/**
 * ============================================================================
 * FILE: voice-critical-path.spec.ts
 * LOCATION: backend/test/performance/voice-critical-path.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify live voice critical-path query reductions and non-blocking TTS dispatch.
 *
 * ROLE IN PROJECT:
 *    Runs the shared runtime and real repositories on the BSON fake driver,
 *    verifying store-bound linkage reuse, Turn 1/Turn 2 context reuse, and
 *    immediate TTS Speak dispatch without a live database or paid calls.
 *
 * KEY COMPONENTS:
 *    - Fresh voice execution with real VoiceDelivery and simulated playback.
 *    - Strict fallback versus store-bound receipt query-count comparison.
 *    - Turn 1 / Turn 2 wire-command profile and idempotency verification.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import type { VoiceDeliveryRecord } from '../../src/contracts/voice.js';
import { key } from '../../src/persistence/records.js';
import { VoiceDelivery } from '../../src/voice/agent/voice-delivery.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { DependencyProbe } from './dependency-probe.js';
import { createLatencyFixture } from './latency-runtime-fixture.js';

it('removes two linkage rereads per voice journal write while retaining writes and heard evidence', async () => {
  const run = async (reuse: boolean) => {
    const probe = new DependencyProbe();
    const fx = await createLatencyFixture({ path: 'text', probe, readMs: 0, writeMs: 0, memoryFirst: true });
    const metadata = fx.persistence.metadata;
    const finish = vi.spyOn(fx.persistence.owner, 'finishAttempt');
    const put = metadata.putVoiceDelivery.bind(metadata), compare = metadata.compareVoiceDelivery.bind(metadata);
    let journalWrites = 0;
    const putSpy = vi.spyOn(metadata, 'putVoiceDelivery').mockImplementation(async (record, linkage) => {
      expect(linkage).toBeDefined();
      journalWrites++;
      return put(record, reuse ? linkage : undefined);
    });
    const compareSpy = vi.spyOn(metadata, 'compareVoiceDelivery').mockImplementation(async (record, sequence, linkage) => {
      expect(linkage).toBeDefined();
      journalWrites++;
      return compare(record, sequence, reuse ? linkage : undefined);
    });
    let latest!: VoiceDeliveryRecord, delivery!: VoiceDelivery;
    let spoken = '';
    try {
      const reservation = await probe.drive(() => fx.rawRuntime.reservations.acquire({
        identity: fx.identity, conversationId: 'voice-critical-path',
        owner: { kind: 'live', voiceSessionId: 'voice-critical' },
      }), 0, 0);
      const { metrics } = await fx.measure(async () => {
        const ids = await fx.rawRuntime.submitLiveTurn({ identity: fx.identity,
          sessionId: 'voice-critical-path', content: 'Hello Aurvin', idempotencyKey: 'voice-critical-key',
          reservation, configSnapshot: textSnapshot(1) });
        await fx.rawRuntime.executeTurn({ userId: fx.identity.userId, ...ids,
          signal: new AbortController().signal, emit: async () => undefined,
          live: {
            reservation,
            start: async (attempt, write) => {
              const seed = { ...deliveryFixture(), userId: attempt.userId, sessionId: attempt.sessionId,
                turnId: attempt.turnId, attemptId: attempt.attemptId, voiceSessionId: 'voice-critical',
                responseId: key('voice-response', attempt.userId, attempt.sessionId, attempt.attemptId),
                status: 'pending' as const, textGenerated: '', textSpoken: null, textRemaining: null,
                audioDurationMs: null, audioPlayedMs: null, playedSamples: null };
              delivery = new VoiceDelivery(seed, 0, async (record, sequence) => {
                await write(record, sequence);
                latest = structuredClone(record);
              }, { flush: async () => undefined, speak: async command => {
                spoken += command.text;
              } }, 2000);
              await delivery.start();
            },
            delta: text => delivery.delta(text), finish: () => delivery.finish(),
            settle: async text => {
              expect((await fx.persistence.sessions.get(fx.identity.userId, ids.sessionId))?.execution.ownerId)
                .toBe(fx.persistence.owner.executorId);
              await delivery.event({ type: 'speech-completed', turnId: latest.turnId,
                responseId: latest.responseId, speechId: 'fixture-speech', audioDurationMs: 100,
                audioSamples: 2400, usage: { providerRequestId: null, model: 'fixture',
                  modelVersion: null, audioMs: 100, billableCharacters: text.length } });
              await delivery.playback(2400);
              await delivery.settle(text);
            },
          },
        });
      });
      expect(latest.status).toBe('completed');
      expect(latest.textSpoken).toBe(spoken);
      expect(spoken.length).toBeGreaterThan(0);
      expect(fx.fetcher).toHaveBeenCalledOnce();
      expect(finish).not.toHaveBeenCalled();
      expect(fx.rawRuntime.memoryFor(fx.identity.userId, true)!.foundation.snapshot().sessions).toBe(0);
      expect((await probe.drive(() => fx.persistence.sessions.get(fx.identity.userId, 'voice-critical-path'), 0, 0))?.execution.ownerId)
        .toBeNull();
      return { metrics, journalWrites };
    } finally { putSpy.mockRestore(); compareSpy.mockRestore(); await fx.close(); }
  };
  const strict = await run(false), reused = await run(true);
  expect(reused.journalWrites).toBe(strict.journalWrites);
  expect(reused.metrics.wireWrites).toBe(strict.metrics.wireWrites);
  expect(reused.metrics.wireReads).toBe(strict.metrics.wireReads - 2 * reused.journalWrites);
});

it('reuses fresh live submission and confirmed state across consecutive voice turns while preserving replay idempotency', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'text', probe, readMs: 0, writeMs: 0 });
  const getRefsSpy = vi.spyOn(fx.persistence.messages, 'getReferences');
  const getVoiceDeliverySpy = vi.spyOn(fx.persistence.metadata, 'getVoiceDelivery');
  try {
    const reservation = await probe.drive(() => fx.rawRuntime.reservations.acquire({
      identity: fx.identity, conversationId: 'voice-two-turn-path',
      owner: { kind: 'live', voiceSessionId: 'voice-two-turn' },
    }), 0, 0);

    const runVoiceTurn = async (turnIndex: number) => {
      let latest!: VoiceDeliveryRecord, delivery!: VoiceDelivery;
      const command = {
        identity: fx.identity,
        sessionId: 'voice-two-turn-path',
        content: `Voice question ${turnIndex}`,
        idempotencyKey: `voice-two-turn-key-${turnIndex}`,
        reservation,
        configSnapshot: textSnapshot(1),
      };
      return fx.measure(async () => {
        const existing = await fx.rawRuntime.findLiveSubmission(command);
        expect(existing).toBeNull();
        const ids = await fx.rawRuntime.submitLiveTurn(command);
        await fx.rawRuntime.executeTurn({
          userId: fx.identity.userId,
          ...ids,
          signal: new AbortController().signal,
          emit: async () => undefined,
          live: {
            reservation,
            start: async (attempt, write) => {
              const seed = {
                ...deliveryFixture(),
                userId: attempt.userId,
                sessionId: attempt.sessionId,
                turnId: attempt.turnId,
                attemptId: attempt.attemptId,
                voiceSessionId: 'voice-two-turn',
                responseId: key('voice-response', attempt.userId, attempt.sessionId, attempt.attemptId),
                status: 'pending' as const,
                textGenerated: '',
                textSpoken: null,
                textRemaining: null,
                audioDurationMs: null,
                audioPlayedMs: null,
                playedSamples: null,
              };
              delivery = new VoiceDelivery(seed, 0, async (record, sequence) => {
                await write(record, sequence);
                latest = structuredClone(record);
              }, { flush: async () => undefined, speak: async () => undefined }, 2000);
              await delivery.start();
            },
            delta: text => delivery.delta(text),
            finish: () => delivery.finish(),
            settle: async text => {
              await delivery.event({
                type: 'speech-started',
                turnId: latest.turnId,
                responseId: latest.responseId,
                speechId: `speech-${turnIndex}`,
              });
              await delivery.event({
                type: 'speech-completed',
                turnId: latest.turnId,
                responseId: latest.responseId,
                speechId: `speech-${turnIndex}`,
                audioDurationMs: 100,
                audioSamples: 2400,
                usage: {
                  providerRequestId: null,
                  model: 'fixture',
                  modelVersion: null,
                  audioMs: 100,
                  billableCharacters: text.length,
                },
              });
              await delivery.playback(2400);
              await delivery.settle(text);
            },
          },
        });
        return { ids, command };
      });
    };

    const turn1 = await runVoiceTurn(1);
    const turn2 = await runVoiceTurn(2);
    expect(getRefsSpy).not.toHaveBeenCalled();
    expect(getVoiceDeliverySpy).not.toHaveBeenCalled();
    expect(turn1.metrics.wireReads).toBeLessThanOrEqual(92);
    expect(turn2.metrics.wireReads).toBeLessThan(turn1.metrics.wireReads);
    const callsBeforeReplay = fx.fetcher.mock.calls.length;
    await probe.drive(async () => {
      const { ids, command } = turn2.result;
      const identity = { sessionId: ids.sessionId, turnId: ids.turnId, attemptId: ids.attemptId };
      expect(await fx.rawRuntime.findLiveSubmission(command)).toMatchObject(identity);
      expect(await fx.rawRuntime.submitLiveTurn(command)).toMatchObject(identity);
      await expect(fx.rawRuntime.findLiveSubmission({ ...command, content: 'Different input' }))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    }, 0, 0);
    expect(fx.fetcher.mock.calls.length).toBe(callsBeforeReplay);
  } finally {
    getRefsSpy.mockRestore();
    getVoiceDeliverySpy.mockRestore();
    await fx.close();
  }
});
