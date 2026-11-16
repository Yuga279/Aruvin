/**
 * ============================================================================
 * FILE: voice-bootstrap.e2e-spec.ts
 * LOCATION: backend/test/assembly/voice-bootstrap.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    End-to-end assembly tests for voice bootstrap and diagnostic wiring.
 *
 * ROLE IN PROJECT:
 *    Verifies that AppService composes voice services into a single owner,
 *    admits LiveKit media through one bridge, keeps dictation/text unchanged,
 *    reports passive degradation, and drains under one finite shutdown budget.
 *
 * KEY COMPONENTS:
 *    - Diagnostic/unconfigured boot: one session service and passive status.
 *    - LiveKit assembly: zero providers before start, one claim per epoch,
 *      reconnect, interruption/completion/durability and shutdown evidence.
 *    - Dictation/text isolation: Nova partials and chat streams after faults.
 * ============================================================================
 */

import 'reflect-metadata';
import { EventEmitter, once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import WebSocket from 'ws';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { AppService, type AssemblyPorts } from '../../src/app.service.js';
import { configureApplication } from '../../src/main.js';
import { loadBootstrapConfig, type BootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { defaultManageableSettings } from '../../src/platform/config/manageable-config.js';
import { CredentialService } from '../../src/admin-config/credential-service.js';
import { CredentialValidator } from '../../src/admin-config/credential-validation.js';
import type { StoredConfigDocument } from '../../src/contracts/admin-config.js';
import type { ConfigRepository } from '../../src/contracts/config-runtime.js';
import { AURVIN_CONFIG } from '../../src/platform/tokens.js';
import { RequestIdentityStore } from '../../src/platform/identity/request-identity-store.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { VoiceGateway } from '../../src/voice/transport/voice.gateway.js';
import { VoiceSessionService } from '../../src/voice/session/voice-session.service.js';
import type { ProviderSocket, SocketFactory } from '../../src/voice/providers/provider-link.js';
import { INPUT_AUDIO, isLiveKitVoiceSessionResponse,
  type VoiceClientPayload, type VoiceServerEvent } from '../../src/contracts/voice-wire.js';
import type { VoiceAccountingRecord } from '../../src/contracts/voice-accounting.js';
import type { VoiceDeliveryRecord } from '../../src/contracts/voice.js';
import { ExecutionReservations } from '../../src/chat-runtime/execution-reservations.js';
import type { ExecuteTurn } from '../../src/chat-runtime/ports.js';
import { fixtureOptions, deferred } from '../http/fixtures.js';
import { key } from '../../src/persistence/records.js';
import { attempt } from '../persistence/fixtures.js';
import { metadata, turn } from '../fixtures/deepgram/socket.js';
import { livekitEnvironment, offlineLiveKit } from './voice-livekit-fixture.js';
import { settle } from '../voice/transport/fixtures.js';
import { admittedAccount, authFixture, SESSION_COOKIE } from '../auth/fixtures.js';

const secret = 'fixture-deepgram-secret';
const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
const sockets: URL[] = [];
const speechSockets: SocketFactory = (url) => {
  sockets.push(url);
  throw new Error('speech socket');
};

class FakeProviderSocket extends EventEmitter implements ProviderSocket {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: Array<string | Uint8Array> = [];
  constructor(readonly url: URL, readonly headers: Record<string, string>) {
    super();
    queueMicrotask(() => {
      this.emit('open');
      if (url.pathname.startsWith('/v2/')) this.emit('message', Buffer.from(JSON.stringify({
        type: 'Connected', request_id: 'req-fixture', model_version: 'fixture', model_name: 'flux-haley-en',
      })), false);
    });
  }
  send(data: string | Uint8Array, callback: (error?: Error) => void) { this.sent.push(data); callback(); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
  ping() { this.emit('pong'); }
  serverText(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
  serverBinary(bytes: Uint8Array) { this.emit('message', Buffer.from(bytes), true); }
}

function recordingSockets() {
  const opened: FakeProviderSocket[] = [];
  const factory: SocketFactory = (url, headers) => {
    const socket = new FakeProviderSocket(url, headers);
    opened.push(socket);
    return socket;
  };
  return { opened, factory };
}

function bootstrap(withLiveKit = false): BootstrapConfig {
  return loadBootstrapConfig({
    FRONTEND_ORIGIN: 'http://127.0.0.1:5173',
    PERSISTENCE_PROFILE: 'native-mongodb',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/aurvin_assembly_fixture',
    AURVIN_CONFIG_ENCRYPTION_KEY: MASTER_KEY,
    AURVIN_USER_ID: 'server-user',
    ...(withLiveKit ? livekitEnvironment() : {}),
  });
}

function storedDocument(options: {
  dictation: boolean; live: boolean; openrouter: string | null; deepgram: string | null;
}): StoredConfigDocument {
  const config = bootstrap();
  const credentials = new CredentialService(config.encryption,
    new CredentialValidator(async () => { throw new Error('e2e must not validate'); }));
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = 'fixture-model';
  settings.voice.enabledModes = { dictation: options.dictation, live: options.live };
  return {
    _id: 'aurvin', schemaVersion: 1, revision: 1, settings,
    credentials: {
      openrouter: options.openrouter === null ? null : {
        envelope: credentials.seal('openrouter', options.openrouter),
        validatedAt: '2026-10-13T12:00:00.000Z',
      },
      deepgram: options.deepgram === null ? null : {
        envelope: credentials.seal('deepgram', options.deepgram),
        validatedAt: '2026-10-13T12:00:00.000Z',
      },
    },
    updatedAt: '2026-10-13T12:00:00.000Z', updatedBy: config.identity.userId,
  };
}

function memoryConfigRepository(stored: StoredConfigDocument | null): ConfigRepository {
  let current = stored === null ? null : structuredClone(stored);
  return {
    read: async () => (current === null ? null : structuredClone(current)),
    createIfAbsent: async document => {
      if (current) return { outcome: 'conflict', currentRevision: current.revision };
      current = structuredClone(document);
      return { outcome: 'confirmed', document: structuredClone(document) };
    },
    compareAndSwap: async (expected, document) => {
      if (current?.revision !== expected) {
        return { outcome: 'conflict', currentRevision: current?.revision ?? 0 };
      }
      current = structuredClone(document);
      return { outcome: 'confirmed', document: structuredClone(document) };
    },
  };
}

async function compileModule(config: BootstrapConfig, service: AppService) {
  const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
  process.env.NODE_ENV = 'development';
  process.env.FRONTEND_ORIGIN = 'http://127.0.0.1:5173';
  try {
    return await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(config)
      .overrideProvider(RequestIdentityStore).useValue(service.identities)
      .overrideProvider(ServerIdentityResolver).useValue(service.identity)
      .overrideProvider(AppService).useValue(service)
      .compile();
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
  }
}

function runtimeStub(executeLive = false) {
  const calls = { submit: 0, execute: 0 };
  const textRuntime = fixtureOptions().runtime;
  const records = new Map<string, VoiceDeliveryRecord>();
  let turnStatus: 'accepted' | 'completed' | 'cancelled' | 'failed' =
    executeLive ? 'accepted' : 'completed';
  let startGate: Promise<void> | undefined;
  let failLive: Error | undefined;
  let completedWriteGate: Promise<void> | undefined;
  let writeRecord: ((record: VoiceDeliveryRecord, expected?: number) => Promise<void>) | undefined;
  const reservations = new ExecutionReservations(bootstrap().identity.userId, async () => false);
  const submitLiveTurn = vi.fn(async (command: { sessionId: string }) => {
    calls.submit += 1;
    return { sessionId: command.sessionId, turnId: 'turn-1', attemptId: 'attempt-1' };
  });
  const executeTurn = vi.fn(async (command: ExecuteTurn) => {
    if (!command.live) return textRuntime.executeTurn(command);
    calls.execute += 1;
    if (!executeLive) return;
    const live = command.live;
    writeRecord = async (record, expected) => {
      if (expected !== undefined) expect(records.get(command.attemptId)?.sequence).toBe(expected);
      if (completedWriteGate && record.status === 'completed') await completedWriteGate;
      records.set(command.attemptId, structuredClone(record));
    };
    await live.start({ ...attempt(), userId: command.userId, sessionId: command.sessionId,
      turnId: command.turnId, attemptId: command.attemptId }, writeRecord);
    if (startGate) await startGate;
    if (failLive) {
      const current = records.get(command.attemptId)!;
      await writeRecord({ ...current, status: 'failed', textSpoken: null, textRemaining: null,
        updatedAt: new Date().toISOString() }, current.sequence);
      turnStatus = 'failed';
      throw failLive;
    }
    try {
      await live.delta('Hello world.');
      await live.finish();
      await live.settle('Hello world.', command.signal);
      if (!command.signal.aborted) turnStatus = 'completed';
    } finally {
      if (command.signal.aborted) turnStatus = 'cancelled';
    }
  });
  return {
    ...textRuntime,
    reservations,
    calls,
    records,
    get turnStatus() { return turnStatus; },
    set turnStatus(value: 'accepted' | 'completed' | 'cancelled' | 'failed') { turnStatus = value; },
    set startGate(value: Promise<void> | undefined) { startGate = value; },
    set failLive(value: Error | undefined) { failLive = value; },
    set completedWriteGate(value: Promise<void> | undefined) { completedWriteGate = value; },
    snapshot: () => ({ active: 0, accepting: true, degraded: false }),
    stopAccepting: vi.fn(),
    drain: vi.fn(async () => ({ drained: true, active: 0, unresolvedWrites: 0 })),
    submitLiveTurn,
    findLiveSubmission: vi.fn(async () => false),
    getLiveTurnStatus: vi.fn(async (_userId: string, sessionId: string, turnId: string) => ({
      sessionId, turnId, attemptId: 'attempt-1', status: turnStatus,
      truncated: false, error: null,
    })),
    reconcileSession: vi.fn(async () => {
      expect([...records.values()].some(record => record.status === 'pending')).toBe(false);
    }),
    executeTurn,
    cancelLiveTurn: vi.fn(async () => { turnStatus = 'cancelled'; }),
    getLiveDelivery: vi.fn(async (_userId: string, _sessionId: string, attemptId: string) =>
      records.get(attemptId) ?? null),
  };
}

async function boot(stored: StoredConfigDocument | null = null) {
  const config = bootstrap();
  const auth = await authFixture(admittedAccount({ userId: 'server-user' }));
  const service = await AppService.create(config, {
    writeLog: () => undefined,
    fetcher: async () => { throw new Error('diagnostic assembly called a provider'); },
    authProvider: () => auth.provider,
    open: stored === null
      ? async () => { throw new Error('diagnostic assembly opened persistence'); }
      : async () => ({
        ping: async () => true,
        close: async () => undefined,
        sessions: {},
        messages: {},
        users: auth.users,
        memory: {},
        metadata: {},
        calendarConnections: { get: async () => null },
        calendarConnectionsV2: { get: async () => null },
        owner: { assertExecutor: async () => undefined },
        checkpoints: {},
      }) as never,
    configRepository: () => memoryConfigRepository(stored),
    speechSockets,
  });
  const moduleRef = await compileModule(config, service);
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  return { app, service, base: await app.getUrl() };
}

async function bootEnabled(factory: SocketFactory, runtime: ReturnType<typeof runtimeStub>,
  write: (record: VoiceAccountingRecord) => Promise<void> = async () => undefined,
  withLiveKit = true) {
  const config = bootstrap(withLiveKit);
  const media = offlineLiveKit();
  const stored = storedDocument({
    dictation: true, live: true, openrouter: 'fixture-openrouter', deepgram: secret,
  });
  const accounting: VoiceAccountingRecord[] = [];
  const runtimeFactory = vi.fn(() => runtime);
  const http = fixtureOptions();
  const auth = await authFixture(admittedAccount({ userId: 'server-user' }));
  const service = await AppService.create(config, {
    authProvider: () => auth.provider,
    writeLog: () => undefined,
    fetcher: async () => { throw new Error('enabled assembly called a provider'); },
    speechSockets: factory,
    livekitAdmission: media.admission,
    livekitConnect: media.connect,
    limits: (async () => ({ modelId: 'fixture-model', contextTokens: 32768, outputTokens: 4096,
      supportsMaxTokens: true, source: 'fixture' as const })) as AssemblyPorts['limits'],
    runtime: runtimeFactory as unknown as AssemblyPorts['runtime'],
    configRepository: () => memoryConfigRepository(stored),
    open: (async () => ({
      ping: async () => true,
      close: async () => undefined,
      sessions: http.sessions,
      messages: http.messages,
      users: auth.users,
      memory: {},
      metadata: { putVoiceAccounting: async (record: VoiceAccountingRecord) => { await write(record); accounting.push(record); } },
      calendarConnections: { get: async () => null },
      calendarConnectionsV2: { get: async () => null },
      owner: { assertExecutor: async () => undefined },
      checkpoints: { create: async () => ({ setup: async () => undefined, bind: () => ({}) }) },
    })) as AssemblyPorts['open'],
  });
  const moduleRef = await compileModule(config, service);
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  return { app, service, base: await app.getUrl(), runtime, accounting, config, media,
    runtimeFactory };
}

async function until(assert: () => void, ms = 2000) {
  const deadline = Date.now() + ms;
  let last: unknown;
  while (Date.now() < deadline) {
    try { assert(); return; } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw last;
}

async function connect(base: string, mode: 'dictation' | 'live') {
  const created = await request(base).post('/api/voice/sessions').set('Origin', 'http://127.0.0.1:5173').set('Cookie', SESSION_COOKIE)
    .send({ protocolVersion: 1, mode, conversationId: null, locale: 'en-US', idempotencyKey: `${mode}-0001` })
    .expect(201);
  expect(JSON.stringify(created.body).includes(secret)).toBe(false);
  expect(JSON.stringify(created.headers).includes(secret)).toBe(false);
  const cookie = String(created.headers['set-cookie'][0]).split(';')[0];
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', {
    headers: { Origin: 'http://127.0.0.1:5173', Cookie: `${SESSION_COOKIE}; ${cookie}` },
  });
  const messages: Array<{ data: Buffer; binary: boolean }> = [];
  socket.on('message', (data, binary) => messages.push({ data: Buffer.from(data as Buffer), binary }));
  await once(socket, 'open');
  let sequence = 0;
  const control = (payload: VoiceClientPayload) => socket.send(JSON.stringify({
    protocolVersion: 1, sessionId: created.body.sessionId, connectionEpoch: created.body.connectionEpoch,
    eventId: `client-${sequence}`, sequence: sequence++, ...payload,
  }));
  control({ type: 'session.start', mode, audioSettings: INPUT_AUDIO });
  const next = async () => {
    const deadline = Date.now() + 2000;
    while (messages.length === 0 && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 5));
    const message = messages.shift();
    if (!message) throw new Error('Assembly voice event exceeded its two-second bound.');
    return message;
  };
  expect(JSON.parse((await next()).data.toString()).type).toBe('session.ready');
  const nextEvent = async (type: string, expected: Record<string, unknown> = {}) => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const message = await next();
      if (message.binary) throw new Error('Unexpected assembly audio event.');
      const event = JSON.parse(message.data.toString());
      if (event.type === type && Object.entries(expected).every(([key, value]) => event[key] === value)) return event;
    }
    throw new Error('Expected assembly control event was not received.');
  };
  return { socket, next, nextEvent, created, control };
}

