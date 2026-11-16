# Offline latency acceptance — Step 1

2026-10-29. **Acceptance not met.** Fresh offline runs, not inherited verification claims. Review **skipped**. No production changes, database connections, `.env` access, paid/provider/Calendar/browser/staging calls, backend restarts, or Git staging/commits/worktrees.

## Provenance and scope

- Candidate production source: `2a32994bd27b8a98ecce02a12d2a39e45e97e76b` on `main` (last implementation `5ec145e`). Only the two test files listed below changed for this step.
- Independently executed baseline: `35eb6e85d0b80f3d88abf32218120ce19a7a32d8`, extracted with `git archive` into approved temporary storage; **already includes phases 0–6**. Identical instrumented fixture/spec on both snapshots. Production source in the snapshot was not changed. Baseline fixed regression caps also pass against that snapshot.
- Dependencies shared through a temporary `node_modules` junction, no installation. Baseline/candidate lockfiles have no Git diff; package dependencies also unchanged (only benchmark scripts added). Actual installed versions: Node `v24.18.0`, Vitest `4.1.11`, MongoDB driver `6.21.0`, LangGraph `1.4.19`, MongoDB saver `1.4.1`.
- `verification.md` calls its larger baseline “Pre-Reduction”: Calendar read `228R/61W`, create `275R/69W`, new text `170R/46W`. Those counts were **not reproduced** by the committed `35eb6e8` runtime/harness, which instead gives `205R/61W`, `251R/69W`, `159R/46W`, matching the old investigation's reported counts. Its larger baseline has no independently identified runnable source/instrumentation snapshot here. Do not combine those denominators with this run's phase boundaries. Even its reported read/create totals imply only 11.8%/10.2% command reductions, not 25%.
- The initiative-start SHA recorded there, `654935d`, predates this harness (`git cat-file -e 654935d:backend/test/performance/latency-runtime-fixture.ts` fails: path absent). A complete pre-initiative whole-runtime comparison is **unavailable**, not certified by this incremental baseline. Reconstructing/backporting an equivalent harness would need separate work. The unbatched prototype's reported 227 waves is not a fresh baseline either.

## What was counted

Real repositories, ownership, stock saver, observer and runtime run over the existing BSON fake driver. Provider/Google transports are scripted; Calendar capability/credential services are simplified. All turns retain existing correctness assertions (context/identity/linkage, tool effects, failure/cancellation/recovery and cleanup). Saver facade remains at its existing default, not enabled.

**These are complete emulated native-command totals within the measured offline turn, not commands measured on a native database.** Counts use the entire `memory.wireCalls` array, including ownership and saver work, and match observer read/write/failure counters; no bounded detail-sample extrapolation. Each run has zero failed wire commands in its measured scenarios. All reads are `find`; writes are `update` plus four `findAndModify` per scenario (one for recovery). Thus every row below specifies the full command-name breakdown: `find=R`, `findAndModify=4` (recovery=1), `update=W-findAndModify`. Summary logs additionally emit the exact histogram. Ordered update bulk is one synthetic `update`; the fake does not establish real batching, `getMore`, retries, heartbeat/topology traffic or majority-write performance.

Measurement excludes bootstrap/index setup, connection seed, prior-turn seeding, later status/history assertions and fixture shutdown. It starts before submit/retry and ends when execution/cancellation/reconciliation settles, including release/terminal callbacks; no HTTP/browser/post-completion status request. Recovery measures reconcile/reconnect only, not its deliberately failed original turn.

- **Pre-dispatch waves:** scheduler advances completed before the first model fetch (proposal reply includes authorized tool work before narration). No dispatch means n/a, not zero.
- **First answer:** first emitted text `delta`; conflict clarification may provide a card earlier. Custom midstream-cancellation sink does not use the fixture delta capture: its first-answer result is unavailable, not evidence that no delta occurred.
- **Post-seal waves/tail:** from return of the existing saver `put` acknowledging `channel_values.sealed=true` for the executing attempt, through operation settlement. Includes sealed-state confirmation reads and finalizing transition. Instrumentation wraps the saver call but adds no reads/writes. Recovery does not create a new sealed checkpoint; post-seal is n/a there.
- Legacy `milestones.sealMs` is **finalization-start**, later than seal acknowledgment; it is not used for this goal. Legacy `modelEndMs` is fetch-response return, not streamed model end; no provider-duration claim uses it.
- Both 0/0 and 67/449 ms profiles use **dependency-wave** scheduling, rounding mixed independent durations to their maximum. Times below are injected/modelled milliseconds, not measured latency, provider TTFT, CPU cost or native percentiles. Zero-duration results are zero by construction. The separate timer-overlap scheduler unit check passes; the whole-runtime comparison is not timer mode or real event-loop calibration.

## Fresh comparison

Baseline → candidate; positive percentages mean fewer. Phase goals are **30% pre-dispatch / 25% complete commands / 30% post-seal**, never total-wave substitutions.

