/**
 * ============================================================================
 * FILE: webrtc-voice.spec.ts
 * LOCATION: backend/test/benchmark/webrtc-voice.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Exercise the headless LiveKit receipt path with deterministic SDK fakes.
 *
 * ROLE IN PROJECT:
 *    Proves decoded onset is measured without fabricating playback or loading
 *    native FFI, and that every invalid/reordered/partial case fails closed.
 *
 * KEY COMPONENTS:
 *    - SDK module fake: Room, AudioSource, AudioStream, track classes.
 *    - Negative matrix: transport, control, media, timeout and confirmation.
 * ============================================================================
 */
import type { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { RemoteAudioTrack } from '@livekit/rtc-node';
import { createSessionResponseFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { INPUT_AUDIO, LIVEKIT_CONTROL_TOPIC } from '../../src/contracts/voice-wire.js';
import { benchmarkConfigSchema, type WireResult } from '../../src/benchmark/runner.js';
import { runWebRtcVoice } from '../../src/benchmark/webrtc-voice.js';

const fake = vi.hoisted(() => ({ room: undefined as unknown, source: undefined as unknown,
  received: undefined as unknown, capture: vi.fn(), disconnect: vi.fn(),
  close: vi.fn(), sourceOptions: [] as number[], queuedDuration: 0, streamOptions: undefined as unknown,
  connectMode: 'ok' as 'ok' | 'never' | 'late', sent: [] as Record<string, unknown>[] }));
vi.mock('@livekit/rtc-node', async () => {
  const { EventEmitter } = await import('node:events');
  class Room extends EventEmitter {
    localParticipant = { publishTrack: vi.fn(async () => ({})),
      publishData: vi.fn(async (bytes: Uint8Array, options: unknown) => {
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        fake.sent.push({ ...payload, options });
      }) };
    name = 'aurvin-live-voice-1';
    connect = vi.fn(async () => {
      if (fake.connectMode === 'never') await new Promise(() => undefined);
      if (fake.connectMode === 'late') await new Promise<void>(yes => setTimeout(yes, 5000));
    });
    disconnect = fake.disconnect;
    constructor() { super(); fake.room = this; }
  }
  class AudioSource {
    captureFrame = fake.capture;
    get queuedDuration() { return fake.queuedDuration; }
    clearQueue = vi.fn();
    close = fake.close;
    constructor(...options: number[]) { fake.source = this; fake.sourceOptions = options; }
  }
  class AudioFrame {
    constructor(public data: Int16Array, public sampleRate: number,
      public channels: number, public samplesPerChannel: number) {}
  }
  class RemoteAudioTrack {}
  class AudioStream extends ReadableStream {
    constructor(_track: unknown, options: unknown) {
      super({ start(controller) { fake.received = controller; } });
      fake.streamOptions = options;
    }
  }
  return { Room, AudioSource, AudioFrame, AudioStream, RemoteAudioTrack,
    LocalAudioTrack: { createAudioTrack: vi.fn(() => ({})) },
    TrackPublishOptions: class { constructor(value: object) { Object.assign(this, value); } },
    TrackSource: { SOURCE_MICROPHONE: 2 },
    RoomEvent: { DataReceived: 'dataReceived', TrackSubscribed: 'trackSubscribed',
      Disconnected: 'disconnected', Reconnecting: 'reconnecting', TrackUnsubscribed: 'trackUnsubscribed',
      TrackSubscriptionFailed: 'trackSubscriptionFailed' } };
});
vi.mock('node:timers/promises', () => ({
  setTimeout: (ms: number, value?: unknown, options?: { signal?: AbortSignal }) => {
    if (options?.signal?.aborted) return Promise.reject(new Error('fixture-aborted'));
    if (ms <= 0) return Promise.resolve(value);
    return new Promise((yes, no) => {
      const abort = () => { clearTimeout(timer); no(new Error('fixture-aborted')); };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener('abort', abort); yes(value);
      }, ms);
      if (options?.signal?.aborted) abort();
      else options?.signal?.addEventListener('abort', abort, { once: true });
    });
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  fake.connectMode = 'ok';
  fake.sent.length = 0;
  fake.streamOptions = undefined;
  fake.received = undefined;
  fake.room = undefined;
  fake.source = undefined;
  fake.queuedDuration = 0;
  fake.capture.mockReset();
});

const agent = 'aurvin-agent:voice-1';
const base = { transport: 'webrtc', start: '2026-11-06T10:00:00Z', end: '2026-11-06T11:00:00Z',
  timeZone: 'Etc/UTC', speechEndMs: 10, timeoutMs: 2000 } as const;

type Harness = Awaited<ReturnType<typeof begin>>;

async function begin(options: { pcm?: Uint8Array;
  confirmDelivery?: (wire: WireResult) => Promise<boolean> } = {}) {
  vi.useFakeTimers();
  const session = createSessionResponseFixture('live');
  const config = benchmarkConfigSchema.parse(base);
  const result: WireResult = { durationMs: 0, firstTextMs: null, acceptanceMs: 0,
    firstAudioMs: null, speechEndToFirstAudioMs: null, outcome: 'failed' };
  const stop = new AbortController();
  setTimeout(() => stop.abort(), config.timeoutMs);
  const work = runWebRtcVoice({ config, pcm: options.pcm ?? new Uint8Array(64000), session,
    result, started: performance.now(), signal: stop.signal,
    confirmDelivery: options.confirmDelivery ? wire => options.confirmDelivery!(wire) : undefined });
  await vi.advanceTimersByTimeAsync(0);
  const room = fake.room as EventEmitter;
  let sequence = 0;
  const readyEvent = { type: 'session.ready', limits: session.limits,
    effectiveAudioSettings: { input: INPUT_AUDIO, output: session.effectiveAudioSettings.output } };
  const control = (payload: Record<string, unknown>,
    envelope: { identity?: string; sessionId?: string; sequence?: number; topic?: string } = {}) => {
    const seq = envelope.sequence ?? sequence++;
    room.emit('dataReceived', new TextEncoder().encode(JSON.stringify({
      protocolVersion: 1, sessionId: envelope.sessionId ?? session.sessionId,
      connectionEpoch: session.connectionEpoch, eventId: `e-${seq}-${sequence}`, sequence: seq, ...payload,
    })), { identity: envelope.identity ?? agent }, 0, envelope.topic ?? LIVEKIT_CONTROL_TOPIC);
  };
  const ready = () => control(readyEvent);
  const subscribe = () => room.emit('trackSubscribed', Object.create(RemoteAudioTrack.prototype), {},
    { identity: agent });
  const decoded = () => fake.received as ReadableStreamDefaultController;
  const frame = (samples: number[], sampleRate = 24000, channels = 1) =>
    decoded().enqueue({ data: new Int16Array(samples), sampleRate, channels });
  const start = (turnId = 't', responseId = 'r') =>
    control({ type: 'audio.start', turnId, responseId, sampleRate: 24000, firstAudioSequence: 0 });
  const finish = async (ms = 3000) => { await vi.advanceTimersByTimeAsync(ms); await work; };
  return { session, config, result, room, control, readyEvent, ready, subscribe, decoded, frame,
    start, finish, stop, work };
}

async function flowing(h: Harness) {
  h.ready();
  await vi.advanceTimersByTimeAsync(160);
  h.subscribe();
  h.start();
  h.frame([0]);
  await vi.advanceTimersByTimeAsync(20);
  h.frame([1]);
  await vi.advanceTimersByTimeAsync(20);
}

it('uses bounded SDK buffering for exact 80 ms little-endian PCM frames', async () => {
  const pcm = new Uint8Array(2562);
  const view = new DataView(pcm.buffer);
  view.setInt16(0, -32768, true);
  view.setInt16(2558, 32767, true);
  view.setInt16(2560, -7, true);
  fake.capture.mockImplementation(async (frame: { samplesPerChannel: number }) => {
    // Installed native direct capture only admits 10 ms; buffering admits 80 ms.
    if (fake.sourceOptions[2] === 0 && frame.samplesPerChannel !== 160)
      throw new Error('direct capture requires 160 samples');
  });
  const h = await begin({ pcm });
  h.ready();
  await vi.advanceTimersByTimeAsync(80);
  expect(fake.sourceOptions).toEqual([16000, 1, 1000]);
  expect(fake.capture).toHaveBeenCalledTimes(2);
  const frames = fake.capture.mock.calls.map(call => call[0]);
  expect(frames[0]).toMatchObject({ sampleRate: 16000, channels: 1, samplesPerChannel: 1280 });
  expect(frames[0].data[0]).toBe(-32768);
  expect(frames[0].data[1279]).toBe(32767);
  expect(Array.from(frames[1].data)).toEqual([-7, ...Array.from({ length: 1279 }, () => 0)]);
  await h.finish();
});

it.each([921, NaN, Infinity, -1])('rejects invalid or overflowing input queue %s before capture', async queued => {
  const h = await begin();
  fake.queuedDuration = queued;
  h.ready();
  await h.finish();
  expect(fake.capture).not.toHaveBeenCalled();
  expect(h.result).toMatchObject({ completed: false, failureCode: 'BENCHMARK_MEDIA_FAILED', inputAudioMs: 0 });
  expect(fake.close).toHaveBeenCalledTimes(1);
  expect(fake.disconnect).toHaveBeenCalledTimes(1);
});

it('admits a frame exactly within queue capacity and reports the SDK queue estimate', async () => {
  const h = await begin({ pcm: new Uint8Array(2560) });
  fake.queuedDuration = 920;
  h.ready();
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.capture).toHaveBeenCalledTimes(1);
  expect(h.result.maxInputQueuedMs).toBe(920);
  await h.finish();
});

it('keeps the 80 ms lateness guard with buffered input and sends no catch-up burst', async () => {
  const h = await begin();
  h.ready();
  await vi.advanceTimersByTimeAsync(0);
  // Move the monotonic fixture clock while the next absolute deadline is waiting.
  vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 161);
  await h.finish();
  vi.restoreAllMocks();
  expect(fake.capture).toHaveBeenCalledTimes(1);
  expect(h.result).toMatchObject({ completed: false, failureCode: 'BENCHMARK_MEDIA_FAILED' });
});

