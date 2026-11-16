/**
 * ============================================================================
 * FILE: audio-capture-processor.ts
 * LOCATION: frontend/src/features/voice/audio/audio-capture-processor.ts
 * ============================================================================
 *
 * PURPOSE:
 *    AudioWorklet processor for browser microphone audio capture and resampling.
 *
 * ROLE IN PROJECT:
 *    Runs in an AudioWorklet thread to resample microphone input, manage mute
 *    state and revisions, post transferable PCM frames, and handle backpressure.
 *    Live capture optionally scores 20 ms windows and admits uploads through
 *    the five-second gate; dictation keeps drain/overflow without a VAD instance.
 *
 * KEY COMPONENTS:
 *    - AudioCaptureProcessor: AudioWorkletProcessor handling audio blocks, mute
 *      state, reset/drain/upload commands, live gate, and transferable PCM16.
 *    - registerProcessor: Registers 'aurvin-capture' in the worklet global scope.
 * ============================================================================
 */

import { DEFAULT_VOICE_LIMITS, isVoiceLimits } from '../../../api/voice-protocol'
import { CaptureGate } from './audio-capture-gate'
import { createCaptureVad, type CaptureVad } from './audio-capture-vad'
import { PcmResampler } from './pcm-resampler'

declare const sampleRate: number
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioCaptureProcessor): void

export class AudioCaptureProcessor extends AudioWorkletProcessor {
  private muted = true
  private revision = 0
  private pending = 0
  private maxFrames: number
  private readonly resampler: PcmResampler
  private readonly liveGate: boolean
  private readonly gate: CaptureGate
  private detector?: CaptureVad
  private initializing = false
  private destroyed = false
  private uploading = true

  constructor(options: { processorOptions: { maxPendingMs: number; speechGate?: boolean } }) {
    super()
    this.maxFrames = Math.max(1, Math.floor(options.processorOptions.maxPendingMs / 80))
    this.liveGate = Boolean(options.processorOptions.speechGate)
    this.gate = new CaptureGate(options.processorOptions.maxPendingMs)
    this.resampler = new PcmResampler(sampleRate, pcm => this.captured(pcm))
    this.port.onmessage = ({ data }) => {
      if (data.type === 'initialize' && data.revision === this.revision) { this.initialize(); return }
      if (data.type === 'destroy') {
        this.destroyed = true; this.muted = true; this.pending = 0
        this.resampler.reset(); this.gate.reset(false, this.maxFrames * 80)
        this.detector?.destroy(); this.detector = undefined
        return
      }
      if (data.type === 'reset') {
        this.revision = data.revision
        this.muted = data.muted
        if (data.maxPendingMs !== undefined &&
            isVoiceLimits({ ...DEFAULT_VOICE_LIMITS, inputQueueMs: data.maxPendingMs })) {
          this.maxFrames = Math.max(1, Math.floor(data.maxPendingMs / 80))
        }
        this.pending = 0
        this.resampler.reset()
        this.uploading = !this.liveGate || data.uploading === true
        this.gate.reset(this.uploading, this.maxFrames * 80)
        if (this.liveGate && this.detector) {
          try { this.detector.reset() }
          catch { this.gateFailure(); return }
        }
        this.port.postMessage({ type: 'reset', revision: this.revision })
        return
      }
      if (data.type === 'upload' && data.revision === this.revision && this.liveGate && !this.muted && !this.destroyed) {
        this.uploading = data.enabled === true
        for (const frame of this.gate.setUploading(this.uploading)) this.send(frame, 0)
        return
      }
      if (data.revision === this.revision && data.type === 'ack') {
        this.pending = Math.max(0, this.pending - 1)
      } else if (data.revision === this.revision && data.type === 'drain') {
        this.muted = true
        if (this.liveGate) {
          this.resampler.reset()
          this.gate.reset(false, this.maxFrames * 80)
          return
        }
        this.send(this.resampler.drain(), 1)
      }
    }
  }

  private initialize() {
    if (!this.liveGate || this.initializing || this.detector || this.destroyed) return
    this.initializing = true
    void createCaptureVad().then(detector => {
      if (this.destroyed) { detector.destroy(); return }
      this.detector = detector
      this.port.postMessage({ type: 'gate-ready', revision: this.revision })
    }).catch(() => { if (!this.destroyed) this.gateFailure() })
  }

  private gateFailure() {
    this.muted = true; this.uploading = false
    this.resampler.reset(); this.gate.reset(false, this.maxFrames * 80)
    this.detector?.destroy(); this.detector = undefined
    this.port.postMessage({ type: 'gate-error', revision: this.revision, code: 'MEDIA_GATE_UNAVAILABLE' })
  }

  private captured(pcm: Uint8Array) {
    if (!this.liveGate) { this.send(pcm, 0); return }
    if (!this.detector || this.destroyed) return
    try {
      const result = this.gate.push(pcm, this.detector.decisions(pcm))
      if (result.signal) this.port.postMessage({ type: 'gate', revision: this.revision, state: result.signal })
      for (const frame of result.frames) this.send(frame, 0)
    } catch (error) {
      if (error instanceof Error && error.message === 'AUDIO_BUFFER_OVERFLOW') this.overflow()
      else this.gateFailure()
    }
  }

  private overflow() {
    this.muted = true; this.uploading = false
    this.resampler.reset(); this.gate.reset(false, this.maxFrames * 80)
    this.port.postMessage({ type: 'overflow', revision: this.revision })
  }

  private send(pcm: Uint8Array, flags: 0 | 1) {
    if (this.pending >= this.maxFrames) {
      this.overflow(); return
    }
    this.pending++
    this.port.postMessage({ type: 'frame', revision: this.revision, flags, pcm: pcm.buffer }, [pcm.buffer])
  }

  process(inputs: Float32Array[][]) {
    if (!this.muted && !this.destroyed && (!this.liveGate || this.detector !== undefined)) {
      this.resampler.push(inputs[0] ?? [])
    }
    return true
  }
}

registerProcessor('aurvin-capture', AudioCaptureProcessor)
