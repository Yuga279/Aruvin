# Comparable WebRTC Benchmark Tooling and Offline Checks (P6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this MAW, use the repository's `executing-plans` and `test-driven-development` skills; the orchestrator assigns workers and serializes commits. Do not dispatch additional agents or a reviewer.

**Goal:** Extend the existing benchmark with a headless LiveKit participant and conservative, transport-labelled comparison evidence, verified entirely offline without replacing the user's WebSocket benchmark work or manufacturing playback/completion evidence.

**Architecture:** Keep `runVoice` as the admission, timeout, and HTTP session-cleanup owner; branch explicitly to a small `@livekit/rtc-node` driver after admission. Reuse the existing scenario selection, log projection/correlation, `LiveBudget`, raw records, and `summarize` nearest-rank implementation. Separate decoded receipt from transport receipt, scheduling, audible output, and durable completion, and make incomplete or boundary-incompatible comparisons fail closed.

**Tech Stack:** Existing TypeScript/NodeNext, Node monotonic `performance.now()`, Vitest, Zod, and P1's existing `@livekit/rtc-node@^1.2.1` dependency/lock resolution. No Agents SDK, browser framework, audio dependency, package install, LiveKit process, database connection, or live provider call is needed for P6 checks.

---

## Steps

- [ ] Freeze measurement boundaries and preserve the user's benchmark changes.
- [ ] Add pure, monotonic decoded-receipt measurement and offline tests.
- [ ] Add the headless LiveKit participant behind the existing `runVoice` entry point.
- [ ] Extend configuration, one-shot guarded driver, and exports additively.
- [ ] Add conservative comparison and incomplete-run rejection.
- [ ] Document the P8 invocation, approval gates, browser/impairment procedure, and verify offline.

## Scope, prerequisites, and preservation rules

Read [goal.md](goal.md), [research.md](research.md), [state.md](state.md), P1's exported SDK/contract handoff in [plan1.md](plan1.md), and the current benchmark files before implementation. P1 implementation and this plan must be committed before the worker starts. P6 can execute independently of P2–P5 using mocks. Actual assembled/live execution belongs to P8.

The working tree already contains user-owned edits to `backend/src/benchmark/cli.ts` and `runner.ts`, new `live-baseline.ts`/`live-budget.ts`, their tests, and benchmark documentation. They are **inputs**, not scaffolding to replace. The current observed files, rather than research line numbers, govern implementation: `runner.ts` is 132 lines, `live-baseline.ts` 149, and `live-budget.ts` 102 at planning time.

Before editing one of these files, coordinate with the orchestrator/user's active owner. Privately record its pre-edit bytes/hash and inspect the proposed **P6-only** hunk. Never stage the user's pre-existing changes just because the whole file is needed for a P6 edit. Ask the orchestrator to establish an agreed baseline commit or stage only agreed P6 hunks; leave unrelated portions and `.openchamber/` alone. This scoped ownership check is not a reinstatement of skipped unified review. Only the orchestrator grants/stages serialized commits. Commit messages below are proposed worker boundaries, **not permission for this planner to run Git**.

Immutable inputs:

- `backend/benchmark-results/ws-live-2026-11-05/**`, including run `9ab4762c-c960-406f-adcf-84d91f265d56`.
- `docs/voice-latency-benchmark/websocket-live-baseline-2026-11-05.md` and `websocket-baseline-2026-11-05.md`.
- Original `baseline.pcm` and `baseline.json` under `backend/benchmark-results/ws-baseline-2026-11-05/audio/`.
- Existing benchmark history/verification/final reports; add methodology in a new document instead of revising historical findings.

Do not regenerate the waveform. Expected PCM is 183518 bytes, SHA-256 `933c59e38179c0a16df1b26aa1567a8a76ee823c0c0ceaf820feef382412c3a1`, with `speechEndMs=3734.9375`, mono PCM16 little-endian 16 kHz. Final zero padding yields 72 input frames / 5760 ms for an uninterrupted full replay.

### Important handoff: headless receipt is not playback proof

`state.md` records an active P1b contract follow-up. P1 currently exposes `audio.start`, `audio.end`, and `playback.progress`; a continuous remote track's decoded sample count is **not** proof that the intended response was played. Reliable data packets and RTP do not have a shared delivery order. Neither `AudioSource.captureFrame`, subscription, nonzero PCM, nor elapsed wall time proves audible playback.

P6 must therefore **not copy the old WebSocket simulated `playback.progress` loop into WebRTC**. Under the presently available P1 contract, the headless path can measure onset but must remain `unverified` if it cannot obtain independently correlated durable completion. It sends no invented `playedSamples`, never sets `completed` on `audio.end`, and does not bypass `LiveFlow` backpressure. It may time out after the existing 2000 ms unacknowledged output window; that is an honest limitation, not a reason to raise limits.

Notify the orchestrator/P1b/P3/P8 of this constraint before the worker finishes. Do not invent a new playback-proof field or benchmark-only server bypass. If upstream subsequently supplies an explicitly supported non-audible consumer/proof contract, its owner must hand over the exact types/validation/semantics and this plan must be reconciled before enabling acknowledgments. P6 can exit with tested fail-closed tooling; **P8 cannot claim a complete 1+7 successful lifecycle comparison from an onset-only/incomplete run**. Browser playout/durability evidence remains necessary. This is a bounded contract limitation, not a new P6 worker dependency or permission to change shared contracts.

## File map (before tasks)

Create:

- `backend/src/benchmark/voice-measurements.ts`: pure single-response onset gate and per-metric summaries, no SDK/network/storage.
- `backend/src/benchmark/webrtc-voice.ts`: native participant adapter only; invoked by `runVoice` after existing admission.
- `backend/src/benchmark/voice-comparison.ts`: offline artifact validation/comparison and guarded CLI entry point; does not launch applications/providers.
- `backend/src/benchmark/live-run-options.ts`: small pure parser for renewed-run arguments/output safety; used by the existing one-shot driver, not an authorization service.
- `backend/test/benchmark/voice-measurements.spec.ts`.
- `backend/test/benchmark/webrtc-voice.spec.ts`.
- `backend/test/benchmark/voice-comparison.spec.ts`.
- `backend/test/benchmark/live-run-options.spec.ts`.
- `docs/voice-latency-benchmark/webrtc-methodology.md`: P6 methodology only, not measured results.

Modify minimally, after preservation coordination:

- `backend/src/benchmark/voice-runner.ts:13-16,35-38`: explicit WebRTC dispatch inside the existing session lifetime; retain the existing WebSocket branch and common DELETE cleanup.
- `backend/src/benchmark/runner.ts:17-51`: additive transport/provenance schema fields and optional measurement fields. Keep default transport `websocket` for existing callers; **do not silently change existing configs to WebRTC**.
- `backend/src/benchmark/cli.ts:46-71,105-107,130-151`: new-run output fence, provenance projection, per-metric summary and completeness metadata. Preserve `voiceOnly`, no-tool analysis, per-case persistence, failure stop, warmups and exit codes.
- `backend/src/benchmark/live-baseline.ts:31-36,63-85,117-127`: parse fresh approval/output options; reuse the existing isolated backend, source hashing, settings validation, `LiveBudget` injections, readiness, and CLI child.
- `backend/src/benchmark/live-budget.ts:22`: only replace the default elapsed clock with `() => performance.now()`; leave ceilings and accounting unchanged.
- Append regression tests to `backend/test/benchmark/runner.spec.ts`, `voice-runner.spec.ts`, and `live-budget.spec.ts`; never replace the user's tests.

Do not modify manifests/lockfiles (P1 owns them), application wiring/providers/contracts (P1–P5), frontend (P4/P8), raw results, or any other workflow plan. Existing `report.ts`, readonly harnesses, text runner, waveform generator, and their tests are reused unchanged.

All new code files start with the repository's valid TypeScript header with FILE, LOCATION, PURPOSE, ROLE IN PROJECT, and KEY COMPONENTS. Snippets below show executable bodies/imports; include the header above those bodies on first write. Existing header changes are only required if a file changes by more than 30%; do not reformat entire user files.

**Execution order:** Task 1 → Task 3 (configuration contract) → Task 2 (SDK adapter) → Task 4 → Task 5 → Task 6. The adapter is described next to the measurement contract for readability, but its green run requires Task 3's config/type additions. Do not commit an adapter that references an absent `BenchmarkConfig.transport` property.

## Frozen measurement/export contract

### Boundaries

All elapsed times use **one client process monotonic clock**. ISO dates are provenance only. Keep `speechEndClockMs = inputStarted + speechEndMs`; do not move the marker to an 80 ms frame boundary. Also record the actual submission time of the marker-containing frame and maximum pacing lateness so codec queues or scheduling drift are not hidden.

- `setupMs`: immediately before HTTP admission POST through validated `session.ready` receipt; identical high-level endpoints for both transports, with different setup work recorded.
- `firstAudioMs` / `speechEndToFirstAudioMs`:
  - Existing WS: first binary PCM chunk accepted after `audio.start` (including all-zero PCM), before any playback scheduling. Boundary ID `ws-pcm-receipt-v1`.
  - WebRTC: first decoded **nonzero** mono 24 kHz `AudioFrame` returned by `AudioStream(track, { sampleRate: 24000, numChannels: 1 })` **after** valid `audio.start` for the one expected backend participant/track and active epoch. Boundary ID `webrtc-decoded-nonzero-after-start-v1`.
  - A nonzero frame before `audio.start` is ignored, counted, and never backdated. Frames after cancellation, reconnection, or track replacement are rejected. Cross-channel reordering/continuous-track attribution is recorded as a limitation; a nonce in the JSON event does not correlate an RTP frame to a response.
- `firstMediaReceiptMs`: **null** for WebRTC; `TrackSubscribed` is not an RTP receipt timestamp. SDK decode availability includes jitter buffering, PLC, decoding, resampling, and JS delivery; do not claim isolated network latency.
- `firstTrackSubscribedMs`: remote assistant track subscription notification; not onset, scheduling, or audibility.
- `firstTrackScheduledMs`, `firstAudibleMs`, `speechEndToAudibleMs`, `interruptionToAudibleStopMs`: **null** in headless P6 exports.
- `speechEndToPlaybackEndMs`: keep the old WebSocket simulated metric unchanged; **null** for the new headless WebRTC path without a supported proof contract. Do not put `audio.end` here.
- `durableCompletionMs`: only after the existing correlated `delivery-settled` without error and matching turn `terminal/chat=completed` evidence callback succeeds. Missing evidence is `null`/unverified. Session-level telemetry belonging to another turn cannot confirm this response.

