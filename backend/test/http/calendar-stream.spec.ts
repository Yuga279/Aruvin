/**
 * ============================================================================
 * FILE: calendar-stream.spec.ts
 * LOCATION: backend/test/http/calendar-stream.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify compatible SSE ordering and terminal transport cleanup.
 * ROLE IN PROJECT:
 *    Exercises transport reservations with deterministic runtime/socket fixtures.
 *    No live application or provider is contacted.
 * KEY COMPONENTS:
 *    - Mixed protocol sequencing and ready-after-reservation terminal delivery.
 * ============================================================================
 */
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { ChatStreamTransport } from '../../src/http/chat-stream.transport.js';
import { fixtureOptions, deferred } from './fixtures.js';

function socket() {
  const request = new EventEmitter();
  const response = Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false, headersSent: false, writableLength: 0,
    setHeader: vi.fn(), flushHeaders() { this.headersSent = true; },
    write: vi.fn((_frame: string) => true),
    end() { this.writableEnded = true; },
  });
  return { request: request as Request, response: response as unknown as Response, raw: response };
}

const scope = { sessionId: 's1', turnId: 't1', attemptId: 'a1' };

it('does not publish readiness until execution and its stream reservation have settled', async () => {
  const o = fixtureOptions(); const sent = deferred<void>(); const cleanup = deferred<void>();
  let slotSettled = false;
  vi.mocked(o.runtime.reserveStream!).mockImplementation((userId, sessionId, signal) => ({
    userId, sessionId, signal, release() {},
    async run<T>(work: () => Promise<T>) { const result = await work(); slotSettled = true; return result; },
  }));
  vi.mocked(o.runtime.executeTurn).mockImplementation(async c => {
    await c.emit({ protocolVersion: 1, ...scope, sequence: 0, event: { type: 'turn-accepted', userMessageId: 'm0' } });
    await c.emit({ protocolVersion: 1, ...scope, sequence: 1, event: { type: 'status', status: 'completed', truncated: false } });
    await c.emit({ protocolVersion: 1, ...scope, sequence: 2, event: { type: 'completed', assistantMessageId: 'm2', outcome: 'completed' } });
    sent.resolve(); await cleanup.promise;
  });
  const transport = new ChatStreamTransport(new ChatHttpService(o)); const a = socket();
  a.raw.write.mockImplementation(frame => {
    if (frame.includes('"type":"completed"')) {
      expect(slotSettled).toBe(true); expect(transport.snapshot().active).toBe(0);
    }
    return true;
  });
  const pending = transport.open('s1', 't1', a.request, a.response);
  await sent.promise;
  expect(a.raw.write.mock.calls.map(c => c[0]).join('')).not.toContain('"type":"completed"');
  cleanup.resolve(); await pending;
  expect(a.raw.write.mock.calls.map(c => c[0]).join('')).toContain('"type":"completed"');
});

it('merges v1 and v2 producers into one wire sequence', async () => {
  const o = fixtureOptions();
  const attached = deferred<void>();
  vi.mocked(o.runtime.executeTurn).mockImplementation(async c => {
    await c.emit({
      protocolVersion: 1, ...scope, sequence: 0,
      event: { type: 'turn-accepted', userMessageId: 'm0' },
    });
    await c.emitCalendar!({
      protocolVersion: 2, ...scope, sequence: 0,
      event: { type: 'calendar-progress', phase: 'repairing' },
    });
    await c.emitCalendar!({
      protocolVersion: 2, ...scope, sequence: 1,
      event: {
        type: 'calendar-operation',
        operation: {
          operationId: 'op1', state: 'succeeded', narration: 'pending', retryAction: 'none',
          receipt: { durable: true, eventId: 'evt12', htmlLink: null, expiresAt: null },
        },
      },
    });
    await c.emit({
      protocolVersion: 1, ...scope, sequence: 1,
      event: { type: 'status', status: 'completed', truncated: false },
    });
    await c.emit({
      protocolVersion: 1, ...scope, sequence: 2,
      event: { type: 'completed', assistantMessageId: 'm2', outcome: 'completed' },
    });
    attached.resolve();
  });
  const t = new ChatStreamTransport(new ChatHttpService(o));
  const a = socket();
  await t.open('s1', 't1', a.request, a.response);
  await attached.promise;
  const frames = a.raw.write.mock.calls.map(call => String(call[0])).join('');
  expect(frames).toContain('repairing');
  expect(frames).toContain('calendar-operation');
  const sequences = a.raw.write.mock.calls.flatMap(call =>
    String(call[0]).split('\n\n').filter(Boolean).map(line => JSON.parse(line.slice(6).trim()).sequence));
  expect(sequences).toEqual([0, 1, 2, 3, 4]);
  expect(o.runtime.executeTurn).toHaveBeenCalledWith(expect.objectContaining({
    emit: expect.any(Function), emitCalendar: expect.any(Function),
  }));
});
