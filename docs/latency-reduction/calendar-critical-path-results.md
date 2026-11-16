# I2 — Calendar critical-path results

2026-10-30. **Offline optimization implemented; Calendar post-seal goal now passes. Overall acceptance still FAILED.** Review **skipped**. No agents, staging, commits, push, worktrees, application dotenv/secret access, database/network/provider/Calendar/browser/staging call, backend restart, model/configuration/infrastructure change or saver-facade activation.

## Outcome and root causes

Two existing mechanisms were not applied on Calendar's live path:

1. [CalendarLoop reservation](../../backend/src/chat-runtime/calendar-loop.ts) separately fenced budget creation and dispatch reservation. They are consecutive storage-only operations with no intervening external request. An existing bounded `owner.runPhase` now serializes them under one authoritative ownership validation pair, preserving each write's synchronous acknowledgment, receipt checks, revision CAS, operation ceiling, deadline/lease checks and error latching. The adapter's **before-dispatch ownership/account checks, dispatched-state acknowledgment and final fence remain outside the phase and unchanged**. A new budget/reservation saves **2 reads/2 pre-dispatch waves**. A continuation or proposal reply may already have a budget, so this phase does not magically remove more work there.
2. [Calendar publication](../../backend/src/chat-runtime/calendar-publication.ts) discarded the assistant append's acknowledged receipt, reread that assistant before completion, and performed separate ownership validation for all six archive/lifecycle writes. Live publication now uses existing `appendConfirmed` → **the exact opaque receipt** → `updateCompletionConfirmed`. Existing insert confirmation handles conflicts/ambiguous acknowledgment; completion remains revision-CAS. Four archive operations share a bounded `publication-stage` phase; two attempt transitions share a separate `publication-commit` phase. This saves **2 assistant reads + 6 archive guard reads + 2 lifecycle guard reads = 10 commands/post-seal waves**. Graph-boundary publication, cleanup and terminal emission stay outside both phases.

No writes were deleted, delayed or made asynchronous. Bounds are 4/4/2 operations for reservation/archive/lifecycle; phase deadline is the smaller of the persistence budget and lease expiry minus 1 second. This reuses the existing single-process exclusive ownership mechanism, not an unfenced local boolean or a claim of multi-instance safety. Stores without the optional mechanisms retain the prior path. Recovery supplies no live evidence and retains strict assistant/content reads and lifecycle CAS. I1 text/model accounting changes were preserved and remain unchanged by I2.

### Full-flow trace and deliberately retained work

Admission persists input/attempt/acceptance and binds the accepted deadline. `runCalendarTurn` creates `CalendarTurnLedger` and `CalendarLoop`; `decide` checks ownership/account/proposal authority and assembles context, reserves a spend hold/dispatch identity, then the model adapter invokes `beforeDispatch`. Ledger observations already reuse budget/dispatch receipts; identity observations are acknowledged before output, unknown billing retains its spend hold, and dispatch completion remains durable. Tool execution reads the saved decision, charges stable logical/create debit identities, performs fresh capability/preflight checks, and persists operation state/events, source retention and matched result references before continuation. Proposal replies retain disclosure/revision/consumption authority and never retarget a previous intent.

Seal still writes the accounting aggregate, restores the ordered selected history with the new input once, and awaits the unchanged stock saver. Publication follows the confirmed seal, then assistant completion/activity, manifest, confirmed graph boundary, finalizing and terminal attempt, and finally cleanup before terminal frames. Recovery reuses saved narration/results without inference replay. Production callers checked: the loop's sole reservation entry; ledger budget/observation/aggregate helpers and operation writer; `publishCalendarTurn` live caller and strict reconciliation caller. Direct test callers retain legacy behavior.

The remaining accounting/debit readbacks are not proven redundant: some reconstruct private dispatch claims, resolve uncertain writes, preserve idempotent debit evidence or verify stale revisions. Capability/preflight rechecks and operation-event acknowledgments cross real authorization/effect boundaries. They were **not removed for counts**, nor were phases stretched across model/provider/tool calls. Further elimination requires a separately tested evidence-carrying protocol, not deletion of guards.

## Fresh verification

