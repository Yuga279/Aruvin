# Application Assembly and Live-only Cutover (P5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble P2 admission, P3 media, and the P4 browser contract into Aurvin's existing application owner; admit live audio only over LiveKit/WebRTC while preserving dictation, text, durable evidence, and finite shutdown.

**Architecture:** AppService supplies one LiveKit admission port and a lazy bridge connector to its existing VoiceSessionService. The bridge opens the existing LiveFlow/AgentVoiceAdapter composition only after a valid Room `session.start`; P2 remains the sole session/reservation/revocation owner and OperationsService remains the sole persistence-close owner. Readiness is passive configuration/observed-failure reporting, not an SFU or paid provider probe.

**Tech Stack:** Existing TypeScript ESM/NodeNext, NestJS, Vitest, `livekit-server-sdk`, `@livekit/rtc-node`, P1/P1b wire guards, existing Flux/Nova adapters and LangGraph runtime. No dependency changes.

---

## Execution boundary and planning provenance

- This is **P5 only**, not a new voice platform or a P8 verification plan. Use `executing-plans`, TDD, and `systematic-debugging` during implementation. No nested agents are necessary. Review remains **skipped**, not passed.
- Read fully for this planning: root `AGENTS.md`, [goal.md](goal.md), [research.md](research.md), [state.md](state.md). Read the relevant interface, lifecycle, implementation and downstream-handoff sections of [plan1.md](plan1.md), [plan1b.md](plan1b.md), [plan2.md](plan2.md), [plan3.md](plan3.md), and [plan4.md](plan4.md), and inspect their actual implementations. Actual source wins over illustrative/stale research signatures.
- User-supplied source provenance: P2 `40f1c97`, P3 `af62c58`, P4 `2740cbb`; benchmark tooling `24a3382`. This planner did **not** independently verify those commits or Git status: the assignment also expressly forbids running Git commands. The orchestrator must check current status/source identity before committing this plan and before authorizing the worker. Do not mistake the old holding gate in state.md for a new execution result.
- Planner writes only this file, uncommitted. The commands below are **future worker commands**, not commands run during planning. Stage/commit only after the orchestrator serializes access to the shared index.
- No provisioning, real SFU/provider connections, external network tests, `.env` reads, credentials, auth changes, deployment, or paid benchmarks. HTTP/WebSocket e2e traffic is loopback to an injected Nest fixture only. Never modify `backend/src/benchmark/**`, `backend/test/benchmark/**`, or `docs/voice-latency-benchmark/**`.
- All new code/test files need the mandatory FILE/LOCATION/PURPOSE/ROLE/KEY COMPONENTS header. Keep `.js` local import specifiers. Existing headers must describe changed responsibilities; preserve unrelated Calendar, configuration, HTTP and runtime code.
- Read-only documentation check: Context7 `/websites/livekit_io`, [LiveKit data packets](https://docs.livekit.io/transport/data/packets/), 6 November 2026, confirms reliable packets are ordered **best effort**, not buffered for disconnected receivers. Application epochs, finite rejoin and durable completion remain necessary. This lookup made no SFU/provider connection.

## File map before implementation

P5 may modify:

- `backend/src/app.service.ts`: admission/bridge ports, one existing voice composition, lifecycle callback wiring, cleanup uncertainty latch, passive LiveKit degradation.
- `backend/src/app.module.ts`: **normally no change**; retain its existing factory returning `service.voiceSessions`. Do not register a second VoiceSessionService, AppService, runtime, RTC worker, or shutdown owner.
- `backend/src/voice/transport/voice.gateway.ts`: dictation-only admission at the public WebSocket boundary.
- `backend/src/voice/transport/voice-connection.ts`: update its public-boundary documentation only unless a dictation regression identifies a necessary change. Do not rewrite generic sink/framing code merely because the public live route moves.
- `backend/src/operations/readiness.ts`: account for requested live mode lacking LiveKit in both snapshot and legacy branches, independently of text admission.
- `backend/src/operations/options.ts`, `operations.service.ts`: synchronous voice admission stop and concurrent bounded voice/runtime drain under the existing deadline.
- `backend/test/assembly/voice-bootstrap.e2e-spec.ts`: repair the P2 fixture handoff and replace its four obsolete live-WebSocket scenarios with actual AppService + fake RTC scenarios; add lifecycle/durability/fault tests here.
- Create `backend/test/assembly/voice-livekit-fixture.ts`: a small assembly-local adapter around **existing** P3 RTC fakes and real P2 token minting with a fake room service. No new test framework.
- `backend/test/voice/transport/gateway.spec.ts`, `gateway.integration.spec.ts`: negative public live routing and unchanged dictation behavior; relocate public live expectations to the assembly suite.
- `backend/test/operations/voice-readiness.spec.ts`, `voice-shutdown.spec.ts`: passive status and stop/drain ordering.

Read-only: all P1 contracts/config/manifests, P2 session/admission source/tests, P3 bridge/flow/agent/provider/usage source/tests, P4 frontend source/tests, P8 integration directories. An upstream defect is a handoff below, **not** permission to write those files.

## Exact consumed interfaces and source corrections

### P2 admission/session owner

`backend/src/voice/session/voice-session.options.ts` currently exports:

```typescript
type SessionContext = {
  identity: ResolvedIdentity;
  response: CreateVoiceSessionResponse;
  reservation: ExecutionReservation | null;
  voiceConfig: RuntimeConfigSnapshot['voice'];
  configSnapshot: RuntimeConfigSnapshot | null;
  livekitTicket?: LiveKitAdmissionTicket | null;
  assertPaidWork?(): void;
};
// Relevant VoiceSessionOptions members:
// livekit?: LiveKitAdmissionPort;
// open(context, sink, signal): Promise<VoiceFlow>;
// openLiveBridge?(context, ticket): Promise<{ close(): Promise<void> } | void>;
```

- `LiveKitAdmission` implements `LiveKitAdmissionPort.issue`, `teardownRoom`, optional `evictParticipant`; inject a fake RoomServiceClient in tests, not a fake production allow-all policy. `issue` is local signing; teardown/revocation would use network without injection.
- `LiveKitAdmissionTicket` contains browser `transport`, server-only `agentIdentity`/`agentToken`, `expiresAtMs`, `ttlSeconds`. Only `ticket.transport` enters the POST response; `SessionContext.livekitTicket` never enters controls, readiness, logs, or browser config.
- `VoiceSessionService.issue(entry)` sets `entry.livekitTicket` and `entry.response.livekit`, then awaits `options.openLiveBridge(entry, ticket)` **before returning** browser credentials. It stores the returned handle in additive `entry.livekitCleanup`; `entry.cleanup` is a separate legacy connection hook. Install **one**, not both, for the bridge.
- `claimLive(sessionId, participantIdentity?, roomName?)` synchronously consumes the join ticket, clears its timer, checks identity/epoch/admission, and changes `created`/`reconnecting` to `active`. Call it on the first valid `session.start` reaching the bridge's `open`, **not** while POST is still issuing the bridge. A resumed paid flow in the same epoch must not claim again.
- `disconnected(binding, true)` retains the original reservation/admission, sets a finite `limits.reconnectMs` deadline, waits prior cleanup and calls usage-disconnected. Repeated create with the same key rotates the epoch once, evicts the previous participant and opens a replacement. `end`, terminal `stop`, expiry `sweep`, and `drain` own room revocation and release.
- `VoiceBinding` adds `state`, `deadline`, `creating`, `cleanup`, `livekitCleanup`, `warning`, `pause`, `terminal`, and `stopping`. The hook's declared context is narrower than its actual argument: source `issue(entry)` passes the registry **entry itself**. A single local `context as VoiceBinding` is acceptable here only with the strict identity regression below; never construct/copy another binding. Request a P2 type refinement if that identity changes.

### P3 media/flow

```typescript
// backend/src/voice/transport/livekit-media.ts
type LiveKitFlow = Pick<LiveFlow,
  'start' | 'input' | 'control' | 'close' | 'suspendInput' | 'resumeCapture'>;
type LiveKitMediaOptions = {
  context: SessionContext;
  ticket: LiveKitAdmissionTicket;
  open(context: SessionContext, sink: VoiceSink, signal: AbortSignal): Promise<LiveKitFlow>;
  ended(reason: 'completed' | 'cancelled' | 'error'): Promise<void>;
  disconnected(recoverable: boolean): Promise<void>;
  observe?(observation: VoiceObservation): void;
};
// LiveKitMediaBridge.connect(options): Promise<LiveKitMediaBridge>
// bridge: outputSamples(), event(payload), audio(ref, pcm), invalidate(ref),
// watermark(ref), finish(reason), pause(code, recoverable?), control(event), dispose()
```

- `connect` owns one native Room/output source/track. Provider opening is deferred to valid reliable controls. `dispose` is local, idempotent and does **not** release reservations, delete rooms, close the database or notify lifecycle callbacks itself.
- `VoiceSink` is `outputSamples/event/audio/invalidate/finish/pause?`, not research's `send/close`. `audio` is synchronous. Keep existing provider wrappers and `openVoice`; no second runtime/AgentVoiceAdapter pipeline.
- `openVoice` currently returns `Promise<VoiceFlow>`. The live bridge needs the two extra quiet hooks. Narrow the actual returned `LiveFlow` at the single live callback, with an executable invariant; do not cast a generic fake dictation flow into `LiveKitFlow` or duplicate accounting/provider construction.
- Forward warnings through `event`, policy pause through `pause`, terminal shutdown through `event`; return `{ close: () => bridge.dispose() }` to P2. P3 already handles audio invalidation and controls; P5 does not decode PCM or infer turns.

### P4 browser/portable response

- `POST /api/voice/sessions` live response must satisfy `isLiveKitVoiceSessionResponse`: `mode: 'live'`, session/epoch-bound `livekit: { url, roomName, participantIdentity, participantToken }`, original `expiresAt`, limits and audio settings. Transitional `websocketUrl: '/api/voice'` is still present but **not a live fallback**.
- Dictation response has no `livekit` and has `effectiveAudioSettings.output === null`; dictation retains cookie admission and binary PCM WebSocket framing.
- P4 sends `session.start` at sequence **0**, matching epoch, `mode: 'live'`, `audioSettings: INPUT_AUDIO`. Server sends `session.ready` before listening state. Controls/progress/interrupt/end use reliable Room data on `LIVEKIT_CONTROL_TOPIC` (`aurvin.voice.control`), not a parallel socket.
- P1b `VoiceControlReassembler` / `encodeVoiceControlPackets` retain 15 KiB packet bounds and legal large envelopes. Preserve `audio.watermark` and `proof: 'proven' | 'unproven'`; publication/final watermark is not durable completion. Do not add private fields or relax parsers.
- P4 reauthorization uses the same HTTP request/idempotency key, a newer epoch, and the same bound conversation. `playedSamples` is the absolute 24 kHz session coordinate; `playedMs` is progress, `playbackPositionMs` is interruption. No P5 frontend edits.

### Explicit upstream handoffs discovered by tracing assembly

These are **source-observed risks, not freshly executed failing-test results**. Send reproductions to the orchestrator at worker start; require upstream failing/passing checks and committed signatures before consuming a change. Do not dispatch a reviewer.

1. **H1 — P2, non-consuming dictation claim (blocks Task 3):** current `claim(cookie, origin)` also accepts a live ticket and changes its entry to `active`. Rejecting only after claim would consume live admission and disable its expiry timer. Request an optional third parameter `expectedMode?: 'dictation'`, checked after locating/validating the entry but **before** `assertPaidWork`, ticket consumption or timer/state mutation. Existing two-argument fixture callers remain compatible. Reproduce: create live, call `claim(cookie, origin, 'dictation')`, expect `VOICE_BINDING_MISMATCH`; then `claimLive(...)` must still succeed. New public gateway uses the third parameter only after P2 commits it. This request is not a claim that the current signature supports it.
2. **H2 — P3, terminal controls while paused (blocks policy/end acceptance):** `LiveKitMediaBridge.control` checks `paused` before `session.end`, so end is ignored after quota/duration/provider pause. Request `session.end` be handled before the paused early return, including after an unsuccessful initial provider handshake. Reproduce start → `pause('VOICE_QUOTA_EXHAUSTED', false)` → next reliable `session.end`; require one `ended('completed')`, local dispose, P2 teardown/release, no new provider. Also reproduce recoverable pause → failed unmute → another error notification; current already-paused `pause()` returns silently on that failure.
3. **H3 — P2/P3, finite lifecycle and uncertainty (blocks final shutdown/reconnect acceptance):** P3 join currently grants separate `connectMs` waits to room connect and track publish and computes the start timer before both; require one original `min(response.expiresAt, ticket.expiresAtMs, original connect deadline)` across connect/publish/start and late-connect fencing. P3 `dispose` must surface evidence-drain failure and not double-close a late flow. P2 `disconnected` must not silently permit replacement/release an original execution reservation when durable cleanup is uncertain; add a deferred/rejecting cleanup regression. P2 `drain` currently calls `end` directly, bypassing `terminal('shutdown')`; request shutdown terminal forwarding once before cleanup. P5 adds only an application uncertainty latch/outer finite wait, never declares a timed-out underlying operation cancelled.
4. **H4 — P3, passive observation (blocks post-join degradation evidence):** `LiveKitMediaOptions.observe` exists but actual media source never invokes it. Request one sanitized `transport-error` observation for terminal Room/control failures and the existing `flow-error` observation on paid media pause, without duplicate reports or provider payloads. Browser leaving/rejoining alone is not proof of an SFU outage. P5 can already report connect rejection; it must not pretend post-join faults are observable through an unused callback.
5. **H5 — P4/P8, playout evidence limitation:** production `LiveTrackPlayback.progress()` advances `performance.now()` elapsed time while element/track state looks playable; `begin()` recreates an element on the **same** continuous remote track. This does not establish response-specific acoustic consumption or prove old RTP/jitter-buffer audio is flushed. Preserve P1b `unproven` handling and never call this hardware proof. Ask P4 to reconcile this actual evidence boundary and stale-generation behavior with its recorded handoff; P8 must record real browser evidence or a blocked gate. P5 may wire the declared contract and test supplied ACKs, but cannot certify genuine playout or full durable-heard semantics from timers. Do not solve it by synthesizing backend progress or changing frontend files here.

H1–H4 are focused ownership handoffs, not a blanket pause on independent P5 fixture/readiness work. Final P5 acceptance remains blocked if their relevant regressions fail. H5 additionally blocks any stronger claim that assembled fixtures prove actual hearing/stale-browser-audio safety; real-browser completion remains P8-owned.

## Routing, readiness, rollback and resource decisions

- `/api/voice` is **dictation-only** after cutover. A live cookie, live JSON start on a dictation binding, binary audio from an unadmitted socket, and query-path variants fail closed without provider work. Live controls and both media directions use one LiveKit Room. No runtime fallback flag or second control socket.
- Keep `VoiceConnection`'s existing generic sink mechanics temporarily because P3 and P8 fixtures instantiate it directly. The **public gateway** is the production trust boundary and its negative test is mandatory. Existing internal live fixtures are not evidence of a supported live-WebSocket route. Delete generic helpers only in a later owner-coordinated fixture migration, not by rewriting dictation now.
- Missing **all** LiveKit env values is allowed diagnostic configuration: live capability false and live POST 503 `VOICE_DISABLED`; dictation and configured text still work. Partial/malformed LiveKit env retains P1's startup validation failure. Do not swallow invalid bootstrap errors or weaken its parser to make the fixture green.
- Retain existing `speech` values, no new operational wire schema: `off` when neither mode is requested; `unconfigured` when any requested mode lacks its required config (Deepgram for both, LiveKit additionally for live); otherwise `degraded` on observed speech/LiveKit failure, else `ready`. With both requested but only LiveKit missing, aggregate speech is unconfigured while public config still admits dictation. `ready` means configured/no observed fault, **not** an ICE/TURN/connectivity certificate.
- Speech/live status never adds text `issues`, changes text provider cooldown, stops the runtime, or changes process exit status. `/operations/ready` HTTP status remains governed by existing text `acceptReady`; `/operations/live` stays liveness only. No paid/network health calls, token signing or room connection in readiness.
- One process-local LiveKit degradation boolean suffices: set on connect rejection or H4 transport-error; clear after a later successful bridge connection. Keep existing speech-provider degradation separate and aggregate with OR. No circuit breaker service, database health record, polling or background SFU probe.
- A failed bridge cleanup latches uncertainty for the application lifetime, prevents a **safe** shutdown/persistence close, and must not be erased by later room success. P2/P3 own session-specific reconciliation/release semantics.
- Synchronously stop voice admission when shutdown starts. Start voice cleanup alongside runtime drain under one existing `shutdownDrainMs` deadline; do not wait for a model run to finish naturally before aborting voice resources. Pending cleanup retains the executor sentinel on timeout/failure. One persistence close after **all** required drains succeed; never RTC process-global dispose.
- Explicit rollback: disable requested live mode through existing settings, retain dictation/text, or have the operator restore an independently retained prior build. No automatic live-WebSocket rollback or silent relabeling of PCM as WebRTC. P7 documents deployment/build rollback; P5 performs none.

## Task 1: Repair the assembly fixture without relaxing production admission

**Files:** create `backend/test/assembly/voice-livekit-fixture.ts`; modify `backend/test/assembly/voice-bootstrap.e2e-spec.ts`; add two optional assembly ports in `backend/src/app.service.ts`.

- [ ] **1. Capture red**, working directory `backend/`:

```powershell
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
```

Expected from the recorded P2 handoff: four live scenarios fail at POST with 503 `VOICE_DISABLED`, not provider execution. Record actual discovery/counts; do not assume exactly four if intervening changes differ.

- [ ] **2. Add deterministic assembly ports.** Use type-only media imports so diagnostic/text boot does not eagerly load native RTC resources:

```typescript
import type { LiveKitAdmissionPort } from './contracts/voice.js';
import type { LiveKitMediaBridge } from './voice/transport/livekit-media.js';
import { LiveKitAdmission } from './voice/session/livekit-admission.js';
// Add to AssemblyPorts (all existing members unchanged):
// livekitAdmission?: LiveKitAdmissionPort;
// livekitConnect?: typeof LiveKitMediaBridge.connect;
// In the existing VoiceSessionService options, wire this immediately:
// livekit: this.ports.livekitAdmission ?? new LiveKitAdmission(),
```

Wire the admission port in **this task**, before enabling live fixture settings: otherwise test teardown would call the default real RoomServiceClient. Task 2 adds only the bridge hook, not a second admission object.

- [ ] **3. Write the new helper**, after its mandatory header. Import the P3 fake before production media consumers; reuse it without editing P3-owned tests:

```typescript
/**
 * ============================================================================
 * FILE: voice-livekit-fixture.ts
 * LOCATION: backend/test/assembly/voice-livekit-fixture.ts
 * ============================================================================
 * PURPOSE:
 *    Adapt existing offline RTC and token fixtures for application assembly.
 * ROLE IN PROJECT:
 *    Exercises real AppService/P2/P3 seams without an SFU, database or provider.
 *    Keeps one captured epoch at a time and preserves prior resource references.
 * KEY COMPONENTS:
 *    - livekitEnvironment: Explicit fixture-only bootstrap settings.
 *    - offlineLiveKit: Fake room administration and real bridge over fake RTC.
 * ============================================================================
 */
import { rtcFixture, type RtcFixture } from '../voice/transport/livekit-fixture.js';
import { vi } from 'vitest';
import { TrackKind, TrackSource } from '@livekit/rtc-node';
import { LiveKitMediaBridge, type LiveKitMediaOptions } from '../../src/voice/transport/livekit-media.js';
import { LiveKitAdmission } from '../../src/voice/session/livekit-admission.js';
import { livekitConfigFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { VoiceControlReassembler, type CreateVoiceSessionResponse,
  type VoiceClientPayload, type VoiceServerEvent } from '../../src/contracts/voice-wire.js';

export const livekitEnvironment = () => {
  const config = livekitConfigFixture();
  return { LIVEKIT_URL: config.url, LIVEKIT_API_KEY: config.apiKey,
    LIVEKIT_API_SECRET: config.apiSecret };
};

type Epoch = {
  response: CreateVoiceSessionResponse;
  rtc: RtcFixture;
  bridge: LiveKitMediaBridge;
  events(): VoiceServerEvent[];
  control(payload: VoiceClientPayload): void;
  microphone(): void;
};

export function offlineLiveKit() {
  const roomClient = { deleteRoom: vi.fn(async (_name: string) => undefined),
    removeParticipant: vi.fn(async (_room: string, _identity: string) => undefined) };
  const epochs: Epoch[] = [];
  const admission = new LiveKitAdmission(() => roomClient);
  const connect = vi.fn(async (options: LiveKitMediaOptions) => {
    // P2 mutates its binding on rejoin: hold an immutable test epoch descriptor.
    const response = structuredClone(options.context.response);
    const rtc = rtcFixture(response);
    const bridge = await LiveKitMediaBridge.connect(options);
    let sequence = 0;
    const events = () => {
      const rx = new VoiceControlReassembler('server', 'live', {
        sessionId: response.sessionId, connectionEpoch: response.connectionEpoch,
      });
      const output: VoiceServerEvent[] = [];
      for (const packet of rtc.controlPackets) {
        const result = rx.push(packet.bytes);
        if (result.status === 'complete') output.push(result.event);
      }
      return output;
    };
    epochs.push({ response, rtc, bridge, events,
      control: payload => rtc.emitControl(payload, sequence++),
      microphone: () => {
        const publication = { sid: 'assembly-mic', kind: TrackKind.KIND_AUDIO,
          source: TrackSource.SOURCE_MICROPHONE, setSubscribed: vi.fn() };
        const participant = { identity: response.livekit!.participantIdentity };
        rtc.rooms[0].emit('trackPublished', publication, participant);
        rtc.rooms[0].emit('trackSubscribed', {}, publication, participant);
      },
    });
    return bridge;
  });
  return { admission, connect, roomClient, epochs,
    last: () => {
      const epoch = epochs.at(-1);
      if (!epoch) throw new Error('Assembly did not open a LiveKit bridge.');
      return epoch;
    },
  };
}
```

P3's `emitControl` already supplies the reliable packet kind; no additional SDK wrapper is needed. Save old Room/source references before resetting P3's single-epoch fake during a rejoin. It is not a multi-room/native concurrency simulator.

- [ ] **4. Supply env only in enabled fixtures.** Change `bootstrap` to accept `withLiveKit = false`, add `...(withLiveKit ? livekitEnvironment() : {})` to its literal. Add a final `withLiveKit = true` parameter to `bootEnabled` and use `bootstrap(withLiveKit)` there. Leave diagnostic `boot()` using `bootstrap()`. Create `const media = offlineLiveKit()` in `bootEnabled`, pass `livekitAdmission: media.admission, livekitConnect: media.connect` to AppService and return `media`. Retain injected `speechSockets`, limits, repository, runtime, fixed assets and fake persistence.

```typescript
const config = bootstrap(withLiveKit);
const media = offlineLiveKit();
// In the existing AppService.create override object:
// livekitAdmission: media.admission,
// livekitConnect: media.connect,
// In the existing return object add: media
```

- [ ] **5. Add this independent negative regression** before bridge wiring; it remains required after the positive fixture turns green:

```typescript
it('keeps live disabled without LiveKit while configured text remains ready', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime, async () => undefined, false);
  app = started.app;
  const config = await request(started.base).get('/api/voice/config').expect(200);
  expect(config.body.enabledModes).toEqual({ dictation: true, live: false });
  await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173')
    .send({ protocolVersion: 1, mode: 'live', conversationId: null,
      locale: 'en-US', idempotencyKey: 'missing-livekit-1' }).expect(503);
  expect(recorded.opened).toHaveLength(0);
  expect(started.media.connect).not.toHaveBeenCalled();
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  const ready = await request(started.base).get('/api/operations/ready').expect(200);
  expect(ready.body.acceptReady).toBe(true);
});
```
- [ ] **6. Run green fixture checks** with the e2e command above. Before Task 2, the old live-WebSocket tests can still pass; that is fixture repair only, **not** WebRTC cutover evidence. If the helper triggers the RTC mock too late, fix its import order, never let it create a real Room.
- [ ] **7. Request serialized commit:** `test(voice): configure offline LiveKit assembly admission`. Stage only the new helper, voice-bootstrap test and assembly-port type changes.

## Task 2: Connect one bridge and claim/open the existing live composition exactly once

**Files:** `backend/src/app.service.ts`; `backend/test/assembly/voice-bootstrap.e2e-spec.ts`.

- [ ] **1. Add a failing assembled routing test**, using the existing `bootEnabled`, `recordingSockets`, `runtimeStub`, `until` functions and the Task 1 return:

```typescript
it('assembles one live bridge without provider work until reliable session.start', async () => {
  const recorded = recordingSockets();
  const runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const claim = vi.spyOn(started.service.voiceSessions, 'claimLive');
  const created = await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173')
    .send({ protocolVersion: 1, mode: 'live', conversationId: null,
      locale: 'en-US', idempotencyKey: 'live-assembly-1' }).expect(201);
  expect(isLiveKitVoiceSessionResponse(created.body)).toBe(true);
  expect(started.media.connect).toHaveBeenCalledTimes(1);
  expect(recorded.opened).toHaveLength(0);
  expect(claim).not.toHaveBeenCalled();
  const epoch = started.media.last();
  epoch.control({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO });
  await until(() => expect(epoch.events().some(e => e.type === 'session.ready')).toBe(true));
  expect(claim).toHaveBeenCalledTimes(1);
  expect(claim.mock.results[0].value).toBe(started.media.connect.mock.calls[0][0].context);
  expect(epoch.events().slice(0, 2).map(e => e.type)).toEqual(['session.ready', 'voice.state']);
  expect(recorded.opened.map(s => s.url.pathname).sort()).toEqual(['/v2/listen', '/v2/speak']);
  expect(app.get(VoiceSessionService)).toBe(started.service.voiceSessions);
});
```

Import `isLiveKitVoiceSessionResponse` from the existing contract, not a duplicate validator. Spy on the existing `AssemblyPorts.runtime`/`open` overrides in `bootEnabled` (wrap their existing bodies with `vi.fn`) and return those spies: assert exactly one of each across create, duplicate POST, provider resume and reconnect. Do not assert executor ownership from a static source-string test.

- [ ] **2. Run red:** `npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts -t "assembles one live bridge"`. Expected `media.connect` was called zero times.
- [ ] **3. Wire the existing owner.** Add `VoiceBinding`, `LiveKitAdmissionTicket`, and `voiceError` imports to AppService, preserving current imports and Task 1's admission injection. Add `openLiveBridge: (context, ticket) => this.openLiveBridge(context, ticket)` to the **existing** VoiceSessionService options. Add these private fields and method:

```typescript
private livekitDegraded = false;
private voiceCleanupFailed = false;

private async openLiveBridge(context: SessionContext, ticket: LiveKitAdmissionTicket) {
  const binding = context as VoiceBinding; // P2 issue(entry) passes the registry object; identity is tested.
  const sessionId = context.response.sessionId;
  const epoch = context.response.connectionEpoch;
  const descriptor = { ...ticket.transport };
  let claimed = false;
  const current = () => binding.response.connectionEpoch === epoch && binding.state !== 'ended';
  try {
    const connect = this.ports.livekitConnect
      ?? (await import('./voice/transport/livekit-media.js')).LiveKitMediaBridge.connect;
    const bridge = await connect({ context, ticket,
      open: async (c, sink, signal) => {
        if (!current()) throw new VoiceSessionError('STALE_CONNECTION_EPOCH');
        if (!claimed) {
          const owner = this.voiceSessions.claimLive(sessionId,
            descriptor.participantIdentity, descriptor.roomName);
          if (owner !== binding) throw new VoiceSessionError('VOICE_BINDING_MISMATCH');
          claimed = true;
        }
        const flow = await this.openVoice(c, sink, signal);
        if (!(flow instanceof LiveFlow)) {
          await flow.close();
          throw new VoiceSessionError('VOICE_INVALID_STATE');
        }
        return flow;
      },
      ended: async () => {
        if (current()) await this.voiceSessions.end(sessionId);
      },
      disconnected: async recoverable => {
        if (current()) await this.voiceSessions.disconnected(binding, recoverable);
      },
      observe: observation => {
        if (!current()) return;
        if (observation.stage === 'transport-error') this.livekitDegraded = true;
        this.voiceUsage.observe(context, observation);
      },
    });
    this.livekitDegraded = false;
    binding.warning = code => bridge.event({ type: 'session.warning', code,
      recovery: 'none', recoverable: true });
    binding.pause = async reason => {
      bridge.pause(reason === 'duration' ? 'VOICE_DURATION_LIMIT' : 'VOICE_QUOTA_EXHAUSTED', false);
      bridge.event({ type: 'session.ended', reason, terminal: false });
    };
    binding.terminal = reason => bridge.event({ type: 'session.ended', reason, terminal: true });
    return { close: async () => {
      try { await bridge.dispose(); }
      catch (error) { this.voiceCleanupFailed = true; throw error; }
    } };
  } catch (error) {
    this.livekitDegraded = true;
    throw voiceError(error, 'VOICE_CONNECT_TIMEOUT');
  }
}
```

No `entry.cleanup = bridge.dispose`: P2 assigns `livekitCleanup` from the returned handle. `pause` synchronously fences paid work; P3's `dispose` waits its internal pausing promise, so P5 does not need a second pause-drain port. Lifecycle callbacks are epoch-fenced because P2 mutates the same binding during rejoin. Let P2's own state/latches ensure repeat end/disconnect is idempotent; do not add a parallel session Map. Dynamic import is inside the catch boundary so native-loader failure is sanitized too. If H3 changes startup callback timing, reconcile here before green.

- [ ] **4. Add `connectLive` beside the existing WebSocket helper** and migrate the four live scenarios (finalized input, quiet/resume, duration and quota) to it:

```typescript
async function connectLive(started: Awaited<ReturnType<typeof bootEnabled>>, key = 'live-0001') {
  const created = await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://127.0.0.1:5173')
    .send({ protocolVersion: 1, mode: 'live', conversationId: null,
      locale: 'en-US', idempotencyKey: key }).expect(201);
  expect(isLiveKitVoiceSessionResponse(created.body)).toBe(true);
  const epoch = started.media.last();
  epoch.control({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO });
  let cursor = 0;
  const nextEvent = async (type: string, expected: Record<string, unknown> = {}) => {
    let found: VoiceServerEvent | undefined;
    await until(() => {
      const events = epoch.events();
      while (cursor < events.length) {
        const event = events[cursor++];
        if (event.type === type && Object.entries(expected).every(([k, v]) =>
          (event as unknown as Record<string, unknown>)[k] === v)) { found = event; break; }
      }
      expect(found).toBeDefined();
    });
    return found!;
  };
  await nextEvent('session.ready');
  epoch.microphone();
  return { ...epoch, created, nextEvent };
}
```

Import `VoiceServerEvent`. Live input becomes `connection.rtc.pushFrame(new Int16Array(1280).fill(1000))`; quiet/resume still drives reliable `input.suspend` and provider settlement, then verifies frames are not uploaded while suspended. Live teardown becomes `voiceSessions.end(sessionId)` or reliable `session.end`, never `socket.close`. In live policy tests assert Room/control remains usable, sources/providers stop, unmute opens nothing, and end eventually deletes the room once. Preserve the original dictation `connect` helper and its wire bytes untouched.

- [ ] **5. Green:** run the whole voice-bootstrap e2e file. H2 may deliberately leave policy/end acceptance red until P3's focused correction is committed. Add duplicate POST/start, provider-pause/resume (one claim), warning forwarding, shutdown-terminal forwarding (H3), and stale-epoch callback tests in separate small red/green cycles. Retain the exact existing no-inference assertion when runtime status is already completed.
- [ ] **6. Request serialized commit:** `feat(voice): assemble LiveKit bridges on the existing runtime`. Stage `app.service.ts` and the assembly e2e test only.

## Task 3: Make the public WebSocket route dictation-only

**Prerequisite:** H1 is committed and its exact signature reconciled. **Files:** `voice.gateway.ts`, `voice-connection.ts` header, `gateway.spec.ts`, `gateway.integration.spec.ts`, assembly e2e tests.

- [ ] **1. Add this red boundary test** to `backend/test/voice/transport/gateway.spec.ts`, using its existing imports, services cleanup array, FakeSocket and options:

```typescript
it('rejects live WebSocket admission without consuming its LiveKit claim', async () => {
  const o = options(), s = new VoiceSessionService(o); services.push(s);
  const result = await s.create({ ...request, mode: 'live' }, origin);
  const socket = new FakeSocket();
  new VoiceGateway(s).handleConnection(socket, { url: '/api/voice', headers: {
    origin, cookie: result.cookie.split(';')[0],
  } } as IncomingMessage);
  expect(socket.close).toHaveBeenCalledExactlyOnceWith(1008);
  expect(o.open).not.toHaveBeenCalled();
  expect(o.reservations.release).not.toHaveBeenCalled();
  expect(s.claimLive(result.response.sessionId, result.response.livekit!.participantIdentity,
    result.response.livekit!.roomName).state).toBe('active');
});
```

- [ ] **2. Red:** `npm test -- test/voice/transport/gateway.spec.ts -t "rejects live WebSocket admission"`. Expected current gateway accepts it and does not close.
- [ ] **3. Minimum implementation after H1:** change exactly the gateway claim call:

```typescript
const binding = this.sessions.claim(request.headers.cookie, request.headers.origin, 'dictation');
connection = new VoiceConnection(this.sessions, binding, socket);
```

Update gateway/connection headers: public `/api/voice` is dictation-only; the generic VoiceSink implementation is not a supported live fallback. Do not add per-frame mode checks, another admission, or `end(liveId)` in the rejection handler. P2 must reject without side effects.

- [ ] **4. Preserve old internal unit coverage without making it routing evidence.** In `gateway.spec.ts`'s local `fixture`, keep the production gateway path for dictation; for the existing generic live sink unit cases instantiate `new VoiceConnection(s, s.claim(...), socket)` directly and attach its existing `receive/lost` handlers. Label those cases `legacy internal sink fixture`, not public live admission. These intentionally bypass the gateway only inside tests. Existing P3/P8 direct constructors remain unchanged. Add a separate dictation binding + live `session.start` rejection test through the actual gateway.
- [ ] **5. Replace public live tests**, rather than retaining false expectations: in `gateway.integration.spec.ts` replace its live reconnect/multiplexing cases with actual live-upgrade rejection using a live POST cookie and a 1008 close; attach the close listener before awaiting events and bound the test to two seconds. Preserve reconnect/output scenario intent in Task 6's assembled fake-RTC tests. Dictation round-trip/finalization, origin, cookie replay, DTO/query checks remain unchanged. Do not delete them or add test-discovery exclusions.
- [ ] **6. Green:**

```powershell
npm test -- test/voice/transport/gateway.spec.ts test/voice/transport/gateway.integration.spec.ts
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
```

Require nonzero tests, live route rejection with no providers, still-claimable live admission, and passing dictation PCM/finalization. There is no live WebSocket rollback flag.
- [ ] **7. Request serialized commit:** `fix(voice): admit only dictation on the public voice WebSocket`. Stage named gateway/connection/test files and any relocated assembly tests only; never P2 source.

## Task 4: Report unconfigured/degraded live voice without text downtime or paid probes

**Files:** `backend/src/operations/readiness.ts`, `backend/src/app.service.ts`, `backend/test/operations/voice-readiness.spec.ts`, assembly e2e tests.

- [ ] **1. Add this failing operations test** beside the existing voice readiness test; its `options` and `loadVoiceConfig` imports already exist:

```typescript
it('reports missing LiveKit as unconfigured without denying configured text', async () => {
  const f = options();
  f.o.config.voice = loadVoiceConfig({ ENABLE_DICTATION_MODE: 'true',
    ENABLE_LIVE_VOICE_MODE: 'true', DEEPGRAM_API_KEY: 'offline-speech' });
  const result = await new Readiness(f.o).read();
  expect(result).toMatchObject({ live: true, acceptReady: true, speech: 'unconfigured' });
  expect(result.issues).toEqual([]);
  expect(f.runtime.stopAccepting).not.toHaveBeenCalled();
});
```

- [ ] **2. Red:** `npm test -- test/operations/voice-readiness.spec.ts -t "missing LiveKit"`. Expected speech currently ready.
- [ ] **3. Implement one configuration predicate**, reused by both readiness branches in this file, importing `isLiveKitConfigured` and type `VoiceConfig` from existing config modules:

```typescript
function speechUnconfigured(voice: VoiceConfig): boolean {
  return !voice.deepgram.apiKey ||
    (voice.enabledModes.live && !isLiveKitConfigured(voice.livekit));
}
```

Replace the snapshot branch's Deepgram-only check and the legacy branch's `voiceReadinessIssues` check with this predicate; remove the now-unused import. Leave `speechEnabled`, `issues`, provider state, HTTP status and dependency probe unchanged. Preserve `speech: 'off'` when neither mode is requested. Update the existing degraded test to supply `...livekitEnvironment()` (or `livekitConfigFixture()` on its voice object) so it tests **configured** degradation rather than missing config.

In AppService use the existing operations callback:

```typescript
speechDegraded: () => this.voiceUsage.speechStatus().degraded || this.livekitDegraded,
```

- [ ] **4. Add assembled failures independently:** reject `media.connect` once with a private error, assert live POST sanitized `VOICE_CONNECT_TIMEOUT`, no speech sockets/runtime submissions, one reservation release after successful cleanup, operations `speech: 'degraded'` and configured text `acceptReady: true`. After later successful bridge connect, only LiveKit degradation clears. Emit H4's `transport-error` through the captured options callback to check forwarding, then use a real fake-RTC publish failure for behavioral evidence after P3 implements H4. Browser voluntary disconnect alone must not assert SFU failure.
- [ ] **5. Add a snapshot-path readiness test** using the real `bootEnabled` currentConfig, then an explicit no-LiveKit bootstrap with requested live mode. Fetch `/api/voice/config`, `/api/operations/ready`, and `/api/operations/live` repeatedly, including after advancing a fake clock past the DB cache window. Assert no additional media connector/admission issue/speech factory/fetcher/runtime-constructor calls. Compare safe status fields only, never serialize signed tokens into assertions/logs.
- [ ] **6. Green:**

```powershell
npm test -- test/operations/voice-readiness.spec.ts test/operations/readiness.spec.ts test/operations/retry-cooldown.spec.ts
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
```

Both legacy and snapshot branches must pass. Text POST/stream and dictation after a LiveKit fault are verified by Task 6; liveness alone is not enough.
- [ ] **7. Request serialized commit:** `fix(voice): isolate passive LiveKit readiness from text admission`.

## Task 5: Stop admission synchronously and drain voice/runtime within one finite shutdown

**Prerequisite for final green:** H3 cleanup/revocation semantics. **Files:** operations options/service, AppService, voice-shutdown spec, voice-bootstrap e2e spec.

- [ ] **1. Add a failing stop-before-drain test** in `backend/test/operations/voice-shutdown.spec.ts` (uses its existing options and OperationsService imports):

```typescript
it('stops voice admission synchronously and starts voice drain while runtime is pending', async () => {
  vi.useFakeTimers();
  const { o, runtime } = options();
  const order: string[] = [];
  const gate = deferred<{ drained: boolean; active: number; unresolvedWrites: number }>();
  o.stopVoice = vi.fn(() => { order.push('voice-stop'); });
  o.drainVoice = vi.fn(async () => { order.push('voice-drain'); return { drained: true, active: 0 }; });
  vi.mocked(runtime.drain).mockImplementation(() => gate.promise);
  try {
    const closing = new OperationsService(o).shutdown();
    expect(order).toEqual(['voice-stop']);
    await Promise.resolve(); await Promise.resolve();
    expect(order).toContain('voice-drain');
    expect(o.closePersistence).not.toHaveBeenCalled();
    gate.resolve({ drained: true, active: 0, unresolvedWrites: 0 });
    expect(await closing).toEqual({ safe: true });
    expect(o.closePersistence).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
```

Import the already exported `deferred` from `../http/fixtures.js`. `stopVoice` is the **new P5-owned** optional OperationsOptions member defined in step 3, so missing type/behavior is the expected red, not an upstream API guess.

- [ ] **2. Red:** `npm test -- test/operations/voice-shutdown.spec.ts -t "stops voice admission"`. Expected no synchronous voice-stop/voice-drain while runtime is pending.
- [ ] **3. Minimal operational wiring:** add `stopVoice?: () => void` to OperationsOptions. In `shutdown()` call it synchronously when setting `readiness.closing`, before scheduling drains. Start the existing bounded voice job before awaiting runtime, then await its result in the existing all-safe predicate:

```typescript
const voiceJob = this.o.drainVoice
  ? boundedResult(Promise.resolve().then(() => this.o.drainVoice!(remaining())), remaining())
  : Promise.resolve({ ok: true as const, value: { drained: true, active: 0 } });
const drained = r ? await boundedResult(Promise.resolve().then(() => r.drain(remaining())), remaining())
  : { ok: true as const, value: { drained: true, active: 0, unresolvedWrites: 0 } };
const voice = await voiceJob;
```

Keep the one existing `shutdownJob`, shared monotonic deadline, config/Calendar drains, transport checks and sole persistence close unchanged. Revise the old sequential-order test's name/expectation to check stop → both drains → close (both drains start once); do not preserve its obsolete requirement that voice wait behind runtime.

In AppService's existing OperationsService options:

```typescript
stopVoice: () => {
  this.voiceSessions.stopAccepting();
  this.voiceUsage.stopAccepting();
},
drainVoice: async () => {
  await this.voiceSessions.drain();
  const result = await this.voiceUsage.drain();
  if (this.voiceAccountingFailed || this.voiceCleanupFailed) {
    throw new AppError('PERSISTENCE_ERROR', 'Voice cleanup could not be confirmed.');
  }
  return result;
},
```

The operations outer bound already limits waiting. Do not race `flow.close` locally and release its lease as if it completed. A hung native/room deletion/provider/evidence call is not proof of cancellation; after the deadline `{ safe: false }` and no persistence close is correct.

- [ ] **4. Add assembled red/green cases one at a time:**
  - Hold a bridge connection or terminal delivery/accounting write on a `deferred`; initiate shutdown twice, require the same promise and immediate rejection of a new voice POST before releasing the deferred.
  - Active Room + providers: shutdown fences input, closes providers/media, H3 forwards shutdown terminal once, P2 room deletion/release runs once; only then close persistence once. Capture call ordering with spies on injected resources, not guessed time delays.
  - Reject bridge dispose and then call end/drain again: uncertainty remains latched; safe false, no persistence close, no false completion. Make P2/P3 owner tests verify reservation quarantine from H3 rather than adding another lease manager.
  - Hang room service deletion: production LiveKitAdmission's 2 s best-effort bound is exercised with fake timers; distinguish that bounded revocation uncertainty from unresolved durable evidence. A returned bounded deletion does not certify the remote participant left.
  - Hang durable/provider cleanup past `shutdownDrainMs`: finite safe false, no persistence close. Resolve deferreds in `finally` so the test does not leave pending work or timers; do not set `process.exitCode` except in the existing lifecycle hook test.

- [ ] **5. Green:**

```powershell
npm test -- test/operations/voice-shutdown.spec.ts test/operations/shutdown.spec.ts test/operations/calendar-shutdown.spec.ts test/assembly/config-drain.spec.ts
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
```

- [ ] **6. Request serialized commit:** `fix(voice): stop admission and drain live media within shutdown budget`.

## Task 6: Prove assembled lifecycle, durability and text/dictation fault isolation

**Files:** extend `backend/test/assembly/voice-bootstrap.e2e-spec.ts` and its assembly-local fixture only. P3/P8 tests are regression inputs, not editable files.

- [ ] **1. Extend the existing `runtimeStub` only for an opt-in live execution mode**, leaving the original completed/no-inference scenario intact. Add `executeLive = false`, `records: Map<string, VoiceDeliveryRecord>`, `turnStatus`, and spies on submit/execute/cancel/reconcile/reservation acquire/release. Reuse `attempt` from `../persistence/fixtures.js` and the actual `ExecuteTurn`/delivery types. Its opt-in execute body follows the existing P3 pipeline fixture rather than inventing completion events:

First preserve a real text-capable fake on the **same object**: inside `runtimeStub`, create `const textRuntime = fixtureOptions().runtime` and spread it first in the returned object. Import `fixtureOptions` from `../http/fixtures.js`. Replace the local reservation-map implementation with existing `ExecutionReservations` from `../../src/chat-runtime/execution-reservations.js`, constructed with `bootstrap().identity.userId` and `async () => false`; spy on acquire/bind/release. This reuses the actual `assertText` exclusion port rather than silently omitting it. In `bootEnabled`, supply `fixtureOptions().sessions` and `.messages` in fake persistence instead of `{}` so text HTTP delegates can run. These changes stay in the existing assembly test file.

```typescript
executeTurn: vi.fn(async (command: ExecuteTurn) => {
  if (!command.live) return textRuntime.executeTurn(command);
  calls.execute += 1;
  if (!executeLive) return;
  const live = command.live!;
  await live.start({ ...attempt(), userId: command.userId, sessionId: command.sessionId,
    turnId: command.turnId, attemptId: command.attemptId }, async (record, expected) => {
    if (expected !== undefined) expect(records.get(command.attemptId)?.sequence).toBe(expected);
    records.set(command.attemptId, structuredClone(record));
  });
  try {
    await live.delta('Hello world.');
    await live.finish();
    await live.settle('Hello world.', command.signal);
    if (!command.signal.aborted) turnStatus = 'completed';
  } finally {
    if (command.signal.aborted) turnStatus = 'cancelled';
  }
}),
```

Initialize `turnStatus: 'accepted' | 'completed' | 'cancelled' | 'failed' = executeLive ? 'accepted' : 'completed'`; `getLiveTurnStatus` returns it; `getLiveDelivery` reads `records.get(attemptId) ?? null`; `cancelLiveTurn` sets cancelled; `reconcileSession` asserts no pending delivery remains. `submitLiveTurn(command)` returns the command's **actual** conversation sessionId instead of hardcoded `chat-1`, plus stable `turn-1`/`attempt-1`; preserve acceptance counter and original reservation/identity. Return records/turnStatus accessor to tests. Use deferred writer hooks for the blocked terminal-write scenario, analogous to the existing accounting writer, not another fake persistence engine.

- [ ] **2. Add this assembled durability test**. Import `metadata` and `turn` from `../fixtures/deepgram/socket.js`; these are existing raw protocol fixtures, not normalized adapter events. Add `serverBinary(bytes: Uint8Array) { this.emit('message', Buffer.from(bytes), true); }` to the assembly's FakeProviderSocket. The opt-in runtime changes above must precede this test:

```typescript
it('assembled durable completion requires synthesis and browser progress', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub(true);
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connectLive(started);
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  const tts = recorded.opened.find(s => s.url.pathname === '/v2/speak')!;
  const input = turn('EndOfTurn', 1, 'hello aurvin');
  stt.serverText(input); stt.serverText(input);
  await until(() => expect(tts.sent).toContain(JSON.stringify({ type: 'Flush' })));
  tts.serverText({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  tts.serverBinary(new Uint8Array(4800));
  const start = await connection.nextEvent('audio.start');
  if (!('turnId' in start) || !('responseId' in start)) throw new Error('Missing response reference');
  const ref = { turnId: start.turnId, responseId: start.responseId };
  tts.serverText({ type: 'SpeechMetadata', ...metadata() });
  const final = await connection.nextEvent('audio.watermark', { final: true });
  if (final.type !== 'audio.watermark') throw new Error('Missing final watermark');
  expect(runtime.calls).toEqual({ submit: 1, execute: 1 });
  expect(runtime.records.get('attempt-1')?.status).toBe('pending');
  expect(final.queuedSamples).toBe(2400);
  expect(connection.events().some(e => e.type === 'audio.end')).toBe(false);
  connection.control({ type: 'playback.progress', ...ref,
    playedSamples: final.lastAudioSample, playedMs: Math.floor(final.lastAudioSample / 24),
    proof: 'proven' });
  await until(() => expect(runtime.records.get('attempt-1')?.status).toBe('completed'));
});
```

`ref` and the final absolute sample bound come from actual server events, not guessed IDs/per-response ACKs. `SpeechMetadata`, not `Flushed`, ends synthesis. The fixture record is observable write-boundary evidence, **not MongoDB durability certification or hardware hearing**.

- [ ] **3. Run red/green:** `npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts -t "durable"`. Existing invariants may already pass through correct wiring; retain passing guards and capture the first failing seam test rather than breaking correct source to manufacture a red. Correct only P5 wiring here; failures in normalized speech, delivery or runtime behavior go to P3/owning workers.
- [ ] **4. Add these separate small executable scenarios using the same helpers**, each with named tests and assertions on actual records/resources:
  - `assembled durable completion waits for the terminal write`: block delivery writer on completed; no inference completion/lease release/persistence close until released.
  - `assembled interruption retains a proven prefix`: 1200-sample progress then `response.interrupt`, source clear before one runtime cancellation; provider SpeechInterrupted evidence supplies `Hello` / ` world.`; require delivery interrupted with that prefix, never copied full generated text.
  - `assembled cancellation before audio is not heard speech`: interrupt while model work exists but before TTS audio; cancelled turn/delivery as existing VoiceDelivery semantics specify, no fabricated played samples.
  - `assembled disconnect remains interrupted or unknown, never completed`: drop Room before final ACK; actual runtime reconciliation and delivery unknown/null spoken evidence, retaining existing distinction from explicit cancel. A response with unproven ACK never completes even at its generated ceiling.
  - `assembled failure retains terminal evidence`: fail the fake provider or opt-in execute body after acceptance; preserve failed runtime outcome and failed/unknown delivery according to current contracts. Never call sink.finish('completed') merely to end a session.
  - `assembled reconnect retains one reservation and opens a fresh epoch`: save old Room/source refs, emit loss, wait cleanup, POST same key, require one reservation acquire, one epoch increment, no old PCM/controls replay, fresh providers only after new start. Old lifecycle callback after the new start does not end the replacement. No new empty transcript on either admission.
  - `assembled LiveKit fault leaves text and dictation usable`: inject join/publish rejection, then a dictation session still returns a Nova partial and configured text HTTP POST/stream still emits its existing terminal sequence. Use the text delegates/repositories and `assertText` port wired above; do not infer this from `/operations/live` alone. Verify the same runtime constructor and persistence owner counts stay one.
  - `assembled quiet input does not accept empty turns`: 63 decoded silent 80 ms frames stop STT uploads without model submission; onset/settlement resumes existing call. This supplements the migrated explicit-suspend regression without reimplementing P3's gate.

Use these exact focused filters (each selects the correspondingly named case), then run the whole file:

```powershell
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts -t "assembled durable"
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts -t "assembled interruption"
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts -t "assembled cancellation"
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts -t "assembled disconnect"
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts -t "assembled failure"
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts -t "assembled reconnect"
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts -t "assembled LiveKit fault"
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts -t "assembled quiet"
```

Preserve provider tags, server identity, config snapshot and accounting assertions from the original e2e suite. Record any pending H2–H5 limitations rather than relaxing assertions.

For the fault-isolation case, the exact text requests against the **same started app** are:

```typescript
const accepted = await request(started.base).post('/api/sessions')
  .send({ sessionId: null, content: 'Hello', idempotencyKey: 'text-after-livekit-fault' }).expect(202);
const stream = await request(started.base).get(`/api${accepted.body.streamPath}`).expect(200);
expect(stream.headers['content-type']).toContain('text/event-stream');
expect(stream.text).toContain('"type":"completed"');
expect(runtime.calls).toEqual({ submit: 0, execute: 0 }); // These count live calls only.
```

- [ ] **5. Green regression commands**, working directory `backend/`, run individually:

```powershell
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts test/http/routes.e2e-spec.ts test/operations/http.e2e-spec.ts
npm test -- test/voice/transport/gateway.spec.ts test/voice/transport/gateway.integration.spec.ts test/voice/transport/livekit-media.spec.ts test/voice/agent/livekit-pipeline.spec.ts
npm test -- test/voice/session/dictation.spec.ts test/voice/session/live.spec.ts test/voice/session/controller.spec.ts test/voice/session/config-snapshots.spec.ts
npm test -- test/http/voice-exclusion.spec.ts test/http/service.spec.ts test/http/stream-transport.spec.ts test/assembly/voice-context.spec.ts
npm test -- test/voice/agent/voice-delivery.spec.ts test/voice/providers/accounting.spec.ts test/voice/usage/
npm test -- test/operations/voice-readiness.spec.ts test/operations/voice-shutdown.spec.ts test/operations/shutdown.spec.ts test/assembly/config-drain.spec.ts
```

- [ ] **6. Request serialized commit:** `test(voice): prove assembled WebRTC lifecycle and transport isolation`. Stage only the assembly-owned tests/helper changed in this task.

## Task 7: Required verification and bounded handoff

**Files:** no extra product source or verification document is required from P5; worker reports results to the orchestrator. P8 owns `verification.md` and comparison evidence; P7 owns operations/setup documentation.

- [ ] Run `npm run build`, `npm run lint`, `npm test`, and `npm run test:e2e` separately from `backend/`. Record Node/OS, actual source identity supplied by the orchestrator, discovered/passed/failed/skipped counts and warnings. A passing build is not a passing suite; empty discovery is not evidence.
- [ ] Run unchanged frontend contract/live/dictation/text regressions from `frontend/`:

```powershell
npm test -- src/api/voice-protocol.test.ts src/api/livekit-voice-client.test.ts src/features/voice/dictation src/features/chat
npm run build
npm run lint
```

P4/P8 own any correction. Do not edit their files. No browser device/ICE validation or paid calls are implied.
- [ ] Full-suite known failures must be separated from new failures: state.md records 25 pre-existing backend tests, plus 22 backend P8 Canvas and 17 frontend P8 integration failures after P3/P4. Do not assume those counts remain constant, remove suites, or classify a new failure as baseline without evidence. P5 exit requires owned/focused checks green; overall workflow regression-free/completion remains blocked until P8 reconciles its failures.
- [ ] Native database tests run only with operator-supplied `AURVIN_TEST_MONGODB_URI` and the isolated `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` authorization. This assignment supplies neither and authorizes no external network test: record native/service/browser evidence unrun/blocked, not passed. Do not run benchmark drivers.
- [ ] Check only named task-file whitespace/ownership and document references before requesting final serialized commit. The worker may use `git diff --check` when authorized; this planner did not. New files contain headers and no secrets; artifacts must not contain signed JWTs, keys, provider payloads or transcripts.
- [ ] Report exact commits and paths, current H1–H5 outcomes, one runtime/executor/persistence-close evidence, dictation/text results, readiness status meaning, finite-shutdown measurements and safe-false cases. Pass P7 the no-fallback rollback decision and existing env/config behavior. Pass P8 fixture APIs, proof limitations and source-specific failure names.
- [ ] Final commit message if verification-only test corrections remain: `test(voice): finalize application cutover regression coverage`. No empty commit, no broad staging, no new passing review artifact.

## Exit checklist (requirements are not results)

- [ ] P2's recorded four-test fixture handoff resolved by env **and deterministic admission/media injection**, with missing/invalid production settings still fail closed.
- [ ] Actual assembled POST/start proves valid P4 descriptor, zero providers before start, one P2 claim per epoch, one live pipeline, one runtime/executor and one persistence-close owner.
- [ ] Public live WebSocket upgrade/start/audio rejected without consuming live admission; dictation Nova/PCM/finalization and configured text submit/stream still pass.
- [ ] Reliable Room controls, warning/policy pause/end, reconnect epochs, old cleanup, expiry sweep/revocation and terminal outcomes observed; H1–H4 committed corrections verified, not guessed.
- [ ] Completion requires generated audio, eligible client progress and successful terminal write; interrupted/cancelled/failed/unknown evidence is not relabeled completed. H5/P8 limitations explicitly retained.
- [ ] Passive off/unconfigured/degraded reporting covers snapshot and legacy paths; no paid/SFU health work and no text restart/admission change for voice-only faults.
- [ ] Shutdown stops admission synchronously, bounds total waiting, drains active/pending bridges/providers/evidence, preserves unsafe ownership on uncertainty and closes persistence at most once only on confirmed safe drain.
- [ ] Focused assembly/dictation/text checks, backend build/lint and required suites have actual outcomes; known P8/baseline failures and prerequisite skips separately reported. No latency, audible-output, Azure, public rollout or full-workflow completion claim.

**Self-check:** tasks map to P5 scope/exit gates; new production changes stay in P5-owned files; upstream signature requests are explicitly gated; all named shared types/helpers exist in read source or are defined in this plan; review stays skipped. Planning itself ran no application tests and supplies no new runtime verification evidence.
