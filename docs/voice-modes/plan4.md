# Browser Audio Engine and Voice Transport Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this harness load `executing-plans` and `test-driven-development`; do not dispatch additional agents unless the orchestrator authorizes them.

**Goal:** Build P4's browser-native microphone, PCM playback, and validated voice transport services, without changing UI, backend orchestration, or shared contracts.

**Architecture:** Capture at the device's native rate through a silent AudioWorklet, filter/resample actual samples, and pass transferable mono PCM16 buffers to the existing P1 binary encoder. A bounded playback scheduler measures consumed output rather than received bytes; a native WebSocket client fences connection epochs and response streams, with live-only bounded reconnection and no audio replay.

**Tech Stack:** TypeScript 6, Vite 8, Node-environment Vitest 4, browser MediaDevices/Web Audio/AudioWorklet/WebSocket, existing `voice-protocol.ts` and `voice-audio.ts`; zero new packages.

---

## Read first and respect ownership

- Authoritative scope: [goal.md](goal.md), particularly integration decisions 1–9, D8, V4–V5, V11, audio transport, interruption and reconnect. Context: [research.md](research.md), sections 3–4; ownership and readiness: [state.md](state.md), P4.
- Prerequisite: verified P1 worker range `952b605..a2860f7`, not just its plan. Recheck actual source before starting. P1 owns shared protocol, codecs, package/lock files and test configuration; P10 owns Vite proxy changes. Request owner follow-ups rather than editing their files.
- Preserve all current user changes. P4 creates only the files listed below. No React component, draft reducer, transcript display, provider connection, identity, credential, or model selection belongs here.
- The plan is documentation, not implementation evidence. Unified review remains **skipped**. Node mocks cannot certify autoplay, AudioWorklet bundling in a real page, microphone quality, latency, physical silence, or any browser/device release gate.
- Every eventual new code/test file needs the repository's mandated file header. Headers are intentionally omitted from all code listings in this Markdown plan as requested; the worker adds them to source files, not this document.
- Commands labelled **frontend** run with working directory `frontend`; git commands run at repository root. Use existing dependencies; if absent, obtain the orchestrator's dependency-install coordination before `npm ci` in `frontend`. Do not edit manifests.

## File map and public handoff

| New file | Responsibility |
| --- | --- |
| `frontend/src/features/voice/audio/pcm-resampler.ts` | Stateful anti-alias FIR, fractional-rate interpolation, explicit LE PCM16, 1,280-sample frames |
| `frontend/src/features/voice/audio/audio-capture-processor.ts` | Worklet registration, source mute/reset/drain, transferable frames and bounded outstanding messages |
| `frontend/src/features/voice/audio/audio-capture-service.ts` | Gesture-owned permission/context lifecycle, revision fencing, track cleanup and device-loss errors |
| `frontend/src/features/voice/audio/audio-playback-service.ts` | Raw 24 kHz scheduling, bounded nodes, consumed-sample cursor, cancellation and disposal |
| `frontend/src/features/voice/audio/testing/audio-fakes.ts` | Minimal deterministic AudioContext, node, track and port mocks |
| `frontend/src/features/voice/audio/pcm-resampler.test.ts` | Signal, rate, endian, clipping and chunk-invariance checks |
| `frontend/src/features/voice/audio/audio-capture-processor.test.ts` | Source mute, transfers, drain, outstanding-frame cap |
| `frontend/src/features/voice/audio/audio-capture-service.test.ts` | Explicit acquisition, permission/device failures, late permission and idempotent cleanup |
| `frontend/src/features/voice/audio/audio-playback-service.test.ts` | Scheduling, sample progress, silence/gaps, queue overflow and cancellation |
| `frontend/src/api/voice-client.ts` | Validated config/create/end HTTP wrapper and native voice WebSocket client |
| `frontend/src/features/voice/transport/testing/voice-fakes.ts` | Socket fake and P1-valid session/control/audio fixtures |
| `frontend/src/features/voice/transport/voice-client.test.ts` | Envelopes, ordering, stale sockets, mode/state guards, budgets and reconnect |
| `frontend/src/features/voice/transport/audio-transport-pipeline.test.ts` | P4-owned Node audio/client composition regression checks; not P11's integrated suite |

P7/P8 consume `AudioCaptureService.start()` on an explicit gesture, await `VoiceClient` readiness, then `setMuted(false)`. They own visual/accessible errors and draft state. Live activation calls playback `unlock()` synchronously from that gesture **before awaiting permission or HTTP**, since a later async callback may lose browser activation. On page hide, navigation, device loss or disconnect they stop capture and clear playback; after a hidden page they must require a new gesture, never automatically call `start()` or `unlock()` from a visibility callback.

`VoiceClient` emits `event`, `audio`, `lost`, `recovered`, `error`, and `ended` callbacks; composition is caller-owned. P4 does not install page-global listeners. Every loss callback must synchronously disable capture transmission and stop local playback. Dictation loss requires a new explicitly activated recording; live reconnect restores transport only, not microphone permission or capture.

### Protocol decisions to hand to P5/P6 before implementation integration

1. Reuse `encodeVoiceAudio`/`decodeVoiceAudio` and `parseVoiceControl`, including `protocolVersion`, `turnId`, `playedSamples`, `segmentId`, `firstAudioSequence`, and `lastAudioSequence`. Research's simplified JSON tables are not the current schema.
2. Binary header: `[0xaf, 1, kind, flags, sequence:u32LE, offsetMs:u32LE, length:u32LE]`. Input payload is normally 2,560 bytes/80 ms; a graceful dictation drain may send a shorter aligned terminal payload or empty terminal frame with flag 1. No header encoder in the worklet: worklet emits raw LE PCM; transport assigns current-epoch sequence and uses P1's encoder.
3. JSON sequence is independent of binary sequence in each direction. First JSON sequence is 0; first input binary sequence is 0. Output binary sequence is connection-wide and contiguous, with `audio.start.firstAudioSequence` identifying the stream and `audio.end.lastAudioSequence` closing it. WebSocket order is authoritative. This must match P5's parser.
4. The 16-byte header has no response ID or epoch. Associate binary output only with its socket instance and the ordered `audio.start` range. After cancellation, consume/discard that range until its ordered close; P5/P6 must drop cancelled producer callbacks and never forward them after a new `audio.start`. Client-side code cannot distinguish mislabelled old PCM from new PCM. A contract change, if required, belongs to P1; do not invent an incompatible local header.
5. `offsetMs` on output is the absolute PCM position in the current provider TTS socket, not receipt time or wall time. The reported playback cursor advances only through scheduled samples actually consumed. A subsequent frame can start beyond a cancelled unheard range; that gap is **not** claimed as heard. P6 derives delivered text per response, not by interpreting the absolute cursor as every prior sample being heard.
6. A fresh live connection epoch must bind a **new** provider TTS socket, hence a new playback-offset origin. HTTP reauthorization uses the existing create route with the same mode, conversation and original `idempotencyKey`; P5 must return the **same voice session ID**, a strictly larger epoch and preserved durable turn state. This is a reconnect admission, not a new agent turn. The current P1 schema has no provider-origin identifier or separate resume endpoint. If P5 retains a TTS socket or cannot implement this admission through create, stop integration and request a serialized P1/P5 amendment rather than reset offsets speculatively.
7. Monotonic cursors are nondecreasing; zero-play/repeated interrupts must not fabricate samples to satisfy a provider's strictly advancing interruption requirement. P3/P6 suppress duplicate/nonadvancing provider interrupts and preserve unknown-delivery evidence when needed.
8. On output queue overflow, stop locally and report `AUDIO_BUFFER_OVERFLOW`; the caller invalidates/cancels the response/session. Do not drop arbitrary chunks and continue a silently incomplete answer. On input backpressure, close/fail rather than send an incomplete command. Native `WebSocket.bufferedAmount` is bytes, not a writable stream.

These are explicit integration prerequisites, not evidence that the gateway already implements them.

## Task 1: Browser Audio Capture & AudioWorklet Resampler

### 1A — Real resampling, anti-aliasing and LE frames

**Files:** Create `frontend/src/features/voice/audio/pcm-resampler.ts` and `frontend/src/features/voice/audio/pcm-resampler.test.ts`.