it('publishes microphone PCM in real time but never fabricates playback from decoded frames', async () => {
  const h = await begin();
  h.ready();
  await vi.advanceTimersByTimeAsync(160);
  expect(fake.capture).toHaveBeenCalledTimes(3); // deadlines 0, 80, 160, not burst submission
  h.subscribe();
  expect(fake.streamOptions).toEqual({ sampleRate: 24000, numChannels: 1 });
  h.start();
  expect(h.result.firstAudioMs).toBeNull();
  h.frame([0]);
  await vi.advanceTimersByTimeAsync(20);
  h.frame([1]);
  await vi.advanceTimersByTimeAsync(20);
  h.control({ type: 'audio.end', turnId: 't', responseId: 'r', lastAudioSequence: 0 });
  await h.finish(2000);
  expect(h.result.firstAudioMs).toBeGreaterThan(0);
  expect(h.result.completed).not.toBe(true);
  expect(h.result.speechEndToPlaybackEndMs).toBeNull();
  expect(h.result.firstMediaReceiptMs).toBeNull();
  expect(h.result.firstTrackScheduledMs).toBeNull();
  expect(h.result.firstAudibleMs).toBeNull();
  expect(h.result.failureCode).toBe('BENCHMARK_UNPROVEN_PLAYBACK');
  expect(fake.sent.some(event => event.type === 'playback.progress')).toBe(false);
  const startEvent = fake.sent.find(event => event.type === 'session.start');
  expect(startEvent).toBeDefined();
  expect((startEvent!.options as { destination_identities?: string[] }).destination_identities).toEqual([agent]);
  expect(fake.disconnect).toHaveBeenCalledTimes(1);
  expect(fake.close).toHaveBeenCalledTimes(1);
});