async function connectLive(started: Awaited<ReturnType<typeof bootEnabled>>, key = 'live-0001') {
  const created = await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173').set('Cookie', SESSION_COOKIE)
    .send({ protocolVersion: 1, mode: 'live', conversationId: null,
      locale: 'en-US', idempotencyKey: key }).expect(201);
  expect(isLiveKitVoiceSessionResponse(created.body)).toBe(true);
  const epoch = started.media.last();
  epoch.control({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO });
  let cursor = 0;
  const nextEvent = async (type: string, expected: Record<string, unknown> = {}) => {
    let found: VoiceServerEvent | undefined;
    await until(() => {
      const events = epoch.events();
      while (cursor < events.length) {
        const event = events[cursor++];
        if (event.type === type && Object.entries(expected).every(([k, v]) =>
          (event as unknown as Record<string, unknown>)[k] === v)) { found = event; break; }
      }
      expect(found).toBeDefined();
    });
    return found!;
  };
  await nextEvent('session.ready');
  epoch.microphone();
  return { ...epoch, created, nextEvent };
}

let app: NestExpressApplication;

afterEach(async () => {
  if (!app) return;
  await app.get(AppService).voiceSessions.drain().catch(() => undefined);
  await app.close();
});

it('boots diagnostic voice wiring without a provider socket or a second session owner', async () => {
  const started = await boot();
  app = started.app;
  expect(app.get(VoiceSessionService)).toBe(started.service.voiceSessions);
  expect(app.get(VoiceGateway)).toBeInstanceOf(VoiceGateway);
  const config = await request(started.base).get('/api/voice/config').set('Cookie', SESSION_COOKIE).expect(503);
  expect(config.body.error?.code ?? config.body.code).toBe('NOT_READY');
  expect(JSON.stringify(config.body).includes(secret)).toBe(false);
  const ready = await request(started.base).get('/api/operations/ready').set('Cookie', SESSION_COOKIE);
  expect(ready.status).toBe(503);
  expect(ready.body.error?.code ?? ready.body.code).toBe('NOT_READY');
  expect(JSON.stringify(ready.body).includes(secret)).toBe(false);
  await request(started.base).get('/api/operations/live').expect(200);
  await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173').set('Cookie', SESSION_COOKIE)
    .send({ protocolVersion: 1, mode: 'dictation', conversationId: null, locale: 'en-US', idempotencyKey: 'request-0001' })
    .expect(503);
  expect(sockets).toEqual([]);
  const socket = new WebSocket(started.base.replace('http:', 'ws:') + '/api/voice');
  const [error] = await once(socket, 'error');
  expect(String(error)).toMatch(/403|401|1008/);
});

