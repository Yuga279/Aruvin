# Voice Calendar Canvas — Integrated Verification

## Scope and tested commits

P3 verifies the approved goal (`goal.md`). P1/P2 source ownership is unchanged; P3 owns the
dedicated integration/HTTP/latency specs, the frontend voice integration test, and this ledger.
Unified review: **skipped**, per user instruction (never "passed").
Execution status: **P3 automated evidence complete; workflow completion is not claimed** — the
orchestrator owns final verification and `final_report.md`.

Capture date: 11 November 2026. Branch: `main`.

| Item | Value |
| --- | --- |
| Repository root HEAD at ledger start | `c6cbb0042e82af9de33a0e381076baa8672c9025` |
| P1 implementation range | `f9ca285^..d8ee6a4` (13 commits) |
| P1 pre-feature source | `622c0a7ac217d2b60847e933015d3bb88bad1917` (= `f9ca285^`) |
| P2 implementation range | `dfe477f^..fd253a7` (10 commits) |
| P3 plan | `2638c7a` (`plan3.md`) |
| P3 test commits | `d203665` (ledger), `c68c2f5` (fixture extension), `3cca8b4` (lookup/archive), `433c397` (confirmation/lifecycle), `6964ca7` (HTTP publication), `cc69720` (latency/sink), `f1a4926` (frontend Canvas) |
| Tested source SHA | `f1a4926`; P3 changed **no** `src/` file and no dependency manifest |
| OS / architecture | `win32 x64` |
| Node | `v24.19.0` (declared range `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`) |
| npm | `11.17.0` |
| Package directories | `backend/`, `frontend/` (separate lockfiles) |
| Working tree before this docs commit | clean (`git status --short` empty; `.openchamber/` preserved) |

P3 files:

- `backend/test/voice/integration/calendar-voice.spec.ts` (28 tests)
- `backend/test/http/calendar-publication-stream.spec.ts` (4 tests)
- `backend/test/performance/calendar-voice-latency.spec.ts` (14 tests)
- `frontend/src/features/voice/integration-tests/calendar-canvas.test.ts` (10 tests)
- `backend/test/voice/integration/integrated-fixture.ts` (P3-only extension, committed `c68c2f5`)

## Environment and prerequisites

- Both packages needed dependency installation before any check could run. `backend/node_modules`
  predated the auth work in `830a9c6`, so `@workos-inc/node@12.2.0` (declared in
  `backend/package.json` and present in `backend/package-lock.json`) was missing and every suite that
  imports `src/app.service.ts` failed to load with
  `Error: Cannot find package '@workos-inc/node' imported from backend/src/auth/provider.ts`.
  That is a **prerequisite/base dependency failure, not a P3 code defect**.
- `npm config get omit` resolves to `dev` in this environment, so the first `npm ci` installed
  production dependencies only (no `vitest`). The run that finally restored a working tree was
  `npm ci --include=dev` in `backend/`. `frontend/` was already complete.
- Native MongoDB suites were **not** configured: `AURVIN_TEST_MONGODB_URI`, `AURVIN_TEST_DB_PREFIX`
  and `AURVIN_VOICE_NATIVE_AUTHORIZED` were absent. Those suites skip and are recorded as
  prerequisite skips, never as passing evidence. No URI or credential value was read or printed.
- No live provider, Google, LiveKit, STT or TTS endpoint was contacted. All provider traffic in the
  P3 specs is a deterministic `fetch` double; the only real socket is a loopback Supertest listener
  inside the test process.

## Command ledger

### Baseline (before any P3 test file existed)