it('confirms completion only when the external callback proves this turn after valid onset', async () => {
  let calls = 0, observed: WireResult | undefined;
  const h = await begin({ confirmDelivery: async wire => {
    calls++; observed = { ...wire };
    return true;
  } });
  await flowing(h);
  h.control({ type: 'audio.end', turnId: 't', responseId: 'r', lastAudioSequence: 0 });
  await h.finish(2000);
  expect(calls).toBe(1);
  expect(observed).toMatchObject({ turnId: 't', firstAudioMs: expect.any(Number) });
  expect(h.result).toMatchObject({ completed: true, outcome: 'completed' });
  expect(h.result.durableCompletionMs).toBeTypeOf('number');
  expect(fake.sent.some(event => event.type === 'playback.progress')).toBe(false);
});

it('keeps an onset-only run unverified when the external callback declines', async () => {
  const h = await begin({ confirmDelivery: async () => false });
  await flowing(h);
  h.control({ type: 'audio.end', turnId: 't', responseId: 'r', lastAudioSequence: 0 });
  await h.finish(2000);
  expect(h.result.firstAudioMs).toBeTypeOf('number');
  expect(h.result.completed).not.toBe(true);
  expect(h.result.outcome).toBe('unverified');
  expect(h.result.durableCompletionMs).toBeNull();
  expect(h.result.failureCode).toBe('BENCHMARK_UNPROVEN_PLAYBACK');
});

