# Isolated service verification and stopped-owner recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Harness adaptation: load the available `executing-plans` skill; this is an assigned P2 worker, not permission to spawn children or run recursive MAW. Unified review is **skipped**. The orchestrator serializes commits; do not commit this plan or worker changes independently.

**Goal:** Verify the actual Azure service primitives in one generated isolated database, then conditionally recover the stopped application owner without deleting records or repeating inference.

**Architecture:** Preserve the existing fail-closed full-service-facts suite. Add one explicitly non-certifying capability probe selected through the existing `test:azure` command, reusing existing persistence fixtures and ownership/checkpointer primitives rather than application factory mocking. Application recovery is a separate operator operation gated by passed capability evidence, stopped/settled-owner proof, and actual application-collection compatibility; service-profile admission and serving remain separate gates.

**Tech Stack:** Node 24, TypeScript ESM/NodeNext, MongoDB driver 6.21.0, stock JavaScript MongoDBSaver 1.4.1, Vitest, Azure DocumentDB MongoDB-compatible API.

---

## Ownership and file map

| File | Action / responsibility |
| --- | --- |
| `backend/test/compatibility/persistence-probe.azure.spec.ts` | New bounded actual-service probe; one generated database, synthetic records, no model/network-provider calls, no application factory seam. |
| `backend/test/compatibility/persistence.azure.spec.ts` | Read/reuse reference workload; **retain** full facts gate and existing precreated-target contract. |
| `backend/test/compatibility/service-facts.ts` | Read only; do not invent facts, weaken parser, or make missing facts a green skip. |
| `backend/test/persistence/native.ts`, `fixtures.ts` | Reuse generated namespace/client options/fixture records. A reused helper named `nativeDatabase` does not certify this Azure target as native. |
| `backend/src/persistence/{ownership,store,indexes,checkpoints,persistence}.ts` | Existing primitives; no production edits without a demonstrated failing operation and focused regression. |
| `backend/src/operations/recovery.ts` | Existing stopped-owner and bounded reconciliation boundary; no automatic takeover or HTTP maintenance route. |
| `docs/backend-startup-fix/p2-evidence.md` | Worker-owned actual results, commands, environment, capability matrix, cleanup and recovery/admission outcomes. |
| `C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-p2-probe-run.mjs` | Temporary private-environment loader/child launcher; never commit credentials or environment snapshots. |
| `C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-p2-empty-recovery.mjs` | Conditional temporary operator script for the verified-empty case only; no framework/factory abstraction. |

Do not edit `.env`, switch databases/profiles, touch S1 data, modify startup/launcher code owned by P1, provision resources, install Azure CLI, or start the real backend during probe execution. Stage only named owned files when the orchestrator requests a commit.

## Facts established while planning (2026-10-07)

Goal/research authorization supersedes the research document's earlier diagnosis-only gate: generated isolated create/drop and existing stopped-owner recovery are approved. Only this PC is an executor host and the previous backend is stopped, by explicit operator testimony. This testimony is distinct from proof of outstanding server work settlement.

Previously recorded read-only evidence: endpoint family Azure DocumentDB/former MongoDB vCore, protocol version `8.0.0`, `hello.isdbgrid`; six application collections and eight application plus two saver indexes exist; all data collections empty and metadata contains an executor sentinel with no owned session. Same deployment as S1-SEVI, different database. These are not new write-suite results.

Additional **read-only** planner checks loaded private `.env` solely in disposable child memory, used compiled `loadConfig`, and closed MongoClient. No URI, hostname, database name, owner ID, credentials, payload or raw error was emitted:

| Check | Actual result / limit |
| --- | --- |
| `listCollections` with options | Six collections; no reported `shardKey`/`partitionKey`. Absence is not an unsharded certificate. |
| `getShardMap` | Supported; top-level fields `map`, `hosts`, `nodes`, `ok`. No tier or physical topology inferred from this response. |
| `currentOp` filtered to escaped application namespace | Supported; zero returned operations at that instant. Not proof that no queued/hidden/server operation exists. |
| `config.collections` query with `_id: {$in: <six application namespaces>}`, projected key/dropped only, limit seven | Supported; zero records. Partition facts remain unknown. No S1 namespace enumeration or data access. |
| `Get-Command az` | Azure CLI unavailable. No installation/login/provisioning attempted. |