- [ ] **Step 1 (2–5 min): Write the failing signal/format test.**

```typescript
import { describe, expect, it } from 'vitest'
import { PcmResampler } from './pcm-resampler'

const flatten = (parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) { all.set(part, offset); offset += part.length }
  return all
}
function sampleSignal(rate: number, hz: number, seconds = 0.16) {
  return Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) =>
    0.5 * Math.sin(2 * Math.PI * hz * i / rate))
}
function rms(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sum = 0
  // Exclude the FIR startup transient; use the identical slice for both signals.
  for (let i = 160; i < bytes.length / 2; i++) sum += (view.getInt16(i * 2, true) / 32768) ** 2
  return Math.sqrt(sum / (bytes.length / 2 - 160))
}
describe('PcmResampler', () => {
  for (const rate of [44100, 48000]) {
    it(`resamples ${rate} Hz with exact frame count and chunk invariance`, () => {
      const input = sampleSignal(rate, 1000)
      const a: Uint8Array[] = [], b: Uint8Array[] = []
      const whole = new PcmResampler(rate, p => a.push(p))
      const chunked = new PcmResampler(rate, p => b.push(p))
      whole.push([input])
      for (let i = 0; i < input.length; i += 128) chunked.push([input.subarray(i, i + 128)])
      expect(a.map(p => p.length)).toEqual([2560, 2560])
      expect(flatten(b)).toEqual(flatten(a))
      expect(rms(flatten(a))).toBeGreaterThan(0.30)
      const stopband: Uint8Array[] = []
      new PcmResampler(rate, p => stopband.push(p)).push([sampleSignal(rate, 12000)])
      expect(rms(flatten(stopband))).toBeLessThan(0.025)
    })
  }
  it('mixes channels, clips and packs signed PCM little endian', () => {
    const chunks: Uint8Array[] = []
    const r = new PcmResampler(48000, p => chunks.push(p))
    r.push([new Float32Array(3840).fill(2), new Float32Array(3840).fill(2)])
    expect([...chunks[0].slice(-4)]).toEqual([255, 127, 255, 127])
    r.reset()
    r.push([new Float32Array(3840).fill(-2)])
    expect([...chunks[1].slice(-4)]).toEqual([0, 128, 0, 128])
  })
  it('drains only real tail samples and reset discards incomplete input', () => {
    const frames: Uint8Array[] = []
    const r = new PcmResampler(48000, p => frames.push(p))
    r.push([new Float32Array(960)])
    expect(r.drain().length).toBe(640)
    expect(r.drain().length).toBe(0)
    r.push([new Float32Array(960).fill(1)])
    r.reset()
    expect(r.drain().length).toBe(0)
    expect(frames).toHaveLength(0)
  })
  it('rejects invalid device rates and sanitizes nonfinite samples', () => {
    expect(() => new PcmResampler(0, () => {})).toThrow('UNSUPPORTED_AUDIO')
    const r = new PcmResampler(48000, () => {})
    r.push([Float32Array.of(NaN, Infinity, -Infinity)])
    expect([...r.drain()]).toEqual([0, 0])
  })
})
```

- [ ] **Step 2 (2 min): Run RED, frontend.** `npm test -- src/features/voice/audio/pcm-resampler.test.ts` → FAIL, missing module/export. Do not accept a discovery skip.
- [ ] **Step 3 (2–5 min per method): Add the minimal streaming implementation.** No per-render-quantum sample-rate relabelling, no WAV/MediaRecorder dependency, no unbounded sample arrays.

```typescript
export class PcmResampler {
  private readonly taps: Float64Array
  private readonly history = new Float64Array(63)
  private head = 0
  private index = 0
  private outputIndex = 0
  private previous = 0
  private frame = new Uint8Array(2560)
  private used = 0
  private readonly rate: number
  private readonly emit: (pcm: Uint8Array) => void
  constructor(rate: number, emit: (pcm: Uint8Array) => void) {
    if (!Number.isFinite(rate) || rate < 16000 || rate > 192000) throw new Error('UNSUPPORTED_AUDIO')
    this.rate = rate; this.emit = emit
    const cutoff = 6800 / rate
    const taps = Float64Array.from({ length: 63 }, (_, i) => {
      const x = i - 31
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)
      return sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / 62))
    })
    const sum = taps.reduce((a, b) => a + b, 0)
    this.taps = taps.map(t => t / sum)
  }
  push(channels: Float32Array[]) {
    if (!channels.length) return
    for (let i = 0; i < channels[0].length; i++) {
      let input = 0
      for (const channel of channels) input += Number.isFinite(channel[i]) ? channel[i] : 0
      this.history[this.head] = input / channels.length
      let filtered = 0
      for (let t = 0; t < 63; t++) filtered += this.taps[t] * this.history[(this.head - t + 63) % 63]
      this.head = (this.head + 1) % 63
      const position = this.outputIndex * this.rate / 16000
      if (position <= this.index) {
        const fraction = this.index === 0 ? 1 : position - (this.index - 1)
        const s = Math.max(-1, Math.min(1, this.previous + (filtered - this.previous) * fraction))
        new DataView(this.frame.buffer).setInt16(this.used, Math.round(s * (s < 0 ? 32768 : 32767)), true)
        this.used += 2; this.outputIndex++
        if (this.used === 2560) {
          this.emit(this.frame); this.frame = new Uint8Array(2560); this.used = 0
        }
      }
      this.previous = filtered; this.index++
    }
  }
  drain() {
    const tail = this.frame.slice(0, this.used)
    this.frame = new Uint8Array(2560); this.used = 0
    return tail
  }
  reset() {
    this.history.fill(0); this.head = 0; this.index = 0; this.outputIndex = 0
    this.previous = 0; this.frame = new Uint8Array(2560); this.used = 0
  }
}
```

The FIR is a real anti-alias filter, unlike unfiltered interpolation. Its 31-source-sample delay and 6.8 kHz cutoff are deliberate. Add a source comment: `ponytail: fixed 63-tap FIR targets 44.1/48 kHz speech; validate other admitted rates and upgrade filter length only if measured stopband/fidelity needs it.` Do not describe this offline check as a WER or device-quality pass.

- [ ] **Step 4 (2 min): Run GREEN, frontend.** Same test command; all cases pass with actual discovery.
- [ ] **Step 5 (2 min): Commit after serialized staging permission.**

```powershell
git add frontend/src/features/voice/audio/pcm-resampler.ts frontend/src/features/voice/audio/pcm-resampler.test.ts
git commit -m "feat(voice): resample microphone PCM with bounded frames"
```

### 1B — Worklet source mute, transfer, drain and outstanding-message cap

**Files:** Create `frontend/src/features/voice/audio/audio-capture-processor.ts` and `frontend/src/features/voice/audio/audio-capture-processor.test.ts`.

- [ ] **Step 1 (2–5 min): Write the failing worklet test with explicit worklet globals.**

```typescript
import { afterEach, expect, it, vi } from 'vitest'
type Message = { type: string; revision: number; pcm?: ArrayBuffer; flags?: 0 | 1 }
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
it('drops muted samples, transfers bounded frames and drains a real tail', async () => {
  const sent: Message[] = []
  const transfers: unknown[][] = []
  class Base {
    port = { onmessage: null as null | ((e: { data: unknown }) => void),
      postMessage: (message: Message, transfer: unknown[] = []) => {
        sent.push(message); transfers.push(transfer)
      } }
  }
  vi.stubGlobal('AudioWorkletProcessor', Base)
  vi.stubGlobal('sampleRate', 48000)
  const register = vi.fn()
  vi.stubGlobal('registerProcessor', register)
  const { AudioCaptureProcessor } = await import('./audio-capture-processor')
  const p = new AudioCaptureProcessor({ processorOptions: { maxPendingMs: 1000 } })
  const command = (data: unknown) => p.port.onmessage!({ data } as MessageEvent)
  const block = () => p.process([[new Float32Array(128).fill(0.5)]])
  for (let i = 0; i < 30; i++) block()
  expect(sent).toHaveLength(0)
  command({ type: 'reset', revision: 1, muted: false })
  for (let i = 0; i < 30; i++) block()
  const frame = sent.find(m => m.type === 'frame')!
  expect(frame.pcm?.byteLength).toBe(2560)
  expect(transfers[sent.indexOf(frame)]).toEqual([frame.pcm])
  command({ type: 'reset', revision: 2, muted: true })
  for (let i = 0; i < 30; i++) block()
  command({ type: 'reset', revision: 3, muted: false })
  block()
  command({ type: 'drain', revision: 3 })
  expect(sent.at(-1)).toMatchObject({ type: 'frame', revision: 3, flags: 1 })
  expect(sent.at(-1)!.pcm!.byteLength).toBe(86)
  command({ type: 'reset', revision: 4, muted: false })
  for (let i = 0; i < 390; i++) block()
  expect(sent.filter(m => m.type === 'frame' && m.revision === 4)).toHaveLength(12)
  expect(sent.at(-1)).toMatchObject({ type: 'overflow', revision: 4 })
  command({ type: 'ack', revision: 4 })
  for (let i = 0; i < 30; i++) block()
  expect(sent.at(-1)?.type).toBe('overflow')
  expect(register).toHaveBeenCalledWith('aurvin-capture', AudioCaptureProcessor)
})
```

