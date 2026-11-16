/**
 * ============================================================================
 * FILE: livekit-voice-client.test.ts
 * LOCATION: frontend/src/api/livekit-voice-client.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic acceptance tests for the live LiveKit voice transport client.
 *
 * ROLE IN PROJECT:
 *    Proves admission fail-closure, reliable bounded control, epoch/sequence
 *    fencing, one native microphone, idempotent teardown, delegated playout
 *    progress, and bounded epoch reauthorization using structural SDK doubles
 *    only. No SFU, no browser permission, no network.
 *
 * KEY COMPONENTS:
 *    - rtcFixture()/liveSession(): shared deterministic Room, media, admission doubles.
 *    - envelope()/packets(): raw control framing helpers for fence cases.
 *    - it(...) cases: Admission, join, control, microphone, teardown, progress, recovery.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { RoomEvent } from 'livekit-client';
import type { LocalAudioTrack } from 'livekit-client';
import { session } from '../features/voice/transport/testing/voice-fakes.ts';
import { ApiClientError } from './client.ts';
import { liveSession, remoteAudioTrack, rtcFixture } from './testing/livekit-fakes.ts';
import { DEFAULT_VOICE_LIMITS, LIVEKIT_CONTROL_TOPIC } from './voice-protocol.ts';
import type { CreateVoiceSessionResponse } from './voice-protocol.ts';
import { LiveKitVoiceClient } from './livekit-voice-client.ts';

// Every case that arms a timer owns its own fake clock; real timers come back here.
afterEach(() => { vi.useRealTimers(); });

type Fixture = ReturnType<typeof rtcFixture>;

/** A raw server envelope so fence cases can break one field at a time. */
function envelope(sequence: number, extra: Record<string, unknown> = {},
  epoch = 1, sessionId = 'v1'): Record<string, unknown> {
  return { protocolVersion: 1, sessionId, connectionEpoch: epoch,
    eventId: `e${epoch}-${sequence}`, sequence, ...extra };
}

/** Delivers raw bytes through the same SDK event the transport listens on. */
function feed(f: Fixture, body: unknown, identity = 'aurvin-agent:v1',
  topic: string = LIVEKIT_CONTROL_TOPIC): void {
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(JSON.stringify(body));
  f.emit(RoomEvent.DataReceived, bytes, { identity }, 0, topic);
}

const state = { type: 'voice.state' as const, input: 'listening' as const,
  agent: 'idle' as const, connection: 'connected' as const };

it('requires an admitted live descriptor and never falls back to PCM WebSocket', async () => {
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  await expect(client.connect(session())).rejects.toThrow('VOICE_DISABLED');
  await expect(client.connect(session(1, 'dictation'))).rejects.toThrow('VOICE_DISABLED');
  expect(f.room.connect).not.toHaveBeenCalled();
  expect(f.microphone).not.toHaveBeenCalled();
  expect('sendInput' in client).toBe(false);
  await client.dispose();
});

it('joins the admitted Room and sends only reliable bounded control to its agent', async () => {
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  await client.prepare();
  await client.connect(liveSession());
  expect(f.room.connect).toHaveBeenCalledWith(liveSession().livekit.url,
    liveSession().livekit.participantToken, expect.objectContaining({ autoSubscribe: false }));
  expect(f.packets()[0]).toMatchObject({ type: 'session.start', mode: 'live',
    sessionId: 'v1', connectionEpoch: 1, sequence: 0 });
  expect(f.room.localParticipant.publishData).toHaveBeenCalledWith(expect.any(Uint8Array),
    { reliable: true, topic: 'aurvin.voice.control', destinationIdentities: ['aurvin-agent:v1'] });
  await client.dispose();
});

