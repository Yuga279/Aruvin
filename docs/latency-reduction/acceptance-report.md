# Latency acceptance — final verification and next intervention

2026-10-29. **Acceptance FAILED offline; native/live execution BLOCKED.** This completes Step 4's verification/synthesis artifact, not latency acceptance or deployment readiness. Review **skipped**, not passed. No agents dispatched, production edits, staging, commits, pushes, branches, worktrees, connections, service calls, backend restarts or infrastructure changes by Step 4.

## Decision

**Next: request a narrowly scoped code critical-path investigation/intervention, offline first.** Text pre-dispatch/first-answer regressions and Calendar phase misses are demonstrated in the instrumented runtime; actual slow native writes and slow live provider windows are not. Do not choose infrastructure placement, migration, model changes or saver-facade activation from synthetic timings.

| Evidence gate | Independently verified outcome |
| --- | --- |
| At least 30% fewer pre-dispatch storage waves | **0/13** applicable scenarios pass; **8 regress** |
| At least 25% fewer complete turn commands | **0/15** pass; midstream cancellation adds 3 commands |
| At least 30% fewer post-seal storage waves | **7/12** pass; **all five Calendar cases miss** |
| Fixed incremental-baseline non-regression cases | **7 pass / 8 fail** |
| Combined per-scenario acceptance cases | **0 pass / 15 fail**; together these are the **23 failed tests**, not 23 independent latency goals |
| Actual storage/provider latency, topology or colocation speedup | **Insufficient evidence** |
| Full pre-initiative improvement | **Unverified:** matching full baseline missing |
| Saver read facade | Default remains gated; no native conformance pass |

## Tested source and provenance

- Working directory: `D:/Peter/Aurvin Agent/Aurvin`, branch `main`. HEAD **`2a32994bd27b8a98ecce02a12d2a39e45e97e76b`**; last production implementation **`5ec145e`**. Production `backend/src` and `frontend/src` have no diff from HEAD. Verification used this HEAD **plus the uncommitted follow-up files below**, not a clean committed candidate. No follow-up commit was created.
- Incremental baseline **`35eb6e85d0b80f3d88abf32218120ce19a7a32d8`** already includes phases 0–6. Step 4 independently compared **241 extracted baseline production files byte-for-byte against a fresh in-memory Git archive** of that revision, plus **324 remaining test/config/asset files**, excluding the two instrumented overlays. Source/test file sets also match, with no extra files. Both instrumented fixture/spec files are byte-identical between the extracted baseline and current checkout. No baseline production file was edited by Step 4.
- Step 4 parsed the original baseline/current raw logs and matched their delayed-profile summaries to the two saved JSON artifacts, **15 scenarios each**. Fresh candidate output exactly matches Step 1's original candidate output for **all 30 rows across both profiles**, including histograms, phase counts and boundaries. Command histogram sums/read-write totals reconcile, with zero failed emulated commands in those measured scenarios. The baseline execution was **not rerun**: its available source, identical instrumentation and raw logs were independently checked instead. This does not retroactively attest every aspect of its process environment or network isolation.
- Baseline/current committed lockfiles have no difference. Installed backend versions freshly checked: Node **v24.18.0**, Vitest **4.1.11**, MongoDB driver **6.21.0**, LangGraph **1.4.19**, MongoDB saver **1.4.1**. Dependencies were not installed or changed.
- Historical `verification.md` denominators (Calendar read **289**, create **344**, new text **216** commands) are **not independently reproduced**. The identified incremental snapshot yields **266**, **320**, **205**, respectively. Do not mix historical totals with fresh phase boundaries. Even historical read/create denominators imply only **11.8% / 10.2%** command savings, below 25%.
- The initiative-start `654935d` predates the runtime harness. No matching full pre-initiative whole-runtime run was reconstructed here. Historical **227→180** total-wave claims are not this independently checked baseline, and total waves never establish phase-goal attainment.

### Exact tested follow-up code state (SHA-256)

All paths below are under `backend/test/performance/`. These hashes identify the dirty test/harness state, independently recorded in `latency-step4-evidence.log` under the approved temporary directory.