Working directory `D:/Peter/Aurvin Agent/Aurvin`, branch `main`, HEAD `2a32994bd27b8a98ecce02a12d2a39e45e97e76b`, plus preserved earlier dirty work/I1 and concurrent disjoint native/live preparation. No committed candidate exists. Incremental baseline remains **`35eb6e85d0b80f3d88abf32218120ce19a7a32d8`**; the full pre-initiative baseline is unavailable. I2 freshly ran the candidate; **pre-I2 values below come from I1's saved raw log**, and baseline values from [independently checked offline evidence](acceptance-offline.md), not a newly rerun baseline.

| Check | Result | Raw log under approved temp directory |
| --- | --- | --- |
| Focused red, before production edits | **2 failed**, expected distinct reread receipt and no Calendar phases | `latency-i2-red.log` |
| Initial same-selection green | **2 passed** | `latency-i2-green.log` |
| Final acknowledgment/recovery + ownership phase safety | **12 passed**, 2 files | `latency-i2-safety-final.log` |
| Final expanded Calendar/model/accounting/ownership/context/recovery selection | **726 passed / 0 failed / 0 skipped**, 65 files | `latency-i2-focused-verified.log` |
| Full safe performance + original two benchmark matrix | **127 passed / 15 failed / 0 skipped**, 10 files; exit 1 | `latency-i2-matrix-verified.log` |
| Backend build | **Pass**, exit 0 | `latency-i2-build-final.log` |
| Backend lint | **Pass**, exit 0; **514 warning lines**, not warning-clean | `latency-i2-lint-verified.log` |
| Metric/histogram/profile/frozen-source reconciliation | **Pass**, 30 current profile rows; non-Calendar metrics unchanged | `latency-i2-metrics.log` |
| I2 document/source and Git whitespace checks | **Pass**, 5 owned files / 9 local links / 3 source hashes; staged diff empty | `latency-i2-check.log` |

The five new tests verify exact receipt linkage, phase bounds, held append acknowledgment blocking completion/terminal emission, and both pre-commit and post-commit missing acknowledgment recovery. Recovery publishes exactly one assistant message and does not repeat inference. Existing ownership tests verify control handoff/release blocking, operation ceilings, deadline/lease expiry, nested-phase/mismatched-lease rejection and all-settled error drain. Existing selected Calendar suites cover tool effects/conflict/retention, unknown costs, debit idempotency, cancellation, failure windows, saved results and cleanup. Counts overlap across commands and must not be added as unique tests.

Intermediate issues were resolved, not hidden: the first build found I2 type narrowing/optional-method diagnostics plus one concurrent live-owner null-body diagnostic (not edited by I2); subsequent builds pass. A test-only attempt to obtain a spy's default implementation returned undefined: the intermediate expanded/matrix captures had one additional harness failure (**725/1**, **126/16**). Capturing the original bound method fixes that helper; final reruns above are clean except the unchanged acceptance failures. No acceptance assertion or production safety behavior was relaxed to fix these issues.

### Exact commands

From `backend/`; `$T = 'C:/Users/Peter/AppData/Local/Temp/opencode'`. Before **every test invocation**, overwrite `AURVIN_NATIVE_PERF_ENABLE='disabled'`, `AURVIN_TEST_MONGODB_URI=''`, `AURVIN_TEST_DB_PREFIX=''` without reading prior values. Existing Step 4 wrapper imports the project Vitest config with `envDir:false`. Only injected/BSON-fake selections run; default discovery excludes native/e2e files. No dependencies/package/lockfiles changed.

```powershell
$env:AURVIN_NATIVE_PERF_ENABLE='disabled'
$env:AURVIN_TEST_MONGODB_URI=''
$env:AURVIN_TEST_DB_PREFIX=''
# Red and initial green used the first filename only:
npm test -- test/performance/calendar-critical-path.spec.ts test/persistence/owned-phases.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --reporter=verbose
npm test -- test/runtime/calendar test/persistence/calendar test/model test/runtime/accounting-completion.spec.ts test/runtime/finalization-repair.spec.ts test/runtime/stream-quiescence.spec.ts test/runtime/work.spec.ts test/persistence/owned-phases.spec.ts test/persistence/claim-executor.spec.ts test/persistence/local-owner.spec.ts test/persistence/accounting-evidence.spec.ts test/context/calendar-context.spec.ts test/plugins/integration/calendar-execution.spec.ts test/performance/calendar-critical-path.spec.ts test/performance/text-critical-path.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --reporter=verbose
npm test -- test/performance test/benchmark/runner.spec.ts test/benchmark/latency.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --silent=false --disableConsoleIntercept --reporter=verbose
npm run build
npm run lint
# repository root:
python "$T/latency-i2-metrics.py"
python "$T/latency-i2-check.py"
git diff --check
```

