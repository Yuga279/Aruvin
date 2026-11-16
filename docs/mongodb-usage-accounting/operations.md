# MongoDB usage accounting operations

## Scope and authority

Accounting evidence, internal read-only reporting, and opt-in maintenance are implemented. There is no new dashboard, HTTP reporting endpoint, authorization, rollup service, refund workflow, provider integration, collection, or deployment. The six chat/memory/checkpoint collections retain their responsibilities; any already-existing configuration collection is untouched. Native MongoDB is the admitted profile, not Azure certification.

Implementation approval does **not** authorize migration of application data. No application migration, paid call, provisioning, or deployment was performed. Follow the existing [ownership/recovery/backup runbook](../aurvin-phase-1/operations.md); never overlap executors, bypass mutation intent, delete a sentinel, or infer safe takeover from lease expiry.

## Evidence and storage

Existing numeric `cost`, `estimatedCostUsd`, `actualCostUsd`, `accountingStatus`, IDs, timestamp strings, and schema version remain compatibility fields. New optional fields have no parser defaults. This release reads historical accounting and saved results without migration.

| Domain field | Storage / meaning |
| --- | --- |
| `money.currency` | Currently `USD`; totals group by currency and unit. Future currencies require a contract change. |
| `money.reportedAmount` | Canonical nonnegative decimal string or null; **Decimal128** in accounting BSON. Zero is known evidence. |
| `money.estimatedAmount` | Separate canonical string or null; **Decimal128**, never added to a reported charge. |
| `money.costStatus` | `known` only for a reported amount; otherwise `pending`/`unknown`, independent of tokens. |
| `money.source` | `provider-response`, `provider-generation`, `provider-estimate`, `legacy-number`, or `unavailable`. |
| `money.observedAt` | Bounded normalized UTC observation time or null. Migration time is conversion observation, not historical provider observation. |
| `money.pricing` | Null or bounded `{version,source,unit,units,unitSize,rateUsd}`. An estimate snapshots its admitted operator rate and provider characters. `rateUsd` is a domain string / stored Decimal128. |
| `cachedPromptTokens`, `cacheWriteTokens`, `reasoningOutputTokens` | Optional nullable safe integers on text records. **Breakdowns**, not tokens to add to parent totals. |
| `timing` | Optional timing object, described below. |

Decimals have no exponent, sign, redundant fractional zeros, leading whole-part zeros, NaN, or infinity; they are bounded to 400 characters and 34 significant digits. BSON decoding canonicalizes scientific notation without converting through a JavaScript number. Provider APIs currently return numbers: conversion preserves their received representation, not precision lost upstream or in legacy doubles. Native sums follow Decimal128's **34-digit arithmetic ceiling**, not arbitrary-precision invoice reconciliation.

The accounting-only codec runs before BSON/document bounds and on repository/CAS rereads. `RecordStore.raw()` remains storage-shaped and can contain Decimal128: use repository reads or `decode()` before domain services. HTTP usage remains numeric for compatibility. LangGraph results contain decimal **strings**. Stock saver serialization, identities, parent links, pending writes, namespace, indexes, and fencing are unchanged. No date sidecar is added; normalized existing `startedAt` strings include old/new records in the same range queries.

Absolute snapshots enrich one existing accounting identity, not delta charges. Known amounts, provenance, pricing, nonnull breakdowns and measured timing cannot silently regress/be replaced. Repeated chunks/reconciliation/finalization do not create new charges. Refunds/corrections require a separately approved, explicit auditable adjustment design, not overwriting known evidence.

### Text and voice

Text takes OpenRouter `usage.cost` or generation `total_cost`, not current model prices or upstream/BYOK inference cost. Response token details and documented native generation cached/reasoning counts are retained when valid. Missing/malformed optional counts remain unavailable; generation lookup does not invent cache-write counts.

Voice socket and TTS-response admission remain independently durable before dispatch. STT `observedAudioMs` measures submitted input, **not billed duration**. TTS `billableCharacters` is counted once per response, with exact estimate `characters × configured rate / 1000`; the original admitted rate is retained, never repriced historically. TTS socket lifecycle rows are excluded from financial totals using the three admitted TTS model IDs, avoiding socket/response double counting; detailed reads retain those rows. Actual voice invoice cost remains unavailable: `actualCostUsd` and `money.reportedAmount` are null. Converted historical estimates have `legacy-number` source and null pricing because their rate was not collected.