it('keeps live disabled without LiveKit while configured text remains ready', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime, async () => undefined, false);
  app = started.app;
  const config = await request(started.base).get('/api/voice/config').set('Cookie', SESSION_COOKIE).expect(200);
  expect(config.body.enabledModes).toEqual({ dictation: true, live: false });
  await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173').set('Cookie', SESSION_COOKIE)
    .send({ protocolVersion: 1, mode: 'live', conversationId: null,
      locale: 'en-US', idempotencyKey: 'missing-livekit-1' }).expect(503);
  expect(recorded.opened).toHaveLength(0);
  expect(started.media.connect).not.toHaveBeenCalled();
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  const ready = await request(started.base).get('/api/operations/ready').set('Cookie', SESSION_COOKIE).expect(200);
  expect(ready.body.acceptReady).toBe(true);
});

it('assembles one live bridge without provider work until reliable session.start', async () => {
  const recorded = recordingSockets();
  const runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const claim = vi.spyOn(started.service.voiceSessions, 'claimLive');
  const created = await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173').set('Cookie', SESSION_COOKIE)
    .send({ protocolVersion: 1, mode: 'live', conversationId: null,
      locale: 'en-US', idempotencyKey: 'live-assembly-1' }).expect(201);
  expect(isLiveKitVoiceSessionResponse(created.body)).toBe(true);
  expect(started.media.connect).toHaveBeenCalledTimes(1);
  expect(recorded.opened).toHaveLength(0);
  expect(claim).not.toHaveBeenCalled();
  const epoch = started.media.last();
  epoch.control({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO });
  await until(() => expect(epoch.events().some(e => e.type === 'session.ready')).toBe(true));
  expect(claim).toHaveBeenCalledTimes(1);
  expect(claim.mock.results[0].value).toBe(started.media.connect.mock.calls[0][0].context);
  expect(epoch.events().slice(0, 2).map(e => e.type)).toEqual(['session.ready', 'voice.state']);
  expect(recorded.opened.map(s => s.url.pathname).sort()).toEqual(['/v2/listen', '/v2/speak']);
  expect(app.get(VoiceSessionService)).toBe(started.service.voiceSessions);
});

