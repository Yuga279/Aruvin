# Persistence reduction: recovery and trade-off research

Researcher 1 of 2 · 7 November 2026 · Aurvin checkout `89e0d4ee94c14f92d383efd1e114a1b8b57463c9`

This report focuses on recovery, failure handling, and deployment workarounds for moving database work out of text and voice latency paths. The other researcher's broader latency strategy is outside this report. Recommendations below are design conclusions from source inspection, not implemented changes or measured performance results.

The user's current direction permits losing unpersisted conversation and accounting on a crash. That changes the existing durable-acceptance and durable-completion contract. It does not by itself resolve duplicate Calendar effects, provider billing ambiguity, or the meaning of voice playback evidence.

Only this report was written. No skills were invoked, workflow started, implementation edited, commit created, application launched, tests run, configuration secrets read, or service/provider checks made. Initial worktree inspection was clean. Host Node reports `v24.19.0`; installed packages inspected locally are LangGraph `1.4.19`, MongoDB checkpointer `1.4.1`, and MongoDB driver `6.21.0`. Context7 tools were searched for twice and were unavailable in this session. Library claims therefore use installed package source and current primary documentation. Existing `research.md` and `plan*.md` contents were not read.

## 1. Recommendation

Use a bounded, server-owned memory state for ordinary conversation, update it before exposing the result or allowing the next turn, and persist consolidated snapshots through one tracked asynchronous writer. Preserve stable IDs, validation, context limits, per-session exclusion, and honest save status. Start with memory alone because the user accepts its crash-loss boundary. Make a disk journal an optional follow-up only if deployment storage and recovery requirements justify it.

Keep a compact durable dispatch record before Calendar mutations. A remote write is the smallest way to reuse the existing Calendar recovery design. A properly flushed local journal can replace that particular remote durability boundary only on an admitted single-owner deployment with restart access to the same journal. A purely volatile Calendar dispatch record cannot preserve the existing reconciliation guarantee.

Specific conclusions:

1. **Do not implement this as generic fire-and-forget repository calls.** Current repositories issue durability receipts and enforce transitions; pretending queued data is confirmed breaks their callers.
2. **Defer and eliminate intermediate writes, rather than merely overlapping them.** An asynchronous call that still executes every old mutation reduces waiting but leaves database load, payload volume, and eventual queue pressure largely intact.
3. **Give the next turn an authoritative memory overlay.** The current code repeatedly consults persisted session, attempt, manifest, checkpoint, and voice delivery state. Moving writes later without changing those reads creates missing-history and active-turn races.
4. **Keep computation, persistence, and delivery as separate facts.** “Answer finished,” “saved remotely,” and “audio played” have different evidence and different failure windows.
5. **Retain the existing collection boundaries initially.** A consolidated flush is several bounded document operations, potentially grouped by collection. One final logical save is not automatically one database write or an atomic transaction.
6. **Avoid a new queue service or dependency initially.** Existing IDs, bounded observation writer, work tracking, caches, validators, and telemetry provide most reusable pieces. A durable external queue adds an infrastructure dependency and a remote enqueue to the critical path.
7. **Do not certify Cosmos through this refactor.** The exact Azure API/product/tier/region, partitioning, retry capabilities, and checkpointer compatibility remain unknown.

“Zero remote persistence on the critical path” is a plausible target for a warm ordinary conversation in the same healthy process. It requires changing admission/status/context reads as well as writes. Cold history loading, startup configuration, effect dispatch, and recovery remain separate cases. There is no measured latency estimate in this report.

## 2. What the real code does today

### Ordinary text

The current path is durable acceptance, HTTP stream attachment, provider generation, graph sealing, application publication, session release, then terminal delivery:

| Boundary | Actual behavior and source |
| --- | --- |
| Browser submit | A UUID is created for each submit invocation; the optimistic user message appears before POST. The returned IDs are then used to open a separate stream. `frontend/src/features/chat/state/use-chat.ts:467`, `:476`, `:493`, `:512`, `:522`. |
| Duplicate joining | Concurrent identical acceptance requests share an in-process promise, with a payload hash mismatch rejected. This entry disappears when acceptance settles; it is not a retained completed-request ledger. `backend/src/chat-runtime/durable-chat-runtime.ts:240`. |
| Initial database checks | Acceptance reads session and prior idempotency state; loads prior turn/context/orphan evidence; and checks active work. `backend/src/chat-runtime/durable-chat-runtime.ts:700`, `:787`. |
| Durable acceptance | It acquires ownership, reserves the attempt and sequences, saves input and attempt, confirms an acceptance marker, updates the session, then detaches acceptance and issues a memory receipt. `backend/src/chat-runtime/durable-chat-runtime.ts:769`, `:772`, `:815`, `:849`, `:854`, `:862`. |
| Stream attachment | One attachment is admitted per user/session. A receipt can avoid some rereads, but attachment still establishes database ownership. `backend/src/http/chat-stream.transport.ts:32`; `backend/src/chat-runtime/durable-chat-runtime.ts:1070`, `:1183`. |
| Before and during inference | Ordinary text awaits a possible-billing accounting snapshot before provider POST; generation identity and accounting are persisted before output proceeds. Further observations use a bounded writer. `backend/src/model/openrouter-adapter.ts:90`, `:115`, `:155`, `:169`. |
| Graph persistence | Shared graph configuration explicitly requests `durability: 'sync'`. Generation occurs inside the text prepare node, avoiding a separate empty prepare checkpoint, but graph checkpoints remain remote. `backend/src/chat-runtime/finalization.ts:97`; `backend/src/agent/turn-graph.ts:71`. |
| Final publication | A sealed result is checked; assistant and accounting are staged; manifest and graph boundary are committed; assistant/attempt become terminal; then session activity, active slot, and owner are cleared. `backend/src/chat-runtime/finalization.ts:198`, `:221`, `:247`, `:279`, `:289`; `backend/src/chat-runtime/durable-chat-runtime.ts:1507`, `:1544`, `:1553`. |
| Terminal delivery | Text releases work and populates the confirmed cache before completed events. HTTP holds terminal frames until the stream reservation also relinquishes work. `backend/src/chat-runtime/durable-chat-runtime.ts:1627`, `:1644`; `backend/src/http/chat-stream.transport.ts:69`, `:92`. |
| Recovery | Sealed results are published without inference replay. No-result accepted work is interrupted for explicit retry. The recovery method checks quiescence and clears disposable caches. `backend/src/chat-runtime/durable-chat-runtime.ts:1960`; `backend/src/chat-runtime/reconciliation.ts:40`. |

Consequently, moving only accounting writes cannot produce a database-free submit or first-token path. Ownership, acceptance, context, readiness, and stream attachment also participate.

### Dictation and live voice are different paths

**Dictation** opens Deepgram STT, accumulates a browser draft, and only enters ordinary text submission when Send is pressed. Speech accounting still exists even if the draft is never sent. STT connection setup awaits socket accounting admission: `backend/src/voice/providers/nova-stt.ts:40`, `backend/src/voice/usage/voice-accounting.ts:64`, `:66`. Its adapter handles transcript finalization and socket close independently of chat: `backend/src/voice/providers/nova-stt.ts:108`, `:114`. Deferring chat persistence alone does not remove this voice-start wait.

**Live voice** uses a session reservation, finalized STT input, the shared runtime, TTS, transport playback evidence, and delivery settlement:

- Stable live input keys include voice session, provider socket epoch, and provider turn ID: `backend/src/voice/agent/agent-voice-adapter.ts:49`. Duplicate finalized input is joined in memory, with a 4,096-entry ceiling: `:110`.
- The bridge binds a conversation, checks for an existing submission, accepts the live turn, and checks its status before execution: `backend/src/voice/agent/agent-voice-adapter.ts:128`.
- Live generation starts with a persisted delivery seed and generating transition: `backend/src/chat-runtime/durable-chat-runtime.ts:1237`, `:1281`.
- A fresh valid voice receipt can allow generation to occur before graph invocation; its result is subsequently passed through the graph. This optimization already exists: `backend/src/chat-runtime/durable-chat-runtime.ts:1495`.
- Live model observations use `nonBlockingStream`; their identity persistence overlaps output, and the ordinary pre-POST accounting save is skipped on that branch. They are still tracked and awaited later. `backend/src/chat-runtime/durable-chat-runtime.ts:1357`; `backend/src/model/openrouter-adapter.ts:125`, `:135`, `:169`, `:257`.
- Generated prose is already coalesced in background at 100 ms / 512-character thresholds while Speak proceeds immediately. Playback observations also coalesce while a write is in flight. `backend/src/voice/agent/voice-delivery.ts:167`, `:184`, `:263`.
- Finishing speech awaits generated-evidence drain in parallel with TTS Flush. Settlement waits for delivery proof or a finite unknown outcome, and writes terminal delivery. `backend/src/voice/agent/voice-delivery.ts:198`, `:342`.
- Voice keeps its session lease until delivery settles. The confirmed follow-up cache is installed only after settlement and release succeed. `backend/src/chat-runtime/durable-chat-runtime.ts:1548`, `:1700`, `:1731`.

