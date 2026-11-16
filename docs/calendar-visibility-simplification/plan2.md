# Google Calendar Contract Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify Aurvin's existing Calendar execution path and model-visible contracts, proving truthful first-page listing, continuation, qualified ownership evidence, bounded correction and preserved safety through the production assembly.

**Architecture:** Keep the existing Google REST adapters and `CalendarApiTools`; remove the embedded same-process MCP negotiation/serialization path only after relocating its necessary result-binding and drain guarantees. Keep v1/v2 durable shapes, tool names and cursor encoding unchanged, explicitly describe Aurvin continuations, and enforce the advertised/runtime contract with exhaustive structural parity checks plus native production-request capture. Consume P1 diagnostic contract v1 without changing the telemetry implementation or pretending fixture evidence explains the live incident.

**Tech Stack:** Existing TypeScript/NodeNext, NestJS, Zod 3, Node standard library, Google Calendar REST, native OpenRouter function calls, and existing Vitest/in-memory assembly fixtures. No new dependency or hosted service.

---

## Steps

- [x] Establish the evidence boundary and five-tool documentation mapping.
- [x] Make contracts truthful and prove structural/native serialization parity.
- [x] Consolidate necessary safety in the existing direct executor and retire embedded MCP.
- [x] Prove first-page listing, returned continuation and qualified ownership through production assembly.
- [x] Consolidate finite correction and genuinely redundant-call suppression.
- [x] Verify stored-record, cursor, authority, privacy and recovery compatibility.
- [x] Verify P1 instrumentation on the final path and hand over measured offline evidence.

## Assignment, dependencies and non-negotiable gates

This is **P2 of exactly two implementation plans**. The tasks below are parts of P2, not additional plans. Read [goal.md](goal.md), [state.md](state.md), [research.md](research.md), [observability.md](observability.md), root [AGENTS.md](../../AGENTS.md) and [README.md](../../README.md). Load the available `executing-plans` and `test-driven-development` skills as the assigned worker; do not create nested agents. Unified review is **skipped**, never passed; no reviewer or review-triggered fixer.

Planning baseline: HEAD `37f7618` on `codex/google-calendar-plugin`, clean index/worktree. P1's implementation handoff includes `9522cf4`, `c476854`, `2538fad`, `0ba16ec`, `8d12bd3`, `4326a1c`; its evidence/runbook commits include `b0ad7c5`, `c2df866`, `1b8b18a`. State records P1's offline gate complete. A later source or diagnostic-contract change pauses affected steps until the orchestrator reconciles ownership. Do not edit `state.md`, `research.md`, `plan1.md`, `observability.md`, `verification.md` or `final_report.md` in this assignment; report discrepancies to their owner. Tick this plan without removing its constraints.

Before writing source:

```powershell
git status --porcelain=v1 --untracked-files=all
git diff --cached --name-only
git log -8 --oneline
```

Preserve intervening edits, existing tests and `.openchamber/`. If an owned path is dirty, stop for an attributable boundary rather than absorbing other work. Serialize every index operation/commit with the orchestrator; stage named files, never `git add .`. Add the repository header to every new code file and to an existing headerless file changed by more than 30%. Use `.js` import specifiers. Do not switch worktree/branch, upgrade Zod, create a framework or instantiate another runtime, credential owner or persistence-close owner.

**Authorization:** this worker performs fixture-only implementation and checks. No Google/OpenRouter live calls, real credentials, database connections/inspection, provisioning, OAuth changes or deployment. Public documentation reads are not provider acceptance calls. Native and live gates belong to separately authorized final verification, not to this worker's automatic commands.

### P1 evidence that actually permits P2 to proceed

`test/assembly/calendar-observability.spec.ts` demonstrates an offline `pageToken: "first"` call rejected locally with `cursor-format/not-sent`, followed by correction to `{}`, a cache result and completed delivery. It also distinguishes Google 400 delivery, discovery refresh, bounded fallback, uncertain POST, interleaved correlation and throwing sinks. This is an actionable **synthetic** boundary, not the original incident. The live arguments and selected model's behavior remain unknown. Do not insert guessed incident arguments or call the page-token allegation an established root cause.

Run the characterization before changing behavior, from `backend`:

```powershell
npm test -- test/assembly/calendar-observability.spec.ts
npm test -- test/runtime/calendar-feedback.spec.ts
```

Expected: existing fixture cases pass, including zero Calendar HTTP for the cached correction/list case. Record actual counts, not inherited P1 counts. Any failure must be understood with `systematic-debugging` before changing behavior. A characterization pass is not a new red test or a live-resolution claim.

## File and test ownership map

All paths are repository-relative. P1 has handed over the following shared execution/model/assembly paths; its telemetry implementation and diagnostic port remain frozen.

| Files | P2 responsibility |
| --- | --- |
| `backend/src/contracts/calendar-tools.ts` | Truthful five-tool descriptions/parameter descriptions; preserve argument/result shapes and revisions. Runtime input schemas remain the authority; JSON Schema is a mandatory parity-checked projection. |
| `backend/src/model/calendar-validation.ts`, `backend/src/model/calendar-repair.ts` | One structural parse after the bounded native scanner; short bounded repair feedback using native tools rather than a second embedded catalogue. Preserve rejection records and P1 field facts. |
| `backend/src/model/calendar-policy.ts`, `backend/src/model/calendar-adapter.ts` | Only changes demonstrated necessary by actual serialized-request regressions. Keep admission, attribution, accounting, fixed catalogue comparison and content-independent fingerprints. |
| `backend/src/plugins/google-calendar/tools.ts` | Existing direct execution port becomes the assembled path; relocate necessary result binding/size checks and active-work shutdown accounting here. Preserve credentials, account fencing, capabilities, sources, cursor signing and readback. |
| `backend/src/plugins/google-calendar/calendar-discovery-api.ts` | Include the collection discriminator in the selected REST fields; retain strict provider parsing and honest incomplete snapshots. No `dataOwner` ingestion/storage. |
| `backend/src/operations/calendar-assembly.ts`, `backend/src/app.service.ts` | Assemble the same `CalendarApiTools` instance directly; use active executions rather than MCP channels for drain safety. Preserve P1 injection and one runtime/store owner. |
| `backend/src/chat-runtime/calendar-loop.ts` | One finite correction transition and semantic duplicate comparison; preserve decision-before-execution, result-before-continuation and durable finalization. |
| `backend/src/instructions/system.md` | One concise ownership/coverage rule; no duplicated catalogue or ownership heuristics. |
| `backend/src/contracts/index.ts`, `backend/src/contracts/calendar-policy.ts` | Remove only the retired MCP-schema export/wire constant after all consumers migrate. Leave stored v1/v2 schemas, grants, limits and revision literals intact. |
| `backend/package.json`, `backend/package-lock.json` | Remove only the two now-unused direct MCP SDK dependencies after the final import audit. No other dependency/version/engine change. |
| `backend/test/contracts/calendar-tools.spec.ts`, `backend/test/contracts/calendar-multi-tools.spec.ts`, **new** `backend/test/contracts/calendar-contract-parity.spec.ts` | Names, fields, required/optional/type/bounds/uniqueness parity and an explicit semantic-constraint inventory. |
| **new** `backend/test/assembly/calendar-simplification.spec.ts`, **new** `backend/test/assembly/calendar-simplification.built.spec.ts`, `backend/test/assembly/calendar-fixture.ts`, `backend/test/assembly/calendar-observability.spec.ts` | Production AppService/native model serialization, built-JavaScript assembly, dynamic returned continuation, ownership/coverage qualification and AC9. Only extend shared fixture options when these tests actually require them. |
| `backend/test/plugins/google-calendar/tools-multi-fixtures.ts`, `backend/test/plugins/google-calendar/tools-multi.spec.ts`, `backend/test/plugins/google-calendar/tools-validation.spec.ts`, **new** `backend/test/plugins/google-calendar/tools-boundaries.spec.ts` | Direct-port safety/lifecycle regressions and relocated business assertions from retired MCP tests. Expose the existing fixture `api` for injected malformed adapter-output tests; do not add a production test hook. |
| `backend/test/plugins/google-calendar/calendar-discovery-api.spec.ts`, `backend/test/plugins/google-calendar/calendar-api-cursor.spec.ts`, `backend/test/plugins/google-calendar/calendar-api.spec.ts`, `backend/test/plugins/google-calendar/calendar-api-http.spec.ts`, `backend/test/plugins/google-calendar/calendar-availability-api.spec.ts` | REST mapping, two distinct pagination layers, safe cursor failure classes, request-budget and write uncertainty regressions. |
| `backend/test/model/calendar-validation.spec.ts`, `backend/test/model/calendar-repair.spec.ts`, `backend/test/model/calendar-policy.spec.ts`, `backend/test/model/calendar-adapter.spec.ts`, `backend/test/model/calendar-repair-flow.spec.ts` | Preserve diagnostics and native catalogue presence without requiring schema JSON inside correction prose. |
| `backend/test/runtime/calendar-runtime.fixture.ts`, `backend/test/runtime/calendar-multi-fixture.ts`, `backend/test/runtime/calendar-feedback.spec.ts`, `backend/test/runtime/calendar-answer-regressions.spec.ts` | Replace embedded execution with the same real direct tools; add structural-exhaustion, duplicate, distinct-query/page and post-write fresh-read checks. Preserve existing effect/failure injection evidence. |
| `backend/test/assembly/calendar-flow.spec.ts`, `backend/test/assembly/calendar-multi-flow.spec.ts`, `backend/test/integration/plugins/multi-calendar/accounting-recovery.spec.ts` | Move invocation spies from the retired class to `CalendarApiTools`; retain HTTP/SSE correlation, receipt, attribution and accounting assertions. |
| `backend/test/plugins/integration/multi-calendar/provider-coverage.spec.ts`, `backend/test/plugins/integration/multi-calendar/catalogue.spec.ts`, `backend/test/plugins/integration/embedded-mcp.spec.ts` | Convert business assertions to direct execution/production native catalogue assertions; rename the last file to `backend/test/plugins/integration/calendar-execution.spec.ts`. No fake SDK client facade. |
| `backend/test/contracts/calendar-multi-mcp.spec.ts`, `backend/test/contracts/calendar-mcp-compatibility.spec.ts` | Move durable/output-size assertions to `calendar-multi-operations.spec.ts`; move package engine/Zod/no-new-dependency checks to `calendar-contract-parity.spec.ts`. Remove only obsolete SDK-wire assertions. |
| **new** `backend/test/contracts/calendar-simplification-compatibility.spec.ts` | Frozen pre-P2 v1/v2 decision/result/checkpoint/receipt/operation round trips, no current authority from historical records. |
| **new** `docs/calendar-visibility-simplification/contract-alignment.md` | Implemented contract mapping, evidence, retained/removed checks, compatibility, rollout/rollback and exact remaining gates. P2's working evidence, not the orchestrator's final report. |