| # | Directory | Command | Exit | Result |
| --- | --- | --- | --- | --- |
| B1 | `backend/` | `npm test -- test/performance/calendar-critical-path.spec.ts test/runtime/calendar-durable-voice.spec.ts test/runtime/calendar-memory-voice.spec.ts test/runtime/calendar-voice-authority.spec.ts test/http/calendar-stream.spec.ts test/voice/agent/submission.spec.ts` | 1 | **1 file failed to load, 5 files passed, 21 tests passed.** Failure: `Cannot find package '@workos-inc/node' imported from src/auth/provider.ts` (missing declared dependency, see prerequisites). |
| B1-rerun | `backend/` | same command after `npm ci --include=dev` | 0 | 6 files passed, **29 tests passed**, 0 failed, 0 skipped; 6.14 s. |
| B2 | `frontend/` | `npm test -- src/features/voice/integration-tests/canvas-multimodal.test.ts src/features/canvas/calendar-canvas.test.ts src/features/chat/ChatView.voice.test.ts` | 0 | 3 files passed, **48 tests passed**, 0 failed; 0.99 s. |

### P3 focused commands

| # | Directory | Command | Exit | Result |
| --- | --- | --- | --- | --- |
| F1 (first run) | `backend/` | `npm test -- test/voice/integration/calendar-voice.spec.ts` | 1 | 26 discovered: 23 passed, 3 failed. All three were **P3 test defects**, not source defects: the outer failure-injection fetcher returned before the `countCreates` wrapper (0 counted POSTs), and the denied-target confirmation needed the runtime's deterministic model-narration wire. Corrected in `433c397`. |
| F1-rerun | `backend/` | `npm test -- test/voice/integration/calendar-voice.spec.ts` | 0 | **27 passed**; 16.20 s. |
| F2 | `backend/` | `npm test -- test/http/calendar-publication-stream.spec.ts` | 0 | **4 passed**; 3.40 s (publication, terminal drain, terminal write failure, proposal publication). |
| F3 | `backend/` | `npm test -- test/performance/calendar-voice-latency.spec.ts test/performance/calendar-critical-path.spec.ts` | 0 | **22 passed** (14 new + 8 reference); 5.75 s. |
| F4 | `backend/` | `npm test -- test/voice/integration/calendar-voice.spec.ts test/http/calendar-publication-stream.spec.ts` | 0 | **32 passed** (28 + 4); 15.94 s. |
| F5 | `frontend/` | `npm test -- src/features/voice/integration-tests/calendar-canvas.test.ts` | 0 | **10 passed**; 0.66 s. |
| F6 | `frontend/` | `npm test -- src/features/voice/integration-tests/calendar-canvas.test.ts src/features/voice/integration-tests/canvas-multimodal.test.ts src/features/canvas/calendar-canvas.test.ts src/features/chat/ChatView.voice.test.ts src/features/chat/state/calendar-chat-state.test.ts src/api/voice-protocol.test.ts src/api/calendar-protocol.test.ts` | 0 | 7 files, **83 passed**; 0.85 s. |
| F7 | `backend/` | `npm test -- test/voice/integration/calendar-voice.spec.ts test/runtime/calendar-voice-authority.spec.ts test/runtime/calendar-multi-concurrency.spec.ts test/voice/transport/livekit-control.spec.ts test/performance/calendar-critical-path.spec.ts test/performance/calendar-voice-latency.spec.ts test/voice/agent/submission.spec.ts test/runtime/calendar-durable-voice.spec.ts test/runtime/calendar-memory-voice.spec.ts test/http/calendar-publication-stream.spec.ts test/http/calendar-stream.spec.ts test/http/sse-writer.spec.ts test/http/voice-exclusion.spec.ts test/voice/transport/gateway.integration.spec.ts test/voice/integration/canvas-multimodal.spec.ts` | 0 | 15 files, **134 passed**, 0 failed, 0 skipped; 20.59 s. |

`F5` initially failed with `foldCalendarFrame` receiving a bare event instead of a
`CalendarFramePayload`; the P3 test fixture call was corrected. No P2 source change.

### Full package and repository commands

