# Offline live-latency follow-up — 8 November 2026

Stock WebRTC input compatibility and missing normal-level timing visibility are
fixed with deterministic regressions. Calendar-enabled ordinary conversation
still uses the durable path; its memory-first migration is **design only** below.
No new live latency improvement, audible playback, complete product goal or
Cosmos compatibility is claimed. Unified review: **skipped**.

## Scope and evidence

Latest authorization is strictly offline investigation/fixes. No paid request,
database/service/loopback benchmark, live retry, provisioning, deployment,
installation, skill, subagent, staging or commit ran. Environment/credential
contents, operator scripts and raw logs were not inspected. Existing reports and
live artifacts remain immutable. The earlier result's authorization label and
`submissionRuleRevoked` are retained historical assertions, not independently
available approval history and not authorization for another run.

Read [live results](live-text-voice-results-2026-11-08.md),
[current implementation](memory-first-remaining-tasks-implementation.md),
[Task 1 contract](memory-first-task-1-contract.md),
[Task 3 report](memory-first-task-3-implementation.md), and current callers.
Sanitized evidence is under these retained directories:

- `backend/benchmark-results/webrtc-live-bounded-2026-11-08T07-12-54-043Z/`:
  text/voice results, results/provenance/preflight JSON and native-frame check.
- `backend/benchmark-results/webrtc-live-voice-2026-11-08T07-19-45-854Z/`:
  voice result, results/provenance/preflight JSON and native-frame adapter check.
- `backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/`:
  summary, results, voice-result/timeline, provenance, preflight, lifecycle,
  shutdown/provenance verification and buffered-input-check JSON.

The final provenance records rtc-node 1.2.1, unavailable FFI version, unverified
SFU/database/provider placement, unknown RTP packet duration and unproven playback.
Lifecycle records one accounted initial text dispatch, zero Calendar/refresh
requests, and server-side provider-user attribution present. The three runs kept
the same allowlisted configuration hashes and Calendar enabled. These facts do
not establish latency distributions, region placement or provider invoice totals.

## Ordinary text: observed time versus source-supported waits

One observed sample: acceptance **14,578.7467 ms**, first received nonempty text
**23,060.5120 ms**, completed-status verification **28,287.0629 ms**. Therefore
acceptance-to-first-text was **8,481.7653 ms**, and first-text-to-verified-completion
was **5,226.5509 ms**, on the client clock. These are arithmetic intervals, not
database/model/transport decompositions. Exactly one initial model dispatch is
supported by durable accounting, despite `analysis.models=[]`. No tool was used.

The source path is:

1. `configure-operations.ts` gates POST and stream attachment through
   `OperationsService.accept`/`acceptForRetry`. `Readiness.readForText` bypasses
   later DB probes only if `runtime.memoryAdmissionReady()` is true. With Calendar
   enabled, `MemoryText.eligible()` is false, so a cached dependency result or
   ping/executor probe remains. The cache is five seconds and shares an in-flight
   probe; source does not establish a fresh probe on each request.
2. `ChatHttpService.submit` validates trusted identity, body, protocol 2 and local
   cross-mode reservation. `DurableChatRuntime.submitTurn` chooses `acceptNewTurn`
   because the Calendar-enabled snapshot excludes memory-first admission.
3. `acceptNewTurn` awaits parallel session/idempotency reads; for a fresh chat it
   creates session metadata, acquires ownership, then loads a healthy context or
   checks the durable boundary. The cold boundary path reads manifest, accepted
   history/attempt evidence and checkpointer state, validates agreement and
   initializes a missing manifest/checkpoint. The healthy path already reuses
   confirmed plain records and a pinned checkpoint when its generation/assets
   constraints hold; it refreshes mutable Calendar/voice evidence.
4. Acceptance reserves the attempt and sequences, writes input and accepted
   attempt (parallel confirmed writes when supported), confirms acceptance,
   calls `admitCalendarBudget` and detaches the accepted lease. The budget-admission
   call reads `connection.currentAccount`; retries can also read an existing
   Calendar budget. Drain/release remain awaited. A memory-publication handoff
   additionally clears the publication marker under ownership when applicable.
5. SSE attachment reacquires accepted ownership, reuses its admission receipt
   where valid, verifies context, starts generating and selects the Calendar
   window for **text**. `runCalendarTurn` reads current account again, constructs
   `CalendarTurnLedger`, loads retained native tool groups and invokes the saved
   Calendar graph. `CalendarLoop.decide` checks the pending proposal slot before
   the first model decision. It advertises `SKILL_NATIVE_TOOLS`, reserves a budget
   and dispatch, checks account currency and ownership, and durably marks model
   dispatch. Even a text-only decision is retained and sealed/published through
   the Calendar decision path.

