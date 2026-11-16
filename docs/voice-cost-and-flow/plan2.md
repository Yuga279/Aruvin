# Browser Speech Gate and Persistent Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop live microphone uploads after five seconds of confirmed non-speech, resume the same foreground call with bounded onset audio, and retain an honest, accessible call surface until the user hangs up.

**Architecture:** Add an explicitly live-only, embedded WebRTC VAD gate inside the existing capture worklet, downstream of its existing resampler. Keep local capture, upload admission, manual mute, server listening acknowledgement, paid-resource recovery, and the mounted call as separate states. Extend the existing controller/reducer and panel rather than introducing another runtime, transport, store, detector service, or settings surface; Flux alone still authorizes turns and barge-in.

**Tech Stack:** Existing React 19, TypeScript, Vite 8 worker URL bundling, AudioWorklet, and Node-environment Vitest; one exact dependency, `@ozymandiasthegreat/vad@2.0.7`, using only its embedded entry.

---

## Steps

- [x] Task 1: Pin and wrap the embedded detector, preserving notices and proving offline behavior.
- [x] Task 2: Implement the pure five-second gate and bounded acknowledgement/pre-roll buffers.
- [x] Task 3: Put the live-only gate in the capture worklet without changing dictation.
- [x] Task 4: Expose independent upload control and fail-closed detector initialization in capture service.
- [x] Task 5: Model automatic suspension separately from recoverable/blocked call pauses.
- [x] Task 6: Implement same-call suspend/resume with listening acknowledgement and absolute mute.
- [x] Task 7: Retain failures/startup/background/reconnect states and implement permitted manual recovery.
- [x] Task 8: Expose visible status, permitted Resume, and accessible Hang up without redesigning the call.
- [x] Task 9: Prove lifecycle/teardown races and update direct real-client composition expectations.
- [x] Task 10: Run the offline P2 regression gate and hand off cross-owner evidence accurately.

## Execution rules and starting evidence

Read root `AGENTS.md`, approved [goal.md](goal.md), [research.md](research.md), [state.md](state.md), and P1's committed source before execution. Planning baseline is `6c8900b` on **`codex/voice-cost-and-flow`**; P1 worker is complete. Stay on that branch. Do not touch canvas files. This is a plan, not implementation or passing evidence. Unified review is **skipped**, not passed; do not dispatch a reviewer or child agents for this assignment.

Use the existing file headers. New code/declaration/test files receive the required `FILE` / `LOCATION` / `PURPOSE` / `ROLE IN PROJECT` / `KEY COMPONENTS` header before imports; update existing headers when changing more than 30%. The snippets below are insertion/replacement bodies beneath those headers, not permission to omit headers. Strict JSON and lockfiles get no comments. Add only the pinned detector; do not add a DOM framework, audio framework, parser, timer package, native module, or fixture downloader.

All npm commands run from `frontend/`; Git commands run from repository root, one command per invocation. Use the supported Node version. Only fixture PCM and injected media/context/socket ports are allowed: **no microphone, paid Deepgram/OpenRouter call, application database, external provisioning, deployment, runtime model download, or analytics**. Check scope before each named-file commit; serialize commits with the orchestrator. Tick this plan as steps finish; do not modify other plans or the orchestrator's state.

### Ownership and required handoffs

P2 edits only the following file map. In particular, do not edit backend files, `live-flow.ts`, `speech-prose.ts`, `voice-delivery.ts`, `app.service.ts`, playback scheduling, dictation controllers/hooks, shared protocol, or `frontend/src/features/voice/integration-tests/**`. The known missing `terminal` in `integration-tests/pipeline.test.ts` is P4's type-check defect, not permission to weaken the contract or edit that file.

**Transport handoff discovered in the actual P1 baseline:** `frontend/src/api/voice-client.ts:270-272` still disposes on every `session.ended` and fails on every `session.error`, ignoring P1's new `terminal`. This file is outside P2 ownership. Tell the orchestrator/P4 before implementation: P4 must arrange the narrowly scoped shared-client fix and its direct transport tests, preserving dictation. Live `terminal: false` error/end must be delivered to the controller without `dispose`, `fail`, `ended`, `lost`, or automatic reconnect. `terminal: true` can close transport but never command UI navigation. P2 does not mask this by replacing the client, clearing policy errors on a later `lost` callback, or swallowing genuine transport failures. P2's fake-client direct tests can pass independently; same-control-socket recovery remains an explicitly open integration gate until P4 fixes this.

**Initial-listening handoff to P1, coordinated by P4:** `LiveFlow` starts with `muted = false`; its `start()` starts readers but emits no initial state, and `control(input.unmute)` is a no-op when already unmuted. Therefore normal startup currently supplies only `session.ready`, not the explicit listening acknowledgement required by this plan. P1 must emit its existing `voice.state` with `input: listening` after the transport's first ready and before media admission, with a direct sequence test. That acknowledgement can arrive while the browser is awaiting a source reset: P2 must latch it within the current epoch/input generation, but only release PCM when both source reset and server listening are confirmed. Do not force a mute/reconnect round trip just to solicit an acknowledgement, invent another event, edit P1 source from P2, or call a fake-client startup test integrated evidence. This is a blocking cross-owner startup gate, not a reason to upload optimistically.

P1 already supplies `input.suspend`, `input: listening | suspended | muted`, `resume_call`, `MEDIA_GATE_UNAVAILABLE`, and mandatory `terminal`. P1 emits listening only when resume is safe. Neither `terminal` nor `recoverable` means navigate away. An `input.unmute` after **suspension** must not invoke the source's mute/reset path; explicit unmute after **mute** must discard old buffers and use a fresh source revision.

## File map

| Create/modify | Responsibility |
| --- | --- |
| Modify `frontend/package.json`, `frontend/package-lock.json` | Exactly pinned VAD dependency; no other package upgrade. |
| Create `frontend/src/features/voice/audio/audio-capture-vad.ts`, `audio-capture-vad.d.ts`, `audio-capture-vad.test.ts`, `audio-capture-vad.NOTICES.md` | Small embedded loader/20 ms decision wrapper, missing subpath types, real WASM fixture checks, exact upstream notices. |
| Create `frontend/src/features/voice/audio/audio-capture-gate.ts`, `audio-capture-gate.test.ts` | Pure upload gate and bounded local buffers; no browser/provider side effects. |
| Modify `frontend/src/features/voice/audio/audio-capture-processor.ts`, `audio-capture-processor.test.ts` | Opt-in live gate, revisioned control messages, existing PCM framing/backpressure and dictation drain. |
| Modify `frontend/src/features/voice/audio/audio-capture-service.ts`, `audio-capture-service.test.ts` | Detector readiness, separate upload switch, explicit mute/reset, track/resource ownership. |
| Modify `frontend/src/features/voice/state/live-voice-reducer.ts`, `live-voice-reducer.test.ts` | Independent input and call pause/blocked state. |
| Modify `frontend/src/features/voice/state/live-voice-controller.ts`, `live-voice-controller.test.ts`, `testing/live-voice-fixture.ts` | Input handshake, explicit recovery, mounted call, source generation/lifetime fences. The fixture is a direct controller test helper. |
| Modify `frontend/src/features/voice/state/useLiveVoice.ts` | Preserve gesture/visibility gating; existing controller composition, no new effect-started capture. |
| Modify `frontend/src/features/voice/live/LiveVoiceControls.tsx`, `LiveVoicePanel.tsx`, `live-voice.css`, `live-voice-controls.test.ts`, `live-voice-surface.test.ts` | Hang-up labeling, visible paused/blocked/quiet status and policy-correct Resume. Preserve waveform and layout. |
| Modify `frontend/src/features/voice/live/live-voice-lifecycle.ts`, `live-voice-lifecycle.test.ts`, `live-voice-composition.test.ts` | Existing lifecycle/shortcuts and direct composition regressions. |

Do not change `pcm-resampler.ts`: reuse its existing 80 ms output. Each complete 1,280-sample frame contains **four**, not three, consecutive 320-sample/20 ms detector windows. Process every window exactly once, in order, without overlap. This is 20 ms **audio analysis** cadence, released in the existing 80 ms worklet batch, not a claim that the detector callback runs every 20 ms of wall time. Record the resulting 0–80 ms batching/release latency separately from detector decisions and network/provider acknowledgement. A stricter wall-clock 20 ms tap would need an expressly reassigned resampler change; do not duplicate the FIR or silently claim that latency here.

### Local message/API contract

Use these local-only shapes; none goes on the WebSocket wire:

```typescript
// CaptureOptions addition. Absence means existing dictation behavior, no VAD instance/scoring.
speechGate?: (state: 'suspended' | 'speech') => void

// Capture service addition; synchronous admission change, no track/reset mutation.
setUploading(enabled: boolean): void

// Main -> worklet, alongside existing reset/ack/drain:
{ type: 'initialize', revision: number }
{ type: 'upload', revision: number, enabled: boolean }
{ type: 'destroy', revision: number }
// Include speechGate: boolean in processorOptions, uploading: boolean in reset.

// Worklet -> main, alongside existing reset/frame/overflow:
{ type: 'gate-ready', revision: number }
{ type: 'gate', revision: number, state: 'suspended' | 'speech' }
{ type: 'gate-error', revision: number, code: 'MEDIA_GATE_UNAVAILABLE' }
```

`speechGate` events never call `interrupt`, `response.interrupt`, submit, HTTP create/end, playback reset, or input mute. Foreground quiet leaves phase `active`, agent/output unchanged, track enabled, and input `suspended`. Hidden/frozen/device/provider/policy states use phase `suspended`; those are not the five-second automatic gate.

## Task 1: Exact embedded detector and notices

**Files:** The two frontend manifests and four new `audio-capture-vad*` files in the map.