| # | Directory | Command | Exit | Result |
| --- | --- | --- | --- | --- |
| P3-1 | `backend/` | `npm run build` | 0 | `nest build` completed with no diagnostics. Build excludes test TypeScript. |
| P3-2 | `backend/` | `npm run lint` | 0 | 737 files, 111 rules; **685 warnings, 0 errors**; 4.6 s. Warnings are the existing advisory set (unbound-method/style), not lint errors. |
| P3-3 | `backend/` | `npm test` | 1 | 363 files: **8 failed, 352 passed, 2 skipped**. 3,219 tests: **34 failed, 3,172 passed, 10 skipped**. 133.62 s. Failing files are pre-existing or one P1-owned mirror (see below); none is a P3 file. |
| P3-4 | `backend/` | `npm run test:e2e` | 1 | 48 files: **1 failed, 3 passed, 44 skipped**. 183 tests: **8 failed, 35 passed, 140 skipped**. 29.24 s. Failing file: `test/assembly/voice-bootstrap.e2e-spec.ts` (8); confirmed failing identically on pre-P1 `622c0a7`. |
| P3-5 | `frontend/` | `npm run build` | 0 | `tsc -b && vite build` passed; 108 modules; Vite reported the existing >500 kB chunk-size warning. |
| P3-6 | `frontend/` | `npm run lint` | 0 | 210 files, 116 rules; **96 warnings, 0 errors**; 0.21 s. |
| P3-7 | `frontend/` | `npm test` | 0 | 97 files, **782 passed**, 0 failed, 0 skipped; 6.21 s. |
| P3-8 | repository root | `git diff --check` | 0 | No whitespace errors. `git status --short` clean before the docs commit. |

### Baseline classification (pre-P1 worktree `622c0a7`)

A temporary `git worktree` at `622c0a7` with a `node_modules` junction was used only to classify
failures, then removed. No source was modified.

| Failing suite | Current result | At `622c0a7` | Classification |
| --- | --- | --- | --- |
| `src/contracts/voice.spec.ts` | 1 failed | **passed** | **P1-owned mirror drift**, see defects. |
| `test/performance/durable-latency.spec.ts` | 19 failed / 42 passed | 19 failed / 42 passed | Pre-existing baseline. |
| `test/operations/local-guard.spec.ts` | 3 failed | 3 failed | Pre-existing environment baseline. |
| `test/persistence/local-open.spec.ts` | 3 failed | 3 failed | Pre-existing environment baseline. |
| `test/performance/memory-text-archive.spec.ts` | 1 failed | 1 failed | Pre-existing baseline. |
| `test/runtime/calendar-recovery-unavailable.spec.ts` | 1 failed | 1 failed | Pre-existing baseline. |
| `test/runtime/finalization-repair.spec.ts` | 1 failed | 1 failed | Pre-existing baseline. |
| `test/assembly/calendar-simplification.built.spec.ts` | 1 failed | 1 failed | Pre-existing baseline. |
| `test/assembly/voice-bootstrap.e2e-spec.ts` | 8 failed / 22 passed | 8 failed / 22 passed | Pre-existing e2e baseline. |

## Acceptance evidence (AC1–AC9)

Evidence types: **runtime** (real service graph over offline stores), **transport** (offline LiveKit
peer or SSE transport), **HTTP** (Nest/Supertest), **controller** (real frontend controller and
Room doubles), **SSR** (static markup only), **browser** (not run).

