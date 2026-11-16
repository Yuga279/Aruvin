# Backend Visibility and Google Calendar Simplification

## Request and approval boundary

Record a MAW work item with **exactly two implementation plans**:

1. Enhance visibility of the backend process.
2. Simplify Google Calendar integration and the tools exposed to the LLM, aligning their behavior with Google's documented contracts.

The user corrected the initial count of three to two. Research and final integrated verification are workflow phases, not additional implementation plans. This document records the design for written approval; it does not claim that the new implementation is complete. The existing instruction to skip unified review remains in force. No reviewer or review-triggered fixer is to be dispatched.

## Problem and evidence

The user cannot determine why a simple request such as “What calendars do I own?” fails. The UI has shown both the old fixed input-rejection fallback and a fixed correction-budget-exhaustion fallback. A subsequent model explanation alleged a required page token, although the source and outgoing request builder make that field optional. The actual rejected calls from that live incident have not been inspected, so that explanation is not established incident evidence.

Source inspection established:

- `backend/src/operations/observed-runtime.ts` mainly logs calendar progress phases and an operation identifier, without the tool decision or precise rejection reason.
- `backend/src/operations/telemetry.ts` permits general application error codes but not the calendar-specific failure vocabulary. Useful internal details are lost rather than deliberately projected into safe diagnostics.
- `backend/src/chat-runtime/calendar-loop.ts` can seal a fallback as a completed chat response despite an unsuccessful calendar lookup. Transport completion and task success need distinct observations.
- `backend/src/contracts/calendar-tools.ts` defines custom model-facing schemas. `backend/src/model/calendar-policy.ts` advertises them to OpenRouter. These are Aurvin's contracts, not an imported Google tool catalogue.
- The integration uses a local embedded MCP client/server, custom discovery snapshots, capability checks, and signed continuation cursors before calling Google's REST APIs or reading cached discovery data. A custom cursor is not a Google page token.
- Scripted-model tests demonstrate control-flow behavior, not that a live model will produce or repair the same calls.

## Design choices

### Recommended: observable backend plus a thin, documented-contract adapter

Extend the existing telemetry path instead of adding a logging platform. Establish one correlated, bounded process trace. Then simplify supported Calendar reads and writes around Google's documented semantics, retaining only the backend translation and safety checks Aurvin actually needs. The model should see a small, truthful tool catalogue, not internal authority, accounting, or persistence mechanics.

### Alternative: replace execution with Google's hosted Calendar MCP server

Google documents a hosted Calendar MCP server and tool schemas in Developer Preview. It is a research candidate, not an assumed drop-in replacement: availability, OAuth, ownership-role information, supported actions, and compatibility with Aurvin's safety requirements must be verified. No hosted-service adoption, new scopes, or provisioning is authorized by this work item alone.

### Alternative: keep all current layers and strengthen prompts/retries

This is the smallest immediate change, but it does not remove redundant contracts or make the failing live request observable. Additional prompts and retries alone do not satisfy this goal.

## P1 — Backend process visibility

### Required behavior

- Trace the lifecycle of a backend chat operation: admission, context preparation, model dispatch, model decision, argument validation, tool execution, provider response, correction, persistence/finalization, and terminal outcome, where applicable.
- Reuse existing request/turn/attempt context and stable correlation identifiers. Correlate model dispatches, decisions, tool calls, and provider request identifiers when available; preserve existing pseudonymization.
- Emit bounded structured events that identify stage, tool, safe reason code, schema revision/fingerprint, correction attempt/limit, duration, and whether an external request was actually sent. Distinguish cached results from provider results.
- At rejection, report the failed field, expected constraint, supplied type/presence, and precise failure class. Distinguish malformed JSON, missing/unknown fields, invalid cursor format/signature/scope/expiry, duplicate calls, access denial, provider failures, and budget exhaustion. Never imply Google rejected a call that stopped locally.
- Separate successful chat delivery, successful calendar execution, a user clarification, a failed task with delivered fallback, and uncertain write outcomes. A fallback must not be recorded as calendar success merely because the stream completed.
- Provide a readable local-development presentation through the existing logging mechanism; keep the structured form available for correlation. Normal logs must explain failure without requiring a full payload dump.
- Replace any touched ad-hoc raw error/stack printing with the existing safe logging path. Explain where logs are written and how an operator follows one turn through them.

### Privacy and scope

Do not log OAuth tokens, API keys, authorization headers, private reasoning, message text, event descriptions, raw tool results, or raw sensitive argument values. Show allowlisted argument shape and validation facts, not full request/response payloads. Schema definitions and safe schema fingerprints may be inspected without logging user content. Any additional development detail must be explicit, bounded, redacted, and local-only, with retention behavior documented. Logging failures must not fail chat or create unbounded queues/cardinality.

Do not introduce a new logging dependency, tracing service, dashboard, generalized event framework, or frontend debug panel. Extend existing infrastructure with the minimum necessary interface.

## P2 — Google Calendar simplification

### Required behavior

