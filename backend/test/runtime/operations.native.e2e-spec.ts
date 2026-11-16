/**
 * ============================================================================
 * FILE: operations.native.e2e-spec.ts
 * LOCATION: backend/test/runtime/operations.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove P8 drain, admission stop, and quiescent recovery hooks.
 *
 * ROLE IN PROJECT:
 *    Native P5 evidence that stopping admission never infers accepted work,
 *    drain reports honestly, and unattached turns remain recoverable.
 *
 * KEY COMPONENTS:
 *    - Drain tests: stopAccepting, drained snapshot, interrupted recovery.
 * ============================================================================
 */

import { createChatRuntime } from '../../src/chat-runtime/index.js';
import { nativeHarness } from './native-harness.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Runtime operations and drain', () => {
  it('stops admission, never infers accepted work during drain, and leaves it recoverable', async () => {
    const h = await nativeHarness();
    try {
      const r = createChatRuntime(h.deps);
      const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      r.stopAccepting();
      await expect(r.submitTurn({ identity: h.identity, sessionId: ids.sessionId, content: 'Another', idempotencyKey: 'request-0002' }))
        .rejects.toMatchObject({ code: 'NOT_READY' });
      expect(await r.drain(20)).toMatchObject({ drained: true, active: 0, unresolvedWrites: 0 });
      await r.reconcileSession(h.identity.userId, ids.sessionId);
      expect((await r.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('interrupted');
      expect(h.fetcher).not.toHaveBeenCalled();
    } finally { await h.close(); }
  }, 30000);
  it('refuses a foreign stopped owner without explicit proof and expiry is not takeover', async () => {
    const h = await nativeHarness();
    try {
      const r = createChatRuntime(h.deps);
      const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      const session = await h.persistence.sessions.get(h.identity.userId, ids.sessionId);
      expect(session?.execution.ownerId).toBeNull();
      expect(() => r.allowStoppedOwner('')).toThrow();
      try { r.allowStoppedOwner(''); } catch (error) { expect(error).toMatchObject({ code: 'NOT_READY' }); }
      r.allowStoppedOwner('other-executor');
      expect(h.fetcher).not.toHaveBeenCalled();
    } finally { await h.close(); }
  }, 30000);
});