Primary code: [runtime](../../backend/src/chat-runtime/durable-chat-runtime.ts),
[memory eligibility/execution](../../backend/src/chat-runtime/memory-text.ts),
[readiness](../../backend/src/operations/readiness.ts),
[Calendar loop](../../backend/src/chat-runtime/calendar-loop.ts),
[ledger](../../backend/src/chat-runtime/calendar-budget.ts),
[account authority](../../backend/src/plugins/google-calendar/connection.ts).

These DB awaits are demonstrably on the acceptance/execution critical path.
They are credible contributors; **none can be called the measured dominant
operation** in this sample. Its normal stdout filter retained terminal/task events
but suppressed detailed model and admission milestones. There are no measured
per-admission driver spans proving how much of 14.579 s was DB work, nor text
dispatch/first-token events to split the remaining 8.482 s. Aggregate counts or
the other voice sample cannot fill that gap.

The two account reads are not interchangeable receipts: `currentAccount` reads
the saved connection and checks enabled/configured/grant/lifecycle state;
`requireAccountCurrent` checks revision and subject immediately at execution.
There is no new trusted revision-bound authority receipt permitting their removal.
No readiness/fence/preflight was deleted, and no inference timing is invented.

## Calendar-enabled memory-first implementation boundary — not implemented

Changing `eligible()` alone would route to `createModelServices` without native
tools and would discard the Calendar loop's proposal/history/accounting semantics.
Changing global `graphConfig` durability would break effect recovery. Both are
unsafe. The existing foundation/archive envelopes retain ordinary messages and
voice evidence, not the resumable skill decision/result/cursor/proposal graph.
A safe lazy Calendar path therefore needs this bounded, separately implemented
extension; it does not require disabling Calendar or guessing message intent:

1. **Trusted hydration/invalidation:** extend the single shared conversation
   authority with bounded complete native tool-call/result groups, provenance,
   pending proposal revision/disclosure state, and connection/capability revision
   hints. Cold sessions may hydrate trusted storage. Refresh, disconnect,
   revoke, disable, proposal consumption/expiry and retention/redaction must
   invalidate the appropriate cached view. Client state never grants authority.
   Warm ordinary conversation must not re-read Calendar state on each turn.
   Pending proposals cannot simply be skipped until a model call: today's
   confirmed replies may execute before inference. Preserve that behavior using
   trusted pending state and the existing proposal/reply validation, not a new
   lexical Calendar-intent classifier.
2. **One bounded memory decision loop:** reuse the same advertised native tools,
   skill-disclosure/validation/repair behavior, context assembly and finite
   turn/model/tool budgets in memory. Local activation results form complete
   groups; text-only decisions complete in authoritative memory and use the one
   bounded background writer. Preserve original accepted input once, attribution
   on every model attempt, request deduplication and generation/attempt identities.
   The existing ledger currently requires a durable connection-bound budget for
   the first model request, so it needs an explicit volatile-accounting strategy
   and export/promotion contract, not fake `ConfirmedRecord` values.
3. **Promote only at the actual external-tool/effect boundary:** freeze the exact
   accepted memory version and pending native decision; publish all referenced
   accepted input/context/tool groups and required accounting before handing off
   to an owned durable graph cursor. Derive receipts only from actual confirmed
   writes. Reuse the exact pending decision/tool-call IDs without re-inference
   or duplicate user acceptance. A save failure refuses tool execution while
   retaining the volatile result. Existing `handoff` correctly refuses dirty state;
   a promotion adapter must deliberately bridge it rather than clear that guard.
4. **Keep effect authority durable:** resolve/revalidate trusted account, target,
   grant and revocation at external access, with privacy/retention policy intact.
   Reuse `CalendarOperationWriter.executeCreate`, its accepted-intent validation,
   deterministic operation/event IDs, fresh capability/availability preflight,
   persisted intent/dispatch barriers **before external mutation**, exact readback
   and unknown/reconciliation rules. Do not cache away effect checks. Read tools
   likewise retain current authority, bounds, source provenance and complete
   call/result pairing. Plain completion may remain unsaved; externally effectful
   work must never be represented as safely ephemeral.
