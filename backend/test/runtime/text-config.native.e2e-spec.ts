/**
 * ============================================================================
 * FILE: text-config.native.e2e-spec.ts
 * LOCATION: backend/test/runtime/text-config.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Native MongoDB verification that text config snapshots leave durable state secret-free.
 *
 * ROLE IN PROJECT:
 *    Proves attempts retain settings across configuration publications and that
 *    all six MongoDB collections contain zero API keys, tokens, or credentials.
 *
 * KEY COMPONENTS:
 *    - Durable attempt stability: Retain IDs and metadata across published updates.
 *    - Secret-free persistence audit: Scans all 6 collections for credentials.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { nativeHarness } from './native-harness.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';

const describeNative = process.env.AURVIN_TEST_MONGODB_URI ? describe : describe.skip;

describeNative('text configuration native MongoDB stability and secret exclusion', () => {
  it('retains attempt metadata across configuration updates and persists zero secrets across all 6 collections', async () => {
    const h = await nativeHarness();
    try {
      const snapA = textSnapshot(1, { maxOutputTokens: 2048 }, 'fixture/modelA', 'SECRET-API-KEY-A', h.identity.userId);
      const snapB = textSnapshot(2, { maxOutputTokens: 512 }, 'fixture/modelB', 'SECRET-API-KEY-B', h.identity.userId);

      let current = snapA;
      h.currentConfig.current = () => current;
      h.deps.limits = snapA.modelLimits!;

      const runtime = new DurableChatRuntime(h.deps);

      // Submit and execute turn 1 under snapshot A
      const first = await runtime.submitTurn({
        identity: h.identity,
        sessionId: null,
        content: 'Turn 1 prompt',
        idempotencyKey: 'native-request-1',
      });
      await runtime.executeTurn({
        userId: h.identity.userId,
        sessionId: first.sessionId,
        turnId: first.turnId,
        attemptId: first.attemptId,
        signal: new AbortController().signal,
        emit: async () => {},
      });

      const att1 = await h.persistence.metadata.getAttempt(h.identity.userId, first.sessionId, first.attemptId);
      expect(att1?.modelId).toBe('fixture/modelA');

      // Publish snapshot B
      current = snapB;
      h.deps.limits = snapB.modelLimits!;

      // Previous attempt record is unchanged
      const att1After = await h.persistence.metadata.getAttempt(h.identity.userId, first.sessionId, first.attemptId);
      expect(att1After).toEqual(att1);

      // Submit and execute turn 2 under snapshot B
      const second = await runtime.submitTurn({
        identity: h.identity,
        sessionId: first.sessionId,
        content: 'Turn 2 prompt',
        idempotencyKey: 'native-request-2',
      });
      const att2 = await h.persistence.metadata.getAttempt(h.identity.userId, second.sessionId, second.attemptId);
      expect(att2?.modelId).toBe('fixture/modelB');

      await runtime.executeTurn({
        userId: h.identity.userId,
        sessionId: second.sessionId,
        turnId: second.turnId,
        attemptId: second.attemptId,
        signal: new AbortController().signal,
        emit: async () => {},
      });

      // Audit all 6 collections to prove zero secrets are stored durably
      const collectionNames = ['sessions', 'messages', 'agent-memory', 'metadata', 'checkpoints', 'checkpoint_writes'];
      for (const colName of collectionNames) {
        const docs = await h.db.db.collection(colName).find({}).toArray();
        const json = JSON.stringify(docs);
        expect(json).not.toContain('SECRET-API-KEY-A');
        expect(json).not.toContain('SECRET-API-KEY-B');
        expect(json).not.toContain('Bearer');
        expect(json).not.toContain('configSnapshot');
      }
    } finally {
      await h.close();
    }
  }, 60000);
});
