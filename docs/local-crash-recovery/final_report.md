# Local crash recovery — implementation report

## Outcome

Implemented in `fa98a2d` (`feat: add idle-journal local crash recovery`), following foundation commit `7844658`. The stopped handoff was resumed by `xai/grok-4.6` with the `high` variant at the user's request. No skills or old launcher plan were used by the implementing agents. Unified review was skipped, not passed.

The mode is default-off. It provides automatic restart recovery for supported Windows-local owners whose durable mutation journal is idle. Exact process-lifetime checks and OS exclusion prevent overlap; primary owner/revision/idle compare-and-swap fences handoff. Every admitted data write is preceded by acknowledged durable busy intent and only successful durable completion permits clearing intent. Uncertain writes stay busy and require operator recovery.

Startup reconciliation preserves bounded ancestor authorization, includes owner-only leftovers, reuses sealed results without inference, interrupts no-result work, and finishes before generation readiness. Local graceful shutdown retains a released ownership binding rather than deleting it.

## Independent final verification

Run by the main session on 8 October 2026 against `fa98a2d` plus preserved, unstaged sibling session-action changes. Consequently the routine suite result is a shared-working-tree result, not an isolated clean-commit certification.

| Directory | Command | Actual result |
| --- | --- | --- |
| backend | `npm run build` | Passed |
| backend | `npm run lint` | Passed with warnings; not a warning-free claim |
| backend | `npm test` | 62 files passed; 371 tests passed, 1 skipped; 29.83 seconds |
| root | `git diff --check` | Passed; CRLF conversion warnings only |

The native test URI and prefix were absent. The skipped test is the operator-gated native assembled smoke. Implementing agent additionally reported 36 focused offline tests passed. Earlier whole-tree TypeScript checking reported six errors in unchanged tests; it was not rerun or represented as passing. Nest build and Vitest execution are distinct from whole-tree test typechecking.

## Enablement and limitations

See [README local crash recovery](../../README.md#local-crash-recovery-opt-in). Set `AURVIN_LOCAL_CRASH_RECOVERY=true` explicitly in backend environment only after the documented legacy-owner migration. Requires Windows, native MongoDB profile, explicit replica-set URI, writable primary matching its set name, and majority+journal acknowledgements. No private `.env` was modified and the mode was not enabled for the user's database.

Legacy unbound sentinels still require one verified operator handoff/reconciliation and graceful release. Busy/malformed/foreign/live/unsupported owners are not automatically adopted. Exact configuration/installation binding means changes require operator migration. No arbitrary mid-write recovery, model replay, exactly-once billing, or charge-prevention promise.

No live database mutations, native-service crash drill, Azure certification, provider calls, e2e suites, provisioning or deployment were performed. Existing sibling source changes and untracked local/user files were preserved. Phase 1 integrated verification and rollout gates remain separate.
