# I1 — shared text critical-path results

2026-10-30. **Scoped fix implemented and verified offline; latency acceptance still FAILED.** Review **skipped**. No child agents, commits, staging, push, worktree, application dotenv/secret access, database/network/provider/Calendar/browser/staging connection, backend restart, model change, deployment or infrastructure work. No saver-facade activation.

## Outcome and proven causes

Two small changes in existing production paths remove **9 commands, 5 pre-dispatch waves and 6 first-answer waves** per normal text/retry turn. Cancellation loses 7 commands. All **15/15 frozen non-regression cases pass**, versus the prior 7/15. All **15 combined acceptance cases still fail**: pre goal **0/13**, command goal **0/15**, post goal **7/12**. Fixed thresholds/baseline and existing instrumented files are untouched.

1. [OpenRouterAttemptAdapter](../../backend/src/model/openrouter-adapter.ts#L100-L132) previously awaited an empty accounting initialization immediately before the mandatory dispatch-bearing accounting save. Both passed through the same [AccountingService](../../backend/src/model/accounting.ts#L63-L75), [runtime owned write](../../backend/src/chat-runtime/durable-chat-runtime.ts#L868-L881), and [repository](../../backend/src/persistence/metadata.ts#L326-L438). The dispatch snapshot includes the initial identity, unknown billing and timing/dispatch count. Keeping only that acknowledged pre-fetch snapshot preserves the no-paid-request-on-save-failure barrier and removes the redundant write/read chain. The newly introduced durable dispatch save, absent in `35eb6e8`, explained the four added pre-dispatch waves; the fix combines it with initialization rather than reverting possible-billing evidence.
2. The runtime already retained `accountingReceipt` for publication but did not pass it to subsequent `putAccountingConfirmed` calls. [The existing receipt-aware method](../../backend/src/persistence/metadata.ts#L381-L437) accepts a store-bound opaque receipt and performs revision CAS; forwarding it inside the unchanged serialized `owner.run` avoids repeated accounting revision reads. The writer guarantees one in-flight save, and the runtime updates its receipt only after acknowledgment. Existing linkage, generation-claim, immutable-evidence, conflict, majority-acknowledgment and ownership checks remain. No repository validation was removed and recovery still uses its strict read path.

End-to-end trace: `executeOwnedTurn` confirms acceptance/context and advances generating → creates per-attempt model services and owned accounting callback → graph generate iterates the adapter → dispatch-bearing save acknowledges before fetch → generation callback durably advances the attempt before `capture` saves accounting and yields identity/text → usage/end writer flushes → graph seal and pinned snapshot → existing publication with latest accounting receipt → terminal receipt and ownership release → ready-after-cleanup. Shared adapter callers are `createModelServices` and direct injected tests; production service creation is in this runtime. Other `AccountingService.save/saveRaw/reconcile` callers retain their behavior. Calendar uses its separate adapter/accounting path and is unchanged. Text/voice response-mode tests also exercise this shared runtime branch.

These are demonstrated redundant dependencies, not a conclusion that every ownership-labelled command is redundant. The prior 58→62 ownership-count lead was not used to remove any fences. Origin attribution is execution-context dependent; current new-text reports 64 such reads despite fewer total reads, so it is not an independent safety or causal-wave metric.

## Evidence and exact commands

Working tree on `main`, HEAD `2a32994bd27b8a98ecce02a12d2a39e45e97e76b`, plus preserved earlier uncommitted acceptance work and these I1 edits. Independent incremental baseline remains `35eb6e85d0b80f3d88abf32218120ce19a7a32d8`, not a new/rebased baseline. The full pre-initiative baseline is still unavailable. **I1 freshly executed the candidate, not the independent baseline or pre-fix full matrix**; pre-fix values below are parsed from the already independently checked Step 4 raw log, identical to Step 1's candidate. Independent-baseline values are from [acceptance-offline.md](acceptance-offline.md). This distinguishes inherited evidence from fresh runs.

All logs/scripts live under `C:/Users/Peter/AppData/Local/Temp/opencode/` (`$T`). The existing Step 4 safe wrapper imports the backend Vitest config and sets `envDir:false`. The selected tests use injected transports/BSON fixtures, not actual services. No dependency installation or package/lockfile/config edits.

```powershell
# backend/; set these without reading existing values for every test invocation
$T = 'C:/Users/Peter/AppData/Local/Temp/opencode'
$env:AURVIN_NATIVE_PERF_ENABLE = 'disabled'
$env:AURVIN_TEST_MONGODB_URI = ''
$env:AURVIN_TEST_DB_PREFIX = ''
# Red (unchanged production), then initial green, same command and selections:
npm test -- test/model/adapter.spec.ts test/performance/text-critical-path.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --reporter=verbose
# Final expanded focused checks:
npm test -- test/model test/runtime/text-config.spec.ts test/runtime/accounting-completion.spec.ts test/runtime/finalization-repair.spec.ts test/runtime/stream-quiescence.spec.ts test/runtime/work.spec.ts test/performance/text-critical-path.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --reporter=verbose
# Complete safe offline matrix, unchanged acceptance assertions:
npm test -- test/performance test/benchmark/runner.spec.ts test/benchmark/latency.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --silent=false --disableConsoleIntercept --reporter=verbose
npm run build
npm run lint
# root/; parses prior/current logs, verifies histograms and prints all tables
$env:PYTHONIOENCODING = 'utf-8'
python "$T/latency-i1-metrics.py"
git diff --check
```

| Check | Actual result / log |
| --- | --- |
| Red before production edits | **41 passed / 2 failed**, exit 1; `latency-i1-red.log`: expected one pre-fetch save, received two; expected previous receipt, received undefined |
| Initial green, same tests | **43 passed**, exit 0; `latency-i1-green.log` |
| Final expanded focused selection | **443 passed / 0 failed / 0 skipped**, 24 files, exit 0; `latency-i1-focused.log` |
| Full offline performance + benchmark matrix | **118 passed / 15 failed / 0 skipped**, 8 files, exit 1; `latency-i1-matrix.log`; performance subtotal **106 passed / 15 failed**, benchmark **12 passed** |
| Backend build | Pass, exit 0; `latency-i1-build.log` |
| Backend lint | Pass, exit 0, **514 warning lines**, not warning-clean; `latency-i1-lint.log` |
| Metric reconciliation | Pass; all 15 matching delayed rows, histogram sums; both matrix profiles have matching command/phase/wave counts |

Final adapter tests cover both supervised and unsupervised operation: one dispatch-bearing snapshot before fetch, failure prevents fetch, and a held save acknowledgment blocks fetch until released. The real-runtime test verifies every subsequent save receives the immediately previous receipt, including finalization, and leaves zero active jobs. Existing focused tests cover generation durability, errors/rejections, unknown billing, retry identity, cancellation, finite deadlines, writer failure/drain, receipt faults, saved-result recovery, retention/publication and cleanup. Counts overlap between commands; do not add them as unique tests. Initial diagnostic assertion inside injected fetch was swallowed by adapter transport handling; it was moved outside fetch before the recorded red rerun so the failure is direct (two versus one), not a setup/transport error.

## Full before/after command and wave matrix

**Pre-fix candidate → I1 candidate**, not independent-baseline denominators. R/W are complete emulated command totals; F=0 throughout. Wave tuple is **pre-dispatch / first-answer / post-seal**, with n/a retaining the original measurement exclusions. Histograms are `find=R`, `findAndModify=4` (recovery=1), `update=W-findAndModify`.

| Scenario | Complete R/W | Commands | Phase waves | Total waves |
| --- | --- | --- | --- | --- |
| new-text | 142/46 → 134/45 | 188 → 179 | 88/98/44 → 83/92/44 | 180 → 171 |
| follow-up-1 | 141/42 → 133/41 | 183 → 174 | 83/93/44 → 78/87/44 | 176 → 167 |
| follow-up-20 | 141/42 → 133/41 | 183 → 174 | 83/93/44 → 78/87/44 | 176 → 167 |
| follow-up-38-at-80-msg-ceiling | 143/42 → 135/41 | 185 → 176 | 85/95/44 → 80/89/44 | 178 → 169 |
| follow-up-39 | 143/42 → 135/41 | 185 → 176 | 85/95/44 → 80/89/44 | 178 → 169 |
| follow-up-50-test-budget | 145/42 → 137/41 | 187 → 178 | 86/96/44 → 81/90/44 | 179 → 170 |
| calendar-text | 141/43 → 141/43 | 184 → 184 | 102/105/42 → 102/105/42 | 177 → 177 |
| calendar-read | 195/60 → 195/60 | 255 → 255 | 102/176/42 → 102/176/42 | 248 → 248 |
| calendar-create | 241/68 → 241/68 | 309 → 309 | 102/230/42 → 102/230/42 | 302 → 302 |
| calendar-conflict | 178/51 → 178/51 | 229 → 229 | 102/222/42 → 102/222/42 | 222 → 222 |
| calendar-proposal-reply | 212/55 → 212/55 | 267 → 267 | 185/188/42 → 185/188/42 | 261 → 261 |
| rejection-retry | 140/41 → 132/40 | 181 → 172 | 83/93/44 → 78/87/44 | 176 → 167 |
| cancel-before-dispatch | 71/21 → 71/21 | 92 → 92 | n/a | 86 → 86 |
| cancel-midstream | 131/36 → 125/35 | 167 → 160 | 88/n/a/n/a → 83/n/a/n/a | 159 → 152 |
| reconnect-finalization-recovery | 67/12 → 67/12 | 79 → 79 | n/a/77/n/a → n/a/77/n/a | 77 → 77 |

Compared with the **frozen incremental baseline**, new-text commands **205→179 (12.7%)**, pre waves **84→83 (1.2%)**, first-answer **95→92**, post **73→44 (39.7%)**. Follow-up-1/20 commands **201→174 (13.4%)**, pre **79→78**, first **90→87**, post **74→44**. Cancellation **164→160**, pre **84→83**. This improves beyond merely undoing the added regression, but is far short of the fixed pre/command goals.

## Complete command-phase attribution

Values are command counts, **not phase waves**. Columns inside each tuple: admission / attachment / context / model-observation / tool-evidence / seal / publication / release / recovery. `other=0` for every row. Summing gives complete commands except cancel-before-dispatch: its existing direct cancellation path leaves 47 commands outside the phase attribution scope (45 attributed versus 92 complete); complete wire totals still include them. No attribution fix or scope change was made.

| Scenario | Before | After |
| --- | --- | --- |
| new-text | 45/8/11/44/0/39/39/2/0 | 45/8/11/35/0/39/39/2/0 |
| follow-up-1 | 39/8/11/44/0/40/39/2/0 | 39/8/11/35/0/40/39/2/0 |
| follow-up-20 | 39/8/11/44/0/40/39/2/0 | 39/8/11/35/0/40/39/2/0 |
| follow-up-38-at-80-msg-ceiling | 40/8/12/44/0/40/39/2/0 | 40/8/12/35/0/40/39/2/0 |
| follow-up-39 | 40/8/12/44/0/40/39/2/0 | 40/8/12/35/0/40/39/2/0 |
| follow-up-50-test-budget | 40/8/14/44/0/40/39/2/0 | 40/8/14/35/0/40/39/2/0 |
| calendar-text | 48/9/10/36/0/43/36/2/0 | unchanged |
| calendar-read | 48/9/10/66/27/57/36/2/0 | unchanged |
| calendar-create | 48/9/10/66/81/57/36/2/0 | unchanged |
| calendar-conflict | 48/9/10/36/38/50/36/2/0 | unchanged |
| calendar-proposal-reply | 46/9/10/120/0/44/36/2/0 | unchanged |
| rejection-retry | 37/8/11/44/0/40/39/2/0 | 37/8/11/35/0/40/39/2/0 |
| cancel-before-dispatch | 45/0/0/0/0/0/0/0/0 | unchanged |
| cancel-midstream | 45/8/11/28/0/21/0/0/54 | 45/8/11/21/0/21/0/0/54 |
| reconnect-finalization-recovery | 0/9/0/0/0/0/0/0/70 | unchanged |

## Modelled timings, not measured service latency

Injected 67/449 ms dependency-wave profile; tuple is dispatch / first emitted text / post-seal tail / total ms. Zero-delay profile is zero by construction; same counts/waves in both profiles. Cancellation's custom sink has no first-answer instrumentation; conflict text may arrive only at completion. Fetch-response mark is not provider stream end.

| Scenario | Before | After |
| --- | --- | --- |
| new-text | 14300/16116/7150/29632 | 13583/15332/7150/28647 |
| follow-up-1 | 12437/14253/7150/27836 | 11720/13469/7150/26851 |
| follow-up-20 | 12437/14253/7150/27836 | 11720/13469/7150/26851 |
| follow-up-38-at-80-msg-ceiling | 12571/14387/7150/27970 | 11854/13603/7150/26985 |
| follow-up-39 | 12571/14387/7150/27970 | 11854/13603/7150/26985 |
| follow-up-50-test-budget | 12638/14454/7150/28037 | 11921/13670/7150/27052 |
| calendar-text | 16002/16585/6252/28285 | unchanged |
| calendar-read | 16002/27836/6252/39536 | unchanged |
| calendar-create | 16002/34510/6252/46210 | unchanged |
| calendar-conflict | 16002/34356/6252/34356 | unchanged |
| calendar-proposal-reply | 26147/26730/6252/38497 | unchanged |
| rejection-retry | 12055/13871/7150/27454 | 11338/13087/7150/26469 |
| cancel-before-dispatch | n/a/n/a/n/a/13784 | unchanged |
| cancel-midstream | 14300/n/a/n/a/24405 | 13583/n/a/n/a/23554 |
| reconnect-finalization-recovery | n/a/9743/n/a/9743 | unchanged |

## Remaining failures, ceiling and I2 handoff

The 15 remaining failed tests are exactly the unchanged combined acceptance case for **each scenario listed in the complete matrix**. All 13 applicable pre goals and all 15 command goals miss; all five Calendar post goals miss. The eight previously failing non-regression cases now pass. No xfail, scope change, assertion weakening, benchmark rebasing or fixture instrumentation change. No new correctness failure in the selected checks. Broad backend typecheck, full backend suite, frontend, native/e2e/live and deployment were not run by I1; prior broad typecheck diagnostics are not claimed resolved.

Safe demonstrated redundancy is now removed, not a proven irreducible floor: text still has 45 admission commands for new text, context/checkpointer work, 35 model-observation commands and 39 publication commands. Even deleting all remaining pre-dispatch model-observation work would not justify discarding acceptance/context/ownership/stock-saver prerequisites. Further reductions need independently traced duplicate dependencies or a larger evidence-carrying design; no proof currently permits dropping fences, generation claims, accounting saves, durability or enabling the facade. Actual native latency/topology remains unmeasured, so do not equate these synthetic gains with service milliseconds or prescribe infrastructure/model changes.

**I2:** proceed with the unchanged Calendar starting points above: pre waves 102 (proposal reply 185), post waves 42; observation command counts 36 for plain/conflict, 66 read/create and 120 proposal reply; tool-evidence 27 read / 81 create / 38 conflict. Trace Calendar adapter → budget observation queue/receipt handling → tool decision/effect persistence → publication; prove redundancy before optimizing. I1 touched no Calendar production files, native harness, acceptance-state/report or baseline fixture/spec. Reuse these changes; do not revert dispatch evidence or assume the text adapter optimization also applies to Calendar's separate loop. Native/live owners still need concrete operator prerequisites and execution authorization.

## I1 file ownership

- Production: [openrouter-adapter.ts](../../backend/src/model/openrouter-adapter.ts), [durable-chat-runtime.ts](../../backend/src/chat-runtime/durable-chat-runtime.ts).
- Tests: [adapter.spec.ts](../../backend/test/model/adapter.spec.ts), [text-critical-path.spec.ts](../../backend/test/performance/text-critical-path.spec.ts).
- Docs: [text-critical-path-plan.md](text-critical-path-plan.md), this results file.

All remain uncommitted and unstaged; earlier intentional files preserved. Final `latency-i1-check.py` passed **6 I1 files / 11 local links and source ranges**, unchanged frozen fixture/spec SHA-256 hashes, and equality of commands/phases/waves across all **30 profile rows**. `git diff --check` passed (LF→CRLF advisories only); staged diff remains empty. The orchestrator owns status transitions.

## 2026-10-30 continuation — shared admission and context

**Further offline savings implemented; acceptance still FAILED.** This continuation preserves all preceding evidence as historical I1 results. I2 concurrently owns disjoint Calendar accounting/ledger/debit work. No Calendar implementation, native/live harness, frozen performance source or acceptance-state/report was edited here. No package build was run in this continuation, per coordination instruction. All prior external-execution prohibitions still apply; review remains **skipped**.

### Three demonstrated shared-path redundancies

1. **Repeated fences during storage-only admission.** [Submit/retry admission](../../backend/src/chat-runtime/durable-chat-runtime.ts) reserved an active attempt and allocated sequences in two separately fenced calls before entering the existing bounded acceptance-stage phase for archive writes. These operations have no intervening provider, tool, Calendar, callback or externally visible output. The same stage now contains reserve → allocate → acknowledged input/attempt writes. It uses the existing `runPhase`/`owner.run` semantics, **4 operations for submit, 3 for retry**, deadline capped at persistence timeout and lease expiry minus one second. This removes **four guard reads**, not writes or mutation prechecks. Calendar budget/proposal work, acceptance-marker publication, detach/attach, graph and inference remain outside. Missing optional phase/confirmed-write support preserves the old path.
2. **Discarded acquisition result.** [MongoOwnership.acquire](../../backend/src/persistence/ownership.ts) already obtains the actual post-CAS session from `findOneAndUpdate` or the existing generation/owner/expiry-scoped ambiguous-write readback. The successful [acquisition result](../../backend/src/contracts/repositories.ts) now optionally carries that decoded `session`. Admission uses it for the immediate latest-turn validation instead of rereading the same session. This removes **one read** for ordinary submit; retry does not have that redundant read. No pre-acquisition/cached session authorizes anything; generation CAS, lifecycle/active-slot constraints, claim serialization and uncertain-result recovery are unchanged. Legacy/custom owners without the optional result still trigger the prior read.
3. **Unnecessary read dependency.** [checkBoundary](../../backend/src/chat-runtime/durable-chat-runtime.ts) launched history and manifest reads in parallel but waited for all archive pages and acceptance markers before starting `graph.getState`. The stock-saver boundary read is independent and now starts alongside history/manifest selection. **Every stock read, budget check, context comparison, pending-state check and graph write remains**. No graph mutation or assembly begins until all prerequisite results resolve. This saves waves, not commands, and is not facade activation or receipt-based caching.

All callers traced: `checkBoundary` serves new admission, retry and both attachment paths; all now overlap the same independent reads. `owner.acquire` serves new/retry admission and instruction rebase; only new admission consumes the optional session, and other callers still consume the lease. Text and live response modes share new admission. Calendar uses the same admission before its separate loop; no phase spans its budget/proposal/model/tool operations. Existing source and focused tests retain durable acceptance, sequence/input linkage, conflict handling, identity-before-output, accounting, retention/redaction, cancellation, restart recovery and cleanup-before-ready.

### Fresh verification and concurrent source identity

All logs named below are in the approved temporary directory. Existing safe wrapper, disabled native flag and empty test URI/prefix were used again, without reading application environment files/values. Red assertions failed directly on missing phase/session evidence or missing overlap; none were marked expected-failure.

| Check | Fresh outcome | Log |
| --- | --- | --- |
| Reservation + acquisition red before production changes | **4 failed**, exit 1: unphased reservation/allocation; missing acknowledged session including both uncertainty cases | `latency-i1-shared-red.log` |
| Same-selection initial green | **4 passed**, exit 0 | `latency-i1-shared-green.log` |
| Independent-read overlap red before overlap edit | **4 passed / 1 failed**, exit 1: held archive read prevents saver read | `latency-i1-overlap-red.log` |
| Expanded initial selection | **754 passed**, 65 files | `latency-i1-shared-focused.log` |
| Final model/runtime/context/ownership/receipt/stock-saver selection | **764 passed / 0 failed / 0 skipped**, 66 files, exit 0 | `latency-i1-shared-focused-final.log` |
| Full safe offline matrix, first capture | **132 passed / 15 failed**, 11 files, exit 1 | `latency-i1-shared-matrix.log` |
| Full safe offline matrix, final capture | **135 passed / 15 failed / 0 skipped**, 11 files, exit 1 | `latency-i1-shared-matrix-final.log` |
| Targeted type-aware lint, final owned production/test files | Pass, exit 0, **5 existing warning lines**, not warning-clean | `latency-i1-shared-lint-final.log` |
| Package build | **Not run**, coordinated with active I2; earlier I1/I2 build results are not fresh certification of this continuation | — |

The final selection adds input-write uncertainty tests and stock-saver offline bounds/conformance checks. Both actual input-write uncertainty cases are exercised: no committed input means no acceptance/no fetch; a committed write with missing acknowledgment is read back, yields exactly one input on duplicate submission and runs inference once. Acquisition tests cover stale generation and competing claims, pre-write uncertainty rejection/retry and post-write exact readback. Existing selected tests cover forged/wrong-scope/stale receipts, held writes/control serialization, phase ceiling/deadline/lease enforcement, all-settled failure drain, restart/publication recovery and strict context linkage. No native saver conformance is implied by injected tests.

**Concurrent-state limitation:** final source manifests bracket the matrix and match for **244 backend TypeScript source files**; the first matrix also had stable source. **Between captures I2 changed `calendar-budget.ts` and `contracts/calendar-accounting.ts`.** Text, cancellation/recovery and Calendar admission metrics reproduce, but four Calendar scenarios gain another 1–2 commands/waves in the final capture; these are not I1 savings. The pass-count increase includes the two added I1 safety cases and a concurrent test. No native execution occurred. Each capture is a dirty-source snapshot, not an attestation that I2 cannot change its files afterward. Before values below come from I2's `latency-i2-matrix-verified.log`, not a fresh pre-edit rerun. Frozen incremental-baseline values remain independently captured Step 1 evidence, not recomputed denominators. Source manifests are `latency-i1-shared-final-source-before.json` / `...-after.json`; metrics reconciliation script is `latency-i1-shared-metrics.py`.

Exact continuation commands, from `backend/` (`$T` as previously defined); all output captured in named UTF-16LE logs:

```powershell
$env:AURVIN_NATIVE_PERF_ENABLE='disabled'
$env:AURVIN_TEST_MONGODB_URI=''
$env:AURVIN_TEST_DB_PREFIX=''
# Initial red/green and overlap-red selection:
npm test -- test/performance/shared-admission-critical-path.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --reporter=verbose
# Final focused selection:
npm test -- test/model test/runtime test/context test/persistence/owned-phases.spec.ts test/persistence/claim-executor.spec.ts test/persistence/local-owner.spec.ts test/persistence/accounting-evidence.spec.ts test/persistence/checkpoints-bounded.spec.ts test/performance/shared-admission-critical-path.spec.ts test/performance/text-critical-path.spec.ts test/performance/latency-storage.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --reporter=verbose
npm test -- test/performance test/benchmark/runner.spec.ts test/benchmark/latency.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --silent=false --disableConsoleIntercept --reporter=verbose
./node_modules/.bin/oxlint --type-aware src/contracts/repositories.ts src/persistence/ownership.ts src/chat-runtime/durable-chat-runtime.ts test/performance/shared-admission-critical-path.spec.ts
Get-ChildItem src -Recurse -Filter *.ts | Get-FileHash | Select-Object Path,Hash | ConvertTo-Json
# root/:
python "$T/latency-i1-shared-metrics.py"
git diff --check
```

### Complete continuation command/wave matrix

**I2 first-intervention candidate → initial I1 continuation capture**, isolating the I1 contribution before I2's next disjoint changes. R/W includes complete emulated commands; failures=0. Wave tuple is pre / first-answer / post. Histograms remain `find=R`, `findAndModify=4` (recovery=1), `update=W-findAndModify`. Both profiles match in counts/waves within each capture; zero-delay times are zero by construction.

| Scenario | R/W before → after | Commands | Phase waves before → after | Total waves |
| --- | --- | --- | --- | --- |
| new-text | 134/45 → 129/45 | 179 → 174 | 83/92/44 → 75/84/44 | 171 → 163 |
| follow-up-1 | 133/41 → 128/41 | 174 → 169 | 78/87/44 → 69/78/44 | 167 → 158 |
| follow-up-20 | 133/41 → 128/41 | 174 → 169 | 78/87/44 → 69/78/44 | 167 → 158 |
| follow-up-38-at-80-msg-ceiling | 135/41 → 130/41 | 176 → 171 | 80/89/44 → 69/78/44 | 169 → 158 |
| follow-up-39 | 135/41 → 130/41 | 176 → 171 | 80/89/44 → 69/78/44 | 169 → 158 |
| follow-up-50-test-budget | 137/41 → 132/41 | 178 → 173 | 81/90/44 → 69/78/44 | 170 → 158 |
| calendar-text | 129/43 → 124/43 | 172 → 167 | 100/103/32 → 92/95/32 | 165 → 157 |
| calendar-read | 183/60 → 178/60 | 243 → 238 | 100/174/32 → 92/166/32 | 236 → 228 |
| calendar-create | 229/68 → 224/68 | 297 → 292 | 100/228/32 → 92/220/32 | 290 → 282 |
| calendar-conflict | 166/51 → 161/51 | 217 → 212 | 100/210/32 → 92/202/32 | 210 → 202 |
| calendar-proposal-reply | 202/55 → 197/55 | 257 → 252 | 185/188/32 → 176/179/32 | 251 → 242 |
| rejection-retry | 132/40 → 128/40 | 172 → 168 | 78/87/44 → 70/79/44 | 167 → 159 |
| cancel-before-dispatch | 71/21 → 66/21 | 92 → 87 | n/a | 86 → 80 |
| cancel-midstream | 125/35 → 120/35 | 160 → 155 | 83/n/a/n/a → 75/n/a/n/a | 152 → 144 |
| reconnect-finalization-recovery | 67/12 → unchanged | 79 → 79 | n/a/77/n/a unchanged | 77 → 77 |

**Full isolated I1 command-phase attribution:** only admission changes. New-text/cancel-before/midstream **45→40**, follow-up-1/20 **39→34**, follow-up-38/39/50 **40→35**, Calendar regular **48→43**, proposal **46→41**, retry **37→33**, recovery **0 unchanged**. Every attachment/context/model-observation/tool-evidence/seal/publication/release/recovery command count stays exactly as in I2's pre-continuation matrix in the initial capture. In particular, all writes and saver reads/writes are unchanged. The independent read overlap reduces dependency waves but does not relabel command counts. The pre-existing 47 unattributed direct-cancellation commands remain included in complete totals.

Injected 67/449 ms timings (dispatch / first text / post-seal tail / total **modelled ms**, not native/provider measurements):

| Scenario | Before | After |
| --- | --- | --- |
| new-text | 13583/15332/7150/28647 | 13047/14796/7150/28111 |
| follow-up-1/20 | 11720/13469/7150/26851 | 11117/12866/7150/26248 |
| follow-up-38/39 | 11854/13603/7150/26985 | 11117/12866/7150/26248 |
| follow-up-50-test-budget | 11921/13670/7150/27052 | 11117/12866/7150/26248 |
| calendar-text | 15868/16451/5582/27481 | 15332/15915/5582/26945 |
| calendar-read | 15868/27702/5582/38732 | 15332/27166/5582/38196 |
| calendar-create | 15868/34376/5582/45406 | 15332/33840/5582/44870 |
| calendar-conflict | 15868/33552/5582/33552 | 15332/33016/5582/33016 |
| calendar-proposal-reply | 26147/26730/5582/37827 | 25544/26127/5582/37224 |
| rejection-retry | 11338/13087/7150/26469 | 10802/12551/7150/25933 |
| cancel-before-dispatch | n/a/n/a/n/a/13784 | n/a/n/a/n/a/13382 |
| cancel-midstream | 13583/n/a/n/a/23554 | 13047/n/a/n/a/23018 |
| reconnect-finalization-recovery | n/a/9743/n/a/9743 | unchanged |

**Final combined dirty-source capture:** all unlisted rows/metrics above are unchanged. Additional differences belong to I2's concurrent continuation and are not counted as I1 improvement:

| Scenario | Final R/W; commands | Final pre/first/post; total waves | Additional phase change since initial I1 capture | Final dispatch/first text/tail/total modelled ms |
| --- | --- | --- | --- | --- |
| calendar-read | 176/60; **236** | 92/164/32; 226 | tool-evidence 27→25 | 15332/27032/5582/38062 |
| calendar-create | 222/68; **290** | 92/218/32; 280 | tool-evidence 81→79 | 15332/33706/5582/44736 |
| calendar-conflict | 160/51; **211** | 92/201/32; 201 | tool-evidence 38→37 | 15332/32949/5582/32949 |
| calendar-proposal-reply | 195/55; **250** | 174/177/32; 240 | model-observation 120→118 | 25410/25993/5582/37090 |

### Remaining goals and concrete feasibility evidence

Against frozen `35eb6e8`, new text is now **205→174 commands (15.1%)**, pre **84→75 waves (10.7%)**, first-answer **95→84**, post **73→44**. Follow-up-1/20 is **201→169 commands (15.9%)**, pre **79→69 (12.7%)**, first-answer **90→78**, post **74→44**. This is a further critical-path reduction, not post-seal-only improvement.

Still **0/13 pre goals, 0/15 command goals, 12/12 post goals**, all **15/15 non-regression cases pass**, all **15 combined acceptance cases fail**. The 15 failures are exactly each frozen scenario's combined acceptance assertion; no correctness failure, xfail, changed denominator, changed measurement scope or relaxed threshold. For integer counts, new text still needs **17 additional pre waves and 21 commands** removed to reach <=58 / <=153; follow-up-1 needs **14 waves and 19 commands** to reach <=55 / <=150. Calendar regular needs **18 pre waves**, proposal **41** in the final combined capture (**43** in the isolated I1 capture). I2 may subsequently improve its disjoint path; these are snapshot gaps, not a claim about its eventual result.

| Remaining work traced | Evidence and why it was retained |
| --- | --- |
| Default saver `getTuple` | [checkpoints.ts](../../backend/src/persistence/checkpoints.ts) first reads bounded latest checkpoint and bounded pending writes, then delegates non-empty reads to installed stock saver: two repeated reads are real source-level redundancy per non-empty invocation. The existing facade addresses exactly this, but remains gated on native conformance. Deleting prechecks or reconstructing tuples would bypass that gate; neither was done. No claimed exact whole-turn saving or irreducible floor follows from this observation. |
| Acquisition initial session read | Establishes current generation, owner/lifecycle and active slot, and pins the exact owner/generation/expiry readback identity for uncertain CAS. Removing it without another durable mutation identity would make ambiguity unsafe. Only its already-acknowledged result is reused now. |
| Sequence reservation/counter reads and writes | Recover idempotent reservation counts, reject missing ordering state with existing records, atomically allocate bounded sequence ranges and persist the reservation. They are not just redundant confirmation reads. No transactions or new reservation protocol were assumed. |
| Input/attempt and acceptance-marker writes | Acknowledged receipts establish exact immutable content before the acceptance marker/latest-turn publication. Existing ambiguous-write readbacks and duplicate-content checks stay; deleting them would lose durable acceptance/idempotency evidence. |
| Attachment and `checkBoundary` | Session generation CAS alone cannot attest archive, manifest or retention state. The existing disposable receipt has a synthetic checkpoint ID and no durable manifest/message revision attestation, so it cannot safely authorize skipping strict history/manifest/saver validation. These reads are overlapped, not cached away. |
| Text prepare manifest read and pre-inference fence | They revalidate across emitted acceptance/generating callbacks and checkpoint work before inference. No evidence proves current manifest/retention state stayed unchanged across those boundaries; the reads remain. |
| Other admission/session/publication reads | Some may still be reducible, but there is no independently validated receipt/linkage protocol for their removal in this continuation. The measured admission total (new text 40 commands, Calendar 43) is not a proof that every command is necessary. Source presence, labels and count ceilings do not establish a physical/network floor. |

The demonstrated small redundancies are fixed. Meeting all original targets would require further validated evidence reuse or broader design work, and the gated native saver comparison, not speculative caching, dropped guards, stretched phases, provider/model changes or assertions that infrastructure is the only answer. Actual native/live measurements remain separately blocked. This continuation does not resolve prior broad typecheck diagnostics or certify a runnable deployment; no build/full-backend/frontend/native/live run was performed here.

**Continuation-owned files:** `backend/src/chat-runtime/durable-chat-runtime.ts`, `backend/src/persistence/ownership.ts`, `backend/src/contracts/repositories.ts`, new [shared-admission-critical-path.spec.ts](../../backend/test/performance/shared-admission-critical-path.spec.ts), and these existing I1 plan/results documents. Original I1 adapter/accounting edits remain intact. No file overlap with I2 was needed. No commits/staging; orchestrator owns status and integration transitions.

Closeout checks: `latency-i1-shared-check.py` passed **9 total I1 files / 17 local links and source ranges**, both frozen-source SHA-256 identities, **60 histogram/profile rows** across the two captures and the final **244-file** source stability comparison. `git diff --check` passed (line-ending advisories only); staged diff remains empty. I2 was still adding disjoint persistence/debit changes at closeout, so these captures are **not a final integrated verification of the subsequently changing checkout**. The orchestrator should use I2's final stable evidence or rerun integrated checks after it finishes; no additional build was launched here.

## 2026-10-30 verification defect correction — shared runtime diagnostics

Same I1 implementation owner, correcting verification defects—not conducting review or acting as a review-triggered fixer. Review **skipped**. No child agents, commits, staging, worktree, application dotenv/secret access, database/network/provider/Calendar/browser/staging connection, backend restart, deployment, infrastructure, or model changes.

### Diagnostics root cause and exact fix

I2's scoped TypeScript run reported 44 diagnostics, including 7 in the I1 continuation in [durable-chat-runtime.ts](../../backend/src/chat-runtime/durable-chat-runtime.ts):
- Line 382:13, line 405:9, line 405:29, line 405:59: `error TS2774: This condition will always return true since this function is always defined. Did you mean to call it instead?` on `p.owner.runPhase`, `p.messages.appendConfirmed`, `p.metadata.putAttemptConfirmed`.
- Line 540:13, line 549:9, line 549:29: `error TS2774` on `p.owner.runPhase` and `p.metadata.putAttemptConfirmed`.

**Root cause:** `p` in `DurableChatRuntime` is typed as `PersistenceBundle`, where `owner: MongoOwnership`, `messages: MongoMessages`, `metadata: MongoMetadata`. On those concrete classes, methods `runPhase`, `appendConfirmed`, and `putAttemptConfirmed` are defined class methods. While the repository interfaces (`ExecutionOwnership`, `MessageRepository`, `MetadataRepository`) define them as optional (`?`), the static class types define them as non-optional functions. In `submitTurn` and `retryTurn`, checking truthiness directly (`p.owner.runPhase && ...`) triggered TS2774 because TypeScript expects function truthiness checks to be immediate function calls or suspects missing `()`. Furthermore, inside `stage()`, `p.owner.runPhase` was checked despite never being called inside `stage()` (`runPhase` wraps `stage()` from the outside), and inner arrow functions carried unnecessary non-null assertion casts (`!`).

**Resolution:**
1. In `submitTurn`, defined capability guard `const canStage = typeof p.owner.runPhase === 'function' && typeof p.messages.appendConfirmed === 'function' && typeof p.metadata.putAttemptConfirmed === 'function';`. Inside `stage()`, branched on `canStage` directly, calling `p.messages.appendConfirmed(input)` and `p.metadata.putAttemptConfirmed(attempt)` cleanly without casts. When invoking `stage()`, used `canStage ? p.owner.runPhase(...) : stage()`.
2. In `retryTurn`, defined capability guard `const canStage = typeof p.owner.runPhase === 'function' && typeof p.metadata.putAttemptConfirmed === 'function';`. Inside `stage()`, branched on `canStage` directly, calling `p.metadata.putAttemptConfirmed(a)` without casts. When invoking `stage()`, used `canStage ? p.owner.runPhase(...) : stage()`.
3. No narrowing or invariant was silenced with a type cast. Zero casts added; two existing non-null assertion casts (`!`) removed. Behavior, acceptance gates, frozen instrumentation, and safety semantics are completely unchanged.

### Exact checks and verification evidence

All tests executed with safe environment overwrites (`AURVIN_NATIVE_PERF_ENABLE='disabled'`, `AURVIN_TEST_MONGODB_URI=''`, `AURVIN_TEST_DB_PREFIX=''`) and the `$T/latency-step4-backend-offline.config.mjs` wrapper (`envDir:false`).

| Check | Result | Scope / Notes |
| --- | --- | --- |
| Backend package build (`npm run build`) | **Pass**, exit 0 | `nest build` completed with **0 errors**; all 7 TS2774 compiler errors resolved. |
| Scoped TypeScript check (`tsc --project latency-i2-calendar-types.json`) | **Pass for owned code** (37 foreign remain) | **0 errors in I1-owned source/contracts/ownership/tests**. All 7 `durable-chat-runtime.ts` errors resolved. |
| Targeted type-aware lint (`oxlint --type-aware`) | **Pass**, exit 0 | 0 errors, 8 existing baseline warnings on 6 owned files. |
| Backend package lint (`npm run lint`) | **Pass**, exit 0 | 0 errors, 514 baseline warning lines (unchanged). |
| Focused I1 regression suite | **53 passed / 0 failed**, 3 files, exit 0 | `shared-admission-critical-path.spec.ts`, `adapter.spec.ts`, `text-critical-path.spec.ts`. |
| Expanded focused selection | **764 passed / 0 failed / 0 skipped**, 66 files, exit 0 | Full model, runtime, context, bounded checkpoints, and ownership suite. |
| Full safe performance + benchmark matrix | **135 passed / 15 failed / 0 skipped**, 11 files, exit 1 | Exactly the 15 frozen acceptance targets fail; all 135 non-regression/correctness tests pass. |
| Git whitespace check (`git diff --check`) | **Pass**, exit 0 | Zero whitespace errors or conflict markers (line-ending advisories only). |

### Remaining non-self-derived diagnostics

Exactly **37 diagnostics** remain in the scoped TypeScript run across two files:
1. `test/performance/latency-runtime-fixture.ts` (1 diagnostic): line 246:5, `error TS2353: Object literal may only specify known properties, and 'persistence' does not exist in type 'OperationsOptions'`.
2. `test/runtime/calendar-runtime.fixture.ts` (36 diagnostics): lines 38, 325, 341, 358–433, 603–899: missing `CalendarAccessRole` export, schemaVersion 1 vs 2 connection record mismatches (`defaultSetting`, `discovery`), property accessor syntax conflicts, and implicit any parameters in Calendar test mock fixtures.

All 37 diagnostics originate in I2/native/live test doubles and fixtures, not in I1 shared runtime, contracts, or ownership files. Per instructions, they are preserved untouched and reported to the orchestrator. I1-owned code is clean, stable, and ready for the final verifier.