| File | SHA-256 |
| --- | --- |
| `durable-latency.spec.ts` | `a92507ecbddff3dd6e3b5e5568e5d60f5e18e3f38c3270ae1aa364935d2e129d` |
| `latency-runtime-fixture.ts` | `61a7e900c1554b61a12e81f3461523eab4b0a8b360e9b400d195878a38bfa9f6` |
| `native-database.ts` | `69689c04243b99116db62e0bf5e0a953ea0b53c389a324271fad25b2137187bc` |
| `native-latency.e2e-spec.ts` | `2545a7a305bb607adae53a1ce8610c072164fd3d5a8dd123e5c2f3135d407f03` |
| `native-preparation.spec.ts` | `2679557288118bd5aa4201872a094c2cde976c7663f8ae3c09f225aa96b63993` |
| `native-runtime-preparation.spec.ts` | `e1e02ba025c24c084f92d59eb8ae3de64430bd1cadf4f9c3e267ce651ace2511` |
| `native-runtime.ts` | `572eb163cf9d2637e39386a733847246ae9fecd21792561190a9a01de5339ace` |
| `native-safety.ts` | `96a573810f57c0bc6da0af6fdc390e6d3021892b9cbde2fb4707dff5860de523` |

## Fresh Step 4 checks

Performed locally around **20:02–20:05 +05:30**. Results below are Step 4 executions, not inherited suite claims. Builds compile/bundle only; they do not attest a running server. No application `.env`/secret files or actual URI values were inspected.

| Check | Actual result |
| --- | --- |
| Backend `npm run build` | **Pass**, exit 0 |
| Backend `npm run lint` | **Pass**, exit 0; **514 warning lines**, not warning-clean |
| Backend scoped offline performance + two benchmark specs | **109 passed / 23 failed / 0 skipped**, 7 files, exit **1**; performance subtotal **97 passed / 23 failed**, benchmark subtotal **12 passed** |
| New native suite, explicitly disabled | **0 executed / 6 skipped**, one file skipped, exit 0; not native correctness, conformance or latency evidence |
| Backend additional broad test-tree `tsc --noEmit --incremental false` | **Fail**, exit **2**, **196 diagnostics**; no `native-*` preparation-file diagnostic. Not baseline-isolated, not a verified baseline defect count |
| Frontend build with dotenv disabled | **Pass**, exit 0; 86 modules, chunk-size warning remains |
| Frontend `npm run lint` | **Pass**, exit 0; **46 warning lines** |
| Frontend complete configured Node test suite with dotenv disabled | **495 passed / 0 failed / 0 skipped**, 68 files, exit 0; not browser E2E |
| Provenance/log/histogram/gate reconciliation | **Pass**; baseline production bytes, harness equality, 30 fresh/prior rows and goal arithmetic checked |
| Task-document local links/source ranges and all changed/untracked task-file whitespace | **Pass**: 13 files, 51 links, 20 source ranges; see final check record below |

The initial disabled-native command used `npm run test:e2e ... --config <wrapper>` and exited **1 before discovery**, because that script already supplies `--config`; no tests ran. The corrected command below uses `npm test` with the same imported e2e configuration and selected exact filename. This is a verification-command correction, not a suite/code change.

### Exact commands and safe configuration

Logs and temporary wrappers/scripts are in **`C:/Users/Peter/AppData/Local/Temp/opencode/`** (abbreviated `$T` below). PowerShell log output is UTF-16LE. Wrappers import the existing named project config and return `{ ...config, envDir: false }`; they change no discovery/assertions and prevent automatic application dotenv loading. No app configuration values are read to create them. Backend test processes explicitly overwrite the test URI/prefix with empty strings without retrieving their existing values. Only inspected fake/injected offline files are selected; blanket backend discovery and broad e2e were deliberately not executed.