it.each([
  ['a foreign sender', (h: Harness) => h.control(h.readyEvent, { identity: 'intruder' })],
  ['a wrong admitted session', (h: Harness) => h.control(h.readyEvent, { sessionId: 'other' })],
  ['malformed control bytes', (h: Harness) => h.room.emit('dataReceived', Uint8Array.of(0xff),
    { identity: agent }, 0, LIVEKIT_CONTROL_TOPIC)],
  ['a replayed control sequence', (h: Harness) => {
    h.ready(); h.control({ type: 'session.ready' }, { sequence: 0 }); }],
  ['a second audio.start', async (h: Harness) => {
    h.ready(); await vi.advanceTimersByTimeAsync(160); h.subscribe(); h.start(); h.start('t2', 'r2'); }],
  ['a mismatched audio.end turn', async (h: Harness) => {
    h.ready(); await vi.advanceTimersByTimeAsync(160); h.subscribe(); h.start(); h.frame([1]);
    h.control({ type: 'audio.end', turnId: 'other', responseId: 'r', lastAudioSequence: 0 }); }],
  ['a reconnect', (h: Harness) => { h.ready(); h.room.emit('reconnecting'); }],
  ['a track unsubscribe', (h: Harness) => { h.ready(); h.room.emit('trackUnsubscribed', {}, {}); }],
  ['decoded EOF', async (h: Harness) => {
    h.ready(); await vi.advanceTimersByTimeAsync(160); h.subscribe(); h.start(); h.frame([1]);
    h.decoded().close(); }],
  ['a second assistant track', async (h: Harness) => {
    h.ready(); await vi.advanceTimersByTimeAsync(160); h.subscribe(); h.subscribe(); }],
  ['a wrong decoded rate', async (h: Harness) => {
    h.ready(); await vi.advanceTimersByTimeAsync(160); h.subscribe(); h.start(); h.frame([1], 16000, 1); }],
  ['a response cancellation', (h: Harness) => {
    h.ready(); h.control({ type: 'response.cancelled', turnId: 't', responseId: 'r', lastAudioSequence: null }); }],
])('fails closed on %s without playback progress or completion', async (_name, act) => {
  const h = await begin();
  await Promise.resolve(act(h));
  await h.finish(3000);
  expect(h.result).toMatchObject({ completed: false });
  expect(h.result.outcome).not.toBe('completed');
  expect(h.result.speechEndToPlaybackEndMs).toBeNull();
  expect(fake.sent.some(event => event.type === 'playback.progress')).toBe(false);
  expect(fake.close).toHaveBeenCalledTimes(1);
  expect(fake.disconnect).toHaveBeenCalledTimes(1);
});

it('bounds a connect that never settles and records a timeout without cleanup proof', async () => {
  fake.connectMode = 'never';
  const h = await begin();
  await h.finish(3000);
  expect(h.result).toMatchObject({ completed: false, outcome: 'timeout',
    failureCode: 'BENCHMARK_TIMEOUT' });
  expect(fake.disconnect).not.toHaveBeenCalled();
  expect(fake.close).toHaveBeenCalledTimes(1);
});

it('tears down a join that resolves after the deadline exactly once', async () => {
  fake.connectMode = 'late';
  const h = await begin();
  await h.finish(6000);
  expect(h.result).toMatchObject({ completed: false, outcome: 'timeout',
    failureCode: 'BENCHMARK_TIMEOUT' });
  expect(fake.disconnect).toHaveBeenCalledTimes(1);
  expect(fake.close).toHaveBeenCalledTimes(1);
});

it('rejects invalid PCM and a legacy WebSocket descriptor before native setup', async () => {
  const session = createSessionResponseFixture('dictation');
  const config = benchmarkConfigSchema.parse({ ...base, speechEndMs: 10 });
  const result: WireResult = { durationMs: 0, firstTextMs: null, acceptanceMs: 0, outcome: 'failed' };
  await expect(runWebRtcVoice({ config, pcm: new Uint8Array(64), session: session as never,
    result, started: 0, signal: new AbortController().signal }))
    .rejects.toThrow('BENCHMARK_TRANSPORT_MISMATCH');
});