All output was redirected to the named logs (PowerShell UTF-16LE). Final focused/matrix counts reflect concurrent preparation tests present at execution; they are not native/live execution evidence. Broad backend typecheck, blanket backend discovery, frontend, native/e2e, browser and live checks were not run by I2. Prior broad typecheck issues are not claimed resolved.

## Complete before/after matrix

**I1 candidate → I2 candidate**, not independent-baseline denominators. Counts cover complete emulated commands in the frozen turn window; failures=0. Wave tuple **pre-dispatch / first-answer / post-seal**. Histograms: `find=R`, `findAndModify=4` (recovery=1), `update=W-findAndModify`. Both injected profiles have identical counts/waves. Total waves are reported separately and **never substitute for phase gates**.

| Scenario | R/W before → after | Commands | Phase waves before → after | Total waves |
| --- | --- | --- | --- | --- |
| new-text | 134/45 → unchanged | 179 → 179 | 83/92/44 → unchanged | 171 → 171 |
| follow-up-1 / follow-up-20 | 133/41 → unchanged | 174 → 174 | 78/87/44 → unchanged | 167 → 167 |
| follow-up-38-at-80-msg-ceiling / follow-up-39 | 135/41 → unchanged | 176 → 176 | 80/89/44 → unchanged | 169 → 169 |
| follow-up-50-test-budget | 137/41 → unchanged | 178 → 178 | 81/90/44 → unchanged | 170 → 170 |
| calendar-text | 141/43 → 129/43 | 184 → 172 | 102/105/42 → 100/103/32 | 177 → 165 |
| calendar-read | 195/60 → 183/60 | 255 → 243 | 102/176/42 → 100/174/32 | 248 → 236 |
| calendar-create | 241/68 → 229/68 | 309 → 297 | 102/230/42 → 100/228/32 | 302 → 290 |
| calendar-conflict | 178/51 → 166/51 | 229 → 217 | 102/222/42 → 100/210/32 | 222 → 210 |
| calendar-proposal-reply | 212/55 → 202/55 | 267 → 257 | 185/188/42 → 185/188/32 | 261 → 251 |
| rejection-retry | 132/40 → unchanged | 172 → 172 | 78/87/44 → unchanged | 167 → 167 |
| cancel-before-dispatch | 71/21 → unchanged | 92 → 92 | n/a | 86 → 86 |
| cancel-midstream | 125/35 → unchanged | 160 → 160 | 83/n/a/n/a → unchanged | 152 → 152 |
| reconnect-finalization-recovery | 67/12 → unchanged | 79 → 79 | n/a/77/n/a → unchanged | 77 → 77 |

Calendar publication command attribution **36→26** in every case; model-observation **36→34** text/conflict, **66→64** read/create, proposal **120 unchanged**. All admission/attachment/context/tool-evidence/seal/release counts remain unchanged. Full phase tuples are preserved in `latency-i2-metrics.log`.

Injected 67/449 ms timings (dispatch / first text / post-seal tail / total **modelled ms**, not service latency): text `16002/16585/6252/28285 → 15868/16451/5582/27481`; read `16002/27836/6252/39536 → 15868/27702/5582/38732`; create `16002/34510/6252/46210 → 15868/34376/5582/45406`; conflict `16002/34356/6252/34356 → 15868/33552/5582/33552`; proposal `26147/26730/6252/38497 → 26147/26730/5582/37827`. Zero-delay times are zero by construction. The conflict's first text follows publication; proposal pre-dispatch includes authorized tool work. Cancellation/recovery exclusions remain as in [offline evidence](acceptance-offline.md).

## Frozen goals and remaining work

Against the original incremental baseline:

| Calendar scenario | Complete commands baseline → current | Reduction | Pre waves baseline → current | Post waves baseline → current |
| --- | --- | --- | --- | --- |
| text | 195 → 172 | 11.8% | 107 → 100 (6.5%) | 48 → 32 (**33.3%**) |
| read | 266 → 243 | 8.6% | 107 → 100 (6.5%) | 48 → 32 (**33.3%**) |
| create | 320 → 297 | 7.2% | 107 → 100 (6.5%) | 48 → 32 (**33.3%**) |
| conflict | 240 → 217 | 9.6% | 107 → 100 (6.5%) | 48 → 32 (**33.3%**) |
| proposal reply | 278 → 257 | 7.6% | 190 → 185 (2.6%) | 48 → 32 (**33.3%**) |

All **15/15 non-regression cases pass**. All **12/12 applicable post-seal goals pass** (I1: 7/12). Pre goal remains **0/13**, command goal **0/15**, combined acceptance **0/15**. The remaining 15 failed tests are exactly the frozen combined acceptance case for each scenario in the full matrix; no newly failing correctness case remains. Thresholds, baseline, frozen instrumentation and measurement window were never edited.

**Safe next tasks:** (1) separately design/test receipt-aware debit + aggregate evidence reuse, including private claims, stale receipt/CAS, duplicate debit repair and ambiguous-write restart tests; these are leads, not validated removal permissions. (2) Investigate admission/context/stock-saver dependencies shared with text: new Calendar admission still costs 48 commands and regular pre-dispatch needs another **26 waves** removed to reach <=74; proposal needs **52** to reach <=133. (3) After concrete authorization/prerequisites, original native/live owners can measure actual matching command intervals, causal phase gaps and bounded read-only provider windows. Their offline preparations do not authorize execution. No proof establishes an irreducible floor or justifies infrastructure/model changes. Required pre/command savings are much larger than the proven redundancies; stop this minimal intervention rather than drop fences or expand phases across external work.

## First-intervention files and source identity (historical)

- Production: [calendar-loop.ts](../../backend/src/chat-runtime/calendar-loop.ts), [calendar-publication.ts](../../backend/src/chat-runtime/calendar-publication.ts).
- Tests: [calendar-critical-path.spec.ts](../../backend/test/performance/calendar-critical-path.spec.ts).
- Docs: [calendar-critical-path-plan.md](calendar-critical-path-plan.md), this results file.

