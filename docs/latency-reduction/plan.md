# Aurvin Major Latency Reduction Implementation Plan

> **For agentic workers:** Execute directly, in dependency order, task-by-task; track the checkboxes. The user has **not** requested further delegation. The writing-plans skill's subagent/execution-skill recommendation does not override that instruction. Unified review is **skipped**, not passed. Correctness tests, independent measurements, fault injection, and the planner's self-review are required.

**Goal:** Substantially reduce durable admission, attachment, stream-consumer stalls, and publication latency without weakening acceptance, identity, spend, checkpoint, recovery, disclosure, or ready-for-follow-up guarantees.

**Architecture:** Keep the current runtime, repositories, six collection roles, stock MongoDB saver, synchronous graph durability, majority acknowledgments, and single live executor. First attribute the complete request path, then reuse bounded acknowledged evidence and group only genuinely independent persistence operations inside short owned phases. Keep authoritative boundaries synchronous; overlap only supervised, bounded enrichment and investigate storage placement separately behind operator approval.

**Tech Stack:** NestJS/TypeScript ESM/NodeNext, React/Vite unchanged, MongoDB Node driver 6.21.0, LangGraph JS 1.4.19, MongoDB saver 1.4.1, existing Vitest/BSON/native replica-set fixtures. No new dependency or workflow engine.

---

## 0. Status, authority, and reading order

- **Status: planning only, 28 October 2026.** None of the implementation or test results below have been performed by this planner. Expected results are requirements, not evidence.
- Inspected reality: HEAD `58f0b781603df35ec064faef7a9951c09d0e9544` plus substantial existing modified/untracked work on `codex/google-calendar-plugin`. Do not restore HEAD over it. Re-read touched methods before editing; symbol names below, not historical line numbers, are anchors.
- This plan is the only file written by the planner. Preserve `docs/performance/**`, `backend/test/performance/**`, all application modifications, `.openchamber/`, local settings, and other agents' artifacts.
- This is a targeted initiative, **not Phase 1 MAW execution management**. Do not change `docs/aurvin-phase-1/state.md`, reopen its approval gate, or dispatch reviewers/fixers.
- The user requested a plan, not execution. Obtain permission to implement. Commits are optional, require separate user approval **before** staging/committing, and must explicitly name task files. No implicit branch/worktree, commit, push, infrastructure, configuration, deployment, or paid-operation authority exists.
- Read root [`AGENTS.md`](../../AGENTS.md), the full [completed research](../performance/latency-reduction-research.md), and [existing implementation record](../performance/conversation-latency-implementation.md). The old [investigation](../performance/conversation-latency-investigation.md) is historical, not the starting implementation.

### What the inspected code independently confirms

1. `MongoOwnership.run` currently serializes globally and calls `fence`, which reads both executor and lease, for each repository callback. Retain the global queue initially; it is also a control/drain dependency.
2. `acceptNewTurn` discards `checkBoundary.source`; `executeTurn` rereads input twice, acceptance, history, manifest, graph, and sequence reservation. HTTP `ChatStreamTransport.open` additionally calls `ChatHttpService.status`, whose Calendar projection is discarded by the transport. These are shared text/Calendar opportunities, not just Calendar ledger work.
3. `RecordStore.insert` already trusts only a fresh acknowledged immutable insert; do not reimplement that optimization. `replace` already returns directly on a known successful match, but callers often reread an envelope **before** calling it.
4. `CalendarTurnLedger` already caches values. `MongoCalendarAccounting` still loads storage revisions/private `_calendarClaims`, and `recomputeBudgetMoney` currently does not establish success from `matchedCount`. A caller must not manufacture a confirmed budget revision from an unconfirmed derived write. Receipt work must fix this contract, not merely skip reads.
5. Text capture awaits attempt generation CAS **and** accounting/generation claim before text. Calendar awaits each changed observation before text. Both coalesce some repeated observations already. The 100-fragment test's ceiling is already six dispatch saves.
6. `ScopedMongoSaver.getTuple` prechecks two collections and delegates to stock `getTuple`, fetching both again. Its empty-thread and serialization optimizations already exist. The installed stock method decodes the checkpoint before querying pending writes; a new facade must enforce bounds **before each stock decode**, not after returning a tuple.
7. Both successful paths wait for cleanup before terminal SSE. Keep that behavior. Text additionally awaits a supposedly optional durable-completion timing enrichment; remove that extra mutation rather than hide it in an untracked task.
8. `MongoMessages.list` exposes message completion independently of attempt status. Therefore **do not insert a completed assistant early** as a transparent optimization: that would change readers' meaning. Keep the archived message provisional until graph-boundary publication.

### Evidence and falsifiable targets

Supplied single-turn evidence: total **54.758 s**; admission **22.386 s**; preparation **9.860 s**; model windows **3.007/6.639 s** including database-consumer waits; tool/evidence window **4.504 s**, only **0.703 s** identified as Google discovery; tail **8.362 s**. Execution instrumentation counted **175 reads/40 writes**; a broader snapshot counted 227/52, averaging approximately **67/449 ms**. Scopes differ. The database is non-loopback; actual product, service region/tier, quorum, journaling behavior, pool wait, and outliers are unknown.

Never sum nested wrapper, queue, command, and model-window durations into one waterfall. Use intervals, their union, and explicit dependency edges. Neither average is a network RTT. Research savings estimates and the following budgets are **hypotheses**:

- Code-only goal on identical delayed fixtures: at least **30% fewer pre-dispatch critical-path storage waves**, **25% fewer total native wire commands**, and **30% fewer post-seal storage waves**, with no added provider requests or worse completion/failure semantics. Capture an actual complete baseline first; do not invent absolute command ceilings from partial fixtures.
- Low-latency-storage engineering budget for a comparable short two-model/one-tool turn: admission 0.3–1.5 s, preparation 0.5–1.5 s, tool/evidence 1–2 s, publication/release 0.5–1.5 s, two model windows 8–14 s. Initial **15–25 s**, later approximately **12–20 s**, are trial total targets, not promises/SLOs/p95s.
- Treat ≤5–10 ms median authoritative reads and ≤15–25 ms median majority writes as placement-investigation targets, not facts. A write-limited remote service can keep code-only results substantially above the total target.
- Text-only, Calendar-enabled ordinary text, read, create, conflict/proposal reply, retry, cancellation, cold first chat, warm follow-up, and long-history follow-up are separate scenarios. Do not report one as another.

## 1. Decisions fixed for the safe implementation

**Preserve by default**

- No model, reasoning, output style, tool catalogue, permissions, conflict coverage, history ceiling, retention, identity, privacy, `OpenRouter.user`, or product changes.
- No `w:1`/`w:0`, journal weakening, shorter success acknowledgment, secondary authority reads, transactions, client-wide bulk, local authoritative WAL, Redis, new queue service, or framework replacement.
- Retain `durability: 'sync'` everywhere. Do not globally select `async` or `exit`. Keep node names and durable state schemas compatible initially; reducing duplicate queries does not require deleting graph recovery states.
- Retain one process-wide ownership lane for now. No claim of multi-instance fencing: a sentinel check cannot atomically fence another document. Another live backend against the same DB remains forbidden, even after these changes.
- Keep acceptance POST + execution SSE. Do not add a combined endpoint to disguise durable admission time.
- Preserve durable generation-ID-before-output evidence. First/new generation identity and its attribution claim remain synchronous; only later enrichment may overlap.
- Keep accounting aggregates and retention/source registration authoritative and awaited. No separately written fire-and-forget outbox.

**Explicit approval/decision gates**

| Gate | Safe default | What would require a new decision |
| --- | --- | --- |
| D1 Implementation | Stop after this plan | Permission to edit application/tests; no implicit commit permission |
| D2 Identity window | Await every newly observed generation identity before associated output | Streaming text while that identity write is unresolved; visible text could survive while newest billing identity does not |
| D3 Plain-text money policy | Preserve current finite token/retry budgets and pending/unknown billing; never infer zero cost | A new USD cap/reservation for non-Calendar text needs verified pricing, cap semantics, schema/recovery design, and product approval; it does not exist today |
| D4 Storage execution | Offline fixtures only until authorized | Operator-supplied isolated native replica-set URI/account, permitted service access, sample/command budget, and test-database deletion authority |
| D5 Saver integration | Existing bounded precheck path until conformance gates pass | Activate bounded driver facade only after exact installed-version and native conformance evidence; if absent, leave old path and report blocked |
| D6 Infrastructure | Investigate sanitized operator facts on paper | Placement, service/tier/quorum changes, local authoritative storage, access control, backup/RPO/RTO, provisioning and deployment |
| D7 External benchmarks | Deterministic provider fixtures | Bounded paid/model/Google/browser/staging runs, isolated Calendar data, cost/data authorization |
| D8 Larger protocol changes | No lifecycle/sequence schema migration or graph node removal | Versioned migration/rollback and reader compatibility for consolidated lifecycle/sequence fields or removed persisted graph nodes |

D2 is **not required** for the default writer. D3 is **not silently solved** with Calendar pricing: a plain-text runtime can have no Calendar pricing or turn budget. Missing usage stays pending/unknown. No code here may claim a new monetary cap, exact provider cost recovery, or exactly-once billing.

## 2. File responsibility map

Paths are future implementation targets, **not planner edits**. Add mandatory project code headers to every new code file; preserve required headers/directives. Use `.js` local import specifiers.

| Unit | Exact files | Responsibility |
| --- | --- | --- |
| Native observation | Create `backend/src/persistence/database-observation.ts`; modify `backend/src/persistence/persistence.ts`, `backend/src/operations/observe-persistence.ts`, `backend/src/operations/telemetry.ts`, `backend/src/operations/observed-runtime.ts`, `backend/src/operations/configure-operations.ts` | Observe the one raw client, preserve originating request/phase context, count stock saver/cursors/aggregate, distinct timing layers |
| Observation tests | Create `backend/test/operations/database-observation.spec.ts`; modify `backend/test/operations/telemetry.spec.ts`, `backend/test/operations/runtime.spec.ts` | Sanitization, attribution, bounds, listener disposal, overlap, admission scope |
| Deterministic storage model | Create `backend/test/performance/dependency-probe.ts`, `backend/test/performance/latency-runtime-fixture.ts`, `backend/test/performance/durable-latency.spec.ts`; extend `backend/test/persistence/calendar-multi-memory.ts` | Real Mongo repositories/ownership/stock saver over a delayed BSON fake driver; independent dependency and wire counters |
| Existing probes | Modify `backend/test/performance/conversation-latency.spec.ts`, `backend/test/performance/latency-storage.spec.ts` | Retain old partial-count regressions; do not relabel their counts as complete |
| Confirmed receipts | Create `backend/src/persistence/confirmed-record.ts`; modify `backend/src/persistence/store.ts`, `backend/src/contracts/repositories.ts`, `backend/src/persistence/messages.ts`, `backend/src/persistence/metadata.ts`, `backend/src/persistence/memory.ts` | Opaque adapter/store-bound acknowledged record/revision, additive fast methods; legacy strict methods remain |
| Calendar receipts | Modify `backend/src/contracts/calendar-accounting.ts`, `backend/src/persistence/calendar-accounting.ts`, `backend/src/chat-runtime/calendar-budget.ts`, `backend/src/chat-runtime/calendar-ports.ts`, `backend/src/chat-runtime/calendar-recovery.ts` | Carry actual storage envelope + budget claims through CAS; no guessed revisions; recovery strict path |
| Ownership phases | Modify `backend/src/persistence/ownership.ts`, `backend/src/persistence/store.ts`, `backend/src/contracts/repositories.ts`, `backend/src/chat-runtime/work.ts`; create `backend/test/persistence/owned-phases.spec.ts` | Short same-owner phases, control handoff barrier, per-mutation deadline checks, no lease expiry bypass, tracked unresolved operations, combined final release |
| Admission/attachment | Create `backend/src/chat-runtime/admission-receipt.ts`; modify `backend/src/chat-runtime/durable-chat-runtime.ts`, `backend/src/chat-runtime/history.ts`, `backend/src/chat-runtime/ports.ts`, `backend/src/operations/observed-runtime.ts`, `backend/src/http/chat-http.service.ts`, `backend/src/http/chat-stream.transport.ts` | Shared text/Calendar acceptance staging, bounded disposable receipts, atomic accepted-slot attachment, transport avoids discarded projection |
| Finalization | Modify `backend/src/chat-runtime/finalization.ts`, `backend/src/chat-runtime/calendar-publication.ts`, `backend/src/chat-runtime/reconciliation.ts`, `backend/src/chat-runtime/durable-chat-runtime.ts` | Same recovery barriers, live evidence reuse, independent staging, completion after boundary, compact release |
| Observation writer | Create `backend/src/model/observation-writer.ts`, `backend/test/model/observation-writer.spec.ts`; modify `backend/src/model/index.ts`, `backend/src/model/openrouter-adapter.ts`, `backend/src/model/calendar-adapter.ts`, `backend/src/model/accounting.ts`, `backend/src/model/calendar-policy.ts`, `backend/src/chat-runtime/calendar-budget.ts`, `backend/src/chat-runtime/calendar-loop.ts`, `backend/src/chat-runtime/durable-chat-runtime.ts`, `backend/src/chat-runtime/work.ts` | One in-flight plus one latest snapshot, synchronous identity barrier, failure latch, tracked drains, no cost authority moved to memory |
| Saver/graph | Modify `backend/src/persistence/checkpoints.ts`, `backend/src/agent/turn-graph.ts`, `backend/src/chat-runtime/durable-chat-runtime.ts`, `backend/src/chat-runtime/finalization.ts`; create `backend/test/persistence/checkpoints-bounded.spec.ts` | Stock decoding through bounded cursor facade; pass existing state into prepare; live exact-snapshot reuse, sync unchanged |
| Native measurement | Create `backend/test/performance/durable-latency.native.e2e-spec.ts`, `backend/test/performance/majority-latency.native.e2e-spec.ts`; modify `backend/test/persistence/native.ts`, `backend/test/runtime/native-harness.ts`, `backend/test/persistence/checkpoints.native.e2e-spec.ts` | Explicitly isolated native profile, actual majority latency, complete command conformance, fixture-only providers |
| Evidence | Future `docs/latency-reduction/verification.md`, `docs/latency-reduction/placement-decision.md` | Actual environment/checks/counts/faults/skips; approval-gated placement facts; never edit Phase 1 state |

