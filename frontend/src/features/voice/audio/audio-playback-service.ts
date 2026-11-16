/**
 * ============================================================================
 * FILE: audio-playback-service.ts
 * LOCATION: frontend/src/features/voice/audio/audio-playback-service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Browser 24 kHz raw PCM audio playback scheduler and progress tracker.
 *
 * ROLE IN PROJECT:
 *    Schedules 24 kHz 16-bit mono PCM playback chunks using Web Audio API, tracks
 *    audible consumed samples vs received bytes, enforces queue limits, handles
 *    immediate interruption, and manages gesture unlock.
 *
 * KEY COMPONENTS:
 *    - AudioPlaybackService: Manages buffer scheduling, audible cursor tracking,
 *      queue overflow enforcement, interruption, and cleanup.
 *    - PlaybackProgress: Reported progress with turnId, responseId, playedMs,
 *      playedSamples, and consumedSamples.
 *    - observations(): Local startup-reserve and underrun scheduler facts.
 * ============================================================================
 */

import type { VoiceAudioFrame } from '../../../api/voice-audio'
import { DEFAULT_VOICE_LIMITS, isVoiceLimits } from '../../../api/voice-protocol'

type Entry = { source: AudioBufferSourceNode; start: number; samples: number; offset: number;
  stopped: boolean; responseId: string }
export type PlaybackProgress = { turnId: string; responseId: string; playedMs: number;
  playedSamples: number; consumedSamples: number }

export class AudioPlaybackService {
  private readonly create: () => AudioContext
  private queueMs: number
  private context?: AudioContext
  private entries: Entry[] = []
  private nextTime = 0
  private cursor = 0
  private consumed = 0
  private received = 0
  private firstPacket = true
  private startupPending = true
  private startupReserveMs = 0
  private underruns = 0
  private underrunSamples = 0
  private ref = { turnId: '', responseId: '' }
  private accepting = false
  private ended = true

  constructor(create: () => AudioContext = () => new AudioContext(), queueMs = 2000) {
    this.create = create
    this.queueMs = queueMs
  }

  configureSessionQueue(ms: number) {
    if (this.accepting || this.entries.length ||
        !isVoiceLimits({ ...DEFAULT_VOICE_LIMITS, outputQueueMs: ms })) throw new Error('VOICE_INVALID_STATE')
    this.queueMs = ms
  }

  async unlock() {
    this.context ??= this.create()
    await this.context.resume()
    if (this.context.state !== 'running') throw new Error('PLAYBACK_BLOCKED')
  }

  begin(turnId: string, responseId: string, origin?: number) {
    this.progress()
    if (this.entries.length || this.accepting) throw new Error('VOICE_INVALID_STATE')
    this.ref = { turnId, responseId }
    this.firstPacket = true
    if (origin !== undefined) {
      if (!Number.isSafeInteger(origin) || origin < this.received || origin % 24) throw new Error('VOICE_SEQUENCE_ERROR')
      this.cursor = origin
      this.received = origin
      this.firstPacket = false
    }
    this.nextTime = this.context?.currentTime ?? 0
    this.startupPending = true
    this.startupReserveMs = 0
    this.underruns = 0
    this.underrunSamples = 0
    this.accepting = true
    this.ended = false
  }

  private audibleTime() {
    if (!this.context) return 0
    const timestamp = this.context.getOutputTimestamp?.()
    const candidate = timestamp?.contextTime
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? Math.min(this.context.currentTime, candidate)
      : Math.max(0, this.context.currentTime - (this.context.baseLatency ?? 0) - (this.context.outputLatency ?? 0))
  }

  private played(entry: Entry, now: number) {
    return Math.min(entry.samples, Math.max(0, Math.floor((now - entry.start) * 24000 + 1e-6)))
  }

  private stopNode(entry: Entry) {
    if (entry.stopped) return
    entry.stopped = true
    try { entry.source.stop() } catch { /* Already ended. */ }
    entry.source.disconnect()
  }

