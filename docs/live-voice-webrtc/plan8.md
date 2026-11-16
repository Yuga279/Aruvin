# Integrated Regressions and Before/After Evidence (P8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repository use `executing-plans`, `test-driven-development`, and, for unexpected failures, `systematic-debugging`. The MAW orchestrator assigns workers and serializes commits; do not spawn nested agents or a reviewer.

**Goal:** Reconcile P8's integrated tests with the live-only WebRTC cutover, preserve dictation/text and durable voice behavior, and report actual before/after evidence without converting fixtures or missing authorization into a latency claim.

**Architecture:** Reuse real session/runtime/flow/controller code, existing P3/P4 SDK doubles, and P5 assembly checks. Replace obsolete live PCM/WebSocket fixture seams only inside P8-owned integration paths; send product defects to their owners. Keep no-service tests, native persistence, real LiveKit media, guarded paid measurements, and browser/acoustic/network observations as separate evidence classes.

**Tech Stack:** Existing TypeScript ESM/NodeNext, Vitest, Nest loopback test fixtures, existing LiveKit SDKs and benchmark tooling, Node built-ins and PowerShell. No new dependencies, benchmark framework, runtime bypass, infrastructure, or production source changes.

---

## Steps

- [ ] Establish prerequisites, immutable evidence inventory, and explicitly blocked reports.
- [ ] Replace P8's frontend matrix fixture with the actual live client over SDK doubles.
- [ ] Migrate frontend pipeline, cost, investigation, and Canvas expectations without losing intent.
- [ ] Migrate the offline backend Canvas relay to real media/control boundaries.
- [ ] Add integrated proof, cancellation, quiet-cost, policy-end, and failure regressions.
- [ ] Migrate native multi-mode/fault fixtures and retain explicit database authorization gates.
- [ ] Run the complete no-service regression phase and classify every failure/skip.
- [ ] Resolve assembled target/access/activation and cleanup gates before any service contact.
- [ ] Conditionally collect the renewed, bounded headless benchmark and conservative comparison.
- [ ] Conditionally collect browser/audible/interruption/impairment evidence and publish the completion matrix.

## Planning provenance and non-negotiable gates

- Planner read root `AGENTS.md`, `goal.md`, `research.md`, `state.md`, upstream plans 5/6/7, all six backend integration files, all seven frontend integration files, relevant real implementations and P3/P4/P5 doubles read-only. No more-specific `AGENTS.md` was found under backend, frontend, or docs. Commands in this plan are **future worker commands**, not planner test results. Planner runs no Git command and writes only this plan, uncommitted.
- Supplied commit/status evidence: plans P5 `7d1efdd`, P6 `0d3d468`, P7 `2c8e056`; partial P5 implementation `3d84aa0`; reported P6 offline commit `24a3382`, 91 benchmark tests and backend build/lint passed, **no live WebRTC run**. These identifiers are supplied evidence, not independently Git-verified by this planner.
- Reported P3/P4 focused evidence is 82 backend and 102 frontend tests passed, builds/lints passed. Broader handoff is **22 backend Canvas and 17 frontend integration failures** assuming old live PCM/WebSocket behavior. Do not assert current counts without rerunning; do not hide them with discovery exclusions, skips, weaker assertions, or invented capture callbacks.
- Worker start requires **this plan committed plus P5, P6, P7 implementations/tests/commits complete**, not only their plans. P5 partial assembly is not completion: H1/H3 belong to P2, H2/H4/unproven-delivery handling to P3. Live-only public WebSocket rejection is not yet enforced in the supplied partial state. A documented plan or a private direct `VoiceConnection` constructor does not prove cutover.
- **Additional source discrepancy found during planning:** inspected `backend/src/benchmark/live-baseline.ts` still accepts only the old `--live`, hardcodes `ws-live-2026-11-05`, and references exhausted authorization. `runner.ts` has no transport/provenance fields. `webrtc-voice.ts`, `voice-comparison.ts`, `live-run-options.ts`, `voice-measurements.ts`, and `docs/voice-latency-benchmark/webrtc-methodology.md` are absent in this checkout. Route this to **P6** and require a source-specific reconciled handoff. The reported 91 passing offline tests are not proof of those missing interfaces. Never execute the inspected historical driver, even as an allegedly safe preflight. P8 does not implement missing P6 tooling or rename old WS output.
- **No LiveKit target is selected; prior eight-submission authorization is exhausted.** Continuing MAW does not authorize a server install/start, Cloud access, database connection, provider catalogue request, microphone permission, audio capture, network probe/impairment, rollback activation, or paid submission. Tasks 8–10 are conditional procedures; initially record their service evidence **BLOCKED**.
- Preserve application/user changes, `.openchamber/`, private settings and ignored outputs. No root package scripts exist. No package installs are planned; missing dependencies are a prerequisite/owner handoff, not permission to install or change lockfiles.
- Unified review is **SKIPPED**, never passed. Plan self-check and test-driven defect correction are not a reinstatement of unified review.

## File map and ownership before tasks

P8 may create/modify only these tracked files in this plan:

| Exact path | Responsibility |
| --- | --- |
| `backend/test/voice/integration/canvas-multimodal-fixture.ts` | Real in-memory runtime + P2/P3 bridge + frontend controller/client over deterministic Room doubles; explicit synthetic ACK injection only. |
| `backend/test/voice/integration/canvas-multimodal.spec.ts` | Existing Canvas filtering/CAS/recovery assertions; replace old transport/scheduling observations with honestly labelled fixture boundaries. |
| `backend/test/voice/integration/webrtc-lifecycle.spec.ts` (new) | Small no-service integrated proof/quiet/pause/end/failure regressions reusing the migrated Canvas fixture. |
| `backend/test/voice/integration/integrated-fixture.ts` | Native runtime fixture: retain dictation WebSocket, replace live WebSocket peer with P3 bridge/Room fake and explicit proof controls. |
| `backend/test/voice/integration/multi-mode.spec.ts` | Preserve native text/dictation/live/history/collision/isolation intent with new live peer. |
| `backend/test/voice/integration/fault-recovery.spec.ts` | Preserve native failure/interruption/rejoin/recovery intent with new live peer. |
| `backend/test/voice/integration/canvas-multimodal.native.e2e-spec.ts` | Existing separately authorized native recovery; change only if the migrated contract requires it. |
| `frontend/src/features/voice/integration-tests/matrix-fixture.ts` | Real LiveKitVoiceClient and LiveVoiceController wired to existing SDK doubles; no worklet/legacy capture masquerading as live media. |
| `frontend/src/features/voice/integration-tests/voice-matrix.test.ts` | Permission/mic/mute/keyboard/page-lifecycle tests against native-track double; preserve dictation/SSR/accessibility checks. |
| `frontend/src/features/voice/integration-tests/pipeline.test.ts` | Reliable data, absolute watermark cursors, pause/rejoin/end through real live client. |
| `frontend/src/features/voice/integration-tests/investigation.test.ts` | Disconnect/stale-cursor regressions; retain standalone legacy PCM arithmetic under its accurate label. |
| `frontend/src/features/voice/integration-tests/cost-flow.test.ts` | Backend-quiet UI semantics and mute isolation; quiet STT upload proof moves to backend integration, not a new frontend VAD. |
| `frontend/src/features/voice/integration-tests/canvas-multimodal.test.ts` | Preserve Canvas/UI/archive safety; update resource/stop assertions to live Room/track boundaries. |
| `docs/live-voice-webrtc/verification.md` (new) | Exact source/environment/checks, acceptance and completion matrices, authorization ledger, failures, cleanup, limitations. |
| `docs/live-voice-webrtc/comparison.md` (new) | Immutable baseline, metric-boundary matrix, observed samples/comparability/deltas, blocked or measured verdict. |

Read-only reusable inputs: `frontend/.../integration-tests/canvas-multimodal-fixtures.ts` (no transport change needed), P3 `backend/test/voice/transport/livekit-fixture.ts`, P4 `frontend/src/api/testing/livekit-fakes.ts`, P5 `backend/test/assembly/voice-livekit-fixture.ts`, session provider doubles, runtime fixtures, all P1–P7 source/tests and benchmark files. Do not edit the deprecated P4 `state/testing/live-voice-fixture.ts`; its `client/capture/playback` overrides are currently ignored. Migrate callers, then ask P4 to remove compatibility shims if desired; deletion there is not P8 work.

New raw output leaves only, already covered by `.gitignore`'s `backend/benchmark-results/`:

- `backend/benchmark-results/webrtc-live-<UTC-date>-p8-<unique-id>/`: P6 driver outputs, new normalization/comparison sidecars, accounting/safety evidence.
- `backend/benchmark-results/p8-webrtc-<UTC-date>-<unique-id>/`: offline command logs, immutable-input inventory, authorized browser/network observations, hashes/manifests and cleanup ledger.
- Each leaf is newly/exclusively created; never reuse/overwrite a failed run's leaf. No `.gitignore` edit, raw output staging, screenshot of tokens, or private `.env` read by a checker. Literal angle-bracket names here describe naming rules, not executable arguments.

All new code gets the mandatory FILE/LOCATION/PURPOSE/ROLE IN PROJECT/KEY COMPONENTS header before first write; update existing headers on >30% edits. Backend local imports use `.js`; frontend follows existing `.ts` imports. Commit messages below are requests to the orchestrator; stage exact changed paths only after serialized permission. Do not run Git for this planning assignment.

## Acceptance matrix (requirements, not current passes)