The first-audio boundaries above are **incompatible for a like-for-like delta**: WS includes initial silence and no jitter/decode, WebRTC excludes silence and includes decode. Report the values side by side with that warning, with `deltaMs=null`, `deltaPercent=null`, and no improvement verdict. Retained WS PCM content was not exported, so its first-nonzero boundary cannot be reconstructed from the old JSON. A newly authorized matched baseline or stronger evidence is required to change this classification. Never retroactively relabel the old report.

### Export additions (schema version 2, existing fields retained)

`WireResult` gets only optional additive fields:

```typescript
transport?: 'websocket' | 'webrtc';
firstAudioBoundary?: 'ws-pcm-receipt-v1' | 'webrtc-decoded-nonzero-after-start-v1';
firstMediaReceiptMs?: number | null;
firstTrackSubscribedMs?: number | null;
firstTrackScheduledMs?: number | null;
firstAudibleMs?: number | null;
speechEndToAudibleMs?: number | null;
interruptionToAudibleStopMs?: number | null;
decodedSamples?: number;
preStartFrames?: number;
maxInputLatenessMs?: number;
speechEndFrameSubmittedMs?: number | null;
failureCode?: 'BENCHMARK_TRANSPORT_MISMATCH' | 'BENCHMARK_MEDIA_FAILED' |
  'BENCHMARK_TIMEOUT' | 'BENCHMARK_UNPROVEN_PLAYBACK';
```

`results.json` retains every record, pseudonymized identifiers, timelines, `summary`, and adds:

- `schemaVersion: 2`, `complete: boolean`, `transport`, `firstAudioBoundary`, `voiceMetrics` (one existing `summarize` result per metric), `provenance` (the allowlist below).
- `complete` requires actual expected warmup/measured counts, no skips/failures/unverified cases, valid finite required metrics, and correlated durable success; it is not set merely because the process exited.
- Keep historical `summary` duration ranking, but never fall back from missing WebRTC playback duration to whole-operation duration as if they were the same metric. A missing voice playback duration yields an unavailable/failed duration sample, not a duration-based win.
- Missing metrics remain null; warmups and failures stay in raw records but are excluded from success percentiles. A failed measured row contributes to failure counts for each requested metric.

Nonsecret `provenance` is a strict bounded object with these exact fields:

```typescript
type VoiceProvenance = {
  authorizationReference: string; // identifier only, never approval text or a credential
  sourceHash: string; buildHash: string; configurationHash: string;
  instructionHash: string; productKnowledgeHash: string;
  inputSha256: string; inputBytes: number; speechEndMs: number;
  scenario: 'voice-baseline'; freshConversation: true;
  inputSampleRateHz: 16000; inputChannels: 1; inputFrameMs: 80;
  decodedSampleRateHz: 24000; decodedChannels: 1;
  codec: 'pcm16' | 'opus'; rtpClockHz: 48000 | null;
  requestedPacketMs: number | null; observedPacketMs: number | null;
  resampling: 'none' | 'rtc-native-16k-to-opus-and-opus-to-24k';
  clientPlacement: string; backendPlacement: string; sfuPlacement: string;
  databasePlacement: string; providerRegion: string;
  rtcNodeVersion: string | null; ffiVersion: string | null;
  modelLabel: string; routingLabel: string; sttModel: string; ttsModel: string;
  endpointingHash: string; limitsHash: string;
  impairment: 'none' | 'fixed-delay-jitter-loss-v1';
  playbackBoundary: 'ws-simulated-24k-v1' | 'unproven';
};
```

Hashes are SHA-256 lowercase hex. Placement/model/version/reference labels allow only `[A-Za-z0-9/_.:-]`, length 1–128; no arbitrary diagnostic strings. Unknown/missing actual placement is literal `unverified`, which blocks a matched comparison. Nullable observed fields mean **not measured**, not 20 ms by assumption. Native WebRTC uses Opus's 48 kHz clock, but 80 ms capture calls do not prove 80 ms RTP packets. Do not set packet duration to 20 ms unless measured; no packet-capture subsystem is added in P6.

The driver hashes existing safe source paths with its existing `sorted path + NUL + bytes + NUL` algorithm; add safe compiled `dist/**/*.js` build hashing and separate fixed-asset hashes. Record pre/post source/build hashes in `context.json`; drift makes the run incomplete. Reuse current nonsecret settings projection, with new `configurationHash`, endpointing and limits hashes computed on stable-key JSON. Store resolved SDK/FFI versions from lockfile, not merely manifest ranges. Do not persist LiveKit token/participant descriptors, raw SDK objects, URLs with access data, `.env`, authorization headers, raw exceptions, transcripts, response text, private reasoning, or any audio output. Original synthetic input stays in its existing private artifact location; its hash is exported.

---

### Task 1: Pure monotonic onset gate and per-metric summaries

**Files:** Create `backend/src/benchmark/voice-measurements.ts` and `backend/test/benchmark/voice-measurements.spec.ts`. Reuse `backend/src/benchmark/report.ts` unchanged.

- [ ] **Step 1 — Write these failing tests.**

```typescript
import { expect, it, vi } from 'vitest';
import { DecodedReceipt, summarizeVoiceMetric } from '../../src/benchmark/voice-measurements.js';

it('gates onset on audio.start and the next decoded nonzero 24 kHz frame', () => {
  let now = 100;
  const receipt = new DecodedReceipt(100, () => now);
  receipt.inputStarted(200, 10);
  now = 205; receipt.frame(new Int16Array([4]), 24000, 1);
  now = 220; receipt.start('turn', 'response');
  now = 230; receipt.frame(new Int16Array([0, 0]), 24000, 1);
  expect(receipt.snapshot().firstAudioMs).toBeNull();
  now = 240; receipt.frame(new Int16Array([0, -1]), 24000, 1);
  now = 250; receipt.frame(new Int16Array([1]), 24000, 1);
  expect(receipt.snapshot()).toMatchObject({ firstAudioMs: 140,
    speechEndToFirstAudioMs: 30, preStartFrames: 1, decodedSamples: 5 });
});

it('rejects backwards clocks, wrong audio formats and invalid response reuse', () => {
  let now = 100;
  const receipt = new DecodedReceipt(100, () => now);
  receipt.inputStarted(100, 10);
  now = 120; receipt.start('t', 'r');
  expect(() => receipt.frame(new Int16Array([1]), 16000, 1)).toThrow('BENCHMARK_MEDIA_FAILED');
  expect(() => receipt.start('other', 'other')).toThrow('BENCHMARK_MEDIA_FAILED');
  now = 119;
  expect(() => receipt.frame(new Int16Array([1]), 24000, 1)).toThrow('BENCHMARK_MEDIA_FAILED');
});

it('does not use wall time or accept onset before the declared speech end', () => {
  const wall = vi.spyOn(Date, 'now').mockReturnValue(-999999);
  try {
    const receipt = new DecodedReceipt(0, () => 10);
    receipt.inputStarted(10, 100);
    receipt.start('t', 'r');
    expect(() => receipt.frame(new Int16Array([1]), 24000, 1)).toThrow('BENCHMARK_MEDIA_FAILED');
  } finally { wall.mockRestore(); }
});

it('reuses nearest-rank summaries without dropping missing/failed measured rows', () => {
  const rows = [
    { warmup: true, outcome: 'success', setupMs: 999 },
    { warmup: false, outcome: 'success', setupMs: 10 },
    { warmup: false, outcome: 'success', setupMs: 20 },
    { warmup: false, outcome: 'success', setupMs: null },
    { warmup: false, outcome: 'timeout', setupMs: 1 },
  ];
  expect(summarizeVoiceMetric(rows, 'setupMs')).toEqual({ scenario: 'setupMs',
    samples: 4, succeeded: 2, failed: 2, p50Ms: 10, p95Ms: 20 });
});
```

- [ ] **Step 2 — Red:** In `backend/`, run `npm test -- test/benchmark/voice-measurements.spec.ts`. Expect missing-module/export failures, not a network prerequisite or native load failure.
- [ ] **Step 3 — Minimal implementation:** Add the following bodies after the mandatory header. Store only counters/times, never frames.

```typescript
import { summarize } from './report.js';

export class DecodedReceipt {
  private last: number;
  private ref: string | null = null;
  private speechEnd: number | null = null;
  private first: number | null = null;
  private samples = 0;
  private before = 0;
  constructor(private readonly started: number,
    private readonly now: () => number = () => performance.now()) {
    if (!Number.isFinite(started) || started < 0) throw new Error('BENCHMARK_MEDIA_FAILED');
    this.last = started;
  }
  private clock() {
    const n = this.now();
    if (!Number.isFinite(n) || n < this.last) throw new Error('BENCHMARK_MEDIA_FAILED');
    this.last = n;
    return n;
  }
  inputStarted(at: number, marker: number) {
    if (this.speechEnd !== null || !Number.isFinite(at) || at < this.started ||
      !Number.isFinite(marker) || marker <= 0) throw new Error('BENCHMARK_MEDIA_FAILED');
    this.speechEnd = at + marker;
  }
  start(turnId: string, responseId: string) {
    this.clock();
    if (this.ref || !turnId || !responseId) throw new Error('BENCHMARK_MEDIA_FAILED');
    this.ref = `${turnId}:${responseId}`;
  }
  frame(data: Int16Array, rate: number, channels: number) {
    const at = this.clock();
    if (rate !== 24000 || channels !== 1 || !data.length || data.length > 4800)
      throw new Error('BENCHMARK_MEDIA_FAILED');
    if (!this.ref) { this.before++; return; }
    this.samples += data.length;
    if (this.samples > 24000 * 180) throw new Error('BENCHMARK_MEDIA_FAILED');
    if (this.first === null && data.some(sample => sample !== 0)) {
      if (this.speechEnd === null || at < this.speechEnd) throw new Error('BENCHMARK_MEDIA_FAILED');
      this.first = at;
    }
  }
  snapshot() {
    return { firstAudioMs: this.first === null ? null : this.first - this.started,
      speechEndToFirstAudioMs: this.first === null || this.speechEnd === null ? null : this.first - this.speechEnd,
      decodedSamples: this.samples, preStartFrames: this.before };
  }
}

export function summarizeVoiceMetric(rows: ReadonlyArray<{ warmup?: boolean; outcome: string;
  [key: string]: unknown }>, metric: string) {
  return summarize(rows.map(row => {
    const value = row[metric];
    const valid = typeof value === 'number' && Number.isFinite(value) && value >= 0;
    return { scenario: metric, warmup: row.warmup === true,
      outcome: row.outcome === 'success' && valid ? 'success' : 'unverified',
      durationMs: valid ? value : 0 };
  }))[0] ?? { scenario: metric, samples: 0, succeeded: 0, failed: 0, p50Ms: null, p95Ms: null };
}
```