Actual tier, physical shard count, collection partition configuration, backup/PITR/HA, consistency and enabled capabilities remain **unknown**. Do not infer M10/M25/Free from hostname, `isdbgrid`, version, or a sibling application's successful connection. No application writes or isolated writes were performed by this planner.

### Primary documentation consulted

Context7 resolution/query used `/websites/learn_microsoft_en-us_azure`, `/microsoftdocs/azure-docs`, `/mongodb/node-mongodb-native`, and LangGraph.js documentation. Azure search mixed RU and DocumentDB results; only the following product-specific primary pages support service statements:

- [DocumentDB compatibility](https://learn.microsoft.com/en-us/azure/documentdb/compatibility-features): MongoDB wire protocol implementation; managed/restricted administration, session and monitoring commands. A successful command must still be exercised on this deployment.
- [DocumentDB limits](https://learn.microsoft.com/en-us/azure/documentdb/limitations): 16 MB BSON documents; default query limit 120 seconds, overridable per query; one simultaneous index build per collection; tier-dependent backup/HA/features. Free-tier backup unsupported; M10/M20/M25 are one-physical-shard dev/test tiers. None establishes the actual tier here.
- [DocumentDB partitioning](https://learn.microsoft.com/en-us/azure/documentdb/partitioning): sharded and unsharded collections coexist; physical shards and collection shard keys are separate facts; placement metadata is in `config` collections. Do not run the page's shard/move/rebalance commands or enumerate unrelated namespaces.
- [Scale configuration](https://learn.microsoft.com/en-us/azure/documentdb/how-to-scale-cluster): actual ARM compute configuration uses `properties.compute.tier`; resource type `Microsoft.DocumentDB/mongoClusters`, API example `2025-09-01`. Use **GET only** on an operator-selected resource if already-authorized read-only control-plane access exists; never copy the page's PATCH/update examples.
- Installed authoritative saver source: `backend/node_modules/@langchain/langgraph-checkpoint-mongodb/dist/checkpoint.js:56-74`; setup creates two ordinary, non-unique named compound indexes, returns settled errors, no TTL unless requested. Verify stock semantics, not the sibling Python saver policies.

Driver timeout errors mean an operation did not complete within the client budget, not conclusive cancellation or durable nonexecution. Do not promote a fulfilled timeout wrapper, socket close, or elapsed wait into `inFlightIoSettled` proof.

## Gate decisions

1. Full certification suite currently cannot honestly run: `parseServiceFacts` requires profile/API/tier/consistency/backup/document limit/capabilities/six partitions. Its string fields could syntactically accept placeholder strings; that is **not** permission to supply `unknown` or fictional facts. The real variable is `AURVIN_AZURE_TEST_FACTS_JSON`, not `AURVIN_AZURE_FACTS`.
2. Its target must be precreated and begin `aurvin_p2_azure_test_`; current authorization requires generated `aurvin_p2_test_` databases. Do not change that suite's existing contract just to green it. Select the new generated capability probe using the **same existing** `npm run test:azure` configuration.
3. Probe pass proves only the operations listed below on newly created test collections on this endpoint. It does not validate every possible partition policy on application collections, native replica-set admission, backup/restore, HA, failover, production readiness or complete Azure certification.
4. Application maintenance can proceed only after the minimum CAS/fencing/release/checkpointer operations pass **and** the operator establishes application-collection equivalence/supported partition configuration and old-owner I/O settlement. If unavailable, stop before handoff and report the blocker. Tier/backup unknowns independently block profile admission and serving; never edit the profile to evade this distinction.

## Task 1: Record prerequisites and prove missing facts stay blocked

**Files:** read existing compatibility files; create `docs/backend-startup-fix/p2-evidence.md`.

- [ ] Recheck worktree status and checkout-specific process/listener absence. Record operator testimony and timestamps, not owner IDs or command lines containing settings. Do not terminate broad Node/process groups.
- [ ] Reuse supplied control-plane/operator facts if any. Obtain actual tier/API/partition/backup/HA/consistency through already-authorized portal/GET evidence; absence means unknown, not a request to provision or install tools. Inspect only the selected Aurvin deployment/collections.
- [ ] Run the deterministic existing facts/index intersection and recovery guard tests from `backend/`:

```powershell
npm test -- test/compatibility/intersection.spec.ts test/operations/recovery.spec.ts
```

Expected: discovered tests pass; incompatible partitions/missing facts and false stopped proof rejected. Save actual counts; no database required.

- [ ] With all `AURVIN_AZURE_TEST_*` inputs removed from a disposable child's environment, run:

```powershell
npm run test:azure -- test/compatibility/persistence.azure.spec.ts
```

Expected: one discovered test **fails** with `Selected-service facts are required; Azure is not certified.` No connection occurs because facts are parsed first. Record this as expected gate evidence, never a passing compatibility suite. Do not run the general suite with real invented facts.

## Task 2: Add one generated, non-certifying actual-service probe

**Create/test:** `backend/test/compatibility/persistence-probe.azure.spec.ts`.

- [ ] Add the complete test below. It is a probe addition, not a production storage fix; no failing production case has yet been established. First run it without authorized target settings to prove its gate refuses before connection.

```typescript
/**
 * ============================================================================
 * FILE: persistence-probe.azure.spec.ts
 * LOCATION: backend/test/compatibility/persistence-probe.azure.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Exercise bounded Azure storage primitives without claiming certification.
 * ROLE IN PROJECT:
 *    Uses one generated isolated database and real stock storage/checkpointer.
 *    Leaves full deployment-facts admission and application recovery separate.
 * KEY COMPONENTS:
 *    - Authorization gate and generated-only cleanup.
 *    - CAS, acceptance, saver, handoff, fencing, release and durable reopen checks.
 * ============================================================================
 */
import { emptyCheckpoint } from '@langchain/langgraph-checkpoint';
import { BSON } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/index.js';
import { APP_INDEXES } from '../../src/persistence/indexes.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { graphThreadId, key } from '../../src/persistence/records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { hashPayload } from '../../src/platform/crypto/hash-payload.js';
import { accounting, attempt, manifest, message, session } from '../persistence/fixtures.js';
import { nativeDatabase } from '../persistence/native.js';

it('probes generated Azure primitives only — not deployment certification', async () => {
  if (process.env.AURVIN_AZURE_TEST_AUTHORIZED !== 'yes' ||
      process.env.AURVIN_TEST_DB_PREFIX !== 'aurvin_p2_test_' ||
      !process.env.AURVIN_TEST_MONGODB_URI) {
    throw new Error('Authorized generated capability target is required.');
  }
  const h = await nativeDatabase();
  let stage = 'empty target';
  try {
    expect(await h.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0);
    stage = 'bundle setup';
    const first = await createPersistenceBundle(h.client, h.name, DEFAULT_BUDGETS, 'probe-a');
    const store = new RecordStore(h.db, DEFAULT_BUDGETS.persistenceTimeoutMs);
    const rival = new MongoOwnership(store, 'probe-b');
    await expect(rival.claimExecutor()).rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
    await first.sessions.createIfAbsent(session());
    // Separate owner objects bypass the in-object queue: this exercises database CAS.
    stage = 'atomic session ownership';
    const peer = new MongoOwnership(store, 'probe-a');
    const input = { userId: 'u1', sessionId: 's1', ownerId: 'probe-a', leaseMs: 180_000 };
    const races = await Promise.all([first.owner.acquire(input), peer.acquire(input)]);
    expect(races.filter(row => row.ok)).toHaveLength(1);
    const won = races.find(row => row.ok);
    if (!won?.ok) throw new Error('Expected one lease.');
    const lease = won.lease;
    stage = 'acceptance and idempotency';
    const reservation = await first.owner.allocateSequences(lease, 'probe-order', 3);
    expect(await first.owner.allocateSequences(lease, 'probe-order', 3)).toEqual(reservation);
    await first.owner.reserveAttempt(lease, 'a1');
    await expect(first.owner.confirmAcceptance(lease, 'a1')).rejects.toMatchObject({ code: 'NOT_READY' });
    const accepted = { ...attempt(), payloadHash: hashPayload(message().content) };
    await first.owner.run(lease, async () => {
      await first.messages.append(message());
      await first.messages.append(message());
      await expect(first.messages.append({ ...message(), content: 'different' }))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
      await first.metadata.putAttempt(accepted);
      await first.memory.put(manifest());
      await first.metadata.putAccounting(accounting());
    });
    await first.owner.confirmAcceptance(lease, 'a1');
    await first.owner.confirmAcceptance(lease, 'a1');
    expect((await first.metadata.getAcceptance('u1', 's1', 'a1'))?.userMessageId).toBe('m0');
    expect(await h.db.collection('messages').countDocuments({ userId: 'u1', sessionId: 's1' })).toBe(1);
    stage = 'stock saver';
    const handle = await first.checkpoints.create();
    await handle.setup();
    const saver = handle.bind(lease);
    const checkpoint = emptyCheckpoint();
    checkpoint.channel_values = { result: { text: 'synthetic', attemptId: 'a1' } };
    const config = { configurable: { thread_id: graphThreadId('u1', 's1'), checkpoint_ns: '' } };
    const saved = await saver.put(config, checkpoint, { source: 'update', step: 1, parents: {} });
    await saver.putWrites(saved, [['result', 'pending']], 'probe-task');
    await saver.putWrites(saved, [['result', 'pending']], 'probe-task');
    expect((await saver.getTuple(saved))?.checkpoint.channel_values).toEqual(checkpoint.channel_values);
    expect((await saver.getTuple(saved))?.pendingWrites).toHaveLength(1);
    const listed = [];
    for await (const row of saver.list(config, { limit: 2 })) listed.push(row);
    expect(listed).toHaveLength(1);
    stage = 'indexes and record headroom';
    const expected = [...APP_INDEXES,
      { collection: 'checkpoints', keys: { thread_id: 1, checkpoint_ns: 1, checkpoint_id: -1 }, options: { name: 'thread_ns_checkpoint_idx' } },
      { collection: 'checkpoint_writes', keys: { thread_id: 1, checkpoint_ns: 1, checkpoint_id: 1, task_id: 1, idx: 1 }, options: { name: 'thread_ns_checkpoint_task_idx' } },
    ];
    for (const index of expected) {
      const indexes = await h.db.collection(index.collection).indexes();
      expect(indexes.find(row => row.name === index.options.name)?.key).toEqual(index.keys);
    }
    const names = ['sessions', 'messages', 'agent-memory', 'metadata', 'checkpoints', 'checkpoint_writes'];
    expect((await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort())
      .toEqual([...names].sort());
    for (const name of names) {
      const docs = await h.db.collection(name).find({}).limit(101).toArray();
      expect(docs.length).toBeGreaterThan(0);
      expect(docs.length).toBeLessThanOrEqual(100);
      for (const doc of docs) expect(BSON.calculateObjectSize(doc) + 256).toBeLessThanOrEqual(1_800_000);
      for (const index of await h.db.collection(name).indexes()) {
        if (index.name !== '_id_') {
          expect(index.unique).not.toBe(true);
          expect(index.expireAfterSeconds).toBeUndefined();
        }
      }
    }
    stage = 'conditional handoff and fencing';
    await expect(rival.handoffStoppedExecutor('wrong-owner')).rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
    await first.owner.drain();
    await peer.drain();
    await rival.handoffStoppedExecutor('probe-a');
    await expect(first.owner.run(lease, async () => undefined))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
    const second = await createPersistenceBundle(h.client, h.name, DEFAULT_BUDGETS, 'probe-b');
    const recovered = await second.owner.recoverStoppedSession('u1', 's1', 'probe-a', 180_000);
    expect(recovered.generation).toBeGreaterThan(lease.generation);
    expect((await (await second.checkpoints.create()).bind(recovered).getTuple(saved))?.pendingWrites).toHaveLength(1);
    stage = 'quiescent release';
    await expect(second.owner.releaseExecutor()).rejects.toMatchObject({ code: 'NOT_READY' });
    await second.owner.run(recovered, async () => {
      expect(await second.metadata.compareAttempt({ ...accepted, status: 'interrupted', errorCode: 'INTERRUPTED' }, 'accepted')).toBe(true);
    });
    await second.owner.clearAttempt(recovered, 'a1');
    await second.owner.release(recovered);
    await second.owner.drain();
    await second.owner.releaseExecutor();
    expect(await h.db.collection('metadata').findOne({ _id: key('executor') })).toBeNull();
    stage = 'durable reopen';
    const reopened = await h.reconnect();
    try {
      const third = await createPersistenceBundle(reopened, h.name, DEFAULT_BUDGETS, 'probe-c');
      expect((await third.messages.list('u1', 's1', { cursor: null, limit: 2 })).items).toHaveLength(1);
      expect((await third.metadata.getAttempt('u1', 's1', 'a1'))?.status).toBe('interrupted');
      expect(await reopened.db(h.name).collection('metadata').countDocuments({ kind: 'accounting' })).toBe(1);
      const acquired = await third.owner.acquire({ ...input, ownerId: 'probe-c' });
      if (!acquired.ok) throw new Error('Expected reopened lease.');
      const readSaver = (await third.checkpoints.create()).bind(acquired.lease);
      expect((await readSaver.getTuple(saved))?.checkpoint.channel_values).toEqual(checkpoint.channel_values);
      expect((await readSaver.getTuple(saved))?.pendingWrites).toHaveLength(1);
      await third.owner.release(acquired.lease);
      await third.owner.drain();
      await third.owner.releaseExecutor();
    } finally {
      await reopened.close();
    }
  } catch {
    // Static stage only; never let raw driver errors enter Vitest output.
    throw new Error(`Generated capability probe failed at ${stage}; recovery remains blocked.`);
  } finally {
    try { await h.close(); }
    catch { throw new Error('Generated test cleanup was not confirmed; stop and inspect privately.'); }
  }
}, 180_000);
```

- [ ] Run gate first with test URI/prefix/authorization unset: `npm run test:azure -- test/compatibility/persistence-probe.azure.spec.ts`. Expected one failing gate test; **zero connections**. This is not live compatibility evidence.
- [ ] Run `npm run build` and `npm run lint`. Fix test typing/style only; preserve existing warnings honestly. Do not introduce a factory abstraction or production change just to compile this test.

## Task 3: Execute the authorized probe, then verify cleanup

**Files:** temporary runner; P2 evidence.

- [ ] Create the runner below. Credentials are read in child memory and inherited environment only, never command arguments/logs or saved facts. Run from `backend/`; the script itself resides in the approved temp directory. Do not use `--env-file` to inject arbitrary real provider settings into the test.

```javascript
/**
 * ============================================================================
 * FILE: aurvin-p2-probe-run.mjs
 * LOCATION: C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-p2-probe-run.mjs
 * ============================================================================
 * PURPOSE: Load private settings in memory and run one authorized isolated probe.
 * ROLE IN PROJECT: Disposable operator runner; no application/provider startup.
 * KEY COMPONENTS: Generated namespace authorization and child-only credentials.
 * ============================================================================
 */
import { spawnSync } from 'node:child_process';
process.loadEnvFile('.env');
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Private target configuration is missing.');
const env = { ...process.env,
  AURVIN_TEST_MONGODB_URI: uri,
  AURVIN_TEST_DB_PREFIX: 'aurvin_p2_test_',
  AURVIN_AZURE_TEST_AUTHORIZED: 'yes',
  OPENROUTER_API_KEY: '',
  MONGODB_URI: '',
};
delete env.AURVIN_AZURE_TEST_FACTS_JSON;
delete env.AURVIN_AZURE_TEST_URI;
delete env.AURVIN_AZURE_TEST_DB_NAME;
const run = spawnSync(process.execPath, ['./node_modules/vitest/vitest.mjs', 'run',
  '--config', './vitest.config.azure.ts',
  'test/compatibility/persistence-probe.azure.spec.ts'],
  { env, stdio: 'inherit', timeout: 240_000 });
if (run.error || run.signal) {
  console.error('Probe process did not finish safely; recovery remains blocked.');
  process.exitCode = 1;
} else process.exitCode = run.status ?? 1;
```

```powershell
node "C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-p2-probe-run.mjs"
```

Expected: one discovered test passes, one generated `aurvin_p2_test_<uuid>` database created/dropped, no provider requests. Exposure: one session/user/attempt/accounting/manifest/message/checkpoint/pending-write plus bounded control records; fewer than 100 documents/collection, at most ten named non-`_id` indexes. No document-limit stress test or benchmark.

- [ ] Confirm the generated target cleanup through bounded read-only metadata for this run's privately retained generated name. Do not print names/URIs; do not drop databases merely matching a prefix or retry an ambiguous drop blindly. If cleanup or any operation times out, preserve failure evidence and pause application maintenance until service work settles conclusively.
- [ ] Record each stage exercised, client/write concern options (`retryWrites:false`, `w:'majority'`, finite selection/operation timeout), installed versions, elapsed time, test count and cleanup outcome. Do not describe this selected probe as a passed full `test:azure` certification suite.
- [ ] If a real failure identifies a production defect, stop and reproduce in a focused synthetic regression before the minimal owning-module fix. Do not alter driver options, index policies, profile gates or checkpointer implementation speculatively. Route cross-owner fixes to the orchestrator.

## Task 4: Resolve recovery gates without changing the application

**Read:** `docs/aurvin-phase-1/operations.md:18-25`; existing ownership/recovery implementations.

- [ ] Recheck exact checkout/backend/frontend processes and listeners on 8001/5179 immediately before handoff, including parent/child command-line provenance privately. Preserve unrelated processes. If any executor/application process exists, stop; no broad kill or overlapping startup.
- [ ] Establish **three separate proofs**: old process stopped (operator testimony + fresh local check), operator authorization (approved goal), and all old server DB/graph I/O settled or conclusively terminated (control-plane/service evidence). A successful scoped `currentOp`, bounded repeated observations, empty sessions/checkpoints, and completed local promises are corroboration, not a universal cancellation guarantee. Do not set `inFlightIoSettled:true` because 15/120 seconds elapsed.
- [ ] Use at most two scoped `currentOp` observations 15 seconds apart (10-second command budget), projecting/reporting only counts. Include selected deployment control-plane evidence privately if available. If visibility is insufficient to establish settlement, **block before mutation**; request only the missing operator/service evidence, not provisioning.
- [ ] Compare actual Aurvin collection partition/index configuration to supported primitives. Read-only absence of reported partition keys remains unknown. Successful default generated collections do not certify differently partitioned application collections. If equivalence cannot be established, **block recovery/profile admission** rather than manufacture `partitions:unsharded`.
- [ ] Bounded read-only preflight: all five data collections empty (`findOne` with `_id`-only projection), metadata contains only a schema-valid executor (`limit(2)`), no session owned by prior/new owner. Keep owner ID in private process memory. If any historical/non-control record appears, use the nonempty procedure below instead of deleting/rewriting it.

**Gate outcome to record:** `probe passed / full service facts blocked / recovery authorized but awaiting <specific proof>` is a valid, honest result. Do not equate successful connection or ownership release to admission.

## Task 5: Conditional verified-empty owner handoff and release

**Temporary operator script only; execute only after Task 4 proofs are recorded.** This path needs no runtime because bounded reads prove there is no session/checkpoint/application work to reconcile. Invoke existing `handoffStoppedExecutor` directly in this runtime-free context; do not construct a fake `ChatRuntime` just to call `handoffVerifiedStopped`.

- [ ] Create the temporary script with the header and core below, using absolute file-URL imports from this checkout's freshly built `backend/dist`. Surround with a secret-safe catch and always close its client. The worker must not substitute a different application DB, use a test DB as application state, or call `openPersistence` before handoff.

```javascript
/**
 * ============================================================================
 * FILE: aurvin-p2-empty-recovery.mjs
 * LOCATION: C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-p2-empty-recovery.mjs
 * ============================================================================
 * PURPOSE: Perform approved verified-empty stopped-owner recovery and release.
 * ROLE IN PROJECT: Temporary operator-only maintenance; no inference or deletion API.
 * KEY COMPONENTS: Bounded empty-state guard, conditional handoff, quiescent release.
 * ============================================================================
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const root = new URL('file:///D:/Peter/Aurvin%20Agent/Aurvin/backend/');
const require = createRequire(new URL('package.json', root));
const { MongoClient } = require('mongodb');
const { loadConfig } = await import(new URL('dist/platform/config/load-config.js', root));
const { RecordStore } = await import(new URL('dist/persistence/store.js', root));
const { MongoOwnership } = await import(new URL('dist/persistence/ownership.js', root));
const { executorSchema, EXECUTOR_SCOPE, key, decode } = await import(new URL('dist/persistence/records.js', root));

function requireProof(p) {
  assert.equal(p.oldProcessStopped, true);
  assert.equal(p.inFlightIoSettled, true);
  assert.equal(p.operatorAuthorized, true);
  assert.equal(p.probePassed, true);
  assert.equal(p.applicationCollectionCompatibilityVerified, true);
}
if (process.argv.includes('--self-test')) {
  const passed = { oldProcessStopped: true, inFlightIoSettled: true,
    operatorAuthorized: true, probePassed: true, applicationCollectionCompatibilityVerified: true };
  requireProof(passed);
  for (const name of Object.keys(passed)) assert.throws(() => requireProof({ ...passed, [name]: false }));
  console.log('Maintenance proof guard self-check passed.');
} else {
  // Private local evidence file is authored only from actual completed Task 4 proofs.
  // Do not create an all-true file as a workaround; booleans are operator attestation.
  let client;
  let handedOff = false;
  try {
    const proof = JSON.parse(readFileSync('C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-p2-recovery-proof.json', 'utf8'));
    requireProof(proof);
    process.loadEnvFile('.env');
    const config = loadConfig(process.env);
    client = new MongoClient(config.persistence.mongoUri, {
      retryWrites: false, maxIdleTimeMS: 120_000, connectTimeoutMS: 10_000,
      serverSelectionTimeoutMS: 10_000, timeoutMS: 15_000, writeConcern: { w: 'majority' },
    });
    await client.connect();
    const db = client.db(config.persistence.mongoDbName);
    const options = { maxTimeMS: 10_000, projection: { _id: 1 } };
    for (const name of ['sessions', 'messages', 'agent-memory', 'checkpoints', 'checkpoint_writes']) {
      assert.equal(await db.collection(name).findOne({}, options), null);
    }
    const controls = await db.collection('metadata').find({}, { maxTimeMS: 10_000 }).limit(2).toArray();
    assert.equal(controls.length, 1);
    assert.equal(controls[0]._id, key('executor'));
    const previous = decode(executorSchema, controls[0]);
    assert.ok(previous?.ownerId);
    assert.equal(previous.userId, EXECUTOR_SCOPE.userId);
    assert.equal(previous.sessionId, EXECUTOR_SCOPE.sessionId);
    const owner = new MongoOwnership(new RecordStore(db, config.budgets.persistenceTimeoutMs), randomUUID());
    await owner.handoffStoppedExecutor(previous.ownerId);
    handedOff = true;
    await owner.assertExecutor();
    assert.equal(await db.collection('sessions').findOne({}, options), null);
    await owner.drain();
    // Existing owner-conditional quiescent release only, never direct sentinel delete.
    await owner.releaseExecutor();
    assert.equal(await db.collection('metadata').findOne({ _id: key('executor') }, options), null);
    for (const name of ['sessions', 'messages', 'agent-memory', 'checkpoints', 'checkpoint_writes']) {
      assert.equal(await db.collection(name).findOne({}, options), null);
    }
    console.log('Verified-empty stopped-owner maintenance completed and released.');
  } catch {
    console.error(handedOff ? 'Maintenance state uncertain; do not restart or repeat handoff.' :
      'Maintenance not confirmed; preserve ownership and stop.');
    process.exitCode = 1;
  } finally {
    try { await client?.close(); }
    catch { console.error('Maintenance client closure uncertain; stop.'); process.exitCode = 1; }
  }
}
```

- [ ] First run `node "C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-p2-empty-recovery.mjs" --self-test` from `backend/`. Expected proof guard self-check passes, no environment load/connection; proves every false attestation refuses.
- [ ] Validate the existing deterministic handoff/recovery tests again, document Task 4 proof artifact, and recheck no application process immediately before executing the script without `--self-test`. Operator proof file is private, never printed/staged.
- [ ] Execute once; bound each operation as above, operator observation budget 90 seconds. Do not kill a child merely at a local deadline or automatically retry an ambiguous CAS/release. If the process exceeds the observation budget, keep serving closed and resolve pending service operations privately before any retry. No unbounded polling loop.
- [ ] Verify prior sentinel became the maintenance owner's sentinel through existing revision/owner CAS, then existing owner-conditional `releaseExecutor` removed **its own** quiescent record. The prohibition is direct deletion/bypass of a stopped/other owner's sentinel, not the established safe release implementation. Verify the five data collections remain empty and index metadata unchanged. Do not claim clean release solely from a fulfilled command.

### If preflight unexpectedly finds application data

This temporary empty-only script must refuse before handoff. Do not broaden it into a new general-purpose recovery framework.

- [ ] Keep all history, attempts, accounting, manifests and checkpoints intact; route the discovered nonempty condition to the orchestrator before proceeding.
- [ ] Once that condition's recovery is authorized/evidenced, follow the existing operations runbook: compose `MongoClient`/`RecordStore`/`MongoOwnership` with one new stable executor ID, perform conditional stopped-owner handoff, compose `createPersistenceBundle` using that same ID, create one maintenance runtime using existing `createChatRuntime` with validated fixed assets/config and a deterministic/no-dispatch model boundary, call `stopAccepting` and `allowStoppedOwner(oldId)`. Do not inject a real OpenRouter adapter or invoke execute/submit/retry.
- [ ] Existing `handoffVerifiedStopped(owner, runtime, oldId, proof)` is used when a real quiescent runtime already exists; it requires actual old-process/I/O/operator proof. Bundle-first composition cannot claim another owner's sentinel: do not attempt that order on the app database.
- [ ] Run `reconcilePage` with `listForRecovery` pages of ten, one at a time, at most 100 pages, stop on errors/continuation cap; separately inspect owner-only/rebase leftovers within bounded scoped pages. Preserve saved graph results; interrupt no-result attempts without inference. Repeat reconciliation to establish idempotency, drain the runtime and owner; retain sentinel on unresolved/quarantined work. Release only the quiescent maintenance owner's sentinel so a fresh ordinary startup can claim it. New data discovery is a stop condition for this assigned empty-path operation, not license to improvise a broad repair.

## Task 6: Report preservation, release and serving gates separately

**File:** `docs/backend-startup-fix/p2-evidence.md`; orchestrator owns final startup/proxy verification and shared status.

- [ ] Record actual build/lint/focused checks and discovered pass/fail/skip counts, expected gate failures, generated target cleanup, static capability stages, timestamps and commit set. Run no application suites merely because documents exist.
- [ ] Report `handoff not run`, `blocked`, `completed and released`, or `uncertain` accurately; include specific missing evidence without secrets. This planner plan and source presence are not successful verification.
- [ ] No environment/profile edits in P2. If actual service admission remains blocked, say so even after a safe maintenance release. Do not call the application fixed or Azure/native certified. Require the orchestrator to settle admission evidence before ordinary serving.
- [ ] When the orchestrator's startup/admission gate is satisfied, P1's direct-Node startup may do one bounded model-catalogue **GET**, which is not inference. Preserve configured model/privacy values; never print them or send chat/completion POSTs. Verify `/api/operations/live`, archive GETs and `/ready` separately, then Vite proxy GET connectivity. A 503 readiness result is a blocker, not proof of failed liveness or permission to infer.
- [ ] Return owned file list and readiness/prerequisites. Do not commit independently. Unified review remains **skipped**, not passed.

## Plan consistency check

- Only a generated isolated database is a fixture; no S1/app testing or profile/environment changes.
- Existing full-service facts gate preserved; capability evidence distinct from admission/certification.
- Real database CAS across distinct owner objects, stock saver put/get/list/pending writes, exact indexes, idempotency, conditional handoff, old-owner fencing, quiescent release and durable reopen exercised.
- Failed/ambiguous I/O blocks recovery; operator testimony and scoped observations are not fabricated server-settlement proof.
- Verified-empty path uses existing handoff/release, no model or runtime; nonempty discovery stops for scoped recovery orchestration.
- No paid inference, provisioning, direct sentinel deletion, new abstraction/dependency, recursive MAW, reviewer or independent commit.
