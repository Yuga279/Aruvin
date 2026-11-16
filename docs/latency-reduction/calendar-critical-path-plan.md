# Calendar Critical-Path Implementation Plan

> **For agentic workers:** Execute locally in this assigned session; no delegation, staging or commits. User instructions override the generic subagent/commit workflow.

**Goal:** Remove proven redundant Calendar storage dependencies without weakening original latency gates or durable semantics.

**Architecture:** Reuse existing opaque assistant receipts and bounded `ExecutionOwnership.runPhase` on consecutive storage-only work. Keep external dispatch/capability checks, per-record acknowledgments/CAS, strict recovery, original measurement scope and I1 edits.

**Tech Stack:** TypeScript, existing Mongo repositories/stock saver, Vitest and offline BSON fake.

---

## Trace and constraints

Admission persists input/attempt/acceptance and binds the accepted deadline. Execution confirms context and generating attempt, creates Calendar ledger/loop, checks account/ownership, reserves budget/dispatch, marks dispatch durably, then fetches. Observations persist identity before output; dispatch completion and tool decisions/effects/retention precede continuations. Seal aggregates accounting and builds ordered context; synchronous saver seal is confirmed before publication. Publication appends assistant, completes it, touches activity, commits manifest and graph boundary, then finalizes attempt and releases before terminal output. Recovery calls publication without live evidence and must retain strict replay reads.

Inspected all `CalendarTurnLedger`, `publishCalendarTurn`, accounting update/debit and model binding callers. Existing ledger receipts are already used; do not remove their validation or substitute ordinary records for opaque receipts. No native/live execution, dotenv reads, saver activation, dependency/config/model changes or frozen harness edits.

## Steps

- [x] Add focused regression tests in `backend/test/performance/calendar-critical-path.spec.ts`; run red with the existing safe Step 4 wrapper. Test that live completion receives the exact acknowledged assistant append receipt, budget/reservation use a bounded phase, and publication storage writes use bounded phases. Use real runtime/repositories with deterministic injected transports.
- [x] Modify only `backend/src/chat-runtime/calendar-loop.ts` and `calendar-publication.ts` for initial proven fixes. Wrap `ledger.reserveDispatch` with existing optional `owner.runPhase` (`maxOperations: 4`, finite deadline), falling back unchanged when unavailable. Keep adapter `beforeDispatch` fences outside. For live publication with both receipt methods, call `appendConfirmed(redactCalendarMessage(...))`, then `updateCompletionConfirmed(receipt, ...)`. Keep recovery's existing get/content check and legacy completion path. Group consecutive archive writes (4 operations) and attempt transitions (2 operations) into separate bounded storage phases; graph-boundary callback and cleanup remain outside.
- [x] Run focused green plus complete Calendar, model, accounting, ownership, retention and recovery offline selections. Add acknowledgement/fault coverage if the focused trace exposes a gap; do not weaken existing tests to accommodate a change.
- [x] Rerun frozen offline matrix and backend build/lint with test URI/prefix cleared and dotenv disabled. Record complete commands and pre/first/post waves for both profiles, correctness and all failed gates. No native/e2e discovery.
- [x] Write `calendar-critical-path-results.md` with exact commands, file inventory, before/after measurements and residual safe next work. Check whitespace, frozen hashes and integration limits. Stop honestly if remaining targets require broader evidence/design.

## Exact runnable checks

From `backend/`, for every test invocation set `AURVIN_NATIVE_PERF_ENABLE=disabled`, `AURVIN_TEST_MONGODB_URI=''`, `AURVIN_TEST_DB_PREFIX=''` without reading current values. Wrapper: `C:/Users/Peter/AppData/Local/Temp/opencode/latency-step4-backend-offline.config.mjs` (`envDir:false`).

```powershell
npm test -- test/performance/calendar-critical-path.spec.ts --config C:/Users/Peter/AppData/Local/Temp/opencode/latency-step4-backend-offline.config.mjs --maxWorkers=1 --reporter=verbose
npm test -- test/performance test/benchmark/runner.spec.ts test/benchmark/latency.spec.ts --config C:/Users/Peter/AppData/Local/Temp/opencode/latency-step4-backend-offline.config.mjs --maxWorkers=1 --silent=false --disableConsoleIntercept --reporter=verbose
npm run build
npm run lint
```