```powershell
$T = 'C:/Users/Peter/AppData/Local/Temp/opencode'
# backend/
npm run build > "$T/latency-step4-backend-build.log" 2>&1
npm run lint > "$T/latency-step4-backend-lint.log" 2>&1
$env:AURVIN_NATIVE_PERF_ENABLE = 'disabled'
$env:AURVIN_TEST_MONGODB_URI = ''
$env:AURVIN_TEST_DB_PREFIX = ''
npm test -- test/performance test/benchmark/runner.spec.ts test/benchmark/latency.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --silent=false --disableConsoleIntercept --reporter=verbose > "$T/latency-step4-backend-offline.log" 2>&1
# Initial command: exited 1 before discovery because of duplicate --config:
npm run test:e2e -- test/performance/native-latency.e2e-spec.ts --config "$T/latency-step4-backend-disabled.config.mjs" --maxWorkers=1 --reporter=verbose > "$T/latency-step4-native-disabled.log" 2>&1
# Corrected invocation, same disabled configuration:
npm test -- test/performance/native-latency.e2e-spec.ts --config "$T/latency-step4-backend-disabled.config.mjs" --maxWorkers=1 --reporter=verbose > "$T/latency-step4-native-disabled-retry.log" 2>&1
node node_modules/typescript/bin/tsc --noEmit --incremental false > "$T/latency-step4-backend-typecheck.log" 2>&1
# frontend/
npm run build -- --config "$T/latency-step4-frontend-build.config.mjs" > "$T/latency-step4-frontend-build.log" 2>&1
npm run lint > "$T/latency-step4-frontend-lint.log" 2>&1
npm test -- --config "$T/latency-step4-frontend-test.config.mjs" > "$T/latency-step4-frontend-test.log" 2>&1
# repository root
python "$T/latency-step4-evidence.py" > "$T/latency-step4-evidence.log" 2>&1
python "$T/latency-step4-doc-check.py" > "$T/latency-step4-doc-check.log" 2>&1
git diff --check
# Expected exit 1: matching runtime harness is absent from initiative-start source:
git cat-file -e 654935d:backend/test/performance/latency-runtime-fixture.ts
```

Backend wrappers import `backend/vitest.config.ts` and `backend/vitest.config.e2e.ts`, respectively; frontend wrappers import `frontend/vite.config.ts` and `frontend/vitest.config.ts`. The selected backend directory excludes `.e2e-spec.ts` under the offline config. The separately selected native suite reads its enable flag before any authorization/client work, and that flag is disabled. Preparation tests use injected constructors or a mocked opener; model/Google fetches use fixtures. No real native attempt is inferred from a skipped file.

### Earlier evidence independently inspected, not freshly rerun

- Step 1 raw baseline log: **46 passed / 15 acceptance cases filtered**, not a candidate acceptance pass. Original candidate: **55 passed / 23 failed**. Correctness-only diagnostic: **48 passed / 30 gate cases filtered**, not acceptance. Their raw footer counts were independently checked.
- Step 2 raw preparation log: **42 passed**; its performance log: **97 passed / 23 failed**. Its broad typecheck capture has **201 diagnostics**, independently recounted, none in the new native files. The fresh 196 differs; neither capture isolates a baseline or proves a fix, and no warning/error was suppressed to reconcile them.
- Step 3 reports **12 offline passes**; the same two specs contribute **12 fresh passes** here. Live turns remain **0**.
- Older `verification.md` backend **2145 pass / 10 skip**, e2e **22 pass / 129 skip** and other whole-suite claims were **not independently rerun here**. Do not present them as fresh comprehensive certification or add them to this selection's totals.

## Measurement scope and meaningful findings

The comparison runs real repositories, ownership, default stock saver and runtime over a BSON fake with deterministic external transports and simplified Calendar capability/credential services. Complete **emulated** command histograms include ownership/saver work within submit/retry→execution settlement; bootstrap, seed turns, later probes and shutdown are excluded. This is neither real MongoDB wire traffic nor full real-provider E2E.

Pre-dispatch ends at first model fetch; post-seal begins at acknowledged executing-attempt saver `put` with `sealed=true`, not at finalizing status or provider end. First answer means emitted text delta, not progress/tool output. Cancellation's custom sink lacks first-answer capture; no dispatch/no new seal is **n/a**, not a zero-latency result. Recovery measures reconciliation, not its failed original turn. See [Step 1's complete matrix and exclusions](acceptance-offline.md).

