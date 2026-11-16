/**
 * ============================================================================
 * FILE: audio-fakes.ts
 * LOCATION: frontend/src/features/voice/audio/testing/audio-fakes.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic test doubles for Web Audio, AudioNode, AudioContext, MediaStream.
 *
 * ROLE IN PROJECT:
 *    Provides minimal test doubles for AudioCaptureService and AudioPlaybackService
 *    unit tests without requiring browser Web Audio or WebRTC APIs.
 *
 * KEY COMPONENTS:
 *    - FakePort: Mock MessagePort with synchronous/mockable postMessage and emit.
 *    - FakeNode: Mock AudioNode / AudioWorkletNode / AudioBufferSourceNode.
 *    - FakeContext: Mock AudioContext with timing, source tracking, and buffer creation.
 *    - fakeStream: Factory for mock MediaStream and MediaStreamTrack.
 * ============================================================================
 */

import { vi } from 'vitest'

export class FakePort {
  onmessage: ((e: MessageEvent) => void) | null = null
  postMessage = vi.fn((data: { type: string; revision: number }) => {
    if (data.type === 'reset') this.emit({ type: 'reset', revision: data.revision })
    if (data.type === 'drain') this.emit({ type: 'frame', revision: data.revision,
      flags: 1, pcm: new ArrayBuffer(0) })
  })
  close = vi.fn()
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent) }
}

export class FakeNode {
  port = new FakePort()
  connect = vi.fn()
  disconnect = vi.fn()
  stop = vi.fn()
  start = vi.fn()
  buffer: AudioBuffer | null = null
  onended: (() => void) | null = null
  onprocessorerror: (() => void) | null = null
}

export class FakeContext {
  currentTime = 0
  state = 'running'
  sampleRate = 48000
  baseLatency = 0
  outputLatency = 0
  destination = {} as AudioDestinationNode
  sources: FakeNode[] = []
  audioWorklet = { addModule: vi.fn(async () => {}) }
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  createMediaStreamSource = vi.fn(() => new FakeNode())
  createBufferSource = vi.fn(() => { const node = new FakeNode(); this.sources.push(node); return node })
  createBuffer = vi.fn((_channels: number, samples: number, rate: number) => {
    const data = new Float32Array(samples)
    return { duration: samples / rate, length: samples, sampleRate: rate,
      getChannelData: () => data } as unknown as AudioBuffer
  })
  getOutputTimestamp() { return { contextTime: this.currentTime, performanceTime: 0 } }
  asContext() { return this as unknown as AudioContext }
}

export function fakeStream() {
  const track = { enabled: true, stop: vi.fn(), onended: null as null | (() => void) }
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream }
}
