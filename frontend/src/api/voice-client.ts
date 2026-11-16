/**
 * ============================================================================
 * FILE: voice-client.ts
 * LOCATION: frontend/src/api/voice-client.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Validated HTTP wrapper and native WebSocket transport client for voice sessions.
 *
 * ROLE IN PROJECT:
 *    Provides REST methods (config, create, end) and real-time WebSocket protocol
 *    handling (session start handshake, LE PCM binary framing, bounded reconnect,
 *    fenced epochs, control deduplication, and backpressure enforcement).
 *
 * KEY COMPONENTS:
 *    - VoiceHttpClient: REST client for creating/ending voice sessions and fetching config.
 *    - VoiceClient: WebSocket transport client managing connection lifecycle, binary audio
 *      transmission, control messages, cancellation invalidation, and live reconnection.
 * ============================================================================
 */

import { ApiClientError } from './client'
import { encodeVoiceAudio, decodeVoiceAudio, type VoiceAudioFrame } from './voice-audio'
import { VOICE_ROUTES, VOICE_ERROR_CODES, INPUT_AUDIO, DEFAULT_VOICE_LIMITS, isPublicVoiceConfig, isCreateVoiceSessionRequest,
  isCreateVoiceSessionResponse, parseVoiceControl, type CreateVoiceSessionRequest,
  type CreateVoiceSessionResponse, type PublicVoiceConfig, type VoiceClientPayload,
  type VoiceServerEvent } from './voice-protocol'

export class VoiceHttpClient {
  private readonly base: string
  private readonly fetcher: typeof fetch

  constructor(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.base = (options.baseUrl ?? import.meta.env?.VITE_API_BASE ?? '/api').replace(/\/+$/, '')
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  private async request(path: string, method: string, signal?: AbortSignal, body?: unknown) {
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), DEFAULT_VOICE_LIMITS.connectMs)
    const bounded = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
    try {
      const response = await this.fetcher(`${this.base}${path}`, { method, signal: bounded,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
       if (!response.ok) {
         const body: unknown = await response.json().catch(() => null)
         const error = body && typeof body === 'object' && 'error' in body ? body.error : body
         const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
           && (VOICE_ERROR_CODES as readonly string[]).includes(error.code) ? error.code : `HTTP_${response.status}`
         throw new ApiClientError(code, 'Voice is unavailable.', response.status, response.status >= 500 || response.status === 429)
       }
      return response.status === 204 ? undefined : await response.json() as unknown
    } catch (error) {
      if (error instanceof ApiClientError) throw error
      const code = signal?.aborted ? 'ABORTED' : timeout.signal.aborted ? 'VOICE_CONNECT_TIMEOUT'
        : error instanceof SyntaxError ? 'INVALID_VOICE_REQUEST' : 'NETWORK_ERROR'
      throw new ApiClientError(code, 'Voice connection unavailable.', 0,
        code === 'NETWORK_ERROR' || code === 'VOICE_CONNECT_TIMEOUT')
    } finally { clearTimeout(timer) }
  }

  async config(signal?: AbortSignal): Promise<PublicVoiceConfig> {
    const value = await this.request(VOICE_ROUTES.config, 'GET', signal)
    if (!isPublicVoiceConfig(value)) throw new Error('INVALID_VOICE_REQUEST')
    return value
  }

  async create(request: CreateVoiceSessionRequest, signal?: AbortSignal, previous?: CreateVoiceSessionResponse): Promise<CreateVoiceSessionResponse> {
    if (!isCreateVoiceSessionRequest(request)) throw new Error('INVALID_VOICE_REQUEST')
    const value = await this.request(VOICE_ROUTES.sessions, 'POST', signal, request)
    if (!isCreateVoiceSessionResponse(value) || value.mode !== request.mode ||
      (value.conversationId !== request.conversationId && !(previous && previous.conversationId === null &&
        previous.sessionId === value.sessionId && value.connectionEpoch > previous.connectionEpoch &&
        previous.mode === value.mode && request.conversationId === null))) throw new Error('INVALID_VOICE_REQUEST')
    return value
  }

  async end(id: string, signal?: AbortSignal) {
    if (!id || id.length > 128) throw new Error('INVALID_VOICE_REQUEST')
    await this.request(VOICE_ROUTES.session(id), 'DELETE', signal)
  }
}

export type VoiceClientOptions = {
  pageUrl?: string
  socket?: (url: string) => WebSocket
  id?: () => string
  event?: (event: VoiceServerEvent) => void
  audio?: (frame: VoiceAudioFrame, ref: { turnId: string; responseId: string }) => void
  lost?: () => void
  recovered?: (session: CreateVoiceSessionResponse) => void
  error?: (code: string) => void
  ended?: () => void
  reauthorize?: (previous: CreateVoiceSessionResponse, signal: AbortSignal) => Promise<CreateVoiceSessionResponse>
  random?: () => number
}

export class VoiceClient {
  private readonly options: VoiceClientOptions
  private socket?: WebSocket
  private session?: CreateVoiceSessionResponse
  private ready = false
  private closed = false
  private muted = false
  private tx = 0
  private rx = -1
  private inputSequence = 0
  private inputSamples = 0
  private inputEnded = false
  private outputSequence = 0
  private outputOffset = -1
  private response?: { turnId: string; responseId: string; invalid: boolean;
    last: number | null; closing?: number }
  private connectTimer?: ReturnType<typeof setTimeout>
  private recovering = false
  private retryAttempt = 0
  private deadline = 0
  private retryTimer?: ReturnType<typeof setTimeout>
  private deadlineTimer?: ReturnType<typeof setTimeout>
  private reauth?: AbortController
  // ponytail: at most 4096 response IDs per client lifetime; fail closed, then start a new session.
  private readonly responsesSeen = new Set<string>()

