/**
 * ============================================================================
 * FILE: bridge.native.e2e-spec.ts
 * LOCATION: backend/test/voice/agent/bridge.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integration tests for live agent bridge, HTTP exclusion, barge-in, and recovery.
 *
 * ROLE IN PROJECT:
 *    Proves end-to-end integration between LiveFlow, AgentVoiceAdapter,
 *    DurableChatRuntime, persistence, and HTTP endpoints with deterministic speech.
 *
 * KEY COMPONENTS:
 *    - fixture: Sets up LiveFlow, AgentVoiceAdapter, VoiceSessionService, and HTTP harness.
 *    - started: Drives turn to speech playback start.
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { voiceRuntimeHarness } from '../../runtime/voice-runtime-harness.js';
import { httpHarness } from '../../http/http-harness.js';
import { fixtureOptions } from '../../http/fixtures.js';
import { options, origin, request, fakeStt, fakeTts } from '../session/fixtures.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { LiveFlow } from '../../../src/voice/session/live-flow.js';
import type { VoiceSink } from '../../../src/voice/session/voice-session.options.js';
import { AgentVoiceAdapter } from '../../../src/voice/agent/agent-voice-adapter.js';
import { ServerIdentityResolver } from '../../../src/platform/identity/server-identity-resolver.js';
import { attemptsFor } from '../../../src/chat-runtime/history.js';
import { chunk, usage as modelUsage, done } from '../../fixtures/openrouter/frames.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

const speechUsage = { providerRequestId: 'fixture-tts', model: 'fixture', modelVersion: 'fixture-v1',
  audioMs: 100, billableCharacters: 12 };

async function fixture() {
  const h = await voiceRuntimeHarness(chunk('Hello world. ') + chunk('', 'stop') + modelUsage + done);
  const o = options(), identityResolver = new ServerIdentityResolver(h.deps.config); o.identity = identityResolver;
  o.sessions = h.persistence.sessions; o.reservations = h.runtime.reservations;
  // The voice session freezes the live configuration snapshot it admitted with, and the
  // bridge forwards it into every live turn, exactly as the production voice path does.
  const base = h.currentConfig.current();
  const snapshot = { ...base, voice: { ...base.voice,
    enabledModes: { dictation: true, live: true },
    deepgram: { ...base.voice.deepgram, apiKey: 'fixture-speech' } } };
  o.currentConfig = { current: () => snapshot };
  const sessions = new VoiceSessionService(o);
  const created = await sessions.create({ ...request, mode: 'live' }, origin);
  const context = sessions.claim(created.cookie.split(';')[0], origin), stt = fakeStt(), tts = fakeTts();
  let outputSamples = 0;
  const sink: VoiceSink = { outputSamples: () => outputSamples, event: vi.fn(),
    audio: vi.fn((_ref, pcm) => { outputSamples += pcm.byteLength / 2; }), invalidate: vi.fn(), finish: vi.fn() };
  const bridge = new AgentVoiceAdapter(h.runtime, (v, s) => sessions.bindConversation(v, s));
  const signal = new AbortController();
  const flow = await LiveFlow.open(context, sink, signal.signal, { stt: stt.port, tts: tts.port,
    hooks: bridge.hooks, usage: o.usage });
  bridge.attach(context, flow, sink); (context as any).cleanup = () => flow.close(); flow.start();
  const api = await httpHarness({ ...fixtureOptions(), identity: identityResolver, sessions: h.persistence.sessions,
    messages: h.persistence.messages, runtime: h.runtime, budgets: h.deps.config.budgets,
    executionReservations: h.runtime.reservations });
  const control = (payload: import('../../../src/contracts/voice-wire.js').VoiceClientPayload) => ({
    protocolVersion: 1 as const, sessionId: context.response.sessionId, connectionEpoch: context.response.connectionEpoch,
    eventId: 'fixture-control', sequence: 1, ...payload });
  return { ...h, sessions, context, stt, tts, sink, bridge, flow, api, control,
    async cleanup() { await flow.close(); await sessions.drain(); await api.close(); await h.close(); } };
}

async function started(f: Awaited<ReturnType<typeof fixture>>, text = 'SECRET voice input') {
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:0', text });
  await vi.waitFor(() => expect(f.tts.connection.speak).toHaveBeenCalled(), { timeout: 5000 });
  const ref = f.bridge.currentResponse(); if (!ref) throw new Error('Expected active response');
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await vi.waitFor(() => expect(f.sink.audio).toHaveBeenCalled(), { timeout: 5000 });
  await vi.waitFor(async () => expect((await attemptsFor(f.persistence, f.identity.userId,
    f.context.response.conversationId!))[0]?.status).toBe('completed'), { timeout: 5000 });
  return ref;
}

describe.skipIf(!configured)('Voice agent native bridge', () => {
  it('rejects competing text submit/retry and hides live status, stream and transcript paths', async () => {
    const f = await fixture();
    try {
      const ref = await started(f), s = f.context.response.conversationId!;
      await supertest(f.api.url).post(`/api/sessions/${s}/turns`)
        .send({ sessionId: s, content: 'Text collision', idempotencyKey: 'text-request-0001' }).expect(409);
      await supertest(f.api.url).post(`/api/sessions/${s}/turns/${ref.turnId}/retry`)
        .send({ idempotencyKey: 'text-retry-0001' }).expect(409);
      const paths = [`/api/sessions/${s}/turns/${ref.turnId}`, `/api/sessions/${s}/turns/${ref.turnId}/stream`];
      for (const path of paths) { const result = await supertest(f.api.url).get(path).expect(404);
        expect(JSON.stringify(result.body)).not.toMatch(/SECRET|Hello world|speech-1/); }
      const activeAttempt = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
      await supertest(f.api.url).post(`/api/sessions/${s}/turns/${ref.turnId}/cancel`)
        .send({ attemptId: activeAttempt.attemptId }).expect(404);
      const messages = await supertest(f.api.url).get(`/api/sessions/${s}/messages`).expect(200);
      const navigation = await supertest(f.api.url).get('/api/sessions').expect(200);
      expect(JSON.stringify(navigation.body)).not.toMatch(/SECRET|Hello world/);
      expect(messages.body.items.some((m: { voiceSessionId?: string; voiceTranscripts?: unknown[] }) =>
        m.voiceSessionId === f.context.response.sessionId && m.voiceTranscripts?.length)).toBe(true);
      expect(JSON.stringify(messages.body)).not.toMatch(/"visibility"|"attemptId"/);
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage: speechUsage });
      await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
      await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull(), { timeout: 5000 });
    } finally { await f.cleanup(); }
  }, 30000);

  it('barge-in cancels once, drops late audio and corrects the next prompt to heard content', async () => {
    const f = await fixture();
    try {
      const ref = await started(f), s = f.context.response.conversationId!;
      await f.flow.control(f.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 }));
      f.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-1', audioPlayedMs: 50,
        textSpoken: 'Hello', textRemaining: ' world.', usage: speechUsage });
      f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
      await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull(), { timeout: 5000 });
      const first = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
      expect(await f.persistence.metadata.getVoiceDelivery(f.identity.userId, s, first.attemptId))
        .toMatchObject({ status: 'interrupted', textGenerated: 'Hello world.', textSpoken: 'Hello', textRemaining: ' world.' });
      expect(f.sink.audio).toHaveBeenCalledTimes(1);
      expect(f.tts.connection.interrupt).toHaveBeenCalledTimes(1);
      f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:1', text: 'Continue.' });
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2), { timeout: 5000 });
      const body = JSON.parse(String(f.fetcher.mock.calls[1]?.[1]?.body)) as { messages: { role: string; content: string }[]; user: string };
      expect(body.user).toBe(f.identity.userId);
      expect(body.messages.filter(m => m.content === 'Continue.')).toHaveLength(1);
      expect(body.messages.filter(m => m.role === 'assistant')).toEqual([{ role: 'assistant', content: 'Hello' }]);
    } finally { await f.cleanup(); }
  }, 30000);

  it('completed generated state survives reconnect without automatic inference or TTS replay', async () => {
    const f = await fixture();
    try {
      const ref = await started(f), s = f.context.response.conversationId!;
      f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage: speechUsage });
      await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
      await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull(), { timeout: 5000 });
      const before = vi.mocked(f.tts.connection.speak).mock.calls.length;
      await f.flow.close(); await f.runtime.reconcileSession(f.identity.userId, s); await f.runtime.reconcileSession(f.identity.userId, s);
      expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.tts.connection.speak).toHaveBeenCalledTimes(before);
      const first = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
      expect(first.status).toBe('completed');
      expect(await f.persistence.metadata.getVoiceDelivery(f.identity.userId, s, first.attemptId))
        .toMatchObject({ status: 'completed', textSpoken: 'Hello world.' });
    } finally { await f.cleanup(); }
  }, 30000);

  it('mid-generation barge-in archives an internal partial and never forwards late model tokens', async () => {
    const f = await fixture(); let source!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    f.fetcher.mockImplementationOnce(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { source = c;
      c.enqueue(encoder.encode(chunk('Hello. '))); } }), { headers: { 'content-type': 'text/event-stream' } }));
    try {
      f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:0', text: 'SECRET slow answer' });
      await vi.waitFor(() => expect(f.tts.connection.speak).toHaveBeenCalledTimes(1), { timeout: 5000 });
      const ref = f.bridge.currentResponse(); if (!ref) throw new Error('Expected running response');
      const s = f.context.response.conversationId!;
      expect((await attemptsFor(f.persistence, f.identity.userId, s))[0]?.status).toBe('generating');
      f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
      f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
      await vi.waitFor(() => expect(f.sink.audio).toHaveBeenCalledTimes(1), { timeout: 5000 });
      await f.flow.control(f.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 }));
      f.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-1', audioPlayedMs: 50,
        textSpoken: 'Hello', textRemaining: '.', usage: speechUsage });
      try { source.enqueue(encoder.encode(chunk('Late secret sentence. ') + chunk('', 'stop') + modelUsage + done)); source.close(); }
      catch { /* The reader may already have cancelled the fixture stream. */ }
      await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull(), { timeout: 5000 });
      const a = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
      expect(a.status).toBe('cancelled');
      expect(await f.persistence.metadata.getVoiceDelivery(f.identity.userId, s, a.attemptId))
        .toMatchObject({ status: 'interrupted', textGenerated: 'Hello.', textSpoken: 'Hello', textRemaining: '.' });
      const manifest = await f.persistence.memory.get(f.identity.userId, s);
      const originals = await f.persistence.messages.getReferences(f.identity.userId, s, manifest!.messageRefs);
      expect(originals.find(m => m.role === 'assistant')).toMatchObject({ content: 'Hello.', visibility: 'internal', mode: 'live' });
      expect(f.tts.connection.speak).toHaveBeenCalledTimes(1); expect(f.fetcher).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  }, 30000);

  it('archives only filtered generated prose and duplicate finalized input never launches inference twice', async () => {
    const f = await fixture();
    f.fetcher.mockImplementationOnce(async () => new Response(
      chunk('<think>private one. private two.</think>\n**Hello world.**\n') + chunk('', 'stop') + modelUsage + done,
      { headers: { 'content-type': 'text/event-stream' } }));
    try {
      const ref = await started(f), s = f.context.response.conversationId!;
      f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:0', text: 'SECRET voice input' });
      expect(vi.mocked(f.tts.connection.speak).mock.calls.map(([c]) => c.text).join('')).toBe('Hello world.');
      f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage: speechUsage });
      await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
      await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull(), { timeout: 5000 });
      const attempts = await attemptsFor(f.persistence, f.identity.userId, s);
      expect(attempts).toHaveLength(1); expect(f.fetcher).toHaveBeenCalledTimes(1);
      const manifest = await f.persistence.memory.get(f.identity.userId, s);
      const originals = await f.persistence.messages.getReferences(f.identity.userId, s, manifest!.messageRefs);
      expect(originals.find(m => m.role === 'assistant')?.content).toBe('Hello world.');
      expect(JSON.stringify(originals)).not.toContain('private one');
      expect(JSON.stringify(vi.mocked(f.sink.event).mock.calls)).not.toMatch(/SECRET|Hello world|private one/);
    } finally { await f.cleanup(); }
  }, 30000);

  it('StartOfTurn aborts thinking before first prose and late provider tokens cannot reach speech', async () => {
    const f = await fixture();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    f.fetcher.mockImplementationOnce(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { source = c; } }),
      { headers: { 'content-type': 'text/event-stream' } }));
    try {
      f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:0', text: 'SECRET slow turn' });
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(f.bridge.currentResponse()).not.toBeNull();
      f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'provider:1' });
      await vi.waitFor(() => expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true), { timeout: 5000 });
      expect(f.tts.connection.interrupt).not.toHaveBeenCalled();
      try { source.enqueue(encoder.encode(chunk('Must not be spoken. ') + chunk('', 'stop') + modelUsage + done)); source.close(); }
      catch { /* The fixture reader may already have been cancelled. */ }
      await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull(), { timeout: 5000 });
      expect(f.tts.connection.speak).not.toHaveBeenCalled();
      const s = f.context.response.conversationId!;
      // The cancellation settles asynchronously; wait for the durable terminal outcome.
      await vi.waitFor(async () => expect(['cancelled', 'interrupted'])
        .toContain((await attemptsFor(f.persistence, f.identity.userId, s))[0]?.status), { timeout: 5000 });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  }, 30000);
});