The zero value is only an excluded failure sentinel passed to the existing summary function, never an exported substitute for missing latency.

- [ ] **Step 4 — Green:** Run `npm test -- test/benchmark/voice-measurements.spec.ts test/benchmark/latency.spec.ts`. Add table cases for NaN/Infinity, two channels, empty/oversized frames, pre-start silence, repeated input start, and seven successful values where p95 equals their maximum; all must pass with no mocks of actual clocks in application code.
- [ ] **Step 5 — Commit boundary:** `test(benchmark): define monotonic decoded receipt boundaries`. Stage only the two new files after orchestrator permission.

### Task 2: SDK adapter tests with deterministic Room/AudioStream fakes

**Files:** Create `backend/test/benchmark/webrtc-voice.spec.ts`; create `backend/src/benchmark/webrtc-voice.ts`. Modify only the WebRTC dispatch hunk in `backend/src/benchmark/voice-runner.ts` and additive `WireResult` fields in `runner.ts`.

- [ ] **Step 1 — Write the fake before implementation.** Use `vi.hoisted` and `vi.mock('@livekit/rtc-node', ...)` so tests never initialize native FFI, discover devices, or contact LiveKit. This is a Vitest fake, not a reusable transport framework.

```typescript
import type { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionResponseFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { INPUT_AUDIO, LIVEKIT_CONTROL_TOPIC } from '../../src/contracts/voice-wire.js';
import { benchmarkConfigSchema, type WireResult } from '../../src/benchmark/runner.js';
import { runWebRtcVoice } from '../../src/benchmark/webrtc-voice.js';

const fake = vi.hoisted(() => ({ room: undefined as unknown, source: undefined as unknown,
  received: undefined as unknown, publish: vi.fn(), capture: vi.fn(), disconnect: vi.fn(),
  close: vi.fn(), streamOptions: undefined as unknown, sent: [] as Record<string, unknown>[] }));
vi.mock('@livekit/rtc-node', async () => {
  const { EventEmitter } = await import('node:events');
  class Room extends EventEmitter {
    localParticipant = { publishTrack: fake.publish,
      publishData: vi.fn(async (bytes: Uint8Array, options: unknown) => {
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        fake.sent.push({ ...payload, options });
      }) };
    name = 'aurvin-live-voice-1';
    connect = vi.fn(async () => undefined);
    disconnect = fake.disconnect;
    constructor() { super(); fake.room = this; }
  }
  class AudioSource {
    captureFrame = fake.capture;
    clearQueue = vi.fn();
    close = fake.close;
    constructor() { fake.source = this; }
  }
  class AudioFrame {
    constructor(public data: Int16Array, public sampleRate: number,
      public channels: number, public samplesPerChannel: number) {}
  }
  class RemoteAudioTrack {}
  class AudioStream extends ReadableStream {
    constructor(_track: unknown, options: unknown) {
      super({ start(controller) { fake.received = controller; } });
      fake.streamOptions = options;
    }
  }
  return { Room, AudioSource, AudioFrame, AudioStream, RemoteAudioTrack,
    LocalAudioTrack: { createAudioTrack: vi.fn(() => ({})) },
    TrackPublishOptions: class { constructor(value: object) { Object.assign(this, value); } },
    TrackSource: { SOURCE_MICROPHONE: 2 },
    RoomEvent: { DataReceived: 'dataReceived', TrackSubscribed: 'trackSubscribed',
      Disconnected: 'disconnected', Reconnecting: 'reconnecting', TrackUnsubscribed: 'trackUnsubscribed',
      TrackSubscriptionFailed: 'trackSubscriptionFailed' } };
});

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); fake.sent.length = 0; });

it('publishes microphone PCM in real time but never fabricates playback from decoded frames', async () => {
  vi.useFakeTimers();
  const session = createSessionResponseFixture('live');
  const config = benchmarkConfigSchema.parse({ transport: 'webrtc',
    start: '2026-11-06T10:00:00Z', end: '2026-11-06T11:00:00Z', timeZone: 'Etc/UTC',
    speechEndMs: 10, timeoutMs: 2000 });
  const result: WireResult = { durationMs: 0, firstTextMs: null, acceptanceMs: 0,
    firstAudioMs: null, speechEndToFirstAudioMs: null, outcome: 'failed' };
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 2000);
  const signal = stop.signal;
  const work = runWebRtcVoice({ config, pcm: new Uint8Array(64000), session,
    result, started: performance.now(), signal });
  await vi.advanceTimersByTimeAsync(0);
  const room = fake.room as EventEmitter;
  let sequence = 0;
  const control = (payload: object) => room.emit('dataReceived', new TextEncoder().encode(JSON.stringify({
    protocolVersion: 1, sessionId: session.sessionId, connectionEpoch: session.connectionEpoch,
    sequence: sequence++, eventId: `e-${sequence}`, ...payload,
  })), { identity: 'aurvin-agent:voice-1' }, 0, LIVEKIT_CONTROL_TOPIC);
  control({ type: 'session.ready', limits: session.limits,
    effectiveAudioSettings: { input: INPUT_AUDIO, output: session.effectiveAudioSettings.output } });
  await vi.advanceTimersByTimeAsync(160);
  expect(fake.capture).toHaveBeenCalledTimes(3); // deadlines 0, 80, 160, not burst submission
  const { RemoteAudioTrack } = await import('@livekit/rtc-node');
  room.emit('trackSubscribed', Object.create(RemoteAudioTrack.prototype), {}, { identity: 'aurvin-agent:voice-1' });
  expect(fake.streamOptions).toEqual({ sampleRate: 24000, numChannels: 1 });
  control({ type: 'audio.start', turnId: 't', responseId: 'r', sampleRate: 24000, firstAudioSequence: 0 });
  const decoded = fake.received as ReadableStreamDefaultController;
  decoded.enqueue({ data: new Int16Array([0]), sampleRate: 24000, channels: 1 });
  await vi.advanceTimersByTimeAsync(20);
  decoded.enqueue({ data: new Int16Array([1]), sampleRate: 24000, channels: 1 });
  await vi.advanceTimersByTimeAsync(20);
  control({ type: 'audio.end', turnId: 't', responseId: 'r', lastAudioSequence: 0 });
  await vi.advanceTimersByTimeAsync(2000);
  await work;
  expect(result.firstAudioMs).toBeGreaterThan(0);
  expect(result.completed).not.toBe(true);
  expect(result.speechEndToPlaybackEndMs).toBeNull();
  expect(fake.sent.some(event => event.type === 'playback.progress')).toBe(false);
  expect(fake.disconnect).toHaveBeenCalledTimes(1);
  expect(fake.close).toHaveBeenCalledTimes(1);
});
```

`Object.create(RemoteAudioTrack.prototype)` is only for the mocked track in this test; never construct fake native tracks in production. The explicit test AbortController follows fake timers; production keeps its existing real bounded signal. Mock `node:timers/promises` in this spec to use the fakeable global timer rather than depending on native promise-timer interception:

```typescript
vi.mock('node:timers/promises', () => ({
  setTimeout: (ms: number, value?: unknown, options?: { signal?: AbortSignal }) => {
    if (options?.signal?.aborted) return Promise.reject(new Error('fixture-aborted'));
    if (ms <= 0) return Promise.resolve(value);
    return new Promise((yes, no) => {
      const abort = () => { clearTimeout(timer); no(new Error('fixture-aborted')); };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener('abort', abort); yes(value);
      }, ms);
      if (options?.signal?.aborted) abort();
      else options?.signal?.addEventListener('abort', abort, { once: true });
    });
  },
}));
```

- [ ] **Step 2 — Red:** `npm test -- test/benchmark/webrtc-voice.spec.ts`. Expect missing `runWebRtcVoice` export; no FFI loading or connection attempt is acceptable.
- [ ] **Step 3 — Add the adapter's exact entry point and native setup.**

```typescript
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, RemoteAudioTrack,
  Room, RoomEvent, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { INPUT_AUDIO, LIVEKIT_CONTROL_TOPIC, isLiveKitVoiceSessionResponse,
  livekitAgentIdentity, parseVoiceControl, type CreateVoiceSessionResponse,
  type VoiceClientPayload } from '../contracts/voice-wire.js';
import type { BenchmarkConfig, WireResult } from './runner.js';
import { DecodedReceipt } from './voice-measurements.js';

export async function runWebRtcVoice(options: {
  config: BenchmarkConfig; pcm: Uint8Array; session: CreateVoiceSessionResponse;
  result: WireResult; started: number; signal: AbortSignal;
  confirmDelivery?: (wire: WireResult, signal: AbortSignal) => Promise<boolean>;
}): Promise<void> {
  const { config, pcm, session, result, started, signal, confirmDelivery } = options;
  if (!isLiveKitVoiceSessionResponse(session)) throw new Error('BENCHMARK_TRANSPORT_MISMATCH');
  const room = new Room(), source = new AudioSource(16000, 1, 0);
  const receipt = new DecodedReceipt(started);
  const agent = livekitAgentIdentity(session.sessionId);
  let sequence = 0, serverSequence = -1, stopped = false, connected = false;
  let disconnectTask: Promise<void> | undefined;
  const disconnect = () => {
    if (!connected) return Promise.resolve();
    connected = false;
    disconnectTask ??= room.disconnect();
    return disconnectTask;
  };
  let reader: ReadableStreamDefaultReader<AudioFrame> | undefined;
  let mediaTask: Promise<void> | undefined;
  let response: { turnId: string; responseId: string } | undefined;
  let endSeen = false;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  let resolveEnd!: () => void, rejectEnd!: (error: Error) => void;
  const ready = new Promise<void>((yes, no) => { resolveReady = yes; rejectReady = no; });
  const end = new Promise<void>((yes, no) => { resolveEnd = yes; rejectEnd = no; });
  void ready.catch(() => undefined); void end.catch(() => undefined);
  const fail = () => {
    if (stopped) return;
    stopped = true;
    const error = new Error('BENCHMARK_MEDIA_FAILED');
    rejectReady(error); rejectEnd(error);
    void reader?.cancel().catch(() => undefined);
  };
  const send = async (payload: VoiceClientPayload) => {
    if (!room.localParticipant || signal.aborted) return;
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({
      protocolVersion: 1, sessionId: session.sessionId, connectionEpoch: session.connectionEpoch,
      eventId: randomUUID(), sequence: sequence++, ...payload,
    })), { reliable: true, topic: LIVEKIT_CONTROL_TOPIC, destinationIdentities: [agent] });
  };
  Object.assign(result, { transport: 'webrtc',
    firstAudioBoundary: 'webrtc-decoded-nonzero-after-start-v1',
    firstMediaReceiptMs: null, firstTrackSubscribedMs: null, firstTrackScheduledMs: null,
    firstAudibleMs: null, speechEndToAudibleMs: null, interruptionToAudibleStopMs: null,
    speechEndToPlaybackEndMs: null, durableCompletionMs: null, inputAudioMs: 0 });
```