it('subscribes only the admitted agent audio publications, including later ones', async () => {
  const f = rtcFixture();
  const audio = { kind: 'audio', setSubscribed: vi.fn() };
  const video = { kind: 'video', setSubscribed: vi.fn() };
  const stranger = { kind: 'audio', setSubscribed: vi.fn() };
  f.room.remoteParticipants.set('aurvin-agent:v1',
    { identity: 'aurvin-agent:v1', trackPublications: new Map([['a', audio], ['v', video]]) });
  f.room.remoteParticipants.set('someone-else',
    { identity: 'someone-else', trackPublications: new Map([['s', stranger]]) });
  const client = new LiveKitVoiceClient(f.options);
  await client.prepare();
  await client.connect(liveSession());
  expect(audio.setSubscribed).toHaveBeenCalledWith(true);
  expect(video.setSubscribed).not.toHaveBeenCalled();
  expect(stranger.setSubscribed).not.toHaveBeenCalled();
  const later = { kind: 'audio', setSubscribed: vi.fn() };
  f.emit(RoomEvent.TrackPublished, later, { identity: 'aurvin-agent:v1' });
  expect(later.setSubscribed).toHaveBeenCalledWith(true);
  await client.dispose();
});

it('ignores other participants, other topics and old epochs but fences current sequence gaps', async () => {
  const f = rtcFixture();
  const event = vi.fn(), error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, event, error });
  await client.prepare();
  await client.connect(liveSession());
  f.event(state, 99, 1, 'unrelated');
  feed(f, envelope(99, state), 'aurvin-agent:v1', 'other.topic');
  f.event(state, 99, 0);
  expect(event).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  f.ready();
  f.event(state, 1);
  f.event(state, 1);
  expect(event).toHaveBeenCalledTimes(2);
  f.event(state, 3);
  expect(error).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledWith('VOICE_SEQUENCE_ERROR');
  await client.dispose();
});

it('fails a rejected async publish without advancing into a successful call', async () => {
  const f = rtcFixture();
  const error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, error });
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.room.localParticipant.publishData.mockRejectedValueOnce(new Error('PRIVATE_JWT_OR_PROVIDER_TEXT'));
  expect(client.control({ type: 'input.mute' })).toBe(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(error).toHaveBeenCalledWith('VOICE_CONNECT_TIMEOUT');
  expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE');
  await client.dispose();
});

it('fails a control envelope that names another session', async () => {
  const f = rtcFixture();
  const error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, error });
  await client.prepare();
  await client.connect(liveSession());
  feed(f, envelope(0, state, 1, 'v2'));
  expect(error).toHaveBeenCalledWith('VOICE_BINDING_MISMATCH');
  await client.dispose();
});

it('fails a control envelope from a future epoch', async () => {
  const f = rtcFixture();
  const error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, error });
  await client.prepare();
  await client.connect(liveSession());
  feed(f, envelope(0, state, 2));
  expect(error).toHaveBeenCalledWith('STALE_CONNECTION_EPOCH');
  await client.dispose();
});

it('fails malformed UTF-8 and an oversized packet without touching the Room', async () => {
  const malformed = rtcFixture();
  const bad = vi.fn();
  const first = new LiveKitVoiceClient({ ...malformed.options, error: bad });
  await first.prepare();
  await first.connect(liveSession());
  feed(malformed, new Uint8Array([0xff, 0xfe, 0xfd]));
  expect(bad).toHaveBeenCalledWith('INVALID_VOICE_CONTROL');
  await first.dispose();
  const oversized = rtcFixture();
  const huge = vi.fn();
  const second = new LiveKitVoiceClient({ ...oversized.options, error: huge });
  await second.prepare();
  await second.connect(liveSession());
  feed(oversized, new Uint8Array(15361));
  expect(huge).toHaveBeenCalledWith('INVALID_VOICE_CONTROL');
  // Only the session.start handshake left the client; the oversized frame was never republished.
  expect(oversized.room.localParticipant.publishData).toHaveBeenCalledTimes(1);
  await second.dispose();
});

it('fails a control that arrives before session.ready', async () => {
  const f = rtcFixture();
  const error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, error });
  await client.prepare();
  await client.connect(liveSession());
  feed(f, envelope(0, state));
  expect(error).toHaveBeenCalledWith('VOICE_INVALID_STATE');
  await client.dispose();
});

