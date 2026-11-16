# Google Calendar plugin: goal and acceptance criteria

Date: 20 October 2026. Workflow: MAW, `--skip review`.

## Authorization and checkpoint

The user requested a written `goal.md`, `state.md`, and fully constructed dependency graph, then a stop at that checkpoint. The written specification is **pending approval**. This request authorizes documentation preparation, not planner/worker dispatch, application changes, account connection, paid checks, or deployment.

Confirmed product decisions:

- Google Calendar is Aurvin's first plugin.
- The operator connects their own Google Calendar.
- This milestone is a **single-user local proof; member accounts and RBAC come later**, explicitly selected on 20 October 2026. Use the current server-resolved identity and do not claim member isolation.
- Invalid LLM tool-call structure must produce a corrective retry prompt and bounded regeneration, with validation before execution.
- Unified code review is **skipped**, not passed. Planning, execution, meaningful tests, compatibility work, defect correction, and final verification remain required after resume.

The following design choices are proposed for approval with this goal: an embedded organization-owned MCP Calendar plugin backed by Google's stable Calendar API; three narrow tools; one ordinary event creation per accepted turn; the finite defaults below. They make the requested plugin experiment concrete without building account administration or a marketplace.

## Outcome

From text chat, the local operator can connect Google Calendar, ask Aurvin to inspect a bounded range or create an ordinary timed event, and receive an accurate durable outcome and event link. Aurvin discovers the plugin's permitted schemas, lets its backend-configured model request a tool, validates and authorizes the call, executes through MCP, and returns the matched result to the model. Invalid structure is repaired through a bounded model regeneration path. Every model dispatch, repair, tool attempt, and external outcome has bounded causal and accounting evidence in MongoDB.

Success means both a working Calendar action and a real MCP discovery/call path. A direct REST fixture by itself does not establish MCP interoperability. A successful fixture or local browser interaction does not establish a real Google grant or production readiness.

## Sources and proposed architecture

Reuse the committed [research summary](../aurvin-plugins-research/README.md) and researcher handoffs recorded in [research state](../aurvin-plugins-research/state.md). Existing source has one text generation per attempt, explicitly rejects tool calls, and uses seven collections including `config`. The graph, provider boundary, context, persistence, accounting, transport, and UI must be extended together.

Choose one curated built-in plugin, `google-calendar`, with versioned tool definitions and a narrow registry. Host an MCP client and Calendar MCP server in the existing backend process, using the official SDK's supported Streamable HTTP handler/fetch path without opening a public MCP route, socket, or second persistence owner. Bind each execution channel to the trusted local identity and connection revision outside model arguments. Own the underlying stable Calendar API adapter so a write can carry a supplied event ID. Test API behavior first, then run the same operations through the actual MCP client/server path.

