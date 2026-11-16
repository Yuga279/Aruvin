# Calendar memory-first production acceptance plan

**Goal:** Verify all production handoff gates through unmodified admission and deterministic real persistence fixtures.

**Architecture:** Reuse the existing Calendar fixture, fake-driver persistence bundle and real provider adapter. Block repository/account access only for no-tool turns; exercise the existing external writer/read dispatcher and durable repositories for promotion.

**Tech stack:** Existing TypeScript ESM and Vitest; no dependencies, live services, staging or commits.

## Ownership and execution

Own `backend/test/performance/calendar-memory-first.spec.ts` and new local test helpers only. P1 owns foundation support; P2 owns production wiring. Preserve their edits and coordinate failing assertions directly. Review is skipped.

1. Remove admission spies; run the suite RED using actual eligibility.
2. Preserve native local activation, repair, cancellation, cold archive and drain coverage.
3. Replace obsolete unavailable-promoter expectation with persistence failure/save-only resume coverage.
4. Add successful external read/create promotion, pending proposal zero-dispatch replies, cold external history/expiry, lifecycle invalidation race, post-create reconciliation and text/voice consistency checks using existing fixtures.
5. Run focused checks and report precise failures to P2. Require original call IDs, input exactly once, unchanged tools/user attribution, zero extra inference/effects, and durable/shared-memory version agreement.

All commands run from backend with `AURVIN_TEST_MONGODB_URI=''`: `npm.cmd test -- --maxWorkers=1 test/performance/calendar-memory-first.spec.ts`.
