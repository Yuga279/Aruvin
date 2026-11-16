/**
 * ============================================================================
 * FILE: live-track-playback.test.ts
 * LOCATION: frontend/src/features/voice/audio/live-track-playback.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic acceptance tests for the LiveKit remote-track playback helper.
 *
 * ROLE IN PROJECT:
 *    Proves immediate local silence, fresh per-response output boundaries, bounded
 *    and fractional 24 kHz played-sample accounting, and the drain/proof rules the
 *    live WebRTC controller depends on. Structural media doubles only; no browser.
 *
 * KEY COMPONENTS:
 *    - makeAudio()/audioFixture(): Counting structural audio-element factories.
 *    - playing(): A started response with a live track and an observed output.
 *    - it(...) cases: Teardown, mounting, sample math, proof, watermark and drain.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { RoomEvent, type RemoteAudioTrack } from 'livekit-client';
import { isLiveKitVoiceSessionResponse, isVoiceServerEvent,
  parseVoiceControl } from '../../../api/voice-protocol.ts';
import { liveSession, remoteAudioTrack, rtcFixture } from '../../../api/testing/livekit-fakes.ts';
import { LiveTrackPlayback, type LiveTrackPlaybackOptions } from './live-track-playback.ts';

function makeAudio() {
  const element = Object.assign(new EventTarget(), {
    muted: true, paused: true, readyState: 4, error: null as Error | null,
    srcObject: null as unknown, currentTime: 0, volume: 1,
    play: vi.fn(), pause: vi.fn(), remove: vi.fn(),
  });
  element.play.mockImplementation(async () => { element.paused = false; });
  element.pause.mockImplementation(() => { element.paused = true; });
  return element;
}

type AudioDouble = ReturnType<typeof makeAudio>;

function audioFixture() {
  const elements: AudioDouble[] = [];
  const factory = () => {
    const element = makeAudio();
    elements.push(element);
    return element as unknown as HTMLAudioElement;
  };
  return { factory, elements };
}

const asTrack = (track: ReturnType<typeof remoteAudioTrack>) => track as unknown as RemoteAudioTrack;

/** A response whose bound is announced, whose track arrives, and whose output is observed. */
function playing(options: LiveTrackPlaybackOptions = {}) {
  const clock = { value: 0 };
  const { factory, elements } = audioFixture();
  const track = remoteAudioTrack();
  const playback = new LiveTrackPlayback(factory, { now: () => clock.value, ...options });
  playback.begin('t1', 'r1', 0);
  playback.watermark({ type: 'audio.watermark', turnId: 't1', responseId: 'r1',
    firstAudioSample: 0, queuedSamples: 4800, lastAudioSample: 4800, final: false });
  playback.attach(asTrack(track));
  playback.progress();
  return { playback, elements, track, clock,
    advance: (ms: number) => { clock.value += ms; return playback.progress(); } };
}

it('silences and detaches output synchronously before asynchronous transport cleanup', () => {
  const f = rtcFixture();
  const track = { attach: vi.fn(), detach: vi.fn(), setVolume: vi.fn() };
  const playback = new LiveTrackPlayback(f.options.element);
  playback.attach(track as unknown as RemoteAudioTrack);
  playback.attach(track as unknown as RemoteAudioTrack);
  expect(track.attach).toHaveBeenCalledTimes(1);
  expect(f.audio.muted).toBe(true);
  expect(f.audio.play).not.toHaveBeenCalled();
  f.audio.muted = false;
  playback.interrupt();
  expect(f.audio.muted).toBe(true);
  expect(f.audio.pause).toHaveBeenCalledTimes(1);
  expect(track.detach).toHaveBeenCalledTimes(1);
  expect(f.audio.srcObject).toBeNull();
  expect(f.audio.remove).toHaveBeenCalledTimes(1);
  playback.dispose();
  playback.dispose();
  expect(track.detach).toHaveBeenCalledTimes(1);
  expect(f.audio.remove).toHaveBeenCalledTimes(1);
});

it('unmutes and plays on begin, and mounts a fresh element for the next response', () => {
  const { factory, elements } = audioFixture();
  const track = remoteAudioTrack();
  const playback = new LiveTrackPlayback(factory);
  playback.attach(asTrack(track));
  expect(elements).toHaveLength(1);
  expect(elements[0].muted).toBe(true);
  expect(elements[0].play).not.toHaveBeenCalled();
  playback.begin('t1', 'r1', 0);
  expect(elements).toHaveLength(2);
  expect(elements[1].muted).toBe(false);
  expect(elements[1].play).toHaveBeenCalledTimes(1);
  playback.interrupt();
  expect(elements[1].muted).toBe(true);
  expect(elements[1].remove).toHaveBeenCalledTimes(1);
  playback.begin('t2', 'r2', 2400);
  expect(elements).toHaveLength(3);
  expect(elements[1].muted).toBe(true);
  expect(elements[1].play).toHaveBeenCalledTimes(1);
  expect(elements[2].muted).toBe(false);
  expect(elements[2].play).toHaveBeenCalledTimes(1);
  expect(track.attach).toHaveBeenCalledTimes(3);
  expect(playback.progress()).toMatchObject({ playedSamples: 2400, proof: 'proven' });
});