### Files retired only after business coverage has a named replacement

Delete `backend/src/plugins/mcp/calendar-client.ts`, `backend/src/plugins/mcp/calendar-server.ts`, `backend/src/plugins/registry.ts`, and `backend/src/contracts/calendar-mcp-schema.ts` after Task 3's relocation and caller audit. Delete `backend/test/plugins/integration/multi-calendar/sdk.ts`; call the actual execution port directly instead of building an SDK-shaped replacement.

Retire `backend/test/plugins/mcp/calendar-client.spec.ts`, `backend/test/plugins/mcp/calendar-server.spec.ts`, `backend/test/plugins/mcp/calendar-bounds.spec.ts`, `backend/test/plugins/registry.spec.ts`, `backend/test/contracts/calendar-mcp-compatibility.spec.ts` and `backend/test/contracts/calendar-multi-mcp.spec.ts` only after recording each business assertion's replacement in `contract-alignment.md`. Keep all-five invocation, hostile fields, authority, canonical targets, byte ceilings, cancellation/drain, revocation races, response/receipt binding and uncertain-write tests. Only initialize/listTools/version/header/JSON-RPC/error-flag/handler-close/catalogue-wire-tampering assertions disappear with that boundary. Native request tampering is still rejected by `buildCalendarBody` and tested there. An unported business assertion blocks deletion; reducing test count alone is not simplification evidence.

**Read/run, do not casually edit:** `backend/src/contracts/calendar-discovery.ts`, `calendar-model.ts`, `calendar-operations.ts`, `calendar-sources.ts`, `calendar-compatibility.ts`, `backend/src/context/calendar-context.ts`, `backend/src/agent/state.ts`, persistence and recovery implementations. Their frozen shapes and provenance/expiry semantics are compatibility inputs. If a regression requires changing them, stop for an explicit strategy/ownership reconciliation before implementation. Frontend/HTTP wire types are unchanged by design.

## Task 1: record evidence and the documented supported subset (AC5, AC8, AC10)

**Files:** create `docs/calendar-visibility-simplification/contract-alignment.md`; read the executor, policy, context, operations and source contracts listed above. No production change in this task.

- [x] Record the baseline/clean-worktree boundary, P1 contract v1 and the two characterization results. Label facts **observed on fixtures**, **source-derived**, **public documentation**, or **unobserved live incident**. Do not copy source findings into an incident-resolution section.
- [x] Write this five-tool mapping, with exact model fields, defaults, outputs, pagination and safe failure behavior; link the primary references below rather than a generic Google overview.

| Aurvin tool | Model arguments retained | REST execution and deliberate limits |
| --- | --- | --- |
| `calendar_list_calendars` | Optional `pageToken`; `{}` first page | `GET /users/me/calendarList` supplies a bounded authorized snapshot. Return existing entry `accessRole`/`primary`, limits, discovery timestamps and nullable `nextPageToken`. Aurvin model pages are at most 20; Google discovery pages are at most 100. Hidden/deleted excluded; this is the user's visible calendar list, not every accessible calendar. |
| `calendar_list_events` | Required `timeMin`, `timeMax`, `maxResults` 1–20; optional `calendarId`, `pageToken` | `GET /calendars/{calendarId}/events`; Aurvin requires offset timestamps, increasing interval of at most 31 days, recurring-instance expansion, start-time ordering and timed-event projection. Google bounds filter event end/start exclusively and ignore milliseconds; an empty page may still have a next token. All-day omissions set truncation; no availability guarantee. |
| `calendar_get_event` | Required `eventId`; optional `calendarId` | `GET /calendars/{calendarId}/events/{eventId}` using Google event ID, not iCalUID. Timed-event subset and private-detail masking only; sparse cancelled/all-day shapes are explicitly unsupported, not proof of absence. |
| `calendar_create_event` | Required `summary`, `start`, `end`, `timeZone`; optional `description`, `location`, `calendarId` | `POST /calendars/{calendarId}/events`; ordinary timed event after server intent/target authorization and fresh availability preflight. Server event ID/linkage, no model invitations or arbitrary REST fields. Keep `sendUpdates=none` without promising email suppression or external sync. Matching receipt/readback, not HTTP status alone, establishes confirmation. |
| `calendar_check_availability` | Required `timeMin`, `timeMax`, `timeZone`; optional unique 1–100 `calendarIds` | `POST /freeBusy`; increasing offset-timestamp range at most 31 days, discovery-authorized calendars, batches at most 50, opaque intervals, per-calendar errors and explicit incomplete coverage. Inclusive start/exclusive end; no working-hours or reservation guarantee. |