it('reuses one live bridge for a duplicate create and forwards policy warnings', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const again = await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173').set('Cookie', SESSION_COOKIE)
    .send({ protocolVersion: 1, mode: 'live', conversationId: null,
      locale: 'en-US', idempotencyKey: 'live-0001' }).expect(201);
  expect(again.body.sessionId).toBe(connection.created.body.sessionId);
  expect(started.media.connect).toHaveBeenCalledTimes(1);
  started.service.voiceSessions.warn(connection.created.body.sessionId, 'VOICE_DURATION_LIMIT');
  expect(await connection.nextEvent('session.warning')).toMatchObject({
    type: 'session.warning', code: 'VOICE_DURATION_LIMIT', recoverable: true,
  });
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('keeps one LiveKit claim across a provider pause and resume', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const claim = vi.spyOn(started.service.voiceSessions, 'claimLive');
  const connection = await connectLive(started);
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  stt.emit('error', new Error('fixture stt down'));
  expect(await connection.nextEvent('session.error')).toMatchObject({
    type: 'session.error', terminal: false, recoverable: true,
  });
  expect(claim).toHaveBeenCalledTimes(1);
  connection.control({ type: 'input.unmute' });
  await until(() => expect(recorded.opened.filter(s => s.url.pathname === '/v2/listen')).toHaveLength(2));
  expect(claim).toHaveBeenCalledTimes(1);
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('isolates a LiveKit connect failure and clears degradation on a later bridge', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const release = vi.spyOn(runtime.reservations, 'release');
  started.media.connect.mockRejectedValueOnce(new Error('private sfu refusal'));
  const failed = await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173').set('Cookie', SESSION_COOKIE)
    .send({ protocolVersion: 1, mode: 'live', conversationId: null,
      locale: 'en-US', idempotencyKey: 'live-fault-1' }).expect(503);
  expect(failed.body.error.code).toBe('VOICE_CONNECT_TIMEOUT');
  expect(JSON.stringify(failed.body)).not.toContain('private sfu refusal');
  expect(recorded.opened).toHaveLength(0);
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  expect(release).toHaveBeenCalledTimes(1);
  const degraded = await request(started.base).get('/api/operations/ready').set('Cookie', SESSION_COOKIE).expect(200);
  expect(degraded.body).toMatchObject({ acceptReady: true, speech: 'degraded' });
  const connection = await connectLive(started, 'live-recovery-1');
  const recovered = await request(started.base).get('/api/operations/ready').set('Cookie', SESSION_COOKIE).expect(200);
  expect(recovered.body).toMatchObject({ acceptReady: true, speech: 'ready' });
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('forwards a transport-error observation without faulting text', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const options = started.media.connect.mock.calls[0][0];
  options.observe?.({ stage: 'transport-error', code: 'VOICE_DELIVERY_UNKNOWN' });
  const degraded = await request(started.base).get('/api/operations/ready').set('Cookie', SESSION_COOKIE).expect(200);
  expect(degraded.body).toMatchObject({ acceptReady: true, speech: 'degraded' });
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('keeps passive readiness stable across the cache window without media or provider work', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const issue = vi.spyOn(started.media.admission, 'issue');
  const observe = async () => {
    const config = await request(started.base).get('/api/voice/config').set('Cookie', SESSION_COOKIE).expect(200);
    const ready = await request(started.base).get('/api/operations/ready').set('Cookie', SESSION_COOKIE).expect(200);
    const live = await request(started.base).get('/api/operations/live').expect(200);
    return { modes: config.body.enabledModes, speech: ready.body.speech,
      acceptReady: ready.body.acceptReady, live: live.body };
  };
  const first = await observe();
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(Date.now() + 6000);
    expect(await observe()).toEqual(first);
  } finally { vi.useRealTimers(); }
  expect(first.modes).toEqual({ dictation: true, live: true });
  expect(first).toMatchObject({ speech: 'ready', acceptReady: true });
  expect(started.runtimeFactory).toHaveBeenCalledTimes(1);
  expect(started.media.connect).not.toHaveBeenCalled();
  expect(started.media.roomClient.deleteRoom).not.toHaveBeenCalled();
  expect(issue).not.toHaveBeenCalled();
  expect(recorded.opened).toHaveLength(0);
});

it('reports a configured app as unconfigured for live when only LiveKit is absent', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime, async () => undefined, false);
  app = started.app;
  const config = await request(started.base).get('/api/voice/config').set('Cookie', SESSION_COOKIE).expect(200);
  const ready = await request(started.base).get('/api/operations/ready').set('Cookie', SESSION_COOKIE).expect(200);
  expect(config.body.enabledModes).toEqual({ dictation: true, live: false });
  expect(ready.body).toMatchObject({ acceptReady: true, speech: 'unconfigured' });
  expect(ready.body.issues).toEqual([]);
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(Date.now() + 6000);
    const after = await request(started.base).get('/api/operations/ready').set('Cookie', SESSION_COOKIE).expect(200);
    expect(after.body).toMatchObject({ acceptReady: true, speech: 'unconfigured' });
  } finally { vi.useRealTimers(); }
  expect(started.runtimeFactory).toHaveBeenCalledTimes(1);
  expect(started.media.connect).not.toHaveBeenCalled();
  expect(recorded.opened).toHaveLength(0);
});