it('fails a ready that disagrees with the admitted limits or repeats one', async () => {
  const mismatched = rtcFixture();
  const limits = vi.fn();
  const first = new LiveKitVoiceClient({ ...mismatched.options, error: limits });
  await first.prepare();
  await first.connect(liveSession());
  feed(mismatched, envelope(0, { type: 'session.ready',
    limits: { ...liveSession().limits, connectMs: 12345 },
    effectiveAudioSettings: liveSession().effectiveAudioSettings }));
  expect(limits).toHaveBeenCalledWith('VOICE_INVALID_STATE');
  await first.dispose();
  const repeated = rtcFixture();
  const twice = vi.fn();
  const second = new LiveKitVoiceClient({ ...repeated.options, error: twice });
  await second.prepare();
  await second.connect(liveSession());
  repeated.ready();
  expect(twice).not.toHaveBeenCalled();
  feed(repeated, envelope(1, { type: 'session.ready', limits: liveSession().limits,
    effectiveAudioSettings: liveSession().effectiveAudioSettings }));
  expect(twice).toHaveBeenCalledWith('VOICE_INVALID_STATE');
  await second.dispose();
});

it('binds the conversation once and fails a conflicting binding', async () => {
  const f = rtcFixture();
  const error = vi.fn(), event = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, error, event });
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.event({ type: 'conversation.bound', conversationId: 'conv-1' }, 1);
  expect(event).toHaveBeenCalledTimes(2);
  f.event({ type: 'conversation.bound', conversationId: 'conv-2' }, 2);
  expect(error).toHaveBeenCalledWith('VOICE_BINDING_MISMATCH');
  await client.dispose();
});

it('fails the thirty-third queued control instead of growing the queue', async () => {
  const f = rtcFixture();
  const error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, error });
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.room.localParticipant.publishData.mockImplementation(() => new Promise<undefined>(() => undefined));
  for (let index = 0; index < 32; index += 1) {
    expect(client.control({ type: 'input.mute' })).toBe(true);
  }
  expect(client.control({ type: 'input.mute' })).toBe(false);
  expect(error).toHaveBeenCalledWith('AUDIO_BUFFER_OVERFLOW');
  await client.dispose();
});

it('forwards a nonterminal end but tears down exactly once on a terminal end', async () => {
  const f = rtcFixture();
  const event = vi.fn(), ended = vi.fn(), error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, event, ended, error });
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.event({ type: 'session.ended', reason: 'disconnected', terminal: false }, 1);
  expect(event).toHaveBeenCalledTimes(2);
  expect(ended).not.toHaveBeenCalled();
  expect(f.room.disconnect).not.toHaveBeenCalled();
  f.event({ type: 'session.ended', reason: 'completed', terminal: true }, 2);
  expect(ended).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
  f.event({ type: 'session.ended', reason: 'completed', terminal: true }, 3);
  expect(ended).toHaveBeenCalledTimes(1);
  expect(f.room.disconnect).toHaveBeenCalledTimes(1);
});

