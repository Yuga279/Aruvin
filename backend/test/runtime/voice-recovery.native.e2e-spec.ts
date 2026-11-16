/**
 * ============================================================================
 * FILE: voice-recovery.native.e2e-spec.ts
 * LOCATION: backend/test/runtime/voice-recovery.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integration tests for live execution recovery and delivery state reconciliation.
 *
 * ROLE IN PROJECT:
 *    Verifies that stopped/interrupted live execution restores sealed results,
 *    marks unconfirmed voice delivery as explicit unknown, and prevents reinference.
 *
 * KEY COMPONENTS:
 *    - voiceRuntimeHarness: Deterministic native MongoDB runtime harness.
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import { voiceRuntimeHarness } from './voice-runtime-harness.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { key } from '../../src/persistence/records.js';
import { archiveRecords } from '../../src/chat-runtime/history.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Voice native recovery', () => {
  it('restores a sealed live result and pending delivery after archive failure without reinference', async () => {
    const h = await voiceRuntimeHarness();
    try {
      const reservation = await h.runtime.reservations.acquire({ identity: h.identity, conversationId: 's1',
        owner: { kind: 'live', voiceSessionId: 'v1' } });
      const ids = await h.runtime.submitLiveTurn({ identity: h.identity, sessionId: 's1', content: 'SECRET input',
        idempotencyKey: 'voice-request-0001', reservation,
        // Live acceptance consumes the frozen configuration snapshot, as the production voice path does.
        configSnapshot: h.currentConfig.current() });
      let generated = '';
      const append = h.persistence.messages.append.bind(h.persistence.messages);
      const broken = vi.spyOn(h.persistence.messages, 'append').mockImplementation(async message => {
        if (message.role === 'assistant') throw new Error('fixture crash before archive'); return append(message);
      });
      await expect(h.runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
        emit: async () => undefined, live: { reservation,
          start: async (a, write) => { await write(voiceDeliveryRecordSchema.parse({ ...deliveryFixture(),
            userId: a.userId, sessionId: a.sessionId, turnId: a.turnId, attemptId: a.attemptId,
            responseId: key('voice-response', a.userId, a.sessionId, a.attemptId),
            voiceSessionId: 'v1', textGenerated: '', status: 'pending', textSpoken: null, textRemaining: null,
            audioDurationMs: null, audioPlayedMs: null, playedSamples: null })); },
          delta: async text => { generated += text; }, finish: async () => undefined,
          settle: async () => { throw new Error('fixture process stopped before delivery settlement'); },
        } })).rejects.toThrow();
      broken.mockRestore();
      expect(generated).toBe('Hello 🌍'); expect(h.fetcher).toHaveBeenCalledTimes(1);
      const restarted = new DurableChatRuntime(h.deps);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      const raw = await archiveRecords(h.persistence, h.identity.userId, ids.sessionId);
      expect(raw.map(m => [m.role, m.visibility])).toEqual([['user', 'internal'], ['assistant', 'internal']]);
      expect(raw[1]?.content).toBe(generated);
      expect(await h.persistence.metadata.getVoiceDelivery(h.identity.userId, ids.sessionId, ids.attemptId))
        .toMatchObject({ status: 'unknown', textGenerated: generated, textSpoken: null });
      const next = await restarted.submitTurn({ identity: h.identity, sessionId: ids.sessionId, content: 'Follow up',
        idempotencyKey: 'text-request-0002' });
      await restarted.executeTurn({ userId: h.identity.userId, ...next, signal: new AbortController().signal, emit: async () => undefined });
      expect(h.fetcher).toHaveBeenCalledTimes(2); // One original inference plus the explicit new follow-up.
      const body = JSON.parse(String(h.fetcher.mock.calls[1]?.[1]?.body)) as { messages: { content: string }[] };
      expect(body.messages.some(m => m.content === generated)).toBe(false);
      expect(body.messages.some(m => m.content.includes('delivery is unknown'))).toBe(true);
      expect(body.messages.filter(m => m.content === 'Follow up')).toHaveLength(1);
    } finally { await h.close(); }
  }, 30000);
});
