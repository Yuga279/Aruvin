/**
 * ============================================================================
 * FILE: audio-capture-service.ts
 * LOCATION: frontend/src/features/voice/audio/audio-capture-service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Browser microphone acquisition, permission lifecycle, and Worklet routing.
 *
 * ROLE IN PROJECT:
 *    Manages explicit user-gesture capture lifecycle, MediaStream/AudioContext,
 *    worklet module loading via Vite ?worker&url, mute revision synchronization,
 *    live detector readiness, independent upload admission, and graceful stop.
 *
 * KEY COMPONENTS:
 *    - AudioCaptureService: Lifecycle controller for capture start/mute/stop.
 *    - CaptureOptions: Frame callbacks, errors, optional live speechGate, and
 *      injected test factories.
 *    - setUploading: Synchronous admission change without track/reset mutation.
 * ============================================================================
 */

import { DEFAULT_VOICE_LIMITS, isVoiceLimits } from '../../../api/voice-protocol.ts'
import workletUrl from './audio-capture-processor.ts?worker&url'

type CaptureOptions = {
  frame: (pcm: Uint8Array, flags: 0 | 1) => void
  error: (code: string) => void
  maxPendingMs?: number
  speechGate?: (state: 'suspended' | 'speech') => void
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  context?: () => AudioContext
  node?: (context: AudioContext, maxPendingMs: number) => AudioWorkletNode
}

export class AudioCaptureService {
  private readonly options: CaptureOptions
  private stream?: MediaStream
  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private node?: AudioWorkletNode
  private lifetime = 0
  private revision = 0
  private accepting = false
  private starting = false
  private uploading = true
  private muted = true
  private sessionPendingMs?: number
  private waiter?: { revision: number; resolve: () => void; reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout> }

  constructor(options: CaptureOptions) { this.options = options }

  async start() {
    if (this.starting || this.context) throw new Error('VOICE_INVALID_STATE')
    this.starting = true
    const lifetime = ++this.lifetime
    let stream: MediaStream | undefined, context: AudioContext | undefined
    let node: AudioWorkletNode | undefined, source: MediaStreamAudioSourceNode | undefined
    let attached = false
    try {
      const get = this.options.getUserMedia ?? navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices)
      if (!get) throw new Error('UNSUPPORTED_AUDIO')
      // Noise suppression stays on with the speech gate too: with it off, auto-gain lifts steady room noise (a far webcam
      // mic) to within a few dB of the voice, so neither the gate nor Deepgram can tell when the speaker stops talking.
      stream = await get({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (lifetime !== this.lifetime) throw new Error('CAPTURE_CANCELLED')
      stream.getAudioTracks().forEach(track => { track.enabled = false })
      context = this.options.context?.() ?? new AudioContext()
      await Promise.all([context.resume(), context.audioWorklet.addModule(workletUrl)])
      if (context.state !== 'running') throw new Error('PLAYBACK_BLOCKED')
      if (lifetime !== this.lifetime) throw new Error('CAPTURE_CANCELLED')
      const max = this.options.maxPendingMs ?? 1000
      node = this.options.node?.(context, max) ?? new AudioWorkletNode(context, 'aurvin-capture', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { maxPendingMs: max, speechGate: Boolean(this.options.speechGate) } })
      source = context.createMediaStreamSource(stream)
      this.stream = stream; this.context = context; this.source = source; this.node = node
      attached = true
      node.port.onmessage = ({ data }) => {
        if (lifetime !== this.lifetime || data.revision !== this.revision) return
        if (data.type === 'reset') { this.resolveWaiter(); return }
        if (data.type === 'gate-ready' && this.options.speechGate) { this.resolveWaiter(); return }
        if (data.type === 'gate-error' && this.options.speechGate) {
          this.rejectWaiter('MEDIA_GATE_UNAVAILABLE'); this.fail('MEDIA_GATE_UNAVAILABLE'); return
        }
        if (data.type === 'gate' && this.options.speechGate && !this.muted) {
          this.options.speechGate(data.state); return
        }
        if (data.type === 'overflow') { this.fail('AUDIO_BUFFER_OVERFLOW'); return }
        if (data.type !== 'frame') return
        node!.port.postMessage({ type: 'ack', revision: this.revision })
        if (!this.accepting) return
        try { this.options.frame(new Uint8Array(data.pcm), data.flags) }
        catch { this.fail('AUDIO_BUFFER_OVERFLOW'); return }
        if (data.flags === 1) this.resolveWaiter()
      }
      node.onprocessorerror = () => this.fail(this.options.speechGate ? 'MEDIA_GATE_UNAVAILABLE' : 'UNSUPPORTED_AUDIO')
      stream.getTracks().forEach(track => { track.onended = () => this.fail('MICROPHONE_LOST') })
      if (this.options.speechGate) {
        const ready = this.wait(this.revision)
        node.port.postMessage({ type: 'initialize', revision: this.revision })
        await ready
        if (lifetime !== this.lifetime || node !== this.node) throw new Error('CAPTURE_CANCELLED')
      }
      source.connect(node); node.connect(context.destination)
      // Processor outputs silence: never route microphone samples to the speakers.
    } catch (error) {
      if (!(attached && lifetime !== this.lifetime)) {
        if (attached) { this.context = undefined; this.stream = undefined;
          this.source = undefined; this.node = undefined }
        source?.disconnect(); node?.disconnect(); node?.port.close()
        stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
        await context?.close().catch(() => {})
      }
      const name = error instanceof Error ? error.name : ''
      const message = error instanceof Error ? error.message : ''
      throw new Error(name === 'NotAllowedError' || name === 'SecurityError' ? 'MICROPHONE_DENIED'
        : name === 'NotFoundError' || name === 'NotReadableError' ? 'MICROPHONE_UNAVAILABLE'
        : ['CAPTURE_CANCELLED', 'PLAYBACK_BLOCKED', 'MEDIA_GATE_UNAVAILABLE'].includes(message) ? message
        : message === 'CAPTURE_TIMEOUT' ? 'MEDIA_GATE_UNAVAILABLE'
        : 'UNSUPPORTED_AUDIO')
    } finally { if (lifetime === this.lifetime) this.starting = false }
  }

