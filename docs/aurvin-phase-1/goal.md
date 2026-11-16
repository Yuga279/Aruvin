---
objective: aurvin-phase-1
workflow: maw
artifact: goal
date: 2026-10-06
status: approved-scope
source: User-approved brainstorming in this chat
research: docs/aurvin-phase-1/research.md
state: docs/aurvin-phase-1/state.md
---

# Goal: Aurvin Phase 1

## 1. Outcome and authorization

Build the reliable foundation of Aurvin: a persistent text-chat application that uses LangGraph to call one OpenRouter model, streams responses, and preserves sessions independently from the agent's selected context. The first deployment is local or controlled staging. The architecture must support later MCP execution and context engineering through stable contracts rather than a replacement of its storage foundation.

The user approved this product direction and authorized preparation of this MAW workflow on 6 October 2026. This request delivers `goal.md`, the consolidated research in `research.md`, and the complete dependency graph in `state.md`. It does not dispatch implementation agents or represent implementation completion. Planning, execution, and final verification remain future required stages. The user subsequently selected `--skip review` on 6 October 2026; unified review is skipped, while required checks and defect correction remain mandatory. Root-level `AGENTS.md` is awaiting the user's approval before planning or implementation proceeds.

## 2. Product purpose and success

Aurvin is the application and agent runtime around a model accessed through OpenRouter. LangGraph organizes the execution and persists thread state; OpenRouter supplies model inference. A user should be able to start a chat, ask a question, see the answer appear progressively, ask follow-up questions, and reopen the session with both its visible history and context intact.

Success means:

- Completed conversations survive refreshes and backend restarts.
- The model receives the correct session context once, with the agreed instructions and knowledge.
- Duplicate submissions and concurrent tabs do not accidentally advance a session twice.
- The UI distinguishes saved completion from failed, interrupted, or cancelled generation.
- Model usage is attributable to the configured user and reconciled when terminal accounting is unavailable.
- The selected Azure MongoDB service is supported by evidence, not assumed equivalent to native MongoDB.
- Later tools and compaction can refer back to the original messages and execution events precisely.

## 3. User and deployment boundary

Phase 1 has one server-configured, hardcoded development user ID. There is no application sign-in, customer account management, or public multi-user isolation claim. All requests resolved to that ID belong to the same development identity.

Local deployment must bind appropriately. Shared staging must have a private access boundary or authenticated gateway protecting both frontend and API. Public production exposure requires a separate identity/access decision and corresponding validation. CORS and a client-supplied user ID are not authentication.

Use a backend identity resolver so a later authenticated identity can replace the hardcoded one without changing storage or model-request contracts. Application records and queries must carry user scope from the start. Test identities may be used in isolation tests without adding a login feature.

## 4. Confirmed scope

### Included

- Existing React/Vite/TypeScript frontend and NestJS/TypeScript backend.
- A basic LangGraph chat flow and the standard MongoDB checkpoint adapter.
- One OpenRouter model selected through backend configuration, without a UI model picker.
- Text-only input and streamed text replies.
- Context consisting of system instructions, basic guardrails, `product_knowledge.md`, current-session history, and the new input.
- General question answering, with product knowledge as background about Aurvin.
- New chat, sidebar history, session reopening, a central chat area, and a welcoming empty state.
- Six MongoDB collections: `sessions`, `messages`, `agent-memory`, `metadata`, `checkpoints`, and `checkpoint_writes`.
- Agent-memory references and context manifests rather than copied transcripts.
- Durable request/attempt lifecycle, bounded storage/context, usage accounting, operational visibility, and failure reconciliation.
- Stable relationships and ordering ready to represent future tool events.

### Deferred

- MCP connections, plugins, OAuth for external applications, and actual tool execution.
- Application authentication, billing UI, user administration, and customer quotas.
- Automatic summarization, compaction, episodic extraction, cross-session retrieval, embeddings, and vector search.
- Uploads, multimodal input/output, voice, branching conversations, message editing, and response regeneration features.
- A usage dashboard, advanced checkpoint recovery UI, time travel, and a durable detached background-run service.

