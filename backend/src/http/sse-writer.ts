/**
 * ============================================================================
 * FILE: sse-writer.ts
 * LOCATION: backend/src/http/sse-writer.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Write version-1 application SSE frames with awaited backpressure.
 *
 * ROLE IN PROJECT:
 *    Flushes durable acceptance and generating feedback promptly, enforces
 *    attempt-local sequence and scope, and settles pending writes on close,
 *    error, abort, or drain timeout so P5 can finish tracked work.
 *
 * KEY COMPONENTS:
 *    - SseWriter.emit: Validate, bound, write, and await drain.
 *    - Initial feedback: Every meaningful event is delivered without buffering.
 *    - waitDrain: One bounded pending write with listener cleanup.
 * ============================================================================
 */

import type { EventEmitter } from 'node:events';
import { calendarCompatibleEnvelopeSchema } from '../contracts/calendar-wire.js';
import { AppError } from '../platform/errors/app-error.js';
import { errorBody } from './client-errors.js';
type CompatibleEnvelope = ReturnType<typeof calendarCompatibleEnvelopeSchema.parse>;
export type SseResponse = Pick<EventEmitter,'once'|'off'> & {
  destroyed:boolean; writableEnded:boolean; headersSent:boolean; writableLength:number;
  setHeader(name:string,value:string): unknown; flushHeaders():void; write(chunk:string):boolean;
};
export class SseWriter {
  next = 0; terminal = false; blocked = false;
  private outcome: 'completed' | 'truncated' | null = null;
  constructor(private res:SseResponse, private abort:AbortController, private timeoutMs:number,
    private maxFrameBytes:number, private scope:Pick<CompatibleEnvelope,'sessionId'|'turnId'|'attemptId'>) {}
  private commitHeaders(): void {
    if (!this.res.headersSent) {
      this.res.setHeader('Content-Type','text/event-stream; charset=utf-8');
      this.res.setHeader('Cache-Control','no-store, no-transform');
      this.res.setHeader('X-Accel-Buffering','no'); this.res.setHeader('X-Content-Type-Options','nosniff');
      this.res.flushHeaders();
    }
  }
  private track(e: CompatibleEnvelope): void {
    this.next++;
    if (e.event.type === 'status' && ['completed','truncated'].includes(e.event.status))
      this.outcome = e.event.status as 'completed' | 'truncated';
    if (e.event.type === 'completed' || e.event.type === 'error') this.terminal = true;
  }
  async emit(raw: unknown): Promise<void> {
    if (this.abort.signal.aborted || this.res.destroyed || this.res.writableEnded)
      throw new AppError('INTERRUPTED','Stream closed.',false);
    const e = calendarCompatibleEnvelopeSchema.parse(raw);
    if (e.sessionId !== this.scope.sessionId || e.turnId !== this.scope.turnId || e.attemptId !== this.scope.attemptId ||
      e.sequence !== this.next || this.terminal) throw new AppError('PERSISTENCE_ERROR','Invalid application event.',false);
    if (e.event.type === 'error') e.event = { type:'error',...errorBody(e.event.code,e.event.retryable) };
    if (e.event.type === 'completed' && this.outcome !== e.event.outcome)
      throw new AppError('PERSISTENCE_ERROR','Completion order invalid.',false);
    const frame = `data: ${JSON.stringify(e)}\n\n`;
    if (Buffer.byteLength(frame,'utf8') > this.maxFrameBytes)
      throw new AppError('INTERRUPTED','Stream buffer limit exceeded.',false);
    if (this.res.writableLength > this.maxFrameBytes)
      throw new AppError('INTERRUPTED','Stream buffer limit exceeded.',false);
    this.commitHeaders();
    if (!this.res.write(frame)) await this.waitDrain();
    this.track(e);
  }
  private waitDrain(): Promise<void> {
    this.blocked = true;
    return new Promise<void>((resolve,reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const clean = () => { clearTimeout(timer); this.blocked = false; this.res.off('drain',drain);
        this.res.off('error',fail); this.res.off('close',fail); this.abort.signal.removeEventListener('abort',fail); };
      const drain = () => { clean(); resolve(); };
      const fail = () => { clean(); this.abort.abort(); reject(new AppError('INTERRUPTED','Stream write failed.',false)); };
      this.res.once('drain',drain); this.res.once('error',fail); this.res.once('close',fail);
      this.abort.signal.addEventListener('abort',fail,{ once:true });
      timer = setTimeout(fail,this.timeoutMs);
      if (this.abort.signal.aborted || this.res.destroyed || this.res.writableEnded) fail();
    });
  }
}