### Timing

- Existing `startedAt` is acceptance/creation, not dispatch.
- `timing.dispatchedAt` observes the **first actual** chat-completion HTTP dispatch.
- `timing.firstOutputAt` observes the first **nonempty text delta once**. Empty deltas, comments, private reasoning and finish markers do not set it.
- `timing.providerEndedAt` records confirmed provider `[DONE]`. Interrupted/error streams without that confirmed boundary leave it null; existing `endedAt` still records accounting lifecycle end.
- `providerDurationMs` / `firstOutputLatencyMs` are monotonic observations from first dispatch, including rejection/backoff and local stream-consumer/persistence observation overhead. They are **not provider-server-only latency**, are bounded to one hour, and remain null when historically unavailable/restarted.
- `dispatchCount` records actual inference HTTP dispatches, at most the existing three-dispatch ceiling. Rejections stay in the same execution attempt and do not change retry rules or imply free billing. Reconciliation GETs are not inference dispatches.
- `durableCompletedAt` is observed after required archive, manifest, confirmed checkpoint boundary and terminal attempt CAS in application publication. Provider end and subsequent guarded slot cleanup remain distinct. Replay retains the first saved observation.

Post-completion timing is optional: failure emits static `AURVIN_ACCOUNTING_TIMING_UNAVAILABLE` and does not reverse durable success. The measurement may be missing. Existing quarantine/timeouts and uncertain local intent still apply; optional telemetry is not permission to clear unsafe intent or guarantee client completion delivery after a storage fault. Required accounting failures remain failures of required publication.

## Internal read-only reporting

Use the **existing admitted bundle**, not another runtime/client owner. `AccountingReportingRepository` supplies:

```typescript
const range = { start: '2026-10-14T00:00:00.000Z', end: '2026-10-15T00:00:00.000Z', limit: 50 };
const detail = await bundle.metadata.listAccounting({ ...range, userId: serverUserId });
const user = await bundle.metadata.accountingTotals({ ...range, userId: serverUserId });
const allUsers = await bundle.metadata.accountingTotals(range);
const usersPage = await bundle.metadata.accountingTotals({ ...range, byUser: true, limit: 20 });
// Subsequent pages pass nextCursor with the same range, user scope and mode.
```

These methods are **not HTTP endpoints or authenticated admin functionality**. Restrict exports/access operationally: real identities and usage metadata remain sensitive. Reporting reads accounting only, without message/manifest/checkpoint joins or payloads.

Ranges are normalized UTC, half-open **`[start,end)`**, nonempty, and at most **31 × 24 hours**. A UTC day runs midnight `Z` to next midnight `Z`, not a local day/inclusive end. Pages are 1–50 and also bounded by admitted `maxPageSize`. Detail order is `(startedAt,_id)`; user totals order is `(userId,unit)`. Opaque cursors bind range/user/mode but are not authorization tokens.

Totals admit at most **10,000 financial operation records** per range, with server `maxTimeMS` and `allowDiskUse:false`. An extra record detects overflow, which **fails**, rather than returning a partial sum. `$facet` output is bounded to `limit+1`; grouping uses scalar request keys, not unbounded arrays. Global/user totals without `byUser` must fit the requested page or fail. Empty ranges return no rows, not a complete-zero invoice claim. Pagination is a live read, not a cross-page snapshot; use quiescent evidence for audits and do not repeatedly add the same per-page totals.

Rows group currency with `text-tokens`, `voice-audio`, or `voice-characters`; `userId` is individual/scoped or null for global totals. Separate `reportedTotal` / `estimatedTotal` are decimal strings, or null when **no amount of that type was observed**. They are observed subtotals, not proof of unavailable zero spend.