| AC | Required deterministic evidence | Required service/browser evidence and honest ceiling | Tasks |
| --- | --- | --- | --- |
| AC1 | Real P3/P4 paths over SDK doubles; P5 public live-WS denial with zero providers; dictation socket retained. | Selected target carries microphone **and** assistant tracks; actual media/ICE observation. Fixtures do not certify RTP/FFI/device operation. | 2–5, 7–10 |
| AC2 | Existing dictation draft/finalize/PCM and text HTTP/SSE/history suites; mode switching, unsent draft preserved. | Authorized real dictation/text smoke around live failure/rollback; no silent old-transport fallback. | 3, 6–8, 10 |
| AC3 | One runtime/reservation owner, duplicate EndOfTurn once, acceptance before inference, terminal-write barrier, saved-result recovery without inference replay. Native record/checkpoint checks are separate. | Actual admitted isolated database; persistence skips remain blocked durability evidence, not in-memory certification. | 4–7, 9 |
| AC4 | Queue invalidation before cancellation, known-prefix vs unknown speech, stale epoch/control rejection, rejoin without replay, pause still accepts end. | Actual output stop and no stale tail after explicit interrupt, Flux barge-in and reconnect on named device; timer/element state is not acoustic proof. | 3–6, 8, 10 |
| AC5 | Origin/client-identity/room/epoch/token grant negatives; secret-safe artifacts; backend-only keys, short TTL and active teardown. | Selected hosting/access boundary, secure context/autoplay/permission, actual end/rejoin/remote-room uncertainty; no public authentication claim. | 1, 2, 5–10 |
| AC6 | Input/output/connect/reconnect bounds, quiet STT upload gate, pause/end, quota denial/no provider work, identity and exactly-once local accounting callbacks, P6 guard tests. | Fresh authorization, guarded egress and actual known/estimated/unknown usage plus independent SFU/TURN exposure. No guaranteed invoice/exactly-once billing claim. | 5–10 |
| AC7 | P6 monotonic/boundary/count/failure/comparison tests; baseline retained. | Observed startup, received/decoded onset, **separate** audible onset; matching settings/clock/boundaries before deltas, uncertainty and small-n p95. | 1, 7, 9, 10 |
| AC8 | Finite error/rejoin/cleanup fakes; operations documentation consistency. | Matched authorized fixed impairment on both transports; actual applied profile/candidate/placement, restoration and deployment/cost trade-offs. | 5, 7, 8, 10 |
| AC9 | All commands/counts/skips/source identity and dispositions recorded, no hidden regressions; review SKIPPED. | Missing approvals/target/hardware/comparable baseline are BLOCKED; full workflow remains incomplete until required evidence and orchestrator final report. | 1–10 |

## Failure routing — P8 is not an unrestricted fixer

Every handoff contains exact test/filter, expected/actual result, source identity, sanitized trace, boundary class, proposed responsible seam, and blocking AC. Keep a red regression in P8 if appropriate; wait for the owner's test-backed commit and rerun it. Do not change a product assertion to the bug's behavior.

| Owner | Route these defects; P8 must not edit | Current named gate / minimum rerun |
| --- | --- | --- |
| P1 (including P1b) | Shared schemas/guards, descriptor mode binding, watermark/proof/packet limits, config validation/redaction/dependency compatibility. | Contract incompatibility blocks consumers. Rerun backend contracts and frontend protocol tests plus affected P8 test after owner commit. |
| P2 | Admission/origin/server identity/idempotency/lease, token grants/expiry/rejoin/revocation, session lifecycle/reservation release. | H1 non-consuming dictation-only claim; H3 one shutdown terminal/uncertain cleanup. Rerun `test/voice/session/`, gateway and assembly checks. |
| P3 | PCM framing/rate/quiet upload gate/output bounds, provider/flow/delivery/usage/cancel handling, proof before persistence and transport observation. | H2 end while paused; H4 observations; `unproven` ACK reaching generated ceiling cannot complete. Rerun bridge/pipeline/usage and P8 lifecycle checks. |
| P4 | Actual frontend live client/controller/playback, one mic, permission/autoplay/rejoin, stale track and genuine progress semantics. | H5 elapsed-time/continuous-track attribution and stale jitter buffer are unproven. No fixture ACK can close hardware proof gate; rerun P4 focused + migrated P8 tests. |
| P5 | AppService/module composition, dictation-only gateway cutover, passive readiness/degradation, concurrent drain/sole persistence-close owner. | Partial `3d84aa0` not complete. Rerun voice-bootstrap e2e, gateway/readiness/shutdown and text/dictation assembly. |
| P6 | Missing WebRTC runner/driver/comparison/metadata/methodology, guards/output fences/clocks/summary/comparability bugs. | Inspected old driver is unsafe to reuse. Require actual handoff for all missing files/interfaces; rerun `npm run test:benchmark` after build, not merely historical 91-test claim. |
| P7 | Procedure/setup/env/proxy/security/ports/cost/rollback contradictions or nonexistent drill steps. | Require committed operations runbook consistent with completed P5; P7 corrects docs/examples, not P8. |
| P8 | Wrong test-only transport/fixture assumptions, ignored overrides, test discovery under P8 paths, inaccurate new evidence/report wording. | Fix only owned paths; retain original security/durability/Canvas/dictation intent. |

Unrelated existing Calendar/performance/build-artifact failures go to the orchestrator for the actual subsystem owner, not a guessed voice fix. Five reported baseline files are `backend/test/performance/durable-latency.spec.ts`, `confirmed-state-cache.spec.ts`, `backend/test/runtime/calendar-recovery-unavailable.spec.ts`, `backend/test/integration/plugins/multi-calendar/authority.spec.ts`, and `backend/test/assembly/calendar-simplification.built.spec.ts`. Their recorded 25 failures are historical context, not a waiver or proof that any new failure is pre-existing.

## Task 1: Establish preservation inventory and reports that fail closed

**Files:** create `verification.md`, `comparison.md`; new ignored offline evidence leaf. No source/test/benchmark edits.

- [ ] **1. Obtain worker-start handoff.** Ask the orchestrator for exact final P1–P7 hashes, P5 H1–H5 outcomes and source/dirty identity; do not ask it to ingest plans. Reconcile the P6 discrepancy above. If prerequisites are incomplete, return a blocked-worker report; planning readiness does not authorize independent P8 implementation.
- [ ] **2. Red document check**, root working directory:

  ```powershell
  node -e "const fs=require('node:fs');const a=require('node:assert/strict');for(const p of ['docs/live-voice-webrtc/verification.md','docs/live-voice-webrtc/comparison.md'])a.ok(fs.existsSync(p),p);"
  ```

  Expected missing-file assertion before creation. If user work already supplies either file, read/preserve it and report an already-green check, never overwrite it to manufacture red.
- [ ] **3. Create reports with these exact sections and initial assertions.** Record the supplied historical evidence with attribution, not a newly executed pass:

  - `verification.md`: `# Live voice WebRTC verification`; `## Source and environment`; `## Authorization ledger`; `## Deterministic checks`; `## Native persistence`; `## Live service and browser gates`; `## Acceptance matrix`; `## Failure routing`; `## Cleanup and rollback`; `## Raw evidence and privacy`; `## Completion matrix`; `## Review`. Initial live status: `BLOCKED — no selected LiveKit target or renewed paid/browser/network authorization.` Initial review: `SKIPPED — user selected --skip review; no reviewer dispatched.`
  - `comparison.md`: `# Live voice WebRTC comparison`; `## Verdict`; `## Retained WebSocket baseline`; `## Metric boundaries`; `## Matching and provenance`; `## Samples and failures`; `## Deltas`; `## Audibility interruption and impairment`; `## Deployment and cost`; `## Limitations`. Initial verdict: `INCONCLUSIVE — no new observed WebRTC run; fixture results are not latency measurements.` No invented after values, zero-use assertions, or completion date.
- [ ] **4. Exclusively reserve the offline evidence leaf and inventory immutable files.** Root PowerShell; uses only Node built-ins, does not read secret settings or start a service:

  ```powershell
  $env:P8_OFFLINE_NAME = 'p8-webrtc-' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd-HHmmss') + '-' + [guid]::NewGuid().ToString('N')
  node -e "const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');const n=process.env.P8_OFFLINE_NAME;if(!/^p8-webrtc-[A-Za-z0-9_-]+$/.test(n||''))throw Error('Invalid evidence name');const d=p.join('backend/benchmark-results',n);fs.mkdirSync(d);const roots=['backend/benchmark-results/ws-live-2026-11-05','backend/benchmark-results/ws-baseline-2026-11-05/audio'];const files=[];function walk(x){for(const e of fs.readdirSync(x,{withFileTypes:true})){const f=p.join(x,e.name);if(e.isSymbolicLink())throw Error('Unexpected link');if(e.isDirectory())walk(f);else if(e.isFile())files.push(f);}}roots.forEach(walk);files.push('docs/voice-latency-benchmark/websocket-live-baseline-2026-11-05.md');const rows=files.sort().map(path=>({path,bytes:fs.statSync(path).size,sha256:c.createHash('sha256').update(fs.readFileSync(path)).digest('hex')}));fs.writeFileSync(p.join(d,'immutable-inputs.json'),JSON.stringify(rows,null,2),{flag:'wx'});console.log(d);"
  ```

  Expected new ignored path and a manifest, never baseline writes. Missing historical inputs block raw normalization/comparison; do not regenerate/copy today's config into them. Preserve all baseline bytes, including failed preflight evidence outside the enumerated roots; never delete those directories either. Store `$env:P8_OFFLINE_NAME` in the worker handoff so later commands use this exact leaf, not a latest-run guess.
- [ ] **5. Green document check:** rerun step 2. Verify initial baseline prose: 8/8 completed, 1 warmup + 7 measured; PCM receipt p50 **7800.7875 ms**, exploratory p95 **17696.4213 ms** (report rounded 7.801/17.696 s), startup p50 **1479.5052 ms**, p95 **2216.6611 ms**; run ID `9ab4762c-c960-406f-adcf-84d91f265d56`; source hash `e916bc586fafc4c2950791fb7cc1c46589623545b63dc11394631320ff4b0432`; compiled post-run audit hash `4574aa2847ce323eb0250b8bdf64fb9bb4448218dc17a5acdfc32870396fd64a`, explicitly not independently sealed pre-run build.
- [ ] **6. Commit request:** `docs(voice): establish P8 evidence and blocked live gates`. Stage only the two reports, never raw evidence or this planner's upstream files.

## Task 2: Use the actual frontend live client, not ignored PCM overrides

**Files:** replace body/update header of `frontend/src/features/voice/integration-tests/matrix-fixture.ts`; migrate permission/mute/lifecycle portions of `voice-matrix.test.ts`. P4 fixture/source stays read-only.

- [ ] **1. Capture red**, frontend working directory:

  ```powershell
  npm test -- src/features/voice/integration-tests/voice-matrix.test.ts -t "permission"
  ```

  Expected existing denial assertion fails because the legacy capture override is ignored, not because permission was really requested. Save actual failure names/counts.