**Existing suites to extend at their seams:** `backend/test/runtime/text-config.spec.ts`, `text-config-fixture.ts`, `calendar-runtime.fixture.ts`, `calendar-budget.spec.ts`, `calendar-publication.spec.ts`, `finalization-repair.spec.ts`, `calendar-graph.spec.ts`, `work.spec.ts`, `stream-quiescence.spec.ts`, `backend/test/model/adapter.spec.ts`, `calendar-adapter.spec.ts`, `backend/test/http/calendar-stream.spec.ts`, `stream-transport.spec.ts`, `backend/test/persistence/local-owner.spec.ts`, `mutation-journal.spec.ts`. Other legacy doubles need no new fast methods: the runtime must retain strict capability-detected fallback, tested explicitly.

**Do not add an abstraction for each phase.** One small receipt primitive, one admission-receipt holder, one bounded writer, one native observer, and test-only dependency probe suffice. Keep specialized business validation in the existing adapters.

## 3. Dependency order and stop conditions

```text
T0 scope/snapshot
  -> T1 complete attribution -> T2 complete deterministic baseline
  -> T3 confirmed receipts -> T4 owned/control phases
  -> T5 admission staging -> T6 attachment reuse
  -> T7 text + Calendar publication
T3 + T4 + T7 -> T8 supervised observation writer
T1 + T2 + T6 -> T9 bounded stock-saver/graph simplification
T5 + T6 + T7 + T8 + T9 -> T10 whole-system certification
T1 + T10 measurements + D4/D6 -> T11 placement decision/evidence
```

- Execution can be sequential in this session; no subagents required. Independent **code execution operations**, not workers, are identified below.
- T1/T2 must land locally before optimizing counts; T3 before passing cache values as durable evidence; T4 before removing repeated per-helper guards; T7 before moving optional enrichment off the tail.
- Absence of a native replica-set fixture does not prevent offline T1–T8 preparation. It **blocks certification/activation of new saver read plumbing, final performance claims, and any release decision relying on native ownership/recovery behavior**. Do not call skipped native tests passes. Do not provision or read application `.env` to bypass the block.
- If a phase cannot maintain the lease/control/journal conditions below, keep its existing individually guarded writes. Record the lost optimization; do not cache authority instead.
- If a reduction target is missed, report measured causes and residual barriers. Never weaken correctness or filter failures out to reach it.

## Task 0 — Freeze the actual baseline and constraints

**Files:** read root `AGENTS.md`, the two performance documents, package manifests, current task targets; no baseline reset or application-data inspection.

- [x] **0.1 — Capture checkout identity read-only.** Run from root:

  ```powershell
  git rev-parse HEAD
  git status --short
  git diff --stat
  ```

  Expected: real revision and existing modified/untracked paths; do not stage anything. Record implementation-start revision and a source-diff fingerprint in future verification evidence; HEAD alone is insufficient. Do not dump `.env`, configuration files, or credentials.
- [x] **0.2 — Confirm D1 and the no-review/no-paid boundaries.** Approval to execute this plan must be explicit. Optional commit checkpoints after completed tasks need separate approval; no task below requires a commit to function.
- [x] **0.3 — Recheck versions without network/install.** Read installed package manifests/lock and `backend/node_modules/@langchain/langgraph-checkpoint-mongodb/dist/checkpoint.js`; expected inspected versions 6.21.0/1.4.19/1.4.1. If changed, repeat stock-call-shape conformance work before T9. Do not replace lockfiles or run dependency installation as part of measurement.

## Task 1 — Complete sensitive-safe request, database, saver, and phase instrumentation

**Files:** observation/operations units in the map. New observer is a persistence diagnostic primitive, not a second client/owner.

- [x] **1.1 — Add failing sanitized event tests** in `backend/test/operations/database-observation.spec.ts` using `EventEmitter` as the client event source. Feed started/succeeded/failed events for stock `find`, `getMore`, `aggregate`, `update`, `findAndModify`, `insert`, `delete`, and ignored setup/control commands. Store attribution on start and finish it after switching ALS contexts. Test shape:

  ```typescript
  const lines: string[] = [];
  const t = new Telemetry(line => lines.push(line));
  const source = new EventEmitter();
  const stop = observeDatabaseCommands(source, 'isolated-test', t);
  t.inRequest('11111111-1111-4111-8111-111111111111', () => {
    source.emit('commandStarted', {
      requestId: 7, databaseName: 'isolated-test', commandName: 'find',
      command: { find: 'checkpoints', filter: { content: 'PRIVATE', uri: 'SECRET' } },
    });
  });
  source.emit('commandSucceeded', {
    requestId: 7, commandName: 'find', duration: 12,
    reply: { cursor: { firstBatch: [{ content: 'PRIVATE' }] } },
  });
  expect(lines.join('')).not.toMatch(/PRIVATE|SECRET|isolated-test|firstBatch|filter/);
  expect(t.snapshot().mongo_read.count).toBe(1);
  stop();
  expect(source.listenerCount('commandStarted')).toBe(0);
  ```

  Import the proposed `observeDatabaseCommands` from `../../src/persistence/database-observation.js`, `Telemetry` from its existing module, and `EventEmitter` from `node:events`. Define `mongo_read`/`mongo_write` in the next step, not dynamically from strings.
- [x] **1.2 — Run red.** `npm test -- test/operations/database-observation.spec.ts` from `backend`; expected failing missing observer/metrics, not a network operation.
- [x] **1.3 — Implement this finite observer interface.** Keep only an allowlisted projection and originating scope capture, never a command/reply/error/event object:

  ```typescript
  export type DatabasePhase =
    | 'admission' | 'attachment' | 'context' | 'model-observation'
    | 'tool-evidence' | 'seal' | 'publication' | 'release' | 'recovery' | 'other';
  export type DatabaseCommand =
    | 'find' | 'getMore' | 'aggregate' | 'count' | 'distinct'
    | 'insert' | 'update' | 'delete' | 'findAndModify' | 'bulkWrite' | 'other';
  export type DatabaseOrigin = 'repository' | 'ownership' | 'checkpoint' | 'other';
  export interface CommandSource {
    on(name: string, listener: (...args: any[]) => void): unknown;
    off(name: string, listener: (...args: any[]) => void): unknown;
  }
  export function observeDatabaseCommands(
    source: CommandSource, databaseName: string, telemetry: Telemetry,
  ): () => void;
  ```

  The declaration describes the adapter boundary; implement with the driver's exported event types and typed listeners rather than introducing `any` into production. Read only `requestId`, `databaseName` for exact in-memory DB filtering, `commandName`, duration, and the **single command collection-name field** for finite classification. Collection output is restricted to the seven admitted names or `other`; never output DB name, host/address, URI, command/reply, error strings/stack, filters, payload length derived from content, user text, tokens, Calendar IDs, namespace strings, or query comments. Do not recursively sanitize raw objects: never retain them.

  Map started events by numeric driver request ID for this client. Capture a Telemetry scope callback at start and use it at success/failure; completion-event ALS can belong to another request. Bound in-flight records to 4,096 and 2 minutes; overflow/expiry increments an unattributed/drop counter and discards metadata, not the DB operation. Numeric operation IDs are trace-local and not metric labels. Dispose listeners and clear maps on close/setup failure. Observer errors cannot change chat behavior.
- [x] **1.4 — Attach to the raw client without weakening `guardedClient`.** Enable `monitorCommands: true` in the existing native `MongoClient` constructor, before connect or pool/connection creation: driver 6.21.0 copies this option into pools and connections, so changing the client property later cannot reliably enable or disable monitoring. `createPersistenceBundle` gains an optional final diagnostics-source parameter defaulting to its supplied native client. Return `observeDatabase(telemetry): () => void` on the bundle; `openPersistence` passes the raw client even when repositories/saver receive the journal facade. `observePersistence` calls it once and stores disposal in the opened bundle's one close path. Bootstrap commands before observer attachment are explicitly excluded from counts; monitoring itself stays enabled for the client lifetime and has unmeasured overhead. Disposal removes listeners and bounded metadata, not the constructor option. Add an offline driver-level regression proving the option is present when the real driver constructs its connection pool/connection; real wire event coverage remains unverified without D4. Never expose the raw client through the journal facade. No change to DB URI/write concern or `AppService` composition is needed.
- [x] **1.5 — Separate timing layers in `Telemetry`.** Add fixed metrics `mongo_read`, `mongo_write`, `mongo_other`, `mongo_failed`, `mongo_pool_wait`, `mongo_unattributed`, `mongo_observation_dropped`, plus fixed phase/origin classifications. Keep existing `driver_read`/`driver_write` as legacy logical-driver-wrapper metrics during comparison; do not add them to native counts. Stock saver `bulkWrite` can emit multiple `update` commands; report actual wire events, not one wrapper as one wire command. `getMore` is a separate wire read. Include failures and killed cursors under finite classes, not hidden successes.

  Record pool-checkout completion/failure `durationMS` separately as pool wait, using the installed driver event definition. Pool events lack a reliable operation ID; if originating request capture is not proven in tests, aggregate them process-wide and mark request attribution unavailable. Do not manufacture per-command pool correlation or call pool/selection/socket/quorum durations interchangeable. Command durations include acknowledgment wait; logical operation wall time also includes checkout, selection, serialization and consumer effects.
- [x] **1.6 — Cover admission and stream preparation, not just `executeTurn`.** `observedRuntime.submitTurn/retryTurn` start a request-scope counter before any DB call and emit a single admission summary after request cleanup. Within `acceptNewTurn/acceptRetry`, enter diagnostic turn scope **as soon as deterministic IDs are known**, before the first session/idempotency query. Preserve the request counter when entering `inTurn`, rather than replacing it. Attachment begins at transport reservation/status work; provider and publication scopes share the execution counter. Distinguish `acceptance-durable` from `admission-returned`, and `attempt-terminal-durable`, `slot-released`, `terminal-delivered`. The latter may have transport delay.

  Add `Telemetry.inDatabasePhase(phase, origin, fn)`, `captureDatabaseScope(): (fn: () => void) => void`, and `databaseCounts()` returning copies of finite counters. Nested diagnostic scopes share the same counter object. Capture phase context **before** entering ownership's promise queue so a different queued operation cannot borrow attribution.