| AC | Result | Named evidence | Limitation |
| --- | --- | --- | --- |
| **AC1 — Voice lookup** | **passed (automated)** | `calendar-voice`: *opens an offline live Calendar session*, *streams a live agenda before narration completes and reloads the same saved view*; `calendar-voice-latency`: *memory/durable completes lookup while the visual sink is …*; `calendar-canvas`: *renders a live proposal …*, *sends one revision-bound control …*. Exchange: one list, 3 model calls, `executing` progress before the agenda frame, agenda frame before the final watermark. | Scripted narration is routing evidence, not model-summary quality. Automatic Canvas opening is a `ChatView` effect and is **not** proven by SSR/controller tests (browser not run). |
| **AC2 — Text/manual** | **passed (automated)** | `calendar-publication-stream`: *carries the saved agenda on completion after prose without another display frame*, *publishes the stored proposal action and target …*; `calendar-canvas`: *keeps text results closed until an explicit inspect action …*, *reloads a text calendar snapshot …*. Text uses `completed.calendarView`; there is no extra `calendar-view` frame. | Real click on the inline inspect button is browser-only; reducer/artifact collection prove the data boundary, not the click wiring. |
| **AC3 — Confirmation** | **passed (automated)** | `calendar-voice`: *confirms the same proposal once using speech/button/duplicate-button*, *executes exactly one write when button-first/speech-first confirmation inputs race*, *records one durable operation bound to the shared proposal…*; authority negatives: old revision, expiry, replaced details, cross-conversation, undisclosed yes, speech/button rejection; `calendar-canvas`: one control send, duplicate returns `false`, no mic/playback change. | No live listener/SFU. Raw POST counting is separate from the fixture success ledger. |
| **AC4 — Truthful lifecycle** | **passed (automated)** | `calendar-voice`: *does not call a denied target a successful creation*, *shows a definitely failed create without a receipt*, *retains an unknown write outcome without retrying it*, reject cases, dictation isolation; `calendar-publication-stream`: terminal backpressure and terminal-write failure; latency sink ablation. Distinct `notice`/`outcome` states; success only with durable receipt. | Browser wording/focus for terminal states is not observed; terminal telemetry under hostile sinks is incomplete (see limitations). |
| **AC5 — Agenda integrity** | **passed (automated)** | `calendar-voice`: timed details, exclusive all-day span, more-results token, missing optional fields; provider-read failure is not an empty agenda; unknown target asks for a real calendar; `calendar-canvas`: DST wall-clock grouping, exclusive all-day end, truncated label, failure vs empty, expired label/link. Views also parse under `calendarViewSchema`/`isCalendarView` and stay under 14,336 bytes. | Browser pan/zoom absence and detail expansion are SSR-only; no real screen reader. |
| **AC6 — Continuity/isolation** | **passed (automated)** | `calendar-voice`: *keeps one archived agenda across live exit, text, reload and another chat*; `calendar-publication-stream` archive equality; `calendar-canvas`: historical read-only proposal, text/live artifact reload, no automatic open; P1 `livekit-control.spec.ts` proves identity/session/epoch fencing; `calendar-voice` live-turn HTTP exclusion. | Browser navigation/reconnect interactions not run; one P1-owned mirror spec fails (test text only). |
| **AC7 — Accessible presentation** | **partial** | **SSR passed:** semantic headings, `<details>/<summary>`, named `role="group" aria-label="Calendar request confirmation"`, `role="status"`, escaped `<script>` text, safe-link policy, no diagram stage in calendar mode. | **Browser interaction evidence not run**: keyboard order, focus restoration, mobile 390×844 layout, reduced-motion behavior and assistive technology are unverified. |
| **AC8 — Evidence** | **passed for P3 scope** | This ledger: seven package commands + repository check with actual exits/counts, focused 134-test regression run, baseline provenance, skips separated, no source-only claim. | Backend full/e2e remain exit 1 for pre-existing suites; one P1-owned mirror defect remains. |
| **AC9 — Minimal work/latency** | **passed (deterministic modeled)** | Four confirmation rows exactly match the frozen reference; after-only lookup profile; matched sink ablation at voice-runtime and voice-journal levels. No added model/Google request; write count unchanged; no new serial dependency observed. | No wall-clock repetition/median/range; modeled `DependencyProbe` milliseconds are not CPU/network measurements; pending-sink terminal telemetry marker is absent (reported below). |

## Deterministic historical comparison

### Provenance

Plan3 supplied four **P1-reported** reference rows captured from P1's pre-edit run of
`npm test -- test/performance/calendar-critical-path.spec.ts`. P3 reproduced those exact rows on
the tested SHA using the unchanged reference spec and the same frozen workload in
`calendar-voice-latency.spec.ts`. The raw P1 pre-edit transcript was not supplied, so identity is
established by exact numeric agreement, not by the original log file. They are labelled
**observed** for this checkout.

- Parameters: `new DependencyProbe()` (dependency-wave mode), `readMs: 67`, `writeMs: 449`,
  `path: 'calendar'`, durable path, existing confirmation workload.
- Boundary: setup, earlier turns and proposal publication happen **outside** `measure`; the measured
  region is **submit confirmation + execute confirmation**. `vi.spyOn(fx.frames, 'push')` only
  observes the existing append; it adds no read/model call.

