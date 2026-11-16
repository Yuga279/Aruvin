/**
 * ============================================================================
 * FILE: live.spec.ts
 * LOCATION: backend/test/voice/session/live.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for LiveFlow live duplex speech bridging and playback control.
 *
 * ROLE IN PROJECT:
 *    Verifies final-only input submission, transcript-free audio streaming,
 *    mute/unmute handling, monotonic playback progress mapping, barge-in / StartOfTurn
 *    invalidation, and bounded input queueing.
 *
 * KEY COMPONENTS:
 *    - LiveFlow turn submission and TTS streaming tests.
 *    - Playback progress and interruption tests.
 *    - Mute/unmute and backlog bounding tests.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { LiveFlow } from '../../../src/voice/session/live-flow.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { FluxSttAdapter } from '../../../src/voice/providers/flux-stt.js';
import { FluxTtsAdapter } from '../../../src/voice/providers/flux-tts.js';
import { VoiceConnection } from '../../../src/voice/transport/voice-connection.js';
import { INPUT_AUDIO, parseVoiceControl } from '../../../src/contracts/voice-wire.js';
import { harness, connected } from '../../fixtures/deepgram/socket.js';
import { FakeSocket as TransportSocket } from '../transport/fixtures.js';
import type { LiveHooks, VoiceSink } from '../../../src/voice/session/voice-session.options.js';
import { VoiceSessionError } from '../../../src/voice/session/voice-session.options.js';
import type { VoiceClientEvent, VoiceClientPayload } from '../../../src/contracts/voice-wire.js';
import { options, origin, request, fakeStt, fakeTts, owner } from './fixtures.js';
import { settle } from '../transport/fixtures.js';

const services: VoiceSessionService[] = [], flows: LiveFlow[] = [];
const retiredInputQueues: Array<{ end(): void }> = [];
afterEach(async () => {
  for (const queue of retiredInputQueues.splice(0)) queue.end();
  await Promise.all(flows.splice(0).map(f => f.close()));
  await Promise.all(services.splice(0).map(s => s.drain()));
  vi.useRealTimers();
});

async function fixture() {
  const o = options(), s = new VoiceSessionService(o);
  services.push(s);
  const result = await s.create({ ...request, mode: 'live' }, origin, owner);
  const context = s.claim(result.cookie.split(';')[0], origin, owner);
  const stt = fakeStt(), tts = fakeTts();
  let outputSamples = 0;
  const sink: VoiceSink = {
    outputSamples: () => outputSamples,
    event: vi.fn(),
    audio: vi.fn((_ref, pcm) => { outputSamples += pcm.byteLength / 2; }),
    invalidate: vi.fn(),
    finish: vi.fn()
  };
  const hooks: LiveHooks = {
    finalized: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    delivery: vi.fn(async () => undefined),
    playback: vi.fn(async () => undefined),
    disconnected: vi.fn(async () => undefined)
  };
  const flow = await LiveFlow.open(context, sink, new AbortController().signal,
    { stt: stt.port, tts: tts.port, hooks, usage: o.usage });
  flows.push(flow);
  flow.start();
  const control = (payload: VoiceClientPayload): VoiceClientEvent => ({
    protocolVersion: 1,
    sessionId: result.response.sessionId,
    connectionEpoch: 0,
    eventId: 'control-1',
    sequence: 1,
    ...payload
  });
  return { o, s, context, stt, tts, sink, hooks, flow, control };
}

const ref = { turnId: 'turn-1', responseId: 'response-1' };
const usage = { providerRequestId: null, model: 'fixture', modelVersion: null, audioMs: 100, billableCharacters: 5 };

it('does not hold microphone frames or mute behind a pending calendar confirmation', async () => {
  const f = await fixture();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.hooks.calendarControl = vi.fn(async () => { await pending; });
  try {
    await f.flow.control(f.control({ type: 'calendar.confirm', proposalId: 'p1', proposalRevision: 1,
      answer: { kind: 'accept' } }));
    await settle();
    expect(f.hooks.calendarControl).toHaveBeenCalledWith(f.context,
      expect.objectContaining({ proposalId: 'p1', proposalRevision: 1 }), expect.any(AbortSignal));
    await f.flow.input(new Uint8Array(2560));
    expect(f.stt.connection.writeAudio).toHaveBeenCalledTimes(1);
    await f.flow.control(f.control({ type: 'input.mute' }));
    expect(f.stt.connection.close).toHaveBeenCalledTimes(1);
  } finally { release(); await settle(); }
});

it('reports a stale calendar button as a warning without closing live voice', async () => {
  const f = await fixture();
  f.hooks.calendarControl = vi.fn(async () => { throw new VoiceSessionError('INVALID_VOICE_CONTROL', 'none'); });
  await f.flow.control(f.control({ type: 'calendar.confirm', proposalId: 'stale', proposalRevision: 1,
    answer: { kind: 'accept' } }));
  await settle();
  expect(f.sink.event).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.warning', code: 'INVALID_VOICE_CONTROL' }));
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).toHaveBeenCalledTimes(1);
  expect(f.tts.connection.close).not.toHaveBeenCalled();
});

it('opens STT and TTS concurrently rather than adding their connection delays', async () => {
  const f = await fixture();
  const stt = fakeStt(), tts = fakeTts();
  let connected!: () => void;
  vi.mocked(stt.port.connect).mockImplementationOnce(() => new Promise(resolve => {
    connected = () => resolve(stt.connection);
  }));
  const opening = LiveFlow.open(f.context, f.sink, new AbortController().signal,
    { stt: stt.port, tts: tts.port, hooks: f.hooks, usage: f.o.usage });
  const synthesisStarted = vi.mocked(tts.port.connect).mock.calls.length;
  connected();
  flows.push(await opening);
  expect(synthesisStarted).toBe(1);
});

it.each(['stt', 'tts'] as const)('closes a connected provider if its parallel %s peer fails to open', async provider => {
  const f = await fixture();
  const stt = fakeStt(), tts = fakeTts();
  if (provider === 'stt') vi.mocked(stt.port.connect).mockRejectedValueOnce(new Error('Provider failed'));
  else vi.mocked(tts.port.connect).mockRejectedValueOnce(new Error('Provider failed'));
  await expect(LiveFlow.open(f.context, f.sink, new AbortController().signal,
    { stt: stt.port, tts: tts.port, hooks: f.hooks, usage: f.o.usage })).rejects.toThrow('Provider failed');
  expect(provider === 'stt' ? tts.connection.close : stt.connection.close).toHaveBeenCalledTimes(1);
});

it('aborts a pending peer and drains a late successful connection after startup failure', async () => {
  const f = await fixture();
  const stt = fakeStt(), tts = fakeTts();
  let inputSignal!: AbortSignal;
  vi.mocked(stt.port.connect).mockImplementationOnce(request => new Promise(resolve => {
    inputSignal = request.abortSignal;
    inputSignal.addEventListener('abort', () => resolve(stt.connection), { once: true });
  }));
  vi.mocked(tts.port.connect).mockRejectedValueOnce(new Error('TTS failed'));
  await expect(LiveFlow.open(f.context, f.sink, new AbortController().signal,
    { stt: stt.port, tts: tts.port, hooks: f.hooks, usage: f.o.usage })).rejects.toThrow('TTS failed');
  expect(inputSignal.aborted).toBe(true);
  expect(stt.connection.close).toHaveBeenCalledTimes(1);
});

it('reaches session.ready with a resolved TTS name and stays open for six silent seconds', async () => {
  vi.useFakeTimers();
  const o = options();
  const stt = harness({ type: 'Connected', request_id: 'fixture-stt', sequence_id: 0 });
  const tts = harness({ ...connected, model_name: 'fixture-resolved-haley-v2' });
  const hooks: LiveHooks = {
    finalized: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    delivery: vi.fn(async () => undefined),
    playback: vi.fn(async () => undefined),
    disconnected: vi.fn(async () => undefined)
  };
  o.open = vi.fn((context, sink, signal) => LiveFlow.open(context, sink, signal, {
    stt: new FluxSttAdapter(o.config, stt.factory, stt.accounting),
    tts: new FluxTtsAdapter(o.config, tts.factory, tts.accounting),
    hooks, usage: o.usage
  }));
  const service = new VoiceSessionService(o);
  const socket = new TransportSocket();
  let connection: VoiceConnection | undefined;
  try {
    const result = await service.create({ ...request, mode: 'live' }, origin, owner);
    const binding = service.claim(result.cookie.split(';')[0], origin, owner);
    connection = new VoiceConnection(service, binding, socket);
    connection.receive(Buffer.from(JSON.stringify({
      protocolVersion: 1, sessionId: result.response.sessionId,
      connectionEpoch: result.response.connectionEpoch, eventId: 'start-1', sequence: 0,
      type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO
    })), false);
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(socket.events().filter(e => e.type === 'session.ready')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);
    await settle();
    expect(socket.events().filter(e => e.type === 'session.ready')).toHaveLength(1);
    expect(socket.events().some(e => e.type === 'session.error' || e.type === 'session.ended')).toBe(false);
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.terminate).not.toHaveBeenCalled();
    for (const h of [stt, tts]) {
      expect(h.sockets).toHaveLength(1);
      expect(h.sockets[0].readyState).toBe(1);
      expect(h.sockets[0].terminated).toBe(false);
      expect(h.sockets[0].sent).toEqual([]);
    }
    expect(hooks.finalized).not.toHaveBeenCalled();
    expect(hooks.delivery).not.toHaveBeenCalled();
  } finally {
    await connection?.dispose();
    await service.drain();
    await Promise.all([stt.accounting.drain(), tts.accounting.drain()]);
    vi.useRealTimers();
  }
});

it('only submits nonempty EndOfTurn once and never sends transcript events', async () => {
  const f = await fixture();
  f.stt.events.push({ type: 'partial', segmentId: 'p1', text: 'private draft' });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p1', text: '   ' });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p2', text: 'Where is Paris?' });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p2', text: 'Where is Paris?' });
  await settle();
  expect(f.hooks.finalized).toHaveBeenCalledTimes(1);
  expect(f.hooks.finalized).toHaveBeenCalledWith(f.context,
    { providerSocketEpoch: 0, providerTurnId: 'p2', text: 'Where is Paris?' }, expect.any(AbortSignal));
  expect(JSON.stringify(vi.mocked(f.sink.event).mock.calls)).not.toMatch(/private draft|Where is Paris/);
});

it('streams PCM between audio.start and audio.end without assistant text', async () => {
  const f = await fixture();
  await f.flow.speak({ ...ref, text: 'Private answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.flush(ref);
  f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage });
  await settle();
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
  expect(f.sink.audio).toHaveBeenCalledWith(ref, new Uint8Array(4800));
  expect(vi.mocked(f.sink.event).mock.calls.map(([e]) => e.type)).toEqual(['voice.state', 'audio.start', 'audio.end', 'voice.state']);
  expect(JSON.stringify(vi.mocked(f.sink.event).mock.calls)).not.toContain('Private answer.');
  expect(f.hooks.delivery).toHaveBeenCalledWith(f.context, expect.objectContaining({ type: 'speech-completed' }));
});

it('mute discards samples, unmute uses only fresh 80ms input', async () => {
  const f = await fixture(), fresh = fakeStt();
  vi.mocked(f.stt.port.connect).mockImplementationOnce(async () => fresh.connection);
  await f.flow.control(f.control({ type: 'input.mute' }));
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  await f.flow.control(f.control({ type: 'input.unmute' }));
  await f.flow.input(new Uint8Array(2560));
  expect(fresh.connection.writeAudio).toHaveBeenCalledTimes(1);
  expect(f.stt.connection.close).toHaveBeenCalledTimes(1);
  await expect(f.flow.input(new Uint8Array(2))).rejects.toMatchObject({ code: 'INVALID_AUDIO_FRAME' });
});

it('acknowledges input.unmute while already unmuted without reopening providers or creating a turn', async () => {
  const f = await fixture();
  vi.mocked(f.sink.event).mockClear();
  await f.flow.control(f.control({ type: 'input.unmute' }));
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.tts.port.connect).toHaveBeenCalledTimes(1);
  expect(f.stt.connection.close).not.toHaveBeenCalled();
  expect(f.hooks.finalized).not.toHaveBeenCalled();
});

it('rejects played-not-sent, regressing or mismatched response progress', async () => {
  const f = await fixture();
  await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  const progress = (samples: number, responseId = ref.responseId) => f.control({
    type: 'playback.progress',
    turnId: ref.turnId,
    responseId,
    playedSamples: samples,
    playedMs: Math.floor(samples / 24)
  });
  await expect(f.flow.control(progress(2401))).rejects.toMatchObject({ code: 'INVALID_VOICE_CONTROL' });
  await f.flow.control(progress(1200));
  await expect(f.flow.control(progress(1199))).rejects.toMatchObject({ code: 'INVALID_VOICE_CONTROL' });
  await expect(f.flow.control(progress(1200, 'wrong'))).rejects.toMatchObject({ code: 'VOICE_BINDING_MISMATCH' });
});

it('StartOfTurn invalidates before cancellation and drops late audio', async () => {
  const f = await fixture();
  await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 1200, playedMs: 50 }));
  f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'p2' });
  await settle();
  expect(f.sink.invalidate).toHaveBeenCalledWith(ref);
  expect(f.tts.connection.interrupt).toHaveBeenCalledWith({ ...ref, providerSocketId: 'provider-socket-1', playbackPositionMs: 50 });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  expect(f.sink.audio).toHaveBeenCalledTimes(1);
});

it('bounds the completed-input backlog instead of queuing another inference', async () => {
  const f = await fixture();
  let finish!: () => void;
  f.hooks.finalized = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p1', text: 'one' });
  await settle();
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p2', text: 'two' });
  await settle();
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p3', text: 'three' });
  await settle();
  expect(f.sink.event).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.error', code: 'CONFLICT_ACTIVE_TURN' }));
  finish();
  await settle();
  expect(f.hooks.finalized).toHaveBeenCalledTimes(1);
});

it('synthesis completion does not claim listening before the last played sample', async () => {
  const f = await fixture();
  await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage });
  await settle();
  expect(f.sink.event).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'voice.state', agent: 'idle' }));
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
});

it('close drains providers when invalidate throws instead of throwing synchronously', async () => {
  const f = await fixture();
  await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  await settle();
  vi.mocked(f.sink.invalidate).mockImplementation(() => { throw new Error('INVALID_VOICE_CONTROL'); });
  await expect(f.flow.close()).resolves.toBeUndefined();
  expect(f.stt.connection.close).toHaveBeenCalled();
  expect(f.tts.connection.close).toHaveBeenCalled();
});

it('a failed media invalidation cannot suppress runtime interruption or provider cleanup', async () => {
  const f = await fixture();
  await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  vi.mocked(f.sink.invalidate).mockImplementation(() => { throw new Error('media failed'); });
  f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'new' });
  await settle();
  expect(f.hooks.interrupt).toHaveBeenCalledWith(f.context, expect.objectContaining(ref));
  await f.flow.close();
  expect(f.stt.connection.close).toHaveBeenCalled();
  expect(f.tts.connection.close).toHaveBeenCalled();
});

it('clears media before provider and runtime cancellation on barge-in', async () => {
  const f = await fixture();
  await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 1200, playedMs: 50 }));
  const order: string[] = [];
  vi.mocked(f.sink.invalidate).mockImplementation(() => { order.push('clear'); });
  vi.mocked(f.tts.connection.interrupt).mockImplementation(async () => { order.push('tts'); });
  vi.mocked(f.hooks.interrupt).mockImplementation(async () => { order.push('runtime'); });
  f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'new' });
  await settle();
  expect(order[0]).toBe('clear');
  expect(order.indexOf('clear')).toBeLessThan(order.indexOf('tts'));
  expect(order.indexOf('clear')).toBeLessThan(order.indexOf('runtime'));
});

it('unproven progress bounds the cursor but never completes or emits audio.end', async () => {
  const f = await fixture();
  await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage });
  await settle();
  await f.flow.control(f.control({
    type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100, proof: 'unproven',
  }));
  expect(f.hooks.playback).not.toHaveBeenCalled();
  expect(f.sink.event).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'audio.end' }));
  expect(f.sink.event).not.toHaveBeenCalledWith(expect.objectContaining({ agent: 'idle' }));
  await f.flow.control(f.control({
    type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100, proof: 'proven',
  }));
  expect(f.sink.event).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio.end' }));
});

it('unproven interruption resets output without a provider playback offset', async () => {
  const f = await fixture(), fresh = fakeTts();
  vi.mocked(f.tts.port.connect).mockResolvedValueOnce(fresh.connection);
  await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.control(f.control({
    type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50, proof: 'unproven',
  }));
  await settle();
  expect(f.sink.invalidate).toHaveBeenCalledWith(ref);
  expect(f.tts.connection.interrupt).not.toHaveBeenCalled();
  expect(f.tts.connection.close).toHaveBeenCalledTimes(1);
  expect(f.tts.port.connect).toHaveBeenCalledTimes(2);
  expect(f.hooks.playback).not.toHaveBeenCalled();
  expect(f.hooks.interrupt).toHaveBeenCalled();
});

it('announces the final generated watermark before audio.end', async () => {
  const f = await fixture();
  const order: string[] = [];
  (f.sink as VoiceSink & { watermark?: (r: { turnId: string; responseId: string }) => void }).watermark =
    vi.fn(() => { order.push('watermark'); });
  vi.mocked(f.sink.event).mockImplementation(payload => {
    if (payload.type === 'audio.end') order.push('end');
  });
  await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage });
  await settle();
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
  expect(order).toEqual(['watermark', 'end']);
});

it('TTS failure during speech cancels through VoiceConnection without INVALID_VOICE_CONTROL', async () => {
  const o = options();
  const stt = fakeStt(), tts = fakeTts();
  const hooks: LiveHooks = {
    finalized: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    delivery: vi.fn(async () => undefined),
    playback: vi.fn(async () => undefined),
    disconnected: vi.fn(async () => undefined)
  };
  o.open = vi.fn((context, sink, signal) => LiveFlow.open(context, sink, signal, {
    stt: stt.port, tts: tts.port, hooks, usage: o.usage
  }));
  const service = new VoiceSessionService(o);
  const socket = new TransportSocket();
  let connection: VoiceConnection | undefined;
  try {
    const result = await service.create({ ...request, mode: 'live' }, origin, owner);
    connection = new VoiceConnection(service, service.claim(result.cookie.split(';')[0], origin, owner), socket);
    connection.receive(Buffer.from(JSON.stringify({
      protocolVersion: 1, sessionId: result.response.sessionId,
      connectionEpoch: result.response.connectionEpoch, eventId: 'start-1', sequence: 0,
      type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO
    })), false);
    await settle();
    const flow = await vi.mocked(o.open).mock.results[0].value as LiveFlow;
    await flow.speak({ ...ref, text: 'Answer.' });
    tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
    tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    await settle();
    tts.events.push({ type: 'error', fault: { code: 'TTS_UNAVAILABLE', recoverable: false, recovery: 'return_to_chat' } });
    await settle();
    const events = socket.events();
    expect(events.some(e => e.type === 'audio.start')).toBe(true);
    expect(events.some(e => e.type === 'response.cancelled')).toBe(true);
    expect(events.some(e => e.type === 'session.error')).toBe(true);
    for (const event of events) {
      expect(() => parseVoiceControl(JSON.stringify(event), 'server', 'live')).not.toThrow();
    }
    expect(events).toContainEqual(expect.objectContaining({ type: 'session.error',
      code: 'TTS_UNAVAILABLE', terminal: false, recovery: 'resume_call' }));
    expect(socket.close).not.toHaveBeenCalled();
    const cancelled = events.find(e => e.type === 'response.cancelled')!;
    expect(cancelled).toMatchObject({ ...ref, type: 'response.cancelled' });
    expect(cancelled).not.toHaveProperty('invalid');
    expect(cancelled).not.toHaveProperty('wireBase');
  } finally {
    await connection?.dispose();
    await service.drain();
  }
});

it('translates monotonic wire playback past discarded audio into the provider cursor', async () => {
  const f = await fixture();
  await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.control(f.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 }));
  f.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-1', audioPlayedMs: 50,
    textSpoken: 'An', textRemaining: 'swer.', usage });
  await settle();
  const next = { turnId: 'turn-2', responseId: 'response-2' };
  await f.flow.speak({ ...next, text: 'Next.' });
  f.tts.events.push({ type: 'speech-started', ...next, speechId: 'speech-2' });
  f.tts.events.push({ type: 'audio', ...next, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.control(f.control({ type: 'response.interrupt', ...next, playedSamples: 3600, playbackPositionMs: 150 }));
  expect(f.tts.connection.interrupt).toHaveBeenLastCalledWith({ ...next,
    providerSocketId: 'provider-socket-1', playbackPositionMs: 100 });
});

it('paces a burst larger than the playback budget and drains all samples', async () => {
  const f = await fixture();
  await f.flow.speak({ ...ref, text: 'A long prose unit.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  for (let i = 0; i < 11; i++) f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(9600) });
  f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 2200, usage });
  await settle();
  expect(f.sink.finish).not.toHaveBeenCalled();
  expect(f.sink.audio).toHaveBeenCalledTimes(10);
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 4800, playedMs: 200 }));
  await settle();
  expect(f.sink.audio).toHaveBeenCalledTimes(11);
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 52800, playedMs: 2200 }));
  expect(f.sink.event).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio.end' }));
});

it('hands off distinct origins for three prepared responses, including discarded audio', async () => {
  const f = await fixture();
  for (let i = 0; i < 3; i++) {
    const r = { turnId: `t${i}`, responseId: `r${i}` };
    expect(f.flow.prepareResponse(r).providerBaseSamples).toBe(i === 0 ? 0 : i === 1 ? 1200 : 3600);
    await f.flow.speak({ ...r, text: 'Answer.' });
    f.tts.events.push({ type: 'speech-started', ...r, speechId: `s${i}` });
    f.tts.events.push({ type: 'audio', ...r, pcm: new Uint8Array(4800) });
    await settle();
    if (i === 0) {
      await f.flow.control(f.control({ type: 'response.interrupt', ...r, playedSamples: 1200, playbackPositionMs: 50 }));
      f.tts.events.push({ type: 'speech-interrupted', ...r, speechId: 's0', audioPlayedMs: 50,
        textSpoken: 'An', textRemaining: 'swer.', usage });
    } else {
      f.tts.events.push({ type: 'speech-completed', ...r, speechId: `s${i}`, audioDurationMs: 100, usage });
      await settle();
      await f.flow.control(f.control({ type: 'playback.progress', ...r, playedSamples: (i + 1) * 2400, playedMs: (i + 1) * 100 }));
    }
    await settle();
  }
});

it('resets speech before first PCM instead of sending an invalid zero-offset Interrupt', async () => {
  const f = await fixture(), fresh = fakeTts();
  vi.mocked(f.tts.port.connect).mockResolvedValueOnce(fresh.connection);
  await f.flow.speak({ ...ref, text: 'Not heard.' });
  f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'new-input' });
  await settle();
  expect(f.hooks.interrupt).toHaveBeenCalledOnce();
  expect(f.tts.connection.interrupt).not.toHaveBeenCalled();
  expect(f.tts.connection.close).toHaveBeenCalled();
  expect(f.sink.finish).not.toHaveBeenCalled();
  expect(f.flow.prepareResponse({ turnId: 'next', responseId: 'next' }).providerBaseSamples).toBe(0);
});

it('preserves a sanitized finalized-hook failure rather than masking delivery failure', async () => {
  const f = await fixture();
  const { VoiceSessionError } = await import('../../../src/voice/session/voice-session.options.js');
  f.hooks.finalized = vi.fn(async () => { throw new VoiceSessionError('VOICE_DELIVERY_UNKNOWN'); });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p1', text: 'Question' });
  await settle();
  expect(f.sink.event).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.error', code: 'VOICE_DELIVERY_UNKNOWN' }));
});

it('does not abort in-flight generation when TTS delivery becomes unknown mid-answer', async () => {
  const f = await fixture();
  vi.mocked(f.tts.port.connect).mockRejectedValueOnce(new Error('TTS reconnect failed'));
  let aborted = false;
  let done!: (error?: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    done = error => { if (error) reject(error); else resolve(); };
  });
  f.hooks.finalized = vi.fn(async (_c, _input, signal) => {
    signal.addEventListener('abort', () => { aborted = true; }, { once: true });
    try {
      await f.flow.speak({ ...ref, text: 'First clause. ' });
      f.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-1',
        audioPlayedMs: null, textSpoken: null, textRemaining: null, usage });
      f.tts.events.push({ type: 'error', fault: { code: 'VOICE_DELIVERY_UNKNOWN', recoverable: true, recovery: 'return_to_chat' } });
      await settle();
      expect(aborted).toBe(false);
      expect(f.sink.event).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.error' }));
      await f.flow.speak({ ...ref, text: 'Second clause must survive.' });
      done();
    } catch (error) { done(error); throw error; }
  });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p1', text: 'Question' });
  await finished;
  expect(f.hooks.finalized).toHaveBeenCalledOnce();
  expect(aborted).toBe(false);
  await settle();
  expect(f.sink.event).toHaveBeenCalledWith(expect.objectContaining({
    type: 'session.error', code: 'VOICE_DELIVERY_UNKNOWN', recoverable: true, terminal: false
  }));
});

it('reconnects Flux TTS once mid-answer and speaks later text on the fresh socket', async () => {
  const f = await fixture();
  const fresh = fakeTts();
  vi.mocked(f.tts.port.connect).mockResolvedValueOnce(fresh.connection);
  let aborted = false;
  let done!: (error?: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    done = error => { if (error) reject(error); else resolve(); };
  });
  f.hooks.finalized = vi.fn(async (_c, _input, signal) => {
    signal.addEventListener('abort', () => { aborted = true; }, { once: true });
    try {
      await f.flow.speak({ ...ref, text: 'First clause. ' });
      f.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-1',
        audioPlayedMs: null, textSpoken: null, textRemaining: null, usage });
      f.tts.events.push({ type: 'error', fault: { code: 'VOICE_DELIVERY_UNKNOWN', recoverable: true, recovery: 'return_to_chat' } });
      await vi.waitFor(() => expect(f.tts.port.connect).toHaveBeenCalledTimes(2));
      expect(aborted).toBe(false);
      expect(signal.aborted).toBe(false);
      expect(f.sink.event).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.error' }));
      await f.flow.speak({ ...ref, text: 'Second clause must survive.' });
      expect(fresh.connection.speak).toHaveBeenCalledWith({ ...ref, text: 'Second clause must survive.' });
      expect(f.tts.connection.speak).toHaveBeenCalledTimes(1);
      expect(f.tts.connection.speak).toHaveBeenCalledWith({ ...ref, text: 'First clause. ' });
      expect(aborted).toBe(false);
      expect(f.sink.event).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.error' }));
      fresh.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-2',
        audioPlayedMs: null, textSpoken: null, textRemaining: null, usage });
      fresh.events.push({ type: 'error', fault: { code: 'TTS_UNAVAILABLE', recoverable: true, recovery: 'return_to_chat' } });
      await settle();
      expect(f.tts.port.connect).toHaveBeenCalledTimes(2);
      expect(aborted).toBe(false);
      done();
    } catch (error) { done(error); throw error; }
  });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p1', text: 'Question' });
  await finished;
  expect(f.hooks.finalized).toHaveBeenCalledOnce();
  expect(aborted).toBe(false);
});

it('speaks only the unheard suffix after a mid-answer TTS reconnect', async () => {
  const f = await fixture();
  const fresh = fakeTts();
  vi.mocked(f.tts.port.connect).mockResolvedValueOnce(fresh.connection);
  let done!: (error?: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    done = error => { if (error) reject(error); else resolve(); };
  });
  f.hooks.finalized = vi.fn(async () => {
    try {
      await f.flow.speak({ ...ref, text: 'First clause. ' });
      f.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-1',
        audioPlayedMs: null, textSpoken: null, textRemaining: null, usage });
      f.tts.events.push({ type: 'error', fault: { code: 'VOICE_DELIVERY_UNKNOWN', recoverable: true, recovery: 'return_to_chat' } });
      await vi.waitFor(() => expect(f.tts.port.connect).toHaveBeenCalledTimes(2));
      await f.flow.speak({ ...ref, text: 'unheard suffix only' });
      expect(fresh.connection.speak).toHaveBeenCalledTimes(1);
      expect(fresh.connection.speak).toHaveBeenCalledWith({ ...ref, text: 'unheard suffix only' });
      expect(fresh.connection.speak).not.toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringContaining('First clause')
      }));
      expect(f.tts.connection.speak.mock.calls.map(([command]) => command.text).join(''))
        .toBe('First clause. ');
      done();
    } catch (error) { done(error); throw error; }
  });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p1', text: 'Question' });
  await finished;
});

it('holds the next response until a retiring provider has reset, and drains reset on close', async () => {
  const f = await fixture(), fresh = fakeTts();
  let connect!: () => void;
  vi.mocked(f.tts.port.connect).mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { connect = resolve; }); return fresh.connection;
  });
  await f.flow.speak({ ...ref, text: 'Not heard.' });
  f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'p2' }); await settle();
  let ready = false;
  const pending = f.flow.waitForOutput().then(() => { ready = true; });
  await settle(); expect(ready).toBe(false);
  connect(); await pending;
  expect(f.flow.prepareResponse({ turnId: 't2', responseId: 'r2' }).providerBaseSamples).toBe(0);
  await f.flow.close(); expect(fresh.connection.close).toHaveBeenCalled();
});

it.each(['NO_AUDIO_GENERATED', 'INTERRUPT_IN_PROGRESS', 'INVALID_INTERRUPT_OFFSET'])(
  'reconciles %s as unknown and replaces only the TTS socket, not the conversation', async code => {
    const o = options(), sessions = new VoiceSessionService(o); services.push(sessions);
    const created = await sessions.create({ ...request, mode: 'live' }, origin, owner);
    const c = sessions.claim(created.cookie.split(';')[0], origin, owner), stt = fakeStt(), tts = harness(connected);
    const hooks: LiveHooks = { finalized: vi.fn(async () => {}), delivery: vi.fn(async () => {}),
      playback: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), disconnected: vi.fn(async () => {}) };
    let sent = 0;
    const sink: VoiceSink = { outputSamples: () => sent, event: vi.fn(), finish: vi.fn(), invalidate: vi.fn(),
      audio: (_r, pcm) => { sent += pcm.length / 2; } };
    const flow = await LiveFlow.open(c, sink, new AbortController().signal, { stt: stt.port,
      tts: new FluxTtsAdapter(o.config, tts.factory, tts.accounting), hooks, usage: o.usage });
    flows.push(flow); flow.start();
    await flow.speak({ ...ref, text: 'Hello world.' });
    tts.sockets[0].json({ type: 'SpeechStarted', speech_id: 's1' });
    tts.sockets[0].binary(new Uint8Array(4800)); await settle();
    await flow.control({ protocolVersion: 1, sessionId: c.response.sessionId, connectionEpoch: 0, eventId: 'interrupt', sequence: 1,
      type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 });
    tts.sockets[0].json({ type: 'Warning', code });
    await vi.waitFor(() => expect(tts.sockets).toHaveLength(2));
    expect(await flow.waitForOutput()).toBe(true);
    expect(sink.finish).not.toHaveBeenCalled();
    expect(hooks.delivery).toHaveBeenCalledWith(c, expect.objectContaining({ type: 'speech-interrupted', textSpoken: null }));
    expect(flow.prepareResponse({ turnId: 't2', responseId: 'r2' }).providerBaseSamples).toBe(0);
  });

it('suspends PCM and settles once without cancelling speech or agent work', async () => {
  const f = await fixture();
  let resolveFinal!: () => void;
  vi.mocked(f.stt.connection.finalize).mockImplementation(() =>
    new Promise<void>(resolve => { resolveFinal = resolve; }));
  await f.flow.speak({ ...ref, text: 'Keep speaking.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.finalize).toHaveBeenCalledTimes(1);
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.stt.connection.close).not.toHaveBeenCalled();
  expect(f.tts.connection.close).not.toHaveBeenCalled();
  expect(f.tts.connection.interrupt).not.toHaveBeenCalled();
  expect(f.hooks.interrupt).not.toHaveBeenCalled();
  expect(f.hooks.disconnected).not.toHaveBeenCalled();
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'voice.state', input: 'suspended',
    agent: 'speaking', connection: 'connected' });
  await f.flow.control(f.control({ type: 'input.unmute' }));
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'pending', text: 'Do not drop this.' });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'pending', text: 'Do not drop this.' });
  resolveFinal(); await settle();
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).toHaveBeenCalledTimes(1);
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.hooks.finalized).toHaveBeenCalledTimes(1);
  expect(f.hooks.interrupt).not.toHaveBeenCalled();
  expect(f.sink.finish).not.toHaveBeenCalled();
});

it('manual mute supersedes suspension and fences the unfinished old turn', async () => {
  const f = await fixture(), fresh = fakeStt();
  let resolveFinal!: () => void;
  vi.mocked(f.stt.connection.finalize).mockImplementation(() =>
    new Promise<void>(resolve => { resolveFinal = resolve; }));
  // Keep the retired fake readable so this test can actually exercise stale callbacks.
  vi.mocked(f.stt.connection.close).mockResolvedValue(undefined);
  retiredInputQueues.push(f.stt.events);
  vi.mocked(f.stt.port.connect).mockResolvedValueOnce(fresh.connection);
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await f.flow.control(f.control({ type: 'input.mute' }));
  await expect(f.flow.control(f.control({ type: 'input.suspend' })))
    .rejects.toMatchObject({ code: 'VOICE_INVALID_STATE' });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'retired', text: 'Never submit this.' });
  resolveFinal(); await settle();
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.hooks.finalized).not.toHaveBeenCalled();
  await f.flow.control(f.control({ type: 'input.unmute' }));
  await f.flow.input(new Uint8Array(2560));
  expect(fresh.connection.writeAudio).toHaveBeenCalledTimes(1);
  expect(f.stt.connection.finalize).toHaveBeenCalledTimes(1);
  f.stt.events.end();
});

it('backend quiet hooks suspend once and resume after settlement without another turn owner', async () => {
  const f = await fixture();
  let finalized!: () => void;
  vi.mocked(f.stt.connection.finalize).mockImplementationOnce(() =>
    new Promise<void>(resolve => { finalized = resolve; }));
  f.flow.suspendInput('quiet');
  f.flow.suspendInput('quiet');
  f.flow.resumeCapture();
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.stt.connection.finalize).toHaveBeenCalledTimes(1);
  finalized(); await settle();
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).toHaveBeenCalledTimes(1);
  expect(f.hooks.finalized).not.toHaveBeenCalled();
  expect(f.hooks.interrupt).not.toHaveBeenCalled();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.tts.port.connect).toHaveBeenCalledTimes(1);
});

it('backend speech onset cannot unmute a manually muted flow', async () => {
  const f = await fixture();
  await f.flow.control(f.control({ type: 'input.mute' }));
  f.flow.resumeCapture();
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.hooks.finalized).not.toHaveBeenCalled();
});

it('renews STT after 2000ms without promoting a partial or starting inference', async () => {
  vi.useFakeTimers();
  const f = await fixture(), fresh = fakeStt();
  vi.mocked(f.stt.connection.finalize).mockImplementation(() => new Promise<void>(() => {}));
  vi.mocked(f.stt.connection.close).mockResolvedValue(undefined);
  retiredInputQueues.push(f.stt.events);
  vi.mocked(f.stt.port.connect).mockResolvedValueOnce(fresh.connection);
  f.stt.events.push({ type: 'partial', segmentId: 'lost', text: 'An incomplete identifier' });
  await settle();
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await f.flow.control(f.control({ type: 'input.unmute' }));
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); await settle();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(2);
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'late', text: 'Never replay.' });
  await settle();
  expect(f.hooks.finalized).not.toHaveBeenCalled();
  expect(f.hooks.interrupt).not.toHaveBeenCalled();
  expect(f.tts.connection.close).not.toHaveBeenCalled();
  await f.flow.input(new Uint8Array(2560));
  expect(fresh.connection.writeAudio).toHaveBeenCalledTimes(1);
  expect(f.context.response.conversationId).toBeNull();
  expect(f.o.reservations.acquire).toHaveBeenCalledTimes(1);
  f.stt.events.end();
});

it('defers quiet STT renewal until current speech drains and renews only once without media', async () => {
  const f = await fixture(), fresh = fakeStt();
  vi.mocked(f.stt.port.connect).mockResolvedValueOnce(fresh.connection);
  await f.flow.speak({ ...ref, text: 'Finish this response.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await settle();
  f.stt.events.end(); await settle();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.hooks.interrupt).not.toHaveBeenCalled();
  f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage });
  await settle();
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
  await settle();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(2);
  expect(f.hooks.finalized).not.toHaveBeenCalled();
  expect(f.tts.port.connect).toHaveBeenCalledTimes(1);
  fresh.events.end(); await settle();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(2);
  expect(f.sink.event).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.error', code: 'STT_UNAVAILABLE' }));
});

it('closes a late unmute connection if mute wins the opening race', async () => {
  const f = await fixture(), fresh = fakeStt();
  let connected!: () => void;
  vi.mocked(f.stt.port.connect).mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { connected = resolve; });
    return fresh.connection;
  });
  await f.flow.control(f.control({ type: 'input.mute' }));
  const opening = f.flow.control(f.control({ type: 'input.unmute' }));
  await settle();
  await f.flow.control(f.control({ type: 'input.mute' }));
  connected(); await opening; await settle();
  await f.flow.input(new Uint8Array(2560));
  expect(fresh.connection.close).toHaveBeenCalledTimes(1);
  expect(fresh.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.sink.event).not.toHaveBeenLastCalledWith(expect.objectContaining({ input: 'listening' }));
});

it('clears the suspension deadline immediately on hang-up', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  vi.mocked(f.stt.connection.finalize).mockImplementation(() => new Promise<void>(() => {}));
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await f.flow.close(); await settle();
  expect(vi.getTimerCount()).toBe(0);
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.hooks.finalized).not.toHaveBeenCalled();
});

it('does not reopen or admit PCM when the original admission forbids paid work', async () => {
  const f = await fixture();
  await f.flow.control(f.control({ type: 'input.suspend' })); await settle();
  const { VoiceSessionError } = await import('../../../src/voice/session/voice-session.options.js');
  f.context.assertPaidWork = () => { throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED', 'none'); };
  await f.flow.control(f.control({ type: 'input.unmute' }));
  await settle();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.hooks.finalized).not.toHaveBeenCalled();
  expect(f.sink.event).toHaveBeenCalledWith(expect.objectContaining({ code: 'VOICE_QUOTA_EXHAUSTED' }));
});

it('idle silence suspension timeout does not retire STT or interrupt active speech', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  vi.mocked(f.stt.connection.finalize).mockImplementation(() => new Promise<void>(() => {}));
  await f.flow.speak({ ...ref, text: 'Keep speaking without cutoff.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await vi.advanceTimersByTimeAsync(2001);
  await settle();
  expect(f.stt.connection.close).not.toHaveBeenCalled();
  expect(f.sink.invalidate).not.toHaveBeenCalled();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage });
  await settle();
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
  await settle();
  expect(f.sink.event).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.error' }));
});

it('does not trigger barge-in from start-of-turn during suspension settlement', async () => {
  const f = await fixture();
  let resolveFinal!: () => void;
  vi.mocked(f.stt.connection.finalize).mockImplementation(() => new Promise<void>(resolve => { resolveFinal = resolve; }));
  await f.flow.speak({ ...ref, text: 'Do not interrupt on noise.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.control(f.control({ type: 'input.suspend' }));
  f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'noise-turn' });
  await settle();
  expect(f.sink.invalidate).not.toHaveBeenCalled();
  resolveFinal();
  await settle();
  expect(f.sink.invalidate).not.toHaveBeenCalled();
});
