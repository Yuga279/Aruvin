# Shared text critical-path implementation plan

> **For agentic workers:** Execute in this assigned session using systematic-debugging and test-driven-development; no child agents, review, commits or external connections are authorized.

**Goal:** Remove proven redundant text-dispatch storage dependencies without weakening durable possible-billing evidence or identity-before-output.

**Architecture:** Retain the existing accounting service, supervised writer, opaque receipts, ownership fences and majority-acknowledged repositories. Combine the adapter's initial empty observation with its mandatory first dispatch observation, and forward the already-held accounting receipt to the existing receipt-aware repository method. Do not change persistence validation, Calendar behavior, baseline instrumentation or acceptance thresholds.

**Tech stack:** Existing TypeScript/Nest runtime, Vitest and injected offline BSON fake; stock LangGraph saver remains unchanged.

## Steps

- [x] Trace dispatch through runtime, adapter, accounting service and repository, compare independently identified baseline source, and inspect all callers.
- [x] Add focused tests showing exactly one acknowledged accounting snapshot before first fetch and receipt reuse on sequential runtime accounting writes; run red against unchanged production.
- [x] Apply minimal production edits: replace `d.check();await save()` with `d.check()` because the loop immediately persists the richer dispatch snapshot before fetch; call `putAccountingConfirmed(record, accountingReceipt ?? undefined)` inside the existing serialized ownership action.
- [x] Run focused offline model/runtime suites and the unchanged complete performance matrix with dotenv disabled and test connection variables overwritten empty; preserve all remaining acceptance failures.
- [x] Build/lint the backend only, check whitespace/document consistency, and write full before/after metrics, root-cause references, remaining ceilings and Calendar handoff in `text-critical-path-results.md`.

## Verification commands

Run from `backend/` with `AURVIN_NATIVE_PERF_ENABLE=disabled`, `AURVIN_TEST_MONGODB_URI=''`, `AURVIN_TEST_DB_PREFIX=''` and the existing safe wrapper `C:/Users/Peter/AppData/Local/Temp/opencode/latency-step4-backend-offline.config.mjs` (imports project configuration with `envDir:false`). Select only inspected injected tests; no broad native/e2e discovery.

```powershell
npm test -- test/model/adapter.spec.ts --config C:/Users/Peter/AppData/Local/Temp/opencode/latency-step4-backend-offline.config.mjs --maxWorkers=1
npm test -- test/performance --config C:/Users/Peter/AppData/Local/Temp/opencode/latency-step4-backend-offline.config.mjs --maxWorkers=1 --silent=false --disableConsoleIntercept --reporter=verbose
npm run build
npm run lint
```

The red check must fail on the redundant initial accounting write, not a test setup error. Existing baseline caps and 30%/25%/30% goals remain unchanged; failing goals stay ordinary failures. Any additional optimization requires an independently demonstrated redundant dependency and a red test before production edits. No promise that this bounded correction meets every initiative goal; no native/provider timing conclusion from synthetic waves.

## 2026-10-30 continuation — shared admission/context

I2 owns Calendar accounting/ledger/debit/operation/publication files concurrently. I1 changes only generic runtime admission, generic ownership/contracts, focused tests and its two documents. No package build while I2 is active; no network/DB/provider connections or native/live edits. Frozen measurement files remain byte-identical.

### Investigation and implementation steps

- [x] Trace `acceptNewTurn`/`acceptRetry`, `checkBoundary`, acquisition/reservation/staging/attachment, generic repositories, admission receipts, and the default stock saver; inspect all production callers of acquisition and context checking.
- [x] Add and run red checks that reservation/allocation/input+attempt staging share one bounded storage-only ownership phase, and that successful acquisition carries its acknowledged session into admission without an immediate reread.
- [x] Expand the existing acceptance-stage local action to include reserve/allocate before input/attempt writes (four guarded operations for submit, three for retry), without spanning Calendar budget/proposal work or acceptance publication. Preserve fallback when optional protocols are unavailable.
- [x] Add an optional `session` field to the existing successful acquisition result, return the actual decoded CAS result/readback from `MongoOwnership.acquire`, and use it only for the immediate latest-turn validation; preserve the old read fallback for custom owners. Test stale generation, concurrent claims and both sides of uncertain acknowledgment.
- [x] Start `checkBoundary`'s independent stock-saver state read alongside history/manifest reads instead of only after archive/acceptance pagination finishes. Keep every read, comparison, bound and acknowledgment; add a red overlap test using a held archive read and the injected saver.
- [x] Run focused model/runtime/context/ownership/receipt/recovery checks, type-aware lint, frozen-source checks and the safe offline matrix. Record concurrent Calendar source identity separately; do not attribute its changes to I1. No package build.
- [x] Append measured results and a concrete feasibility breakdown to I1 results, including stock-saver redundant reads that remain gated, current-context validations deliberately retained and uninvestigated work. Do not call the residual a proven floor.

The existing disposable admission receipt is insufficient to skip `checkBoundary`: its checkpoint ID is synthetic, and a session generation alone does not attest manifest/message/retention state. Do not activate it as a context cache. The default saver reads checkpoint/pending-write bounds before delegating to stock reads; avoiding those repeated reads is exactly the still-gated facade, not permission to drop bound checks.