  constructor(options: VoiceClientOptions = {}) { this.options = options }

  connect(session: CreateVoiceSessionResponse) {
    if (!isCreateVoiceSessionResponse(session) || Date.parse(session.expiresAt) <= Date.now())
      throw new Error('INVALID_VOICE_REQUEST')
    if (this.socket || this.closed) throw new Error('VOICE_INVALID_STATE')
    this.session = session
    this.tx = 0
    this.rx = -1
    this.inputSequence = 0
    this.inputSamples = 0
    this.inputEnded = false
    this.outputSequence = 0
    this.outputOffset = -1
    this.ready = false
    this.muted = false
    this.response = undefined
    const url = new URL(session.websocketUrl, this.options.pageUrl ?? location.href)
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/api/voice' || url.search || url.hash)
      throw new Error('INVALID_VOICE_REQUEST')
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = (this.options.socket ?? (url => new WebSocket(url)))(url.href)
    this.socket = socket
    socket.binaryType = 'arraybuffer'
    this.connectTimer = setTimeout(() => this.fail('VOICE_CONNECT_TIMEOUT'), session.limits.connectMs)
    const current = () => this.socket === socket && !this.closed
    socket.onopen = () => { if (current()) this.send({ type: 'session.start', mode: session.mode, audioSettings: INPUT_AUDIO }, true) }
    socket.onmessage = ({ data }) => { if (current()) this.receive(data) }
    socket.onclose = () => { if (current()) this.disconnect() }
    socket.onerror = () => { if (current()) this.disconnect() }
  }

  private send(payload: VoiceClientPayload, handshake = false) {
    const session = this.session, socket = this.socket
    if (!session || (!handshake && !this.ready)) return false
    if (socket?.readyState !== 1) { this.disconnect(); return false }
    if (this.tx > 0xffffffff) { this.fail('VOICE_SEQUENCE_ERROR'); return false }
    const event = { protocolVersion: 1, sessionId: session.sessionId, connectionEpoch: session.connectionEpoch,
      eventId: this.options.id?.() ?? crypto.randomUUID(), sequence: this.tx, ...payload }
    const json = JSON.stringify(event)
    parseVoiceControl(json, 'client', session.mode)
    if (socket.bufferedAmount + new TextEncoder().encode(json).length > this.inputBudget()) {
      this.fail('AUDIO_BUFFER_OVERFLOW')
      return false
    }
    try { socket.send(json) } catch { this.disconnect(); return false }
    this.tx++
    return true
  }

  control(payload: Exclude<VoiceClientPayload, { type: 'session.start' }>) {
    if (payload.type === 'response.interrupt') this.invalidate(payload.responseId)
    if (payload.type === 'input.mute') this.muted = true
    if (['dictation.stop', 'dictation.cancel', 'session.end'].includes(payload.type)) this.inputEnded = true
    const sent = this.send(payload)
    if (payload.type === 'input.unmute' && sent) this.muted = false
    return sent
  }

  private inputBudget() {
    // Include framing overhead, but no extra unbounded application queue.
    const ms = this.session!.limits.inputQueueMs
    return Math.floor(ms * 32 + Math.ceil(ms / 80) * 16)
  }