it('captures once in the gesture, publishes once, and reuses the mic on mute', async () => {
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  const preparing = client.prepare();
  expect(f.room.startAudio).toHaveBeenCalledTimes(1);
  expect(f.microphone).toHaveBeenCalledTimes(1);
  await preparing;
  await client.connect(liveSession());
  f.ready();
  expect(f.room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
  expect(f.room.localParticipant.publishTrack).toHaveBeenCalledWith(f.mic, { source: 'microphone' });
  expect(f.mediaTrack.enabled).toBe(false);
  await client.setInputEnabled(true);
  expect(f.mediaTrack.enabled).toBe(true);
  const muting = client.setInputEnabled(false);
  expect(f.mediaTrack.enabled).toBe(false);
  await muting;
  await client.setInputEnabled(true);
  expect(f.microphone).toHaveBeenCalledTimes(1);
  expect(f.mediaTrack.enabled).toBe(true);
  expect(f.room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
  expect(f.room.startAudio).toHaveBeenCalledTimes(1);
  expect(f.room.disconnect).not.toHaveBeenCalled();
  await client.dispose();
});

it('maps denied and unavailable capture without leaking the SDK text', async () => {
  const denied = rtcFixture();
  denied.microphone.mockRejectedValueOnce(new DOMException('PRIVATE_DEVICE', 'NotAllowedError'));
  const first = new LiveKitVoiceClient(denied.options);
  expect(String(await first.prepare().then(() => null, (reason: unknown) => reason)))
    .toBe('Error: MICROPHONE_DENIED');
  await first.dispose();
  const unavailable = rtcFixture();
  unavailable.microphone.mockRejectedValueOnce(new DOMException('PRIVATE_DEVICE', 'NotFoundError'));
  const second = new LiveKitVoiceClient(unavailable.options);
  expect(String(await second.prepare().then(() => null, (reason: unknown) => reason)))
    .toBe('Error: MICROPHONE_UNAVAILABLE');
  await second.dispose();
});

it('captures one microphone for concurrent prepare calls', async () => {
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  const first = client.prepare();
  const second = client.prepare();
  expect(f.microphone).toHaveBeenCalledTimes(1);
  expect(first).toBe(second);
  await Promise.all([first, second]);
  expect(f.room.startAudio).toHaveBeenCalledTimes(1);
  expect(f.mediaTrack.enabled).toBe(false);
  await client.dispose();
});

it('times out a hung capture and stops the late permission result', async () => {
  vi.useFakeTimers();
  const f = rtcFixture();
  let grant!: (track: LocalAudioTrack) => void;
  f.microphone.mockImplementationOnce(() => new Promise<LocalAudioTrack>(resolve => { grant = resolve; }));
  const client = new LiveKitVoiceClient(f.options);
  const preparing = client.prepare();
  const timedOut = expect(preparing).rejects.toThrow('CAPTURE_TIMEOUT');
  await vi.advanceTimersByTimeAsync(DEFAULT_VOICE_LIMITS.connectMs);
  await timedOut;
  grant(f.mic as unknown as LocalAudioTrack);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.mediaTrack.enabled).toBe(false);
  expect(f.mic.stop).toHaveBeenCalledTimes(1);
  expect(f.room.localParticipant.publishTrack).not.toHaveBeenCalled();
  await client.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels a permission grant that resolves after disposal', async () => {
  const f = rtcFixture();
  let grant!: (track: LocalAudioTrack) => void;
  f.microphone.mockImplementationOnce(() => new Promise<LocalAudioTrack>(resolve => { grant = resolve; }));
  const error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, error });
  const preparing = client.prepare();
  await client.dispose();
  grant(f.mic as unknown as LocalAudioTrack);
  await expect(preparing).rejects.toThrow('CAPTURE_CANCELLED');
  expect(f.mic.stop).toHaveBeenCalledTimes(1);
  expect(f.room.localParticipant.publishTrack).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

it('reports blocked playback instead of a usable call', async () => {
  const rejected = rtcFixture();
  rejected.room.startAudio.mockRejectedValueOnce(new Error('PRIVATE_AUTOPLAY'));
  const first = new LiveKitVoiceClient(rejected.options);
  expect(String(await first.prepare().then(() => null, (reason: unknown) => reason)))
    .toBe('Error: PLAYBACK_BLOCKED');
  await first.dispose();
  const silent = rtcFixture();
  silent.room.canPlaybackAudio = false;
  const second = new LiveKitVoiceClient(silent.options);
  expect(String(await second.prepare().then(() => null, (reason: unknown) => reason)))
    .toBe('Error: PLAYBACK_BLOCKED');
  await second.dispose();
});

it('retires a lost device without stopping output or the Room', async () => {
  const f = rtcFixture();
  const microphoneLost = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, microphoneLost });
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.emit(RoomEvent.TrackSubscribed, remoteAudioTrack(), {}, { identity: 'aurvin-agent:v1' });
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 }, 1);
  const pauses = f.audio.pause.mock.calls.length;
  f.mediaTrack.dispatchEvent(new Event('ended'));
  expect(microphoneLost).toHaveBeenCalledTimes(1);
  expect(f.room.disconnect).not.toHaveBeenCalled();
  expect(f.audio.pause.mock.calls.length).toBe(pauses);
  f.mediaTrack.dispatchEvent(new Event('ended'));
  expect(microphoneLost).toHaveBeenCalledTimes(1);
  expect(f.mediaTrack.enabled).toBe(false);
  await client.dispose();
});

