/**
 * ============================================================================
 * FILE: audio-capture-vad.test.ts
 * LOCATION: frontend/src/features/voice/audio/audio-capture-vad.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Direct tests for the offline embedded capture VAD wrapper.
 *
 * ROLE IN PROJECT:
 *    Proves the pinned embedded WebRTC VAD loads without network, classifies
 *    synthetic PCM, maps WASM failure to MEDIA_GATE_UNAVAILABLE, and retains
 *    MIT/BSD notices. Does not certify real-microphone acoustic accuracy.
 *
 * KEY COMPONENTS:
 *    - createCaptureVad: Real-module loader and 20 ms decision wrapper.
 *    - Synthetic voiced/silent PCM fixtures for offline classification.
 * ============================================================================
 */

import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { createCaptureVad } from './audio-capture-vad'

const pcm = (voiced: boolean) => {
  const samples = Int16Array.from({ length: 1280 }, (_, i) => voiced
    ? Math.round(9000 * (Math.sin(2 * Math.PI * 140 * i / 16000) +
      0.35 * Math.sin(2 * Math.PI * 280 * i / 16000))) : 0)
  return new Uint8Array(samples.buffer)
}

afterEach(() => { vi.restoreAllMocks() })

it('loads embedded WASM offline, classifies synthetic voiced/silent PCM, and fails after destroy', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
  const vad = await createCaptureVad()
  try {
    expect(Array.from({ length: 8 }, () => vad.decisions(pcm(false))).flat()).toEqual(Array(32).fill(false))
    expect(Array.from({ length: 8 }, () => vad.decisions(pcm(true))).flat()).toContain(true)
    expect(fetcher).not.toHaveBeenCalled()
    vad.destroy()
    expect(() => vad.decisions(pcm(true))).toThrow('MEDIA_GATE_UNAVAILABLE')
    expect(() => vad.destroy()).not.toThrow()
  } finally { vad.destroy(); fetcher.mockRestore() }
})

it('maps unavailable WebAssembly to MEDIA_GATE_UNAVAILABLE without a network fallback', async () => {
  const instantiate = vi.spyOn(WebAssembly, 'instantiate').mockRejectedValueOnce(new Error('WASM blocked'))
  try { await expect(createCaptureVad()).rejects.toThrow('MEDIA_GATE_UNAVAILABLE') }
  finally { instantiate.mockRestore() }
})

it('pins the embedded entry and retains MIT metadata plus BSD redistribution notices', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  expect(manifest.dependencies['@ozymandiasthegreat/vad']).toBe('2.0.7')
  const source = readFileSync('src/features/voice/audio/audio-capture-vad.ts', 'utf8')
  expect(source).toContain("from '@ozymandiasthegreat/vad/lib/embedded.js'")
  expect(source).not.toMatch(/\bfetch\s*\(|\beval\s*\(|new\s+Function\s*\(/)
  const notice = readFileSync('src/features/voice/audio/audio-capture-vad.NOTICES.md', 'utf8')
  expect(notice).toContain('MIT')
  expect(notice).toContain('BSD-3-Clause')
  expect(notice).toContain('Neither the name of Google')
  expect(notice).toContain('THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS')
})