- [ ] **2. Replace the matrix fixture after its mandatory header with this actual composition.** Its synthetic clock and structural element prove only software behavior; do not name them audible observations. The optional response/http/bindings arguments also let the backend relay reuse it without copying controller code.

  ```typescript
  import { vi } from 'vitest';
  import { RoomEvent } from 'livekit-client';
  import { LiveKitVoiceClient, type LiveKitVoiceClientOptions } from '../../../api/livekit-voice-client.ts';
  import { liveSession, rtcFixture, remoteAudioTrack } from '../../../api/testing/livekit-fakes.ts';
  import { INPUT_AUDIO, OUTPUT_AUDIO, LIVEKIT_CONTROL_TOPIC, encodeVoiceControlPackets,
    livekitAgentIdentity, type CreateVoiceSessionResponse, type PublicVoiceConfig,
    type VoiceServerPayload } from '../../../api/voice-protocol.ts';
  import { LiveVoiceController, type LiveVoiceControllerPorts }
    from '../state/live-voice-controller.ts';
  import { settle } from '../state/testing/live-voice-fixture.ts';

  export function matrixFixture(permission: 'granted' | 'denied',
    overrides: Partial<Pick<LiveVoiceControllerPorts, 'http' | 'bindings'>> = {},
    response: CreateVoiceSessionResponse = liveSession(),
    clientOptions: LiveKitVoiceClientOptions = {}) {
    const rtc = rtcFixture();
    if (permission === 'denied') rtc.microphone.mockRejectedValue(
      new DOMException('fixture denial', 'NotAllowedError'));
    const config: PublicVoiceConfig = { protocolVersion: 1,
      enabledModes: { dictation: true, live: true }, supportedLocales: ['en-US'],
      limits: { ...response.limits }, inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO };
    let draft = 'Unsent original', owner: string | null = null;
    let close: (() => void) | undefined, sequence = 0;
    const http = {
      create: vi.fn(async (): Promise<CreateVoiceSessionResponse> => structuredClone(response)),
      end: vi.fn(async (_id: string) => {}),
    };
    const bindings = {
      claimVoiceInput: vi.fn((_mode: 'live', callback: () => void): string | null => {
        if (owner) return null; owner = 'lease-1'; close = callback; return owner;
      }),
      writeVoiceDraft: vi.fn((token: string, text: string) => {
        if (token !== owner) return false; draft = text; return true;
      }),
      releaseVoiceInput: vi.fn((token: string) => { if (token === owner) owner = null; }),
      bindVoiceConversation: vi.fn((token: string, _id: string) => token === owner),
      refreshSessions: vi.fn(),
    };
    let client!: LiveKitVoiceClient;
    const controller = new LiveVoiceController({ http: overrides.http ?? http,
      bindings: overrides.bindings ?? bindings, support: () => true,
      client: callbacks => {
        client = new LiveKitVoiceClient({ ...callbacks, ...rtc.options,
          random: () => 0.5, ...clientOptions });
        return client;
      } });
    const event = (payload: VoiceServerPayload, epoch = response.connectionEpoch) => {
      const n = sequence++;
      const json = JSON.stringify({ protocolVersion: 1, sessionId: response.sessionId,
        connectionEpoch: epoch, eventId: `integration-${n}`, sequence: n, ...payload });
      for (const bytes of encodeVoiceControlPackets(json, 'server', 'live')) {
        rtc.emit(RoomEvent.DataReceived, bytes,
          { identity: livekitAgentIdentity(response.sessionId) }, 0, LIVEKIT_CONTROL_TOPIC);
      }
    };
    const listening = () => event({ type: 'voice.state', input: 'listening',
      agent: 'idle', connection: 'connected' });
    const start = async () => {
      await controller.start({ text: draft, start: 7, end: 15, direction: 'backward' }, null, config);
      await settle();
    };
    const begin = async () => {
      await start();
      event({ type: 'session.ready', limits: response.limits,
        effectiveAudioSettings: response.effectiveAudioSettings });
      await settle(); listening(); await settle();
    };
    const track = remoteAudioTrack();
    const attach = () => rtc.emit(RoomEvent.TrackSubscribed, track, {},
      { identity: livekitAgentIdentity(response.sessionId) });
    return { controller, config, response, http, bindings, rtc, track, attach,
      client: () => client, event, listening, start, begin,
      draft: () => draft, close: () => close?.(),
      advance: async (ms: number) => {
        rtc.clock.value += ms; await vi.advanceTimersByTimeAsync(ms); await settle();
      } };
  }
  ```

  Do not use this helper's `event` across an epoch rotation: its sequence belongs to one epoch. Reconnect cases use the explicit new-epoch packet helper in Task 3. Do not add aliases named `frame`, `capture`, `context.sources`, or `sendInput` to satisfy stale tests.
- [ ] **3. Migrate permission and mute assertions explicitly.** `f.getUserMedia` becomes `f.rtc.microphone`; this verifies one SDK microphone request, **not** a second `getUserMedia`. Do not retain the old worklet-load expectation for live. Replace the granted test body with:

  ```typescript
  const f = matrixFixture('granted');
  try {
    await f.begin();
    expect(f.rtc.microphone).toHaveBeenCalledOnce();
    expect(f.rtc.participant.publishTrack).toHaveBeenCalledOnce();
    expect(f.rtc.mediaTrack.enabled).toBe(true);
    await f.controller.toggleMute();
    expect(f.rtc.mediaTrack.enabled).toBe(false);
    await f.controller.toggleMute();
    expect(f.rtc.mediaTrack.enabled).toBe(false);
    f.listening(); await settle();
    expect(f.rtc.mediaTrack.enabled).toBe(true);
    expect(f.rtc.microphone).toHaveBeenCalledOnce();
    f.controller.exit(); f.controller.exit(); await settle();
    expect(f.rtc.mic.stop).toHaveBeenCalledOnce();
    expect(f.rtc.room.disconnect).toHaveBeenCalledOnce();
    expect(f.http.end).toHaveBeenCalledOnce();
  } finally { f.controller.exit(); await settle(); }
  ```

  Denial: one `rtc.microphone`, no `http.create`, unchanged draft and resumable notice. Existing standalone dictation selection/finalization assertions stay. For custom draft start, use the actual controller as before; spy on `f.client().dispose` **after** it exists. Keyboard stop asserts `rtc.audio.muted` and `track.detach`, not Web Audio source stops. Backgrounding asserts `rtc.mic.stop`; visibility alone must not request another mic. SSR/CSS/safe-IME checks remain.
- [ ] **4. Green:** rerun the file with no filter. Require nonzero discovery, no real Room/microphone factory, no legacy capture override, no extra HTTP admission, one disconnect/end/release. If the actual client cannot meet the lifecycle, keep the test and route P4; do not fix P4 source.
- [ ] **5. Commit request:** `test(voice): integrate the live controller with LiveKit SDK doubles`. Stage only `matrix-fixture.ts` and `voice-matrix.test.ts`.

## Task 3: Reconcile frontend pipeline/cost/Canvas regressions by boundary

**Files:** `pipeline.test.ts`, `investigation.test.ts`, `cost-flow.test.ts`, `canvas-multimodal.test.ts` in `frontend/src/features/voice/integration-tests/`.

- [ ] **1. Red**, frontend directory:

  ```powershell
  npm test -- src/features/voice/integration-tests/pipeline.test.ts src/features/voice/integration-tests/investigation.test.ts src/features/voice/integration-tests/cost-flow.test.ts src/features/voice/integration-tests/canvas-multimodal.test.ts
  ```

  Record which failures are obsolete test seams versus actual product failures. The 17 reported failures are an input, not an expected green count.
- [ ] **2. Migrate one scenario per red/green cycle**, retaining this mapping in `verification.md`:

  | Existing intent | New executable observation |
  | --- | --- |
  | Three irregular bursty replies/exact cumulative samples | Real live client receives `audio.start` + bounded `audio.watermark`; three **absolute** 24 kHz coordinates; no credit before ceiling, no credit past ceiling, no previous-response cursor masquerading as new speech. Virtual element/clock only, not sample-exact device playback. |
  | Lost first binding/rejoin/shutdown | `RoomEvent.Disconnected`; same HTTP idempotency key and bound conversation; newer room/participant epoch; stopped old mic/element; no input until explicit gesture/listening; terminal shutdown does not reauthorize. |
  | Nonterminal provider/policy pause | Reliable Room controls remain usable; no `room.disconnect` on nonterminal event; recoverable resume waits listening; quota/duration remains blocked without extra create. |
  | Pre-start interrupt | Zero earned samples, mute/detach before `publishData`, no cursor on a cancelled response, no claim that muted SDK output proves jitter-buffer flush. |
  | Send-time disconnect | Reject `rtc.participant.publishData` during controller control; actual client loss callback suspends; no inferred PCM send path. |
  | Quiet-cost flow | Server `voice.state input:suspended` changes UI without disabling native mic or emitting client `input.suspend`; server listening resumes UI without mic reacquisition. Actual five-second paid upload count belongs to Task 5. |
  | Canvas close/reopen/tab/replay | Same client/Room/mic/track identities and unchanged publish/capture/stop counts. Preserve safety, archive merging and artifact idempotency. |
  | Canvas stop-before-network | Real attached track/audio element is muted/paused/detached synchronously before rejected interrupt send; artifact retained. |