| Report fields | Interpretation |
| --- | --- |
| `knownCostCount`, `pendingCostCount`, `unknownCostCount` | Independent cost completeness; known cost is included even with unknown tokens. |
| `estimatedCostCount` | Operations with estimates, not actual provider charges. |
| `requestCount` | Distinct text logical turns `(userId,sessionId,turnId)` within the range. Retries add zero requests. Voice socket/response rows add zero, being downstream operations. |
| `executionAttemptCount` | Text accounting attempts, including failures/retries. |
| `operationCount` | Included text-attempt/STT-socket/TTS-response rows; TTS socket controls and non-accounting kinds are excluded. |
| `billableOperationCount` | Units with provider dispatch/generation/charge evidence; voice admissions count as attempted units. Not proof of a positive charge or a count of each rejected HTTP dispatch. |
| `dispatchCount`, `dispatchIncompleteCount`, `unobservedDispatchBillingCount` | Observed inference dispatches, operations lacking historical dispatch counts, and observed dispatches not covered by a reported generation charge. Rejections are not assumed free. |
| `spendComplete` | True only when all included operations have known cost and text dispatch billing is observable. Legacy charges remain included, but missing legacy dispatch evidence prevents a completeness assertion. |
| `tokenCompleteCount`, `tokenIncompleteCount`, `breakdownIncompleteCount` | Explicit token completeness. Token/breakdown numeric sums are observed subtotals; cached/reasoning counts are not added again. |
| `observedAudioMs`, `billableCharacters`, `voiceUnitsIncompleteCount` | Distinct audio/character units. STT billed duration stays unavailable even when submitted duration is known. |
| `failedCount`, `cancelledCount`, `interruptedCount`, `truncatedCount` | Lifecycle counts; reported charges remain included for these outcomes. |

No lifetime `$inc`, rollup, scheduler, time-series collection, TTL, `$merge`, or `$out` exists. Canonical `money` wins when present; numeric legacy costs convert through their native string representation only as a read fallback. Migration is not needed for historical inclusion and cannot recover lost precision.

Two ordinary nonunique metadata indexes are added; operational/stock saver indexes remain:

```javascript
{ kind: 1, userId: 1, startedAt: 1, _id: 1 } // kind_user_accounting_range
{ kind: 1, startedAt: 1, userId: 1 }         // kind_accounting_range_user
```

Local recovery admits only the recursively frozen validated accounting read pipeline, on `metadata`, with bounded options. Arbitrary/copy-modified pipelines, other collections, transactions, write stages and driver escapes remain refused. Reads do not mark mutation intent. Without isolated native prerequisites, query plans remain **unverified**; a gated fixture records winning index names/examined counts without records or credentials.

## Explicit-target migration

Run from `backend/`. These are operator templates, **not permission to apply**:

```powershell
npm run build
node dist/scripts/migrate-accounting.js --help
node dist/scripts/migrate-accounting.js --database "$TargetDb" --page-size 50 --max-pages 1000
# Separate approval, backup, stopped/reconciled writers, and inspected dry run are required:
node dist/scripts/migrate-accounting.js --database "$TargetDb" --apply --maintenance-confirmed --page-size 50 --max-pages 1000
# Resume using the returned opaque metadata key (include apply flags only for an approved apply batch):
node dist/scripts/migrate-accounting.js --database "$TargetDb" --after-id "$NextCursor"
```

Explicit **`AURVIN_ACCOUNTING_MONGODB_URI`** must contain `replicaSet`; it is not taken from application `MONGODB_URI`, accepted as a CLI argument, or printed. No application `.env` is loaded. Supply it through an ACL-protected operator mechanism, not a shell-history secret literal. `--database` is required even for dry run; no default target exists, and reserved `admin`, `local`, `config` names are refused. No provider calls occur.

For a Windows-local-bound database, explicitly set `AURVIN_ACCOUNTING_LOCAL_CRASH_RECOVERY=true` and use the **same exact configured URI and installation**. This does not bypass foreign/busy/pending sentinel refusal. Do not change URI aliases, turn local mode off, or delete a sentinel to admit maintenance.

Dry run is default and **performs zero mutations**: read-only connection/hello/queries, no executor claim or index creation. Apply uses `openPersistence` admission/setup/close, normal local guard/journaling when selected, and no runtime. Routine ownership/index setup may update its own machinery; the **enrichment transformation** replaces only `accounting`/`voice-accounting`, never control kinds or other collections. It never silently steals ownership or performs unsafe-exit reconciliation itself.