- Use P1's trace to identify the actual failing boundary before changing behavior. Capture a deterministic reproducer where possible; label source-derived hypotheses separately from observed incident evidence.
- Inventory every model-visible Calendar tool and its actual executor. Map supported arguments, required/optional fields, outputs, pagination, errors, and ownership semantics to authoritative Google documentation.
- Prefer a thin backend adapter over current REST endpoints unless research establishes that the hosted MCP alternative satisfies the same requirements without extra complexity or unapproved capabilities.
- Maintain one authoritative model-facing schema definition with runtime validation and advertised JSON Schema derived from it, or an equally explicit parity check if derivation cannot represent a required constraint. Do not maintain contradictory independent definitions.
- Make the tool definitions actually present on every applicable initial, continuation, and correction model request. Tool names, descriptions, native function parameters, examples, and the executor must describe the same operation. Internal configuration and authority remain server-owned.
- Align supported behavior with Google's documented contracts. A deliberately reduced subset is acceptable; undocumented behavioral divergence is not. Do not advertise unsupported API fields or expand scope just because Google exposes them.
- For calendar listing, no page token is required for the first page. A supplied continuation must match the documented token contract. Do not label Aurvin-generated cursors as Google tokens. If an internal cursor remains necessary, isolate and explain it without exposing a misleading model contract.
- Return ownership-role evidence so the assistant can distinguish owned calendars from calendars merely shared with it. Google MCP and REST responses are not assumed to provide the same fields.
- Remove redundant same-process protocol round trips, repeated validation, adapters, prompts, and repair machinery where evidence shows they add no necessary boundary. Record retained layers and their concrete purpose. Do not build a new plugin framework or remove a safety boundary solely to reduce line count.
- Keep finite corrective feedback for recoverable tool mistakes, preserve successful results, and suppress genuinely redundant execution. Permit distinct pages/queries and fresh reads after a write. Never repeat an uncertain create or bypass a permission denial through repair.

### Safety and compatibility that must remain

Preserve server-side credentials and identity, OpenRouter attribution, OAuth scope restrictions, input/output/context/time/spend bounds, accepted-message durability, source privacy/expiry, transcript/stream consistency, cancellation, confirmed create authority, duplicate-write protection, and recovery from saved results without repeated inference or writes.

Do not delete stored conversations, operation receipts, or existing records to simplify the code. Document compatibility with existing stored tool decisions, results, checkpoints, and cursors, including the chosen rollout and rollback behavior. Any persistent-schema change needs an explicit compatibility strategy before implementation. No application/production database may be used as a test fixture.

No UI model picker, authentication redesign, new Calendar features, voice redesign, external deployment, paid live calls, expanded OAuth grants, or whole-backend rewrite is included.

## Acceptance criteria

| ID | Criterion | Owner |
| --- | --- | --- |
| AC1 | One correlated trace explains the applicable admission-to-terminal stages, selected tool, duration, external-call status, and result origin. | P1 |
| AC2 | Invalid arguments and cursor failures identify the exact safe reason and field, with correction counts; calendar-specific codes survive logging. | P1 |
| AC3 | Chat completion is distinguishable from task success, clarification, fallback, cancellation, and uncertain write. | P1 |
| AC4 | Log redaction, boundedness, disabled-detail behavior, and sink-failure isolation are tested; private content and credentials do not appear. | P1 |
| AC5 | Every supported tool has a primary-documentation mapping and a truthful advertised/runtime contract with optional/required parity. | P2 |
| AC6 | A first-page calendar call with `{}` succeeds through the production assembly on fixtures; ownership roles support an accurate owned-calendar answer; returned continuations work. | P2 |
| AC7 | Native model request inspection proves schemas are present on initial, continuation, and correction requests; redundant calls do not execute again and corrections remain bounded. | P2 |
| AC8 | Necessary authority, attribution, privacy, limits, durable publication, write safety, and recovery regressions pass; retained/removed layers and storage compatibility are explained. | P2 |
| AC9 | P1 events describe the simplified P2 path accurately, including local rejection versus actual provider delivery, without stale stage names or lost correlation. | P2, final verification |
| AC10 | Final evidence distinguishes scripted/offline, native-database, and live-provider checks. The reported live incident is not called resolved solely because scripted tests pass. | Both, final verification |

## Verification and completion

Use existing Vitest suites and deterministic provider fixtures first. Add failing regressions before non-trivial behavior changes. Verify the built application as well as source-level helpers. Backend build must finish before suites that consume `dist`; do not rebuild while they run. Run backend build, lint, routine tests, and e2e checks; run frontend checks if changes cross frontend/shared wire behavior. Report skipped tests separately.

Actual live incident resolution requires a user-authorized, bounded reproduction with the selected model and connected Google account, showing the correlated decision/rejection/execution trace and a successful owned-calendar answer. Until authorized and performed, record that gate as blocked/unrun, not passed. An explicit user waiver may close the implementation-only scope, but cannot establish live resolution. No automatic live calls or database inspection are authorized by this document.

Final artifacts are `verification.md` and `final_report.md`, written after both workers finish. Unified review is **skipped**, not passed. Neither pre-existing fixes nor prior test runs establish completion of this new work item.

## Primary references and source paths

- [Google Calendar REST calendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list): optional pagination and access-role filtering; REST results expose calendar-list entries.
- [Google Calendar MCP list_calendars](https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/list_calendars): Developer Preview, optional `pageSize`/`pageToken`; documented output must be checked for ownership-role coverage.
- [Google Calendar MCP setup](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server): availability and authorization requirements to verify during research.
- Existing telemetry: `backend/src/operations/telemetry.ts`, `backend/src/operations/observed-runtime.ts`.
- Model contracts and delivery: `backend/src/contracts/calendar-tools.ts`, `backend/src/model/calendar-policy.ts`, `backend/src/model/calendar-adapter.ts`.
- Execution: `backend/src/chat-runtime/calendar-loop.ts`, `backend/src/plugins/mcp/calendar-client.ts`, `backend/src/plugins/mcp/calendar-server.ts`, `backend/src/plugins/google-calendar/tools.ts`.
- Repository-wide constraints: root `AGENTS.md` and `README.md`. Existing workflow records remain separate and are not overwritten by this objective.