- [ ] **Step 2 (2 min): Run RED, frontend.** `npm test -- src/features/voice/audio/audio-capture-processor.test.ts` → missing processor module.
- [ ] **Step 3 (2–5 min per method): Implement the module.** Declare globals locally since DOM's TypeScript lib does not define AudioWorkletGlobalScope. Exporting the processor permits Node testing but registration is still automatic in the real worklet scope.

```typescript
import { PcmResampler } from './pcm-resampler'
declare const sampleRate: number
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioCaptureProcessor): void

export class AudioCaptureProcessor extends AudioWorkletProcessor {
  private muted = true
  private revision = 0
  private pending = 0
  private readonly maxFrames: number
  private readonly resampler: PcmResampler
  constructor(options: { processorOptions: { maxPendingMs: number } }) {
    super()
    this.maxFrames = Math.max(1, Math.floor(options.processorOptions.maxPendingMs / 80))
    this.resampler = new PcmResampler(sampleRate, pcm => this.send(pcm, 0))
    this.port.onmessage = ({ data }) => {
      if (data.type === 'reset') {
        this.revision = data.revision; this.muted = data.muted
        this.pending = 0; this.resampler.reset()
        this.port.postMessage({ type: 'reset', revision: this.revision })
      } else if (data.revision === this.revision && data.type === 'ack') {
        this.pending = Math.max(0, this.pending - 1)
      } else if (data.revision === this.revision && data.type === 'drain') {
        this.muted = true
        this.send(this.resampler.drain(), 1)
      }
    }
  }
  private send(pcm: Uint8Array, flags: 0 | 1) {
    if (this.pending >= this.maxFrames) {
      this.muted = true; this.resampler.reset()
      this.port.postMessage({ type: 'overflow', revision: this.revision })
      return
    }
    this.pending++
    this.port.postMessage({ type: 'frame', revision: this.revision, flags, pcm: pcm.buffer }, [pcm.buffer])
  }
  process(inputs: Float32Array[][]) {
    if (!this.muted) this.resampler.push(inputs[0] ?? [])
    return true
  }
}
registerProcessor('aurvin-capture', AudioCaptureProcessor)
```

- [ ] **Step 4 (2 min): Run GREEN.** Same command, then `npm test -- src/features/voice/audio/pcm-resampler.test.ts`.
- [ ] **Step 5 (2 min): Commit exact files.**

```powershell
git add frontend/src/features/voice/audio/audio-capture-processor.ts frontend/src/features/voice/audio/audio-capture-processor.test.ts
git commit -m "feat(voice): capture PCM in a muted bounded audio worklet"
```

### 1C — User-gesture acquisition, permission/device failures and lifecycle

**Files:** Create `frontend/src/features/voice/audio/testing/audio-fakes.ts`, `frontend/src/features/voice/audio/audio-capture-service.test.ts`, `frontend/src/features/voice/audio/audio-capture-service.ts`.

- [ ] **Step 1 (2–5 min): Add minimal shared test doubles.** They model only used APIs; they are not a fake browser certification harness.

```typescript
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
```

- [ ] **Step 2 (2–5 min): Write the failing capture service test.**

```typescript
import { expect, it, vi } from 'vitest'
import { AudioCaptureService } from './audio-capture-service'
import { FakeContext, FakeNode, fakeStream } from './testing/audio-fakes'
vi.mock('./audio-capture-processor.ts?worker&url', () => ({ default: '/capture-worklet.js' }))

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
```

- [ ] **Step 3 (2 min): Run RED, frontend.** `npm test -- src/features/voice/audio/audio-capture-service.test.ts` → missing service.
- [ ] **Step 4 (2–5 min per method): Implement lifecycle and revision fencing.** The `?worker&url` import asks Vite to transpile/bundle the processor and its resampler into a standalone script; a plain `.ts?url` asset is insufficient for production TypeScript/import processing. No `new Worker()` is created.

```typescript
import workletUrl from './audio-capture-processor.ts?worker&url'
type CaptureOptions = {
  frame: (pcm: Uint8Array, flags: 0 | 1) => void
  error: (code: string) => void
  maxPendingMs?: number
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
  private waiter?: { revision: number; resolve: () => void; reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout> }
  constructor(options: CaptureOptions) { this.options = options }
  async start() {
    if (this.starting || this.context) throw new Error('VOICE_INVALID_STATE')
    this.starting = true
    const lifetime = ++this.lifetime
    let stream: MediaStream | undefined, context: AudioContext | undefined
    let node: AudioWorkletNode | undefined, source: MediaStreamAudioSourceNode | undefined
    try {
      const get = this.options.getUserMedia ?? navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices)
      if (!get) throw new Error('UNSUPPORTED_AUDIO')
      stream = await get({ audio: { channelCount: 1, echoCancellation: true,
        noiseSuppression: true, autoGainControl: true } })
      if (lifetime !== this.lifetime) throw new Error('CAPTURE_CANCELLED')
      stream.getAudioTracks().forEach(track => { track.enabled = false })
      context = this.options.context?.() ?? new AudioContext()
      await Promise.all([context.resume(), context.audioWorklet.addModule(workletUrl)])
      if (context.state !== 'running') throw new Error('PLAYBACK_BLOCKED')
      if (lifetime !== this.lifetime) throw new Error('CAPTURE_CANCELLED')
      const max = this.options.maxPendingMs ?? 1000
      node = this.options.node?.(context, max) ?? new AudioWorkletNode(context, 'aurvin-capture', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { maxPendingMs: max } })
      source = context.createMediaStreamSource(stream)
      this.stream = stream; this.context = context; this.source = source; this.node = node
      node.port.onmessage = ({ data }) => {
        if (lifetime !== this.lifetime || data.revision !== this.revision) return
        if (data.type === 'reset') { this.resolveWaiter(); return }
        if (data.type === 'overflow') { this.fail('AUDIO_BUFFER_OVERFLOW'); return }
        if (data.type !== 'frame' || !this.accepting) return
        try { this.options.frame(new Uint8Array(data.pcm), data.flags) }
        catch { this.fail('AUDIO_BUFFER_OVERFLOW'); return }
        node!.port.postMessage({ type: 'ack', revision: this.revision })
        if (data.flags === 1) this.resolveWaiter()
      }
      node.onprocessorerror = () => this.fail('UNSUPPORTED_AUDIO')
      stream.getTracks().forEach(track => { track.onended = () => this.fail('MICROPHONE_LOST') })
      source.connect(node); node.connect(context.destination)
      // Processor outputs silence: never route microphone samples to the speakers.
    } catch (error) {
      if (this.context === context) { this.context = undefined; this.stream = undefined;
        this.source = undefined; this.node = undefined }
      source?.disconnect(); node?.disconnect(); node?.port.close()
      stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
      await context?.close().catch(() => {})
      const name = error instanceof Error ? error.name : ''
      const message = error instanceof Error ? error.message : ''
      throw new Error(name === 'NotAllowedError' || name === 'SecurityError' ? 'MICROPHONE_DENIED'
        : name === 'NotFoundError' || name === 'NotReadableError' ? 'MICROPHONE_UNAVAILABLE'
        : ['CAPTURE_CANCELLED', 'PLAYBACK_BLOCKED'].includes(message) ? message : 'UNSUPPORTED_AUDIO')
    } finally { if (lifetime === this.lifetime) this.starting = false }
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
  async setMuted(muted: boolean) {
    const node = this.node
    if (!node) throw new Error('VOICE_INVALID_STATE')
    this.accepting = false
    this.stream!.getAudioTracks().forEach(track => { track.enabled = false })
    const revision = ++this.revision
    const ready = this.wait(revision)
    node.port.postMessage({ type: 'reset', revision, muted })
    await ready
    if (node !== this.node || revision !== this.revision) return
    this.accepting = !muted
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
    this.rejectWaiter('CAPTURE_CANCELLED')
    this.source?.disconnect(); this.source = undefined
    if (this.node) { this.node.port.onmessage = null; this.node.onprocessorerror = null
      this.node.disconnect(); this.node.port.close(); this.node = undefined }
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
    this.stream = undefined
    const context = this.context; this.context = undefined
    await context?.close().catch(() => {})
  }
}
```