- [x] **Step 1: Write the failing real-module test.** Add the required header and this test to `audio-capture-vad.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { createCaptureVad } from './audio-capture-vad'

const pcm = (voiced: boolean) => {
  const samples = Int16Array.from({ length: 1280 }, (_, i) => voiced
    ? Math.round(9000 * (Math.sin(2 * Math.PI * 140 * i / 16000) +
      0.35 * Math.sin(2 * Math.PI * 280 * i / 16000))) : 0)
  return new Uint8Array(samples.buffer)
}

it('loads embedded WASM offline, classifies synthetic voiced/silent PCM, and fails after destroy', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
  const vad = await createCaptureVad()
  try {
    expect(Array.from({ length: 8 }, () => vad.decisions(pcm(false))).flat()).toEqual(Array(32).fill(false))
    expect(Array.from({ length: 8 }, () => vad.decisions(pcm(true))).flat()).toContain(true)
    expect(fetcher).not.toHaveBeenCalled()
    vad.destroy()
    expect(() => vad.decisions(pcm(true))).toThrow('MEDIA_GATE_UNAVAILABLE')
    expect(() => vad.destroy()).not.toThrow()
  } finally { vad.destroy(); fetcher.mockRestore() }
})

it('pins the embedded entry and retains MIT metadata plus BSD redistribution notices', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  expect(manifest.dependencies['@ozymandiasthegreat/vad']).toBe('2.0.7')
  const source = readFileSync('src/features/voice/audio/audio-capture-vad.ts', 'utf8')
  expect(source).toContain("from '@ozymandiasthegreat/vad/lib/embedded.js'")
  expect(source).not.toMatch(/\bfetch\s*\(|\beval\s*\(|new\s+Function\s*\(/)
  const notice = readFileSync('src/features/voice/audio/audio-capture-vad.NOTICES.md', 'utf8')
  expect(notice).toContain('MIT')
  expect(notice).toContain('BSD-3-Clause')
  expect(notice).toContain('Neither the name of Google')
  expect(notice).toContain('THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS')
})
```

This synthetic harmonic fixture proves the selected module executes and recognizes a known speech-like signal, **not** acoustic accuracy on real voices. Keep both this test and scripted decisions in Task 2; a sine/noise threshold must not replace the classifier.

- [x] **Step 2: Run red.** `npm test -- src/features/voice/audio/audio-capture-vad.test.ts`. Expected FAIL: missing `audio-capture-vad` export/module. This is the intended pre-implementation failure.

- [x] **Step 3: Pin the only dependency.** Run `npm install --save-exact @ozymandiasthegreat/vad@2.0.7`. Inspect the manifest/lockfile diff: the dependency is exactly `2.0.7`, zero transitive dependencies, no unrelated version churn. Never import `lib/index.js` or the package root; the latter has a fetching entry despite its bundler metadata.

- [x] **Step 4: Add the subpath declaration and minimal wrapper.** In `audio-capture-vad.d.ts`:

```typescript
declare module '@ozymandiasthegreat/vad/lib/embedded.js' {
  export const VADMode: { readonly AGGRESSIVE: 2 }
  export type EmbeddedVad = { processFrame(frame: Int16Array): number; destroy(): void }
  export default function createVad(): Promise<new (mode: number, rate: number) => EmbeddedVad>
}
```

In `audio-capture-vad.ts`:

```typescript
import createVad, { VADMode } from '@ozymandiasthegreat/vad/lib/embedded.js'

export type CaptureVad = {
  decisions(pcm: Uint8Array): boolean[]
  reset(): void
  destroy(): void
}

export async function createCaptureVad(): Promise<CaptureVad> {
  try {
    const VAD = await createVad()
    let instance = new VAD(VADMode.AGGRESSIVE, 16000), destroyed = false
    return {
      decisions(pcm) {
        if (destroyed || pcm.byteLength !== 2560) throw new Error('MEDIA_GATE_UNAVAILABLE')
        const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
        return Array.from({ length: 4 }, (_, window) => {
          // The pinned package reads frame.buffer, ignoring byteOffset: each 20 ms window owns its buffer.
          const frame = Int16Array.from({ length: 320 }, (_, i) => view.getInt16((window * 320 + i) * 2, true))
          const result = instance.processFrame(frame)
          if (result !== 0 && result !== 1) throw new Error('MEDIA_GATE_UNAVAILABLE')
          return result === 1
        })
      },
      reset() {
        if (destroyed) throw new Error('MEDIA_GATE_UNAVAILABLE')
        const fresh = new VAD(VADMode.AGGRESSIVE, 16000)
        instance.destroy()
        instance = fresh
      },
      destroy() { if (!destroyed) { destroyed = true; instance.destroy() } },
    }
  } catch { throw new Error('MEDIA_GATE_UNAVAILABLE') }
}
```

Do not pass a `subarray` into this version's `processFrame`: upstream creates `new Uint8Array(frame.buffer)` without respecting the view offset. The independent 640-byte windows are necessary correctness, not an abstraction opportunity. Catch process/reset exceptions in the worklet as the same fail-closed error.

- [x] **Step 5: Preserve the actual notices.** `audio-capture-vad.NOTICES.md` contains heading `# @ozymandiasthegreat/vad 2.0.7 notices`, upstream URL `https://github.com/OzymandiasTheGreat/libfvad-wasm`, package metadata `license: MIT`, and the embedded decoder's existing `rfc4648.js` MIT attribution. Copy the **entire**, unmodified installed `node_modules/@ozymandiasthegreat/vad/LICENSE` under `## Distributed WebRTC/libfvad license (BSD-3-Clause)`, including both copyright lines, all three conditions and the full disclaimer. Do not replace it with an SPDX label or infer an author/year for an absent MIT grant. Leave installed dependency metadata/license intact. Tell P4 to include this notice with release documentation/binary distribution; do not claim deployment license packaging is tested by a source-file check.

- [x] **Step 6: Run green and failure injection.** `npm test -- src/features/voice/audio/audio-capture-vad.test.ts`. Add and run this independent failure test in the same file:

```typescript
it('maps unavailable WebAssembly to MEDIA_GATE_UNAVAILABLE without a network fallback', async () => {
  const instantiate = vi.spyOn(WebAssembly, 'instantiate').mockRejectedValueOnce(new Error('WASM blocked'))
  try { await expect(createCaptureVad()).rejects.toThrow('MEDIA_GATE_UNAVAILABLE') }
  finally { instantiate.mockRestore() }
})
```

Expected PASS; tests neither fetch a model nor capture audio. Use `vi.restoreAllMocks()` in `afterEach` so failing assertions cannot contaminate other tests.

- [x] **Step 7: Commit.**

```powershell
git add frontend/package.json frontend/package-lock.json frontend/src/features/voice/audio/audio-capture-vad.ts frontend/src/features/voice/audio/audio-capture-vad.d.ts frontend/src/features/voice/audio/audio-capture-vad.test.ts frontend/src/features/voice/audio/audio-capture-vad.NOTICES.md
git commit -m "feat(voice): pin offline embedded capture detector"
```

## Task 2: Pure gate, media-time silence, and bounded onset

**Files:** Create `audio-capture-gate.ts` and `audio-capture-gate.test.ts` with headers. No timer or provider calls.

- [x] **Step 1: Write exact failing gate tests.**

```typescript
import { expect, it } from 'vitest'
import { CaptureGate } from './audio-capture-gate'

const frame = (id: number) => new Uint8Array(2560).fill(id)
const quiet = [false, false, false, false]
const voice = [false, false, true, false]

it('stops PCM by 5080 ms and emits one suspend through three minutes of quiet', () => {
  const gate = new CaptureGate(1000), sent: Uint8Array[] = [], signals: string[] = []
  for (let i = 0; i < 2250; i++) {
    const result = gate.push(frame(i % 255), quiet)
    sent.push(...result.frames)
    if (result.signal) signals.push(result.signal)
    if (i >= 63) expect(result.frames).toEqual([])
  }
  expect(sent).toHaveLength(62)
  expect(signals).toEqual(['suspended'])
  expect(gate.bufferedFrames).toBe(4)
})

it('releases exactly one ordered 320 ms pre-roll only after listening acknowledgement', () => {
  const gate = new CaptureGate(1000)
  for (let i = 0; i < 70; i++) gate.push(frame(i), quiet)
  expect(gate.push(frame(70), voice)).toMatchObject({ frames: [], signal: 'speech', decisionOffsetMs: 40 })
  expect(gate.push(frame(71), voice)).toMatchObject({ frames: [] })
  expect(gate.setUploading(true).map(p => p[0])).toEqual([67, 68, 69, 70, 71])
  expect(gate.setUploading(true)).toEqual([])
  expect(gate.push(frame(72), voice).frames.map(p => p[0])).toEqual([72])
})

it('a normal pause or one positive 20 ms window resets confirmed non-speech', () => {
  const gate = new CaptureGate(1000)
  for (let i = 0; i < 60; i++) expect(gate.push(frame(i), quiet).signal).toBeUndefined()
  expect(gate.push(frame(60), voice).signal).toBeUndefined()
  for (let i = 0; i < 60; i++) expect(gate.push(frame(i), quiet).signal).toBeUndefined()
})

it('bounds acknowledgement audio and clears every transient frame on reset', () => {
  const gate = new CaptureGate(800)
  for (let i = 0; i < 70; i++) gate.push(frame(i), quiet)
  gate.push(frame(70), voice)
  for (let i = 0; i < 6; i++) gate.push(frame(i), voice)
  expect(gate.bufferedFrames).toBe(10)
  expect(() => gate.push(frame(99), voice)).toThrow('AUDIO_BUFFER_OVERFLOW')
  gate.reset(false, 800)
  expect(gate.bufferedFrames).toBe(0)
  expect(gate.setUploading(true)).toEqual([])
})
```

- [x] **Step 2: Run red.** `npm test -- src/features/voice/audio/audio-capture-gate.test.ts`. Expected FAIL missing `CaptureGate`.