| Selected matching scenario | Commands | Pre-dispatch waves | First-answer waves | Post-seal waves |
| --- | --- | --- | --- | --- |
| New text | 205→188 | **84→88** | **95→98** | 73→44 |
| Follow-up 1 / 20 | 201→183 | **79→83** | **90→93** | 74→44 |
| Calendar read | 266→255 | 107→102 | 181→176 | **48→42** |
| Calendar create | 320→309 | 107→102 | 235→230 | **48→42** |
| Calendar proposal reply | 278→267 | 190→185 | 193→188 | **48→42** |
| Rejection/retry | 199→181 | **79→83** | **90→93** | 74→44 |
| Midstream cancellation | **164→167** | **84→88** | unavailable | n/a |

At injected 67/449 ms, new-text first delta changes **15,533→16,116 modelled ms** (+583), while total changes **30,838→29,632** and post-seal tail **10,239→7,150**. Better total/tail therefore does **not** establish better first answer. Calendar read/create command improvements are only **4.1% / 3.4%** on the verified incremental denominator, and all Calendar post-seal waves improve just **12.5%**, below 30%.

Both timing profiles use dependency-wave scheduling; the zero profile is zero by construction, not a CPU benchmark. Timer-overlap unit coverage does not calibrate whole-runtime timings to real hardware. No synthetic mean read/write is native RTT, no model-fetch return mark is provider stream end, and no wave count is a network-hop count. Native command overlap/busy time does not prove causal waves. The prepared [native suite](acceptance-native.md) can eventually produce complete command-monitor counts and monotonic timings, but not the missing causal phase graph; its six cases are not the full offline matrix and its smoke sample ceiling is not p95 certification.

## Historical placement contradictions — retain as hypotheses

[placement-decision.md](placement-decision.md) remains untouched. Its “on-paper”/external-unrun status contradicts using its other assertions as measured facts:

- Lines 19–30 and 50–62 turn synthetic waves/delays into an “irreducible” physical network floor and a negligible-CPU conclusion. Neither follows from the scheduler; code critical-path regressions are visible here.
- Lines 38–44 call a remote cloud database/operator attestation and particular product/quorum/journaling properties facts or requirements. This follow-up has **no actual service/topology attestation**; the admitted replica-set requirement is not discovery of the running service, and majority concern does not establish the claimed explicit `journal:true` configuration or timing formula.
- Lines 73–77, 90–94, 120–136 present local/colocated read/write ranges, 800–1200 ms provider TTFT, **2.5–3.5 s** totals and **~90%** improvement. They are **unsupported hypotheses**, not measured forecasts or approved deployment choices. They cannot close acceptance, storage/provider attribution or saver conformance gates.
- Its suggested local service setup is not authorized by this follow-up either. No topology is certified; no public deployment, provisioning, migration or model change is recommended as an immediate action.

## Minimal next intervention proposal — not implementation or authorization

1. **First small code task, subject to approval:** isolate the **four added pre-dispatch waves / three added first-answer waves** in new/follow-up text and retry against `35eb6e8`, including cancellation's extra commands. Start with the shared dispatch/observation/ownership path, not UI symptoms: new-text's labelled model-observation command count grows **32→44**, ownership guard reads **58→62**. These are investigation leads, **not a proven root cause**. Trace awaited dependencies and reuse existing phase/receipt/observation helpers only where redundancy is demonstrated. Propose the smallest shared-path removal/reordering that retains durable identity before output, acceptance, synchronous majority acknowledgments, spend/accounting evidence, fencing and ready-after-cleanup. Do not delete safeguards or claim those counts alone justify a change.
2. Keep the original fixed regression caps and **30% / 25% / 30%** gates untouched. Add one focused runnable failing check for the demonstrated shared-path defect before its fix, rerun the same offline matrix, and report residual misses. Calendar remains a separate visible backlog: pre-dispatch **102** waves (**185** for proposal reply), post-seal **42**, with all five cases below goals. Trace shared Calendar critical-path dependencies next; do not promise all targets from the text correction or increase output/context/tool budgets to hide them.
3. **Storage investigation only if actual native writes are measured slow:** obtain separately authorized matching native baseline/current command intervals/counts, acknowledged-seal milestones, durability/correctness results and missing causal instrumentation/coverage. Only then distinguish client waiting, server work, replication/topology and background load using operator-attested evidence. Infrastructure comparison would be a later separately approved measurement, not a claimed colocation speedup.
4. **Provider investigation only if measured live windows are slow:** first satisfy the [live gates](acceptance-live.md), then compare per-dispatch first event/output/text/end and Calendar response windows. Account for transport/backpressure and tool/storage overlap; do not change the model on synthetic evidence. No live provider sample currently supports a provider bottleneck conclusion.

