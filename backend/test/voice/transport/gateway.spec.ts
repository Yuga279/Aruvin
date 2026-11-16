/**
 * ============================================================================
 * FILE: gateway.spec.ts
 * LOCATION: backend/test/voice/transport/gateway.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for VoiceGateway and VoiceConnection handshake, framing, and errors.
 *
 * ROLE IN PROJECT:
 *    Verifies native WebSocket message handling, handshake gating, ticket binding,
 *    binary PCM audio framing, and sequence enforcement.
 *
 * KEY COMPONENTS:
 *    - Handshake and session start tests.
 *    - Binary PCM audio frame validation tests.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { INPUT_AUDIO, parseVoiceControl } from '../../../src/contracts/voice-wire.js';
import { encodeVoiceAudio } from '../../../src/contracts/voice-audio.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { VoiceConnection } from '../../../src/voice/transport/voice-connection.js';
import { VoiceGateway } from '../../../src/voice/transport/voice.gateway.js';
import { VoiceSessionError, voiceError } from '../../../src/voice/session/voice-session.options.js';
import { options, origin, request, revisionFixture, owner } from '../session/fixtures.js';
import type { VoiceUpgradeAdmission } from '../../../src/voice/transport/authenticated-ws-adapter.js';
import { FakeSocket, settle } from './fixtures.js';

const services: VoiceSessionService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.drain())); });

async function fixture(mode: 'dictation' | 'live' = 'dictation') {
  const o = options(), s = new VoiceSessionService(o); services.push(s);
  const result = await s.create({ ...request, mode }, origin, owner);
  const admission = { takePrincipal: () => owner } as unknown as VoiceUpgradeAdmission;
  const socket = new FakeSocket(), gateway = new VoiceGateway(s, admission);
  if (mode === 'dictation') {
    gateway.handleConnection(socket, { url: '/api/voice', headers: {
      origin, cookie: result.cookie.split(';')[0] } } as IncomingMessage);
  } else {
    // Legacy internal sink fixture: live WebSocket mechanics are unit-tested
    // without treating the public gateway as an admitted live transport.
    const connection = new VoiceConnection(s, s.claim(result.cookie.split(';')[0], origin, owner), socket);
    socket.on('message', (data, binary) => connection.receive(data as Uint8Array, binary));
    socket.on('close', () => { void connection.lost().catch(() => undefined); });
    socket.on('error', () => { void connection.lost().catch(() => undefined); });
  }
  const event = (type: 'session.start' | 'dictation.stop', sequence = 0) => ({
    protocolVersion: 1, sessionId: result.response.sessionId,
    connectionEpoch: result.response.connectionEpoch, eventId: `event-${sequence}`, sequence,
    ...(type === 'session.start' ? { type, mode, audioSettings: INPUT_AUDIO } : { type }) });
  return { o, s, result, socket, gateway, event };
}

it('legacy internal sink fixture: invalidate emits schema-valid response.cancelled with extra response fields', async () => {
  const f = await fixture('live');
  f.socket.text(f.event('session.start'));
  await settle();
  const sink = vi.mocked(f.o.open).mock.calls[0][1];
  sink.event({
    type: 'audio.start', turnId: 'turn-1', responseId: 'response-1',
    sampleRate: 24000, firstAudioSequence: 0
  });
  expect(() => sink.invalidate({
    turnId: 'turn-1', responseId: 'response-1', invalid: true, started: true,
    sent: 2400, base: 0, wireBase: 0, completed: false
  } as { turnId: string; responseId: string })).not.toThrow();
  const cancelled = f.socket.events().find(e => e.type === 'response.cancelled');
  expect(cancelled).toMatchObject({
    type: 'response.cancelled', turnId: 'turn-1', responseId: 'response-1', lastAudioSequence: null
  });
  expect(cancelled).not.toHaveProperty('invalid');
  expect(cancelled).not.toHaveProperty('started');
  expect(cancelled).not.toHaveProperty('sent');
  expect(cancelled).not.toHaveProperty('wireBase');
  expect(() => parseVoiceControl(JSON.stringify(cancelled), 'server', 'live')).not.toThrow();
});

it('uses native JSON start, binds the ticket, emits ready before accepting PCM', async () => {
  const f = await fixture(); f.socket.text(f.event('session.start')); await settle();
  expect(f.socket.events().map(e => e.type)).toEqual(['session.ready']);
  expect(f.o.open).toHaveBeenCalledTimes(1);
  f.socket.binary(encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(2560) }));
  await settle();
  const opened = await vi.mocked(f.o.open).mock.results[0].value;
  expect(opened.input).toHaveBeenCalledWith(new Uint8Array(2560));
});

it('rejects a live session.start on the public dictation WebSocket binding', async () => {
  const f = await fixture();
  f.socket.text({ ...f.event('session.start'), mode: 'live' });
  await settle();

  expect(f.o.open).not.toHaveBeenCalled();
  expect(f.socket.events()).toContainEqual(expect.objectContaining({
    type: 'session.error', code: 'INVALID_VOICE_CONTROL',
  }));
});

it('rejects live WebSocket admission without consuming its LiveKit claim', async () => {
  const o = options(), s = new VoiceSessionService(o); services.push(s);
  const result = await s.create({ ...request, mode: 'live' }, origin, owner);
  const cookie = result.cookie.split(';')[0];
  expect(() => s.claim(cookie, origin, owner, 'dictation')).toThrow('VOICE_BINDING_MISMATCH');

  const socket = new FakeSocket();
  const admission = { takePrincipal: () => owner } as unknown as VoiceUpgradeAdmission;
  new VoiceGateway(s, admission).handleConnection(socket, { url: '/api/voice', headers: {
    origin, cookie,
  } } as IncomingMessage);

  expect(socket.close).toHaveBeenCalledTimes(1);
  expect(socket.close).toHaveBeenCalledWith(1008);
  expect(o.open).not.toHaveBeenCalled();
  expect(o.reservations.release).not.toHaveBeenCalled();
  expect(s.claimLive(result.response.sessionId, result.response.livekit!.participantIdentity,
    result.response.livekit!.roomName).state).toBe('active');
});

it.each(['bad-epoch', 'bad-binding', 'bad-kind', 'bad-length', 'gap', 'before-start'])
  ('rejects %s without forwarding invalid audio', async kind => {
    const f = await fixture();
    if (kind !== 'before-start') {
      const start = f.event('session.start');
      if (kind === 'bad-epoch') start.connectionEpoch++;
      if (kind === 'bad-binding') start.sessionId = 'foreign';
      f.socket.text(start); await settle();
    }
    if (!['bad-epoch', 'bad-binding'].includes(kind)) {
      const bytes = encodeVoiceAudio({ kind: kind === 'bad-kind' ? 2 : 1, flags: 0,
        sequence: kind === 'gap' ? 1 : 0, offsetMs: 0, pcm: new Uint8Array(2560) });
      if (kind === 'bad-length') bytes[12] = 1;
      f.socket.binary(bytes); await settle();
    }
    expect(f.socket.close).toHaveBeenCalled();
  });

it('legacy internal sink fixture: disposes once and reconnects with a fresh epoch, never the old cookie', async () => {
  const f = await fixture('live'); f.socket.text(f.event('session.start')); await settle();
  const flow = await vi.mocked(f.o.open).mock.results[0].value;
  f.socket.emit('close'); await settle();
  expect(flow.close).toHaveBeenCalledTimes(1);
  const next = await f.s.create({ ...request, mode: 'live' }, origin, owner);
  expect(next.response.sessionId).toBe(f.result.response.sessionId);
  expect(next.response.connectionEpoch).toBe(1);
  expect(() => f.s.claim(f.result.cookie.split(';')[0], origin, owner)).toThrow('VOICE_BINDING_MISMATCH');
  expect(f.o.disconnected).toHaveBeenCalledTimes(1);
  expect(f.o.reservations.acquire).toHaveBeenCalledTimes(1);
});

it('rejects bad Origin and cookie replay before opening a provider', async () => {
  const f = await fixture(); const replay = new FakeSocket();
  f.gateway.handleConnection(replay, { url: '/api/voice', headers: {
    origin: 'https://evil.example', cookie: f.result.cookie.split(';')[0] } } as IncomingMessage);
  expect(replay.close).toHaveBeenCalledWith(1008);
  const twice = new FakeSocket();
  f.gateway.handleConnection(twice, { url: '/api/voice', headers: {
    origin, cookie: f.result.cookie.split(';')[0] } } as IncomingMessage);
  expect(twice.close).toHaveBeenCalledWith(1008); expect(f.o.open).not.toHaveBeenCalled();
});

it('legacy internal sink fixture: recovers a socket error with a fresh epoch instead of ending its reservation', async () => {
  const f = await fixture('live');
  f.socket.text(f.event('session.start')); await settle();
  f.socket.emit('error'); await settle();
  const next = await f.s.create({ ...request, mode: 'live' }, origin, owner);
  expect(next.response.sessionId).toBe(f.result.response.sessionId);
  expect(next.response.connectionEpoch).toBe(1);
  expect(f.o.reservations.release).not.toHaveBeenCalled();
  expect(f.socket.events().some(e => e.type === 'session.error')).toBe(false);
});

it('drops duplicate controls and audio without a second provider write', async () => {
  const f = await fixture(); const start = f.event('session.start');
  f.socket.text(start); f.socket.text(start); await settle();
  const bytes = encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(2560) });
  f.socket.binary(bytes); f.socket.binary(bytes); await settle();
  const flow = await vi.mocked(f.o.open).mock.results[0].value;
  expect(f.o.open).toHaveBeenCalledTimes(1); expect(flow.input).toHaveBeenCalledTimes(1);
});

it('input backpressure rejects instead of buffering unlimited audio', async () => {
  const f = await fixture(); f.socket.text(f.event('session.start')); await settle();
  const flow = await vi.mocked(f.o.open).mock.results[0].value;
  let finish!: () => void;
  flow.input = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  for (let i = 0; i < 14; i++) f.socket.binary(encodeVoiceAudio({ kind: 1, flags: 0,
    sequence: i, offsetMs: i * 80, pcm: new Uint8Array(2560) }));
  await settle(); finish?.(); await settle();
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.error', code: 'AUDIO_BUFFER_OVERFLOW' }));
  expect(f.socket.close).toHaveBeenCalled();
});

it('disconnect during provider opening aborts and disposes the late connection', async () => {
  const f = await fixture(); let resolve!: (value: Awaited<ReturnType<typeof f.o.open>>) => void;
  const late = { start: vi.fn(), input: vi.fn(async () => undefined), control: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  f.o.open = vi.fn<typeof f.o.open>((_c, _sink, signal) => {
    expect(signal.aborted).toBe(false);
    return new Promise(r => { resolve = r; });
  });
  f.socket.text(f.event('session.start')); await settle(); f.socket.emit('close');
  resolve(late); await settle();
  expect(late.close).toHaveBeenCalledTimes(1); expect(late.start).not.toHaveBeenCalled();
  expect(f.socket.events().some(e => e.type === 'session.ready')).toBe(false);
});

it('legacy internal sink fixture: reconnect deadline does not extend with repeated REST attempts', async () => {
  vi.useFakeTimers(); const f = await fixture('live');
  f.socket.text(f.event('session.start')); await settle(); f.socket.emit('close'); await settle();
  await vi.advanceTimersByTimeAsync(5000); await f.s.create({ ...request, mode: 'live' }, origin, owner);
  await vi.advanceTimersByTimeAsync(5001);
  expect(f.s.snapshot().active).toBe(0); expect(f.o.reservations.release).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

it('keeps an active connection after current capabilities disable the mode', async () => {
  const revisions = revisionFixture();
  const o = { ...options(), currentConfig: revisions.port };
  const release = vi.fn(async () => undefined);
  o.admission = vi.fn(async () => ({ release }));
  const s = new VoiceSessionService(o); services.push(s);
  const result = await s.create(request, origin, owner);
  const socket = new FakeSocket();
  const connection = new VoiceConnection(s, s.claim(result.cookie.split(';')[0], origin, owner), socket);
  const start = {
    protocolVersion: 1, sessionId: result.response.sessionId,
    connectionEpoch: result.response.connectionEpoch, eventId: 'event-0', sequence: 0,
    type: 'session.start' as const, mode: 'dictation' as const, audioSettings: INPUT_AUDIO,
  };
  connection.receive(Buffer.from(JSON.stringify(start)), false);
  await settle();
  revisions.publish(revisions.make(2, settings => {
    settings.voice.enabledModes = { dictation: false, live: false };
  }));
  connection.receive(encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(2560) }), true);
  connection.receive(Buffer.from(JSON.stringify({
    protocolVersion: 1, sessionId: result.response.sessionId,
    connectionEpoch: result.response.connectionEpoch, eventId: 'event-1', sequence: 1,
    type: 'dictation.stop',
  })), false);
  await settle();
  const flow = await vi.mocked(o.open).mock.results[0].value;
  expect(flow.input).toHaveBeenCalled();
  expect(flow.control).toHaveBeenCalled();
  expect(socket.events().some(e => e.type === 'session.error')).toBe(false);
  expect(release).not.toHaveBeenCalled();
  await connection.dispose();
  await s.end(result.response.sessionId);
});

it('legacy internal sink fixture: retains bounded replay protection without a 4096-control lifetime hangup', async () => {
  const f = await fixture('live'); f.socket.text(f.event('session.start')); await settle();
  for (let sequence = 1; sequence <= 4200; sequence++) {
    f.socket.text({ ...f.event('session.start', sequence), type: 'input.mute', mode: undefined, audioSettings: undefined });
    await settle();
  }
  expect(f.socket.events().some(e => e.type === 'session.error')).toBe(false);
  const flow = await vi.mocked(f.o.open).mock.results[0].value;
  expect(flow.control).toHaveBeenCalledTimes(4200);
});

it('legacy internal sink fixture: sends terminal shutdown before the real server drain', async () => {
  const f = await fixture('live'); f.socket.text(f.event('session.start')); await settle();
  await f.s.stop(f.result.response.sessionId, 'shutdown');
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.ended',
    reason: 'shutdown', terminal: true }));
  expect(f.socket.close).toHaveBeenCalled();
});

it('legacy internal sink fixture: allows a credited PCM window with irregular framing and a finite socket cap', async () => {
  const f = await fixture('live'); f.socket.text(f.event('session.start')); await settle();
  const sink = vi.mocked(f.o.open).mock.calls[0][1];
  f.socket.send.mockImplementation(data => { f.socket.bufferedAmount += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength; });
  const ref = { turnId: 't1', responseId: 'r1' };
  sink.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
  expect(() => {
    sink.audio(ref, new Uint8Array(50)); sink.audio(ref, new Uint8Array(50));
    for (let i = 0; i < 9; i++) sink.audio(ref, new Uint8Array(9600));
    sink.audio(ref, new Uint8Array(9500)); // Exactly 48,000 samples including the irregular packets.
    sink.event({ type: 'voice.state', input: 'listening', agent: 'speaking', connection: 'connected' });
  }).not.toThrow();
  f.socket.bufferedAmount = 131072 + f.result.response.limits.outputQueueMs * 24 * 18;
  expect(() => sink.audio(ref, new Uint8Array(2))).toThrow('AUDIO_BUFFER_OVERFLOW');
});

it.each(['duration', 'quota'] as const)('legacy internal sink fixture: stops paid work for %s without closing the control socket', async reason => {
  const f = await fixture('live');
  f.socket.text(f.event('session.start')); await settle();
  const flow = await vi.mocked(f.o.open).mock.results[0].value;
  await f.s.stop(f.result.response.sessionId, reason); await settle();
  const code = reason === 'duration' ? 'VOICE_DURATION_LIMIT' : 'VOICE_QUOTA_EXHAUSTED';
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.error',
    code, terminal: false, recoverable: false, recovery: 'none' }));
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.ended', reason, terminal: false }));
  expect(flow.close).toHaveBeenCalledTimes(1);
  expect(f.socket.close).not.toHaveBeenCalled();
  expect(f.s.snapshot().active).toBe(1);
  f.socket.binary(encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(2560) }));
  f.socket.text({ ...f.event('session.start', 1), type: 'input.unmute', mode: undefined, audioSettings: undefined });
  await settle();
  expect(flow.input).not.toHaveBeenCalled();
  expect(f.o.open).toHaveBeenCalledTimes(1);
  expect(f.socket.close).not.toHaveBeenCalled();
  f.socket.text({ ...f.event('session.start', 2), type: 'session.end', mode: undefined, audioSettings: undefined });
  await settle();
  expect(f.socket.close).toHaveBeenCalled();
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.ended', reason: 'completed', terminal: true }));
});

it('legacy internal sink fixture: reopens a failed paid flow on unmute using the same binding', async () => {
  const f = await fixture('live');
  f.socket.text(f.event('session.start')); await settle();
  const [binding, sink] = vi.mocked(f.o.open).mock.calls[0];
  const first = await vi.mocked(f.o.open).mock.results[0].value;
  sink.pause?.('STT_UNAVAILABLE'); await settle();
  expect(first.close).toHaveBeenCalledTimes(1);
  expect(f.socket.close).not.toHaveBeenCalled();
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.error',
    code: 'STT_UNAVAILABLE', terminal: false, recovery: 'resume_call', recoverable: true }));
  f.socket.text({ ...f.event('session.start', 1), type: 'input.unmute', mode: undefined, audioSettings: undefined });
  await settle();
  expect(f.o.open).toHaveBeenCalledTimes(2);
  expect(vi.mocked(f.o.open).mock.calls[1][0]).toBe(binding);
  expect(f.o.admission).toHaveBeenCalledTimes(1);
  expect(f.o.reservations.acquire).toHaveBeenCalledTimes(1);
  expect(f.socket.events().filter(e => e.type === 'session.ready')).toHaveLength(1);
  expect(f.socket.events().some(e => e.type === 'conversation.bound')).toBe(false);
  expect(f.socket.close).not.toHaveBeenCalled();
});

it('legacy internal sink fixture: keeps a failed provider handshake paused until recovery', async () => {
  const f = await fixture('live');
  vi.mocked(f.o.open).mockRejectedValueOnce(new VoiceSessionError('STT_UNAVAILABLE', 'resume_call'));
  f.socket.text(f.event('session.start')); await settle();
  expect(f.socket.events().filter(e => e.type === 'session.ready')).toHaveLength(0);
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.error', terminal: false }));
  expect(f.socket.close).not.toHaveBeenCalled();
  f.socket.text({ ...f.event('session.start', 1), type: 'input.unmute', mode: undefined, audioSettings: undefined });
  await settle();
  expect(f.socket.events().filter(e => e.type === 'session.ready')).toHaveLength(1);
  expect(f.o.admission).toHaveBeenCalledTimes(1);
  expect(f.socket.close).not.toHaveBeenCalled();
});

it('legacy internal sink fixture: emits session.error when resumePaidWork fails on unmute', async () => {
  const f = await fixture('live');
  f.socket.text(f.event('session.start')); await settle();
  const sink = vi.mocked(f.o.open).mock.calls[0][1];
  sink.pause?.('STT_UNAVAILABLE'); await settle();
  const countBefore = f.socket.events().filter(e => e.type === 'session.error').length;
  vi.mocked(f.o.open).mockRejectedValueOnce(new VoiceSessionError('STT_UNAVAILABLE', 'resume_call'));
  f.socket.text({ ...f.event('session.start', 1), type: 'input.unmute', mode: undefined, audioSettings: undefined });
  await settle();
  const errorEvents = f.socket.events().filter(e => e.type === 'session.error');
  expect(errorEvents.length).toBe(countBefore + 1);
  expect(errorEvents[errorEvents.length - 1]).toMatchObject({
    type: 'session.error',
    code: 'STT_UNAVAILABLE',
    recoverable: true
  });
});

it('preserves allowlisted parser fault messages but never returns private error text', () => {
  for (const code of ['INVALID_VOICE_CONTROL', 'INVALID_AUDIO_FRAME'] as const)
    expect(voiceError(new Error(code), 'VOICE_DELIVERY_UNKNOWN').code).toBe(code);
  expect(voiceError(new Error('private provider payload'), 'VOICE_DELIVERY_UNKNOWN').code)
    .toBe('VOICE_DELIVERY_UNKNOWN');
});

it('legacy internal sink fixture: does not reopen paid work when pausing could not drain its old flow', async () => {
  const f = await fixture('live');
  f.socket.text(f.event('session.start')); await settle();
  const flow = await vi.mocked(f.o.open).mock.results[0].value;
  vi.mocked(flow.close).mockRejectedValueOnce(new Error('private persistence failure'));
  const sink = vi.mocked(f.o.open).mock.calls[0][1];
  sink.pause?.('TTS_UNAVAILABLE'); await settle();
  f.socket.text({ ...f.event('session.start', 1), type: 'input.unmute', mode: undefined, audioSettings: undefined });
  await settle();
  expect(f.o.open).toHaveBeenCalledTimes(1);
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.error',
    code: 'VOICE_DELIVERY_UNKNOWN', recoverable: false, terminal: false }));
  expect(JSON.stringify(f.socket.events())).not.toContain('private persistence failure');
});
