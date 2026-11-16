# Calendar memory-first: remaining-work handoff

9 November 2026. Original note: the user requested this handoff while final
routine verification was running. **That run has now completed.** Focused
acceptance remains **30/30**. Broad routine is **not** green
(2,856 passed / 30 failed / 10 skipped). Review is **skipped**, never passed.
Do not restart implementation from the older incomplete report sections.

## Read first

- Root `AGENTS.md` and the user's Calendar Memory-First Production Handoff.
- [Current implementation report](../performance/calendar-memory-first-implementation-2026-11-08.md),
  specifically its new 9 November continuation at the top.
- [Execution state](state.md) and [final report](final_report.md).
  `goal.md`, `research.md`, `plan1.md`–`plan3.md` are in this directory. Under
  MAW, orchestrators use state and reported summaries; assigned workers read
  their own plans.

The user prohibits staging and commits. Preserve all pre-existing work, including
78 entry modified/untracked paths, unrelated frontend/benchmark work and local
configuration. Review is **skipped**, never passed. No reviewer or review-triggered
fixer. No external/live/paid checks, provisioning or deployment are authorized.

## Completed behavior

- Real Calendar-v2 text and voice admission through the shared memory foundation;
  no eligibility overrides remain. Actual AppService ordinary chat completes with
  every repository and account-authority method blocked.
- Cold external/native history hydration, proposals/bindings, dynamic expiry,
  voice textSpoken/artifact projection, turn-wide retry budgets.
- Ordered dirty-session flush before promotion; true confirmed input/attempt,
  acceptance, budget/dispatch receipts and original pending graph cursor.
- Existing read executor/create writer remains the single effect authority;
  original call/decision IDs are retained.
- Durable seal/publication, memory-publication marker and sequence synchronization,
  imported terminal messages/groups/proposals and version/durableVersion.
- Persistence-only prefix retry; original-ID uncertain-create reconciliation;
  saved-seal publication-only recovery. Following ordinary turns save successfully.
- Disconnect/revoke/disable, expiry and account-redaction synchronization into warm
  text/voice state. The final late-prefix invalidation race was reproduced RED
  and fixed, including a subsequent ordinary turn that saves successfully.

## Verified results

| Check | Result |
| --- | --- |
| Entry focused suite | 1 failed / 6 passed; blocked durable admission |
| After removing all test overrides | 7 failed / 0 passed; real-route RED |
| Final root `calendar-memory-first.spec.ts` | **30/30 passed**, 6.35 s |
| Root four requested support suites | **79/79 passed**, 11.22 s; before final late-race integration fix |
| Worker related text/voice/Calendar runtime matrix | **71/71 passed** |
| Worker final TypeScript no-emit | Exit 0 |
| Root backend build | Exit 0 |
| Root backend lint, sequentially after build | Exit 0; **647 warnings / 0 errors** |
| Requested `test/assembly/built-assembly.spec.ts` | **No such file; command exit 1 / no tests found** |
| Actual `test/assembly/calendar-simplification.built.spec.ts` after build | **1/1 passed**, 5.70 s |
| Full routine `npm.cmd test -- --maxWorkers=1` | **2,856 passed / 30 failed / 10 skipped**; 316 files (308 passed / 6 failed / 2 skipped); 378.13 s. Numeric wrapper exit not captured in the resume session; Vitest reported 30 failures. |

Environment: Windows PowerShell, Node `v24.19.0`, Vitest `4.1.11`, installed
dependencies. All test commands used `AURVIN_TEST_MONGODB_URI=''`, one Vitest worker,
fake repositories/provider responses. No MongoDB service, Azure or live provider
certification follows from these checks.

## Remaining tasks — collected 9 November 2026

1. **Collect the running full routine suite.** Done. Process was already finished
   in this new session; the log had a final summary, so the suite was not rerun.
   Log: system temp `aurvin-calendar-handoff-routine-20261109.log`.
2. **Classify every failure against entry evidence.** Done. All 30 remaining
   names match the stopped entry partial log. The entry Calendar admission
   failure is fixed. No new task-related defect; P1/P2/P3 were not reactivated.
   Historical thresholds were not weakened.