| Scenario | Complete R/W | Commands | Reduction | Pre waves | Reduction | Post waves | Reduction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| new-text | 159/46 → 142/46 | 205 → 188 | 8.3% | 84 → 88 | -4.8% | 73 → 44 | **39.7%** |
| follow-up-1 | 159/42 → 141/42 | 201 → 183 | 9.0% | 79 → 83 | -5.1% | 74 → 44 | **40.5%** |
| follow-up-20 | 159/42 → 141/42 | 201 → 183 | 9.0% | 79 → 83 | -5.1% | 74 → 44 | **40.5%** |
| follow-up-38-at-80-msg-ceiling | 161/42 → 143/42 | 203 → 185 | 8.9% | 81 → 85 | -4.9% | 74 → 44 | **40.5%** |
| follow-up-39 | 161/42 → 143/42 | 203 → 185 | 8.9% | 81 → 85 | -4.9% | 74 → 44 | **40.5%** |
| follow-up-50-test-budget | 163/42 → 145/42 | 205 → 187 | 8.8% | 82 → 86 | -4.9% | 74 → 44 | **40.5%** |
| calendar-text | 151/44 → 141/43 | 195 → 184 | 5.6% | 107 → 102 | 4.7% | 48 → 42 | 12.5% |
| calendar-read | 205/61 → 195/60 | 266 → 255 | 4.1% | 107 → 102 | 4.7% | 48 → 42 | 12.5% |
| calendar-create | 251/69 → 241/68 | 320 → 309 | 3.4% | 107 → 102 | 4.7% | 48 → 42 | 12.5% |
| calendar-conflict | 188/52 → 178/51 | 240 → 229 | 4.6% | 107 → 102 | 4.7% | 48 → 42 | 12.5% |
| calendar-proposal-reply | 222/56 → 212/55 | 278 → 267 | 4.0% | 190 → 185 | 2.6% | 48 → 42 | 12.5% |
| rejection-retry | 158/41 → 140/41 | 199 → 181 | 9.0% | 79 → 83 | -5.1% | 74 → 44 | **40.5%** |
| cancel-before-dispatch | 71/21 → 71/21 | 92 → 92 | 0.0% | n/a | n/a | n/a | n/a |
| cancel-midstream | 129/35 → 131/36 | 164 → 167 | -1.8% | 84 → 88 | -4.8% | n/a | n/a |
| reconnect-finalization-recovery | 75/14 → 67/12 | 89 → 79 | 11.2% | n/a | n/a | n/a | n/a |

**Verdicts:** pre-dispatch goal **0/13 pass** (8 regress); commands goal **0/15 pass** (midstream cancellation regresses by 3 commands); post-seal goal **7/12 pass**, all five Calendar scenarios miss. Whole initiative acceptance remains unproven because the full pre-initiative baseline is unavailable; incremental misses must not be represented as success.

| Scenario | First-answer waves | Total waves | First dispatch ms | First text ms | Post-seal tail ms | Total modelled ms |
| --- | --- | --- | --- | --- | --- | --- |
| new-text | 95 → 98 | 198 → 180 | 13650 → 14300 | 15533 → 16116 | 10239 → 7150 | 30838 → 29632 |
| follow-up-1 / follow-up-20 | 90 → 93 | 195 → 176 | 11787 → 12437 | 13670 → 14253 | 10306 → 7150 | 29109 → 27836 |
| follow-up-38 / follow-up-39 | 92 → 95 | 197 → 178 | 11921 → 12571 | 13804 → 14387 | 10306 → 7150 | 29243 → 27970 |
| follow-up-50-test-budget | 93 → 96 | 198 → 179 | 11988 → 12638 | 13871 → 14454 | 10306 → 7150 | 29310 → 28037 |
| calendar-text | 110 → 105 | 188 → 177 | 16337 → 16002 | 16920 → 16585 | 7036 → 6252 | 29404 → 28285 |
| calendar-read | 181 → 176 | 259 → 248 | 16337 → 16002 | 28171 → 27836 | 7036 → 6252 | 40655 → 39536 |
| calendar-create | 235 → 230 | 313 → 302 | 16337 → 16002 | 34845 → 34510 | 7036 → 6252 | 47329 → 46210 |
| calendar-conflict | 233 → 222 | 233 → 222 | 16337 → 16002 | 35475 → 34356 | 7036 → 6252 | 35475 → 34356 |
| calendar-proposal-reply | 193 → 188 | 272 → 261 | 26482 → 26147 | 27065 → 26730 | 7036 → 6252 | 39616 → 38497 |
| rejection-retry | 90 → 93 | 195 → 176 | 11405 → 12055 | 13288 → 13871 | 10306 → 7150 | 28727 → 27454 |
| cancel-before-dispatch | n/a | 86 → 86 | n/a | n/a | n/a | 13784 → 13784 |
| cancel-midstream | unavailable | 156 → 159 | 13650 → 14300 | unavailable | n/a | 23822 → 24405 |
| reconnect-finalization-recovery | 89 → 77 | 89 → 77 | n/a | 11311 → 9743 | n/a | 11311 → 9743 |

## Runnable checks and exact commands