- [ ] **3. Use this complete cursor test as the replacement first pipeline guard**, importing `matrixFixture` and `settle` (remove live PCM packet construction imports only when unused):

  ```typescript
  it('bounds three virtual live responses by absolute watermark coordinates', async () => {
    vi.useFakeTimers(); const f = matrixFixture('granted');
    try {
      await f.begin(); f.attach();
      let first = 0, generated = 0;
      for (let n = 1; n <= 3; n++) {
        const ref = { turnId: `t${n}`, responseId: `r${n}` };
        f.event({ type: 'audio.start', ...ref, sampleRate: 24000,
          firstAudioSequence: n - 1, firstAudioSample: first });
        expect(f.client().progress().playedSamples).toBe(first);
        const last = first + 52825;
        f.event({ type: 'audio.watermark', ...ref, firstAudioSample: first,
          queuedSamples: 52825, lastAudioSample: last, final: true });
        f.client().progress(); // Arm the explicitly virtual observation clock.
        await f.advance(2300);
        expect(f.client().progress().playedSamples).toBe(last);
        f.event({ type: 'audio.end', ...ref, lastAudioSequence: n - 1,
          firstAudioSample: first, lastAudioSample: last });
        await f.advance(100);
        expect(f.controller.getSnapshot().agent).toBe('idle');
        generated += 52825;
        first = Math.ceil(last / 24) * 24; // Next response origin is millisecond aligned.
      }
      expect(generated).toBe(158475);
      expect(f.rtc.participant.publishTrack).toHaveBeenCalledOnce();
    } finally { f.controller.exit(); await settle(); }
  });
  ```

  This guards the software watermark contract, not acoustic proof. If P4 changes progress to correctly remain unproven absent supported observations, reconcile the test to expect unproven/no-drain and route the explicit supported-progress fixture contract to P4; never force real production elapsed time to count as heard merely to keep this illustrative positive test.
- [ ] **4. Rejoin uses two existing SDK doubles without copying transport logic.** Use Task 2's fourth argument, with `first = rtcFixture(), second = rtcFixture()`, `room: vi.fn().mockReturnValueOnce(first.options.room()).mockReturnValueOnce(second.options.room())`, and `microphone: vi.fn().mockImplementationOnce(first.options.microphone).mockImplementationOnce(second.options.microphone)`. Return `liveSession(2)` with the discovered conversation and fresh expiry from `f.http.create` on reauthorization; never only change `connectionEpoch` while leaving participant identity at epoch 1. For this case use `f.start()` followed by `first.ready()`/`first.event(...)`, not `f.begin()` (the helper's default emitter targets its own Room). Emit `RoomEvent.Disconnected` on first, advance 250 ms, then `second.ready(2)` and `second.event(..., 1, 2)` with sequence reset for epoch 2. Resume gesture/listening must enable only second's mic. Assert the request idempotency key is unchanged, old Room listeners are removed, epoch-1 packets cannot update epoch 2, and no new mic/input before the gesture. Reuse `first.options.element` for the no-output reconnect case; no acoustic assertion is made. Do not construct simultaneous backend executors.
- [ ] **5. Minimal quiet-cost replacement test**, preserving dictation's existing CaptureGate tests elsewhere read-only:

  ```typescript
  it('reflects backend quieting without a second capture or client VAD upload gate', async () => {
    const f = matrixFixture('granted');
    try {
      await f.begin();
      const requests = f.rtc.microphone.mock.calls.length;
      f.event({ type: 'voice.state', input: 'suspended', agent: 'idle', connection: 'connected' });
      await settle();
      expect(f.controller.getSnapshot().input).toBe('suspended');
      expect(f.rtc.mediaTrack.enabled).toBe(true);
      expect(f.rtc.packets().some(p => p.type === 'input.suspend')).toBe(false);
      f.listening(); await settle();
      expect(f.controller.getSnapshot().input).toBe('listening');
      expect(f.rtc.microphone).toHaveBeenCalledTimes(requests);
      await f.controller.toggleMute();
      expect(f.rtc.mediaTrack.enabled).toBe(false);
    } finally { f.controller.exit(); await settle(); }
  });
  ```

- [ ] **6. Canvas migration:** replace its fixture import/calls with `matrixFixture('granted', { bindings })`; retain custom `openCanvasArtifact` hooks and all source filtering/renderer/archive/SSR assertions. Media stability uses `f.client()`, `rtc.room`, `rtc.mic`, `track`, `publishTrack`, `microphone`, `mic.stop`, and `room.disconnect`; do not assert deprecated capture starts. For stop ordering, attach before `audio.start`, set a real watermark, spy `rtc.participant.publishData` and decode/reassemble controls; when interrupt is published assert `rtc.audio.muted === true` and `rtc.audio.pause` called, then reject. Require retained visuals and no later progress for the cancelled response. Do not feed `callbacks.audio` to resurrect PCM.
- [ ] **7. Preserve the standalone `AudioPlaybackService` 25+25 exact-sample arithmetic test in `investigation.test.ts`**, rename it to explicitly say `legacy PCM playback arithmetic (not live WebRTC evidence)`. Its coverage remains useful for the retained helper. Replace sendInput-based disconnect with Room loss/send rejection. New-response progress must start at its explicit first absolute sample coordinate, not at zero or the previous response's per-response coordinate.
- [ ] **8. Green:** rerun step 1 and `npm test -- src/features/voice/integration-tests/`. Count executed/passed/failed/skipped. No hidden fixture fallback, test deletion to reduce failure count, or false real-device claims. Route actual implementation failures to P1/P4.
- [ ] **9. Commit requests**, one small group at a time: `test(voice): migrate live pipeline and cost checks to Room controls`; `test(voice): preserve Canvas safety across the WebRTC cutover`. Stage only named P8 test files and any P8 matrix-helper adjustment.

## Task 4: Replace the backend Canvas live-WebSocket relay

**Files:** `backend/test/voice/integration/canvas-multimodal-fixture.ts`, `canvas-multimodal.spec.ts`; `integrated-fixture.ts` only for its shared `liveConfigSnapshot` bootstrap tuple.

- [ ] **1. Red**, backend directory:

  ```powershell
  npm test -- test/voice/integration/canvas-multimodal.spec.ts
  ```

  Expected reported 22 old-transport failures; record actual result. Preserve all passing delimiter/format/guard tests.
- [ ] **2. Correct the shared frozen fixture config**, not production admission. Import `livekitConfigFixture` in `integrated-fixture.ts` and replace its empty bootstrap only inside `liveConfigSnapshot()`:

  ```typescript
  const livekit = livekitConfigFixture();
  const bootstrap = loadBootstrapConfig({ LIVEKIT_URL: livekit.url,
    LIVEKIT_API_KEY: livekit.apiKey, LIVEKIT_API_SECRET: livekit.apiSecret });
  ```

  Pass `bootstrap` to its existing `buildRuntimeSnapshot`. Retain model, quota separation and secret fixture values, never use private `.env`. Snapshot omission cannot be repaired by relaxing production `VOICE_DISABLED` checks.
- [ ] **3. Replace the Canvas transport seam**, importing P5's offline helper **before** any module binding RTC, and Task 2's P8 matrix fixture. Keep the existing `textConfigFixture`, streaming model, CAS trace, speech queues, artifact/message/restart helpers. Remove `VoiceConnection`, browser/server WebSocket doubles and `VoiceClient` imports only when no longer used. Use these exact bridge callbacks in the existing fixture body after `sessions` construction:

  ```typescript
  const media = offlineLiveKit();
  let binding!: VoiceBinding;
  o.livekit = media.admission;
  o.openLiveBridge = async (context, ticket) => {
    const epoch = context.response.connectionEpoch;
    const owner = context as VoiceBinding;
    binding = owner;
    let claimed = false;
    const current = () => owner.response.connectionEpoch === epoch && owner.state !== 'ended';
    const bridge = await media.connect({ context, ticket,
      open: async (c, sink, signal) => {
        if (!current()) throw new Error('STALE_CONNECTION_EPOCH');
        if (!claimed) {
          expect(sessions.claimLive(c.response.sessionId,
            ticket.transport.participantIdentity, ticket.transport.roomName)).toBe(c);
          claimed = true;
        }
        return o.open(c, sink, signal) as Promise<LiveFlow>;
      },
      ended: async () => { if (current()) await sessions.end(context.response.sessionId); },
      disconnected: async recoverable => {
        if (current()) await sessions.disconnected(owner, recoverable);
      },
    });
    return { close: () => bridge.dispose() };
  };
  ```

  Replace the old outer `let binding: ReturnType<typeof sessions.claim>` declaration with the declaration above; do not keep a second/shadowed binding. Existing `delivery`/`messages` helpers read this admitted object, set during POST. Import `VoiceBinding` type from `backend/src/voice/session/voice-session.options.ts` with the relative `.js` specifier. **Lifecycle rule:** the single cast consumes P2's current `issue(entry)` registry-object contract exactly as P5 does; the claim identity assertion exercises it. Before using this fixture, reconcile P2's final committed hook type/identity. If it changes, obtain the typed owner handoff; do not construct another binding, re-claim on disconnect, create a second reservation, or assert safe cleanup from a cast. A recovered paid flow in the same epoch must not claim twice. This is test wiring, not an alternative application assembly implementation.
- [ ] **4. Relay actual packet bytes between existing Room doubles**, after `created`, `media.last()`, and `ui = matrixFixture('granted', { http: { create: async () => structuredClone(created.response), end: id => sessions.end(id) }, bindings: existingCanvasBindings }, created.response)` exist. Use one reassembler for event inspection, not permissive JSON logging:

  ```typescript
  const epoch = media.last();
  const serverRoom = epoch.rtc.rooms[0];
  const rx = new VoiceControlReassembler('server', 'live', {
    sessionId: created.response.sessionId, connectionEpoch: created.response.connectionEpoch });
  const sendControl = vi.fn((event: VoiceServerEvent) => {
    events.push(event);
    if (event.type === 'canvas.artifact') trace.push('artifact-sent');
  });
  serverRoom.localParticipant.publishData.mockImplementation(async (bytes: Uint8Array) => {
    const result = rx.push(bytes);
    if (result.status === 'complete') sendControl(result.event);
    ui.rtc.emit(RoomEvent.DataReceived, bytes,
      { identity: livekitAgentIdentity(created.response.sessionId) }, 0, LIVEKIT_CONTROL_TOPIC);
  });
  ui.rtc.participant.publishData.mockImplementation(async (bytes: Uint8Array) => {
    serverRoom.emit('dataReceived', bytes,
      { identity: created.response.livekit!.participantIdentity },
      DataPacketKind.KIND_RELIABLE, LIVEKIT_CONTROL_TOPIC);
  });
  ```

  Import `RoomEvent` from browser SDK and `DataPacketKind` from mocked node SDK; both sides use P1/P1b reassembly. `sendControl` throw/rejection is the new transport failure-injection seam. Never catch parser failures with console logs and continue. Do not copy a server event through `ui.event`, which would invent a new envelope/sequence.