it('credits 480 reference samples for 960 samples of 48 kHz output', () => {
  const s = playing();
  expect(s.advance(20)).toMatchObject({ playedSamples: 480, playedMs: 20, proof: 'proven' });
  expect(s.advance(10)).toMatchObject({ playedSamples: 720, playedMs: 30 });
});

it('accumulates fractional milliseconds instead of discarding them', () => {
  const s = playing();
  expect(s.advance(0.1).playedSamples).toBe(2);
  expect(s.advance(0.1).playedSamples).toBe(5);
});

it('never credits samples while the output observation is unavailable', () => {
  const muted = playing();
  muted.elements[0].muted = true;
  expect(muted.advance(20).playedSamples).toBe(0);
  const paused = playing();
  paused.elements[0].paused = true;
  expect(paused.advance(20).playedSamples).toBe(0);
  const ended = playing();
  ended.track.mediaStreamTrack.readyState = 'ended';
  expect(ended.advance(20).playedSamples).toBe(0);
  const failed = playing();
  failed.elements[0].error = new Error('stalled');
  expect(failed.advance(20).playedSamples).toBe(0);
  const unplayable = playing({ canPlayback: () => false });
  expect(unplayable.advance(20).playedSamples).toBe(0);
  const detached = playing();
  detached.playback.interrupt();
  expect(detached.advance(20).playedSamples).toBe(0);
});

it('does not credit time with no attached track or before a watermark raises the bound', () => {
  const { factory } = audioFixture();
  const clock = { value: 0 };
  const playback = new LiveTrackPlayback(factory, { now: () => clock.value });
  playback.begin('t1', 'r1', 0);
  playback.watermark({ type: 'audio.watermark', turnId: 't1', responseId: 'r1',
    firstAudioSample: 0, queuedSamples: 0, lastAudioSample: 0, final: false });
  clock.value = 100;
  expect(playback.progress().playedSamples).toBe(0);
  const unbounded = audioFixture();
  const silent = new LiveTrackPlayback(unbounded.factory, { now: () => clock.value });
  silent.begin('t2', 'r2', 0);
  silent.attach(asTrack(remoteAudioTrack()));
  silent.progress();
  clock.value = 200;
  expect(silent.progress().playedSamples).toBe(0);
  silent.end({ turnId: 't2', responseId: 'r2' });
  expect(silent.isDrained()).toBe(false);
});

it('freezes the cursor and marks the response unproven after observation fails', () => {
  const s = playing();
  expect(s.advance(20).playedSamples).toBe(480);
  s.elements[0].paused = true;
  expect(s.advance(20)).toMatchObject({ playedSamples: 480, proof: 'unproven' });
  s.elements[0].paused = false;
  expect(s.advance(20).playedSamples).toBe(480);
  s.playback.end({ turnId: 't1', responseId: 'r1' });
  expect(s.advance(200).playedSamples).toBe(480);
  expect(s.playback.isDrained()).toBe(false);
});

it('ignores stale watermarks but rejects misaligned and non-monotonic bounds', () => {
  const s = playing();
  expect(() => s.playback.watermark({ type: 'audio.watermark', turnId: 't1', responseId: 'r2',
    firstAudioSample: 0, queuedSamples: 4800, lastAudioSample: 9600, final: true })).not.toThrow();
  expect(s.playback.progress().playedSamples).toBe(0);
  expect(() => s.playback.watermark({ type: 'audio.watermark', turnId: 't1', responseId: 'r1',
    firstAudioSample: 24, queuedSamples: 4800, lastAudioSample: 9600, final: false }))
    .toThrow('VOICE_SEQUENCE_ERROR');
  expect(() => s.playback.watermark({ type: 'audio.watermark', turnId: 't1', responseId: 'r1',
    firstAudioSample: 0, queuedSamples: 4704, lastAudioSample: 4704, final: false }))
    .toThrow('VOICE_SEQUENCE_ERROR');
  expect(() => s.playback.end({ turnId: 't1', responseId: 'r1',
    firstAudioSample: 24, lastAudioSample: 9600 })).toThrow('VOICE_SEQUENCE_ERROR');
  expect(() => s.playback.end({ turnId: 't1', responseId: 'r1', lastAudioSample: 4704 }))
    .toThrow('VOICE_SEQUENCE_ERROR');
});

it('treats audio.end as producer completion, not playout completion', () => {
  const s = playing();
  s.playback.end({ turnId: 't1', responseId: 'r1' });
  expect(s.playback.isDrained()).toBe(false);
  expect(s.advance(200)).toMatchObject({ playedSamples: 4800, proof: 'proven' });
  expect(s.playback.isDrained()).toBe(true);
});