it('reports unconfigured speech without a socket or a text restart', async () => {
  const started = await boot(storedDocument({
    dictation: true, live: false, openrouter: null, deepgram: null,
  }));
  app = started.app;
  const ready = await request(started.base).get('/api/operations/ready').set('Cookie', SESSION_COOKIE);
  expect(ready.body.speech).toBe('unconfigured');
  expect(ready.body.acceptReady).toBe(false);
  expect(JSON.stringify(ready.body).includes('DEEPGRAM_API_KEY is missing')).toBe(false);
  await request(started.base).get('/api/operations/live').expect(200);
  expect(sockets).toEqual([]);
});

it('dictation partials travel through the assembled Nova adapter and do not submit a turn', async () => {
  const recorded = recordingSockets();
  const runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime);
  app = started.app;
  const connection = await connect(started.base, 'dictation');
  const nova = recorded.opened.find((socket) => socket.url.pathname === '/v1/listen');
  if (!nova) throw new Error('Nova socket was not opened');
  expect(nova.headers.Authorization).toBe(`Token ${secret}`);
  expect(nova.url.searchParams.get('tag')).toMatch(/^aurvin-user-[a-f0-9]{64}$/);
  expect(started.accounting[0]).toMatchObject({ status: 'pending',
    userId: started.config.identity.userId, conversationId: null, voiceSessionId: connection.created.body.sessionId,
    userTag: nova.url.searchParams.get('tag') });
  expect(recorded.opened.some((socket) => socket.url.pathname === '/v2/listen')).toBe(false);
  nova.serverText({ type: 'Results', channel_index: [0, 1], duration: 0.4, start: 0,
    is_final: false, speech_final: false, channel: { alternatives: [{ transcript: 'hello aurvin' }] } });
  const partial = JSON.parse((await connection.next()).data.toString());
  expect(partial.type).toBe('dictation.partial');
  expect(partial.text).toBe('hello aurvin');
  expect(runtime.calls.submit).toBe(0);
  expect(runtime.calls.execute).toBe(0);
  connection.socket.close();
  await started.service.voiceSessions.drain();
  expect(started.accounting.at(-1)).toMatchObject({ status: 'cancelled', actualCostUsd: null });
});