- [x] **1.7 — Record intervals honestly.** Test-only probe retains finite per-operation intervals/causal IDs. Production keeps fixed histograms and bounded per-request counts, elapsed phase times, DB interval-union busy time, and overlap time; emits at most 128 operation detail samples per request plus dropped-detail count. Counters still cover all commands. Avoid using terminal event multiplicity as sample count: `observedRuntime` currently emits terminal on both status and completed. Emit one timing summary in execution `finally`, with outcome and `terminalDelivered` separately; failed/disconnected executions also count.
- [x] **1.8 — Green + independent checks.** Run:

  ```text
  npm test -- test/operations/database-observation.spec.ts test/operations/telemetry.spec.ts test/operations/runtime.spec.ts
  npm run build
  ```

  Expected: nonempty passing discovery; 3 parallel fake operations lasting 10 ms produce operation sum 30 ms but union 10 ms; no 30 ms waterfall claim. Explicit tests cover admission, retry, delayed queued command, failure after request return, cursor chains/async iteration, aggregate, journal control source, stock saver, listener disposal, overflow, invalid fields, sink failure, and absence of all secret sentinels. Independently compare native event count with the fake driver's wire log in T2; instrumentation must not be its own oracle.

## Task 2 — Establish a complete delayed-persistence and dependency-wave baseline

**Files:** test-only probe/fixture units; keep existing partial probes.

- [x] **2.1 — Build the smallest scheduler in `dependency-probe.ts`.** Define a finite operation trace and gate all command entry points, including cursor consumption. Core runnable fixture contract:

  ```typescript
  export type ProbeKind = 'read' | 'write';
  export type ProbeEvent = {
    id: number; kind: ProbeKind; method: string; collection: string;
    startedAt: number; endedAt: number | null; wave: number;
  };
  export class DependencyProbe {
    readonly events: ProbeEvent[] = [];
    private now = 0;
    private wave = 0;
    private next = 0;
    private pending: Array<{
      event: ProbeEvent; run: () => unknown;
      resolve: (value: unknown) => void; reject: (reason: unknown) => void;
    }> = [];
    command<T>(kind: ProbeKind, method: string, collection: string, run: () => T): Promise<T> {
      if (this.events.length >= 100_000) throw new Error('Probe command ceiling exceeded');
      const event = { id: ++this.next, kind, method, collection,
        startedAt: this.now, endedAt: null, wave: this.wave + 1 };
      this.events.push(event);
      return new Promise<T>((resolve, reject) => this.pending.push({
        event, run, resolve: value => resolve(value as T), reject,
      }));
    }
    advance(readMs: number, writeMs: number): void {
      const ready = this.pending.splice(0);
      if (!ready.length) throw new Error('No pending storage wave');
      ++this.wave;
      let end = this.now;
      for (const item of ready) {
        const duration = item.event.kind === 'read' ? readMs : writeMs;
        item.event.endedAt = this.now + duration;
        end = Math.max(end, item.event.endedAt);
        try { item.resolve(item.run()); } catch (error) { item.reject(error); }
      }
      this.now = end;
    }
    get waiting(): number { return this.pending.length; }
    get waves(): number { return this.wave; }
    get elapsedMs(): number { return this.now; }
  }
  ```

  This scheduler intentionally rounds mixed-duration independent operations up to the largest duration at a wave boundary; label it a **dependency-wave model**, not an accurate event-loop simulator. In a second mode, use actual deferred promises/fake timers per command to check finer overlap. Drive microtasks between advances with `setImmediate` from `node:timers/promises`, bounded to 10,000 advances; error on no-progress instead of hanging. Provider fixtures are immediate unless the scenario explicitly gates a model or Google operation. Real-time Windows elapsed measurements are informational only.
- [x] **2.2 — Prove the scheduler before using it.** In `durable-latency.spec.ts`:

  ```typescript
  it('counts independent commands as one wave and dependent writes as two', async () => {
    const p = new DependencyProbe();
    const independent = Promise.all([
      p.command('read', 'find', 'messages', () => 1),
      p.command('read', 'find', 'metadata', () => 2),
    ]);
    p.advance(67, 449);
    expect(await independent).toEqual([1, 2]);
    expect(p.elapsedMs).toBe(67);
    const dependent = p.command('write', 'update', 'metadata', () => 1)
      .then(() => p.command('write', 'update', 'sessions', () => 2));
    p.advance(67, 449);
    await Promise.resolve();
    p.advance(67, 449);
    expect(await dependent).toBe(2);
    expect(p.waves).toBe(3);
    expect(p.elapsedMs).toBe(965);
  });
  ```

  Expected PASS independently of runtime changes.
- [x] **2.3 — Extend BSON fake Mongo, not map-backed ownership mocks.** `calendar-multi-memory.ts` currently implements `$setOnInsert`, replacement, `findOne`, and limited `find`; it does **not** implement production session mutations or a stock saver. Add tested nested `$set`/`$inc`/`$max`, `$and`/`$ne`, correct null/missing matching, `findOneAndUpdate` before/after documents, `insertOne`, `deleteOne`, `bulkWrite` ordered/update upsert behavior, no-op `createIndex`, `find().sort()` string/object forms, projection, `limit`, `toArray`, `next`, `hasNext`, `close`, and async iteration. Preserve BSON Binary/Decimal128 via BSON round-trip. Every operation's **execution/consumption**, not cursor construction, passes through the probe. `bulkWrite` emits modeled wire batches independently of repository calls; explicitly label limits of that fake.

  For nested mutations, use this setter, not `{ ...doc, ...update.$set }`:

  ```typescript
  function setPath(record: Record<string, any>, path: string, value: unknown): void {
    const keys = path.split('.');
    let target = record;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys[keys.length - 1]!] = value;
  }
  ```

  Keep this test-only dynamic-object helper local; test `execution.ownerId` actually changes the nested field and `$inc` preserves other nested keys. Add before-write, after-write/lost acknowledgment, read, failed CAS, held write and individual bulk-item fault controls. Fake errors must not print supplied values. The fake does not certify MongoDB semantics; T10 does.
- [x] **2.4 — Compose real adapters in `latency-runtime-fixture.ts`.** Use `createPersistenceBundle` with a driver-shaped fake (`db`, bound `appendMetadata`, EventEmitter monitoring), `MongoOwnership`, `MongoCheckpointFactory`/stock saver and existing context assets/config fixture. Do not replace `owner.run/fence/acquire` with no-ops or use `MemorySaver` for this baseline. Keep delayed bootstrap/index setup outside the measured turn, but count first-session/first-boundary initialization inside it.

  Expose exactly `createLatencyFixture({ path: 'text' | 'calendar', probe, readMs, writeMs })`, returning `{ runtime, persistence, identity, modelCalls, googleEffects, frames, submit, execute, run, close }`. `run<T>(operation: () => Promise<T>): Promise<T>` advances queued storage waves and flushes microtasks until the operation settles; it rethrows faults and exposes `probe.events`. `submit` uses stable incrementing `request-0001` keys. `execute` uses both emit callbacks and captures protocol frames. `close` drains work and the fake client. Expose no production configuration inputs.

  Reuse scripted wires/default entries/gates from `calendar-runtime.fixture.ts` through a test-only optional bundle override and an awaited `ready` seed; never silently swap real native repositories back to Calendar's in-memory ones. Add optional dependency override to `text-config-fixture.ts` before constructing its assembler/runtime, retaining defaults for existing tests. Seed Calendar connections with `await`, not the fixture's existing unawaited startup seed. Test baseline includes every repository used by Calendar, not just accounting.
- [x] **2.5 — Record numeric baseline in future `verification.md`.** Run the following for both zero-latency and modeled 67/449 ms profiles:

  ```text
  npm test -- test/performance/durable-latency.spec.ts --reporter=verbose --silent=false
  npm test -- test/performance/conversation-latency.spec.ts test/performance/latency-storage.spec.ts
  ```

  Report complete logical ops, wire ops, ownership guard reads, saver reads/writes, phase waves, first dispatch/delta/end/seal/terminal/release. Add table-driven scenarios: new text; 1/20/39-completed-turn text follow-up within default 80-message bound; 50-turn fixture with explicit 500-message **test-only** budget; Calendar ordinary text/read/create/conflict/proposal reply; rejection retry; cancellation before dispatch/midstream; reconnect and finalization recovery. Do not change production 80-message limits.
- [x] **2.6 — Add non-self-referential gates.** Assert provider wire `user` for every attempt, one accepted input in context, stable model/privacy/schema, call/result grouping, no second create, immutable message order, pending status before terminal, zero active work at completion. Compare database event counters with the fake driver's independently recorded calls and assert each trace has no unresolved operation at release. Store baseline numeric measurements only after running tests; later tests compare fixed measured ceilings/ratios, not a second copy of newly optimized code.

## Task 3 — Reuse actual acknowledged CAS envelopes, not optimistic cached values

**Files:** receipt, store, repository, Calendar receipt units.

- [x] **3.1 — Add failing adapter tests** to `backend/test/performance/latency-storage.spec.ts`, `backend/test/persistence/calendar-accounting.spec.ts`, `backend/test/persistence/calendar-multi-accounting.spec.ts`. Cover fresh identity/timing update success with zero preliminary envelope reread, stale receipt/CAS mismatch, existing exact duplicate, wrong-store/collection/scope receipt, changed immutable identity, ambiguous write with exact later readback, timeout with late success, private claims preserved, and nonregressing Decimal128 cost. A stale receipt may not turn a conflict into a success. Money-changing updates have the additional settlement reads described below; do not assert those away.
- [x] **3.2 — Introduce a small opaque receipt primitive** in `confirmed-record.ts`:

  ```typescript
  declare const confirmation: unique symbol;
  export type ConfirmedRecord<T> = Readonly<{
    record: Readonly<T>;
    [confirmation]: true;
  }>;
  export type CasConfirmation<T> =
    | { outcome: 'confirmed'; receipt: ConfirmedRecord<T> }
    | { outcome: 'conflict' | 'uncertain' };
  ```

  Implement issuance/lookup as a `WeakMap<object, { store: RecordStore; collection: string; id: string; revision: number; encoded: StoredDocument }>`; only the store/owning adapter can mint it. Deep-freeze a cloned JSON-safe public record, retain a separate private canonical record/encoded envelope, keep private encoded claims hidden, and reject forged/wrong-scope/mutated receipts before DB dispatch. Public nested data cannot alter the expected private payload. No process-global keyed record cache. Receipts prove **a past acknowledgment**, not continuing executor authority. They remain conditional expected versions; CAS still decides whether they are current.
- [x] **3.3 — Add minimal store methods; keep old signatures available.** `readConfirmed(collection, schema, filter)` returns receipt/null; `insertConfirmed` uses existing `insert` logic but returns raw revision 0 only for a known new insert, otherwise exact decoded readback; `replaceConfirmed(expected, schema, next, limit)` validates issuer/identity, uses `_id + user/session + _revision`, requires `acknowledged===true && matchedCount===1`, and returns next receipt. On error/zero match, bounded exact readback must check revision **and** canonical payload. If later state differs, return conflict/uncertain, not a fabricated next revision. Never automatically repeat the mutation on timeout.

  Retain `raw/read/insert/replace` for existing callers. Refactor their shared encoding/confirmation internals rather than implement two divergent idempotency algorithms.
