# Aurvin: materially reducing durable chat latency

Research date: **28 October 2026**. Checkout: `codex/google-calendar-plugin`, HEAD `58f0b781603df35ec064faef7a9951c09d0e9544`, **with existing uncommitted implementation changes**. This report describes the inspected working tree, not HEAD alone. Research only; implementation and service validation are not performed. Unified review remains **skipped**.

## Executive recommendation

**Put the backend and its authoritative MongoDB primary/quorum on a genuinely low-latency path, then collapse repetitive persistence work into a few fenced lifecycle phases. Do not start with a faster model, browser animation, or globally weaker checkpoints.** Keep the existing LangGraph/runtime; no replacement orchestration framework is warranted.

The supplied turn spent **32.246 seconds before the first model dispatch** and another **8.362 seconds sealing/finalizing/releasing**. Its two model windows total 9.646 seconds, and even those include awaited application persistence. The database is confirmed non-loopback, but its product, region, tier and quorum layout are unknown. The confirmed bottleneck is **serial persistence amplification with expensive observed database operations**; geographical distance, service throttling, journal/quorum delay and query inefficiency are competing explanations for those operation times, not yet individually proven causes.

The first architectural choice is therefore:

1. **Preferred production shape:** one backend executor near the verified native MongoDB primary and majority-acknowledging members; browser connects to that backend over access-controlled HTTPS/SSE. One browser WAN request is much cheaper than hundreds of backend–DB WAN operations. This is a recommendation, not deployment authorization.
2. **If the backend must stay on this PC:** use an explicitly admitted local/nearby **native replica set as the authoritative database**, with appropriate durable storage and backups. A one-member replica set is a development/recovery-test option, not high availability. A remote backup is not a synchronous remote authority disguised as a local cache.
3. **If placement cannot change:** optimize commands and dependency barriers in the current code. Meaningful seconds can be recovered, but retaining hundreds of expensive remote commands puts a ceiling on the gain. Raising connection-pool size or process concurrency does not fix sequential dependencies or the process-wide ownership queue.

An initial **15–25 second comparable short tool-turn completion target**, followed by a **12–20 second engineering target**, is more credible than subsecond completion, conditional on measured low-latency storage and unchanged roughly similar provider behavior. These are **unverified targets**, not measured improvements or promised p95s. Acceptance and terminal cleanup should each be targeted below approximately 1–2 seconds on the low-latency architecture. Measure all phases before committing to an SLO.

## 1. Evidence: what the observation does and does not establish

### Supplied successful-turn timeline

The timestamps/counters below are supplied by the requesting session/user; this researcher did not query the database, backend metrics, Calendar, or paid model endpoints.

| Phase | Observed duration | Interpretation |
| --- | ---: | --- |
| Submit 06:30:09.738 → acceptance returned 06:30:32.124 | 22.386 s | Durable admission plus its request cleanup; no model answer can fix this. |
| Attachment/preparation → initial dispatch 06:30:41.984 | 9.860 s | More reads, ownership, context and graph preparation. Not simply the cost of one browser HTTP round trip. |
| Initial model window | 3.007 s | Includes awaited observation persistence; not pure provider compute. |
| Tool/handoff | 4.504 s | Includes only 0.703 s identified as Google discovery; do not attribute the whole window to Google. |
| Continuation model window | 6.639 s | Includes application work while consuming the provider stream. |
| Sealing/finalization/release | 8.362 s | Durable answer publication and ready-for-next-turn cleanup. |
| Total | **54.758 s** | First backend answer delta at **44.231 s** after submission. |

Acceptance plus preparation is **58.9%** of this turn; the named sealing/finalization tail is another **15.3%**. Together they are **74.2%**, before considering persistence inside model/tool windows. Eliminating both model windows altogether would still leave **45.112 seconds** in the remaining named phases. This arithmetic is not a prediction that the phases stay constant after a redesign.

The reported execution timer is 31.352 s and excludes acceptance/attachment instrumentation. Its scope differs from the end-to-end timeline; do not add it to those phases or force it to reconcile with their boundaries. Execution-scoped counters are 175 reads/40 writes. The process-wide read-only metrics snapshot was reported to match one execution:

| Metric | Count | Sum | Maximum | Derived arithmetic mean |
| --- | ---: | ---: | ---: | ---: |
| Instrumented driver reads | 227 | 15,180.1644 ms | 1,506.9813 ms | 66.87 ms |
| Instrumented driver writes | 52 | 23,330.699 ms | 2,069.7702 ms | 448.67 ms |
| Ownership queue waits | 55 | 2,705.9376 ms | 773.9782 ms | 49.20 ms |
| Checkpoint put/putWrites wrappers | 16 | 8,216.2025 ms | Not supplied | Not a driver-command count |
| Checkpoint reads | 8 | 2,543.78 ms | Not supplied | Not a driver-command count |

**Do not sum these into a latency waterfall.** Checkpoint wrappers include queue/fence/driver work; operations overlap, and the model consumer awaits some writes. Driver counters also omit stock saver commands and some cursor/aggregate paths. The read/write means are operation durations, **not measured network RTTs**. The roughly 6.7× write/read mean ratio is a reason to inspect majority acknowledgment, storage/quorum/tier behavior and operation classes, not to blame distance alone.

Reported idle, nondegraded runtime and no transport backpressure make an ongoing stuck job less likely at snapshot time; they do not rule out earlier stalls. Bootstrap classification says non-loopback MongoDB, SRV false, local crash recovery false. No URI or secret was read for this report. The optional local mutation journal is therefore **not the current latency cause**.

### Already implemented: do not propose the old baseline as new work

The [implementation record](conversation-latency-implementation.md) and inspected code already contain bulk history/acceptance reads, owned context-source reuse, scoped latest-attempt lookup, lazy Calendar budgets, cached ledger results, narrower fresh capability checks, unchanged-discovery revision preservation, saver serialization reuse, immediate accepted/generating SSE flushing, frontend parsing improvements, and cleanup before terminal delivery. The [investigation](conversation-latency-investigation.md) is explicitly historical.

