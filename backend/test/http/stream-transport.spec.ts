/**
 * ============================================================================
 * FILE: stream-transport.spec.ts
 * LOCATION: backend/test/http/stream-transport.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify one request-owned stream attachment and honest disconnect errors.
 *
 * ROLE IN PROJECT:
 *    Proves the transport reservation is not a persistence lock, holds until
 *    executeTurn settles, and never invents completed/failed terminal status.
 *
 * KEY COMPONENTS:
 *    - Attachment tests: 409 second stream and snapshot occupancy.
 *    - Disconnect tests: Abort reaches P5 while the reservation stays.
 *    - Error tests: Post-header persistence failures without private text.
 * ============================================================================
 */

import { EventEmitter } from 'node:events';
import type { Request,Response } from 'express';
import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { ChatStreamTransport } from '../../src/http/chat-stream.transport.js';
import { fixtureOptions,envelope,deferred } from './fixtures.js';
import { session } from '../persistence/fixtures.js';
function socket() {
  const request = new EventEmitter();
  const response = Object.assign(new EventEmitter(), { destroyed:false,writableEnded:false,headersSent:false,writableLength:0,
    setHeader:vi.fn(),flushHeaders() { this.headersSent = true; },write:vi.fn((_frame:string) => true),
    end() { this.writableEnded = true; } });
  return { request:request as Request,response:response as unknown as Response, raw:response };
}
it('holds the slot until durable execution settles and rejects a second attachment with 409', async () => {
  const o = fixtureOptions(); const sealed = deferred<void>(); const attached = deferred<void>();
  vi.mocked(o.runtime.executeTurn).mockImplementation(async c => {
    await c.emit(envelope(0,{ type:'status',status:'finalizing',truncated:false })); attached.resolve();
    await sealed.promise;
    await c.emit(envelope(1,{ type:'status',status:'completed',truncated:false }));
    await c.emit(envelope(2,{ type:'completed',assistantMessageId:'m2',outcome:'completed' }));
  });
  const t = new ChatStreamTransport(new ChatHttpService(o)); const a = socket();
  const run = t.open('s1','t1',a.request,a.response); await attached.promise;
  const b = socket(); await expect(t.open('s1','t1',b.request,b.response)).rejects.toMatchObject({ code:'CONFLICT_ACTIVE_TURN' });
  expect(a.raw.write.mock.calls.some(call => call[0].includes('"type":"completed"'))).toBe(false);
  expect(t.snapshot().active).toBe(1); sealed.resolve(); await run;
  expect(t.snapshot()).toEqual({ active:0,backpressured:0 }); expect(o.runtime.executeTurn).toHaveBeenCalledTimes(1);
});
it('abort from response close reaches P5 but does not release a still-pending execution', async () => {
  const o = fixtureOptions(); const entered = deferred<void>(); const stopped = deferred<void>();
  vi.mocked(o.runtime.executeTurn).mockImplementation(async c => {
    await c.emit(envelope(0,{ type:'delta',text:'partial' })); entered.resolve();
    await stopped.promise; expect(c.signal.aborted).toBe(true);
  });
  const t = new ChatStreamTransport(new ChatHttpService(o)); const a = socket();
  const run = t.open('s1','t1',a.request,a.response); await entered.promise;
  a.raw.destroyed = true; a.raw.emit('close'); expect(t.snapshot().active).toBe(1);
  stopped.resolve(); await run; expect(t.snapshot().active).toBe(0);
  expect(a.raw.listenerCount('close')).toBe(0);
});
it('normalizes a post-header persistence failure without inventing a failed/completed status', async () => {
  const o = fixtureOptions();
  vi.mocked(o.runtime.executeTurn).mockImplementation(async c => {
    await c.emit(envelope(0,{ type:'status',status:'finalizing',truncated:false }));
    throw new Error('checkpoint dump sk-private private system instructions');
  });
  const t = new ChatStreamTransport(new ChatHttpService(o)); const a = socket();
  await t.open('s1','t1',a.request,a.response);
  const text = a.raw.write.mock.calls.map(call => call[0]).join('');
  expect(text).toContain('PERSISTENCE_ERROR'); expect(text).not.toMatch(/sk-private|checkpoint dump|"type":"completed"|"status":"failed"/);
});
it('reserves the stream before the first asynchronous status work and holds run through executeTurn', async () => {
  const o = fixtureOptions();
  const order: string[] = [];
  const entered = deferred<void>();
  const sealed = deferred<void>();
  o.runtime.reserveStream = vi.fn((userId, sessionId, signal) => {
    order.push('reserve');
    return {
      userId, sessionId, signal,
      run: async <T>(work: () => Promise<T>) => { order.push('run'); return work(); },
      release: vi.fn(),
    };
  });
  vi.mocked(o.sessions.get).mockImplementation(async () => {
    order.push('status');
    return session('server-user', 's1');
  });
  vi.mocked(o.runtime.executeTurn).mockImplementation(async () => {
    order.push('execute');
    entered.resolve();
    await sealed.promise;
  });
  const t = new ChatStreamTransport(new ChatHttpService(o));
  const a = socket();
  const opened = t.open('s1','t1',a.request,a.response);
  await entered.promise;
  expect(order.slice(0, 3)).toEqual(['reserve', 'run', 'status']);
  expect(order.indexOf('status')).toBeLessThan(order.indexOf('execute'));
  expect(o.runtime.reserveStream).toHaveBeenCalledWith('server-user', 's1', expect.any(AbortSignal));
  sealed.resolve();
  await opened;
});