Keep the function open for the next steps. No retry, token minting, room creation, server secret, device capture, or second HTTP admission is added here.

- [ ] **Step 4 — Add bounded control handling and decoded subscription.** Append inside `runWebRtcVoice`:

```typescript
  room.on(RoomEvent.DataReceived, (bytes, participant, _kind, topic) => {
    if (stopped || topic !== LIVEKIT_CONTROL_TOPIC) return;
    try {
      if (participant?.identity !== agent || bytes.byteLength > 131072) throw new Error();
      const event = parseVoiceControl(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'server', 'live');
      if (event.sessionId !== session.sessionId || event.connectionEpoch !== session.connectionEpoch ||
        event.sequence <= serverSequence) throw new Error();
      serverSequence = event.sequence;
      if (event.type === 'session.ready') resolveReady();
      if (event.type === 'conversation.bound') result.sessionId = event.conversationId;
      if (event.type === 'voice.state' && event.agent === 'thinking' &&
        result.speechEndClockMs !== undefined && result.speechEndToThinkingMs === undefined) {
        const elapsed = performance.now() - result.speechEndClockMs;
        if (elapsed < 0) throw new Error();
        result.speechEndToThinkingMs = elapsed;
      }
      if (event.type === 'audio.start') {
        receipt.start(event.turnId, event.responseId);
        response = { turnId: event.turnId, responseId: event.responseId };
        result.turnId = event.turnId;
      }
      if (event.type === 'audio.end') {
        if (!response || response.turnId !== event.turnId || response.responseId !== event.responseId)
          throw new Error();
        endSeen = true;
        // Audio may trail reliable data. Do not stop the decoder on this control alone.
        if (receipt.snapshot().firstAudioMs !== null) resolveEnd();
      }
      if (event.type === 'response.cancelled' || event.type === 'session.error' || event.type === 'session.ended') fail();
    } catch { fail(); }
  });
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (stopped) return;
    if (participant.identity !== agent) return;
    if (!(track instanceof RemoteAudioTrack) || reader) { fail(); return; }
    result.firstTrackSubscribedMs = performance.now() - started;
    reader = new AudioStream(track, { sampleRate: 24000, numChannels: 1 }).getReader();
    mediaTask = (async () => {
      while (!stopped && !signal.aborted) {
        const frame = await reader!.read();
        if (frame.done) { if (!stopped) fail(); break; }
        receipt.frame(frame.value.data, frame.value.sampleRate, frame.value.channels);
        Object.assign(result, receipt.snapshot());
        if (endSeen && result.firstAudioMs !== null) resolveEnd();
      }
    })().catch(() => fail());
  });
  room.on(RoomEvent.Disconnected, fail);
  room.on(RoomEvent.Reconnecting, fail);
  room.on(RoomEvent.TrackUnsubscribed, fail);
  room.on(RoomEvent.TrackSubscriptionFailed, fail);
  signal.addEventListener('abort', fail, { once: true });
```

Use P1b's named control packet limit once handed off by its owner; do not enlarge the hardcoded current ceiling or alter the shared contract here. A non-control topic is ignored; a purported control message from an unauthorized sender fails the run. Do not export message bodies or raw errors. A reconnect/track replacement invalidates this one-shot measurement instead of merging epochs.

- [ ] **Step 5 — Add native connect, real-time replay, confirmation, and cleanup.** Append:

```typescript
  const within = async <T>(promise: Promise<T>): Promise<T> => {
    let abort!: () => void;
    const aborted = new Promise<never>((_yes, no) => {
      abort = () => no(new Error('BENCHMARK_TIMEOUT'));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([promise, aborted]); }
    finally { signal.removeEventListener('abort', abort); }
  };
  const boundedClose = async (task: Promise<unknown> | undefined) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([task, new Promise<void>(yes => { timer = setTimeout(yes, 2000); })]);
    } finally { clearTimeout(timer); }
  };
  try {
    const connectTask = room.connect(session.livekit.url, session.livekit.participantToken).then(async () => {
      connected = true;
      if (stopped || signal.aborted) await disconnect();
    });
    // The retained handler also tears down a successful join that resolves after timeout.
    void connectTask.catch(() => undefined);
    await within(connectTask);
    if (stopped || signal.aborted || room.name !== session.livekit.roomName || !room.localParticipant)
      throw new Error('BENCHMARK_MEDIA_FAILED');
    const track = LocalAudioTrack.createAudioTrack('benchmark-input', source);
    await within(room.localParticipant.publishTrack(track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE })));
    await within(send({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }));
    await within(ready);
    result.setupMs = performance.now() - started;
    const inputStarted = performance.now();
    receipt.inputStarted(inputStarted, config.speechEndMs!);
    result.speechEndClockMs = inputStarted + config.speechEndMs!;
    result.maxInputLatenessMs = 0;
    for (let offset = 0, n = 0; offset < pcm.length; offset += 2560, n++) {
      if (stopped || signal.aborted) throw new Error('BENCHMARK_MEDIA_FAILED');
      const due = inputStarted + n * 80;
      await sleep(Math.max(0, due - performance.now()), undefined, { signal });
      const at = performance.now(), late = at - due;
      result.maxInputLatenessMs = Math.max(result.maxInputLatenessMs, late);
      if (late > 80) throw new Error('BENCHMARK_MEDIA_FAILED'); // no catch-up bursts
      const samples = new Int16Array(1280);
      const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      for (let j = 0; j < 1280 && offset + j * 2 + 1 < pcm.length; j++)
        samples[j] = view.getInt16(offset + j * 2, true);
      if (n * 80 <= config.speechEndMs! && config.speechEndMs! < (n + 1) * 80)
        result.speechEndFrameSubmittedMs = at - started;
      await within(source.captureFrame(new AudioFrame(samples, 16000, 1, 1280)));
      result.inputAudioMs! += 80;
    }
    await within(end);
    Object.assign(result, receipt.snapshot());
    // The callback must independently prove this exact turn settled durably.
    const confirmed = confirmDelivery ? await within(confirmDelivery(result, signal)) : false;
    if (!stopped && !signal.aborted && confirmed) {
      result.completed = true;
      result.outcome = 'completed';
      result.durableCompletionMs = performance.now() - started;
    } else {
      result.outcome = 'unverified';
      result.failureCode = 'BENCHMARK_UNPROVEN_PLAYBACK';
    }
  } catch {
    result.completed = false;
    result.outcome = signal.aborted ? 'timeout' : 'failed';
    result.failureCode = signal.aborted ? 'BENCHMARK_TIMEOUT' : 'BENCHMARK_MEDIA_FAILED';
  } finally {
    Object.assign(result, receipt.snapshot());
    signal.removeEventListener('abort', fail);
    stopped = true;
    source.clearQueue();
    // Never leave native work running after a Promise.race deadline.
    // A late connect completion also needs a bounded disconnect, below.
    await Promise.allSettled([
      reader?.cancel(), source.close(), disconnect(),
    ].map(task => boundedClose(task)));
    if (mediaTask) {
      // Releasing a reader lock with an outstanding read is unsafe; release only on settlement.
      void mediaTask.finally(() => reader?.releaseLock()).catch(() => undefined);
      await boundedClose(mediaTask);
    }
    room.removeAllListeners();
  }
}
```

`Promise.race` only bounds waiting; it does **not** cancel native connect/publish/capture. The retained connect handler and one disconnect promise prevent a late successful join from retaining its room or double-disconnecting the same join. Test that explicitly. If the pinned native SDK never settles an in-flight join, record cleanup as unproven and make the one-shot driver terminate its own benchmark child at the global deadline; never call cleanup successful merely because a timer won. Do not add retries.

Bounded cleanup waits clear their timers on prompt completion. Record a timeout/cleanup failure as incomplete; the two-second race is a waiting ceiling, not positive cleanup evidence. The parent driver retains the final process-exit evidence before calling resources released.

- [ ] **Step 6 — Route through the existing entry point.** After `result.acceptanceMs` in `runVoice`, add the following branch; keep outer `finally` and session DELETE unchanged. Set WS metadata immediately before its original socket branch.

```typescript
    if (config.transport === 'webrtc') {
      if (!session.livekit) {
        result.failureCode = 'BENCHMARK_TRANSPORT_MISMATCH';
        result.outcome = 'failed';
        return result;
      }
      const { runWebRtcVoice } = await import('./webrtc-voice.js');
      await runWebRtcVoice({ config, pcm, session, result, started, signal, confirmDelivery });
      return result;
    }
    if (session.livekit) {
      result.failureCode = 'BENCHMARK_TRANSPORT_MISMATCH';
      return result;
    }
    result.transport = 'websocket';
    result.firstAudioBoundary = 'ws-pcm-receipt-v1';
```

This avoids loading native FFI for old WebSocket/text/dry-run paths. A declared WebRTC run must fail on a legacy descriptor, never silently use WS. Both transport errors still DELETE only the admitted voice session. Existing PCM validation happens before either path opens paid resources.

- [ ] **Step 7 — Green and negative cases:** Run `npm test -- test/benchmark/webrtc-voice.spec.ts test/benchmark/voice-runner.spec.ts`. Extend the fake with individually failing scenarios: silent frames only, nonzero before `audio.start`, `audio.end` before decoded onset, wrong sender/session/epoch/sequence, second `audio.start`, wrong turn end, reconnect, unsubscribe, decoded EOF, two assistant tracks, invalid rate/channels, timeout during connect/capture/read, late connection resolution, durable callback false/rejected, output >180 s, pacing lag >80 ms. Every case must leave `completed !== true`, retain raw onset only when valid, close source/room/reader, and make zero `playback.progress` calls. A callback true test must explicitly assert it was invoked only after matching start/end and nonzero receipt; it is a synthetic external proof, not real headless playback evidence.
- [ ] **Step 8 — Commit boundary:** `feat(benchmark): add fail-closed headless LiveKit receipt path`. Include only the new adapter/test and agreed dispatch/type hunks.