`stop(true)` is only for graceful dictation Stop: await its terminal input frame before sending `dictation.stop`. Cancel, mute, disconnect, page hide and failures use `stop(false)` and discard the tail. P7 owns its separate two-second recognition finalization timeout. A permission prompt cannot be forcibly cancelled; the lifetime check stops any stream returned after cancellation.

- [ ] **Step 5 (2 min): Run GREEN and type verification, frontend.** `npm test -- src/features/voice/audio/audio-capture-service.test.ts`, then `npm run build` and `npm run lint`. A bundler test is not a real worklet execution test; P10 must import this service and P11 must inspect the emitted worklet and run it in target browsers.
- [ ] **Step 6 (2 min): Commit exact files, serialized.**

```powershell
git add frontend/src/features/voice/audio/audio-capture-service.ts frontend/src/features/voice/audio/audio-capture-service.test.ts frontend/src/features/voice/audio/testing/audio-fakes.ts
git commit -m "feat(voice): own microphone permission and capture cleanup"
```

## Task 2: Browser Audio Playback Scheduler

**Files:** Create `frontend/src/features/voice/audio/audio-playback-service.ts` and `frontend/src/features/voice/audio/audio-playback-service.test.ts`. Reuse Task 1's audio fake.

- [ ] **Step 1 (2–5 min): Write the failing raw-PCM/played-offset tests.**

```typescript
import { expect, it } from 'vitest'
import { AudioPlaybackService } from './audio-playback-service'
import { FakeContext } from './testing/audio-fakes'
const pcm = (samples: number) => new Uint8Array(samples * 2)
it('schedules 24 kHz PCM, counts played not received, and ignores idle time', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext())
  await playback.unlock()
  playback.begin('t1', 'r1')
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(2400) })
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 1, offsetMs: 100, pcm: pcm(2400) })
  expect(context.sources.map(n => n.start.mock.calls[0][0])).toEqual([0, 0.1])
  expect(playback.progress().playedSamples).toBe(0)
  context.currentTime = 0.05
  expect(playback.progress()).toMatchObject({ playedSamples: 1200, playedMs: 50 })
  context.currentTime = 0.25
  expect(playback.progress().playedMs).toBe(200)
  context.currentTime = 10
  expect(playback.progress().playedMs).toBe(200)
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 2, offsetMs: 200, pcm: pcm(2400) })
  context.currentTime = 10.05
  expect(playback.progress().playedMs).toBe(250)
})
it('stops immediately, preserves cursor, drops cancelled frames, and resets only explicitly', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext())
  await playback.unlock(); playback.begin('t1', 'r1')
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(4800) })
  context.currentTime = 0.05
  expect(playback.interrupt()).toMatchObject({ turnId: 't1', responseId: 'r1', playedMs: 50 })
  expect(context.sources[0].stop).toHaveBeenCalledTimes(1)
  expect(context.sources[0].disconnect).toHaveBeenCalledTimes(1)
  expect(playback.enqueue('r1', { kind: 2, flags: 0, sequence: 1, offsetMs: 200, pcm: pcm(2400) })).toBe(false)
  playback.begin('t2', 'r2')
  playback.enqueue('r2', { kind: 2, flags: 0, sequence: 2, offsetMs: 200, pcm: pcm(2400) })
  expect(playback.progress().playedMs).toBe(50)
  context.currentTime = 0.10
  expect(playback.progress().playedMs).toBe(250)
  playback.resetOrigin()
  expect(playback.progress().playedMs).toBe(0)
  await playback.dispose(); await playback.dispose()
  expect(context.close).toHaveBeenCalledTimes(1)
})
it('decodes little endian, enforces two seconds of pending output and retains actual drain', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext(), 2000)
  await playback.unlock(); playback.begin('t1', 'r1')
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 0, offsetMs: 0,
    pcm: new Uint8Array([0, 128, 255, 127]) })
  expect([...context.sources[0].buffer!.getChannelData(0)]).toEqual([-1, 1])
  playback.resetOrigin(); playback.begin('t2', 'r2')
  for (let i = 0; i < 10; i++) playback.enqueue('r2', {
    kind: 2, flags: 0, sequence: i, offsetMs: i * 200, pcm: pcm(4800) })
  expect(() => playback.enqueue('r2', { kind: 2, flags: 0, sequence: 10,
    offsetMs: 2000, pcm: pcm(4800) })).toThrow('AUDIO_BUFFER_OVERFLOW')
  expect(context.sources.every(n => n.stop.mock.calls.length === 1)).toBe(true)
  playback.begin('t3', 'r3')
  playback.enqueue('r3', { kind: 2, flags: 0, sequence: 11, offsetMs: 2200, pcm: pcm(2400) })
  playback.end('r3')
  expect(playback.isDrained()).toBe(false)
  context.currentTime = 0.1
  expect(playback.isDrained()).toBe(true)
})
it('requires a running gesture-unlocked context and does not advance with a suspended context', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext())
  playback.begin('t', 'r')
  expect(() => playback.enqueue('r', { kind: 2, flags: 0, sequence: 0, offsetMs: 0,
    pcm: pcm(2400) })).toThrow('PLAYBACK_BLOCKED')
  await playback.unlock()
  playback.enqueue('r', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(2400) })
  expect(playback.progress().playedMs).toBe(0)
  context.state = 'suspended'
  expect(playback.progress().playedMs).toBe(0)
})
```

- [ ] **Step 2 (2 min): Run RED, frontend.** `npm test -- src/features/voice/audio/audio-playback-service.test.ts` → missing service.
- [ ] **Step 3 (2–5 min per method): Implement the scheduler.** The absolute provider cursor and actual consumed sample count are distinct. Nodes finish on the audible clock, not just receipt or synthesis completion; gaps in AudioContext time add no samples. Cull played entries during enqueue/progress so long sessions do not grow the registry indefinitely.