it('a finalized live turn submits once on the injected runtime and does not execute inference', async () => {
  const recorded = recordingSockets();
  const runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime);
  app = started.app;
  const connection = await connectLive(started);
  const stt = recorded.opened.find((socket) => socket.url.pathname === '/v2/listen');
  const tts = recorded.opened.find((socket) => socket.url.pathname === '/v2/speak');
  if (!stt || !tts) throw new Error('Flux sockets were not both opened');
  expect(stt.url.searchParams.get('tag')).toBe(tts.url.searchParams.get('tag'));
  expect(started.accounting.filter(r => r.status === 'pending')).toHaveLength(2);
  stt.serverText({ type: 'TurnInfo', request_id: 'req-fixture', sequence_id: 1, turn_index: 0,
    event: 'EndOfTurn', transcript: 'hello aurvin', audio_window_end: 0.8 });
  await until(() => { expect(runtime.calls.submit).toBe(1); });
  expect(runtime.calls.execute).toBe(0);
  expect(started.service.voiceSessions).toBe(app.get(VoiceSessionService));
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('a speech socket error degrades speech and does not block text liveness', async () => {
  const recorded = recordingSockets();
  const started = await bootEnabled(recorded.factory, runtimeStub());
  app = started.app;
  await connect(started.base, 'dictation');
  const nova = recorded.opened.find((socket) => socket.url.pathname === '/v1/listen');
  if (!nova) throw new Error('Nova socket was not opened');
  nova.emit('error', new Error('fixture speech down'));
  const ready = await request(started.base).get('/api/operations/ready').set('Cookie', SESSION_COOKIE);
  expect(ready.body.speech).toBe('degraded');
  expect(ready.body.provider).not.toBe('blocked');
  await request(started.base).get('/api/operations/live').expect(200);
  expect(JSON.stringify(ready.body).includes(secret)).toBe(false);
});

it('does not report safe shutdown or close persistence after a terminal accounting write fails', async () => {
  const recorded = recordingSockets();
  const started = await bootEnabled(recorded.factory, runtimeStub(), async record => {
    if (record.status !== 'pending') throw new Error('accounting fixture failure');
  });
  app = started.app;
  const connection = await connect(started.base, 'dictation');
  const close = vi.spyOn(started.service.operations.o, 'closePersistence');
  await expect(started.service.voiceSessions.end(connection.created.body.sessionId)).rejects.toThrow();
  expect(await started.service.operations.shutdown()).toEqual({ safe: false });
  expect(close).not.toHaveBeenCalled();
  expect(started.accounting.map(r => r.status)).toEqual(['pending']);
  connection.socket.close();
});

it('assembles acknowledged quiet/resume on one live call without empty turns or provider recreation', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const activity = vi.spyOn(started.service.voiceUsage, 'noteActivity');
  const connection = await connectLive(started);
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  const binary = () => stt.sent.filter(v => v instanceof Uint8Array);
  connection.control({ type: 'input.unmute' });
  expect(await connection.nextEvent('voice.state')).toMatchObject({
    type: 'voice.state', input: 'listening', connection: 'connected',
  });
  const send = () => connection.rtc.pushFrame(new Int16Array(1280).fill(1000));
  send(); await until(() => { expect(binary()).toHaveLength(1); });
  connection.control({ type: 'input.suspend' });
  expect(await connection.nextEvent('voice.state', { input: 'suspended' })).toMatchObject({ type: 'voice.state', input: 'suspended' });
  await until(() => { expect(stt.sent).toContain(JSON.stringify({ type: 'ForceEndTurn' })); });
  send(); await settle();
  expect(binary()).toHaveLength(1);
  connection.control({ type: 'input.unmute' });
  stt.serverText({ type: 'Warning', code: 'FORCE_END_TURN_NO_ACTIVE_TURN' });
  expect(await connection.nextEvent('voice.state', { input: 'listening' })).toMatchObject({ type: 'voice.state', input: 'listening' });
  expect(binary()).toHaveLength(1);
  send(); await until(() => { expect(binary()).toHaveLength(2); });
  expect(recorded.opened).toHaveLength(2);
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  expect(activity).toHaveBeenCalledWith(connection.created.body.sessionId, false);
  expect(started.service.voiceUsage.snapshot()).toMatchObject({ sessions: 1, active: 1,
    estimatedSpendUsd: null, spendStatus: 'unknown' });
  expect(connection.events().some(e => e.type === 'session.ended')).toBe(false);
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('assembled durable completion requires synthesis and browser progress', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub(true);
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  const tts = recorded.opened.find(s => s.url.pathname === '/v2/speak')!;
  const input = turn('EndOfTurn', 1, 'hello aurvin');
  stt.serverText(input); stt.serverText(input);
  await until(() => expect(tts.sent).toContain(JSON.stringify({ type: 'Flush' })));
  tts.serverText({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  tts.serverBinary(new Uint8Array(4800));
  const start = await connection.nextEvent('audio.start');
  if (!('turnId' in start) || !('responseId' in start)) throw new Error('Missing response reference');
  const ref = { turnId: start.turnId, responseId: start.responseId };
  tts.serverText({ type: 'SpeechMetadata', ...metadata() });
  const final = await connection.nextEvent('audio.watermark', { final: true });
  if (final.type !== 'audio.watermark') throw new Error('Missing final watermark');
  expect(runtime.calls).toEqual({ submit: 1, execute: 1 });
  expect(runtime.records.get('attempt-1')?.status).toBe('pending');
  expect(final.queuedSamples).toBe(2400);
  expect(connection.events().some(e => e.type === 'audio.end')).toBe(false);
  connection.control({ type: 'playback.progress', ...ref,
    playedSamples: final.lastAudioSample, playedMs: Math.floor(final.lastAudioSample / 24),
    proof: 'proven' });
  await until(() => expect(runtime.records.get('attempt-1')?.status).toBe('completed'));
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('assembled durable completion waits for the terminal write', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub(true);
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  const tts = recorded.opened.find(s => s.url.pathname === '/v2/speak')!;
  const gate = deferred<void>();
  runtime.completedWriteGate = gate.promise;
  stt.serverText(turn('EndOfTurn', 1, 'hello aurvin'));
  await until(() => expect(tts.sent).toContain(JSON.stringify({ type: 'Flush' })));
  tts.serverText({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  tts.serverBinary(new Uint8Array(4800));
  const start = await connection.nextEvent('audio.start');
  if (!('turnId' in start) || !('responseId' in start)) throw new Error('Missing response reference');
  const ref = { turnId: start.turnId, responseId: start.responseId };
  tts.serverText({ type: 'SpeechMetadata', ...metadata() });
  const final = await connection.nextEvent('audio.watermark', { final: true });
  if (final.type !== 'audio.watermark') throw new Error('Missing final watermark');
  connection.control({ type: 'playback.progress', ...ref,
    playedSamples: final.lastAudioSample, playedMs: Math.floor(final.lastAudioSample / 24),
    proof: 'proven' });
  await settle();
  expect(runtime.records.get('attempt-1')?.status).toBe('pending');
  expect(runtime.turnStatus).not.toBe('completed');
  gate.resolve();
  await until(() => expect(runtime.records.get('attempt-1')?.status).toBe('completed'));
  expect(runtime.turnStatus).toBe('completed');
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('assembled unproven progress never completes at the generated ceiling', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub(true);
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  const tts = recorded.opened.find(s => s.url.pathname === '/v2/speak')!;
  stt.serverText(turn('EndOfTurn', 1, 'hello aurvin'));
  await until(() => expect(tts.sent).toContain(JSON.stringify({ type: 'Flush' })));
  tts.serverText({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  tts.serverBinary(new Uint8Array(4800));
  const start = await connection.nextEvent('audio.start');
  if (!('turnId' in start) || !('responseId' in start)) throw new Error('Missing response reference');
  const ref = { turnId: start.turnId, responseId: start.responseId };
  tts.serverText({ type: 'SpeechMetadata', ...metadata() });
  const final = await connection.nextEvent('audio.watermark', { final: true });
  if (final.type !== 'audio.watermark') throw new Error('Missing final watermark');
  connection.control({ type: 'playback.progress', ...ref,
    playedSamples: final.lastAudioSample, playedMs: Math.floor(final.lastAudioSample / 24),
    proof: 'unproven' });
  await new Promise(resolve => setTimeout(resolve, 2200));
  expect(runtime.records.get('attempt-1')?.status).not.toBe('completed');
  expect(connection.events().some(e => e.type === 'audio.end')).toBe(false);
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('assembled interruption retains a proven prefix', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub(true);
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  const tts = recorded.opened.find(s => s.url.pathname === '/v2/speak')!;
  stt.serverText(turn('EndOfTurn', 1, 'hello aurvin'));
  await until(() => expect(tts.sent).toContain(JSON.stringify({ type: 'Flush' })));
  tts.serverText({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  tts.serverBinary(new Uint8Array(4800));
  const start = await connection.nextEvent('audio.start');
  if (!('turnId' in start) || !('responseId' in start)) throw new Error('Missing response reference');
  const ref = { turnId: start.turnId, responseId: start.responseId };
  await connection.nextEvent('audio.watermark', { final: false });
  connection.control({ type: 'playback.progress', ...ref,
    playedSamples: 1200, playedMs: 50, proof: 'proven' });
  const order: string[] = [];
  connection.rtc.sources[0].clearQueue.mockImplementation(() => { order.push('clear'); });
  runtime.cancelLiveTurn.mockImplementationOnce(async () => {
    order.push('cancel');
    expect(order[0]).toBe('clear');
  });
  connection.control({ type: 'response.interrupt', ...ref,
    playedSamples: 1200, playbackPositionMs: 50, proof: 'proven' });
  await until(() => expect(runtime.cancelLiveTurn).toHaveBeenCalledTimes(1));
  tts.serverText({ type: 'SpeechInterrupted', metadata: metadata(), audio_played_ms: 50,
    text_spoken: 'Hello', text_remaining: ' world.' });
  await until(() => expect(runtime.records.get('attempt-1')?.status).toBe('interrupted'));
  expect(runtime.records.get('attempt-1')).toMatchObject({
    status: 'interrupted', textSpoken: 'Hello', textRemaining: ' world.', playedSamples: 1200,
  });
  expect(connection.events()).toContainEqual(expect.objectContaining({
    type: 'response.cancelled', ...ref,
  }));
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('assembled cancellation before audio is not heard speech', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub(true);
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const gate = deferred<void>();
  runtime.startGate = gate.promise;
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  stt.serverText(turn('EndOfTurn', 1, 'hello aurvin'));
  const bound = await connection.nextEvent('conversation.bound');
  if (bound.type !== 'conversation.bound') throw new Error('Missing conversation binding');
  expect(runtime.calls).toEqual({ submit: 1, execute: 1 });
  const responseId = key('voice-response', started.config.identity.userId,
    bound.conversationId, 'attempt-1');
  connection.control({ type: 'response.interrupt', turnId: 'turn-1', responseId,
    playedSamples: 0, playbackPositionMs: 0 });
  await until(() => expect(runtime.cancelLiveTurn).toHaveBeenCalledTimes(1));
  gate.resolve();
  await until(() => expect(runtime.records.get('attempt-1')?.status).toBe('cancelled'));
  expect(connection.events().some(e => e.type === 'audio.start')).toBe(false);
  expect(runtime.records.get('attempt-1')).toMatchObject({
    playedSamples: 0, audioDurationMs: 0, audioPlayedMs: 0,
  });
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('assembled failure retains terminal evidence without a completed session', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub(true);
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  runtime.failLive = new Error('fixture model failure');
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  stt.serverText(turn('EndOfTurn', 1, 'hello aurvin'));
  await until(() => expect(runtime.calls.execute).toBe(1));
  await until(() => expect(runtime.turnStatus).toBe('failed'));
  expect(runtime.records.get('attempt-1')?.status).toBe('failed');
  expect(connection.events().some(e => e.type === 'session.ended' && e.reason === 'completed')).toBe(false);
  expect(runtime.calls).toEqual({ submit: 1, execute: 1 });
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('assembled reconnect retains one reservation and opens a fresh epoch', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub(true);
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const acquire = vi.spyOn(runtime.reservations, 'acquire');
  const release = vi.spyOn(runtime.reservations, 'release');
  const connection = await connectLive(started);
  expect(acquire).toHaveBeenCalledTimes(1);
  const oldRoom = connection.rtc.rooms[0];
  const openedBefore = recorded.opened.length;
  oldRoom.emit('reconnecting');
  await until(() => expect(oldRoom.disconnect).toHaveBeenCalled());
  const next = await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173').set('Cookie', SESSION_COOKIE)
    .send({ protocolVersion: 1, mode: 'live', conversationId: null,
      locale: 'en-US', idempotencyKey: 'live-0001' }).expect(201);
  expect(next.body.sessionId).toBe(connection.created.body.sessionId);
  expect(next.body.connectionEpoch).toBe(1);
  expect(started.media.connect).toHaveBeenCalledTimes(2);
  const epoch = started.media.last();
  epoch.control({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO });
  await until(() => expect(epoch.events().some(e => e.type === 'session.ready')).toBe(true));
  expect(recorded.opened).toHaveLength(openedBefore + 2);
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(release).not.toHaveBeenCalled();
  expect(started.service.voiceSessions.snapshot().active).toBe(1);
  oldRoom.emit('disconnected');
  await settle();
  expect(started.service.voiceSessions.snapshot().active).toBe(1);
  expect(epoch.events().some(e => e.type === 'session.ended')).toBe(false);
  await started.service.voiceSessions.end(next.body.sessionId);
});

it('assembled LiveKit fault leaves text and dictation usable', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  started.media.connect.mockRejectedValueOnce(new Error('private join refusal'));
  await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173').set('Cookie', SESSION_COOKIE)
    .send({ protocolVersion: 1, mode: 'live', conversationId: null,
      locale: 'en-US', idempotencyKey: 'live-fault-2' }).expect(503);
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  const dictation = await connect(started.base, 'dictation');
  const nova = recorded.opened.find(s => s.url.pathname === '/v1/listen')!;
  nova.serverText({ type: 'Results', channel_index: [0, 1], duration: 0.4, start: 0,
    is_final: false, speech_final: false, channel: { alternatives: [{ transcript: 'still here' }] } });
  const partial = JSON.parse((await dictation.next()).data.toString());
  expect(partial).toMatchObject({ type: 'dictation.partial', text: 'still here' });
  dictation.socket.close();
  const accepted = await request(started.base).post('/api/sessions')
    .set('Origin', 'http://127.0.0.1:5173').set('Cookie', SESSION_COOKIE)
    .send({ sessionId: null, content: 'Hello', idempotencyKey: 'text-after-livekit-fault' }).expect(202);
  const stream = await request(started.base).get(`/api${accepted.body.streamPath}`)
    .set('Cookie', SESSION_COOKIE).expect(200);
  expect(stream.headers['content-type']).toContain('text/event-stream');
  expect(stream.text).toContain('"type":"completed"');
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  expect(app.get(VoiceSessionService)).toBe(started.service.voiceSessions);
});

it('assembled shutdown stops admission and closes persistence after one drain', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  await connectLive(started);
  const release = vi.spyOn(runtime.reservations, 'release');
  const close = vi.spyOn(started.service.operations.o, 'closePersistence');
  const closing = started.service.operations.shutdown();
  expect(started.service.voiceSessions.snapshot().accepting).toBe(false);
  await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173').set('Cookie', SESSION_COOKIE)
    .send({ protocolVersion: 1, mode: 'live', conversationId: null,
      locale: 'en-US', idempotencyKey: 'live-after-shutdown' }).expect(503);
  expect(await closing).toEqual({ safe: true });
  expect(started.media.roomClient.deleteRoom).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(recorded.opened.every(socket => socket.readyState === 3)).toBe(true);
});

it('assembled shutdown forwards one terminal shutdown event', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const closing = started.service.operations.shutdown();
  await until(() => expect(connection.events().filter(e =>
    e.type === 'session.ended' && e.reason === 'shutdown' && e.terminal)).toHaveLength(1));
  expect(await closing).toEqual({ safe: true });
});

it('assembled uncertain LiveKit cleanup latches an unsafe shutdown', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const close = vi.spyOn(started.service.operations.o, 'closePersistence');
  vi.spyOn(connection.bridge, 'dispose').mockRejectedValue(new Error('private dispose failure'));
  const closing = started.service.operations.shutdown();
  expect(started.service.operations.shutdown()).toBe(closing);
  expect(await closing).toEqual({ safe: false });
  expect(close).not.toHaveBeenCalled();
  expect(await started.service.operations.shutdown()).toEqual({ safe: false });
  expect(close).not.toHaveBeenCalled();
});

it('assembled quiet input does not accept empty turns', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  const binary = () => stt.sent.filter(v => v instanceof Uint8Array).length;
  for (let i = 0; i < 63; i++) {
    connection.rtc.pushFrame(new Int16Array(1280));
    await settle();
  }
  expect(await connection.nextEvent('voice.state', { input: 'suspended' }))
    .toMatchObject({ type: 'voice.state', input: 'suspended' });
  stt.serverText({ type: 'Warning', code: 'FORCE_END_TURN_NO_ACTIVE_TURN' });
  await settle();
  const paused = binary();
  expect(paused).toBeGreaterThan(0);
  for (let i = 0; i < 5; i++) connection.rtc.pushFrame(new Int16Array(1280));
  await settle();
  expect(binary()).toBe(paused);
  connection.rtc.pushFrame(new Int16Array(1280).fill(1000));
  expect(await connection.nextEvent('voice.state', { input: 'listening' }))
    .toMatchObject({ type: 'voice.state', input: 'listening' });
  await until(() => expect(binary()).toBeGreaterThan(paused));
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it('assembled disconnect remains unknown, never completed', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub(true);
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  const tts = recorded.opened.find(s => s.url.pathname === '/v2/speak')!;
  stt.serverText(turn('EndOfTurn', 1, 'hello aurvin'));
  await until(() => expect(tts.sent).toContain(JSON.stringify({ type: 'Flush' })));
  tts.serverText({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  tts.serverBinary(new Uint8Array(4800));
  await connection.nextEvent('audio.start');
  tts.serverText({ type: 'SpeechMetadata', ...metadata() });
  await connection.nextEvent('audio.watermark', { final: true });
  expect(runtime.records.get('attempt-1')?.status).toBe('pending');
  connection.rtc.rooms[0].emit('disconnected');
  await until(() => expect(runtime.records.get('attempt-1')?.status).not.toBe('pending'), 5000);
  expect(runtime.records.get('attempt-1')?.status).not.toBe('completed');
  expect(runtime.records.get('attempt-1')?.textSpoken).toBeNull();
  expect(connection.events().some(e => e.type === 'audio.end')).toBe(false);
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});

it.each(['duration', 'quota'] as const)('retains the control channel but blocks paid work after %s', async reason => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  await started.service.voiceSessions.stop(connection.created.body.sessionId, reason);
  expect(await connection.nextEvent('session.error')).toMatchObject({ type: 'session.error', terminal: false,
    recoverable: false, code: reason === 'quota' ? 'VOICE_QUOTA_EXHAUSTED' : 'VOICE_DURATION_LIMIT' });
  expect(await connection.nextEvent('session.ended')).toMatchObject({ type: 'session.ended', reason, terminal: false });
  expect(connection.events().some(e => e.type === 'session.ended' && e.terminal)).toBe(false);
  const count = recorded.opened.length;
  connection.control({ type: 'input.unmute' });
  connection.control({ type: 'session.end' });
  expect(await connection.nextEvent('session.ended')).toMatchObject({ type: 'session.ended', reason: 'completed', terminal: true });
  expect(recorded.opened).toHaveLength(count);
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  await started.service.voiceSessions.end(connection.created.body.sessionId);
});