Future-ready schemas must not become simulated tools, fabricated memory features, or unrelated framework scaffolding.

## 5. Chat experience

### Session navigation

The sidebar lists session titles and last activity using session metadata, with bounded pagination and a stable ordering tie-breaker. New chat opens a clean empty state. Create a persistent session when the first message is accepted; avoid saving empty sessions simply from navigation.

Use a deterministic title from the first accepted message in Phase 1, with length and rendering safeguards. No separate model call is required for titles. Reopening a chat loads ordered visible messages, paginating older history without a single growing transcript document. Preserve unsent input if a recoverable request fails.

### Sending and receiving

The composer supports multiline text and a clear submit action. Disable duplicate submission for an active turn in the current view; the backend independently enforces concurrency. Display preparing/generating/finalizing states in understandable language. Stream incremental answer text, render it safely, and avoid scrolling a user away from older content they are reading.

Provide cancellation for an active attempt, a clear failure/interruption state, and an explicit retry action where eligible. Retrying a failed logical turn must not duplicate its user message. Keep partial output visibly incomplete. On reconnect or refresh, read durable turn state rather than automatically re-send the prompt. Retain any durably captured partial output; do not promise every displayed token survives a process crash.

The browser should receive an application stream contract, not raw graph state, private instructions, checkpoint data, or provider credentials.

## 6. Agent and context contract

Keep the graph small and give nodes actual execution responsibilities. Expose the graph through an agent-runtime interface separate from HTTP, database repositories, and rendering.

At invocation, compose:

1. Versioned system instructions and behavioral guardrails.
2. Validated product knowledge from `product_knowledge.md`.
3. Eligible history for the current session, in valid message order.
4. The new user input exactly once.

The backend owns the product-knowledge file and loads/validates it at startup. Record its version or content hash, the instruction version, and graph/schema version on each attempt. A minimal initial knowledge file should describe Aurvin's current capabilities and deferred features accurately. Missing required knowledge/configuration must fail startup or readiness clearly.

Guardrails require uncertainty to be acknowledged and external actions not to be claimed without evidence. Credentials must never be placed in prompts. User content, tool results, summaries, and retrieved memory remain data; they cannot grant permissions or override backend authority. Do not expose or persist private model reasoning as product memory.

Use one stable LangGraph thread per session. Normal continuation adds only new input to the restored state. Do not append the saved full transcript repeatedly. The context manifest and checkpoint must identify the same completed history; reconcile disagreement before continuing. Do not concatenate checkpoint history with archive history as two independent inputs.

Use all eligible current-session history in Phase 1 until the context budget is reached. Reserve configured completion capacity and a conservative model-specific margin. Enforce message bytes, input token/message budgets, maximum output tokens, and any provider constraints. If history does not fit, explain the limit and require a new chat. Do not silently summarize, truncate, compress, or use another session's memory. Explicitly configure provider compression behavior where required.

## 7. MongoDB storage and authority

Use bounded records; growing content belongs in child records, not unlimited session arrays.

| Collection | Record shape and authority |
| --- | --- |
| `sessions` | One metadata document per chat. Owns user/session identity, title, activity, lifecycle summary, graph thread association, and execution ownership/version fields. Does not contain the transcript or an unlimited array of message/attempt IDs. |
| `messages` | Individual visible user/assistant messages. The authoritative conversation archive supplying the UI. Records carry user/session/turn identity, event identity/order, role, content, timestamps, and completion status. |
| `agent-memory` | Bounded working-context manifests with source ranges/references, context version, and active summary reference, initially null. Future derived memories use explicit types and provenance. No duplicate raw transcript in Phase 1. |
| `metadata` | Bounded attempt, accounting, and lifecycle/event records. Stores request deduplication identity and execution outcomes; later stores assistant tool requests, tool results, and errors or bounded payload references. |
| `checkpoints` | Native LangGraph graph-state checkpoints, managed through the supported adapter. |
| `checkpoint_writes` | Native intermediate checkpoint writes, managed through the supported adapter. |