Existing deterministic ceilings are **27/67/105 Calendar-adapter commands** for ordinary text/read/create, not complete native production counts. The 100-fragment probe requires **at most six dispatch saves**, not one write per text fragment: [performance probe](../../backend/test/performance/conversation-latency.spec.ts#L149). Earlier suite results are documented in the implementation record; they were **not rerun or recertified by this research**.

## 2. Current causal path, with exact source seams

| Remaining amplification | Current source evidence | Concrete implication |
| --- | --- | --- |
| Every ordinary `owner.run` performs executor read → session lease read → action, inside one global queue | [ownership.ts:67](../../backend/src/persistence/ownership.ts#L67), [assertExecutor:137](../../backend/src/persistence/ownership.ts#L137), [fence/run:308–326](../../backend/src/persistence/ownership.ts#L308) | A simple write can require at least three sequential storage operations before repository-specific work. Async checkpoints also share this queue. |
| Admission contains repeated session/idempotency checks, acquire, boundary validation, reserve slot, sequence allocation, input write, attempt write, confirmation and release | [acceptNewTurn:242–374](../../backend/src/chat-runtime/durable-chat-runtime.ts#L242); [sequence allocation:489–568](../../backend/src/persistence/ownership.ts#L489); [confirmation:591–648](../../backend/src/persistence/ownership.ts#L591) | 22.386 s is credible without provider work. Confirmation rereads the session, attempt and input after the writes have already returned. First-chat sequence/boundary initialization adds extra work. |
| Execution rereads accepted input/attempt/acceptance, reacquires ownership and repeats boundary validation before inference | [executeTurn:484–595](../../backend/src/chat-runtime/durable-chat-runtime.ts#L484); [checkBoundary:197–241](../../backend/src/chat-runtime/durable-chat-runtime.ts#L197) | Existing within-execution context reuse does not remove the admission-to-attachment duplication. |
| Ledger cache does not eliminate adapter reads preceding CAS | [observe:435–492](../../backend/src/chat-runtime/calendar-budget.ts#L435); [putDispatchVersioned:353–382](../../backend/src/persistence/calendar-accounting.ts#L353); [compareAndSwapBudget:170–225](../../backend/src/persistence/calendar-accounting.ts#L170) | The runtime knows the confirmed dispatch/budget, but persistence still reloads the envelope/revision to evolve it. Exposing validated CAS receipts is a smaller redesign than a new cache service. |
| Model stream consumption awaits observation writes before emitting text | [calendar-adapter publish:102–109](../../backend/src/model/calendar-adapter.ts#L102), [frame path:226–253](../../backend/src/model/calendar-adapter.ts#L226); [binding hooks:388–399](../../backend/src/chat-runtime/calendar-budget.ts#L388) | First generation identity/model metadata and first-output enrichment can insert remote persistence into time-to-first-text even though identical observations already coalesce. |
| All graph calls explicitly request synchronous durability | [graphConfig:34](../../backend/src/chat-runtime/finalization.ts#L34), [graph:41–111](../../backend/src/agent/turn-graph.ts#L41) | Input, prepare, decide, execute, seal and boundary publication create graph persistence boundaries, not just the indispensable external-effect boundaries. |
| Nonempty saver read validates two queries, then stock saver fetches both again | [ScopedMongoSaver.getTuple:201–242](../../backend/src/persistence/checkpoints.ts#L201); stock `dist/checkpoint.js:81–123` | A nonempty tuple normally takes four reads instead of the stock two. Empty-thread short-circuit and serialization reuse are already fixed. |
| Calendar graph prepare reads its own state, and finalization reads/updates/confirms state again | [runCalendarTurn:831–885](../../backend/src/chat-runtime/durable-chat-runtime.ts#L831) | Several of the eight checkpoint-read wrapper observations plausibly come from repeated snapshots, not eight distinct useful application checkpoints. Attribution needs command tracing. |
| Publication performs message append → completion update → activity touch → manifest write → graph boundary update/confirmation → lifecycle transitions → clear/release | [publishCalendarTurn:266–311](../../backend/src/chat-runtime/calendar-publication.ts#L266); [beforeTerminal:888–895](../../backend/src/chat-runtime/durable-chat-runtime.ts#L888) | The 8.362 s tail has an explicit serial implementation. Ready-after-cleanup is correct and must remain; make cleanup cheaper rather than emit completion early. |
| Ordinary text has the same general pattern and also awaits optional timing enrichment | [publishResult:79–119](../../backend/src/chat-runtime/finalization.ts#L79); [text adapter:46–54, 93–99](../../backend/src/model/openrouter-adapter.ts#L46) | Fix the shared primitives and both adapters; optimizing only the logged Calendar case leaves a sibling path slow. |

Shared callers were searched in runtime, reconciliation, Calendar recovery, both provider adapters and the saver. Recovery must retain strict readback even when the live, already-owned path gains receipt reuse.

## 3. Architecture choice: remove distance amplification before micro-optimizing

### A. Backend near database — recommended production default

Keep one shared runtime/persistence owner. Run that executor in the same low-latency region/network as the authoritative primary; ensure majority acknowledgment does not still require a distant voting member on every write. Serve the browser through an access-controlled streaming endpoint. Select placement based on **measured read and majority-write latency**, not the word “cloud” or an assumed Azure product.

MongoDB's official guidance recommends application/data locality and same-provider/same-region placement [R1]. It is not a benchmark for Aurvin, and does not establish that the configured service is Atlas or native MongoDB. A same-region label cannot cure an undersized/throttled tier, high storage latency or unsuitable quorum configuration.

This placement removes the repeated WAN component across **all** reads, accounting, leases and stock saver commands without changing durable acknowledgment semantics. Browser-to-backend latency is paid once per request/stream rather than once per DB operation. It still requires production access control, server-side secret handling, backup/restore and deployment approval; none is authorized here.

### B. Local/nearby authoritative replica set — best alternative for local-first Aurvin

If inference/backend must run on the PC, keep the database primary and acknowledging members nearby. Retain replica-set admission, majority write concern and one executor/database. Verify durable disks, restart recovery, encryption/access control and operator-managed backup. A single-member native replica set can offer durable local acknowledgment with a **single-machine failure domain**; it is not equivalent to a multi-member production replica set or regional disaster recovery.

Do not introduce local authoritative writes plus best-effort replication to the existing remote database while claiming the old failure guarantees. That is a new local-first durability/disaster-recovery policy, with an explicit remote RPO and conflict/restore design. Prefer one authoritative database and tested backups. Do not enable `localCrashRecovery` as a speed knob: its mutation-journal/sentinel protocol adds writes and changes recovery prerequisites.

### C. Code only, unchanged remote database — useful but bounded

Reducing commands and serial waves is worthwhile under any placement. At this sample's arithmetic means, removing ten **critical-path** reads and five writes corresponds to about **2.91 s** of operation time. This is a sensitivity calculation only: classes differ, work overlaps and pressure changes after optimization. A remote protocol with eight sequential 450 ms write barriers already spends 3.6 s on those writes alone.

Do not use secondary/nearest reads for authoritative acceptance, budget or ownership merely to save latency: stale state can admit concurrent work or overspend. Do not switch to `w:1`, `w:0`, disable journaling, or shorten acknowledgment timeouts to manufacture a faster success. The application client explicitly uses majority writes; with local recovery off it does **not** explicitly request `j:true` globally. Native majority journaling depends on the actual server configuration [R3], which must be established rather than assumed.

### Why optimistic browser streaming is insufficient

An immediate local echo/loading state improves feedback, but cannot erase 22.386 s of durable admission or make an unsafe operation accepted. Current SSE already flushes accepted/generating events. The two-step protocol cannot open its execution stream until the acceptance POST returns. A combined submission/SSE endpoint could show honest **pending-admission** progress and save one browser round trip, but durable acceptance must still precede inference and the accepted event. It does not by itself remove the database barriers in either endpoint. Existing answer deltas remain provisional until durable terminal publication; do not relabel them completed.

## 4. Smallest credible durable-protocol redesign

**Use existing repositories, bounded records, CAS and replay-safe publication. Introduce a compact fenced unit of work, not a new workflow engine, distributed lock service or queue product.** Start with receipt reuse/batching without changing collection roles; consider bounded lifecycle schema consolidation only after those gains are counted.

### 4.1 One guard per logical phase, not per helper call

`owner.run` presently rechecks both control and session documents for every helper. A logical phase can acquire the session serialization lane, validate executor/session generation once, run a bounded set of dependent/independent operations, and retain their acknowledged receipts. Conditional mutations include scope, expected revision/status, owner generation where stored, and stable operation identity. A failed/ambiguous write still requires exact readback; a known fresh success does not need speculative rereading.

**Important limitation:** checking a sentinel in one document does not atomically fence writes to another document. The existing read-before-write protocol has that limitation too. Do not advertise a batch wrapper as multi-instance fencing. It is admissible only under Aurvin's one-live-executor assumption, coordinated handoff/drain and per-session exclusion. If executor handoff can happen concurrently with the phase, establish a real global handoff barrier first; never cache executor authority indefinitely. Preserve lease deadlines and abort on renewal loss. Runtime source guards, Calendar account checks and fresh provider-rights gates still apply at actual disclosure/effect boundaries.

Move from the single global ownership tail to per-session lanes **only after** this lifecycle is proved. Keep an executor-control/handoff barrier, aggregate drain of all lanes and tracked in-flight operations, safe keyed-lane eviction and heartbeat admission. That change primarily improves concurrent-session p95 and prevents another session's slow write from holding cleanup; the observed 2.706 s summed queue wait is not all recoverable wall time and is not the principal single-turn remedy.

### 4.2 Compact atomic lifecycle changes

MongoDB supports single-document atomic updates and expected-value filters [R2]. Apply this where data already shares one bounded record:

- Coalesce compatible session changes: active-attempt assignment, generation/lease changes, sequence counter/reservation for the **current** attempt, and later activity/active-slot/owner clearing. Current sequence state is separate metadata, so moving it requires a versioned migration/recovery design, not a casual `$inc` substitution. Keep bounded current reservation data and historical evidence as separate documents; no transcript or indefinitely growing reservation array inside `sessions`.
- Let attempt/dispatch/budget CAS accept a validated expected envelope/revision and return the confirmed next envelope. Change the shared persistence port as needed, not just the caller's cache. Preserve immutable identity validation, allowed transitions, exact Decimal128 accounting and conservative unknown/held reservations. Never treat a local object as confirmed after CAS conflict/uncertainty.
- On a newly published saved answer, insert its final message completion state where recovery permits, instead of append-streaming then immediately update-completion. This is a proposal requiring publication-reader/fault tests: final transcript state still cannot make an attempt terminal before manifest/checkpoint publication. Existing partial-output/interrupted-message handling remains separate.
- Fold activity touch into the final conditional session release rather than one extra guarded mutation. Keep **completed/finalizing/failed/cancelled/interrupted/truncated** distinctions and ready-after-release semantics.

Avoid one giant turn document. The existing six-collection responsibilities, bounded manifests, append-only UI archive and standard checkpoint layout should survive.

### 4.3 Acceptance and finalization as a few barriers

**Yes, plausibly a few write phases, not one cross-collection atomic operation.** MongoDB bulk operations reduce requests but are not multi-document transactions. Collection bulk writes work on ordinary native MongoDB; client-wide cross-namespace bulk requires server 8.0+ and driver 6.10+ [R4]. Installed driver 6.21.0 satisfies the driver side, but the server/product is unknown. Do not assume client bulk compatibility or add transactions as an unverified dependency.

Proposed acceptance phases, preserving accepted-before-inference:

1. Acquire/reserve the session and validate its committed context boundary, using scoped independent reads in parallel when they belong to the same validated epoch. A first chat still needs initialization; a long archive can still need bounded pages.
2. Durably stage immutable input, attempt identity and any proposal-reply binding. Independent collection writes may share one guarded concurrent phase; same-collection operations may batch. Collect every acknowledgment and track every promise.
3. Publish the acceptance marker **only after** all its prerequisites have acknowledged; then publish/update session acceptance state and release or transfer its owned reservation. Do not put the acceptance marker in an unordered bulk alongside its prerequisites. Ambiguous/partial outcomes reconcile from stable IDs before any provider call.

Under existing cross-document roles this is roughly **3–5 write barriers plus read/initialization waves**; an illustrative overall admission target is **4–8 dependency waves**, not four MongoDB commands or a proven constant for every history length. Merging the current acceptance evidence into a bounded atomic lifecycle record could reduce one barrier, but requires explicit schema/reader/migration changes.

For same-process stream attachment, retain a bounded admission receipt containing immutable input/context-version and acknowledged acceptance evidence, alongside the existing bound settings. Under the active-attempt exclusion, verify scope/version/ownership at attachment and reuse originals instead of redoing the full acceptance history/graph inspection. Invalidate on restart, cancellation, uncertain writes, recovery, configuration/provenance changes and expired/disconnected Calendar evidence. Fresh rights/disclosure projection is **not** an immutable receipt. Recovery and duplicate requests without a valid receipt use strict durable readback. This can remove preparation work without changing the public two-request protocol; retaining a lease across attachment would additionally need a finite abandonment/timeout/drain design.

Proposed finalization:

1. Await a durable sealed graph result and required model/tool outcome evidence. This is the no-provider-replay anchor, not an optional metric.
2. Stage archive/accounting publication and target manifest in a bounded idempotent phase. Batch only independent writes; retain any required provenance/retention registration before result disclosure. If message completion is staged early, attempt status still controls whether the UI may report completion.
3. Publish/confirm the graph boundary **after** the target manifest, as current reconciliation requires; then durably transition the attempt to its terminal outcome.
4. Clear/release the current session slot, activity and owner in a compact conditional mutation, stop/drain tracked work and transport admission, then deliver terminal frames.

This aims at **3–5 publication write phases after the saved seal**, plus required graph/confirmation reads. Phase 2 may contain multiple commands. Preserve the current partial-publication repair protocol so a crash after any phase recovers from the saved answer without inference or duplicate effects. Do not parallelize manifest publication past graph-boundary publication or completion past cleanup.

### 4.4 What can leave the synchronous path

| Class | Safe treatment |
| --- | --- |
| Latency histograms, event-loop samples, diagnostic enrichment | Bounded in-memory aggregation/queue; best-effort export is acceptable if loss is explicit. No message payloads or unbounded labels. The optional durable-completed timing write in text finalization currently still blocks; remove it from authoritative completion latency. |
| UI activity/sidebar projection | Fold into session release first. Async projection is optional only with documented staleness and readers that do not use it as admission/recovery authority. |
| Budget reservations, accepted input, idempotency, operation authority, external dispatch intent, effect outcome/receipt, final saved answer | **Authoritative:** must acknowledge at their required boundaries. Never turn into an untracked promise or “telemetry”. |
| Usage/model metadata enrichment | May overlap text streaming via a bounded writer, subject to the final drain and identity/unknown-cost rules below. Continuation budget decisions must use durable settled cost or conservatively held reservation. |
| Derived aggregates/audit export | Can be asynchronous only if authoritative inputs and a durable replay obligation already exist, and readers/retention accept delayed projection. Current `aggregate()` and publication require them; moving them is a protocol change. |

A transactional outbox works because state and notification intent are committed atomically; a separately written unawaited outbox merely creates another dual-write failure [R10]. In Aurvin without cross-collection transactions, use a **bounded pending-projection marker in the same authoritative CAS record**, scanned and cleared idempotently, or keep the write awaited. Do not add an unlimited embedded outbox.

A local WAL with fsync can move the acknowledgment boundary closer, but changes the authority/failure domain: acknowledged state survives only if that machine/disk survives until remote replication. Aurvin would need fsync/replay, corruption detection, bounded disk/backpressure, retention/encryption, exactly scoped replay IDs, shutdown/backup integration and a new admission/recovery policy. The existing mutation journal is a mutation guard, **not** a replacement authoritative WAL. This is larger and riskier than colocating a native replica set; it is not the recommended first redesign.

## 5. LangGraph durability: installed support and safe scope

Installed packages inspected directly: **`@langchain/langgraph` 1.4.19**, **MongoDB saver 1.4.1**, **MongoDB driver 6.21.0**. The source exposes `durability` on execution configuration. Official JavaScript documentation and the exact versioned source agree on the modes [R5, R6]:

| Mode | Actual behavior | Aurvin implication |
| --- | --- | --- |
| `sync` | Checkpoint/pending work is awaited at step boundaries. | Aurvin explicitly selects it in shared `graphConfig`; this is not the framework default. Keep initially. |
| `async` | Persistence overlaps the next step; intermediate state may not survive process crash. Version 1.4.19 drains tracked checkpointer promises before the execution stream closes and propagates errors. | Can hide waits, not remove command count. A slow saver still contends on the global owner queue. It is not permission to publish completion before drain. |
| `exit` | Skips ordinary intermediate checkpoint writes; persists at successful exit/error/interrupt, not abrupt process death. | Removes intermediate graph recovery. A crash can lose completed-but-not-checkpointed model result/progress and require interruption, or replay if recovery is naive. Not an equivalent-durability toggle. |

The installed source's default is `async` (`dist/pregel/index.js:926–932`); per-step sync barrier is in `dist/pregel/loop.js:477–478`; final checkpoint-promise drain is `dist/pregel/index.js:1148–1166`. Versioned primary-source equivalents are linked in R6. This matters: documentation about Python or hosted LangGraph deployment does not establish Aurvin's installed JS behavior.

### Recommended checkpoint changes, in order

1. **Keep `sync`, remove repeated readback of the same immutable checkpoint identity.** Retain one confirmed tuple/result in a live owned execution and reuse it when no intervening graph mutation occurred. Recovery still reads durable state. Calendar prepare's `getState` is a prime seam; prefer passing already-known graph boundary/cursor through the prepare contract rather than querying the graph from its own node.
2. **Eliminate duplicate tuple fetches without removing raw size/scope checks.** The stock saver has no preloaded-document hook. Its 1.4.1 `getTuple` reads two collections; Aurvin pre-reads both for bounds. Seek an upstream bounded decode/preloaded hook or a tightly version-pinned, conformance-tested integration; do not silently copy a new private saver implementation or validate oversized data only after unrestricted decoding. A scoped read-through adapter must pin the exact checkpoint ID and validate the exact pending-write set consumed, not cache an unpinned “latest”. Native compatibility and malformed/oversize fixtures are mandatory. Eight nonempty reads suggest up to sixteen avoidable queries **if** all follow this path; that count is a source-based hypothesis, not measured attribution.
3. **Merge purely deterministic graph nodes only after boundary mapping.** `prepare` and `seal` are tiny but enforce real invariants. Validate/seal a result in its producing node, or combine deterministic preparation with the next node, only if the same authoritative result/seal is durable before dependent work and the recovery state machine remains explicit. Keeping a logical state does not require a separate saved superstep for every helper.
4. **Only then consider selectively `async` invocation of segments whose input/result is independently authoritative.** Current shared `graphConfig` also serves recovery and boundary updates; do not change it globally. A model decision persisted by `calendarDecisionsV2.put` can anchor the next action, but all consumers must restore that exact decision if its graph cursor is missing. A returned tool result/operation receipt must be durable before dependent disclosure/continuation. Text results currently rely on graph persistence, so async creates a larger crash window before a generated result is saved even if normal completion later drains.
5. **Do not recommend `exit` for the current monolithic turn.** To retain equivalent application recovery, separately persist every paid-model result and external-effect boundary first, then make graph snapshots a reconstructible index. That duplicates/restructures authority and may save fewer writes than expected. It is a larger design, not the smallest credible fix.

LangGraph tasks/checkpoints do not guarantee exactly-once external side effects: work that executed but whose result was not saved can run again on replay [R5]. Aurvin must keep dispatch reservations, durable external-operation intent and receipt/readback reconciliation regardless of durability mode. Never replay a possibly billed model request or an uncertain Calendar write merely because the graph checkpoint is missing. With the current policy, interruption is safer than automatic replay; switching modes can increase interrupted turns or lost resumable progress, even if duplicates are refused.

The observed 8.216 s checkpoint-wrapper sum is **not** an independently removable 8.216 s discount. It contains fences/queue work and overlaps other metrics. Lowering storage latency and duplicate I/O improves this without changing crash semantics; `async` at most hides eligible work behind subsequent work.

## 6. Stream accounting: decouple observation, not spend authority

### Exact current hooks

- `CalendarDispatchHooks.beforeDispatch/onObservation`: [calendar-policy.ts:31–34](../../backend/src/model/calendar-policy.ts#L31).
- Reservation precedes provider fetch: [ledger reserveDispatch:311–385](../../backend/src/chat-runtime/calendar-budget.ts#L311), [beforeDispatch:412–432](../../backend/src/chat-runtime/calendar-budget.ts#L412), [adapter beforeDispatch/fetch:142–167](../../backend/src/model/calendar-adapter.ts#L142). These protect finite spend and current account authority; keep them awaited.
- `bindingFor` wires `onObservation` directly to `ledger.observe`: [calendar-budget.ts:388–399](../../backend/src/chat-runtime/calendar-budget.ts#L388).
- `publish()` awaits this hook at [calendar-adapter.ts:102–109](../../backend/src/model/calendar-adapter.ts#L102). Every SSE data frame merges observation, then awaits `publish(false)` **before** parsing/emitting its text at [226–253](../../backend/src/model/calendar-adapter.ts#L226). Identical observations short-circuit; changed observations do not. `firstOutputAt` added after publication produces another changed observation on a following frame.
- Provider-end observation is awaited before the final decision at [261–269](../../backend/src/model/calendar-adapter.ts#L261); cancellation/error observation uses its own finite cleanup signal at [112–122](../../backend/src/model/calendar-adapter.ts#L112). `CalendarLoop` then awaits dispatch termination and saves the resumable decision before tool execution: [697–729](../../backend/src/chat-runtime/calendar-loop.ts#L697).
- Ordinary text separately awaits generation-ID transition/accounting before its first delta, usage saves, and final save: [openrouter-adapter.ts:46–54](../../backend/src/model/openrouter-adapter.ts#L46), [93–99](../../backend/src/model/openrouter-adapter.ts#L93), [138–145](../../backend/src/model/openrouter-adapter.ts#L138). Its saved-generation invariant at [durable-chat-runtime.ts:650](../../backend/src/chat-runtime/durable-chat-runtime.ts#L650) must be deliberately updated if identity persistence is overlapped.

### Proposed bounded observation writer

Use **one in-flight write plus one coalesced latest absolute observation per dispatch**, not a promise per token. Merge only monotonic known fields under existing money/identity conflict checks; a conflicting generation ID/cost is an error, never overwritten. Nonblocking enqueue returns after validation; a single supervised worker persists the snapshot. While it writes, parse valid text and emit provisional deltas without waiting for optional model/provider/timing/usage enrichment.

Required safety contract:

1. Durable reservation and “dispatched/possibly billed” evidence precede paid HTTP dispatch. Unknown final usage retains the full conservative held reservation; it is not treated as zero or released on disconnect.
2. **Generation identity is special, not disposable telemetry.** Preserve a prompt bounded identity save/flush, preferably one compact identity checkpoint overlapped with provisional text, and surface its failure. Before a dependent tool/continuation, saved result/seal or terminal completion, drain identity and all required usage evidence. Once available, provider/generation IDs must remain bound to the original dispatch for later billing reconciliation.
3. A coalescing writer bounds memory and has a finite persistence/total-run deadline. On error, latch it, abort provider consumption/future dispatches, report persistence failure or saved-result finalization-needed status as appropriate, and keep tracking the dispatched operation until settled. Never clear ownership over unresolved writes.
4. Drain on normal provider end **before** final decision publication/next spend-sensitive dispatch; also drain on cancellation, iterator return and shutdown with a separate bounded cleanup budget. After a visible timeout, unresolved driver operations still retain/quarantine ownership; do not start a conflicting writer under a new lease.
5. If final cost is missing, preserve pending/unknown and the held reservation. Later reconciliation may query OpenRouter generation metadata by its saved ID [R8]; that is an authenticated operator-authorized external call, not permission for this research to make it. `AccountingService.reconcile` exists for ordinary text at [accounting.ts:70–111](../../backend/src/model/accounting.ts#L70), but is not evidence that a supervised Calendar/background recovery worker already exists.

**Changed guarantee to acknowledge:** streaming provisional text before the identity save finishes creates a window where the user saw text but a crash loses the newest identity/usage fields. The pre-dispatch claim still proves possible billing and prevents unsafe reservation release, but cannot recreate an unavailable provider generation ID or exact cost. If exact immediate identity recoverability is required, keep that one identity barrier synchronous and overlap only later enrichment. Do not claim equivalent evidence durability for a merely in-memory queue. A durable local WAL could close part of that window but has the authority/failure-domain costs in section 4.4.

OpenRouter documents a final usage chunk before `[DONE]`, and generation-stat lookup as an asynchronous audit path [R8]. This establishes that per-frame durable metadata enrichment is not an API requirement; it does **not** establish that a lost final usage frame can always be recovered without a saved generation ID. Provider compute is not accelerated by this change; time-to-first-text and stream stalls are the likely wins. Given the existing six-save ceiling, do not promise a 100× command reduction.

## 7. Model → tool → model: necessary sequence versus avoidable work

The general path genuinely needs **model chooses valid call → server validates/debits/executes → model answers from the result**. A read answer cannot truthfully depend on an event it has not fetched. A create continuation cannot assert success before the authoritative receipt. `parallel_tool_calls:false` is explicit in [calendar-policy.ts:165](../../backend/src/model/calendar-policy.ts#L165), and the graph carries one pending decision. Merely enabling parallel tool calls breaks current contracts/accounting; it is not a configuration-only speedup.

Practical order:

- Keep progress streaming (accepted, generating, executing, repairing, finalizing) honest and prompt; use existing app SSE rather than introducing LangGraph's streaming API solely for UI progress. Do not stream private reasoning, unsanitized tool payloads or claims of success before receipt.
- Parallelize **independent internal reads**, after scope/epoch validation, and independent bounded read-only provider batches only after reserving their combined budget. Never parallelize unknown-effect writes, rights checks past dispatch, cursor-dependent pagination or reads intended to observe a preceding write.
- Availability has at most two sequential batches with shared response-byte/interval/coverage budgets: [calendar-availability-api.ts:254–335](../../backend/src/plugins/google-calendar/calendar-availability-api.ts#L254). Parallel delivery needs preallocated aggregate byte/request/interval limits, bounded concurrency, deterministic coverage/merge, cancellation and honest incomplete-coverage reporting. The likely saving is one batch's provider latency, **not** either model window; this is secondary to the observed storage amplification.
- Existing create guidance already tells the model not to request an availability call solely for mandatory create preflight. Measure whether it actually reduces calls; do not describe that guidance as a new fix. Keep current account/rights and all-discovered-calendar conflict coverage.
- Keep schemas stable and descriptions/results concise without dropping semantic fields, provenance, cursor binding or warnings. Current fixture schema size is about 6.2 KB, not a giant tool catalogue. Tool-search/classifier infrastructure is unjustified here.
- Preserve the fixed system/instruction/knowledge prefix and stable tool ordering; append history/new input/result groups without gratuitous prefix rewrites. The current [calendarContext](../../backend/src/context/calendar-context.ts#L140) already preserves the accepted input exactly once and complete tool groups. Check any dynamic timestamps against prefix stability, but never freeze trusted execution time or remove required history. Measure cached prompt tokens, provider route and first-output separately.
- OpenRouter supports best-effort sticky routing and an explicit `session_id`/`x-session-id` key in current documentation [R9]. A stable **opaque server-derived scoped key** is an optional low-cost integration experiment, not permission to replace OpenRouter `user`, change the model/provider privacy policy or assume a cache hit. Verify the configured model/provider's supported cache behavior and retention first. Cache policy must remain compatible with `dataCollection:'deny'` and the deployment's processing policy. OpenAI cache/latency guidance supports stable prefixes and fewer sequential requests [R7], not a transferable “80% faster Aurvin” claim.

**Product choices, not transparent optimizations:** replace a narrowly defined successful-create narration with a deterministic receipt; expose an explicit text-only capability mode; change model/reasoning/output style; narrow conflict coverage. Receipt-only narration could remove the observed 6.639 s continuation *window* for eligible cases, but could also omit another requested answer and would change the experience. No paid classifier, silent tool disabling, history truncation or automatic compaction is proposed. A lower output ceiling alone does not speed an already short response.

## 8. Ranked staged mitigation and verification gates

The order separates evidence gathering from the implementation/deployment decisions it enables. Each stage needs its own measured before/after; effects below are **estimates or design targets**, not observed gains.

| Rank | Change and exact seam | Expected effect | Safety gate / verification |
| --- | --- | --- | --- |
| 0 — establish cause | Attribute all commands and dependency phases around `RecordStore`, stock saver client and `observe-persistence.ts`; identify actual DB product/region/tier/quorum. | Distinguish network, service/majority-write, pool wait, query and lock costs; do not spend weeks tuning the wrong tier. | No payload/URI logging. Native command monitoring counts stock saver too; record bounded command class/duration and pool-checkout wait. Operator authorization needed for external measurements/query plans. |
| 1 — largest architectural lever | Backend near primary/quorum, or nearby authoritative native replica set; composition remains `persistence.ts`. | Potentially removes tens of seconds if most of the 40.608 s admission/prep/tail is remote storage waiting. Target read median ≤5–10 ms and majority-write median ≤15–25 ms; validate tails. | Product/topology admission, security/access control, isolated saver/failover/recovery tests, backup/restore; no provisioning/deploy inferred. Same-region alone is not evidence. |
| 2 — shrink acceptance/attachment | Admission/confirmation/sequence seams and a bounded accepted receipt in `durable-chat-runtime.ts`; shared ownership/CAS ports. | Replace repeated guards/readbacks with 3–5 write phases; reuse accepted context across attachment. Low-latency architecture target acceptance ≤1–2 s, preparation ≤0.5–1.5 s. Remote-only improvement may still leave multi-second admission. | Duplicate submit/retry with identical/different payload; simultaneous tabs; orphan-input recovery; unattached accepted attempt; restart invalidation; expired provenance; no paid call before accepted evidence; no early saved-chat visibility. |
| 3 — shrink terminal publication | `calendar-publication.ts`, `finalization.ts`, `ownership.clearAttempt/release`, `metadata.compareAttempt`, `calendar-accounting` expected envelopes. | Reduce the 8.362 s tail toward ≤1–2 s on low-latency storage, not by moving completion earlier. Shared fixes benefit text and Calendar. | Crash after every staged write/manifest/boundary/status/release; no completion before durable seal/publication/drain; immediate follow-up succeeds; no duplicate model or Calendar create. |
| 4 — keep stream moving | Both adapters' identity/usage hooks; `CalendarTurnLedger.observe/finishDispatch`; supervised writer in existing work lifecycle. | Remove changed-enrichment DB waits before text; potentially hundreds of ms to a few seconds in this topology. Does not remove provider reasoning/generation. | Delayed writer proves deltas can flow; one-in-flight/one-latest bound; conflicting IDs/cost fail; cancellation/end/iterator-return drain; no overspend if usage lost; persistence error reaches runtime; explicit identity crash-window decision. |
| 5 — reduce checkpoint work, initially still sync | `checkpoints.ts:getTuple/putWrites`; `runCalendarTurn.prepare`; graph node boundaries. | Remove duplicated tuple queries and repeated confirmed state loads; fewer deterministic saved steps. Count native commands before claiming the 8.216 s sum as savings. | Stock saver 1.4.1 conformance, scope/size/malformed pending writes; exact checkpoint IDs; fault injection around decision, tool effect, result seal and rebase. Native replica-set fixture required. |
| 6 — improve contention | Per-session lanes replacing `MongoOwnership.tail`, separate executor control/drain. | Concurrent-session p95 and cleanup fairness, not a cure for one turn's hundreds of commands. | Multi-session tests plus single-session exclusion; heartbeat/renew races; handoff, disable/disconnect, shutdown and journal-enabled topology; no stale-lane leak. |
| 7 — conditional provider loop/cache tuning | Stable prefix/routing at provider request builder; bounded read parallelism; optional receipt-only product mode. | Cache prefill/one independent batch may help. Skipping one authorized narration could remove a whole model window; no general guaranteed benefit. | Explicit product/privacy choice; bounded paid benchmark authorization; quality/tool correctness/accounting parity; no model/history/rights changes hidden in performance work. |

### Latency model and falsifiable targets

Use the actual dependency graph:

`Ttotal = admission + attachment/preparation + Σ(model-network/compute + consumer stalls) + Σ(dependent tools/evidence) + publication/release`.

Within a phase, the cost is its serial chain plus the **maximum** of independent concurrent branches, not the sum of every metric. Model windows already include consumer stalls; do not add them twice.

Useful sensitivity experiment, not a forecast: **227 instrumented reads at 5 ms plus 52 writes at 20 ms is 2.175 s of summed operation time**, versus 38.511 s in this sample. Stock saver work is additional, and these operations are not all serial. This explains why placement/service latency can outperform shaving a handful of input tokens. Conversely, if a colocated write still takes 450 ms because the service tier/quorum is slow, placement alone will disappoint.

For the same short two-model/one-tool workload, set trial budgets of acceptance **0.3–1.5 s**, preparation **0.5–1.5 s**, tool/evidence handoff **1–2 s**, terminal publication **0.5–1.5 s**, and two model windows roughly **8–14 s** after consumer stalls are removed. This yields approximately **11–21 s**, hence the rounded 12–20 s engineering target and more conservative initial 15–25 s target. These are not independent measured components or a provider-speed floor: shorter/longer answers, uncached prompts, provider queueing, token reasoning and retries can move them substantially. Text-only turns should avoid the extra tool/continuation path; their target must be measured separately.

Do not claim a p95 from one successful turn. Start with deterministic dependency/command budgets, then authorized isolated native measurements, then bounded paid/browser runs. Report acceptance, first honest feedback, first model dispatch, first provider meaningful output, first backend/browser answer delta, provider end, durable completion and slot release separately. Keep cold/warm first turn and long-history follow-up distinct.

## 9. Verification work to authorize, not results of this research

### Deterministic and source-level

- Extend the existing [conversation probe](../../backend/test/performance/conversation-latency.spec.ts) and [storage regressions](../../backend/test/performance/latency-storage.spec.ts). Present fixtures currently simplify native ownership/checkpointer I/O; add a production-like fenced/checkpoint path and delay **all** storage commands, not just `messages.get`/`getAcceptance`.
- Record dependency-wave count and command ceilings for new/follow-up/long-history text, Calendar ordinary text, read, create, conflict/proposal reply and cancellation. Fake-clock/deferred-promise assertions are more robust than Windows timer microbenchmarks.
- Inject success, acknowledged duplicate, CAS mismatch, timeout-with-later-success, partial bulk failure, step crash, lease loss and failed final drain. Preserve input once, provenance/expiry/redaction, decimal spend caps, terminal ordering and no implicit provider replay. Keep one runnable deterministic regression for each nontrivial new behavior.
- Routine focused commands remain `npm test -- test/performance/conversation-latency.spec.ts` and `npm test -- test/performance/latency-storage.spec.ts` from `backend/`. After future implementation, run the package build/lint/unit/e2e suites appropriate to touched code. This report itself does not require unrelated application test execution.

### Isolated native replica-set verification

Use **operator-supplied** `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, never application data/config substitution. Relevant existing native saver fixture: `backend/test/persistence/checkpoints.native.e2e-spec.ts`. Confirm actual path/config before invoking; absent prerequisites/skips are not passes. Capture complete command monitoring without commands/replies/payloads, checkpoint conformance, majority-write latency, contention and restart/failover/finalization faults. Establish native product/version/replica-set/partition/index/transaction features before admitting anything Azure-branded; no Cosmos-equivalence assumption.

### Authorized live/browser verification

After explicit cost/data authorization, compare the same approved model/settings, prompt/history, tool scenario and cache warmness across topologies/increments. Use bounded samples and an isolated test Calendar account/data where effects are involved. Measure real browser/proxy first feedback/answer delivery and backend phases, and report p50/p95 only with sample counts/methodology. Include provider route, cached/reasoning/output token counts when returned, errors and interrupted turns. Do not mask a faster p50 with more failed durable completions. No such runs were performed here.

## 10. Decisions and missing operator facts

1. **Actual database:** native MongoDB versus compatibility product; server version, primary location, backend location, tier/limits, replica/quorum layout and majority-journal configuration. Is the 449 ms write mean network, majority lag, throttling, storage or a few outliers? SRV false answers none of these.
2. **Placement constraints:** may the backend move near the database, or must it remain on the PC? If local-first, what disk/machine-loss RPO/RTO and backup policy are acceptable? Production access-control requirements remain unsettled; do not publicly expose the backend.
3. **Durability contract:** must every provider generation ID be durably stored before the first provisional text, or may it overlap streaming while the pre-dispatch possible-billing reservation remains authoritative? No relaxation of accepted-before-inference or completion-before-required-durability is proposed.
4. **Schema/change scope:** permission to change shared ownership/repository contracts and migrate bounded lifecycle/sequence fields? Receipt reuse and same-phase batching should be attempted before a larger schema consolidation.
5. **Provider facts:** current configured model/provider route, supported cache/privacy/retention behavior and actual token counts. Historical documentation is not current runtime configuration. No model change, paid comparison or provider-specific feature is assumed authorized.
6. **Product choices:** receipt-only create narration, explicit text-only capabilities or changed conflict coverage remain opt-in requirements decisions. General chat and combined requests must continue to work by default.
7. **Evidence access:** isolated native test prerequisites, sanitized command/pool/phase measurements and bounded live benchmark approval. Existing deterministic successes are not topology or Azure certification.

## Primary references and what they establish

All documentation consulted for this report on 28 October 2026. Context7 was used for LangGraph JS, MongoDB Node driver and OpenRouter API behavior; official primary pages/versioned source were inspected for the claims below. Performance guidance is not comparative measurement of Aurvin.

- **R1 — MongoDB locality:** [Latency strategies](https://www.mongodb.com/docs/atlas/architecture/current/latency-strategies/) and [single-region deployment recommendations](https://www.mongodb.com/docs/atlas/architecture/current/deployment-paradigms/single-region/). Establish physical-distance/network effects and colocating application and Atlas region; do not identify Aurvin's service or guarantee a latency number.
- **R2 — MongoDB atomicity:** [Atomicity and transactions](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/). Single-document updates are atomic; expected-current-value filters prevent conflicting evolution. Multi-document operations can interleave. Supports bounded CAS lifecycle updates, not cross-collection atomic bulk claims.
- **R3 — MongoDB acknowledgment:** [Write concern](https://www.mongodb.com/docs/manual/reference/write-concern/). Defines majority/journal behavior, rollback risks and timeout ambiguity; majority journaling depends on server configuration. Supports retaining durable acknowledgment and investigating quorum latency, not weakening writes.
- **R4 — MongoDB Node bulk operations:** [v6 bulk-write guide](https://www.mongodb.com/docs/drivers/node/v6.x/crud/bulk-write/). Batching reduces server calls; collection versus client-wide bulk compatibility differs; client-wide requires MongoDB 8.0+/Node driver 6.10+. Does not make all operations atomic or all writes independent.
- **R5 — LangGraph JS durability/replay:** [Checkpoint durability modes](https://docs.langchain.com/oss/javascript/langgraph/checkpointers), [durable execution](https://docs.langchain.com/oss/javascript/langgraph/durable-execution), [functional API idempotency](https://docs.langchain.com/oss/javascript/langgraph/functional-api). Establish sync/async/exit tradeoffs, replay boundaries and idempotent external work; do not promise exactly-once provider billing/effects.
- **R6 — Exact LangGraph source:** [1.4.19 Pregel defaults/final drain](https://github.com/langchain-ai/langgraphjs/blob/@langchain/langgraph@1.4.19/libs/langgraph-core/src/pregel/index.ts#L1944) (final drain at lines 2478–2493), [1.4.19 step barrier](https://github.com/langchain-ai/langgraphjs/blob/@langchain/langgraph@1.4.19/libs/langgraph-core/src/pregel/loop.ts#L1023), [MongoDB saver 1.4.1 tuple](https://github.com/langchain-ai/langgraphjs/blob/@langchain/langgraph-checkpoint-mongodb@1.4.1/libs/checkpoint-mongodb/src/checkpoint.ts#L170), [put/putWrites](https://github.com/langchain-ai/langgraphjs/blob/@langchain/langgraph-checkpoint-mongodb@1.4.1/libs/checkpoint-mongodb/src/checkpoint.ts#L370). These public tagged files were fetched successfully and checked against installed code. Establish actual default/drain and two-query saver/bulk pending-write behavior rather than extrapolation from another language/version.
- **R7 — OpenAI latency/cache principles:** [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization), [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching). Establish fewer sequential requests, parallel independent work, streaming/progress and stable cacheable prefixes. Their example percentage savings and provider-specific cache behavior are not Aurvin benchmarks or OpenRouter-wide guarantees.
- **R8 — OpenRouter stream/accounting:** [Streaming](https://openrouter.ai/docs/api/reference/streaming), [usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [generation metadata API](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation). Establish final usage frames and post-completion generation-ID audit lookup. Do not require blocking every content frame on an application DB write or guarantee recovery without an ID.
- **R9 — OpenRouter cache routing:** [Prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching). Establish provider/model-specific automatic/explicit caching, best-effort sticky routing and optional session routing keys. No guarantee of a hit, lower wall time, fixed provider or policy compatibility for Aurvin's unknown current route.
- **R10 — Durable outbox principle:** [AWS transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html). Explains dual-write inconsistency, atomic state/notification intent and idempotent consumers. Used as a design principle only; no AWS framework/service adoption is recommended.

## Research execution and preservation statement

Only this new report was written. Repository source, existing docs, tests and local configuration were inspected read-only and left unchanged by this researcher. No source implementation, dependency installation, application test execution, server start/restart, external database query/write, paid model/Google API call, provisioning/deployment, commit or push was performed. No additional agents were spawned. Public documentation/source retrieval is the only external research access. Existing modified/untracked user and prior-agent work was preserved. Document checks passed: all **45 relative links resolve**, no trailing whitespace, and a final newline is present. The referenced native saver test path was confirmed to exist. These are document checks, not application readiness certification.