it('drains only when the cursor reaches the final bound announced by audio.end', () => {
  const { factory } = audioFixture();
  const clock = { value: 0 };
  const playback = new LiveTrackPlayback(factory, { now: () => clock.value });
  playback.begin('t1', 'r1', 2400);
  playback.end({ turnId: 't1', responseId: 'r1', firstAudioSample: 2400, lastAudioSample: 7200 });
  playback.attach(asTrack(remoteAudioTrack()));
  playback.progress();
  clock.value = 100;
  expect(playback.progress()).toMatchObject({ playedSamples: 4800, playedMs: 200 });
  expect(playback.isDrained()).toBe(false);
  clock.value = 200;
  expect(playback.progress().playedSamples).toBe(7200);
  expect(playback.isDrained()).toBe(true);
});

it('keeps the cursor monotonic, clamped and undrained until a final bound arrives', () => {
  const s = playing();
  expect(s.advance(500).playedSamples).toBe(4800);
  expect(s.advance(100).playedSamples).toBe(4800);
  expect(s.playback.isDrained()).toBe(false);
  s.playback.watermark({ type: 'audio.watermark', turnId: 't1', responseId: 'r1',
    firstAudioSample: 0, queuedSamples: 4800, lastAudioSample: 4800, final: true });
  expect(s.playback.isDrained()).toBe(true);
});

it('starts the absolute cursor at firstAudioSample and reports the active response', () => {
  const { factory } = audioFixture();
  const clock = { value: 0 };
  const playback = new LiveTrackPlayback(factory, { now: () => clock.value });
  expect(playback.activeResponse()).toBeNull();
  playback.begin('t1', 'r1', 2400);
  expect(playback.activeResponse()).toEqual({ turnId: 't1', responseId: 'r1' });
  playback.watermark({ type: 'audio.watermark', turnId: 't1', responseId: 'r1',
    firstAudioSample: 2400, queuedSamples: 2400, lastAudioSample: 4800, final: false });
  playback.attach(asTrack(remoteAudioTrack()));
  expect(playback.progress()).toMatchObject({ playedSamples: 2400, playedMs: 100 });
  clock.value = 50;
  expect(playback.progress()).toMatchObject({ playedSamples: 3600, playedMs: 150 });
});

it('freezes the last real sample count in the snapshot returned by interrupt', () => {
  const s = playing();
  s.advance(20);
  const snapshot = s.playback.interrupt();
  expect(snapshot).toEqual({ playedSamples: 480, playedMs: 20, proof: 'proven' });
  expect(s.playback.progress()).toEqual(snapshot);
  s.advance(100);
  expect(s.playback.progress()).toEqual(snapshot);
  expect(s.playback.isDrained()).toBe(false);
  expect(s.playback.activeResponse()).toBeNull();
  expect(s.elements[0].muted).toBe(true);
  expect(s.elements[0].pause).toHaveBeenCalledTimes(1);
  expect(s.elements[0].remove).toHaveBeenCalledTimes(1);
  expect(s.elements[0].srcObject).toBeNull();
});

it('provides protocol-valid live fixtures for the transport worker', () => {
  const f = rtcFixture();
  expect(isLiveKitVoiceSessionResponse(liveSession())).toBe(true);
  const received: Uint8Array[] = [];
  f.room.on(RoomEvent.DataReceived, (bytes: unknown) => { received.push(bytes as Uint8Array); });
  const ready = f.ready();
  expect(ready).toMatchObject({ sessionId: 'v1', connectionEpoch: 1, sequence: 0, type: 'session.ready' });
  expect(isVoiceServerEvent(ready, 'live')).toBe(true);
  expect(parseVoiceControl(new TextDecoder().decode(received[0]), 'server', 'live')).toEqual(ready);
});

it('reports blocked output instead of proving samples when play is rejected', async () => {
  const f = rtcFixture();
  const blocked = vi.fn();
  const clock = { value: 0 };
  const playback = new LiveTrackPlayback(f.options.element, { now: () => clock.value, blocked });
  playback.attach(asTrack(remoteAudioTrack()));
  f.audio.play.mockRejectedValueOnce(new Error('NotAllowedError'));
  playback.begin('t1', 'r1', 0);
  await Promise.resolve();
  await Promise.resolve();
  expect(blocked).toHaveBeenCalledTimes(1);
  expect(playback.progress()).toMatchObject({ playedSamples: 0, proof: 'unproven' });
  playback.watermark({ type: 'audio.watermark', turnId: 't1', responseId: 'r1',
    firstAudioSample: 0, queuedSamples: 4800, lastAudioSample: 4800, final: true });
  clock.value = 1000;
  expect(playback.progress()).toMatchObject({ playedSamples: 0, proof: 'unproven' });
  expect(playback.isDrained()).toBe(false);
});
