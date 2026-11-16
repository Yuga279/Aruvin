# Live voice WebRTC verification

**Current disposition: P8 deterministic migration gate passes; external evidence remains blocked.** On the fixed source set (`4a564e0` plus the P4 fix `121ae72` and the P6 benchmark fix `b528445`..`deb09f5`), every P8 integration case now passes or is an explicitly named native-prerequisite skip, and both package builds, lints, the benchmark suite, and the e2e suite have actual outcomes. The full backend routine suite still reports failures, but they are confined to the documented pre-existing Calendar/performance files, where the only variation is wall-clock load sensitivity, plus six failures caused by this host's script-execution policy rather than by source. Native database, real LiveKit/SFU, browser/microphone/audio, impairment, deployment, and rollback evidence remain **BLOCKED / NOT RUN**. No WebRTC measurement was performed. Review is **SKIPPED**.

## Source and environment

- Verification ran on 7 November 2026, India Standard Time (UTC+05:30), between approximately 11:14 and 11:40.
- Git source: branch `main`, **base commit `4a564e024ac33616348921d188fb96e8d4533465`** (`docs(live-voice-webrtc): record P4 and P6 fixes, dispatch P8 rerun`). The worktree was **clean** immediately before these report edits (`git status --porcelain` returned no entries), so the reported results describe exactly this commit.
- **Owner fix commits included in this source set:** P4 `121ae72` (`fix(voice): restore resumable denied-permission state`); P6 `b528445`, `57eba7d`, `2e540b3`, `ae654ac`, `18c56bd`, `d7d3d51`, `deb09f5` (transport-aware WebRTC driver, strict provenance, guarded run identity, fail-closed comparison, output fence).
- **P8 report commit:** `4b565ad` (`docs(voice): record P8 rerun outcomes against fixed P4/P6 source`) contains this report revision and `comparison.md` only, with no test or source changes. This identity-record follow-up commit adds only this hash line. A commit cannot contain its own hash; the follow-up hash is reported to the orchestrator for recording in [state](state.md).
- **P8 test-source fingerprint:** `d25fedb6c674e92ec3475281d43a5299db16a70ac11002fc7863112cf98e6113`, SHA-256 over sorted relative path + NUL + file bytes + NUL for exactly fourteen files — all seven files in `backend/test/voice/integration/` (`canvas-multimodal-fixture.ts`, `canvas-multimodal.native.e2e-spec.ts`, `canvas-multimodal.spec.ts`, `fault-recovery.spec.ts`, `integrated-fixture.ts`, `multi-mode.spec.ts`, `webrtc-lifecycle.spec.ts`) and all seven in `frontend/src/features/voice/integration-tests/` (`canvas-multimodal-fixtures.ts`, `canvas-multimodal.test.ts`, `cost-flow.test.ts`, `investigation.test.ts`, `matrix-fixture.ts`, `pipeline.test.ts`, `voice-matrix.test.ts`). This set is exactly the two P8-owned integration directories; unlike the previous checkpoint it does not include `backend/test/assembly/readme.spec.ts`, which is a P7 handoff test already committed in `b180e78` and unchanged here. Any change to a listed file invalidates the fingerprint.
- Environment: Microsoft Windows 11 Home Single Language, version and build `10.0.26300`, 64-bit; Node `v24.19.0`; npm `11.17.0`; Vitest `4.1.11` in both packages; backend `@livekit/rtc-node` `1.2.1` and `livekit-server-sdk` `2.19.2`; frontend `livekit-client` `2.23.0`. Commands were invoked from a PowerShell 7.6.0-preview.6 parent shell.
- No browser, microphone, audio-output device, LiveKit target, native database, deployment, or network-impairment environment was selected or exercised. Frontend Vitest ran in Node, not a browser DOM.
- **Host script-execution caveat:** this machine's default child-PowerShell policy refuses to load unsigned local `.ps1` files (`"is not digitally signed"`; `Win32_DeviceGuard.CodeIntegrityPolicyEnforcementStatus` reports `2`). That is a host condition, not repository source, and it changes the result of any suite that spawns `backend/src/operations/local-guard.ps1`. It is quantified and separated under [Deterministic checks](#deterministic-checks) and [Failure routing](#failure-routing); it was not worked around by editing source, tests, or machine policy. A per-process `PSExecutionPolicyPreference=Bypass` environment variable was used only to obtain the clean comparison runs described below.

## Authorization ledger

