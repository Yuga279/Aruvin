/**
 * ============================================================================
 * FILE: chat-stream.transport.ts
 * LOCATION: backend/src/http/chat-stream.transport.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Own one stream attachment per user/session and interrupt on disconnect.
 *
 * ROLE IN PROJECT:
 *    Delegates executeTurn to P5, holds a bounded transport reservation until
 *    that promise settles, and emits sanitized application errors only after
 *    SSE headers have been committed.
 *
 * KEY COMPONENTS:
 *    - open: Latest-attempt stream, conflict, and disconnect wiring.
 *    - snapshot: Aggregate active/backpressured counts for P8 telemetry.
 * ============================================================================
 */

import type { Request,Response } from 'express';
import { calendarCompatibleEnvelopeSchema } from '../contracts/calendar-wire.js';
import { AppError } from '../platform/errors/app-error.js';
import { ChatHttpService } from './chat-http.service.js';
import { SseWriter } from './sse-writer.js';
import { publicError,errorBody } from './client-errors.js';
type StreamAttachment = {
  userId: string; authSessionId: string; abort: AbortController; response: Response; writer: SseWriter | null;
};
export class ChatStreamTransport {
  private attachments = new Map<string, StreamAttachment>();
  constructor(private service:ChatHttpService) {}
  snapshot() { return { active:this.attachments.size,
    backpressured:[...this.attachments.values()].filter(a => a.writer?.blocked).length }; }
  closeUser(userId: string, sessionId?: string): void {
    for (const attachment of this.attachments.values()) {
      if (attachment.userId !== userId) continue;
      if (sessionId !== undefined && attachment.authSessionId !== sessionId) continue;
      attachment.abort.abort();
      if (!attachment.response.writableEnded && !attachment.response.destroyed) attachment.response.end();
    }
  }
  async open(sessionId:string,turnId:string,req:Request,res:Response): Promise<void> {
    const o = this.service.o; const identity = o.identity.resolve(); const principal = o.principal();
    const userId = identity.userId;
    const key = JSON.stringify([userId,sessionId]);
    if (this.attachments.has(key)) throw new AppError('CONFLICT_ACTIVE_TURN','Stream already attached.');
    const maxStreams = o.currentConfig?.current()?.budgets.maxConcurrentGenerationsPerProcess ?? o.budgets.maxConcurrentGenerationsPerProcess;
    if (this.attachments.size >= maxStreams)
      throw new AppError('CONCURRENCY_LIMIT','Too many streams.');
    const abort = new AbortController();
    const attachment: StreamAttachment = {
      userId, authSessionId: principal.sessionId, abort, response: res, writer: null,
    };
    this.attachments.set(key, attachment);
    const closed = () => { if (!res.writableEnded) abort.abort(); };
    req.once('aborted',closed); res.once('close',closed); res.once('error',closed);
    if (req.aborted || res.destroyed) abort.abort();
    let writer:SseWriter | undefined; let selectedAttemptId:string | undefined;
    const terminalFrames: ReturnType<typeof calendarCompatibleEnvelopeSchema.parse>[] = [];
    let terminalBytes = 0;
    try {
      const slot = o.runtime.reserveStream?.(userId, sessionId, abort.signal);
      if (!slot) throw new AppError('NOT_READY', 'Stream reservation is unavailable.');
      await slot.run(async () => {
        const status = await this.service.streamStatus(sessionId,turnId);
        selectedAttemptId = status.attemptId;
        if (abort.signal.aborted) return;
        // Other tabs may poll status, but cannot attach and own the same run.
        if (['generating','finalizing'].includes(status.status))
          throw new AppError('CONFLICT_ACTIVE_TURN','An attempt is already running or needs recovery.');
        const attemptBudgets = o.runtime.attemptStreamBudgets?.(userId, sessionId, status.attemptId);
        const idleStreamTimeoutMs = attemptBudgets?.idleStreamTimeoutMs ?? o.budgets.idleStreamTimeoutMs;
        const maxMessageBytes = attemptBudgets?.maxMessageBytes ?? o.budgets.maxMessageBytes;
        writer = new SseWriter(res,abort,idleStreamTimeoutMs,
          6 * Math.min(maxMessageBytes,65536) + 4096,{ sessionId,turnId,attemptId:status.attemptId });
        attachment.writer = writer;
        const forward = async (raw: unknown): Promise<void> => {
          const event = calendarCompatibleEnvelopeSchema.parse(raw);
          if (event.sessionId !== sessionId || event.turnId !== turnId
            || event.attemptId !== selectedAttemptId) {
            throw new AppError('PERSISTENCE_ERROR', 'Invalid application event.', false);
          }
          // Hold terminal publication (including reset deltas after a terminal
          // status) until reservation.run has also relinquished transport work.
          if (terminalFrames.length || event.event.type === 'completed' || event.event.type === 'error'
            || (event.event.type === 'status' && ['completed','truncated','failed','cancelled','interrupted'].includes(event.event.status))) {
            terminalBytes += Buffer.byteLength(JSON.stringify(event), 'utf8');
            if (terminalBytes > 6 * maxMessageBytes + 65536)
              throw new AppError('INTERRUPTED', 'Stream buffer limit exceeded.', false);
            terminalFrames.push(event);
            return;
          }
          await writer!.emit({ ...event, sequence: writer!.next });
        };
        await o.runtime.executeTurn({
          userId, sessionId, turnId, attemptId: status.attemptId,
          signal: abort.signal, emit: forward, emitCalendar: forward,
        });
        // A terminal read-only reattachment can have only a status event in P5.
        if (!writer.terminal && !terminalFrames.some(e => e.event.type === 'error')
          && ['failed','cancelled','interrupted'].includes(status.status)) {
          const body = status.error ?? errorBody(status.status === 'cancelled' ? 'CANCELLED' : 'INTERRUPTED',false);
          terminalFrames.push({ protocolVersion:1,sessionId,turnId,attemptId:status.attemptId,sequence:writer.next,
            event:{ type:'error',...body } });
        }
      });
      if (this.attachments.get(key)?.writer === writer) this.attachments.delete(key);
      for (const event of terminalFrames) await writer!.emit({ ...event, sequence: writer!.next });
    } catch (error) {
      if (abort.signal.aborted || res.destroyed) return;
      if (!res.headersSent) throw error;
      if (this.attachments.get(key)?.writer === writer) this.attachments.delete(key);
      if (writer) {
        try { for (const event of terminalFrames) await writer.emit({ ...event, sequence: writer.next }); }
        catch { abort.abort(); return; }
      }
      if (writer && selectedAttemptId && !writer.terminal) {
        const { body } = publicError(error);
        try { await writer.emit({ protocolVersion:1,sessionId,turnId,
          attemptId:selectedAttemptId,sequence:writer.next,
          event:{ type:'error',...body } }); } catch { abort.abort(); }
      }
    } finally {
      req.off('aborted',closed); res.off('close',closed); res.off('error',closed);
      if (this.attachments.get(key)?.writer === writer || this.attachments.get(key)?.writer == null)
        this.attachments.delete(key);
      if (res.headersSent && !res.destroyed && !res.writableEnded) res.end();
    }
  }
}