| Earlier turns | Explicit reply reference | Wire reads | Wire writes | Waves | Modeled elapsed ms | First succeeded receipt ms | Model calls | Request kinds | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | no | 158 | 45 | 199 | 30523 | 21108 | 2 | preflight, create | exact match |
| 0 | yes | 155 | 45 | 196 | 30322 | 20907 | 2 | preflight, create | exact match |
| 8 | no | 182 | 45 | 223 | 32131 | 22716 | 10 | preflight, create | exact match |
| 8 | yes | 171 | 45 | 212 | 31394 | 21979 | 10 | preflight, create | exact match |

Logical counters from the P3 run: `(41 reads, 43 writes)`, `(38, 43)`, `(57, 43)`, `(46, 43)`.
Wire command histograms: `find 158/155/182/171`, `findAndModify 4`, `update 41`. Each row attempted
exactly one provider create and left the runtime with `active: 0`. No row regressed; no baseline
rebasing or threshold weakening was applied.

### After-only lookup profile (no pre-feature lookup baseline exists)

| Metric | Value |
| --- | --- |
| Model requests / kinds | 3 / `list` |
| Google effects | 1 `list`, 0 `create` |
| Logical / wire reads | 37 / 197 |
| Logical / wire writes | 62 / 73 |
| Wire commands | `find: 197`, `update: 69`, `findAndModify: 4` |
| Waves / modeled elapsed / busy / overlap | 262 / 45,440 ms / 45,440 ms / 918 ms |
| Phases (count) | admission 41, attachment 6, context 2, model-observation 90, tool-evidence 32, seal 71, publication 26, release 2 |
| Milestones | first dispatch 14,595 ms, first delta 34,410 ms, model end 14,595 ms, seal 40,126 ms, terminal 45,440 ms, release 45,440 ms |
| Storage waves | pre-dispatch 81, first answer 200, post-seal 32 |
| Frames / view | 7 frames; completion carries a bounded agenda view |

The lookup is an **after-feature profile**, not a historical baseline. `requestKinds` records the
single logical list; there is no display-only model or Google call.

## Matched sink-ablation and non-blocking evidence

### Real voice-runtime callback (memory and durable)

`calendarLiveFixture(mode)` lookup with `record | throws | pending | rejected` visual sinks. All
eight combinations passed within a 1,500 ms bound (pending was never released until after the
assertions):

- visual sink invoked; narration exactly `No events in that range.`;
- `finish` exactly once; 3 model bodies; 1 list effect; 0 creates;
- runtime `active: 0` after settlement.

This proves the calendar frame callback is not awaited on the narration/completion path at the
runtime boundary. It does not prove browser render timing.

### Voice journal (`VoiceDelivery`) ablation

`measureVoiceSink` ran the same real voice turn with a recording sink and with `throws`, `pending`,
and `rejected` sinks, fixed `Date` clock, alternating runs. For all three hostile behaviours the
following matched the recording run **exactly**:

| Metric | Recorded and hostile |
| --- | --- |
| Model requests / kinds | 3 / `["list"]` |
| Provider requests (fixture method/path) | 3 × `POST /api/v1/chat/completions`, 1 × `GET /calendar/v3/calendars/personal%40example.test/events` |
| Logical reads / writes | 32 / 66 |
| Wire reads / writes | 205 / 78 |
| Wire commands | `find: 205`, `update: 74`, `findAndModify: 4` |
| Waves / modeled elapsed / busy / overlap | 277 / 47,973 ms / 40,863 ms / 449 ms |
| First speech | 40,059 ms |
| Archived outcome | identical bounded agenda view |
| Slot release | 47,973 ms; `active: 0` |

Observed difference: the `terminal-delivered` telemetry marker (`milestones.terminalMs`) is
`47,973 ms` with the recording sink and `null` with hostile sinks. Speech, durable completion,
authoritative outcome, view projection and slot release still occurred. This is recorded as a
presentation-telemetry boundary, not a blocked voice/text path; no CPU-zero or absolute-overhead
claim is made.

### Wall-clock and CPU