| Activity | Authorization/evidence | Result |
| --- | --- | --- |
| Deterministic package checks | Authorized within the P8 no-service scope. The native-database URI/prefix and both native-authorization variables were confirmed **absent** from the environment before every run. | Ran only deterministic tests, builds, and linters; no LiveKit/SFU/provider/native database action. |
| Native MongoDB integration | No isolated URI, approved create/write/drop scope, or `AURVIN_VOICE_NATIVE_AUTHORIZED=1` supplied. | **BLOCKED**; no database connection attempted. Eight P8 native cases skipped by their explicit gates. |
| LiveKit, provider, browser/audio, network impairment, deployment | No selected target or renewed bounded service/browser/network authorization. The historical eight-submission WebSocket authorization is exhausted. | **BLOCKED**; no service or paid action attempted. The P6 driver was **not** executed against LiveKit or any provider. |
| Public access or production rollout | Not authorized and outside this verification. | **NOT RUN**. |

## Deterministic checks

All commands were run from the stated package directory with native database and service credentials removed. Results below are actual outcomes, with the counts each runner printed.

| Working directory | Exact command | Result |
| --- | --- | --- |
| `backend/` | `npm run build` | **PASS**, exit 0 (`nest build`). |
| `backend/` | `npm run lint` | **PASS**, exit 0; 647 warnings, 0 errors across 640 files. |
| `backend/` | `npm test -- test/voice/integration/` | **PASS**, exit 0; 38 passed, 8 skipped across 4 files (2 passed, 2 skipped). The eight skips are the native multi-mode/fault-recovery cases awaiting database authorization; they are not a pass. |
| `backend/` | `npm test -- test/voice/session/ test/voice/providers/ test/voice/usage/ test/http/voice-exclusion.spec.ts test/assembly/voice-context.spec.ts test/voice/transport/livekit-media.spec.ts test/voice/agent/livekit-pipeline.spec.ts` | **PASS**, exit 0; 203 passed across 18 files. Mode isolation, limits, accounting, and bridge/pipeline determinism hold. |
| `backend/` | `npm run test:benchmark` | **PASS**, exit 0; 147 passed across 11 files, including `webrtc-voice.spec.ts` (18) and `voice-comparison.spec.ts` (17). This is deterministic tooling evidence, **not** a measurement. |
| `backend/` | `npm run test:e2e` | **PASS**, exit 0; 43 passed, 139 skipped across 47 files (4 passed, 43 skipped). `test/assembly/voice-bootstrap.e2e-spec.ts` passed 30/30, including assembled unproven-progress and disconnect-remains-unknown cases. Skips are native-prerequisite suites, not passes. |
| `backend/` | `npm test` | **FAIL**, exit 1 in the default host environment: 35 failed, 2,726 passed, 10 skipped across 309 files (7 failed, 300 passed, 2 skipped files). Six of the 35 are induced by the host script-execution policy; the remainder are the documented baseline set. See the reconciliation below. |
| `frontend/` | `npm run build` | **PASS**, exit 0; `tsc -b && vite build` succeeded (largest bundle about 1.10 MB uncompressed, existing chunk-size advisory). |
| `frontend/` | `npm run lint` | **PASS**, exit 0; 80 warnings, 0 errors across 174 files. |
| `frontend/` | `npm test -- src/features/voice/integration-tests/` | **PASS**, exit 0; 34 passed across 5 files, zero failures. The previously failing P4 permission-denial regression now passes. |
| `frontend/` | `npm test` | **PASS**, exit 0; 670 passed across 80 files, zero failures. |

### Full backend suite reconciliation

`npm test` was run four times to separate source behaviour from host and load effects. The failing **file set is identical every time** to the five files recorded in [state](state.md) as the pre-existing Calendar/performance baseline: `test/performance/durable-latency.spec.ts`, `test/performance/confirmed-state-cache.spec.ts`, `test/runtime/calendar-recovery-unavailable.spec.ts`, `test/integration/plugins/multi-calendar/authority.spec.ts`, and `test/assembly/calendar-simplification.built.spec.ts`. No voice, LiveKit, contract, or P4/P6-owned test failed in any run.

| Run | Environment | Files | Result | Delta against baseline |
| --- | --- | --- | --- | --- |
| A | `PSExecutionPolicyPreference=Bypass` per process, no concurrent load | 309 (5 failed, 302 passed, 2 skipped) | 27 failed, 2,734 passed, 10 skipped | Same five files; +2 in `durable-latency` only |
| B | `PSExecutionPolicyPreference=Bypass` per process, no concurrent load | 309 (5 failed, 302 passed, 2 skipped) | 29 failed, 2,732 passed, 10 skipped | Same five files; +4 in `durable-latency` only |
| C | Default host policy, frontend suite running concurrently | 309 (6 failed, 301 passed, 2 skipped) | 35 failed, 2,726 passed, 10 skipped | Same five files, minus the built spec which passed, plus 6 host-policy failures |
| D | Default host policy, no concurrent load | 309 (7 failed, 300 passed, 2 skipped) | 35 failed, 2,726 passed, 10 skipped | Same five files plus 6 host-policy failures; +4 in `durable-latency` |