5. **Publish and synchronize:** import durable effect/proposal/result state into
   the same memory version stream before later text/live context selection.
   Preserve original approved single-process cross-mode reservation and dirty
   handoff rules, voice heard-versus-generated projection, cold recovery, expiry,
   tombstones and no automatic inference/effect replay. Extend archive/schema
   publication and hydration together rather than only writing tool messages.

Likely implementation files: `memory-text.ts`, `memory-first-foundation.ts`,
`memory-text-archive.ts`, `calendar-loop.ts`, `calendar-budget.ts`, runtime and
shared contracts. Keep operation writer/authority checks as the effect boundary.
Required failing-first fixtures: enabled-Calendar new/warm no-tool text with all
DB ports blocked still dispatches with unchanged tools; complete local tool
groups; cold provenance/revocation/expiry; pending confirmation without extra
inference; blocked promotion forbids external access; confirmed promotion resumes
the same decision once; crash/unknown readback; disable/revoke racing promotion;
idempotent reconnect/retry; and dirty text ↔ voice ↔ Calendar follow-ups. This is
substantial coordinated execution/storage work, not a small safe eligibility fix.

## Voice: disjoint same-clock intervals

All server rows below share `clockOriginMs=1794122689517.804` in the sanitized
[voice timeline](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/voice-result.json).
Times are monotonic `clockMs`; differences are rounded to 0.001 ms. Do not add
overlapping stage `durationMs` fields from the preexisting analysis.

| Server span | Clock endpoints (ms) | Difference (ms) | Interpretation |
| --- | --- | ---: | --- |
| STT EOT → response prepared | 20722.3659 → 24206.0233 | 3483.657 | Local submission/binding/admission/status/control work; durable acceptance at 24204.9779. Not pure STT. |
| Prepared → model dispatch | 24206.0233 → 24453.5532 | 247.530 | Local attach/context/generation/delivery-start work; no finer command spans. |
| Dispatch → first model text | 24453.5532 → 26707.9755 | 2254.422 | Provider request/headers/SSE arrival plus local processing; not isolated provider compute. |
| First model text → first Speak | 26707.9755 → 26726.5059 | 18.530 | Local prose/delivery submission. Voice model-output marker is 26708.2308. |
| First Speak → first TTS PCM | 26726.5059 → 27214.1158 | 487.610 | TTS/request/transport/decode handling; not isolated synthesis time. |
| Stream end → model-complete marker | 26930.8823 → 28056.5877 | 1125.705 | Stream-end accounting/identity completion work can await persistence. |
| Model-complete → finalization start | 28056.5877 → 32064.1533 | 4007.566 | Remaining accounting, speech finish and saved graph/seal/transition work; not model generation. |
| Finalization start → attempt terminal durable | 32064.1533 → 33745.2871 | 1681.134 | Application publication. |
| Attempt terminal durable → chat terminal | 33745.2871 → 34499.7663 | 754.479 | Remaining publication/control/release bookkeeping. |
| Chat terminal → delivery settled unknown | 34499.7663 → 59662.0876 | 25162.321 | Delivery proof/settlement wait and final evidence; not extra inference. |

STT EOT → first server PCM totals **6491.750 ms**. Dispatch → stream-end was
**2477.329 ms** (the separately captured model duration is 2477.319 ms).
`analysis.finalization.durationMs=6443` approximately spans model-complete through
finalization-ok at 34499.5474; the actual finalization **start→ok** marker interval
is **2435.394 ms**. Treating both as independent waits double-counts work.

On the client clock: setup 1565.9828 ms, speech-end→thinking 1989.4927 ms,
speech-end→decoded-nonzero onset **8251.2173 ms**, session-start→onset 13552.1416 ms.
The inferred local speech-end position is 5300.9243 ms. The exported result has
no client monotonic origin allowing exact alignment to server EOT/PCM. Thus
speech-end→STT EOT and server PCM→client decoded onset are **not individually
measured**; subtracting the server chain from 8251 ms cannot identify either one.
Thinking is a client notification, not proof of durable acceptance or dispatch.
STT/TTS connections (840.235/826.439 ms) overlap setup, not sequential EOT costs.

`AgentVoiceAdapter.run` awaits binding/dedup, durable submission/status, then
starts delivery/execution. The Calendar-enabled snapshot excludes the shared
memory voice route, although this live execution uses the ordinary voice graph
(Calendar text-loop selection requires `!c.live`). Later native graph/checkpoint,
accounting and delivery publication waits remain. The existing `VoiceDelivery`
already dispatches Speak immediately while coalescing generated evidence in the
background. There is no source-supported reason to move first Speak after a DB
save, and no such extra wait was added here. Removing the upstream durable route
requires the same coherent Calendar/cross-mode migration above. No safe isolated
runtime wait removal was established or implemented.