The fixed workloads were not repeated five times, and no wall-clock samples/median/range were
recorded. All timing above is the existing modeled `DependencyProbe` metric. No CPU, browser-render
or network latency claim follows.

## Browser interaction evidence

**Not run — fixture-backed browser unavailable.** This repository has no deterministic
fixture-backed browser entry page for the calendar Canvas, and Task 8 forbids creating a browser
framework or replacement UI for evidence. Automated SSR/controller coverage is recorded above, but
these interactions remain unverified in a real browser:

- automatic Canvas opening at actual work (a `ChatView` effect) and sticky dismissal;
- keyboard order, Enter/Space activation, focus restoration and tab behavior;
- 1280×800 desktop and 390×844 mobile layout, overflow and reduced-motion behavior;
- real screen-reader announcements; DOM role inspection is not assistive-technology testing.

No screenshots, traces or session payload logs were produced or committed.

## Test-discovered defects and owning-worker rechecks

1. **P1-owned — `backend/src/contracts/voice.spec.ts` contract mirror (open).**
   - Command: `cd backend; npm test -- src/contracts/voice.spec.ts -t "mirrors the entire portable voice contract"`.
   - Current: fails with a source-mirror diff for `calendar.confirm` (`answer.kind: 'select'`
     canonical-id check) and `calendar.frame` (`event: isCalendarPresentationEvent`).
   - Pre-P1 `622c0a7`: the same spec passes, so the drift arrived with P1's `voice-wire.ts` calendar
     additions. The production contract validators are exercised by the passing P3 transport tests;
     this is a test-fixture mirror defect, not evidence of a runtime failure.
   - Owner: **P1**. P3 did not edit `backend/src/` or this spec. No correction commit exists yet.
2. **P3 test defects (corrected in `433c397` and the subsequent F5 fix).**
   - Failure-injection fetcher returned before the POST-counting wrapper, so three lifecycle tests
     counted 0 attempts. Corrected by wrapping the counter outside the failure mock.
   - Denied-target confirmation takes P1's model-narration clarification branch; the test supplied
     no narration wire and surfaced `VOICE_AGENT_FAILED`. Corrected with the intended deterministic
     narration wire.
   - The definitely-failed create records a fixture effect when the tool resolves with a structured
     provider error; the test now relies on attempted POST + authoritative outcome instead of
     treating the effect ledger as success evidence.
   - `foldCalendarFrame` was called with a bare event instead of a `CalendarFramePayload` in the
     frontend test; corrected the test call.
3. **Pre-existing baseline/e2e failures (not P3, not repaired).**
   - Backend full suite: `durable-latency` (19), `local-guard` (3), `local-open` (3),
     `memory-text-archive` (1), `calendar-recovery-unavailable` (1), `finalization-repair` (1),
     `calendar-simplification.built` (1). All reproduce identically on pre-P1 `622c0a7`.
   - Backend e2e: `voice-bootstrap.e2e-spec.ts` (8). Reproduces identically on pre-P1 `622c0a7`.
   - These are reported, not silently excluded or rewritten. `durable-latency` fixed caps are an
     older performance baseline; its failure on pre-P1 source means P3 cannot attribute it to this
     feature.
4. **Observed presentation boundary (not a failed assertion).** Under `throws`/`pending`/`rejected`
   visual sinks, `milestones.terminalMs` is absent while speech, durability, outcome and slot
   release remain correct. If terminal-delivery telemetry under failed visuals is required, it is a
   P1 follow-up.

## Skips, baseline failures, and limitations

- **Prerequisite skips (not passes):** native MongoDB/voice suites in `npm run test:e2e` — 44 files /
  140 tests skipped because `AURVIN_TEST_MONGODB_URI`, `AURVIN_TEST_DB_PREFIX` and
  `AURVIN_VOICE_NATIVE_AUTHORIZED` were absent. Backend full suite also reports 2 skipped files /
  10 skipped tests.
- **Baseline failures:** the list in “Test-discovered defects” item 3; pre-P1 reproduction is the
  classification evidence. They are separated from P3 passes.
