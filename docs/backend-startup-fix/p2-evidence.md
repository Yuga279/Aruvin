# P2 isolated capabilities and conditional recovery evidence

Recorded 7 October 2026 against base `933f0aa74ad6bb0acfadb4f9d753cf015f7fd4da` (approved P2 plan). P2 changes are uncommitted for orchestrator serialization. Unified review: **skipped**.

Final checkout head is P1's independently serialized startup commit `2ac57e75d3438bab2e8ed6fd91cac9001127bb1e`; P2 did not stage or commit it. The maintenance reused unchanged ownership/store/config modules from the successful build, not P1 startup code.

## Outcome

- **Generated actual-service capability probe: passed**, one discovered test, no skips. Its single generated `aurvin_p2_test_<uuid>` database was dropped by the existing fixture helper and independently verified absent using an exact-name filtered `listDatabases` read on a fresh connection.
- **Full selected-service certification: blocked**, not passed. The unchanged full-facts suite deliberately failed before connection because actual deployment facts are missing.
- **Application empty-state ownership restoration: completed and released**, following the explicitly authorized follow-up below. Existing `handoffStoppedExecutor` compared the old owner and record revision; the replacement owner's scoped `releaseExecutor` succeeded. A second ordinary claim/assert/drain/release also succeeded. No sessions or execution records required reconciliation.
- Only the authorized application ownership control record was transferred/released and ordinarily claimed/released. No transcript/session/attempt/checkpoint/accounting data writes, reference/S1 writes, direct sentinel deletion, inference, provisioning, app startup, `.env` edits, or profile changes. All ten indexes are unchanged.

## Authorization and environment

The approved [goal](goal.md) authorizes isolated generated database create/drop and conditional existing stopped-owner recovery. Operator testimony: this PC is the only executor host, and the previous backend is stopped. This is testimony, not proof of queued/hidden server work settlement.

Windows; Node `v24.18.0`; MongoDB Node driver `6.21.0`; stock JS MongoDBSaver `1.4.1`; Vitest `4.1.11`. Private `.env` values were loaded solely inside temporary Node process memory. Test credentials were inherited through the child's environment, never command arguments or evidence. No raw driver errors, URI, hostname, database name, owner ID, credentials or payload were emitted.

The generated fixture uses `retryWrites:false`, `w:'majority'`, `serverSelectionTimeoutMS:10000`, `connectTimeoutMS:10000`, `timeoutMS:15000`, and `maxIdleTimeMS:120000`. Its helper name `nativeDatabase` does **not** classify this Azure DocumentDB endpoint as native MongoDB.

## Actual checks

All commands ran from `backend/`; temporary scripts reside in `C:/Users/Peter/AppData/Local/Temp/opencode/`. The runner selects the existing `vitest.config.azure.ts`, the same configuration used by `npm run test:azure`; no new config or script command was needed.

| Command/check | Actual result |
| --- | --- |
| `npm test -- test/compatibility/intersection.spec.ts test/operations/recovery.spec.ts` | 2 files, 7 tests passed. Facts/index intersection and stopped-owner guard checks. |
| `node "C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-p2-probe-run.mjs" --facts-gate` | **Expected failure**, 1 file/1 discovered test: `Selected-service facts are required; Azure is not certified.` All selected-service inputs removed from child environment; no connection. |
| Same runner with `--gate` | **Expected failure**, 1 file/1 discovered test: `Authorized generated capability target is required.` Probe gate refuses before calling the connection helper. |
| `npm run build` | Passed; no production changes required. |
| `npm run lint` | Exit 0, existing upstream warnings remain. An initial new unsafe-finally warning was removed by retaining sanitized failure until cleanup completes; final run has no warning in the new probe. |
| Same runner without gate flags | **Passed**, 1 file/1 test; workload 12.30 s, total 13.39 s, starting 16:42:40 local (UTC+05:30). Exact generated target cleanup verified within this test. |
| `npm test -- test/compatibility/intersection.spec.ts test/operations/recovery.spec.ts test/persistence/records.spec.ts test/persistence/pagination.spec.ts` | Final focused check: 4 files, 13 tests passed; no skips; 1.02 s. |
| `git diff --check` | No whitespace errors; existing LF/CRLF conversion notices only. |

Vite emits its existing `vite-tsconfig-paths` deprecation warning. No full ordinary/backend e2e/service certification suite is claimed from these selected checks. No production storage implementation was changed: the negative gate and rejection assertions are probe checks of existing behavior, not a claimed production bugfix red/green cycle.

## Capability matrix — isolated synthetic collections only

All rows below are assertions actually reached in the passing probe:

| Capability | Evidence |
| --- | --- |
| Fresh isolated setup | Generated empty database; real persistence bundle creates six collections and required indexes. |
| Executor exclusion | Rival executor claim refuses with `UNSUPPORTED_TOPOLOGY`. |
| Database CAS | Concurrent acquire through **distinct** same-executor owner objects yields exactly one lease; not just the owner's local serialization queue. |
| Ordering/idempotency | Sequence reservation repeat returns same range; duplicate visible message remains one document; changed-content same-ID append refuses. |
| Durable acceptance | Confirmation refuses missing input/attempt, then succeeds twice without duplicate visible input. |
| Bounded memory/accounting | Fixture manifest and accounting persisted through real repositories. |
| Standard saver | Real setup, put, putWrites repeat, getTuple and bounded list; exact saved synthetic channel values, one pending write. No custom saver replacement. |
| Index policy | Eight app and two stock saver named index keys match; no non-`_id` unique or TTL index. |
| Record headroom | Each collection populated, at most 100 documents; observed BSON envelopes plus 256 bytes fit 1,800,000 bytes. This is **not** a maximum-document stress test. |
| Handoff/fencing | Wrong previous owner refuses; compare-old handoff succeeds; old executor refuses guarded work; recovered session generation increases and saved pending write survives. |
| Quiescent release | Release refuses owned session; accepted fixture attempt becomes interrupted, clears active attempt, releases session, drains, releases **own** executor; sentinel absence read back. |
| Durable reopen | New client/executor sees original single visible message, interrupted attempt, accounting, checkpoint values and pending write; fresh acquire and normal release succeed. |
| Cleanup | Generated database drop completes; fresh exact-name metadata query confirms absence; clients closed. No prefix-wide deletion/enumeration. |

Exposure was fixture-only: one synthetic session, accepted user message, attempt, manifest, accounting, checkpoint and pending write, plus bounded executor/ordering/acceptance controls. No historical chat data, model adapter or application factory was used. Tests cannot certify backup/PITR, HA, failover, transaction semantics, physical shards, every possible partition policy, maximum documents, or production readiness.

## Application read-only preflight and preservation

Temporary `aurvin-p2-recovery-preflight.mjs` uses existing compiled `loadConfig`, record schema/key helpers and index definitions without opening the application bundle or claiming ownership. Each query/command is finite and scoped to the configured Aurvin database or its six exact namespace metadata records; the reference/S1 database was not accessed.

| Observation | Actual result |
| --- | --- |
| Local app process/listener check, 11:11:29 UTC | Zero checkout-specific app processes; zero listeners 8001/5179. |
| Fresh empty-state guard, 11:13:42 and 11:14:38 UTC | All five data collections empty; metadata contains exactly one schema-valid executor. No session, attempt, message, manifest, accounting or checkpoint to reconcile. |
| Existing indexes | All ten required named keys match; no non-`_id` unique/TTL index. No index setup was performed on app data. |
| `listCollections` | Six exact collections, no reported shard/partition key. Absence is not an unsharded certificate. |
| Exact `config.collections` lookup | Zero records. Does not establish partition semantics. |
| Exact `config.chunks` lookup | Six selected-namespace placement records. This establishes metadata visibility, not a supported shard-key/partition guarantee. No unrelated namespace enumeration. |
| First read-only preflight | Failed at scoped operation observations; only a static secret-safe stage was emitted. Cause not established. No mutation or automatic retry of a write occurred. |
| Second read-only preflight | Completed; scoped `currentOp` counts **0** at 11:14:41.357 and 11:14:58.780 UTC, 15-second observation gap, 10-second command maximum. |
| Final local check, 11:15:36 UTC | Zero Aurvin app processes, zero listeners 8001/5179, zero other checkout Node/cmd tool processes. Earlier parallel tool checks counted test/lint processes; these were not app executors. |

At this initial preflight stage, no app runtime, model catalogue GET, inference, handoff/release or second app claim was executed, and the old sentinel remained intact. Its initially blocked outcome was superseded by the authorized, bounded empty-state maintenance below; it was not bypassed with an all-true proof file.

## Follow-up: bounded empty-state maintenance completed

The user clarified that safe operational restoration of this **empty** database is distinct from full Azure topology/tier certification, and explicitly instructed proceeding through the existing conditional handoff if real bounded safety observations supported it. This narrows the initial blanket partition/settlement blocker, without weakening production admission or changing source guards.

### Concrete stale-I/O risk and the evidence used

A killed client can leave an already-submitted server command executing; a client-side timeout/socket close does not prove cancellation. The initial `ns`-only operation filter could also miss command operations that expose the target database only through `command.$db`. A pending old upsert or index command was a concrete concern, not a reason to demand indefinite universal proof.

The final temporary procedure uses a server-side `currentOp` `$or` matching:

- `ns` beginning the regex-escaped exact application database followed by `.` (including its `$cmd` namespace);
- `command.$db`, `originatingCommand.$db`, or `query.$db` equal to that exact database.

Its runnable self-check verifies regex escaping, exact database boundary, `$cmd` matching and all three database command fields. It also verifies refusal for each nonempty data collection, extra/missing metadata, active operations, changed sentinel owner/revision, and changed indexes. The checks passed without loading private settings or connecting.