### Task 3: Add transport/provenance config without widening live permissions

**Files:** Minimal additive changes to `backend/src/benchmark/runner.ts`; append to `backend/test/benchmark/runner.spec.ts`. Add output/provenance projection helpers to `voice-measurements.ts` and its tests, rather than exporting raw config objects.

- [ ] **Step 1 — Append a failing config regression.**

```typescript
it('selects transport explicitly while preserving old defaults and approval gates', () => {
  const base = { start: '2026-11-06T10:00:00Z', end: '2026-11-06T11:00:00Z', timeZone: 'Etc/UTC' };
  expect(benchmarkConfigSchema.parse(base).transport).toBe('websocket');
  const rtc = benchmarkConfigSchema.parse({ ...base, transport: 'webrtc', voiceOnly: true });
  expect(rtc.allowPaid).toBe(false);
  expect(rtc.allowCalendarData).toBe(false);
  expect(rtc.allowMutations).toBe(false);
  expect(blockedReason(scenarios(rtc).find(s => s.mode === 'voice')!, rtc, true))
    .toBe('paid-call-approval-required');
  expect(() => benchmarkConfigSchema.parse({ ...base, transport: 'auto' })).toThrow();
  expect(() => benchmarkConfigSchema.parse({ ...base, participantToken: 'private' })).toThrow();
});
```

- [ ] **Step 2 — Red:** `npm test -- test/benchmark/runner.spec.ts -t "selects transport explicitly"` must fail because the strict schema currently rejects transport.
- [ ] **Step 3 — Minimal schema additions.** Import `voiceProvenanceSchema` in `runner.ts`, insert `transport: z.enum(['websocket', 'webrtc']).default('websocket')` and optional `provenance: voiceProvenanceSchema.optional()` before `.strict()`. Add the optional `WireResult` fields from the frozen contract. Add this schema to `voice-measurements.ts` (and import `z` and `isCompactJwt`). No default fills unknown provenance with a verified value; keep all existing config validation and paid/data gates intact.

```typescript
import { z } from 'zod';
import { isCompactJwt } from '../contracts/voice-wire.js';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().regex(/^[A-Za-z0-9/_.:-]{1,128}$/)
  .refine(value => !isCompactJwt(value) && !value.startsWith('sk-') && !value.startsWith('Bearer'));
const nullablePositive = z.number().finite().positive().max(1000).nullable();
export const voiceProvenanceSchema = z.object({
  authorizationReference: label,
  sourceHash: sha256, buildHash: sha256, configurationHash: sha256,
  instructionHash: sha256, productKnowledgeHash: sha256,
  inputSha256: sha256, inputBytes: z.number().int().positive().max(65000 * 32),
  speechEndMs: z.number().finite().positive().max(60000),
  scenario: z.literal('voice-baseline'), freshConversation: z.literal(true),
  inputSampleRateHz: z.literal(16000), inputChannels: z.literal(1), inputFrameMs: z.literal(80),
  decodedSampleRateHz: z.literal(24000), decodedChannels: z.literal(1),
  codec: z.enum(['pcm16', 'opus']), rtpClockHz: z.literal(48000).nullable(),
  requestedPacketMs: nullablePositive, observedPacketMs: nullablePositive,
  resampling: z.enum(['none', 'rtc-native-16k-to-opus-and-opus-to-24k']),
  clientPlacement: label, backendPlacement: label, sfuPlacement: label,
  databasePlacement: label, providerRegion: label,
  rtcNodeVersion: label.nullable(), ffiVersion: label.nullable(),
  modelLabel: label, routingLabel: label, sttModel: label, ttsModel: label,
  endpointingHash: sha256, limitsHash: sha256,
  impairment: z.enum(['none', 'fixed-delay-jitter-loss-v1']),
  playbackBoundary: z.enum(['ws-simulated-24k-v1', 'unproven']),
}).strict();
```

Add a `projectVoiceProvenance(raw: unknown)` helper as the single export path:

```typescript
export function projectVoiceProvenance(raw: unknown) {
  const parsed = voiceProvenanceSchema.safeParse(raw);
  if (!parsed.success) throw new Error('BENCHMARK_PROVENANCE_INVALID');
  return parsed.data;
}
```

Construct the driver object explicitly rather than spreading bootstrap/session/SDK objects into it. Use P1's `redactSecrets` as defense in depth for human-readable messages, not to make arbitrary raw objects safe to export. The strict allowlist and generic errors are primary.

- [ ] **Step 4 — Test malformed and secret-bearing provenance before green.**

```typescript
it('rejects secret-shaped or unbounded metadata rather than exporting it', () => {
  for (const raw of [
    { participantToken: 'eyJhbGciOiJIUzI1NiJ9.private.signature' },
    { authorization: 'Bearer private' },
    { sourceHash: 'not-a-hash' },
    { backendPlacement: 'https://user:password@host/?token=private' },
  ]) expect(() => projectVoiceProvenance(raw)).toThrow('BENCHMARK_PROVENANCE_INVALID');
});
```

Also add this complete valid fixture and rejection test. It avoids a false-positive privacy test caused solely by absent required fields:

```typescript
const safeProvenance = () => ({
  authorizationReference: 'offline-fixture', sourceHash: '1'.repeat(64), buildHash: '2'.repeat(64),
  configurationHash: '3'.repeat(64), instructionHash: '4'.repeat(64), productKnowledgeHash: '5'.repeat(64),
  inputSha256: '6'.repeat(64), inputBytes: 183518, speechEndMs: 3734.9375,
  scenario: 'voice-baseline', freshConversation: true, inputSampleRateHz: 16000, inputChannels: 1,
  inputFrameMs: 80, decodedSampleRateHz: 24000, decodedChannels: 1,
  codec: 'opus', rtpClockHz: 48000, requestedPacketMs: null, observedPacketMs: null,
  resampling: 'rtc-native-16k-to-opus-and-opus-to-24k', clientPlacement: 'loopback-host',
  backendPlacement: 'loopback-host', sfuPlacement: 'loopback-host', databasePlacement: 'fixture-region',
  providerRegion: 'us', rtcNodeVersion: '1.2.1', ffiVersion: '0.13.1',
  modelLabel: 'anthropic/claude-haiku-5.5', routingLabel: 'default', sttModel: 'flux-general-en',
  ttsModel: 'flux-haley-en', endpointingHash: '7'.repeat(64), limitsHash: '8'.repeat(64),
  impairment: 'none', playbackBoundary: 'unproven',
});
it('accepts a full safe projection but rejects every extra secret field and token-shaped label', () => {
  expect(projectVoiceProvenance(safeProvenance()).inputBytes).toBe(183518);
  for (const key of ['participantToken', 'apiKey', 'apiSecret', 'authorization', 'uri',
    'transcript', 'audio', 'message', 'stack']) {
    expect(() => projectVoiceProvenance({ ...safeProvenance(), [key]: 'PRIVATE_FIXTURE' })).toThrow();
  }
  for (const backendPlacement of ['eyJhbGciOiJIUzI1NiJ9.eyJmb28iOiJiYXIifQ.c2lnbmF0dXJlMTIz',
    'https://user:password@host/?token=private']) {
    expect(() => projectVoiceProvenance({ ...safeProvenance(), backendPlacement })).toThrow();
  }
  expect(JSON.stringify(projectVoiceProvenance(safeProvenance()))).not.toMatch(/PRIVATE_FIXTURE|password|participantToken/);
});
```

- [ ] **Step 5 — Green:** `npm test -- test/benchmark/runner.spec.ts test/benchmark/voice-measurements.spec.ts`. No paid/data permission becomes true when transport changes. Re-run the old voice-only regression unchanged.
- [ ] **Step 6 — Commit boundary:** `feat(benchmark): record strict transport and nonsecret provenance`. Stage only agreed schema/type hunks and new/append-only tests.

### Task 4: Fresh, non-overwriting guarded driver and unchanged budget accounting

**Files:** Create `backend/src/benchmark/live-run-options.ts` and `backend/test/benchmark/live-run-options.spec.ts`. Minimal hunks in `live-baseline.ts` and the one-line clock change in `live-budget.ts`; append `live-budget.spec.ts`.

The research's example caps (640 frames/2400 characters) do not match the actual user's implementation. **Retain actual tested ceilings**: 16 capped model dispatches; 60000 context/6000 output tokens per dispatch; 60000 ms aggregate STT PCM; 4000 aggregate UTF-8 TTS bytes; 32 speech sockets; 900000 ms paid-active lifetime. Conservative provider reservation is `$0.99847` under its pinned rate envelope. Eight logical submissions are the driver/CLI envelope, distinct from 16 possible model dispatches. LiveKit traffic is not provider STT PCM accounting. No cost guarantee includes an unpriced cloud/TURN service; that requires a separate approved envelope in P8.

- [ ] **Step 1 — Write failing parser/output tests.**

```typescript
import { expect, it } from 'vitest';
import { parseLiveRunOptions, claimLiveOutput } from '../../src/benchmark/live-run-options.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

it('refuses exhausted/default approval and protects the historical directory', () => {
  expect(() => parseLiveRunOptions(['--live'])).toThrow('FRESH_APPROVAL_REQUIRED');
  for (const path of ['ws-live-2026-11-05', '../ws-live-2026-11-05', 'webrtc-live-x/../ws-live-2026-11-05']) {
    expect(() => parseLiveRunOptions(['--live', '--transport=webrtc',
      '--approval-reference=offline-fixture', `--output-name=${path}`])).toThrow();
  }
  expect(parseLiveRunOptions(['--live', '--transport=webrtc',
    '--approval-reference=offline-fixture', '--output-name=webrtc-live-2026-11-05-offline']))
    .toEqual({ transport: 'webrtc', approvalReference: 'offline-fixture',
      outputName: 'webrtc-live-2026-11-05-offline' });
});

it('claims only a new leaf and never overwrites existing evidence', async () => {
  const root = await mkdtemp('C:/Users/Peter/AppData/Local/Temp/opencode/p6-output-');
  try {
    const directory = await claimLiveOutput(root, 'webrtc-live-2026-11-05-offline');
    await writeFile(join(directory, 'sentinel.txt'), 'retain');
    await expect(claimLiveOutput(root, 'webrtc-live-2026-11-05-offline')).rejects.toThrow();
    expect(await readFile(join(directory, 'sentinel.txt'), 'utf8')).toBe('retain');
  } finally { await rm(root, { recursive: true }); } // only this test-created temp root
});
```

