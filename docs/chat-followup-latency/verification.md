# Follow-up latency verification

Status: **offline verification finished; performance acceptance remains open**. Review **skipped**, not passed. Real database/provider/browser latency remains unmeasured and separately gated. This document distinguishes the clean baseline, an intermediate candidate and the corrected verified candidate.

## Latest verified increment: `301c33b`

The user explicitly requested one additional implementation sub-agent for drastic simplification. Main independently verified its final source, including the subsequent stream-visibility correction. The earlier parent run overlapped that correction and is diagnostic only; authoritative logs are the later `drastic-verified-*` set below. No source/test mutation occurred during that final run: **599 files**, before/after hashes equal.

| Main check | Result | Local log under `$T` |
| --- | --- | --- |
| Backend build | Pass, exit 0 | `drastic-verified-build.log` |
| Backend lint | Pass, exit 0, warnings remain | `drastic-verified-lint.log` |
| Full serialized backend unit | **2398 passed / 8 failed / 10 skipped**, 279 files | `drastic-verified-unit.log` |
| Backend e2e, native prerequisites absent | **22 passed / 135 skipped**, 45 files | `drastic-verified-e2e.log` |
| Separate performance selection | **149 passed / 8 failed**, 12 files | `drastic-verified-performance.log` |
| Focused public visibility/admission checks | **15 passed**, 2 files | `drastic-parent-visibility.log` |

All eight failures are remaining frozen acceptance-target cases: five Calendar scenarios, cancellation before/midstream, and reconnect/recovery. Seven text/retry combined targets now pass. No additional correctness failure remains in executed checks. Frozen goals: commands7/15, pre-dispatch8/13, post-seal12/12. Frozen baseline/caps and whole-runtime fixture were not modified. Frontend source did not change; its earlier build/lint/536-test verification still applies.

The final main performance run reproduces follow-up **90R/38W (128 commands), 47 pre-dispatch / 56 first-text / 30 post-seal waves**, versus the previous verified111R/40W (151 commands),68/77/30. New text is98R/42W,56/65/31; Calendar text112R/43W,82/85/32. Full scenario values are recorded in [worker results](drastic-simplification-results.md). The extra one new-text post-seal wave is a real trade-off, not hidden. Counts are emulated work, not native RTT or p95.

Healthy public stream receipts require public text visibility locally, without an extra session read. Cold/missing receipts return null, so HTTP checks session existence and active lifecycle before status. Internal/live receipts are rejected on the public route. This necessary compatibility correction was completed by the same implementation owner, with no additional reviewer/planner session.

No native/provider calls, service changes, application restart, merge or deployment were authorized or performed. Absolute sub-100 ms remains unverified. Historical first-increment evidence follows below.

## Environment and isolation

- Windows, Node `v24.18.0`; installed backend LangGraph `1.4.19`, MongoDB saver `1.4.1`, MongoDB driver `6.21.0`, Vitest `4.1.11`.
- Branch `codex/chat-followup-latency`, starting source `927ab45871d1206e1ac56978c13083fc924ae671`. Original main-checkout context/admin edits were not carried or overwritten. No merge, push, app restart or deployment.
- Backend uses a matched-lockfile dependency junction; frontend uses a private `npm ci --no-audit --no-fund` installation from the unchanged branch lock. No dependency/manifest changes.
- No application dotenv/credentials copied. Test commands explicitly set `AURVIN_NATIVE_PERF_ENABLE=disabled`, empty `AURVIN_TEST_MONGODB_URI` and empty `AURVIN_TEST_DB_PREFIX`. Service tests skip rather than substitute application storage.
- Logs and source-hash manifests live under `C:/Users/Peter/AppData/Local/Temp/opencode/` (`$T` below). PowerShell captures are UTF-16; raw files are local diagnostic evidence, not public CI artifacts.

## Clean baseline

The tracked baseline was separately exported with `git archive` to `$T/followup-latency-baseline-927ab45`. No source edits or application configuration were copied into it. The same backend installation was reused. Its build and serialized unit run completed independently of candidate source edits.

| Check | Result | Log |
| --- | --- | --- |
| Clean-branch performance selection | 123 passed / 15 acceptance-target failures, 9 files, exit 1 | `followup-clean-branch-baseline-20261102.log` |
| Archived baseline backend build | Pass, exit 0 | `followup-baseline-backend-build.log` |
| Archived baseline backend full unit (`--maxWorkers=1`) | 2347 passed / 15 failed / 10 skipped; 273 files, exit 1 | `followup-baseline-backend-unit.log` |