3. **Finish report and state.** Done. Top continuation of the implementation
   report, this workflow `state.md`, and `final_report.md` now record actual
   counts, skip reasons and the baseline comparison. Older report sections
   preserved. Review recorded as skipped.
4. **Finish hygiene and handoff.** Done. `git diff --check` exit 0; staged list
   empty; HEAD `89e0d4ee94c14f92d383efd1e114a1b8b57463c9`. 78/78 entry paths
   present; 12/78 hashes differ, all listed continuation files; extra vs entry
   are `calendar-history.ts`, `calendar-publication.ts`, `reconciliation.ts`
   and this workflow directory. Links and P1/P2/P3 ownership remain consistent.
   Everything unstaged/uncommitted.

## Logs and exact commands

System-temp files (use `$env:TEMP`, do not assume a hardcoded temp directory):

- `aurvin-calendar-handoff-entry-20261109.json`: entry path/status/SHA256 manifest.
- `aurvin-calendar-handoff-baseline-20261109.log`: stopped pre-edit partial run.
- `aurvin-calendar-handoff-routine-20261109.log`: completed final run.
- `aurvin-calendar-handoff-lint-20261109.log`: completed lint output.

Run from `D:\Peter\ECG\Aurvin\backend`:

```powershell
$env:AURVIN_TEST_MONGODB_URI=''
npm.cmd test -- --maxWorkers=1 test/performance/calendar-memory-first.spec.ts
npm.cmd test -- --maxWorkers=1 test/performance/memory-first-foundation.spec.ts test/performance/memory-text-archive.spec.ts test/performance/memory-first-text.spec.ts test/performance/memory-calendar-state.spec.ts
npm.cmd run build
npm.cmd run lint
npm.cmd test -- --maxWorkers=1 test/assembly/calendar-simplification.built.spec.ts
npm.cmd test -- --maxWorkers=1
```

Do not repeat successful checks unless a change, failure or unresolved concern
justifies it. The completed full suite covers final production source;
the standalone related-suite run preceded only the final MemoryText race fix.

## Ownership and exact continuation edit set

- P1 `/root/integration_planner`: `memory-first-foundation.ts`,
  `memory-calendar-ledger.ts`, `memory-calendar-state.ts`, `calendar-history.ts`;
  `memory-first-foundation.spec.ts`, `memory-calendar-state.spec.ts`,
  `memory-first-text.spec.ts`. Retry-context filtering, failed-seal import and
  voice redaction support are already included. P1 is finished/idle.
- P2 `/root/calendar_integration`: `memory-text.ts`, `calendar-loop.ts`,
  `durable-chat-runtime.ts`, `calendar-publication.ts`, `reconciliation.ts` in
  `backend/src/chat-runtime/`, plus `backend/src/app.service.ts`. P2 is
  finished/idle. Use `followup_task` to activate a finished worker for a defect;
  `send_message` alone does not trigger an idle agent's turn.
- P3 `/root/calendar_acceptance`: only
  `backend/test/performance/calendar-memory-first.spec.ts` and the new `plan3.md`.
  P3 is finished/idle.
- Orchestrator: new workflow docs, this handoff, the implementation report and
  `final_report.md`. No implementation code was written by the orchestrator.

No archive/reader or frontend production files were changed in this continuation.
Three previously clean tracked production files became modified:
`calendar-history.ts`, `calendar-publication.ts`, `reconciliation.ts`. Other
production changes were already modified or untracked at entry. HEAD remains
`89e0d4ee94c14f92d383efd1e114a1b8b57463c9`. Final SHA comparison: **78/78 entry
paths present**, 12 listed continuation hashes differ, zero unexpected changes
among the 78, plus the three previously clean files and this workflow directory.

`git diff --check` passes and the staged list is empty.

Single-process/single-executor authority and finite save/budget/retention limits
remain. No multi-instance support, exactly-once billing, measured live latency
improvement or external/Azure certification is claimed.