- [ ] **Step 2 — Red:** `npm test -- test/benchmark/live-run-options.spec.ts` fails on missing exports. These tests perform only private temporary filesystem work.
- [ ] **Step 3 — Minimal parser/output implementation.**

```typescript
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export function parseLiveRunOptions(args: string[]) {
  const transport = args.find(a => a.startsWith('--transport='))?.slice(12);
  const approvalReference = args.find(a => a.startsWith('--approval-reference='))?.slice(21);
  const outputName = args.find(a => a.startsWith('--output-name='))?.slice(14);
  if (!args.includes('--live') || !approvalReference ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(approvalReference) ||
    approvalReference === 'user-followup-2026-11-05') throw new Error('FRESH_APPROVAL_REQUIRED');
  if (transport !== 'webrtc' || !outputName || !/^webrtc-live-[A-Za-z0-9_-]{1,96}$/.test(outputName) ||
    args.length !== 4 || new Set(args).size !== 4 || args.some(a => a !== '--live' &&
      !a.startsWith('--transport=') && !a.startsWith('--approval-reference=') && !a.startsWith('--output-name=')))
    throw new Error('INVALID_LIVE_RUN_OPTIONS');
  return { transport, approvalReference, outputName } as const;
}
export async function claimLiveOutput(root: string, name: string) {
  if (!/^webrtc-live-[A-Za-z0-9_-]{1,96}$/.test(name)) throw new Error('INVALID_LIVE_RUN_OPTIONS');
  const directory = join(root, name);
  await mkdir(directory); // deliberately not recursive: exclusive leaf; EEXIST is fatal
  return directory;
}
```

The approval reference is provenance, **not proof the user authorized a run**. P8 must obtain actual fresh permission before invoking the driver. The driver parser replaces the exhausted implicit authorization rather than preserving a usable `--live` alias to it.

- [ ] **Step 4 — Apply only these driver changes.**

  1. Call `parseLiveRunOptions(process.argv.slice(2))` **before** `.env` loading, MongoClient construction, model catalogue reads, or any network call.
  2. Replace the fixed `directory = resolve('benchmark-results/ws-live-2026-11-05')`/mkdir pair with `await claimLiveOutput(resolve('benchmark-results'), options.outputName)`; replace historical authorization string with `options.approvalReference`; use a new `aurvin_voice_bench_webrtc_...` database name. Claim the output before remote work; a retained directory from failed preflight is evidence and must never be deleted to rerun.
  3. Preserve read-only source config access, isolated DB, exact model/provider/settings validation, source hash algorithm/path list, `budget.fetch(fetch)` and `budget.sockets(socketFactory)` composition, and one executor. Add fixed-asset/build hashes, safe version/placement metadata, and the full strict provenance object described above to `context.json` and generated CLI config. Read optional nonsecret placement labels from the exact ignored path `backend/benchmark-results/webrtc-context.local.json` (relative to repository root; the driver runs in `backend/`). Its strict object has only `clientPlacement`, `backendPlacement`, `sfuPlacement`, `databasePlacement`, `providerRegion`, and `routingLabel`, each using the safe `label` schema. If absent, fill each label with `unverified` and mark comparability blocked; never infer SFU location from a hostname. This sidecar is metadata, not a new config/auth platform.
  4. Generated config retains `voiceOnly:true`, one warmup + seven measured, 90000 ms/case, budget 1, false Calendar flags, original PCM path/marker, unchanged model and voice settings; add `transport:'webrtc'` and strict provenance. Hash/validate PCM bytes before any admission. Throw a generic prerequisite error on wrong hash/marker/size; do not silently regenerate or substitute it.
  5. Add child wall-clock deadline (900000 ms after launch), terminate only the driver's own CLI child on expiry, stop `LiveBudget`, and always close its isolated app/service. On Windows verify `child.kill()` actually ends the direct Node child; do not use a broad process-name kill or stop a user's backend. Snapshot budgets/pre/post source/build identity into retained artifacts even for failures. Existing guard's active deadline remains independent.
  6. Keep stdout/error projection; extend only the safe error-code allowlist for fresh-approval/output/preflight denials. Do not log raw file, database, JWT, signaling, or provider error strings. Add no live tests in this task.

For the clock-only budget hunk use `constructor(private readonly now: () => number = () => performance.now()) {}`. Do not refactor `LiveBudget`, change its counters, remove guard tests, silently raise its limits, or reinterpret a declared dollar ceiling as guaranteed invoice control.

- [ ] **Step 5 — Add boundary regressions to the existing budget test.**

```typescript
it('blocks at the exact monotonic active deadline without another outbound dispatch', async () => {
  let now = 0;
  const upstream = vi.fn<typeof fetch>(async () => new Response('{}'));
  const budget = new LiveBudget(() => now);
  try {
    await budget.fetch(upstream)(url, request());
    now = 900000;
    await expect(budget.fetch(upstream)(url, request())).rejects.toThrow('LIVE_BUDGET_DENIED');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(budget.snapshot().denial).toBe('LIVE_BUDGET_DENIED');
  } finally { budget.stop(); }
});
```

Add fake tests for the 33rd speech socket, UTF-8 multibyte TTS accounting at 4000 bytes, `stop()` revoking a retained HTTP/socket wrapper, and guard denial during WebRTC-driven server input. Reuse the existing `socket()` fixture. Prove rejection before forwarding and unchanged `$0.99847` conservative reservation; do not send synthetic LiveKit RTP into the Deepgram byte counter.

- [ ] **Step 6 — Green:** `npm test -- test/benchmark/live-run-options.spec.ts test/benchmark/live-budget.spec.ts`. After build, `node dist/benchmark/live-baseline.js` and `node dist/benchmark/live-baseline.js --live` must refuse **before env/network/database work**. Do not run an approved-shaped live invocation in P6.
- [ ] **Step 7 — Commit boundary:** `feat(benchmark): require fresh guarded WebRTC run identity`. Stage only new helper/test and approved user-file hunks; no old baseline docs or ignored evidence.

### Task 5: Export complete raw evidence and reject misleading comparisons

**Files:** Minimal `backend/src/benchmark/cli.ts` hunks; create `backend/src/benchmark/voice-comparison.ts` and `backend/test/benchmark/voice-comparison.spec.ts`; append measurement tests as needed.

- [ ] **Step 1 — Define a small explicit comparison input and failing tests.** Export `compareVoiceRuns` using the following exact normalized shape. This is an offline artifact DTO, not another runner/framework. CLI validation uses Zod strict objects for this shape, bounds records to 12, requires finite/null metric numbers, and rejects unknown fields.

```typescript
export type VoiceComparisonInput = {
  runId: string;
  mode: 'live' | 'dry-run';
  complete: boolean;
  repetitions: number;
  warmups: number;
  sourceHash: string;
  configurationHash: string;
  inputSha256: string;
  speechEndMs: number;
  environmentHash: string;
  firstAudioBoundary: string;
  playbackBoundary: string;
  records: Array<{ repetition: number; warmup: boolean; outcome: string;
    setupMs: number | null; speechEndToFirstAudioMs: number | null;
    speechEndToPlaybackEndMs: number | null; durableCompletionMs: number | null }>;
};
```

`environmentHash` covers **explicit** client/backend/database/provider placement, network profile, instructions/product hashes, scenario/fresh conversation, locale, model/routing, STT/TTS, endpointing/limits, input frame/rate/channel and decoded rate/channel. Exclude transport/codec/SFU-only fields from the matching hash, but retain those differences in full provenance/limitations. Any `unverified` matching field prevents a comparison input from being declared complete. Source hashes are required for identity but are not required equal: transport implementation necessarily changes source. Configuration and semantics matching hashes must be equal.

```typescript
import { expect, it } from 'vitest';
import { compareVoiceRuns, type VoiceComparisonInput } from '../../src/benchmark/voice-comparison.js';

function run(boundary = 'webrtc-decoded-nonzero-after-start-v1'): VoiceComparisonInput {
  return { runId: 'offline', mode: 'live', complete: true, repetitions: 3, warmups: 1,
    sourceHash: '1'.repeat(64), configurationHash: '2'.repeat(64),
    environmentHash: '3'.repeat(64), inputSha256: '4'.repeat(64), speechEndMs: 10,
    firstAudioBoundary: boundary, playbackBoundary: 'unproven',
    records: [999, 10, 20, 30].map((n, i) => ({ repetition: i, warmup: i === 0,
      outcome: 'success', setupMs: n, speechEndToFirstAudioMs: n,
      speechEndToPlaybackEndMs: null, durableCompletionMs: n })) };
}

it('does not manufacture a first-audio improvement across unlike transport boundaries', () => {
  const comparison = compareVoiceRuns(run('ws-pcm-receipt-v1'), run());
  expect(comparison.firstAudio).toMatchObject({ comparable: false,
    reason: 'incompatible-first-audio-boundary', deltaMs: null, deltaPercent: null });
  expect(comparison.setup).toMatchObject({ comparable: true, deltaMs: 0, deltaPercent: 0 });
});

it.each(['input', 'marker', 'configuration', 'environment', 'incomplete', 'missing-row',
  'duplicate-row', 'warmup', 'failed', 'missing-onset', 'nonfinite', 'dry-run'])
('rejects an unmatched or incomplete %s run', defect => {
  const baseline = run(), current = run();
  if (defect === 'input') current.inputSha256 = '5'.repeat(64);
  if (defect === 'marker') current.speechEndMs = 11;
  if (defect === 'configuration') current.configurationHash = '5'.repeat(64);
  if (defect === 'environment') current.environmentHash = '5'.repeat(64);
  if (defect === 'incomplete') current.complete = false;
  if (defect === 'missing-row') current.records.pop();
  if (defect === 'duplicate-row') current.records[2].repetition = 1;
  if (defect === 'warmup') current.records[0].warmup = false;
  if (defect === 'failed') current.records[2].outcome = 'timeout';
  if (defect === 'missing-onset') current.records[2].speechEndToFirstAudioMs = null;
  if (defect === 'nonfinite') current.records[2].setupMs = NaN;
  if (defect === 'dry-run') current.mode = 'dry-run';
  expect(() => compareVoiceRuns(baseline, current)).toThrow('BENCHMARK_RUNS_NOT_MATCHED');
});
```