The application `RecordStore` uses server `maxTimeMS` equal to the actual configured **15,000 ms** persistence budget. A conservative **120,000 ms** interval additionally covers DocumentDB's documented default query execution window for stock-saver queries without their own server maximum. This is not claimed as a universal bound on every background service operation or index build. Stable completed index metadata, unchanged sentinel and repeated zero operation observations supplement the interval. A ten-minute idle cursor lifetime is not pending write execution, and there are no graph/session/attempt records needing recovery.

Stopped-process operator testimony, fresh local checks, empty durable state, the widened scoped operation visibility, unchanged owner/revision and unchanged indexes across the window jointly establish bounded settlement for **this empty-state control-record operation**. There was no observed remaining active operation or ambiguous mutation to resolve. Time passage alone was not treated as cancellation.

### Partition relevance and safety boundary

The maintenance does not insert application messages, repartition collections, set up indexes, or construct a runtime/checkpointer. It uses the existing sole metadata record's `_id`, fixed system scope, old owner and revision in the existing atomic replacement, then only the replacement owner's conditional release. The application metadata `_id_` key and all required compound index keys are present. The actual-service isolated probe already demonstrated this same executor CAS/fencing/release algorithm.

No broad claim that the six app collections are unsharded/equivalent is needed to transfer this single existing control record. The successful actual handoff reread confirms the new owner and exact revision increment on the application collection itself. Unknown partition/tier/backup facts still prevent full admission/certification; they were not manufactured or silently resolved by this maintenance.

### Actual final procedure and observations

Command, from `backend/`:

```powershell
node "C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-p2-empty-recovery.mjs" --self-test
npm test -- test/compatibility/intersection.spec.ts test/operations/recovery.spec.ts
node "C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-p2-empty-recovery.mjs" --recover
```

Self-check passed; repeated deterministic tests: 2 files/7 tests passed, no skips. Maintenance ran **once**, completed normally with client closure, approximately 140 seconds including the explicit 120-second observation window. No local-deadline process kill or ambiguous CAS retry was used.

| UTC time, 2026-10-07 | Actual result |
| --- | --- |
| 11:19:03.992 | Local stopped guard: no other Node process, checkout app command or listener on 8001/5179. Only this maintenance process was excluded. |
| 11:19:15.342 | First widened operation check zero; data counts `[0,0,0,0,0]`; exactly one valid executor; required indexes match. |
| 11:21:17.617 | After 120-second window: widened operation check zero; same empty counts, exact sentinel owner/revision/document and index metadata unchanged. |
| 11:21:18.753 | Immediate pre-handoff local guard again zero. |
| 11:21:22.426 | Final pre-CAS snapshot: widened operation check zero; exact sentinel, empty collections and indexes still unchanged. |
| By 11:21:24.137 | Existing compare-old handoff succeeded; `assertExecutor` and reread verified new owner and old revision + 1. No data work existed; owner drain and owner-conditional release succeeded, metadata count zero. |
| By 11:21:24.137 | Second fresh `MongoOwnership.claimExecutor`/assert/drain/release succeeded; final metadata count zero, all five data counts zero, all index metadata value-equivalent to the initial snapshot. |
| 11:21:24.137 | Final local guard still zero. No app runtime/backend started, no inference, profile unchanged. |

No direct collection deletion was invoked by the procedure; only the existing scoped `releaseExecutor` implementation released its **own** quiescent sentinel. The former owner's record was first transferred by conditional CAS, never blindly deleted. An unknown handoff/release result or any newly discovered data/operations would have stopped the procedure without retry/startup.

## Remaining gates

- **Ownership maintenance blocker: cleared.** No stale executor sentinel remains; normal second claim/release was actually proved. No historical data existed to reconcile or discard.
- **Full service admission/certification remains unresolved:** actual tier, physical shard/partition policy, consistency, backup/PITR/HA and enabled capabilities. The unchanged `AURVIN_AZURE_TEST_FACTS_JSON` parser/full-suite contract remains fail-closed; no invented facts or admission/profile edits.
- **Startup/liveness/archive/proxy verification:** not performed by P2; P1/orchestrator own those next steps. Ownership restoration alone does not authorize generation admission or constitute Azure/native certification.

Primary references remain the approved [plan](plan2.md) and [research](research.md). Current Microsoft [partitioning guidance](https://learn.microsoft.com/en-us/azure/documentdb/partitioning) confirms that sharded/unsharded collections coexist and collection placement is separate from physical shard count. Context7 MongoDB driver documentation was consulted for timeout/command semantics: a client timeout is not conclusive nonexecution. No documentation statement was substituted for deployment evidence.

## P2 owned files for orchestrator

- `backend/test/compatibility/persistence-probe.azure.spec.ts`
- `docs/backend-startup-fix/p2-evidence.md`

Temporary, **do not commit**: `aurvin-p2-probe-run.mjs`, `aurvin-p2-recovery-preflight.mjs`, and `aurvin-p2-empty-recovery.mjs` in the approved temp directory. None contains credentials. P1 launcher/startup/README files and shared workflow status were not edited by P2. No files staged or committed.
