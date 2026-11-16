/**
 * ============================================================================
 * FILE: pcm-resampler.test.ts
 * LOCATION: frontend/src/features/voice/audio/pcm-resampler.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for browser audio PCM resampler and FIR anti-aliasing filter.
 *
 * ROLE IN PROJECT:
 *    Verifies signal resampling math, chunk-invariance, clipping, little-endian
 *    packing, tail drain, and rate bounds for microphone capture.
 *
 * KEY COMPONENTS:
 *    - describe('PcmResampler'): Test suite covering rates, RMS, FIR cutoff,
 *      channel mixing, draining, resetting, and error cases.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest'
import { PcmResampler } from './pcm-resampler'

const flatten = (parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) { all.set(part, offset); offset += part.length }
  return all
}
function sampleSignal(rate: number, hz: number, seconds = 0.16) {
  return Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) =>
    0.5 * Math.sin(2 * Math.PI * hz * i / rate))
}
function rms(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sum = 0
  // Exclude the FIR startup transient; use the identical slice for both signals.
  for (let i = 160; i < bytes.length / 2; i++) sum += (view.getInt16(i * 2, true) / 32768) ** 2
  return Math.sqrt(sum / (bytes.length / 2 - 160))
}
describe('PcmResampler', () => {
  for (const rate of [44100, 48000]) {
    it(`resamples ${rate} Hz with exact frame count and chunk invariance`, () => {
      const input = sampleSignal(rate, 1000)
      const a: Uint8Array[] = [], b: Uint8Array[] = []
      const whole = new PcmResampler(rate, p => a.push(p))
      const chunked = new PcmResampler(rate, p => b.push(p))
      whole.push([input])
      for (let i = 0; i < input.length; i += 128) chunked.push([input.subarray(i, i + 128)])
      expect(a.map(p => p.length)).toEqual([2560, 2560])
      expect(flatten(b)).toEqual(flatten(a))
      expect(rms(flatten(a))).toBeGreaterThan(0.30)
      const stopband: Uint8Array[] = []
      new PcmResampler(rate, p => stopband.push(p)).push([sampleSignal(rate, 12000)])
      expect(rms(flatten(stopband))).toBeLessThan(0.025)
    })
  }
  it('mixes channels, clips and packs signed PCM little endian', () => {
    const chunks: Uint8Array[] = []
    const r = new PcmResampler(48000, p => chunks.push(p))
    r.push([new Float32Array(3840).fill(2), new Float32Array(3840).fill(2)])
    expect([...chunks[0].slice(-4)]).toEqual([255, 127, 255, 127])
    r.reset()
    r.push([new Float32Array(3840).fill(-2)])
    expect([...chunks[1].slice(-4)]).toEqual([0, 128, 0, 128])
  })
  it('drains only real tail samples and reset discards incomplete input', () => {
    const frames: Uint8Array[] = []
    const r = new PcmResampler(48000, p => frames.push(p))
    r.push([new Float32Array(960)])
    expect(r.drain().length).toBe(640)
    expect(r.drain().length).toBe(0)
    r.push([new Float32Array(960).fill(1)])
    r.reset()
    expect(r.drain().length).toBe(0)
    expect(frames).toHaveLength(0)
  })
  it('rejects invalid device rates and sanitizes nonfinite samples', () => {
    expect(() => new PcmResampler(0, () => {})).toThrow('UNSUPPORTED_AUDIO')
    const r = new PcmResampler(48000, () => {})
    r.push([Float32Array.of(NaN, Infinity, -Infinity)])
    expect([...r.drain()]).toEqual([0, 0])
  })
})