From repository root (PowerShell); extraction is a snapshot, not a checkout/worktree. `Copy-Item` here supplies only this step's instrumented offline fixture/spec to the old source:

```powershell
git archive --format=zip --output=C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-35eb6e8.zip 35eb6e8 backend/src backend/test backend/package.json backend/tsconfig.json backend/tsconfig.build.json backend/vitest.config.ts backend/nest-cli.json product_knowledge.md
Expand-Archive -Path C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-35eb6e8.zip -DestinationPath C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-35eb6e8
New-Item -ItemType Junction -Path C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-35eb6e8/backend/node_modules -Target 'D:/Peter/Aurvin Agent/Aurvin/backend/node_modules'
Copy-Item 'D:/Peter/Aurvin Agent/Aurvin/backend/test/performance/latency-runtime-fixture.ts' C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-35eb6e8/backend/test/performance/latency-runtime-fixture.ts
Copy-Item 'D:/Peter/Aurvin Agent/Aurvin/backend/test/performance/durable-latency.spec.ts' C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-35eb6e8/backend/test/performance/durable-latency.spec.ts
```

From snapshot `.../latency-baseline-35eb6e8/backend/`:

```powershell
npm test -- test/performance/durable-latency.spec.ts --maxWorkers=1 --silent=false --reporter=verbose --disableConsoleIntercept -t '^(?!.*acceptance targets)' > C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-step1.log 2>&1
```

From candidate `backend/`:

```powershell
npm test -- test/performance --maxWorkers=1 --silent=false --reporter=verbose --disableConsoleIntercept > C:/Users/Peter/AppData/Local/Temp/opencode/latency-current-step1.log 2>&1
npm test -- test/performance --maxWorkers=1 -t '^(?!.*(?:fixed baseline regression caps|acceptance targets))' > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step1-correctness.log 2>&1
npm run build > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step1-build.log 2>&1
npm run lint > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step1-lint.log 2>&1
```

From repository root: `git diff --check`.

| Check | Fresh outcome |
| --- | --- |
| Baseline fixture/spec + fixed baseline caps | **46 passed**, 15 candidate acceptance-target cases explicitly filtered/skipped; exit 0 |
| Candidate complete offline performance directory | **55 passed / 23 failed / 0 skipped**, 3 files; exit **1** |
| Candidate correctness-only diagnostic | **48 passed**, 30 gate cases explicitly filtered/skipped; exit 0; **not** acceptance success |
| Fixed non-regression cases within full candidate run | **7 pass / 8 fail**: six text scenarios + retry regress in pre/first-answer waves; midstream cancellation regresses pre waves and command total |
| Acceptance cases within full candidate run | **0 pass / 15 fail**; soft assertions show each missed goal separately |
| Backend build | Pass, exit 0 |
| Backend type-aware lint | Pass, exit 0, warnings remain (not a warning-clean result) |
| Diff whitespace check | Pass; Git warns of future LF→CRLF conversion |
| Native DB, provider, browser and staging | **Not executed / unauthorized**, not passing checks |

Raw logs are the absolute paths above (PowerShell writes UTF-16LE). Successful console summaries required `--disableConsoleIntercept`; earlier successful runs without it produced no summary output and are not the recorded evidence. Parsed 67/449 ms summaries: `C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-step1.json` and `latency-current-step1.json`. Initial/repeated correctness captures agree on counts/boundaries. Baseline constants in the spec are frozen from its independent run, never recomputed from candidate values. Gates intentionally remain **red**; no expected-failure marker, rebasing, tolerance allowance or semantic weakening hides the misses.

## Changed files and Step 2 prerequisites

- [durable-latency.spec.ts](../../backend/test/performance/durable-latency.spec.ts): full command histograms, new boundary summaries, fixed independent-baseline regression caps and explicit acceptance assertions.
- [latency-runtime-fixture.ts](../../backend/test/performance/latency-runtime-fixture.ts): observe acknowledged seal/dispatch/delta scheduler boundaries and collect complete command histograms; no additional storage dispatches.
- This evidence artifact. `acceptance-state.md` remains orchestrator-owned and untouched by Step 1. All changes uncommitted.

Step 2 may **prepare** isolated native suites without connecting. Preserve matching scenarios, distinguish synchronous storage dependencies from unrelated overlapping traffic, and collect complete command-monitor totals (including actual cursor/bulk/retry behavior), dispatch/first-answer/seal/terminal/release boundaries and real monotonic timings. Retain native durability/conformance/correctness checks; do not enable the saver facade just to improve numbers. A native baseline must execute against an identified source snapshot, not use this fake's counts as native evidence.

Actual execution still requires explicit operator authorization, dedicated replica-set attestation, an existing operator test URI, exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, and permission for generated database creation/drop and bounded sample load. Do not inspect application `.env`, substitute its database, or connect merely to detect prerequisites. Live provider/Calendar acceptance remains separately blocked by cost/data authorization; creation needs separate disposable-target mutation permission. No real topology, storage/provider latency, colocation speedup, deployment readiness or full-initiative acceptance conclusion follows from these offline runs.
