# Conversation latency investigation

Date: 27 October 2026. Source: `58f0b78`, branch `codex/google-calendar-plugin`.

**Historical investigation baseline.** Subsequent uncommitted implementation, regression results, resolved defects and remaining work are tracked in [conversation-latency-implementation.md](conversation-latency-implementation.md). Measurements below remain the original pre-change findings, not current behavior.

## Conclusion

The strongest explanation in the implementation is **serial database round-trip amplification**, compounded by Calendar discovery, accounting, checkpoints, and sequential model/tool/model calls. A short follow-up is not a short execution path.

There is also a reproduced **event-pagination defect**: refreshing an unchanged Calendar catalogue changes the revision to which an existing continuation is bound. The next page is rejected locally and sent through model correction instead of being fetched.

No production fix or configuration change was made. These are investigation findings, not verified speedups. Work remained in one session without delegated agents.

## Evidence and limits

- Offline probes: [conversation-latency.spec.ts](../../backend/test/performance/conversation-latency.spec.ts). Existing deterministic fixtures, real runtime/context/Calendar persistence adapters, in-memory storage, scripted provider responses. No real inference or Calendar effects.
- Command, from `backend/`: `npm test -- test/performance/conversation-latency.spec.ts --reporter=verbose --silent=false`.
- Raw latest probe output: `C:\Users\Peter\AppData\Local\Temp\opencode\aurvin-latency-probes.log`.
- Windows, Node `v24.18.0`. The configured local crash-recovery flag is false.
- Initially no backend listened on the documented ports. Later, read-only local HTTP inspection found a fresh running backend on port 8001. Its metrics showed `active=0`, `unresolvedWrites=0`, `degraded=false`, transport `active=0`, `backpressured=0`, and voice `active=0`. Turn timing counters were empty. This snapshot does **not** exclude a problem during an earlier conversation.
- The active nonsecret configuration was revision 2: model `openai/gpt-6-luna`, 80 context messages, 60,000 context-token ceiling, 6,000 output-token ceiling, 8 process generations, 30-second first-output timeout, 180-second total-run timeout. Provider performance/reasoning behavior was not measured.
- Direct database inspection was skipped because the configured URI did not pass a strictly local-host guard. No URI, credential, message content, event detail, or identity was printed. Attempts to obtain historical samples through `GET /api/sessions` returned `INVALID_REQUEST`; historical timings therefore remain unavailable. Its cause was not investigated as part of this performance audit.
- No backend start/restart command was issued. No direct external service checks, provisioning, migrations, paid requests, or Calendar mutations were performed; live inspection used read-only local HTTP routes.

## 1. Follow-ups reread history one record at a time — highest priority

**Confirmed by executable probes and source tracing.**

| Prior completed turns | Message reads before model | Acceptance-marker reads before model | Combined before model | Combined through completion |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 3 | 2 | 5 | 8 |
| 5 | 33 | 12 | 45 | 68 |
| 20 | 123 | 42 | 165 | 248 |
| 50 | 303 | 102 | 405 | 608 |

These count only `messages.get` and `metadata.getAcceptance` in direct runtime execution. They exclude archive-page queries, manifest/session reads, ownership checks, writes, checkpoint I/O, HTTP admission and stream-attachment status reads. The 50-turn sample raises the **fixture-only** context-message bound to 500; the running application's 80-message bound was not changed.

For `N` ordinary completed prior turns, the observed text path makes `8N + 5` point reads before dispatch and `12N + 8` through completion. At 20 turns, a hypothetical 50 ms per sequential point read means **8.25 seconds before inference and 12.4 seconds through completion from these reads alone**. This is a calculation, not a measurement of the configured database.

The synthetic delay probe requested a 5 ms timer before each point read and measured approximately 2.5 seconds before inference / 3.8 seconds through completion. Windows timer scheduling rounded waits upward; this is a timer-based demonstration of amplification, not a 5 ms database benchmark. Undelayed in-memory follow-ups took milliseconds.

Why:

- [history.ts:47](../../backend/src/chat-runtime/history.ts#L47): `acceptedHistory` walks all attempts, awaits one acceptance lookup per attempt, then pages all archived messages.
- [referenced-context-assembler.ts:95](../../backend/src/context/referenced-context-assembler.ts#L95): every assembly rereads each referenced message sequentially; voice history adds individual delivery lookups.
- [durable-chat-runtime.ts:196](../../backend/src/chat-runtime/durable-chat-runtime.ts#L196): boundary validation and assembly run during acceptance **and again during stream execution**; ordinary text assembles a third time in the graph's prepare hook at line 610.
- [messages.ts:195](../../backend/src/persistence/messages.ts#L195): finalization reference reads are sequential too. Text generation and `checkedResult` each reread the historical references after inference.

**Optimize:** bounded bulk reads of scoped message IDs and acceptance markers; restore manifest order and validate every reference. Reuse one validated snapshot within an owned execution, checking its version at the required boundaries. Reuse `getReferences` rather than adding a second bulk-reader pattern. Do not silently truncate history, cache credentials/transcripts indefinitely, or remove reconciliation checks.

## 2. Unchanged Calendar refreshes invalidate event continuations — highest priority defect

**Reproduced using the real connection service, cursor implementation and Calendar API adapter.**

Probe result: first event-page target revision 2; next-page target revision 4; four mocked discovery requests; only one event-page request; second page fails `CALENDAR_INPUT_REJECTED` **before provider dispatch**.

The ordinary path is:

1. Runtime resolves a target, forcing a discovery refresh.
2. Tool gate refreshes again to check the resolved target.
3. Event API signs a continuation using the first resolved target's discovery revision and expiry.
4. The next model tool call repeats resolution/refresh, producing another revision.
5. Cursor validation compares that new revision/expiry to the token's original scope and rejects it.
6. Runtime treats this as bad tool arguments and spends a schema-repair model call.

References: [calendar-loop.ts:1492](../../backend/src/chat-runtime/calendar-loop.ts#L1492), [connection.ts:923](../../backend/src/plugins/google-calendar/connection.ts#L923), [discovery.ts:305](../../backend/src/plugins/google-calendar/discovery.ts#L305), [calendar-api.ts:398](../../backend/src/plugins/google-calendar/calendar-api.ts#L398), [calendar-api-cursor.ts:168](../../backend/src/plugins/google-calendar/calendar-api-cursor.ts#L168).

**Optimize/fix:** preserve and validate a continuation's original bounded snapshot/target scope while independently checking current account and target rights. Alternatively, stop revision churn for semantically unchanged discoveries with a carefully defined stable snapshot lifetime. Do not simply remove cursor signature, scope or expiry checks. Add an integrated two-page regression with real discovery refreshes; the existing runtime fixture's capability gate does not perform those refreshes.

## 3. Repeated full catalogue downloads on the critical path — high priority

**Confirmed; three consecutive checks produced three discovery calls even without any account/calendar change.**

- [connection.ts:886](../../backend/src/plugins/google-calendar/connection.ts#L886) and [connection.ts:1033](../../backend/src/plugins/google-calendar/connection.ts#L1033) call `refresh(force: true)`, not the existing `ensureFresh` cache.
- Event reads resolve in the runtime and recheck in the tool: normally two full discoveries before the actual event GET/list.
- Creates resolve in the runtime, re-resolve in the operation writer, and recheck in the tool: normally three discoveries, plus availability preflight, create, and possible readback.
- Each refresh also rereads connection state repeatedly and persists a new discovery revision.
- [discovery.ts:127](../../backend/src/plugins/google-calendar/discovery.ts#L127) coalesces only **out-of-turn** refreshes; in-turn requests do not share flights.

**Optimize:** use the existing fresh discovery cache for selection, preserve same-turn validated scope, and perform one narrowly scoped fresh capability check at the effect boundary. Evaluate target-only verification rather than redownloading the whole account catalogue. Coalesce equivalent in-flight reads with per-turn accounting/cancellation ownership. Preserve immediate local disconnect/replacement invalidation and current rights checks before a write; this requires policy-aware design, not blanket caching.

## 4. Calendar accounting and evidence generate many serial storage commands — high priority

**Measured in the isolated fixture, even with no previous conversation.**

| Scenario | Model calls | Calendar-adapter storage commands | Of which writes |
| --- | ---: | ---: | ---: |
| Ordinary text while Calendar is enabled | 1 | 59 | 10 |
| One event read and answer | 2 | 134 | 23 |
| One event create and answer | 2 | 179 | 31 |

These are commands through the Calendar adapters' shared `RecordStore`, excluding fixture initialization and the probe's post-turn budget inspection, not full production totals. Ordinary application persistence, real ownership fencing, stock MongoDB checkpointing, real capability discovery and real credential refresh are absent or simplified in this fixture. Do not mistake the fixture's one GET / preflight+create request counts for the assembled production provider request counts.

Sources:

- [calendar-budget.ts:285](../../backend/src/chat-runtime/calendar-budget.ts#L285): dispatch reservation rereads budgets, dispatch lists, saved dispatch and budget; binding and before-dispatch repeat reads/fencing.
- [calendar-budget.ts:373](../../backend/src/chat-runtime/calendar-budget.ts#L373): observation update reads a dispatch, writes it, rereads it.
- [calendar-budget.ts:233](../../backend/src/chat-runtime/calendar-budget.ts#L233): request charging reads the budget and calls `consumeNow`, which reads it again before CAS processing reads it again.
- [calendar-accounting.ts:344](../../backend/src/persistence/calendar-accounting.ts#L344): dispatch updates read/parse/CAS, sometimes recompute money using a budget read and dispatch-list query.
- [store.ts:61](../../backend/src/persistence/store.ts#L61): every immutable upsert rereads even after an acknowledged result.

**Optimize:** remove duplicate reads inside the same serialized ledger action; return authoritative updated records from CAS operations; coalesce unchanged observations; make successful acknowledged insert handling avoid redundant confirmation where the result proves the needed invariant. Retain reread-on-uncertain outcomes, durable spend reservation before dispatch, receipt/evidence ordering and idempotency. Do not make required billing/safety evidence fire-and-forget.

## 5. Enabling Calendar makes unrelated text use the heavy path — high priority

[durable-chat-runtime.ts:741](../../backend/src/chat-runtime/durable-chat-runtime.ts#L741) admits a Calendar budget for every eligible text turn when Calendar is enabled. Execution chooses the Calendar loop based on that budget, not whether a tool was actually requested.

Thus “hello” also pays for account checks, dispatch reservation/observation/aggregate evidence, Calendar graph machinery, and **6,144 bytes of serialized tool schemas** in the fixture request. This is not a mandatory extra model classifier call: the current path still uses one model call for ordinary text, but its local/provider request is heavier.

**Optimize:** defer optional Calendar bookkeeping until a tool-capable dispatch or actual tool decision needs it, while reserving spend before every paid call. Investigate an explicit text-only capability mode or safe routing if desired. Do not use naive keyword routing to disable tools on “yes”, “tomorrow” or proposal replies; do not add an extra LLM classifier that costs more latency than it saves.

## 6. Each tool result usually requires another full model call — high priority, architectural

[calendar-loop.ts:543](../../backend/src/chat-runtime/calendar-loop.ts#L543), [calendar-loop.ts:1573](../../backend/src/chat-runtime/calendar-loop.ts#L1573): model decision → tool execution → model continuation. One tool read/create plus an answer required **two sequential model calls** in the probe. Pagination, multiple tools and repairs multiply this. The contract allows up to 8 dispatches, 6 logical tools and 2 repairs; parallel tool calls are disabled.

**Optimize:** avoid redundant model-requested availability checks when the runtime will already preflight a create; improve tool guidance and correction feedback; use deterministic receipt-based narration for narrow successful writes if product requirements allow it; avoid a second call solely to say “created”. Prefer one availability query over repeated event reads. Independent read batching is an architectural option, not permission to parallelize writes or bypass per-session serialization.

## 7. Latest-attempt/status lookup scans the whole session — medium/high priority

[history.ts:62](../../backend/src/chat-runtime/history.ts#L62) implements `latestAttempt` by fetching every attempt, paging and sorting, then finding the requested turn in memory. [durable-chat-runtime.ts:1046](../../backend/src/chat-runtime/durable-chat-runtime.ts#L1046) calls it twice for one `getTurnStatus`. Stream attachment calls status before `executeTurn` calls it again; submission also looks up the previous turn.

**Optimize:** one scoped latest-attempt query by user/session/turn, ordered by sequence; reuse the result in status/visibility projection. Verify a supporting query plan before adding an index. Existing session/sequence indexes help but do not make full archive materialization necessary. Keep failed/retried attempts ordered correctly.

## 8. Checkpoint wrapper duplicates reads and serialization — medium/high priority

[checkpoints.ts:172](../../backend/src/persistence/checkpoints.ts#L172) queries latest checkpoint and pending writes for bounds, then calls the stock saver's `getTuple`, which fetches its tuple again. `put` serializes for byte validation before the stock saver serializes for persistence. `putWrites` reads existing writes and serializes values before invoking the stock writer.

[finalization.ts:34](../../backend/src/chat-runtime/finalization.ts#L34) requires synchronous graph durability. Several graph nodes plus repeated `getState`/boundary-confirmation calls therefore produce real database barriers, even though node bodies are tiny. Calendar prepare also calls `graph.getState` from inside an invocation.

**Optimize:** reuse the bounded tuple/serialized envelope if the stock saver extension contract permits it; eliminate redundant `getState` calls under the same immutable checkpoint ID; reduce unnecessary intermediate node/state traffic after recovery analysis. Keep acceptance, external-operation authority, saved result/seal and completion boundaries durable. Switching globally to async/exit-only checkpoints would sacrifice existing crash guarantees and is not a safe quick fix.

## 9. One global ownership queue causes head-of-line blocking — medium priority

[ownership.ts:66](../../backend/src/persistence/ownership.ts#L66) serializes ownership operations and guarded actions across the entire process. Every `run` fences through an executor read and session read. Even separate sessions can wait behind another session's slow database operation. `owner.drain()` also waits on that global tail at request cleanup.

**Optimize:** first reduce commands inside the queue. Then evaluate per-session queues with a separate executor-control barrier, preserving drain and shutdown semantics. Raising the configured process concurrency above 8 will not remove this lock. Do not permit overlapping attempts within one session.

The optional [mutation journal](../../backend/src/persistence/mutation-journal.ts#L40) adds another process-wide write queue and two majority+journal sentinel writes per data mutation. It is **configured off here**, so it is not the current explanation; do not enable it as a performance remedy or weaken it without redesigning crash safety.

## 10. Calendar signals completion before freeing the active attempt — reproduced race

[calendar-publication.ts:321](../../backend/src/chat-runtime/calendar-publication.ts#L321) emits completed; [durable-chat-runtime.ts:866](../../backend/src/chat-runtime/durable-chat-runtime.ts#L866) subsequently stops heartbeat, clears the attempt, drains, and finally releases ownership/job state. The probe paused `clearAttempt` and observed `completedAlreadyEmitted=true` while `active=1`.

An immediate follow-up can therefore collide with cleanup despite the UI showing completion. This is a race/rejection window, not proof of a queued background job.

**Optimize/fix:** align the user-visible ready-for-next-turn signal with successful active-attempt cleanup and ownership release, while retaining durable terminal evidence. Add a follow-up-on-completion regression. Transport attachment cleanup must also be considered; emitting completed alone does not mean the old stream reservation has closed.

## 11. Initial SSE buffering hides progress — medium perceived-latency priority

The browser performs a submission POST, waits for durable acceptance, then opens a second HTTP stream. [sse-writer.ts:42](../../backend/src/http/sse-writer.ts#L42) buffers accepted/generating events and delays headers until content, usage, a Calendar progress event, or a terminal event arrives. [calendar-loop.ts:683](../../backend/src/chat-runtime/calendar-loop.ts#L683) cannot execute a tool until its streamed decision is complete; reasoning-only frames are not visible text.

**Optimize:** flush accepted/generating promptly, keep a bounded stream heartbeat if needed, and show actual admission/context/model/tool/finalizing stages. This improves feedback, not provider computation. A combined acceptance/stream endpoint could remove one HTTP round trip, but is a larger protocol change and must preserve idempotent durable acceptance.

The existing SSE writer already disables proxy buffering through headers; the checked-in NGINX proxy has buffering off too. There is no evidence that changing those files would fix the observed delay. Actual deployed proxy/browser delivery remains unmeasured.

## 12. Frontend reparses old answers on every stream update — medium priority, not yet browser-profiled

- [chat-context.tsx:78](../../frontend/src/features/chat/state/chat-context.tsx#L78): one context value changes on every text delta and composer edit.
- [MessageItem.tsx:85](../../frontend/src/components/MessageItem.tsx#L85): every message consumes that context; memoizing the outer row alone will not prevent context-driven rerenders.
- [safe-markdown.tsx:362](../../frontend/src/features/chat/markdown/safe-markdown.tsx#L362): parses Markdown during every render.
- [ChatView.tsx:57](../../frontend/src/features/chat/ChatView.tsx#L57), [canvas-artifacts.ts:1039](../../frontend/src/features/canvas/canvas-artifacts.ts#L1039): every token invalidates artifact collection, which reparses all prior assistant messages as well as the active stream.
- [ScrollController.tsx:51](../../frontend/src/components/ScrollController.tsx#L51): a newly allocated dependencies array reruns scroll-height/layout work on parent renders, including unrelated changes.

**Optimize:** cache parsed immutable messages and their artifacts by content/message ID; separate archived artifacts from active-stream extraction; pass narrow stable props to message rendering and remove full chat-context subscriptions from unchanged rows; batch visual delta updates once per animation frame; use stable scroll dependencies. Profile before introducing virtualization or a new state library. Preserve sanitization, ordered deltas, cancellation and accessibility.

## 13. Full prompt/history and 6,000 output budget can dominate provider time — conditional

All selected current-session history, fixed instructions/product knowledge and tool schemas are resent on each dispatch. Tool continuations also resend accumulated tool results. There is no compaction and no provider latency/reasoning preference configured in [policy.ts:52](../../backend/src/model/policy.ts#L52).

**Optimize:** benchmark the configured model's first-output latency and generation speed separately from local preparation; inspect reported reasoning/cached tokens where supplied. Consider a lower-latency backend-configured model or supported reasoning-effort controls only with explicit product approval and capability/privacy checks. Keep tool result fields and answers concise. Cache-friendly stable prompt prefixes are worth measuring. Lowering maximum output tokens caps long generation; it does **not** automatically make a short answer faster. Do not silently drop history, introduce summary generation, or change the user's model as part of this investigation.

## 14. Error handling contains waits that do not actually retry — conditional tail-latency issue

[calendar-api-http.ts:272](../../backend/src/plugins/google-calendar/calendar-api-http.ts#L272) sleeps for `Retry-After` on rate limiting, then throws; normal read handling seals a failure rather than retrying within that call. [calendar-adapter.ts:198](../../backend/src/model/calendar-adapter.ts#L198) similarly sleeps before yielding a retryable rejection, but the current loop's provider-failure path does not implement a provider retry.

**Optimize:** choose one retry owner. Wait only when an admitted retry will actually occur; otherwise return a useful bounded failure promptly. Keep no-blind-write-retry/readback rules and never replay possibly billed inference without clear rejection evidence. A 20-second tool deadline or 180-second run ceiling is a ceiling, not the cause of every slow request; increasing these is not an optimization.

## 15. Broad availability preflights and sequential batches — conditional

[calendar-preflight.ts:86](../../backend/src/chat-runtime/calendar-preflight.ts#L86) invokes availability without `calendarIds`, so [tools.ts:474](../../backend/src/plugins/google-calendar/tools.ts#L474) includes the discovered calendar set, not just the write target. [calendar-availability-api.ts:284](../../backend/src/plugins/google-calendar/calendar-availability-api.ts#L284) processes up to two batches sequentially and shares working-byte/interval budgets between them.

**Optimize:** avoid redundant model-initiated preflights before the mandatory fresh runtime scan; retain an already fresh discovery snapshot. Changing the calendars covered changes conflict semantics and needs approval. Parallel batch delivery would require preserving global response-byte, interval, request and disclosure bounds, not simply adding `Promise.all`.

## 16. Missing latency visibility can make the wrong component look stalled — diagnostic priority

[observed-runtime.ts:96](../../backend/src/operations/observed-runtime.ts#L96) measures first output/finalization/completed success on `emit`, but Calendar output travels through `emitCalendar`, whose wrapper does not perform those same measurements. Calendar-heavy traffic can therefore be absent from first-output/finalization counters. Calendar usage records expose timestamps but their current elapsed interval also includes local ledger/observation work.

[observe-persistence.ts:49](../../backend/src/operations/observe-persistence.ts#L49) times selected writes, not reads or ownership-queue wait. Existing model/provider response timings end at headers, not complete tool/model latency. Aggregate counters reset on restart and do not provide per-turn percentiles.

**Improve measurement before tuning further:** one monotonic per-turn timeline: submission received → acceptance durable → SSE attached → context ready → model dispatched → first meaningful provider output → first browser-visible delta → each tool/discovery/refresh start/end → provider done → durable finalization → slot released. Record read/write/checkpoint counts, queue wait, prompt/output/reasoning tokens and event-loop delay. Apply the same measurements to all protocol versions. Keep scope identifiers hashed and never log payloads or secrets; use bounded timing storage, not unbounded labels.

## Background processes: what was and was not found

- No periodic compaction, embeddings, summary-generation, retrieval or background agent loop runs in the traced text path.
- The lease heartbeat normally waits asynchronously for 30 seconds; stopping it wakes the timer immediately. It does not unconditionally add a 30-second tail.
- Readiness dependency checks are already cached/coalesced for 5 seconds and make no paid inference calls.
- Accounting's generation-lookup reconciliation method has no production caller in the searched source; it is not secretly running on every text completion.
- Identical accounting observations are already coalesced: a 100-fragment text response produced 6 dispatch-save calls, not 100 token-by-token saves. The extra reads/writes around each changed observation still matter.
- Real stalls can still arise from the global ownership queue, unresolved driver promises, provider response/Retry-After waits, failed finalization quarantine, or disconnect/account-invalidation drains. `Work.wait` has a visible timeout but `settled()` deliberately waits for dispatched persistence operations to settle before releasing ownership. Dropping those writes is not a safe optimization.
- Calendar disconnect/disable/replacement deliberately quiesces streams and redacts affected source records. This lifecycle work is not ordinary read/create polling and should not be removed to speed up tools.
- A provider error can impose the explicit 30-second readiness cooldown; the UI must distinguish unavailable/retryable from “still generating”.

## Recommended implementation order

1. Bulk history/acceptance reads and reuse validated execution snapshots; replace latest-attempt archive scans. Largest likely win for all follow-ups, without changing model behavior.
2. Fix continuation invalidation and redundant full-catalogue discovery together, retaining independent current-rights checks and bounded snapshot expiry.
3. Reduce ledger/storage round trips; measure queue wait and checkpoint overhead before changing durability topology.
4. Align Calendar completion/slot release and measure Calendar streaming with the same telemetry as ordinary text.
5. Cache immutable frontend Markdown/artifacts and batch display updates; then benchmark model/routing changes separately with explicit live-call authorization.

Suggested acceptance evidence: constant bounded history query count as turns increase; two-page event retrieval succeeds with real discovery code; no additional catalogue downloads for unchanged same-turn selection; no duplicate create or accounting debit after faults; immediate follow-up succeeds once the UI indicates readiness; p50/p95 submission-to-first-delta and durable completion measured for short/long text, read, create and conflict/proposal reply. Keep cancellation, expiry/redaction and crash-recovery tests passing.

## Verification performed

- New offline probes: **7 passed**.
- Related context, model, runtime, SSE and capability suites: **17 files / 147 tests passed**.
- `npm run lint` in `backend`: exited 0 with existing repository warnings; no warning referenced the new probe file.
- Focused type-aware lint of the final probe file: exited 0, no diagnostics.
- Document checks: all 45 relative file links resolve; no trailing whitespace in the two added files.
- No application source change, build/deployment certification, full-suite result, real-provider benchmark, database-topology certification, or unified review is claimed. Review remains **skipped**.