Internal `metadata.migrateAccountingPage({limit,cursor,apply,maintenanceConfirmed,owner})` requires the exact admitted owner/store, executor checks, no active/owned sessions, and an idle nonpending local journal before writes. Operator stop confirmation is also necessary: a quiescent query cannot prove a running backend stays stopped. Each record uses its observed `_revision`, stable key/scope, existing conditional replacement/ambiguous-write confirmation, and BSON/document budgets. Concurrent changed records are skipped/reported, not overwritten; uncertain writes retain quarantine.

Pages are capped by the budget/50, batches by **1,000 pages / 50,000 records**. Output contains bounded counts (`scanned`, `eligible`, `converted`, `unchanged`, `invalid`, `conflicts`), page/completion indicators and an opaque continuation key, not records/credentials/exception text. Exit **0** means completed without invalid/conflicting rows; **2** means continuation/invalid/conflicts; **1** means refusal/failure/unconfirmed close. Help makes no connection; Ctrl-C prevents further dispatch after bounded current IO.

Legacy numbers convert to Decimal128 with `legacy-number` provenance and a current conversion observation time. Original numeric fields and timestamps are preserved exactly. Nulls stay null; historical rates, costs, tokens and durations are not invented. Already enriched valid records are unchanged. Invalid shape/key/revision/budget is reported without mutation. Repeated apply is idempotent. After resolving conflicts, rerun the full scan: continuation passes skipped keys deliberately.

### Backup and reader/writer order

1. Separately approve the explicit target. Stop traffic and every writer, including accounting lookups/maintenance; drain, reconcile without inference replay and verify graceful close or approved stopped-work evidence. No rolling overlap.
2. Under write freeze, verify an encrypted access-restricted **entire-database** backup including all six chat/memory/checkpoint collections, controls and any existing configuration collection. Record release/dependency/schema/asset versions, collection/index counts and backup hash without secrets. Restore/test into a new isolated database with fixture providers.
3. Install the backward-reading release **before** any enriched writer or migration. This release reads old/new metadata and saved results; the old strict release does not read new additive fields. Replace one stopped executor with one coordinated reader/writer release.
4. Optional migration: stop/reconcile the new backend again, inspect dry run, apply only with separate authority, finish pages/conflicts, verify, and close maintenance before restarting. Startup never automatically migrates data; only ordinary index setup is added.

### Rollback is conditional, not guaranteed

Tests prove old strict text/voice readers accept legacy records but **reject** additive `money`, `timing`, and text breakdown fields. Keeping compatibility numbers is necessary, not sufficient for old-reader compatibility.

If **only metadata enrichment** occurred and no new-release checkpoints/pending writes or other incompatible state were written, a separately approved reversible cleanup can restore the old field set:

1. Freeze/drain all writers; verify an enriched whole-database backup/audit copy so precise provenance is retained.
2. In the admitted guarded maintenance context, page only the accounting kinds. Validate each record; condition on `_id`, scope, `kind` and observed `_revision`; remove only `money`, `timing`, `cachedPromptTokens`, `cacheWriteTokens`, `reasoningOutputTokens` as applicable and increment revision. Preserve numeric fields, IDs, timestamps, outcome, controls and other collections. Use the **same mutation guard/uncertainty protocol**, not an unguarded shell writer. Conflicts require operator reconciliation, not unconditional overwrite.
3. Validate the actual old schemas/release against an isolated restored copy and whole owner/checkpoint alignment before an approved restart. Retain enriched backups for reversible restoration. No automatic destructive cleanup command ships here.

New saved graph evidence also resides in stock serialized checkpoint/pending-write values. Metadata cleanup **does not** clean those binary values. Do not `$unset` inside blobs, delete results, consolidate pending writes, or replay inference. For new-release graph writes, supported safe rollback is a verified **complete pre-upgrade snapshot restored to a new isolated target**, previous-release validation, then an approved switch. Serializer-aware versioned conversion requires separate approval/proof and is not built. Record post-backup accepted data/provider costs that rollback loses. Unknown compatibility blocks rollback readiness.

## Verification prerequisites

See [implementation-report.md](implementation-report.md) for actual passes/failures/skips. Native tests require operator-supplied `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; fixtures create/drop only generated isolated databases. Never substitute application data or print the URI. Without these prerequisites, native aggregation/saver recovery/explain/backup/rollback drills are skipped/unverified, not passed. Azure/live/provider checks require separate authority.