  setUploading(enabled: boolean) {
    this.uploading = enabled
    this.accepting = !this.muted && (!this.options.speechGate || enabled)
    this.node?.port.postMessage({ type: 'upload', revision: this.revision, enabled })
  }

  private wait(revision: number) {
    this.rejectWaiter('CAPTURE_CANCELLED')
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined; reject(new Error('CAPTURE_TIMEOUT'))
      }, 1000)
      this.waiter = { revision, resolve, reject, timer }
    })
  }

  private resolveWaiter() {
    if (this.waiter?.revision !== this.revision) return
    clearTimeout(this.waiter.timer); this.waiter.resolve(); this.waiter = undefined
  }

  private rejectWaiter(code: string) {
    if (!this.waiter) return
    clearTimeout(this.waiter.timer); this.waiter.reject(new Error(code)); this.waiter = undefined
  }

  async setMuted(muted: boolean, maxPendingMs?: number) {
    const node = this.node
    if (!node) throw new Error('VOICE_INVALID_STATE')
    if (maxPendingMs !== undefined) {
      if (this.accepting || !isVoiceLimits({ ...DEFAULT_VOICE_LIMITS, inputQueueMs: maxPendingMs }))
        throw new Error('VOICE_INVALID_STATE')
      this.sessionPendingMs = maxPendingMs
    }
    this.muted = muted
    this.accepting = false
    if (muted && this.options.speechGate) this.uploading = false
    this.stream!.getAudioTracks().forEach(track => { track.enabled = false })
    const revision = ++this.revision
    const ready = this.wait(revision)
    node.port.postMessage({ type: 'reset', revision, muted, uploading: this.uploading,
      ...(this.sessionPendingMs === undefined ? {} : { maxPendingMs: this.sessionPendingMs }) })
    await ready
    if (node !== this.node || revision !== this.revision) return
    this.accepting = !muted && (!this.options.speechGate || this.uploading)
    this.stream!.getAudioTracks().forEach(track => { track.enabled = !muted })
  }

  private fail(code: string) { void this.stop(); this.options.error(code) }

  async stop(drain = false) {
    if (drain && this.node && this.accepting) {
      const done = this.wait(this.revision)
      this.node.port.postMessage({ type: 'drain', revision: this.revision })
      try { await done } catch { this.options.error('CAPTURE_TIMEOUT') }
    }
    this.lifetime++; this.revision++; this.starting = false; this.accepting = false
    this.muted = true; this.uploading = false
    this.rejectWaiter('CAPTURE_CANCELLED')
    this.source?.disconnect(); this.source = undefined
    if (this.node) {
      this.node.port.postMessage({ type: 'destroy', revision: this.revision })
      this.node.port.onmessage = null; this.node.onprocessorerror = null
      this.node.disconnect(); this.node.port.close(); this.node = undefined
    }
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
    this.stream = undefined
    const context = this.context; this.context = undefined
    await context?.close().catch(() => {})
  }
}