- [x] **Step 3: Implement the bounded class.**

```typescript
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
```

The **pre-roll itself** is at most four frames/320 ms. After a positive decision, preserve that onset once and append only live acknowledgement-wait audio within the existing negotiated input queue (default 1,000 ms, floor to 80 ms frames; 800 ms test ceiling is ten frames). This is not permission for an additional unbounded queue. Connection loss, mute, hide, detector failure and hang-up clear it; a delayed listening acknowledgement exceeding the queue fails visibly rather than silently evicting the first syllable. Do not keep rolling away voiced onset while waiting for the server. Service/worklet validate the existing queue limits; the class receives an admitted value.

- [x] **Step 4: Run green.** `npm test -- src/features/voice/audio/audio-capture-gate.test.ts`. Expected PASS with 62 transmitted quiet frames, suspension at captured 5,040 ms, no output thereafter, one release containing three preceding frames plus onset, then the one subsequent ACK-wait frame. The index-2 positive decision occurs 40 ms into that 80 ms batch; batch release is at 80 ms, so this fixture's local release delay is 40 ms, separately from the network ACK.

- [x] **Step 5: Commit.**

```powershell
git add frontend/src/features/voice/audio/audio-capture-gate.ts frontend/src/features/voice/audio/audio-capture-gate.test.ts
git commit -m "feat(voice): gate silence with bounded same-call onset audio"
```

## Task 3: Capture worklet opt-in, privacy, and failure fencing

**Files:** `audio-capture-processor.ts` and its direct test only. Preserve existing no-gate tests unchanged except option type widening. Do not change the resampler or playback.

- [x] **Step 1: Add failing worklet tests.** In `audio-capture-processor.test.ts`, mock `./audio-capture-vad` with `vi.hoisted` spies and `vi.mock` before importing the worklet. Reuse its stubbed worklet base pattern, setting `sampleRate = 16000` and feeding exactly `new Float32Array(1280)` for one emitted 80 ms frame. The mock is:

```typescript
const vadMock = vi.hoisted(() => ({
  decisions: vi.fn(() => [false, false, false, false]), reset: vi.fn(), destroy: vi.fn(),
  create: vi.fn(),
}))
vi.mock('./audio-capture-vad', () => ({ createCaptureVad: vadMock.create }))
// In beforeEach, clear all four spies before applying defaults:
vi.clearAllMocks()
vadMock.create.mockResolvedValue(vadMock)
vadMock.decisions.mockReturnValue([false, false, false, false])
```

Add `beforeEach` to the Vitest import. This exact local harness supplies the names used below without changing shared fakes:

```typescript
async function liveProcessor() {
  type GateMessage = { type: string; revision: number; state?: string; code?: string;
    pcm?: ArrayBuffer; flags?: 0 | 1 }
  const sent: GateMessage[] = []
  class Base {
    port = { onmessage: null as null | ((e: MessageEvent) => void),
      postMessage: (message: GateMessage) => { sent.push(message) } }
  }
  vi.stubGlobal('AudioWorkletProcessor', Base)
  vi.stubGlobal('sampleRate', 16000)
  vi.stubGlobal('registerProcessor', vi.fn())
  const { AudioCaptureProcessor } = await import('./audio-capture-processor')
  const processor = new AudioCaptureProcessor({ processorOptions: { maxPendingMs: 1000, speechGate: true } })
  const command = (data: unknown) => processor.port.onmessage!({ data } as MessageEvent)
  return { sent, processor, command }
}
```

Add tests with these exact names/assertions; each begins `const { sent, processor, command } = await liveProcessor()`:

```typescript
// In 'live gate stops quiet PCM but keeps scoring and resumes only on upload acknowledgement':
command({ type: 'initialize', revision: 0 })
await Promise.resolve(); await Promise.resolve()
expect(sent).toContainEqual({ type: 'gate-ready', revision: 0 })
command({ type: 'reset', revision: 1, muted: false, uploading: true })
for (let i = 0; i < 2250; i++) {
  processor.process([[new Float32Array(1280)]])
  command({ type: 'ack', revision: 1 })
}
expect(sent.filter(m => m.type === 'frame')).toHaveLength(62)
expect(sent.filter(m => m.type === 'gate')).toEqual([{ type: 'gate', revision: 1, state: 'suspended' }])
expect(vadMock.decisions).toHaveBeenCalledTimes(2250)
vadMock.decisions.mockReturnValue([true, false, false, false])
processor.process([[new Float32Array(1280)]])
expect(sent.at(-1)).toMatchObject({ type: 'gate', state: 'speech' })
expect(sent.filter(m => m.type === 'frame')).toHaveLength(62)
command({ type: 'upload', revision: 0, enabled: true })
expect(sent.filter(m => m.type === 'frame')).toHaveLength(62)
command({ type: 'upload', revision: 1, enabled: true })
expect(sent.filter(m => m.type === 'frame')).toHaveLength(66)

// In 'mute/destroy discard pre-roll and a late detector cannot revive capture':
command({ type: 'initialize', revision: 0 })
await Promise.resolve(); await Promise.resolve()
command({ type: 'reset', revision: 2, muted: true, uploading: false })
const count = sent.filter(m => m.type === 'frame').length
command({ type: 'upload', revision: 1, enabled: true })
processor.process([[new Float32Array(1280)]])
expect(sent.filter(m => m.type === 'frame')).toHaveLength(count)
command({ type: 'destroy', revision: 2 })
expect(vadMock.destroy).toHaveBeenCalledTimes(1)
```

Add a separate init-rejection test: `vadMock.create.mockRejectedValueOnce(new Error('private WASM error'))`; initialize and process 100 blocks; expect exactly `gate-error` with code `MEDIA_GATE_UNAVAILABLE`, no frame, no private detail. Add a deferred init test that destroys before resolution, then resolves the fake detector: it is destroyed once and sends no `gate-ready` or frames. For a successful detector throwing or returning a failure through the wrapper, process one block and assert the same fail-closed path. Leave the no-`speechGate` processor's existing drain/overflow/reset tests as the dictation compatibility oracle.

- [x] **Step 1b: Add the real embedded-module worklet-fixture smoke.** This uses the actual WASM wrapper with only the AudioWorklet host stubbed, not a browser microphone. It complements the pure/module tests rather than claiming browser acoustics:

```typescript
it('real embedded detector gates silence and wakes the worklet on a synthetic voiced fixture', async () => {
  const actual = await vi.importActual<typeof import('./audio-capture-vad')>('./audio-capture-vad')
  vadMock.create.mockImplementationOnce(actual.createCaptureVad)
  const { sent, processor, command } = await liveProcessor()
  command({ type: 'initialize', revision: 0 })
  await vi.waitFor(() => expect(sent).toContainEqual({ type: 'gate-ready', revision: 0 }))
  command({ type: 'reset', revision: 1, muted: false, uploading: true })
  for (let i = 0; i < 80; i++) {
    processor.process([[new Float32Array(1280)]])
    command({ type: 'ack', revision: 1 })
  }
  expect(sent.filter(m => m.type === 'gate')).toEqual([{ type: 'gate', revision: 1, state: 'suspended' }])
  const before = sent.filter(m => m.type === 'frame').length
  const voiced = Float32Array.from({ length: 1280 }, (_, i) =>
    0.3 * (Math.sin(2 * Math.PI * 140 * i / 16000) + 0.35 * Math.sin(2 * Math.PI * 280 * i / 16000)))
  // At most eight frames, below the negotiated ACK queue ceiling.
  for (let i = 0; i < 8; i++) processor.process([[voiced]])
  expect(sent.filter(m => m.type === 'gate' && m.state === 'speech')).toHaveLength(1)
  expect(sent.filter(m => m.type === 'frame')).toHaveLength(before)
  command({ type: 'destroy', revision: 1 })
  processor.process([[voiced]])
  expect(sent.filter(m => m.type === 'frame')).toHaveLength(before)
})
```

- [x] **Step 2: Run red.** `npm test -- src/features/voice/audio/audio-capture-processor.test.ts -t "live gate|mute/destroy|detector"`. Expected FAIL absent gate-ready/messages or the current processor uploads all quiet frames.

- [x] **Step 3: Add the minimal processor paths.** Add imports for `CaptureGate`, `createCaptureVad`, `CaptureVad`. Widen constructor options to `{ maxPendingMs: number; speechGate?: boolean }`. Add fields:

```typescript
private readonly liveGate: boolean
private readonly gate: CaptureGate
private detector?: CaptureVad
private initializing = false
private destroyed = false
private uploading = true
```

Initialize `liveGate = Boolean(options.processorOptions.speechGate)` and `gate = new CaptureGate(maxPendingMs)`. Change the resampler callback to `pcm => this.captured(pcm)`. Add these methods:

```typescript
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
```

Replace the existing overflow body in `send()` with `this.overflow(); return`. Preserve the transferable frame shape and pending counter. Within the existing reset branch, after validated queue update, clear pending/resampler, set `uploading = !liveGate || data.uploading === true`, reset gate with the same negotiated ceiling, and `detector?.reset()` inside `try/catch`; on reset failure emit gate error and **do not acknowledge success**. Manual mute resets are deliberate privacy discards. Add the new message cases:

```typescript
if (data.type === 'initialize' && data.revision === this.revision) { this.initialize(); return }
if (data.type === 'destroy') {
  this.destroyed = true; this.muted = true; this.pending = 0
  this.resampler.reset(); this.gate.reset(false, this.maxFrames * 80)
  this.detector?.destroy(); this.detector = undefined
  return
}
// After reset handling and before ack/drain; never admit while muted or destroyed:
if (data.type === 'upload' && data.revision === this.revision && this.liveGate && !this.muted && !this.destroyed) {
  this.uploading = data.enabled === true
  for (const frame of this.gate.setUploading(this.uploading)) this.send(frame, 0)
  return
}
```