- [ ] **5. Change fixture startup/observation helpers explicitly.** `begin`: actual controller start → settle/ready → `epoch.microphone()` → `ui.attach()` → enqueue synthetic STT EndOfTurn. `tick` advances `ui.rtc.clock.value` and fake timers, not an unused Web Audio context. `audio(count)` pushes TTS PCM as before and observes `epoch.rtc.sources[0].captureFrame`, not browser binary receipt. Expose `media`, `epoch`, `source`, `sendControl`, `control: (payload) => ui.client().control(payload)`, and `microphone: () => epoch.rtc.pushFrame(new Int16Array(1280).fill(1000))`; remove the obsolete socket/connection return fields.
- [ ] **6. Make positive completion an explicit synthetic-proof action.** After client creation, `vi.spyOn(ui.client(), 'progress').mockReturnValue({ playedSamples: 0, playedMs: 0, proof: 'unproven' })` prevents the cross-layer fixture's timer from silently earning durable hearing. Keep a named `ack(playedSamples, proof)` method that sends the actual `playback.progress` control with current response and explicit proof. `finishAudio` pushes `speech-completed`, waits the actual final watermark, then **only its positive fixture completion path** sends `ack(final.lastAudioSample, 'proven')`; assert no completed delivery before this test-supplied ACK. This is synthetic client evidence, not device proof. Negative tests can send unproven/no ACK and settle unknown on disconnect. Do not change production progress, bypass outputQueueMs, or call runtime settlement directly.
- [ ] **7. Preserve Canvas assertions and migrate only observations.** Replace `f.ui.frame()` with `f.microphone()`, `f.server.send` fault/timing hooks with typed `f.sendControl`, `f.connection.dispose()` with P2 session end/drain plus bridge dispose. Retain artifact CAS-before-send order, all supported visual variants, partial/malformed/oversized filtering, interrupt before/during/after visual, blocked CAS, rejected CAS, publication/memory failure, two reconciliations without reinference, and context ownership. Remove old `context.sources[...].start`/`AudioPlaybackService.observations` assertions from live integration; replace with `captureFrame`/watermark order, bounded output queue, pending-before-proof and explicit fault detector tests. Preserve the standalone `timingGates` oracle but rename `firstAudible` and clock labels to `virtualOutputProxy`/`virtual-proxy`; no live trace gets `browser-audible` from a fake clock. Real underrun/gap/stop timing is Task 10, blocked meanwhile. Record relocated coverage in the verification matrix rather than pretending exact Web Audio scheduling remains the production path.
- [ ] **8. Green:** rerun step 1; then `npm test -- test/voice/integration/canvas-multimodal.spec.ts test/voice/transport/livekit-media.spec.ts test/voice/agent/livekit-pipeline.spec.ts`. All retained invariant checks must pass or have an owner handoff, never `it.skip` for a product defect.
- [ ] **9. Commit request:** `test(voice): migrate the Canvas integration relay to LiveKit boundaries`. Stage only the three named P8 files actually changed.

## Task 5: Leave small integrated checks for proof, quiet cost, and terminal controls

**Files:** create `backend/test/voice/integration/webrtc-lifecycle.spec.ts`; minimal additions to the P8 Canvas fixture's explicit control/observation helpers. Reuse existing providers/runtime, no new general fixture framework.

- [ ] **1. Add this failing proof regression** after the mandatory new-file header:

  ```typescript
  import { afterEach, expect, it, vi } from 'vitest';
  import { canvasPipeline } from './canvas-multimodal-fixture.js';
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('unproven generated-ceiling ACK cannot persist completed heard delivery', async () => {
    vi.useFakeTimers(); const f = await canvasPipeline();
    try {
      await f.begin(); await f.push('Hello world.'); await f.endModel(); await f.audio(2400);
      const ref = f.ref();
      f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'canvas-speech',
        audioDurationMs: 100, usage: { providerRequestId: null, model: 'fixture',
          modelVersion: null, audioMs: 100, billableCharacters: 12 } });
      await f.until(() => f.events.some(e => e.type === 'audio.watermark' && e.final));
      const final = f.events.findLast(e => e.type === 'audio.watermark' && e.final);
      if (!final || final.type !== 'audio.watermark') throw new Error('Missing final watermark');
      expect((await f.delivery())?.status).not.toBe('completed');
      f.control({ type: 'playback.progress', ...ref, playedSamples: final.lastAudioSample,
        playedMs: Math.floor(final.lastAudioSample / 24), proof: 'unproven' });
      await f.tick(100);
      expect((await f.delivery())?.status).not.toBe('completed');
      expect((await f.delivery())?.textSpoken).not.toBe('Hello world.');
    } finally { await f.close(); }
  });
  ```

- [ ] **2. Red:** `npm test -- test/voice/integration/webrtc-lifecycle.spec.ts -t "unproven generated-ceiling"`. If P3 has already fixed the reported defect, this should already pass; record it as a guard, not fabricate red. If it fails on delivery, route P3 and preserve the failing regression; only fix P8 wiring errors locally.
- [ ] **3. Add each additional small scenario with explicit existing helpers and inspect one failing assertion before moving on:**

  | Test name/filter | Driver and exact invariant |
  | --- | --- |
  | `proven fixture ACK waits for terminal persistence` | Begin/push/endModel/audio; block `h.p.metadata.compareVoiceDelivery` when status becomes completed using a deferred Promise. Send positive fixture ACK. No completed delivery/response release before resolving writer; after resolve, one completed record. Release gate in finally. This is fixture write-barrier proof, not native durability. |
  | `quiet frames stop paid STT uploads without accepting an empty turn` | Begin live without enqueuing STT EndOfTurn (add `begin(false)` to P8 fixture). Publish mic; feed 63 silent 1280-sample frames with 80 ms fake-clock steps. Upload count stops at quiet transition in [5000,5080] ms. Feed 100 more silent frames: zero new `writeAudio`, no model fetch or accepted transcript. Feed voiced `fill(1000)` frame: existing quiet-resume handshake completes, no buffered replay/second session. Preserve actual P3 contract counts; do not copy the old frontend 62-frame VAD/pre-roll model if different. |
  | `paused quota session still accepts end and cleans up once` | Begin, `epoch.bridge.pause('VOICE_QUOTA_EXHAUSTED', false)`, send reliable `session.end`, advance finite drain budget; require one room deletion/local disconnect/provider close/reservation release; no new model/provider opening. Repeat end/drain is idempotent. H2/P2 failures route owners. |
  | `interrupt flushes before cancellation and rejects late provider audio` | Begin/push/audio; explicit 1200-sample proven fixture ACK then response interrupt. Spy order: source clear before runtime cancel. Feed matching speech-interrupted usage and late PCM; no additional captureFrame, one cancellation/usage settlement and retained known prefix. |
  | `lost transport cannot turn generated text into heard text` | Begin/push/endModel/audio without ACK; emit actual fake Room loss, settle bounded provider close. Delivery unknown/null spoken; no inferred prefix, no automatic model replay. |
  | `denial and duplicate input keep trusted attribution and bounded accounting` | Same provider EndOfTurn ID twice gives one user acceptance/model fetch; request body OpenRouter `user` equals server identity. Quota denial before start opens zero providers. Usage callbacks for the same terminal provider event are not duplicated by end/drain. Reuse P3/P2 owner guards for exact quotas; do not build a second quota implementation. |

  Each test is a 2–5 minute red/green slice; if fixture convenience methods are needed, define them explicitly in `canvas-multimodal-fixture.ts`, not production or P3 test files. Read exact current status names/types; generated-model terminal and heard-delivery terminal are distinct, and an interrupted audio delivery may coexist with a completed generated result.
- [ ] **4. Green commands**, backend:

  ```powershell
  npm test -- test/voice/integration/webrtc-lifecycle.spec.ts
  npm test -- test/voice/integration/canvas-multimodal.spec.ts test/voice/agent/voice-delivery.spec.ts test/voice/providers/accounting.spec.ts test/voice/usage/
  npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
  ```

  P5 e2e is read-only reuse proving actual application composition and H1/H3/readiness/shutdown; no duplicate P8 e2e server is needed. Counts must be nonzero; owner failures block the related AC until corrected and rerun.
- [ ] **5. Commit request:** `test(voice): guard integrated WebRTC proof cost and terminal lifecycle`. Only new spec and necessary P8 fixture changes.

## Task 6: Reconcile native multi-mode/recovery peers without accidentally contacting MongoDB

**Files:** `integrated-fixture.ts`, `multi-mode.spec.ts`, `fault-recovery.spec.ts`; existing `canvas-multimodal.native.e2e-spec.ts` only if required by a proven contract change.

- [ ] **1. Add an explicit gate**, in P8 `integrated-fixture.ts`, replacing the URI-only exported gate. Preserve fail-closed prefix checks and do not print URI:

  ```typescript
  const nativeAuthorized = process.env.AURVIN_VOICE_NATIVE_AUTHORIZED === '1';
  const nativeSupplied = Boolean(process.env.AURVIN_TEST_MONGODB_URI);
  if (nativeAuthorized && nativeSupplied && process.env.AURVIN_TEST_DB_PREFIX !== 'aurvin_p2_test_') {
    throw new Error('Voice native checks require the isolated test prefix.');
  }
  export const nativeConfigured = nativeAuthorized && nativeSupplied;
  ```

  The Canvas native e2e retains **its own** `AURVIN_CANVAS_NATIVE_AUTHORIZED=1` gate. An ambient URI is not permission to run service tests. No planner/worker should set either flag until operator supplies isolated-database authorization.