```typescript
import type { VoiceAudioFrame } from '../../../api/voice-audio'
type Entry = { source: AudioBufferSourceNode; start: number; samples: number; offset: number;
  stopped: boolean; responseId: string }
export type PlaybackProgress = { turnId: string; responseId: string; playedMs: number;
  playedSamples: number; consumedSamples: number }
export class AudioPlaybackService {
  private readonly create: () => AudioContext
  private readonly queueMs: number
  private context?: AudioContext
  private entries: Entry[] = []
  private nextTime = 0
  private cursor = 0
  private consumed = 0
  private ref = { turnId: '', responseId: '' }
  private accepting = false
  private ended = true
  constructor(create: () => AudioContext = () => new AudioContext(), queueMs = 2000) {
    this.create = create; this.queueMs = queueMs
  }
  async unlock() {
    this.context ??= this.create()
    await this.context.resume()
    if (this.context.state !== 'running') throw new Error('PLAYBACK_BLOCKED')
  }
  begin(turnId: string, responseId: string) {
    if (this.entries.length || this.accepting) this.interrupt()
    this.ref = { turnId, responseId }; this.accepting = true; this.ended = false
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
        this.consumed += entry.samples; entry.source.disconnect()
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
      this.interrupt(); throw new Error('AUDIO_BUFFER_OVERFLOW')
    }
    const buffer = context.createBuffer(1, samples, 24000)
    const float = buffer.getChannelData(0)
    const pcm = new DataView(frame.pcm.buffer, frame.pcm.byteOffset, frame.pcm.byteLength)
    for (let i = 0; i < samples; i++) {
      const value = pcm.getInt16(i * 2, true)
      float[i] = value < 0 ? value / 32768 : value / 32767
    }
    const source = context.createBufferSource()
    source.buffer = buffer; source.connect(context.destination)
    const start = Math.max(context.currentTime, this.nextTime)
    source.start(start); this.nextTime = start + samples / 24000
    this.entries.push({ source, start, samples, offset: frame.offsetMs * 24,
      stopped: false, responseId })
    return true
  }
  end(responseId: string) {
    if (responseId === this.ref.responseId) { this.accepting = false; this.ended = true }
  }
  isDrained() { this.progress(); return this.ended && this.entries.length === 0 }
  interrupt() {
    const progress = this.progress()
    this.consumed = progress.consumedSamples
    this.accepting = false; this.ended = true
    this.entries.forEach(entry => this.stopNode(entry)); this.entries = []
    this.nextTime = this.context?.currentTime ?? 0
    return progress
  }
  resetOrigin() {
    this.interrupt(); this.cursor = 0; this.consumed = 0
    this.ref = { turnId: '', responseId: '' }
  }
  async dispose() {
    this.interrupt()
    const context = this.context; this.context = undefined
    await context?.close().catch(() => {})
  }
}
```

`getOutputTimestamp()` estimates output-device consumption; fallback subtracts known output latency conservatively. Never use received bytes as played audio. Device latency/clock rounding and already queued hardware audio mean the browser cannot guarantee sample-exact human hearing or instantaneous physical silence; P11 measures the p95 stop target. The existing output header's integer-ms origin quantizes the absolute provider cursor by less than one millisecond; `consumedSamples` still counts actual scheduled samples. Add `ponytail: provider cursor origin is millisecond-quantized by the v1 header; request P1 sample-offset framing if sub-ms reconciliation is required.` beside the offset conversion. P8 sends progress at a bounded interval (250 ms) only while active, omits `consumedSamples` from the exact P1 wire payload, and clears that timer on exit. P8 changes Speaking→Listening only after `audio.end` **and** `isDrained()`.

- [ ] **Step 4 (2 min): Run GREEN, frontend.** Same test command, then `npm test -- src/features/voice/audio` and `npm run build`.
- [ ] **Step 5 (2 min): Commit, serialized.**

```powershell
git add frontend/src/features/voice/audio/audio-playback-service.ts frontend/src/features/voice/audio/audio-playback-service.test.ts
git commit -m "feat(voice): schedule bounded PCM playback and heard offsets"
```

## Task 3: Browser Voice Transport Client

### 3A — Test fixtures and validated HTTP/native socket transport

**Files:** Create `frontend/src/api/voice-client.ts`, `frontend/src/features/voice/transport/testing/voice-fakes.ts`, `frontend/src/features/voice/transport/voice-client.test.ts`.

- [ ] **Step 1 (2–5 min): Add deterministic protocol/socket fixtures.**

```typescript
import { vi } from 'vitest'
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO,
  type CreateVoiceSessionResponse, type VoiceMode, type VoiceServerPayload } from '../../../../api/voice-protocol'
import { encodeVoiceAudio } from '../../../../api/voice-audio'
export class FakeSocket {
  readyState = 0
  bufferedAmount = 0
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: (string | Uint8Array)[] = []
  send(data: string | Uint8Array) { this.sent.push(data) }
  close = vi.fn(() => { this.readyState = 3 })
  open() { this.readyState = 1; this.onopen?.() }
  receive(data: unknown) { this.onmessage?.({ data } as MessageEvent) }
  lose() { this.readyState = 3; this.onclose?.() }
  asSocket() { return this as unknown as WebSocket }
}
export function session(epoch = 1, mode: VoiceMode = 'live'): CreateVoiceSessionResponse {
  return { protocolVersion: 1, sessionId: 'v1', conversationId: null, mode,
    connectionEpoch: epoch, websocketUrl: '/api/voice', expiresAt: '2099-10-08T00:20:00Z',
    effectiveAudioSettings: { input: INPUT_AUDIO, output: mode === 'live' ? OUTPUT_AUDIO : null },
    limits: { ...DEFAULT_VOICE_LIMITS } }
}
export function control(payload: VoiceServerPayload, sequence: number, epoch = 1) {
  return JSON.stringify({ protocolVersion: 1, sessionId: 'v1', connectionEpoch: epoch,
    eventId: `e${epoch}-${sequence}`, sequence, ...payload })
}
export function ready(sequence = 0, epoch = 1, mode: VoiceMode = 'live') {
  return control({ type: 'session.ready', limits: session(epoch, mode).limits,
    effectiveAudioSettings: session(epoch, mode).effectiveAudioSettings }, sequence, epoch)
}
export function output(sequence = 0, offsetMs = 0) {
  return encodeVoiceAudio({ kind: 2, flags: 0, sequence, offsetMs, pcm: new Uint8Array(4800) }).buffer
}
```

- [ ] **Step 2 (2–5 min): Write failing HTTP/framing/state tests.**

```typescript
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
  abort.abort(); await wasCancelled
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
  client.dispose(); client.dispose()
  expect(socket.close).toHaveBeenCalledTimes(1)
})
it('deduplicates controls, fences cancelled responses and old epochs, and rejects gaps', () => {
  const socket = new FakeSocket(), event = vi.fn(), audio = vi.fn(), error = vi.fn()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', event, audio, error })
  client.connect(session()); socket.open(); socket.receive(ready())
  const start = control({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0 }, 1)
  socket.receive(start); socket.receive(start)
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
    client.connect(session()); socket.open(); socket.receive(ready())
    if (bad === 'text') socket.receive(JSON.stringify({ ...JSON.parse(ready(1)), text: 'hidden' }))
    if (bad === 'audio') socket.receive(new Uint8Array([1, 2]).buffer)
    if (bad === 'state') socket.receive(output())
    if (bad === 'backpressure') { socket.bufferedAmount = 32000; client.sendInput(new Uint8Array(2560)) }
    expect(error).toHaveBeenCalledTimes(1)
    expect(socket.close).toHaveBeenCalledTimes(1)
  }
})
```

- [ ] **Step 3 (2 min): Run RED, frontend.** `npm test -- src/features/voice/transport/voice-client.test.ts` → missing client.
- [ ] **Step 4 (2–5 min per method): Implement HTTP wrapper and socket state.** This is a separate small HTTP wrapper because existing `ApiClient.request` is private and P4 does not own `client.ts`; reuse its exported `ApiClientError` instead of changing user work or weakening that boundary.