- [x] **3.4 — Add concrete repository fast methods, without breaking legacy doubles.** Use `ConfirmedRecord` as an internal TypeScript import only; do not put tokens/revisions into HTTP or stored public schemas:

  ```typescript
  // Optional additive capabilities in contracts/repositories.ts.
  // Concrete Mongo implementations provide every method below.
  appendConfirmed?(record: MessageRecord): Promise<ConfirmedRecord<MessageRecord>>;
  getConfirmed?(userId: string, sessionId: string, messageId: string): Promise<ConfirmedRecord<MessageRecord> | null>;
  updateCompletionConfirmed?(expected: ConfirmedRecord<MessageRecord>,
    status: MessageCompletionStatus, truncated: boolean): Promise<ConfirmedRecord<MessageRecord>>;
  putAttemptConfirmed?(record: AttemptRecord): Promise<ConfirmedRecord<AttemptRecord>>;
  getAttemptConfirmed?(userId: string, sessionId: string,
    attemptId: string): Promise<ConfirmedRecord<AttemptRecord> | null>;
  compareAttemptConfirmed?(expected: ConfirmedRecord<AttemptRecord>,
    next: AttemptRecord): Promise<CasConfirmation<AttemptRecord>>;
  getAccountingConfirmed?(userId: string, sessionId: string,
    attemptId: string): Promise<ConfirmedRecord<AccountingRecord> | null>;
  putAccountingConfirmed?(record: AccountingRecord,
    expected?: ConfirmedRecord<AccountingRecord>): Promise<ConfirmedRecord<AccountingRecord>>;
  putConfirmed?(manifest: AgentMemoryManifest,
    expected?: ConfirmedRecord<AgentMemoryManifest>): Promise<ConfirmedRecord<AgentMemoryManifest>>;
  ```

  Place each declaration on its actual owning interface, not one giant interface. Add memory's scoped `getConfirmed(userId, sessionId)` separately (no messageId argument). Legacy methods delegate to the same implementation and discard the returned receipt. Every fast method applies the same schemas, bounds, immutable linkage, allowed transitions, generation claims, and nonregression rules as its strict sibling. Receipt input does not waive authority/retention/current-source checks.
- [x] **3.5 — Return real Calendar envelopes including private claims.** Add optional `getBudgetConfirmed`, `createBudgetConfirmed`, `getDispatchConfirmed`, `reserveDispatchConfirmed`, `updateDispatchConfirmed`, and `compareBudgetConfirmed` to `CalendarAccountingStoreV2`; signatures:

  ```typescript
  type ConfirmedBudget = ConfirmedRecord<CalendarTurnBudget>;
  type ConfirmedDispatch = ConfirmedRecord<CalendarModelDispatchV2>;
  type CalendarDispatchSave = {
    dispatch: ConfirmedDispatch;
    budget: ConfirmedBudget;
  };
  // scope arguments for both getters remain the existing user/session/turn or user/dispatch IDs.
  // createBudgetConfirmed(record): Promise<ConfirmedBudget>
  // reserveDispatchConfirmed(record, budget): Promise<CalendarDispatchSave>
  // updateDispatchConfirmed(expectedDispatch, next, expectedBudget): Promise<CalendarDispatchSave>
  // compareBudgetConfirmed(expectedBudget, next): Promise<CasConfirmation<CalendarTurnBudget>>
  ```

  `reserveDispatchConfirmed` must await draft insert **then** durable budget claim, returning actual post-claim budget receipt. `updateDispatchConfirmed` validates evolution and non-null generation/request identity, token/cost nonregression, persists dispatch, then conditionally settles money in budget. Receipt budget preserves `_calendarClaims` and debit entries, actual `_revision`, Decimal128 encoding, and public revision. If money settlement is unchanged, return the prior confirmed budget. If changed, require acknowledged matched CAS or exact readback; the present unchecked `replaceOne` result in `recomputeBudgetMoney` cannot authorize a new continuation.

  Ambiguity between dispatch and budget keeps the old reservation conservatively held; mark cache invalid and reconcile from durable claims before further spend. Do not return a success receipt for only half of that operation. Old `putDispatch` and `compareAndSwapBudget` retain strict storage reads and return shapes, including Calendar recovery's callers.

  Initially retain bounded authoritative dispatch-list recomputation on **money-changing** updates, using expected budget receipt to avoid the unnecessary preliminary budget reload where valid. A budget's private claims identify reservations but do not prove every dispatch's current settled contribution; a cached public total alone cannot justify subtracting a reservation. Return the actual acknowledged post-recompute budget receipt. If the complete contribution set is unavailable/changed, reload it (≤8 dispatches), confirm its linkage to claims, then CAS; on conflict invalidate and reconcile. Receipt optimization primarily removes repeated envelope reads for identity/timing and counter evolution, not these indispensable settlement dependencies. Recovery retains the strict scan. No unproven arithmetic-delta settlement shortcut is part of this plan.
- [x] **3.6 — Use receipts in `CalendarTurnLedger`.** Keep value getters for request building; maintain receipt twins only when supported. Remove local guesses such as `confirmedBudget.revision + 1` after `putDispatch`. Cache only returned confirmed envelopes. Clear both value/receipt caches on conflict, uncertain write, account change, recovery, or failed drain. Serialize `observe`, `reserveDispatch`, `finishDispatch`, and budget mutation through the ledger's existing queue; adding a stream writer must not race the same dispatch/budget through different queues.
- [x] **3.7 — Run green.** From `backend`:

  ```text
  npm test -- test/performance/latency-storage.spec.ts test/persistence/calendar-accounting.spec.ts test/persistence/calendar-multi-accounting.spec.ts test/runtime/calendar-budget.spec.ts test/model/accounting.spec.ts
  npm run build
  ```

  Expected: nonempty suites pass; known fresh update avoids at least one envelope read, but ambiguous update still reads. An injected budget CAS conflict prevents the continuation fetch and leaves held money nonzero. Assertions cover exact cost strings (including zero), held+settled cap, unknown usage, retry linkage, and generation unique-claim failures.

## Task 4 — Short owned phases and a real in-process handoff/drain barrier

**Files:** ownership/work/owned-phase units. This is not a distributed transaction/fence.

- [x] **4.1 — Write failing phase tests.** Two independent writes in one phase should perform one executor/lease validation pair, not two. Start a phase, block a write, request `releaseExecutor` or same-process handoff, and prove control mutation waits. Simulate expired lease before the next nested operation; it must not dispatch. A visible timeout must leave the underlying promise in pending work and prevent release/new work even if a sibling already failed.
- [x] **4.2 — Add `runPhase` and a finite phase token to `MongoOwnership`.**

  ```typescript
  export type OwnedPhaseName =
    | 'acceptance-stage' | 'acceptance-publish'
    | 'publication-stage' | 'publication-commit' | 'model-observation';
  export type OwnedPhaseOptions = {
    name: OwnedPhaseName;
    deadlineAt: number;
    maxOperations: number;
  };
  // MongoOwnership:
  // runPhase<T>(lease: ExecutionLease, options: OwnedPhaseOptions,
  //   action: () => Promise<T>): Promise<T>
  ```

  Keep `exclusive`'s global tail. At phase entry validate executor and session once under the lane; retain the decoded session from that very fence query so acceptance can verify its exact active slot without another speculative read. Install a per-owner `AsyncLocalStorage` token containing exact lease identity/generation, deadline, operation ceiling, active flag, and a set of operations. `run` inside that exact active token invokes its action without reacquiring the queue/fence, but checks deadline, lease expiry, journal health, and operation ceiling **before every nested action**; it tracks the returned promise. A mismatched lease, nested phase, exhausted/expired token, or action starting after token closure fails before dispatch. Outside the token, existing `run` retains full guards.

  Initial phase ceiling: 8 repository actions, deadline `min(now + persistenceTimeoutMs, lease expiry - 1_000 ms)`. These internal ceilings require no new settings surface. A phase with insufficient remaining lease time must exit/renew **outside** the phase, then begin afresh. No provider call, stream emit, arbitrary timer, graph `invoke/updateState`, heartbeat renewal, or durable recovery scan inside a phase.

  A repository action can itself await multiple writes. Add `RecordStore.beforeMutation?: () => void`, installed by the owner, to inspect the current phase token immediately before **each actual driver mutation**, including adapter-internal continuations. Its collection facade must operate when this guard exists even if timing hooks are absent. The callback is a no-op outside a phase; inside, an expired/failed/inactive token throws before dispatch. Do not count a repository action limit as a native-command bound. Test a two-write action whose first write finishes after the phase deadline: the second mutation must not start. Checkpointer writes remain individually guarded outside phases, so they need no phase bypass.
- [x] **4.3 — Drain every child before closing a token.** The phase must `await Promise.allSettled` on all tracked operations in `finally`, then mark token inactive. Failures latch and forbid new nested actions. `Promise.all` alone is unsafe for independent writes because it rejects while siblings continue. A call-site pattern for exactly independent staging is:

  ```typescript
  const staged = await job.wait(p.owner.runPhase(lease, phaseOptions, async () => {
    const results = await Promise.allSettled([
      p.owner.run(lease, () => p.messages.appendConfirmed!(input)),
      p.owner.run(lease, () => p.metadata.putAttemptConfirmed!(attempt)),
    ]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return results.map(result => {
      if (result.status !== 'fulfilled') throw new AppError('PERSISTENCE_ERROR', 'The chat could not be saved.');
      return result.value;
    });
  }), persistenceTimeoutMs);
  ```

  This shows operation order/draining, not a typed heterogeneous tuple implementation: use separate fulfilled-result narrowing at the actual call site to retain message/attempt types. `phaseOptions`, `persistenceTimeoutMs`, `job`, `lease`, `input`, and `attempt` are the live call's existing values. Track the **raw entire phase promise** with `Work.track` before any visible timeout; never replace it with just a `Promise.race` result in pending tracking.
- [x] **4.4 — Serialize executor control on the same lane.** Public `claimExecutor`, `handoffStoppedExecutor`, and `releaseExecutor` must enter exclusive control actions; extract private unlocked cores where claim calls handoff to avoid self-deadlock. `drain` observes all phases and the existing journal; stopped/failed controls reject admission. `releaseExecutor` must not remove a sentinel while an earlier phase or raw write is unresolved. Read-only `assertExecutor` remains fresh outside a phase. Process-external handoff cannot be locked by ALS: retain stopped-owner proof/local guard requirements and the one-live-executor operator rule, explicitly documented.
- [x] **4.5 — Preserve local-journal semantics with a strict fallback.** The phase never bypasses `guardedClient`/`MutationJournal.write`; journal writes remain serialized with majority+journal intent/ack. Do **not** group many writes under one journal token. Initially disable phase guard-elision/concurrent staging when `owner.journal` exists: use the existing individually guarded sequential path. A pre-enqueue deadline check does not prove a mutation still has authority after waiting in a journal queue. Supporting optimized phases there would require an additional actual-dispatch check inside the journal and its recovery proof, which is not necessary for the observed nonlocal bottleneck. Test both modes and verify fallback command semantics; do not enable local recovery as a speed knob.
- [x] **4.6 — Add `Work.settled` fixed-point draining and release assertions.** Drain snapshots in a loop until `pending.size===0`, because a finishing writer can enqueue its one pending latest snapshot. `close` still fails with a live heartbeat/pending write; do not silently clear pending sets. A timed-out write quarantines/degrades runtime and retains durable active slot/owner until raw settlement. A finite shutdown can report `drained:false` without relinquishing executor/client. No new lease is issued to compete with a late write.
- [x] **4.7 — Run green.**

  ```text
  npm test -- test/persistence/owned-phases.spec.ts test/persistence/local-owner.spec.ts test/persistence/mutation-journal.spec.ts test/runtime/work.spec.ts test/runtime/stream-quiescence.spec.ts
  npm run build
  ```

  Expected: one guard pair per eligible phase; queued control cannot overtake; expired token dispatch count unchanged; errors survive all-settled drain; old individually guarded behavior remains for unsupported phases. Do not introduce per-session lanes in this task.

## Task 5 — Reduce shared durable admission to ordered write phases

**Files:** runtime, history, ownership, receipt-enabled repositories and existing acceptance suites.

