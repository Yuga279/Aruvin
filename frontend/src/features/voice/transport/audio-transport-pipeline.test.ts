/**
 * ============================================================================
 * FILE: audio-transport-pipeline.test.ts
 * LOCATION: frontend/src/features/voice/transport/audio-transport-pipeline.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integration regression tests for Audio and Transport pipeline components.
 *
 * ROLE IN PROJECT:
 *    Validates cross-component interactions between PcmResampler, AudioCaptureService,
 *    AudioPlaybackService, and VoiceClient in Node test environment.
 *
 * KEY COMPONENTS:
 *    - Pipeline baseline tests: resampled PCM to framed input, heard output on interrupt.
 *    - Edge regressions: terminal input closure, output overlap prevention,
 *      cancelled range drain, response ID reuse fencing, idle drift, backpressure.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest'
import { PcmResampler } from '../audio/pcm-resampler'
import { AudioCaptureService } from '../audio/audio-capture-service'
import { AudioPlaybackService } from '../audio/audio-playback-service'
import { FakeContext, FakeNode, fakeStream } from '../audio/testing/audio-fakes'
import { VoiceClient } from '../../../api/voice-client'
import { decodeVoiceAudio } from '../../../api/voice-audio'
import { FakeSocket, session, ready, control, output } from './testing/voice-fakes'

vi.mock('../audio/audio-capture-processor.ts?worker&url', () => ({ default: '/capture-worklet.js' }))
afterEach(() => vi.useRealTimers())

it('moves deterministic native-rate PCM through framed input and tracks heard output on interrupt', async () => {
  const socket = new FakeSocket(), context = new FakeContext()
  const playback = new AudioPlaybackService(() => context.asContext())
  await playback.unlock()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost',
    event: event => {
      if (event.type === 'audio.start') playback.begin(event.turnId, event.responseId)
      if (event.type === 'audio.end') playback.end(event.responseId)
      if (event.type === 'response.cancelled') playback.interrupt()
    }, audio: (frame, ref) => playback.enqueue(ref.responseId, frame),
    lost: () => { playback.interrupt() } })
  client.connect(session())
  socket.open()
  socket.receive(ready())
  const r = new PcmResampler(48000, bytes => { client.sendInput(bytes) })
  r.push([new Float32Array(3840).fill(0.25)])
  const input = decodeVoiceAudio(socket.sent[1] as Uint8Array)
  expect(input.pcm.length).toBe(2560)
  // Stable DC golden after startup: round(0.25 * 32767) = 8192, LE [0,32].
  expect([...input.pcm.slice(-4)]).toEqual([0, 32, 0, 32])
  socket.receive(control({ type: 'audio.start', turnId: 't', responseId: 'r', sampleRate: 24000,
    firstAudioSequence: 0 }, 1))
  socket.receive(output())
  context.currentTime = 0.15
  const heard = playback.interrupt()
  client.control({ type: 'response.interrupt', turnId: heard.turnId, responseId: heard.responseId,
    playbackPositionMs: heard.playedMs, playedSamples: heard.playedSamples })
  expect(JSON.parse(socket.sent.at(-1) as string)).toMatchObject({ type: 'response.interrupt',
    playbackPositionMs: 50, playedSamples: 1200 })
  socket.receive(output(1, 100))
  expect(context.sources).toHaveLength(1)
  client.dispose()
  await playback.dispose()
})

it('terminal input closes capture transmission until a new connection', () => {
  const socket = new FakeSocket()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost' })
  client.connect(session(1, 'dictation'))
  socket.open()
  socket.receive(ready(0, 1, 'dictation'))
  expect(client.sendInput(new Uint8Array(0), 1)).toBe(true)
  expect(client.sendInput(new Uint8Array(2560))).toBe(false)
  client.control({ type: 'dictation.stop' })
  expect(client.sendInput(new Uint8Array(2560))).toBe(false)
  client.dispose()
})

it('rejects an output replacement before previous playback drain instead of truncating silently', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext())
  await playback.unlock()
  playback.begin('t1', 'r1')
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(4800) })
  playback.end('r1')
  expect(() => playback.begin('t2', 'r2')).toThrow('VOICE_INVALID_STATE')
  playback.interrupt()
  expect(() => playback.begin('t2', 'r2')).not.toThrow()
  await playback.dispose()
})

it('does not double-close resources if stop races an in-flight worklet module load', async () => {
  const context = new FakeContext(), media = fakeStream(), node = new FakeNode()
  let loaded!: () => void
  context.audioWorklet.addModule.mockImplementationOnce(() => new Promise<void>(resolve => { loaded = resolve }))
  const capture = new AudioCaptureService({ getUserMedia: async () => media.stream,
    context: () => context.asContext(), node: () => node as unknown as AudioWorkletNode,
    frame: () => {}, error: () => {} })
  const starting = capture.start()
  await Promise.resolve()
  await capture.stop()
  loaded()
  await expect(starting).rejects.toThrow('CAPTURE_CANCELLED')
  expect(context.close).toHaveBeenCalledTimes(1)
  expect(media.track.stop).toHaveBeenCalledTimes(1)
})

it('lets a cancelled range close after queued frames without applying it to the next response', () => {
  const socket = new FakeSocket(), audio = vi.fn(), error = vi.fn()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', audio, error })
  client.connect(session())
  socket.open()
  socket.receive(ready())
  socket.receive(control({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0 }, 1))
  socket.receive(output())
  socket.receive(control({ type: 'response.cancelled', turnId: 't1', responseId: 'r1', lastAudioSequence: 1 }, 2))
  socket.receive(output(1, 100))
  socket.receive(control({ type: 'audio.start', turnId: 't2', responseId: 'r2', sampleRate: 24000,
    firstAudioSequence: 2 }, 3))
  socket.receive(output(2, 200))
  expect(audio).toHaveBeenCalledTimes(2)
  expect(audio.mock.calls[1][1]).toMatchObject({ responseId: 'r2' })
  expect(error).not.toHaveBeenCalled()
  client.dispose()
})

it('rejects reuse of an interrupted response ID even with new control and audio sequences', () => {
  const socket = new FakeSocket(), audio = vi.fn(), error = vi.fn()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', audio, error })
  client.connect(session())
  socket.open()
  socket.receive(ready())
  socket.receive(control({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0 }, 1))
  socket.receive(output())
  client.invalidate('r1')
  socket.receive(control({ type: 'audio.end', turnId: 't1', responseId: 'r1', lastAudioSequence: 0 }, 2))
  socket.receive(control({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 1 }, 3))
  socket.receive(output(1, 100))
  expect(audio).toHaveBeenCalledTimes(1)
  expect(error).toHaveBeenCalledWith('VOICE_INVALID_STATE')
  client.dispose()
})

it('handles many replies with bounded node registry and cursor without idle drift', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext())
  await playback.unlock()
  for (let i = 0; i < 100; i++) {
    playback.begin(`t${i}`, `r${i}`)
    playback.enqueue(`r${i}`, { kind: 2, flags: 0, sequence: i, offsetMs: i * 100, pcm: new Uint8Array(4800) })
    playback.end(`r${i}`)
    context.currentTime += 0.2
    expect(playback.isDrained()).toBe(true)
  }
  expect(playback.progress().playedSamples).toBe(240000)
  expect(playback.progress().consumedSamples).toBe(240000)
  context.currentTime += 30
  expect(playback.progress().playedMs).toBe(10000)
  expect(context.sources.every(n => n.disconnect.mock.calls.length > 0)).toBe(true)
  await playback.dispose()
})

it('caps input backpressure including header overhead and retains no replay queue', () => {
  const socket = new FakeSocket(), error = vi.fn(), lost = vi.fn()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', error, lost })
  client.connect(session())
  socket.open()
  socket.receive(ready())
  socket.bufferedAmount = 32208 - 2576
  expect(client.sendInput(new Uint8Array(2560))).toBe(true)
  socket.bufferedAmount++
  expect(client.sendInput(new Uint8Array(2560))).toBe(false)
  expect(error).toHaveBeenCalledWith('AUDIO_BUFFER_OVERFLOW')
  expect(lost).toHaveBeenCalled()
  expect(socket.sent.filter(p => p instanceof Uint8Array)).toHaveLength(1)
})

it('gesture-independent dispose cancels reconnect and ignores a late reauthorization result', async () => {
  vi.useFakeTimers()
  const socket = new FakeSocket(), factory = vi.fn(() => socket.asSocket()), recovered = vi.fn()
  let resolve!: (s: ReturnType<typeof session>) => void
  let abort!: AbortSignal
  const client = new VoiceClient({ socket: factory, pageUrl: 'http://localhost', random: () => 0.5, recovered,
    reauthorize: async (_s, signal) => { abort = signal; return new Promise(r => { resolve = r }) } })
  client.connect(session())
  socket.open()
  socket.receive(ready())
  socket.lose()
  await vi.advanceTimersByTimeAsync(250)
  client.dispose()
  client.dispose()
  resolve(session(2))
  await Promise.resolve()
  await Promise.resolve()
  expect(abort.aborted).toBe(true)
  expect(factory).toHaveBeenCalledTimes(1)
  expect(recovered).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('hiding/disposal discards microphone tail and stale port callbacks until explicit start', async () => {
  const context = new FakeContext(), node = new FakeNode(), media = fakeStream(), frame = vi.fn()
  const capture = new AudioCaptureService({ getUserMedia: async () => media.stream,
    context: () => context.asContext(), node: () => node as unknown as AudioWorkletNode, frame, error: () => {} })
  await capture.start()
  await capture.setMuted(false)
  const old = node.port.onmessage!, revision = node.port.postMessage.mock.calls.at(-1)![0].revision
  await capture.stop(false)
  old({ data: { type: 'frame', revision, flags: 0, pcm: new ArrayBuffer(2560) } } as MessageEvent)
  expect(frame).not.toHaveBeenCalled()
  expect(media.track.stop).toHaveBeenCalledTimes(1)
  expect(node.port.postMessage.mock.calls.some(([m]) => m.type === 'drain')).toBe(false)
})