Conversations are not recoverable solely from an LLM summary. Archive retention and context selection are separate policies. App-owned schemas must have versions and repository interfaces. Do not depend on undocumented internal checkpoint serialization for UI rendering.

Index session listing and message retrieval according to user/session scope, ordering, and pagination. Enforce appropriate stable identity uniqueness compatible with the selected service and partitioning. Validate payload/document headroom before acceptance and bound memory/metadata records too. Oversized future tool payloads require bounded storage or external references; their existence must not break the session document.

### Cosmos DB compatibility gate

The user believes the database is Azure Cosmos DB but has not identified RU-based MongoDB, vCore/Azure DocumentDB, API version, enabled features, or partition configuration. These are mandatory inputs to persistence implementation.

Before database implementation, record the actual service and verify document limits, transactions, consistency semantics, indexes, unique constraints, TTL, driver/checkpointer compatibility, and backup facilities. RU-based Cosmos DB must not be given a cross-collection transaction design it does not support. Choose idempotent writes and reconciliation where atomicity is unavailable. Use service-specific evidence for staging; native MongoDB tests alone are insufficient to certify Cosmos DB behavior.

## 8. Timeline, causality, and future tool placement

A logical turn starts with one user submission and includes all work responding to it. It can contain multiple model steps, future tools, and an eventual visible answer. An attempt is a particular execution of that turn; an explicit retry creates a new attempt without another user-message record.

Common identifiers:

- `userId`, `sessionId`, `turnId`, and stable `eventId` / `messageId`.
- Request/idempotency identity, payload identity, and `attemptId` for executed work.
- Backend-assigned sequence within the session, plus causal/source-event references.
- Model generation ID, graph thread/checkpoint linkage, and context version where relevant.
- Future assistant tool-request group/model-step identity and provider `toolCallId`.

Ordering and causality must both be preserved. Timestamps alone do not establish order. A future tool result must identify the assistant's originating tool request and call ID; parallel results may arrive in a different order from requests. Tool metadata must retain arguments/results, not merely timing counters. Preserve valid call/result groupings when reconstructing model input.

Allocate sequence under backend execution ownership. Account for gaps, crash windows, and partial writes; do not infer successful completion from an allocated sequence. The UI reads visible messages; context engineering can additionally use committed metadata events. Future compaction covers a completed event boundary and keeps recent complete interactions intact.

## 9. Durable turn and streaming lifecycle

Use accepted, generating, finalizing, and completed lifecycle states, with failed, cancelled, and interrupted terminal outcomes. Usage has a separate known/pending/unknown status. A provider length stop is an incomplete/truncated answer, not indistinguishable from ordinary completion.

Required sequence:

1. Validate the request and resolve server identity. Check ownership, context/storage budgets, and duplicate identity.
2. Acquire exclusive session execution ownership. Persist the accepted input and its attempt/lifecycle record before making a model request.
3. Invoke the configured model through LangGraph; every attempt carries the resolved OpenRouter `user` value.
4. Emit a versioned stream with turn/attempt IDs, deltas, and explicit lifecycle events. Distinguish provider framing/comments, errors, usage, and completion.
5. Await graph completion and required checkpoint persistence. Finalize messages, execution/accounting records, and context references using the selected persistence policy.
6. Emit application completion only after durable finalization. If connection loss prevents delivery, the stored state remains fetchable.

Use bounded periodic partial-output persistence if implemented; do not write each token independently. Do not treat HTTP 200, EOF, or a provider terminal token as application completion by itself.

One session can have one active attempt. Reject another new turn while it is active with a predictable conflict result; do not silently queue Phase 1 turns. Repeated requests with the same identity and payload return recorded status/result. A reused identity with different input is rejected. Retry attempts and events must be deduplicated durably.

