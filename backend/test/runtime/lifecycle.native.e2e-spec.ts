/**
 * ============================================================================
 * FILE: lifecycle.native.e2e-spec.ts
 * LOCATION: backend/test/runtime/lifecycle.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove streamed lifecycle events, honest outcomes, and cancellation.
 *
 * ROLE IN PROJECT:
 *    Native P5 evidence that completed/truncated publication is durable, that
 *    provider faults never emit completion, and that disconnects interrupt.
 *
 * KEY COMPONENTS:
 *    - Outcome tests: Normal and length fixtures publish distinct terminals.
 *    - Failure tests: Error/EOF/malformed streams never complete.
 *    - Disconnect/cancel tests: Interrupted archive and stale-cancel rejection.
 * ============================================================================
 */

import { nativeHarness } from './native-harness.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { archiveRecords } from '../../src/chat-runtime/history.js';
import type { StreamEnvelope } from '../../src/contracts/stream.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Runtime lifecycle outcomes', () => {
  it.each([['normal', 'completed'], ['length', 'truncated']] as const)('durably publishes %s with honest outcome', async (fixture, outcome) => {
    const h = await nativeHarness(FRAMES[fixture]);
    try {
      const runtime = new DurableChatRuntime(h.deps); const events: StreamEnvelope[] = [];
      const ids = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      await runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
        emit: async e => {
          events.push(e);
          if (e.event.type === 'completed') {
            expect((await h.persistence.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status).toBe(outcome);
            expect((await h.persistence.messages.get(h.identity.userId, ids.sessionId, e.event.assistantMessageId))?.completionStatus).toBe(outcome);
            expect((await h.persistence.sessions.get(h.identity.userId, ids.sessionId))?.execution.activeAttemptId).toBeNull();
          }
        } });
      expect(events.map(e => e.sequence)).toEqual(events.map((_, i) => i));
      expect(events.some(e => e.event.type === 'delta')).toBe(true);
      expect(events.filter(e => e.event.type === 'status').map(e => e.event.type === 'status' && e.event.status))
        .toEqual(['generating', 'finalizing', outcome]);
      expect(events.at(-1)?.event).toMatchObject({ type: 'completed', outcome });
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  }, 30000);
  it.each(['errorBefore', 'errorAfter', 'eof', 'finishEof', 'onlyDone', 'malformed'] as const)('never emits completion on %s', async fixture => {
    const h = await nativeHarness(FRAMES[fixture]);
    try {
      const runtime = new DurableChatRuntime(h.deps); const events: StreamEnvelope[] = [];
      const ids = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      await expect(runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
        emit: async e => { events.push(e); } })).rejects.toThrow();
      expect(events.some(e => e.event.type === 'completed')).toBe(false);
      expect((await h.persistence.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status).not.toBe('completed');
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  }, 30000);
  it('disconnect after a delta interrupts and preserves a bounded incomplete archive record', async () => {
    const h = await nativeHarness();
    try {
      const runtime = new DurableChatRuntime(h.deps); const controller = new AbortController();
      const ids = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      await expect(runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: controller.signal,
        emit: async e => { if (e.event.type === 'delta') controller.abort(); } })).rejects.toThrow();
      expect((await runtime.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('interrupted');
      const messages = await archiveRecords(h.persistence, h.identity.userId, ids.sessionId);
      expect(messages.find(m => m.role === 'assistant')).toMatchObject({ completionStatus: 'interrupted' });
      expect((await h.persistence.memory.get(h.identity.userId, ids.sessionId))?.messageRefs.map(r => r.messageId)).toEqual([ids.userMessageId]);
    } finally { await h.close(); }
  }, 30000);
  it('cancel after a delta aborts the active attempt; stale cancel cannot cancel a retry', async () => {
    const h = await nativeHarness();
    try {
      const r = new DurableChatRuntime(h.deps);
      const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      await expect(r.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
        emit: async e => { if (e.event.type === 'delta') await r.cancelTurn({ identity: h.identity,
          sessionId: ids.sessionId, turnId: ids.turnId, attemptId: ids.attemptId }); } })).rejects.toThrow();
      expect((await r.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('cancelled');
      const retry = await r.retryTurn({ identity: h.identity, sessionId: ids.sessionId, turnId: ids.turnId, idempotencyKey: 'retry-key-0001' });
      await expect(r.cancelTurn({ identity: h.identity, sessionId: ids.sessionId, turnId: ids.turnId,
        attemptId: ids.attemptId })).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
      expect(retry.attemptId).not.toBe(ids.attemptId);
    } finally { await h.close(); }
  }, 30000);
  it('throwing sink interrupts without completion and terminal reattach does not POST again', async () => {
    const h = await nativeHarness();
    try {
      const r = new DurableChatRuntime(h.deps);
      const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      await expect(r.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
        emit: async () => { throw new Error('sink failed'); } })).rejects.toThrow();
      expect((await r.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('interrupted');
      const retry = await r.retryTurn({ identity: h.identity, sessionId: ids.sessionId, turnId: ids.turnId, idempotencyKey: 'retry-key-0001' });
      const events: StreamEnvelope[] = [];
      await r.executeTurn({ userId: h.identity.userId, ...retry, signal: new AbortController().signal, emit: async e => { events.push(e); } });
      expect(h.fetcher).toHaveBeenCalledTimes(1);
      const again: StreamEnvelope[] = [];
      await r.executeTurn({ userId: h.identity.userId, ...retry, signal: new AbortController().signal, emit: async e => { again.push(e); } });
      expect(again.some(e => e.event.type === 'delta')).toBe(false);
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  }, 30000);
  it('a second executeTurn attachment conflicts while the first owns the session', async () => {
    const h = await nativeHarness();
    try {
      const r = new DurableChatRuntime(h.deps);
      const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      let started!: () => void;
      const gate = new Promise<void>(resolve => { started = resolve; });
      const first = r.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
        emit: async e => { if (e.event.type === 'turn-accepted') started(); } });
      await gate;
      await expect(r.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
        emit: async () => undefined })).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
      await first;
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  }, 30000);
});