- [ ] **2. Migrate native fixture live branch only.** Reuse `offlineLiveKit` admission/connect, real `AgentVoiceAdapter`, `LiveFlow`, `DurableChatRuntime`, current config and reservations. Keep real Nest HTTP and the dictation `VoiceGateway`/WebSocket cookie/PCM branch unchanged. Live peer becomes a discriminated union with `mode:'live'`, copied response/epoch, `events()`, `control`, `pcm` feeding RTC frames, `lose()` emitting Room loss, `captured()` exposing source capture count and `wait`; dictation peer alone has `socket`/binary audio. Use P2 claim once in bridge open, callback binding as finalized in Task 4/P5. Keep old Room/source refs before the P3 single-epoch fake resets; no parallel native peers using that global fake. Sequential rejoin only, never mutation of the old descriptor in saved assertions.
- [ ] **3. Replace live-specific call sites:** `p.socket.terminate()` → `p.lose()`; `p.audio.length` → source capture count; `fresh.audio=[]` → no captured frames/no new speak. `startReply` must not wait for runtime completed **before** supplying synthesis/progress: wait accepted delivery/active response and `audio.start`/capture, then let `finishReply` supply matching speech-completed plus explicit final **absolute** watermark ACK with `proof:'proven'`. Never restore the old circular completion ordering or ack a hardcoded 2400 coordinate on later replies. Native CAS/checkpoint/archive checks remain real database checks with fake providers/RTC, not live RTP or audible evidence.
- [ ] **4. Red migration check without services:** with database gate off, run backend build/lint and the no-service Canvas/lifecycle specs importing the shared snapshot. Require no missing-type/import errors. Record native scenarios skipped, not passed. The actual native red/green check below is intentionally blocked without authorization; a skipped test is not a TDD red.
- [ ] **5. Authorized native invocation only**, backend, with operator-injected URI and prefix already private in environment:

  ```powershell
  if (-not $env:AURVIN_TEST_MONGODB_URI -or $env:AURVIN_TEST_DB_PREFIX -ne 'aurvin_p2_test_') { throw 'Authorized isolated database settings required.' }
  $env:AURVIN_VOICE_NATIVE_AUTHORIZED = '1'
  npm test -- test/voice/integration/multi-mode.spec.ts test/voice/integration/fault-recovery.spec.ts
  $env:AURVIN_CANVAS_NATIVE_AUTHORIZED = '1'
  npm run test:e2e -- test/voice/integration/canvas-multimodal.native.e2e-spec.ts
  ```

  Scope/restore flags with `try/finally` in the actual worker terminal. Before this command confirm target is an admitted isolated native replica set, fixture-generated databases only, explicit create/drop permission, no live app executor there, provider ports all injected and no SFU/provider use. First run should expose any remaining obsolete live peer assumptions; then correct only P8 fixtures and rerun. Expected 4 multi-mode + 4 fault-recovery + 3 Canvas native cases execute (recount actual discovery). No test skipping due to missing prerequisites may be counted as native acceptance. Catch topology errors honestly; no Azure compatibility claim.
- [ ] **6. Commit request:** `test(voice): migrate native multi-mode peers and gate database evidence`. Record whether actual native execution was PASS, FAIL or BLOCKED in verification; do not claim fixture migration itself verifies persistence.

## Task 7: Complete no-service regression phase and preserve actual outcomes

**Files:** `verification.md`, `comparison.md`; only necessary P8 test-only corrections. Logs in the new ignored offline leaf.

- [ ] **1. Fence the no-service phase before commands.** Save then remove `AURVIN_TEST_MONGODB_URI`, `AURVIN_TEST_DB_PREFIX`, `AURVIN_VOICE_NATIVE_AUTHORIZED`, `AURVIN_CANVAS_NATIVE_AUTHORIZED` from the test child environment; restore them privately in `finally`. Also disable any other opt-in live/service flags identified by test discovery. Do not run Azure/behavior opt-in scripts or baseline drivers. Never print environment values. Confirm fixed fixtures inject providers/RoomService/RTC; routine checks must not initialize a real SFU connection. Loopback Nest sockets in deterministic e2e fixtures are allowed, external services are not.
- [ ] **2. Run each command separately** (PowerShell redirection to an exclusive log inside the Task 1 leaf is allowed; capture exit immediately, and do not let `Tee-Object` hide the exit status):

  | Directory | Exact command | Required result/classification |
  | --- | --- | --- |
  | backend | `npm run build` | Exit 0; no stale compiled child inputs. |
  | backend | `npm run lint` | Exit 0; actual warning/error counts separate. |
  | backend | `npm test -- test/voice/integration/ test/voice/transport/livekit-media.spec.ts test/voice/agent/livekit-pipeline.spec.ts` | All deterministic cases pass; native skips named. |
  | backend | `npm test -- test/voice/session/ test/voice/providers/ test/voice/usage/ test/http/voice-exclusion.spec.ts test/assembly/voice-context.spec.ts` | Mode isolation/limits/accounting pass; no provider connections. |
  | backend | `npm test` | Actual full routine outcome, including formerly failing 22 Canvas cases and unrelated failures. |
  | backend | `npm run test:benchmark` | Nonzero WebRTC/guard/comparison cases after P6 reconciliation, not only old tests. |
  | backend | `npm run test:e2e` | Actual assembly/text/dictation outcomes, native/service skips listed. |
  | frontend | `npm run build` | Exit 0 type check/bundle. |
  | frontend | `npm run lint` | Exit 0; warnings separate. |
  | frontend | `npm test -- src/features/voice/integration-tests/ src/api/livekit-voice-client.test.ts src/features/voice/dictation/ src/features/chat/` | Former 17 failures reconciled; both retained modes pass. |
  | frontend | `npm test` | Actual full outcome, no browser DOM/device claim from Node Vitest. |

- [ ] **3. For each unexpected failure use systematic debugging, then route by owner.** Classify `P8 fixture defect`, `product defect (owner)`, `independently established pre-existing failure`, `prerequisite skip`, or `missing evidence`. Reproduce named failures individually with `npm test -- <exact-path> -t "<actual test name>"`; do not use this symbolic template as a logged executed command. Record the actual command in verification. After owner commit rerun the focused regression **and** affected full package checks against the changed source; old pass counts expire. Unresolved required failures prevent a regression-free verdict even if unrelated. User/owner disposition must be explicit; P8 cannot self-waive them.
- [ ] **4. Recheck immutable bytes**, root, with the Task 1 environment leaf:

  ```powershell
  node -e "const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto'),a=require('node:assert/strict');const d=p.join('backend/benchmark-results',process.env.P8_OFFLINE_NAME||'INVALID');const rows=JSON.parse(fs.readFileSync(p.join(d,'immutable-inputs.json'),'utf8'));for(const r of rows){a.equal(fs.statSync(r.path).size,r.bytes,r.path);a.equal(c.createHash('sha256').update(fs.readFileSync(r.path)).digest('hex'),r.sha256,r.path);}console.log('P8 immutable evidence: PASS');"
  ```

  Expected PASS. No regeneration, truncation, modification or cleanup of baseline inputs/outputs. Missing/different evidence is a blocker requiring investigation, not a reason to refresh the manifest.
- [ ] **5. Document P6 boundary correction**, superseding research's initial like-for-like inference: `ws-pcm-receipt-v1` measures the first PCM chunk including silence before browser scheduling; `webrtc-decoded-nonzero-after-start-v1` includes jitter/decode and excludes silent frames. Historical PCM output was not retained, so first-nonzero cannot be reconstructed from old timing JSON. First-audio delta and percentage are **null/not comparable**. Startup endpoints may be compared only after config/environment matching. Durable/simulated-playback timing is not comparable to unproven WebRTC playback. Headless audible/stop metrics remain null. No overall improvement from transport choice alone.
- [ ] **6. Commit request:** `docs(voice): record deterministic regression outcomes and evidence limits`. Stage the two reports and named P8 test corrections only. Ask orchestrator for scoped whitespace/status verification and exact committed source identity; no broad staging.

## Task 8: Separate assembled target selection, activation, safety and cleanup gate

**Files:** `verification.md`, `comparison.md`; new ignored authorization/observation manifests only. No provisioning or product fixes.

- [ ] **1. Record this authorization ledger before any service action:** requester/reference/timezone and expiry; selected existing local server vs user-supplied Cloud project; installation/start permission if needed (a target choice alone does not authorize either); signaling/media/TURN endpoints and access boundary; bridge/SFU/client/database/provider placement; permitted synthetic data and microphone/output method; read-only settings and isolated DB create/write/drop scope; specific probes/room lifecycle actions; participant-minutes/bandwidth/infra ceiling and account cap; stop owner; wall-clock and cleanup permission. Secret acquisition uses OpenChamber's private secret card or existing operator environment, never chat text/arguments/artifacts. Unknown target/cost/retention/access values remain unknown and block that action.
- [ ] **2. Red gate check:** before authorization, inspection of `verification.md` must show `BLOCKED` for target/media/provider/browser/network gates and zero **new task-originated** service actions. Do not turn reported historical spend into a new zero-use measurement. Missing approval is expected blocking behavior, not a failed product check.
- [ ] **3. After explicit approval only**, follow **committed P7** setup/protected-access/ports/TURN/secure-context procedure on the approved isolated target. Do not invent an endpoint, region, free tier or installer command. Verify both browser and backend signaling/media directions, actual selected candidate protocol/relay use as aggregates (no IP/SDP/token dump), mic publication and assistant subscription. A mere POST/signaling join without tracks is insufficient. Real application `session.start` opens paid speech, so it additionally requires Task 9/10 egress/spend allocation; do not call a browser handshake free. A media-only synthetic two-participant check may avoid providers only when separately approved and supported by the selected existing procedure.
- [ ] **4. Carry P7 drills D1–D9 into P8 ledger:** actual target/ICE; restricted-network fallback; permission/autoplay; audible/stop; jitter/loss; active/pending shutdown; live-off rollback; protected access and token/rejoin scope; usage/data/cleanup. Mark each `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN` with reason. Leave P7's procedural UNRUN inventory read-only; observed entries belong here. No infrastructure/public rollout certification from documentation checks.
- [ ] **5. Cleanup/rollback for every authorized batch:** stop replay/input, immediately mute/stop local track, explicit session end, await controller/bridge/provider shutdown and accounting/delivery drain, attempt room deletion/participant removal through P2, verify remote disappearance using approved management access or state **unknown**, confirm provider active sockets zero or unknown. Stop **only task-created** processes, release task-owned port/device; preserve generated databases/evidence unless explicit fixture/drop authorization applies. Restore impairment exactly and verify restoration before any subsequent run. If safe drain is false or durable writes unresolved, preserve ownership/sentinel, confirm process stop using existing operations handoff, never delete sentinel or overlap executor.
- [ ] **6. Approved live-off rollback drill:** disable requested live mode via existing settings, explicitly end existing snapshot-bound calls, prove no new live capability/admission and unchanged text/dictation. No automatic WS fallback exists. Retained older-build swap/restore is a **separate** deployment/data-compatibility authorization; no reset/checkout over user work, schema downgrade, prompt replay or application DB purge. Re-enable original approved state only if authorized. All unexecuted rollback steps remain blocked/unrun, not passed.
- [ ] **7. Green gate outcome:** either an explicit referenced approval plus observed cleanup/target result or an accurate blocked ledger. Neither outcome permits P8 full completion while required live evidence is missing. Commit request: `docs(voice): record target authorization and operational evidence gates` (reports only, no secret/raw manifests staged).

