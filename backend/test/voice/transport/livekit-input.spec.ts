/**
 * ============================================================================
 * FILE: livekit-input.spec.ts
 * LOCATION: backend/test/voice/transport/livekit-input.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic checks for LiveKit microphone framing and quiet gating.
 *
 * ROLE IN PROJECT:
 *    Proves exact PCM byte order, fixed 2560-byte framing, five-second quiet
 *    suspension, bounded pre-roll and overflow rejection without native RTC.
 *
 * KEY COMPONENTS:
 *    - frame(): Structural decoded-frame stdlib shape.
 *    - inputFixture(): Isolated LiveKitInput with spy callbacks.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { LiveKitInput } from '../../../src/voice/transport/livekit-input.js';
import { VoiceSessionError } from '../../../src/voice/session/voice-session.options.js';
import { settle } from './fixtures.js';

const frame = (n: number, value = 1000) => ({
  data: new Int16Array(n).fill(value), sampleRate: 16000,
  channels: 1, samplesPerChannel: n,
});

function inputFixture(inputQueueMs = 1000) {
  const write = vi.fn(async (_pcm: Uint8Array): Promise<void> => undefined);
  const suspend = vi.fn(), resume = vi.fn(), fail = vi.fn();
  const input = new LiveKitInput(inputQueueMs, write, suspend, resume, fail);
  return { input, write, suspend, resume, fail };
}

it('assembles irregular native frames in exact little-endian sample order', async () => {
  const f = inputFixture();
  f.input.push(frame(160, 0x1234));
  f.input.push(frame(480, -32768));
  f.input.push(frame(640, 32767));
  f.input.push(frame(1279));
  await settle();
  expect(f.write).toHaveBeenCalledTimes(1);
  const bytes = f.write.mock.calls[0][0];
  expect(bytes).toHaveLength(2560);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([view.getInt16(0, true), view.getInt16(320, true), view.getInt16(1280, true)])
    .toEqual([0x1234, -32768, 32767]);
  f.input.close();
  expect(f.write).toHaveBeenCalledTimes(1);
});

it('suspends at five seconds, bounds pre-roll and waits for listening before onset upload', async () => {
  const f = inputFixture();
  for (let i = 0; i < 62; i++) { f.input.push(frame(1280, 0)); await settle(); }
  expect(f.suspend).not.toHaveBeenCalled();
  f.input.push(frame(1280, 0)); await settle();
  expect(f.suspend).toHaveBeenCalledTimes(1);
  const before = f.write.mock.calls.length;
  for (let i = 0; i < 100; i++) f.input.push(frame(1280, 0));
  expect(f.input.bufferedFrames).toBe(4);
  f.input.push(frame(1280, 600)); await settle();
  expect(f.resume).toHaveBeenCalledTimes(1);
  expect(f.write).toHaveBeenCalledTimes(before);
  f.input.setUploading(true); await settle();
  expect(f.write).toHaveBeenCalledTimes(before + 4);
  expect(f.fail).not.toHaveBeenCalled();
});

it('rejects format mismatch and overflows a blocked STT lane without unbounded promises', async () => {
  const f = inputFixture(160);
  let release!: () => void;
  f.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  f.input.push(frame(1280)); await settle();
  f.input.push(frame(1280));
  expect(f.input.bufferedFrames).toBe(2);
  f.input.push(frame(1280));
  expect(f.fail).toHaveBeenCalledExactlyOnceWith('AUDIO_BUFFER_OVERFLOW');
  release(); await settle();
  expect(f.write).toHaveBeenCalledTimes(1);
  const g = inputFixture();
  g.input.push({ ...frame(1280), sampleRate: 48000 });
  expect(g.fail).toHaveBeenCalledExactlyOnceWith('INVALID_AUDIO_FRAME');
  expect(g.write).not.toHaveBeenCalled();
});

it('discards partial and queued frames on mute before forwarding fresh input', async () => {
  const f = inputFixture();
  let release!: () => void;
  f.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  f.input.push(frame(1280, 1000)); await settle();
  f.input.push(frame(1280, 2000)); f.input.push(frame(100, 3000));
  f.input.setEnabled(false); f.input.setEnabled(true);
  f.input.push(frame(1280, 4000)); release(); await settle();
  expect(f.write).toHaveBeenCalledTimes(2);
  const fresh = f.write.mock.calls[1][0];
  expect(new DataView(fresh.buffer, fresh.byteOffset).getInt16(0, true)).toBe(4000);
  f.input.close();
});

it('preserves a source VoiceSessionError instead of masking it as STT failure', async () => {
  const f = inputFixture();
  f.write.mockRejectedValueOnce(new VoiceSessionError('VOICE_QUOTA_EXHAUSTED', 'none'));
  f.input.push(frame(1280)); await settle();
  expect(f.fail).toHaveBeenCalledExactlyOnceWith('VOICE_QUOTA_EXHAUSTED');
  expect(f.input.bufferedFrames).toBe(0);
});