it('reacquires a mic only through an explicit later prepare after stopInput', async () => {
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  client.stopInput();
  expect(f.mic.stop).toHaveBeenCalledTimes(1);
  expect(f.room.disconnect).not.toHaveBeenCalled();
  await client.setInputEnabled(false);
  await expect(client.setInputEnabled(true)).rejects.toThrow('MICROPHONE_LOST');
  await client.prepare();
  expect(f.microphone).toHaveBeenCalledTimes(2);
  expect(f.room.startAudio).toHaveBeenCalledTimes(2);
  expect(f.mediaTrack.enabled).toBe(false);
  await client.dispose();
  expect(f.mic.stop).toHaveBeenCalledTimes(2);
});

it('releases Room and local tracks once without waiting for permission or network', async () => {
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  await client.prepare();
  await client.connect(liveSession());
  const first = client.dispose();
  const second = client.dispose();
  expect(first).toBe(second);
  expect(f.mediaTrack.enabled).toBe(false);
  expect(f.mic.stop).toHaveBeenCalledTimes(1);
  expect(f.room.disconnect).toHaveBeenCalledTimes(1);
  expect(f.room.disconnect).toHaveBeenCalledWith(false);
  await Promise.all([first, second]);
  expect(f.room.disconnect).toHaveBeenCalledTimes(1);
  expect([...f.listeners.values()].every(set => set.size === 0)).toBe(true);
});

it('never publishes or sends after disposal while the Room join was pending', async () => {
  const f = rtcFixture();
  let resolve!: () => void;
  f.room.connect.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  const client = new LiveKitVoiceClient(f.options);
  await client.prepare();
  const joining = client.connect(liveSession());
  await client.dispose();
  resolve();
  await joining;
  expect(f.room.localParticipant.publishTrack).not.toHaveBeenCalled();
  expect(f.room.localParticipant.publishData).not.toHaveBeenCalled();
});

it('never attaches or plays a track that arrives after disposal', async () => {
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 }, 1);
  await client.dispose();
  const track = remoteAudioTrack();
  f.emit(RoomEvent.TrackSubscribed, track, {}, { identity: 'aurvin-agent:v1' });
  expect(track.attach).not.toHaveBeenCalled();
  expect(f.audio.play).not.toHaveBeenCalled();
  expect(client.progress().playedSamples).toBe(0);
});

it('observes a rejected Room disconnect without surfacing it', async () => {
  const f = rtcFixture();
  f.room.disconnect.mockRejectedValueOnce(new Error('PRIVATE_TRANSPORT'));
  const error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, error });
  await client.prepare();
  await client.connect(liveSession());
  await expect(client.dispose()).resolves.toBeUndefined();
  expect(error).not.toHaveBeenCalled();
});

it('does not infer samples from subscription, ready, start, end or advancing wall time', async () => {
  vi.useFakeTimers();
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.emit(RoomEvent.TrackSubscribed, remoteAudioTrack(), {}, { identity: 'aurvin-agent:v1' });
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 }, 1);
  await vi.advanceTimersByTimeAsync(1500);
  expect(client.progress().playedSamples).toBe(0);
  f.event({ type: 'audio.end', turnId: 't1', responseId: 'r1', lastAudioSequence: 0 }, 2);
  expect(client.isDrained()).toBe(false);
  await client.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('credits playout only up to the bound the watermark announced', async () => {
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  const track = remoteAudioTrack();
  f.emit(RoomEvent.TrackSubscribed, { kind: 'video' }, {}, { identity: 'aurvin-agent:v1' });
  f.emit(RoomEvent.TrackSubscribed, remoteAudioTrack(), {}, { identity: 'someone-else' });
  expect(f.audio.play).not.toHaveBeenCalled();
  f.emit(RoomEvent.TrackSubscribed, track, {}, { identity: 'aurvin-agent:v1' });
  expect(track.attach).toHaveBeenCalledTimes(1);
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 }, 1);
  f.event({ type: 'audio.watermark', turnId: 't1', responseId: 'r1', firstAudioSample: 0,
    queuedSamples: 2400, lastAudioSample: 2400, final: false }, 2);
  expect(client.progress().playedSamples).toBe(0);
  f.clock.value = 100;
  expect(client.progress()).toMatchObject({ playedSamples: 2400, playedMs: 100, proof: 'proven' });
  f.clock.value = 400;
  expect(client.progress().playedSamples).toBe(2400);
  await client.dispose();
});

