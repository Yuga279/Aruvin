/**
 * ============================================================================
 * FILE: publication-activity-commitment.spec.ts
 * LOCATION: backend/test/chat-runtime/publication-activity-commitment.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove W1 supplies activityUpdatedByFinish only for committed plain-text finish.
 *
 * ROLE IN PROJECT:
 *    Captures LivePublicationEvidence from the runtime publish path. Voice/live
 *    and receipt-less recovery must omit the flag so W2 keeps the early touch.
 *
 * KEY COMPONENTS:
 *    - Plain text: flag true with onAttemptConfirmed when finish/CAS exist.
 *    - Live/voice and missing-receipt recovery: flag omitted.
 * ============================================================================
 */
import { activityUpdatedByFinishCommitment } from '../../src/chat-runtime/durable-chat-runtime.js';
import * as finalization from '../../src/chat-runtime/finalization.js';
import type { LivePublicationEvidence } from '../../src/chat-runtime/finalization.js';
import { sessionIdFor } from '../../src/chat-runtime/identity.js';
import type { DeliveryWrite } from '../../src/chat-runtime/ports.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { key } from '../../src/persistence/records.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { DependencyProbe } from '../performance/dependency-probe.js';
import { createLatencyFixture } from '../performance/latency-runtime-fixture.js';
import { textConfigFixture } from '../runtime/text-config-fixture.js';

function publishedEvidence(spy: ReturnType<typeof vi.spyOn>): LivePublicationEvidence | undefined {
  return spy.mock.calls.at(-1)?.[6] as LivePublicationEvidence | undefined;
}

async function textFixture() {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'text', probe, readMs: 67, writeMs: 449 });
  return { probe, fx };
}

it('supplies activityUpdatedByFinish on plain text publication evidence', async () => {
  const { probe, fx } = await textFixture();
  const spy = vi.spyOn(finalization, 'publishResult');
  try {
    const ids = await probe.drive(() => fx.submit('Commit activity to finish'), 67, 449);
    await probe.drive(() => fx.execute(ids), 67, 449);
    expect(spy).toHaveBeenCalled();
    const evidence = publishedEvidence(spy);
    expect(evidence?.activityUpdatedByFinish).toBe(true);
    expect(evidence?.onAttemptConfirmed).toEqual(expect.any(Function));
    expect(evidence?.attemptReceipt).toBeTruthy();
  } finally {
    spy.mockRestore();
    await fx.close();
  }
});

it('commits the finish flag only for non-live text with finishAttempt, attempt receipt, and CAS', () => {
  const allowed = {
    live: false,
    finishAttempt: async () => undefined,
    attemptReceipt: { record: {} },
    compareAttemptConfirmed: async () => undefined,
  };
  expect(activityUpdatedByFinishCommitment(allowed)).toBe(true);
  expect(activityUpdatedByFinishCommitment({ ...allowed, live: true })).toBeUndefined();
  expect(activityUpdatedByFinishCommitment({ ...allowed, finishAttempt: undefined })).toBeUndefined();
  expect(activityUpdatedByFinishCommitment({ ...allowed, attemptReceipt: null })).toBeUndefined();
  expect(activityUpdatedByFinishCommitment({ ...allowed, compareAttemptConfirmed: undefined })).toBeUndefined();
});

it('omits activityUpdatedByFinish on a live voice execute', async () => {
  const h = textConfigFixture(textSnapshot(1));
  const spy = vi.spyOn(finalization, 'publishResult');
  const snapshot = h.currentConfig.current();
  if (!snapshot) throw new Error('expected snapshot');
  const idempotencyKey = 'w1-live-activity';
  try {
    const held = await h.runtime.reservations.acquire({
      identity: h.identity,
      conversationId: null,
      owner: { kind: 'live', voiceSessionId: 'w1-live-voice' },
    });
    const sessionId = sessionIdFor(h.identity.userId, null, idempotencyKey);
    const reservation = await h.runtime.reservations.bindConversation({
      identity: h.identity,
      reservationId: held.reservationId,
      conversationId: sessionId,
    });
    const ids = await h.runtime.submitLiveTurn({
      identity: h.identity,
      sessionId,
      content: 'Speak this answer.',
      idempotencyKey,
      reservation,
      configSnapshot: snapshot,
    });
    let a: { userId: string; sessionId: string; attemptId: string; turnId: string } | undefined;
    let write: DeliveryWrite | undefined;
    await h.runtime.executeTurn({
      userId: h.identity.userId,
      ...ids,
      signal: new AbortController().signal,
      emit: async () => undefined,
      live: {
        reservation,
        start: async (attempt, persist) => { a = attempt; write = persist; },
        delta: async () => undefined,
        finish: async () => undefined,
        settle: async textGenerated => {
          if (!write || !a) throw new Error('expected delivery writer');
          await write(voiceDeliveryRecordSchema.parse({
            ...deliveryFixture(),
            userId: a.userId,
            sessionId,
            turnId: a.turnId,
            attemptId: a.attemptId,
            responseId: key('voice-response', a.userId, a.sessionId, a.attemptId),
            voiceSessionId: 'w1-live-voice',
            status: 'completed',
            textGenerated,
            textSpoken: textGenerated,
            textRemaining: '',
          }));
        },
      },
    });
    expect(spy).toHaveBeenCalled();
    expect(publishedEvidence(spy)?.activityUpdatedByFinish).toBeUndefined();
  } finally {
    spy.mockRestore();
    await h.dispose();
  }
});

it('omits activityUpdatedByFinish when execute reconstructs without an attempt receipt', async () => {
  const { probe, fx } = await textFixture();
  const spy = vi.spyOn(finalization, 'publishResult');
  try {
    const ids = await probe.drive(() => fx.submit('Recovery omits finish commitment'), 67, 449);
    (fx.rawRuntime as unknown as { receipts: { delete(u: string, s: string, a: string): void } })
      .receipts.delete(fx.identity.userId, ids.sessionId, ids.attemptId);
    await probe.drive(() => fx.execute(ids), 67, 449);
    expect(spy).toHaveBeenCalled();
    const evidence = publishedEvidence(spy);
    expect(evidence?.activityUpdatedByFinish).toBeUndefined();
    expect(evidence?.attemptReceipt).toBeFalsy();
  } finally {
    spy.mockRestore();
    await fx.close();
  }
});
