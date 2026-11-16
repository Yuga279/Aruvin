/**
 * ============================================================================
 * FILE: voice-acceptance.native.e2e-spec.ts
 * LOCATION: backend/test/runtime/voice-acceptance.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Native MongoDB tests for internal live turn acceptance and session creation.
 *
 * ROLE IN PROJECT:
 *    Proves internal turn acceptance before inference, first-utterance conversation title,
 *    mode/visibility persistence, duplicate rejection, and forged capability rejection.
 *
 * KEY COMPONENTS:
 *    - submitLiveTurn: Durable internal turn acceptance.
 *    - ExecutionReservations: Verified live reservation capability checks.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { voiceRuntimeHarness } from './voice-runtime-harness.js';
import { sessionIdFor } from '../../src/chat-runtime/identity.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Voice native acceptance', () => {
  it('accepts one internal input before inference and titles the first-turn conversation from that input', async () => {
    const h = await voiceRuntimeHarness();
    try {
      const held = await h.runtime.reservations.acquire({ identity: h.identity, conversationId: null,
        owner: { kind: 'live', voiceSessionId: 'v1' } });
      expect((await h.persistence.sessions.list(h.identity.userId, { limit: 10, cursor: null })).items).toEqual([]);
      const sessionId = sessionIdFor(h.identity.userId, null, 'voice-request-0001');
      const reservation = await h.runtime.reservations.bindConversation({ identity: h.identity,
        reservationId: held.reservationId, conversationId: sessionId });
      const command = { identity: h.identity, sessionId, content: 'SECRET ABC-42 is not cancelled.',
        idempotencyKey: 'voice-request-0001', reservation };
      // Live acceptance consumes the frozen configuration snapshot, as the production voice path does.
      const live = { ...command, configSnapshot: h.currentConfig.current() };
      const [a, b] = await Promise.all([h.runtime.submitLiveTurn(live), h.runtime.submitLiveTurn(live)]);
      expect(a).toEqual(b);
      expect(h.fetcher).not.toHaveBeenCalled();
      expect(await h.persistence.messages.get(h.identity.userId, sessionId, a.userMessageId))
        .toMatchObject({ content: command.content, mode: 'live', visibility: 'internal', completionStatus: 'accepted' });
      expect(await h.persistence.metadata.getAcceptance(h.identity.userId, sessionId, a.attemptId)).not.toBeNull();
      expect((await h.persistence.sessions.get(h.identity.userId, sessionId))?.title).toBe(
        'SECRET ABC-42 is not cancelled.',
      );
      const visible = (await h.persistence.messages.list(h.identity.userId, sessionId, { limit: 10, cursor: null })).items;
      // The internal live turn never becomes visible text: it surfaces only as an attributed transcript.
      expect(visible).toHaveLength(1);
      expect(visible[0]).toMatchObject({ role: 'user', mode: 'live', content: '' });
      expect(visible[0]?.voiceTranscripts)
        .toEqual([{ role: 'user', content: command.content, createdAt: expect.any(String) }]);
      await expect(h.runtime.submitTurn({ ...command, idempotencyKey: 'text-request-0001' }))
        .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
      await expect(h.runtime.submitLiveTurn({ ...live, content: 'different' }))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
      await h.runtime.reconcileSession(h.identity.userId, sessionId);
      await h.runtime.reservations.release({ identity: h.identity, reservationId: held.reservationId });
    } finally { await h.close(); }
  }, 30000);

  it('a forged live capability cannot bypass text exclusion or create a record', async () => {
    const h = await voiceRuntimeHarness();
    try {
      await expect(h.runtime.submitLiveTurn({ identity: h.identity, sessionId: 's1', content: 'SECRET',
        idempotencyKey: 'voice-request-0001', reservation: { reservationId: 'forged', userId: h.identity.userId,
          conversationId: 's1', owner: { kind: 'live', voiceSessionId: 'v1' } } }))
        .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
      expect(await h.persistence.sessions.get(h.identity.userId, 's1')).toBeNull();
      expect(h.fetcher).not.toHaveBeenCalled();
    } finally { await h.close(); }
  }, 30000);

  it('live admission rejects an accepted text attempt even between HTTP acceptance and stream attach', async () => {
    const h = await voiceRuntimeHarness();
    try {
      const ids = await h.runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Visible text', idempotencyKey: 'text-request-0001' });
      await expect(h.runtime.reservations.acquire({ identity: h.identity, conversationId: ids.sessionId,
        owner: { kind: 'live', voiceSessionId: 'v1' } })).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
      expect(h.fetcher).not.toHaveBeenCalled();
      await h.runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal, emit: async () => undefined });
      const live = await h.runtime.reservations.acquire({ identity: h.identity, conversationId: ids.sessionId,
        owner: { kind: 'live', voiceSessionId: 'v1' } });
      await h.runtime.reservations.release({ identity: h.identity, reservationId: live.reservationId });
      expect((await h.persistence.sessions.get(h.identity.userId, ids.sessionId))?.title).toBe('Visible text');
    } finally { await h.close(); }
  }, 30000);
});