`process()` pushes input only when `!muted && !destroyed && (!liveGate || detector !== undefined)`. Drain remains the existing no-gate dictation operation. Live controller always uses `stop(false)`; a live drain must not bypass the gate with a tail frame. Block a live drain by muting/resetting without posting tail PCM. No top-level `await`, `fetch`, `eval`, `new Function`, alternate WASM path, or dynamic remote import.

- [x] **Step 4: Run green.** `npm test -- src/features/voice/audio/audio-capture-vad.test.ts src/features/voice/audio/audio-capture-gate.test.ts src/features/voice/audio/audio-capture-processor.test.ts src/features/voice/audio/pcm-resampler.test.ts`. Expected PASS; no-gate tests still exercise all original frames and real tail length. The real-module worklet fixture must be discovered, not skipped.

- [x] **Step 5: Commit.**

```powershell
git add frontend/src/features/voice/audio/audio-capture-processor.ts frontend/src/features/voice/audio/audio-capture-processor.test.ts
git commit -m "feat(voice): run live upload gate inside capture worklet"
```

## Task 4: Capture service readiness and independent upload admission

**Files:** `audio-capture-service.ts`, its direct test. Do not edit shared playback/audio fakes; override `FakeNode.port.postMessage` locally in this test when testing the new messages. The statically bundled detector bytes are part of the shared worklet asset, but dictation never instantiates WASM, scores audio, waits for VAD, or changes its pause/drain behavior.

- [x] **Step 1: Add failing service tests.** Extend the existing first test to retain its **dictation** expectation `noiseSuppression: true`. Add a live case with a `speechGate: vi.fn()` option and inject a node whose postMessage forwards reset/drain to the existing fake implementation and emits `gate-ready` only for `initialize`:

```typescript
const originalPost = node.port.postMessage.getMockImplementation()!
node.port.postMessage.mockImplementation(data => {
  if (data.type === 'initialize') node.port.emit({ type: 'gate-ready', revision: data.revision })
  else originalPost(data)
})
```

In test **`live capture waits for VAD, disables only initial noise suppression, and separates uploads from mute`**, use the existing injected `FakeContext`/stream/node pattern and assert:

```typescript
await capture.start()
expect(getUserMedia).toHaveBeenCalledWith({ audio: {
  channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true,
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
```

Add **`detector startup/runtime failure stops tracks and never enables unguarded upload`**: do not emit readiness, emit revision-0 `gate-error`; await `start()` rejecting `MEDIA_GATE_UNAVAILABLE`; assert stopped track/context/port once and no frame. Start a second instance successfully, then emit gate-error; assert one sanitized error callback, stopped resources, and no late frame/gate delivery. Add startup timeout using fake timers, no readiness for 1,000 ms: reject `MEDIA_GATE_UNAVAILABLE`, no frame. Restore timers in `afterEach`.

- [x] **Step 2: Run red.** `npm test -- src/features/voice/audio/audio-capture-service.test.ts -t "live capture|detector"`. Expected FAIL missing `setUploading` or wrong constraints/readiness.

- [x] **Step 3: Implement the local API without changing existing callers.** Add the declared `speechGate` callback, `uploading = true`, and `muted = true` fields. In start, set `noiseSuppression: !this.options.speechGate`; include `speechGate: Boolean(this.options.speechGate)` in real processor options. Keep the injected node signature unchanged. After installing port handlers and saving resource references, but before connecting the graph, start a revisioned waiter, post `initialize`, and await `gate-ready` only for live. Reuse the existing 1,000 ms waiter; map its initialization timeout and detector errors to `MEDIA_GATE_UNAVAILABLE` in the start catch. After every await check lifetime/node identity before connecting. Include `MEDIA_GATE_UNAVAILABLE` in preserved sanitized error messages, not arbitrary exception strings.

Add this method and replace setMuted's `accepting = !muted` assignment with `accepting = !muted && (!speechGate || uploading)`:

```typescript
setUploading(enabled: boolean) {
  this.uploading = enabled
  this.accepting = !this.muted && (!this.options.speechGate || enabled)
  this.node?.port.postMessage({ type: 'upload', revision: this.revision, enabled })
}
```

At the **start** of `setMuted`, synchronously set `this.muted = muted`, `accepting = false`, and disable tracks as today. On mute set `uploading = false` for live. Include `uploading` in reset; after its acknowledgement, enable tracks according to `!muted` even when live uploads remain disabled. Never call `setMuted` merely to suspend/resume quiet uploads.

Port-handler order after lifetime/revision validation:

```typescript
if (data.type === 'gate-ready' && this.options.speechGate) { this.resolveWaiter(); return }
if (data.type === 'gate-error' && this.options.speechGate) {
  this.rejectWaiter('MEDIA_GATE_UNAVAILABLE'); this.fail('MEDIA_GATE_UNAVAILABLE'); return
}
if (data.type === 'gate' && this.options.speechGate && !this.muted) {
  this.options.speechGate(data.state); return
}
```

For every revision-current `frame`, post `ack` **even when it is locally rejected**; then deliver only if accepting (existing tail-wait resolution stays valid). Otherwise queued pre-admission worklet frames can falsely overflow. Gate messages are allowed with upload admission disabled, not while muted. A `gate-error` must not also resolve a reset/ready waiter successfully. For a live `onprocessorerror`, fail with `MEDIA_GATE_UNAVAILABLE`; for dictation retain `UNSUPPORTED_AUDIO`.

Before closing the port in `stop`, post `destroy`, clear admission/mute flags and pending waiter, then execute existing disconnect/track/context cleanup. Reuse lifetime cancellation to avoid double disposal when start's catch runs after a fail/stop; track/context cleanup has **one owner**. Add an ownership check in catch before re-cleaning already stopped resources (late permission before ownership is still cleaned locally). No-gate capture semantics, including final drain, remain unchanged.

- [x] **Step 4: Run green.** `npm test -- src/features/voice/audio/audio-capture-service.test.ts src/features/voice/audio/audio-capture-processor.test.ts src/features/voice/transport/audio-transport-pipeline.test.ts src/features/voice/dictation/dictation-controller.test.ts`. Expected PASS or report only independently confirmed pre-existing failures; never weaken dictation to fix live gating.

- [x] **Step 5: Commit.**

```powershell
git add frontend/src/features/voice/audio/audio-capture-service.ts frontend/src/features/voice/audio/audio-capture-service.test.ts
git commit -m "feat(voice): separate local listening from upload admission"
```

## Task 5: Independent automatic quiet, gesture pause, and blocked call state

**Files:** Reducer and direct test. Keep `showsLiveVoice` true for every mounted non-ending phase; it is not keyed to a server terminal flag.

- [x] **Step 1: Write failing reducer tests.** Add `showsLiveVoice` to the imports and append:

```typescript
it('quiet input suspension preserves active output and the mounted surface', () => {
  const speaking = { ...initialLiveVoice, phase: 'active' as const, connection: 'connected' as const,
    agent: 'speaking' as const, response: { turnId: 't', responseId: 'r' } }
  const quiet = liveVoiceReducer(speaking, { type: 'INPUT', input: 'suspended' })
  expect(quiet).toMatchObject({ phase: 'active', input: 'suspended', agent: 'speaking',
    response: speaking.response, resumeRequired: false })
  expect(showsLiveVoice(quiet)).toBe(true)
})

it('blocked and recoverable failures stay mounted and only permitted recovery enables Resume', () => {
  for (const canResume of [false, true]) {
    const state = liveVoiceReducer({ ...initialLiveVoice, phase: 'active' },
      { type: 'PAUSE', notice: 'Voice paused.', canResume })
    expect(state).toMatchObject({ phase: 'suspended', resumeRequired: true, canResume,
      response: null, agent: 'idle', restoreDraft: null })
    expect(showsLiveVoice(state)).toBe(true)
  }
})
```

- [x] **Step 2: Run red.** `npm test -- src/features/voice/state/live-voice-reducer.test.ts -t "quiet input|blocked and recoverable"`. Expected FAIL missing `PAUSE` handling/`canResume`.

- [x] **Step 3: Make the minimal state additions.** Extend `input` with `suspended`; extend connection with `disconnected` so terminal failure is not falsely labeled connected. Add `canResume: boolean` (initial false) and `errorCode: string | null` (initial null). Add action `{ type: 'PAUSE'; notice: string; canResume: boolean; code?: string; disconnected?: boolean }`; implement:

```typescript
case 'PAUSE': return { ...state, phase: 'suspended', resumeRequired: true,
  canResume: action.canResume, errorCode: action.code ?? null,
  connection: action.disconnected ? 'disconnected' : state.connection,
  response: null, agent: 'idle', inputBusy: false, notice: action.notice }
```

`SUSPEND` (page/playback gesture) sets `canResume: true` only when control is connected; `LOST` sets false during bounded reconnect; `READY` with resumeRequired true sets true for the existing recovered-gesture path unless a previously recorded policy block forbids it. `RESUMED` clears `canResume`, `errorCode`, `notice`, `resumeRequired`, and `inputBusy`. `PAUSE` is not `ENDING`/`EXIT`: no draft restoration until actual exit. Update affected explicit state literals to use `initialLiveVoice` rather than fabricating incomplete types.

- [x] **Step 4: Run green.** `npm test -- src/features/voice/state/live-voice-reducer.test.ts`. Expected PASS, preserving old playback-drain/mute independence.

- [x] **Step 5: Commit.**

```powershell
git add frontend/src/features/voice/state/live-voice-reducer.ts frontend/src/features/voice/state/live-voice-reducer.test.ts
git commit -m "feat(voice): model quiet input and persistent paused calls"
```

## Task 6: Suspend/resume handshake and absolute mute

**Files:** Controller, direct test, direct fixture. Extend capture port Pick with `setUploading`; no transport source change.