```typescript
import { ApiClientError } from './client'
import { encodeVoiceAudio, decodeVoiceAudio, type VoiceAudioFrame } from './voice-audio'
import { VOICE_ROUTES, INPUT_AUDIO, DEFAULT_VOICE_LIMITS, isPublicVoiceConfig, isCreateVoiceSessionRequest,
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
      if (!response.ok) throw new ApiClientError(`HTTP_${response.status}`, 'Voice is unavailable.',
        response.status, response.status >= 500 || response.status === 429)
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
  async create(request: CreateVoiceSessionRequest, signal?: AbortSignal): Promise<CreateVoiceSessionResponse> {
    if (!isCreateVoiceSessionRequest(request)) throw new Error('INVALID_VOICE_REQUEST')
    const value = await this.request(VOICE_ROUTES.sessions, 'POST', signal, request)
    if (!isCreateVoiceSessionResponse(value) || value.mode !== request.mode ||
      value.conversationId !== request.conversationId) throw new Error('INVALID_VOICE_REQUEST')
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
  private outputSequence = 0
  private outputOffset = -1
  private response?: { turnId: string; responseId: string; invalid: boolean; last: number | null }
  private connectTimer?: ReturnType<typeof setTimeout>
  // Task 3B adds reconnect fields and methods below.
  constructor(options: VoiceClientOptions = {}) { this.options = options }
  connect(session: CreateVoiceSessionResponse) {
    if (!isCreateVoiceSessionResponse(session) || Date.parse(session.expiresAt) <= Date.now())
      throw new Error('INVALID_VOICE_REQUEST')
    if (this.socket || this.closed) throw new Error('VOICE_INVALID_STATE')
    this.session = session; this.tx = 0; this.rx = -1; this.inputSequence = 0
    this.inputSamples = 0; this.outputSequence = 0; this.outputOffset = -1
    this.ready = false; this.muted = false; this.response = undefined
    const url = new URL(session.websocketUrl, this.options.pageUrl ?? location.href)
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/api/voice' || url.search || url.hash)
      throw new Error('INVALID_VOICE_REQUEST')
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = (this.options.socket ?? (url => new WebSocket(url)))(url.href)
    this.socket = socket; socket.binaryType = 'arraybuffer'
    this.connectTimer = setTimeout(() => this.fail('VOICE_CONNECT_TIMEOUT'), session.limits.connectMs)
    const current = () => this.socket === socket && !this.closed
    socket.onopen = () => { if (current()) this.send({ type: 'session.start', mode: session.mode, audioSettings: INPUT_AUDIO }, true) }
    socket.onmessage = ({ data }) => { if (current()) this.receive(data) }
    socket.onclose = () => { if (current()) this.disconnect() }
    socket.onerror = () => { if (current()) this.disconnect() }
  }
  private send(payload: VoiceClientPayload, handshake = false) {
    const session = this.session, socket = this.socket
    if (!session || socket?.readyState !== 1 || (!handshake && !this.ready)) return false
    if (this.tx > 0xffffffff) { this.fail('VOICE_SEQUENCE_ERROR'); return false }
    const event = { protocolVersion: 1, sessionId: session.sessionId, connectionEpoch: session.connectionEpoch,
      eventId: this.options.id?.() ?? crypto.randomUUID(), sequence: this.tx, ...payload }
    const json = JSON.stringify(event)
    parseVoiceControl(json, 'client', session.mode)
    if (socket.bufferedAmount + new TextEncoder().encode(json).length > this.inputBudget()) {
      this.fail('AUDIO_BUFFER_OVERFLOW'); return false
    }
    try { socket.send(json) } catch { this.disconnect(); return false }
    this.tx++; return true
  }
  control(payload: Exclude<VoiceClientPayload, { type: 'session.start' }>) {
    if (payload.type === 'response.interrupt') this.invalidate(payload.responseId)
    if (payload.type === 'input.mute') this.muted = true
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
    if (!this.ready || this.muted || socket?.readyState !== 1) return false
    if ((flags === 0 && pcm.length !== 2560) || (flags === 1 && pcm.length > 2560)) {
      this.fail('INVALID_AUDIO_FRAME'); return false
    }
    let bytes: Uint8Array
    try { bytes = encodeVoiceAudio({ kind: 1, flags, sequence: this.inputSequence,
      offsetMs: Math.floor(this.inputSamples / 16), pcm }) }
    catch { this.fail('INVALID_AUDIO_FRAME'); return false }
    if (socket.bufferedAmount + bytes.length > this.inputBudget()) {
      this.fail('AUDIO_BUFFER_OVERFLOW'); return false
    }
    try { socket.send(new Uint8Array(bytes)) } catch { this.disconnect(); return false }
    this.inputSequence++; this.inputSamples += pcm.length / 2
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
          if (this.ready || JSON.stringify(event.effectiveAudioSettings) !== JSON.stringify(this.session!.effectiveAudioSettings) ||
            JSON.stringify(event.limits) !== JSON.stringify(this.session!.limits)) throw new Error('VOICE_INVALID_STATE')
          this.ready = true; clearTimeout(this.connectTimer)
          this.onReady()
        } else if (event.type === 'audio.start') {
          if (this.response || event.firstAudioSequence !== this.outputSequence) throw new Error('VOICE_INVALID_STATE')
          this.response = { turnId: event.turnId, responseId: event.responseId, invalid: false, last: null }
        } else if (event.type === 'audio.end' || event.type === 'response.cancelled') {
          if (!this.response || this.response.responseId !== event.responseId || this.response.turnId !== event.turnId ||
            this.response.last !== event.lastAudioSequence) throw new Error('VOICE_INVALID_STATE')
          this.response = undefined
        }
        this.options.event?.(event)
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
      this.outputSequence++; this.outputOffset = frame.offsetMs; this.response.last = frame.sequence
      if (!this.response.invalid) this.options.audio?.(frame, this.response)
    } catch (error) { this.fail(error instanceof Error ? error.message : 'INVALID_VOICE_CONTROL') }
  }
  private detach() {
    clearTimeout(this.connectTimer)
    const socket = this.socket; this.socket = undefined; this.ready = false
    if (socket) { socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null
      socket.close() }
    this.response = undefined
  }
  private fail(code: string) { this.options.lost?.(); this.dispose(); this.options.error?.(code) }
  // Task 3B replaces these three methods with bounded reconnect lifecycle.
  private disconnect() { this.options.lost?.(); this.detach(); this.options.error?.('VOICE_INVALID_STATE') }
  private onReady() {}
  dispose() { if (this.closed) return; this.closed = true; this.detach() }
}
```

The two comments marking Task 3B insertion points are navigation for the next exact patch, not deferred shipped behavior. Do not commit unfinished Task 3A in isolation: finish 3B and verify the combined task first. Exact event validation strips nothing: unknown fields (including hidden text or client identity) are rejected. No credentials, parameters or transcript logging. The wrapper must not read or print local `.env`.

- [ ] **Step 5 (2 min): Run GREEN for 3A, frontend.** Same test command, then `npm run build`. Use object-insensitive comparisons for effective settings/limits in the follow-up regression below; field order in JSON is not a protocol requirement.

### 3B — Bounded live reconnect, fresh epochs, no dictation restart

- [ ] **Step 1 (2–5 min): Append exact failing recovery tests to `voice-client.test.ts`.**

```typescript
it('reconnects live transport only, fences old socket callbacks and never replays audio', async () => {
  vi.useFakeTimers()
  const first = new FakeSocket(), second = new FakeSocket(), lost = vi.fn(), recovered = vi.fn()
  const reauthorize = vi.fn(async () => session(2))
  const factory = vi.fn().mockReturnValueOnce(first.asSocket()).mockReturnValueOnce(second.asSocket())
  const client = new VoiceClient({ socket: factory, pageUrl: 'http://localhost', random: () => 0.5,
    reauthorize, lost, recovered })
  client.connect(session()); first.open(); first.receive(ready())
  client.sendInput(new Uint8Array(2560))
  const oldMessage = first.onmessage!
  first.lose()
  expect(lost).toHaveBeenCalledTimes(1)
  expect(client.sendInput(new Uint8Array(2560))).toBe(false)
  await vi.advanceTimersByTimeAsync(250)
  second.open(); second.receive(ready(0, 2))
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
  client.connect(session()); socket.open(); socket.receive(ready()); socket.lose()
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
  dictation.connect(session(1, 'dictation')); socket.open(); socket.receive(ready(0, 1, 'dictation')); socket.lose()
  await vi.advanceTimersByTimeAsync(10000)
  expect(retry).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledWith('DICTATION_DISCONNECTED')
  for (const invalid of [session(1), { ...session(2), sessionId: 'new-session' }]) {
    const liveSocket = new FakeSocket(), invalidError = vi.fn()
    const live = new VoiceClient({ socket: () => liveSocket.asSocket(), pageUrl: 'http://localhost',
      random: () => 0.5, error: invalidError, reauthorize: async () => invalid })
    live.connect(session()); liveSocket.open(); liveSocket.receive(ready()); liveSocket.lose()
    await vi.advanceTimersByTimeAsync(250)
    expect(invalidError).toHaveBeenCalledWith('STALE_CONNECTION_EPOCH')
  }
})
it('accepts structurally identical ready settings regardless of JSON property order', () => {
  const socket = new FakeSocket(), error = vi.fn()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost', error })
  client.connect(session()); socket.open()
  const event = JSON.parse(ready())
  event.limits = Object.fromEntries(Object.entries(event.limits).reverse())
  event.effectiveAudioSettings.input = Object.fromEntries(Object.entries(event.effectiveAudioSettings.input).reverse())
  socket.receive(JSON.stringify(event))
  expect(error).not.toHaveBeenCalled()
  expect(client.sendInput(new Uint8Array(2560))).toBe(true)
  client.dispose()
})
```

