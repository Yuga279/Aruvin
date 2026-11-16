# Backend startup failure investigation

Date: 7 October 2026. Assignment: diagnosis only; no implementation, environment edits, executor handoff, or ownership changes. Unified review remains **skipped**.

## Finding

The current configured database contains a valid executor sentinel. A new backend executor cannot claim this database: the existing sentinel belongs to a different executor, so startup rejects with `UNSUPPORTED_TOPOLOGY` before opening the HTTP listener. The generic entry-point error hides this actionable reason. This is an ownership admission refusal, not a TypeScript compilation error, launcher delay, invalid fixed asset, or Nest dependency-injection failure.

The original screenshot's raw exception was not retained, and the actual mutating bootstrap was deliberately not rerun. The finding is supported by current read-only database evidence and an in-memory replay of the real ownership/storage/Nest initialization path. Whether the existing owner is active, safely stopped, or left by an unsafe exit is **not established**.

## Safe evidence

All local diagnostics ran in disposable Node child processes from `backend/`, using existing compiled modules. Environment loading occurred only inside those children. No secret settings, database names/addresses, owner identifiers, user data, raw exception messages, or stacks were printed.

| Check | Actual result |
| --- | --- |
| Load `.env` after setting launcher port/origin in child | Configuration validation passed; both launcher values remained effective. URI, API key, and model were present; profile was `unknown`. |
| Load actual instruction and knowledge files with `loadFixedAssets` | Passed. |
| `NestFactory.create(AppModule)` with `AppService.create` patched only in child to use a persistence port throwing `NOT_READY` and a forbidden network port | Passed; `configureApplication` and `app.init` passed. One fake persistence open, zero provider calls. |
| Read-only Mongo diagnostic | Connected; `hello` reported sharded topology. A `findOne` of the executor sentinel found a schema-valid record with an owner. No writes, index setup, checkpointer setup, or ownership claim. |
| In-memory existing-owner fixture using real `RecordStore.insert` and `MongoOwnership.claimExecutor`, then real `AppService.create`/`NestFactory.create` | Reproduced startup rejection with `UNSUPPORTED_TOPOLOGY`. One simulated update of an in-memory fixture; zero actual database writes or network calls. |
| `npm run test:e2e -- test/app.e2e-spec.ts` | 1 test file, 3 tests passed; diagnostic application routes work without real persistence/provider access. |

The read-only Mongo diagnostic was necessary only after configuration, assets, and dependency injection passed. It performed `hello` and a narrowly scoped sentinel lookup, then closed its client. It did not read chat/session payloads.

## Causal path

1. [`backend/src/main.ts`](../../backend/src/main.ts) loads private environment values and calls `NestFactory.create` with `logger: false` and `abortOnError: false`.
2. [`backend/src/app.module.ts`](../../backend/src/app.module.ts) builds `AppService` through the async assembly factory.
3. [`backend/src/app.service.ts`](../../backend/src/app.service.ts) validates the origin, loads fixed assets, then opens persistence because the URI is nonempty.
4. [`backend/src/persistence/persistence.ts`](../../backend/src/persistence/persistence.ts) connects and calls `createPersistenceBundle`, whose first operation is `owner.claimExecutor()`.
5. [`backend/src/persistence/store.ts`](../../backend/src/persistence/store.ts) uses `$setOnInsert` and rereads the sentinel. An existing record is unchanged; its owner differs from the new executor ID, producing `IDEMPOTENCY_PAYLOAD_MISMATCH`.
6. [`backend/src/persistence/ownership.ts`](../../backend/src/persistence/ownership.ts) maps that mismatch to `UNSUPPORTED_TOPOLOGY` (“Another executor owns this database”).
7. `AppService.initialize` intentionally rethrows `UNSUPPORTED_TOPOLOGY` instead of treating it as ordinary diagnostic degradation. Nest initialization rejects, and `main.ts`'s entry catch emits only “Aurvin startup failed; check configuration and dependencies.” The listener is never opened.

Successful watch compilation does not establish successful application startup. The watch supervisor can remain alive after its application child fails.

## Separate observations, not the immediate failure

- The launcher-provided origin overrides the `.env` origin in the tested child. Their hostname difference therefore does not explain this startup failure.
- `PERSISTENCE_PROFILE=unknown` passes configuration validation. Despite `openPersistence`'s native-only description, its current implementation does not reject this profile before connecting/claiming. Do not change the profile label as a supposed fix or evidence of certification.
- The observed service reports **sharded**, not the repository's admitted native replica-set topology. Actual service identity/capabilities remain unverified. Resolving ownership alone does not establish chat readiness or authorize admitting this deployment.
- Ordinary persistence connection errors would degrade to liveness rather than produce this hard failure. The existing-owner guard is deliberately different.