- [x] **5.1 — Write admission ordering tests in `durable-latency.spec.ts`.** Gate input, attempt, and optional proposal-binding writes independently. Neither acceptance marker, `latestTurnId`, acceptance response, visible new session, nor model fetch may precede all prerequisite acknowledgments. Fail one prerequisite while another remains held; assert no marker and no release until the held operation settles. Recovery must preserve orphan input and allow only an identical resubmission. Test retry acceptance separately, reusing original input and original Calendar deadline.
- [x] **5.2 — Coalesce existing read waves.** Parallelize initial independent `sessions.get` and `getAttemptByIdempotency`, preserving visibility/mismatch checks. Reuse `createIfAbsent`'s returned record rather than load the same session again, but preserve existing-session lifecycle checks and latest-attempt validation under ownership. Within `checkBoundary`, start manifest read, graph-state read, and `acceptedHistory` independently after acquiring a validated epoch; these must all finish before initialization/matching. Within `acceptedHistory`, fetch archive pages and attempt pages concurrently; acceptance-marker chunks follow discovered attempts, not vice versa. Pagination within each cursor chain stays sequential. Errors wait for all started reads before release.
- [x] **5.3 — Keep ordering state in metadata.** `allocateSequences` stays durable/idempotent; do not move counters/reservations into sessions without D8. On a new empty session, query prior-message and prior-reservation absence in parallel before first counter insertion; do not initialize a missing counter over old records. Reuse the resulting reservation in a live admission receipt so attachment does not reserve/read it again. Gaps after uncertain counter increments are acceptable; reusing a sequence for a different record is not.
- [x] **5.4 — Stage independent immutable prerequisites together.** After reserve slot + sequence allocation + bounded payload validation, run input append and attempt insertion concurrently under `acceptance-stage`. Retry stages only its new attempt (original input already durable). Proposal reply binding can share the stage **only after** its reference is validated and only if the persistence implementation does not require the new attempt to have acknowledged first; otherwise put it in a subsequent bounded stage and count that dependency. Preserve changed/missing reply-reference idempotency refusal.

  Calendar `currentAccount` for lazy budget admission is a read, not permission/dispatch evidence; it may overlap staging, but all its launched work must settle before admission returns. Preserve ordinary-text fallback if Calendar unavailable and do not create a Calendar budget prematurely.
- [x] **5.5 — Publish acceptance from issued receipts.** Extend concrete `confirmAcceptance(lease, attemptId, evidence?)` with `{ input: ConfirmedRecord<MessageRecord>; attempt: ConfirmedRecord<AttemptRecord> }`. Validate role, scope, turn, hash, active slot, immutable linkage against opaque receipts. Under `acceptance-publish`, write acceptance marker **after** prerequisites; then conditionally set session `latestTurnId`. Retain the old strict readback route for recovery, duplicates, or absent receipts. Do not put marker + prerequisites in unordered bulk/parallel operations.

  Return a typed `AcceptanceRecord` inferred from existing `acceptanceSchema`; do not invent a second persisted marker format. If the marker has committed but session update is ambiguous, no fast response/receipt until exact session confirmation. A repeated command uses strict durable evidence; never infer acceptance merely from attempt existence.
- [x] **5.6 — Confirm admission release and preserve its result.** Add `detachAccepted(lease, attemptId): Promise<{ releasedGeneration: number }>`: conditional session mutation by user/session/owner/generation/activeAttempt, clearing **only owner/lease**, not active attempt. Require acknowledged match or strict exact session readback. Build the disposable admission receipt only **after** raw work and detach acknowledgment. HTTP acceptance response still waits for this cleanup. Do not retain the lease across a user who never attaches SSE.
- [x] **5.7 — Green + fault matrix.** Run:

  ```text
  npm test -- test/performance/durable-latency.spec.ts test/runtime/text-config.spec.ts test/runtime/calendar-runtime-regressions.spec.ts test/runtime/calendar-budget.spec.ts
  ```

  Expected fewer actual guard/read waves on both model paths; no promise of four wire commands. Test first chat, same-key same/different content, different reply reference, simultaneous identical requests, distinct-tab request, existing archived chat, orphan after later accepted input, absent sequence state with prior records, missing/uncertain marker, maximum capacity, abandoned accepted attempt, internal/live visibility, and explicit retry. Native acceptance/isolation suites are T10/D4, not waived.

## Task 6 — Reuse a bounded admission receipt during HTTP stream attachment

**Files:** admission-receipt unit, runtime/ports, HTTP service/transport, observed wrapper and tests.

- [x] **6.1 — Add fail-first regression for actual HTTP preparation.** On a same-process submit+attach with no intervening mutation, assert one full history/graph-boundary validation **across both requests**, one accepted-input receipt, and no attachment Calendar status projection. Count transport status reads as well as runtime. Expired/invalid receipt must use strict path or safely reject, never infer.
- [x] **6.2 — Define the disposable receipt, not a durable cache.** In `admission-receipt.ts`:

  ```typescript
  export type AdmissionReceipt = Readonly<{
    userId: string; sessionId: string; turnId: string; attemptId: string;
    executorId: string; releasedGeneration: number; expiresAt: number;
    attempt: ConfirmedRecord<AttemptRecord>;
    input: ConfirmedRecord<MessageRecord>;
    acceptance: AcceptanceRecord;
    reservation: Readonly<{ start: number; count: number }>;
    manifest: AgentMemoryManifest;
    sourceRecords: readonly MessageRecord[];
    refreshRefs: readonly MessageRef[];
    boundary: Boundary;
    checkpointId: string;
    graphEpoch: number;
    responseMode: ResponseMode;
    configRevision: number;
  }>;
  ```

  Import `AcceptanceRecord` from the inferred existing marker type, `Boundary` from `agent/state`, and existing context/message types. Store **no credentials, new settings copy, rendered context, Calendar rights, source/tool payload cache, or voice delivery projection**. Use the already-bound `attemptSettings` separately. Retain only manifest-selected immutable plain-text records, not the whole accepted archive. Put records with any Calendar provenance, internal/live delivery, or redaction possibility in `refreshRefs`; reload those through existing bounded scoped `getReferences` and fresh voice evidence before assembly. Do not retain their source content in the receipt.

  Limits: 128 entries, ≤2 MiB serialized nonsecret records per entry, ≤16 MiB total, TTL `min(release time + 60_000, accepted turn deadline if present)`. These bound cache memory, not authoritative history. Oversize/full cache evicts oldest receipt and uses strict attachment; it must not reject an otherwise valid submission or remove bound accepted settings. Expiry on read/insert, no leaking background timer. Existing 1,024 bound-settings cap is unchanged.
- [x] **6.3 — Add exact atomic attachment.** Concrete owner method:

  ```typescript
  // attachAccepted({ userId, sessionId, attemptId, expectedGeneration?, leaseMs })
  // -> Promise<{ lease: ExecutionLease; session: SessionRecord }>
  ```

  Under executor control lane, `findOneAndUpdate` filters active lifecycle, owner null, exact activeAttemptId, safe generation and optional receipt's `releasedGeneration`, increments generation, sets lease, returns session after. This replaces unguarded preliminary session get + broadly scoped `recoverStoppedSession(..., null, ...)` for live attachment. On ambiguous write, use exact intended owner/generation/expiry readback; failure cannot fall back to arbitrary recovery/acquisition. No new instance fencing claim.
- [x] **6.4 — Fast attachment still validates authority and moving evidence.** Consume receipt once only after reserving Work; validate user/session/turn/attempt/internal-vs-text scope, executor ID, TTL, bound settings identity/assets/schema version, and returned session latestTurn/active slot. Reuse immutable input/marker/reservation/history; fetch current manifest once and compare **full manifest**, not only contextVersion. Reassemble context with fresh sensitive refs/voice evidence and existing budgets; re-evaluate expiry at use. Bound config is intentionally allowed to survive ordinary settings changes as existing text-config behavior requires; do not replace it with current settings. If assets/provenance incompatible or Calendar account/policy changed, invalidate and strict-read or fail according to existing semantics. Fresh account/rights/provider gates at actual disclosure/effect remain.

  Skip full graph boundary reread only when the stored checkpoint identity and a runtime-owned per-session graph-mutation epoch are unchanged. Maintain that epoch at every graph `invoke/updateState`, reconcile, rebase, cancel and retention/quiescence operation owned here; invalidate before the first await of those paths. If a mutator cannot participate (including direct operational graph writes), do **one pinned graph-state read** and validate boundary/next/tasks instead of trusting an epoch. Never cache unpinned “latest” across graph mutations.
- [x] **6.5 — Remove transport's discarded Calendar projection without changing public status.** Add optional `ChatRuntime.getStreamAttempt(userId, sessionId, turnId): Promise<TurnStatusResponse>` and delegate it through `observedRuntime`. It returns a scoped accepted hint from a valid receipt or strict visible status otherwise; it does **not** execute inference or grant a lease. Add `ChatHttpService.streamStatus(sessionId, turnId)` validating path/server identity and calling it, falling back to ordinary `getTurnStatus` after session visibility check. `ChatStreamTransport.open` calls `streamStatus`; public `status` endpoint still includes Calendar operation/receipt state. Do not project current Calendar state solely to discard it. `executeTurn` remains final authority and does atomic attachment before any provider dispatch.
- [x] **6.6 — Invalidate and fallback deliberately.** Delete receipts synchronously on cancellation request, retry replacement, rebase/reconcile entry, uncertain write, terminal/failure, executor change, stream quiescence/retention, and drain. Restart creates an empty holder. Do not authorize restart-resumed inference without bound settings; current restart behavior may require reconciliation/interruption. A valid receipt never converts a terminal reattachment into a new execution. Tests with all optional fast capabilities removed must pass via strict legacy route.
- [x] **6.7 — Verify.**

  ```text
  npm test -- test/performance/durable-latency.spec.ts test/runtime/text-config.spec.ts test/runtime/voice-history.spec.ts test/runtime/stream-quiescence.spec.ts test/http/stream-transport.spec.ts test/http/calendar-stream.spec.ts
  ```

  Expected no duplicated immutable history work on eligible same-process attachment; strict readback on TTL/eviction/restart. Faults: cancel between status hint and CAS, two attachers, archived/deleted chat, changed manifest same version, receipt wrong user/session, expired/revoked Calendar source, changed voice heard state, Calendar disconnect, asset change, newer accepted retry, stale generation, missing bound settings, stream disconnect before consume, and cleanup failure. No source redaction bypass or hidden voice data disclosure.

## Task 7 — Reduce text AND Calendar finalization without early completion

**Files:** shared finalization/publication/reconciliation, receipt-aware message/memory/metadata, ownership/runtime.

- [x] **7.1 — Pin the recovery/barrier matrix first.** Extend `finalization-repair.spec.ts` and `calendar-publication.spec.ts` with fault-before, fault-after-ack, timeout-later-success, and process-restart at every boundary in this table:

  | Boundary | Durable state allowed | Required behavior after restart |
  | --- | --- | --- |
  | Before sealed result/decision checkpoint | Generating, possible billing/effect evidence | Interrupt/reconcile; never silently rerun inference/uncertain create |
  | Seal acknowledged | Saved exact answer + accounting/decision refs | Publish that answer without provider replay |
  | Archive or final accounting staged | Provisional assistant; no terminal attempt | Idempotently repair remaining prerequisite; no duplicate message |
  | Target manifest acknowledged | Base/target recognized, active attempt retained | Publish graph boundary from saved result; no new inference |
  | Graph boundary acknowledged | Target manifest and graph agree | Complete archived message, then attempt |
  | Message completion acknowledged | Message completed/truncated; attempt nonterminal | Finish exact attempt CAS/release; no false ready signal |
  | Attempt terminal acknowledged | Durable terminal plus active owner/slot possibly retained | Clear/release only same attempt/generation; no emit before cleanup |
  | Session release acknowledged | Owner/slot null, activity advanced | Reattach saved completion; immediate follow-up allowed |

  For archived message visibility between final boundaries, preserve existing wire semantics; never label an attempt completed before its required graph/application evidence. Cancellation after seal does not erase the saved answer. Disconnect after seal only affects delivery, not publication.