- [ ] **Step 2 (2 min): Run RED, frontend.** `npm test -- src/features/voice/transport/voice-client.test.ts` → recovery tests fail (no reconnect/recovered callback; comparison incorrectly uses object insertion order).
- [ ] **Step 3 (2–5 min): Add fields inside `VoiceClient`, replacing the Task 3B field comment.**

```typescript
  private recovering = false
  private retryAttempt = 0
  private deadline = 0
  private retryTimer?: ReturnType<typeof setTimeout>
  private deadlineTimer?: ReturnType<typeof setTimeout>
  private reauth?: AbortController
```

- [ ] **Step 4 (2–5 min): Replace the three marked methods at the end of `VoiceClient`.** Timer/HTTP/handshake are all inside the same recovery deadline; no sleep/poll loop, no persisted audio queue, no resetting the deadline after failed attempts.

```typescript
  private disconnect() {
    if (this.closed) return
    this.options.lost?.(); this.detach()
    if (this.session!.mode === 'dictation') { this.dispose(); this.options.error?.('DICTATION_DISCONNECTED'); return }
    if (!this.options.reauthorize) { this.fail('VOICE_RECONNECT_TIMEOUT'); return }
    if (!this.recovering) {
      this.recovering = true; this.retryAttempt = 0
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
    const abort = new AbortController(); this.reauth = abort
    try {
      const next = await this.options.reauthorize!(previous, abort.signal)
      if (this.closed || abort.signal.aborted || Date.now() >= this.deadline) return
      if (!isCreateVoiceSessionResponse(next) || next.sessionId !== previous.sessionId ||
        next.connectionEpoch <= previous.connectionEpoch || next.mode !== previous.mode ||
        next.conversationId !== previous.conversationId) { this.fail('STALE_CONNECTION_EPOCH'); return }
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
    clearTimeout(this.retryTimer); clearTimeout(this.deadlineTimer)
    this.recovering = false
    this.options.recovered?.(this.session!)
  }
  dispose() {
    if (this.closed) return
    this.closed = true; this.recovering = false
    clearTimeout(this.retryTimer); clearTimeout(this.deadlineTimer)
    this.reauth?.abort(); this.reauth = undefined
    this.detach()
  }
```

- [ ] **Step 5 (2–5 min): Replace the `session.ready` comparison inside `receive`.** Use P1's exact shape guards first, then compare typed values without relying on JSON key order:

```typescript
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
```

Keep the following existing `this.ready = true`, timer clearing and `onReady()` statements. On `conversation.bound`, update the locally stored admitted session before calling the event handler so a later reconnect uses the newly durable conversation:

```typescript
        if (event.type === 'conversation.bound') {
          if (this.session!.conversationId !== null && this.session!.conversationId !== event.conversationId)
            throw new Error('VOICE_BINDING_MISMATCH')
          this.session = { ...this.session!, conversationId: event.conversationId }
        }
```

Insert this immediately before `this.options.event?.(event)`. The caller's reauthorization callback uses `previous.conversationId` and its original create idempotency key. A reconnect is never a submit/retry request.

- [ ] **Step 6 (2 min): Run GREEN, frontend.** `npm test -- src/features/voice/transport/voice-client.test.ts`, `npm test -- src/api/voice-protocol.test.ts`, `npm run build`, `npm run lint`.
- [ ] **Step 7 (2 min): Commit Task 3's exact files, serialized.**

```powershell
git add frontend/src/api/voice-client.ts frontend/src/features/voice/transport/voice-client.test.ts frontend/src/features/voice/transport/testing/voice-fakes.ts
git commit -m "feat(voice): validate native voice transport and bounded reconnect"
```

## Task 4: Audio & Transport Pipeline Integration Tests

**Files:** Create only `frontend/src/features/voice/transport/audio-transport-pipeline.test.ts`; make the exact P4-owned fixes listed below. These Node composition tests use fixed mathematical/byte fixtures, not real microphones or paid services.

### 4A — Failing composition/edge regressions

- [ ] **Step 1 (2–5 min per test): Write these exact tests.** The first is a cross-component baseline; subsequent regressions must fail against the Task 1–3 baseline (terminal-input state, response overlap, late permission disposal race, ordered cancelled output closure).

```typescript
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
  client.connect(session()); socket.open(); socket.receive(ready())
  const r = new PcmResampler(48000, bytes => { client.sendInput(bytes) })
  r.push([new Float32Array(3840).fill(0.25)])
  const input = decodeVoiceAudio(socket.sent[1] as Uint8Array)
  expect(input.pcm.length).toBe(2560)
  // Stable DC golden after startup: round(0.25 * 32767) = 8192, LE [0,32].
  expect([...input.pcm.slice(-4)]).toEqual([0, 32, 0, 32])
  socket.receive(control({ type: 'audio.start', turnId: 't', responseId: 'r', sampleRate: 24000,
    firstAudioSequence: 0 }, 1))
  socket.receive(output())
  context.currentTime = 0.05
  const heard = playback.interrupt()
  client.control({ type: 'response.interrupt', turnId: heard.turnId, responseId: heard.responseId,
    playbackPositionMs: heard.playedMs, playedSamples: heard.playedSamples })
  expect(JSON.parse(socket.sent.at(-1) as string)).toMatchObject({ type: 'response.interrupt',
    playbackPositionMs: 50, playedSamples: 1200 })
  socket.receive(output(1, 100))
  expect(context.sources).toHaveLength(1)
  client.dispose(); await playback.dispose()
})
it('terminal input closes capture transmission until a new connection', () => {
  const socket = new FakeSocket()
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost' })
  client.connect(session(1, 'dictation')); socket.open(); socket.receive(ready(0, 1, 'dictation'))
  expect(client.sendInput(new Uint8Array(0), 1)).toBe(true)
  expect(client.sendInput(new Uint8Array(2560))).toBe(false)
  client.control({ type: 'dictation.stop' })
  expect(client.sendInput(new Uint8Array(2560))).toBe(false)
  client.dispose()
})
it('rejects an output replacement before previous playback drain instead of truncating silently', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext())
  await playback.unlock(); playback.begin('t1', 'r1')
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
  client.connect(session()); socket.open(); socket.receive(ready())
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
  client.connect(session()); socket.open(); socket.receive(ready())
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
```

- [ ] **Step 2 (2 min): Run RED, frontend.** `npm test -- src/features/voice/transport/audio-transport-pipeline.test.ts` → terminal-input and overlap regressions fail; cancellation range and reused-response fencing fail. Record each failure before implementing its matching change. The module-load race test is a baseline that protects the lifetime-local cleanup pattern; it should already pass (resources are local until setup completes).

### 4B — Minimum fixes, one red/green pair at a time

- [ ] **Step 1 (2–5 min): Close input transmission at terminal/finalizing states.** In `frontend/src/api/voice-client.ts`, add `private inputEnded = false` near `inputSamples`; set it false in `connect`. Replace the first guard in `sendInput`:

```typescript
    if (!this.ready || this.muted || this.inputEnded || socket?.readyState !== 1) return false
```

Immediately after the successful `this.inputSequence++; this.inputSamples += pcm.length / 2`:

```typescript
    if (flags === 1) this.inputEnded = true
```

At the beginning of `control`, after local mute/invalidation handling but before `send`:

```typescript
    if (['dictation.stop', 'dictation.cancel', 'session.end'].includes(payload.type)) this.inputEnded = true
```

Run frontend `npm test -- src/features/voice/transport/audio-transport-pipeline.test.ts -t "terminal input"` → PASS.

- [ ] **Step 2 (2–5 min): Reject unintended overlapping playback.** Replace `begin` in `frontend/src/features/voice/audio/audio-playback-service.ts`:

```typescript
  begin(turnId: string, responseId: string) {
    this.progress()
    if (this.entries.length || this.accepting) throw new Error('VOICE_INVALID_STATE')
    this.ref = { turnId, responseId }; this.accepting = true; this.ended = false
  }
```

Run frontend `npm test -- src/features/voice/transport/audio-transport-pipeline.test.ts -t "output replacement"` → PASS. P6/P8 must close, drain or explicitly interrupt the old response before allowing another spoken response.

