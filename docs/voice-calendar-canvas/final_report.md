# Final Report: voice-calendar-canvas

## Executive Summary

Voice mode now presents calendar work as an automatically opened, evolving Canvas workspace, while
text calendar results stay inline with an explicit inspect button. The implementation reuses the
existing calendar authority, proposal/expiry/idempotency rules, renderers, and voice bridge rather
than adding a second calendar stack. Calendar views are derived from structured operation results,
not model prose. No display-only model/provider call, polling loop, or new serial dependency was
added to the voice/text critical path.

Three implementation plans were executed. P3's integrated verification found one P1-owned contract
mirror drift, which was corrected in `3cda6a0` and rechecked. Unified review was **skipped** per
repository instruction and is not recorded as passed.

## Workflow Configuration

- Workflow: MAW with three implementation plans (user limit).
- Goal: `docs/voice-calendar-canvas/goal.md`, approved 11 November 2026.
- Research: complete (`e45918e`).
- Unified review: **skipped**, never passed.
- No live provider, Google, LiveKit, STT or TTS call; no provisioning, deployment, credential or
  calendar-data change. All verification is deterministic fixture-based.
- Branch: `main`. Final code HEAD before the report commit: `3cda6a0`.

## Plan Breakdown & Execution Record

| Plan | Scope | Commits | Status |
| --- | --- | --- | --- |
| P1 | Calendar authority and voice bridge | `f9ca285`, `2f527e7`, `ae67d48`, `ae1509f`, `d7f2243`, `dc41dc4`, `8b316a4`, `aec4d95`, `4727f20`, `a7bfd0c`, `2fb134e`, `f77cfda`, `d8ee6a4` | Completed; mirror correction `3cda6a0` |
| P2 | Voice-first Canvas and text entry points | `dfe477f`, `8c2a438`, `e3f3ce6`, `cff5e8e`, `330638d`, `a54073f`, `eed4d4f`, `bb79e77`, `9550b8f`, `fd253a7` | Completed |
| P3 | Integrated verification and completion | `d203665`, `c68c2f5`, `3cca8b4`, `433c397`, `6964ca7`, `cc69720`, `f1a4926`, `ba534f4` | Completed; manual handoff P3-W1 verified |
| Final | P1 contract mirror correction | `3cda6a0` | Completed; rechecked |

P3 delivered `backend/test/voice/integration/calendar-voice.spec.ts` (28 tests),
`backend/test/http/calendar-publication-stream.spec.ts` (4), the P3-only extension of
`integrated-fixture.ts`, `backend/test/performance/calendar-voice-latency.spec.ts` (14), and
`frontend/src/features/voice/integration-tests/calendar-canvas.test.ts` (10).

## Verification & Quality Assurance

Post-correction final run at `3cda6a0`:

| Check | Exit | Result |
| --- | --- | --- |
| `backend/ npm run build` | 0 | `nest build` clean. |
| `backend/ npm run lint` | 0 | 687 warnings, 0 errors. |
| `backend/ npm test` | 1 | 363 files: 7 failed / 353 passed / 2 skipped. 3,219 tests: 31 failed / 3,177 passed / 10 skipped; 1 unhandled Vitest worker error. |
| `backend/ npm run test:e2e` | 1 | 48 files: 1 failed / 3 passed / 44 skipped. 183 tests: 8 failed / 35 passed / 140 skipped. |
| `frontend/ npm run build` | 0 | Passed; existing >500 kB chunk-size warning. |
| `frontend/ npm run lint` | 0 | 96 warnings, 0 errors. |
| `frontend/ npm test` | 0 | 97 files, 782/782 passed. |
| `git diff --check` | 0 | No whitespace errors. |

- P3 focused results: 28/28 `calendar-voice`, 4/4 publication, 14/14 latency, 10/10 frontend
  Calendar Canvas; 134/134 across the 15-file focused backend regression batch.
- Mirror rechecks after `3cda6a0`: `backend/src/contracts/voice.spec.ts` 12/12; frontend
  parity/protocol files 22/22.

### Baseline failures (classified, not caused by this feature)

The 7 failing backend files all reproduce at pre-P1 `622c0a7`: `durable-latency` (19→21 failures
under these runs; fixed caps are timing-sensitive), `local-guard` (3), `local-open` (3),
`memory-text-archive` (1), `calendar-recovery-unavailable` (1), `finalization-repair` (1),
`calendar-simplification.built` (1). Backend e2e fails only `voice-bootstrap.e2e-spec.ts` (8),
identically at `622c0a7`. The unhandled Vitest worker error is recorded as an observed test-run
stability issue; it did not affect P3 or the correction results.