- [x] **7.2 — Add a live-only publication evidence parameter.** `publishResult` accepts optional `{ acceptedInput, acceptance, baseManifest, sourceRecords, confirmedSnapshot, attemptReceipt, accountingReceipt }` minted/retained by the current owned execution. Validate exact result/attempt/input/target identity, immutable acceptance and checkpoint ID. Reuse the already-confirmed post-invoke snapshot instead of another unpinned `getState`, and reuse base originals for target validation when not sensitive. Current manifest must still equal base or target; sensitive/source records are reprojected at use. Recovery calls omit this parameter and retain strict `checkedResult`, source reads, graph snapshot, and allowed base/target checks.

  Do not treat the value returned by `graph.invoke` as a durable receipt. Retain one explicit post-invoke `getState` confirmation initially; sync alone does not replace the saved-result check.

  Add `transitionConfirmed(p, lease, work, expected: ConfirmedRecord<AttemptRecord>, status, errorCode?) -> Promise<ConfirmedRecord<AttemptRecord>>` beside `transition`, implemented with `compareAttemptConfirmed` and the same transition rules. The live runtime carries the returned receipt through generating, identity, finalizing and terminal changes; `a` is always derived from that latest confirmed record. Legacy/recovery callers keep `transition`. Extend `CalendarTurnPublication` with optional `liveEvidence: { attemptReceipt; confirmedSnapshot; baseManifest; acceptedInput; acceptance }` using the same concrete types as the text parameter, not a caller-supplied boolean `trusted`. Runtime's accounting write closure captures returned `putAccountingConfirmed` receipts; model/accounting modules need not import persistence receipt types. A missing capability uses strict paths, not a fabricated receipt.

  For text's optional live evidence, add `onAttemptConfirmed(receipt: ConfirmedRecord<AttemptRecord>): void` so the existing `publishResult` return type can remain `AttemptRecord` while the runtime receives the final receipt for cleanup. For Calendar change the optional cleanup callback additively to `beforeTerminal(completion: { attempt: AttemptRecord; receipt: ConfirmedRecord<AttemptRecord> | null; activityAt: string | null }): Promise<void>`; zero-argument legacy callbacks remain valid. Publisher passes its latest acknowledged terminal receipt and archived activity time, not the original generating attempt. Strict recovery can read a missing receipt rather than claim one.
- [x] **7.3 — Stage independent publication prerequisites once.** Under `publication-stage`, append the provisional assistant with `appendConfirmed` and save final authoritative accounting in parallel on text. Both depend on the saved seal; neither depends on the other. Calendar's aggregate/decision outcome already required by its seal remains awaited; do not save it twice or move it after disclosure. Retention/source registration must have acknowledged before retained/source-derived result publication as currently required; it is not independent telemetry.

  If the assistant exists, compare stable content/identity and permit only existing streaming or the exact final outcome. Redaction-aware Calendar normalization must accept the authoritative tombstone, never resurrect expired content to satisfy string equality. Preserve BSON legacy `voiceTranscripts:null` compatibility tests. Do not insert a completed assistant at this stage.
- [x] **7.4 — Preserve dependent publication order; use CAS receipts within it.** Commit target manifest using its confirmed expected base; then `graph.updateState(...boundary..., 'seal')`; then confirm graph boundary with one pinned state load; then `updateCompletionConfirmed` on the archive receipt; then terminal attempt CAS on its receipt. Calendar must not transition generating→completed directly: keep explicit finalizing (idempotent same-state CAS may be skipped only with an acknowledged identical record). Text `checkedResult` still expects the **saved** assistant to be streaming; do not mutate the saved result schema to match the published copy.

  Where receipts are missing, strict methods remain. Do not parallelize manifest with its graph publication, attempt completion with message completion, or terminal SSE with cleanup. Confirm graph `next`, errors/interrupts, attempt identity, and boundary; checking boundary hash alone is insufficient.
- [x] **7.5 — Fold activity, clear slot, owner release into one session CAS.** Add concrete `finishAttempt(lease, terminalAttemptReceipt, activityAt): Promise<void>`. After heartbeat stops and raw tracked work settles, validate terminal receipt and update the same session document by exact user/session/owner/generation/activeAttempt: `$set` activeAttempt/owner/lease null, `$max` activity/updated time, `$inc` revision. On ambiguity, exact scoped readback can confirm cleared fields and sufficient activity **only if generation still matches**; do not declare success by observing a newer attempt's cleanup. If no match because newer work exists, do not clear it. Recovery without terminal receipt loads strict terminal attempt first. Keep `clearAttempt/release` for orphan/recovery/live-delivery cases that cannot use the combined operation safely.

  Live voice settlement keeps its distinct delivery owner until `c.live.settle` and delivery writes drain; optimize its shared staging but do not release it early merely to match text timings.

  Replace successful text's separate `clearAttempt`/`release` calls with `finishAttempt`, then set local `lease = undefined` before `job.close`. Calendar's `beforeTerminal` uses the supplied terminal receipt, calls `finishAttempt`, and its enclosing release callback only clears the local lease reference/closes the same job; it must not issue another storage release. Keep `finally` cleanup only when a lease remains. Preserve WorkRegistry's identity check so an older callback cannot close a follow-up job created by terminal delivery.
- [x] **7.6 — Delete the optional finalization mutation.** Remove awaited `putAccounting(...durableCompletedAt...)` from `publishResult`. Emit the timing through bounded telemetry **after required durability** instead. Leave persisted `timing.durableCompletedAt` nullable for compatibility; no reader may interpret null as failed completion. Do not launch a best-effort DB promise after release or invent an outbox solely for this field. If durable timing is later required, decide a same-record replayable marker design separately.
- [x] **7.7 — Preserve both runtime and transport terminal barriers.** Close job and runtime slot, then let transport reservation settle and remove its attachment, then deliver held terminal status/reset deltas/completed. Direct callbacks and HTTP immediate follow-up must see zero conflicting reservation/work. A failed final drain cannot yield completed; retain saved result and mark finalization-needed/degraded, not a failed answer that gets reinferred.
- [x] **7.8 — Green.**

  ```text
  npm test -- test/runtime/finalization-repair.spec.ts test/runtime/calendar-publication.spec.ts test/runtime/accounting-completion.spec.ts test/runtime/calendar-recovery.spec.ts test/runtime/calendar-recovery-unavailable.spec.ts test/http/calendar-stream.spec.ts test/performance/durable-latency.spec.ts
  ```

  Expected fewer post-seal guard/read/write waves on plain text and Calendar. Re-run existing completion-callback follow-up probes. Recovery twice yields one assistant, one accepted input, same generation mapping, zero extra model calls/Calendar create effects. Missing/expired narration interrupts safely while preserving durable operation receipt; terminal distinctions and truncation remain exact.

## Task 8 — Supervised bounded observation writer on both model paths

**Files:** writer/model/ledger/work units. Default keeps identity save-before-output. No global background queue.

- [ ] **8.1 — Add a reusable writer with this exact small API.**

  ```typescript
  export type ObservationWriterOptions<T> = {
    initial: T;
    merge: (previous: T, next: T) => T;
    persist: (snapshot: T) => Promise<void>;
    track: <R>(promise: Promise<R>) => Promise<R>;
    fail: (error: unknown) => void;
  };
  export interface ObservationWriter<T> {
    enqueue(snapshot: T): number;
    flush(): Promise<void>;
    check(): void;
    close(): Promise<void>;
    snapshot(): Readonly<{ inFlight: number; queued: number; closed: boolean }>;
  }
  export function createObservationWriter<T>(options: ObservationWriterOptions<T>): ObservationWriter<T>;
  ```

  Implementation state is one active promise, one coalesced **absolute latest** snapshot/version, one latched error, and closed/draining state. `enqueue` validates/merges synchronously before return; no promise per fragment and no token buffer. No timer loop or detached worker. Start one tracked worker immediately when idle; while pending overwrite only the single validated latest snapshot. On write completion persist the latest if newer. `flush` waits to a fixed point, not only the first pending promise. `close` refuses new enqueues and drains; cancellation must still permit the caller's one final cancellation snapshot before close. Repeated flush/close is idempotent. On rejection latch original error, abort provider/future dispatch through `fail`, and continue to track the raw operation; do not swallow it as telemetry.
- [ ] **8.2 — Test queue bounds and merging before adapter integration.** New `backend/test/model/observation-writer.spec.ts`:

  ```typescript
  it('keeps one pending latest snapshot and drains the raw write', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const saved: number[] = [];
    const pending = new Set<Promise<unknown>>();
    const writer = createObservationWriter<number>({
      initial: 0,
      merge: (a, b) => { if (b < a) throw new Error('regression'); return b; },
      persist: async n => { if (!saved.length) await gate; saved.push(n); },
      track: promise => {
        pending.add(promise);
        void promise.then(() => pending.delete(promise), () => pending.delete(promise));
        return promise;
      },
      fail: () => {},
    });
    writer.enqueue(1);
    for (let n = 2; n <= 100; n++) writer.enqueue(n);
    expect(writer.snapshot()).toMatchObject({ inFlight: 1, queued: 1 });
    expect(pending.size).toBe(1);
    release();
    await writer.close();
    expect(saved).toEqual([1, 100]);
    expect(pending.size).toBe(0);
  });
  ```

  Add tests for synchronous merge conflict before a second save, first-write error, second-write error, enqueue during flush, close during active save, no work after closed, no unhandled rejection, delayed write past visible timeout, and retained raw promise. Run `npm test -- test/model/observation-writer.spec.ts`; expected red before implementation, green after.
- [ ] **8.3 — Keep identity as an awaited priority barrier.** On **every newly available generation ID** (and first provider request ID where currently required), enqueue the observation/record then `await flush` before emitting associated `generation-id`/text/decision/tool chunks. Text additionally awaits its attempt generation CAS and unique generation claim; preserve `a.generationId === chunk.generationId` in runtime. Once known, conflicting generation ID fails; it must not overwrite a queued snapshot. Conflicting exact cost is an error before discard/coalescing. Do not “fix” a provider-request-ID change by rebinding billing generation: preserve original request attribution and either validate documented separate fields or fail closed.

  `CalendarDispatchHooks` gains optional `flushObservations(): Promise<void>` and `checkObservations(): void`; existing `onObservation` remains a persistence callback, not redefined as a lossy enqueue without caller changes. The production binding installs a per-dispatch writer around `ledger.observe`; adapter's changed-enrichment path calls a new optional `enqueueObservation(observation): void`, falling back to awaited `onObservation` for legacy bindings. Identity always calls awaited `onObservation` **or enqueue+flush**, never a queue-only hook. Same signatures on v1 bindings preserve legacy read-only behavior. Validate a snapshot against the latest **enqueued** known fields, not only the last persisted record.
- [ ] **8.4 — Calendar spend authority stays synchronous.** `reserveDispatch`, conservative held USD claim, current account/rights/fence checks, and persisted `dispatched` evidence all acknowledge before fetch. Later model/provider/timing/token/money enrichment may enqueue. The writer persists dispatch+budget settlement through T3 and serializes through the ledger queue. Missing final cost retains the full held reservation, even on cancel/EOF/HTTP error/iterator return; no background queue value may be counted as settled for another model dispatch. Drain before `finishDispatch`, decision save, tool execution, repair/retry/continuation, aggregate, seal, terminal, or ownership release. If settlement fails, stop continuation; do not subtract held money in memory to fit the cap.
- [ ] **8.5 — Plain text uses the same writer, with its real existing limits.** Keep initial accounting seed synchronous. Persist timing `dispatchedAt/dispatchCount` immediately **before each allowed fetch** so there is durable possible-billing evidence even with no generation ID returned. This is an acknowledged conservative claim, not proof that HTTP was sent; failures before fetch can remain conservatively unknown. Definitive 429/503 rejection retry remains bounded and permitted only by current no-ID/no-visible-output rejection rules; ambiguous inference never auto-retries.

  After generation barrier, enqueue later optional reported-model/provider/timing and absolute usage snapshots using existing `mergeUsage/status`, enhanced to reject non-null identity/count/cost regressions before coalescing. Drain before authoritative usage event, adapter `end`, saved graph result, or cancellation outcome. Optional timing-only enrichment may overlap text immediately; a usage-bearing frame can emit its text after identity validation while the usage save runs, but its **usage event and dependent final result** wait for the drain. `AccountingService.snapshot` remains the last **confirmed** snapshot, never newest queued data.

  There is **no current monetary reservation/cap for non-Calendar text**. Preserve null/pending/unknown cost, finite input/output/token/retry limits and possible-billing evidence; never report unknown as zero, refunded, or safe-to-repeat. If the acceptance criteria require a USD cap on this path, stop that enhancement at D3 rather than borrowing Calendar pricing. Safe fallback is synchronous text usage persistence plus queued timing-only enrichment; document the lower speed gain, not fictional cap equivalence.