`VoiceDelivery.proof` requires matching synthesized/generated output plus exact
played-sample evidence, or validated interruption evidence. This headless runner
never sends playback progress. Its 784560 decoded samples (including silence)
prove neither hearing nor a heard prefix. The bounded settlement reaching
`VOICE_DELIVERY_UNKNOWN`, null spoken evidence and false completion is expected
for this no-proof consumer; the retained timeline alone does not show a browser
runtime delivery defect. Server error handling explains `BENCHMARK_MEDIA_FAILED`
instead of the successful-onset/no-error `BENCHMARK_UNPROVEN_PLAYBACK` branch.
No playback ACK, new audio functionality or model change was introduced.

## Implemented fixes and measurement limits

**Benchmark input:** installed `@livekit/rtc-node/src/audio_source.ts` documents
constructor default `queueSize=1000`, passes it to `queueSizeMs`, awaits native
capture callbacks, exposes `queuedDuration`, and clears/disposes owned resources.
The retained native-frame JSON proves zero-queue 1280 samples fail while 160
samples pass. The retained split-frame JSON only proves frame acceptance; its
live variant still failed the unchanged pacing guard at 87.802 ms lateness.
The buffered operator check admitted 15 paced frames (max lateness 2.294 ms,
queue 82 ms); its live sample observed max 13.967 ms lateness and 95 ms queue.
These are previous measurements, not reruns or performance promises.

`webrtc-voice.ts` now explicitly uses a 1000 ms native input queue, preserves
absolute 80 ms pacing and the >80 ms rejection, rejects invalid/overflowing queue
estimates before capture, and reports optional `WireResult.maxInputQueuedMs`.
Frame rate/channels/sample count, little-endian conversion and zero-padded final
frame remain exact. Queue capacity is not a mandatory one-second initial delay.
Queue length is the SDK estimate, not an RTP timing measurement. Existing cleanup,
late-connect teardown, no fallback and unproven delivery behavior are preserved.
The ignored operator client was not copied. Context7 is unavailable in this
session; installed SDK source and preserved native evidence were used offline.
No new native FFI/network test ran.

**Instrumentation:** `telemetry.ts` now allows a finite set of existing
admission/acceptance, model dispatch/first-event/first-output/first-text/end,
finalization and voice EOT/prepared/Speak/PCM/settlement milestones through normal
stdout. Existing sanitized construction, pseudonymous IDs, numeric bounds,
4096-byte event limit and nonblocking stdout backpressure behavior remain.
No per-token/per-frame logs or DB writes were added. Existing admission-returned
Mongo counters can now survive the normal filter. Debug remains optional.
This repairs future evidence visibility, not missing historical measurements;
stdout backpressure or a separate operator sink can still drop events.

## Verification

Windows PowerShell, Node v24.19.0, Vitest 4.1.11; current HEAD
`89e0d4ee94c14f92d383efd1e114a1b8b57463c9` plus the preexisting unstaged work and
the seven-file delta below. Database test URI explicitly
blank for test commands. No native/service prerequisites were supplied.

| Check | Actual result |
| --- | --- |
| Benchmark failing-first | Original source: **2 failed / 19 passed**. Constructor was `[16000,1,0]`; overflowing queue still captured 25 frames. |
| Benchmark initial GREEN | **21 passed**, after buffered input/queue guard. Lateness and existing negative/late-connect/cleanup/proof checks passed. |
| Timing filter failing-first | **1 failed / 14 passed**; acceptance-durable was suppressed. |
| Combined initial GREEN | **36 passed**, two files. |
| Expanded deterministic matrix, serial | **430 passed / 1 failed / 0 skipped**, 38 files, 99.96 s. `calendar-recovery-unavailable.spec.ts:45` expected injected archive failure to reject; execution resolved. Same failure is recorded in the prior implementation report; no fresh controlled-baseline comparison ran here. Remains unresolved. |
| Final changed-file regressions | **40 passed**, 2 files, 2.71 s; includes invalid/nonfinite queue estimates and exact capacity edge. |
| Additional voice/observation safety | **89 passed**, 7 files, 9.29 s: pipeline, LiveKit pipeline, submission, speech prose, live session, LiveKit admission and observation writer. |
| Complete-command comparison alone | **1 passed / 12 filtered-out skipped**, 5.71 s. Plain **43 total commands / 12 writes** versus durable **136 / 42**; reductions **93 commands / 30 writes** in the existing fake-driver fixture, after complete publication. Not a Calendar-enabled comparison or a reduction introduced by these fixes. |
| Backend `npm.cmd run build`, sequential | **Exit 0**, `nest build`. |
| Backend `npm.cmd run lint`, final | **Exit 0**, **647 warnings / 0 errors**. New fixture warning from `new Array` was corrected; no warnings in newly added lines. Existing telemetry line 323 warning remains. |
| Document/Git consistency | All local Markdown link targets exist; `git diff --check` exit 0; initial-file hashes show exactly six intended existing-file changes, zero missing/unexpected changes, and this report as the only new Git-visible file. No staged files. |