it('drains only once the cursor reaches the committed final bound', async () => {
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.emit(RoomEvent.TrackSubscribed, remoteAudioTrack(), {}, { identity: 'aurvin-agent:v1' });
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 }, 1);
  f.event({ type: 'audio.watermark', turnId: 't1', responseId: 'r1', firstAudioSample: 0,
    queuedSamples: 4800, lastAudioSample: 4800, final: true }, 2);
  expect(client.progress().playedSamples).toBe(0);
  f.clock.value = 100;
  expect(client.progress().playedSamples).toBe(2400);
  expect(client.isDrained()).toBe(false);
  f.clock.value = 300;
  expect(client.progress().playedSamples).toBe(4800);
  expect(client.isDrained()).toBe(true);
  await client.dispose();
});

it('never advances a paused or muted element', async () => {
  const paused = rtcFixture();
  const first = new LiveKitVoiceClient(paused.options);
  await first.prepare();
  await first.connect(liveSession());
  paused.ready();
  paused.emit(RoomEvent.TrackSubscribed, remoteAudioTrack(), {}, { identity: 'aurvin-agent:v1' });
  paused.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 }, 1);
  paused.event({ type: 'audio.watermark', turnId: 't1', responseId: 'r1', firstAudioSample: 0,
    queuedSamples: 2400, lastAudioSample: 2400, final: true }, 2);
  paused.audio.paused = true;
  paused.clock.value = 100;
  expect(first.progress().playedSamples).toBe(0);
  expect(first.isDrained()).toBe(false);
  await first.dispose();
  const muted = rtcFixture();
  const second = new LiveKitVoiceClient(muted.options);
  await second.prepare();
  await second.connect(liveSession());
  muted.ready();
  muted.emit(RoomEvent.TrackSubscribed, remoteAudioTrack(), {}, { identity: 'aurvin-agent:v1' });
  muted.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 }, 1);
  muted.event({ type: 'audio.watermark', turnId: 't1', responseId: 'r1', firstAudioSample: 0,
    queuedSamples: 2400, lastAudioSample: 2400, final: true }, 2);
  muted.audio.muted = true;
  muted.clock.value = 100;
  expect(second.progress().playedSamples).toBe(0);
  await second.dispose();
});

it('silences the active response locally before any interrupt control', async () => {
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.emit(RoomEvent.TrackSubscribed, remoteAudioTrack(), {}, { identity: 'aurvin-agent:v1' });
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 }, 1);
  expect(f.audio.muted).toBe(false);
  client.invalidate('other');
  expect(f.audio.muted).toBe(false);
  client.invalidate('r1');
  expect(f.audio.muted).toBe(true);
  expect(f.audio.pause).toHaveBeenCalled();
  expect(client.progress().playedSamples).toBe(0);
  expect(client.isDrained()).toBe(false);
  f.event({ type: 'audio.start', turnId: 't2', responseId: 'r2', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 }, 2);
  expect(f.audio.muted).toBe(false);
  f.emit(RoomEvent.TrackUnsubscribed, { kind: 'audio' }, {}, { identity: 'aurvin-agent:v1' });
  expect(f.audio.muted).toBe(true);
  await client.dispose();
});

/** Drops an admitted Room, burns the first retry delay, and reports the failure codes seen. */
async function recoveryFailure(next: () => Promise<CreateVoiceSessionResponse>,
  prepare?: (f: Fixture) => void): Promise<string[]> {
  vi.useFakeTimers();
  const f = rtcFixture();
  const error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, reauthorize: next, error,
    random: () => 0.5 });
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  prepare?.(f);
  f.emit(RoomEvent.Disconnected);
  await vi.advanceTimersByTimeAsync(250);
  const codes = error.mock.calls.map(([code]) => String(code));
  await client.dispose();
  expect(vi.getTimerCount()).toBe(0);
  return codes;
}