The current SDK [testing guide](https://ts.sdk.modelcontextprotocol.io/v2/testing) documents a real handler/fetch path and distinguishes it from older linked in-memory transport coverage. A compatibility researcher must pin the package/API/protocol combination and verify schema support before P1 freezes dependencies. Do not mix examples from different MCP revisions. An unsupported combination is a compatibility gate to resolve, not permission to substitute mocks or silently omit MCP.

Alternatives considered: direct backend functions are smaller for an action-only proof; Google-operated remote Calendar MCP is a genuine Developer Preview option with different create/retry constraints; a managed connector adds another processor and dependency. This goal selects the owned adapter plus embedded MCP because the experiment includes learning the plugin protocol. Public plugin distribution, arbitrary MCP endpoints, and remote-server authentication are outside this milestone.

Keep one `AppService` composition, one admitted executor, and one persistence-close owner. Preserve native MongoDB single-process admission, unsafe-exit fencing, drain, and checkpoint/application finalization. No cross-collection transaction or atomic transaction with Google is assumed.

## Local boundary and connection lifecycle

1. Run on the existing loopback/local-development boundary. The plugin remains disabled by default. Enabling it must not expose Aurvin to a network or imply authentication. Multiple tabs are the same operator and retain one active attempt per session.
2. Bind exactly one active Google connection to the server-configured Aurvin user. No browser/body/model-supplied identity, token, connection owner, model override, or arbitrary service URL is trusted. This proof does not admit independent members or an organization-wide credential.
3. Use backend OAuth authorization-code flow, offline access, single-use expiring state bound to the initiating browser, exact configured redirect URI, and PKCE where supported by the pinned client. Validate the connected Google subject through the selected supported identity/account mechanism. Account display information is connection metadata, not Aurvin sign-in or RBAC.
4. Store access/refresh credentials encrypted with environment-held key material and AAD bound to local user, provider, connection ID, and credential version. Preserve the existing config cipher's compatibility. Keep credentials, authorization codes, PKCE verifiers, and secret state out of model context, SSE, browser storage, ordinary logs, and checkpoints.
5. Request the minimum documented Calendar scope for the chosen owned-calendar operations, initially `calendar.events.owned`, subject to the delta compatibility check. The operator selects one known owned calendar ID; the backend verifies the allowed target. A calendar picker or broader calendar-list scope is unnecessary for the proof. The first live target is a disposable operator-owned calendar.
6. Refresh under a bounded per-connection refresh lock and persist rotated tokens safely. Missing/expired/revoked grants produce reconnect-required state. Reconnection/account replacement increments connection revision; pending operations cannot resume against a different account or target silently.
7. Disconnect first prevents further dispatch. Distinguish local disconnect from explicit Google grant revocation, explain project-wide revocation implications, and clear credentials safely. No automatic event deletion or Calendar rollback occurs on disconnect.
8. Protect plugin setup/mutations and tool-enabled chat against cross-site requests with strict configured loopback Host/Origin handling and appropriate anti-CSRF/browser binding. The OAuth callback uses state validation rather than expecting an Aurvin-page Origin. CORS alone is not authorization. Missing/invalid state or a hostile origin fails closed.

## Tool surface and permitted behavior

The MCP catalogue and model-facing schema use the same versioned definitions, translated only as required by the provider format:

| Tool | Model inputs | Server responsibilities |
| --- | --- | --- |
| `calendar_list_events` | Explicit start/end range, bounded page cursor and page size | Bind configured calendar, validate range/cursor, return a bounded projection and explicit pagination/truncation metadata |
| `calendar_get_event` | Known event ID | Enforce current connection/target and return a bounded event projection |
| `calendar_create_event` | Title, RFC3339 start/end, IANA timezone, optional bounded description/location | Validate exact action, bind calendar/credentials, assign stable event ID, prevent notification fan-out, persist/reconcile outcome |

Initially support one-off timed events only. Require an explicit, unambiguous date/time and timezone; preserve user intent when converting relative dates using the request's trusted current-time/timezone context. Never invent missing values. Ask a concise clarification for missing or ambiguous intent. Enforce end after start and timezone/offset consistency, including daylight-saving ambiguities.

Reject unknown fields and unsupported attendees, invitations, recurrence, all-day events, attachments, Meet/conference creation, updates, deletions, ACL changes, and bulk creation. Explicitly prevent invitation emails; do not rely only on a provider default. Omitted optional fields cannot enable additional behavior. More than one requested creation requires narrowing/clarification in this proof.

The model may answer general questions without using tools. Tool permissions are checked before advertising and again immediately before dispatch and after any pause. A precisely specified user request may authorize its stated action; missing or materially changed details require clarification or approval of the canonical action. An OAuth grant does not authorize arbitrary actions. The UI's durable operation state is authoritative for whether an event was created.

## Schema validation and corrective regeneration

Treat model output as untrusted. Buffer complete bounded streaming tool-call fragments, assemble by stable call index/ID, require a valid terminal tool-call decision, parse JSON strictly, validate the provider envelope and registered input schema, then validate semantics and current policy. Never execute partial JSON, fenced prose, guessed/coerced fields, trailing JSON, duplicate keys, or unknown fields. Validate the entire candidate batch before dispatch; this proof allows one call per model decision.

**Repairable failures:** malformed arguments/envelope structure that can be safely classified, missing required schema fields, wrong types, unknown fields, unsupported call cardinality, and incomplete/truncated call structure with a usable provider terminal outcome. The model receives normalized field-path/type errors and the authoritative allowed schema, and regenerates the decision. An irrecoverably broken stream or missing terminal frame is a transport/provider failure, not an invitation to execute accumulated fragments.

**Not schema repairs:** disabled/unknown tools, forbidden fields/operations that express a policy violation, another account/calendar, revoked credentials, insufficient budget, missing user intent, invalid dates requiring clarification, Google permission/quota failures, uncertain external writes, or persistence failures. Stop or clarify according to that category. In particular, an extra innocuous schema field can be corrected, but an attempted `attendees`/identity/token override is a policy rejection. A repair prompt cannot grant permission or bypass a denial.

Allow **at most two corrective model regenerations in total per accepted turn**. They are additional model dispatches and consume the same deadline, token/spend limits, and global dispatch cap. Persist the counter before each correction dispatch so a restart cannot replenish it. On exhaustion, fail the unresolved decision with a useful user-facing explanation; never execute the rejected call. Previously completed operations remain completed and visible.

The repair instruction must include this substantive wording, with safe structured diagnostics substituted:

> The previous tool decision failed structural validation. Regenerate the decision using only the currently allowed tool definitions and the provider's native tool-call format. Correct these validation errors: {bounded field-path and expected-type diagnostics}. Preserve the user's requested action, date, time, and authorized target. Do not invent missing information, add unsupported fields, change accounts, or switch tools to bypass a denial. Do not wrap a tool call in Markdown or prose. If required user information is missing, ask a concise clarification instead. No tool from the rejected decision has been executed.

Only trusted instructions/schema and bounded sanitized diagnostics enter this prompt. Do not interpolate raw malformed output, secrets, event-description instructions, or verbose validator dumps. Do not append an invalid assistant tool-call message or fabricated tool response to provider history: repair from the last valid conversation boundary, preserving the accepted user input exactly once. Record rejected-output evidence as bounded hashes/diagnostics outside normal conversational messages. A repaired call has a new provider/tool-call identity linked to the rejected decision, while the logical accepted input remains the same.

After a tool has executed, structural repair of a later response cannot rerun that tool. Provider-native structured output/strict modes may reduce failures where supported but never replace server validation. Supported model/protocol selection must respect the repository prohibition on storing private model reasoning; token-count evidence is allowed without reasoning content.

## Separate retry policies and finite defaults

| Budget or policy | Proposed initial limit/behavior |
| --- | --- |
| Model dispatches per accepted turn | 8 total, including successful rounds, schema repairs, and provider transport retries |
| Structural repair regenerations | 2 total per accepted turn, persisted and never reset by recovery |
| Model-requested logical tool calls | 6 total, sequential; at most 1 call per decision |
| Mutating operations | 1 logical event creation per accepted turn; delivery retries reuse that operation |
| Calendar HTTP requests | 20 per accepted turn, including readback/reconciliation and retry deliveries; refresh has a separate cap of 2 requests |
| Transient Calendar delivery retries | At most 2 retries after the original delivery, respecting overall limits and reconciliation rules |
| Provider retries | Retain existing bounded eligible-rejection policy; count every dispatch globally; do not blindly retry ambiguous accepted inference |
| Event reads | At most 20 events per response, at most 31 days per list range, explicit continuation/limit evidence |
| Call arguments and tool results | At most 16 KiB each, also subject to existing document/context budgets |
| Repair diagnostics | At most 10 normalized errors and 2,048 characters; no raw payload dumps |
| Tool request timeout | At most 20 seconds and never beyond remaining turn deadline |
| Overall deadline | Existing `totalRunTimeoutMs` (180 seconds by default), shared by the complete turn; no reset per round/retry |
| Estimated model spend admission | USD 1.00 per accepted tool-enabled turn by default, with known price evidence and a reservation before each dispatch |

These are backend-enforced proof limits, not a new model picker or budget-dashboard project. Existing smaller configured limits still apply. Reserve enough output and context headroom for schemas, repair instructions, and results. Reject capacity overflow explicitly; never silently discard historical messages or break tool-call/result groups.

Provider, structural, and external-delivery retries have separate reason codes and counters. Bounded backoff/Retry-After handling uses existing patterns and stops for cancellation, shutdown, revocation, budget, or deadline. An ambiguous Calendar create first follows readback of the same event ID, not blind resubmission with a new ID. Ambiguous inference accounting remains pending/unknown. Cancellation does not guarantee provider charge prevention or reverse a dispatched Google write.

The spend admission cap is a conservative estimate based on frozen verified price/model/provider evidence, not a guarantee about final invoices. Unknown pricing disables tool-enabled inference until resolved; unknown dispatched cost retains a reservation pending bounded reconciliation rather than becoming zero. No member/monthly billing or infrastructure-cost allocation engine is required for this single-user proof.

## Durability, recovery, context, and accounting

Persist acceptance before inference as today. Distinguish accepted turn, application execution attempt, model decision, model dispatch/repair, tool call, and logical external operation. Use stable IDs, ordered event sequences, causal links, provider generation/request IDs when available, and a connection/config/tool-schema revision snapshot. Recheck current disable/revocation immediately before an effect even when a configuration snapshot is retained.

Before a create dispatch, persist its canonical validated action, request hash, authorization evidence, connection/target revision, and one Google-compatible event ID. Reuse the event ID for retries/recovery of that operation. A repeated idempotent submission or explicit retry of the same accepted input must reuse a completed/unknown operation, not create a second event. A genuinely new accepted user turn is a distinct intent. Do not deduplicate unrelated user requests by text similarity.

Track planned, dispatching, succeeded, definitely failed, and unknown/reconciliation-required operation outcomes separately from turn/narration status. If Google succeeds and MongoDB or final inference fails, recover from the saved receipt or read back the same ID and verify linkage. A duplicate/conflicting resource response requires reconciliation; a mismatch cannot be accepted as success. Unknown outcome remains visible and prevents another mutating dispatch. Never promise universal exactly-once execution.

Save resumable model decisions and completed tool results before advancing the graph. Recovery reuses durable decisions/receipts and the persisted repair/dispatch budgets; it does not silently repeat paid inference or a write. If evidence cannot establish a safe continuation, interrupt or retain unknown outcome for an explicit, bounded retry/reconciliation path. No graph checkpoint alone establishes external success.

Preserve complete native tool-call/result groups in current-turn context. Load session history/new input exactly once despite checkpoints. Keep UI messages, graph state, context manifests, and causal tool/accounting evidence in their established roles. Do not store private model reasoning or grow transcript/result arrays inside one record.

Add one bounded `integration_connections` collection for the operator's Google grant, with a unique user/provider ownership key. Store OAuth-state, operation state/events, model-dispatch usage, and tool-call/result evidence as bounded typed records in existing `metadata`, with stable uniqueness and appropriately targeted expiry/indexes. Do not append credentials/connections to singleton `config`. P1/P2 define additive versions and legacy accounting compatibility; migrations are tested on fixtures and never run against application data implicitly.

Every model dispatch, including malformed output and schema correction, records requested/actual model/provider where available, server-resolved OpenRouter `user`, generation IDs, timing, token breakdowns, and canonical decimal monetary evidence/status. Aggregate dispatches once under the application attempt/turn and preserve legacy rows without double-counting them. A tool-only, failed, empty-visible-text, cancelled, or disconnected generation can still be billable. Tool execution outcome and model spend are separate. Track Calendar request counts and known connector charges independently; unknown charges are not zero and no speculative rates are invented.

## Privacy, retention, and operations

Use only the data needed for the requested action. Treat event descriptions, tool output, metadata, links, and errors as untrusted content. Sanitize rendered URLs/Markdown and prevent result text from overriding instructions, permissions, or target identity. Pin the built-in tool schema; reject unexpected catalogue changes. No arbitrary endpoint/URL-fetch tool is introduced.

Raw fetched event bodies are transient and excluded from ordinary telemetry. Persist only bounded resumable projections/references needed by the tool loop, with source provenance and expiry. Proposed fetched/derived-content lifetime has a hard ceiling of 24 hours and must be reduced to the stricter permitted cache/header/policy lifetime; absent permission to retain it, keep content volatile and persist only an allowed minimized reference/outcome. A resumed read may refetch within current permission and budgets; an expired result never justifies replaying a write. Expire/redact linked tool results and derived assistant-message content across archive, graph state, caches, and documented backup-retention handling, retaining clear tombstones rather than silently rewriting history. Canonical user-authored input remains governed by existing transcript policy. Operational audit/usage evidence defaults to 30 days for this proof, subject to stricter applicable policy; retain only the minimum permitted non-content terminal/deduplication marker while its accepted turn remains retryable. After evidence expiry, refuse unsafe replay instead of generating a new event ID. Unresolved operations must remain quarantined with bounded operator escalation, not be erased by a TTL that would permit duplicate execution. Retention writes use the existing owner/fencing; any proposed database TTL must first be shown safe for that ownership and record lifecycle.

The researcher/planners must verify that this retention/processing design meets the selected Google API terms before admitting real Google data. Configuration must document external processing through OpenRouter/model provider and Google, preserve denied provider data collection, and require an explicit approved provider-retention/routing policy for plugin data. Do not label self-hosted Aurvin as fully local processing or infer zero retention from non-training settings.

Plugin readiness reports disabled, setup required, connected, reconnect required, or degraded without paid inference/Calendar-write health probes. Calendar loss must not take ordinary text chat or process liveness down. Drain stops new tool dispatch, bounds active work, persists uncertain effects, closes MCP channels, and uses the existing persistence owner. Preserve native ownership fencing and safe startup reconciliation; Azure/multi-instance admission and public deployment remain outside scope.

The UI provides a simple Calendar connection/status panel, enable/disable/disconnect actions under the existing local admin assumption, and chat progress for validating, repairing, executing, reconciling, and final/failed/interrupted outcomes. Repairs can be described as “Correcting the Calendar request” without raw schema/backend errors. Show a durable created-event receipt/link independently of a failed final narration. A retry action must explain whether it resumes an operation or requires reconnection/clarification. No false “Created” receipt from provisional streamed text.

Existing voice behavior remains supported. Dictated text submitted through ordinary text chat can use this text path. Live-voice graph execution does not acquire Calendar tools in this milestone. Instructions, capability reporting, and tests must enforce that separation while preserving existing voice/config/accounting behavior.

## Acceptance criteria

| ID | Required evidence |
| --- | --- |
| AC01 | Plugin is default-off, local single-user only; trusted identity/connection and Host/Origin/CSRF boundaries are enforced; member accounts/RBAC are explicitly deferred |
| AC02 | Pinned real MCP client/server discovers and calls exactly the three allowed tools; schema/version changes and identity substitution fail safely; direct REST tests alone are insufficient |
| AC03 | OAuth state/replay/expiry, encrypted storage, bounded refresh, reconnect, target enforcement, account replacement, disconnect/revocation behavior pass deterministic and isolated-native tests |
| AC04 | Malformed JSON/envelope, missing fields, wrong types, extra innocuous fields, fragmented calls, and too many calls trigger the stated correction prompt and bounded regeneration; valid repair executes once; exhaustion executes zero rejected calls |
| AC05 | Policy denial, unknown tools, missing intent, credential failure, persistence failure, and uncertain writes are distinguished from schema repair; correction cannot change user intent or bypass a denial |
| AC06 | Provider-native tool messages and ordered complete call/result groups survive streaming/checkpoint restore without duplicate user input or context loss; partial calls never execute |
| AC07 | Ordinary timed event creation validates date/time/zone, forbids unsupported features and invitations, and returns a verified target/event receipt |
| AC08 | Idempotency, cross-tab concurrency, crash windows before/after dispatch/receipt/checkpoint, duplicate/conflicting IDs, failed narration after success, recovery budgets, cancellation, and drain prevent unsafe replay |
| AC09 | Every dispatch/repair retains OpenRouter user attribution and decimal usage/cost evidence; multi-round totals, legacy compatibility, unknown costs, and reservations are correct without double-counting |
| AC10 | All stated round/repair/tool/Google-request/time/context/size/spend limits are enforced, including at exact boundaries and after restart |
| AC11 | UI connect/status/repair/receipt/reconcile/retry flows are accessible and accurate; no credentials or implementation payloads appear in browser storage or ordinary UI failures |
| AC12 | Injection, hostile origins, malicious links, content expiry/provenance, redaction, backups, and secret-safe telemetry are covered; actual provider/Google policy limits are documented |
| AC13 | Single shared assembly, diagnostic liveness, independent plugin degradation, safe owner/drain behavior, text/config/voice/canvas regressions, and release assets pass relevant checks |
| AC14 | Final verification records exact commits/environment, executed passes, skips/blocks, measured local behavior, and an explicitly authorized bounded live Calendar create/readback plus safe-retry proof when prerequisites are supplied; review is recorded skipped |

## Verification and completion boundary

Use deterministic model/Google fixtures for routine tests, including a malformed response followed by a valid repair, two failed repairs, cancellation during repair, and Google success followed by local failure. Leave meaningful runnable regression checks in established Vitest suites. Browser verification supplements the frontend's Node tests; it does not substitute for them.

Run backend build/lint/test/e2e and frontend build/lint/test. Native database tests need the operator-supplied isolated URI and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; report skipped native tests separately. No app/production database is admitted to fixtures. Azure/behavior commands with no discovery are not evidence.

The later live gate requires an explicitly supplied Google project/consent configuration, the operator's own grant, a disposable owned calendar, exact permitted event data and cleanup authority, a tool-capable configured model with approved external-data policy, and a bounded authorized spend limit. No provisioning, grant, real Calendar mutation, paid inference, application-data migration, or deployment is authorized by drafting or approving this goal alone. Existing authorization for an exact test action remains valid; do not request duplicate permission.

Final `verification.md`, `staging-evidence.md`, and `final_report.md` distinguish implementation, deterministic/native/browser evidence, unrun service checks, and actual live results. If a required prerequisite or live acceptance remains unavailable, record a named gate and the tested subset; do not mark the whole workflow complete. Unified code review remains **skipped** throughout.

## Exclusions

Member accounts, sign-in/RBAC, multi-organization hosting, service accounts/domain-wide delegation, a plugin marketplace, untrusted uploads, arbitrary remote MCP servers, other service plugins, Calendar bulk/update/delete/recurrence/invitation features, live-voice tools, automatic compaction/summaries/embeddings/cross-session retrieval, monthly billing systems, public access, infrastructure provisioning, Azure certification, and multi-instance execution are deferred. The versioned tool/connection boundaries must permit later extensions without implementing them now.
