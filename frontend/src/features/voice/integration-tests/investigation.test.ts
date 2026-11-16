/**
 * ============================================================================
 * FILE: investigation.test.ts
 * LOCATION: frontend/src/features/voice/integration-tests/investigation.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Guard LiveKit disconnect behavior and absolute response cursor boundaries.
 *
 * ROLE IN PROJECT:
 *    Exercises the real frontend live client over Room doubles while retaining the
 *    standalone legacy PCM arithmetic check under an accurate non-live label.
 *
 * KEY COMPONENTS:
 *    - matrixFixture: LiveKit client/controller test harness.
 *    - AudioPlaybackService case: Legacy PCM helper arithmetic only.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { RoomEvent } from 'livekit-client';
import { matrixFixture } from './matrix-fixture.ts';
import { settle } from '../state/testing/live-voice-fixture.ts';
import { AudioPlaybackService } from '../audio/audio-playback-service.ts';
import { FakeContext } from '../audio/testing/audio-fakes.ts';

afterEach(() => vi.useRealTimers());

it('keeps a Room disconnect suspended for recovery instead of ending the session', async () => {
  const f = matrixFixture('granted');
  try {
    await f.begin();
    f.rtc.emit(RoomEvent.Disconnected);
    await settle();
    expect(f.controller.getSnapshot().phase).toBe('suspended');
    expect(f.http.end).not.toHaveBeenCalled();
  } finally { f.controller.exit(); await settle(); }
});

it('keeps exact samples in standalone legacy PCM playback arithmetic (not live WebRTC evidence)', async () => {
  const context = new FakeContext();
  const playback = new AudioPlaybackService(() => context.asContext());
  await playback.unlock();
  try {
    playback.begin('t', 'r');
    playback.enqueue('r', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(50) });
    playback.enqueue('r', { kind: 2, flags: 0, sequence: 1, offsetMs: 1, pcm: new Uint8Array(50) });
    context.currentTime = 1;
    expect(playback.progress()).toMatchObject({ consumedSamples: 50, playedSamples: 50 });
  } finally { await playback.dispose(); }
});

it('starts new-response progress at its explicit absolute sample coordinate', async () => {
  vi.useFakeTimers(); const f = matrixFixture('granted');
  try {
    await f.begin(); f.attach();
    f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
      firstAudioSequence: 0, firstAudioSample: 0 });
    f.event({ type: 'audio.watermark', turnId: 't1', responseId: 'r1', firstAudioSample: 0,
      queuedSamples: 2400, lastAudioSample: 2400, final: false });
    f.client().progress();
    await f.advance(100);
    expect(f.client().progress().playedSamples).toBe(2400);
    f.controller.interrupt(false);
    f.event({ type: 'audio.start', turnId: 't2', responseId: 'r2', sampleRate: 24000,
      firstAudioSequence: 1, firstAudioSample: 2424 });
    expect(f.client().progress().playedSamples).toBe(2424);
    await f.advance(100);
    const progress = f.rtc.packets().filter(packet => packet.type === 'playback.progress').at(-1);
    expect(progress).toMatchObject({ responseId: 'r2', playedSamples: 2424, playedMs: 101 });
  } finally { f.controller.exit(); await settle(); }
});