- **Open P1-owned failure:** the `voice.spec.ts` mirror described above.
- No live/paid provider, Google Calendar, LiveKit SFU, STT or TTS call was made.
- No public deployment, Azure/Cosmos compatibility, real-model speech quality, real hardware audio,
  or browser/assistive-technology behaviour is certified by this ledger.
- The BSON double is not a native MongoDB or Azure certification.
- Pending-sink tests use a promise that the test releases in `finally`; the runtime completed before
  release. Synchronous infinite loops were not used as a “slow renderer”.
- No wall-clock latency samples; no claim of literal zero overhead.

## Completion gate

- AC1–AC6 and AC8–AC9 have deterministic automated evidence at `f1a4926`; AC7 is **partial** because
  browser interaction evidence was not available.
- All P3-owned specs pass (28 + 4 + 14 backend; 10 frontend). The focused 15-file regression run
  passes 134/134.
- Backend full suite and e2e remain exit 1 for pre-existing suites plus one **P1-owned** contract
  mirror test; frontend build/lint/test and backend build/lint pass.
- P3 automated verification is complete for its ownership. **Workflow completion is not claimed.**
  The orchestrator owns the final verification decision, routing of the `voice.spec.ts` mirror to
  P1, and `final_report.md`.

## Orchestrator final verification addendum (11 November 2026)

### P1 mirror correction

- Commit `3cda6a0` (`backend/src/contracts/voice-wire.ts`,
  `backend/src/contracts/calendar-wire.ts`). The portable body is byte-identical to
  `frontend/src/api/voice-protocol.ts`; `calendar.confirm` select now rejects control characters and
  `calendar.frame` uses `isCalendarPresentationEvent` backed by the existing schema.
- Rechecks: `backend/src/contracts/voice.spec.ts` **12/12 passed**; `backend/test/contracts/`
  calendar wire parity passed; frontend parity/protocol files (`voice-fixtures`, `voice-protocol`,
  `calendar-protocol`) **22/22 passed**. No mirror-spec or frontend change.

### Post-correction final run (HEAD `3cda6a0`)

| # | Directory | Command | Exit | Result |
| --- | --- | --- | --- | --- |
| V1 | `backend/` | `npm run build` | 0 | `nest build` clean. |
| V2 | `backend/` | `npm run lint` | 0 | 737 files, **687 warnings, 0 errors**. |
| V3 | `backend/` | `npm test` | 1 | 363 files: **7 failed, 353 passed, 2 skipped**. 3,219 tests: **31 failed, 3,177 passed, 10 skipped**; 1 unhandled Vitest worker error. All 7 failing files are the classified pre-existing baseline; `durable-latency` varied 19→21 failures in this run (fixed caps are timing-sensitive and also fail at `622c0a7`). `src/contracts/voice.spec.ts` now passes. |
| V4 | `backend/` | `npm run test:e2e` | 1 | 48 files: **1 failed, 3 passed, 44 skipped**. 183 tests: **8 failed, 35 passed, 140 skipped**. Identical to the pre-P1 `622c0a7` baseline (`voice-bootstrap.e2e-spec.ts`). |
| V5 | `frontend/` | `npm run build` | 0 | `tsc -b && vite build` passed; existing >500 kB chunk-size warning only. |
| V6 | `frontend/` | `npm run lint` | 0 | 210 files, **96 warnings, 0 errors**. |
| V7 | `frontend/` | `npm test` | 0 | 97 files, **782 passed**, 0 failed, 0 skipped. |
| V8 | repository root | `git diff --check` | 0 | No whitespace errors. |

### Residual limits carried into the final report

- AC7 browser interaction evidence remains unrun (no fixture-backed browser page; keyboard/focus,
  mobile 390×844, reduced motion, and real assistive technology are unverified).
- Native MongoDB/voice suites remain prerequisite skips; no live provider call was made.
- Latency evidence is deterministic modeled `DependencyProbe` data, not wall-clock/CPU measurement;
  no literal-zero-overhead claim is made.
- Backend full suite and e2e remain exit 1 only for the classified pre-existing baseline; frontend
  and both builds/lints are clean apart from advisory warnings.

