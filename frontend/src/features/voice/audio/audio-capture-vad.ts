/**
 * ============================================================================
 * FILE: audio-capture-vad.ts
 * LOCATION: frontend/src/features/voice/audio/audio-capture-vad.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Offline embedded WebRTC VAD loader and 20 ms decision wrapper.
 *
 * ROLE IN PROJECT:
 *    Live capture scores 80 ms PCM as four independent 320-sample windows
 *    without fetch, eval, or the fetching package root. Failures map to
 *    MEDIA_GATE_UNAVAILABLE so the call pauses rather than uploading continuously.
 *
 * KEY COMPONENTS:
 *    - createCaptureVad: Instantiates AGGRESSIVE 16 kHz embedded VAD.
 *    - decisions: Four independent 20 ms windows per 80 ms frame.
 *    - reset/destroy: Fresh instance vs fail-closed teardown.
 * ============================================================================
 */

import createVad, { VADMode } from '@ozymandiasthegreat/vad/lib/embedded.js'

export type CaptureVad = {
  decisions(pcm: Uint8Array): boolean[]
  reset(): void
  destroy(): void
}

export async function createCaptureVad(): Promise<CaptureVad> {
  try {
    const VAD = await createVad()
    let instance = new VAD(VADMode.AGGRESSIVE, 16000), destroyed = false
    return {
      decisions(pcm) {
        if (destroyed || pcm.byteLength !== 2560) throw new Error('MEDIA_GATE_UNAVAILABLE')
        const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
        return Array.from({ length: 4 }, (_, window) => {
          // The pinned package reads frame.buffer, ignoring byteOffset: each 20 ms window owns its buffer.
          const frame = Int16Array.from({ length: 320 }, (_, i) => view.getInt16((window * 320 + i) * 2, true))
          const result = instance.processFrame(frame)
          if (result !== 0 && result !== 1) throw new Error('MEDIA_GATE_UNAVAILABLE')
          return result === 1
        })
      },
      reset() {
        if (destroyed) throw new Error('MEDIA_GATE_UNAVAILABLE')
        const fresh = new VAD(VADMode.AGGRESSIVE, 16000)
        instance.destroy()
        instance = fresh
      },
      destroy() { if (!destroyed) { destroyed = true; instance.destroy() } },
    }
  } catch { throw new Error('MEDIA_GATE_UNAVAILABLE') }
}