  sendInput(pcm: Uint8Array, flags: 0 | 1 = 0) {
    const socket = this.socket
    if (!this.ready || this.muted || this.inputEnded) return false
    if (socket?.readyState !== 1) { this.disconnect(); return false }
    if ((flags === 0 && pcm.length !== 2560) || (flags === 1 && pcm.length > 2560)) {
      this.fail('INVALID_AUDIO_FRAME')
      return false
    }
    let bytes: Uint8Array
    try { bytes = encodeVoiceAudio({ kind: 1, flags, sequence: this.inputSequence,
      offsetMs: Math.floor(this.inputSamples / 16), pcm }) }
    catch { this.fail('INVALID_AUDIO_FRAME'); return false }
    if (socket.bufferedAmount + bytes.length > this.inputBudget()) {
      this.fail('AUDIO_BUFFER_OVERFLOW')
      return false
    }
    try { socket.send(new Uint8Array(bytes)) } catch { this.disconnect(); return false }
    this.inputSequence++
    this.inputSamples += pcm.length / 2
    if (flags === 1) this.inputEnded = true
    return true
  }

  invalidate(responseId: string) {
    if (this.response?.responseId === responseId) this.response.invalid = true
  }

  private receive(data: unknown) {
    try {
      if (typeof data === 'string') {
        const event = parseVoiceControl(data, 'server', this.session!.mode)
        if (event.sessionId !== this.session!.sessionId) throw new Error('VOICE_BINDING_MISMATCH')
        if (event.connectionEpoch < this.session!.connectionEpoch) return
        if (event.connectionEpoch !== this.session!.connectionEpoch) throw new Error('STALE_CONNECTION_EPOCH')
        if (event.sequence <= this.rx) return
        if (event.sequence !== this.rx + 1) throw new Error('VOICE_SEQUENCE_ERROR')
        if (!this.ready && !['session.ready', 'session.error', 'session.ended'].includes(event.type))
          throw new Error('VOICE_INVALID_STATE')
        this.rx = event.sequence
        if (event.type === 'session.ready') {
          const settings = event.effectiveAudioSettings
          const admitted = this.session!.effectiveAudioSettings
          const sameInput = Object.entries(admitted.input).every(([key, value]) =>
            settings.input[key as keyof typeof settings.input] === value)
          const sameOutput = admitted.output === null ? settings.output === null
            : settings.output !== null && Object.entries(admitted.output).every(([key, value]) =>
              settings.output![key as keyof typeof settings.output] === value)
          const sameLimits = Object.entries(this.session!.limits).every(([key, value]) =>
            event.limits[key as keyof typeof event.limits] === value)
          if (this.ready || !sameInput || !sameOutput || !sameLimits) throw new Error('VOICE_INVALID_STATE')
          this.ready = true
          clearTimeout(this.connectTimer)
          this.onReady()
        } else if (event.type === 'audio.start') {
          if (this.response || event.firstAudioSequence !== this.outputSequence) throw new Error('VOICE_INVALID_STATE')
          if (this.responsesSeen.has(event.responseId) || this.responsesSeen.size >= 4096)
            throw new Error('VOICE_INVALID_STATE')
          this.responsesSeen.add(event.responseId)
          this.response = { turnId: event.turnId, responseId: event.responseId, invalid: false, last: null }
        } else if (event.type === 'response.cancelled' && !this.response && event.lastAudioSequence === null) {
          // The server can cancel a thinking turn before any audio.start exists.
          if (this.responsesSeen.has(event.responseId) || this.responsesSeen.size >= 4096)
            throw new Error('VOICE_INVALID_STATE')
          this.responsesSeen.add(event.responseId)
        } else if (event.type === 'audio.end' || event.type === 'response.cancelled') {
          const response = this.response
          if (!response || response.responseId !== event.responseId || response.turnId !== event.turnId)
            throw new Error('VOICE_INVALID_STATE')
          if (event.type === 'audio.end') {
            if (response.last !== event.lastAudioSequence) throw new Error('VOICE_SEQUENCE_ERROR')
            this.response = undefined
          } else {
            response.invalid = true
            if (event.lastAudioSequence === response.last) this.response = undefined
            else {
              if (event.lastAudioSequence === null || event.lastAudioSequence < this.outputSequence ||
                event.lastAudioSequence - this.outputSequence > 10) throw new Error('VOICE_SEQUENCE_ERROR')
              response.closing = event.lastAudioSequence
            }
          }
        }
        if (event.type === 'conversation.bound') {
          if (this.session!.conversationId !== null && this.session!.conversationId !== event.conversationId)
            throw new Error('VOICE_BINDING_MISMATCH')
          this.session = { ...this.session!, conversationId: event.conversationId }
        }
        this.options.event?.(event)
        if (this.session!.mode === 'live' && (event.type === 'session.error' || event.type === 'session.ended') &&
          event.terminal === false) return
        if (event.type === 'session.ended') { this.dispose(); this.options.ended?.() }
        if (event.type === 'session.error') this.fail(event.code)
        return
      }
      if (!(data instanceof ArrayBuffer)) throw new Error('INVALID_AUDIO_FRAME')
      const frame = decodeVoiceAudio(new Uint8Array(data))
      if (!this.ready || this.session!.mode !== 'live' || !this.response || frame.kind !== 2)
        throw new Error('VOICE_INVALID_STATE')
      if (frame.sequence < this.outputSequence) return
      if (frame.sequence !== this.outputSequence || frame.offsetMs < this.outputOffset)
        throw new Error('VOICE_SEQUENCE_ERROR')
      this.outputSequence++
      this.outputOffset = frame.offsetMs
      this.response.last = frame.sequence
      if (!this.response.invalid) this.options.audio?.(frame, this.response)
      if (this.response?.closing === frame.sequence) this.response = undefined
    } catch (error) { this.fail(error instanceof Error ? error.message : 'INVALID_VOICE_CONTROL') }
  }