- [ ] **8.6 — Integrate raw work supervision and cancellation.** Runtime passes `Work.track` and `job.abort` to both writers. Append `supervision?: { track: <T>(promise: Promise<T>) => Promise<T>; fail: (error: unknown) => void }` as the seventh argument of `createModelServices` in `model/index.ts`, after the existing diagnostic sink; append the same optional argument to `OpenRouterAttemptAdapter`. Existing callers remain synchronous if it is absent. Add `AccountingService.saveRaw(record, signal): Promise<void>` that performs current validation, returns the actual repository acknowledgment promise, and updates `latest` only after it resolves; retain existing bounded `save` for strict callers, wrapping that raw method. `persist` must return the **raw repository/owner promise**, not an internal `bounded`/abort race that resolves/rejects before the raw driver operation. The runtime owns the visible persistence timeout using `job.wait`; lower accounting helpers must not hide the raw pending promise. Adapter-only tests use an equivalent explicit tracker. Calendar binding gets the equivalent supervision through its existing ledger job, extended with `track` and failure/abort callbacks.

  Make additions to `CalendarLedgerJob` capability-compatible: `track?<R>(promise: Promise<R>): Promise<R>` and `abort?(code: 'INTERRUPTED'): void`; production `Work` provides both. Without them, the ledger creates no asynchronous writer and retains awaited observations. Every production Calendar identity/enrichment/final-cleanup observation must flow through the **same** dispatch writer; a direct identity callback may not race a previously queued enrichment write. Priority identity means enqueue plus flush on that queue, not a second parallel saver.

  A failed writer is checked before/after each provider frame and every next dispatch, and aborts the fetch controller immediately. Normal end flushes; cancellation/error/early iterator return runs one final outcome save and flush with a separate finite cleanup signal. `finally` cannot swallow cleanup errors; an async generator `return()` must reject persistence failure or expose the same latched runtime failure before release. Track original paid dispatch until settled, including when cleanup times out. Shutdown/quiesce returns `drained:false` and retains/quarantines ownership if raw writes remain. No completed/end/next paid request or lease release through unresolved writer work.
- [ ] **8.7 — Prove the identity/stream tradeoff deterministically.** Gate identity save: no first text. Release identity, gate later timing/model enrichment: text must flow while held, queue remains 1+1. Gate final usage: no decision/end/seal/completed. Inject identity/usage/cost conflict, midstream save failure, cancel, abort, timeout-later-success, iterator break, client disconnect and shutdown. Assert exact generation/user/request binding persisted before text, no continuation spend while held settlement unresolved, and no zeroing/release of unknown costs. Use 100/10,000-fragment fixture streams; memory/save bound must not scale with fragments.

  Commands:

  ```text
  npm test -- test/model/observation-writer.spec.ts test/model/adapter.spec.ts test/model/calendar-adapter.spec.ts test/model/accounting.spec.ts test/runtime/calendar-budget.spec.ts test/runtime/work.spec.ts test/runtime/stream-quiescence.spec.ts test/performance/durable-latency.spec.ts
  ```

  Expected: all nonempty suites pass; first ID still blocks, later eligible enrichment no longer inserts a DB stall before text. Existing six-save Calendar ceiling must not regress without a recorded correctness reason. Do not promise 100× reduction or faster provider compute. Optional D2 implementation is **excluded** until user chooses the crash-window tradeoff.

## Task 9 — Simplify checkpoint reads and preparation, initially still synchronous

**Files:** checkpoints/graph/finalization/runtime units and saver/graph suites.

- [ ] **9.1 — Add fail-first bounded-stock conformance tests.** In `checkpoints-bounded.spec.ts`, compare scoped saver tuples to unmodified `MongoDBSaver` over separately seeded identical fake DBs: checkpoint, metadata, parentConfig, normal/special pending writes and their ordering, overwrite rules, empty thread, explicit historical ID, fresh factory/restart and list pagination. Count wire queries independently: nonempty `getTuple` target is **two**, not four; empty remains one. No private decoder copy.
- [ ] **9.2 — Replace prefetch/delegate duplication with a bounded driver read facade.** Use the existing `guardedClient` facade pattern **inside `checkpoints.ts`**, passed through the public MongoDBSaver constructor client argument. It wraps only the saver DB/collection/cursor boundary, delegates stock `put/putWrites/setup` unchanged to the original (possibly journal-guarded) client, and forwards `appendMetadata` with the original receiver. Do not mutate `this.db`, `this.serde`, or global client prototypes per read; concurrent reads need independent cursor state.

  For a stock `getTuple` checkpoint query: enforce exact bound thread/namespace, optional exact ID, fixed sort/limit 1; on `toArray`, validate raw BSON document bytes, binary checkpoint/metadata fields, scope, IDs and metadata-search budget before returning to stock `loadsTyped`. Its pending query must use the exact checkpoint ID selected by that query, not unpinned latest. Apply `.limit(81)` to the underlying pending cursor **before** fetching; refuse >80, oversized individual/aggregate raw bytes, wrong thread/ns/checkpoint, malformed fields, or invalid task/index/channel identity before stock decodes pending values. Validate checkpoint/metadata and pending budgets separately as existing policy does; never allocate an unbounded pending array just to check it.

  The facade returns the exact validated rows from these queries directly to stock; it is not a cache. For `list`, retain current bounded ID-page→explicit-ID tuple implementation, so it also gets bounded decoding. `putWrites` aggregate size validation and serialized-dump reuse remain in place; do not remove them because reads got faster. Refuse unexpected read API/query shapes rather than forwarding unrestricted operations. Version-sensitive shape change must fail conformance/build gates, not silently disable bounds.
- [ ] **9.3 — Exercise malicious/changed storage before decode.** Spy `serde.loadsTyped`: it must not run on oversized checkpoint, metadata, 81 pending rows, oversized summed pending rows, malformed Binary/type, or wrong-scope record. Test a newer checkpoint inserted between checkpoint read and pending read: tuple stays pinned to the first identity. Test pending rows changing during read: stock consumes precisely the set the bounded cursor validated; no second unbounded refetch. Journal mode must still see all writes and require its normal intent ack. If facade cannot satisfy public-driver compatibility, retain old path and mark D5 blocked; do not copy stock private decoding as an escape hatch.
- [ ] **9.4 — Pass graph state to prepare instead of reading the graph from its node.** Extend hook signature additively:

  ```typescript
  export type PrepareState = Readonly<{
    boundary: Boundary | null;
    calendarCursor: CalendarCursor | null;
    calendarSeal: CalendarSeal | null;
  }>;
  // prepare(input: GraphInput, restored: PrepareState): Promise<void | CalendarGraphPatch>
  ```

  `buildTurnGraph` passes schema-validated state from the current node; runtime Calendar prepare uses it for legacy refusal/resume/initial-cursor selection instead of `graph.getState` from within prepare. Existing one-argument hooks continue to type-check. Preserve same-attempt restored seal routing, stale-other-turn clearing, boundary refusal and legacy pending disposition. Never query a fresh unrelated latest state to route a node that already has its state.
- [ ] **9.5 — Reuse confirmed immutable snapshots only within an owned epoch.** Pass the single post-invoke seal snapshot to T7; pass a pinned boundary-update confirmation into repeated live checks when no intervening mutation exists. `updateState`'s returned config supplies checkpoint ID for the **subsequent confirmation**, not a claim of no pending errors by itself. Recovery and rebase retain durable readback. Do not cache pending-write tuples across `putWrites`, graph invokes, or recovery.
- [ ] **9.6 — Keep graph topology/durability stable in this increment.** Leave `prepare`, `generate`, `calendar_decide`, `calendar_execute`, `seal` and stored graph schema/node names unchanged. Merging seal into a paid-result node would remove a real crash boundary and affect old checkpoints; merging prepare can similarly alter saved next nodes. Those research suggestions are deliberately omitted until D8 plus a migration/recovery proof. No global `async`/`exit`, manual replay from pre-effect checkpoint, or auto-inference to reconstruct lost results.
- [ ] **9.7 — Run offline then native gates.**

  ```text
  npm test -- test/persistence/checkpoints-bounded.spec.ts test/persistence/calendar-checkpoints.spec.ts test/runtime/graph.spec.ts test/runtime/calendar-graph.spec.ts test/performance/durable-latency.spec.ts
  npm run test:e2e -- test/persistence/checkpoints.native.e2e-spec.ts
  ```

  The second command runs **only after D4**, with the exact operator variables; absence is a BLOCKED gate, not passing evidence. Native stock saver setup/indexes/tuple/pending/restart/isolation/oversize/lost lease tests must pass with nonzero executed count before activating the facade. Retain sync and explicit saved-result verification whether or not this optimization is activated.

## Task 10 — Whole-system correctness, fault, and performance certification

**Files:** deterministic/native latency suites; future `verification.md`. No live model/Google calls.

- [ ] **10.1 — Re-run fixed full baseline matrix after each increment.** Compare T2 constants, using identical fake provider streams/config/context and both zero-latency and modeled 67/449 ms storage profiles. Report per-phase wave counts and complete command totals, critical path, overlap, finalization tail, and queue bounds. No old point-read-delay probe may be presented as whole-system speedup. Count failed/interrupted samples and cleanup time, not just successful first deltas. Keep old partial ceilings as regression checks separately.
- [ ] **10.2 — Add table-driven crash and ambiguity tests.** For both model paths exercise every T5/T7 boundary and T8 identity/usage boundary before/after ack. Add stale CAS receipt, lease loss, handoff/drain race, timeout-with-later-success, duplicate submission after uncertain ack, pending dispatch with missing generation ID, usage lost, final graph pending writes, retention expiry/redaction during attachment/publication, Calendar disconnect/rights revocation before disclosure/effect, SSE backpressure and disconnect, cancellation before and after seal, iterator return and failed final drain. Record actual assertions per case, not only a single “fault suite passed” label.

  Required independent postconditions: scoped durable input once; correct visibility; one active attempt; same generation bound to original accepted attempt/dispatch/user; no hidden provider replay; no duplicate create; held money conservative; completed/truncated distinction; ordered tool call/result groups; graph/manifest target match; no terminal delivery before release; immediate follow-up from completed/error callback succeeds; all raw writes settled before ownership relinquished. A saved answer with failed publication is repairable, not reinferred.
- [ ] **10.3 — Gate native fixture use before any connection.** Require explicit D4 plus `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` already in the execution environment. Never read application `.env`, substitute an app URI/DB name, or print environment/driver errors. If either missing, stop native stage and record **BLOCKED / 0 native tests executed**; do not call an all-skipped suite certification. Operator must attest dedicated allowed test service/account and approve generated test DB creation/drop and sample load. Environment names alone are not proof of isolation.

  Extend `nativeDatabase` with an optional diagnostics hook and preflight: explicit `replicaSet` configured, no direct/load-balanced workaround, `hello` confirms writable replica-set primary, not standalone/mongos/unknown compatibility profile. Observe only sanitized booleans/version needed for certification, not hosts/URI. An unverified Azure-compatible service is not admitted by passing one command. Do not set failpoints/reconfigure/step down an externally supplied service without separate infrastructure authorization.
- [ ] **10.4 — Measure actual remote majority-write latency safely.** New `majority-latency.native.e2e-spec.ts` uses only `nativeDatabase()`'s random generated database. First initialize a **synthetic 1 KiB** `latency_probe` document (never application content). Use the existing inherited `{ w:'majority' }`, no changed `j` setting or retry policy. Do five warmup writes, then 60 awaited sequential versioned `$inc` writes; separately 60 primary reads of that synthetic record. Record per-operation wall time and native command duration, success/error/ack status and pool aggregate, not payload/document/URI. A confirmed `matchedCount===1`/ack is required; timeouts are failures with ambiguous durability, not fast successes. Counter update changes each time to avoid no-op measurement.

  Quantile helper for both benchmark files:

  ```typescript
  function quantile(values: readonly number[], q: number): number {
    if (!values.length || q <= 0 || q > 1) throw new Error('Nonempty samples and 0 < q <= 1 required');
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * q) - 1]!;
  }
  ```

  Record `n`, nearest-rank p50/p95, max, error/ambiguity count, acknowledgment/journaling policy **as known**, command classes and cold/warm distinction. Treat 60-sample p95 as exploratory with limited tail confidence. This measures actual authorized remote majority-ack duration without production documents; it does **not** isolate network vs quorum vs tier by itself. No `ping` substitution and no automatic weakening of concern to compare it. Drop only the generated DB in `finally`; sanitize cleanup failures and report unresolved cleanup, never recursively delete paths or production collections.