All 15 baseline unit failures are the unchanged combined acceptance targets in `test/performance/durable-latency.spec.ts`. This is not a green baseline. Frozen baseline values/caps and the whole-runtime fixture remain unchanged by this task.

## Intermediate candidate — retained diagnostic evidence, not final acceptance

Candidate implementation commits: W2 `e28399b`, W1 `8ba5db5`, W3 `2486483`, frontend test compilation correction `a802e4a`.

- Initial frontend build found one unused test callback parameter (TS6133). W3 corrected it without compiler suppression; the successful frontend rerun is below.
- First combined backend build and lint exited 0. Full unit run: **2376 passed / 16 failed / 10 skipped**, 278 files. Fifteen are existing acceptance-target failures; one additional case is `text-config.spec.ts`'s pre-inference manifest-change guard test. W1 is investigating semantic safety versus the old third-read injection; it must not be removed or weakened.
- Backend e2e: **22 passed / 135 skipped**, 45 files, exit 0. Skips are not native correctness/latency evidence.
- Backend source hashes matched before/after that run for **250 source files**. It is valid evidence for that intermediate source, but not for subsequent W1 corrections.
- Intermediate performance selection: **132 passed / 15 failed**, 11 files. It reduced follow-up commands **169→152** and post-seal waves **44→30**, but follow-up pre-dispatch stayed **69**, new text regressed **75→79**, and Calendar initial-turn pre-dispatch regressed **92→96**. New-text and Calendar regressions were routed to W1; these must not be represented as a successful start-path optimization.

Raw intermediate logs: `followup-final-backend-{build,lint,unit,e2e}.log`, `followup-final-performance.log`, `followup-final-backend-source-{before,after}.json`. The historical `final` filename does not mean this candidate is final or accepted.

## Verified frontend source

At `a802e4a`, main independently reran `npm run build`, `npm run lint` and `npm test` from `frontend/`:

- Build: **pass**, exit 0; existing >500 kB chunk warning remains.
- Lint: **pass**, exit 0, warnings remain, including test-harness patterns; not warning-clean.
- Unit: **536 passed / 0 failed / 0 skipped**, 73 files.
- Before/after source-hash manifests match for **171 frontend source files**.
- Node tests do not measure DOM focus/IME behavior, browser paint, or a p95 responsiveness target.

Logs: `followup-verified-frontend-{build,lint,unit}.log`, `followup-verified-frontend-source-{before,after}.json`.

## Corrected verified backend

Verified implementation source: **`aa1eac647f6b68b74266f59e7f1e44f4d0152b1e`**. This includes W2 `e28399b`, W1 `8ba5db5`, W3 `2486483`, frontend test correction `a802e4a`, and W1 integration correction `aa1eac6`. Later report-only commits change no verified application source.

The correction uses the acknowledged initial `updateState` checkpoint config instead of an extra readback, removes the unused post-detach manifest read, and injects a real persisted manifest change at prepare in the existing safety test rather than relying on a third-read ordinal. The same safety assertion still requires refusal before provider dispatch. W1's 37 focused passes are not added to main suite counts as unique tests.

Main independently ran these checks after the correction:

| Check | Result | Log |
| --- | --- | --- |
| Backend build | Pass, exit 0 | `followup-corrected-backend-build.log` |
| Backend lint | Pass, exit 0, warnings remain; not warning-clean | `followup-corrected-backend-lint.log` |
| Full backend unit, serialized | **2379 passed / 15 failed / 10 skipped**, 278 files, exit 1 | `followup-corrected-backend-unit.log` |
| Backend e2e, no native prerequisites | **22 passed / 135 skipped**, 45 files, exit 0 | `followup-corrected-backend-e2e.log` |
| Separate unchanged performance selection | **134 passed / 15 failed**, 11 files, exit 1 | `followup-corrected-performance.log` |

All 15 final unit failures are the same frozen combined acceptance-target cases present in the untouched baseline. No additional correctness failure remains in these executed checks. This is **not a green full test suite or passing performance acceptance**. The additional manifest-safety failure from the intermediate candidate is resolved. Native skips do not certify database behavior.

Before/after hash manifests match for **598 backend source/test files** across the corrected build/lint/full-unit/e2e run. The separate performance run reproduces the full-unit delayed-profile metrics; both zero-delay and injected-delay performance profiles agree on all 15 command/wave records. Complete command histograms reconcile to reads+writes, and measured emulated command failures are zero. Package manifests/locks, the frozen baseline/caps and `latency-runtime-fixture.ts` have no diff from the starting commit.