- [x] **Step 1: Extend the direct fixture and write failing handshake tests.** Add `setUploading: vi.fn()` to fake capture and expose `gate: (state: 'suspended' | 'speech') => captureCallbacks.speechGate?.(state)`. Add `listening()` that emits `{ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }`. `begin()` emits ready, settles source reset, then listening and settles; tests explicitly covering pre-ack behavior do not use that final helper. Retain original response/session identities. Add:

```typescript
it('suspends uploads without muting or interrupting, then waits for listening before PCM', async () => {
  const f = liveVoiceFixture(); await f.begin()
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 })
  f.audio(); f.client.control.mockClear(); f.capture.setMuted.mockClear()
  f.gate('suspended'); f.frame(); f.gate('suspended')
  expect(f.client.sendInput).not.toHaveBeenCalled()
  expect(f.client.control).toHaveBeenCalledExactlyOnceWith({ type: 'input.suspend' })
  expect(f.capture.setMuted).not.toHaveBeenCalled()
  expect(f.capture.stop).not.toHaveBeenCalled()
  expect(f.context.sources[0].stop).not.toHaveBeenCalled()
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', input: 'suspended', agent: 'speaking' })
  f.gate('speech'); f.gate('speech'); f.frame()
  expect(f.client.control.mock.calls.filter(([e]) => e.type === 'input.unmute')).toHaveLength(1)
  expect(f.client.sendInput).not.toHaveBeenCalled()
  expect(f.capture.setMuted).not.toHaveBeenCalled()
  f.listening(); await settle(); f.frame()
  expect(f.capture.setUploading).toHaveBeenLastCalledWith(true)
  expect(f.client.sendInput).toHaveBeenCalledTimes(1)
  expect(f.http.create).toHaveBeenCalledTimes(1)
  expect(f.http.end).not.toHaveBeenCalled()
  expect(f.bindings.bindVoiceConversation).not.toHaveBeenCalled()
  expect(f.client.control.mock.calls.some(([e]) => e.type === 'response.interrupt')).toBe(false)
  f.controller.exit(); await settle()
})

it('manual mute wins over pending automatic resume and stale listening cannot release audio', async () => {
  const f = liveVoiceFixture(); await f.begin()
  f.gate('suspended'); f.gate('speech')
  await f.controller.toggleMute(); f.listening(); f.gate('speech'); f.frame()
  expect(f.controller.getSnapshot().input).toBe('muted')
  expect(f.client.sendInput).not.toHaveBeenCalled()
  expect(f.capture.setMuted).toHaveBeenLastCalledWith(true)
  const unmute = f.controller.toggleMute(); await settle()
  f.frame(); expect(f.client.sendInput).not.toHaveBeenCalled()
  f.listening(); await unmute; f.frame()
  expect(f.capture.setMuted).toHaveBeenLastCalledWith(false)
  expect(f.client.sendInput).toHaveBeenCalledTimes(1)
  f.controller.exit(); await settle()
})
```

Add a startup test: emit ready but not listening; frame is rejected; emit listening then frame is accepted. Add a stale-epoch listening event and check it does not release pending audio. Update existing unmute/resume tests to emit real listening **after** the requested control, not to assume sending a command grants admission.

- [x] **Step 2: Run red.** `npm test -- src/features/voice/state/live-voice-controller.test.ts -t "suspends uploads|manual mute wins|listening"`. Expected FAIL missing callback/API or continuous transmission/current immediate unmute.

- [x] **Step 3: Add only the handshake fields and helpers.** Run fields:

```typescript
inputSuspended: boolean
waitingForListening: boolean
inputGeneration: number
sourceReady: boolean
listeningGeneration: number | null
ackTimer?: ReturnType<typeof setTimeout>
```

Initialize the three flags false, inputGeneration 0 and listeningGeneration null. Add `speechGate` callback in `capture()` guarded by the same capture generation and `current(run)` test as frame/error; it calls `gate(run, state)`. Before capture starts or resets to unmuted, invoke `capture.setUploading(false)` so local listening is never upload permission. Implement:

```typescript
private gate(run: Run, state: 'suspended' | 'speech') {
  if (!this.current(run) || !run.ready || run.muted || run.needsGesture || this.view.phase !== 'active') return
  if (state === 'suspended') {
    if (run.inputSuspended) return
    run.inputSuspended = true; run.waitingForListening = false
    clearTimeout(run.ackTimer); run.transmitting = false
    run.capture?.setUploading(false)
    this.dispatch({ type: 'INPUT', input: 'suspended' })
    if (!run.client?.control({ type: 'input.suspend' })) this.fail(run, 'VOICE_CONNECT_TIMEOUT')
  } else if (run.inputSuspended && !run.waitingForListening) {
    this.requestListening(run)
  }
}

private requestListening(run: Run) {
  if (!this.current(run) || !run.ready || run.waitingForListening) return
  run.transmitting = false; run.capture?.setUploading(false)
  run.inputGeneration++; run.listeningGeneration = null
  run.waitingForListening = true
  clearTimeout(run.ackTimer)
  run.ackTimer = setTimeout(() => {
    if (this.current(run) && run.waitingForListening) this.fail(run, 'VOICE_CONNECT_TIMEOUT')
  }, run.session!.limits.connectMs)
  if (!run.client?.control({ type: 'input.unmute' })) this.fail(run, 'VOICE_CONNECT_TIMEOUT')
}

private listening(run: Run) {
  if (!this.current(run) || !run.waitingForListening || !run.capture || !run.ready) return
  if (!run.sourceReady || run.listeningGeneration !== run.inputGeneration) return
  if (run.needsGesture || run.muted) return
  clearTimeout(run.ackTimer); run.waitingForListening = false; run.inputSuspended = false
  run.transmitting = true
  this.dispatch({ type: 'INPUT', input: 'listening' })
  this.dispatch({ type: 'INPUT_BUSY', value: false })
  run.capture.setUploading(true)
}
```

A single bounded ACK timer uses the existing connect ceiling; the worklet's smaller admitted queue may fail sooner. This is not automatic network retry. Clear this timer in every stop/pause/lost/exit/mute path. In `voice.state`, retain the agent update and call `listening(run)` only for `event.input === 'listening'`; never assign server input over immediate local mute intent. A duplicate/stale suspended state cannot revoke or grant a newer request.

For startup and recreated-source races, at the start of initial `ready()` establish waiting state/timer **before** awaiting `setMuted(false, negotiatedLimit)`; on a current-epoch listening event while waiting set `listeningGeneration = run.inputGeneration`, then try release. The event handler latches first, and source-reset completion calls the same helper again. Set sourceReady only after its matching source reset succeeds. Clear sourceReady/listeningGeneration on any mute/pause/loss/stop; automatically suspended capture is already sourceReady and must not be reset. Add a test emitting listening synchronously immediately after ready but before a deferred reset resolves: no early PCM, then successful release after reset, with no second backend acknowledgement needed. Initial input.unmute is harmless but must not be treated as a promise of another state event; P1's initial-state handoff supplies that acknowledgement. For later explicit unmute/recovery, establish waiting only after the new source is prepared and before sending the control, so their listening event is for that operation. Each request clears the listening latch and advances the input generation before sending; no earlier observed listening state can authorize a later request.

Change normal `ready()` to set ready, prepare unmuted capture with negotiated limits **while uploading is false**, dispatch active READY and start progress timer only after the guarded source preparation. After any awaited source reset, require current run, matching `inputGeneration`, no manual mute and no gesture pause before releasing PCM. Recovered gesture readiness stays paused and does not start capture.

In `toggleMute()`, do not prevent the **mute** operation merely because any unmute/automatic resume is pending: its busy guard is `view.inputBusy && run.muted`, not a blanket inputBusy guard. Increment `inputGeneration`, clear waiting/timer, immediately clear transmitting/uploading, flip local manual intent, and dispatch the pressed state. Muting synchronously starts `setMuted(true)` before sending `input.mute`, as today; await and sanitize its rejection even when sending fails. Explicit unmute calls `setMuted(false)` while upload admission remains false; after current-generation checks it calls `requestListening`, not `setUploading(true)`. Do not hold a promise awaiting a server event inside toggleMute; `inputBusy` stays true until listening arrives or failure/pause clears it. Quiet gate wake uses only `requestListening`: no `setMuted`, new capture, new epoch, HTTP create, conversation binding or playback mutation.

- [x] **Step 4: Run green.** `npm test -- src/features/voice/state/live-voice-controller.test.ts -t "suspends uploads|manual mute|listening|allocates nothing|adopts initial"`. Expected PASS. Keep the RMS volume calculation strictly visual; it does not select speech or interrupt.

- [x] **Step 5: Commit.**

```powershell
git add frontend/src/features/voice/state/live-voice-controller.ts frontend/src/features/voice/state/live-voice-controller.test.ts frontend/src/features/voice/state/testing/live-voice-fixture.ts
git commit -m "feat(voice): resume same-call uploads only after listening ack"
```

## Task 7: Persistent failures, page pauses, and permitted manual recovery

**Files:** Controller, reducer if the directly required transition needs adjustment, direct tests/fixture, existing hook. Do not turn `VoiceClient.error` into an automatic new-client loop.

- [x] **Step 1: Write failing policy and startup tests.** Replace old direct tests that intentionally expect automatic idle/lease release on errors; preserve their sanitized-notice assertions. Add:

```typescript
it('all server failure/end variants retain the call, draft and lease without automatic paid recovery', async () => {
  for (const terminal of [false, true]) {
    for (const payload of [
      { type: 'session.error' as const, code: 'STT_UNAVAILABLE' as const, recovery: 'resume_call' as const,
        recoverable: true, terminal },
      ...(['idle', 'duration', 'quota', 'shutdown', 'error'] as const).map(reason =>
        ({ type: 'session.ended' as const, reason, terminal })),
    ]) {
      const f = liveVoiceFixture(); await f.begin(); f.event(payload); await settle(); f.frame()
      expect(f.controller.getSnapshot().phase).toBe('suspended')
      expect(f.controller.getSnapshot().resumeRequired).toBe(true)
      expect(f.client.sendInput).not.toHaveBeenCalled()
      expect(f.capture.stop).toHaveBeenCalledWith(false)
      expect(f.http.create).toHaveBeenCalledTimes(1)
      expect(f.http.end).not.toHaveBeenCalled()
      expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled()
      expect(f.bindings.writeVoiceDraft).not.toHaveBeenCalled()
      expect(f.draft()).toBe('Unsent original')
      if (payload.type === 'session.ended' || terminal)
        expect(f.controller.getSnapshot().canResume).toBe(false)
      f.controller.exit(); await settle()
      expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1)
    }
  }
})

it('only explicit permitted Resume reuses the same session and waits for listening', async () => {
  const f = liveVoiceFixture(); await f.begin()
  f.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'resume_call', recoverable: true, terminal: false })
  await settle(); expect(f.controller.getSnapshot().canResume).toBe(true)
  const resume = f.controller.resume(); await settle(); await resume; f.frame()
  expect(f.http.create).toHaveBeenCalledTimes(1)
  expect(f.client.control).toHaveBeenLastCalledWith({ type: 'input.unmute' })
  expect(f.client.sendInput).not.toHaveBeenCalled()
  f.listening(); await settle(); f.frame()
  expect(f.controller.getSnapshot().phase).toBe('active')
  expect(f.client.sendInput).toHaveBeenCalledTimes(1)
  f.controller.exit(); await settle()
})

it('quota/duration/exhausted reconnect cannot be bypassed by Resume or a later lost callback', async () => {
  for (const code of ['VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT', 'VOICE_RECONNECT_TIMEOUT'] as const) {
    const f = liveVoiceFixture(); await f.begin()
    f.event({ type: 'session.error', code, recovery: 'none', recoverable: false, terminal: false })
    f.callbacks().lost?.(); await settle(); await f.controller.resume(); f.frame()
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: false, errorCode: code })
    expect(f.http.create).toHaveBeenCalledTimes(1)
    expect(f.capture.start).toHaveBeenCalledTimes(1)
    expect(f.client.sendInput).not.toHaveBeenCalled()
    f.controller.exit(); await settle()
  }
})
```

Add direct tests **`detector unavailable at startup keeps a visible recoverable call without an admitted session`** (capture.start rejects MEDIA_GATE_UNAVAILABLE once; lease remains; Resume retries after cleanup; capture succeeds; HTTP create happens once, never before the failed detector), **`hiding during permission acquisition preserves the call but fences the late permission result`** (replace old idle expectation with suspended; zero create; no capture restart on visible; gesture Resume may proceed), and **`local gate speech after hidden/mute/loss cannot resume capture or playback`**. For hidden startup use a capture promise resolved after `suspend()` and verify input-generation fencing, not just the run-abort signal.

- [x] **Step 2: Run red.** `npm test -- src/features/voice/state/live-voice-controller.test.ts -t "server failure|permitted Resume|cannot be bypassed|detector unavailable|hiding during|local gate speech"`. Expected FAIL current fail/ended/startup-suspend exits.

- [x] **Step 3: Centralize stopped-resource pause instead of exiting.** Add `stoppingCapture?: Promise<void>` and `resuming: boolean` to Run; retain original request, limits, token, draft and session across all pauses. Define finite local recovery policy:

```typescript
const blocked = new Set(['VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT', 'VOICE_DISABLED',
  'VOICE_SESSION_ENDED', 'VOICE_RECONNECT_TIMEOUT', 'VOICE_DELIVERY_UNKNOWN', 'VOICE_BINDING_MISMATCH',
  'INVALID_VOICE_CONTROL', 'VOICE_SEQUENCE_ERROR', 'STALE_CONNECTION_EPOCH'])

private pause(run: Run, code: string, canResume: boolean, disconnected = false) {
  if (!this.current(run)) return
  run.inputGeneration++; run.waitingForListening = false
  clearTimeout(run.ackTimer); run.transmitting = false; run.needsGesture = true; run.resuming = false
  run.capture?.setUploading(false)
  this.stopTimer(run)
  run.playback.interrupt(); run.response = null; run.responseHasAudio = false
  run.stoppingCapture = this.stopCapture(run).catch(() => {})
  this.dispatch({ type: 'PAUSE', code, notice: liveVoiceNotice(code),
    canResume: canResume && !blocked.has(code), disconnected })
}
```

`fail()` now calls pause, never exit. Local microphone/detector/playback/source errors may offer manual recovery if the same control connection is valid, or if no session was admitted yet. A client `error` callback means the actual client has disposed: set ready false and disconnected, block recovery on that client. A server `session.error` uses `!terminal && recoverable && recovery === 'resume_call'` (or explicit `resume_gesture`) AND the finite block list; it does not infer permission from `recoverable` alone. For non-terminal local capture failure with a live server connection, send `input.mute` once to discard/fence recognition while capture is stopped; do not send that on a server policy pause that already stopped its flow. Do not call HTTP end/release/dispose just to pause. `callbacks.ended` likewise pauses with disconnected true and canResume false, rather than calling exit; if the structured event already supplied a specific notice/code, leave it intact. On a terminal structured event set run.ready false before disposal callbacks can run.

`session.ended` always pauses. Duration/quota/shutdown/terminal remain blocked; a legacy non-terminal idle reason is visible and blocked unless an explicit subsequent server recovery policy grants recovery. `session.warning` idle copy becomes **`Call is quiet. Listening locally; audio uploads pause automatically.`**, never “will end soon.” In error/ended callbacks, retain the first policy error rather than overwriting it with a generic lost notice. `lost()` still performs existing bounded reconnect cleanup, but if `view.errorCode` is set or this run is already blocked it cannot re-enable Resume, erase the code, restart capture, or convert disconnected into healthy. P4 fixes the underlying shared-client non-terminal disposal, not this defensive ordering rule.

- [x] **Step 4: Implement the explicit recovery path with source/gesture fences.** Extract the existing `start()` try-body into a private activation method and keep its existing audio/client event wiring unchanged. Store the original capabilities limits on Run so pre-admission retry does not adopt a refreshed configuration. The changed control flow is:

```typescript
// start(): after allocating run, recording original limits and dispatching START:
await this.activate(run)

// activate(): use the original start try-body, with these guards at its existing boundaries:
const generation = run.inputGeneration
const capture = this.capture(run, run.session?.limits.inputQueueMs ?? run.initialLimits.inputQueueMs)
capture.setUploading(false)
await Promise.all([run.playback.unlock(), capture.start()])
if (!this.current(run) || generation !== run.inputGeneration || run.needsGesture) return
// Only if there is no admitted session, perform existing HTTP create with run.request and run.abort.signal.
// Only if there is no client, construct existing callbacks and connect that admitted session.
```

These two comments identify **existing blocks to wrap** in `if (!run.session)` / `if (!run.client)`; do not add a second copy, change idempotencyKey, reset startedAt, or rotate an admitted session. All activation exceptions route to the new pause policy. If HTTP admission failed with a quota/duration/config/policy block, Resume stays disabled. Initial local detector/microphone failure before admission can retry only on a new user gesture; reuse the same Run and lease.

After HTTP create resolves, preserve the existing actual-exit cleanup (`!current(run)` ends that late admission once). If the run is still current but inputGeneration changed during page pause, retain the returned admission on Run without connecting/starting media. The next gesture can activate that same admission. Ignore an obsolete activation catch after a generation-changing pause; it must not overwrite the newer pause with CAPTURE_CANCELLED. Cover hide during the create await as well as hide during permission acquisition.

For `resume()`, require `view.phase === 'suspended' && view.canResume && !view.inputBusy`. Set busy and an input generation; recheck current/generation/visibility intent after each await. Clear gesture requirement only for this explicit recovery attempt. If no client was connected yet, retry activation with the original request, reusing any already returned admission. If an admitted, previously connected client exists, require ready/current control connection, recreate local capture only, call start and source setMuted(false) while upload is false, set `resuming = true`, then request listening. `listening()` completes the RESUMED transition and starts progress polling; no optimistic active/PCM before acknowledgement. A failed/blocked Resume re-pauses and closes its new source, never mints another server session.

**Gesture/cleanup ordering:** Calling playback.unlock before an await does not preserve activation for a later getUserMedia. Keep both permission/capture start and playback.unlock before the first await, as existing start does. If run.stoppingCapture is still pending, leave Resume disabled and clear inputBusy when that cleanup finishes; it does not auto-resume. The next explicit click may synchronously create/start the new source. If there is no pending cleanup, proceed synchronously in that click. Store/clear the exact stopping promise by identity so an older cleanup cannot enable Resume during a newer pause; guard its completion by inputGeneration/current run. This avoids both overlapping source owners and a gesture-losing await before getUserMedia. Add a direct test: Resume while prior cleanup is pending allocates no source, completion merely enables the control, then a new click invokes both start/unlock before the first await.

Preserve a manually muted intent across recovery: a permitted Resume may send `input.unmute` to reopen server paid resources, but **never enables microphone tracks** if `run.muted`. On the corresponding listening event, send `input.mute`, keep/reset capture muted, clear waiting/timer, dispatch RESUMED with input muted and transmitting false. Put this remute branch before listening's normal `run.muted` early return; only allow it when `run.resuming` is true. Add a test to show no frame can escape during the open/remute sequence. An old listening event after a user mutes during ordinary automatic wake does not qualify for that branch.