### Prerequisite skips

Native MongoDB/voice suites were not configured (`AURVIN_TEST_MONGODB_URI`,
`AURVIN_TEST_DB_PREFIX`, `AURVIN_VOICE_NATIVE_AUTHORIZED` absent): 44 e2e files / 140 tests skipped,
plus 2 files / 10 tests in the full suite. A skipped or empty suite is not a pass.

### Latency and non-blocking evidence

- The four frozen confirmation rows reproduce exactly (wire reads/writes, waves, modeled elapsed,
  receipt timings); each row makes one provider create and leaves `active: 0`.
- Lookup profile: 3 model requests, 1 Google list, 0 display-only calls; a bounded completion view.
- Matched sink ablation at the real voice-runtime and voice-journal boundaries: `throws`, `pending`,
  and `rejected` visual sinks produced identical speech, durability, outcome, projection and slot
  release; 8/8 runtime combinations passed within 1,500 ms.
- Observed boundary: `milestones.terminalMs` is absent under hostile sinks while the authoritative
  outcome and release still occur. This is presentation telemetry, not a blocked voice/text path.
- Timing is the existing modeled `DependencyProbe` metric, not wall-clock or CPU measurement; no
  literal-zero-overhead claim is made.

## Acceptance Criteria

| AC | Result | Note |
| --- | --- | --- |
| AC1 Voice lookup | Passed (automated) | Agenda before final watermark; automatic `ChatView` opening not browser-proven. |
| AC2 Text/manual | Passed (automated) | Inline completion view; explicit inspect path; no text auto-open. |
| AC3 Confirmation | Passed (automated) | Speech/buttons resolve one proposal once; revision, expiry, replacement, session and race negatives covered. |
| AC4 Truthful lifecycle | Passed (automated) | Success only with durable receipt; denied/failed/unknown distinct; no retry of unknown write. |
| AC5 Agenda integrity | Passed (automated) | Timed, all-day exclusive end, multi-day, DST grouping, truncation, failure-vs-empty, bounded views. |
| AC6 Continuity/isolation | Passed (automated) | Archive equality, reload/mode-switch hydration, read-only history, session fencing. |
| AC7 Accessible presentation | **Partial** | SSR/controller semantics pass; browser keyboard/focus/mobile/reduced-motion/screen-reader checks were not runnable. |
| AC8 Verification evidence | Passed for scope | Full command ledger with actual exits/counts, skips and baseline classification. |
| AC9 Minimal work/latency | Passed (deterministic modeled) | Exact historical rows, no added requests or serial waits; visual handling non-blocking. |

## Defects and Corrections

- **P1 contract mirror drift** (found by P3): `backend/src/contracts/voice.spec.ts` failed because
  the backend `calendar.confirm`/`calendar.frame` text diverged from the portable frontend mirror.
  Fixed in `3cda6a0`: byte-identical body, control-character rejection for `select.calendarId`,
  and `isCalendarPresentationEvent` backed by the existing schema. The mirror spec was not weakened.
- **P3 test defects** (corrected in `433c397` and the subsequent frontend fixture fix): failure
  fetcher/wrapper ordering, missing deterministic narration wire, effect-ledger misuse, and a
  `foldCalendarFrame` payload shape. No production source change.
- No silent retry, second-write path, or false success was found.

## Key Artifacts

- Goal: `docs/voice-calendar-canvas/goal.md`
- State and DAG: `docs/voice-calendar-canvas/state.md`
- Plans: `docs/voice-calendar-canvas/plan1.md`, `plan2.md`, `plan3.md`
- Verification ledger: `docs/voice-calendar-canvas/verification.md`
- Research: `docs/voice-calendar-canvas/research.md`

## Limitations

- AC7 browser interaction evidence was not run: no fixture-backed browser page exists and creating a
  replacement UI for evidence was out of scope. Automatic opening, keyboard/focus, mobile layout,
  reduced motion and real assistive technology remain unverified in a browser.
- Native MongoDB and voice-native suites require operator-supplied prerequisites; they were skipped.
- No live/paid provider, Google Calendar, LiveKit SFU, STT or TTS call was made.
- The BSON double is not a native MongoDB or Azure/Cosmos certification.
- Latency is modeled, not wall-clock; backend full/e2e retain classified pre-existing failures.

## Verdict

The feature is implemented and verified to the extent supported by deterministic fixtures and the
available environment. **Workflow complete with AC7 browser interaction evidence outstanding**;
unified review was skipped, not passed. Final verification and this report were produced by the
orchestrator after verifying the P3 handoff commits and the P1 correction.
