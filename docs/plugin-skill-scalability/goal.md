# Plugin skill scalability — v1 design

## Status and objective

Consolidated on 4 November 2026 from the user's agreed brainstorming decisions. This document specifies the first version; it is not implementation or verification evidence. User review of the written specification precedes implementation planning. Unified implementation review remains skipped under the repository workflow instruction.

Reduce unnecessary plugin-schema input and tool-definition churn as Aurvin grows beyond Calendar. Use a compact catalog, on-demand schema discovery, and a stable execution dispatcher. Preserve reliable execution, conversation history, and opportunities for provider prompt-cache reuse without promising cache hits or cost savings before measurement.

## Agreed scope

- Initially show plugin grouping and a short plugin description, with tool names and short descriptions only. Do not include parameter schemas in the initial catalog.
- Load one, several, or all tools from a plugin on demand.
- Retain loaded schemas for the chat, within existing finite context limits; reuse them on follow-ups rather than unloading them after a task.
- Execute through a stable generic dispatcher with strict backend validation.
- Reject execution before schema loading, then guide Aurvin through a bounded load-and-retry correction loop.
- Preserve tool-call history and results. Reuse existing permissions, confirmation, idempotency, accounting, and recovery behavior.
- First implementation integrates the existing Calendar plugin. Do not build additional plugins to demonstrate scale; use deterministic catalog fixtures for larger tool counts.

## Simplicity and latency requirements (Ponytail)

V1 must follow the repository's Ponytail ladder: reuse the current catalog, schemas, runtime loop, persistence, and plugin executor before adding code. Implement the smallest working change, not a general-purpose skill platform. Simplicity and low round-trip overhead are acceptance requirements, not optional cleanup after implementation.

- **No duplicate validation or authorization layers.** Validate the dispatch envelope and loaded-schema prerequisite at the dispatcher; reuse the existing executor's argument, authorization, and write-safety checks at their established boundaries. Do not repeat those checks at discovery, activation, dispatch, and execution or introduce a new permission service. Keep required trust-boundary checks; remove redundant plumbing rather than weakening protections.
- **Discovery is a local metadata lookup.** Loading a schema must not call the plugin provider, refresh OAuth, probe connectivity, or make a separate authorization/model request. Reuse the existing enabled/available plugin catalog. Actual execution retains the existing authoritative access and connection checks.
- **No ceremonial call chains.** For a newly needed tool, load its schema and execute it; for an already-loaded tool, call it directly. Batch schemas that the model already knows it needs in one activation. Do not force plugin activation before tool activation, reload on each turn, or add planning, confirmation, or preflight calls beyond existing action requirements.
- **Reuse state instead of building another subsystem.** Derive loaded revisions from retained discovery records in the existing chat context. Add only minimal existing-state metadata if necessary for recovery or efficient lookup; no new collection, activation service, parallel source of truth, or schema-version execution framework.
- **Reuse bounded correction.** Extend the current loop for missing-schema and argument errors; do not build a second retry/recovery engine. Handle uncommon failures through existing error paths where they already suffice.
- **Keep the change and its checks focused.** No new dependency, unrelated refactor, separate benchmark platform, or mandatory parallel legacy implementation. Extend existing fixtures and tests. A capability not needed for Calendar and the agreed discovery workflow waits for a concrete need.

In the normal path, add at most one schema-discovery model round trip before using a previously unloaded tool or selected batch, and zero discovery round trips for already-loaded tools. Multiple genuinely new dependencies, recoverable errors, and existing action confirmations can require additional calls; they are not reasons to impose those calls on every request. Record call counts and task latency alongside token savings, and do not treat lower prompt size alone as success.

## 1. Compact catalog

Example discovery content:

```text
Calendar — scheduling and availability
  calendar_list_events — Find events within a time range.
  calendar_get_event — Read a known event.
  calendar_create_event — Create a timed event.
  calendar_list_calendars — Discover available calendars.
  calendar_check_availability — Find busy intervals.
```

Names must map to canonical registry identifiers; friendly plugin labels are not separate implementations. Calendar's current canonical plugin ID is `google-calendar`.

