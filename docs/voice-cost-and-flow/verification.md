# Voice Cost and Flow Verification

Status: **offline verification complete on the final commit set; live acoustic/billing acceptance (AC8) unrun, not authorized.**

## Tested commit set and environment

- Baseline: `4569119` (per plan4).
- Source-tested HEAD: `b8fa24a` (`docs(voice-cost-and-flow): record P2 clock fix; final verification`).
  The HEAD commit itself touches only `docs/voice-cost-and-flow/state.md`; the source under test is
  unchanged since `70ab85d`, so this report covers the final assembled source set with no untested delta.
- Owner-correction commits consumed: P1 `54ff635` (idempotent initial listening ACK),
  transport owner `4350b1d` (retain live control socket on non-terminal events),
  P2 `8af3cf6` (100 ms playback-origin direct-clock corrections) and P2 `70ab85d`
  (same 100 ms-origin correction for `audio-transport-pipeline.test.ts`, resolving the prior 2-test block).
- P4 commits: `b81c338` (dependency assembly), `58e054d` (cost-flow integration),
  `54fb8c7` (operations/evaluation docs), `df844c1` (Task 2), `e5ff734` (Task 3),
  `293884e` (Task 5), `c43bcec` (Task 6).
- P3 commits in range: `af3384b`, `0fa5eeb`, `14caf84`, `60bebc1`, `b6f81f7`, `a963edf`, `5c8e130`.
- P1/P2 worker commits in range predate the owner corrections and are listed in the branch log, not re-verified here.
- Environment: Windows, Node `v24.18.0`, npm `12.0.1`, branch `codex/voice-cost-and-flow`.
  Assembly/integration tests use injected persistence/providers, recording provider sockets, `FakeSocket`
  fixtures and loopback WebSockets; no fixed test ports were recorded and no external service was contacted.
- Native prerequisites were forced absent for e2e (`AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX`
  emptied for that invocation only). Only the availability of the variables is recorded, never values.
  No `.env` was read for credentials and no application database was used.

## Commands and results

Backend (`backend/`, sequential; builds and bootstrap tests both write `dist`, never run concurrently):

| Command | Exit | Files | Tests | Time | Notes |
| --- | --- | --- | --- | --- | --- |
| `npm run build` | 0 | n/a | n/a | not timed | `nest build`, no new errors. |
| `npm run lint` | 0 | n/a | n/a | not timed | Warnings only, pre-existing (`typescript/unbound-method` across voice specs). |
| `npm test` | 0 | 124 passed, 2 skipped (126) | 1006 passed, 10 skipped (1016) | 41.57 s | Runner-reported skips, not separately verified per suite. |
| `npm run test:e2e` (native vars forced empty) | 1 | 17 failed, 4 passed, 15 skipped (36) | 70 failed, 22 passed, 40 skipped (132) | ~14.3 s | Every one of the 70 failures is a `*.native.e2e-spec.ts` test failing fast on the `Isolated native test configuration is required.` guard (verified per-test: all FAIL lines are `*.native.e2e-spec.ts` paths). No real database access was attempted. |
| offline-only e2e rerun (every non-native `*.e2e-spec.ts`: app, voice-bootstrap, routes, operations/http) | 0 | 4 passed (4) | 22 passed (22) | 3.47 s | Includes `test/assembly/voice-bootstrap.e2e-spec.ts` (9 tests: 6 existing, quiet/resume, 2 hard-policy). |

Frontend (`frontend/`):

| Command | Exit | Files | Tests | Time | Notes |
| --- | --- | --- | --- | --- | --- |
| `npm run build` | 0 | n/a | n/a | ~146 ms bundle (68 modules) | `tsc -b && vite build`; embedded VAD bundled, no external model fetch. |
| `npm run lint` | 0 | n/a | n/a | not timed | Warnings only, pre-existing (react fast-refresh, control-regex, refs). |
| `npm test` | 0 | 54 passed (54) | 397 passed (397) | 2.85 s | Zero failures; the 2 previously red P2-owned transport-pipeline clocks pass after `70ab85d`. |

Targeted P4-scope reruns (subsets of the green full suites above):

| Command | Exit | Files | Tests | Notes |
| --- | --- | --- | --- | --- |
| backend `npm test -- test/voice/agent/pipeline.spec.ts test/assembly/voice-context.spec.ts test/runtime/voice-output.spec.ts test/runtime/voice-history.spec.ts` | 0 | 4 passed | 12 passed | Initial-ACK, suspend/drain composition, context/output/history. |
| frontend `npm test -- src/features/voice/integration-tests src/features/voice/dictation` | 0 | 9 passed | 56 passed | Cost-flow, pipeline, matrix, dictation. |
| frontend `npm test -- src/features/voice/live src/features/voice/state/live-voice-controller.test.ts src/features/voice/transport/audio-transport-pipeline.test.ts` | 0 | 6 passed | 59 passed | Lifecycle/controller plus the corrected transport clocks. |

