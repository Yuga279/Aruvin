/**
 * ============================================================================
 * FILE: gateway.integration.spec.ts
 * LOCATION: backend/test/voice/transport/gateway.integration.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integration tests for the dictation-only NestJS WebSocket voice gateway.
 *
 * ROLE IN PROJECT:
 *    End-to-end tests verifying HTTP session creation, ticket authentication,
 *    dictation WebSocket streaming, live-ticket rejection, and lifecycle cleanup.
 *
 * KEY COMPONENTS:
 *    - Real Nest app with WsAdapter on `/api/voice`.
 *    - Supertest REST and native WebSocket client round-trips.
 * ============================================================================
 */

import 'reflect-metadata';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import type { INestApplication } from '@nestjs/common';
import WebSocket from 'ws';
import supertest from 'supertest';
import { INPUT_AUDIO, type VoiceClientPayload } from '../../../src/contracts/voice-wire.js';
import { encodeVoiceAudio } from '../../../src/contracts/voice-audio.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { VoiceSessionController } from '../../../src/voice/session/voice-session.controller.js';
import { VOICE_SESSION_OPTIONS, type LiveHooks } from '../../../src/voice/session/voice-session.options.js';
import { DictationFlow } from '../../../src/voice/session/dictation-flow.js';
import { VoiceGateway } from '../../../src/voice/transport/voice.gateway.js';
import { options, origin, request, fakeStt, EventQueue, owner } from '../session/fixtures.js';
import { RequestIdentityStore } from '../../../src/platform/identity/request-identity-store.js';
import { AuthenticatedWsAdapter, VoiceUpgradeAdmission } from '../../../src/voice/transport/authenticated-ws-adapter.js';

let app: INestApplication, sessions: VoiceSessionService;
let base: string, o: ReturnType<typeof options>;
let stt: ReturnType<typeof fakeStt>;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  o = options();
  stt = fakeStt();
  o.open = async (context, sink, signal) => DictationFlow.open(context, sink, signal, stt.port, o.usage);
  const identities = new RequestIdentityStore();
  const admission = new VoiceUpgradeAdmission(
    { authenticate: async () => ({ principal: owner }) },
    { frontendOrigin: origin, secureCookie: false, developmentLoopback: true,
      trustedHttpsIngress: () => false },
  );
  const module = await Test.createTestingModule({
    controllers: [VoiceSessionController],
    providers: [
      { provide: VOICE_SESSION_OPTIONS, useValue: o },
      VoiceSessionService,
      { provide: RequestIdentityStore, useValue: identities },
      { provide: VoiceUpgradeAdmission, useValue: admission },
      VoiceGateway
    ]
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api');
  app.use((req: { }, _res: unknown, next: () => void) => identities.run(owner, () => next()));
  app.useWebSocketAdapter(new AuthenticatedWsAdapter(app, admission));
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  sessions = app.get(VoiceSessionService);
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await sessions.drain();
  await app.close();
});

async function connect() {
  const created = await supertest(base).post('/api/voice/sessions').set('Origin', origin).send(request).expect(201);
  const cookie = String(created.headers['set-cookie'][0]).split(';')[0];
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', { headers: { Origin: origin, Cookie: cookie } });
  sockets.push(socket);
  const messages = new EventQueue<{ data: Buffer; binary: boolean }>();
  socket.on('message', (data, binary) => messages.push({ data: Buffer.from(data as Buffer), binary }));
  await once(socket, 'open');
  let sequence = 0;
  const control = (payload: VoiceClientPayload) => socket.send(JSON.stringify({
    protocolVersion: 1,
    sessionId: created.body.sessionId,
    connectionEpoch: created.body.connectionEpoch,
    eventId: `client-${sequence}`,
    sequence: sequence++,
    ...payload
  }));
  control({ type: 'session.start', mode: 'dictation', audioSettings: INPUT_AUDIO });
  const reader = messages[Symbol.asyncIterator]();
  const next = async () => (await reader.next()).value!;
  expect(JSON.parse((await next()).data.toString()).type).toBe('session.ready');
  return { socket, next, control, created, cookie };
}