  progress(): PlaybackProgress {
    const now = this.audibleTime()
    let consumed = this.consumed
    const pending: Entry[] = []
    for (const entry of this.entries) {
      const played = this.played(entry, now)
      consumed += played
      if (played > 0) this.cursor = Math.max(this.cursor, entry.offset + played)
      if (played === entry.samples) {
        this.consumed += entry.samples
        entry.source.disconnect()
      } else pending.push(entry)
    }
    this.entries = pending
    return { ...this.ref, playedMs: Math.floor(this.cursor / 24), playedSamples: this.cursor,
      consumedSamples: consumed }
  }

  enqueue(responseId: string, frame: VoiceAudioFrame) {
    if (!this.accepting || responseId !== this.ref.responseId) return false
    const context = this.context
    if (!context || context.state !== 'running') throw new Error('PLAYBACK_BLOCKED')
    if (frame.kind !== 2 || frame.pcm.length % 2 || frame.pcm.length > 9600) throw new Error('INVALID_AUDIO_FRAME')
    this.progress()
    const samples = frame.pcm.length / 2
    if (!samples) return true
    const pendingSamples = this.entries.reduce((n, e) => n + e.samples - this.played(e, this.audibleTime()), 0)
    if ((pendingSamples + samples) / 24 > this.queueMs) {
      this.interrupt()
      throw new Error('AUDIO_BUFFER_OVERFLOW')
    }
    const buffer = context.createBuffer(1, samples, 24000)
    const float = buffer.getChannelData(0)
    const pcm = new DataView(frame.pcm.buffer, frame.pcm.byteOffset, frame.pcm.byteLength)
    for (let i = 0; i < samples; i++) {
      const value = pcm.getInt16(i * 2, true)
      float[i] = value < 0 ? value / 32768 : value / 32767
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    const gapSamples = this.startupPending ? 0
      : Math.round(Math.max(0, context.currentTime - this.nextTime) * 24000)
    if (gapSamples > 0) {
      this.underruns++
      this.underrunSamples += gapSamples
    }
    // ponytail: one fixed 100ms response-start reserve, never a packet/sentence delay; adaptive rebuffering needs separate measured authorization.
    const start = Math.max(context.currentTime, this.nextTime) + (this.startupPending ? 0.1 : 0)
    if (this.startupPending) this.startupReserveMs = 100
    this.startupPending = false
    source.start(start)
    this.nextTime = start + samples / 24000
    // Response origins are millisecond aligned; packet boundaries are not.
    const offset = this.firstPacket ? frame.offsetMs * 24 : this.received
    if (Math.floor(offset / 24) !== frame.offsetMs) {
      source.stop(); source.disconnect(); throw new Error('VOICE_SEQUENCE_ERROR')
    }
    this.firstPacket = false
    this.received = offset + samples
    this.entries.push({ source, start, samples, offset,
      stopped: false, responseId })
    return true
  }

  observations() {
    return { ...this.ref, startupReserveMs: this.startupReserveMs,
      underruns: this.underruns, underrunMs: this.underrunSamples / 24 }
  }

  end(responseId: string) {
    if (responseId === this.ref.responseId) { this.accepting = false; this.ended = true }
  }

  isDrained() { this.progress(); return this.ended && this.entries.length === 0 }

  interrupt() {
    const progress = this.progress()
    this.consumed = progress.consumedSamples
    this.accepting = false
    this.ended = true
    this.entries.forEach(entry => this.stopNode(entry))
    this.entries = []
    this.nextTime = this.context?.currentTime ?? 0
    return progress
  }

  resetOrigin() {
    this.interrupt()
    this.cursor = 0
    this.consumed = 0
    this.received = 0
    this.ref = { turnId: '', responseId: '' }
  }

  async dispose() {
    this.interrupt()
    const context = this.context
    this.context = undefined
    await context?.close().catch(() => {})
  }
}