Execution ownership must survive the supported deployment topology. A process-local mutex alone is insufficient for multiple replicas. If leases are used, renewal, expiry, stale-worker fencing, and graph-write protection must be demonstrated. A lease timeout must not allow an old worker and a new worker to mutate the same graph concurrently. Until those properties are verified, operate with an explicitly enforced single-executor topology; do not claim horizontal execution safety.

Basic reconciliation belongs in Phase 1: finalize from a saved completed result when possible without another inference; otherwise mark interrupted and require explicit retry. Repeated recovery must be idempotent. A cancelled or interrupted partial answer is not silently inserted into later context as a completed answer.

## 10. OpenRouter adapter, attribution, and resource controls

Keep the API key only in backend configuration. Evaluate the dedicated JavaScript OpenRouter integration behind an application adapter. Verify actual outgoing `user`, configured model, context/compression settings, abort propagation, generation identity, provider outcomes, usage, and cost against the chosen dependency versions.

Store accounting per attempt/generation, including scope IDs, requested/reported model and provider, time, outcome, prompt/completion tokens, reported cost, and accounting status. Do not sum the same generation twice. A failed or retried request may still cost money.

Capture terminal accounting; reconcile through generation lookup when an ID exists. Without recoverable accounting, retain unknown/pending rather than zero. Do not implement a customer dashboard or rely solely on the OpenRouter UI to supply application evidence.

Configure finite request, first-output, idle-stream, total-run, and persistence deadlines; input/output/storage limits; request rate and active-run caps; bounded retry counts; and upstream key spending controls. Classify retryable failures, use backoff and jitter, and avoid multiplying retry layers. Invalid credentials, credits, input, and context must not receive blind retries. After visible output or ambiguous generation, use explicit retry with recorded attempts. Best-effort cancellation does not guarantee upstream charges stop.

Select numerical values using the configured model, deployment, and expected workload at P1/P4/P8 gates. Safe defaults must be explicit and tested before workers finish; documentation research does not establish universal values. Public production capacity and spending targets require a rollout decision rather than invented promises.

## 11. Operations and security baseline

- Validate configuration and product knowledge before accepting work; redact credentials and sensitive payloads from operational errors/logs.
- Validate inputs, reject client identity/model/privileged-role overrides, cap payloads, and safely render Markdown/links.
- Provide correlated logs/traces using request/session/attempt/generation identity. Do not log full chat content by default or use user IDs as unbounded metric labels.
- Measure first-output and total latency, failures, interruptions, deduplication, checkpoint/finalization latency, reconciliation failures, and known/unknown accounting.
- Separate liveness from database/configuration readiness. Report upstream provider degradation without unnecessary restart loops or paid inference health probes.
- Stop acceptance during shutdown; finish or interrupt active attempts within a bounded drain window. Reconcile crashes that bypass graceful shutdown.
- Configure the staging proxy for actual streaming, timeouts, and no transcript caching; verify end-to-end behavior.
- Select provider privacy/routing policy deliberately and use separate environment credentials and appropriate database access.
- Document migrations, retention, consistent backup/restore, and rollback compatibility. Do not independently expire state needed by live sessions.

Operational requirements may be enforced by the platform or application, but their ownership and evidence must be explicit. No specific hosting provider, observability vendor, Redis service, or production infrastructure purchase is mandated by this goal.

## 12. Acceptance criteria