## Minimal recommendation

1. Preserve the ownership refusal. Do not delete the sentinel, automatically take over on expiry, suppress the guard, or launch the real application against this database to test a guess.
2. Make startup diagnostics actionable using a small static allowlist: surface a safe startup stage/code and an ownership-specific operator instruction, without serializing errors, causes, config, messages, or stacks. Preserve known application codes through any bootstrap wrapping; `NestFactory.create` currently rejects before the inner startup `try`, while later failures are replaced by a generic error.
3. To restore this database's use, first establish the previous executor/work is conclusively stopped and obtain operator authorization for the documented maintenance handoff/reconciliation. Follow [`docs/aurvin-phase-1/operations.md`](../aurvin-phase-1/operations.md), steps 4–7; do not treat missing local listeners as proof that no other executor owns the remote database. This investigation does not authorize that handoff.
4. Resolve actual persistence-service/topology compatibility before admitting chat. Do not auto-switch databases or profiles.

## Regression approach for the implementation owner

- Add a deterministic startup test for the existing-owner path: use actual application assembly with a fake persistence port throwing `AppError('UNSUPPORTED_TOPOLOGY', ...)`; require a safe, ownership-specific diagnostic and unsuccessful startup.
- Include a raw error with credential-looking content and assert none reaches output; verify unknown errors use only a static fallback.
- Keep a sibling `NOT_READY` case proving diagnostic liveness still starts, rather than making every persistence failure fatal.
- If exercising `bootstrap` directly, do so in an isolated child with persistence/provider ports disabled before calling it; never load the configured database through real assembly.
- Reuse the existing diagnostic e2e suite and the parent's launcher tests. No paid/provider checks or native database fixture tests are needed for the diagnostic change.

## Scope preservation

No code was changed. Existing uncommitted `run.bat` and `backend/test/operations/launcher.spec.ts` were preserved. Only this research document is assigned for commit. No parent plans were read. No real backend was started, no Mongo sentinel was modified, and no deployment/profile/ownership compatibility was certified.

## Follow-up: authorized local-instance closure and service identity

The user authorized closing **local Aurvin backend/frontend instances only**. Diagnosis continued without implementation authorization, database writes, ownership handoff, or admission changes.

### Local closure evidence

- Enumerated `Win32_Process` records, command lines, and parent relationships for checkout-specific backend Nest, frontend Vite, and `run.bat` processes: **no matches**.
- Independently enumerated every `node.exe`/`cmd.exe`: **no Node processes** and one command window. Its verified command line was the unrelated automatic-review runner's startup script, with a service ancestor; it was preserved.
- Queried listening TCP endpoints: **no listeners on 8001 or 5179**.
- Therefore no Aurvin target remained to signal or terminate. No Ctrl-C broadcast, broad Node termination, or process kill was performed. This establishes the current local process/listener state, not how the earlier application exited or whether its remote recorded owner/work is conclusively stopped.

### Nonsensitive service evidence

A second disposable child loaded private settings in memory, classified only the endpoint **family**, and issued read-only `hello`/`buildInfo` commands. It printed no hostname, URI, credentials, database name, owner identifier, or full server response.

| Fact | Observed |
| --- | --- |
| Endpoint product family | Azure DocumentDB / former Azure Cosmos DB for MongoDB vCore |
| Reported protocol-compatible version | `8.0.0` |
| Topology response | Sharded (`isdbgrid`), no advertised replica-set name |
| Logical session timeout advertised | Yes |
| Wire protocol bounds | Minimum `0`, maximum `25` |
| `buildInfo` availability | Yes |
| Actual database writes | Zero |

Primary Microsoft documentation resolves the endpoint-family ambiguity:

- [Azure DocumentDB Node.js quickstart](https://learn.microsoft.com/en-us/azure/documentdb/quickstart-nodejs) documents the observed endpoint family and version 8.0 configuration.
- [Azure DocumentDB FAQ](https://learn.microsoft.com/en-us/azure/documentdb/faq) explicitly states the service was previously called Azure Cosmos DB for MongoDB (vCore).
- [Azure DocumentDB overview](https://learn.microsoft.com/en-us/azure/documentdb/overview) explicitly states it does **not** run the MongoDB server or codebase. Reporting version `8.0.0` does not establish native MongoDB semantics.
- [Feature compatibility](https://learn.microsoft.com/en-us/azure/documentdb/compatibility-features) and [service limits](https://learn.microsoft.com/en-us/azure/documentdb/limitations) describe engine-specific restrictions and tier-dependent operations. These are research references, not executed capability checks.

The endpoint and responses support **Azure DocumentDB**, not Cosmos MongoDB RU or native MongoDB. No control-plane resource/tier confirmation, enabled-capability inventory, isolated write/index/checkpointer tests, or complete compatibility certification was performed. A protocol/sharded response does not establish physical shard count or service tier. The original compatibility blocker is narrowed to a product family, **not closed**.

### Root cause and remaining blockers

The immediate current failure remains the existing-owner sentinel refusal reproduced offline above. Stopping local consoles does not release a durable sentinel after an already failed/unsafe application exit, and absence of local processes cannot prove cessation of an executor on another machine or outstanding remote work. No claim that the old owner is stale/safely stopped is justified yet.

Before any real restart or handoff, establish recorded-owner provenance, conclusive stopped/work-settled evidence, operator authorization, and Azure DocumentDB compatibility for the actual service/tier. Do not run `openPersistence`, change profiles, delete/replace the sentinel, or test compatibility by mutating the application database.

### Minimum proposed code change (not implemented)

- **One production file:** `backend/src/main.ts`. Retain `UNSUPPORTED_TOPOLOGY` through bootstrap cleanup, and map it to a static ownership-specific startup instruction. Keep unknown errors generic; do not expose raw error messages, stacks, causes, environment, or config. Preserve failed startup, client/application cleanup, and the existing ownership guard.
- **One regression file:** `backend/test/operations/bootstrap.spec.ts` (suggested new file). Exercise the diagnostic/code-preservation boundary with deterministic ports: ownership refusal yields a safe known code/instruction; credential-looking unknown errors never leak; configure/listen failures close the app and preserve the original known error; ordinary `NOT_READY` still permits diagnostic liveness.
- Reuse the already-passing `backend/test/app.e2e-spec.ts` and the parent's existing launcher regression; no persistence implementation changes or new dependency are needed for this narrow diagnostic correction.

The diagnostic fix explains the failure; it does **not** make an unverified/owned database ready. Cleanup must never release another executor's sentinel. No creative scope, reviewer, recursive MAW orchestration, or code implementation was introduced during this follow-up.

## Follow-up: working Cosmos connection comparison and concrete failure boundary

The user requested concrete compatibility/correction work without brainstorming and identified a working sibling project. This assignment remains research-only. Read-only reference inspection identified `D:/Peter/S1/S1-SEVI/S1.BOT/app/db.py`; `D:/Peter/S1/system1` is a SQL Server/.NET solution, not the relevant Mongo connection implementation. Reference instructions were read. No sibling files were changed, and private environment files were parsed only in child-process memory.

### Connection comparison

- Aurvin and S1.BOT point to the **same deployment endpoint**, with **different databases**. No endpoint/database identifiers or credentials were emitted.
- Their parsed URI options match: TLS enabled, retryable writes disabled, 120-second maximum idle time, no explicit replica-set option, no `appName`, no explicitly selected SCRAM-SHA-256 mechanism. They use non-SRV URIs. Successful read-only connection already establishes that authentication/TLS negotiation works.
- Reference code uses PyMongo `>=4.12,<4.18`, a 5-second selection timeout, and Python `MongoDBSaver` `>=0.5,<0.6`. Aurvin's installed Node driver is `6.21.0`, JS saver `1.4.1`, and Nest CLI `12.0.8`.
- S1.BOT's saver creates **unique** checkpoint/pending-write compound indexes and 24-hour TTL indexes. Aurvin's installed JS saver creates **non-unique**, named compound indexes and no TTL. Do not copy reference retention/uniqueness policies into Aurvin or mix the databases.
- **No connection-option patch is supported by this comparison.** User terminology “Cosmos DB” is consistent with the service's previous vCore name; no RU-specific restrictions should be applied merely because of that name.

### Actual read-only collection/index evidence

Inspected only collection/index metadata and record-existence flags, not chat/checkpoint contents. In Aurvin, all six collections exist, all eight required application indexes and both stock JS saver indexes match their required names/keys, and there are no non-`_id` unique indexes or TTL indexes. `sessions`, `messages`, `agent-memory`, `checkpoints`, and `checkpoint_writes` contain no records. `metadata` contains the already observed executor sentinel; its owner owns **no session**.

In the separate reference database, the four expected collections exist. Checkpoint and pending-write collections contain records and the expected unique/TTL index categories. This supports a working persistence precedent on the same service; it is not proof of every JS saver operation or Aurvin's reliability contract.

`listCollections` did not report shard-key or collation options. **Absence of a reported shard key is not proof that collections are physically unsharded.** `isdbgrid` is an API/router response, not a failing operation or a reliable physical shard/tier count. The service label alone is not a compatibility failure. No actual connection, metadata lookup, collection listing, or index listing failed. Existing required indexes demonstrate that creation of those index definitions has occurred successfully at some point.

### Confirmed Windows watch lifecycle defect

The current launcher invokes `npm run start:dev` → `nest start --watch`. In the installed CLI's `actions/start.action.js`, recompilation calls `treeKillSync` before spawning a replacement application. Its Windows implementation, `lib/utils/tree-kill.js`, calls `taskkill /pid <application PID> /T /F`. That bypasses asynchronous shutdown and executor release. Child spawning uses inherited stdio with **no IPC channel**, so Aurvin's `process.on('message', ... 'shutdown')` cannot protect this watch-reload path.

A disposable, database-free child with a registered SIGINT cleanup marker was terminated using that exact installed CLI helper. Result: fixture reached ready, cleanup marker **did not run**, child exited; zero database writes/network calls, only the owned diagnostic child terminated. This confirms the actual termination behavior, not merely a source suspicion. No real Aurvin/reference application or unrelated process was killed.

This is a proven mechanism that leaves an otherwise valid owner sentinel across Windows watch recompilation; the precise historical event that created this sentinel remains unrecorded. Ordinary Ctrl-C/process exits during incomplete startup can also precede `main.ts`'s late shutdown-hook installation. Do not claim the screenshot proves which preceding event occurred.

### Startup cleanup/readiness findings

- `createPersistenceBundle` claims first, then sets up app/saver indexes. On ordinary setup failure it attempts `releaseExecutor`; `openPersistence` closes its client. A failed index setup does **not normally** retain a sentinel.
- An offline fixture exercised the real bundle/ownership/storage/saver setup path: normal setup issued ten simulated index calls; forced first-index failure returned `NOT_READY`. Both paths released their own sentinel, with zero actual network/database activity. Only interrupted/failed cleanup could leave ownership in that scenario.
- Once persistence is open, model-limit failure intentionally leaves diagnostic liveness/archive reads and ownership active until shutdown; it does not itself throw startup failure. Runtime construction failure invokes operations shutdown. Configure/listen failures call `app.close`; creation errors occur before the inner startup cleanup block.
- `OperationsService` stops admission, drains work, and closes owned persistence only when safe; unsafe drains retain ownership by design. Preserve that policy.
- Current config/readiness code does not reject `unknown` merely by profile nor require `hello.setName`. No native-replica-set transaction operation exists in the persistence implementation. Therefore changing a topology label is not a demonstrated runtime fix.

### Minimum corrective work and evidence gates

1. **Prevent recurring sentinel leaks:** change only the parent-owned `run.bat` backend path to build once and run compiled `node --enable-source-maps dist/main.js` directly, while retaining its existing liveness gate. Do not use Nest's forced Windows watch-restart for the admitted persistent executor. Update the existing `backend/test/operations/launcher.spec.ts` to require the direct launch/build path. No dependency patch, custom checkpointer, or new supervisor is required. Document explicit stop/build/restart in `README.md`.
2. **Explain failures safely:** the previously proposed `backend/src/main.ts` diagnostic/code-preservation change plus one focused startup regression file remains appropriate. Retain all ownership and unsafe-shutdown guards.
3. **Restore ownership only through authorized maintenance:** the user now states this PC is the only executor host and the previous backend stopped. Together with local absence and empty session/checkpoint collections, this strengthens stopped-owner evidence. Record this as operator testimony plus read-only facts, not a machine-derived proof of every outstanding remote request. Before any handoff, establish remaining in-flight-I/O settlement and authorization; use the existing owner-conditional handoff/reconciliation procedure, not deletion or automatic stale takeover.
4. **Verify actual compatibility, then label accurately:** no storage algorithm/driver-option change is yet justified. Use the existing `backend/test/compatibility/persistence.azure.spec.ts` with an explicitly authorized, precreated **isolated** `aurvin_p2_azure_test_...` database and actual service facts. It exercises acceptance/idempotency, CAS ownership/order, all six collections, standard saver put/get/pending writes, and index/BSON invariants. Add only missing targeted failure/concurrency/clean-release/reopen coverage after inspecting existing suites. Never point it at the Aurvin or reference databases; it writes and requires authorization. Keep providers deterministic.
5. Service family/version evidence is now strong; actual tier, consistency/backup mode, collection partition configuration, and enabled capabilities still require operator/control-plane facts. Primary Azure DocumentDB documentation supports the general operations and a 16-MB document limit, but that does not replace isolated capability evidence or certify the actual deployment. After the required tests, select the accurate `azure-documentdb` profile and update admitted-service documentation/evidence; changing that label alone fixes nothing.

No brainstorming/reviewer/MAW recursion was added. No real backend restarted, no paid request occurred, no app/reference database was modified, and no code or environment change was made. Parent `run.bat`, launcher tests, and any goal/state edits remain outside this researcher's commit.
