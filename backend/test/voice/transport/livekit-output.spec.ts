/**
 * ============================================================================
 * FILE: livekit-output.spec.ts
 * LOCATION: backend/test/voice/transport/livekit-output.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic checks for bounded 24 kHz LiveKit assistant audio output.
 *
 * ROLE IN PROJECT:
 *    Proves aligned PCM copying, monotonic response origins, generation fencing
 *    on invalidation, watermark bounds and finite retained output bytes.
 *
 * KEY COMPONENTS:
 *    - fixture(): LiveKitOutput with a structural AudioSource fake.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { LiveKitOutput } from '../../../src/voice/transport/livekit-output.js';
import { settle } from './fixtures.js';

const ref = { turnId: 't1', responseId: 'r1' };

function fixture() {
  const frames: Int16Array[] = [];
  const source = {
    captureFrame: vi.fn(async (f: { data: Int16Array; sampleRate: number; channels: number }) => {
      expect([f.sampleRate, f.channels]).toEqual([24000, 1]);
      frames.push(f.data.slice());
    }),
    clearQueue: vi.fn(),
  };
  const send = vi.fn(), fail = vi.fn();
  return { source, send, fail, frames, output: new LiveKitOutput(source, 2000, send, fail) };
}

it('copies unaligned PCM and maintains exact monotonic response origins', async () => {
  const f = fixture();
  f.output.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
  const raw = new Uint8Array([99, 0, 128, 255, 127]);
  f.output.audio(ref, raw.subarray(1));
  raw.fill(0);
  await settle();
  expect([...f.frames[0]]).toEqual([-32768, 32767]);
  expect(f.output.outputSamples()).toBe(24);
  f.output.invalidate(ref);
  f.output.event({ type: 'audio.start', turnId: 't2', responseId: 'r2', sampleRate: 24000, firstAudioSequence: 0 });
  expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ firstAudioSample: 24 }));
});

it('clears immediately and never captures queued old-generation audio after a delayed capture', async () => {
  const f = fixture();
  let release!: () => void;
  f.source.captureFrame.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  f.output.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
  f.output.audio(ref, new Uint8Array(9600));
  f.output.audio(ref, new Uint8Array(9600));
  await settle();
  f.output.invalidate(ref);
  expect(f.source.clearQueue).toHaveBeenCalledTimes(1);
  f.output.audio(ref, new Uint8Array(9600));
  const next = { turnId: 't2', responseId: 'r2' };
  f.output.event({ type: 'audio.start', ...next, sampleRate: 24000, firstAudioSequence: 0 });
  f.output.audio(next, new Uint8Array([1, 0]));
  release();
  await settle();
  expect(f.source.captureFrame).toHaveBeenCalledTimes(2);
  expect(f.source.clearQueue).toHaveBeenCalledTimes(2);
  expect([...f.frames[0]]).toEqual([1]);
  expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'response.cancelled', ...ref }));
});

it('bounds retained output bytes and never interprets capture as played progress', async () => {
  const f = fixture();
  f.source.captureFrame.mockImplementation(() => new Promise<void>(() => {}));
  f.output.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
  for (let i = 0; i < 11; i++) f.output.audio(ref, new Uint8Array(9600));
  expect(f.fail).toHaveBeenCalledExactlyOnceWith('AUDIO_BUFFER_OVERFLOW');
  expect(f.send.mock.calls.some(([e]) =>
    e.type === 'playback.progress' || e.type === 'audio.end')).toBe(false);
});

it('announces queued and final watermarks from the exact generated sample cursor', async () => {
  const f = fixture();
  f.output.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
  f.output.audio(ref, new Uint8Array(9600));
  await settle();
  expect(f.send).toHaveBeenCalledWith({
    type: 'audio.watermark', ...ref,
    firstAudioSample: 0, queuedSamples: 4800, lastAudioSample: 4800, final: false,
  });
  f.output.finalize(ref);
  expect(f.send).toHaveBeenLastCalledWith({
    type: 'audio.watermark', ...ref,
    firstAudioSample: 0, queuedSamples: 4800, lastAudioSample: 4800, final: true,
  });
});

it('surfaces a rejecting native capture once without an unhandled rejection', async () => {
  const f = fixture();
  f.source.captureFrame.mockRejectedValueOnce(new Error('native capture failed'));
  f.output.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
  f.output.audio(ref, new Uint8Array(960));
  await settle();
  expect(f.fail).toHaveBeenCalledExactlyOnceWith('VOICE_DELIVERY_UNKNOWN');
  expect(f.source.clearQueue).toHaveBeenCalled();
});

it('ignores invalidation after close without throwing', async () => {
  const f = fixture();
  f.output.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
  f.output.close();
  expect(() => f.output.invalidate(ref)).not.toThrow();
  expect(f.send.mock.calls.some(([e]) => e.type === 'response.cancelled')).toBe(false);
});
