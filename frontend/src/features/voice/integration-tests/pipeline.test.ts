/**
 * ============================================================================
 * FILE: pipeline.test.ts
 * LOCATION: frontend/src/features/voice/integration-tests/pipeline.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify integrated LiveKit control, playout bounds, reconnect, and interruption.
 *
 * ROLE IN PROJECT:
 *    Drives the real LiveKitVoiceClient and LiveVoiceController across deterministic
 *    Room/track doubles; virtual output observations are software-only evidence.
 *
 * KEY COMPONENTS:
 *    - matrixFixture: Real live client/controller with controllable SDK doubles.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { RoomEvent } from 'livekit-client';
import { liveSession, rtcFixture } from '../../../api/testing/livekit-fakes.ts';
import { matrixFixture } from './matrix-fixture.ts';
import { settle } from '../state/testing/live-voice-fixture.ts';

afterEach(() => { vi.useRealTimers(); });

it('bounds three virtual live responses by absolute watermark coordinates', async () => {
  vi.useFakeTimers(); const f = matrixFixture('granted');
  try {
    await f.begin(); f.attach();
    let first = 0, generated = 0;
    for (let n = 1; n <= 3; n++) {
      const ref = { turnId: `t${n}`, responseId: `r${n}` };
      f.event({ type: 'audio.start', ...ref, sampleRate: 24000,
        firstAudioSequence: n - 1, firstAudioSample: first });
      expect(f.client().progress().playedSamples).toBe(first);
      const last = first + 52825;
      f.event({ type: 'audio.watermark', ...ref, firstAudioSample: first,
        queuedSamples: 52825, lastAudioSample: last, final: true });
      f.client().progress();
      await f.advance(2300);
      expect(f.client().progress().playedSamples).toBe(last);
      f.event({ type: 'audio.end', ...ref, lastAudioSequence: n - 1,
        firstAudioSample: first, lastAudioSample: last });
      await f.advance(100);
      expect(f.controller.getSnapshot().agent).toBe('idle');
      generated += 52825;
      first = Math.ceil(last / 24) * 24;
    }
    expect(generated).toBe(158475);
    expect(f.rtc.participant.publishTrack).toHaveBeenCalledOnce();
  } finally { f.controller.exit(); await settle(); }
});

it('rejoins in a newer epoch without replay until a fresh listening gesture', async () => {
  vi.useFakeTimers(); const first = rtcFixture(), second = rtcFixture();
  const room = vi.fn().mockReturnValueOnce(first.options.room()).mockReturnValueOnce(second.options.room());
  const microphone = vi.fn().mockImplementationOnce(first.options.microphone)
    .mockImplementationOnce(second.options.microphone);
  const f = matrixFixture('granted', {}, liveSession(), { room, microphone });
  try {
    await f.start();
    const firstRequest = f.http.create.mock.calls[0]![0]!;
    f.http.create.mockResolvedValueOnce({ ...liveSession(2), conversationId: 'bound-chat' });
    first.ready(); await settle();
    first.event({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }, 1);
    await settle();
    expect(first.microphone).toHaveBeenCalledOnce();
    first.emit(RoomEvent.Disconnected);
    expect(first.mic.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(250); await settle();
    second.ready(2); await settle();
    const secondRequest = f.http.create.mock.calls[1]![0]!;
    expect(secondRequest.idempotencyKey).toBe(firstRequest.idempotencyKey);
    expect(f.bindings.bindVoiceConversation).toHaveBeenCalledWith('lease-1', 'bound-chat');
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', resumeRequired: true });
    expect(second.microphone).not.toHaveBeenCalled();
    expect(second.room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect([...first.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
    first.event({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }, 2, 1);
    expect(f.controller.getSnapshot().phase).toBe('suspended');
    await f.controller.resume();
    expect(second.microphone).toHaveBeenCalledOnce();
    second.event({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }, 1, 2);
    await settle();
    expect(f.controller.getSnapshot().input).toBe('listening');
    expect(second.mediaTrack.enabled).toBe(true);
    expect(f.http.create).toHaveBeenCalledTimes(2);
  } finally { f.controller.exit(); await settle(); }
});

it('keeps the Room control lane through a recoverable provider pause', async () => {
  const f = matrixFixture('granted');
  try {
    await f.begin();
    f.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'resume_call',
      recoverable: true, terminal: false });
    await settle();
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: true });
    expect(f.rtc.room.disconnect).not.toHaveBeenCalled();
    await f.controller.resume();
    expect(f.rtc.packets().some(packet => packet.type === 'input.unmute')).toBe(true);
    expect(f.controller.getSnapshot().phase).toBe('suspended');
    f.listening(); await settle();
    expect(f.controller.getSnapshot().input).toBe('listening');
    expect(f.rtc.room.disconnect).not.toHaveBeenCalled();
  } finally { f.controller.exit(); await settle(); }
});

it.each([
  { type: 'session.ended', reason: 'duration', terminal: false },
  { type: 'session.ended', reason: 'quota', terminal: false },
  { type: 'session.error', code: 'VOICE_RECONNECT_TIMEOUT', recovery: 'none', recoverable: false, terminal: true },
  { type: 'session.error', code: 'VOICE_DISABLED', recovery: 'none', recoverable: false, terminal: true },
] as const)('keeps policy-ended $type blocked without a new admission', async payload => {
  const f = matrixFixture('granted');
  try {
    await f.begin();
    f.event(payload);
    await settle();
    const calls = f.http.create.mock.calls.length;
    await f.controller.resume();
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: false });
    expect(f.http.create).toHaveBeenCalledTimes(calls);
    expect(f.http.create).toHaveBeenCalledOnce();
  } finally { f.controller.exit(); await settle(); }
});

it('silences a pre-start interruption before reliable control and ignores late bounds', async () => {
  vi.useFakeTimers();
  const f = matrixFixture('granted');
  try {
    await f.begin(); f.attach();
    const ref = { turnId: 't1', responseId: 'r1' };
    f.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0, firstAudioSample: 0 });
    expect(f.rtc.audio.muted).toBe(false);
    expect(f.client().progress().playedSamples).toBe(0);
    f.controller.interrupt();
    expect(f.rtc.audio.muted).toBe(true);
    expect(f.rtc.audio.pause).toHaveBeenCalled();
    const interrupt = f.rtc.packets().find(packet => packet.type === 'response.interrupt');
    expect(interrupt).toMatchObject({ playedSamples: 0, playbackPositionMs: 0 });
    f.event({ type: 'audio.watermark', ...ref, firstAudioSample: 0,
      queuedSamples: 2400, lastAudioSample: 2400, final: true });
    await f.advance(1000);
    expect(f.client().progress().playedSamples).toBe(0);
  } finally { f.controller.exit(); await settle(); }
});

it('fails a rejected interrupt publish after local output is stopped', async () => {
  const f = matrixFixture('granted');
  try {
    await f.begin(); f.attach();
    f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
      firstAudioSequence: 0, firstAudioSample: 0 });
    f.rtc.participant.publishData.mockImplementation(async bytes => {
      const packet = JSON.parse(new TextDecoder().decode(bytes));
      if (packet.type === 'response.interrupt') {
        expect(f.rtc.audio.muted).toBe(true);
        expect(f.rtc.audio.pause).toHaveBeenCalled();
        throw new Error('fixture publish failure');
      }
    });
    f.controller.interrupt();
    await settle();
    expect(f.rtc.room.disconnect).toHaveBeenCalledOnce();
    expect(f.http.end).not.toHaveBeenCalled();
  } finally { f.controller.exit(); await settle(); }
});