There are therefore at least three independent work reductions to consider: speech socket accounting; model/turn persistence; and delivery evidence persistence. They require different aggregation keys and terminal boundaries.

### Calendar and local tool dispatch

When Calendar is configured, enabled, supported by the selected model, and connected, a text turn can enter the Calendar loop even if its eventual answer performs no Calendar mutation. Admission marks a Calendar window based on those conditions, and execution branches on that window: `backend/src/chat-runtime/durable-chat-runtime.ts:1743`, `:1305`, `:1782`. Do not classify the persistence path only by whether the user's sentence sounds like a Calendar request.

`activate_skill` is a pure local disclosure/selection operation; its helper does not invoke OAuth, permissions, or a provider. `backend/src/chat-runtime/calendar-skills.ts:8`, `:70`. External Calendar read tools and create tools have different recovery needs. The inspected create path supports event creation; this report does not assume update/delete tools exist.

For a create, the runtime preserves an accepted intent, canonical action hash, original connection/target revisions, stable operation ID, stable Google event ID, budget admission, operation reservation, and dispatch state **before** provider invocation. See `backend/src/chat-runtime/calendar-operation.ts:225`, `:423`, `:511`, `:579`. Provider request admission also occurs immediately before HTTP: `backend/src/plugins/google-calendar/calendar-api-http.ts:217`.

Those records are functional recovery state, not just analytics. Eliminating them has consequences beyond losing a conversation transcript.

## 3. Existing pieces to reuse

| Existing piece | What it already provides | Boundary to preserve |
| --- | --- | --- |
| Deterministic IDs | Scoped new-session, turn, attempt, input, output, and event identities. `backend/src/chat-runtime/identity.ts:24`. | Keep request identity independent of free-form content; validate payload hashes separately. IDs do not remember whether a provider request already ran. |
| Admission receipts | Bounded in-process acceptance/context reuse. `backend/src/chat-runtime/admission-receipt.ts:31`, `:157`. | These currently carry real confirmed records, acceptance evidence, generation, config revision, and checkpoint identity. A queued write cannot create equivalent proof. |
| Confirmed-state cache | 128 entries, 2 MiB per entry, 16 MiB total, five-minute TTL. `backend/src/chat-runtime/confirmed-state-cache.ts:45`. | It is disposable confirmed state. Do not put unsaved authoritative turns in an evictable cache and silently lose them on TTL/size eviction. |
| Cache validity checks | Executor, generation, turn, assets, schema, and pinned checkpoint checks; refresh mutable references. `backend/src/chat-runtime/durable-chat-runtime.ts:526`. | Memory-first context needs equivalent in-process version checks. Calendar expiry/redaction and voice delivery cannot become permanently cached facts. |
| Confirmed-record receipts | Immutable, store-bound, revision-bearing proof held in a WeakMap. `backend/src/persistence/confirmed-record.ts:48`, `:63`, `:86`. | Receipts cannot be fabricated, serialized into a journal, transferred to another process, or reused against a new store. Reconstruct proof after a real acknowledged write/read. |
| Idempotent insert and CAS | Insert-once data with content verification for existing/ambiguous results; revision-qualified replacement. `backend/src/persistence/store.ts:146`, `:215`. | Preserve distinction between confirmed, conflict, and uncertain. Bulk aggregation must map outcomes back to each record. |
| Observation writer | One in-flight snapshot plus one coalesced latest snapshot, explicit flush/close, tracked raw promise, error latch. `backend/src/model/observation-writer.ts:41`. | It dispatches immediately and fails the supervisor on error. It is not an end-only accumulator, persistent queue, or cross-record dependency scheduler. |
| Work registry | Per-session request exclusion, process admission cap, stream reservation, underlying-promise tracking, bounded visible waits, drain/quiesce. `backend/src/chat-runtime/work.ts:54`, `:65`, `:94`, `:187`. | Detached persistence must remain visible to drain after the response's Work closes. A request-local set alone cannot own the backlog. |
| Text/live reservations | Synchronous process-local slots, with durable busy checks around acquire/bind/release. `backend/src/chat-runtime/execution-reservations.ts:57`, `:77`, `:95`. | A volatile design must change the busy reader consistently. Retain single-process topology; these maps are not distributed locks. |
| Calendar ledger receipts | Confirmed budget/dispatch cache, serialized consumption, stable debit identities, absolute observation merging. `backend/src/chat-runtime/calendar-budget.ts:77`, `:176`, `:216`, `:308`. | Do not replace debit identities with a retried bare increment. Lost counters after restart are a product-policy change. |
| Voice delivery accumulator | Generated text, last playback sample watermark, interruption proof, synthesis completion, artifacts, and settlement. `backend/src/voice/agent/voice-delivery.ts:35`. | Reuse its validation and proof logic; change its storage boundary deliberately. A final generated answer does not prove it was heard. |
| Accounting merge logic | Absolute token/cost snapshots, explicit zero versus null, identity checks, bounded generation lookup. `backend/src/model/accounting.ts:30`, `:34`, `:51`, `:77`. | Keep known monetary evidence and avoid double-counting cumulative frames. The service's `latest` currently updates after persistence at `:67`; changing save to return early requires separating observed state from confirmed state. |
| Database telemetry | Driver command counts, collection/phase attribution, failures, pool wait, bounded observation state. `backend/src/persistence/database-observation.ts:22`, `:36`. | Include detached work in a turn's total and preserve async diagnostic scope. Logical repository calls are not the same as actual driver commands or Cosmos RUs. |

Source searches found no production filesystem turn outbox and no production browser pending-submit journal using IndexedDB/localStorage/sessionStorage. Benchmark artifact writers are not an application recovery journal.

### The existing mutation journal is remote

`backend/src/persistence/mutation-journal.ts:28` writes idle/busy intent into the database executor sentinel with majority+journal write concern. A guarded data mutation is dispatched only after busy acknowledgement, then idle is written after successful acknowledgement (`:38`). Its single process-wide queue is capped at 100 jobs (`:40`). Errors leave intent busy and quarantine subsequent writes (`:54`).

This is an opt-in native MongoDB / Windows recovery safety mechanism, not a disk-backed message outbox. It can add two remote sentinel writes per guarded mutation. `runPhase` bypasses its usual shared phase optimization when this journal is present: `backend/src/persistence/ownership.ts:405`.

The opt-in code requires an explicit native replica-set URI, local guard, primary verification, binding/provenance, and controlled close: `backend/src/persistence/persistence.ts:127`, `:143`, `:169`, `:185`. It is not a Cosmos-compatible substitute. Reusing its name or turning it on would not satisfy the user's zero-remote-path objective.

## 4. Alternatives ranked by implementation scope

The latency column describes removed waits, not a promised duration. Recovery assumes correct implementation and an admitted service profile.

| Rank / alternative | Complexity and dependencies | Latency/work implications | Recovery behavior |
| --- | --- | --- | --- |
| 1. Reduce redundant reads and retain current durable acceptance/completion | Lowest change risk; reuse receipts, caches, bulk reference reads, confirmed CAS; no dependency. | Removes duplicate queries and fences; still has remote boundaries before inference and terminal completion. Cannot achieve the full stated target. | Existing persisted acceptance and sealed-result recovery remain, subject to admitted topology/service semantics. |
| 2. Accumulate ordinary observations until terminal publication | Focused but touches adapter/runtime/accounting ownership; no dependency. | Removes intermediate accounting and delivery updates rather than only overlapping them. Acceptance, graph, and publication still wait remotely. | Can preserve durable transcript completion if final flush is awaited; loses finer progress/provider observations on crash. A compact dispatch marker may be retained if billing attribution matters. |
| 3. Memory-first ordinary turns with consolidated asynchronous final persistence | Recommended target. Moderate to substantial cross-layer change; no new dependency or external infrastructure. Requires trusted memory reads, changed save semantics, queue bounds, and status APIs. | Warm ordinary turn can avoid remote database waits; replaces many lifecycle mutations with final snapshots. Cold loading and Calendar effects remain exceptions. | Loses any accepted input/output/accounting not yet persisted on process loss. Same-process reconnect works from memory; restart does not recreate lost inference. Recovery handles only surviving remote data. |
| 4. Alternative 3 plus optional final-result disk spool | Adds file format, replay, disk limits, cleanup, key/retention handling, and exclusive deployment ownership. Node stdlib suffices. | Syncing a final envelope after generation need not delay first output; waiting for it delays a “saved locally” acknowledgement. Async append offers a smaller durability window. | Can recover completed spooled turns after process restart on the same retained disk. An acceptance-only crash before the final envelope still loses work. Does not recover a lost disk or missing provider result. |
| 5. Disk journal at acceptance, provider dispatch/identity, final result, and effect boundary | Higher operational complexity despite no dependency. Requires explicitly verified filesystem/storage durability. | Replaces remote waits with local append/flush waits, optionally group committed. More recovery evidence, more critical-path disk work. | Recovers recorded input and sealed results; conservatively marks sent-but-unfinished calls unknown/interrupted. Still cannot guarantee exactly-once provider billing or atomicity with Google. |
| 6. Durable external broker / separate write service | Highest infrastructure scope; provisioning, cost, access, and operation changes. | Remote enqueue remains a wait if durable acknowledgement is required; moves load and adds another service. | Can outlive one app host, but still needs idempotent consumers, ordered projections, and effect reconciliation. Not justified as the first change. |

