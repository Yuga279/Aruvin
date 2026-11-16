/**
 * ============================================================================
 * FILE: recovery.native.e2e-spec.ts
 * LOCATION: backend/test/runtime/recovery.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove sealed-result publication and crash-window recovery without replay.
 *
 * ROLE IN PROJECT:
 *    Native P5 evidence that unlinked results cannot publish, sealed answers
 *    recover without a second POST, and no-result work is interrupted.
 *
 * KEY COMPONENTS:
 *    - Publication tests: Fabricated saved results fail closed.
 *    - Crash-window tests: Archive/memory/checkpoint/terminal recovery.
 * ============================================================================
 */

import { checkedResult } from '../../src/chat-runtime/finalization.js';
import { nativeHarness } from './native-harness.js';
import { attempt, message, accounting } from '../persistence/fixtures.js';
import { buildReferenceManifest } from '../../src/context/index.js';
import { boundaryFor } from '../../src/agent/state.js';
import { outputId, eventIdFor } from '../../src/chat-runtime/identity.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { archiveRecords } from '../../src/chat-runtime/history.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Runtime crash recovery', () => {
  it('does not publish an unlinked/fabricated saved result', async () => {
    const h = await nativeHarness();
    try {
      const a = attempt();
      const assets = { ...h.deps.assets, instructionVersion: a.instructionVersion,
        knowledgeContentHash: a.knowledgeContentHash, graphSchemaVersion: a.graphSchemaVersion };
      const base = buildReferenceManifest(a.userId, a.sessionId, 0, [], assets, h.deps.config.budgets);
      const assistant = { ...message(2), role: 'assistant' as const, messageId: outputId(a),
        eventId: eventIdFor(a.userId, a.sessionId, outputId(a)), completionStatus: 'streaming' as const };
      const target = buildReferenceManifest(a.userId, a.sessionId, 1,
        [message(0), { ...assistant, completionStatus: 'completed' }], assets, h.deps.config.budgets);
      await expect(checkedResult(h.persistence, a, { input: { attempt: a, assistantSequence: 2 }, assistant,
        accounting: accounting(), base: boundaryFor(base), target, outcome: 'completed' }))
        .rejects.toMatchObject({ code: 'NOT_READY' });
      expect(h.fetcher).not.toHaveBeenCalled();
    } finally { await h.close(); }
  }, 30000);
  it('recovers a sealed graph answer after archive failure without reinference and is repeatable', async () => {
    const h = await nativeHarness();
    try {
      const runtime = new DurableChatRuntime(h.deps);
      const ids = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      const append = h.persistence.messages.append.bind(h.persistence.messages);
      const failure = vi.spyOn(h.persistence.messages, 'append').mockImplementation(async m => {
        if (m.role === 'assistant') throw new Error('fixture crash before archive write');
        return append(m);
      });
      await expect(runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
        emit: async () => undefined })).rejects.toThrow();
      failure.mockRestore();
      expect((await runtime.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('finalizing');
      const restarted = new DurableChatRuntime(h.deps);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      expect((await restarted.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('completed');
      expect((await archiveRecords(h.persistence, h.identity.userId, ids.sessionId)).map(m => m.role)).toEqual(['user', 'assistant']);
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  }, 30000);
  it('interrupts accepted work with no sealed result and never starts inference during recovery', async () => {
    const h = await nativeHarness();
    try {
      const r = new DurableChatRuntime(h.deps);
      const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      await r.reconcileSession(h.identity.userId, ids.sessionId);
      await r.reconcileSession(h.identity.userId, ids.sessionId);
      expect((await r.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('interrupted');
      expect(h.fetcher).not.toHaveBeenCalled();
      expect((await archiveRecords(h.persistence, h.identity.userId, ids.sessionId)).filter(m => m.role === 'user')).toHaveLength(1);
    } finally { await h.close(); }
  }, 30000);
  it.each(['memory', 'checkpoint-boundary', 'assistant-terminal', 'attempt-terminal', 'slot-clear'] as const)
  ('replays %s publication window without a second POST', async window => {
    const h = await nativeHarness();
    try {
      const runtime = new DurableChatRuntime(h.deps);
      const ids = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
      const p = h.persistence;
      let spy: { mockRestore(): void };
      if (window === 'memory') spy = vi.spyOn(p.memory, 'put').mockRejectedValueOnce(new Error('crash before memory'));
      else if (window === 'assistant-terminal') spy = vi.spyOn(p.messages, 'updateCompletion').mockRejectedValueOnce(new Error('crash before message terminal'));
      else if (window === 'attempt-terminal') {
        const original = p.metadata.compareAttempt.bind(p.metadata);
        spy = vi.spyOn(p.metadata, 'compareAttempt').mockImplementation(async (a, expected) => {
          if (a.status === 'completed') throw new Error('crash before attempt terminal'); return original(a, expected);
        });
      } else if (window === 'slot-clear') spy = vi.spyOn(p.owner, 'clearAttempt').mockRejectedValueOnce(new Error('crash before slot clear'));
      else {
        const { ScopedMongoSaver } = await import('../../src/persistence/checkpoints.js');
        const original = ScopedMongoSaver.prototype.put;
        spy = vi.spyOn(ScopedMongoSaver.prototype, 'put').mockImplementation(async function (this: InstanceType<typeof ScopedMongoSaver>, ...args) {
          if (args[2].source === 'update') throw new Error('crash before boundary checkpoint');
          return original.apply(this, args);
        });
      }
      try { await expect(runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
        emit: async () => undefined })).rejects.toThrow(); } finally { spy.mockRestore(); }
      const restarted = new DurableChatRuntime(h.deps);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      expect((await restarted.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('completed');
      expect(h.fetcher).toHaveBeenCalledTimes(1);
      expect((await archiveRecords(p, h.identity.userId, ids.sessionId)).filter(m => m.role === 'user')).toHaveLength(1);
      expect((await archiveRecords(p, h.identity.userId, ids.sessionId)).filter(m => m.role === 'assistant')).toHaveLength(1);
    } finally { await h.close(); }
  }, 30000);
});