The documented baseline is **25 failures across five files**. Running `test/performance/durable-latency.spec.ts` alone reproduces **19** failures, and `test/performance/confirmed-state-cache.spec.ts` alone reproduces **3**; with the single failures in `calendar-recovery-unavailable.spec.ts`, `multi-calendar/authority.spec.ts`, and `calendar-simplification.built.spec.ts`, the standalone arithmetic is **19 + 3 + 1 + 1 + 1 = 25**, which matches the recorded baseline exactly. Under full-suite parallel load the same timing-sensitive `durable-latency` file reports 21–23 failures instead of 19 (its assertions are wall-clock gates), which fully accounts for the 27–29 totals. This is load sensitivity inside an already-failing pre-existing file, not a new defect class.

`test/assembly/calendar-simplification.built.spec.ts` remains the known build-artifact failure: in the full runs it fails at about 20–40 ms with `Cannot find module '/dist/plugins/google-calendar/tools.js'`, while it passes 1/1 when run alone and when run beside the `test/benchmark/` directory against the same build. That full-run/standalone divergence was already recorded in the previous P8 checkpoint; it was not fixed or waived here and is routed under [Failure routing](#failure-routing).

### Host script-execution policy effect

`backend/test/operations/local-guard.spec.ts` (3 tests) and `backend/test/persistence/local-open.spec.ts` (3 tests) fail **only** under this host's default policy, because the code under test spawns `powershell.exe -File backend/src/operations/local-guard.ps1` and the child refuses unsigned scripts. Evidence classifying it as environmental rather than source:

- A trivial one-line `.ps1` in a scratch directory fails identically, so the block is not script-specific.
- `Get-ExecutionPolicy -List` reports `CurrentUser RemoteSigned`, but the child still refuses the file; `Win32_DeviceGuard.CodeIntegrityPolicyEnforcementStatus` reports `2` (enforced), consistent with an OS-level code-integrity block.
- Setting `PSExecutionPolicyPreference=Bypass` for the test process makes the two suites pass **6/6**, with the guard's real mutex, kill, and PID-reuse assertions executing.

These six failures are therefore classified **environment-blocked**, not a product regression and not a P4/P6 defect. They are not waived: they are reported here, they remain failures under the default host policy, and `npm test` is recorded as **FAIL** for that reason.

### Focused P8 regressions

- The P4 permission-denial regression `denied LiveKit microphone permission allocates no session and keeps the original editable draft` passes **1/1** when filtered directly (5 sibling cases filtered out). The prior `canResume: true` expectation now holds; no assertion was relaxed.
- `backend/test/voice/integration/webrtc-lifecycle.spec.ts` passes **6/6**, covering unproven generated-ceiling ACK, the terminal write barrier, quiet-frame cost gating, paused-quota end, interrupt flush, and lost-transport text handling. These remain software/fixture boundaries.
- `canvas-multimodal.spec.ts` passes **32/32** and the frontend Canvas/UI/pipeline/cost/investigation suite passes **34/34**, so the former 22 backend and 17 frontend old-transport assumptions are reconciled on this source set.

No fixture output in this section is audible evidence or a WebRTC latency measurement.

## Native persistence

**BLOCKED — not run.** No isolated replica-set URI/prefix and explicit native authorization were supplied. Eight P8 cases were skipped by their explicit gate (`multi-mode` 4, `fault-recovery` 4), and three Canvas native e2e cases skipped. Any skipped native case is not evidence of durability, history, checkpoint, accounting, or crash-recovery behaviour on MongoDB.

## Live service and browser gates

**BLOCKED — no selected LiveKit target or renewed paid/browser/network authorization.** No LiveKit server or Cloud project was activated; no browser room join, microphone capture, assistant track, ICE/TURN path, autoplay, audible onset, interruption stop, or remote cleanup was observed. No impairment profile, provider call, benchmark submission, deployment, or rollback drill ran. P7's operational drills remain unrun; documentation and SDK doubles do not certify them.

**P6 tooling now exists and is verified only offline.** The previously missing WebRTC path is present and committed: `backend/src/benchmark/webrtc-voice.ts`, `voice-comparison.ts`, `voice-measurements.ts`, and `live-run-options.ts`, with methodology in [webrtc-methodology](../voice-latency-benchmark/webrtc-methodology.md) and 147/147 offline benchmark tests. The driver declares `transport: 'websocket' | 'webrtc'`, fails closed on a descriptor mismatch, validates the frozen PCM before admission, fences `webrtc-live-*` output roots away from the immutable baseline, and exports strict non-secret provenance. **No measurement occurred.** The headless path deliberately sends no invented `playback.progress` and never sets `completed` from `audio.end`; a valid onset without supported completion proof terminates as `outcome: 'unverified'` with `failureCode: 'BENCHMARK_UNPROVEN_PLAYBACK'`. Any future run therefore requires fresh bounded authorization and may legitimately end exit 2 / onset-only, which cannot be reported as eight successful samples.

## Acceptance matrix

| Criterion | Deterministic evidence | External/native evidence | Disposition |
| --- | --- | --- | --- |
| AC1 — live audio uses LiveKit/WebRTC rather than the old browser audio WebSocket | Live client/bridge tests over SDK doubles: backend integration 38 passed / 8 skipped, frontend 34 passed; text/dictation cutover suites 203 passed. | No real room, bidirectional media, ICE, or track observation. | **PARTIAL**; service evidence **BLOCKED**. |
| AC2 — dictation and text behavior remain unchanged | Full frontend suite 670 passed; backend voice mode-isolation set 203 passed; `voice-bootstrap.e2e-spec.ts` 30/30. | No real rollback or live-failure smoke on hardware. | **PARTIAL**. |
| AC3 — one runtime and durable turn/history/accounting behavior | Lifecycle, fixture, benchmark-guard, and assembly evidence listed above, including terminal-write and unproven-progress barriers. | Native persistence and recovery were not authorized. | **PARTIAL**; native durability **BLOCKED**. |
| AC4 — interruption, reconnect, and stale output stop correctly | Deterministic Room/control/lifecycle checks only, including interrupt flush before cancellation and lost-transport handling. | No acoustic/device stop, stale-tail, or real reconnect observation. | **PARTIAL**; browser evidence **BLOCKED**. |
| AC5 — scoped access, secret handling, trusted identity | Existing deterministic tests; this report contains no credentials or session payloads; provenance export is non-secret by test. | No target access boundary, token/rejoin, protected access, or secure-context test. | **PARTIAL**; external security evidence **BLOCKED**. |
| AC6 — finite budgets, quotas, attribution, and accounting | Offline benchmark suite 147/147, including budget guards; deterministic integration checks passed. | No new provider usage, billing, SFU/TURN exposure, or invoice evidence. | **PARTIAL**; paid evidence **BLOCKED**. |
| AC7 — startup, received audio, and audible latency are compared honestly | Historical WebSocket values retained; no new WebRTC timing sample; fail-closed onset-only limitation recorded. | No comparable WebRTC run or audible observation. | **INCONCLUSIVE**; see [comparison](comparison.md). |
| AC8 — impairment and deployment trade-offs | Procedures remain documented in [operations](operations.md) and the P6 methodology. | No matched impairment, fallback, deployment, shutdown, or rollback drill. | **BLOCKED / NOT RUN**. |
| AC9 — meaningful verification and truthful completion; review skipped | Source identity, fingerprint, environment, commands, counts, skips, and reconciliation are recorded; residual failures classified and routed. | Full required live gates and orchestrator final synthesis are pending. | **INCOMPLETE**; review **SKIPPED**. |

## Failure routing

- **P4 — frontend permission denial: RESOLVED.** The regression reported in the previous checkpoint now passes exactly on `121ae72`. No P8-owned assertion was changed. Status: closed for the deterministic gate; device-level permission/autoplay evidence is still blocked.
- **P6 — WebRTC benchmark interface: RESOLVED for tooling, blocked for evidence.** `b528445`..`deb09f5` supply transport selection, strict provenance, guarded run identity, the fail-closed comparison, and the output fence; `npm run test:benchmark` passes 147/147. The earlier "driver missing / old `--live` only" statement is superseded and removed. **No** run occurred, so this closes the tooling handoff only.
- **Pre-existing backend baseline: unchanged and reproduced.** Current failures are confined to the five documented files and reproduce the 25-test baseline arithmetic when their suites are run independently. No new failure class appears; the extra `durable-latency` count is wall-clock load sensitivity within that already-failing file. These are **not waived** and remain routed to their non-P8 owners: the Calendar subsystem (`calendar-recovery-unavailable`, `multi-calendar/authority`, `calendar-simplification.built`) and chat-performance (`durable-latency`, `confirmed-state-cache`). The built-artifact spec's full-run-only module-resolution failure was not fixed and is included in that routing.
- **Host script-execution policy: environment-blocked, not source.** `local-guard.spec.ts` (3) and `local-open.spec.ts` (3) fail only when the OS refuses unsigned `.ps1` execution; they pass 6/6 when the process is permitted to run scripts. Report as an environment limitation; no source or test change is warranted, and no P4/P6 defect is implied.
- **No P4 or P6 regression was found.** No voice-owned, LiveKit-owned, or benchmark-tooling test failed in any run, so nothing required the "stop and route" path for those owners.

## Cleanup and rollback

No service, browser, database, provider, deployment, or impairment activity was initiated, so there were no task-created service resources to clean up and no rollback was performed. Routine tests used deterministic fixtures; native authorization variables were absent throughout. No sentinel, baseline artifact, or database was modified or deleted; no service process was started or stopped. Temporary PowerShell scratch scripts used for the policy diagnosis were created only in the session scratch directory, never in the repository.

## Raw evidence and privacy

- No new live, native, browser, audio, impairment, or paid-run raw evidence was produced. There is no after-WebRTC run directory and no zero-use billing assertion.
- The retained historical WebSocket record is [the 5 November baseline report](../voice-latency-benchmark/websocket-live-baseline-2026-11-05.md), run `9ab4762c-c960-406f-adcf-84d91f265d56`. It reports 8 completed submissions (1 warm-up + 7 measured), source/input hash `e916bc586fafc4c2950791fb7cc1c46589623545b63dc11394631320ff4b0432`, and post-run compiled audit hash `4574aa2847ce323eb0250b8bdf64fb9bb4448218dc17a5acdfc32870396fd64a`. The compiled hash was not independently sealed before the run.
- The ignored raw `backend/benchmark-results/` tree is **not present in this checkout**, so the immutable-input manifest re-check from the P8 plan could not be executed. The committed baseline report is retained unchanged; no baseline bytes were regenerated, copied, or deleted.
- This report records only test summaries and source hashes. It contains no credentials, database URI, token, transcript, model payload, raw audio, SDP, or user data.

## Completion matrix

| Gate | Status | Evidence / remaining condition |
| --- | --- | --- |
| G0 upstream/source | **PASS for source identity** | Base `4a564e0`, P4 `121ae72`, P6 `b528445`..`deb09f5`, clean worktree, and the fourteen-file fingerprint are recorded. Live targeting remains a separate blocked gate. |
| G1 P8 migration | **PASS** | Backend integration 38 passed / 8 named native skips, frontend 34 passed, zero P8 failures; the former 22 backend and 17 frontend old-transport assumptions are reconciled and the P4 regression is fixed. |
| G2 full regression | **PARTIAL** | Builds, lints, benchmark 147/147, e2e 43 passed / 139 skipped, frontend 670/670 all pass. Backend routine is **FAIL** with 35 failures under the default host policy: 6 host-policy-induced plus the five documented baseline files (25 standalone arithmetic). No hidden new failure class; no full-suite pass is claimed. |
| G3 native durability | **BLOCKED** | No isolated database and explicit native authorization; 8 + 3 native cases skipped. |
| G4 target/media/security | **BLOCKED** | No approved target or real media/access observation. |
| G5 bounded headless run | **BLOCKED** | P6 tooling verified offline, but no fresh finite grant and no run; onset-only fail-closed outcome would be expected. |
| G6 metric matching | **BLOCKED / NONCOMPARABLE** | Historical PCM receipt and WebRTC decoded-nonzero boundaries differ; no after sample exists. |
| G7 real browser output | **BLOCKED** | No matched browser/device/acoustic evidence or retained WebSocket browser build. |
| G8 impairment/operations | **BLOCKED / NOT RUN** | No matched impairment or operational drill and restoration evidence. |
| G9 artifacts/truth | **PARTIAL** | Reports, source fingerprint, command outcomes, skips, and failure reconciliation are recorded; live gates remain blocked, so P8 is not fully complete. |
| Review | **SKIPPED** | User selected `--skip review`; no reviewer dispatched. |
| Workflow final synthesis | **PENDING** | The orchestrator owns `final_report.md` and workflow status; P8 is not complete. |

## Review

**SKIPPED — user selected `--skip review`; no reviewer dispatched.** This is not a passed review.