### Clean baseline → corrected whole-runtime comparison

Counts are **emulated commands**; wave columns are **pre-dispatch / first emitted text / after sealed checkpoint**. They are not elapsed milliseconds. Bootstrap/seed turns/probes/shutdown remain excluded consistently. Cancellation/recovery retain unavailable boundaries instead of reporting false zeroes.

| Scenario | Reads/writes before → after | Commands before → after | Waves before → after |
| --- | --- | --- | --- |
| New text | 129/45 → 112/44 | 174 → 156 | 75/84/44 → 74/83/30 |
| Follow-up 1 | 128/41 → 111/40 | 169 → 151 | 69/78/44 → 68/77/30 |
| Follow-up 20 | 128/41 → 111/40 | 169 → 151 | 69/78/44 → 68/77/30 |
| Follow-up 38 at default ceiling | 130/41 → 112/40 | 171 → 152 | 69/78/44 → 68/77/30 |
| Follow-up 39 | 130/41 → 112/40 | 171 → 152 | 69/78/44 → 68/77/30 |
| Follow-up 50, test budget | 132/41 → 112/40 | 173 → 152 | 69/78/44 → 68/77/30 |
| Calendar text | 124/43 → 120/43 | 167 → 163 | 92/95/32 → 91/94/32 |
| Calendar read | 176/60 → 172/60 | 236 → 232 | 92/164/32 → 91/163/32 |
| Calendar create | 222/68 → 218/68 | 290 → 286 | 92/218/32 → 91/217/32 |
| Calendar conflict | 160/51 → 156/51 | 211 → 206 | 92/201/32 → 91/200/32 |
| Calendar proposal reply | 195/55 → 192/55 | 250 → 247 | 174/177/32 → 173/176/32 |
| Explicit retry | 128/40 → 111/39 | 168 → 150 | 70/79/44 → 69/78/30 |
| Cancel before dispatch | 66/21 → 66/21 | 87 → 87 | unavailable |
| Cancel midstream | 120/35 → 116/35 | 155 → 151 | 75/unavailable → 74/unavailable |
| Saved-result recovery/reconnect | 67/12 → 55/12 | 79 → 67 | unavailable/77/unavailable → unavailable/65/unavailable |

No final command/wave scenario regresses against the clean branch baseline. For follow-up1/20, commands decrease **10.7%**, pre-dispatch waves **1.4%**, and post-seal waves **31.8%**. Do not describe these as measured end-to-end speedups. The pre-dispatch improvement is small; the change does not establish a fast-enough admission path.

Against the older frozen incremental baseline's unchanged goals, **3/15** command goals pass, **0/13** pre-dispatch goals pass and **12/12** post-seal goals pass. All 15 combined acceptance cases still fail. The denominators for those goals are the original frozen values, not this task's clean baseline.

### Reproduction

From `backend/`, no application dotenv present:

```powershell
$env:AURVIN_NATIVE_PERF_ENABLE='disabled'
$env:AURVIN_TEST_MONGODB_URI=''
$env:AURVIN_TEST_DB_PREFIX=''
npm run build
npm run lint
npm test -- --maxWorkers=1
npm run test:e2e -- --maxWorkers=1
npm test -- test/performance --maxWorkers=1 --silent=false --disableConsoleIntercept --reporter=verbose
```

From `frontend/`: `npm run build`, `npm run lint`, `npm test`. Backend unit discovery is deliberately serialized, matching the independent baseline run and avoiding the known shared-dist build/import race. This does not attest the default parallel execution profile. Azure/live behavior suites, real native conformance, browser paint and provider checks were not run.

Main also checked all 8 new code files for required headers, preserved frozen/config files, and checked task-document links/whitespace/graph consistency. Plans remain worker-owned; main verified their committed existence without ingesting plan contents.

## Final measurement boundaries

The existing whole-runtime harness uses real repositories/runtime/stock saver over an instrumented BSON fake, not an actual MongoDB server. Reads/writes are emulated commands; dependency waves are not physical network round trips. Injected 67/449 ms timings are not measured service latency or CPU time. Its `modelEndMs` marker is fixture fetch-response time, not actual provider stream end.

The final report must keep real Send-to-dispatch, provider-end-to-ready, first-text delivery/paint and provider TTFT separate. Absolute sub-100 ms acceptance remains **unverified** until representative native/browser measurements are explicitly authorized and collected. No saver facade activation or weaker sync/majority/identity/accounting/terminal guarantees is permitted to manufacture a pass.