First broad checks launched concurrently exhausted available memory: Vitest workers
reported heap/allocation OOM; lint reported PowerShell/native OOM. Wrapper exit
zero is not passing evidence. Build output contained only its invocation, so that
attempt is unverified. A serial `--maxWorkers=1` test rerun and sequential package
checks replace those attempts without changing assertions/timeouts.

The selected matrix uses all `test/runtime/calendar*.spec.ts`, memory-first/
archive/voice-critical-path/delivery/readiness/telemetry suites and benchmark specs
except `voice-runner` (loopback server) and `voice-comparison` (symlink fixture).
Those exclusions are unrun, not passes/skips. Full routine/e2e/service/Azure/
behavior suites were not rerun: scope forbids services, and the prior full result
remains **2725 passed / 103 failed / 10 skipped**, not green. Frontend is unchanged;
no new browser or audible-device validation is claimed.

The existing complete-command comparison must be distinguished from real RTT,
Calendar-enabled latency and Azure request units. These fixes themselves claim
**no conversation-driver command reduction**. Tests were selected, not skipped by
missing native prerequisites; the comparison-only `-t` run explicitly filtered
12 other tests. No assertion, timing threshold or test timeout was weakened.

Commands ran from `backend/` with `$env:AURVIN_TEST_MONGODB_URI=''`. The broad
`npm.cmd test -- --maxWorkers=1` arguments were the five `memory-*` performance
specs (`memory-first-foundation`, `memory-first-text`, `memory-text-archive`,
`memory-first-voice`, `memory-voice-observations`), `voice-critical-path.spec.ts`,
`test/voice/agent/voice-delivery.spec.ts`, `test/operations/telemetry.spec.ts`,
`test/operations/readiness.spec.ts`, all `test/runtime/calendar*.spec.ts`, and all
`test/benchmark/*.spec.ts` except the two excluded above. PowerShell expanded the
file lists before invoking npm. Final regressions used the two modified specs;
comparison used `--reporter=verbose test/performance/memory-text-archive.spec.ts
-t 'reduces complete database command'`. Additional voice arguments were
`test/voice/agent/{pipeline,livekit-pipeline,submission,speech-prose}.spec.ts`,
`test/voice/session/{live,livekit-admission}.spec.ts` and
`test/model/observation-writer.spec.ts` (each passed as its explicit filename).
Temporary evidence logs: `$env:TEMP/aurvin-followup-focused-serial.log`,
`aurvin-followup-final-regressions.log`, `aurvin-followup-voice-safety.log`,
`aurvin-followup-command-comparison.log`, `aurvin-followup-build-serial.log`,
`aurvin-followup-lint-final.log`. Initial OOM logs retain their unsuffixed names.

## Delta relative to the initial workspace snapshot

Initial source/file hashes and Git status were captured before edits. Only:

- `backend/src/benchmark/webrtc-voice.ts`
- `backend/src/benchmark/runner.ts`
- `backend/test/benchmark/webrtc-voice.spec.ts`
- `backend/src/operations/telemetry.ts`
- `backend/test/operations/telemetry.spec.ts`
- `docs/voice-latency-benchmark/webrtc-methodology.md`
- this new report.

All initial modified/untracked conversation implementation files, reports,
configuration and unrelated work are preserved. No source eligibility, global
graph settings, operation authority or receipt semantics were changed. Build
output is generated/ignored; temporary check logs are outside the checkout.

Next work needs the coordinated Calendar-enabled memory-loop/promotion tests and
implementation above, actual operator memory sizing, and approved isolated
compatibility checks. Offline fixtures can establish command counts and safety;
live performance, supported playback proof and Cosmos certification remain
separate uncompleted gates. No paid retry is requested or authorized by this report.
