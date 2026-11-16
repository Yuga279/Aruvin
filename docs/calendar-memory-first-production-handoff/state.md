---
objective: calendar-memory-first-production-handoff
workflow: maw
status: verification-complete-focused-green-broad-open
skipped_phases: [review]
source: user production handoff, 9 November 2026
goal_status: approved
dag_status: research-reconciled
resume_gate: authorized
---

# Calendar memory-first production handoff execution

The user's production handoff is the approved design and acceptance matrix. No
staging or commits are authorized. Existing benchmark artifacts and workflow states
remain immutable. This new record tracks this continuation only.

## Milestones

- [x] Brainstorming/design alignment: user supplied exact architecture, gates and tests.
- [x] Targeted local research and implementation planning (goal/research/plan1/plan2; unstaged by instruction).
- [x] Worker execution and defect correction.
- [x] Unified review: **skipped**, per repository instructions. Never passed. No reviewer or review-triggered fixer.
- [x] Final verification and implementation report update. Focused acceptance 30/30. Broad routine **not** green: 2,856 passed / 30 failed / 10 skipped. See [`final_report.md`](final_report.md).

## Ownership and dependencies

| Unit | Ownership | Planning prerequisites | Worker prerequisites | Status |
| --- | --- | --- | --- | --- |
| P1 | Memory foundation, ledger, state validation, calendar history and focused tests | Local research | Approved plan and agreed interfaces | Complete: 79 related tests pass; unstaged; idle |
| P2 | MemoryText, CalendarLoop, runtime routing, AppService lifecycle wiring | P1 interface agreement | Approved plan; P1 interfaces required for integrated completion | Complete: 30 acceptance / 71 related runtime tests pass; unstaged; idle |
| P3 | Calendar memory-first integration acceptance suite | P1/P2 interface agreement | Approved test plan; production workers required for GREEN | Complete: 30 tests pass without overrides; unstaged; idle |

P1 and P2 can execute on disjoint files once interfaces are agreed. P3 owns the
integration test file separately. At most three children run alongside the
orchestrator. The orchestrator manages dispatch, documentation and final checks;
workers own production edits. Review remains skipped, never passed.

No worker was reactivated after the full routine completed: every remaining
failure name was already present in the stopped entry partial log.

## Entry evidence

- HEAD: `89e0d4ee94c14f92d383efd1e114a1b8b57463c9`.
- Node: `v24.19.0`; Windows PowerShell; installed package dependencies.
- 78 modified/untracked paths recorded with SHA256 hashes in system temp
  `aurvin-calendar-handoff-entry-20261109.json` before edits.
- Focused entry run: 6 passed, 1 failed. Failure is ordinary Calendar-enabled
  admission reaching blocked `DurableChatRuntime.acceptNewTurn` before dispatch.
- Broad entry run stopped before production edits to avoid mixed-source baseline
  claims. Its partial output is retained in system temp
  `aurvin-calendar-handoff-baseline-20261109.log`; it is not a completed baseline.

## Research handoff

P1 provides ordered flush, promoted commit/import, account redaction and seeded
retry budgets. P2 retains the existing Calendar effect dispatcher and durable
publication, and must synchronize `sessions.memoryPublication` plus sequence
counters so later memory archives accept the promoted version. Existing redaction
helpers are reused. P3 exclusively owns the integrated acceptance file.

## Verification policy

Run all requested backend checks with `AURVIN_TEST_MONGODB_URI=''` and one Vitest
worker. Run build and lint sequentially, then built-assembly checks, then the full
routine suite. Record actual failures and skips separately. No paid/live provider,
external database, provisioning or deployment checks are authorized.

## Worker evidence (intermediate)

- P3 removed all eligibility overrides. First production-route run: 7 failed / 0
  passed, confirming the old checks no longer bypass admission.
- P1 first support RED: 5 new failures / 34 existing passes (missing flush/import,
  ignored retry seed, missing capsule history). Initial GREEN: 55 passed across
  three support suites. Final requested four related suites: 75 passed. Failure,
  timeout, fencing and late-save assertions pass. The obsolete test requiring
  Calendar-enabled text to use the durable route now asserts memory admission.
- P2 authorized a minimal extension to `calendar-publication.ts` for promoted
  voice projection and deterministic redaction clock; it remains the sole publisher.
- P3 real AppService admission check passes with all repositories and account
  methods blocked; local native activation/repair checks also pass without
  overrides.

## Final verification evidence

| Check | Result |
| --- | --- |
| Focused `calendar-memory-first.spec.ts` | **30/30 passed**, 6.35 s |
| Root four related suites | **79/79 passed**, 11.22 s (before final late-race integration fix) |
| Worker related text/voice/Calendar runtime | **71/71 passed** |
| Backend build | Exit 0 |
| Backend lint after build | Exit 0; **647 warnings / 0 errors** |
| Requested `test/assembly/built-assembly.spec.ts` | No such file; exit 1 / no tests found |
| `test/assembly/calendar-simplification.built.spec.ts` | **1/1 passed**, 5.70 s |
| Full routine `npm.cmd test -- --maxWorkers=1` | **2,856 passed / 30 failed / 10 skipped**; 316 files (308 passed / 6 failed / 2 skipped); 378.13 s |

The 30 broad failures match the stopped entry partial log by exact name. The
entry Calendar admission failure is fixed and is not among them. Classification
and skip reasons are in the top continuation of
[`../performance/calendar-memory-first-implementation-2026-11-08.md`](../performance/calendar-memory-first-implementation-2026-11-08.md)
and [`final_report.md`](final_report.md).

Final hygiene: 78/78 entry paths present; 12/78 hashes differ, all listed
continuation files; extra vs entry are `calendar-history.ts`,
`calendar-publication.ts`, `reconciliation.ts` and this workflow directory.
HEAD unchanged. `git diff --check` exit 0. Staged list empty. Unstaged /
uncommitted by instruction.

## Current gate

**CURRENT GATE: FOCUSED ACCEPTANCE COMPLETE; BROAD ROUTINE OPEN.**

Review skipped. Implementation workers remain finished/idle. Focused Calendar
memory-first acceptance is implemented and verified. Broad backend readiness is
not claimed. No staging or commits. No further orchestrator dispatch unless the
user authorizes work on the remaining historical broad failures.
