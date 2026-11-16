/**
 * ============================================================================
 * FILE: acceptance.native.e2e-spec.ts
 * LOCATION: backend/test/runtime/acceptance.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove durable acceptance, idempotency, and bounded full-history reads.
 *
 * ROLE IN PROJECT:
 *    Native P5 evidence that turns are accepted before inference and that
 *    history recovery reads complete archives rather than newest-page windows.
 *
 * KEY COMPONENTS:
 *    - History tests: Empty archive/attempt discovery for absent sessions.
 *    - Acceptance tests: Duplicate, changed payload, concurrent, retry, join.
 * ============================================================================
 */

import { nativeHarness } from './native-harness.js';
import { archiveRecords, attemptsFor } from '../../src/chat-runtime/history.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Runtime durable acceptance', () => {
  it('reads complete bounded archive, not just the newest UI page', async () => {
    const h = await nativeHarness();
    try {
      expect(await archiveRecords(h.persistence, h.identity.userId, 'absent')).toEqual([]);
      expect(await attemptsFor(h.persistence, h.identity.userId, 'absent')).toEqual([]);
    } finally { await h.close(); }
  }, 30000);
  it('accepts before inference, deduplicates new chats and refuses changed payload', async () => {
    const h = await nativeHarness();
    try {
      const runtime = new DurableChatRuntime(h.deps);
      const command = { identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' };
      const first = await runtime.submitTurn(command);
      expect(await runtime.submitTurn(command)).toEqual(first);
      expect(h.fetcher).not.toHaveBeenCalled();
      expect(await h.persistence.metadata.getAcceptance(h.identity.userId, first.sessionId, first.attemptId)).not.toBeNull();
      expect((await h.persistence.messages.list(h.identity.userId, first.sessionId, { cursor: null, limit: 50 })).items).toHaveLength(1);
      await expect(runtime.submitTurn({ ...command, content: 'Changed' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
      await expect(runtime.submitTurn({ ...command, sessionId: first.sessionId, idempotencyKey: 'request-0002' })).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
    } finally { await h.close(); }
  }, 30000);
  it('two clients cannot accept two distinct inputs into one active session', async () => {
    const h = await nativeHarness();
    try {
      const runtime = new DurableChatRuntime(h.deps);
      const first = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      const results = await Promise.allSettled([2, 3].map(n => runtime.submitTurn({ identity: h.identity,
        sessionId: first.sessionId, content: `Input ${n}`, idempotencyKey: `request-000${n}` })));
      expect(results.every(r => r.status === 'rejected')).toBe(true);
      expect((await h.persistence.messages.list(h.identity.userId, first.sessionId, { cursor: null, limit: 50 })).items).toHaveLength(1);
      expect(h.fetcher).not.toHaveBeenCalled();
    } finally { await h.close(); }
  }, 30000);
  it('explicit retry links a new attempt to the original accepted input once', async () => {
    const h = await nativeHarness();
    try {
      const r = new DurableChatRuntime(h.deps);
      const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      await r.reconcileSession(h.identity.userId, ids.sessionId);
      const command = { identity: h.identity, sessionId: ids.sessionId, turnId: ids.turnId, idempotencyKey: 'retry-key-0001' };
      const retry = await r.retryTurn(command);
      expect(await r.retryTurn(command)).toEqual(retry);
      expect(retry.userMessageId).toBe(ids.userMessageId); expect(retry.turnId).toBe(ids.turnId);
      expect(retry.attemptId).not.toBe(ids.attemptId);
      await r.executeTurn({ userId: h.identity.userId, ...retry, signal: new AbortController().signal, emit: async () => undefined });
      const body = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
      expect(body.messages.filter((m: { role: string; content: string }) => m.role === 'user' && m.content === 'Hello')).toHaveLength(1);
      expect((await archiveRecords(h.persistence, h.identity.userId, ids.sessionId)).filter(m => m.role === 'user')).toHaveLength(1);
      expect((await h.persistence.metadata.getAttempt(h.identity.userId, ids.sessionId, retry.attemptId))?.causal.previousAttemptId).toBe(ids.attemptId);
    } finally { await h.close(); }
  }, 30000);
  it('identical simultaneous new-chat requests join acceptance without duplicate input', async () => {
    const h = await nativeHarness();
    try {
      const r = new DurableChatRuntime(h.deps); const c = { identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' };
      const results = await Promise.all([r.submitTurn(c), r.submitTurn(c)]);
      expect(results[0]).toEqual(results[1]);
      expect((await archiveRecords(h.persistence, h.identity.userId, results[0].sessionId)).filter(m => m.role === 'user')).toHaveLength(1);
      expect(h.fetcher).not.toHaveBeenCalled();
    } finally { await h.close(); }
  }, 30000);
  it('follow-up turn sends fixed context plus completed history and new input once', async () => {
    const h = await nativeHarness();
    try {
      const r = new DurableChatRuntime(h.deps);
      const first = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      await r.executeTurn({ userId: h.identity.userId, ...first, signal: new AbortController().signal, emit: async () => undefined });
      const second = await r.submitTurn({ identity: h.identity, sessionId: first.sessionId, content: 'Next', idempotencyKey: 'request-0002' });
      await r.executeTurn({ userId: h.identity.userId, ...second, signal: new AbortController().signal, emit: async () => undefined });
      const body = JSON.parse(String(h.fetcher.mock.calls[1][1]?.body));
      const roles = body.messages.map((m: { role: string }) => m.role);
      expect(roles.slice(0, 2)).toEqual(['system', 'system']);
      expect(body.messages.filter((m: { role: string; content: string }) => m.role === 'user' && m.content === 'Hello')).toHaveLength(1);
      expect(body.messages.filter((m: { role: string }) => m.role === 'assistant')).toHaveLength(1);
      expect(body.messages.filter((m: { role: string; content: string }) => m.role === 'user' && m.content === 'Next')).toHaveLength(1);
      expect(h.fetcher).toHaveBeenCalledTimes(2);
    } finally { await h.close(); }
  }, 30000);
  it('rejects a fourth durable attempt for the same logical turn', async () => {
    const h = await nativeHarness();
    try {
      const r = new DurableChatRuntime(h.deps);
      const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      await r.reconcileSession(h.identity.userId, ids.sessionId);
      await r.retryTurn({ identity: h.identity, sessionId: ids.sessionId, turnId: ids.turnId, idempotencyKey: 'retry-key-0001' });
      await r.reconcileSession(h.identity.userId, ids.sessionId);
      await r.retryTurn({ identity: h.identity, sessionId: ids.sessionId, turnId: ids.turnId, idempotencyKey: 'retry-key-0002' });
      await r.reconcileSession(h.identity.userId, ids.sessionId);
      await expect(r.retryTurn({ identity: h.identity, sessionId: ids.sessionId, turnId: ids.turnId, idempotencyKey: 'retry-key-0003' }))
        .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
      expect(h.fetcher).not.toHaveBeenCalled();
    } finally { await h.close(); }
  }, 30000);
});