### Authorization and technical gates that remain closed

- Native: explicit named operator authorization/expiry, dedicated non-application replica-set attestation/set name, existing operator-supplied test URI, exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, generated DB create/drop and bounded sample-load permission. Maximum prepared invocation **18 databases / 81 turns**; paired maximum **36 / 162**, not automatically authorized. Matching baseline source/harness/dependencies must be attested, with coverage gaps and real command-monitor exclusions retained.
- Saver facade: separate native stock/facade restart/pending-write/scope/bounds/failure conformance; performance preparation or skip is not permission to enable it.
- Live: offline failures resolved or an explicit diagnostic exception, actual native evidence, numerical cost/token/request/deadline/data budgets and enforcement, matched running source/builds, approved isolated synthetic account/target visibility, selected-scenario fail-closed harness, and actual mutation/out-of-scope-read denial. Existing CLI config does **not** enforce read-only execution or cumulative spending and cannot safely substitute for this harness. Begin read-only only after authorization; event creation requires separate disposable-target mutation/reconciliation permission. Unknown billing stays unknown.
- No execution authorization follows from this report. No backend restart, infrastructure setup or deployment is included. If preparation changes are required, the orchestrator should continue the **same owning Step 1/2/3 agent**, not dispatch reviewers/fixers; no preparation defect requiring such continuation was demonstrated by these fresh checks. Failed performance gates and failed broad typechecking remain visible.

## Complete follow-up file inventory and ownership

All changes remain **uncommitted/unstaged**. Only the first two files are tracked modifications; the other listed follow-up files are new/untracked. No package/lockfile or production configuration changed.

| Owner | Changed files |
| --- | --- |
| Step 1 | [durable-latency.spec.ts](../../backend/test/performance/durable-latency.spec.ts), [latency-runtime-fixture.ts](../../backend/test/performance/latency-runtime-fixture.ts), [acceptance-offline.md](acceptance-offline.md) |
| Step 2 | [native-safety.ts](../../backend/test/performance/native-safety.ts), [native-database.ts](../../backend/test/performance/native-database.ts), [native-runtime.ts](../../backend/test/performance/native-runtime.ts), [native-latency.e2e-spec.ts](../../backend/test/performance/native-latency.e2e-spec.ts), [native-preparation.spec.ts](../../backend/test/performance/native-preparation.spec.ts), [native-runtime-preparation.spec.ts](../../backend/test/performance/native-runtime-preparation.spec.ts), [acceptance-native.md](acceptance-native.md) |
| Step 3 | [acceptance-live.md](acceptance-live.md) only |
| Orchestrator | [acceptance-state.md](acceptance-state.md), not modified by Step 4 |
| Step 4 | This [acceptance-report.md](acceptance-report.md) only in the repository; temporary safe config wrappers/evidence/check scripts and logs outside it |

Final check record: the explicit post-write checker passed **13 changed/untracked task files**, **51 local Markdown links** and **20 linked source line ranges**, with no trailing whitespace or conflict markers. `git diff --check` passed; explicit whole-file content checks cover the untracked files that Git's diff check omits. HEAD and the empty staged diff are unchanged. The provenance/check logs live under the temporary directory above; raw evidence is local, not durable CI/public evidence. The orchestrator owns the subsequent status transition. **No green overall acceptance claim is warranted.**

## Post-Intervention Addendum (2026-10-30)

Independent verification of the I1–I4 implementation follow-up was completed and recorded in [implementation-verification.md](implementation-verification.md).
- Critical-path optimizations implemented: I1 shared text dispatch; I2 Calendar debit receipts & publication.
- Post-seal storage wave targets: **12/12 passed** (100%).
- Pre-dispatch storage wave targets (0/13 passed) and wire command targets (0/15 passed) remain failing.
- Overall latency acceptance remains **FAILED offline** (15 acceptance failures in `durable-latency.spec.ts`).
- Native and live benchmarks remain **BLOCKED** due to missing external authorizations.
- Full details, exact commands, and diagnostic provenance: see [implementation-verification.md](implementation-verification.md).