- [ ] **Step 2 — Red:** `npm test -- test/benchmark/voice-comparison.spec.ts` fails on missing module/export.
- [ ] **Step 3 — Minimal comparison algorithm.** Validate at entry, then reuse summaries and calculate signed deltas `(after-before)`; negative is faster. Never produce a percentage for baseline zero, or any delta when boundaries mismatch.

```typescript
import { z } from 'zod';
import { summarizeVoiceMetric } from './voice-measurements.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const elapsed = z.number().finite().nonnegative().max(900000).nullable();
export const voiceComparisonInputSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), mode: z.enum(['live', 'dry-run']),
  complete: z.boolean(), repetitions: z.number().int().min(1).max(10),
  warmups: z.number().int().min(0).max(2), sourceHash: hash, configurationHash: hash,
  inputSha256: hash, speechEndMs: z.number().finite().positive().max(60000), environmentHash: hash,
  firstAudioBoundary: z.enum(['ws-pcm-receipt-v1', 'webrtc-decoded-nonzero-after-start-v1']),
  playbackBoundary: z.enum(['ws-simulated-24k-v1', 'unproven']),
  records: z.array(z.object({ repetition: z.number().int().min(0).max(11), warmup: z.boolean(),
    outcome: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), setupMs: elapsed,
    speechEndToFirstAudioMs: elapsed, speechEndToPlaybackEndMs: elapsed,
    durableCompletionMs: elapsed }).strict()).max(12),
}).strict();

const validNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
function completeRun(run: VoiceComparisonInput) {
  const expected = run.repetitions + run.warmups;
  return run.mode === 'live' && run.complete && run.repetitions >= 1 && expected <= 12 &&
    run.records.length === expected && run.records.every((row, index) =>
      row.repetition === index && row.warmup === (index < run.warmups) && row.outcome === 'success' &&
      validNumber(row.setupMs) && validNumber(row.speechEndToFirstAudioMs) && validNumber(row.durableCompletionMs));
}
export function compareVoiceRuns(before: VoiceComparisonInput, after: VoiceComparisonInput) {
  if (!voiceComparisonInputSchema.safeParse(before).success ||
    !voiceComparisonInputSchema.safeParse(after).success || !completeRun(before) || !completeRun(after) ||
    ['configurationHash', 'environmentHash', 'inputSha256', 'speechEndMs', 'repetitions', 'warmups']
      .some(key => before[key as keyof VoiceComparisonInput] !== after[key as keyof VoiceComparisonInput]))
    throw new Error('BENCHMARK_RUNS_NOT_MATCHED');
  const metric = (name: string, comparable: boolean, reason: string | null) => {
    const a = summarizeVoiceMetric(before.records, name), b = summarizeVoiceMetric(after.records, name);
    const deltaMs = comparable && a.p50Ms !== null && b.p50Ms !== null ? b.p50Ms - a.p50Ms : null;
    const p95DeltaMs = comparable && a.p95Ms !== null && b.p95Ms !== null ? b.p95Ms - a.p95Ms : null;
    return { comparable, reason, before: a, after: b, deltaMs,
      deltaPercent: deltaMs !== null && a.p50Ms !== 0 ? deltaMs * 100 / a.p50Ms! : null,
      p95DeltaMs, p95DeltaPercent: p95DeltaMs !== null && a.p95Ms !== 0 ? p95DeltaMs * 100 / a.p95Ms! : null };
  };
  const same = before.firstAudioBoundary === after.firstAudioBoundary;
  const samePlayback = before.playbackBoundary === after.playbackBoundary && before.playbackBoundary !== 'unproven';
  return { firstAudio: metric('speechEndToFirstAudioMs', same, same ? null : 'incompatible-first-audio-boundary'),
    setup: metric('setupMs', true, null),
    durable: metric('durableCompletionMs', samePlayback, samePlayback ? null : 'durable-timing-includes-playback-boundary'),
    limitations: ['Nearest-rank p95 is exploratory for this small sample; it is not a stable tail estimate.',
      'Matching input does not eliminate provider routing/cache variability or prove a transport-caused gain.',
      'No headless field measures browser/device audibility.'] };
}
```

Use the exported DTO and the known boundary enums above; arbitrary equal strings cannot establish comparability. Do not add a statistical significance claim or overall `improved:true` field. A later upstream boundary must be explicitly added with its tests; never make the enum an unrestricted string to get a run through.

- [ ] **Step 4 — Extend existing CLI output additively.**

  1. On a WebRTC config require the output root's leaf to match `webrtc-live-*` or be its `runs` child; reject traversal/reparse/symlink targets into the historical baseline. Use `realpath` on existing ancestors and compare canonical directory containment, not a substring match. Reserve the new UUID leaf with non-recursive `mkdir`; keep after-case writes inside that leaf only. Never open any old baseline file for writing.
  2. Before paid execution require valid strict provenance and the original PCM hash/marker. Dry-run does not open .env/database/server and still makes zero network calls; mark evidence kind `dry-run` and `complete:false`.
  3. Project provenance explicitly, preserve pseudonymized raw records/timelines and their existing failures. Add per-metric summaries through `summarizeVoiceMetric`, separate first receipt and playback end, and leave unproven playback null. `summary` must not turn missing playback time into whole-operation latency.
  4. Tighten `confirmDelivery` in the existing voice callback: terminal and delivery-settled must match `hashId(pending.turnId)` and the admitted voice session where supplied, not just pass session-level `correlate`. Preserve missing/failed evidence as unverified. Neither `audio.end` nor a foreign turn's terminal can make the exported case successful.
  5. Compute `complete` from expected execution counts, warmup flags and successful evidence, not from a mutable default. Keep failure-induced repetition stopping and live exit 2. Output both `results.json` and a **derived** `comparison-input.json` only when identity/config/provenance is valid; incomplete inputs still carry `complete:false` so offline comparison refuses them. Include nulls and failed raw samples instead of omitting them.
  6. Append `voiceMetrics`, boundary explanations, and provenance identity to the existing `report.md`; preserve its text/tool coverage. New WebRTC received-onset values are descriptive only while completion is unproven.

For the completion callback's shared check, append this helper to `runner.ts`, import it into `cli.ts`, and replace the existing loose `settled` predicate with `isVoiceDeliveryConfirmed(events, pending)`. Keep its existing bounded polling and stop on a matching error settlement without retrying inference:

```typescript
export function isVoiceDeliveryConfirmed(events: Evidence[], wire: WireResult): boolean {
  if (!wire.turnId || !wire.voiceSessionId) return false;
  const turn = hashId(wire.turnId), voice = hashId(wire.voiceSessionId);
  const rows = events.filter(event => event.turnId === turn &&
    (event.kind !== 'voice-pipeline' || event.sessionId === voice));
  return rows.some(event => event.stage === 'delivery-settled' && !event.code) &&
    rows.some(event => event.stage === 'terminal' && event.chat === 'completed') &&
    !rows.some(event => event.stage === 'delivery-settled' && event.code ||
      event.stage === 'terminal' && event.chat !== 'completed');
}
```

Append the concrete negative test to `runner.spec.ts` and add `isVoiceDeliveryConfirmed` to its existing imports:

```typescript
it('does not confirm delivery from another turn in the same voice session', () => {
  const wire = { voiceSessionId: 'v', turnId: 't', durationMs: 1,
    firstTextMs: null, acceptanceMs: null, outcome: 'failed' };
  const settlement = { kind: 'voice-pipeline', sessionId: hashId('v'), turnId: hashId('t'),
    stage: 'delivery-settled' };
  const terminal = { kind: 'process', turnId: hashId('other'), stage: 'terminal', chat: 'completed' };
  expect(isVoiceDeliveryConfirmed([settlement, terminal], wire)).toBe(false);
  expect(isVoiceDeliveryConfirmed([settlement, { ...terminal, turnId: hashId('t') }], wire)).toBe(true);
  expect(isVoiceDeliveryConfirmed([{ ...settlement, code: 'VOICE_DELIVERY_UNKNOWN' },
    { ...terminal, turnId: hashId('t') }], wire)).toBe(false);
});
```

- [ ] **Step 5 — Add offline CLI regressions.** Run `npm run build` before exercising built children; spawn only **dry-run** CLI children using temporary config/output under the approved temp root, with a deliberately unreachable loopback base URL and no `--live`. Assert zero successful samples, `complete:false`, null audible/scheduling values, voice-only inventory, strict metadata rejection, and unchanged baseline sentinel bytes. Add injected/synthetic evidence tests for a foreign terminal and a missing delivery-settled pair; reject success. No offline test may import and execute the live driver's `main`.
- [ ] **Step 6 — Add comparison CLI entry.** Invocation is `node dist/benchmark/voice-comparison.js <before-comparison-input.json> <after-comparison-input.json> <new-output-directory>`. Read at most 1 MiB per input, strict-parse both, use `compareVoiceRuns`, refuse an existing output directory, and write `comparison.json`/`comparison.md` with generic errors on invalid inputs. Guard `main` with `fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')` so imports in Vitest do not execute it. Do not support URLs, providers, subprocesses, or a `--force` flag.
- [ ] **Step 7 — Green:** `npm test -- test/benchmark/voice-comparison.spec.ts test/benchmark/voice-measurements.spec.ts test/benchmark/runner.spec.ts test/benchmark/voice-runner.spec.ts test/benchmark/webrtc-voice.spec.ts`. Add fixtures proving signed p50/p95 deltas, baseline-zero percentage null, different source hash allowed with recorded identity, same source hash not enough to override different input/settings, and unlike playback boundaries refusing durable/playback deltas.
- [ ] **Step 8 — Commit boundary:** `feat(benchmark): reject incomplete and boundary-incompatible latency comparisons`.

### Task 6: P8 runbook, browser/impairment procedure, and offline verification

**Files:** Create `docs/voice-latency-benchmark/webrtc-methodology.md`. Do not edit historical baseline reports. An optional one-line link in the user-modified README requires owner agreement; the new document can stand alone without it.