## Task 9: Conditional bounded paid headless run and baseline comparison

**Files:** reports and new ignored run/normalization/comparison outputs only. Benchmark code/tests/docs remain P6-owned.

- [ ] **1. Verify P6's actual interfaces before spending.** Require real WebRTC driver/parser/output fences, no-argument/exhausted-approval refusal before env/network, original PCM verification before admission, strict provenance/export allowlist, native cleanup, current guard tests and comparison method. Inspected historical driver cannot satisfy this gate. If still missing, record BLOCKED/P6 and stop this task. A fabricated `approval-reference` is not permission.
- [ ] **2. Request fresh finite authorization — do not assume it:** proposed maximum **8 logical submissions/session creations, 1 excluded warmup + 7 measured, concurrency 1, 90000 ms per case, 900000 ms active/global child limit**. Distinguish logical submission from at most **16 capped model dispatches**, <=60000 context/6000 output tokens each, <=60000 ms aggregate uploaded STT PCM, <=4000 aggregate UTF-8 TTS bytes, <=32 provider sockets. Existing tested conservative tariff reservation is **$0.99847 under pinned rates**, proposed estimated provider ceiling **$1**; validate actual current rates within approved preflight before inference, stop if outside envelope. SFU/Cloud/TURN/egress costs need their own explicit bound/account controls; guard is not an invoice guarantee. Stop on any guard denial, first incomplete/unproven result, unknown accounting/source drift, budget/deadline, or user stop. No auto-retries or invisible replacement warmups.
- [ ] **3. Freeze matching inputs/provenance:** original PCM 183518 bytes, SHA-256 `933c59e38179c0a16df1b26aa1567a8a76ee823c0c0ceaf820feef382412c3a1`, 16 kHz mono PCM16LE, marker **3734.9375 ms**, 80 ms pacing/zero-pad final (72 frames, 5760 ms full replay), fresh conversation/no tools, same model/provider routing/endpointing/voice/locale/limits/assets where demonstrably retained. Export actual source+dirty+pre/post source/build/config/asset hashes, OS/Node/SDK/FFI versions and actual placements/codec/resampling/packetization; unknown packetization/region is null/unverified, not assumed 20 ms/US-East. Source hashes need not equal across implementations; semantics/config/environment matching must be proven. Never fill historical gaps from today's config.
- [ ] **4. Future command, backend only**, after P6 handoff confirms it and authorization is recorded; operator sets **nonsecret** reference and unique output name in the terminal:

  ```powershell
  if ($env:P8_APPROVAL_REFERENCE -notmatch '^[A-Za-z0-9_-]{1,80}$' -or $env:P8_RUN_NAME -notmatch '^webrtc-live-[A-Za-z0-9_-]{1,96}$') { throw 'Recorded fresh approval reference and new output name required.' }
  npm run test:benchmark
  npm run build
  node dist/benchmark/live-baseline.js --live --transport=webrtc "--approval-reference=$env:P8_APPROVAL_REFERENCE" "--output-name=$env:P8_RUN_NAME"
  ```

  Check each preceding exit before next command. Reject an already-existing output leaf; preserve failed/preflight outputs. Never use plain old `--live`, the client-only CLI without a server egress guard, or an application database executor. Expected outcome may legitimately be **exit 2/incomplete**: current headless path does not send invented playback ACKs and may hit the 2000 ms unacknowledged output window. Preserve onset/failure/accounting, stop repetitions, route P1/P3/P4/P6 proof issues. Do not raise queues, synthesize progress, mark `audio.end` completed, or rerun under the same exhausted allocation to obtain eight successes.
- [ ] **5. Retain raw evidence exactly:** driver `context.json`, `benchmark.json`, projected `server.jsonl`, readiness files, safe client status/log, budget, exact `runs/<run-id>/results.json`, report/comparison input plus new `accounting.json`, `safety-check.json`, cleanup ledger and hashes. Preserve warmups, failures, incomplete rows and null metrics. Record observed known model cost, estimated speech cost, unknown invoice/infra exposure separately. Private export-safety comparison must not print secrets; use existing redaction/allowlists and no arbitrary raw SDK/errors/HAR/SDP/transcripts/reasoning/audio output. Only consented synthetic waveform evidence for Task 10 may be privately retained under its separate consent.
- [ ] **6. Normalize legacy data only into a **new** sidecar**, e.g. `$env:P8_RUN_NAME/legacy-ws-comparison-input.json` beneath the new ignored run. Derive sample rows from original raw JSON, verify 1+7 counts and all terminal/delivery pairs using the old evidence, source hash/compiled-audit qualification/context/config/input identities. Missing instruction/environment/config provenance → `complete:false` and blocked matched comparison. Keep `firstAudioBoundary='ws-pcm-receipt-v1'`, simulated playback label; never relabel historical PCM receipt nonzero/audible.
- [ ] **7. Offline comparison invocation**, only after P6 supplies validated inputs. `$env:P8_AFTER_INPUT` is the exact recorded run's comparison-input path, not a wildcard; `$env:P8_COMPARE_OUTPUT` is a new ignored leaf:

  ```powershell
  node dist/benchmark/voice-comparison.js "benchmark-results/$env:P8_RUN_NAME/legacy-ws-comparison-input.json" "$env:P8_AFTER_INPUT" "$env:P8_COMPARE_OUTPUT"
  ```

  Expected strict refusal for incomplete/unmatched runs, or structured output with **null first-audio deltas** across incompatible boundaries. Even valid startup delta cannot imply audible improvement. If a matching boundary is genuinely established by a newly approved retained WS build, report signed `after - before` p50/p95 milliseconds and `100*(after-before)/before`; baseline zero → percentage null. Preserve denominator/sample failures; nearest rank p95 with seven samples is maximum and exploratory, not stable tail/significance. No cross-process monotonic subtraction or summed stage percentiles.
- [ ] **8. Update reports:** actual grant, attempted/warmup/measured/success/failure/skips, usage/cleanup/source stability, side-by-side values with boundary labels, noncomparable/null deltas and measured slower/inconclusive results. Run immutable-input check from Task 7. Commit request: `docs(voice): report guarded WebRTC receipt evidence and comparability` only if a run happened; otherwise `docs(voice): record blocked WebRTC measurement prerequisites`. Never claim a live run from offline benchmark tests.

## Task 10: Conditional browser audibility, interruption, network impairment and final publication

**Files:** reports and new ignored authorized observation outputs. No frontend production instrumentation, benchmark extension, network tool install or deployment edit by P8.