| ID | Required evidence |
| --- | --- |
| AC01 | New chat, sidebar session history, paginated opening/reopening, and safe deterministic titles work; no empty session is persisted merely by navigation. |
| AC02 | Text replies stream progressively; UI distinguishes generating/finalizing from completed, failure, interruption, truncation, and cancellation. |
| AC03 | System instructions, guardrails, product knowledge, and current-session history enter the configured model call correctly and exactly once; general questions remain supported. |
| AC04 | Completed chat and follow-up context survive refresh/restart; other sessions and test identities do not enter its context. |
| AC05 | The selected six collections have bounded records and validated schemas/indexes; no transcript, ID list, or attempt array grows unbounded inside a session. |
| AC06 | Agent-memory references original records and tracks context version/range; no transcript copying or active compaction is introduced. |
| AC07 | Messages and metadata retain session/turn/attempt scope, event identity/order, and causality. Tool-shaped fixtures reconstruct valid parallel call/result groups without enabling live tools. |
| AC08 | Double submissions and repeated request identities produce one logical input/attempt; changed payload with reused identity fails; intentional retry adds an attempt without duplicating input. |
| AC09 | Concurrent tabs cannot execute two active turns in one session; the documented supported executor topology and stale-worker policy are enforced. |
| AC10 | Input/attempt acceptance is durable before inference. Application completion is emitted only after graph/checkpoint and application finalization requirements succeed. |
| AC11 | Pre-stream errors, HTTP-200 error streams, abrupt EOF, cancellation, length stops, refresh, and partial-output outcomes are persisted and rendered honestly. |
| AC12 | Crash after saved graph completion but before application finalization recovers without a second inference. No saved final result produces an interrupted state and explicit retry. Recovery can run repeatedly safely. |
| AC13 | Every model attempt sends the backend-resolved `user` field and configured model; the browser cannot override identity/model or obtain the key. |
| AC14 | Generation accounting frames and cost are retained once; missing accounting is reconciled where possible and otherwise remains unknown. Attempt retries do not hide billable generations. |
| AC15 | Configured context, message, output, storage, concurrency, rate, retry, and timeout limits fail predictably. Full history is not silently compressed or removed. |
| AC16 | Selected Azure service/API/capabilities and adapter behavior are recorded and tested. Unsupported transactions/constraints are not assumed. |
| AC17 | Validation, safe rendering, secret redaction, staged access boundary, provider privacy configuration, and startup/readiness rules are verified. |
| AC18 | Metrics/log correlation, graceful shutdown, abrupt-crash recovery, proxy streaming, migration/rollback, and backup restore have staging evidence. |
| AC19 | A versioned behavior evaluation set covers product knowledge, general questions, follow-ups, capability honesty, and adversarial inputs; model/instruction changes trigger evaluation. |
| AC20 | Backend/frontend build, lint, meaningful unit/integration/e2e checks, compatibility checks, and final verification pass; unified review is explicitly skipped via the user's `--skip review` instruction. Results and limitations are reported accurately. |

Use deterministic provider fixtures for failure/lifecycle tests, native MongoDB where useful for fast repository tests, service-specific staging integration for Azure compatibility, and a small authorized live-model smoke/evaluation suite. Live tests must have cost limits and isolated test records. A specification or mock result is not production evidence.

## 13. Decisions required during the workflow

| Decision | Owner / deadline | Default boundary until resolved |
| --- | --- | --- |
| Actual Azure service, API version, capabilities, partitioning, consistency | Compatibility research R1 before P2 implementation | No database compatibility certification or unsupported transaction promise |
| Published runtime/dependency versions and contract shape | P1 before dependent implementation | Pin compatible releases; preserve existing project conventions |
| Model ID, context/token accounting, compression/privacy options | P4 before live verification | One configured model; no automatic model switch or silent compression |
| Finite resource defaults, test workload, staging targets | P1/P4/P8 before integration gate | Controlled local/staging load; no unsupported public-capacity claim |
| Product-knowledge contents and release ownership | P3 before behavior evaluation | Backend-owned truthful description of current capabilities |
| Staging hosting/access/proxy and production identity policy | P8 before deployment; production policy before public rollout | Local or protected staging only |
| Retention, backup/restore, and production recovery objectives | P8 before production readiness | Preserve raw evidence; no independent checkpoint expiry |

These are explicit workflow gates with owners, not permission to omit the requirements. `state.md` defines the plans, dependency edges, ownership, and evidence needed to close them.
