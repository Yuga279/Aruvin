/**
 * ============================================================================
 * FILE: canvas-multimodal.native.e2e-spec.ts
 * LOCATION: backend/test/voice/integration/canvas-multimodal.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Isolated native MongoDB publication and crash recovery verification for voice Canvas artifacts.
 *
 * ROLE IN PROJECT:
 *    Verifies that Canvas artifacts committed during voice delivery survive checkpoint publication,
 *    assistant append failure, and manifest failure in an isolated native replica set database without
 *    re-inference or artifact duplication.
 *
 * KEY COMPONENTS:
 *    - Authorization gate: AURVIN_CANVAS_NATIVE_AUTHORIZED and AURVIN_TEST_MONGODB_URI checks
 *    - Native recovery test: Fault injection across before-append, after-append, and journal-only locations
 *    - Reconcile validation: Proves deterministic assistant archive and public projection equality
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import { voiceRuntimeHarness } from '../../runtime/voice-runtime-harness.js';
import { chunk, usage, done } from '../../fixtures/openrouter/frames.js';
import { deliveryFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import { VoiceDelivery } from '../../../src/voice/agent/voice-delivery.js';
import { DurableChatRuntime } from '../../../src/chat-runtime/durable-chat-runtime.js';
import { archiveRecords } from '../../../src/chat-runtime/history.js';
import { graphConfig } from '../../../src/chat-runtime/finalization.js';
import { key } from '../../../src/persistence/records.js';
import type { LiveExecution } from '../../../src/chat-runtime/ports.js';
import { VISUALS, SPEECH, block } from '../../../../frontend/src/features/voice/integration-tests/canvas-multimodal-fixtures.js';

const authorized = process.env.AURVIN_CANVAS_NATIVE_AUTHORIZED === '1';
const supplied = Boolean(process.env.AURVIN_TEST_MONGODB_URI);
if (authorized && supplied && process.env.AURVIN_TEST_DB_PREFIX !== 'aurvin_p2_test_') {
  throw new Error('Canvas native checks require the isolated test prefix.');
}

describe.skipIf(!authorized || !supplied)('Canvas multimodal native recovery', () => {
  it.each(['before-append', 'after-append', 'journal-only'] as const)('recovers %s without inference or artifact replay', async fault => {
    const h = await voiceRuntimeHarness(chunk(`${SPEECH}\n${block(VISUALS[0]!, 'ticks')}`) + chunk('', 'stop') + usage + done);
    let delivery!: VoiceDelivery;
    let failure: { mockRestore(): void } | undefined;
    try {
      const reservation = await h.runtime.reservations.acquire({ identity: h.identity, conversationId: 'canvas-native-chat',
        owner: { kind: 'live', voiceSessionId: 'canvas-native-voice' } });
      const ids = await h.runtime.submitLiveTurn({ identity: h.identity, sessionId: 'canvas-native-chat',
        content: 'Explain the path.', idempotencyKey: 'canvas-native-1', reservation, configSnapshot: h.currentConfig.current() });
      if (fault === 'before-append') {
        const append = h.persistence.messages.append.bind(h.persistence.messages);
        failure = vi.spyOn(h.persistence.messages, 'append').mockImplementation(async row => {
          if (row.role === 'assistant') throw new Error('fixture archive failure'); return append(row);
        });
      }
      if (fault === 'after-append') {
        failure = vi.spyOn(h.persistence.memory, 'put').mockRejectedValue(new Error('fixture manifest failure'));
      }
      const live: LiveExecution = {
        reservation,
        start: async (a, write) => {
          delivery = new VoiceDelivery({ ...deliveryFixture(), userId: a.userId, sessionId: a.sessionId,
            turnId: a.turnId, attemptId: a.attemptId, responseId: key('voice-response', a.userId, a.sessionId, a.attemptId),
            voiceSessionId: 'canvas-native-voice', status: 'pending', textGenerated: '', textSpoken: null,
            textRemaining: null, audioDurationMs: null, audioPlayedMs: null, playedSamples: null }, 0, write,
            { speak: async () => undefined, flush: async () => undefined }, 2000);
          await delivery.start();
        },
        delta: text => delivery.delta(text),
        finish: () => delivery.finish(),
        artifact: async artifact => {
          const accepted = await delivery.artifact(artifact);
          if (fault === 'journal-only') throw new Error('fixture stop after confirmed artifact');
          return accepted;
        },
        settle: async () => { throw new Error('fixture stopped before heard evidence'); },
      };
      await expect(h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
        signal: new AbortController().signal, emit: async () => undefined, live })).rejects.toThrow();
      failure?.mockRestore();
      failure = undefined;
      const journal = await h.persistence.metadata.getVoiceDelivery(h.identity.userId, ids.sessionId, ids.attemptId);
      expect(journal?.canvasArtifacts).toHaveLength(1);
      if (fault !== 'journal-only') {
        const graph = await h.runtime.graph({ userId: h.identity.userId, sessionId: ids.sessionId,
          ownerId: 'canvas-native-inspect', leaseExpiresAt: new Date(Date.now() + 60000).toISOString() });
        const snapshot = await graph.getState(graphConfig(h.identity.userId, ids.sessionId));
        expect(snapshot.values.sealed).toBe(true);
        expect(snapshot.values.result.assistant.canvasArtifacts).toEqual(journal!.canvasArtifacts);
      }
      const restarted = new DurableChatRuntime(h.deps);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      const assistants = (await archiveRecords(h.persistence, h.identity.userId, ids.sessionId)).filter(m => m.role === 'assistant');
      expect(assistants).toHaveLength(1);
      expect(assistants[0]!.content).toBe(SPEECH);
      expect(assistants[0]!.canvasArtifacts).toEqual(journal!.canvasArtifacts);
      const page = await h.persistence.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
      const visible = page.items.filter(m => m.role === 'assistant');
      expect(visible).toHaveLength(1);
      expect(visible[0]!.content).toBe('');
      expect(visible[0]!.canvasArtifacts).toEqual(journal!.canvasArtifacts);
      expect(visible[0]!.voiceTranscripts?.map(t => t.content)).toEqual([SPEECH]);
      const settled = await h.persistence.metadata.getVoiceDelivery(h.identity.userId, ids.sessionId, ids.attemptId);
      expect(settled?.textGenerated).toBe(SPEECH);
      expect(settled?.textSpoken).toBeNull();
      expect(settled?.status).toBe('unknown');
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally {
      failure?.mockRestore();
      await h.close();
    }
  }, 30000);
});
