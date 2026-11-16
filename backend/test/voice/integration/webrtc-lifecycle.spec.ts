/**
 * ============================================================================
 * FILE: webrtc-lifecycle.spec.ts
 * LOCATION: backend/test/voice/integration/webrtc-lifecycle.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Guard integrated LiveKit proof, quiet-input, interruption, and terminal lifecycle.
 *
 * ROLE IN PROJECT:
 *    Exercises the assembled in-memory voice runtime and P2/P3 bridge over deterministic
 *    LiveKit Room doubles, keeping fixture evidence distinct from service/device evidence.
 *
 * KEY COMPONENTS:
 *    - Proof barriers: Unproven progress and pending terminal persistence.
 *    - Lifecycle controls: Quiet input, pause/end, interruption, and transport loss.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { canvasPipeline } from './canvas-multimodal-fixture.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function finalWatermark(f: Awaited<ReturnType<typeof canvasPipeline>>) {
  const ref = f.ref();
  f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'canvas-speech',
    audioDurationMs: 100,
    usage: { providerRequestId: null, model: 'fixture', modelVersion: null,
      audioMs: 100, billableCharacters: 12 } });
  await f.until(() => f.events.some(event => event.type === 'audio.watermark' && event.final &&
    event.responseId === ref.responseId));
  const final = f.events.findLast(event => event.type === 'audio.watermark' && event.final &&
    event.responseId === ref.responseId);
  if (!final || final.type !== 'audio.watermark') throw new Error('Missing final fixture watermark');
  return { ref, final };
}

it('quiet frames stop STT uploads without accepting an empty turn', async () => {
  vi.useFakeTimers();
  const f = await canvasPipeline();
  try {
    await f.begin(false);
    const silence = new Int16Array(1280);
    let suspendedAt = 0;
    for (let frame = 1; frame <= 64; frame++) {
      f.microphone(silence);
      await f.tick(80);
      if (f.events.some(event => event.type === 'voice.state' && event.input === 'suspended')) {
        suspendedAt = frame * 80;
        break;
      }
    }
    expect(suspendedAt).toBeGreaterThanOrEqual(5000);
    expect(suspendedAt).toBeLessThanOrEqual(5080);
    const uploads = vi.mocked(f.stt.connection.writeAudio).mock.calls.length;
    for (let frame = 0; frame < 100; frame++) {
      f.microphone(silence);
      await f.tick(80);
    }
    expect(f.stt.connection.writeAudio).toHaveBeenCalledTimes(uploads);
    expect(f.h.fetcher).not.toHaveBeenCalled();
    expect(await f.messages()).toEqual([]);
    const beforeResume = vi.mocked(f.stt.connection.writeAudio).mock.calls.length;
    f.microphone(new Int16Array(1280).fill(1000));
    await f.tick(80);
    await f.until(() => f.events.some(event => event.type === 'voice.state' && event.input === 'listening'));
    expect(f.stt.connection.writeAudio.mock.calls.length).toBeGreaterThan(beforeResume);
    expect(f.events.filter(event => event.type === 'session.ready')).toHaveLength(1);
  } finally { await f.close(); }
}, 30000);

it('unproven generated-ceiling ACK cannot persist completed heard delivery', async () => {
  vi.useFakeTimers();
  const f = await canvasPipeline();
  try {
    await f.begin(); await f.push('Hello world.'); await f.endModel(); await f.audio(2400);
    const { ref, final } = await finalWatermark(f);
    expect((await f.delivery())?.status).not.toBe('completed');
    await f.control({ type: 'playback.progress', ...ref, playedSamples: final.lastAudioSample,
      playedMs: Math.floor(final.lastAudioSample / 24), proof: 'unproven' });
    await f.tick(100);
    expect((await f.delivery())?.status).not.toBe('completed');
    expect((await f.delivery())?.textSpoken).toBeNull();
  } finally { await f.close(); }
}, 30000);

it('proven fixture ACK waits for terminal persistence before releasing the response', async () => {
  vi.useFakeTimers();
  const f = await canvasPipeline();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let blockedOnce = false;
  try {
    await f.begin(); await f.push('Hello world.'); await f.endModel(); await f.audio(2400);
    const { ref, final } = await finalWatermark(f);
    const compare = f.h.p.metadata.compareVoiceDelivery.bind(f.h.p.metadata);
    vi.spyOn(f.h.p.metadata, 'compareVoiceDelivery').mockImplementation(async (record, revision) => {
      if (record.status === 'completed' && !blockedOnce) {
        blockedOnce = true; entered(); await gate;
      }
      return compare(record, revision);
    });
    await f.control({ type: 'playback.progress', ...ref, playedSamples: final.lastAudioSample,
      playedMs: Math.floor(final.lastAudioSample / 24), proof: 'proven' });
    await f.until(() => blockedOnce);
    expect((await f.delivery())?.status).not.toBe('completed');
    expect(f.bridge().currentResponse()).not.toBeNull();
    release();
    await f.until(() => f.bridge().currentResponse() === null);
    expect((await f.delivery())?.status).toBe('completed');
    expect(f.h.fetcher).toHaveBeenCalledTimes(1);
  } finally { release(); await f.close(); }
}, 30000);

it('a paused quota session accepts end and tears down the Room and providers once', async () => {
  vi.useFakeTimers();
  const f = await canvasPipeline();
  try {
    await f.begin(false);
    const room = f.epoch.rtc.rooms[0]!;
    f.epoch.bridge.pause('VOICE_QUOTA_EXHAUSTED', false);
    await f.tick(10);
    expect(f.events.some(event => event.type === 'session.error' && event.code === 'VOICE_QUOTA_EXHAUSTED')).toBe(true);
    await f.control({ type: 'session.end' });
    await f.tick(2500);
    await f.sessions.end(f.binding.response.sessionId);
    await f.sessions.drain();
    expect(room.disconnect).toHaveBeenCalledOnce();
    expect(f.media.roomClient.deleteRoom).toHaveBeenCalledOnce();
    expect(f.stt.connection.close).toHaveBeenCalledOnce();
    expect(f.tts.connection.close).toHaveBeenCalledOnce();
    expect(f.h.fetcher).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 30000);

it('transport loss cannot turn generated text into heard text or replay inference', async () => {
  vi.useFakeTimers();
  const f = await canvasPipeline();
  try {
    await f.begin(); await f.push('Hello world.'); await f.endModel(); await f.audio(2400);
    f.epoch.rtc.rooms[0]!.emit('disconnected');
    await f.tick(2500);
    const delivery = await f.delivery();
    expect(delivery).toMatchObject({ status: 'unknown', textSpoken: null });
    expect(f.h.fetcher).toHaveBeenCalledTimes(1);
  } finally { await f.close(); }
}, 30000);

it('interrupt invalidates output before cancellation and rejects late provider audio', async () => {
  vi.useFakeTimers();
  const f = await canvasPipeline();
  const order: string[] = [];
  let originalCancel: typeof f.h.runtime.cancelLiveTurn;
  try {
    await f.begin(); await f.push('Hello world.'); await f.endModel(); await f.audio(2400);
    const ref = f.ref();
    await f.until(() => f.events.some(event => event.type === 'audio.watermark' && event.responseId === ref.responseId));
    await f.control({ type: 'playback.progress', ...ref, playedSamples: 1200, playedMs: 50, proof: 'proven' });
    await f.tick(0);
    f.source.clearQueue.mockImplementation(() => { order.push('clear'); });
    originalCancel = f.h.runtime.cancelLiveTurn.bind(f.h.runtime);
    vi.spyOn(f.h.runtime, 'cancelLiveTurn').mockImplementation(async (...args) => {
      order.push('cancel'); return originalCancel(...args);
    });
    await f.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 });
    await f.until(() => order.includes('cancel'));
    expect(order.indexOf('clear')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('clear')).toBeLessThan(order.indexOf('cancel'));
    f.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'canvas-speech', audioPlayedMs: 50,
      textSpoken: 'Hello', textRemaining: ' world.', usage: { providerRequestId: null,
        model: 'fixture', modelVersion: null, audioMs: 100, billableCharacters: 12 } });
    await f.until(() => f.bridge().currentResponse() === null);
    const captured = f.source.captureFrame.mock.calls.length;
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    await f.tick(0);
    expect(f.source.captureFrame).toHaveBeenCalledTimes(captured);
    expect((await f.delivery())?.status).toBe('interrupted');
  } finally { await f.close(); }
}, 30000);
