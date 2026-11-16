/**
 * ============================================================================
 * FILE: audio-capture-gate.ts
 * LOCATION: frontend/src/features/voice/audio/audio-capture-gate.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Pure five-second non-speech upload gate with bounded same-call onset audio.
 *
 * ROLE IN PROJECT:
 *    Decides which 80 ms PCM frames may leave capture, holds a 320 ms pre-roll
 *    after speech onset, and bounds acknowledgement-wait audio. No timers,
 *    browser APIs, or provider calls.
 *
 * KEY COMPONENTS:
 *    - CaptureGate.push: Scores 20 ms windows, suspends, and buffers onset.
 *    - CaptureGate.setUploading: Releases pending frames after listening ACK.
 *    - CaptureGate.reset: Clears every transient frame on mute/hide/failure.
 * ============================================================================
 */

type GateResult = { frames: Uint8Array[]; signal?: 'suspended' | 'speech'; decisionOffsetMs?: number }

export class CaptureGate {
  private quietMs = 0
  private suspended = false
  private waking = false
  private uploading = true
  private preRoll: Uint8Array[] = []
  private pending: Uint8Array[] = []
  private maxFrames: number
  constructor(maxPendingMs: number) { this.maxFrames = Math.floor(maxPendingMs / 80) }
  get bufferedFrames() { return this.preRoll.length + this.pending.length }

  reset(uploading: boolean, maxPendingMs: number) {
    this.quietMs = 0; this.suspended = false; this.waking = false
    this.uploading = uploading; this.preRoll = []; this.pending = []
    this.maxFrames = Math.floor(maxPendingMs / 80)
  }

  setUploading(enabled: boolean) {
    this.uploading = enabled
    if (!enabled) return []
    this.suspended = false; this.waking = false; this.quietMs = 0; this.preRoll = []
    const frames = this.pending; this.pending = []
    return frames
  }

  push(pcm: Uint8Array, decisions: readonly boolean[]): GateResult {
    if (pcm.byteLength !== 2560 || decisions.length !== 4) throw new Error('MEDIA_GATE_UNAVAILABLE')
    for (const speech of decisions) this.quietMs = speech ? 0 : this.quietMs + 20
    if (!this.suspended && this.quietMs >= 5000) {
      this.suspended = true; this.uploading = false; this.pending = []
      this.preRoll = [pcm]
      return { frames: [], signal: 'suspended' }
    }
    if (this.suspended && !this.waking) {
      this.preRoll.push(pcm)
      // ponytail: four 80 ms frames (320 ms); use a measured resampler tap only if onset latency warrants it.
      if (this.preRoll.length > 4) this.preRoll.shift()
      const index = decisions.indexOf(true)
      if (index < 0) return { frames: [] }
      this.waking = true; this.pending = this.preRoll; this.preRoll = []
      return { frames: [], signal: 'speech', decisionOffsetMs: index * 20 }
    }
    if (!this.uploading) {
      // This is a finite listening-ACK buffer, never a reconnect or long-silence backlog.
      if (this.pending.length >= this.maxFrames) throw new Error('AUDIO_BUFFER_OVERFLOW')
      this.pending.push(pcm)
      return { frames: [] }
    }
    return { frames: [pcm] }
  }
}
