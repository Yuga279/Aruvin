# Aurvin runtime, persistence, and accounting fit for member-connected tools

Research date: 20 October 2026. Inspected source baseline: `681787cffadd813f68f61531b7b1126656935263`. Scope: read-only source/dependency inspection and primary-document research; no implementation, installation, application database access, OAuth grant, provider inference, Calendar action, or application test execution. Review is **skipped**, not passed. The user has selected **a member connects their own Google Calendar**.

## Finding

Aurvin already has useful boundaries for a reliable tool-enabled product: server-side provider access, persisted acceptance, ordered causal identifiers, bounded reference-based context, isolated transcript/checkpoint responsibilities, durable completion publication, unknown-cost handling, encrypted provider credentials, and reporting. However, its current executable contract is deliberately one text generation per attempt. Installing an MCP client or adding JSON schemas alone cannot turn it into a safe Calendar agent. The model protocol, multi-round state machine, external-action recovery, cost ledger, authenticated membership, and member-owned connection lifecycle need a coordinated extension.

The smallest first product slice is one organization-approved Calendar integration, member OAuth connections, bounded text turns, narrow Calendar operations, a concrete action preview and approval, durable operation receipts, and total usage across all model rounds. An extensible marketplace, arbitrary executable plugin installation, generic workflow builder, tool autonomy in live voice, cross-session retrieval, and automatic compaction are unnecessary for proving this slice. This is a research recommendation, not an approved implementation plan.

## 1. What the present checkout actually contains

Historical root instructions describe unfinished Phase 1 verification and six collections. Current tracked files contain Phase 1 `verification.md` and `final_report.md`, later voice/configuration/recovery implementations, and a seventh `config` collection. This does not erase the remaining limitations in those reports.

| Area | Source evidence | Interpretation |
| --- | --- | --- |
| Collection names | `backend/src/contracts/collections.ts:20–27` | Six original collections plus `config`; document any further secure integration collections as an explicit schema/layout decision. |
| Phase 1 closeout | `docs/aurvin-phase-1/final_report.md:131–135` | Historical verdict is complete-with-blocks; external readiness is not certified by this research. |
| Config closeout | `docs/super-admin-config/final_report.md:7`, `:41–47` | Implementation/reporting exists; native verification and several provider-gate follow-ups are recorded blocked. Do not present that document as an all-green certificate. |
| Local stopped-owner recovery | `backend/src/operations/local-recovery.ts:20–44`, `:47–74` | A guarded local idle-journal handoff exists; it is not generic external-action recovery. |
| Identity | `backend/src/platform/identity/server-identity-resolver.ts:41–47`; `backend/src/contracts/identity.ts:23–34` | Every request resolves to one configured development identity. No organization/member claim or authenticated request context is present. |
| Admin identity | `backend/src/admin-config/admin-config.service.ts:320–328`; `backend/src/contracts/admin-config-wire.ts:64` | “Super-admin” is explicitly a development assumption with authentication disabled, not implemented RBAC. |
| Voice | `backend/src/chat-runtime/durable-chat-runtime.ts:130–137`, `:390–398`; `backend/src/context/referenced-context-assembler.ts:59–83` | Live voice uses the same runtime with internal transcript/delivery handling, so runtime changes have voice consequences. |

These are observations about source. Historical reported test runs remain historical evidence. No previously passing tests were rerun for this investigation.

## 2. Current dependency baseline and MCP compatibility

The backend manifest requires Node `^22.22.3 || ^24.15.0 || >=26.0.0` (`backend/package.json:8–9`). Its lockfile, rather than caret ranges alone, records:

| Package | Locked version | Lockfile entry |
| --- | --- | --- |
| `@langchain/core` | `1.2.16` | `backend/package-lock.json:576` |
| `@langchain/langgraph` | `1.4.19` | `backend/package-lock.json:594` |
| `@langchain/langgraph-checkpoint` | `1.1.5` | `backend/package-lock.json:613` |
| `@langchain/langgraph-checkpoint-mongodb` | `1.4.1` | `backend/package-lock.json:625` |
| `@langchain/openrouter` | `0.4.17` | `backend/package-lock.json:717` |
| `mongodb` | `6.21.0` | `backend/package-lock.json:4418` |