Not run / not evidence: `npm run test:azure` and `npm run test:behavior` (empty discovery exit zero is not
evidence; reported as not run, not certified). Planner observations from 16 October 2026 are historical
baseline only, not final evidence.

## Acceptance evidence

| AC | Test path / name | Observation | Remaining limit |
| --- | --- | --- | --- |
| AC1 | `frontend/.../integration-tests/cost-flow.test.ts` `stops quiet PCM by 5080ms ...` | Pass (within 56-test integration run). Suspension at 5,040 ms, 62 uploaded frames, `input.suspend` sent once, no `response.interrupt`. | Injected detector decisions, not acoustic measurement. |
| AC2 | Same cost-flow test (onset release) + `backend/test/assembly/voice-bootstrap.e2e-spec.ts` `assembles acknowledged quiet/resume ...` | Pass. Onset `[1598, 1599, 1600, 1601]`, sequences 62-65, offsets 4960-5200 ms, released once after same-call listening ACK; assembly resume reuses one live call with zero turns and no provider recreation. | Synthetic 80 ms frames; detector decision/release latency separated by fixture design, not network measurement. |
| AC3 | `frontend/.../integration-tests/pipeline.test.ts` recoverable/blocked tests + assembly `retains the control channel but blocks paid work after ...` (duration, quota) + `voice-matrix.test.ts` lifecycle/permission + live/controller suites | Pass. Non-terminal events keep the control socket open; blocked policy stops keep the call mounted with `canResume: false`; hang-up/exit still releases everything. | Fixture-driven; no duration/quota provider billing verified. |
| AC4 | cost-flow no-early-upload assertion (`media()` stays 62 before ACK) + dictation suites (in 56-test run) + P2 detector fixtures | Pass. No local trigger creates an agent interrupt before server acknowledgement. | Real-device false positives/negatives and background-speech attribution remain separately gated (AC8). |
| AC5 | P3 slow/split/jitter tests (in backend 1006 pass) + P4 `suspends input without cancelling output ...` + pipeline `uses one 100ms origin ...` + corrected `audio-transport-pipeline.test.ts` (in 59-test run) | Pass. One 100 ms origin reserve, contiguous packets, zero-heard pre-start interruption; corrected clocks assert 0/0 heard and drain at the reserve-adjusted times. | Offline fixtures; P3 prose/filter ownership unchanged. |
| AC6 | `backend/test/voice/agent/pipeline.spec.ts` suspend/drain test + `test/assembly/voice-context.spec.ts`, `test/runtime/voice-output.spec.ts`, `test/runtime/voice-history.spec.ts` (12 pass) | Pass. Input suspension never cancels output; drain waits behind durable heard evidence; single flush; one execution. | Offline fixtures; P3 prose/filter ownership unchanged. |
| AC7 | Builds, lints, routine suites above | Pass. Backend and frontend fully green; native fail-fast guard recorded separately (not certification). | Rerun recorded on the final HEAD; no untested source delta after `70ab85d`. |
| AC8 | `docs/voice-cost-and-flow/evaluation.md` | **UNRUN, not authorized.** No consented device/provider trial performed. | Acoustic quality and real billing savings unverified. |

## Timing and usage interpretation

Actually asserted and passing values only: media suspension at 5,040 ms (within the 5,000 ms + one 80 ms
frame tolerance); zero quiet PCM after suspension; 62 uploaded media frames before suspension; bounded 320 ms
pre-roll (4 frames) released exactly once after the synchronous same-call listening ACK; 20 ms within-frame
decision offset; zero additional release latency in this harness; one 100 ms playback origin reserve per
response with 0 underruns in the pre-start interruption fixture; `audioSamples()` 2,400 at suspension;
durable record leaves `pending`; exactly one TTS flush and one turn execution in the drain composition.
Observed STT upload counts are fixture upload accounting, not provider charges; socket-open time is not
provider cost.

## Skipped, blocked and unverified

- Native suites: 17 files / 70 tests fail fast on the absent-prerequisite guard with no real access; 15 files /
  40 tests runner-reported skipped. No native replica-set or Azure certification; no application URI supplied.
- `test:azure` / `test:behavior`: not run, not certified.
- No remaining red tests: the prior P2 transport-clock block (`audio-transport-pipeline.test.ts`, 2 tests)
  was corrected in `70ab85d` and verified green in the 59-test targeted rerun and the 397-test full frontend run.
- AC8 device/provider A/B evaluation: unrun, not authorized; acoustic/billing acceptance unverified.
- Process-local quota counters are not restart-durable; cancellation cannot guarantee zero charges;
  unknown/in-flight usage stays unknown.

## Review

**Skipped by user instruction; not passed.**
