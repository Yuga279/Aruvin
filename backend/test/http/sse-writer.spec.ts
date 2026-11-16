/**
 * ============================================================================
 * FILE: sse-writer.spec.ts
 * LOCATION: backend/test/http/sse-writer.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove bounded SSE writes wait for drain and reject invalid frames.
 *
 * ROLE IN PROJECT:
 *    Locks request-owned stream backpressure, listener cleanup, and
 *    scope/order checks so P5 never waits on a leaked timer or private frame.
 *
 * KEY COMPONENTS:
 *    - Drain tests: Producer pause until drain and listener removal.
 *    - Interrupt tests: Close, error, abort, and timeout settlement.
 *    - Guard tests: Scope, sequence, size, and premature completion.
 * ============================================================================
 */

import { EventEmitter } from 'node:events';
import { SseWriter, type SseResponse } from '../../src/http/sse-writer.js';
import { envelope } from './fixtures.js';
class ResponseFixture extends EventEmitter implements SseResponse {
  destroyed = false; writableEnded = false; headersSent = false; writableLength = 0;
  headers: Record<string,string> = {}; frames: string[] = []; ready = true;
  setHeader(name: string, value: string) { this.headers[name] = value; return this; }
  flushHeaders() { this.headersSent = true; }
  write(frame: string) { this.frames.push(frame); return this.ready; }
}
afterEach(() => vi.useRealTimers());
it('does not advance the producer until drain and removes all wait listeners', async () => {
  const res = new ResponseFixture(); res.ready = false;
  const abort = new AbortController(); const writer = new SseWriter(res,abort,20,10000,{ sessionId:'s1',turnId:'t1',attemptId:'a1' });
  let done = false; const pending = writer.emit(envelope(0,{ type:'delta',text:'a\n😀' })).then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false); expect(res.frames).toHaveLength(1);
  res.emit('drain'); await pending;
  expect(res.listenerCount('drain')).toBe(0); expect(res.listenerCount('close')).toBe(0);
  expect(JSON.parse(res.frames[0].slice(6).trim()).event.text).toBe('a\n😀');
  expect(res.headers['Cache-Control']).toBe('no-store, no-transform');
});
it.each(['close','error','abort','timeout'] as const)('settles blocked emit on %s without leaking timers', async event => {
  vi.useFakeTimers(); const res = new ResponseFixture(); res.ready = false;
  const abort = new AbortController(); const writer = new SseWriter(res,abort,5,10000,{ sessionId:'s1',turnId:'t1',attemptId:'a1' });
  const result = expect(writer.emit(envelope(0,{ type:'delta',text:'partial' }))).rejects.toMatchObject({ code:'INTERRUPTED' });
  if (event === 'abort') abort.abort(); else if (event === 'timeout') await vi.advanceTimersByTimeAsync(6);
  else res.emit(event, new Error('private socket details'));
  await result; expect(abort.signal.aborted).toBe(true);
  expect(res.listenerCount('drain')).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it('rejects wrong scope, sequence, private fields, oversized frames, and premature completion before writing', async () => {
  const res = new ResponseFixture(); const writer = new SseWriter(res,new AbortController(),20,1000,{ sessionId:'s1',turnId:'t1',attemptId:'a1' });
  for (const e of [{ ...envelope(0,{ type:'delta',text:'x' }), attemptId:'other' },
    envelope(2,{ type:'delta',text:'x' }), { ...envelope(0,{ type:'delta',text:'x' }), checkpoint:'private' },
    envelope(0,{ type:'delta',text:'x'.repeat(1001) }),
    envelope(0,{ type:'completed',assistantMessageId:'m2',outcome:'completed' })]) {
    await expect(writer.emit(e)).rejects.toThrow();
  }
  expect(res.frames).toEqual([]); expect(res.headersSent).toBe(false);
});
it('cleans repeated backpressure waits and preserves exact frame order',async () => {
  const res = new ResponseFixture(); res.ready = false;
  const writer = new SseWriter(res,new AbortController(),100,10000,{ sessionId:'s1',turnId:'t1',attemptId:'a1' });
  for (let sequence=0;sequence<5;sequence++) {
    const pending = writer.emit(envelope(sequence,{ type:'delta',text:`part ${sequence}` }));
    res.emit('drain'); await pending;
    expect(res.listenerCount('drain')).toBe(0); expect(res.listenerCount('error')).toBe(0);
  }
  expect(res.frames.map(frame => JSON.parse(frame.slice(6).trim()).sequence)).toEqual([0,1,2,3,4]);
});
it('flushes durable acceptance and generating before waiting for model output', async () => {
  const res = new ResponseFixture();
  const writer = new SseWriter(res,new AbortController(),100,10000,{ sessionId:'s1',turnId:'t1',attemptId:'a1' });
  await writer.emit(envelope(0,{ type:'turn-accepted',userMessageId:'m0' }));
  expect(res.frames).toHaveLength(1);
  expect(res.headersSent).toBe(true);
  await writer.emit(envelope(1,{ type:'status',status:'generating',truncated:false }));
  expect(res.frames).toHaveLength(2);
  await writer.emit(envelope(2,{ type:'delta',text:'Hello' }));
  expect(res.frames).toHaveLength(3);
  const first = res.frames[0];
  expect(first).toContain('turn-accepted');
  expect(first).not.toContain('Hello');
  expect(res.frames[2]).toContain('Hello');
  expect(first).not.toContain('"type":"completed"');
  expect(res.headersSent).toBe(true);
});
it('accepts mixed v1/v2 frames without treating progress as terminal', async () => {
  const scope = { sessionId: 's1', turnId: 't1', attemptId: 'a1' };
  const res = new ResponseFixture();
  const writer = new SseWriter(res, new AbortController(), 100, 10000, scope);
  await writer.emit({ protocolVersion: 1, ...scope, sequence: 0,
    event: { type: 'turn-accepted', userMessageId: 'm0' } });
  await writer.emit({ protocolVersion: 2, ...scope, sequence: 1,
    event: { type: 'calendar-progress', phase: 'repairing' } });
  expect(res.frames.join('')).toContain('repairing');
  expect(writer.terminal).toBe(false);
  await writer.emit({ protocolVersion: 2, ...scope, sequence: 2,
    event: { type: 'status', status: 'completed', truncated: false } });
  await writer.emit({ protocolVersion: 2, ...scope, sequence: 3,
    event: { type: 'completed', assistantMessageId: 'm2', outcome: 'completed' } });
  expect(writer.terminal).toBe(true);
});