Neither `@langchain/mcp-adapters` nor `@modelcontextprotocol/sdk` is installed. The current LangChain guide uses `MCPAdapter`, `servers`, and `listTools()` for adapter 2.x. `MultiServerMCPClient`/`getTools()` examples belong to the separate 1.x guide or deprecated compatibility API. The modern adapter also changes tool-name prefixes, schema forwarding, error handling, and elicitation behavior, so copying older snippets is unsafe. [Current MCP guide](https://docs.langchain.com/oss/javascript/langchain/mcp), [migration guide](https://docs.langchain.com/oss/javascript/migrate/langchain-mcp-adapters).

Read-only npm registry inspection returned `@langchain/mcp-adapters` **2.0.1**, with peer dependencies `@langchain/core ^1.2.6` and `@langchain/langgraph ^1.4.18`, Node `>=20.10.0`, and dependencies on MCP client/core `^2.2.0` and Zod `^4.4.3`. The official monorepo package metadata confirms these values; Aurvin's locked core/graph versions satisfy these declared ranges. The migration guide's broader graph minimum is not a substitute for the selected package's actual peer range. This establishes declared dependency compatibility only; no package was installed, no lockfile was changed, and no executable MCP/checkpointer compatibility was tested. [Official package metadata](https://raw.githubusercontent.com/langchain-ai/langchainjs/main/libs/langchain-mcp-adapters/package.json).

Using a direct Calendar API adapter for the first slice can avoid an MCP dependency entirely. Using MCP can teach discovery and transport reuse, but cannot supply Aurvin's member authorization, approval, accounting, or action recovery. Both routes can expose the same narrow model-callable tool contract. The transport decision should follow the Calendar server's actual capability and authentication evidence, not the assumption that a plugin must be an MCP server.

## 3. The model boundary is text-only today

The execution path is `DurableChatRuntime.executeTurn` → `buildTurnGraph` → `OpenRouterAttemptAdapter.stream` → raw OpenRouter SSE. `ChatOpenRouter.invocationParams()` helps serialize provider settings; Aurvin does not run a stock prebuilt LangChain agent loop.

Concrete current restrictions:

- `backend/src/contracts/context.ts:22–25` permits only string content with `system`, `user`, or `assistant` roles.
- `backend/src/contracts/runtime.ts:27–50` has no tool definitions, tool-call messages, tool results, or tool-call stream chunks.
- `backend/src/model/policy.ts:33–48` validates text-only messages and estimates their content; `:51–58` serializes only role/content. Its `plugins` field disables OpenRouter's own request-processing features; it is unrelated to Aurvin's proposed Google integration catalogue.
- `backend/src/model/openrouter-adapter.ts:33–39` permits one stream invocation; `:100` rejects `delta.tool_calls` and legacy function calls; `:112–115` accepts only `stop`/`length` finish reasons.
- `backend/src/model/catalogue.ts:34–49` checks context/output/max-token capabilities, not tool support, parallel-call support, or complete tool-round behavior.
- `backend/src/agent/turn-graph.ts:29–47` is the linear `prepare → generate → seal` graph. `backend/src/agent/state.ts:31–35` saves one assistant result and one accounting record.

OpenRouter's client-tool protocol supplies function names/descriptions/JSON Schema to the model. The model returns an assistant tool call; the application validates and executes it; a `tool` message refers back with the same `tool_call_id`; another model request consumes the result. The `tools` definitions accompany continuation requests too. The model requests an action; application code controls its execution. [OpenRouter client tools](https://openrouter.ai/docs/guides/features/tool-calling).

For Aurvin, a streamed tool request must be collected by call index/ID with byte/count/depth limits, assembled completely, parsed, schema-validated, allowlist-checked, and authorized **before** any effect. A partial argument fragment is never an API request. Require complete terminal framing, stable IDs/names, no duplicate or conflicting calls, and useful failures for malformed JSON or unsupported tools. Sequential Calendar writes are sufficient for the experiment; disable parallel model calls where supported and enforce the sequential policy in Aurvin even if a provider ignores that hint. Preserve provisional-text semantics until durable terminal publication.

Choosing “a model that supports tools” is necessary but insufficient. The selected model/provider/protocol must also support multi-round use under Aurvin's prohibition on stored private reasoning. Some reasoning protocols expect reasoning/signature blocks to be echoed across tool rounds. Do not put private chain-of-thought into MongoDB, traces, or messages to satisfy a generic tutorial. Choose and test a compatible configuration; count billed reasoning tokens as usage without recording their content. Opaque continuation metadata, if required, needs a separate explicit security and retention decision. [OpenRouter reasoning documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

Fixed prompts also have to match the deliberately enabled slice. `backend/src/instructions/system.md:7–13` treats tool results as untrusted data and forbids claiming unsupported actions; its Phase 1 capability sentence says no live tools. `product_knowledge.md:11–17` says plugins/OAuth/external actions are absent, alongside older no-voice wording. Preserve the untrusted-data rule and evidence requirement while updating only capabilities actually implemented. The per-turn text/voice selector and voice formatting rules (`system.md:17`, `:29–35`; `backend/src/context/context-budget.ts:25–33`) must remain authoritative for their own purpose. Fixed assets are release-marker validated and hashed (`backend/src/instructions/fixed-assets.ts:60–68`), so prompt/version changes also reach budget checks, immutable acceptance versions, context rebase/recovery behavior and prompt fixtures. This is not authorization to activate deferred retrieval, summaries or compaction.

## 4. Preserve the existing durability guarantees while adding effects

Aurvin accepts before inference: it writes the user message, attempt, and acceptance marker at `backend/src/chat-runtime/durable-chat-runtime.ts:270–284`. It locks one active attempt per session, scopes IDs to the configured user, and binds an immutable in-memory runtime snapshot to accepted work (`:57–58`, `:214–237`). Explicit retry reuses the original input with a new linked attempt and allows at most three logical attempts (`:294–340`).

Generation creates one adapter/accounting seed (`:487–493`), streams one request (`:505–528`), and saves one result (`:532–545`). Only a sealed durable graph result proceeds to finalization (`:548–558`). `backend/src/chat-runtime/finalization.ts:79–108` idempotently publishes assistant/archive/accounting/manifest/checkpoint alignment before terminal completion; only then does the runtime emit `completed` (`durable-chat-runtime.ts:561–567`). Recovery reuses a sealed result without inference; otherwise it interrupts (`:652–661`).

Those rules prevent false chat completion, but they do not yet protect Google effects inside a multi-round generation. A Calendar event could succeed, then MongoDB/checkpoint publication or the following model call could fail. Re-running a generic generate node, explicitly retrying the whole turn, or receiving a second click must not create that event again.

LangGraph replay starts from a checkpoint boundary, not an arbitrary paused source line. Its task API restores saved completed task outputs, but an unfinished task can run again. Interrupts can re-run their containing node, and side effects before an interrupt must be idempotent. Use small effect boundaries and application-level idempotency/reconciliation even with synchronous checkpoints; a checkpoint cannot atomically commit a Google API action and a MongoDB write. [Functional API durability/idempotency](https://docs.langchain.com/oss/javascript/langgraph/functional-api), [interrupt side-effect rules](https://docs.langchain.com/oss/javascript/langgraph/interrupts).

Suggested operation protocol, requiring later design and tests:

1. Persist a stable operation intent and normalized request hash, selected member connection, target calendar, and planned provider event ID.
2. Bind approval to that exact request, integration version, member/organization, connection, and relevant policy revision; changes invalidate approval.
3. Recheck current organization policy, membership, connection grant/revocation, and ownership immediately before dispatch. A stale accepted snapshot must not bypass revocation.
4. Persist dispatch evidence and execute the same logical operation using its original provider event ID, never a new ID for a transport retry.
5. Persist a bounded receipt with provider object ID, result/status and safe link, before marking that operation successful or claiming success to the user.
6. On an ambiguous timeout or missing receipt after dispatch, reconcile the same provider object. Keep an explicit unknown/reconciliation state if evidence remains inconclusive. Never turn uncertainty into a “failed, safe to repeat” result.
7. Continue or publish the saved operation result without replaying successful writes. A new model attempt can incur new inference cost while reusing the same accepted action intent.

Google permits a client-supplied event ID specifically to synchronize local records and avoid duplicate creation after an ambiguous response. Respect its documented ID format and collision constraints. An existing-ID response needs a read and comparison against the intended action, not automatic success. This improves replay safety without promising exactly-once delivery across both systems. [Create events](https://developers.google.com/workspace/calendar/api/guides/create-events), [events.insert reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [Calendar error handling](https://developers.google.com/workspace/calendar/api/guides/errors).

Cancellation stops future orchestration work where possible; it does not undo an event Google already accepted. Report “created before cancellation” or an unknown action outcome from durable evidence. A later model-response failure should still leave a deterministic receipt card available in the UI.

## 5. MongoDB archive, memory, checkpoint, and connection responsibilities

Reuse the existing separation:

| Responsibility | Existing home | Tool extension needed |
| --- | --- | --- |
| Navigation/lifecycle | `sessions` | Preserve bounded metadata and session exclusion. |
| Human-visible archive | `messages` | Final reply and safe action receipt projection; preserve transcript on context overflow. |
| Selected agent context | `agent-memory` | Bounded references to complete tool-call/result groups, not copied growing results. |
| Attempts/accounting/causal events | `metadata` | Round records, tool intents/results/receipts, authorization evidence with finite payloads. |
| Graph state and pending writes | `checkpoints`, `checkpoint_writes` | Bounded references/cursors/round state; keep credentials and private reasoning out. |
| Application settings | `config` | Existing singleton settings/keys; avoid appending every member grant here. |
| Member integrations and OAuth credentials | No present equivalent | Explicitly design a separately secured connection record and encrypted credential storage or dedicated secret store. |

`backend/src/contracts/metadata.ts:66–107` already defines bounded tool-request/result shapes with `userId`, `sessionId`, `turnId`, `attemptId`, event sequence, `toolCallId`, and assistant/request causal links. `:118–151` pairs a result only with its originating request and matching scope. This is **schema preparation**, not implemented tool storage/execution: `backend/src/contracts/repositories.ts:80–104` and `backend/src/persistence/metadata.ts` provide no corresponding tool-write/read API, and the current context assembler never loads these records.

The prepared schemas also lack organization/connection/approval/operation lifecycle and an “unknown outcome” state; result outcomes are only `ok`/`error`. Their string bounds alone do not prove JSON validity or byte-budget enforcement. Extend the existing causal design deliberately rather than treating it as a finished action ledger.

Current manifests cap source ranges at 64 and references at 500 (`backend/src/contracts/agent-memory.ts:48–60`); selected context reloads only original message references and appends the current input exactly once (`backend/src/context/referenced-context-assembler.ts:85–117`; `reference-selection.ts:87–115`). Tool continuation/history must preserve valid assistant-call/result groups in order; do not leave a lone result or dangling call after selection. Budget tool schemas, intermediate assistant calls, sanitized results, and reserved future output on every round. Do not silently discard history or introduce automatic compaction as an incidental tools change.

A later data design should use stable `organizationId`/tenant, member `userId`, connection ID, session, turn, logical attempt, model round, provider generation/request, assistant event, tool call, operation/intent, approval, result and receipt identifiers. Separate one logical action from repeated transport dispatches. Bound each record, projection, query/page and retention window; use immutable linkage and CAS for state transitions. Do not embed an unbounded list of steps/results into one session, attempt, manifest or checkpoint.

OAuth tokens must never enter model tool arguments, prompt content, transcript, checkpoints, ordinary audit output or browser configuration. Existing `CredentialService` uses AES-256-GCM with provider-bound AAD (`backend/src/admin-config/credential-service.ts:59–73`, `:102–114`) for two singleton API keys. Reuse the validated encryption pattern where appropriate, but its current AAD `['aurvin','config',1,provider]` and singleton contract do not bind a member/organization/connection. A member-token lifecycle needs that binding plus grant version, refresh concurrency, expiry, revocation, replacement, deletion and key rotation decisions.

## 6. Cost: a turn becomes a sequence of separately billable requests

Existing accounting is a good foundation. `backend/src/model/accounting.ts:32–55` merges absolute provider snapshots, preserves unavailable numbers, and records monetary provenance. It can GET generation statistics without new inference (`:70–111`). Streaming usage is saved before publication (`openrouter-adapter.ts:87–91`). Missing costs remain `null` with `pending`/`unknown`, not fabricated zero.

The limiting assumption is cardinality: an attempt has one immutable `generationId` (`backend/src/contracts/attempt.ts:39–67`); accounting is keyed by user/session/attempt (`backend/src/persistence/metadata.ts:316–380`) and rejects changes to already known generation/model/token/cost fields (`:337–357`). A second model round cannot safely overwrite or increment that record. Its one `SavedResult.accounting` cannot represent several independently uncertain billable requests either.

OpenRouter currently returns usage automatically in complete responses or the last SSE message. Its older `usage.include` and `stream_options.include_usage` flags are deprecated/no-effect; Aurvin still sends the latter (`backend/src/model/policy.ts:58`). Each model round must capture its own generation identity, reported tokens/cost/provider, dispatch attempts, and knownness. A failed, cancelled or tool-only response may still have spend. Generation lookup supplies request and upstream identifiers, native token counts and `total_cost`; it is a reconciliation source, not a reason to repeat inference. [Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation).

Recommended distinction:

- **User request/turn:** one accepted user input, possibly explicit logical retries.
- **Execution attempt:** an application run of that input, linked to prior attempts.
- **Model round:** one model request within that attempt, with independent provider generation and billing evidence.
- **Transport dispatch:** a bounded retry of a definitive rejection; an ambiguous network result is not proof that no paid execution occurred.
- **Tool operation:** one accepted logical external action with separately tracked API dispatches and receipt; distinguish tool/MCP/service fees from model inference.

For example, a create-event turn might have a tool-selection model round, a Calendar write, and a final-explanation model round. Its model spend is the sum of round costs, plus any separately billable retries/other services; a turn total is incomplete if any constituent cost is unknown. Do not double-count aggregate attempt rows and constituent round rows. Retain token categories/caching/reasoning counts without storing private reasoning.

The existing monetary path uses canonical decimal strings in shared JSON, BSON `Decimal128` for accounting amounts (`backend/src/persistence/accounting-codec.ts:13–29`), and native decimal aggregation with separate known/pending/unknown and reported/estimated evidence (`backend/src/persistence/accounting-reporting.ts:62–124`, `:140–154`). Reporting queries cap a range at 31 days and inputs at 10,000 records (`backend/src/contracts/accounting-reporting.ts:12–20`); accounting indexes already exist (`backend/src/persistence/indexes.ts:63–76`). Extend these semantics and the reporting/migration indexes for round and tool cardinality. Preserve attribution by member and organization, with read access enforced before aggregation.

The current resource limits reserve output/context headroom and cap concurrency, rate, retries and time (`backend/src/contracts/budgets.ts:82–106`); they do not constitute a monetary reservation ledger. Repeatedly applying a per-request cap permits a multi-round turn to multiply its spend. Before implementation choose finite turn-wide maximum rounds, total tokens, tools, per-tool result bytes, elapsed time, API retries, and monetary spend. A durable per-member/organization allowance needs atomic reservation before dispatch, conservative outstanding reservations for unknown requests, settlement from evidence, and bounded expiry/reconciliation. Do not label an estimate as an invoice or a best-effort stop as a guaranteed cap.

Send the server-resolved stable pseudonymous member identifier as OpenRouter `user` on **every round and every allowed dispatch**. Current `policy.ts:36`, `:54` and runtime `:508–510` enforce this for the singleton identity. OpenRouter user tracking assists reporting and abuse isolation; it is not member login or tool authorization. [OpenRouter user tracking](https://openrouter.ai/docs/cookbook/administration/user-tracking). Stream abort support and resulting billing vary by routed provider, so cancellation cannot justify zeroing cost. [Streaming/cancellation behavior](https://openrouter.ai/docs/api_reference/streaming).

## 7. Member ownership, organization policy, and actual data control

For “a member connects their own Calendar,” bind an OAuth callback to an authenticated Aurvin member and organization using a server-held, one-time connection attempt. Do not choose a member from model-generated arguments, a supplied email, a client `userId`, or Google consent alone. A super-admin enables approved integrations/scopes and organization policy; members connect, inspect and revoke their own grant. Admin permission to configure an integration is separate from permission to act through every member's Google account.

The identity change reaches the full request and persistence path. The resolver accepts no request argument today; `DurableChatRuntime.identity` additionally rejects every ID except the configured singleton (`backend/src/chat-runtime/durable-chat-runtime.ts:97–100`), with similar singleton checks in execution/reconciliation. Adding an OAuth button while retaining that model would mix all members under one principal. All session/message/accounting/connection queries and voice tickets must derive scope from authenticated context. If the first experiment deliberately retains a single local tester, call that a local tester proof and do not claim multi-member or RBAC readiness.

Self-hosting Aurvin gives control of its application policy, connection handling, records and permitted actions. It does not make processing local: the current adapter sends prompts and selected tool results to OpenRouter and its routed model provider; Calendar calls go to Google; live voice involves Deepgram. Minimize Calendar content sent to inference and state these processor boundaries explicitly.

Source presently uses global `https://openrouter.ai/api/v1` (`backend/src/model/policy.ts:30`), `data_collection` and `require_parameters` (`:54`), no request `zdr`, and no provider allowlist in that body. The managed configuration fixes `dataCollection: 'deny'` (`backend/src/platform/config/manageable-config.ts:243`; legacy environment parsing permits allow/deny). Neither source alone nor this read-only investigation verifies actual OpenRouter account settings or the routed endpoint's contractual data policy.

OpenRouter distinguishes its own opt-in prompt logging from stored request metadata and upstream provider policies. ZDR is a separate routing control; request `provider.zdr` can require eligible endpoints, and it does not automatically govern third-party tools/plugins. Organization requirements should explicitly decide retention/training, permitted providers, region and external services before sensitive Calendar data is included. Do not equate `data_collection: 'deny'` with a verified residency or universal zero-retention guarantee. [OpenRouter data collection](https://openrouter.ai/docs/guides/privacy/data-collection), [provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging), [ZDR controls](https://openrouter.ai/docs/guides/features/zdr).

## 8. Voice and paused approvals require explicit lifecycle work

Start the tool proof in text. Live voice currently filters generated output into spoken prose and stores delivery evidence (`backend/src/chat-runtime/durable-chat-runtime.ts:433–434`, `:516–531`, `:596–600`). A streamed promise that an event was created can be spoken before an external operation or final persistence completes unless the new protocol controls it. Barge-in cancels generation, but cannot retract an already dispatched Calendar write. Spoken “yes” also requires binding to the exact pending action, handling recognition errors, changed details, repeats and competing tabs.

LangGraph interrupts can persist a pause, but Aurvin's current lifecycle treats pending graph tasks/interrupts as not complete (`backend/src/chat-runtime/finalization.ts:82–85`) and recovers no-sealed-result work by interruption. A pending approval spanning minutes, disconnect or restart needs a deliberate lifecycle state, immutable public proposal, ownership/revalidation and resume path. Do not keep a transient HTTP stream, in-memory credential snapshot, or generation slot open indefinitely and call that durable approval. Adapter 2.x elicitation can itself introduce LangGraph interrupts; disable unsupported server-initiated interaction for the first bounded slice or design that path explicitly.

## 9. Scope that a later implementation must reach

| Boundary | Existing callers/assets affected | Verification to plan later |
| --- | --- | --- |
| Identity and policy | resolver/contracts, HTTP options/controllers, admin actor, runtime singleton checks, persistence scope, voice sessions/tickets | Member A/B isolation; unauthorized callback/actions/reports; admin/member boundaries; revocation during pause/refresh. |
| Model protocol | runtime/context contracts, `policy.ts`, SSE parser/adapter, catalogue/limits, model fixtures | Fragmented/interleaved calls, repeated terminal usage frame, malformed/oversized calls, unsupported schemas/model, user on every round/retry, no reasoning leakage. |
| Instructions/assets | `system.md`, `product_knowledge.md`, fixed-asset hashes/release validation, response-mode selector and prompt fixtures | Capabilities match the enabled tools; tool data cannot grant permission; text/voice selector remains correct; versions/budgets/rebase preserve acceptance guarantees. |
| Agent/runtime | linear graph/state, acceptance, attempt settings, cancellation, finalization, reconciliation, stopped-owner handoff | Failure at every intent/dispatch/receipt/checkpoint/publication boundary; no repeated Google effects; safe explicit retry; unknown-state recovery. |
| Persistence/context | metadata schemas/repositories, manifests/selection/budgets, Decimal128 codec, indexes/reporting/migrations, backup/retention | Whole call/result groups, bounded records/pages, no secret in checkpoint/context, per-round sum/unknown totals, no double count, isolated native fixtures. |
| Calendar/OAuth | new narrow server integration boundary; connection/grant storage; bootstrap config and secret rotation | State replay/CSRF/account binding, expiry/revocation/refresh race, target calendar authorization, deterministic event IDs/receipts, safe timeout reconciliation. |
| UI/protocol | API schemas/client, chat state/view/status, receipt and approval/connection surface; live voice gate | Clear waiting/approved/denied/running/created/unknown/cancelled states; reconnect and duplicate-click safety; accessibility; no credentials in Vite settings. |
| Assembly/operations | one `AppService` composition, readiness/drain/telemetry, local recovery journal and reporting commands | No paid health probes; no token/payload logging; safe shutdown in an external call; versioned rollback and retention compatibility. |

Use existing Vitest/fixture conventions and owning package scripts when implementation is later authorized. Deterministic fixtures should precede an explicitly authorized, bounded pilot in a disposable/test calendar. Native MongoDB tests require operator-provided isolated prerequisites; app/production data is not a substitute. A successful live event must be demonstrated by Google receipt/readback, Aurvin's durable terminal/operation evidence, per-round accounting knownness, and safe replay/reconnect behavior—not a model's claim alone.

## Research boundary and unresolved decisions

This investigation inspected the named current source, package manifests/lockfile, and existing reports; it read current official OpenRouter, LangChain and Google references. The package metadata check is a read-only registry request. No source, dependency or application configuration was changed by this research document.

Decisions still needed before implementation: supported organization/member authentication; exact Calendar API or MCP route and selected/pinned server version; allowed actions/scopes and approval semantics; secure connection/secret storage beyond the existing singleton configuration; tool/round schema migration; crash reconciliation policy and operator path; model/provider compatibility without stored private reasoning; explicit turn-wide and organization/member budgets; retention/residency requirements; and which voice surfaces remain disabled for actions.

Skipped: implementation, package installation, tests, native/service/OAuth/live Calendar checks and unified review. Risk: source and declared peer compatibility are evidence of fit, not proof that a real member-connected tool loop is safe or operational.