- [ ] **10.5 — Run real ownership + stock saver + runtime over native isolated DB.** `durable-latency.native.e2e-spec.ts` composes `nativeHarness` with T2 scripted Calendar capability/fetch ports but **all real native persistence adapters**, not mixed map repositories. Use distinct synthetic sessions/users per scenario. Confirm runtime fixture keys are inert and fetch stub refuses any unexpected URL; network provider fetch is never available. Test restart with a new owner/factory only after old work is settled/stopped and authorized recovery, not overlapping executors. Text generation IDs are unique across samples to respect generation claims.

  After explicit sample-load authorization: for each approved scenario, five warmups + 60 measured end-to-end turns with fixed starting history length and fixture stream, serialized initially. Setup/history seeding outside measured interval but still within isolated DB and reported separately. Then a separate bounded 2/4-session contention run within configured process limits, with same-session tab conflict cases. Do not increase production concurrency. Record acceptance, attachment, first dispatch, provider meaningful output, first backend delta, provider end, sealed result, durable terminal, slot release, HTTP delivery separately. Native synthetic performance is DB/runtime evidence, not paid-model/browser performance.
- [ ] **10.6 — Run the native checks with explicit commands after gates.** From `backend`:

  ```text
  npm run test:e2e -- test/persistence/checkpoints.native.e2e-spec.ts test/persistence/ownership.native.e2e-spec.ts test/persistence/calendar-accounting.native.e2e-spec.ts test/runtime/acceptance.native.e2e-spec.ts test/runtime/isolation.native.e2e-spec.ts test/runtime/lifecycle.native.e2e-spec.ts test/runtime/recovery.native.e2e-spec.ts test/runtime/calendar-recovery.native.e2e-spec.ts
  npm run test:e2e -- test/performance/majority-latency.native.e2e-spec.ts test/performance/durable-latency.native.e2e-spec.ts
  ```

  Expected: actual nonzero executed native tests with admitted replica-set profile; no service/credentials in logs. If product/version/replica prerequisites fail, stop and record unsupported/blocked. Failover/replica stepdown/quorum drills require a separately authorized disposable replica set: ordinary operator-supplied DB permissions do not imply authority to affect the whole service. If unavailable, use deterministic lost-connection/late-ack faults and explicitly leave real failover unverified.
- [ ] **10.7 — Run application suites, not only performance probes.** From `backend`:

  ```text
  npm run build
  npm run lint
  npm test -- --maxWorkers=1
  npm run test:e2e
  ```

  From `frontend` (no frontend behavior changes expected):

  ```text
  npm run build
  npm run lint
  npm test
  ```

  Expected: nonempty passing checks, skips reported separately. Do not run `test:azure`/`test:behavior` with empty discovery as evidence. Provider fixtures must remain deterministic; no live/private data in routine suites. Repair actual introduced failures within approved scope; do not dispatch a reviewer.
- [ ] **10.8 — Write precise verification evidence.** Future `verification.md` contains implementation-start/final commit **plus uncommitted diff identity**, environment/installed versions, native topology admission facts and unknowns, all commands, executed/failed/skipped counts, dependency/command baseline→result per scenario, cost/identity/fault assertions, p50/p95 method/sample counts when authorized, and remaining limits. Mark unified review **skipped**. If native/paid/browser prerequisites absent, the report states implemented/offline-tested only and blocked gates; no production/readiness claim.

## Task 11 — Approval-gated infrastructure placement investigation, not a deployment task

**Files:** future `placement-decision.md`; existing `README.md` and operations docs are read-only references unless later explicitly authorized to update.

- [ ] **11.1 — Ask operator for sanitized facts, not credentials.** Actual service product/API/version, backend location, primary and majority-ack member regions, tier/limits, storage/quorum journal policy, expected access control, and whether the backend must stay on the PC. Include source/date/verified vs operator-attested vs unknown for every fact. Do not inspect application configuration/data or query remote admin endpoints merely because this plan names them.
- [ ] **11.2 — Use T10's isolated raw-write evidence to distinguish hypotheses.** Compare logical operation vs wire durations, wrapper/guard count, pool wait, command class and tail; investigate service/quorum/throttle/query-plan explanations using **synthetic test records and operator-approved diagnostic access** only. A colocated label or a low `ping` is not majority-write evidence. Do not create indexes/migrations from conjecture. Query plans, server status, service dashboards and settings access each need explicit permission; never capture query filters containing app content.
- [ ] **11.3 — Present a paper choice with no infrastructure changes implied.**

  1. Preferred production candidate: one access-controlled backend executor near verified native primary **and acknowledging quorum**; browser reaches it over HTTPS/SSE. Production exposure requires access-control/secrets/backup/restore/proxy-drain readiness decisions first.
  2. PC-bound alternative: nearby authoritative native replica set, operator-managed durable storage and backup/RPO/RTO. A one-member development replica set is not high availability and does not preserve remote disaster-recovery guarantees by magic.
  3. Code-only: unchanged remote authority, retain measured residual serial-write floor and investigate service latency. Do not propose asynchronous remote replication as an equivalent local cache.

  For each show measured/unknown read+majority-write latency, access-control responsibility, machine/region failure domain, backup/restore obligation, RPO/RTO, operational cost and approval prerequisites. Do not choose a service/tier/model on the user's behalf.
- [ ] **11.4 — Stop for D6/D7 decisions.** No provisioning, migration, replica changes, deployment, backend restart against app DB, model swap, paid benchmark, Calendar effects, or public endpoint in this plan's execution. Optional live/browser comparison later uses the same approved model/prompts/history/tool result, fixed sample/cost ceiling, isolated Calendar account and reported cache state; until authorized those measurements remain **unrun**.

## 4. Parallelism and recovery-boundary checklist

**Actually independent and eligible after scope/epoch validation:** session and idempotency reads; archive and attempt page chains; manifest/graph/history reads; prior-message/prior-reservation absence reads for a new counter; immutable input+attempt staging after sequence/slot reservation; text provisional assistant+final accounting after seal. These use bounded `allSettled` and tracked raw promises. They do not become one atomic operation.

**Not independent:** cursor page N+1 before N; marker before its prerequisites; session acceptance visibility before marker; budget claim before dispatch draft; fetch before durable dispatched/reservation and fresh gates; money settlement used by another dispatch before ack; decision before observation drain; tool execution before saved decision/current rights; continuation before durable tool result/receipt; graph boundary before target manifest; completed message/attempt before required graph confirmation; terminal before tracked work + runtime/transport release. Keep all these dependencies explicit.

**Deliberately not parallelized here:** availability batches with shared byte/interval/request/coverage budgets, unknown-effect Calendar writes, per-session ownership lanes, graph execution spanning DB phases, operations through journal as one giant token, or arbitrary history/drop/compaction. These are not transparent speed switches.

## 5. Acceptance and rollback criteria

An increment is acceptable only if **both** command/wave evidence improves **and** all relevant invariants/fault tests hold. A faster first delta with more ambiguous billing, interrupted turns, source disclosure, false terminal events, or blocked immediate follow-up is a regression.

- No persistent schema migration is required by the default path. Receipts, epochs, phase tokens, and queues are process-local optimizations with strict durable fallbacks; expired/missing receipt simply costs reads.
- Rollback means reverting **only newly authorized task diffs**, after drain, to existing strict methods; never reset unrelated user work. Save this initiative's actual diff list before any rollback. No automated reset/checkout command belongs here.
- A driver/saver compatibility failure keeps the old bounded precheck path and sync graph config. A writer failure falls back to synchronous observation only after raw writes settle and a quiescent restart/reconciliation as required, not by racing another writer.
- A native certification failure blocks release of the dependent optimized path. Do not suppress failed tests, manufacture fixtures that bypass real fencing, or report skipped gates as success.
- A new financial policy, identity crash window, graph/lifecycle migration, pool/topology change or product change requires an amended approved plan, not a performance-only implementation shortcut.

## 6. Planner self-review — performed on this plan, not a unified code review

- **Coverage:** T1 complete sanitized native/stock saver/request attribution; T2 complete delayed dependency baseline; T3 actual CAS/envelope reuse; T4 guarded/control phases; T5 shared admission; T6 bounded attachment receipts and actual HTTP duplication; T7 both finalization paths and every crash boundary; T8 both model writers, conservative holds/identity/drain and safe plain-text fallback; T9 sync/stock/bounded decode compatibility; T10 isolated native/p50/p95/fault/whole-app verification; T11 approval-gated placement. All requested areas have tasks.
- **Research independently filtered:** no early completed-message insertion because current archive readers expose it; no guessed ledger revisions because current budget recompute lacks confirmation; no graph-node deletion/migration; no global async/exit; no per-session lane changes; no asynchronous identity by default; no pretend plain-text USD reservation; no independent writes crossing a recovery boundary.
- **Type consistency:** one `ConfirmedRecord<T>`/`CasConfirmation<T>` vocabulary; specialized Calendar save returns dispatch+actual budget receipts; old strict APIs stay callable. `getStreamAttempt` is a hint/status port, `attachAccepted` is authority; neither receipt grants executor ownership. `PrepareState` is existing graph state, not a second persistence source. Writer snapshots are absolute and only confirmed data reaches accounting snapshots/continuation budgets.
- **Failure consistency:** all concurrent writes join via all-settled; raw promises stay tracked beyond visible timeout; phase/control/journal barriers remain; recovery never needs cache/settings receipts to infer; no silent provider replay; failed finalization preserves saved answer; terminal still follows cleanup.
- **Compatibility:** no HTTP/protocol version or stored schema/model/permission/retention change; additive fast capabilities with strict fallback; live voice retains delivery settlement ownership; stock saver encoding/index semantics retained and native-gated. Code headers and ESM `.js` imports required.
- **Evidence calibration:** supplied numbers and targets are hypotheses/baselines, not planner measurements. Native and paid/browser stages explicitly blocked without authorization/environment. No application tests run or claimed passing during planning. Unified review remains **skipped**.
- **Scope/hygiene:** only this plan may be written during planning; no Phase 1 state edits, new agents, branch/worktree, commit/push, infrastructure/config/data/provider access. Optional commits require approval. Existing work stays intact.

## 7. Documentation references used to check feasibility

Public docs consulted through Context7 during planning; installed source remains the version-specific authority for the facade:

- [MongoDB Node command monitoring](https://www.mongodb.com/docs/drivers/node/v6.x/monitoring-and-logging/monitoring/command-monitoring/) and installed driver `src/mongo_client.ts`/`src/cmap/connection_pool_events.ts`: `monitorCommands`, client event lifecycle and distinct pool `durationMS`. Event projection must not retain command/reply contents.
- [LangGraph JS durability modes](https://docs.langchain.com/oss/javascript/langgraph/checkpointers): sync saves at step boundaries; async/exit have different abrupt-crash guarantees. [Replay behavior](https://docs.langchain.com/oss/javascript/langgraph/use-time-travel): replay can reexecute models/effects, so missing graph progress never authorizes blind replay.
- Installed `backend/node_modules/@langchain/langgraph-checkpoint-mongodb/dist/checkpoint.js`, `getTuple`, `put`, `putWrites`: two underlying tuple queries, raw decode order, Binary serialization, pending-write index/update semantics and public constructor injection. No dependency source is modified.
- [Research primary-source index](../performance/latency-reduction-research.md#primary-references-and-what-they-establish): atomicity/majority/bulk limitations, topology, provider usage and identity limitations. No claim here identifies the user's remote database service or certifies Azure compatibility.
