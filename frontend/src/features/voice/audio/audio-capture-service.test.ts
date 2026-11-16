/**
 * ============================================================================
 * FILE: audio-capture-service.test.ts
 * LOCATION: frontend/src/features/voice/audio/audio-capture-service.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for browser AudioCaptureService lifecycle and error handling.
 *
 * ROLE IN PROJECT:
 *    Verifies gesture-driven capture start, track disabling until explicit unmute,
 *    revision fencing, permission denial, late permission recovery, device loss,
 *    live VAD readiness, independent upload admission, and fail-closed detector init.
 *
 * KEY COMPONENTS:
 *    - it('requests permission only on start...'): Tests nominal lifecycle & muting.
 *    - it('cleans up permission failure...'): Tests denied and aborted permissions.
 *    - it('releases tracks on device loss...'): Tests onended and worklet errors.
 *    - it('live capture waits for VAD...'): Tests upload vs mute and noise suppression.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest'
import { AudioCaptureService } from './audio-capture-service'
import { FakeContext, FakeNode, fakeStream } from './testing/audio-fakes'
vi.mock('./audio-capture-processor.ts?worker&url', () => ({ default: '/capture-worklet.js' }))
afterEach(() => { vi.useRealTimers() })

it('requests permission only on start and drops pre-ready, muted and stale frames', async () => {
  const context = new FakeContext(), node = new FakeNode(), media = fakeStream()
  const getUserMedia = vi.fn(async () => media.stream), frame = vi.fn(), error = vi.fn()
  const capture = new AudioCaptureService({ getUserMedia, context: () => context.asContext(),
    node: () => node as unknown as AudioWorkletNode, frame, error })
  expect(getUserMedia).not.toHaveBeenCalled()
  await capture.start()
  expect(getUserMedia).toHaveBeenCalledWith({ audio: {
    channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  expect(context.audioWorklet.addModule).toHaveBeenCalledWith('/capture-worklet.js')
  expect(media.track.enabled).toBe(false)
  await capture.setMuted(false)
  const revision = node.port.postMessage.mock.calls.at(-1)![0].revision
  node.port.emit({ type: 'frame', revision, flags: 0, pcm: new ArrayBuffer(2560) })
  expect(frame).toHaveBeenCalledTimes(1)
  await capture.setMuted(true)
  node.port.emit({ type: 'frame', revision, flags: 0, pcm: new ArrayBuffer(2560) })
  expect(frame).toHaveBeenCalledTimes(1)
  await capture.setMuted(false)
  await capture.stop(true)
  expect(frame).toHaveBeenLastCalledWith(expect.any(Uint8Array), 1)
  await capture.stop()
  expect(media.track.stop).toHaveBeenCalledTimes(1)
  expect(context.close).toHaveBeenCalledTimes(1)
  expect(node.port.close).toHaveBeenCalledTimes(1)
  expect(error).not.toHaveBeenCalled()
})
it('cleans up permission failure and a permission result arriving after stop', async () => {
  const denied = new AudioCaptureService({ getUserMedia: async () => {
    throw new DOMException('private details', 'NotAllowedError') }, frame: () => {}, error: () => {} })
  await expect(denied.start()).rejects.toThrow('MICROPHONE_DENIED')
  const media = fakeStream()
  let grant!: (stream: MediaStream) => void
  const late = new AudioCaptureService({ getUserMedia: () => new Promise(resolve => { grant = resolve }),
    frame: () => {}, error: () => {} })
  const starting = late.start()
  await late.stop()
  grant(media.stream)
  await expect(starting).rejects.toThrow('CAPTURE_CANCELLED')
  expect(media.track.stop).toHaveBeenCalledTimes(1)
})
it('releases tracks on device loss and worklet setup failure', async () => {
  const context = new FakeContext(), node = new FakeNode(), media = fakeStream(), error = vi.fn()
  const capture = new AudioCaptureService({ getUserMedia: async () => media.stream,
    context: () => context.asContext(), node: () => node as unknown as AudioWorkletNode,
    frame: () => {}, error })
  await capture.start()
  media.track.onended!()
  await Promise.resolve()
  expect(error).toHaveBeenCalledWith('MICROPHONE_LOST')
  expect(media.track.stop).toHaveBeenCalledTimes(1)
  const broken = fakeStream(), bad = new FakeContext()
  bad.audioWorklet.addModule.mockRejectedValueOnce(new Error('internal'))
  const other = new AudioCaptureService({ getUserMedia: async () => broken.stream,
    context: () => bad.asContext(), frame: () => {}, error })
  await expect(other.start()).rejects.toThrow('UNSUPPORTED_AUDIO')
  expect(broken.track.stop).toHaveBeenCalledTimes(1)
  expect(bad.close).toHaveBeenCalledTimes(1)
})

it('applies a negotiated reset ceiling and retains it across mute', async () => {
  const context = new FakeContext(), node = new FakeNode(), media = fakeStream()
  const capture = new AudioCaptureService({ getUserMedia: async () => media.stream,
    context: () => context.asContext(), node: () => node as unknown as AudioWorkletNode,
    frame: () => {}, error: () => {}, maxPendingMs: 1000 })
  await capture.start()
  await capture.setMuted(false, 800)
  expect(node.port.postMessage.mock.calls.at(-1)![0]).toMatchObject({
    type: 'reset', muted: false, maxPendingMs: 800,
  })
  await capture.setMuted(true)
  expect(node.port.postMessage.mock.calls.at(-1)![0]).toMatchObject({ muted: true, maxPendingMs: 800 })
  await capture.setMuted(false)
  expect(node.port.postMessage.mock.calls.at(-1)![0]).toMatchObject({ muted: false, maxPendingMs: 800 })
})

it('live capture waits for VAD, keeps noise suppression enabled, and separates uploads from mute', async () => {
  const context = new FakeContext(), node = new FakeNode(), media = fakeStream()
  const getUserMedia = vi.fn(async () => media.stream), frame = vi.fn(), error = vi.fn()
  const speechGate = vi.fn()
  const originalPost = node.port.postMessage.getMockImplementation()!
  node.port.postMessage.mockImplementation(data => {
    if (data.type === 'initialize') node.port.emit({ type: 'gate-ready', revision: data.revision })
    else originalPost(data)
  })
  const capture = new AudioCaptureService({ getUserMedia, context: () => context.asContext(),
    node: () => node as unknown as AudioWorkletNode, frame, error, speechGate })
  await capture.start()
  expect(getUserMedia).toHaveBeenCalledWith({ audio: {
    channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  } })
  capture.setUploading(false)
  await capture.setMuted(false, 800)
  expect(media.track.enabled).toBe(true)
  const revision = node.port.postMessage.mock.calls.findLast(([m]) => m.type === 'reset')![0].revision
  node.port.emit({ type: 'gate', revision, state: 'suspended' })
  expect(speechGate).toHaveBeenLastCalledWith('suspended')
  node.port.emit({ type: 'frame', revision, flags: 0, pcm: new ArrayBuffer(2560) })
  expect(frame).not.toHaveBeenCalled()
  capture.setUploading(true)
  node.port.emit({ type: 'frame', revision, flags: 0, pcm: new ArrayBuffer(2560) })
  expect(frame).toHaveBeenCalledTimes(1)
  expect(media.track.enabled).toBe(true)
  await capture.setMuted(true)
  capture.setUploading(true)
  node.port.emit({ type: 'gate', revision, state: 'speech' })
  expect(speechGate).toHaveBeenCalledTimes(1)
  expect(media.track.enabled).toBe(false)
  await capture.stop()
})

it('detector startup/runtime failure stops tracks and never enables unguarded upload', async () => {
  const context = new FakeContext(), node = new FakeNode(), media = fakeStream()
  const frame = vi.fn(), error = vi.fn()
  node.port.postMessage.mockImplementation(data => {
    if (data.type === 'initialize') {
      node.port.emit({ type: 'gate-error', revision: 0, code: 'MEDIA_GATE_UNAVAILABLE' })
    }
  })
  const capture = new AudioCaptureService({ getUserMedia: async () => media.stream,
    context: () => context.asContext(), node: () => node as unknown as AudioWorkletNode,
    frame, error, speechGate: vi.fn() })
  await expect(capture.start()).rejects.toThrow('MEDIA_GATE_UNAVAILABLE')
  expect(media.track.stop).toHaveBeenCalledTimes(1)
  expect(context.close).toHaveBeenCalledTimes(1)
  expect(node.port.close).toHaveBeenCalledTimes(1)
  expect(frame).not.toHaveBeenCalled()

  const context2 = new FakeContext(), node2 = new FakeNode(), media2 = fakeStream()
  const originalPost = node2.port.postMessage.getMockImplementation()!
  node2.port.postMessage.mockImplementation(data => {
    if (data.type === 'initialize') node2.port.emit({ type: 'gate-ready', revision: data.revision })
    else originalPost(data)
  })
  const frame2 = vi.fn(), error2 = vi.fn(), speechGate = vi.fn()
  const live = new AudioCaptureService({ getUserMedia: async () => media2.stream,
    context: () => context2.asContext(), node: () => node2 as unknown as AudioWorkletNode,
    frame: frame2, error: error2, speechGate })
  await live.start()
  node2.port.emit({ type: 'gate-error', revision: 0, code: 'MEDIA_GATE_UNAVAILABLE' })
  await Promise.resolve()
  expect(error2).toHaveBeenCalledTimes(1)
  expect(error2).toHaveBeenCalledWith('MEDIA_GATE_UNAVAILABLE')
  expect(media2.track.stop).toHaveBeenCalledTimes(1)
  node2.port.emit({ type: 'frame', revision: 0, flags: 0, pcm: new ArrayBuffer(2560) })
  node2.port.emit({ type: 'gate', revision: 0, state: 'speech' })
  expect(frame2).not.toHaveBeenCalled()
  expect(speechGate).not.toHaveBeenCalled()
})

it('detector startup timeout maps to MEDIA_GATE_UNAVAILABLE without a frame', async () => {
  vi.useFakeTimers()
  const context = new FakeContext(), node = new FakeNode(), media = fakeStream()
  const frame = vi.fn()
  const capture = new AudioCaptureService({ getUserMedia: async () => media.stream,
    context: () => context.asContext(), node: () => node as unknown as AudioWorkletNode,
    frame, error: vi.fn(), speechGate: vi.fn() })
  const starting = expect(capture.start()).rejects.toThrow('MEDIA_GATE_UNAVAILABLE')
  await vi.advanceTimersByTimeAsync(1000)
  await starting
  expect(frame).not.toHaveBeenCalled()
})