A single bounded final-turn envelope stored remotely and then projected into existing collections is another option. It can provide a compact remote recovery anchor. It creates a new authoritative record/read contract and projection machinery, and still requires a remote save. Prefer consolidating the existing finalization writes before introducing that schema change.

## 5. State and queue rules for the recommended target

These are implementation requirements inferred from the existing callers. They are not a proposed generic persistence framework.

### Separate three state axes

Retain generation outcomes such as accepted/generating/completed/truncated/failed/cancelled/interrupted. Separately represent persistence as pending/saving/saved/failed-or-unknown, and voice delivery as pending/completed/interrupted/unknown.

An ordinary answer can finish computation while remote save is pending. It may be usable immediately in the same process, with a clear save state. A persistence failure after the user reads or hears the answer must not rewrite the generation outcome into “the model failed.” Likewise, generation completion must not imply delivered audio.

Current stream contracts and reducer behavior equate a completed event with the durable terminal path (`backend/src/chat-runtime/durable-chat-runtime.ts:1644`; `frontend/src/features/chat/state/chat-reducer.ts:489`). Reusing that event without revising its documented meaning would conceal the new loss window. A small orthogonal save-status field/event is preferable to overloading generation statuses.

### Make a server-owned memory overlay authoritative while dirty

For each active or dirty session, retain the accepted input, attempt identity, bounded selected records/manifest, local context revision, current outcome, terminal result, and voice delivery evidence when applicable. Reserve the session synchronously before the first asynchronous operation. Validate input and reserve enough memory/queue capacity before dispatching paid work.

Publish the next context version into this overlay before unlocking the generation slot. Follow-up turns read confirmed database state plus ordered pending changes, with pending state taking precedence. The overlay must serve status, duplicate submit, history/current-session navigation, and voice heard-history callers, not just model input assembly.

Concrete dependencies that otherwise race:

- Acceptance checks prior durable terminal state and session ownership: `backend/src/chat-runtime/durable-chat-runtime.ts:787`.
- Healthy-context reuse expects the acquired generation immediately after the confirmed cache generation: `backend/src/chat-runtime/durable-chat-runtime.ts:526`.
- Stream terminal replay verifies saved message, checkpoint, and manifest: `backend/src/chat-runtime/durable-chat-runtime.ts:1092`.
- Public HTTP history/status first checks database session existence: `backend/src/http/chat-http.service.ts:35`, `:50`, `:84`.
- Live context independently retrieves delivery records and requires non-pending exact linkage: `backend/src/context/referenced-context-assembler.ts:74`, `:129`.

A warm cache miss cannot silently discard dirty turns and reload an older database transcript. Pin dirty entries until saved or explicitly abandoned under the loss policy. Clean entries may still use the existing cache's eviction behavior. Applying the existing five-minute TTL to unsaved authoritative state would cause non-crash data loss.

### Bound the asynchronous writer by bytes as well as count

Use one application-owned writer with per-session ordering and a small bounded global dispatch concurrency. Reuse the one-in-flight/one-latest pattern for replaceable observation records. Retain distinct terminal turn envelopes; they are not interchangeable snapshots.

Required ceilings include total dirty bytes, dirty sessions, final envelopes, bytes per envelope, operations and bytes per flush, in-flight batches, retry attempts, oldest dirty age, and shutdown time. Count copies held by graph results, context snapshots, output text, and queue items, rather than only the queue array length. Reserve capacity for the maximum admitted output and terminal bookkeeping before starting inference.

Do not select numeric queue limits without the current process memory budget and measured flush throughput. The existing 16 MiB cache ceiling is a precedent for explicit bounds, not evidence that 16 MiB is the right write backlog size. A memory queue cannot continue indefinitely through a database outage while also guaranteeing bounded memory and preserving every completed turn.

At capacity, stop admitting additional paid work or enter an explicitly selected ephemeral mode. Do not silently evict the oldest unsaved turn, create unlimited promises, or block an unbounded number of HTTP requests waiting for space.

### Consolidate semantically, not by replaying all old lifecycle writes

An end-only design should write terminal absolute state rather than queuing accepted → generating → identity → timing → finalizing → completed as separate mutations after the fact. Those intermediate states no longer provide crash protection once delayed until the end.

Coalescible data:

- Absolute usage/timing snapshots for one provider dispatch, preserving known fields and explicit zero.
- A monotonically advancing playback sample watermark for one response/transport epoch.
- The generated-text prefix for one response, followed by its final text and terminal delivery proof.
- Session activity using `$max`, and the newest valid context/manifest version after all its referenced records exist.

Keep separate:

- Different accepted inputs, attempts, and completed turns.
- Different provider dispatches, socket epochs, speech responses, and tool effects.
- Terminal unknown/interrupted evidence and its causal IDs.
- User rename/pin/delete commands, account revocation, and retention/redaction decisions.
- Calendar operation intent, original target authority, and dispatch/readback certainty.

Persisted voice APIs currently require an initial pending record before terminal replacement (`backend/src/persistence/metadata.ts:124`, `:581`). End-only voice persistence therefore needs an explicitly validated final-snapshot path, or a compatibility projection that performs both writes in the worker. Calling the current terminal method against an absent row will fail; replaying both writes preserves compatibility but does less work reduction.

### Preserve ordered projections and handle partial success

Group independent operations by collection when verified compatible. Use deterministic record IDs, payload hashes, and expected revisions. Preserve per-session causal order; different sessions may progress independently within a global cap.

For the existing data model, archive/accounting/input/attempt evidence must be available before a committed manifest refers to it or a saved-completion marker exposes it as complete. The database can contain partial projection state after a failed flush. Existing readers must either exclude incomplete commits or recovery must finish them from surviving final-result evidence.

Do not overwrite a whole session snapshot from an old queued turn: it can restore stale title/pin/lifecycle values or clear a newer active attempt. Existing activity uses `$max`; terminal release is qualified by lease and active attempt. `backend/src/persistence/sessions.ts:161`; `backend/src/persistence/ownership.ts:975`. Retain those protections or replace them with explicit local/durable version conditions.

Dirty deletion must also reach the queue. Existing deletion is a soft archive restricted to idle sessions: `backend/src/persistence/sessions.ts:194`. A queued old create/upsert must not resurrect that session. Treat archive/revocation/redaction as a fence against future stale flushes, with any required retention behavior preserved.

For an ambiguous batch result, inspect per-operation successes and confirm uncertain IDs/revisions. Never retry an entire batch with non-idempotent increments. Never advance the durable high-water mark because only some records succeeded. A later turn may be available in memory while the durable prefix remains behind; expose that difference honestly.

### Memory and durable ownership cannot be mixed accidentally

Current release requires acknowledged terminal attempt receipts (`backend/src/persistence/ownership.ts:975`). Current Work closure refuses unresolved raw promises (`backend/src/chat-runtime/work.ts:221`). Moving persistence behind the response requires transferring those promises to a longer-lived owner, not bypassing the checks.

Either keep current database ownership through a final synchronous boundary, or deliberately establish generation exclusion in memory and make the asynchronous writer own database projection/reconciliation. Do not acknowledge a volatile attempt as a `ConfirmedRecord`, reuse a stale lease for later queued turns, or release the executor sentinel while unknown writes remain.

## 6. Idempotency, reconnect, retry, and next-turn ambiguity

Stable IDs are necessary for safe replay, but insufficient for exactly-once execution. If the process forgets a volatile request before any database/journal evidence survives, receiving its old key again cannot prove whether the provider ran.

Retain a bounded in-process request ledger beyond the acceptance promise: key, payload hash including Calendar reply reference, derived IDs, original config revision, state/result, save state, and expiry. Resolve duplicate submit and reattach from that ledger before database fallback. Same-key/different-payload remains a conflict. A caller retrying the HTTP delivery of an accepted request must retain its original key; an explicit new generation attempt gets a new key linked to the original input.

The current browser generates a fresh UUID each time `submitMessage` is invoked and restores text on submission error; it does not retain that key in its reducer's pending state. `frontend/src/features/chat/state/use-chat.ts:476`, `:547`; `frontend/src/features/chat/state/chat-reducer.ts:406`. Clicking Send again after a lost POST response can consequently mean a new logical request. Fixing backend persistence alone does not resolve that user-facing ambiguity.

Recommended recovery behavior by failure window:

| Failure window | What can be established | Workaround / required behavior |
| --- | --- | --- |
| Request not accepted, no dispatch | Only local draft/request evidence may exist. | Retain draft and delivery key; retry the same submission identity when non-acceptance is established. |
| Volatile acceptance, lost POST response, same process | Memory ledger can know whether it accepted or executed the request. | Return the same IDs/status/result. Do not dispatch again just because the client did not receive acceptance. |
| Volatile acceptance, process restart, no durable evidence | Inference might never have started, might have finished, or might still have been billed. | Return an explicit unknown-after-restart state. Do not translate absence/404 into proof of non-dispatch. Require explicit retry for a new attempt. |
| Provider request sent, no generation ID observed | Billing and result are ambiguous. | Preserve a compact possible-dispatch record if desired; otherwise accept the attribution gap. Automatic retry can duplicate cost. |
| Generation ID observed, transcript not saved | A surviving ID can support usage reconciliation, not reconstruction of the answer. | Save the ID in a compact local receipt if that trade-off is valuable; query usage later under bounded authorized maintenance, not through inference replay. |
| Answer generated, remote flush pending, same process reconnect | Memory can return the exact answer and pending save state. | Replay/reset the buffered answer, never repeat inference. Keep local version and request ledger pinned. |
| Completed final-result envelope on retained local disk | The exact recorded result can be projected again. | Idempotent replay of persistence only; no model or TTS replay. Mark missing delivery proof unknown. |
| Some remote projections committed, then crash | Only the acknowledged/surviving prefix is known. | Use saved final envelope/checkpoint if present; otherwise conservative reconciliation and explicit interruption. Do not fabricate the missing completion. |
| New turn begins before prior flush | Memory knows the full logical prefix; DB may be behind. | Next context uses the overlay. Flush dependency order prevents a newer manifest from becoming authoritative before its referenced records. |
| Late old write completes after visible timeout | Timeout did not prove cancellation of storage. | Track the raw promise; qualify updates by identity/version; do not let a late progress write regress a terminal or newer turn. |
| Browser refresh/restart with unsaved answer | Client may retain a copy; server authority may be gone. | Offer local display/export or explicitly tagged client-restored transcript. Do not use client-supplied text as a provider receipt, accounting proof, or authorization to repeat a tool. |

Current text streaming interrupts generation on disconnect and refuses a second generating/finalizing attachment: `backend/src/http/chat-stream.transport.ts:40`, `:55`. A replayable in-process result does not require changing that policy into “continue generating after disconnect.” Decide that policy independently. Continuing detached inference also consumes paid work when the client disappears and requires its own timeout/backpressure owner.

For voice, do not replay spoken audio automatically after reconnect. The existing bridge already avoids speaking accepted replays: `backend/src/voice/agent/agent-voice-adapter.ts:137`, `:145`. Voice transport reconnect is bounded and operates on in-memory session state; it is not process-restart recovery: `backend/src/voice/session/voice-session.service.ts:400`.

## 7. Optional local journal/outbox

### Choose the smallest recovery problem first

There are three useful variants, with different guarantees:

1. **Tiny provider identity receipts:** record attempt ID, provider dispatch ordinal, generation/request ID when received, and timing/config identifiers. Low disk volume and no transcript replay. Useful for later usage attribution; does not recover the answer, prove no charge, or capture a crash before the ID was observed.
2. **Final-result spool:** append a bounded completed-turn envelope and later project it remotely. Best fit if losing in-progress work is fine but losing an already displayed completed answer is undesirable.
3. **Full lifecycle journal:** persist accepted input, dispatch intent, provider identity, final answer, and essential effect authority/outcomes. Stronger restart evidence, with more file writes, sensitive retained data, format maintenance, and replay logic.

Do not build variant 3 by default merely because variant 1 or 2 sounds useful. The user's accepted loss policy makes a pure memory queue a reasonable starting point.

### Durability boundaries

Node's promise filesystem APIs execute I/O asynchronously but do not serialize concurrent modifications to one file. `FileHandle.sync()` requests storage-device flushing; its behavior depends on the operating system/device. Append operations also support flushing options. None of these APIs makes a database/provider call and a file append one transaction. [Node 24 filesystem documentation](https://nodejs.org/docs/latest-v24.x/api/fs.html)

The following distinctions are design implications:

- Merely scheduling an append protects nothing before the append completes.
- An append acknowledged by the OS may improve process-crash recovery while still having a power-loss window.
- Awaiting an appropriate flush establishes the chosen local durability boundary, subject to the actual filesystem/device contract.
- Periodic/group flushing reduces the number of flushes at the cost of a defined unsynced window. A time interval is a target window, not a guarantee if I/O stalls.
- To claim durable acceptance, flush before acknowledging it. To claim durable effect intent, flush before provider dispatch. To claim only final-result recovery, acceptance can remain volatile and the final envelope can be the sole local durable record.

### Minimum safe file design if selected

Use Node stdlib filesystem/crypto and current schema/record encoding. A new database dependency is unnecessary for the first bounded append-only design. A generic embedded database is a larger option only if hand-rolled replay/rotation becomes more complex than the benefit.

Recommended record facts are format/schema version; monotonic journal sequence; boot/installation identity; user/session/turn/attempt IDs; idempotency key/hash; context/config version; accepted public input; provider dispatch/identity facts; final public answer/accounting/voice evidence when available; and effect authority/operation IDs only for the chosen scope. Do not store credentials or private model reasoning.

Use one serialized writer, bounded record length, framing/checksum, and a bounded rotated spool. Preserve stable creation times and IDs when replaying. Store data records, not closures, live leases, WeakMap receipts, or generic driver objects. Raw JSON round-tripping of BSON/checkpointer structures is not sufficient; use an explicit versioned representation and the existing bounded encoders. A final application envelope avoids implementing a second custom LangGraph saver.

Replay rules:

- Accept a torn incomplete last record only under the specified tail-recovery rule. Corrupt data in the middle is an integrity failure, not permission to skip arbitrary history.
- Replay only persistence projections from sealed result envelopes. Do not rerun inference or TTS from accepted-only entries.
- Keep sent-without-result inference interrupted/unknown. Keep effects unknown until original-ID readback resolves them.
- Remote acknowledgement must precede marking an envelope delivered. Crashing after remote success but before the local delivered mark causes replay; deterministic upserts/CAS must make that replay safe.
- Do not delete/truncate the only recovery copy until its remote projection and commit evidence are confirmed. Rotate/checkpoint only at defined safe boundaries.
- Bound disk bytes, startup scan/replay pages, replay attempts, and replay time. Disk full, access errors, checksum/schema mismatch, and unsupported future records need an explicit failure policy.
- Recovery must coordinate with the executor guard and delayed remote writes. Process death alone does not prove an earlier remote command failed or cannot still commit.
- Apply retention, revocation, redaction, and archived-session fences during replay. A stale spool must not reintroduce expired Calendar content or resurrect a deleted session.

These are necessary obligations, not an assertion that a short JSONL helper would already satisfy them.

### Deployment decides whether “local” helps