SHA-256 at the first intervention: loop `ab4c611f5cb125c7ac62abd48401cfd58b04711c96cf844ff46362392adb68f9`; publication `f94c3e2fa2338e893568b2bef2adb2a687abcb66bbe3abeed4e2526b9cb419d0`; test `70d85bd802e362243787a1dbabbe5a8850f2febaee61c75170f949c3b59f9617`. Frozen fixture/spec hashes match [Step 4's identities](acceptance-report.md). No acceptance-state/report, I1 artifacts, native/live harness files or frozen measurement files were edited by I2. All changes remain **unstaged/uncommitted**; the orchestrator owns status transitions. This is an offline code improvement, not native durability/latency certification or deployment readiness.

## Continuation — revision-scoped debit receipts

2026-10-30, same I2 owner. The first intervention/evidence above is preserved, not replaced. **One further safe accounting protocol implemented; aggregate/settlement shortcuts rejected on evidence. Acceptance remains FAILED.** Review still **skipped**. No additional agents, package build, external execution, credentials/configuration reads, Git staging/commit/worktree or changes outside Calendar-specific ownership. I1 concurrently changed shared paths; the matrix below is explicitly a concurrent-source diagnostic, not an isolated I2 comparison.

### Proven cause and exact changes

The ledger already held a genuine acknowledged budget receipt, but `consumeDebitNow` passed only a plain request to `debit`. The repository reread that envelope before CAS. It then returned a plain budget, causing the ledger to discard its prior receipt and reread again before the next counter/reservation update. Both reads can be replaced by **opaque, store/scope-bound revision evidence used as a CAS expectation**, not trusted as a statement of current state.

- [Calendar accounting contract](../../backend/src/contracts/calendar-accounting.ts): optional server-only `expectedBudget` in the existing internal request and `budgetReceipt` in successful outcomes. They are not persisted or accepted by the wire schema. Existing callers/stores can omit them; no new interface/facade/dependency.
- [Accounting repository](../../backend/src/persistence/calendar-accounting.ts): validates the receipt's WeakMap provenance, store, scope and private envelope; uses the existing exact logical revision + `_revision` CAS and its exact uncertain-write readback. Preserves private `_calendarClaims` and Decimal128 money. The new receipt is returned **only after both budget and debit-record acknowledgments**. Missing evidence uses the existing strict read. Duplicate evidence always rereads current counters and repairs the separate debit row; stale CAS uses strict reread/retry. A concurrently landed same debit identity is now payload-compared before confirmation, preventing a different decision's debit from being acknowledged under the new stale-receipt path.
- [Calendar ledger](../../backend/src/chat-runtime/calendar-budget.ts): forwards the existing receipt and retains the returned one. Errors still invalidate all existing caches. A store returning no receipt retains the strict reload path. Per-turn lower limits, deadlines, serialization, spend holds, external dispatch identity/permissions/ownership checks and recovery remain unchanged.

All production debit callers were checked: v2 facade → repository; `CalendarTurnLedger.consumeDebitNow` is the sole runtime caller, reached by stable logical-tool/create helpers in the loop and operation writer. The observer and fixture wrappers pass the request object unchanged, so no adapter/harness edit was necessary. `getDebit` remains a strict public repair/read helper; it has no production runtime caller. Successful debit and request-counter sequencing remains synchronous and fenced through the same `o.write` callback.

**Isolated runnable protocol result:** old compatible caller behavior (no expectation, discard returned envelope) costs **2 reads + 3 writes = 5 commands** for debit followed by the next request counter. Acknowledged evidence costs **0 reads + the same 3 writes = 3 commands**. Both end with byte-equivalent public budget data, one debit and unchanged money/claims. This is an isolated two-read improvement, **not 40% whole-turn acceptance**.

### Why the other reads remain

| Boundary | Evidence and decision |
| --- | --- |
| Duplicate debit | A receipt may predate later counters, and the separate debit record may be missing. Strict current-envelope read plus idempotent row repair retained; the test deletes that row and advances counters before replay. |
| Stale/uncertain debit | CAS can lose or acknowledgment/readback can fail after commit. Strict readbacks/restart repair retained. New tests preserve the concurrent counter and charge once, including same-ID/different-payload conflict. |
| Aggregate dispatch set | `putAggregate` performs **one current dispatch-set query**, not a receipt reread. A genuine old receipt set omits a subsequently reserved dispatch of the same attempt. A new test proves strict discovery refuses that stale aggregate before insertion. There is no aggregate CAS that pins the complete set; passing old receipts would delete this check, so no shortcut was enabled. |
| Money settlement | The query verifies every claimed dispatch exists and matches immutable private claims before recomputing held/settled money. Existing missing-claimed-dispatch and stale budget-CAS tests remain green. More importantly, deterministic matrix wires report **no money**, retaining holds: settlement scans are **not on these measured model paths**. Optimizing that branch could not close these gates. |
| Tool/operation evidence | Current read/create tool-evidence totals are **25 / 79 commands**. These include decision reads, capability/preflight/authority checks, stable debit records, operation state/events, retained sources and matched tool results. The two debit reloads are proven removed; the rest are **not all proven irreducible or redundant**. No broad untested receipt conversion of tool-effect records was attempted. |

The read/create path contains one logical/create debit respectively: create's debit already counts its own logical action. Conflict has no subsequent request-counter update, so it saves only the debit's first read. Proposal reply performs its charged tool work before model dispatch. Measured I2-specific contribution is therefore **read 2 commands/waves, create 2, conflict 1, proposal reply 2**, ordinary Calendar text 0. No post-seal work changed in this continuation.

### Checks and exact evidence

All logs/scripts below are under `C:/Users/Peter/AppData/Local/Temp/opencode/`. Same `envDir:false` Step 4 wrapper and URI/prefix overwrite rules as above. No broad/native/e2e discovery. Package build deliberately left to the final verifier.

| Check | Actual result | Log |
| --- | --- | --- |
| Repository protocol red before implementation | **6 passed / 6 failed**: ignored receipt, absent receipt result/provenance checks, uncertain-budget crash setup cannot reach write without receipt | `latency-i2-debit-red.log` |
| Repository protocol + existing v1/v2 accounting green, before ledger activation | **33 passed**, 3 files | `latency-i2-debit-green.log` |
| Runtime forwarding red before ledger edit | **1 failed / 5 filtered**, expected acknowledged budget but received undefined | `latency-i2-ledger-red.log` |
| Initial ledger/accounting/logical-tool green | **45 passed**, 4 files | `latency-i2-ledger-green.log` |
| Expanded Calendar/model/accounting/ownership/context/recovery selection | **741 passed / 0 failed / 0 skipped**, 66 files | `latency-i2-debit-focused.log` |
| Final receipt/runtime safety after explicit unknown-money hold assertion | **20 passed**, 2 files | `latency-i2-debit-final-safety.log` |
| Frozen performance + original two benchmark specs, concurrent source | **135 passed / 15 failed / 0 skipped**, 11 files | `latency-i2-debit-matrix-concurrent.log` |
| Lint | **Pass**, 514 warning lines; no warning in I2 continuation files | `latency-i2-debit-lint.log` |
| Scoped no-emit TypeScript selection plus transitive imports | **Fail**, 44 diagnostics outside the five selected continuation files; not baseline-isolated | `latency-i2-debit-types-scoped.log` |
| Profile/histogram reconciliation | **Pass**, all 30 concurrent rows agree across profiles; zero measured emulated command failures | `latency-i2-debit-metrics.log` |
| I2 source/docs and whitespace checks | **Pass**, 9 files / 14 local links / 7 current source hashes / 10 plan steps; frozen measurement hashes unchanged; staged diff empty | `latency-i2-debit-check.log` |

The TypeScript selection imports existing test fixtures and the shared runtime: seven diagnostics were in concurrently edited `durable-chat-runtime.ts`, the rest in existing imported fixture files. None named the five selected continuation files. This is **not a passing typecheck** or proof that every diagnostic predates this continuation. An initial temporary config could not resolve Node/Vitest types; explicit installed type roots fixed that setup issue before the recorded scoped run. No file owned by I1, native/live owners or the frozen harness was edited to suppress diagnostics. Build and stable integrated verification remain the final verifier's responsibility.

Exact commands from `backend/` (reset safe environment variables before each test):

```powershell
$env:AURVIN_NATIVE_PERF_ENABLE='disabled'
$env:AURVIN_TEST_MONGODB_URI=''
$env:AURVIN_TEST_DB_PREFIX=''
# Initial red used the first filename; green added existing accounting suites:
npm test -- test/persistence/calendar-debit-receipts.spec.ts test/persistence/calendar-accounting.spec.ts test/persistence/calendar-multi-accounting.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --reporter=verbose
npm test -- test/performance/calendar-critical-path.spec.ts -t 'forwards acknowledged budget evidence' --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --reporter=verbose
npm test -- test/performance/calendar-critical-path.spec.ts test/persistence/calendar-debit-receipts.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --reporter=verbose
# Expanded 741-pass selection: same full focused command recorded above, plus
# the new receipt file discovered by the existing test/persistence/calendar filter.
npm test -- test/performance test/benchmark/runner.spec.ts test/benchmark/latency.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --silent=false --disableConsoleIntercept --reporter=verbose
npm run lint
node node_modules/typescript/bin/tsc --project "$T/latency-i2-calendar-types.json" --pretty false
# root/:
python "$T/latency-i2-debit-metrics.py"
python "$T/latency-i2-debit-check.py"
git diff --check
```

The 14 repository checks cover fresh/no/forged/foreign/wrong-scope evidence, private claims/Decimal128, stale counter CAS, duplicate row repair, landed payload conflict, exact post-write readback for both writes, read-unavailable-after-budget-commit restart, missing-debit restart, isolated command parity and stale aggregate set. Six real-runtime checks now cover both earlier publication safety and debit receipt propagation; they assert actual tool effect once, held unknown money and zero active work at cleanup. No acceptance threshold or frozen source changed.

### Concurrent-source matrix — not isolated I2 gains

Previous accepted I2 snapshot → source running alongside I1's continuation. R/W and phase wave boundaries retain the frozen scope. Full histogram, phase tuple and modelled timing details are in `latency-i2-debit-metrics.log`; **do not attribute all differences to debit reuse**.

| Scenario | Commands before → concurrent | Pre / first / post waves before → concurrent |
| --- | --- | --- |
| new-text | 179 → 174 | 83/92/44 → 75/84/44 |
| follow-up-1 / follow-up-20 | 174 → 169 | 78/87/44 → 69/78/44 |
| follow-up-38 / follow-up-39 | 176 → 171 | 80/89/44 → 69/78/44 |
| follow-up-50-test-budget | 178 → 173 | 81/90/44 → 69/78/44 |
| Calendar text | 172 → 167 | 100/103/32 → 92/95/32 |
| Calendar read | 243 → 236 (176R/60W) | 100/174/32 → 92/164/32 |
| Calendar create | 297 → 290 (222R/68W) | 100/228/32 → 92/218/32 |
| Calendar conflict | 217 → 211 (160R/51W) | 100/210/32 → 92/201/32 |
| Calendar proposal reply | 257 → 250 (195R/55W) | 185/188/32 → 174/177/32 |
| rejection-retry | 172 → 168 | 78/87/44 → 70/79/44 |
| cancel-before-dispatch | 92 → 87 | n/a |
| cancel-midstream | 160 → 155 | 83/n/a/n/a → 75/n/a/n/a |
| reconnect-finalization-recovery | 79 → 79 | n/a/77/n/a → unchanged |

Calendar admission command attribution **48→43** (proposal **46→41**) belongs to I1's shared work. I2 changes read/create tool-evidence **27→25 / 81→79**, conflict **38→37**, proposal model-observation **120→118**; Calendar ordinary text's observation count stays 34. Post-seal remains 32 and modelled tail 5582 ms in every Calendar case. Those are synthetic timings, not native/provider latency.

All **15 non-regression** and **12 post-seal** cases still pass; **0/13 pre**, **0/15 command**, **0/15 combined** acceptance goals pass. Exactly 15 frozen combined cases remain failed, with no other failing test in the selected matrix. On this concurrent snapshot regular Calendar still needs **18 more pre-dispatch waves** removed to reach <=74, proposal **41** to reach <=133. Read/create complete totals still need **37 / 50** fewer commands to reach integer ceilings 199 / 240. A one-query aggregate shortcut or an unmeasured settlement optimization cannot plausibly close those gaps and lacks a currency proof anyway.

**Stop boundary and next work:** this continuation implements the defensible debit protocol and concretely rejects unsafe aggregate/settlement omission. Remaining tool-event/storage commands require their own revision-scoped effect/authority protocol and fault matrix before reuse, not an arbitrary sweep. I1 owns further shared admission/context/ownership investigation. Final verifier must pin the assembled source, resolve shared type diagnostics and rerun stable integrated gates/build. Native/live owners still require explicit execution authorization and measured causal phases; no database, provider, infrastructure or model conclusion follows from this fake. No overall completion/readiness claim.

### Continuation file inventory and identities

Additional production files: `backend/src/contracts/calendar-accounting.ts`, `backend/src/persistence/calendar-accounting.ts`, `backend/src/chat-runtime/calendar-budget.ts`. New tests: [calendar-debit-receipts.spec.ts](../../backend/test/persistence/calendar-debit-receipts.spec.ts); extended [calendar-critical-path.spec.ts](../../backend/test/performance/calendar-critical-path.spec.ts). Own plan/results updated; first-intervention loop/publication left unchanged. No generic ownership/admission/session/message/manifest/context/model file, frozen performance source, native/live harness or acceptance/state/report edited by I2.

Current SHA-256 identities:

- Contract: `e0a0d43f9c3df18200fc5cb86731d179c882485c63846577b98cb171e96b3742`.
- Repository: `06d1b44f3d5eaf431c363e91a29a0d8ff5f0f08fa8aba46b54693b02183fca08`.
- Ledger: `e250562f132a9aafe7043cd37cec1348e92bda6198e4c324060cf8cea3c2fb34`.
- Receipt tests: `1b9a97c991e4229830115a33a14185b87ff986c0c5a91d121c3235f3d0aedcc7`.
- Runtime tests: `166986b69d79b2774a738e42634c2d5c28560570bd145e17e61f96d1c647cfa9`.

All remain unstaged/uncommitted. The original loop/publication and frozen fixture/spec hashes remain unchanged; first-intervention test hash above is intentionally historical because the focused test file gained the receipt case. Evidence logs are local temporary artifacts, not durable CI or native certification.
