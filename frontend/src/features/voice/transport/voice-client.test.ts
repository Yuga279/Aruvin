/**
 * ============================================================================
 * FILE: voice-client.test.ts
 * LOCATION: frontend/src/features/voice/transport/voice-client.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for VoiceHttpClient and VoiceClient transport.
 *
 * ROLE IN PROJECT:
 *    Verifies REST endpoint contracts, WebSocket lifecycle, binary frame
 *    encoding/decoding, sequence validation, response cancellation fencing,
 *    bounded live reconnection, and dictation disconnect handling.
 *
 * KEY COMPONENTS:
 *    - VoiceHttpClient tests: create, config, abort signals, connect timeout.
 *    - VoiceClient tests: handshake, deduplication, epoch fencing, reconnect,
 *      audio frame bounds and backpressure.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest'
import { VoiceClient, VoiceHttpClient } from '../../../api/voice-client'
import { decodeVoiceAudio } from '../../../api/voice-audio'
import { FakeSocket, session, ready, control, output } from './testing/voice-fakes'

afterEach(() => vi.useRealTimers())

const request = { protocolVersion: 1 as const, mode: 'live' as const, conversationId: null,
  locale: 'en-US' as const, idempotencyKey: 'voice-request-1' }

it('validates HTTP request and response without browser identity or key overrides', async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(session()), {
    status: 200, headers: { 'Content-Type': 'application/json' } }))
  const http = new VoiceHttpClient({ fetch: fetcher })
  expect(await http.create(request)).toEqual(session())
  expect(fetcher.mock.calls[0][0]).toBe('/api/voice/sessions')
  await expect(http.create({ ...request, userId: 'bad' } as typeof request)).rejects.toThrow('INVALID_VOICE_REQUEST')
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...session(), apiKey: 'hidden' })))
  await expect(http.create(request)).rejects.toThrow('INVALID_VOICE_REQUEST')
})

it('bounds HTTP acquisition and clears its timeout after user cancellation', async () => {
  vi.useFakeTimers()
  const fetcher: typeof fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }))
  const http = new VoiceHttpClient({ fetch: fetcher })
  const timeout = http.create(request)
  const timedOut = expect(timeout).rejects.toMatchObject({ code: 'VOICE_CONNECT_TIMEOUT' })
  await vi.advanceTimersByTimeAsync(10000)
  await timedOut
  const abort = new AbortController()
  const cancelled = http.create(request, abort.signal)
  const wasCancelled = expect(cancelled).rejects.toMatchObject({ code: 'ABORTED' })
  abort.abort()
  await wasCancelled
  expect(vi.getTimerCount()).toBe(0)
})

it('uses wss /api/voice, handshake before capture, and the existing 16-byte LE encoder', () => {
  const socket = new FakeSocket(), factory = vi.fn(() => socket.asSocket())
  const client = new VoiceClient({ socket: factory, pageUrl: 'https://aurvin.example/chat', id: () => 'id' })
  client.connect(session())
  expect(factory).toHaveBeenCalledWith('wss://aurvin.example/api/voice')
  expect(socket.binaryType).toBe('arraybuffer')
  expect(client.sendInput(new Uint8Array(2560))).toBe(false)
  socket.open()
  expect(JSON.parse(socket.sent[0] as string)).toMatchObject({ type: 'session.start', sequence: 0,
    connectionEpoch: 1, sessionId: 'v1' })
  socket.receive(ready())
  expect(client.sendInput(new Uint8Array(2560))).toBe(true)
  expect(client.sendInput(new Uint8Array(640), 1)).toBe(true)
  const first = socket.sent[1] as Uint8Array, tail = socket.sent[2] as Uint8Array
  expect([...first.slice(0, 16)]).toEqual([175, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0])
  expect(decodeVoiceAudio(tail)).toMatchObject({ sequence: 1, offsetMs: 80, flags: 1 })
  client.dispose()
  client.dispose()
  expect(socket.close).toHaveBeenCalledTimes(1)
})

it('accepts cancellation before audio starts and keeps the next response usable', () => {
  const socket = new FakeSocket(), event = vi.fn(), error = vi.fn(), audio = vi.fn()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', event, error, audio })
  client.connect(session()); socket.open(); socket.receive(ready())
  socket.receive(control({ type: 'response.cancelled', turnId: 't1', responseId: 'r1', lastAudioSequence: null }, 1))
  expect(error).not.toHaveBeenCalled()
  expect(event).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'response.cancelled', responseId: 'r1' }))
  socket.receive(control({ type: 'audio.start', turnId: 't2', responseId: 'r2', sampleRate: 24000, firstAudioSequence: 0 }, 2))
  socket.receive(output())
  expect(audio).toHaveBeenCalledTimes(1)
  expect(error).not.toHaveBeenCalled()
  client.dispose()
})

it('does not accept unbound cancellation claiming audio was already sent', () => {
  const socket = new FakeSocket(), error = vi.fn()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', error })
  client.connect(session()); socket.open(); socket.receive(ready())
  socket.receive(control({ type: 'response.cancelled', turnId: 't1', responseId: 'r1', lastAudioSequence: 0 }, 1))
  expect(error).toHaveBeenCalledWith('VOICE_INVALID_STATE')
  client.dispose()
})

it('deduplicates controls, fences cancelled responses and old epochs, and rejects gaps', () => {
  const socket = new FakeSocket(), event = vi.fn(), audio = vi.fn(), error = vi.fn()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', event, audio, error })
  client.connect(session())
  socket.open()
  socket.receive(ready())
  const start = control({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0 }, 1)
  socket.receive(start)
  socket.receive(start)
  expect(event).toHaveBeenCalledTimes(2)
  socket.receive(output())
  expect(audio).toHaveBeenCalledTimes(1)
  client.invalidate('r1')
  socket.receive(output(1, 100))
  expect(audio).toHaveBeenCalledTimes(1)
  socket.receive(control({ type: 'audio.end', turnId: 't1', responseId: 'r1', lastAudioSequence: 1 }, 2))
  socket.receive(control({ type: 'audio.start', turnId: 't2', responseId: 'r2', sampleRate: 24000,
    firstAudioSequence: 2 }, 3))
  socket.receive(output(2, 200))
  expect(audio).toHaveBeenCalledTimes(2)
  socket.receive(ready(0, 0))
  expect(error).not.toHaveBeenCalled()
  socket.receive(control({ type: 'voice.state', input: 'listening', agent: 'thinking', connection: 'connected' }, 5))
  expect(error).toHaveBeenCalledWith('VOICE_SEQUENCE_ERROR')
  expect(socket.close).toHaveBeenCalled()
})

it('fails on hidden live text, malformed audio, illegal state or input backpressure', () => {
  for (const bad of ['text', 'audio', 'state', 'backpressure']) {
    const socket = new FakeSocket(), error = vi.fn()
    const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', error })
    client.connect(session())
    socket.open()
    socket.receive(ready())
    if (bad === 'text') socket.receive(JSON.stringify({ ...JSON.parse(ready(1)), text: 'hidden' }))
    if (bad === 'audio') socket.receive(new Uint8Array([1, 2]).buffer)
    if (bad === 'state') socket.receive(output())
    if (bad === 'backpressure') { socket.bufferedAmount = 32000; client.sendInput(new Uint8Array(2560)) }
    expect(error).toHaveBeenCalledTimes(1)
    expect(socket.close).toHaveBeenCalledTimes(1)
  }
})

it('reconnects live transport only, fences old socket callbacks and never replays audio', async () => {
  vi.useFakeTimers()
  const first = new FakeSocket(), second = new FakeSocket(), lost = vi.fn(), recovered = vi.fn()
  const reauthorize = vi.fn(async () => session(2))
  const factory = vi.fn().mockReturnValueOnce(first.asSocket()).mockReturnValueOnce(second.asSocket())
  const client = new VoiceClient({ socket: factory, pageUrl: 'http://localhost', random: () => 0.5,
    reauthorize, lost, recovered })
  client.connect(session())
  first.open()
  first.receive(ready())
  client.sendInput(new Uint8Array(2560))
  const oldMessage = first.onmessage!
  first.lose()
  expect(lost).toHaveBeenCalledTimes(1)
  expect(client.sendInput(new Uint8Array(2560))).toBe(false)
  await vi.advanceTimersByTimeAsync(250)
  second.open()
  second.receive(ready(0, 2))
  oldMessage({ data: ready(1) } as MessageEvent)
  expect(recovered).toHaveBeenCalledWith(session(2))
  expect(second.sent).toHaveLength(1)
  client.sendInput(new Uint8Array(2560))
  expect(decodeVoiceAudio(second.sent[1] as Uint8Array)).toMatchObject({ sequence: 0, offsetMs: 0 })
  client.dispose()
})

it('bounds all live reauthorization and ready waits by ten seconds and aborts HTTP on exit', async () => {
  vi.useFakeTimers()
  const socket = new FakeSocket(), error = vi.fn()
  let signal!: AbortSignal
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', random: () => 0.5,
    error, reauthorize: async (_previous, abort) => { signal = abort; return new Promise(() => {}) } })
  client.connect(session())
  socket.open()
  socket.receive(ready())
  socket.lose()
  await vi.advanceTimersByTimeAsync(10000)
  expect(error).toHaveBeenCalledWith('VOICE_RECONNECT_TIMEOUT')
  expect(signal.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('dictation never auto reconnects and changed session IDs or nonadvancing epochs fail closed', async () => {
  vi.useFakeTimers()
  const socket = new FakeSocket(), retry = vi.fn(), error = vi.fn()
  const dictation = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost',
    error, reauthorize: retry })
  dictation.connect(session(1, 'dictation'))
  socket.open()
  socket.receive(ready(0, 1, 'dictation'))
  socket.lose()
  await vi.advanceTimersByTimeAsync(10000)
  expect(retry).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledWith('DICTATION_DISCONNECTED')
  for (const invalid of [session(1), { ...session(2), sessionId: 'new-session' }]) {
    const liveSocket = new FakeSocket(), invalidError = vi.fn()
    const live = new VoiceClient({ socket: () => liveSocket.asSocket(), pageUrl: 'http://localhost',
      random: () => 0.5, error: invalidError, reauthorize: async () => invalid })
    live.connect(session())
    liveSocket.open()
    liveSocket.receive(ready())
    liveSocket.lose()
    await vi.advanceTimersByTimeAsync(250)
    expect(invalidError).toHaveBeenCalledWith('STALE_CONNECTION_EPOCH')
  }
})

it('accepts structurally identical ready settings regardless of JSON property order', () => {
  const socket = new FakeSocket(), error = vi.fn()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', error })
  client.connect(session())
  socket.open()
  const event = JSON.parse(ready())
  event.limits = Object.fromEntries(Object.entries(event.limits).reverse())
  event.effectiveAudioSettings.input = Object.fromEntries(Object.entries(event.effectiveAudioSettings.input).reverse())
  socket.receive(JSON.stringify(event))
  expect(error).not.toHaveBeenCalled()
  expect(client.sendInput(new Uint8Array(2560))).toBe(true)
  client.dispose()
})

it('recovers a lost first binding only within the same session and advancing epoch', async () => {
  vi.useFakeTimers()
  const first = new FakeSocket(), second = new FakeSocket(), recovered = vi.fn(), error = vi.fn()
  const bound = { ...session(2), conversationId: 'bound-chat' }
  const http = new VoiceHttpClient({ fetch: vi.fn(async () => new Response(JSON.stringify(bound))) })
  const client = new VoiceClient({ socket: vi.fn().mockReturnValueOnce(first.asSocket()).mockReturnValueOnce(second.asSocket()),
    pageUrl: 'http://localhost', random: () => 0.5, recovered, error, reauthorize: previous => http.create(request, undefined, previous) })
  client.connect(session()); first.open(); first.receive(ready()); first.lose()
  await vi.advanceTimersByTimeAsync(250); second.open(); second.receive(ready(0, 2))
  expect(error).not.toHaveBeenCalled(); expect(recovered).toHaveBeenCalledWith(bound)
  client.dispose()
})

it('preserves only allowlisted structured HTTP voice failure codes', async () => {
  for (const code of ['VOICE_QUOTA_EXHAUSTED', 'TTS_UNAVAILABLE', 'secret-provider-payload']) {
    const http = new VoiceHttpClient({ fetch: vi.fn(async () => new Response(JSON.stringify({ error: { code } }), { status: 503 })) })
    await expect(http.create(request)).rejects.toMatchObject({ code: code === 'secret-provider-payload' ? 'HTTP_503' : code })
  }
})

it('delivers a fatal code before loss cleanup can erase it, without retrying an intentional end', () => {
  const socket = new FakeSocket(), calls: string[] = [], reauthorize = vi.fn()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', reauthorize,
    lost: () => calls.push('lost'), error: code => calls.push(code) })
  client.connect(session()); socket.open(); socket.receive(ready())
  socket.bufferedAmount = 32000; client.sendInput(new Uint8Array(2560))
  expect(calls).toEqual(['AUDIO_BUFFER_OVERFLOW', 'lost']); expect(reauthorize).not.toHaveBeenCalled()
})