Expected red: existing production never forwards assistant receipt/enters Calendar reservation/publication phases. Expected green: focused checks pass; frozen combined acceptance can remain red and must be reported. Review **skipped**.

## Continuation — debit/aggregate evidence protocol (2026-10-30)

The first intervention and its evidence above remain accepted. This continuation owns only Calendar-specific contracts, ledger/repository and focused tests; I1 owns generic admission/ownership/messages/context/manifest paths. No package build by I2; final verifier owns it. Existing no-external-execution constraints remain.

### Investigation and proposed protocol

`consumeDebitNow` already owns a store-issued budget receipt, but `debit` always rereads its envelope and returns only a plain budget; the ledger then discards the receipt, forcing another read before the next request-counter/reservation update. A new debit can safely use the acknowledged envelope **only as a CAS expectation**, never as proof it is current: retain exact `_revision` and logical revision predicates, hidden `_calendarClaims`, limit checks and both majority-acknowledged writes. Extend the existing request with optional server-only `expectedBudget` (opaque `ConfirmedBudget`) and successful outcomes with optional `budgetReceipt`. These are not persisted/request-wire fields. Legacy stores/callers may omit both.

Absent evidence uses the original strict read. Invalid/foreign/forged evidence fails before mutation. Duplicate evidence must reread the current envelope and repair the separate debit record; do not return an old cached duplicate budget. Stale CAS falls back to strict reread/retry, including payload comparison on a concurrently landed debit identity. Return only a receipt issued from an acknowledged CAS or an exact strict readback. Ledger forwards/retains it after successful completion; errors invalidate existing caches as before. No arbitrary cache or skip flag.

Aggregate and money settlement have a different barrier: `putAggregate` verifies the **complete current attempt dispatch-ID set**, while settlement verifies every claimed dispatch still exists and matches its immutable claim before recomputing held/settled money. Old immutable receipts do not prove no later dispatch was reserved or that another claimed row still exists. No CAS in aggregate publication pins this complete set. Keep these strict reads unless a testable stronger protocol is proven; do not enable a superficially similar receipt shortcut.

### Steps

- [x] Add `backend/test/persistence/calendar-debit-receipts.spec.ts` with fresh-receipt zero-preliminary-read, private-claim/Decimal128 preservation and receipt-to-next-CAS tests; absent receipt strict reads; forged/wrong-store/wrong-scope rejection; stale CAS preserving concurrent counters; duplicate repair using current budget; concurrent same-debit/different-payload conflict; uncertain budget/debit-write restart recovery. Add stale aggregate-set test demonstrating why that read remains required. Run before production changes and record expected red failures.
- [x] Modify only `backend/src/contracts/calendar-accounting.ts` and `backend/src/persistence/calendar-accounting.ts` to add optional receipt transport to existing debit API, use `casBudgetEnvelopeConfirmed`, and retain strict duplicate/stale/uncertain paths. Keep aggregate/settlement reads unchanged. Run repository green and existing accounting suites before enabling ledger reuse.
- [x] Add focused real-runtime regression to `calendar-critical-path.spec.ts` proving each debit receives the latest confirmed budget and its returned receipt reaches the next budget operation; run red before modifying `backend/src/chat-runtime/calendar-budget.ts`. Forward existing receipt and retain returned receipt; fallback remains plain-budget strict read.
- [x] Run Calendar/model/accounting/ownership/recovery selections and lint with safe wrapper/cleared URI; scoped type diagnostics only if useful, no package build. Frozen matrix may run only as a concurrent-source diagnostic; compare local debit command reductions separately from I1 changes.
- [x] Append results, retained-read proof and exact before/after/checks to the I2 results document, preserving original evidence/source hashes as historical identities. Record all residual acceptance failures and integration limits; no whole-workflow completion claim.