Sources: [CalendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [CalendarList resource](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList), [Events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Events.get](https://developers.google.com/workspace/calendar/api/v3/reference/events/get), [Events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [Freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), [errors](https://developers.google.com/workspace/calendar/api/guides/errors), [OAuth scopes](https://developers.google.com/workspace/calendar/api/auth). Checked during planning on 27 October 2026. Zod 3 strict/optional/refinement behavior was checked against [Zod 3 documentation](https://v3.zod.dev/); do not use Zod 4's `toJSONSchema` on installed Zod 3.

- [x] Record that omitted `calendarId` invokes Aurvin's explicit → saved default → primary resolution, not a universal REST default. Scope grants stay exactly the current `openid`, `email`, `calendar.calendarlist.readonly`, `calendar.events`, `calendar.freebusy`; capability and confirmed-write authority remain separate.
- [x] Record the chosen compatibility decisions **before** source work: no persistent shape/revision change; no tool/argument/result-key rename; no raw Google-token adoption; no `dataOwner` field or email comparison. `pageToken` and `nextPageToken` remain historical field names for an **opaque Aurvin continuation**, signed but not encrypted, scoped to account/query/discovery and process key, expiring within five minutes. A snapshot cursor resumes only retained entries, not omitted Google pages. Restart/refresh/expiry invalidation leads to a bounded fresh-first-page correction, not reinterpretation or weakened signature checks.
- [x] Explain REST selection: Google's [hosted MCP setup](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server) is Developer Preview with extra enrollment/configuration and broader tools; [list_calendars](https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/list_calendars) does not document `accessRole`, `primary` or `dataOwner`. No hosting/provisioning/scope change is selected.
- [x] Commit after named staging: `git add docs/calendar-visibility-simplification/contract-alignment.md docs/calendar-visibility-simplification/plan2.md`; `git commit -m "docs(calendar): freeze contract and compatibility boundaries"`. Keep index operations separate from other workers.

## Task 2: truthful catalogue, one structural parse and native parity (AC5, AC7)

**Files:** `calendar-tools.ts`, model validation/repair/policy files and their tests; new contract-parity and assembly-simplification specs from the ownership map.

TDD order: write both the small red tests and the full production-serialization regression below before applying any Task 2 green source edit. Run the new assembly test once against the baseline; catalogue presence may already pass, while the missing dispatch-kind/decision observations fail. Keep that distinction in the evidence rather than claiming every assertion reproduces the reported incident.

- [x] **Red:** add the following regressions to `backend/test/model/calendar-repair.spec.ts` (use its existing imports, or import `repairInstruction` and Vitest). The native catalogue must remain present; removing its duplicate from a system prompt is not removal of the actual tools.

```ts
it('uses native tools rather than copying a second schema catalogue into repair prose', () => {
  const instruction = repairInstruction([{ path: 'pageToken', code: 'invalid-value', expected: 'bounded-value' }]);
  expect(instruction).toContain('pageToken');
  expect(instruction).toContain('nextPageToken');
  expect(instruction).not.toContain('Allowed tool schemas:');
  expect(instruction).not.toContain('"inputSchema"');
});
```

Add a description regression to `calendar-contract-parity.spec.ts`:

```ts
import { expect, it } from 'vitest';
import { CALENDAR_TOOLS, calendarInputSchemas } from '../../src/contracts/calendar-tools.js';

it('describes an Aurvin continuation and qualified manager evidence, not a raw Google token', () => {
  const listing = CALENDAR_TOOLS.find(tool => tool.name === 'calendar_list_calendars')!;
  expect(listing.inputSchema.required).toEqual([]);
  expect(calendarInputSchemas.calendar_list_calendars.parse({})).toEqual({});
  expect(listing.description).toContain('Aurvin continuation');
  expect(listing.description).toContain('manager access');
  expect(listing.description).toContain('not proof of data ownership');
});
```

- [x] Run red from `backend`: `npm test -- test/model/calendar-repair.spec.ts test/contracts/calendar-contract-parity.spec.ts`. Expected: the old schema-dump/description assertions fail; existing `{}` acceptance is a passing characterization, not a manufactured red.
- [x] **Green:** replace only the five v2 descriptions in `definitionsV2` with the following strings; add `description` on each pagination property with the continuation text. Keep names, optional/required sets, structural constraints, result schemas, v1 catalogue and revision literals unchanged.

```ts
// calendar_list_events
'List timed events on one authorized calendar in a required offset-timestamp range of at most 31 days; maxResults is required, 1–20. calendarId omission uses the server default. Recurring instances are expanded; all-day omissions are marked truncated. Omit pageToken initially; otherwise copy the exact nextPageToken from this tool for the same query. It is an opaque Aurvin continuation, not a raw Google page token. An empty page can still have a continuation.'
// calendar_get_event
'Read one known timed event using its Google eventId, not iCalUID, on one authorized calendar. calendarId omission uses the server default. Private details may be masked; all-day and sparse cancelled events are unsupported.'
// calendar_create_event
'Create one ordinary timed event only after server authorization and availability preflight. Required: summary, offset start/end and IANA timeZone. calendarId omission uses the server default. No invitations, recurrence or unsupported fields. A confirmed receipt establishes creation; an uncertain outcome must not be repeated.'
// calendar_list_calendars
'List a bounded page from the connected user’s visible calendar list, with accessRole and primary evidence. Use {} for the first page. Otherwise copy the exact nextPageToken as pageToken: it is an opaque Aurvin continuation, not a raw Google page token. owner means manager access, not proof of data ownership. primary identifies the authenticated user’s primary calendar. Follow continuations before claiming the retained list is exhausted; complete describes discovery coverage, not remaining pages. Hidden/deleted entries and reported limitations prevent an exhaustive ownership claim.'
// calendar_check_availability
'Check Google opaque busy intervals for an increasing offset time range of at most 31 days and IANA timeZone on authorized calendars. Optional calendarIds is a unique set of 1–100 IDs; omission uses the discovered set. Results disclose per-calendar and incomplete coverage; clear is not a reservation or a working-hours guarantee.'
// Both pageToken properties:
'Omit for the first page. Otherwise copy the exact nextPageToken returned by this Aurvin tool for the unchanged query/account. This signed, sensitive Aurvin continuation expires on timeout, discovery change or restart; it is not a raw Google page token.'
```

Document existing string-length/UTF-8 ceilings and cross-field semantics rather than implying JSON Schema establishes authorization. Add a short description to bounded text parameters where needed to disclose that Aurvin additionally enforces existing UTF-16 string-unit and UTF-8 request/result budgets. Do not silently change Unicode acceptance in stored v2 schemas: JSON Schema character counts do not encode every Zod-3/byte-level constraint.

- [x] **Green:** remove the duplicate `calendarInputSchemas[name].safeParse` followed by `calendarCallSchema.safeParse` in `validateCalendarCandidate`. After the unchanged scanner/policy/date-only checks, use the single envelope parse below. Strip only the known `arguments` prefix before the existing repair mapper and P1 observer; preserve diagnostic bounds and return discriminants.

```ts
const validated = calendarCallSchema.safeParse({ name: call.name, arguments: parsed });
if (!validated.success) {
  const issues = validated.error.issues.map(issue => ({ ...issue,
    path: issue.path[0] === 'arguments' ? issue.path.slice(1) : issue.path,
  }));
  observeIssues(call, parsed, issues, limits, diagnostic);
  return rejected(fromZod(call.name, issues), batch, limits);
}
return { kind: 'valid', toolCallId: idSchema.parse(call.id), call: validated.data };
```

Keep the known-name guard and `calendarInputSchemas` import used by that guard. Retain the bounded native raw-JSON scanner: duplicate keys, forbidden fields, depth/byte limits and native-envelope checks are a different trust boundary from parsed execution. Retain executor semantic validation and binding validation for direct callers. Do not remove them because a model validator ran earlier.

- [x] **Green:** replace the schema dump suffix of `repairInstruction` with a short rule; keep normalized diagnostics and no denial bypass. The complete effect and return text are:

```ts
const diagnostics = JSON.stringify(repairDiagnosticsSchema.parse(input));
const effect = input.some(item => item.code === 'redundant-call')
  ? 'This rejected call was not executed. Its earlier successful result is already present; use that result instead of repeating it.'
  : 'This rejected decision performed no calendar write.';
return `Correct the previous invalid tool decision using the native tool definitions supplied on this request. Validation errors: ${diagnostics}. Preserve the user’s requested action, dates, times and authorized target. Do not invent missing user information; ask a concise clarification when it is genuinely missing. Invalid internal arguments are your mistake, not a request for the user to supply backend fields. Use only the native tool-call format, never Markdown or prose wrappers. For pageToken, omit it on the first page or copy the exact nextPageToken returned by that Aurvin tool for the same query; never invent a token. Do not change accounts or switch tools to bypass a denial. ${effect}`;
```

`CALENDAR_TOOLS` remains imported in this file for native-history validation. Update old tests that required `"additionalProperties":false` inside repair prose to assert it inside captured `body.tools[*].function.parameters`, retaining the matched prior successful tool-result assertion.

- [x] **Green AC9 metadata:** source inspection during planning found that the adapter emits model dispatch/response and validation facts, but does not yet populate the permitted `dispatchKind` field or emit the permitted `model-decision` stage. This is a bounded emission gap in the handed-over adapter, not evidence about the live incident and not a reason to change P1's projection. The native-capture regression below must first fail on that gap. Add this field to the adapter's existing `report` projection:

```ts
dispatchKind: ['initial', 'continuation', 'schema-repair'].includes(this.binding.dispatch.reason)
  ? this.binding.dispatch.reason : undefined,
```

For a provider-retry dispatch whose original category is not established, omit this optional field rather than inventing one. Immediately before returning each parsed result branch, emit its actual decision without content:

```ts
// assembly.finish(): text branch
report({ stage: 'model-decision', state: 'ok', decisionKind: 'text', origin: 'local', delivery: 'not-sent' });
// valid tool branch
report({ stage: 'model-decision', state: 'ok', decisionKind: 'tool', tool: result.call.name,
  toolCallId: result.toolCallId, origin: 'local', delivery: 'not-sent' });
// rejected branch
report({ stage: 'model-decision', state: 'rejected', decisionKind: 'rejected', origin: 'local', delivery: 'not-sent' });
// failure branch
report({ stage: 'model-decision', state: 'error', decisionKind: 'failure', code: result.failure.code,
  origin: 'local', delivery: 'not-sent' });
```

These are local interpretation events following an independently observed model response, not a claim that no model HTTP occurred. Use existing correlation, fingerprint and count fields already supplied by `report`; no new logger, diagnostic version or persistent field. Report this discovered gap and its verified correction in the handoff.

- [x] **Parity:** extend the existing `calendar-tools.spec.ts` loop rather than writing a general JSON Schema engine. For every one of the five native function definitions, assert exact names/properties/type, no extra properties, required/optional parity, string min/max, integer min/max/integrality, array member bounds/cardinality/uniqueItems. Probe missing, null, boolean, number, string, array and object at every property; include 0/1/20/21/1.5 `maxResults`, empty/2048/2049 cursors, duplicate calendar IDs and 1/100/101 array entries. Reject unknown and reserved fields on every tool. Use `z.ZodObject.shape`/`isOptional()` and `safeParse`, not private Zod internals or a new schema-conversion dependency. Keep `calendarInputSchemas` authoritative and make this mirror check required in routine tests.

The core probe addition inside that existing property loop is:

```ts
const wrongTypes = property.type === 'string' ? [null, true, 4, [], {}]
  : property.type === 'integer' ? [null, true, '1', [], {}, 1.5]
    : [null, true, 4, 'x', {}];
for (const value of wrongTypes) expect(shape[key]!.safeParse(value).success).toBe(false);
if (property.type === 'array') {
  const member = property.items as { minLength: number; maxLength: number; type: string };
  expect(member.type).toBe('string');
  expect(shape[key]!.safeParse(['']).success).toBe(false);
  expect(shape[key]!.safeParse(['x'.repeat(member.maxLength)]).success).toBe(true);
  expect(shape[key]!.safeParse(['x'.repeat(member.maxLength + 1)]).success).toBe(false);
  for (const value of [null, 4, {}, []]) expect(shape[key]!.safeParse([value]).success).toBe(false);
}
```

Record the semantic constraints that basic JSON Schema cannot prove: actual RFC3339 validity/order/window/zone consistency, path-safe IDs, string-unit/UTF-8 budgets, cursor MAC/scope/expiry, current capability, source provenance and create authority. Add explicit semantic test rows to existing validation suites; do not equate structural parity with their removal.

- [x] **Production serialization:** create `calendar-simplification.spec.ts` with the required file header and the following helper/test. These imports and helpers are also used by Task 4; they are local test conveniences, not production APIs.

```ts
import { expect, it } from 'vitest';
import { CALENDAR_TOOLS } from '../../src/contracts/calendar-tools.js';
import { nativeFrame } from '../model/calendar-fixtures.js';
import { textWire } from '../runtime/calendar-runtime.fixture.js';
import { assembledCalendarApp } from './calendar-fixture.js';

type Assembly = Awaited<ReturnType<typeof assembledCalendarApp>>;
function toolWire(name: string, args = '{}', id = 'call_1'): string {
  return nativeFrame({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function',
    function: { name, arguments: args } }] }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}
async function execute(h: Assembly, question = 'What calendars do I own?') {
  const runtime = h.service.operations.runtime;
  const ids = await runtime.submitTurn({ identity: { userId: 'aurvin-dev-user',
    openRouterUser: 'aurvin-dev-user', source: 'server-configured' }, sessionId: null,
    content: question, idempotencyKey: 'calendar-contract-0001' });
  const frames: unknown[] = [];
  await runtime.executeTurn({ userId: 'aurvin-dev-user', ...ids, signal: new AbortController().signal,
    emit: async frame => { frames.push(frame); }, emitCalendar: async frame => { frames.push(frame); } });
  return { ids, frames };
}
it('serializes identical truthful native contracts on initial correction and continuation requests', async () => {
  const lines: string[] = [];
  const h = await assembledCalendarApp({ writeLog: line => { lines.push(line); } });
  try {
    h.cal.modelWires.push(toolWire('calendar_list_calendars', '{"pageToken":null}'),
      toolWire('calendar_list_calendars'), textWire('Fixture-qualified answer.'));
    await execute(h);
    expect(h.cal.modelBodies).toHaveLength(3);
    const expected = CALENDAR_TOOLS.map(tool => ({ type: 'function', function: {
      name: tool.name, description: tool.description, parameters: tool.inputSchema,
    } }));
    for (const body of h.cal.modelBodies) {
      expect(body.tools).toEqual(expected);
      expect(body.user).toBe('aurvin-dev-user');
      expect(body).toMatchObject({ provider: { data_collection: 'deny', require_parameters: true } });
      expect(JSON.stringify(body.tools)).not.toContain('accessToken');
    }
    const records = lines.map(line => JSON.parse(line));
    expect(records.filter(record => record.stage === 'model-dispatch').map(record => record.dispatchKind))
      .toEqual(['initial', 'schema-repair', 'continuation']);
    expect(records).toContainEqual(expect.objectContaining({ stage: 'model-decision', decisionKind: 'tool',
      tool: 'calendar_list_calendars' }));
    const repaired = h.cal.modelBodies[1]!.messages as Array<{ role: string; content?: string }>;
    expect(repaired.at(-1)?.content).toContain('pageToken');
    expect(repaired.at(-1)?.content).not.toContain('"inputSchema"');
    const continuation = h.cal.modelBodies[2]!.messages as Array<{ role: string }>;
    expect(continuation.filter(message => message.role === 'tool')).toHaveLength(1);
    expect(continuation.filter(message => message.role === 'user')).toHaveLength(1);
  } finally { await h.dispose(); }
});
```

Read the **actual fetch bodies**, not only `CalendarDecisionRequest` or `buildCalendarBody` unit results. Include equality of each emitted parameter schema with the structural parity-checked mirror. This fixture uses the real AppService/runtime/adapter/scanner/serializer with a fake external fetcher, not a replacement model port. Tool definitions must be present even on the final continuation that returns text. Test forged/mutated/missing tool definitions at `buildCalendarBody` where applicable; do not change its supported explicit text-only `tools: []` helper contract just to force a universal catalogue.

- [x] Run green: `npm test -- test/contracts/calendar-tools.spec.ts test/contracts/calendar-multi-tools.spec.ts test/contracts/calendar-contract-parity.spec.ts test/model/calendar-validation.spec.ts test/model/calendar-repair.spec.ts test/model/calendar-policy.spec.ts test/model/calendar-adapter.spec.ts test/model/calendar-repair-flow.spec.ts test/assembly/calendar-simplification.spec.ts`.
- [x] Commit named changes: `git commit -m "refactor(calendar): align native tool contracts and bounded feedback"`. Record red and green results in `contract-alignment.md`; update fingerprint expectations only to the hash of the actual changed static catalogue.

## Task 3: direct execution without deleting its safety boundary (AC8)

**Files:** `tools.ts`, assembly/AppService, direct-plugin fixtures/tests, all retired-MCP callers and tests in the ownership map. Do not create a replacement plugin or generic execution framework.

- [x] **Red:** expose the existing `CalendarApi` instance as `api` in `multiToolsFixture` by assigning its current constructor expression to `const api` and returning that same instance. Add `vi` to imports in `tools-multi.spec.ts` and append:

```ts
it('binds the direct result to the requested event even when an adapter returns a valid wrong event', async () => {
  const f = multiToolsFixture({ operation: null, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } }, steps: [] });
  vi.spyOn(f.api, 'get').mockResolvedValue({ headers: new Headers(), fetchedAt: f.input.binding.trustedNow,
    result: { schemaVersion: 2, tool: 'calendar_get_event', target: {
      calendarId: f.input.binding.target!.calendarId, calendarLabel: f.input.binding.target!.calendarLabel,
      discoveryRevision: f.input.binding.target!.discoveryRevision, privateAccess: f.input.binding.target!.privateAccess,
    }, event: { eventId: 'different-event', summary: 'Fixture', start: '2026-11-03T10:00:00Z',
      end: '2026-11-03T11:00:00Z', timeZone: 'Etc/UTC', status: 'confirmed', htmlLink: null } } });
  try {
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: {
      code: 'CALENDAR_RESPONSE_INVALID', retry: 'none' } });
  } finally { await f.tools.close(); }
});
```

This injects at the real adapter seam, not a fake success outside the executor. Port the existing MCP source/tool/receipt/target/availability tamper cases to this seam, with the exact same expected business failures. For create, malformed output after dispatch remains `WRITE_OUTCOME_UNKNOWN/readback`, never a fresh POST or a definite noncreation.

- [x] Run red: `npm test -- test/plugins/google-calendar/tools-multi.spec.ts -t "binds the direct result"`. Expected: the current direct executor accepts the wrong event; the wrapper previously supplied that check. If this already passes after an upstream change, report it as characterization and find the remaining unrelocated check rather than weakening the assertion.
- [x] **Green:** consolidate the semantic portion of `decodeCalendarExecution` into a private `CalendarApiTools` success-validation method called from `buildSuccessV2` and the list/availability result return sites. Reuse `calendarExecutionEnvelopeV2Schema`; do not copy MCP content/error flag parsing. Its complete check set is expressed below. `target` and `expectedIds` are trusted values already resolved in that executor branch, not read back from the result.

```ts
private checkedSuccessV2(binding: CalendarExecutionBindingV2, call: CalendarCall,
  target: CalendarResolvedTarget | null, expectedIds: readonly string[],
  value: unknown): CalendarExecutionResultV2 {
  const invalid = (): never => { throw call.name === 'calendar_create_event'
    ? toolFault('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback')
    : toolFault('delivery', 'CALENDAR_RESPONSE_INVALID'); };
  let bytes: number;
  try { bytes = jsonBytes({ content: [], structuredContent: value }); }
  catch { return invalid(); }
  if (bytes > this.limits.resultBytes) {
    throw call.name === 'calendar_create_event' ? toolFault('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback')
      : toolFault('delivery', 'CALENDAR_RESULT_TOO_LARGE');
  }
  const parsed = calendarExecutionEnvelopeV2Schema.safeParse(value);
  if (!parsed.success || parsed.data.outcome !== 'success') return invalid();
  const envelope = parsed.data;
  const { result, source, receipt } = envelope;
  if (result.tool !== call.name || source.connectionId !== binding.connectionId
    || source.connectionRevision !== binding.connectionRevision
    || !source.toolCallIds.includes(binding.toolCallId)) return invalid();
  const ids = source.targets.map(item => item.calendarId).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...expectedIds].sort())) return invalid();
  if ('target' in result) {
    if (!target || result.target.calendarId !== target.calendarId
      || result.target.calendarLabel !== target.calendarLabel
      || result.target.discoveryRevision !== target.discoveryRevision
      || result.target.privateAccess !== target.privateAccess) return invalid();
  }
  if (result.tool === 'calendar_get_event' && call.name === 'calendar_get_event'
    && result.event.eventId !== call.arguments.eventId) return invalid();
  if (result.tool === 'calendar_create_event') {
    const operation = binding.operation;
    if (!target || !operation || !receipt || result.event.eventId !== operation.googleEventId
      || !source.operationIds.includes(operation.operationId)
      || receipt.operationId !== operation.operationId || receipt.googleEventId !== operation.googleEventId
      || receipt.requestHash !== operation.requestHash || receipt.connectionId !== binding.connectionId
      || receipt.connectionRevision !== binding.connectionRevision || receipt.targetRevision !== target.targetRevision
      || receipt.calendarId !== target.calendarId
      || (receipt.calendarLabel !== null && receipt.calendarLabel !== target.calendarLabel)) return invalid();
  } else if (receipt !== null) return invalid();
  if (result.tool === 'calendar_list_calendars'
    && result.calendars.some(item => !expectedIds.includes(item.calendarId))) return invalid();
  if (result.tool === 'calendar_check_availability') {
    if (result.connectionId !== binding.connectionId || result.connectionRevision !== binding.connectionRevision
      || result.calendarSetHash !== sha256(JSON.stringify(ids))
      || result.calendars.some(item => !expectedIds.includes(item.calendarId))) return invalid();
    if (result.coverage === 'complete' && result.calendars.length !== expectedIds.length) return invalid();
    if (result.coverage !== 'complete' && (!result.limitations.length
      || result.conflict === 'clear' || result.free.length > 0)) return invalid();
  }
  return envelope;
}
```

At event return sites pass `(binding, call, target, [target.calendarId], envelope)`; at list return pass `(binding, call, null, pageEntries.map(entry => entry.calendarId), envelope)`; at availability return pass `(binding, call, null, calendarIds, envelope)`. The existing schema also enforces result/source revisions, matching source labels and receipt shape; do not replace it with TypeScript casts. The historical encoded-envelope byte ceiling above is deliberately retained even though no protocol round trip remains. Do not enlarge existing output budgets in this refactor. Known `CalendarToolFault` failures keep their exact category/retry; unexpected exceptions at/after the create adapter invocation stay uncertain. Pre-dispatch validation/permission/admission failures must remain not-sent; do not classify all create failures as uncertain merely because the selected tool was create.

`buildSuccessV2` currently parses `response.result` before building an envelope. Wrap that existing parse (and any post-response source/receipt construction failure) with the same known-fault-preserving read-invalid/create-uncertain mapping so a Zod exception cannot escape through `toFailure` as an incorrect policy denial. Keep its existing result/headroom check unless exact-envelope tests prove an equivalent bound; do not return an unchecked adapter result to avoid the early parse. In the create callback, distinguish known pre-dispatch `CalendarToolFault` failures from unexpected exceptions once the actual create adapter has been entered. P1's HTTP seam remains the only source of actual external-delivery facts.

- [x] **Red lifecycle:** move the blocked-read, blocked-POST, shorter deadline, cancellation, repeated invocation and revocation-during-credential/admission cases into `tools-boundaries.spec.ts`, using `multiToolsFixture` and its existing fail-closed fetcher. Add the following direct-executor contract to those tests: `activeExecutions` is 1 while `invoke`/`readback` waits, returns to 0 after settlement, and remains nonzero if a dependency ignores abort beyond drain expiry. `close()` is idempotent, aborts in-flight work, refuses subsequent invokes and never declares a dispatched create definitely absent. Use controlled promises or the existing finite blocked-stream fixture, not sleeps to guess when a request started. Run `npm test -- test/plugins/google-calendar/tools-boundaries.spec.ts`; expected red is absent active-work accounting/early close, not a missing import.

This first direct lifecycle check supplies a concrete no-sleep red (imports are `expect`, `it`, `multiToolsFixture`, `googleJson`, `googleEvent` from their existing modules):

```ts
it('counts active direct work until settlement and refuses later work after close', async () => {
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const f = multiToolsFixture({ operation: null, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } }, steps: [{
    method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234',
    response: async () => { started(); await resume; return googleJson(googleEvent()); },
  }] });
  const pending = f.tools.invoke(f.input);
  try {
    await entered;
    expect(f.tools.activeExecutions).toBe(1);
    const closing = f.tools.close();
    release();
    await pending;
    await closing;
    expect(f.tools.activeExecutions).toBe(0);
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure' });
    expect(f.requests).toHaveLength(1);
    await f.tools.close();
  } finally { release(); await pending; await f.tools.close(); }
});
```
- [x] **Green lifecycle:** track existing invoke/readback promises in the same tools instance; no second execution wrapper. Add these class members/methods and enclose each existing implementation body after its closed guard in `return this.track(async () => {` and the matching `});`, leaving its public overloads and internal logic intact. Both paths must register before their first `await` and remove the pending marker in `finally`; no extra private execution-method split is needed.

```ts
private readonly pending = new Set<Promise<void>>();
private closePromise: Promise<void> | null = null;
get activeExecutions(): number { return this.pending.size; }
private track<T>(work: () => Promise<T>): Promise<T> {
  let settle!: () => void;
  const done = new Promise<void>(resolve => { settle = resolve; });
  this.pending.add(done);
  return (async () => {
    try { return await work(); }
    finally { this.pending.delete(done); settle(); }
  })();
}
async close(): Promise<void> {
  if (this.closePromise) return this.closePromise;
  this.closed = true;
  this.closing.abort();
  this.closePromise = (async () => {
    let timer: NodeJS.Timeout | undefined;
    const expiry = new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); timer.unref?.(); });
    try { await Promise.race([Promise.allSettled([...this.pending]), expiry]); }
    finally { if (timer) clearTimeout(timer); }
  })();
  return this.closePromise;
}
```

Keep the existing closing/deadline signals in REST/discovery/credential work. Never remove a marker because drain timed out; `activeExecutions > 0` must keep AppService from releasing persistence. Count readback as well as model invocations. If a closed guard is moved to a wrapper, preserve invoke's failure versus readback's `unknown` result, including legacy read-only behavior. No external work, retry or business callback may run twice due to tracking/logging.

- [x] **Wire direct:** replace the assembly's wrapper construction with `const execution = tools;`. In `AppService`, change the Calendar execution type/import from `EmbeddedCalendarExecution` to `CalendarApiTools` (or `ReturnType<typeof createCalendarAssembly>['execution']`) and read `activeExecutions` in `drainCalendar`. Keep the one existing `stopCalendar`/drain order, diagnostic injection, current-account checks and persistence-close owner. Runtime fixtures must use the same tools instance directly, preserving effect records and failure injectors; availability primary canonicalization already exists in `tools.ts` and must be tested there. Event reads retain canonical server resolution; saved create/readback keeps its original target, never the current default.

```ts
// calendar-assembly.ts: replace wrapper construction only.
const execution = tools;
// app.service.ts: existing drainCalendar after execution.close().
const active = this.calendarExecution.activeExecutions;
```

- [x] **Migrate callers and coverage:** run the exact caller audit below from repository root, then port every owned reference using the retirement map. Tests must invoke `f.tools.invoke(f.input)` or `readback` with the real bound input; replace `client.callTool(...)` by that call and `structuredContent` assertions by direct envelope assertions. Do not introduce a fake client/listTools implementation. Rename `embedded-mcp.spec.ts` to `calendar-execution.spec.ts`; remove wire-only tests after business assertions have replacements. Move exact 16,384/16,385-byte and malformed-source/receipt tests into `calendar-multi-operations.spec.ts`/`tools-boundaries.spec.ts`, maintaining multibyte cases and lower configured caps.

```powershell
rg -n 'EmbeddedCalendarExecution|createCalendarMcpHandler|withSdk|calendarCatalogue|assertCalendarCatalogue|calendar-mcp-schema|CALENDAR_MCP_WIRE|CALENDAR_MCP_ENDPOINT|openChannels|@modelcontextprotocol' backend/src backend/test
```

Expected after migration/deletion: no executable-source/test references; historical documentation and the explicit dependency-absence check can mention retired names. Delete only the exact retired files listed above. Remove retired catalogue-only blocks from `tools-validation.spec.ts`, preserving every validator test. Preserve all previously read-only v1 decoders and uncertain-operation dispositions; no new v1 execution/authority branch.

- [x] Remove only `@modelcontextprotocol/client` and `@modelcontextprotocol/server` from `backend/package.json`. From `backend`, run `npm install --package-lock-only --ignore-scripts --offline` to prune the lock without lifecycle scripts or provider calls, then inspect the lock diff. If offline resolution is unavailable, stop and report the dependency-cleanup gate; do not broaden network authorization or regenerate unrelated versions. No `googleapis`, schema converter or plugin dependency is added. Update the package test to assert unchanged Node engine/Zod and absent retired direct SDK dependencies rather than frozen SDK versions.
- [x] Run green from `backend`: `npm test -- test/plugins/google-calendar test/plugins/integration test/contracts/calendar-multi-operations.spec.ts test/contracts/calendar-contract-parity.spec.ts test/assembly/calendar-flow.spec.ts test/assembly/calendar-multi-flow.spec.ts test/integration/plugins/multi-calendar/accounting-recovery.spec.ts test/operations/calendar-shutdown.spec.ts`.
- [x] Commit source/test/manifest deletions and named replacements only: `git commit -m "refactor(calendar): execute REST tools without embedded MCP"`. Record each retained check's concrete boundary and each removed protocol-only assertion in `contract-alignment.md` before this commit. Reduced duplicate checks must not reduce required request debits, authorization or recovery evidence.

## Task 4: real first-page/pagination and honest ownership evidence (AC6)

**Files:** `system.md`, `calendar-discovery-api.ts` and its spec; `calendar-simplification.spec.ts`, existing cursor/tools tests. No new result or discovery field.

- [x] **Red documentation-contract regression:** add this test to `calendar-discovery-api.spec.ts`, using its existing imports/helpers. This is a deterministic fields-mask test, **not** proof that the old live incident had an empty masked response.

```ts
it('requests the collection kind needed to validate an empty CalendarList response', async () => {
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ kind: 'calendar#calendarList' }) }]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput());
  const fields = new URL(fake.requests[0]!.url).searchParams.get('fields')!;
  expect(fields.split(',')[0]).toBe('kind');
  expect(result).toMatchObject({ entries: [], complete: false, limitations: ['primary-missing'] });
  expect(new URL(fake.requests[0]!.url).searchParams.has('pageToken')).toBe(false);
});
```

- [x] Run red: `npm test -- test/plugins/google-calendar/calendar-discovery-api.spec.ts -t "collection kind"`; expected failure is the outgoing fields mask. **Green:** change its sole discovery query field selection to:

```ts
fields: 'kind,nextPageToken,items(id,summary,summaryOverride,primary,accessRole,timeZone,selected,hidden,deleted)'
```

Keep rejection of arbitrary `{}`, non-array/null `items`, malformed/looped tokens, unsupported entry shapes and later-page failure flags. Do not accept arbitrary provider objects as an empty successful list. Existing provider-pagination tests separately prove raw Google `nextPageToken` is sent only to the next REST request and is never substituted for an Aurvin cursor.

- [x] **Test setup:** the existing assembly fixture uses synthetic fixed assets, so a test using it unmodified cannot verify changes to the real system instruction. Import `loadFixedAssets` from `../../src/instructions/fixed-assets.js` in `calendar-fixture.ts`, add `realAssets?: boolean` to `AssembledCalendarInit`, and apply this override before `AppService.create`:

```ts
if (init.realAssets) f.ports.assets = () => loadFixedAssets({
  instructions: 'src/instructions/system.md', knowledge: '../product_knowledge.md',
});
```

Use `{ realAssets: true }` only in the ownership/built acceptance rows; keep existing unrelated fixtures unchanged. This reads bounded checkout assets only, not `.env`, credentials or a database.

- [x] **Red production ownership gate:** add an assertion in the production-body listing test that the actual system messages contain the phrases `manager access` and `not proof of data ownership`. Run `npm test -- test/assembly/calendar-simplification.spec.ts -t "qualified roles"` before changing the instruction; expected failure is the absent ownership qualification in the actual asset-fed request, not the fixture seed. **Green:** add the following single paragraph beside the existing Calendar policy in `backend/src/instructions/system.md`, not a separate prompt framework:

```text
For calendar ownership questions, distinguish evidence from inference. CalendarList accessRole "owner" means manager access, not proof of data ownership; "primary" identifies the authenticated user's primary calendar. Describe other roles as shared access, and do not infer secondary-calendar data ownership from a role, label, calendar ID or email spelling. This tool does not return secondary data-owner proof. State that limitation when asked what the user owns. Follow returned continuations before claiming the retained list is exhausted, and qualify hidden/deleted exclusions and incomplete or truncated discovery. Do not call the result a complete inventory of every calendar the account owns or can access.
```

- [x] **Production first page + returned continuation:** append the following test to `calendar-simplification.spec.ts`, importing `effectiveCalendarCapabilities` from `../../src/contracts/calendar-discovery.js`. It seeds only the in-memory fixture store, drives the real model fetch serializer and copies the actual cursor from the preceding serialized tool result. No token is manufactured or fetched from a real account.

```ts
it('accepts {} and a returned Aurvin continuation through production assembly with qualified roles', async () => {
  const h = await assembledCalendarApp({ realAssets: true });
  const original = h.fetcher.getMockImplementation()!;
  const pages: Array<{ calendars: Array<{ calendarId: string; accessRole: string; primary: boolean }>;
    nextPageToken: string | null }> = [];
  let dispatch = 0;
  try {
    const current = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
    if (!current || current.schemaVersion !== 2 || !current.discovery) throw new Error('Missing fixture discovery');
    const base = current.discovery.entries[0]!;
    const entries = Array.from({ length: 21 }, (_, index) => {
      const role = index === 2 ? 'writer' as const : index === 3 ? 'reader' as const : 'owner' as const;
      return { ...base, calendarId: index === 0 ? 'owned' : index === 1 ? 'managed-secondary' : `cal-${index}`,
        label: index === 0 ? 'Primary' : index === 1 ? 'Managed secondary' : `Calendar ${index}`,
        primary: index === 0, accessRole: role, privateAccess: role !== 'reader',
        capabilities: effectiveCalendarCapabilities(role, current.grantedScopes, true) };
    });
    const saved = await h.cal.p.calendarConnectionsV2.compareAndSwap({ userId: current.userId,
      expectedRevision: current.revision, expectedConnectionRevision: current.connectionRevision,
      expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
      next: { ...current, revision: current.revision + 1, discovery: {
        ...current.discovery, discoveryRevision: current.discovery.discoveryRevision + 1, entries } } });
    expect(saved.outcome).toBe('confirmed');
    h.fetcher.mockImplementation(async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.origin !== 'https://openrouter.ai' || parsed.pathname !== '/api/v1/chat/completions') {
        return original(url, init);
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      h.cal.modelBodies.push(body);
      const messages = body.messages as Array<{ role: string; content: string }>;
      const result = messages.filter(message => message.role === 'tool').at(-1);
      if (result) pages.push(JSON.parse(result.content));
      dispatch += 1;
      let wire: string;
      if (dispatch === 1) wire = toolWire('calendar_list_calendars', '{}', 'page-one');
      else if (dispatch === 2) {
        expect(pages[0]!.nextPageToken).toEqual(expect.any(String));
        wire = toolWire('calendar_list_calendars', JSON.stringify({ pageToken: pages[0]!.nextPageToken }), 'page-two');
      } else if (dispatch === 3) wire = textWire('Primary is your primary calendar. Managed secondary grants manager access; I cannot establish its data ownership. This covers the visible retained list only.');
      else throw new Error('Unbounded fixture dispatch');
      return new Response(wire.replaceAll('gen_fixture', `gen_pagination_${dispatch}`), {
        headers: { 'content-type': 'text/event-stream' } });
    });
    const { ids } = await execute(h);
    expect(dispatch).toBe(3);
    expect(pages.map(page => page.calendars.length)).toEqual([20, 1]);
    expect(pages[1]!.nextPageToken).toBeNull();
    const calendars = pages.flatMap(page => page.calendars);
    expect(new Set(calendars.map(calendar => calendar.calendarId)).size).toBe(21);
    expect(calendars).toContainEqual(expect.objectContaining({ calendarId: 'managed-secondary', accessRole: 'owner', primary: false }));
    expect(calendars).toContainEqual(expect.objectContaining({ calendarId: 'owned', primary: true }));
    const system = (h.cal.modelBodies[0]!.messages as Array<{ role: string; content: string }>)
      .filter(message => message.role === 'system').map(message => message.content).join('\n');
    expect(system).toContain('manager access');
    expect(system).toContain('not proof of data ownership');
    expect(h.fetcher.mock.calls.filter(([url]) => new URL(String(url)).origin === 'https://www.googleapis.com')).toHaveLength(0);
    expect(await h.cal.p.metadata.getAttempt('aurvin-dev-user', ids.sessionId, ids.attemptId)).toMatchObject({ status: 'completed' });
    expect(await h.cal.p.calendarAccountingV2.getBudget('aurvin-dev-user', ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 0, logicalTools: 2 });
  } finally { await h.dispose(); }
});
```

The scripted final text proves publication and context integrity, **not** selected-model ownership reasoning. Inspect the tool groups and actual system instructions; record that limitation. Add a discovery-fixture row with a secondary `accessRole: owner` and foreign `dataOwner` to prove extra provider fields are not ingested, persisted, logged or converted into `owned: true`. Add missing-primary, missing-data-owner and writer/reader rows. Do not create an ownership boolean, normalize account emails or expose new PII to satisfy a test.

- [x] Add production-assembly rows for incomplete/capped/hidden-filtered discovery and byte-shrunk pages: returned role evidence and `complete/truncated/limitations` survive, and the native context cannot represent a local continuation as resuming omitted Google pages. Preserve no-empty-nonadvancing-page failure and handle an empty page with a real provider continuation in the REST adapter. Retain cursor tests for format, signature, account, target, query, discovery revision, process-key restart and authenticated expiry; assert exact P1 safe reasons and no raw cursor/token in logs.
- [x] Run green: `npm test -- test/assembly/calendar-simplification.spec.ts test/plugins/google-calendar/calendar-discovery-api.spec.ts test/plugins/google-calendar/calendar-api-cursor.spec.ts test/plugins/google-calendar/tools-multi.spec.ts test/plugins/google-calendar/calendar-api.spec.ts`.
- [x] Commit named changes: `git commit -m "fix(calendar): qualify ownership evidence and verify continuations"`.

**Acceptance conflict, not a waiver:** AC6 can be satisfied only as an accurate, evidence-qualified response under this no-new-shape design: identify the authenticated primary, describe manager/shared roles and state secondary ownership uncertainty. A definitive exhaustive list of secondary calendars' data owners is not established by current fields. If the acceptance owner requires that stronger outcome, stop and escalate; do not mark AC6/live resolution passed, silently relabel manager access as ownership, or add a persistent `dataOwner` contract without an approved compatibility/privacy strategy. The accepted goal is not relaxed by this plan.

## Task 5: one finite correction transition and semantic duplicate suppression (AC7, AC8)

**Files:** `calendar-loop.ts`, feedback/answer/model-repair tests. Keep the existing ledger and repair diagnostic vocabulary.

- [x] **Red:** add the following to `calendar-feedback.spec.ts` (its helpers/imports already exist). The two final JSON strings differ only in property order; comparing serialized strings must not cause a second execution.

```ts
it('suppresses the same read when JSON property order differs', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(nativeWire('{"calendarId":"personal@example.test","eventId":"abcde"}'),
      nativeWire('{"eventId":"abcde","calendarId":"personal@example.test"}'), textWire('Found once.'));
    await h.execute(ids);
    expect(h.effects.filter(effect => effect.kind === 'get')).toHaveLength(1);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 1, logicalTools: 1 });
    const repaired = h.modelBodies[2]!.messages as Array<{ role: string; content: string }>;
    expect(repaired.filter(message => message.role === 'tool')).toHaveLength(1);
    expect(repaired.at(-1)?.content).toContain('redundant-call');
  } finally { await h.dispose(); }
});

it('seals bounded malformed-argument exhaustion like a cursor failure without blaming user input', async () => {
  const trace = processDiagnosticCapture();
  const h = calendarFixture(trace.diagnostics);
  try {
    const ids = await h.submit('What calendars do I own?');
    h.modelWires.push(listWire('{'), listWire('{'), listWire('{'));
    await h.execute(ids);
    expect(h.modelBodies).toHaveLength(3);
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId);
    expect(messages.items.filter(message => message.role === 'assistant').at(-1)?.content).toContain('my tool calls');
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 2, creates: 0, logicalTools: 0 });
    expect(trace.records()).toContainEqual(expect.objectContaining({ stage: 'correction',
      reason: 'budget-exhausted', correctionAttempt: 2, correctionLimit: 2 }));
    expect(trace.records()).toContainEqual(expect.objectContaining({ stage: 'task-outcome', task: 'fallback' }));
  } finally { await h.dispose(); }
});
```

The runtime fixture's canonical primary is `personal@example.test`; the separate AppService assembly fixture renames its primary to `owned`. Do not conflate them or change production defaults. Run red: `npm test -- test/runtime/calendar-feedback.spec.ts -t "property order|malformed-argument exhaustion"`. Expected: second read/current structural-exhaustion path, not an unrelated unknown-target failure.

- [x] **Green duplicate comparison:** use Node `isDeepStrictEqual`, not a new hash store or fuzzy matcher. The local helper is:

```ts
import { isDeepStrictEqual } from 'node:util';

function sameCalendarCall(left: CalendarCall, right: CalendarCall): boolean {
  if (left.name !== right.name) return false;
  const normalize = (call: CalendarCall) => call.name === 'calendar_check_availability' && call.arguments.calendarIds
    ? { ...call.arguments, calendarIds: [...call.arguments.calendarIds].sort() } : call.arguments;
  return isDeepStrictEqual(normalize(left), normalize(right));
}
```

Import `calendarCallSchema` from the existing tools contract. Replace the existing duplicate predicate/branch after the unchanged `prior` slice with:

```ts
const duplicate = prior.some(group => {
  const previous = group.assistant.tool_calls[0].function;
  let args: unknown;
  try { args = JSON.parse(previous.arguments); }
  catch { throw new AppError('INVALID_REQUEST', 'Calendar tool results are incomplete.', false); }
  const parsed = calendarCallSchema.safeParse({ name: previous.name, arguments: args });
  if (!parsed.success) throw new AppError('INVALID_REQUEST', 'Calendar tool results are incomplete.', false);
  return sameCalendarCall(parsed.data, decision.call);
});
if ((decision.call.name === 'calendar_create_event' && this.lastOperationId !== null) || duplicate) {
  const current = await this.ctx.ledger.ensureBudget();
  diagnose(this.ctx.diagnostics?.emit, { stage: 'validation', state: 'rejected', reason: 'duplicate-call',
    field: 'tool_calls', expected: 'one-call', constraint: 'one-call', origin: 'local', delivery: 'not-sent',
    decisionId: decision.decisionId, toolCallId: decision.toolCallId, tool: decision.call.name,
    correctionAttempt: current.repairs, correctionLimit: this.ctx.limits.repairs });
  return this.correctToolCall(input, decision, [{ path: 'tool_calls', code: 'redundant-call', expected: 'one-call' }]);
}
```

Prior groups have already passed native-history validation; malformed historical JSON still fails closed rather than causing re-execution. Keep the existing slice after the last confirmed create and the at-most-one-create condition. Do not collapse different cursors/ranges/IDs/default omission/queries or infer equivalence from timestamps or labels. The scan is bounded by `limits.logicalTools`; do not introduce an unbounded cross-turn cache.

- [x] **Green correction:** factor the existing budget/feedback/cursor transition into this private method. `correctToolCall` still durably saves its rejection evidence first, then delegates with its decision ID/diagnostics. The structural-rejection branch in `decide` still saves the adapter's original rejected evidence, then delegates to the same method instead of throwing `PROVIDER_ERROR` at the ceiling. Remove its separate premature `repairing` event.

```ts
private async repairOrSeal(input: GraphInput, decisionId: string,
  diagnostics: CalendarRepairDiagnostics): Promise<CalendarGraphPatch> {
  const budget = await this.ctx.ledger.ensureBudget();
  this.setTask('fallback');
  if (budget.repairs >= this.ctx.limits.repairs) {
    diagnose(this.ctx.diagnostics?.emit, { stage: 'correction', state: 'rejected',
      reason: 'budget-exhausted', code: 'REPAIR_EXHAUSTED', origin: 'local', delivery: 'not-sent',
      correctionAttempt: budget.repairs, correctionLimit: this.ctx.limits.repairs });
    return this.answerAndSeal(input,
      'I could not complete the calendar request after correcting my tool calls. You do not need to change your question. Please try again.', decisionId);
  }
  diagnose(this.ctx.diagnostics?.emit, { stage: 'correction', state: 'rejected',
    origin: 'local', delivery: 'not-sent', correctionAttempt: budget.repairs,
    correctionLimit: this.ctx.limits.repairs });
  await this.emit({ type: 'calendar-progress', phase: 'repairing' });
  this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'decide', pendingDecisionId: null,
    repair: { rejectedDecisionId: decisionId, diagnostics } });
  return { calendarCursor: this.cursor, calendarRefs: this.refs() };
}
```

Charge repairs only through existing `reserveDispatch('schema-repair', ...)`; this helper must not debit again, add retries or reset deadlines/spend. With current limit 2, there are at most 3 malformed decisions and no tool execution; a prior successful call plus two permitted repairs still obeys the overall dispatch/logical-tool budgets. Permission/credential denial does not enter this helper. Uncertain create stops at saved operation/readback, never correction or a new create.

- [x] Add/run the required neighboring rows in the same existing suites: distinct returned pages execute once each; changed range/calendar/event IDs execute independently; reordered availability ID set is redundant; read-after-confirmed-create executes freshly; second create uses the earlier confirmed receipt; prior successful tool groups survive correction without duplicating accepted input; zero configured repairs permits no correction; global model/argument/diagnostic/context/spend/deadline caps win before dispatch. Existing denial fixtures assert zero repair and no switch-tool bypass. Existing lost-response/409/mismatched-readback fixtures assert at most one POST and no new inference during recovery. Do not add a provider retry to make these tests pass.
- [x] Run green: `npm test -- test/runtime/calendar-feedback.spec.ts test/runtime/calendar-answer-regressions.spec.ts test/runtime/calendar-budget.spec.ts test/runtime/calendar-preflight.spec.ts test/runtime/calendar-recovery.spec.ts test/model/calendar-repair.spec.ts test/model/calendar-validation.spec.ts test/assembly/calendar-simplification.spec.ts`.
- [x] Commit named changes: `git commit -m "fix(calendar): bound repairs and suppress equivalent repeated reads"`.

## Task 6: compatibility and preserved guarantees (AC8, AC10)

**Files:** new compatibility spec, existing contract/persistence/context/runtime/plugin suites; update only `contract-alignment.md` unless a demonstrated defect is in P2-owned code. Do not modify stored schemas in place or access a database.

- [x] Freeze pre-P2 specimen objects in `calendar-simplification-compatibility.spec.ts` using the existing fixtures from `test/contracts/calendar-multi-fixtures.ts` and `test/persistence/calendar-fixtures.ts` / `calendar-multi-fixtures.ts`. Include v1/v2 accepted/rejected decisions, retained/reference results, completed/unknown operations and receipts, account/source revisions and checkpoint references. New specimens must contain only synthetic IDs/content. Parse, serialize, parse and assert equality through the actual current compatibility decoders and stores, not a replacement decoder.

The minimal read-only checkpoint/operation check uses existing exports and is runnable as written:

```ts
import { expect, it } from 'vitest';
import { compatibleCalendarOperationSchema, compatibleCalendarReceiptSchema,
  compatibleCalendarCheckpointRefsSchema, legacyOperationDisposition }
  from '../../src/contracts/calendar-compatibility.js';
import { operationV1, receiptV1, at } from './calendar-multi-fixtures.js';

it('keeps pre-simplification records readable without converting history into authority', () => {
  const saved = JSON.parse(JSON.stringify({ ...operationV1, state: 'unknown' }));
  const decoded = compatibleCalendarOperationSchema.parse(saved);
  expect(compatibleCalendarOperationSchema.parse(JSON.parse(JSON.stringify(decoded)))).toEqual(decoded);
  expect(legacyOperationDisposition(decoded, at)).toMatchObject({ externalOutcome: 'unknown', reconcileOriginal: true });
  expect(compatibleCalendarReceiptSchema.parse(JSON.parse(JSON.stringify(receiptV1)))).toEqual(receiptV1);
  const refs = { version: 1, userId: 'u', sessionId: 's', turnId: 't', decisionIds: ['d'],
    toolCallIds: ['call'], operationId: 'op' };
  expect(compatibleCalendarCheckpointRefsSchema.parse(JSON.parse(JSON.stringify(refs)))).toEqual(refs);
});
```

Existing tests cover many of these rows; extend them only where the simplification changes a seam. Passing this characterization alone does not certify two binaries against a service. Do not fabricate old-record values or delete old expectations to fit newly written output.

- [x] Run the explicit offline compatibility/safety battery, from `backend`:

```powershell
npm test -- test/contracts/calendar-multi-compatibility.spec.ts test/contracts/calendar-simplification-compatibility.spec.ts test/contracts/calendar-multi-operations.spec.ts test/persistence/calendar-records.spec.ts test/persistence/calendar-multi-evidence.spec.ts test/persistence/calendar-checkpoints.spec.ts test/persistence/calendar-retention.spec.ts test/persistence/calendar-multi-retention.spec.ts test/context/calendar-context.spec.ts
npm test -- test/runtime/calendar-authority.spec.ts test/runtime/calendar-intent.spec.ts test/runtime/calendar-preflight.spec.ts test/runtime/calendar-operation.spec.ts test/runtime/calendar-publication.spec.ts test/runtime/calendar-recovery.spec.ts test/runtime/calendar-multi-recovery.spec.ts test/runtime/calendar-multi-concurrency.spec.ts test/runtime/calendar-recovery-unavailable.spec.ts
npm test -- test/plugins/google-calendar/connection-refresh.spec.ts test/plugins/google-calendar/connection-capabilities.spec.ts test/plugins/google-calendar/tools-multi.spec.ts test/plugins/google-calendar/tools-boundaries.spec.ts test/plugins/google-calendar/calendar-api-http.spec.ts test/operations/calendar-privacy.spec.ts test/operations/calendar-shutdown.spec.ts test/operations/calendar-restart.spec.ts
```

Assertions required, not just file existence: server identity/OpenRouter `user` on every attempt; scope/capability intersection and account/credential-revision fences at effect admission; refusal before unconfirmed debits; accepted input saved before model; decision/result/source before continuation; bounded arguments/results/context/turn time/spend; volatile source non-retention and expired/redacted/account-mismatched source exclusion; unchanged UI archive/SSE ordering/terminal publication; stable event ID/immutable operation target; confirmation/preflight/one-create; no blind retry after lost response/409/unknown readback; source/result/receipt binding; cancellation and safe drain; saved-result finalization without new inference or POST. Unchanged test skip counts are not evidence those cases executed.

### Rollout/rollback strategy to record before implementation ships

1. No persistent migration: names, arguments, result keys, v1/v2 revision literals, strict record/checkpoint/cursor payloads and byte ceilings stay readable. Descriptions/repair prose change the content-independent catalogue fingerprint, not the persistent schema revision. Compare the baseline/current contract diff; any accepted new durable shape reopens this strategy before release.
2. Stop admission and drain the one executor before replacing the binary. Keep normal policy/connection settings and records. No overlapping processes. Preserve unresolved operations/receipts/checkpoints, existing sentinel and reconciliation rules. Do not introduce a destructive cleanup or use the application database as a fixture.
3. Completed/retained saved results finalize through existing recovery; never repeat model inference or writes to regenerate them. Pending v2 operations keep their original account/calendar/event ID; uncertainty uses existing readback or remains unknown. Old v1 records remain historical/read-only and do not gain executable authority.
4. Model-visible input field names remain unchanged, so old valid saved calls remain decodable. If a saved continuation is invalid after normal process-key restart, reject with a precise local cursor reason and restart the read at `{}` under the existing finite repair budget. Never treat an Aurvin cursor as a Google token or automatically retry a create. Expired old results are not re-exposed as current evidence.
5. New records use exactly the old shapes and must round-trip through the pre-P2-compatible decoder fixtures. Record the exact unchanged shape ranges and the new-record fixture results. This establishes structural fixture compatibility, not an actual old-binary/database rollback drill. Rollback uses a complete previous release with its own lockfile/dependencies, after admission/drain, not an old executable with the new pruned dependencies. If previous-binary acceptance is not independently established, mark rollback drill unrun and block unattended rollback rather than deleting new records.
6. Re-enable only the existing feature/configuration gate after offline verification and the operator's rollout approval. This plan does not authorize deployment or a live acceptance request.

- [x] Audit with `git diff 37f7618 -- backend/src/contracts backend/src/agent backend/src/persistence backend/src/context/calendar-context.ts`; expected durable decoder/schema implementation change is **none**, apart from the explicitly retired MCP-only schema/export and truthful tool descriptions. Document preserved schema ranges and all other differences. Unexpected durable changes block the compatibility claim.
- [x] Commit named test/doc changes: `git commit -m "test(calendar): preserve historical records and write recovery"`.

## Task 7: AC9, full offline verification and handoff

**Files:** `calendar-simplification.spec.ts`, `calendar-observability.spec.ts`, `contract-alignment.md`, this plan's ticks. P1 telemetry/redaction/diagnostic-port implementation remains unchanged.

- [x] **Built-application gate:** extend `AssembledCalendarInit` with `compiled?: boolean`. Inside `assembledCalendarApp`, select the actual built AppService and built DurableChatRuntime together when true; otherwise preserve the source constructors. The assertions below are fixture-only nominal-type bridges between the same source and emitted declarations, not a replacement execution implementation:

```ts
const Service = init.compiled
  ? (await import('../../dist/app.service.js')).AppService as unknown as typeof AppService : AppService;
const Runtime = init.compiled
  ? (await import('../../dist/chat-runtime/durable-chat-runtime.js')).DurableChatRuntime as unknown as typeof DurableChatRuntime
  : DurableChatRuntime;
// Replace only the existing fixture runtime/create constructor sites:
f.ports.runtime = vi.fn((d: RuntimeDependencies) => new Runtime({ ...d, now: cal.clock }));
const service = await Service.create(bootstrap, f.ports);
```

Do not leave the source `DurableChatRuntime` override active when claiming to test built execution. All opened persistence, provider fetch and model-limit ports still use the existing bounded in-memory/offline fixtures. Build must complete before invoking this option. Add `calendar-simplification.built.spec.ts` with the required header and this test; write it before the first fresh build of P2, verify that any stale built output fails the behavioral/catalogue assertions, then build and rerun. If no `dist` exists, build the baseline once rather than calling a missing module a meaningful red.

```ts
import { expect, it, vi } from 'vitest';
import { CALENDAR_TOOLS } from '../../src/contracts/calendar-tools.js';
import { assembledCalendarApp } from './calendar-fixture.js';
import { nativeFrame } from '../model/calendar-fixtures.js';
import { textWire } from '../runtime/calendar-runtime.fixture.js';

it('runs the built direct assembly with native initial repair continuation contracts and real assets', async () => {
  const { CalendarApiTools } = await import('../../dist/plugins/google-calendar/tools.js');
  const { CALENDAR_TOOLS: compiledTools } = await import('../../dist/contracts/calendar-tools.js');
  expect(compiledTools).toEqual(CALENDAR_TOOLS);
  const lines: string[] = [];
  const h = await assembledCalendarApp({ compiled: true, realAssets: true, writeLog: line => { lines.push(line); } });
  const call = (raw: string) => nativeFrame({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1',
    type: 'function', function: { name: 'calendar_list_calendars', arguments: raw } }] })
    + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
  try {
    const dependencies = vi.mocked(h.f.ports.runtime).mock.calls.at(-1)![0];
    expect(dependencies.calendar!.execution).toBeInstanceOf(CalendarApiTools);
    h.cal.modelWires.push(call('{"pageToken":"first"}'), call('{}'),
      textWire('Your primary calendar is identified; manager access alone does not prove secondary data ownership.'));
    const runtime = h.service.operations.runtime;
    const ids = await runtime.submitTurn({ identity: { userId: 'aurvin-dev-user',
      openRouterUser: 'aurvin-dev-user', source: 'server-configured' }, sessionId: null,
      content: 'What calendars do I own?', idempotencyKey: 'calendar-built-0001' });
    await runtime.executeTurn({ userId: 'aurvin-dev-user', ...ids, signal: new AbortController().signal,
      emit: async () => {}, emitCalendar: async () => {} });
    expect(h.cal.modelBodies).toHaveLength(3);
    const native = compiledTools.map(tool => ({ type: 'function', function: {
      name: tool.name, description: tool.description, parameters: tool.inputSchema,
    } }));
    for (const body of h.cal.modelBodies) {
      expect(body.tools).toEqual(native);
      expect(body.user).toBe('aurvin-dev-user');
    }
    expect(h.fetcher.mock.calls.filter(([url]) => new URL(String(url)).origin === 'https://www.googleapis.com')).toHaveLength(0);
    const records = lines.map(line => JSON.parse(line));
    expect(records.filter(record => record.stage === 'model-dispatch').map(record => record.dispatchKind))
      .toEqual(['initial', 'schema-repair', 'continuation']);
    expect(records).toContainEqual(expect.objectContaining({ stage: 'cursor', reason: 'cursor-format', delivery: 'not-sent' }));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
    const stored = await h.cal.p.messages.list('aurvin-dev-user', ids.sessionId);
    expect(stored.items.filter(message => message.role === 'user')).toHaveLength(1);
    expect(stored.items.filter(message => message.role === 'assistant')).toHaveLength(1);
  } finally { await h.dispose(); }
});
```

Run from `backend`, sequentially: `npm run build`, then `npm test -- test/assembly/calendar-simplification.built.spec.ts`. Expected: native catalogue equality, real direct-executor instance, three bounded dispatches, locally rejected cursor and durable completion all pass on emitted JavaScript. Do not mock the built executor, model adapter or catalogue. This is still offline evidence, not a live-service result.

- [x] Assert P1 v1 facts on the final direct production path, reusing `writeLog` capture and P1's hash helper/pattern rather than inventing identifiers. For every test row below, assert observed state, exact actual model/Google delivery counts, correlation and result origin; do not infer a Google fetch from selecting a Calendar tool.

| Final-path case | Required diagnostic evidence |
| --- | --- |
| `{}` on fresh cached snapshot | Same hashed attempt/decision/tool-call scope; `cache/origin=cache/not-sent`; zero Google requests; task success means execution only, not ownership-answer correctness. |
| Missing/expired discovery | Real `provider-request/google-calendar/discovery/attempted`, response-received when a response exists, then local snapshot projection. |
| Cursor/structural rejection and correction | Precise safe field/type/presence/reason, local not-sent; actual correction-used/limit; schemas/fingerprint on repaired native dispatch. |
| Returned second page and distinct queries | Real executions counted, no duplicate suppression; sensitive cursor never appears in logs. |
| Equivalent redundant read | `validation/rejected/duplicate-call/not-sent`, successful earlier group retained; no duplicate Google request, result record or logical debit. |
| Google 400/403 and failure | Received safe status/code with provider origin versus local authority denial; no cursor reason for a provider response, no repair bypass. |
| Exhausted malformed/cursor corrections | `REPAIR_EXHAUSTED/budget-exhausted`; task fallback versus completed chat; no task-success claim merely from delivery. |
| Successful/uncertain create and saved-result recovery | Actual POST attempt versus matched durable confirmation; one POST only; independent write certainty; no inference/write replay on recovery. |
| Throwing/backpressured sink and interleaved turns | Same business outcome/calls/durability; no cross-turn IDs; bounded records and P1 safe projection preserved. |

The existing P1 regression suite already covers most cases. Keep it and add only missing final-path assertions. A changed catalogue must have `diagnosticVersion: 1`, schema revision v2 and the hash of the **actual new static catalogue**. No stale MCP/channel stage, fake provider label, raw account/calendar/event ID, argument/result/body, private text, raw cursor, provider exception or credential may appear. Keep 4096 UTF-8 bytes/record, 512-character summary, at most `min(diagnosticCount, 10)` rejected-field observations and no per-token/frame records. Reopen P1 through the orchestrator if its projection needs changing rather than silently weakening its contract.

- [x] Run `npm test -- test/assembly/calendar-observability.spec.ts test/assembly/calendar-flow.spec.ts test/assembly/calendar-simplification.spec.ts test/operations/telemetry.spec.ts test/operations/runtime.spec.ts test/operations/persistence.spec.ts test/runtime/calendar-feedback.spec.ts test/runtime/calendar-recovery.spec.ts`.
- [x] Run backend build **to completion before** any dist-consuming routine/e2e suite. Never rebuild concurrently with these suites. Record Node/npm versions, exact source/worker commits, command exit statuses, test counts, warnings, skips, and fixture evidence. Run the offline suite in a child PowerShell process with native fixture variables removed so an inherited operator environment cannot authorize database access:

```powershell
# Working directory: backend. Each command is separate; no background build.
node --version
npm --version
npm run build
npm run lint
powershell -NoProfile -Command {
  Remove-Item Env:AURVIN_TEST_MONGODB_URI -ErrorAction SilentlyContinue
  Remove-Item Env:AURVIN_TEST_DB_PREFIX -ErrorAction SilentlyContinue
  npm test -- --no-file-parallelism
  exit $LASTEXITCODE
}
powershell -NoProfile -Command {
  Remove-Item Env:AURVIN_TEST_MONGODB_URI -ErrorAction SilentlyContinue
  Remove-Item Env:AURVIN_TEST_DB_PREFIX -ErrorAction SilentlyContinue
  npm run test:e2e
  exit $LASTEXITCODE
}
```

Do not start the application with its local `.env` to perform this verification. Offline fetchers must reject every unrecognized origin/path; never fall back to global fetch. Existing fixtures inject in-memory persistence, not a database. A green e2e exit with native tests skipped is not native evidence. This worker does not run Azure/behavior suites to turn empty discovery into evidence. Frontend checks are unnecessary if wire/frontend behavior truly remains unchanged; record that reason. If shared wire/frontend changes become necessary, pause ownership and run from `frontend`: `npm run build`, `npm run lint`, `npm test` after the change is approved.

### Explicit evidence lanes for final verification (not worker authorization)

| Lane | Commands/requirements | Reporting |
| --- | --- | --- |
| Offline, authorized here | Focused checks, backend build/lint/routine/e2e above; deterministic REST/OpenRouter fixtures, in-memory stores; built assembly consumers included | Actual passes/failures and named skips, synthetic reproduction only. |
| Native database, **not run here** | Separately authorized isolated operator fixture, `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. From `backend`, after build: `npm run test:e2e -- test/persistence/calendar-storage.native.e2e-spec.ts test/persistence/calendar-multi-storage.native.e2e-spec.ts test/runtime/calendar-recovery.native.e2e-spec.ts test/integration/plugins/multi-calendar/native-recovery.native.e2e-spec.ts` | Fixtures create/drop generated databases; never use application data or print the URI. Missing authorization/configuration means blocked/unrun, even if discovery exits zero. No Azure/topology certification. |
| Selected-model + connected Google account, **not run here** | Explicit user authorization specifying model/account, allowed reads/pages, spend/time/data bounds; one read-only owned-calendar question with correlated decision/validation/execution and qualified result; no writes without separate approval | Original incident remains unresolved/unobserved until actual authorized reproduction succeeds. A later explicit implementation-only waiver can close only that scope, not prove live resolution. |

- [x] At repository root, run `git diff --check`; verify all relative document links and the caller retirement audit. Inspect `git diff --stat` and named diffs for unrelated changes/secrets/generated output; do not add `dist`, dependencies or local configuration. There remain exactly `plan1.md` and `plan2.md`; no review artifact is produced.
- [x] Complete `contract-alignment.md` with measured results, the retained/removed-layer and test-relocation ledger, structural compatibility evidence, exact commands, skipped native/live gates and the unresolved ownership acceptance qualification. Do not claim all acceptance criteria or the whole workflow complete from offline tests alone.
- [x] Commit named final P2 evidence/tests/plan ticks: `git commit -m "docs(calendar): record simplification verification and remaining gates"`.
- [x] Hand the orchestrator: commit list and baseline, owned files, red/green/full check results, warnings/skips, native/live status, diagnostic v1 compatibility and fingerprint change, rollback limitations, and AC6 qualification. The orchestrator writes `verification.md`/`final_report.md` and updates `state.md`; this is not a third plan or a review stage.

## Acceptance coverage and explicit stop conditions

| Criterion | Implementing/checking tasks | Completion evidence |
| --- | --- | --- |
| AC5 | 1–2 | Five primary-document mappings, unchanged supported subset, runtime/mirror parity including optional first-page field, real native function parameters. |
| AC6 | 2, 4 | Production `{}` plus dynamically returned continuation, primary/manager/shared evidence, explicit coverage and secondary data-ownership uncertainty. Definitive secondary ownership remains an acceptance conflict, not a silent pass. |
| AC7 | 2, 5 | Actual initial/continuation/correction serialized bodies, successful groups retained, bounded structural/cursor repairs, semantic duplicate suppression, distinct pages/queries and post-write reads permitted. |
| AC8 | 3, 5–6 | Direct-path safety check relocation, effect-admission/attribution/limits/privacy/durable history/authority/write recovery tests, no stored-record deletion or in-place durable schema change, documented rollout/rollback. |
| AC9 | 2–5, 7 | P1 v1 events describe the final direct path with actual delivery/origin, precise local reasons, real correlation, fingerprint, bounds and sink isolation. |
| AC10 | All, 7 | Separate source/fixture/native/live evidence, no scripted live-resolution claim; explicit blocked or later authorized/waived gate. |

Stop and report rather than weaken the goal if: native/live access seems required for a failing offline test; actual source differs from the prerequisite handoff; a persistent/tool-key change is necessary; account/authority/provenance or uncertain-write safety would be lost; an unported business test would be deleted; the P1 contract needs an incompatible update; or an exhaustive secondary data-ownership answer is demanded without sufficient evidence. Review remains **skipped** throughout.