`suspend()` always retains the call, including permission/connecting phases: increment input generation, stop capture/upload and playback, clear ACK/timer, dispatch `{ type: 'PAUSE', notice, canResume: !run.client || run.ready }`, and send input.mute only if a ready server exists. Do not abort the whole Run merely to fence an outstanding permission result. That capture instance's stop/lifetime generation handles its late track; activation's generation check prevents HTTP create. `useLiveVoice.resume` keeps its existing `!document.hidden` check; rendering/effects and becoming visible never call resume. Pagehide/navigation/unmount still call real exit. Remove `'error'` from `LiveExitReason` and error-only draft-restore conditions once no caller uses it; restore only on real user hang-up, preserving navigation behavior.

- [x] **Step 5: Make notices accurate and sanitized.** Replace existing suggestions that imply automatic navigation/restart with in-call copy. Exact additions/changes:

```typescript
if (code === 'MEDIA_GATE_UNAVAILABLE') return 'Microphone uploads are paused because local speech detection is unavailable. Select Resume voice to try again.'
if (code === 'VOICE_IDLE_TIMEOUT') return 'Call is quiet. Audio uploads are paused.'
if (code === 'MICROPHONE_DENIED') return 'Microphone access was denied. Allow access, then select Resume voice.'
if (['MICROPHONE_LOST', 'MICROPHONE_UNAVAILABLE'].includes(code)) return 'Microphone unavailable. Reconnect it, then select Resume voice.'
if (code === 'VOICE_QUOTA_EXHAUSTED') return 'The voice limit was reached. This call is paused; Resume cannot reset the limit.'
if (code === 'VOICE_DURATION_LIMIT') return 'The call time limit was reached. Audio uploads and responses are stopped.'
if (code === 'VOICE_RECONNECT_TIMEOUT') return 'The connection could not be restored. This call is paused. Hang up when ready.'
if (code === 'STT_UNAVAILABLE') return 'Speech recognition is unavailable. This call is paused.'
if (code === 'TTS_UNAVAILABLE') return 'Speech playback is unavailable. This call is paused.'
```

Retain useful other sanitized mappings; generic fallback is **`Voice is paused. Your conversation and draft are unchanged. Hang up when ready.`** Never render arbitrary code/error/provider payload. Ended reason shutdown uses **`The voice service shut down. This call is paused; audio is stopped.`**

- [x] **Step 6: Run green.** `npm test -- src/features/voice/state/live-voice-controller.test.ts src/features/voice/state/live-voice-reducer.test.ts`. Expected PASS including changed old error/startup/mute-reset expectations. Each fixture run exits in cleanup so no test silently leaves a progress/ACK timer or lease alive.

- [x] **Step 7: Commit.**

```powershell
git add frontend/src/features/voice/state/live-voice-controller.ts frontend/src/features/voice/state/live-voice-controller.test.ts frontend/src/features/voice/state/live-voice-reducer.ts frontend/src/features/voice/state/live-voice-reducer.test.ts frontend/src/features/voice/state/testing/live-voice-fixture.ts frontend/src/features/voice/state/useLiveVoice.ts
git commit -m "fix(voice): retain paused calls and enforce explicit recovery policy"
```

## Task 8: Visible operational status and accessible controls

**Files:** Panel, controls, CSS, their direct surface/control tests, and `live-voice-lifecycle.ts` / `live-voice-lifecycle.test.ts` for keyboard policy parity. This is a functional status change, not a new design: preserve the black call screen, waveform, native buttons and layout.

- [x] **Step 1: Write failing rendered-status tests.** Update direct control test's `Exit voice` expectation to `Hang up`. Add to surface tests:

```typescript
it('shows quiet and failed/blocked status visibly without creating a transcript or auto-exit action', () => {
  const quiet = render({ input: 'suspended' })
  expect(quiet).toContain('Listening locally. Audio uploads paused until speech.')
  expect(quiet).not.toContain('aria-label="Resume voice"')
  const paused = render({ phase: 'suspended', resumeRequired: true, canResume: true,
    errorCode: 'MEDIA_GATE_UNAVAILABLE', notice: 'Local speech detection is unavailable.' })
  expect(paused).toMatch(/class="aurvin-live-notice"[^>]*role="status"/)
  expect(paused).toContain('Local speech detection is unavailable.')
  expect(paused).toMatch(/aria-label="Resume voice"(?![^>]*disabled)/)
  const blocked = render({ phase: 'suspended', resumeRequired: true, canResume: false,
    errorCode: 'VOICE_QUOTA_EXHAUSTED', notice: 'The voice limit was reached.' })
  expect(blocked).toContain('The voice limit was reached.')
  expect(blocked).toMatch(/<button[^>]*aria-label="Resume voice"[^>]*disabled=""/)
  expect(blocked).toContain('aria-label="Hang up"')
  expect(blocked).not.toContain('textarea')
})
```

Update the old recovered-surface fixture to `canResume: true`; a merely connected blocked state must not enable Resume. Add a control test proving quiet input's mic is **not pressed/muted**, Mute is available, and Hang up remains available during requesting/connecting/reconnecting/blocked/disconnected states. Replace the existing blanket busy-button test with two assertions: busy + input muted disables Unmute; busy + input listening leaves Mute enabled so a user can revoke a pending unmute. Apply that same policy to Alt+M in `live-voice-lifecycle.ts` and its direct shortcut test; change its old disabled-busy fixture to `input: 'muted', inputBusy: true` and add the enabled pending-unmute case.

- [x] **Step 2: Run red.** `npm test -- src/features/voice/live/live-voice-controls.test.ts src/features/voice/live/live-voice-surface.test.ts -t "quiet|Hang|failed/blocked"`. Expected FAIL no visible status or old Exit label.

- [x] **Step 3: Make the minimal panel/control changes.** Change hang-up aria-label to `Hang up`, retain Alt+X/action wiring. The mic disabled expression is `!usable || (view.inputBusy && isMuted)`; Alt+M uses `usable && (!view.inputBusy || view.input !== 'muted')`. Extend `liveVoiceLabels.connection` with disconnected: `Disconnected`; input uses suspended: `Listening locally; uploads paused`, with muted intent taking precedence over quiet. Keep ordinary dimension status sr-only. Add the following after that existing paragraph and before Resume:

```tsx
{voice.view.notice || voice.view.input === 'suspended' ?
  <p className="aurvin-live-notice" role="status" aria-live="polite" aria-atomic="true">
    {voice.view.notice ?? 'Listening locally. Audio uploads paused until speech.'}
  </p> : null}
```

Do not duplicate the same notice in both polite regions: remove `view.notice` text from the sr-only dimension paragraph. Resume appears for `resumeRequired` but is disabled by `!canResume || inputBusy` (not simply connection); this permits pre-admission local-detector recovery without pretending a transport exists. Controller policy remains authoritative. Native keyboard Enter/Space works; keep existing Alt+X Hang up shortcut and scoped editable/IME/repeat exclusions. The visible notice must not inherit `.aurvin-live-status` or `sr-only` hiding:

```css
.aurvin-live-notice {
  max-width: 42rem;
  margin: 0;
  color: #ffffff;
  font-size: 0.95rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
```

Do not change waveform scheduling, insert transcript elements or add Exit/Return to text as another automatic/user call action. Hang up is the explicit user exit. Existing navigation/unmount semantics stay intact.

- [x] **Step 4: Run green.** `npm test -- src/features/voice/live/live-voice-controls.test.ts src/features/voice/live/live-voice-surface.test.ts src/features/voice/live/live-voice-lifecycle.test.ts`. Expected PASS including reduced motion/focus tests and all two-button control expectations.

- [x] **Step 5: Commit.**

```powershell
git add frontend/src/features/voice/live/LiveVoiceControls.tsx frontend/src/features/voice/live/LiveVoicePanel.tsx frontend/src/features/voice/live/live-voice.css frontend/src/features/voice/live/live-voice-controls.test.ts frontend/src/features/voice/live/live-voice-surface.test.ts frontend/src/features/voice/live/live-voice-lifecycle.ts frontend/src/features/voice/live/live-voice-lifecycle.test.ts
git commit -m "feat(voice): show paused call status and accessible hang up"
```

## Task 9: Lifecycle races, quiet call duration, and direct composition

**Files:** Controller/direct tests/fixture as necessary; existing lifecycle and its direct test; direct `live-voice-composition.test.ts`. No integration-tests or transport-source edits.

- [x] **Step 1: Add the failing race checks.** Use fake timers and a deferred source/reset where specified:

```typescript
it('quiet beyond the old 60 plus 30 second idle window stays on call until Hang up', async () => {
  vi.useFakeTimers()
  const f = liveVoiceFixture(); await f.begin(); f.gate('suspended')
  f.event({ type: 'session.warning', code: 'VOICE_IDLE_TIMEOUT', recovery: 'none', recoverable: true })
  await vi.advanceTimersByTimeAsync(180_000)
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', input: 'suspended' })
  expect(f.controller.getSnapshot().notice).not.toContain('end soon')
  expect(f.http.end).not.toHaveBeenCalled()
  expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled()
  f.gate('speech'); f.controller.exit(); f.listening(); f.frame(); await settle()
  expect(f.client.sendInput).not.toHaveBeenCalled()
  expect(f.client.dispose).toHaveBeenCalledTimes(1)
  expect(f.http.end).toHaveBeenCalledTimes(1)
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
```

Add **`hide during resumed source reset cannot enable tracks or release buffered onset`**: defer capture.setMuted(false), invoke resume, suspend while deferred, resolve reset, emit listening/gate/frame; assert suspended, no sendInput, no resource reopening. Add **`Hang up during detector/permission/manual-resume work fences every late callback`**: exit while capture.start pending, resolve it, emit listening; expect one release/end/dispose and zero new HTTP create for an unadmitted source. Retain existing late successful HTTP response cleanup: one end, no connect. Add controller-fixture scenario with detector states for noise/echo while output is playing: no `response.interrupt`, `invalidate`, playback.stop, conversation binding or HTTP create, regardless of the fake detector saying speech. Then feed a real `response.cancelled` and assert the existing immediate playback interruption still occurs. These are control-authority fixtures, not acoustic false-positive proof.