  private detach() {
    clearTimeout(this.connectTimer)
    const socket = this.socket
    this.socket = undefined
    this.ready = false
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      socket.close()
    }
    this.response = undefined
  }

  private fail(code: string) { this.dispose(); this.options.error?.(code); this.options.lost?.() }

  private disconnect() {
    if (this.closed) return
    this.options.lost?.()
    this.detach()
    if (this.session!.mode === 'dictation') { this.dispose(); this.options.error?.('DICTATION_DISCONNECTED'); return }
    if (!this.options.reauthorize) { this.fail('VOICE_RECONNECT_TIMEOUT'); return }
    if (!this.recovering) {
      this.recovering = true
      this.retryAttempt = 0
      this.deadline = Date.now() + this.session!.limits.reconnectMs
      this.deadlineTimer = setTimeout(() => this.fail('VOICE_RECONNECT_TIMEOUT'), this.session!.limits.reconnectMs)
    }
    this.retry()
  }

  private retry() {
    if (this.closed) return
    clearTimeout(this.retryTimer)
    const remaining = this.deadline - Date.now()
    if (remaining <= 0) { this.fail('VOICE_RECONNECT_TIMEOUT'); return }
    const random = Math.max(0, Math.min(1, this.options.random?.() ?? Math.random()))
    const delay = Math.min(remaining, Math.min(2000, 250 * 2 ** Math.min(this.retryAttempt++, 4)) * (0.8 + 0.4 * random))
    this.retryTimer = setTimeout(() => { void this.reconnect() }, delay)
  }

  private async reconnect() {
    if (this.closed || Date.now() >= this.deadline) return
    const previous = this.session!
    const abort = new AbortController()
    this.reauth = abort
    try {
      const next = await this.options.reauthorize!(previous, abort.signal)
      if (this.closed || abort.signal.aborted || Date.now() >= this.deadline) return
      if (!isCreateVoiceSessionResponse(next) || next.sessionId !== previous.sessionId ||
        next.connectionEpoch <= previous.connectionEpoch || next.mode !== previous.mode ||
        (previous.conversationId !== null && next.conversationId !== previous.conversationId)) { this.fail('STALE_CONNECTION_EPOCH'); return }
      this.connect(next)
      clearTimeout(this.connectTimer)
      this.connectTimer = setTimeout(() => this.disconnect(), Math.min(next.limits.connectMs, this.deadline - Date.now()))
    } catch (error) {
      if (this.closed || abort.signal.aborted) return
      if (error instanceof ApiClientError && !error.retryable) { this.fail(error.code); return }
      this.retry()
    } finally { if (this.reauth === abort) this.reauth = undefined }
  }

  private onReady() {
    if (!this.recovering) return
    clearTimeout(this.retryTimer)
    clearTimeout(this.deadlineTimer)
    this.recovering = false
    this.options.recovered?.(this.session!)
  }

  dispose() {
    if (this.closed) return
    this.closed = true
    this.recovering = false
    clearTimeout(this.retryTimer)
    clearTimeout(this.deadlineTimer)
    this.reauth?.abort()
    this.reauth = undefined
    this.detach()
  }
}