Catalog entries are trusted application metadata, not plugin-result instructions. Keep ordering and wording deterministic. Keep the catalog unchanged during ordinary follow-ups; apply explicit version or permission changes when necessary. Do not place credentials, user identity overrides, or full schemas in catalog entries. Detailed parameter semantics and essential usage constraints are supplied when loading the selected tool.

## 2. Two stable native tools

Expose the same two native tool definitions on ordinary model requests throughout a chat:

```text
activate_skill({ plugin, tools: "all" | [toolName, ...] })
call_tool({ plugin, tool, arguments })
```

These are proposed application contracts, not existing APIs. The model-facing names and schemas stay stable; plugin-specific schemas are not added to the native `tools` array.

The user's notation expresses the same discovery operations:

```text
calendar.all()                  -> activate_skill({ plugin: "google-calendar", tools: "all" })
calendar.tools("create_event")  -> select calendar_create_event
calendar.tools([name1, name2])   -> select several tools in one activation
```

These examples are conceptual shorthand, not executable JavaScript tools or an additional routing layer.

### Schema loading

`activate_skill` resolves the plugin and requested tool names from the existing enabled/available server catalog. Explicit selection must be nonempty. Reject unknown names and invalid selections without partially activating tools. This is local metadata resolution, not a new authorization or connectivity workflow.

Return the selected canonical names, schema revisions, full argument schemas, and concise necessary usage instructions as an ordinary tool result. A revision counts as loaded when its disclosure is durably recorded through existing history persistence and available in the model context. No separate activation transaction or extra persistence round trip is required. Loading does not execute a plugin action.

Return multiple requested schemas together. Enforce existing result-size and context budgets; if the complete selection cannot fit, return a bounded error advising a smaller explicit selection rather than silently truncating schemas or partially activating them.

Repeated activation of an already-loaded revision returns a compact acknowledgement referencing its prior disclosure, not another copy of the full schema. Recover the loaded state and original disclosures when reopening the chat or restarting the backend. Never trust a client-supplied assertion that a schema was loaded.

### Execution

`call_tool` accepts the plugin ID, canonical tool name, and an argument object. The dispatcher resolves the tool and checks its loaded revision, then passes the request to the existing plugin execution path. That path remains responsible for argument validation, authorization, connection checks, confirmation requirements, and operation budgets; do not duplicate its checks in the dispatcher.

Use existing schemas and validators as the authority; do not create manually maintained copies of parameter schemas for discovery. A revealed schema is guidance for the model, not a permission grant.

## 3. Automatic workflow correction

If Aurvin attempts execution before loading the schema:

1. Reject the request before any plugin action runs.
2. Return a machine-readable `SCHEMA_NOT_LOADED` result identifying the plugin and tool, with an instruction to call `activate_skill` for that tool and then retry `call_tool` using the revealed schema.
3. Continue the model loop so Aurvin can perform that sequence automatically.
4. Validate the corrected execution normally; loading never bypasses any other check.

Invalid arguments receive bounded, useful validation diagnostics. Unknown tools, revoked access, disconnected plugins, provider failures, and uncertain action outcomes remain distinct from a missing-schema error. Do not repeatedly instruct discovery when discovery cannot fix the failure.

Reuse the existing finite correction budget, at most two repair cycles per turn for the initial Calendar integration, and the existing model-dispatch, deadline, context, and spend limits. Missing-schema and argument corrections share the repair budget rather than each receiving a separate unlimited loop. Each recoverable schema-loading or argument-validation rejection consumes one repair cycle; successful discovery does not reset that counter. Every additional model request counts toward dispatch and spend limits. Exhaustion ends with an explicit useful failure.

Retrying a request rejected before execution is not the same as retrying an attempted external write. Never blindly repeat an uncertain write; retain existing durable operation IDs, receipts, confirmation, and recovery behavior. Discovery is not a mutation and does not consume a Calendar create allowance.

## 4. Lifetime, revisions, and history

Keep each disclosed schema revision and its instructions in the chat's model-visible history. Preserve complete call/result pairs, including discovery and correction results, with original ordering and stable identifiers. Do not duplicate application-loaded history with checkpoint-restored messages.

Use retained disclosure records as the authority for loaded tool revisions. If a bounded lookup is needed, derive or maintain it within existing chat state and link it to those records; do not introduce an independent activation store. It must not claim a schema is available if the corresponding disclosure is absent from the assembled model context.