In lifecycle direct test, rename misleading “device loss exit” title to **`hidden/freeze pause; visible does not resume; page destruction/detach tear down`**. Preserve its no-op devicechange assertion and assert zero exit calls before pagehide. Add Alt+X on a suspended/disconnected/blocked state and check one onExit; Escape never exits and cannot substitute for Hang up. No timer/effect-based visible resume.

- [x] **Step 2: Run red.** `npm test -- src/features/voice/state/live-voice-controller.test.ts src/features/voice/live/live-voice-lifecycle.test.ts -t "old 60|hide during|Hang up during|noise|hidden/freeze|Alt"`. Expected red for any missed lifetime/ACK/gesture fence; do not change tests to allow a leak.

- [x] **Step 3: Apply only missing shared fences.** Every async path captures `run.inputGeneration` or captureGeneration before awaiting and requires equality before changing admission/view. `stopCapture()` clears transmission/ACK synchronously, increments source generation, removes the source reference, and stores its cleanup promise. Exit aborts Run, clears ACK and polling timers before any await, stops source, disposes client and playback, releases lease once, and does one idempotent HTTP end. A repeated exit does nothing. Disconnected/terminal callback after user exit cannot overwrite idle/draft restoration. A policy pause keeps the lease until actual exit. Example common guard, used in the owning source method rather than duplicated across UI handlers:

```typescript
const generation = run.inputGeneration
await capture.setMuted(false)
if (!this.current(run) || generation !== run.inputGeneration || run.needsGesture || run.muted) return
this.requestListening(run)
```

For hide during startup, ensure visibility/permission cancellation also invalidates `resuming` before late reset completion. `pagehide`/navigation/unmount retain real teardown; permission loss only pauses the mounted call and stops resources.

- [x] **Step 4: Update direct real-client composition to the explicit handshake.** In `live-voice-composition.test.ts`, emit a numbered listening `voice.state` after ready and each explicit unmute/recovery; renumber subsequent control events contiguously. This preserves the real client's sequence oracle rather than bypassing it with direct controller events. The old test “ten-second failure exits” becomes **`real client bounded recovery failure pauses the same mounted call without replay`**, expecting phase suspended, canResume false, same original idempotency key/conversation, no PCM, no source restart and no further retry timers. Explicitly call exit at the end and assert timers zero.

Do **not** add a test expecting live non-terminal events to keep the real socket open in this P2 direct composition until the assigned P4 transport correction lands; record it as the handoff gate above, not a passing fixture. Existing dictation transport tests must continue to close on their terminal errors. Do not edit the P4-owned pipeline type error.

- [x] **Step 5: Run green.** `npm test -- src/features/voice/state/live-voice-controller.test.ts src/features/voice/state/live-voice-reducer.test.ts src/features/voice/live`. Expected PASS, or explicitly identify a P3 playback timing expectation or the P4 shared-client handoff as cross-owner rather than modifying their source. Preserve sample-accurate playback assertions; do not rewrite them to conceal incorrect scheduling.

- [x] **Step 6: Commit.**

```powershell
git add frontend/src/features/voice/state/live-voice-controller.ts frontend/src/features/voice/state/live-voice-controller.test.ts frontend/src/features/voice/state/testing/live-voice-fixture.ts frontend/src/features/voice/live/live-voice-lifecycle.ts frontend/src/features/voice/live/live-voice-lifecycle.test.ts frontend/src/features/voice/live/live-voice-composition.test.ts
git commit -m "test(voice): verify persistent call privacy and teardown races"
```

## Task 10: P2 verification and truthful downstream handoff

**Files:** Only previously owned files requiring an evidenced correction, and this plan's checkboxes. No new verification document owned by P4 and no unrelated source changes.

- [x] **Step 1: Run focused direct suites together.**

```powershell
npm test -- src/features/voice/audio/audio-capture-vad.test.ts src/features/voice/audio/audio-capture-gate.test.ts src/features/voice/audio/audio-capture-processor.test.ts src/features/voice/audio/audio-capture-service.test.ts src/features/voice/state/live-voice-reducer.test.ts src/features/voice/state/live-voice-controller.test.ts src/features/voice/live
```

Expected every discovered direct test passes, no unhandled promise rejection/timer leak. Record actual test counts and elapsed times. Fixtures prove media/control invariants, not real-device acoustic quality.

- [x] **Step 2: Run package checks separately.**

```powershell
npm run build
npm run lint
npm test
```

At this baseline, `npm run build` is expected to expose the known missing mandatory terminal in P4-owned `integration-tests/pipeline.test.ts` until P4 fixes it; report **blocked/failing**, not passed. Other newly introduced errors are P2 defects and must be corrected in scope. If tsc blocks Vite output, also run `npx vite build` to exercise actual worker bundling without claiming that substitutes for the package build. Inspect the emitted `dist/assets/audio-capture-processor-*.js`: embedded WASM is included; no `libfvad.wasm` external URL, fetch/eval/new Function, remote model asset, or separate model download was added. Node WASM plus production worker bundle is offline evidence, not a browser/AudioWorklet/CPU certification. Do not change build targets/config or disable type checks to hide another owner's failure.

Deployment policy remains P4/operator work: WebAssembly instantiation may require CSP `script-src 'wasm-unsafe-eval'`; this does **not** authorize script `unsafe-eval`, runtime downloads, or relaxing access controls. A policy that forbids WASM must produce the same visible MEDIA_GATE_UNAVAILABLE pause, not an alternate detector or continuous-upload fallback.

- [x] **Step 3: Run unaffected input/transport regressions.**

```powershell
npm test -- src/features/voice/dictation src/features/voice/transport src/api/voice-protocol.test.ts src/api/testing/voice-fixtures.test.ts
```

Expected dictation continues uploading its ordinary pauses, real tail drain and commit semantics are unchanged, and local live controls cannot become dictation protocol controls. Report integrated suites outside ownership separately; do not silently skip discovered failures. Backend/native/service suites are not P2's evidence: P4 executes and reports actual prerequisites. No live/paid checks are authorized.

- [x] **Step 4: Self-check acceptance and ownership, without dispatching review.**

| Criterion | Required P2 evidence / limitation |
| --- | --- |
| AC1 | 3-minute deterministic gate/worklet fixture, suspension at 5,040 ms captured non-speech, zero PCM afterward, no replacement silent frames. Provider protocol heartbeats remain P1/P4. |
| AC2 | Ordered once-only 320 ms pre-roll, ACK wait bounded by negotiated input queue, listening-before-PCM, same HTTP session/create count/conversation, reset only for real mute, measured 20 ms decision vs 80 ms batch vs separate network ACK. Overflow pauses visibly instead of dropping onset. |
| AC3 | Old idle interval, duration/quota/provider/terminal/nonterminal/reconnect/startup/background failures stay mounted, stopped paid/source resources, no retry/budget reset, permitted explicit recovery and Hang up cleanup. Real shared-client nonterminal recovery is P4 handoff, not yet passing evidence. |
| AC4 | Detector events cannot submit/interrupt/accept turns; only existing server response cancellation can stop old output. Synthetic noise/echo authority fixtures do not certify acoustic false-positive/negative rates. |
| AC6/AC7 | Absolute mute/hidden/unmount privacy, dictation regression, direct/full frontend check results with actual failures attributed; no playback or output durability change. |
| AC8 | Unauthorized/unrun: real mic, browser acoustics/CPU/CSP/device evaluation, paid usage/billing and perceived sentence flow. No savings or device quality certification. |

Confirm `git diff --check`, exact pin and license retention, no source outside ownership, no canvas changes, and branch still `codex/voice-cost-and-flow`. Search for `this.exit('error'`, “will end soon”, and calls that toggle mute on the quiet path; none should remain in live controller. Review is recorded **skipped**, not passed.

- [x] **Step 5: Commit scoped corrections and plan progress, then hand off.** Stage only actual P2 task paths; never `git add .`. If only this plan's progress changed:

```powershell
git add docs/voice-cost-and-flow/plan2.md
git commit -m "docs(voice-cost-and-flow): record P2 implementation progress"
```

Return actual commit hashes, test commands/counts/results, dependency/notice files, exact local API, measured fixture threshold/onset/ACK bounds, and open cross-owner work. Specifically tell P4: (1) preserve the same VoiceClient control socket on live terminal:false error/end, (2) fix its pipeline mandatory terminal fixture, (3) coordinate P1's initial listening state after ready and run real-client integration for startup plus pause -> permitted Resume -> listening -> pre-roll once with no duplicate inference, (4) include detector notices in release materials and validate allowed WASM CSP offline in an authorized browser fixture, and (5) keep unauthorized AC8 unverified. Do not mark the whole workflow complete or edit P3/P4 plans/state yourself.

## Planning self-check

All ten tasks are initially unchecked. AC1–AC4 map to Tasks 1–9 and the final matrix; no new settings, model, detector-driven interruption, transport/session rotation, dictation gating, or source outside P2 is planned. Shared-client and integrated type-check defects are explicit downstream gates. The four 20 ms windows and upstream typed-array-offset defect are reconciled against actual package source rather than copied from imprecise research prose.

References checked for this plan: [Vite worker URL import](https://vite.dev/guide/features.html#web-workers), pinned [embedded module](https://unpkg.com/@ozymandiasthegreat/vad@2.0.7/lib/embedded.js), [wrapper implementation](https://unpkg.com/@ozymandiasthegreat/vad@2.0.7/lib/vad.js), [published types](https://unpkg.com/@ozymandiasthegreat/vad@2.0.7/typings/index.d.ts), [package metadata](https://unpkg.com/@ozymandiasthegreat/vad@2.0.7/package.json), and [distributed BSD license](https://unpkg.com/@ozymandiasthegreat/vad@2.0.7/LICENSE). These public read-only documentation checks used no microphone, provider or application database.