- [ ] **Step 3 (2–5 min): Retain a bounded cancelled range until its declared final frame.** This is the only delayed closure allowed: an ordered `response.cancelled` may declare the last frame already sent by the producer but still arriving through the gateway. In `frontend/src/api/voice-client.ts`, extend the response field type:

```typescript
  private response?: { turnId: string; responseId: string; invalid: boolean;
    last: number | null; closing?: number }
```

Replace the `audio.end`/`response.cancelled` branch body in `receive`:

```typescript
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
```

After the binary `this.options.audio` callback, add:

```typescript
      if (this.response?.closing === frame.sequence) this.response = undefined
```

The range has no PCM storage and at most eleven declared pending frames. No `audio.start` is accepted while it is unclosed. A disconnect clears it. P5 should normally forward cancellation after its previously sent binary frames; this tolerance covers a bounded already-in-flight range without relabelling. Run frontend `npm test -- src/features/voice/transport/audio-transport-pipeline.test.ts -t "cancelled range"` → PASS.

- [ ] **Step 4 (2–5 min): Fence response-ID reuse for the entire voice-client lifetime.** Add this field to `VoiceClient` in `frontend/src/api/voice-client.ts`; do **not** clear it in `connect`, since that method also establishes fresh epochs for the same session:

```typescript
  // ponytail: at most 4096 response IDs per client lifetime; fail closed, then start a new session.
  private readonly responsesSeen = new Set<string>()
```

Inside the `audio.start` branch, after the existing current-range/first-sequence guard and before assigning `this.response`, insert:

```typescript
          if (this.responsesSeen.has(event.responseId) || this.responsesSeen.size >= 4096)
            throw new Error('VOICE_INVALID_STATE')
          this.responsesSeen.add(event.responseId)
```

This bounds tombstones without evicting a cancelled ID and accidentally admitting late replay. Run frontend `npm test -- src/features/voice/transport/audio-transport-pipeline.test.ts -t "reuse of an interrupted"` → PASS. The 4,096-response ceiling exceeds the baseline session's practical budget; if product requirements exceed it, request a server-negotiated bounded response generation counter rather than an unbounded set.

### 4C — Additional golden/lifecycle/abuse checks before the task commit

- [ ] **Step 1 (2–5 min): Append these exact deterministic regression tests to `audio-transport-pipeline.test.ts`.** Each is a runnable check, not a prose request for future tests.

```typescript
it('handles many replies with bounded node registry and cursor without idle drift', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext())
  await playback.unlock()
  for (let i = 0; i < 100; i++) {
    playback.begin(`t${i}`, `r${i}`)
    playback.enqueue(`r${i}`, { kind: 2, flags: 0, sequence: i, offsetMs: i * 100, pcm: new Uint8Array(4800) })
    playback.end(`r${i}`)
    context.currentTime += 0.1
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
  client.connect(session()); socket.open(); socket.receive(ready())
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
  client.connect(session()); socket.open(); socket.receive(ready()); socket.lose()
  await vi.advanceTimersByTimeAsync(250)
  client.dispose(); client.dispose()
  resolve(session(2))
  await Promise.resolve(); await Promise.resolve()
  expect(abort.aborted).toBe(true)
  expect(factory).toHaveBeenCalledTimes(1)
  expect(recovered).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
it('hiding/disposal discards microphone tail and stale port callbacks until explicit start', async () => {
  const context = new FakeContext(), node = new FakeNode(), media = fakeStream(), frame = vi.fn()
  const capture = new AudioCaptureService({ getUserMedia: async () => media.stream,
    context: () => context.asContext(), node: () => node as unknown as AudioWorkletNode, frame, error: () => {} })
  await capture.start(); await capture.setMuted(false)
  const old = node.port.onmessage!, revision = node.port.postMessage.mock.calls.at(-1)![0].revision
  await capture.stop(false)
  old({ data: { type: 'frame', revision, flags: 0, pcm: new ArrayBuffer(2560) } } as MessageEvent)
  expect(frame).not.toHaveBeenCalled()
  expect(media.track.stop).toHaveBeenCalledTimes(1)
  expect(node.port.postMessage.mock.calls.some(([m]) => m.type === 'drain')).toBe(false)
})
```

- [ ] **Step 2 (2 min): Run all P4 checks, frontend.**

```powershell
npm test -- src/features/voice/audio src/features/voice/transport src/api/voice-protocol.test.ts
npm run build
npm run lint
npm test
```

Expected: actual new test discovery; signal math, endian golden, transfer/mute, permission/resource, PCM scheduling/offset, queue, ordering/epoch, cancellation and reconnect checks all pass; build/lint pass; pre-existing frontend suites remain green. If a check fails, load `systematic-debugging`, add/retain its minimal failing regression and fix only P4-owned code. Report unrelated failures without overwriting user work or weakening assertions.

- [ ] **Step 3 (2 min): Verify documentation/ownership and commit, serialized.**

```powershell
git diff --check
git add frontend/src/features/voice/transport/audio-transport-pipeline.test.ts frontend/src/api/voice-client.ts frontend/src/features/voice/audio/audio-playback-service.ts
git diff --cached --name-only
git commit -m "test(voice): verify bounded audio transport and interruption pipeline"
```

Only these named Task 4 files may be staged. If another agent has staged files, stop and request serialized commit access; never unstage their work or include it in this commit.

## Completion and evidence handoff

- [ ] Return P4 worker commits, exact changed paths, discovered/pass/fail counts and build/lint results; distinguish implementation checks from unrun hardware/provider checks. The orchestrator alone updates workflow state.
- [ ] Return P7/P8 APIs: capture starts muted and needs an acknowledged revision reset before unmute; graceful dictation Stop drains before its control; playback requires gesture unlock; immediate interrupt returns `{turnId,responseId,playedMs,playedSamples,consumedSamples}`; wire controls omit `consumedSamples`; reconnect never restarts capture; page-hidden resume needs a new gesture.
- [ ] Return P5/P6 prerequisites listed above: independent control/binary sequences, bounded cancelled ranges, absolute provider output offsets, same-session reauthorization with strictly new epoch/TTS socket, no old producer callbacks after new response start, nonadvancing interrupt suppression, and playback drain before another response.
- [ ] Record P10/P11 prerequisites as **unrun/blocked here**: Vite `/api` `ws: true` wiring (P10); actual processor emitted/transpiled and loaded in a browser; localhost/HTTPS permission; gesture unlock on iOS; 44.1/48 kHz device path; Chrome/Edge/Firefox/Safari/iOS Safari/Android Chrome; headset/speaker AEC/noise, device loss and hidden page; actual ≤250 ms p95 stop; measured fidelity/latency. No paid provider calls, external provisioning or feature-flag enablement are authorized by this plan.

## Planner self-check (documentation only)

P4 covers A2 (permission), A9 (local stop/played cursor), A12 (mute discard), A14 (device/network/resource failures), and its portion of A17 (foreground cleanup). A15/A18 hardware evidence remains P11-owned. D4/D8 drain/cleanup and V4/V5/V11 are mapped to Tasks 1–4. Header, frame rates, queue budgets, fresh epochs, stale/duplicate suppression and no replay have explicit tests. Live transcript-free transport uses P1's strict validators; UI visibility remains P8-owned. Authentication, live tools, provider adapters, durable history, UI and central wiring are excluded.

Primary documentation consulted for this plan: [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet), [worklet sampleRate](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/sampleRate), [AudioContext getOutputTimestamp](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp), [Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices), and [Vite worker URL imports](https://vite.dev/guide/features.html#web-workers), via Context7 on 8 October 2026. These document browser APIs, not achieved deployment behavior.

Planner-only checks on 8 October 2026: local links, four task headings, balanced fences, no placeholders/code-file headers/trailing whitespace; assembled TypeScript listings checked in memory against frontend compiler options with zero listing diagnostics; resampler math produced two 2,560-byte frames at both 44.1/48 kHz, with 1 kHz RMS >0.30, 12 kHz stopband RMS <0.025, and the quarter-scale DC golden bytes `[0,32,0,32]`. No implementation files were created, and no application build/lint/Vitest, browser, device, provider or service suite was run. The commands above are worker verification instructions, not passing results.