| Deployment situation | Consequence |
| --- | --- |
| One Windows installation, retained local disk, controlled restarts | Best match for an optional local spool. Existing local guard patterns may help exclusive ownership, but the current native recovery protocol must not be assumed to admit Cosmos. |
| VM with a verified persistent attached disk | Potentially suitable, subject to filesystem, ownership, backup, disk failure, and deployment handoff rules. Journal must survive replacement of application binaries. |
| Container writable layer | Not sufficient for restart recovery without verified retained storage. Container-scoped storage in Azure Container Apps disappears with container shutdown; replica-scoped ephemeral storage is also not a durable volume. [Container Apps storage lifetimes](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts) |
| Azure App Service persistent content storage | Persistent paths are backed by shared storage, not automatically fast host-local disk. Linux custom containers require persistent storage configuration; storage outside retained paths can disappear. A file append here can still be network storage I/O. [App Service container storage](https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container?pivots=container-linux&tabs=debian), [App Service filesystem behavior](https://learn.microsoft.com/en-us/azure/app-service/operating-system-functionality) |
| Multiple replicas, rolling overlap, scale-to-zero/replacement | A per-process file cannot provide cross-host idempotency or prove another process stopped. A shared filesystem does not itself implement a distributed executor protocol. Current source admits one executor per database. |

Unknowns include actual backend host, filesystem type, retained volume, restart/swap behavior, region, maximum termination grace, and whether overlap can be disabled. No deployment setup was inspected or provisioned. Do not select a local journal on the assumption that every Azure deployment has a persistent low-latency local disk.

## 8. Browser workarounds and optimistic navigation

The cheapest improvement is to retain pending request identity and local UI state, without making the browser the persistence authority.

Current behavior already:

- Adds an optimistic temporary user message: `frontend/src/features/chat/state/chat-reducer.ts:351`.
- Commits server IDs at acceptance: `:379`.
- Produces a provisional live-session row in the transcript: `:324`.
- Avoids a session-list GET on Send, and idle-reconciles known rows after a turn: `frontend/src/features/chat/state/use-chat.ts:330`, `:377`, `:396`.

However, `TURN_ACCEPTED` does not insert an optimistic sidebar session. Unknown/new sessions trigger a list fetch after completion. A memory-first server can return IDs before remote persistence, so a list fetched immediately can omit the new row.

Recommended UI changes:

1. Add a provisional sidebar row when server-local acceptance returns a session ID, using a bounded title derived from the accepted text. No backend-configured model/identity/credential data is needed.
2. Merge server list reconciliation with pending rows by session ID and revision/save state. Do not replace the whole list and remove an unsaved local session because the database has not caught up.
3. Preserve the request UUID with its payload until delivery ambiguity is resolved. Make “retry delivery of this request” distinct from “generate another attempt.”
4. Opening a pending session should read the server overlay or retain its local transcript. A database-only GET must not turn a new optimistic chat into “not found.”
5. Use last confirmed durable version for saved status; show a small pending/failed-save indication only when relevant. Keep the answer usable after generation completes.
6. Coordinate tabs through the server. BroadcastChannel/Web Locks may improve UI hints, but cannot replace server per-session exclusion, survive backend restarts, or authorize effects.

For refresh recovery, sessionStorage can preserve a small tab-local draft/request descriptor; IndexedDB is more appropriate for larger optional local transcript copies. Browser storage remains quota-limited, user-clearable, and unavailable in some conditions. Keep it bounded, avoid credentials, and handle failure without blocking ordinary chat.

The IndexedDB specification defines strict/relaxed durability hints, with different persistence/performance expectations; it is not an application-server receipt. [IndexedDB transaction durability](https://w3c.github.io/IndexedDB/#transaction-durability-hint)

Persist useful local recovery state as it changes or on an earlier lifecycle transition. Do not rely on unload/page termination to send the one required save; pages can be discarded or terminated without such callbacks. [Chrome Page Lifecycle guidance](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)

If a client offers a completed answer that the server lost, treat it as user-controlled recovered content, validate and tag it if importing is permitted, and never derive provider billing, tool success, or effect authorization from it. Display/export alone is the smallest workaround.

## 9. Voice delivery, accounting, and follow-up context

### Keep evidence in memory without weakening its meaning

Moving voice progress to memory is compatible with the requested loss policy. Continue validating response/turn/socket bindings and monotonic sample positions, and produce the same conservative terminal proof in memory. Persist the final aggregate asynchronously after delivery settles, or persist generated-turn state first and a later delivery amendment if saving earlier is preferable.

These two terminal boundaries must remain distinct:

- The model has finished generating text and its usage is known or explicitly unknown.
- The browser's verified playback cursor and provider interruption metadata establish what was delivered, or delivery reaches an explicit unknown state.

Waiting for remote database saves before Speak or first PCM is unnecessary for a volatile policy. Waiting for enough playback evidence before claiming speech was heard remains necessary. Skipping both waits together would produce incorrect context, not merely less durability.

Current proof logic already handles zero audio, exact generated/sent text, expected sample counts, invalid interruption splits, and unknown fallback. Reuse it: `backend/src/voice/agent/voice-delivery.ts:318`. Provider synthesis completion alone does not complete delivery; settlement checks proof and finite deadlines at `:342`.

Deepgram documents that interruption offsets are session-wide, must advance, and are used to derive the spoken/remaining split. Without an offset, the split is omitted and audio duration can describe generated audio rather than actual playback. A new connection also resets Flux TTS acoustic context. [Flux TTS interruption handling](https://developers.deepgram.com/docs/flux-tts/interrupt-handling), [Flux TTS cross-turn context](https://developers.deepgram.com/docs/flux-tts/context)

The application should therefore:

1. Stop/drop old playback immediately on barge-in, preserving the existing transport epoch and interruption safeguards. Do not wait for a save before stopping audio.
2. Keep generated text, sent text, synthesized audio length, and observed played samples separately. Store one latest validated playback watermark rather than every callback.
3. Freeze a terminal response before admitting late callback updates. A duplicate or retired response cannot increase the new response's playback cursor.
4. On process restart without complete proof, use unknown delivery. Do not estimate spoken characters from an audio-duration ratio, or assume text shown in the UI was spoken.
5. Retain generated answer text for the UI archive, but use the proven spoken prefix or an unknown-delivery marker for subsequent model context.
6. Keep Canvas descriptors distinct from spoken prose and from proof of actual visual display. Existing artifact admission waits for delivery-journal acceptance; changing it requires memory ownership and final snapshot consistency, not blindly removing the wait. `backend/src/voice/agent/agent-voice-adapter.ts:201`.

The existing context assembler is particularly important. It requires exact delivery linkage and uses `textSpoken` or an explicit unknown-delivery message: `backend/src/context/referenced-context-assembler.ts:74`. Even when record history is supplied through a cache, it separately bulk-fetches voice deliveries at `:129`. A complete memory-first follow-up path must supply trusted delivery evidence there too; caching just messages/manifests still leaves a remote read and can fail while final persistence is pending.

There is no need to persist raw PCM for conversation recovery. Retaining audio introduces a different storage/privacy/size problem and does not recreate proof that a person heard it. Save bounded public text and delivery facts selected by the product policy.

### Reduce voice accounting work at the right granularity

`VoiceAccounting` already binds provider sockets and individual speech responses to stable IDs, captures a rate snapshot, pipelines response-level admission, and tracks terminal writes through drain. Socket admission still blocks connection; response terminal persistence follows admission. `backend/src/voice/usage/voice-accounting.ts:50`, `:64`, `:73`, `:88`.

Potential reduction: maintain socket and response accounting records in memory, enforce quotas there, and submit one final absolute record per socket/response rather than pending-plus-terminal database mutations. Reuse existing record identities and money evidence. A socket may span multiple turns, so its final record cannot be folded into one turn indiscriminately. Preserve provider request IDs and explicit accounting gaps when an abrupt close omits metadata.

The database API currently checks socket linkage and pending-to-terminal transitions, with reads before replacement: `backend/src/persistence/metadata.ts:124`. A worker that writes terminal-only records needs a validated path designed for that lifecycle, rather than an unchecked upsert.

`VoiceUsageService` already enforces process-local concurrency, duration, daily usage, and estimated-spend quotas (`backend/src/voice/usage/voice-usage.service.ts:81`, `:198`, `:350`). Its own header and daily-map comment describe the single-identity/process limits. Deferred database records do not suddenly provide durable quotas across restarts. If restart resets are acceptable, document that limit; otherwise a compact persisted quota reservation/checkpoint is a separate remote boundary.

Keep STT submitted/observed input duration distinct from billed duration. Keep TTS configured-rate cost estimates distinct from actual invoice cost. These distinctions already exist in `backend/src/voice/usage/voice-accounting.ts:71`. Consolidating writes must not turn missing provider metadata into zero usage or make estimates look final.

### Voice teardown and next-turn policy

The bridge waits for the prior active run and output readiness, then submits one finalized input: `backend/src/voice/agent/agent-voice-adapter.ts:128`. LiveFlow bounds pending finalized turns and handles interruption/cleanup independently of the PCM receive chain: `backend/src/voice/session/live-flow.ts:374`, `:546`, `:555`.

A remote-save backlog should not hold the voice generation slot once the preceding answer and heard-history projection are stable in memory. However, the next turn must wait for enough delivery settlement to build correct heard history, or deliberately include unknown delivery. Do not use “database save deferred” to accidentally bypass output readiness and overlap incompatible TTS responses.

VoiceSessionService ends transport/session ownership and releases reservations/admission during cleanup: `backend/src/voice/session/voice-session.service.ts:323`. That release currently consults the runtime's busy reader, which can see durable active markers. If the markers now lag behind memory, release/bind/end must use the new state consistently, with persistence owned separately. Otherwise a completed voice response may still appear busy until a slow flush finishes.

## 10. Provider billing and Calendar effects

### Billing ambiguity is unavoidable, but attribution can improve

For OpenRouter, the existing `user` field, stable session routing identity, per-attempt accounting, and generation IDs should remain unchanged. Do not trust browser user attribution. The request body uses a stable server-derived session ID: `backend/src/model/openrouter-adapter.ts:78`.

OpenRouter's generation metadata endpoint accepts a generation ID and returns usage/cost/request metadata. It can help reconcile surviving IDs; it is not a transcript recovery API or a provider-idempotency guarantee. [OpenRouter generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-generation)

OpenRouter also documents that cancellation stops processing/billing only for supported streaming providers; other providers or non-streaming calls can continue and be billed. Therefore “we aborted on crash/cancel” is insufficient evidence of no charge. [OpenRouter stream cancellation](https://openrouter.ai/docs/api_reference/streaming)

Recommended ordinary-turn policy:

- Record dispatch ordinal, provider generation/request ID when observed, model/config identity, and absolute usage in memory.
- Consolidate terminal usage; optionally retain a tiny locally flushed provider-ID receipt if attribution is worth the extra local I/O.
- Retry only under the existing bounded rejection rules. Do not automatically replay after uncertain delivery, output, or restart with missing evidence.
- Reconcile accounting from a surviving provider ID using a bounded later lookup. `backend/src/model/accounting.ts:77` already provides identity validation and lookup limits.
- Leave unresolvable accounting unknown. Aggregate provider dashboards/logs can identify a discrepancy, but do not prove the association to a particular lost application turn.
- If an operator requires a hard restart-resistant spend cap, retain durable reservations or enforce an appropriate provider-side cap. A memory-only per-process ledger cannot offer that guarantee.

### Calendar requires a different dispatch boundary

The existing create protocol has valuable reusable safeguards:

| Safeguard | Source |
| --- | --- |
| Operation carries canonical action, accepted authorization, original account/target revisions, request hash, deterministic event ID | `backend/src/chat-runtime/calendar-operation.ts:225`. |
| Existing succeeded intent returns its receipt; dispatching/unknown is not a new permit | `backend/src/chat-runtime/calendar-operation.ts:423`. |
| Logical create debit, intent reservation, and planned event are confirmed before provider requests | `backend/src/chat-runtime/calendar-operation.ts:511`. |
| State advances to dispatching before the one provider invoke | `backend/src/chat-runtime/calendar-operation.ts:579`. |
| Provider body contains the exact event ID and private operation/hash linkage; attendees/notifications are not exposed as ordinary tool arguments | `backend/src/plugins/google-calendar/calendar-api.ts:140`; `backend/src/contracts/calendar-tools.ts:58`. |
| HTTP network failure after a write dispatch is classified unknown | `backend/src/plugins/google-calendar/calendar-api-http.ts:246`. |
| Recovery reads the original event/account/calendar under original budget/deadline; absent/mismatch/unknown does not grant replay | `backend/src/chat-runtime/calendar-recovery.ts:239`. |

Google recommends client-assigned event IDs to avoid duplicate creation after a successful insert whose response is lost. The current code uses that mechanism and verifies readback content/linkage. It does not mean any future user request with the same natural-language text is the same authorized operation. [Google Calendar create-event guidance](https://developers.google.com/workspace/calendar/api/guides/create-events)

For future mutation tools, conditional modification with an original etag can protect against overwriting intervening edits; Google documents `If-Match` and 412 semantics. That is a future tool requirement, not evidence of current update/delete support. [Google Calendar resource versions](https://developers.google.com/workspace/calendar/api/guides/version-resources)

Recommended minimal effect policy:

1. Let ordinary model reasoning and observational accounting accumulate in memory.
2. Immediately before an external mutation, confirm a compact recoverable record containing original authority, stable operation/provider IDs, canonical action/hash, target/account revisions, and dispatch uncertainty state. Use the existing remote record first; local disk is an alternative only after its deployment/replay protocol is admitted.
3. Do not dispatch if that chosen durability boundary fails. Saving a receipt afterward alone cannot recover a crash between provider success and receipt persistence.
4. Preserve current non-replay/readback behavior for dispatching/unknown operations. A restarted client retry must not mint a new operation/event ID automatically.
5. The ordinary assistant narration/transcript may save asynchronously. The effect receipt can arrive independently. If narration is lost, do not treat the effect as absent.
6. If exact effect authority was lost, tell the user the outcome is unknown and use an explicitly scoped verification action. Do not infer a new target from current defaults or silently recreate the event.

Read-only Calendar tools can tolerate lost results or repeated reads more readily, subject to explicit budget, freshness, and content-permission policy. Coalescing their observations or accepting lost counters is a reasonable decision if documented. Their API calls still consume quota/latency, OAuth state still needs revocation checks, and retained tool call/result groups must remain valid.

Do not globally replace every `ledger.charge*`, `operation.compareAndSwap`, or tool-evidence save with a no-op. Some are observation overhead; others distinguish “not dispatched” from “might have created an appointment.” Existing durable debit IDs and confirmed ledger receipts already reduce repeated reads and duplicate charges without removing those boundaries.

## 11. Database outage, backpressure, shutdown, and deployment handoff

### Database unavailable while the process remains healthy

Current readiness caches/coalesces dependency checks for five seconds and awaits a ping/executor check on cache refresh: `backend/src/operations/readiness.ts:53`. Operations admission waits for that readiness result: `backend/src/operations/operations.service.ts:48`. A strict zero-database warm path must also address this occasional admission wait.

Possible policy: initialize dependencies at startup; refresh health in the background; admit warm ordinary chat from validated memory while the bounded backlog has capacity. Readiness should distinguish inability to save from process liveness and from provider availability. Cold session opening and mutations requiring durable effect intent can remain unavailable during a DB outage.

This would change current fail-closed behavior. Today runtime degradation rejects new work (`backend/src/chat-runtime/durable-chat-runtime.ts:237`), accounting/delivery write failures can abort generation, and shared AppService records voice-accounting failure (`backend/src/app.service.ts:897`). Changing only one writer to ignore errors leaves other gates contradictory.

An explicit degraded mode needs:

- User-visible pending/failed save state while keeping a successful answer usable.
- Backlog count, bytes, oldest age, and failure classification.
- One bounded retry owner, with bounded backoff/jitter and coalesced latest state; no retry storm per record or request.
- An admission stop threshold. Existing dirty data is retained; new paid work is rejected before capacity is exhausted.
- Separate permanent schema/auth/compatibility failures from temporary service errors. Do not loop forever against an unsupported Cosmos operation.
- A decision for long outages: stop, explicitly accept ephemeral loss, or spool to verified disk. “Keep buffering forever” is not an option.

### Drain owns all accepted background work

`OperationsService.shutdown` stops admission, drains voice alongside runtime work under a common remaining deadline, drains config/Calendar, checks transport activity, and closes persistence only after safe results. `backend/src/operations/operations.service.ts:62`. Runtime drain currently sees request Work and ownership queues (`backend/src/chat-runtime/durable-chat-runtime.ts:2233`); a new detached writer would otherwise be invisible.

Required integration:

1. Stop admission to prevent new dirty work, then stop/cancel media/model producers according to existing policy.
2. Snapshot and drain the write backlog and underlying in-flight operations, including coalesced latest data and delivery amendments.
3. If using a disk spool, wait for the selected local durability boundary before declaring the remainder recoverable. “Queued for file write” is not locally safe.
4. Preserve raw write promises after visible timeout, as Work already does. A `Promise.race` timeout does not cancel a MongoDB command.
5. Close the database and release the executor only when current safety conditions are satisfied, or report an explicit unsafe/incomplete drain. Do not return `drained: true` solely because HTTP streams closed.
6. Carry a finite supervisor grace period and controlled Windows close/IPC path. Current bootstrap only enables SIGINT on Windows: `backend/src/main.ts:111`. Windows termination behavior must be tested rather than assumed to follow Unix SIGTERM handling.
7. Prevent overlapping old/new writer processes during deployment. The default sentinel behavior takes over a leftover owner by design; it is not permission to run both. Delayed writes must retain identity/version fences.

Node documents that asynchronous work scheduled from `exit` handlers is abandoned, and forced exit can leave I/O incomplete. An exit handler is not a substitute for application-owned drain. [Node 24 process lifecycle](https://nodejs.org/docs/latest-v24.x/api/process.html)

A pure memory design can explicitly choose to discard remaining unsaved ordinary records after the shutdown budget. If so, count and disclose discarded turns/bytes, retain unknown effect state, and do not label the result a fully persisted safe drain. Product acceptance of conversation loss does not automatically authorize clearing uncertain ownership/effect evidence.

## 12. Cosmos-specific constraints and measurements

The current source uses the MongoDB driver, not the Cosmos NoSQL SDK. It configures `retryWrites: false`, majority write concern, monitoring, finite driver timeouts, and optional native local-recovery concerns: `backend/src/persistence/persistence.ts:131`. Profile labels include `cosmos-mongodb-ru` and `azure-documentdb`, but conservative document headroom remains 1,800,000 bytes for all labels: `backend/src/contracts/persistence-profile.ts:22`, `:32`.

Source and README admission rules are not proof of which Azure service the running application actually reaches. No connection string, account, portal, service endpoint, `.env`, or live compatibility probe was inspected here. The user reports Cosmos in use; exact identity remains a prerequisite for service-specific changes.

Current primary-documentation findings:

| Topic | Supported conclusion and implication |
| --- | --- |
| MongoDB bulk operations | Installed driver supports collection bulk writes. Official docs require MongoDB Server 8.0+ for client-level multi-namespace bulk writes, even with a recent driver. Do not assume one driver-level batch can write all Aurvin collections on Cosmos. [MongoDB Node bulk-write requirements](https://www.mongodb.com/docs/drivers/node/current/crud/bulk-write/) |
| Batch atomicity | Single-document MongoDB updates are atomic; multi-document writes can interleave without a transaction. Ordered bulk execution is not a cross-collection commit. Preserve a recoverable projection/commit boundary. [MongoDB atomicity documentation](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/) |
| Cosmos MongoDB transactions | Microsoft documents single unsharded-collection support and a fixed transaction timeout for the API discussed. It is not permission to use a six-collection transaction or the native replica-set protocol. [Cosmos MongoDB transaction scope](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/use-multi-document-transactions) |
| Cosmos MongoDB capabilities | The 4.2 feature page documents feature-gated 16 MiB support and retryable-write restrictions, including unordered bulk limitations when that capability is enabled. Preserve current conservative bounds until the actual collection/account is verified. [Cosmos MongoDB 4.2 feature support](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/feature-support-42) |
| NoSQL transactional batch | The documented NoSQL batch uses the same partition key in one container, with limits. It is a different API from the existing MongoDB driver and six-collection layout. [Cosmos NoSQL transactional batch](https://learn.microsoft.com/en-us/azure/cosmos-db/transactional-batch) |
| New distributed-transaction preview | Current docs describe a NoSQL/.NET preview and explicitly exclude MongoDB. It cannot be used to infer cross-collection support for this project. [Cosmos distributed transactions preview](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-configure-and-use-distributed-transactions) |
| Rate limiting | Cosmos MongoDB can report 16500; optional server-side retry can delay requests and eventually time out. Client request count alone can hide this service-side delay. Inspect the actual setting and bounded timeout interaction before changing retries. [Cosmos MongoDB server-side retry](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/prevent-rate-limiting-errors) |
| RU measurement | Microsoft describes per-operation RU statistics through `getLastRequestStatistics` and portal/query statistics. Such measurement is a later authorized service test, not part of this read-only research. Do not add an extra statistics command after every production operation to “optimize” reads. [Cosmos MongoDB request-charge measurement](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/find-request-unit-charge) |

An async flush of all original writes does not inherently reduce RU consumption. Batching can reduce network round trips while retaining many document writes and index updates. Coalescing repeated full-record snapshots, eliminating redundant reads, and reducing saved intermediate states can reduce real work; measure the result on the identified service.

Also distinguish fewer database operations from lower provisioned bill. Billing impact depends on capacity mode and workload. A larger final document can cost more than one small update; a synchronized flush burst can hit throttling even if the average rate is lower. Prefer bounded batches and a small controlled writer concurrency rather than `Promise.all` over the entire backlog.

Do not solve this by putting the entire conversation, accounting history, tool transcript, or all outputs into a single session document. Preserve bounded per-message/attempt records and valid context references. Existing message reference loading already uses one bounded `$in` query, validates IDs/event sequence, and applies Calendar redaction: `backend/src/persistence/messages.ts:269`. Reimplementing it as one read per message would regress the existing design.

## 13. LangGraph durability options: useful, but not the whole solution

The installed LangGraph `1.4.19` exposes `async`, `sync`, and `exit` durability modes: `backend/node_modules/@langchain/langgraph/dist/pregel/types.d.ts:215`. The current official checkpointer page documents all three modes and the ambiguity of a new thread with no durable checkpoint. Its description of sync mode differs from the installed code's intermediate-step wait, so the installed version must be verified rather than assuming either the latest prose or a generic LangGraph explanation applies. [LangChain checkpointer durability modes](https://docs.langchain.com/oss/javascript/langgraph/checkpointers#durability-modes)

Actual installed behavior matters:

- `async` overlaps checkpoint writes with graph steps; it does not remove those writes.
- The installed loop explicitly awaits checkpointer promises after applying a completed super-step when durability is sync: `backend/node_modules/@langchain/langgraph/dist/pregel/loop.js:458`, `:478`. This does not establish that initial admission was durable before the first user node; application acceptance is a separate boundary.
- The run still awaits outstanding checkpointer promises in its final cleanup: `backend/node_modules/@langchain/langgraph/dist/pregel/index.js:1151`.
- `exit` defers checkpoint creation/pending writes until graph exit: `backend/node_modules/@langchain/langgraph/dist/pregel/loop.js:392`, `:532`, `:822`.
- Aurvin adds owner fencing, size validation, and existing pending-write reads around the stock saver: `backend/src/persistence/checkpoints.ts:255`, `:298`.

Therefore, changing shared `graphConfig` from sync to async is not a sufficient implementation of consolidated asynchronous persistence. It does not remove application acceptance/accounting/finalization writes, and terminal graph completion can still await the save.

An exit-only invocation for pure text is a worthwhile focused experiment if the user accepts loss of mid-run checkpoint progress. Keep it scoped to the appropriate ordinary path rather than changing Calendar's dispatch boundaries and all recovery/updateState calls through one shared flag. Verify resulting checkpoint IDs, boundaries, pending writes, legacy/restart recovery, and finalization before relying on it.

For a genuinely memory-first ordinary runtime, an installed in-memory saver is an available option, but memory-only LangGraph state is not remote persistence. It needs bounds and cleanup; a default in-memory saver retained indefinitely can accumulate history. Do not run both memory and remote graphs in a way that repeats inference. Persist the already computed public final result, not a second graph execution with provider side effects.

The current live path already precomputes a result before graph invocation when its receipt is valid. For that branch, reducing checkpoint frequency mainly affects later sealing/finalization; acceptance and delivery-start persistence remain earlier bottlenecks. `backend/src/chat-runtime/durable-chat-runtime.ts:1495`.

## 14. Guarantees preserved and lost

| Guarantee | Recommended memory-first ordinary conversation | Compact durable Calendar dispatch boundary |
| --- | --- | --- |
| Request validation, size/context limits, server identity, provider `user` | Preserve before any paid work. | Preserve, including original target/account authorization. |
| One active generation per session across tabs | Preserve through the single server's synchronous reservations and versioned memory state. No multi-instance guarantee. | Preserve same topology, with durable operation identity for effects. |
| Duplicate delivery in the same process | Preserve within the bounded request-ledger retention window. | Preserve operation/request identity and existing receipt/readback rules. |
| Accepted input survives process crash | Lost until remote save or optional local durability boundary. | Required authority/operation evidence survives the chosen admitted boundary; ordinary narration can still be lost. |
| Completed answer survives process crash | Lost if still only in memory; optional final-result spool improves same-disk recovery. | Effect may survive even when its narration does not. Recover receipt/readback independently. |
| Fine-grained observation history | Deliberately reduced to final aggregates; unpersisted observations can disappear. | Keep only effect-critical evidence synchronously; other observations can aggregate. |
| Same-process next-turn continuity | Preserve using ordered dirty overlay and settled heard-history evidence. | Preserve valid call/result groups, intent/target references, and retention policy. |
| Restart without repeated inference | Preserve as a recovery policy: no-result is interrupted/unknown, not automatically inferred again. This sacrifices automatic completion. | Dispatching/unknown reconciles original operation rather than creating a new one. |
| Exactly-once provider inference/billing | Never guaranteed; volatile evidence increases attribution gaps. | Still not guaranteed for model calls or external effects. Stable IDs/readback reduce specific duplication risks. |
| Remote durability implied by completed UI | Lost unless a separate saved acknowledgement has arrived. Product copy/contracts must change. | Only claim effect success from appropriate receipt/readback, not optimistic narration. |
| Accurate voice heard history | Preserve while proof survives in memory; after loss use unknown. | Voice does not gain Calendar execution simply through this persistence change. |
| Cross-restart quotas/accounting | Not guaranteed by a memory ledger; compact reservations or provider caps are separate options. | Existing durable budgets can remain if that protection is required. |
| Safe ownership handoff | Requires no overlapping executors, tracked delayed writes, honest drain, and conservative uncertain-state handling. | Same requirement; never clear effect evidence as if a generation slot were an effect receipt. |

## 15. Product and deployment decisions needed before implementation

These are unresolved decisions, not requests to authorize live research or infrastructure changes now.

| Decision | Suggested starting position |
| --- | --- |
| Does “completed” mean answer generation finished or remote persistence confirmed? | Generation finished plus a separate save state; saved is confirmed independently. |
| What may be lost: in-progress turns, completed turns, or all dirty turns? | User has accepted dirty conversation/accounting loss; state this explicitly in the contract. If completed-answer loss is undesirable, select final-result spool. |
| Warm-only zero DB path, or cold starts/history too? | Warm active sessions first. Cold durable history loading remains a read. |
| Continue generating after disconnect? | Keep current bounded interrupt-on-disconnect initially; replay existing in-memory results only. |
| Restart with missing evidence | Explicit unknown/interrupted state and user-driven new attempt; no automatic inference/TTS/effect replay. |
| Ordinary chat during DB outage | Allow only warm validated memory sessions within a finite dirty backlog; decide whether the product wants this behavior. |
| Full queue/disk policy | Stop new paid work before overflow. Any ephemeral discard mode must be explicit. |
| Daily spend/usage across restarts | Accept reset/gaps or retain compact durable reservation/checkpoint; a memory-only hard cap is insufficient. |
| Calendar effect durability | Keep current remote compact effect records initially; do not apply the transcript-loss policy to unrecorded external mutations. |
| Local storage deployment | Confirm one installation/replica, retained writable path, storage type, ownership, crash/replace behavior, disk budget, and termination grace before selecting a journal. |
| Browser-restored content | Display/export first. Import requires a distinct untrusted provenance path, without billing or effect authority. |
| Exact Azure service | Obtain nonsecret resource identity, API/version, RU versus other capacity model, region(s), partition/index definitions, enabled capabilities, consistency/retry policy, and deployment placement. |
| Flush targets | Define maximum dirty bytes/turns/age, batch bytes/operations, writer concurrency, recovery time, and tolerated saved lag from measurements. |
| Retention | Apply existing Calendar permissions/expiry and account invalidation to memory, queues, disk, replay, and UI cache. |

## 16. Proposed failure checks and verification metrics

No tests in this section were executed. These are specific verification targets for a later authorized implementation, using current Vitest and deterministic fixtures. Native/Azure tests require their isolated operator-supplied prerequisites; provider calls and Calendar effects remain separately authorized.

### Smallest meaningful checks

| Check | Failure it must expose |
| --- | --- |
| Hold all DB writes unresolved, send a warm ordinary turn | Model dispatch/first output and generation completion must follow the chosen memory policy; saved status must remain pending. No fake confirmed receipt. |
| Same key/same input concurrently and after local completion | One acceptance, one provider execution, same IDs/result within retained memory window. |
| Same key/different input or different Calendar reply reference | Reject mismatch before generation/effect. |
| Lost POST response followed by same-key delivery retry | Return existing local request; do not create a new turn. Browser retains the key. |
| Explicit retry after unknown/interrupted restart | New attempt links to original input when that input survives; unknown missing input is not silently fabricated. No automatic replay. |
| Two tabs and text/live contention | Exactly one session owner in the admitted process; unrelated sessions make progress within caps. |
| Immediate next turn with first flush blocked | Context contains the previous accepted input and completed assistant exactly once, using memory; no stale graph/manifest error. |
| Voice next turn with DB blocked | Uses settled in-memory `textSpoken` or unknown marker, not generated-but-unheard prose; avoids delivery reread. |
| Slow/coalesced progress writes | Latest absolute sample/usage state wins; queue remains bounded; terminal state is not overwritten by a late progress callback. |
| Abort, barge-in, stale socket epoch, malformed split | Playback stops immediately; no duplicate TTS replay; invalid evidence stays unknown; correct spoken prefix retained. |
| Voice finish before terminal playback acknowledgement | Synthesis is not mistaken for heard completion. Remote saves do not block first Speak/PCM under selected policy. |
| Slow remote projection, many follow-up turns | Per-session flush order and durable high-water mark remain correct; manifest never commits references beyond the persisted prefix. |
| Batch partial success and ambiguous timeout | Retry only safe IDs/revisions; no double increments/debits, no lost known costs, no false saved result. |
| Rename/pin/archive or Calendar revocation during backlog | Old queued snapshots cannot restore obsolete metadata, unarchive sessions, or reintroduce expired content. |
| Full queue, long outage, permanent schema error | Finite bytes/count, deterministic admission rejection/degradation, bounded retries, no unhandled rejection or silent dirty eviction. |
| Shutdown with detached flush still active | Drain sees queue and raw promise; safe result is false until settled/spooled under selected policy; no premature DB close/sentinel release. |
| Process crash before/after final envelope and during remote projection | Correct loss boundary; surviving envelope replays persistence only; no sealed result means no automatic inference. |
| Local spool torn tail, corrupt middle, disk full, format upgrade, missing volume | Detect/reject conservatively; bounded replay; no silent record skipping, credential leakage, or false local durability. |
| Calendar provider success followed by receipt-save failure | Reconcile the original event ID and original authority; never a second create with a fresh ID. |
| Calendar intent/dispatch save failure before HTTP | No mutation leaves the process. Ordinary transcript persistence may remain asynchronous independently. |
| Fresh/legacy persisted sessions after rollout/rollback | Current readers/recovery do not interpret partial or newly aggregated records as fully durable completed turns. |

Existing suites to extend/reuse rather than introduce a framework:

- `backend/test/model/observation-writer.spec.ts:32` covers bounded latest-snapshot state and raw-promise drain; `:225` covers visible timeout versus underlying write.
- `backend/test/chat-runtime/admission-receipt-reuse.spec.ts:28` checks pinned checkpoint identity and source reuse.
- `backend/test/performance/voice-critical-path.spec.ts:30` checks real delivery/linkage work with deterministic storage behavior.
- `backend/test/voice/agent/voice-delivery.spec.ts:93` covers unknown delivery; `:157` covers coalesced playback; `:175` covers stall/cancel bounds.
- `backend/test/runtime/recovery.native.e2e-spec.ts:50` checks sealed-result recovery without reinference; `:72` checks no-result interruption.
- `backend/test/runtime/voice-recovery.native.e2e-spec.ts:31` checks sealed live result and pending delivery recovery.
- `backend/test/runtime/calendar-recovery.spec.ts:55` checks provider-success/local-receipt-failure readback; `:80` checks no recovery HTTP when admission cannot be confirmed.
- `backend/test/operations/local-recovery.spec.ts:60` checks maintenance drain before a fresh runtime and retention of failed recovery evidence.
- `backend/test/persistence/mutation-journal.spec.ts:75` checks guarded saver writes; it does not test a new filesystem spool.
- Existing frontend reducer/client/voice fixtures are appropriate for optimistic row merge, retained request identity, pending-save navigation, and reconnect behavior.

Some existing test names reflect older durability expectations. Reconcile assertions against the selected product policy explicitly; do not delete a failing crash/delivery check merely to make a deferred save pass.

### Measure all work, including after the visible answer

| Metric family | Required measurements |
| --- | --- |
| Text latency | Browser Send → local acceptance; provider dispatch; first token received; first visible paint; last token; generation outcome; session-slot release; remote saved acknowledgement. Keep first/warm/cold/cache-miss distributions separate. |
| Voice latency | Speech end/finalized transcript → acceptance/model dispatch/first text/Speak/first PCM sent/first non-silent audio observed/playback acknowledgement. Distinguish STT/TTS socket setup from steady-state turns. |
| Save lag | Generation completion → flush queued/start/remote commit; final audio proof → delivery save; first/last dirty timestamp and actual maximum lag. |
| Database work | Actual driver reads/writes/commands by phase and collection, operation bytes, retries/failures, pool wait, busy interval, overlap, and ownership-queue time. Include detached flush and startup/readiness work separately. |
| Azure service | Identified API, region/distance, consistency/capabilities, RU per scenario and per completed turn, throttling/server-side retries, latency, and capacity mode. No reduction claim based only on fewer repository calls. |
| Backlog and resource use | Dirty sessions/turns/bytes, peak resident memory, duplicate payload copies, batch count/bytes/ops, active flushes, oldest age, write throughput, event-loop delay, rejected admission. |
| Recovery | Lost accepted/completed turns and accounting records at each injected crash window, spool replay work/time, unknown provider/effect outcomes, late write handling, repeat-recovery idempotency. |
| Correctness/cost | Provider POST count, stable attribution on every attempt, explicit zero versus unknown usage, no duplicated cumulative cost, explicit retry count, one Calendar create per recorded operation, correct heard prefixes and context ordering. |

Use p50/p95/p99 only with reported sample size, failures, timeouts, model, fixture/service type, workload size, concurrency, and environment. Report unknown/unrun samples and skipped tests separately. Do not present a deterministic delayed-storage fixture as an Azure speed measurement.

The project already records driver command phases, pool wait, command busy/overlap intervals, and bounded redacted metrics: `backend/src/persistence/database-observation.ts:36`; `backend/src/operations/telemetry.ts:194`, `:219`. Extend those scopes across queued tasks rather than inventing a parallel telemetry system. Preserve redaction; never log full message/tool payloads, URIs, tokens, or credentials to obtain the measurements.

Do not stop counting at the completed SSE event. A change that moves the same remote work after that event can improve perceived latency without reducing database load. Both are useful, but they are different claims.

## 17. Smallest future change boundaries

This is a source-based scope recommendation, not workflow initiation or an implementation plan.

1. **First isolate observation persistence policy.** Relevant code is `backend/src/model/openrouter-adapter.ts`, `accounting.ts`, `observation-writer.ts`, `backend/src/voice/agent/voice-delivery.ts`, and `backend/src/voice/usage/voice-accounting.ts`. Reuse merge/proof validation and stable keys; remove redundant intermediate work under the new loss contract. Keep required final save awaited initially if reducing implementation risk is more important than immediately reaching zero waits.
2. **Then establish trusted dirty state and one writer owner.** Runtime acceptance/status/context/replay, HTTP reads, voice context evidence, and operations drain must agree on memory versus confirmed state. This is the principal cross-layer work. Do not introduce a second runtime or persistence-close owner; composition remains in `backend/src/app.service.ts`.
3. **Add optimistic sidebar and delivery-key retention using existing reducers.** Backend overlay support must accompany it. A CSS/loading-only change would not fix pending-session navigation or duplicate sends.
4. **Keep Calendar effect dispatch records durable.** Optimize observation/receipt reuse around them before considering a new local effect journal. Preserve current deterministic event IDs, original-target readback, and finite budgets.
5. **Add a final-result spool only if the selected loss/deployment decision warrants it.** Do not build full lifecycle logging, raw audio retention, a broker, a new schema, or multi-instance coordination speculatively.

The most important implementation distinction is between **observed in this process**, **queued for persistence**, **confirmed locally**, and **confirmed remotely**. Existing receipts and recovery logic deliberately encode the last of those. A faster design can choose weaker durability for ordinary conversation while retaining exact identities, bounded resources, conservative unknown outcomes, and independent protection for external effects.