- [ ] **1. Acquire separate finite consent/allocation.** Named browser/OS/device/microphone/output route, synthetic-only capture, acoustic vs OS-loopback method, secure context/user gestures, selected target/build/database, start/end/timezone/stop owner, per-batch session/model/audio/TTS/provider/infra ceilings, tool/privileges/interfaces/seed for impairment and restoration permission. A consented OS loopback is device-output evidence with its documented boundary, **not microphone-at-speaker acoustic onset**. If no calibrated method/tool exists, route missing benchmark capability to P6/operator and mark BLOCKED; do not add unowned tooling.
- [ ] **2. Establish a comparable retained WS build without reverting current work.** Use a user/operator-supplied complete compatible retained build or separately approved isolated checkout with preserved baseline source/build/assets; serialized runs and separate isolated databases, never overlapping executors against one DB or two mic owners. If matching config/device/browser/input/placement cannot be established, record noncomparability. Old headless baseline contains **no** browser audible/stop/impairment data; its gaps cannot be repaired by treating 7.801 s as audible latency.
- [ ] **3. Propose small **separately approved** browser batches, not implied use of the headless eight:** for each transport × profile, 1 warmup + 3 measured normal-reply turns (four onset batches, maximum 16 sessions); separately 3 explicit-interrupt and 3 Flux-barge-in turns per transport × profile (four interruption batches, maximum 24 sessions). Total proposed browser ceiling is **40 logical submissions across eight separately gated batches**, plus the headless proposal's 8 only if independently granted. Each batch must fit a P6/operator-verified egress guard no looser than Task 9 and its separately authorized dollar/infra ceiling; no blanket $9 approval is implied by nine possible $1 envelopes. User may approve fewer: report actual counts and leave unmet evidence blocked. Three-sample p95 is simply maximum, extremely exploratory. Do not pool profiles/interrupt policies or silently recycle unused/failed allocations.
- [ ] **4. Calibrate one observation clock for both waveform endpoints.** Use original consented synthetic input; identify last-input marker and first assistant output on the **same** loopback/acoustic observation clock. Record calibration offset/jitter/resolution/noise floor/detection threshold, output device/routing/sample rate and clock origin, permission/unlock timing, cold/warm state and observed startup separately. Do not subtract a server clock from a client/acoustic clock or label `playing`, subscribe, track attach, `captureFrame`, timer progress or audible-listener opinion as a calibrated timestamp. Retain bounded consented synthetic traces privately only; default retained artifacts remain derived times, not microphone speech/reply content.
- [ ] **5. Exercise permission/device/autoplay and resource boundaries:** denial, ignored prompt until timeout, missing/removed device, blocked autoplay and gesture recovery, background/pagehide, initial join failure, reconnect to a new epoch. Record one microphone capture at a time, stopped old capture/output and no paid provider work after abandoned/failed admission where applicable. Observe continued output absence after old response cancellation and after the new response/reconnect begins; a fresh HTML element on the same track alone is not flush proof. Product failures route P4/P3/P2; do not invent ACKs to finish a browser run.
- [ ] **6. Measure each interruption kind separately.** Fix the consented marker at 500 ms after observed assistant onset, if output is long enough; otherwise mark sample ineligible/failure rather than move the trigger silently. Explicit client action and synthetic Flux-detected barge-in are different cohorts. Measure marker/action to actual output disappearing and **continued absence for 1000 ms**; check stale tail/old response does not reappear on resume/rejoin. Record exact marker detection/action timing, output method uncertainty, runtime cancelled/interrupted/unknown status, generated-versus-spoken evidence and usage. No numerical improvement threshold was approved: report observed stop latency and misses honestly, not an invented SLA.
- [ ] **7. Apply matched network profiles only with approved isolated injector.** Profile `none`: no added impairment. `fixed-delay-jitter-loss-v1`: requested bidirectional 50 ms one-way added delay, ±10 ms jitter, independent 1% packet loss; no bandwidth cap/reordering. Record actual tool/version/seed/affected process/interface/link and separately measured applied delay/jitter/loss. Apply equivalent client↔media-endpoint link to TCP WS and UDP WebRTC, with SFU↔bridge placement recorded; if semantics cannot be matched, label **incompatible**, not transport-equivalent. DevTools HTTP throttling alone does not establish RTP impairment. Restricted UDP/ICE-TCP/TURN-TLS fallback is a separate P7 D2 drill needing explicit network authorization; no shared-host firewall mutation or VPN/adapter reset. Include startup/failed joins/loss/rejoin/underrun/stop observations and timeouts in raw rows, not only surviving replies. Restore original network settings in finally, verify restoration with approved probes, stop on inability to restore.
- [ ] **8. Record deployment/cost trade-offs:** actual bridge/SFU/client/provider routing, direct vs relay candidate, infra/egress/participant-minutes and unknown invoice items, operational complexity/TURN access/secure-context/autoplay limits, existing unauthenticated-development identity boundary. No free-cloud claim, universal placement/RTT multiplier, guaranteed cancellation savings, Azure admission, production readiness or public rollout.
- [ ] **9. Finish exact report content and run document/ownership checks.** `verification.md` records supplied and final actual commit set plus dirty/source/build hashes and command timestamps; Node/npm/OS/browser/device/SDK/FFI; config/assets/input/placements; every command exit and discovered/pass/fail/skip count; per-AC deterministic/native/service/browser evidence links; grant vs observed usage; routed issue/commit/rerun; cleanup/rollback/drill outcomes; private raw manifest paths/hashes; limitations and **Review: SKIPPED**. `comparison.md` records old and new raw per-sample tables (warmup/failures retained), definitions/counts, p50/p95 units and method, matching differences/unknowns, comparable signed deltas only, audible/interruption/profile cohorts separately, total known/estimated/unknown costs, and verdict `improved`, `not improved`, or `inconclusive` supported by matching evidence. A slower result is valid evidence, not successful latency improvement.
- [ ] **10. Run this offline document/link guard**, root directory (checker excludes code fences and never fetches external URLs):

  ```powershell
  $P8DocsCheck = @'
  const fs = require('node:fs'), path = require('node:path'), a = require('node:assert/strict');
  const files = ['docs/live-voice-webrtc/verification.md','docs/live-voice-webrtc/comparison.md'];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    a.ok(!/\b(?:TBD|TODO)\b/.test(text), 'Unresolved placeholder: ' + file);
    const prose = text.replace(/```[\s\S]*?```/g, '');
    for (const m of prose.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      if (/^(?:https?:|mailto:|#)/.test(m[1])) continue;
      const target = path.resolve(path.dirname(file), decodeURIComponent(m[1].split('#')[0]));
      a.ok(fs.existsSync(target), 'Broken local link: ' + m[1]);
    }
  }
  const verification = fs.readFileSync(files[0], 'utf8');
  for (let i = 1; i <= 9; i++) a.ok(verification.includes('AC' + i), 'Missing acceptance row');
  a.ok(/SKIPPED/.test(verification), 'Review must be explicitly skipped');
  a.ok(verification.includes('## Completion matrix'), 'Missing gate matrix');
  const comparison = fs.readFileSync(files[1], 'utf8');
  a.ok(comparison.includes('ws-pcm-receipt-v1'), 'Missing old boundary');
  a.ok(comparison.includes('not audible'), 'Missing audibility qualification');
  a.ok(/exploratory/.test(comparison), 'Missing small-sample qualification');
  console.log('P8 report structure and local links: PASS (not service certification)');
  '@
  node -e $P8DocsCheck
  ```

  Resolve local fragment anchors manually; private missing raw paths are described as unavailable code-text paths, not fabricated links. Rerun Task 7 immutable inventory, relevant package checks after any source change and native/observed gates if affected. Ask orchestrator for named-file whitespace/ownership checks and serialized commit, not broad Git staging.
- [ ] **11. Commit request:** `docs(voice): publish WebRTC verification and before-after evidence`. If service evidence remains blocked, message instead `docs(voice): publish offline verification with blocked live evidence`. No empty commit, raw artifacts, secret files, source fixes, or passing review artifact. Report exact accepted/failing/blocked gates to orchestrator; it owns `state.md` and `final_report.md` and must not mark workflow complete prematurely.

## Exact completion matrix for verification.md

Use these rows and states; never collapse `BLOCKED`, `NOT RUN`, `SKIPPED`, `FAIL` into `PASS`. Add evidence references to actual outputs, not this plan.

| Gate | PASS requires | Otherwise / effect |
| --- | --- | --- |
| G0 upstream/source | Committed P5/P6/P7 implementations with reconciled H1–H5/P6 interface handoffs; exact final source/build identity. | BLOCKED or FAIL; no assembled/live certification. |
| G1 P8 migration | Former 22 backend/17 frontend assumptions reconciled, retained intent and all P8 deterministic tests green. | FAIL/owner route; P8 offline implementation incomplete. |
| G2 full regression | Backend build/lint/routine/benchmark/e2e and frontend build/lint/full tests have actual outcomes, nonzero required discovery and no unresolved required failures. | FAIL or prerequisite-specific NOT RUN/BLOCKED. Historical failures documented separately, not waived. |
| G3 native durability | Authorized isolated replica-set native cases execute/pass, acceptance/history/checkpoint/delivery/accounting/recovery evidence retained. | BLOCKED without URI/prefix/permission; skips do not pass AC3. |
| G4 target/media/security | Approved actual target, bidirectional real tracks, protected access/secure context/permissions, finite teardown/rejoin/ICE observations. | BLOCKED without approval or FAIL on observed defect; fixtures insufficient for AC1/AC5. |
| G5 bounded headless | Fresh grant, P6 actual WebRTC path, expected attempt counts and complete correlated terminal evidence, guard/accounting/cleanup/source stability. | BLOCKED without grant/tooling, FAIL/INCOMPLETE on unproven/partial run; partial onset retained, never successful 1+7 comparison. |
| G6 metric matching | Historical artifacts preserved; explicit compatible metric/settings/environment evidence; null deltas for unlike receipt/playback boundaries. | Comparison BLOCKED/noncomparable for missing baseline identity; no latency win from receipt mismatch. |
| G7 real browser output | Named calibrated output/audible onset + explicit/Flux interruption/old-tail/rejoin observations for matched transports, actual counts/failures and uncertainty. | BLOCKED without hardware/consent/matched WS build; timers/SDK doubles never pass. |
| G8 impairment/operations | Authorized matched profile/fallback tests, applied profile verified, finite shutdown/live-off rollback/drill outcomes and network restoration/cleanup recorded. | BLOCKED/FAIL per drill; operations documents alone do not pass AC8. |
| G9 artifacts/truth | Both required reports, source/command/authorization/raw/privacy/usage matrices and local-link/immutable checks complete; all ACs honestly classified. | P8 reporting incomplete; no workflow completion inferred. |
| Review | **SKIPPED by user instruction**; no reviewer dispatched. | Never a PASS requirement and never reinstated implicitly. |
| Workflow final synthesis | Orchestrator completes required actual evidence and `final_report.md` after P8 handoff. | Outside P8 ownership; remain incomplete while mandatory gates blocked. |

Allowed P8 handoff outcomes:

1. **Offline verification complete; external evidence BLOCKED:** G1 and offline G2 pass, reports/known failure dispositions current, service/native/browser gates explicitly blocked. Useful stopping point, **not P8 full exit or workflow complete**.
2. **Verification failed/incomplete:** required regression, proof, safety/cleanup or owner defect unresolved; identify exact blocker and next owner/action.
3. **P8 verification complete:** all mandatory G0–G9 evidence requirements genuinely met, with Review SKIPPED. A non-improvement may still be a completed honest evaluation; do not label the latency goal improved unless matched observed results support it. Orchestrator still owns final synthesis and rollout is separately unauthorized.

## References and planner self-check

- Existing goal/state and read-only plans 5/6/7 govern owners/prerequisites. Research is background, not authority to propagate illustrative outdated signatures, 15 s reconnect, fixed 20 ms packets, cloud pricing/free-tier quantities or first-audio equivalence.
- Official browser SDK audio documentation queried read-only through Context7 `/websites/livekit_io` on 6 November 2026: <https://docs.livekit.io/reference/client-sdk-js/> and <https://docs.livekit.io/reference/client-sdk-js/classes/Room.html>. Autoplay/startAudio needs a user gesture and SDK canPlaybackAudio is permission/state, not calibrated acoustic proof. No actual device/service check was performed.
- Official browser security reference for the future authorized operator procedure: <https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security>. Use committed P7 official-source ledger for LiveKit ports/token/revocation/placement requirements; do not fetch/contact a target to validate a documentation claim.
- Immutable baseline: [WebSocket live report](../voice-latency-benchmark/websocket-live-baseline-2026-11-05.md). Its original invocation and historical authorization are descriptive, **not repeat permission**. New P6 methodology is currently absent in inspected source; add a local link only once its owner supplies the committed file.
- Planner self-check: ten tasks cover AC1–AC9 and P8 ownership, exact commands/expected classifications, no-service versus native/service/browser gates, bounded proposed spend and separate browser allocations, baseline preservation, comparison incompatibility, rollback/cleanup, defect routing and review SKIPPED. Only this plan is written. No Git, tests, package install, external service activation, paid call, private configuration read, or baseline modification is performed by planning.