it('serves exact REST routes and rejects unknown DTO/query keys without allocation', async () => {
  const config = await supertest(base).get('/api/voice/config').expect(200);
  expect(config.body.enabledModes).toEqual({ dictation: true, live: true });
  expect(JSON.stringify(config.body)).not.toContain('fixture-secret');
  await supertest(base).get('/api/voice/config?userId=attacker').expect(400);
  await supertest(base).post('/api/voice/sessions').set('Origin', origin)
    .send({ ...request, userId: 'attacker' }).expect(400);
  await supertest(base).post('/api/voice/sessions').set('Origin', 'https://evil.example').send(request).expect(403);
  o.config.enabledModes.dictation = false;
  await supertest(base).post('/api/voice/sessions').set('Origin', origin).send(request).expect(503);
  expect(stt.port.connect).not.toHaveBeenCalled();
  expect(o.admission).not.toHaveBeenCalled();
});

it('dictation round-trips PCM, finalization and idempotent DELETE without inference', async () => {
  const f = await connect();
  f.socket.send(encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(2560) }));
  stt.events.push({ type: 'partial', segmentId: 's1', text: 'private dictation' });
  expect(JSON.parse((await f.next()).data.toString()).type).toBe('dictation.partial');
  f.control({ type: 'dictation.stop' });
  // Wait on the provider operation instead of using a wall-clock sleep.
  await vi.waitFor(() => expect(stt.connection.finalize).toHaveBeenCalledTimes(1));
  stt.events.push({ type: 'final', segmentId: 's1', text: 'Private dictation.' });
  stt.events.push({ type: 'finalized', unfinalizedTail: false });
  expect(JSON.parse((await f.next()).data.toString()).type).toBe('dictation.final');
  expect(JSON.parse((await f.next()).data.toString()).type).toBe('dictation.complete');
  expect(JSON.parse((await f.next()).data.toString()).type).toBe('session.ended');
  await supertest(base).delete(`/api/voice/sessions/${f.created.body.sessionId}`).set('Origin', origin).expect(204);
  await supertest(base).delete(`/api/voice/sessions/${f.created.body.sessionId}`).set('Origin', origin).expect(204);
  expect(stt.connection.close).toHaveBeenCalledTimes(1);
});

it('invalid Origin and replayed ticket close before a speech connection is allocated', async () => {
  const created = await supertest(base).post('/api/voice/sessions').set('Origin', origin).send(request).expect(201);
  const cookie = String(created.headers['set-cookie'][0]).split(';')[0];
  const bad = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', { headers: { Origin: 'https://evil.example', Cookie: cookie } });
  sockets.push(bad);
  const status = await new Promise<number>((resolve, reject) => {
    bad.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode!); });
    bad.once('open', () => reject(new Error('Evil origin upgrade succeeded')));
    bad.once('error', () => {});
  });
  expect(status).toBe(403);
  expect(stt.port.connect).not.toHaveBeenCalled();
  const valid = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', { headers: { Origin: origin, Cookie: cookie } });
  sockets.push(valid);
  await once(valid, 'open');
  const replay = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', { headers: { Origin: origin, Cookie: cookie } });
  sockets.push(replay);
  const [replayCode] = await once(replay, 'close');
  expect(replayCode).toBe(1008);
  expect(stt.port.connect).not.toHaveBeenCalled();
});

it('rejects a live WebSocket ticket without consuming LiveKit admission', async () => {
  const created = await supertest(base).post('/api/voice/sessions').set('Origin', origin)
    .send({ ...request, mode: 'live' }).expect(201);
  const cookie = String(created.headers['set-cookie'][0]).split(';')[0];
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', {
    headers: { Origin: origin, Cookie: cookie },
  });
  sockets.push(socket);
  const closed = once(socket, 'close', { signal: AbortSignal.timeout(2000) });
  const [code] = await closed;

  expect(code).toBe(1008);
  expect(stt.port.connect).not.toHaveBeenCalled();
  expect(sessions.claimLive(created.body.sessionId, created.body.livekit.participantIdentity,
    created.body.livekit.roomName).state).toBe('active');
});