Do not replace old disclosures when a plugin changes. Execute against a loaded revision only while that revision remains supported by the backend. If it no longer matches an executable revision, reject before plugin execution with `SCHEMA_STALE`, instruct reactivation, and append the newly disclosed revision. Reuse the same bounded correction policy. No legacy schema executor is required for v1.

Retained knowledge does not retain authorization. Preserve the existing execution-boundary permission check rather than adding new checks at each discovery step. Preserve existing privacy/redaction rules even if applying them reduces cache reuse.

No automatic unloading, compaction, or silent history truncation is introduced. When the existing context limit prevents further safe execution, report the limit and ask for a new chat. A new chat starts with no loaded plugin schemas.

## 5. Cache behavior and its limits

Keep the compact catalog, base instructions, and two native tool definitions byte-stable during ordinary continuation. Append schema disclosures and execution results in their actual conversation positions; do not relocate them into a rewritten system prompt or change the native tool definitions on activation.

This avoids plugin activation itself changing the native tool-definition prefix. It does not certify the rest of Aurvin's assembled prompt as stable: context reconstruction and any changing prefix content must be checked during implementation. Provider routing, cache lifetimes, minimum cacheable sizes, and endpoint behavior can still cause misses.

Revealed schemas remain input context on later requests. Caching can reduce their billed processing cost; it does not remove their context-window usage. Discovery also adds model round trips, so evaluate total task cost and latency rather than first-request size alone.

The generic dispatcher exposes an argument object, not each plugin's native parameter schema. A provider can enforce only the dispatcher's advertised structure where strict mode is supported and enabled; it cannot enforce schemas supplied as ordinary tool-result text. Backend validation remains mandatory. Aurvin's current Calendar request builder supplies native schemas but does not attach `strict: true`; do not describe provider-side strict enforcement as an existing guaranteed behavior.

## 6. Verification and acceptance

Leave runnable deterministic checks for:

- Initial catalog contains names and short descriptions, not full plugin parameter schemas.
- One-tool, multi-tool, and all-tool discovery; invalid and over-budget selections; repeated-load deduplication.
- Native tool definitions and the existing assembled prefix remain unchanged across ordinary activation and execution continuations; new disclosures are appended.
- Execution-before-load rejection produces no plugin action and can automatically recover through load then execution within budgets.
- Invalid arguments, stale revisions, unknown tools, disconnected plugins, revoked access, and exhausted correction budgets have explicit bounded outcomes.
- Loaded state and disclosures survive follow-ups, chat reopening, and backend restart without cross-chat or cross-user leakage.
- Retained call/result groups remain complete and ordered, and context-limit failures do not silently discard history.
- Existing Calendar permissions, confirmation, idempotency, uncertain-write recovery, durable completion, accounting, and cancellation behavior still pass.
- Discovery performs no external plugin/preflight calls; loading a batch uses one discovery result, and an already-loaded tool executes without another discovery or authorization preflight round trip.

Compare the existing all-five-native-schemas Calendar baseline against v1 using matched deterministic tasks: no-plugin questions, a single operation, multi-tool tasks, same-tool follow-ups, and a later newly needed tool. Use synthetic larger plugin catalogs to check scaling without implementing new integrations.

Record total input/output tokens, uncached and cached input tokens when reported, model-request count, argument corrections, correct tool selection, task success, and end-to-end latency. Label fixture token estimates separately from provider-reported usage. Report unavailable cache measurements as unavailable, not zero. Any paid provider comparison requires separate authorization and bounded cost/data exposure; fixture results cannot certify provider cache hits.

Acceptance requires the specified behavior, the simplicity and normal-path call-count requirements above, and passing required package checks. A performance claim additionally requires measured task-level evidence; do not claim improvement from source changes alone. Capture the existing baseline before replacing the routing path; do not require maintaining two production implementations just to compare them. Any rollout switch should reuse existing configuration conventions, not introduce a rollout framework.

## Non-goals

No new router model, semantic tool search, embeddings, automatic compaction, extra plugin implementations, UI model picker, authorization redesign, or new provider-cache infrastructure. No removal of validation, operation safety, or history to achieve token savings. No implementation or live provider authorization is implied by this document.
