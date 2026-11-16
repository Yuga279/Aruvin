/**
 * ============================================================================
 * FILE: audio-capture-gate.test.ts
 * LOCATION: frontend/src/features/voice/audio/audio-capture-gate.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Direct tests for the pure five-second upload gate and bounded onset buffers.
 *
 * ROLE IN PROJECT:
 *    Proves media-time silence suspension, once-only 320 ms pre-roll, listening
 *    acknowledgement wait, overflow fail-closed, and reset without browser or
 *    provider side effects.
 *
 * KEY COMPONENTS:
 *    - CaptureGate: Pure PCM admission and local buffer class under test.
 * ============================================================================
 */

import { expect, it } from 'vitest'
import { CaptureGate } from './audio-capture-gate'

const frame = (id: number) => new Uint8Array(2560).fill(id)
const quiet = [false, false, false, false]
const voice = [false, false, true, false]

it('stops PCM by 5080 ms and emits one suspend through three minutes of quiet', () => {
  const gate = new CaptureGate(1000), sent: Uint8Array[] = [], signals: string[] = []
  for (let i = 0; i < 2250; i++) {
    const result = gate.push(frame(i % 255), quiet)
    sent.push(...result.frames)
    if (result.signal) signals.push(result.signal)
    if (i >= 63) expect(result.frames).toEqual([])
  }
  expect(sent).toHaveLength(62)
  expect(signals).toEqual(['suspended'])
  expect(gate.bufferedFrames).toBe(4)
})

it('releases exactly one ordered 320 ms pre-roll only after listening acknowledgement', () => {
  const gate = new CaptureGate(1000)
  for (let i = 0; i < 70; i++) gate.push(frame(i), quiet)
  expect(gate.push(frame(70), voice)).toMatchObject({ frames: [], signal: 'speech', decisionOffsetMs: 40 })
  expect(gate.push(frame(71), voice)).toMatchObject({ frames: [] })
  expect(gate.setUploading(true).map(p => p[0])).toEqual([67, 68, 69, 70, 71])
  expect(gate.setUploading(true)).toEqual([])
  expect(gate.push(frame(72), voice).frames.map(p => p[0])).toEqual([72])
})

it('a normal pause or one positive 20 ms window resets confirmed non-speech', () => {
  const gate = new CaptureGate(1000)
  for (let i = 0; i < 60; i++) expect(gate.push(frame(i), quiet).signal).toBeUndefined()
  expect(gate.push(frame(60), voice).signal).toBeUndefined()
  for (let i = 0; i < 60; i++) expect(gate.push(frame(i), quiet).signal).toBeUndefined()
})

it('bounds acknowledgement audio and clears every transient frame on reset', () => {
  const gate = new CaptureGate(800)
  for (let i = 0; i < 70; i++) gate.push(frame(i), quiet)
  gate.push(frame(70), voice)
  for (let i = 0; i < 6; i++) gate.push(frame(i), voice)
  expect(gate.bufferedFrames).toBe(10)
  expect(() => gate.push(frame(99), voice)).toThrow('AUDIO_BUFFER_OVERFLOW')
  gate.reset(false, 800)
  expect(gate.bufferedFrames).toBe(0)
  expect(gate.setUploading(true)).toEqual([])
})
