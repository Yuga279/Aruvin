/**
 * ============================================================================
 * FILE: integrated-fixture.ts
 * LOCATION: backend/test/voice/integration/integrated-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Real Nest HTTP/runtime fixture with dictation WebSocket and offline LiveKit peers.
 *
 * ROLE IN PROJECT:
 *    Composes NestJS, VoiceSessionController/Service, the dictation VoiceGateway, and
 *    DurableChatRuntime with deterministic providers and the P5 offline LiveKit bridge.
 *
 * KEY COMPONENTS:
 *    - integratedFixture: Factory for text, dictation, and offline live test peers.
 *    - Peer: Discriminated dictation-WebSocket/live-Room SDK test boundary.
 * ============================================================================
 */

import 'reflect-metadata';
import { offlineLiveKit } from '../../assembly/voice-livekit-fixture.js';
import { once } from 'node:events';
import { expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import WebSocket from 'ws';
import request from 'supertest';
import { voiceRuntimeHarness } from '../../runtime/voice-runtime-harness.js';
import type { CalendarRuntimeFixture } from '../../runtime/calendar-runtime.fixture.js';
import { principal } from '../../assembly/auth-principal-fixture.js';
import { options, origin, fakeStt, fakeTts } from '../session/fixtures.js';
import { ChatHttpModule, configureChatHttp } from '../../../src/http/index.js';
import { ServerIdentityResolver } from '../../../src/platform/identity/server-identity-resolver.js';
import { RequestIdentityStore } from '../../../src/platform/identity/request-identity-store.js';
import { AuthenticatedWsAdapter, VoiceUpgradeAdmission }
  from '../../../src/voice/transport/authenticated-ws-adapter.js';
import { loadConfig } from '../../../src/platform/config/load-config.js';
import { loadBootstrapConfig } from '../../../src/platform/config/bootstrap-config.js';
import { livekitConfigFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import { buildRuntimeSnapshot, defaultManageableSettings }
  from '../../../src/platform/config/manageable-config.js';
import type { RuntimeConfigSnapshot } from '../../../src/contracts/config-runtime.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import type { VoiceBinding } from '../../../src/voice/session/voice-session.service.js';
import { VoiceSessionController } from '../../../src/voice/session/voice-session.controller.js';
import { VoiceGateway } from '../../../src/voice/transport/voice.gateway.js';
import { VOICE_SESSION_OPTIONS, type SessionContext } from '../../../src/voice/session/voice-session.options.js';
import { DictationFlow } from '../../../src/voice/session/dictation-flow.js';
import { LiveFlow } from '../../../src/voice/session/live-flow.js';
import { AgentVoiceAdapter } from '../../../src/voice/agent/agent-voice-adapter.js';
import { INPUT_AUDIO, type CreateVoiceSessionResponse, type VoiceClientPayload,
  type VoiceServerEvent } from '../../../src/contracts/voice-wire.js';
import { encodeVoiceAudio } from '../../../src/contracts/voice-audio.js';
import { chunk, usage, done } from '../../fixtures/openrouter/frames.js';

export { origin };
const nativeAuthorized = process.env.AURVIN_VOICE_NATIVE_AUTHORIZED === '1';
const nativeSupplied = Boolean(process.env.AURVIN_TEST_MONGODB_URI);
if (nativeAuthorized && nativeSupplied && process.env.AURVIN_TEST_DB_PREFIX !== 'aurvin_p2_test_') {
  throw new Error('Voice native checks require the isolated test prefix.');
}
export const nativeConfigured = nativeAuthorized && nativeSupplied;
type Ref = { turnId: string; responseId: string };
type Connection = { context: SessionContext; stt: ReturnType<typeof fakeStt>;
  tts: ReturnType<typeof fakeTts>; flow: DictationFlow | LiveFlow; bridge: AgentVoiceAdapter | null };
export type DictationPeer = { mode: 'dictation'; response: CreateVoiceSessionResponse; socket: WebSocket;
  events: VoiceServerEvent[]; audio: Buffer[]; control(payload: VoiceClientPayload): void; pcm(): void;
  wait(type: VoiceServerEvent['type']): Promise<VoiceServerEvent> };
export type LivePeer = { mode: 'live'; response: CreateVoiceSessionResponse; events(): VoiceServerEvent[];
  control(payload: VoiceClientPayload): void; pcm(): void; lose(): void; captured(): number;
  wait(type: VoiceServerEvent['type']): Promise<VoiceServerEvent> };
export type Peer = DictationPeer | LivePeer;
export const speechUsage = { providerRequestId: 'fixture-tts', model: 'fixture', modelVersion: 'fixture-v1',
  audioMs: 100, billableCharacters: 12 };

/**
 * Live-capable frozen snapshot for the committed SubmitLiveTurn.configSnapshot
 * contract: the session service captures it once and every live turn binds it.
 */
export function liveConfigSnapshot(): RuntimeConfigSnapshot {
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = 'fixture/model';
  settings.voice.enabledModes = { dictation: true, live: true };
  // Isolate execution exclusion from the separate identity-concurrency quota gate.
  settings.voice.quotas.identityConcurrent = 4; settings.voice.quotas.globalConcurrent = 4;
  const livekit = livekitConfigFixture();
  const bootstrap = loadBootstrapConfig({ LIVEKIT_URL: livekit.url,
    LIVEKIT_API_KEY: livekit.apiKey, LIVEKIT_API_SECRET: livekit.apiSecret });
  return buildRuntimeSnapshot(bootstrap, { revision: 1, settings,
    credentials: { openrouter: 'fixture-key', deepgram: 'fixture-secret' } },
    { modelId: 'fixture/model', contextTokens: 32768, outputTokens: 4096,
      supportsMaxTokens: true, source: 'fixture' });
}

export async function integratedFixture(calendar?: CalendarRuntimeFixture) {
  await calendar?.ready;
  const h = calendar ? {
    get runtime() { return calendar.runtime; },
    persistence: calendar.p,
    identity: calendar.identity,
    fetcher: calendar.fetcher,
    deps: { config: loadConfig({ AURVIN_USER_ID: calendar.identity.userId }) },
    close: () => calendar.dispose(),
  } : await voiceRuntimeHarness(chunk('Hello world. ') + chunk('', 'stop') + usage + done);
  const o = options();
  const identities = new RequestIdentityStore();
  const admitted = principal(h.identity.userId);
  const identityResolver = new ServerIdentityResolver(identities);
  const admission = new VoiceUpgradeAdmission(
    { authenticate: async () => ({ principal: admitted }) },
    { frontendOrigin: origin, secureCookie: false, developmentLoopback: true,
      trustedHttpsIngress: () => false },
  );
  o.sessions = h.persistence.sessions; o.reservations = h.runtime.reservations;
  const media = offlineLiveKit();
  o.livekit = media.admission;
  // The session service captures this frozen snapshot; live turns bind it to the runtime.
  const configSnapshot = calendar ? {
    ...liveConfigSnapshot(),
    calendar: calendar.currentConfig.current()!.calendar,
    modelLimits: calendar.currentConfig.current()!.modelLimits,
  } : liveConfigSnapshot();
  o.currentConfig = { current: () => configSnapshot };
  calendar?.publish(configSnapshot);
  // Isolate execution exclusion from the separate identity-concurrency quota gate.
  o.config.quotas.identityConcurrent = 4; o.config.quotas.globalConcurrent = 4;
  const connections: Connection[] = [], peers: Peer[] = [];
  let sessions!: VoiceSessionService;
  o.open = async (context, sink, signal) => {
    const stt = fakeStt(), tts = fakeTts();
    if (context.response.mode === 'dictation') {
      const flow = await DictationFlow.open(context, sink, signal, stt.port, o.usage);
      connections.push({ context, stt, tts, flow, bridge: null }); return flow;
    }
    const bridge = new AgentVoiceAdapter(h.runtime, (v, s) => sessions.bindConversation(v, s));
    const flow = await LiveFlow.open(context, sink, signal, { stt: stt.port, tts: tts.port,
      hooks: bridge.hooks, usage: o.usage });
    bridge.attach(context, flow, sink);
    connections.push({ context, stt, tts, flow, bridge }); return flow;
  };
  o.openLiveBridge = async (context, ticket) => {
    const epochNumber = context.response.connectionEpoch;
    const owner = context as VoiceBinding;
    let claimed = false;
    const current = () => owner.response.connectionEpoch === epochNumber && owner.state !== 'ended';
    const bridge = await media.connect({ context, ticket,
      open: async (c, sink, signal) => {
        if (!current()) throw new Error('STALE_CONNECTION_EPOCH');
        if (!claimed) {
          expect(sessions.claimLive(c.response.sessionId,
            ticket.transport.participantIdentity, ticket.transport.roomName)).toBe(c);
          claimed = true;
        }
        return o.open(c, sink, signal) as Promise<LiveFlow>;
      },
      ended: async () => { if (current()) await sessions.end(context.response.sessionId); },
      disconnected: async recoverable => {
        if (current()) await sessions.disconnected(owner, recoverable);
      },
    });
    return { close: () => bridge.dispose() };
  };
  let app: NestExpressApplication;
  try {
  const module = await Test.createTestingModule({
    imports: [ChatHttpModule.register({ identity: identityResolver, sessions: h.persistence.sessions,
      messages: h.persistence.messages, runtime: h.runtime, budgets: h.deps.config.budgets,
      principal: () => identities.principal(),
      ...(calendar ? { currentConfig: calendar.currentConfig } : {}),
      executionReservations: h.runtime.reservations })],
    controllers: [VoiceSessionController], providers: [
      { provide: VOICE_SESSION_OPTIONS, useValue: o }, VoiceSessionService, VoiceGateway,
      { provide: RequestIdentityStore, useValue: identities },
      { provide: VoiceUpgradeAdmission, useValue: admission } ],
  }).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api'); configureChatHttp(app, h.deps.config.budgets);
  app.use((_req: object, _res: unknown, next: () => void) => identities.run(admitted, next));
  app.useWebSocketAdapter(new AuthenticatedWsAdapter(app, admission)); sessions = app.get(VoiceSessionService);
  await app.listen(0, '127.0.0.1');
  } catch (error) {
    try { await sessions?.drain(); await app!?.close(); } finally { await h.close(); }
    throw error;
  }
  const url = await app.getUrl();
  const latest = () => { const c = connections.at(-1); if (!c) throw new Error('No voice connection'); return c; };
  function connect(mode: 'dictation', conversationId: string | null, idempotencyKey: string): Promise<DictationPeer>;
  function connect(mode: 'live', conversationId: string | null, idempotencyKey: string): Promise<LivePeer>;
  async function connect(mode: 'dictation' | 'live', conversationId: string | null,
    idempotencyKey: string): Promise<Peer> {
    const created = await request(url).post('/api/voice/sessions').set('Origin', origin)
      .send({ protocolVersion: 1, mode, conversationId, locale: 'en-US', idempotencyKey }).expect(201);
    const response = created.body as CreateVoiceSessionResponse;
    if (mode === 'live') {
      const epoch = media.last();
      const room = epoch.rtc.rooms[0]!;
      const source = epoch.rtc.sources[0]!;
      const livePeer: LivePeer = {
        mode, response,
        events: () => epoch.events(),
        control: payload => epoch.control(payload),
        pcm: () => epoch.rtc.pushFrame(new Int16Array(1280).fill(1000)),
        lose: () => { room.emit('disconnected'); },
        captured: () => source.captured.length,
        wait: async type => {
          await vi.waitFor(() => expect(epoch.events().some(e => e.type === type)).toBe(true), { timeout: 5000 });
          return epoch.events().find(e => e.type === type)!;
        },
      };
      peers.push(livePeer);
      epoch.control({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO });
      await livePeer.wait('session.ready');
      epoch.microphone();
      return livePeer;
    }
    const cookie = String(created.headers['set-cookie'][0]).split(';')[0];
    const socket = new WebSocket(url.replace('http:', 'ws:') + '/api/voice', { headers: { Origin: origin, Cookie: cookie } });
    const events: VoiceServerEvent[] = [], audio: Buffer[] = [];
    socket.on('message', (data, binary) => binary ? audio.push(Buffer.from(data as Buffer))
      : events.push(JSON.parse(data.toString()) as VoiceServerEvent));
    let sequence = 0, audioSequence = 0;
    const peer: DictationPeer = { mode, response, socket, events, audio,
      control: payload => { const n = sequence++; socket.send(JSON.stringify({ protocolVersion: 1,
        sessionId: response.sessionId, connectionEpoch: response.connectionEpoch,
        eventId: `client-${n}`, sequence: n, ...payload })); },
      pcm: () => { const n = audioSequence++; socket.send(encodeVoiceAudio({ kind: 1, flags: 0,
        sequence: n, offsetMs: n * 80, pcm: new Uint8Array(2560) })); },
      wait: async type => { await vi.waitFor(() => expect(events.some(e => e.type === type)).toBe(true), { timeout: 5000 });
        return events.find(e => e.type === type)!; },
    };
    peers.push(peer);
    await once(socket, 'open'); peer.control({ type: 'session.start', mode, audioSettings: INPUT_AUDIO });
    await peer.wait('session.ready'); return peer;
  }
  const text = async (sessionId: string | null, content: string, idempotencyKey: string) => {
    const path = sessionId === null ? '/api/sessions' : `/api/sessions/${sessionId}/turns`;
    const calendarProtocol = o.currentConfig.current()?.calendar?.enabled ? { calendarProtocol: 2 } : {};
    const accepted = await request(url).post(path).send({ sessionId, content, idempotencyKey, ...calendarProtocol }).expect(202);
    await h.runtime.executeTurn({ userId: h.identity.userId, ...accepted.body,
      signal: new AbortController().signal, emit: async () => undefined,
      emitCalendar: async event => { calendar?.frames.push(event); } });
    expect((await request(url).get(`/api/sessions/${accepted.body.sessionId}/turns/${accepted.body.turnId}`).expect(200)).body.status).toBe('completed');
    return accepted.body as { sessionId: string; turnId: string; attemptId: string };
  };
  const awaitReply = async (peer: LivePeer, previousSpeakCount: number): Promise<Ref> => {
    const c = latest();
    await vi.waitFor(() => expect(vi.mocked(c.tts.connection.speak).mock.calls.length)
      .toBeGreaterThan(previousSpeakCount), { timeout: 5000 });
    const ref = c.bridge?.currentResponse();
    if (!ref) throw new Error('Expected active response for this reply');
    c.tts.events.push({ type: 'speech-started', ...ref, speechId: `speech-${ref.responseId}` });
    c.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    await vi.waitFor(() => expect(peer.events().some(e => e.type === 'audio.start'
      && e.turnId === ref.turnId && e.responseId === ref.responseId)).toBe(true));
    await vi.waitFor(() => expect(peer.captured()).toBeGreaterThan(0));
    return ref;
  };
  const startReply = async (peer: LivePeer, input: string,
    providerTurnId = 'provider:0'): Promise<Ref> => {
    const c = latest();
    const count = vi.mocked(c.tts.connection.speak).mock.calls.length;
    c.stt.events.push({ type: 'end-of-turn', providerTurnId, text: input });
    return awaitReply(peer, count);
  };
  const finishReply = async (peer: LivePeer, ref: Ref) => {
    const c = latest();
    c.tts.events.push({ type: 'speech-completed', ...ref, speechId: `speech-${ref.responseId}`,
      audioDurationMs: 100, usage: speechUsage });
    await vi.waitFor(() => expect(peer.events().some(event => event.type === 'audio.watermark' && event.final
      && event.turnId === ref.turnId && event.responseId === ref.responseId)).toBe(true));
    const final = peer.events().findLast(event => event.type === 'audio.watermark' && event.final
      && event.turnId === ref.turnId && event.responseId === ref.responseId);
    if (!final || final.type !== 'audio.watermark') throw new Error('Missing final live audio watermark for this reply');
    peer.control({ type: 'playback.progress', ...ref, playedSamples: final.lastAudioSample,
      playedMs: Math.floor(final.lastAudioSample / 24), proof: 'proven' });
    await vi.waitFor(() => expect(c.bridge?.currentResponse()).toBeNull(), { timeout: 5000 });
  };
  const end = async (peer: Peer) => {
    await request(url).delete(`/api/voice/sessions/${peer.response.sessionId}`).set('Origin', origin).expect(204);
    if (peer.mode === 'dictation') peer.socket.terminate();
  };
  return { ...h, app, url, sessions, connections, media, latest, connect, text, startReply, awaitReply,
    finishReply, end,
    close: async () => {
      try { for (const p of peers) if (p.mode === 'dictation') p.socket.terminate(); await sessions.drain(); }
      finally { try { await app.close(); } finally { await h.close(); } }
    } };
}