- [ ] **Step 1 — Write the runbook from the exact interfaces below.** Copy the invocation, output layout, metric/budget definitions, no-fallback rules, and limitations; link the immutable baseline and current workflow goal/state. State that P6's code/tests provide no measured latency or deployment approval. The offline suite is not browser, FFI/media connectivity, provider performance, or audible evidence.
- [ ] **Step 2 — Document the legacy comparison boundary.** The retained WS `results.json` is schema 1 and has no new comparison DTO. P8 must retain it unchanged and produce a **new sidecar** in the new P8 evidence directory, deriving counts/metrics from raw rows and input/config identities from its original `context.json`, PCM/manifest, provenance audit, and saved source/build evidence. Do not fill unavailable legacy matching fields from today's checkout. If old configuration/asset/environment identity cannot be established, emit `complete:false` in that sidecar and report comparison blocked. Old `latency-summary.json` or rounded report values alone are insufficient comparison inputs.
- [ ] **Step 3 — Add these browser/impairment instructions (procedures only).**

  - Match both transports using separate preserved builds/checkouts; do not revert current user work or run overlapping database executors. Use the same fixture/rates, model/routing, endpointing, fresh conversation, counts, device/browser/output route, and placements. Record permission/unlock and cold/warm state separately from setup.
  - For **actual audibility**, route the consented synthetic input plus calibrated acoustic or device-loopback output into one observation clock. Detect last input waveform and first output waveform/stop on that same clock; log calibration latency, resolution, threshold, noise floor, browser/OS/device versions, and method. UI `playing`, track `attach`, server TTS, or decoded onset is not an audible event. Retain only consented synthetic artifacts/derived timing; never record private microphone speech or reply content by default.
  - For interruption, use one documented synthetic interruption marker at a fixed time after observed assistant onset; measure actual output disappearance and continued absence for 1000 ms, including no stale tail after cancellation. Label explicit client interrupt versus Flux-detected barge-in separately. Do not mix them into one percentile.
  - Fixed profile `none`: no injected impairment. Proposed profile `fixed-delay-jitter-loss-v1`: bidirectional added 50 ms one-way delay, ±10 ms jitter, independent 1% packet loss; no bandwidth cap/reordering. These are **requested injector settings**, not measured network properties. Record tool/version/seed/affected link and verify actual imposed profile with independent probes. Apply to the same browser/client↔media endpoint link for both WS and WebRTC; record SFU↔bridge unmodified placement. If a tool cannot apply matching semantics to TCP WS and UDP RTP, mark the profile incompatible, not equivalent.
  - Obtain approval for the specific impairment tool/privileges/interface before use. No P6 installation, adapter reset, firewall change, proxy deployment, TURN change, or network impairment is authorized. Always restore operator network settings and verify restoration. A browser-only DevTools HTTP throttle is not proof of UDP WebRTC loss/jitter.
  - Use the same approved repeats/warmup policy for both paths, keep impaired samples separate from unimpaired, preserve timeouts/failures, and qualify small p95. Browser/interruption/impairment submissions need their own finite allocation; do not squeeze them invisibly into or beyond the eight-turn headless approval.

- [ ] **Step 4 — Run final offline checks from `backend/` in this order.** Build first so offline child-CLI checks do not execute stale `dist`; record actual counts and failures/warnings rather than repeating historical pass counts.

```powershell
npm run build
npm test -- test/benchmark/voice-measurements.spec.ts test/benchmark/webrtc-voice.spec.ts test/benchmark/voice-comparison.spec.ts test/benchmark/live-run-options.spec.ts test/benchmark/runner.spec.ts test/benchmark/voice-runner.spec.ts test/benchmark/live-budget.spec.ts
npm run test:benchmark
npm run build
npm run lint
```

Then execute only the no-argument and exhausted-argument driver refusal checks, and the temp-output dry-run/comparison fixture checks. No LiveKit server, devices, native join, database, paid inference, Calendar, or remote catalogue call may occur. Inspect the safe output for known fixture secrets; assert baseline PCM/hash/reports/raw evidence unchanged. Documentation checks resolve local links, confirm commands match `backend/package.json`, and confirm no P8 report is claimed to exist. Ask the orchestrator to run its ordinary scoped whitespace/status checks when it serializes commits; this planner does not run Git.

If unrelated pre-existing build/lint failures occur, report exact paths/diagnostics and route them to their owner; do not alter unrelated source or call P6 verified while P6 failures remain. Native/built-browser/live suites are **unrun** in P6; unified review is **skipped**, not passed.

- [ ] **Step 5 — Commit boundary:** `docs(benchmark): document WebRTC measurement boundaries and P8 gates`. Stage only methodology and approved P6 test corrections; no generated evidence or secrets.

## Exact P8 interface handoff

### Invocations (future; not run by P6)

Run from `backend/`, only after P8's renewed authorization and assembled P5/P7 prerequisites:

```powershell
npm run test:benchmark
npm run build
node dist/benchmark/live-baseline.js --live --transport=webrtc --approval-reference=P8-2026-11-05-approved --output-name=webrtc-live-2026-11-05-p8-01
```

`P8-2026-11-05-approved` is an illustrative reference identifier, **not an actual approval**. P8 substitutes the real reference/date and a fresh output name. Reusing a name must fail. An onset-only/unproven run is incomplete/exit 2 and stops subsequent repetitions; do not automatically rerun or turn on simulated progress. Resolve the P1b/P3 proof contract and obtain supported actual playback evidence before expecting eight successful terminal samples.

For the existing CLI against an already approved loopback backend, use an ignored nonsecret full config with `transport:'webrtc'`, `voiceOnly:true`, original PCM/marker, strict provenance, false Calendar flags, and a fresh `webrtc-live-*` root, then `npm run benchmark -- benchmark.local.json --live`. **This client-only route does not inject `LiveBudget` into the backend.** It is not the approved guarded path unless the operator proves the same server egress guard/accounting is installed; use the driver above for P8's bounded provider run. Never start another executor against an active application database.

Offline comparison, once P8 has valid normalized sidecars:

```powershell
node dist/benchmark/voice-comparison.js benchmark-results/webrtc-live-2026-11-05-p8-01/legacy-ws-comparison-input.json benchmark-results/webrtc-live-2026-11-05-p8-01/runs/RUN_ID/comparison-input.json benchmark-results/webrtc-live-2026-11-05-p8-comparison-01
```

Replace `RUN_ID` with the UUID actually printed by the existing CLI. No glob that selects an arbitrary latest run. Incompatible first-audio boundaries must still emit null first-audio deltas even if setup is comparable. Incomplete/missing legacy evidence must refuse the comparison rather than produce a win.

### Output layout

```text
backend/benchmark-results/webrtc-live-<date>-<unique-name>/
  context.json                 # pre/post source/build identity, settings, SDK/placement, approval ref
  benchmark.json               # nonsecret generated config, explicit transport/provenance
  server.jsonl                 # existing allowlisted projected telemetry only
  readiness.json
  readiness.jsonl
  client.log                   # generic safe status lines, no native/raw errors
  client-status.json           # exit/deadline/failure recorded
  budget.json                  # same LiveBudget counters/denial/conservative ceiling
  runs/<run-id>/results.json   # every attempted sample, warmups, failures, raw metrics, provenance
  runs/<run-id>/report.md
  runs/<run-id>/comparison-input.json
```

P8 may add `accounting.json`, `safety-check.json`, legacy normalization sidecar, and new actual measurement reports/evidence in its owned paths. P6 does not invent observed accounting or write `docs/live-voice-webrtc/comparison.md`/`verification.md`. All generated output remains ignored/private. No output goes into `ws-live-2026-11-05`.

### P8 must authorize/establish explicitly

1. Local LiveKit server versus user-supplied cloud target; any installation/provisioning, signaling/media/TURN access, known SFU↔bridge placement and infrastructure cost. P6 has not started/provisioned anything.
2. Fresh provider spend/submission/time envelope: proposed eight logical submissions (1 warmup + 7 measured), concurrency one, 90000 ms/case, 900000 ms active/global child limit, at most 16 model dispatches, pinned tariff reserve ≤$1 plus separately approved infrastructure costs. Existing eight-submission approval is exhausted. Validate current catalogue/pricing/settings before any inference; unknown accounting or guard denial stops work.
3. Safe read-only config access and generated isolated database writes/index setup; exactly one executor per database, no application database cleanup, no overlapping backends. Credentials stay server-side/private process memory.
4. Original input hash/marker and matching model/routing/config/assets/host/provider/database/environment provenance; retained baseline raw artifacts, not rounded report numbers alone. Record mismatches, source drift, and irrecoverable baseline gaps honestly.
5. Separate bounded browser/device/synthetic audio consent, true audible/interruption observation, and fixed impairment target/tool/privileges/repeats/cleanup. No real audible/network claim from Node mocks or decoded receipt.
6. Supported P1b/P3 playback proof semantics. Without them, headless onset can be observed but whole-turn completion and comparable successful-run summaries remain unproven; no invented progress or limit increase.

## P6 exit gate and self-check

- [ ] Explicit WebRTC path publishes original synthetic PCM at 16 kHz/mono/80 ms with zero-padded final frame, preserves fractional speech-end marker, records lateness, and never silently falls back to WS.
- [ ] SDK fake tests prove `AudioStream(track, { sampleRate:24000, numChannels:1 })`, start-plus-nonzero gate, one trusted response/epoch, silence/reordering/failure distinctions, finite teardown and no unearned progress/completion.
- [ ] All duration calculations tested with a monotonic clock; wall-clock jumps cannot alter latency/guard elapsed time. No client/server monotonic subtraction.
- [ ] Existing nearest-rank utility reused; raw warmups/failures retained; missing metrics unavailable; incomplete/unmatched comparisons rejected; different boundaries cannot manufacture improvement.
- [ ] Strict provenance includes PCM/marker, codec, rate/resampling/packetization unknowns, placements, SDK/FFI, source/build/config/assets, samples/settings and failures without secrets or payloads.
- [ ] Existing egress guards/limits, no-tool scenario, isolated runtime ownership, dry-run behavior, and no-retry policy retained and tested.
- [ ] New `webrtc-live-*` outputs only; overwrite/traversal/symlink guards verified; historical report/raw/PCM bytes unchanged.
- [ ] Focused backend tests, `npm run test:benchmark`, build and lint have actual outcomes; warnings/skips/foreign failures reported separately. No live run performed.
- [ ] P8 receives exact invocation/output/comparison interfaces and explicit unresolved headless proof/baseline equivalence limitations. Required browser/live/impairment evidence is unrun or blocked, never fixture-certified.
- [ ] Worker reports agreed file hunks, atomic commits, test counts, and handoffs to the orchestrator. Unified review remains **skipped**; P6 completion is not P8 measurement or workflow completion.

Plan self-check: maps the P6 scope/exit gate in `state.md` to Tasks 1–6; preserves the existing user's driver/guard rather than replacing it; makes the research-versus-actual guard discrepancy explicit; excludes all paid/provisioning work; and treats unavailable playback/legacy boundary proof as a real limitation instead of an artificial success.
