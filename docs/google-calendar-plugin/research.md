# Google Calendar MCP Plugin — Technical Research Delta (`R`)

## 1. Scope, Purpose, and Relationship to Prior Committed Research

This document is the focused technical research delta (`R`) for the `google-calendar-plugin` workflow, reconciling the approved goal ([`docs/google-calendar-plugin/goal.md`](file:///d:/Peter/Aurvin%20Agent/Aurvin/docs/google-calendar-plugin/goal.md), approved 20 October 2026) and workflow state ([`docs/google-calendar-plugin/state.md`](file:///d:/Peter/Aurvin%20Agent/Aurvin/docs/google-calendar-plugin/state.md)) against Aurvin's current source tree on branch `codex/google-calendar-plugin`.

This delta **does not** authorize live Google or OpenRouter spend, OAuth credential provisioning, live account grants, or external deployment.

The exact written goal is approved, as recorded in `state.md`; its stale pending-approval prose does not reopen that gate. The approved actions, limits, repair wording, privacy rules, and P9 acceptance boundary govern this document. Recommendations below refine implementation only; they do not substitute new scope or certify readiness.

### 1.1 Reused Prior Research vs New Delta Findings

| Subject | Reused from Prior Research (`989d6b1`) | New in This Delta (`R`) |
| --- | --- | --- |
| **Google Calendar integration path & API surface** | Reuses [`docs/aurvin-plugins-research/calendar.md`](file:///d:/Peter/Aurvin%20Agent/Aurvin/docs/aurvin-plugins-research/calendar.md) (`3bdedee`): recommends an Aurvin-owned stable Calendar REST API v3 adapter and MCP when protocol learning is required; the approved goal selects embedded MCP. Reuses event/time-zone semantics and write-idempotency risks. | Reconciles OAuth scope and account-subject identification for the **single-user local proof** (replacing multi-member RBAC assumptions), recommends `calendar.events.owned` + OIDC `openid email` for `sub` binding, and proposes local loopback OAuth + PKCE + `SameSite=Lax` callback correlation. Actual client/target behavior remains a verification gate. |
| **MCP transport & SDK line** | Reuses [`docs/aurvin-plugins-research/platforms.md`](file:///d:/Peter/Aurvin%20Agent/Aurvin/docs/aurvin-plugins-research/platforms.md) (`1f7d782`): identifies the `@modelcontextprotocol/server` + `@modelcontextprotocol/client` v2 architecture and Streamable HTTP transport direction. | Records exact package candidates (`2.3.1`) and the original R's reported isolated handler/fetch evidence for wire protocol `2026-07-28` on Node `24.18.0` / TypeScript `6.0.3`, including a reported `zod@3.25.76` schema-adapter trap. P1/P5 must reproduce compatibility before accepting the freeze and actual plugin path. |
| **Aurvin runtime, persistence, & OpenRouter fit** | Reuses [`docs/aurvin-plugins-research/aurvin-fit.md`](file:///d:/Peter/Aurvin%20Agent/Aurvin/docs/aurvin-plugins-research/aurvin-fit.md) (`d4dd696`): identifies existing Phase 1 text-only guards, checkpoint/journal invariants, `CredentialService` AES-256-GCM envelope patterns, and OpenRouter data-collection boundaries. | Specifies the exact pre-dispatch **native tool-call schema-repair loop** from the last valid conversation boundary without polluting provider history, defines the **strict duplicate-key-rejecting JSON parser**, maps exact `mutation-journal.ts` collection allowlist and owner-fenced retention/tombstone mechanics (avoiding unsafe MongoDB TTL deletes), and specifies pre-dispatch USD `1.00` spend reservation. |

### 1.2 Evidence Classification Legend

Evidence labels distinguish published interfaces, declarations, and execution; implementation recommendations and required future tests are not passing evidence:
- **[Primary documentation]** — Official vendor/specification findings reported by R or the linked prior research (MCP TypeScript SDK v2, Google Calendar API v3 & Google Identity OAuth/OIDC, OpenRouter, ECMA-262 / RFC 8259). These do not establish live behavior or policy approval.
- **[Declared compatibility]** — Repository source/declarations or package/registry metadata reported by R. Source observations corrected during this reconciliation are identified below; declarations alone do not prove compatibility.
- **[Executed evidence]** — The original R reports isolated local checks on `Node.js v24.18.0` / `TypeScript 6.0.3`, outside repository manifests/lockfiles. No check script/output is linked here; these are reported results, not checks rerun by this documentation repair. Reproduction remains required at G1/G5.
- **[Approved requirement] / [Recommendation]** — Requirements from `goal.md` versus proposed implementation details. Neither label claims execution. This repair performs documentation/source consistency checks only: no installs, application suites, or Google/OpenRouter calls.

---

## 2. Reconciliations & Compatibility Gates (P1 Handoff)

The corrections below align research to the approved architecture in [`goal.md`](file:///d:/Peter/Aurvin%20Agent/Aurvin/docs/google-calendar-plugin/goal.md); they require no scope change. These three compatibility/privacy matters still require explicit alignment in **P1** (contracts/manifests) and **P2/P3/P5/P6**; they are not certified by this handoff:

1. **Google OAuth Scope for Immutable Subject (`sub`) vs Calendar Access (`goal.md:37–46`):**
   - **Finding ([Primary documentation]):** The prior [scope research](../aurvin-plugins-research/calendar.md#scope-selection-google-access-and-aurvin-roles) recommends `https://www.googleapis.com/auth/calendar.events.owned` for owned-calendar events. It is not an OIDC identity scope or a general calendar-metadata/calendar-list permission. An empty disposable test calendar cannot supply account identity from event `creator`/`organizer` fields.
   - **Reconciliation ([Recommendation]):** Use standard identity scopes `openid email` with `calendar.events.owned` and validate the resulting Google subject through the pinned supported OIDC mechanism. Keep display email as connection metadata only, not Aurvin sign-in/RBAC. A bounded `events.list(calendarId, maxResults=1)` preflight and `accessRole === "owner"` check are candidate target checks, not sufficient evidence by themselves: the prior research distinguishes ACL `owner` from calendar data ownership. P3/P5 must verify the scope/actual owned target together without silently broadening permissions. The operator selects the target; the first live target must be disposable, not a fallback to `"primary"`.
2. **MCP SDK v2 Protocol Revision String (`2026-07-28` vs `2025-11-25`) and `zod@3.25.76` Schema Adapter (`goal.md:25–35`):**
   - **Finding ([Declared compatibility], [Executed evidence]):** In `@modelcontextprotocol/server@2.3.1` and `@modelcontextprotocol/client@2.3.1`, `createMcpHandler(factory, { legacy: 'reject' })` speaks the stateless v2 Streamable HTTP wire revision `'2026-07-28'` (`MODERN_WIRE_REVISION`), whereas `LATEST_PROTOCOL_VERSION` in `@modelcontextprotocol/core@2.3.1` remains `'2025-11-25'` for stateful legacy initialize flows. When `Client` is constructed with `{ versionNegotiation: { mode: 'auto' } }`, it probes and negotiates `'2026-07-28'` automatically in-process.
   - **Finding ([Executed evidence]):** Passing a `zod@3.25.76` schema directly to `server.registerTool(..., { inputSchema })` **throws at runtime** (`Schema appears to be from zod 3, which the SDK cannot convert to JSON Schema. Upgrade to zod >=4.2.0, or wrap your JSON Schema with fromJsonSchema()`). Upgrading root `zod` to `^4.2.0` would change default `import { z } from 'zod'` across `backend/src/**` from Zod v3 to Zod v4.
   - **Reconciliation ([Recommendation]):** Keep `"zod": "^3.25.32"` (resolved `3.25.76`) in `backend/package.json` and reproduce the reported `StandardSchemaWithJSON` wrapper (`withStandardJsonSchema(zodSchema, jsonSchema)`) in Section 5.3. This candidate avoids a root Zod major bump or external JSON Schema validator dependency; P1/P5 must verify schema parity and runtime compatibility before relying on it.
3. **Cache/Header/Policy Limits Apply to Both Fetched and Derived Content (`goal.md:122–128`):**
   - **Finding ([Primary documentation], [Approved requirement]):** The prior [Workspace-policy research](../aurvin-plugins-research/calendar.md#tool-result-trust-persistent-memory-and-costs) leaves actual processing/retention approval open. The approved goal requires fetched **and derived** lifetimes to be no longer than 24 hours and the stricter permitted cache/header/policy lifetime. Original R described `private, max-age=0, must-revalidate, no-transform` / `no-store` responses but supplied no header capture here; do not assume a universal Calendar response header or treat HTTP freshness as a policy permission.
   - **Reconciliation:** Inspect actual headers and applicable Google/provider policy before admitting real data. If retention permission is absent/zero, keep fetched content **and derived assistant details** volatile; do not persist them in messages, results, checkpoints, or caches. Persist only a separately permitted minimized reference/outcome and clear tombstone. A field such as `htmlLink`, `start`, `end`, or `timeZone` is not automatically non-content or exempt because it is in a receipt. When retention is permitted, use source-linked expiry at the earliest applicable deadline, never an unconditional derived `+24h` allowance. P2/P5/P6/P8 must cover all copies and backup handling (Section 8).

---

## 3. Topic 1: Safe Native Tool-Call Correction Without Invalid Message Sequences

### 3.1 Current Backend Inspection (`[Declared compatibility]`)

- [`backend/src/contracts/context.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/contracts/context.ts#L22-L25) defines `ModelMessageRole = 'system' | 'user' | 'assistant'` and `ModelMessage = { role: ModelMessageRole; content: string }`.
- [`backend/src/model/policy.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/model/policy.ts#L33-L59) builds the OpenRouter `/chat/completions` request body without `tools`, `tool_choice`, or `parallel_tool_calls`.
- [`backend/src/model/openrouter-adapter.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/model/openrouter-adapter.ts#L100-L129) explicitly rejects `delta.tool_calls`, `delta.function_call`, `message.tool_calls`, `message.function_call`, and any `finish_reason` other than `'stop'` or `'length'` with `ModelFault('PROTOCOL_VIOLATION')`.
- [`backend/src/context/referenced-context-assembler.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/context/referenced-context-assembler.ts#L118-L162) deterministically builds `[system.md, guardrails, product_knowledge.md, ...selectedHistoryMessages, responseModeMessage, currentUserInput]` and enforces token budgets before any model call.
- [`backend/src/agent/turn-graph.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/agent/turn-graph.ts#L62-L120) runs a single-node `StateGraph(TurnGraphAnnotation)` (`run_model`) that streams text deltas and writes checkpoints via `ScopedMongoSaver`.

### 3.2 Why Appending Rejected Tool Calls or Fabricated Tool Results Is Unsafe (`[Primary documentation]`, `[Declared compatibility]`)

1. **OpenRouter / OpenAI Chat Completions sequence invariant ([Primary documentation]):**
   - Every `assistant` message that includes a non-empty `tool_calls` array **must** be immediately followed by `role: 'tool'` messages whose `tool_call_id` matches each `tool_calls[i].id`.
   - Sending `[..., assistant({ tool_calls: [badCall] }), system("The previous tool call for ... failed...")]` without an intervening `role: 'tool'` message is rejected by OpenAI-compatible and Anthropic-translated upstream providers on OpenRouter with HTTP `400 Bad Request` (`An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'`).
2. **Why fabricated `role: 'tool'` error messages are also prohibited (`goal.md:78`, `[Declared compatibility]`):**
    - [`goal.md`](file:///d:/Peter/Aurvin%20Agent/Aurvin/docs/google-calendar-plugin/goal.md#L78) explicitly states: *"Do not append an invalid assistant tool-call message or fabricated tool response to provider history: repair from the last valid conversation boundary, preserving the accepted user input exactly once. Record rejected-output evidence as bounded hashes/diagnostics outside normal conversational messages."*
    - Fabricating a `role: 'tool'` message for an unparseable or schema-invalid call would confuse pre-dispatch validation with actual MCP execution. Provider validation behavior must be tested on the pinned combination; it is not a reason to violate the approved clean-history repair contract.

### 3.3 Safe Schema-Repair Architecture and Conversation Boundary ([Approved requirement], [Recommendation])

To satisfy both OpenRouter message sequence rules and `goal.md:74-79`:

1. **Two-stage decision buffering within a model dispatch:**
   - During each model dispatch (`1..8`), stream and buffer any `delta.tool_calls` chunks in memory without emitting them to the UI SSE stream and without committing them to the conversation message list.
    - Wait for the pinned provider protocol's complete terminal framing (`finish_reason` + `data: [DONE]` for this SSE path); record generation/request IDs when available, rather than making an optional ID a new execution prerequisite.
2. **Candidate validation before history mutation:**
   - Run the strict pre-dispatch validation pipeline (Section 4) on the candidate decision.
    - **If valid:** Persist the validated decision and required operation authority before dispatch, subject to content permission. After MCP returns, preserve the assistant tool-call message (`role: 'assistant'`, `content: null | ''`, `tool_calls: [{ id, type: 'function', function: { name, arguments: canonicalJsonString } }]`) and matching `role: 'tool'` result (`tool_call_id: id`, `name`, bounded sanitized content) as one logically complete conversation group before the next model round. This does not assume a database transaction or permit checkpointing volatile Google content. Durable resumable evidence must obey Section 8; missing/expired evidence requires bounded refetch or safe interruption, not replay of a write.
   - **If structurally invalid and repairable (and `repairsUsed < 2` and `dispatchesUsed < 8`):**
     - **Discard** the rejected assistant candidate from conversation history. Do **not** append the rejected `assistant` message and do **not** append any `tool` message.
      - Before each correction dispatch, durably consume the accepted turn's repair counter and global dispatch budget; restart or a new execution attempt cannot reset them. Persist a bounded operational record in `metadata` (`kind: 'tool-repair'` or dispatch attempt record) containing: `turnId`, `attemptId`, `dispatchIndex`, `repairIndex` (`1` or `2`), `rejectedDecisionId`, `toolName` (if known and allowed), `rawArgumentsSha256` (hash only, never the raw arguments), and up to 10 normalized diagnostics totaling `<= 2,048` characters. Use allowlisted schema paths/types, not attacker-controlled keys/values or validator dumps. Link the regenerated decision's new provider/tool-call identity to the rejected one; keep the accepted input unchanged.
     - Re-invoke the model from the **last valid conversation boundary**:
       ```text
       [
         ...fixedSystemMessages,          // system.md, guardrails, product_knowledge.md, tool-grounding rules
         ...selectedSessionHistory,       // prior turns (text only; never raw tool calls from prior turns)
         responseModeSystemMessage,       // text mode instruction
         acceptedCurrentUserMessage,      // current turn user input (exactly once)
         ...completedCurrentTurnToolGroups, // 0..N already-executed [assistant(tool_calls), tool(result)] pairs from earlier rounds in THIS turn
         repairSystemMessage              // role: 'system' containing the exact goal.md repair prompt
       ]
       ```
     - The `repairSystemMessage` (`role: 'system'`) uses the **exact substantive prompt** from [`goal.md`](file:///d:/Peter/Aurvin%20Agent/Aurvin/docs/google-calendar-plugin/goal.md#L76):
        > The previous tool decision failed structural validation. Regenerate the decision using only the currently allowed tool definitions and the provider's native tool-call format. Correct these validation errors: {bounded field-path and expected-type diagnostics}. Preserve the user's requested action, date, time, and authorized target. Do not invent missing information, add unsupported fields, change accounts, or switch tools to bypass a denial. Do not wrap a tool call in Markdown or prose. If required user information is missing, ask a concise clarification instead. No tool from the rejected decision has been executed.
      - Include only trusted instructions, the authoritative currently allowed `tools` schemas, and the bounded sanitized diagnostics. Never interpolate raw malformed output, secrets, or event-description instructions. Use provider-native strict mode / `parallel_tool_calls: false` only where supported by the verified model/provider combination; always enforce one call per decision on the server.
3. **Checkpoint and context-assembly isolation across turns:**
    - Consistent with Phase 1's `ReferencedContextAssembler` ([`backend/src/context/referenced-context-assembler.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/context/referenced-context-assembler.ts#L50-L115)), UI history remains separate from native current-turn tool groups and bounded causal metadata. Persist permitted projections/references and decisions for recovery, not raw fetched bodies or derived content whose retention is forbidden. Checkpoints do not provide a privacy exception; P2/P6 must keep volatile results outside durable graph serialization. A resumed read may refetch only within current permission/budgets; an expired result never authorizes repeating a write. Preserve complete valid groups for any continued model round, or interrupt safely if that cannot be established.

---

## 4. Topic 2: Strict JSON Parsing, Duplicate-Key Rejection, and Truncation Behavior

### 4.1 Why Standard `JSON.parse` + Zod Alone Is Insufficient (`[Primary documentation]`)

1. **Duplicate-key overwrite in `JSON.parse` ([Primary documentation] — ECMA-262 `JSON.parse` / RFC 8259 § 4):**
   - V8's `JSON.parse('{"calendarId":"primary","calendarId":"attacker@group.calendar.google.com"}')` or `JSON.parse('{"start":"2026-10-21T10:00:00Z","start":"2026-10-22T10:00:00Z"}')` silently succeeds and overwrites earlier keys with the last key. Zod receives only the post-parse JS object and **cannot detect duplicate keys**.
2. **Streamed tool-call argument concatenation (`[Primary documentation]` — OpenRouter / OpenAI SSE spec):**
   - OpenRouter streams tool calls across multiple SSE chunks via `choices[0].delta.tool_calls[]`, where each element has `index: number`, optional `id: string`, `type?: 'function'`, and `function?: { name?: string, arguments?: string }`.
   - If a stream terminates early, or if `finish_reason === 'length'`, or if the model wraps arguments in Markdown code fences (` ```json ... ``` `) or appends prose after the closing `}`, naive parsing either fails ambiguously or executes partial parameters.

### 4.2 Required Strict Parsing & Validation Pipeline ([Approved requirement], [Recommendation])

Before any tool call reaches the embedded MCP client, the candidate decision must pass five sequential gates:

1. **Gate 1 — Stream & Terminal Frame Integrity:**
    - Require the pinned SSE path's `data: [DONE]` and a recognized terminal `finish_reason`. A valid tool decision requires its native tool-call terminal outcome; a clean `length` truncation may be repairable but never executable. Ordinary text `stop` remains supported. Record generation/request IDs when available, per `goal.md:108,120`.
   - If `[DONE]` is missing, the socket closes early, or an SSE frame is malformed JSON -> **Transport/Provider Failure (`INTERRUPTED` / `PROTOCOL_VIOLATION`)**. Never repair and never execute.
    - Enforce raw streamed tool-argument byte cap `<= 16,384` UTF-8 bytes (`16 KiB`, `goal.md:94`) during stream accumulation. Never execute over-budget content. Repair only a safely classified structural failure with usable terminal framing; actual context/budget exhaustion is not repairable, and an aborted runaway stream is a provider/transport failure.
2. **Gate 2 — Call Cardinality & Tool Identity:**
   - Accumulate `delta.tool_calls` keyed by `index`.
   - If more than one tool call is present (`toolCalls.length > 1` or any `index !== 0`) -> **Repairable Structural Failure** (`MULTIPLE_TOOL_CALLS_UNSUPPORTED`; at most one tool call per round).
   - If `finish_reason === 'length'` while a tool call was being generated -> **Repairable Structural Failure** (`TRUNCATED_BY_LENGTH`).
    - Verify `toolName` is one of the enabled Calendar tools (`calendar_list_events`, `calendar_get_event`, `calendar_create_event`). An explicitly unknown/disabled tool is a **Non-Repairable Policy Failure** (`UNKNOWN_OR_DISABLED_TOOL`). A missing name/ID in an otherwise safely classifiable malformed envelope is structural, not automatically a policy denial; an unusable stream remains a provider failure. Validate the entire candidate batch and prioritize any identified policy denial before allowing regeneration; cardinality repair cannot bypass a forbidden action.
3. **Gate 3 — Zero-Dependency Strict JSON Scanner (Duplicate-Key, Fence, & Trailing-Token Rejection):**
   - Run a deterministic single-pass RFC 8259 JSON token scanner over the UTF-8 string before calling `JSON.parse`:
     - Reject leading/trailing Markdown fences (` ``` `) or prose outside a single root JSON object (`{ ... }`).
     - Reject root values that are arrays, strings, numbers, booleans, or `null` (must be a JSON object `{...}`).
     - Reject any trailing non-whitespace token after the root object's closing `}`.
      - Maintain a `Set<string>` of decoded property keys per open object frame, with bounded parsing memory/depth chosen against the registered schemas and existing byte budgets by P1/P4 (not a new event/action limit). On every object property key token, unescape `\uXXXX` / standard JSON escapes and check `frameKeySet.has(key)`. If already present -> reject with `DUPLICATE_OBJECT_KEY`; diagnostics expose only normalized allowlisted paths.
     - Delegate final value construction to native `JSON.parse(rawArguments)` only after the token/duplicate-key scan succeeds.
4. **Gate 4 — Policy-Forbidden Field Screen vs Repairable Schema Validation:**
   - Inspect parsed object keys recursively before generic schema repair:
     - **Forbidden capability / boundary override keys (Non-Repairable Policy Failure):**
       - Calendar capability violations: `attendees`, `sendUpdates`, `sendNotifications`, `recurrence`, `attachments`, `conferenceData`, `reminders`, `visibility`, `transparency`, `guestsCanModify`, `guestsCanInviteOthers`, `guestsCanSeeOtherGuests`, `anyoneCanAddSelf`, `organizer`, `creator`, `iCalUID`, `id`.
       - All-day event shape: `date` inside `start` or `end` (or date-only strings `YYYY-MM-DD` without time/offset).
       - Security/boundary override attempts: `userId`, `calendarId`, `accountId`, `connectionId`, `accessToken`, `refreshToken`, `authorization`, `headers`, `_meta`.
       - If any of these keys appear, classify as **Non-Repairable Policy Failure** (`FORBIDDEN_TOOL_FIELD` / `UNSUPPORTED_CALENDAR_CAPABILITY`) and fail or return a safe policy refusal without spending a schema-repair round.
     - **Strict Zod Schema Validation (`.strict()`):**
       - Validate against the tool's strict Zod schema (`z.object({...}).strict()`).
        - Missing required fields, wrong primitive types, `maxResults` outside `1..20`, bounded-string schema failures, or innocuous unknown fields -> **Repairable Structural Failure** (`SCHEMA_VALIDATION_FAILED`), unless the input instead establishes a policy denial or missing/ambiguous user intent. Invalid dates needing clarification are not schema repair. P1 freezes bounded field names/lengths and the mapping of the goal's title to Google's `summary`; examples here do not replace approved tool inputs or introduce extra action limits. The `16 KiB` argument/result caps and smaller existing budgets still apply.
5. **Gate 5 — Semantic / Temporal Policy & Clarification Checks (Non-Repairable):**
   - After Zod structural validation succeeds:
      - Check window bounds (`timeMax > timeMin`, `timeMax - timeMin <= 31 days` for `calendar_list_events`; `end > start` for `calendar_create_event`). The approved goal has no 24-hour creation-duration restriction; do not add one. Require explicit unambiguous dates/times/timezone and preserve trusted relative-date context without inventing missing values.
     - Check IANA `timeZone` validity via `Intl.DateTimeFormat(undefined, { timeZone })` and verify explicit RFC3339 offsets match the named `timeZone` at that instant (detecting nonexistent spring-forward DST gap times or ambiguous fall-back fold times without an explicit valid offset).
      - Check logical creation admission (`calendarWritesUsed < 1` per accepted turn); delivery retries/recovery reuse the same operation/ID and count against the separate request/retry budgets.
     - Any failure in Gate 5 is a **Non-Repairable Semantic/Policy or Clarification Failure** (either ask the user to clarify the ambiguous time/duration or fail the tool operation cleanly; never ask the model to "repair" a user ambiguity by guessing).

### 4.3 Required Future Test Cases for P4 and P6 ([Approved requirement], [Recommendation])

| Test ID | Owner | Input / Scenario | Expected Classification & Outcome |
| --- | --- | --- | --- |
| `TR-01` | P4/P6 | Valid `calendar_list_events` JSON arguments with `finish_reason: 'tool_calls'` and `[DONE]` | Passes Gates 1–5; dispatches once through embedded MCP; no repair triggered. |
| `TR-02` | P4/P6 | Truncated JSON (`{"summary":"Team Sync","start":"2026-10-21T10:00`) with `finish_reason: 'length'` and `[DONE]` | Repairable (`TRUNCATED_BY_LENGTH`); rejected candidate omitted from provider messages; repair prompt injected; succeeds on repair 1. |
| `TR-03` | P4 | Stream cut mid-argument without SSE `data: [DONE]` | Transport/Protocol failure (`INTERRUPTED` / `PROTOCOL_VIOLATION`); **0 repairs**, **0 MCP calls**, **0 writes**. |
| `TR-04` | P4/P6 | Duplicate key at root or nested object: `{"eventId":"abc","eventId":"def"}` | Repairable (`DUPLICATE_OBJECT_KEY` at `eventId`); rejected before `JSON.parse`; never reaches MCP. |
| `TR-05` | P4/P6 | Unicode-escaped duplicate key: `{"\u0065ventId":"abc","eventId":"def"}` | Scanner unescapes keys before set membership check; rejected as `DUPLICATE_OBJECT_KEY`. |
| `TR-06` | P4/P6 | Markdown-fenced JSON (` ```json\n{"eventId":"abc"}\n``` `) or trailing prose (`{"eventId":"abc"} // lookup`) | Repairable (`NON_JSON_WRAPPER_OR_TRAILING_TOKENS`); triggers schema repair with exact prompt. |
| `TR-07` | P6 | Otherwise valid creation with an innocuous unknown field such as `extraLabel` | Repairable (`SCHEMA_VALIDATION_FAILED`: unrecognized innocuous field); repaired on next dispatch without changing intent; `metadata` records persisted `repairCount: 1` and `rawArgumentsSha256`. |
| `TR-08` | P6 | Three consecutive repairable structural failures (initial + 2 repairs) | Stops after 2nd repair failure (`repairCount === 2`); does not execute tool; records terminal failure without a 3rd repair dispatch. |
| `TR-09` | P6 | Multi-tool batch of otherwise permitted calls (`choices[0].message.tool_calls` has 2 items) | Repairable (`MULTIPLE_TOOL_CALLS_UNSUPPORTED`); neither tool executes; repair requests single tool call. A batch containing a policy violation follows the separate denial path. |
| `TR-10` | P5/P6 | Forbidden policy field (`attendees`, `recurrence`, `sendUpdates`, or `calendarId`/`userId` override) | **Non-repairable policy failure** (`FORBIDDEN_TOOL_FIELD`); **0 schema repairs**; rejected immediately. |
| `TR-11` | P5/P6 | All-day event input (`start: "2026-10-25"` or `{"date":"2026-10-25"}`) | **Non-repairable policy/clarification outcome**; no schema repair loop; assistant explains timed-event requirement or asks user for start/end time. |
| `TR-12` | P5/P6 | Nonexistent DST spring-forward local time (`2026-03-08T02:30:00` in `America/New_York`) | **Non-repairable temporal validation failure**; asks user for clarification rather than silently shifting the hour. |
| `TR-13` | P6 | Round 1 `calendar_list_events` succeeds; Round 2 `calendar_create_event` fails schema validation once then succeeds on repair 1 | Round 2 repair prompt preserves Round 1's valid `[assistant(tool_calls), tool(result)]` pair in conversation context while omitting Round 2's rejected candidate. |

**Approved limits remain unchanged (`goal.md:82–104`):** 8 model dispatches total, including provider retries; 2 structural regenerations total; 6 sequential logical tool calls, at most 1 per decision; 1 logical creation; 20 Calendar HTTP requests including reconciliation/retries plus a separate 2-request refresh cap; at most 2 transient delivery retries after the original; 20 events per response and 31 days per list; 16 KiB each for arguments/results; 10 diagnostics / 2,048 characters; tool timeout at most 20 seconds and remaining deadline; the existing shared `totalRunTimeoutMs` (180 seconds by default); estimated model-spend admission USD 1.00 by default. Existing smaller configured limits apply. P1/P4/P5/P6/P9 must test exact boundaries and persisted counters, not substitute different limits.

---

## 5. Topic 3: Exact MCP SDK/Protocol and In-Process Handler/Fetch Support

### 5.1 Inspected Repository Runtime & Compiler Baseline (`[Declared compatibility]`, `[Executed evidence]`)

- **Node.js engine range ([`backend/package.json`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/package.json#L7-L9), [`frontend/package.json`](file:///d:/Peter/Aurvin%20Agent/Aurvin/frontend/package.json#L6-L8)):** `"^22.22.3 || ^24.15.0 || >=26.0.0"`. Active workstation runtime: `Node.js v24.18.0` (**[Executed evidence]**).
- **TypeScript compiler ([`backend/package.json`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/package.json#L61), [`backend/tsconfig.json`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/tsconfig.json#L3-L10)):** `typescript@6.0.3` with `"module": "nodenext"`, `"moduleResolution": "nodenext"`, `"target": "ES2023"`, `"strict": true`.
- **Zod version ([`backend/package.json`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/package.json#L44), `backend/package-lock.json`):** `"zod": "^3.25.32"`, resolved to `3.25.76`.

### 5.2 Exact Pinned Package & Protocol Candidates (`[Primary documentation]`, `[Declared compatibility]`, `[Executed evidence]`)

| Package | Pinned Version Candidate | Engines & Dependencies | Justification & Evidence |
| --- | --- | --- | --- |
| `@modelcontextprotocol/server` | `2.3.1` (or `^2.3.1` locked to `2.3.1`) | `node >= 20`; depends on `@modelcontextprotocol/core@2.3.1` | Official MCP TypeScript SDK v2 server package providing `McpServer` and `createMcpHandler` ([`ts.sdk.modelcontextprotocol.io/v2/testing`](https://ts.sdk.modelcontextprotocol.io/v2/testing)). **[Primary documentation]**, **[Declared compatibility]**, **[Executed evidence]** |
| `@modelcontextprotocol/client` | `2.3.1` (or `^2.3.1` locked to `2.3.1`) | `node >= 20`; depends on `@modelcontextprotocol/core@2.3.1`, `eventsource@3.0.7`, `eventsource-parser@3.0.6` | Official MCP TypeScript SDK v2 client package providing `Client` and `StreamableHTTPClientTransport` with custom `fetch` injection. **[Primary documentation]**, **[Declared compatibility]**, **[Executed evidence]** |
| `zod` | Keep existing `^3.25.32` (locked `3.25.76`) | Existing dependency | Retains the existing major version; original R reports a small `StandardSchemaWithJSON` adapter for MCP v2 (Section 5.3). Whole-repository/schema parity verification remains G1/G5. **[Declared compatibility]**, **[Executed evidence]** |

**Packages explicitly rejected (`Ponytail` / `goal.md` minimal-dependency rule):**
- **Do NOT install `@modelcontextprotocol/sdk` (`1.x`):** Legacy v1 SDK line; lacks v2 `createMcpHandler` and mixes incompatible transport patterns.
- **Do NOT install `@langchain/mcp-adapters`:** Unnecessary abstraction layer over 3 curated tools that obscures pre-dispatch repair boundaries and trusted context injection.
- **[Recommendation] Avoid an unnecessary broad Google API client:** Node's built-in `fetch` and `node:crypto` may cover the narrow adapter/PKCE flow. This is not a blanket prohibition on a justified identity/OAuth dependency: P1/P3 must pin and verify the supported subject-validation and PKCE mechanism rather than assume that four HTTP endpoints alone establish secure OIDC compatibility. No package-size assertion is used as verification evidence.

### 5.3 Reported Isolated Compatibility Check: Handler/Fetch & Zod Bridge (`[Executed evidence]`)

Original R reports an isolated check on `Node.js v24.18.0` and `TypeScript 6.0.3` (`--module nodenext --moduleResolution nodenext --strict`) against `@modelcontextprotocol/server@2.3.1`, `@modelcontextprotocol/client@2.3.1`, and `zod@3.25.76`. The findings/example below preserve that reported evidence; this repair does not rerun it or certify the repository assembly. Reproduce it with retained commands/results at G1/G5.

**Reported execution findings (not independently rerun by this repair):**
1. **Wire Protocol Negotiation (`2026-07-28`):**
   - `createMcpHandler(createServer, { legacy: 'reject' })` implements the stateless v2 Streamable HTTP wire format and requires header `mcp-protocol-version: 2026-07-28` (`MODERN_WIRE_REVISION`).
   - By default, `new Client({ name, version })` sends `mcp-protocol-version: 2025-11-25` unless `versionNegotiation` is enabled.
   - Constructing the client with `new Client({ name: 'aurvin-backend-host', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })` probes the handler via `fetch`, negotiates `mcp-protocol-version: 2026-07-28`, lists tools, and executes `callTool` entirely in memory over Web `Request`/`Response` with **zero sockets or open ports**.
2. **Resolving the `zod@3.25.76` vs `StandardSchemaWithJSON` Runtime Error:**
   - `@modelcontextprotocol/server@2.3.1` requires `registerTool`'s `inputSchema` to satisfy `StandardSchemaWithJSON<Input, Output>` (`~standard.validate` + `~standard.jsonSchema`).
   - Passing a raw `zod@3.25.76` schema throws `Error: Schema appears to be from zod 3, which the SDK cannot convert to JSON Schema. Upgrade to zod >=4.2.0, or wrap your JSON Schema with fromJsonSchema()`.
    - Original R reports that wrapping a strict Zod v3 schema and canonical JSON Schema object in this helper compiles under `typescript@6.0.3` (`strict: true`) and runs without warnings; equivalent validation/catalogue schemas must still be checked in the actual three-tool integration:

```typescript
import { z } from 'zod';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';

export function withStandardJsonSchema<T extends z.ZodTypeAny>(
  zodSchema: T,
  jsonSchema: Record<string, unknown>,
): StandardSchemaWithJSON<z.input<T>, z.output<T>> {
  return {
    '~standard': {
      version: 1,
      vendor: 'aurvin-zod',
      validate: (value: unknown) => {
        const parsed = zodSchema.safeParse(value);
        if (parsed.success) {
          return { value: parsed.data };
        }
        return {
          issues: parsed.error.issues.map((issue) => ({
            message: issue.message,
            path: issue.path,
          })),
        };
      },
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
    },
  };
}
```

3. **Trusted Context Binding Outside Model Arguments:**
   - For each tool dispatch (or turn), instantiate the handler with a closure bound to the verified server context (`{ userId, connectionId, connectionRevision, calendarId, turnId, attemptId, operationJournal }`):
     ```typescript
     const handler = createMcpHandler(
       () => createCalendarMcpServer(boundExecutionContext),
       { legacy: 'reject' },
     );
     const transport = new StreamableHTTPClientTransport(
       new URL('http://aurvin.internal/mcp'),
       { fetch: (url, init) => handler.fetch(new Request(url, init)) },
     );
     ```
    - The MCP server reads `userId`, `connectionId`, `connectionRevision`, and `calendarId` exclusively from `boundExecutionContext` in server memory — never from `args` and never from spoofable HTTP headers. Recheck current enablement/permission/revision before advertising, immediately before dispatch, and after any pause; a bound snapshot cannot override a later disconnect or denial.

---

## 6. Topic 4: Google OAuth, Account Identification, Owned-Calendar Scope, and Local-Origin Constraints

### 6.1 OAuth Scopes, Subject Identification, and `"primary"` vs Disposable Owned Calendar (`[Primary documentation]`, `[Declared compatibility]`)

1. **Recommended OAuth Scope Set (`[Primary documentation]`):**
   - Request space-delimited scopes:
     - `https://www.googleapis.com/auth/calendar.events.owned` — read/write access strictly to events on calendars the authenticated Google user owns. Does **not** grant access to shared/subscribed team or family calendars the user does not own, and does **not** grant ACL/sharing management.
     - `openid` and `email` — standard OIDC scopes so `POST https://oauth2.googleapis.com/token` returns a signed `id_token` JWT containing the immutable `sub` claim (`googleSubjectId`) and `email` / `email_verified` (`accountEmail` display metadata).
2. **Validating the Connected Google Subject (`goal.md:41`, `[Primary documentation]`):**
    - Validate the token-exchange response (`access_token`, expiry/type, actual grant, OIDC identity) under the pinned mechanism; a `refresh_token` is not guaranteed in every exchange. Missing usable offline credentials must lead to a useful setup/reconnect outcome, not fabricated refresh capability.
    - Verify the actual Calendar/identity grant and required claims. If the Calendar permission is absent, reject connection activation and safely destroy unusable local credentials; do not automatically revoke the wider Google project grant. Explicit remote revocation is separate (Section 6.3).
    - R proposed direct token-endpoint TLS validation under OIDC Core § 3.1.3.7, including `iss`, `aud`, `exp`, and `sub` checks. Treat that as a candidate, not a complete verified validator: P1/P3 must pin a supported identity mechanism and test all applicable validation requirements (including signature/TLS mode and request binding as appropriate). A decoded JWT alone is not verified identity.
    - Store the validated `googleSubjectId` and optional display `accountEmail` on `integration_connections`, bound to the current server-resolved identity. Source uses configured `identity.userId`, not a new `DEFAULT_USER_ID` or browser/model-supplied owner.
3. **Target Calendar Verification (`"primary"` or Owned Disposable Calendar ID) (`[Primary documentation]`):**
    - Use the operator-selected known owned calendar ID, bound on the server; do not default to `"primary"` when a target is missing. The first live target is a disposable operator-owned calendar. The candidate `events.list?...maxResults=1&singleEvents=true` connection preflight is bounded and separate from model-requested list ranges.
   - The `events.list` response envelope returns `{ kind: "calendar#events", summary: string, timeZone: string, accessRole: "owner" | ..., items: [...] }` even when `items` is empty (`[]`).
    - P3/P5 must test the bounded preflight and allowed-target enforcement with the actual narrow scope. Reject inaccessible/non-owner targets, but do not equate ACL `owner` alone with data ownership or infer access to an untested shared calendar. If sufficient verification cannot be achieved with the selected scope, block admission and report it rather than broaden scope or silently switch calendars.

### 6.2 Local-Origin, Loopback, PKCE, and CSRF Callback Correlation (`[Primary documentation]`, `[Declared compatibility]`)

1. **Existing Guard Pattern ([`backend/src/admin-config/configure-admin-http.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/admin-config/configure-admin-http.ts#L38-L148), source checked during this repair):**
    - `originAllowed` requires the exact configured frontend Origin for admin mutations. `transportAllowed` admits development HTTP only with loopback frontend/backend hosts and `isLoopbackPeer`; it also has a trusted-HTTPS branch. There are no existing functions named `isLoopbackAddress` / `isLoopbackHost` here.
    - Reuse the applicable validation pattern, not a claim that these existing admin checks already secure plugin routes or tool-enabled chat. The approved plugin proof remains loopback-only, with strict configured Host/port and Origin handling plus browser/anti-CSRF binding; do not inherit broader HTTPS admission.
2. **State-Changing Plugin Control Routes (`POST /oauth/start`, `POST /disconnect`, `PATCH /settings`):**
    - Must enforce loopback peer, exact configured loopback Host/port, exact frontend Origin, and appropriate anti-CSRF/browser binding. Apply the same approved local boundary to tool-enabled chat, not only setup routes. Route names/methods here are proposals for P1/P3, not already implemented endpoints.
3. **Browser-Redirect OAuth Callback (`GET /api/plugins/google-calendar/oauth/callback`):**
   - **Critical Browser Behavior ([Primary documentation]):** When Google redirects the user's browser (`302 Found`) from `https://accounts.google.com/...` to `http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback?code=...&state=...` (or via Vite proxy `http://localhost:5173/api/plugins/google-calendar/oauth/callback`), the request is a **cross-site top-level `GET` navigation**:
     - Browsers do **not** send `Origin: http://localhost:5173` on a `GET` redirect from `accounts.google.com` (`Sec-Fetch-Site: cross-site`, `Sec-Fetch-Mode: navigate`).
     - Browsers strip `SameSite=Strict` cookies on cross-site redirects from `accounts.google.com`, but **do send `SameSite=Lax; HttpOnly` cookies** on top-level `GET` navigations!
    - **Recommended Callback Protocol (P1/P3 Pin and Test):**
      - The 10-minute state/cookie lifetime below is a bounded implementation recommendation, not a replacement for any approved turn/action budget. PKCE/client/redirect compatibility remains unverified until G3.
     1. On `POST /api/plugins/google-calendar/oauth/start` (verified via `Origin === bootstrap.frontendOrigin` + loopback Host/peer):
        - Generate 32-byte CSPRNG `state` (`base64url`), 32-byte CSPRNG `browserNonce` (`base64url`), and 32-byte CSPRNG PKCE `code_verifier` (`base64url`) with `code_challenge = base64url(sha256(code_verifier))` (`code_challenge_method = 'S256'`).
        - Persist an `oauth-state` record in `metadata` containing `stateHash: sha256(state)`, `browserNonceHash: sha256(browserNonce)`, `encryptedCodeVerifier` (encrypted via `CredentialService` AES-256-GCM with AAD `{ userId, kind: 'oauth-pkce', stateHash }`), `userId`, `createdAt`, `expiresAt: now + 10 minutes`, and `consumedAt: null`.
        - Set response cookie: `Set-Cookie: aurvin_gcal_oauth=<browserNonce>; Path=/api/plugins/google-calendar/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=600`.
        - Return `{ authorizationUrl }` pointing to `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email https://www.googleapis.com/auth/calendar.events.owned`, `access_type=offline`, `prompt=consent`, `include_granted_scopes=false`, `state`, `code_challenge`, `code_challenge_method=S256`.
     2. On `GET /api/plugins/google-calendar/oauth/callback`:
         - Enforce loopback peer and exact configured callback Host/port/redirect URI. Validate state/browser binding rather than requiring the Aurvin-page Origin on Google's cross-site navigation.
        - Read `state` query param and `aurvin_gcal_oauth` cookie (`browserNonce`). Clear the cookie immediately (`Max-Age=0`).
        - Atomically transition the matching `oauth-state` record from `consumedAt: null` to `consumedAt: now` where `stateHash === sha256(state)`, `browserNonceHash === sha256(browserNonce)`, and `expiresAt > now`. If no record matches -> reject (`400`/`403`) and never call Google's token endpoint.
        - Exchange `code` + decrypted `code_verifier` at `https://oauth2.googleapis.com/token`.
        - Redirect (`302`) to `${bootstrap.frontendOrigin}/?plugin=google-calendar&oauth=connected` (or error code).

### 6.3 Token Custody, Encryption AAD, Refresh, and Revocation Blast Radius (`[Primary documentation]`, `[Declared compatibility]`)

- **Encryption Pattern ([Declared compatibility], [Approved requirement]):**
   - Existing `CredentialService` uses AES-256-GCM with AAD `['aurvin', 'config', 1, provider]`; keep those ciphertext/AAD semantics compatible. The plugin needs its own versioned envelope binding local `userId`, provider, `connectionId`, and `credentialVersion` (with `googleSubjectId` / token kind as appropriate). P2/P3 must test tampering and credential-version swaps; the proposed extended AAD is not existing source behavior.
- **Bounded Refresh / Replacement ([Approved requirement], `goal.md:44,90`):**
   - Serialize refresh per connection, cap refresh at 2 requests per accepted turn, preserve a stored refresh token if no replacement arrives, and persist rotation safely. Reconnect/account/target replacement invalidates the old revision. Missing/expired/revoked grants require reconnect; never retarget paused work silently.
- **Local Disconnect vs Explicit Remote Grant Revocation ([Primary documentation], [Approved requirement]):**
   - The prior [revocation finding](../aurvin-plugins-research/calendar.md#member-oauth-and-connection-lifecycle), citing [Google's web-server guide](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke), describes project-wide scope/token implications across that project's clients. Do not describe this as revoking only one local Calendar connection or one `(client_id, user, scope)` tuple.
   - **Local disconnect:** first fence new dispatch/refresh by disabling the binding and advancing `connectionRevision`, then safely clear persisted access/refresh credentials and in-memory references and apply source-linked content removal/expiry policy. Use a distinct disconnected outcome, not a false claim that Google revoked its grant. Do **not** automatically call the revocation endpoint. An already-dispatched write may still succeed and requires reconciliation; disconnect neither deletes events nor rolls Calendar back.
   - **Explicit remote revocation:** explain the wider project-grant implications and require that separate operator action. Fence local use first; retain the necessary token only in the bounded revocation action's volatile memory, send it in the form body to `POST https://oauth2.googleapis.com/revoke` (not in a logged URL), then destroy local credentials/references regardless of remote success. Record only a safe confirmed/failed/unknown result. If the token has already been destroyed or Google is unreachable, do not promise a credential-free automatic retry: report that remote revocation is unconfirmed and direct the operator to Google's grant controls or a separately authorized action. No ordinary usable credential may survive merely to label revocation pending.

---

## 7. Topic 5: Provider Pricing, Privacy, and Tool-Calling Support

### 7.1 OpenRouter Catalogue Discovery for Tools & Pricing (`[Primary documentation]`, `[Declared compatibility]`)

- **Current implementation ([`backend/src/model/catalogue.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/model/catalogue.ts#L34-L57)):**
  - Parses `GET https://openrouter.ai/api/v1/models` and extracts only `context_length`, `top_provider.max_completion_tokens`, and `supported_parameters.includes('max_tokens')`.
- **Required extensions for P1/P4 (`[Primary documentation]` — OpenRouter Models API schema):**
  - Each entry in `data[]` from `GET https://openrouter.ai/api/v1/models` provides:
    - `supported_parameters: string[]` — must include `'tools'` (and optionally `'tool_choice'`, `'parallel_tool_calls'`).
    - `pricing: { prompt: string; completion: string; request?: string; image?: string }` — decimal USD strings per single token/request (e.g. `"0.0000025"`).
  - **Fail-closed rules (`goal.md:98, 104`):**
    1. If `supported_parameters` does not include `'tools'`, the model is **not tool-capable** -> disable Calendar tool injection (or fail closed when Calendar is enabled for the turn).
    2. If `pricing.prompt` or `pricing.completion` is missing, empty, non-decimal, `< 0` (note: OpenRouter uses `"-1"` on dynamic/auto routers where price is unknown upfront), or `NaN`, set `toolPricing: null`. When `toolPricing === null`, **tool-enabled inference is disabled** (`NOT_READY` / safe degradation to ordinary non-tool chat), because Aurvin cannot enforce the mandatory pre-dispatch USD `1.00` turn cap (`goal.md:98`).

### 7.2 Pre-Dispatch USD `1.00` Spend Cap Reservation ([Approved requirement], [Recommendation])

- Reuse canonical decimal validation in [`backend/src/contracts/usage-evidence.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/contracts/usage-evidence.ts) and existing Decimal128 persistence/reporting patterns. Source currently includes character-based estimation, not a ready-made token-price reservation helper; P1/P2 must define additive token/request pricing evidence and exact decimal arithmetic without changing legacy row interpretation or using floating-point admission sums.
- Before each model dispatch `d` (`1..8`) in a tool-enabled turn:
   1. Compute a conservative dispatch reservation from frozen verified model/provider pricing and bounded input/output, including schema/repair/result overhead and applicable known fees:
     $$\text{reservation}_d = (\text{estimatedInputTokens}_d \times \text{promptPriceUsd}) + (\text{maxOutputTokens}_d \times \text{completionPriceUsd}) + \text{requestFeeUsd}$$
  2. Check:
     $$\text{settledSpendUsd} + \text{unsettledReservedSpendUsd} + \text{reservation}_d \le 1.00\text{ USD}$$
  3. If the sum exceeds `1.00 USD`, refuse the dispatch before calling OpenRouter and complete/fail the turn cleanly with budget exhaustion evidence.
   4. Durably record reported canonical cost once and settle its reservation only with valid evidence. Existing `MoneyEvidence.costStatus` is `known | pending | unknown`, not `reported`. If cost is absent/ambiguous, retain the reservation pending bounded reconciliation, including across restart/turn termination; do not release it merely because visible text or the turn ended. The USD 1.00 default is estimated spend admission, not a final-invoice guarantee. Unknown applicable pricing/fees cannot silently become zero.

### 7.3 User Attribution and Data Collection / ZDR Disclosure (`[Primary documentation]`, `[Declared compatibility]`)

- **OpenRouter `user` attribution ([Declared compatibility], source checked during this repair):**
   - [`ServerIdentityResolver`](../../backend/src/platform/identity/server-identity-resolver.ts) returns configured `identity.userId` as `openRouterUser`; [`buildBody`](../../backend/src/model/policy.ts) passes `r.user` to `ChatOpenRouter`. No `deriveProviderUserId` hash helper exists in this flow. Preserve server-resolved attribution on every initial, repair, provider-retry, and post-tool dispatch; do not invent a new identity derivation.
- **Privacy boundary (`data_collection` vs `zdr`):**
  - `policy.ts:54` sends `provider: { data_collection: c.openRouter.dataCollection, require_parameters: true }`.
  - As documented in [`docs/aurvin-plugins-research/aurvin-fit.md`](file:///d:/Peter/Aurvin%20Agent/Aurvin/docs/aurvin-plugins-research/aurvin-fit.md#L147-L149) (**[Primary documentation]**), `data_collection: 'deny'` instructs OpenRouter to route only to providers that do not train on or publish prompts, which is distinct from Zero Data Retention (`provider.zdr: true`).
   - Any Calendar fields selected for a later model round leave Aurvin for OpenRouter/the selected provider; minimization or self-hosting does not make processing fully local. P3/P8 must document this and require an explicit approved provider-retention/routing policy before admitting real Google data. Preserve denied data collection; neither `data_collection: 'deny'` nor an unverified ZDR flag establishes compliance with stricter content lifetimes or Google's terms. This remains the named G9 policy gate.

---

## 8. Topic 6: Source-Linked Retention, Cache/Header Restrictions, Guarded-Owner/TTL Interaction, and Write Deduplication

### 8.1 Critical Persistence Wiring Finding: `mutation-journal.ts` Collection Allowlist (`[Declared compatibility]`)

Inspection of [`backend/src/persistence/mutation-journal.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/persistence/mutation-journal.ts#L74-L129) and [`backend/src/contracts/collections.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/contracts/collections.ts#L19-L26) reveals:
1. Source checked during this repair: `COLLECTIONS` contains **seven** collections: the six Phase 1 collections (`sessions`, `messages`, `agent-memory`, `metadata`, `checkpoints`, `checkpoint_writes`) plus `config`. The goal adds one bounded `integration_connections` collection, not credentials in `config`.
2. `guardedClient()` in `mutation-journal.ts:74` hardcodes:
   ```typescript
   const collections = new Set([
     'sessions', 'messages', 'agent-memory', 'metadata', 'checkpoints', 'checkpoint_writes',
   ]);
   ```
    `guardedClient` explicitly **throws `UNSUPPORTED_TOPOLOGY`** for an unlisted collection; it does not bypass its guard. P1 owns adding the contract collection name and P2 owns the narrowly required guarded persistence admission. Do not bypass the facade with another MongoDB client/owner.
3. The admitted mutation methods are `updateOne`, `replaceOne`, `findOneAndUpdate`, `bulkWrite`, and `createIndex`; direct `insertOne`, `deleteOne`, and `deleteMany` are rejected, not silently unguarded.
    - **Recommendation for P2:** Use owner-fenced admitted mutations for connection lifecycle and content-expiry tombstones. Any new deletion API requires explicit safe admission/tests, not raw-driver access. Preserve existing `config` behavior and P1/P2 file ownership.

### 8.2 Calendar TTL Is Not Admitted Without Ownership/Lifecycle Proof (`[Declared compatibility]`, [Approved requirement])

1. **Ownership mismatch:** Background TTL deletion does not use Aurvin's owner-fenced mutation journal. The goal requires any proposed TTL to be shown safe for ownership and record lifecycle first; this research does not provide that proof.
2. **Breaks `ReferencedContextAssembler` (`[Declared compatibility]`):** [`backend/src/context/referenced-context-assembler.ts`](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/context/referenced-context-assembler.ts#L96-L97) throws `NOT_READY` (`Missing message for active reference`) if a message document referenced by `agent-memory`'s `activeMessageIds` is physically deleted.
3. **Unsafe-replay risk (`goal.md:110–126`):** Deleting an operation/quarantine record while its turn is retryable could allow a duplicate if absence were treated as new authority. Retain permitted minimal markers and fail closed when evidence expires; absence must never authorize a fresh event ID for the same accepted turn.

### 8.3 Owner-Fenced Retention, Redaction, and Deduplication ([Approved requirement], [Recommendation])

1. **Permission First, Then Earliest Applicable Expiry (`goal.md:126–128`):**
    - Inspect actual `Cache-Control` / `Expires` responses and the applicable Google API terms and approved OpenRouter/provider processing policy. Do not infer permission from missing headers, the 24-hour ceiling, or non-training settings. P2/P5/P8 must verify how directives and policy govern Aurvin's storage/processing; until then, do not admit real Google content.
    - Raw fetched bodies remain transient. For any permitted minimized fetched projection **or derived assistant content**, choose `expiresAt = earliest(sourceFetchedAt + 24h, applicable header/cache deadline, applicable policy deadline, linked source expiries)`. Use absolute source deadlines; derivation/checkpoint restore/refetch of a different record cannot renew an old copy's lifetime. Multiple sources inherit the strictest applicable expiry.
    - Under this proof's conservative pending-policy handling, `no-store`, `no-cache`, or zero freshness provides no assumed durable allowance. If actual permission is absent/zero, keep fetched and derived details volatile and out of durable `metadata`, `messages`, `checkpoints`, `checkpoint_writes`, and caches. Persist only an independently permitted minimized reference/outcome and tombstone; `eventId`, `htmlLink`, dates/zones, hashes, or counts are not automatically exempt. If even safe minimal evidence is not permitted, block the feature/retry path rather than weaken retention or deduplication safety.
2. **Source-Linked Content Lifecycle Across Every Copy:**
    - Permitted durable projections/derived messages carry bounded provenance (`plugin`, `connectionId`, `connectionRevision`, source/operation references, `fetchedAt`, computed `expiresAt`, `redactedAt`). There is no unconditional `fetchedAt + 24h` derived-content exemption. With zero permission, write a permitted outcome/tombstone from the outset, not content awaiting a later scrub. Canonical user-authored input keeps its existing transcript policy.
    - Enforce expiry on reads/context assembly as well as owner-fenced cleanup; a delayed scrub cannot authorize reusing expired data. Redact linked results and assistant details in the UI archive, metadata projections, graph state/pending checkpoint writes, and caches. Preserve message IDs/sequence and clear tombstones so references/history do not silently disappear. Keep tool-call/result groups valid or interrupt safely instead of sending an unmatched or expired group.
    - Apply the documented disconnect/removal policy and record source-linked redaction. P8/P9 must document/test backup retention and restore-time redaction so restoring a backup cannot re-admit expired content. These mechanisms are required future work, not claimed implemented behavior.
3. **Operational Evidence vs Write-Deduplication Safety (`goal.md:108–126`):**
    - Before dispatching `calendar_create_event`, persist the canonical validated authorized action, request hash, current connection/target revision, and **one Google-compatible event ID**, with stable operation/turn identity. Keep user-authored action data distinct from fetched content; store only permitted minimized reconciliation evidence and never put credentials or unrelated fetched bodies in the ledger.
    - P1/P2 map the approved `planned`, `dispatching`, `succeeded`, definitely failed, and unknown/reconciliation-required outcomes to bounded typed records/events. No cross-collection atomicity or exactly-once Google execution is assumed.
    - Completed operations are reused, not recreated, across idempotent submission, explicit retry of the same accepted input, final-narration failure, or recovery. For an ambiguous dispatch, first read back **the same event ID** under current permission/revision/budgets and verify linkage. A matching result can finalize; a conflict/mismatch cannot become success. Any permitted delivery retry reuses that ID, never a newly generated one. Uncertainty remains visible/quarantined and prevents another mutation; asking the user to check Calendar alone does not establish a safe retry.
    - Operational audit/usage evidence defaults to **30 days subject to stricter applicable policy**, separate from the fetched/derived-content deadline. Retain only a minimum permitted non-content terminal/dedup marker while its accepted turn is retryable. If evidence expires or cannot be retained, refuse unsafe replay rather than treating a missing row as new intent. Keep unresolved operations quarantined with bounded operator escalation; a TTL must not erase them into eligibility for another create.

---

## 9. Summary of Blockers and Later Execution Gates (P1–P9)

### 9.1 Blockers / Pre-P1 Reconciliations
- **No approved-scope change is needed for this documentation reconciliation.** P1 planning can continue against the unchanged goal. Remaining verification/policy gates block the dependency freeze, real-data admission, or whole-workflow completion as applicable; they are not passed by this research.
   1. Exact remaining candidates: `@modelcontextprotocol/server@2.3.1`, `@modelcontextprotocol/client@2.3.1`, transitive `@modelcontextprotocol/core@2.3.1`; retain `zod` declared `^3.25.32`, resolved `3.25.76`. Reported test environment: Node `24.18.0`, TypeScript `6.0.3`, NodeNext. Reproduce the `StandardSchemaWithJSON` bridge, actual package APIs, and schema parity before accepting compatibility. Candidate handler/fetch path: `createMcpHandler(..., { legacy: 'reject' })` + `StreamableHTTPClientTransport` custom fetch + client `versionNegotiation: { mode: 'auto' }`; observe wire **`2026-07-28`**, not legacy **`2025-11-25`**, without a public route/socket. Do not silently switch to v1 or mocks if reproduction fails.
   2. Identity/OAuth recommendation remains `openid email` + `calendar.events.owned`; the supported validator/client/PKCE combination and actual owned-target verification remain P1/P3/P5 gates. No automatic `primary` target, wider Calendar scope, or remote revocation on local disconnect is authorized.
   3. P1 owns the additive `integration_connections` contract name; P2 owns its guarded admission and persistence. Preserve seven existing collections, the single owner/config cipher, and fail-closed facade behavior. Freeze bounded source-expiry and permission-aware result/assistant contracts without a derived-content retention exception.
   4. Exact goal repair wording, 20-result read ceiling, no invented creation-duration cap, unchanged turn/request/spend budgets, local-disconnect/explicit-revoke separation, and required P9 live-gate disposition are mandatory. Google retention terms, actual response headers, approved external provider policy/pricing, and required native/browser/live evidence remain unresolved until measured/documented by their owners. If those findings truly conflict with approved scope, halt and report for reconciliation rather than substituting scope.

### 9.2 Later Execution Gates (Must NOT Be Treated as Certified from This Research)

| Gate | Owning Plan(s) | What Must Be Verified by Actual Execution |
| --- | --- | --- |
| **G1 — Dependency Freeze / Reproducible Build** | P1 | Before accepting the freeze, verify exact candidate packages/peer APIs and reproduce reported local compatibility; retain commands/output, lockfile and NodeNext schema checks. Run backend build/lint/test. Any install belongs to authorized implementation, not this repair. |
| **G2 — Guarded Persistence, Revision Fencing, & Retention** | P2 | Unit and isolated-native tests of guarded `integration_connections`, cipher/AAD/version compatibility, durable counters/reservations, stricter fetched **and derived** lifetimes including zero permission, all-copy tombstones, and quarantine/minimal dedup markers. Use only the supplied isolated MongoDB URI/prefix; record absent prerequisites as blocked/unrun, not a pass. |
| **G3 — Supported OAuth / Target / Disconnect Contract** | P1, P3, P5 | Pin/test subject validation and supported PKCE; deterministic/native state replay/expiry/browser-binding, configured Host/Origin/CSRF, target/subject/revision swaps, refresh lock/rotation/caps, and credential AAD. Reject missing scope without silently revoking the project grant. Test local disconnect separately from explicit remote revocation, including safe credential destruction and unconfirmed remote outcomes. |
| **G4 — Provider Tool Protocol, Strict Parsing, & Spend** | P1, P2, P4, P6 | `TR-01`–`TR-06`, complete terminal framing, optional provider IDs recorded when available, duplicate keys/fragmented envelopes, policy-vs-structure classification, exact repair wording/clean history, frozen model/provider tool/price support, exact-decimal reservations, legacy compatibility and unknown-cost retention. Fixtures are not live model certification. |
| **G5 — Real Embedded MCP / Calendar Adapter** | P5 | Actual pinned client discovers/calls exactly the three tools through the production handler/fetch path and records observed `2026-07-28` negotiation. Verify schema parity/tamper rejection, trusted context, narrow scope/owned-target checks (not ACL label alone), 20-event/31-day bounds, explicit pagination, valid timed events without an invented 24-hour duration cap, unsupported-feature/no-invitation behavior, result bounds/expiry and channel closure. Direct REST or mocked-client tests alone are insufficient. |
| **G6 — Durable Loop / Safe Same-ID Recovery** | P6 | `TR-07`–`TR-13` plus cancellation, all exact budget boundaries/restart counters, clean valid tool groups, acceptance/operation-before-dispatch, same-ID readback/linkage/conflict handling, retained completed outcomes after narration failure, cross-tab retries, uncertain writes and drain. Expired volatile results cannot be recovered by replaying a write or paid inference. |
| **G7 — Integrated Native / Browser / Regression Evidence** | P7, P8, P9 | Backend build/lint/test/e2e and frontend build/lint/test; actual browser flows, isolated MongoDB recovery/accounting, assembled real MCP with deterministic Google/model fixtures, voice/config/canvas/text regressions, source expiry/redaction/backup handling, and secret-safe operations. Record measured results and native/browser skips/blocks separately; no-tests exits or source presence are not evidence. |
| **G8 — Required P9 Live Acceptance or Named Completion Block** | P9, final V | Required by `goal.md:153,161–163`: an explicitly authorized bounded live Calendar create/readback **and safe-retry proof**, using the supplied Google project/consent configuration, operator grant, disposable owned calendar, exact event data/cleanup authority, tool-capable configured model with approved external-data policy, and authorized spend/request bounds. Goal approval itself supplies none of this live authorization; reuse any existing exact authorization rather than request it twice. If inputs/authorization/evidence are unavailable, record **G8 blocked / live acceptance unrun**, the tested subset, and leave whole-workflow completion pending in final verification/evidence/report. This is not optional or post-P9 work. |
| **G9 — Real-Data Processing / Retention Admission** | P1, P2, P3, P5, P6, P8; P9 verifies | Before real Google data, document applicable Google terms, observed header restrictions, independently permitted minimal references/outcomes, stricter fetched/derived expiry and backup/restore treatment, plus explicit approved OpenRouter/provider retention/routing and known model/provider price evidence. Denied data collection is retained; no derived 24-hour exemption, universal-header assumption, or implicit zero-retention certification. An unresolved policy requirement blocks real-data admission and affected acceptance. |

P9 records exact commits/environment and actual passes, skips, named blocks, and live results in `verification.md`, `staging-evidence.md`, and `final_report.md`. Unified review remains **skipped**, never passed. Neither this reconciliation nor a tested subset closes a required blocked acceptance gate.