it('reauthorizes a new epoch but never captures or replays during recovery', async () => {
  vi.useFakeTimers();
  const a = rtcFixture(), b = rtcFixture();
  const reauthorize = vi.fn(async () => liveSession(2));
  const recovered = vi.fn(), lost = vi.fn();
  const rooms = [a.options.room(), b.options.room()];
  const client = new LiveKitVoiceClient({ ...a.options, room: () => rooms.shift()!,
    reauthorize, recovered, lost, random: () => 0.5 });
  await client.prepare();
  await client.connect(liveSession());
  a.ready();
  a.emit(RoomEvent.Disconnected);
  expect(a.mediaTrack.enabled).toBe(false);
  expect(a.mic.stop).toHaveBeenCalledTimes(1);
  expect(lost).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(250);
  expect(reauthorize).toHaveBeenCalledWith(expect.objectContaining({ connectionEpoch: 1 }),
    expect.any(AbortSignal));
  b.ready(2);
  expect(recovered).toHaveBeenCalledWith(expect.objectContaining({ connectionEpoch: 2 }));
  a.ready();
  a.emit(RoomEvent.TrackSubscribed, {}, {}, { identity: 'aurvin-agent:v1' });
  expect(a.microphone).toHaveBeenCalledTimes(1);
  expect(b.room.localParticipant.publishTrack).not.toHaveBeenCalled();
  expect(client.progress().playedSamples).toBe(0);
  await client.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('gives up at the recovery deadline when reauthorization hangs', async () => {
  vi.useFakeTimers();
  const f = rtcFixture();
  const reauthorize = vi.fn(() => new Promise<CreateVoiceSessionResponse>(() => undefined));
  const error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, reauthorize, error, random: () => 0.5 });
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.emit(RoomEvent.Disconnected);
  await vi.advanceTimersByTimeAsync(liveSession().limits.reconnectMs);
  expect(reauthorize).toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith('VOICE_RECONNECT_TIMEOUT');
  await client.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps retrying a failed rejoin until the recovery deadline', async () => {
  vi.useFakeTimers();
  const a = rtcFixture(), b = rtcFixture();
  const rooms = [a.options.room(), b.options.room()];
  const error = vi.fn();
  let epoch = 1;
  b.room.connect.mockRejectedValue(new Error('PRIVATE_JOIN'));
  // Each attempt consumes a newer epoch; a failed join still burns the one it was admitted.
  const reauthorize = async () => liveSession(epoch += 1);
  const client = new LiveKitVoiceClient({ ...a.options, room: () => rooms.shift() ?? b.options.room(),
    reauthorize, error, random: () => 0.5 });
  await client.prepare();
  await client.connect(liveSession());
  a.ready();
  a.emit(RoomEvent.Disconnected);
  await vi.advanceTimersByTimeAsync(liveSession().limits.reconnectMs);
  expect(b.room.connect.mock.calls.length).toBeGreaterThan(1);
  expect(error).toHaveBeenCalledWith('VOICE_RECONNECT_TIMEOUT');
  expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE');
  await client.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('fails a non-retryable admission error instead of retrying it', async () => {
  const error = vi.fn();
  const reauthorize = vi.fn(async () => {
    throw new ApiClientError('VOICE_SESSION_ENDED', 'PRIVATE_ADMISSION', 410, false);
  });
  vi.useFakeTimers();
  const f = rtcFixture();
  const client = new LiveKitVoiceClient({ ...f.options, reauthorize, error, random: () => 0.5 });
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.emit(RoomEvent.Disconnected);
  await vi.advanceTimersByTimeAsync(250);
  expect(reauthorize).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledWith('VOICE_SESSION_ENDED');
  expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE');
  await client.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('rejects a stale, mismatched, descriptor-less, expired or rebound reauthorization', async () => {
  const invalid = (next: CreateVoiceSessionResponse) => () => Promise.resolve(next);
  expect(await recoveryFailure(invalid(liveSession(1)))).toEqual(['STALE_CONNECTION_EPOCH']);
  expect(await recoveryFailure(invalid({ ...liveSession(2), sessionId: 'v2' })))
    .toEqual(['STALE_CONNECTION_EPOCH']);
  expect(await recoveryFailure(invalid({ ...session(2) }))).toEqual(['STALE_CONNECTION_EPOCH']);
  expect(await recoveryFailure(invalid({ ...liveSession(3), livekit: liveSession(4).livekit })))
    .toEqual(['STALE_CONNECTION_EPOCH']);
  expect(await recoveryFailure(invalid({ ...liveSession(2), expiresAt: '2000-01-01T00:00:00.000Z' })))
    .toEqual(['STALE_CONNECTION_EPOCH']);
  expect(await recoveryFailure(invalid({ ...liveSession(2), conversationId: 'conv-2' }),
    f => f.event({ type: 'conversation.bound', conversationId: 'conv-1' }, 1)))
    .toEqual(['STALE_CONNECTION_EPOCH']);
});

it('aborts reauthorization on disposal and leaves no timers', async () => {
  vi.useFakeTimers();
  const f = rtcFixture();
  const error = vi.fn();
  const reauthorize = vi.fn((_previous: CreateVoiceSessionResponse, signal: AbortSignal) =>
    new Promise<CreateVoiceSessionResponse>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('PRIVATE_ABORT')));
    }));
  const client = new LiveKitVoiceClient({ ...f.options, reauthorize, error, random: () => 0.5 });
  await client.prepare();
  await client.connect(liveSession());
  f.ready();
  f.emit(RoomEvent.Disconnected);
  await vi.advanceTimersByTimeAsync(250);
  expect(reauthorize).toHaveBeenCalledTimes(1);
  await client.dispose();
  expect(reauthorize.mock.calls[0][1].aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(error).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('cannot publish or fail from an old generation after recovery', async () => {
  vi.useFakeTimers();
  const a = rtcFixture(), b = rtcFixture();
  const rooms = [a.options.room(), b.options.room()];
  const error = vi.fn();
  let reject!: (reason: Error) => void;
  const client = new LiveKitVoiceClient({ ...a.options, room: () => rooms.shift()!,
    reauthorize: async () => liveSession(2), error, random: () => 0.5 });
  await client.prepare();
  await client.connect(liveSession());
  a.ready();
  a.room.localParticipant.publishData.mockImplementationOnce(() =>
    new Promise<undefined>((_resolve, no) => { reject = no; }));
  expect(client.control({ type: 'input.mute' })).toBe(true);
  a.emit(RoomEvent.Disconnected);
  await vi.advanceTimersByTimeAsync(250);
  b.ready(2);
  reject(new Error('PRIVATE_PUBLISH'));
  await vi.advanceTimersByTimeAsync(0);
  expect(error).not.toHaveBeenCalled();
  expect(b.room.localParticipant.publishData).toHaveBeenCalledTimes(1);
  await client.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('ignores an old Room join that resolves after recovery', async () => {
  vi.useFakeTimers();
  const a = rtcFixture(), b = rtcFixture();
  const rooms = [a.options.room(), b.options.room()];
  const error = vi.fn();
  let resolveA!: () => void;
  a.room.connect.mockImplementationOnce(() => new Promise<void>(done => { resolveA = done; }));
  const client = new LiveKitVoiceClient({ ...a.options, room: () => rooms.shift()!,
    reauthorize: async () => liveSession(2), error, random: () => 0.5 });
  await client.prepare();
  const joining = client.connect(liveSession());
  a.emit(RoomEvent.Disconnected);
  await vi.advanceTimersByTimeAsync(250);
  b.ready(2);
  resolveA();
  await joining;
  expect(a.room.localParticipant.publishData).not.toHaveBeenCalled();
  expect(a.room.localParticipant.publishTrack).not.toHaveBeenCalled();
  expect(b.room.localParticipant.publishData).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
  await client.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
