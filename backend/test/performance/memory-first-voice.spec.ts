/**
 * ============================================================================
 * FILE: memory-first-voice.spec.ts
 * LOCATION: backend/test/performance/memory-first-voice.spec.ts
 * PURPOSE: Prove live follow-up and interruption use memory while saves are blocked.
 * ROLE IN PROJECT: Real voice delivery and native repositories over deterministic I/O.
 * KEY COMPONENTS: Shared foundation, heard context, idempotency and save-only retry.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import type { MongoClient } from 'mongodb';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { parseVoiceControl, type VoiceServerPayload } from '../../src/contracts/voice-wire.js';
import { VoiceDelivery } from '../../src/voice/agent/voice-delivery.js';
import { AgentVoiceAdapter } from '../../src/voice/agent/agent-voice-adapter.js';
import { key } from '../../src/persistence/records.js';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { chunk, done, usage } from '../fixtures/openrouter/frames.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from '../../src/chat-runtime/memory-text.js';
import { sessionIdFor } from '../../src/chat-runtime/identity.js';
import type { SubmitTurnResponse } from '../../src/contracts/api.js';
import { AppService } from '../../src/app.service.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { defaultManageableSettings } from '../../src/platform/config/manageable-config.js';

it.each([false, true])('follows up before actual native saving, retaining only proven hearing (barge-in=%s)', async interrupted => {
  const memory = calendarMemory();
  const client = Object.assign(memory.commandSource, { db: () => memory.store.db, appendMetadata: () => undefined }) as unknown as MongoClient;
  const p = await createPersistenceBundle(client, 'offline-memory-voice', DEFAULT_BUDGETS, 'offline-executor');
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d,
    memoryFirst: { policy: { ...PROPOSED_MEMORY_TEXT_POLICY, shutdownDrainMs: 50 }, voice: true } }), p);
  const reservation = await f.runtime.reservations.acquire({ identity: f.identity, conversationId: null,
    owner: { kind: 'live', voiceSessionId: 'voice-one' } });
  const sessionId = sessionIdFor(f.identity.userId, null, 'voice-input-one');
  const bound = await f.runtime.reservations.bindConversation({ identity: f.identity, reservationId: reservation.reservationId, conversationId: sessionId });
  const paused = memory.pauseNextUpdate();
  let spoken = '', delivery!: VoiceDelivery;
  const first = await f.runtime.submitLiveTurn({ identity: f.identity, sessionId, content: 'First', idempotencyKey: 'voice-input-one',
    reservation: bound, configSnapshot: textSnapshot(1), freshConversation: true,
    voice: { voiceSessionId: 'voice-one', socketEpoch: 1, providerTurnId: 'provider-one' } });
  const run = (ids: SubmitTurnResponse, interrupted: boolean) => f.runtime.executeTurn({ userId: f.identity.userId, ...ids, signal: new AbortController().signal, emit: async () => {},
    live: { reservation: bound, start: async (attempt, write) => {
      delivery = new VoiceDelivery({ ...deliveryFixture(), userId: attempt.userId, sessionId, turnId: attempt.turnId,
        attemptId: attempt.attemptId, voiceSessionId: 'voice-one', responseId: key('voice-response', attempt.userId, sessionId, attempt.attemptId),
        status: 'pending', textGenerated: '', textSpoken: null, textRemaining: null, audioDurationMs: null, audioPlayedMs: null, playedSamples: null },
      0, write, { speak: async c => { spoken += c.text; }, flush: async () => {} }, 20);
      await delivery.start();
    }, delta: text => delivery.delta(text), finish: () => delivery.finish(), settle: async text => {
      const record = delivery.current();
      if (interrupted) {
        delivery.invalidate();
        await delivery.event({ type: 'speech-interrupted', turnId: record.turnId, responseId: record.responseId,
          speechId: 'speech-one', audioPlayedMs: 0, textSpoken: '', textRemaining: text,
          usage: { providerRequestId: null, model: 'fixture', modelVersion: null, audioMs: null, billableCharacters: text.length } });
      } else {
        await delivery.event({ type: 'speech-completed', turnId: record.turnId, responseId: record.responseId,
          speechId: 'speech-one', audioDurationMs: 100, audioSamples: 2400,
          usage: { providerRequestId: null, model: 'fixture', modelVersion: null, audioMs: 100, billableCharacters: text.length } });
        await delivery.playback(2400);
      }
      await delivery.settle(text);
    } } });
  await run(first, interrupted); await paused.started;
  expect(spoken).toBe('Hello 🌍');
  expect(f.runtime.memoryFor(f.identity.userId)!.foundation.snapshot().sessions).toBe(1);
  expect(await f.runtime.getLiveDelivery(f.identity.userId, sessionId, first.attemptId, bound))
    .toMatchObject({ status: interrupted ? 'interrupted' : 'completed', textSpoken: interrupted ? '' : 'Hello 🌍' });
  const calls = memory.calls.length;
  const second = await f.runtime.submitLiveTurn({ identity: f.identity, sessionId, content: 'Second', idempotencyKey: 'voice-input-two',
    reservation: bound, configSnapshot: textSnapshot(1), voice: { voiceSessionId: 'voice-one', socketEpoch: 1, providerTurnId: 'provider-two' } });
  expect(memory.calls).toHaveLength(calls);
  expect(second.turnId).not.toBe(first.turnId);
  await run(second, false);
  const body = JSON.parse(f.fetcher.mock.calls[1][1]?.body as string);
  expect(body.messages.some((m: { role: string; content: string }) => m.role === 'assistant' && m.content.includes('Hello 🌍'))).toBe(!interrupted);
  expect(memory.calls).toHaveLength(calls);
  await expect(f.runtime.getTurnStatus(f.identity.userId, sessionId, first.turnId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(f.runtime.cancelTurn({ identity: f.identity, ...second })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const third = await f.runtime.submitLiveTurn({ identity: f.identity, sessionId, content: 'Third', idempotencyKey: 'voice-input-three',
    reservation: bound, configSnapshot: textSnapshot(1), voice: { voiceSessionId: 'voice-one', socketEpoch: 1, providerTurnId: 'provider-three' } });
  await f.runtime.cancelLiveTurn({ identity: f.identity, ...third }, bound);
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  expect(await f.runtime.drain(30)).toMatchObject({ drained: false });
  paused.resume(); await vi.waitFor(() => expect(f.runtime.memoryFor(f.identity.userId)!.foundation.snapshot().pending).toBe(0));
  expect(await f.runtime.drain(50)).toMatchObject({ drained: true });
});

it('streams a multi-paragraph escaped/Unicode voice answer with Canvas artifact and emits live save-state wire metadata while saves are blocked', async () => {
  const memory = calendarMemory();
  const client = Object.assign(memory.commandSource, { db: () => memory.store.db, appendMetadata: () => undefined }) as unknown as MongoClient;
  const p = await createPersistenceBundle(client, 'offline-memory-voice-long', DEFAULT_BUDGETS, 'offline-executor');
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d,
    memoryFirst: { policy: { ...PROPOSED_MEMORY_TEXT_POLICY, shutdownDrainMs: 50 }, voice: true } }), p);
  const paragraph = 'Paragraph with "quotes", paths C:\\\\aurvin\\\\voice, emoji 🌍🚀, and accents café — clear spoken prose that previously hit a 682-byte ceiling.';
  const longSpoken = Array.from({ length: 30 }, (_, i) => `Section ${i + 1}: ${paragraph}`).join('\n\n');
  const rawModelOutput = `${longSpoken}\n\n\`\`\`mermaid title="Voice flow"\nflowchart TD\nA --> B\n\`\`\``;
  expect(Buffer.byteLength(longSpoken, 'utf8')).toBeGreaterThan(4_000);
  f.fetcher.mockImplementation(async () => new Response(
    chunk(rawModelOutput) + chunk('', 'stop') + usage + done,
    { headers: { 'content-type': 'text/event-stream' } },
  ));

  const paused = memory.pauseNextUpdate();
  const reservation = await f.runtime.reservations.acquire({
    identity: f.identity, conversationId: null, owner: { kind: 'live', voiceSessionId: 'voice-long-1' },
  });
  let bound = reservation;
  const sinkEvents: VoiceServerPayload[] = [];
  const context: Parameters<AgentVoiceAdapter['attach']>[0] = {
    identity: f.identity,
    configSnapshot: textSnapshot(1),
    reservation,
    response: {
      protocolVersion: 1, sessionId: 'voice-long-1', conversationId: null, mode: 'live',
      connectionEpoch: 1, websocketUrl: '/api/voice', expiresAt: new Date(Date.now() + 30_000).toISOString(),
      effectiveAudioSettings: {
        input: { encoding: 'pcm16', sampleRate: 16000, channels: 1, endian: 'little', frameMs: 80 },
        output: { encoding: 'pcm16', sampleRate: 24000, channels: 1, endian: 'little' },
      },
      limits: {
        dictationMaxMs: 300000, liveMaxMs: 1200000, liveWarningMs: 1080000, idleWarningMs: 60000,
        idleExitAfterWarningMs: 30000, finalizationMs: 200, reconnectMs: 10000, connectMs: 10000,
        inputQueueMs: 1000, outputQueueMs: 2000,
      },
    },
  };
  const bridge = new AgentVoiceAdapter(f.runtime, async (_voiceId, convId) => {
    bound = await f.runtime.reservations.bindConversation({
      identity: f.identity, reservationId: reservation.reservationId, conversationId: convId,
    });
    context.reservation = bound;
    context.response.conversationId = convId;
  });
  let spokenTotal = '';
  let activeRef: { turnId: string; responseId: string } | null = null;
  let observedMidTurnMessages: ReturnType<typeof f.runtime.memoryMessages> = null;
  const flow = {
    providerSocketId: 'tts-socket-long',
    waitForOutput: async () => true,
    prepareResponse: (ref: { turnId: string; responseId: string }) => { activeRef = ref; return { providerBaseSamples: 0 }; },
    modelStarted: () => {
      if (context.response.conversationId) {
        observedMidTurnMessages = f.runtime.memoryMessages(f.identity.userId, context.response.conversationId, { cursor: null, limit: 10 });
      }
    },
    modelOutput: () => undefined,
    speak: async (c: { text: string }) => { spokenTotal += c.text; },
    flush: async () => {
      if (!activeRef) return;
      await bridge.hooks.delivery(context, {
        type: 'speech-completed', turnId: activeRef.turnId, responseId: activeRef.responseId,
        speechId: 'speech-long', audioDurationMs: 500, audioSamples: 12000,
        usage: { providerRequestId: null, model: 'fixture', modelVersion: null, audioMs: 500, billableCharacters: spokenTotal.length },
      });
      await bridge.hooks.playback(context, activeRef, 12000);
    },
    deliverySettled: () => undefined,
  };
  bridge.attach(context, flow as never, {
    event: payload => {
      const wire = { protocolVersion: 1 as const, sessionId: 'voice-long-1', connectionEpoch: 1, eventId: `ev-${sinkEvents.length + 1}`, sequence: sinkEvents.length, ...payload };
      expect(parseVoiceControl(JSON.stringify(wire), 'server', 'live')).toEqual(wire);
      sinkEvents.push(payload);
    },
    audio: () => true,
    close: () => undefined,
  });

  await bridge.finalized(context, { providerSocketEpoch: 1, providerTurnId: 'p-1', text: 'Explain architecture in detail' }, new AbortController().signal);
  await paused.started;

  expect(spokenTotal.length).toBeGreaterThan(3_500);
  expect(spokenTotal).not.toContain('flowchart');
  expect(sinkEvents.some(e => e.type === 'canvas.artifact')).toBe(true);
  const boundEvents = sinkEvents.filter((e): e is Extract<VoiceServerPayload, { type: 'conversation.bound' }> => e.type === 'conversation.bound');
  expect(boundEvents.length).toBeGreaterThanOrEqual(2);
  expect(boundEvents[0]).toMatchObject({ conversationId: context.response.conversationId!, save: { state: 'pending' } });
  expect(boundEvents.at(-1)).toMatchObject({ conversationId: context.response.conversationId!, save: { state: 'saving', durableVersion: 0 } });
  expect(observedMidTurnMessages?.activeTurn).toMatchObject({ status: 'generating', mode: 'live' });

  const afterFirst = f.runtime.memoryMessages(f.identity.userId, context.response.conversationId!, { cursor: null, limit: 10 });
  expect(afterFirst?.activeTurn).toBeUndefined();
  expect(afterFirst?.save).toMatchObject({ state: 'saving', durableVersion: 0 });
  expect(afterFirst?.saveTurnId).toBe(boundEvents.at(-1)?.turnId);
  expect(afterFirst?.items.at(-1)?.canvasArtifacts).toHaveLength(1);

  await bridge.finalized(context, { providerSocketEpoch: 1, providerTurnId: 'p-2', text: 'Follow up while save is still blocked' }, new AbortController().signal);
  const secondBound = sinkEvents.filter((e): e is Extract<VoiceServerPayload, { type: 'conversation.bound' }> => e.type === 'conversation.bound').at(-1);
  expect(secondBound?.save).toMatchObject({ version: 2, durableVersion: 0 });

  paused.resume();
  await vi.waitFor(() => expect(f.runtime.memoryFor(f.identity.userId)!.foundation.snapshot().pending).toBe(0));
  expect(await f.runtime.drain(50)).toMatchObject({ drained: true });
});

it('settles an oversized escaped live stream cleanly without overflowing evidence or wedging the session slot', async () => {
  const memory = calendarMemory();
  const client = Object.assign(memory.commandSource, { db: () => memory.store.db, appendMetadata: () => undefined }) as unknown as MongoClient;
  const p = await createPersistenceBundle(client, 'offline-memory-voice-overflow', DEFAULT_BUDGETS, 'offline-executor');
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d,
    memoryFirst: { policy: { ...PROPOSED_MEMORY_TEXT_POLICY, shutdownDrainMs: 50 }, voice: true } }), p);
  const reservation = await f.runtime.reservations.acquire({
    identity: f.identity, conversationId: null, owner: { kind: 'live', voiceSessionId: 'voice-overflow-1' },
  });
  const sessionId = sessionIdFor(f.identity.userId, null, 'voice-overflow-turn-1');
  const bound = await f.runtime.reservations.bindConversation({
    identity: f.identity, reservationId: reservation.reservationId, conversationId: sessionId,
  });
  // 16_000 quotes => 32_000 JSON-escaped bytes (> live prose budget after 33_792 artifact reserve), while raw UTF-8 is only 16_000 bytes.
  const escapedFlood = '"'.repeat(16_000);
  f.fetcher.mockResolvedValueOnce(new Response(
    chunk(escapedFlood) + chunk('', 'stop') + usage + done,
    { headers: { 'content-type': 'text/event-stream' } },
  ));
  const first = await f.runtime.submitLiveTurn({
    identity: f.identity, sessionId, content: 'Trigger escaped flood', idempotencyKey: 'voice-overflow-turn-1',
    reservation: bound, configSnapshot: textSnapshot(1), freshConversation: true,
    voice: { voiceSessionId: 'voice-overflow-1', socketEpoch: 1, providerTurnId: 'p-1' },
  });
  let delivery!: VoiceDelivery;
  await f.runtime.executeTurn({
    userId: f.identity.userId, ...first, signal: new AbortController().signal, emit: async () => {},
    live: {
      reservation: bound,
      start: async (attempt, write) => {
        delivery = new VoiceDelivery({
          ...deliveryFixture(), userId: attempt.userId, sessionId, turnId: attempt.turnId,
          attemptId: attempt.attemptId, voiceSessionId: 'voice-overflow-1',
          responseId: key('voice-response', attempt.userId, sessionId, attempt.attemptId),
          status: 'pending', textGenerated: '', textSpoken: null, textRemaining: null,
          audioDurationMs: null, audioPlayedMs: null, playedSamples: null,
        }, 0, write, { speak: async () => {}, flush: async () => {} }, 20);
        await delivery.start();
      },
      delta: text => delivery.delta(text),
      finish: () => delivery.finish(),
      settle: async text => { delivery.invalidate(); await delivery.settle(text); },
    },
  });
  expect(await f.runtime.getLiveTurnStatus(f.identity.userId, sessionId, first.turnId, bound))
    .toMatchObject({ status: 'failed' });

  const second = await f.runtime.submitLiveTurn({
    identity: f.identity, sessionId, content: 'Recover on next turn', idempotencyKey: 'voice-overflow-turn-2',
    reservation: bound, configSnapshot: textSnapshot(1),
    voice: { voiceSessionId: 'voice-overflow-1', socketEpoch: 1, providerTurnId: 'p-2' },
  });
  expect(second.turnId).not.toBe(first.turnId);
  await f.runtime.cancelLiveTurn({ identity: f.identity, ...second }, bound);
  await vi.waitFor(() => expect(f.runtime.memoryFor(f.identity.userId)!.foundation.snapshot().pending).toBe(0));
  expect(await f.runtime.drain(50)).toMatchObject({ drained: true });
});

it('falls back to durable runtime when injected persistence stub lacks owner.store, while failing closed on explicit memoryFirstPolicy', async () => {
  const bootstrap = loadBootstrapConfig({
    FRONTEND_ORIGIN: 'http://127.0.0.1:5173',
    PERSISTENCE_PROFILE: 'native-mongodb',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/aurvin_stub_fixture',
    AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    AURVIN_USER_ID: 'server-user',
  });
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = 'fixture-model';
  settings.voice.enabledModes = { dictation: true, live: false };
  const stored = {
    _id: 'aurvin' as const,
    schemaVersion: 1 as const,
    revision: 1,
    settings,
    credentials: { openrouter: null, deepgram: null, googleOAuthClient: null, googleCalendar: null },
    updatedAt: '2026-11-07T00:00:00.000Z',
  };
  const openStub = async () =>
    ({
      ping: async () => true,
      close: async () => undefined,
      sessions: {},
      messages: {},
      memory: {},
      metadata: {},
      owner: { assertExecutor: async () => undefined },
      checkpoints: {},
    }) as never;
  const configRepo = () =>
    ({
      read: async () => stored,
      writeSettings: async () => stored,
      writeCredential: async () => stored,
    }) as never;

  const service = await AppService.create(bootstrap, {
    writeLog: () => undefined,
    fetcher: async () => { throw new Error('unexpected provider call'); },
    open: openStub,
    configRepository: configRepo,
  });
  await service.operations.shutdown();

  await expect(
    AppService.create(bootstrap, {
      writeLog: () => undefined,
      fetcher: async () => { throw new Error('unexpected provider call'); },
      open: openStub,
      configRepository: configRepo,
      memoryFirstPolicy: PROPOSED_MEMORY_TEXT_POLICY,
    }),
  ).rejects.toMatchObject({ code: 'NOT_READY' });
});
