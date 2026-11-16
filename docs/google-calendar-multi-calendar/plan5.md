# P5 — Multi-target event execution, MCP, and model catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Remain the assigned P5 worker; do not dispatch a reviewer or another worker.

**Goal:** Execute the five frozen v2 Calendar tools through the actual embedded MCP path, with operation-specific target authority, truthful provenance, strict model validation, and no weakening of create/readback safety.

**Architecture:** Extend the existing event adapter, signed cursor, direct executor, registry, and SDK client/handler rather than adding another connector. Consume P1 contracts, P3 provider primitives, and P4 lifecycle/capability/credential services through trusted injected ports; P6 alone owns conversational resolution, proposals, conflict acceptance, and mandatory create preflight. Version dispatch explicitly: v1 evidence remains decodable and read-only, never a fresh v2 action.

**Tech Stack:** TypeScript/NodeNext (`.js` local imports), native fetch/crypto/Intl/AbortSignal, installed Zod 3.25, Vitest, MCP client/server **2.3.1**, wire **`2026-07-28`**, and installed `@langchain/core/utils/json_schema`. Node `^22.22.3 || ^24.15.0 || >=26.0.0`; no new dependency.

---

## Execution boundary, prerequisites, and actual-source corrections

Read [goal.md](goal.md), P5/A1/readiness/ownership/evidence in [state.md](state.md), [research.md](research.md), [plan1.md](plan1.md), [plan3.md](plan3.md), root `AGENTS.md`, and the actual files below. P1/A1 and P3 implementations are committed prerequisites. P4 planning is concurrent; read `plan4.md` only after its commit and reconcile the consumer handoff below before binding its concrete service. A plan is not worker completion. Review remains **skipped**, not passed.

This planner changes only this Markdown file. The future worker must not edit contracts/manifests (P1), persistence (P2), discovery/availability REST or shared HTTP (P3), connection/OAuth/options/controllers/module/discovery lifecycle (P4), runtime/agent/context (P6), frontend (P7), assembly/config/fixed instructions/HTTP/operations (P8), or reserved integration files (P9). Do not touch goal/state/research/other plans, `.env`, `.openchamber/`, or historical Phase 1 evidence.

Important source facts, not assumptions to copy from research:

1. Production uses `createMcpHandler` + `StreamableHTTPClientTransport` with an injected `fetch` face. It does **not** use `InMemoryTransport`. Keep this actual socket-free transport and its close/drain behavior.
2. Production registers **inputSchema only**. Its structured result is `{ outcome, result, source, receipt }`, not `calendarSuccessSchema.data`. P1 has already supplied `calendarExecutionEnvelopeV2Schema` and the five-member `calendarResultV2Schema`; register the real envelope, not a new `data` wrapper.
3. `CALENDAR_TOOLS` already has five v2 definitions. `tools-validation.ts` still has a hardcoded three-name allowlist, while `tools.ts` falls through from every non-list/get call to create. Fix both dispatch boundaries, not just assertions.
4. A1 already compares `CALENDAR_TOOL_REVISION` and explicitly narrows get/create result branches before `.event`. Preserve those fixes and extend exhaustive dispatch intentionally.
5. `calendar-api-http.ts` sends **one delivery**, including writes. P3 owns it and has implemented semantic rate/quota classification, byte bounds, and resource-local 404. Do not add retries or a second HTTP implementation in P5. A create must never receive an automatic retry loop; after an ambiguous dispatch, reconcile original target/ID.
6. Goal prose saying the provider window is “far shorter than a month” conflicts with the explicit 31-day policy and actual P1 schemas. Use the frozen **31 elapsed days**, without claiming a verified Google maximum. Research's deleted-default fallback recommendation is superseded by the goal: unavailable defaults clarify, never fall back.
7. Current `calendarActionHash` omits `calendarId`. V2 hashing must include the **resolved canonical selector** while preserving the exact old hash when no selector exists. Keep `calendarEventId`'s existing deterministic prefix/algorithm; advancing tool revisions must not mint a different ID for an existing operation.
8. Current tests are not green baseline evidence: full backend has 13 failed files / 34 failed tests. P5 owns the model/validation/MCP consumer migrations; P4 owns OAuth fixtures and P8 owns assembly. Do not weaken, delete, skip, or blanket-update assertions to erase the distinction.
9. P1 plan Task 9 explicitly reserves the **exact production output JSON descriptor/parity amendment to P1**. Actual committed source supplies the Zod envelope but no production JSON descriptor; its SDK fixture uses `{ type:'object' }` only as a labelled fixture limitation. **Task 8 is blocked on a serialized P1-owned descriptor amendment**, not permission for P5 to invent a second output contract. The public installed `@langchain/core/utils/json_schema` converter avoids a dependency change; P1 must freeze its derived descriptor/export and parity evidence first.

### File map (future worker writes)

| Exact paths | Responsibility |
| --- | --- |
| `backend/src/plugins/google-calendar/tools-validation.ts` | Five-tool semantic validation, canonical hash, v2 persisted create authority |
| `backend/src/plugins/google-calendar/calendar-api-cursor.ts` | Signed v2 event/calendar continuations; legacy read-only decoding |
| `backend/src/plugins/google-calendar/calendar-api.ts` | Canonical target-bound event REST, private masking, stable create/readback |
| `backend/src/plugins/google-calendar/tools.ts` | Port composition, fresh capability checks, five-way dispatch, source/receipt encoding |
| `backend/src/plugins/registry.ts` | One immutable catalogue projection; compare input/output/revision/annotations |
| `backend/src/plugins/mcp/calendar-server.ts`, `calendar-client.ts` | Actual SDK output registration, trusted closures, exact decoding and teardown |
| `backend/src/model/calendar-validation.ts`, `calendar-policy.ts`, `calendar-adapter.ts`, `calendar-repair.ts` | Selector diagnostic paths, v2 dispatch compatibility, repaired-call policy, matched native history |
| `backend/test/plugins/google-calendar/tools-fixtures.ts`, new `tools-multi-fixtures.ts` | Existing inert transport plus explicit v2 execution fixtures; preserve legacy fixtures |
| `backend/test/plugins/google-calendar/tools-validation.spec.ts`, `tools.spec.ts`, new `tools-multi.spec.ts` | Meaningful v2 selector/authority/fencing/projection tests |
| `backend/test/plugins/google-calendar/calendar-api.spec.ts`, `calendar-api-cursor.spec.ts` | Owned REST/cursor regressions |
| `backend/test/plugins/mcp/calendar-server.spec.ts`, `calendar-client.spec.ts`, `calendar-bounds.spec.ts` | Actual transport, catalogue, tampering, encoded bytes, close/drain |
| New `backend/test/plugins/registry.spec.ts` | Exact v2 registry parity and tamper rejection |
| `backend/test/model/calendar-fixtures.ts`, `calendar-validation.spec.ts`, `calendar-policy.spec.ts`, `calendar-adapter.spec.ts`, `calendar-repair.spec.ts`, `calendar-repair-flow.spec.ts` | Migrate active fixtures to v2 while keeping explicit legacy rejection/decoding cases |

No new production helper file is required. `backend/test/plugins/integration/embedded-mcp.spec.ts` is **read-only**: its unknown `other-calendar` must still fail before any event request, but not because all calendar IDs are forbidden. Exercise it after migrating the shared active fixture; add positive authorized-selector coverage in P5's owned suites. If that read-only suite needs an assertion change beyond the shared fixture migration, report to the orchestrator for ownership assignment instead of editing it.

New code files and existing files changed by >30% need the mandatory FILE / LOCATION / PURPOSE / ROLE IN PROJECT / KEY COMPONENTS banner. All snippets below go beneath that header. Reuse Vitest; no fixtures with live credentials, network Google/model calls, database actions, installs, or paid work.

## Frozen interfaces and consumer handoffs

### P1 interfaces consumed, not redefined

- `CALENDAR_TOOL_REVISION = 'google-calendar.v2'`, `CALENDAR_PROOF_REVISION = 'google-calendar.multi.v2'`, cursor version 2, `CALENDAR_MCP_WIRE = '2026-07-28'`; exact five verified scopes include **`calendar.freebusy`**.
- `CALENDAR_TOOLS`, `calendarInputSchemas`, `calendarCallSchema`, `calendarResultV2Schema`, `jsonBytes`, `forbiddenCalendarKeys` from `contracts/calendar-tools.ts`. Exact order is events/list, event/get, event/create, calendars/list, availability/check. Do not reorder/rewrite shared definitions.
- `CalendarExecutionBindingV2`, `calendarExecutionBindingV2Schema`, `CalendarExecutionPortV2`, `CalendarExecutionResultV2`, `CalendarOperationV2`, `operationRecordV2Schema`, `CalendarReceiptV2`, `calendarReceiptV2Schema`, `calendarExecutionEnvelopeV2Schema`, `CalendarRequestKindV2` from `contracts/calendar-operations.ts`.
- `CalendarAccountBinding`, `CalendarResolvedTarget`, `CalendarDiscoverySnapshot`, `CalendarDiscoveryPort`, `CalendarProviderContext`, `CalendarConnectionStoreV2`, their schemas, `primaryCalendarId`, and `effectiveCalendarCapabilities` from `contracts/calendar-discovery.ts`.
- `CalendarCapabilityGate.resolve/requireCurrent` from `contracts/calendar-authority.ts`; `CalendarAccountCredentialPort.withAccessToken({ account, signal, deadlineAt, consumeRefreshRequest }, action)` from `contracts/calendar-connections.ts`.
- `CalendarAvailabilityPort.check`, result/coverage schemas, and `calendarAvailabilityFingerprint` from `contracts/calendar-availability.ts`.
- `sourceReferenceV2Schema`, `effectiveSourceExpiry`, source permission; `calendarCursorV2PayloadSchema` / compatible legacy decoder; `modelDispatchV2Schema`, `CalendarModelDispatchV2`, `rejectedDecisionV2Schema`, `CalendarModelPortV2`, and `completeToolGroupV2Schema`.

**Required upstream descriptor handoff before Task 8:** request that P1 export `calendarExecutionEnvelopeV2JsonSchema: Record<string, unknown>` from its owned `backend/src/contracts/calendar-mcp-schema.ts`, derived from the existing v2 Zod envelope with object-root semantics and the already-installed public LangChain converter. P1 owns its exact JSON descriptor/parity test and commit; P5 owns only consumption/production SDK registration. No new field/revision/authority is requested. If P1 chooses a different export location/name, amend this consumer plan before executing Task 8, rather than writing another owner's file or maintaining duplicate schema literals. Other P5 tasks can proceed against committed P1 ports/fixtures while that amendment is serialized.

Exact gate semantics: `resolve` takes untrusted `selector: string | null` and returns resolved / clarify / denied. `requireCurrent` takes a **resolved target**, operation `read | create | availability`, deadline, capability-request callback, refresh callback and signal; it returns `void`. It cannot silently retarget. P5 maps clarification/denial codes to bounded failures; P6 owns conversational handling and primary/default/name precedence.

Allowed model selectors: optional `calendarId` at top level of **list/get/create arguments only**; optional `calendarIds` at top level of **availability arguments only**. List-calendars accepts only `pageToken?`. Neither IDs nor `confirmed`, conflict flags, names, revisions, operation IDs, tokens, model IDs or notification options create authority. Strict schemas reject misplaced/nested selectors even though `calendarId` is no longer globally forbidden.

### P3 interfaces consumed

`CalendarDiscoveryApi implements CalendarDiscoveryPort` and `CalendarAvailabilityApi implements CalendarAvailabilityPort` are committed. Each derives input from the P1 port. Provider context carries actual trusted scopes/policy/retention, account-bound credentials, deadline, clock, and a counted request callback. P3 handles ≤100 retained calendars, ≤2 in-turn page deliveries, ≤50 calendars/batch, ≤2 availability batch deliveries, ≤2,000 ingested intervals, 256 KiB work and ≤15,360-byte result bodies. Whole MCP envelopes must still fit 16 KiB.

P3 returns a raw **Google** `snapshot.nextPageToken`, not an Aurvin tool cursor. It has no continuation-input port. Never expose that raw token or pretend a partial provider snapshot can be resumed by a tool page. Tool pagination walks a stable P4 snapshot at ≤20 entries/page, with a separately signed index cursor. Completeness describes discovery coverage, not whether a UI page is the final page.

No allowance replenishment: reuse one request-admission closure across credential replay and caller-authorized retries; no fresh two-retry allowance in P5. In-turn discovery caps count deliveries including retries. Availability's two-batch cap also counts deliveries. A first provider 401 may cause one P4 refresh/replay only; it still spends a Calendar delivery, and every refresh spends the refresh-request budget. A create must not be replayed automatically by credentials after a callback may have dispatched it; reconcile its stable ID instead. Return an interface issue if P4 cannot make that distinction.

### Required P4 handoff (consumer dependency, never co-owned source)

P4 supplies the capability gate and account credential port above. P5 also needs an account-bound discovery **lifecycle** read: current snapshot plus actual scopes, with expiry-aware refresh and current account validation. P1's REST discovery port does not supply this cached lifecycle operation. Use this exact injection shape in `tools.ts`; it is a local consumer dependency, not a new public/shared contract:

```ts
type DiscoveryRead = {
  account: CalendarAccountBinding; signal: AbortSignal; deadlineAt: string;
  consumeRequest: (kind: 'discovery' | 'capability-recheck') => Promise<void>;
  consumeRefreshRequest: () => Promise<void>;
};
export type CalendarToolsV2Dependencies = {
  api: CalendarApi;
  gate: CalendarCapabilityGate;
  credentials: CalendarAccountCredentialPort;
  // Read only, for cheap account/grant fencing around an admitted delivery.
  connections: Pick<CalendarConnectionStoreV2, 'get'>;
  readDiscovery(input: DiscoveryRead): Promise<{
    snapshot: CalendarDiscoverySnapshot; grantedScopes: readonly string[];
  }>;
  availability: CalendarAvailabilityPort;
  limits: CalendarLimits;
  permission: z.infer<typeof sourcePermissionSchema>;
  policyDeadlines: readonly number[];
  now?: () => number;
  cursorKey?: Uint8Array;
};
```

P4 may adapt an already-named method to this shape; do not rename or edit its service. P8 performs production constructor wiring. P5 tests inject a strict fixture until P4 is ready. Before integration, the orchestrator must acknowledge the concrete mapping and its retry/write-refresh semantics. `connections.get` is an existing frozen read-only store port, not permission for P5 to change persistence, tokens, settings, revisions, or cache state.

The host/handler also need a **cheap account-only** fence when `binding.target === null` (catalogue/discovery is not a write-target operation). P1's capability port has no such method. Do not pass a nullable target to `requireCurrent`, invent a dummy calendar, or resolve a default merely to list tools. Define this local injected extension in the P5 MCP dependency types, with an adapter supplied by P4/P8:

```ts
export type CalendarMcpGate = CalendarCapabilityGate & {
  requireAccount(account: CalendarAccountBinding, signal: AbortSignal): Promise<void>;
};
```

The method only checks stored current account/revision/subject, enabled/status and full grant; no Google request, target/default selection, or hidden refresh. The fixture gate below implements it. It may reuse P4's existing account validation or the same frozen read-only connection store checks as the direct executor. This is an explicit consumer handoff requiring acknowledgement, not an implicit P1 or P4 file amendment. Keep `gate: CalendarMcpGate` in the v2 `EmbeddedCalendarExecution`/handler overload; the existing legacy overload remains compile-only/read-only as described below.

P4 must guarantee: current account/revision/subject and full scope grant; no stale refresh resurrection; stable snapshot revision/expiry for paging; no raw provider cursor exposure; partial/volatile cache truth; independent `defaultSettingRevision`; fresh operation-specific gate checks. P5 repeats cheap binding/shape checks at its trust boundary. Do not implement a second cache or a competing target resolver.

Because `requireCurrent` returns `void`, it must **reject** a binding whose fresh role/private-access/capability evidence has materially changed, rather than silently authorizing it while leaving old `target.privateAccess:true` in place. Otherwise a former writer that becomes private-masked could leak details through an old projection flag. Re-resolving safe new evidence belongs to P4/P6; P5 must not mutate an already-persisted operation's target or infer the new role itself.

### Version compatibility while P6/P8 migrate

Keep current class exports and existing v1 constructor/call signatures compilable via explicit overloads; add v2 constructor/call overloads to those same classes. Dispatch by **parsed `binding.schemaRevision`**, never by an untrusted call argument or a cast. Legacy `invoke` returns `CALENDAR_EXECUTION_DENIED` with zero external requests; do not retain a live v1 create path. Legacy matched **GET-only readback** may use the original binding/operation and old receipt format, never a replacement account/default or a v2 receipt fabricated from v1 evidence. Preserve `verifyOwnedTarget` solely as the legacy `CalendarTargetPort` method while P4 migrates; do not relabel its owner-only proof as multi-calendar proof. P8 removes its active assembly use.

Model v1 dispatch decoding remains possible, but a new tool-bearing provider dispatch must be v2. Preserve old exported model entry points for compilation; reject their legacy tool dispatches without HTTP. Add the v2 factory directly to `calendar-adapter.ts`; P6 imports that module, so P5 need not edit `model/index.ts`. No second runtime or persistence owner is introduced.

## Task 1: Admit only the frozen selector positions and validate both new tool inputs

**Files:** `backend/src/plugins/google-calendar/tools-validation.ts`; `backend/test/plugins/google-calendar/tools-validation.spec.ts`; `backend/test/model/calendar-validation.spec.ts` (only the obsolete calendar-ID policy case).

- [x] **Write these failing assertions** in the existing validation suite:

```ts
it('validates all five v2 calls without turning selectors into authority', () => {
  const calls = [
    { name: 'calendar_list_calendars', arguments: {} },
    { name: 'calendar_check_availability', arguments: {
      timeMin: '2026-10-21T00:00:00Z', timeMax: '2026-10-22T00:00:00Z',
      timeZone: 'Etc/UTC', calendarIds: ['shared'] } },
    { name: 'calendar_list_events', arguments: { calendarId: 'shared',
      timeMin: '2026-10-21T00:00:00Z', timeMax: '2026-10-22T00:00:00Z', maxResults: 20 } },
    { name: 'calendar_get_event', arguments: { calendarId: 'shared', eventId: 'abcde' } },
    { name: 'calendar_create_event', arguments: { ...ACTION, calendarId: 'shared' } },
  ];
  for (const call of calls) expect(validateCalendarCall(call)).toEqual(call);
  for (const call of calls) for (const key of ['confirmed', 'conflictAccepted', 'accessToken',
    'connectionId', 'targetRevision', 'attendees', 'modelId']) {
    expect(() => validateCalendarCall({ ...call, arguments: { ...call.arguments, [key]: true } }))
      .toThrow('CALENDAR_FORBIDDEN');
  }
  expect(() => validateCalendarCall({ name: 'calendar_list_calendars', arguments: { calendarId: 'shared' } }))
    .toThrow('CALENDAR_ARGUMENTS_INVALID');
  expect(() => validateCalendarCall({ name: 'calendar_get_event', arguments: {
    eventId: 'abcde', calendarIds: ['shared'] } })).toThrow('CALENDAR_ARGUMENTS_INVALID');
  expect(() => validateCalendarCall({ name: 'calendar_get_event', arguments: {
    eventId: 'abcde', location: { calendarId: 'shared' } } })).toThrow('CALENDAR_ARGUMENTS_INVALID');
});

it('applies the exact list window and real zone to availability too', () => {
  const call = { name: 'calendar_check_availability', arguments: {
    timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-02-01T00:00:00Z', timeZone: 'Etc/UTC' } };
  expect(validateCalendarCall(call)).toEqual(call);
  for (const arguments_ of [
    { ...call.arguments, timeMax: '2026-02-01T00:00:00.000000001Z' },
    { ...call.arguments, timeMin: '2026-02-30T00:00:00Z' },
    { ...call.arguments, timeMax: call.arguments.timeMin },
    { ...call.arguments, timeZone: 'Invalid/Zone' },
  ]) expect(() => validateCalendarCall({ ...call, arguments: arguments_ }))
    .toThrow('TIME_REQUIRES_CLARIFICATION');
  for (const calendarId of ['.', '..', 'bad\nID']) expect(() => validateCalendarCall({
    name: 'calendar_get_event', arguments: { calendarId, eventId: 'abcde' } }))
    .toThrow('CALENDAR_ARGUMENTS_INVALID');
});
```

In `calendar-validation.spec.ts`, move `{"eventId":"abcde","calendarId":"other"}` out of the forbidden-field cases and give it an explicit **structurally valid, not execution-authorized** assertion:

```ts
it('accepts an ID selector structurally without asserting its authorization', () => {
  expect(validateCalendarCandidate(candidate('{"eventId":"abcde","calendarId":"other"}'),
    CALENDAR_TOOLS, CALENDAR_LIMITS)).toMatchObject({ kind: 'valid', call: {
      name: 'calendar_get_event', arguments: { eventId: 'abcde', calendarId: 'other' } } });
  expect(execute).not.toHaveBeenCalled();
});
```

- [x] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/tools-validation.spec.ts -t "validates all five|applies the exact"`. Expect `CALENDAR_UNKNOWN_TOOL` for a new tool and missing availability semantic checks; the selector-only model assertion may already pass and is regression evidence, not invented red evidence.
- [x] **Minimal implementation:** import `CALENDAR_TOOLS`, replace the hardcoded allowlist, preserve recursive forbidden-key scanning, byte/depth checks and A1 narrowing:

```ts
const ALLOWED_TOOL_NAMES: readonly string[] = CALENDAR_TOOLS.map(t => t.name);
// After strict calendarCallSchema parsing:
if ('calendarId' in call.arguments && call.arguments.calendarId !== undefined) {
  validateGetArguments({ eventId: call.arguments.calendarId });
}
if (call.name === 'calendar_list_events' || call.name === 'calendar_check_availability') {
  validateListArguments(call.arguments, limits);
}
if (call.name === 'calendar_check_availability') {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: call.arguments.timeZone }); }
  catch { throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION); }
  for (const id of call.arguments.calendarIds ?? []) validateGetArguments({ eventId: id });
} else if (call.name === 'calendar_get_event') validateGetArguments(call.arguments);
else if (call.name === 'calendar_create_event') validateCreateArguments(call.arguments);
```

Keep `primary` as a valid **selector**, never a canonical provider target. Do not infer timezone wall-clock consistency for range timestamps: availability range offsets describe instants and may cross zones/DST; only event creation requires its existing offset/zone consistency.

- [x] **Verify green**, cwd `backend`: `npm test -- test/plugins/google-calendar/tools-validation.spec.ts test/model/calendar-validation.spec.ts`. Update the old exact catalogue assertions to the exact five names and `CALENDAR_TOOL_REVISION`, while retaining copy isolation, schema drift, duplicate tools, and every unsupported-field/time test. Pass `calendarCatalogue()` to `assertCalendarCatalogue`, not `CALENDAR_TOOLS` with only `revision` removed (that leaves non-wire `deliveryRetry` metadata). Compare copied descriptions with the exact frozen v2 definition instead of the old v1 sentence. Full output/annotation/revision parity is added in Task 8.
- [x] **Commit named paths:** `git commit -m "feat(calendar): validate five strict multi-calendar tool inputs"`.

## Task 2: Add explicit v2 inert fixtures and bind canonical actions to their target

**Files:** `backend/src/plugins/google-calendar/tools-validation.ts`; new `backend/test/plugins/google-calendar/tools-multi-fixtures.ts`; `backend/test/plugins/google-calendar/tools-validation.spec.ts`.

- [x] **Write these fixture functions** (imports are exact; prepend the code header). Do not mutate the shared contract fixtures or legacy `savedOperation`:

```ts
import { calendarResolvedTargetSchema, effectiveCalendarCapabilities }
  from '../../../src/contracts/calendar-discovery.js';
import { calendarExecutionBindingV2Schema, operationRecordV2Schema }
  from '../../../src/contracts/calendar-operations.js';
import { CALENDAR_SCOPES } from '../../../src/contracts/calendar-policy.js';
import { calendarActionHash, calendarEventId }
  from '../../../src/plugins/google-calendar/tools-validation.js';
import { CREATE_ACTION } from './tools-fixtures.js';

export function multiTarget(role: 'owner' | 'writer' | 'writerWithoutPrivateAccess' | 'reader'
  | 'freeBusyReader' = 'writer', calendarId = 'shared', now = new Date().toISOString()) {
  return calendarResolvedTargetSchema.parse({ userId: 'u', connectionId: 'c', connectionRevision: 1,
    googleSubjectId: 'sub', calendarId, calendarLabel: `Calendar ${calendarId}`,
    targetRevision: 1, discoveryRevision: 1, selectedBy: 'explicit', accessRole: role,
    privateAccess: role === 'owner' || role === 'writer',
    capabilities: effectiveCalendarCapabilities(role, CALENDAR_SCOPES, true),
    verifiedAt: now, proofRevision: 'google-calendar.multi.v2' });
}
export function multiOperation(target = multiTarget()) {
  const action = { ...CREATE_ACTION, calendarId: target.calendarId };
  const hash = calendarActionHash(action);
  return operationRecordV2Schema.parse({ schemaVersion: 2, kind: 'calendar-operation',
    userId: 'u', sessionId: 's', turnId: 't', operationId: 'op_1', originatingAttemptId: 'a_1',
    revision: 1, sequence: 1, intentId: 'intent_1', originatingTurnId: 't',
    originatingAcceptedMessageId: 'm_1', connectionId: 'c', connectionRevision: 1,
    googleSubjectId: 'sub', calendarId: target.calendarId, targetRevision: target.targetRevision,
    calendarLabel: null, labelExpiresAt: null, discoveryRevision: target.discoveryRevision,
    proofRevision: 'google-calendar.multi.v2', schemaRevision: 'google-calendar.v2',
    requestHash: hash, googleEventId: calendarEventId('op_1'), action, actionSources: [],
    authorization: { acceptedUserMessageId: 'm_1', acceptedTurnId: 't', canonicalActionHash: hash,
      approvedAt: target.verifiedAt, basis: 'explicit-request', proposalId: null, conditionFingerprint: null },
    deliveryRetries: 0, createdAt: target.verifiedAt, updatedAt: target.verifiedAt,
    auditExpiresAt: new Date(Date.parse(target.verifiedAt) + 86400000).toISOString(),
    state: 'dispatching', receipt: null, failure: null });
}
export function multiBinding(target = multiTarget(), operation: ReturnType<typeof multiOperation> | null = null) {
  return calendarExecutionBindingV2Schema.parse({ userId: 'u', connectionId: 'c', connectionRevision: 1,
    googleSubjectId: 'sub', target, sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd',
    toolCallId: 'tc', schemaRevision: 'google-calendar.v2', operation,
    trustedNow: target.verifiedAt, trustedTimeZone: 'Etc/UTC',
    deadlineAt: new Date(Date.now() + 10000).toISOString() });
}
```

**Failing authority assertions** in the existing suite, importing these helpers:

```ts
it('hashes canonical target and rejects mismatched or legacy create authority', () => {
  const target = multiTarget();
  const operation = multiOperation(target);
  const bound = multiBinding(target, operation);
  expect(calendarActionHash({ ...ACTION, calendarId: 'shared' }))
    .not.toBe(calendarActionHash({ ...ACTION, calendarId: 'other' }));
  expect(requireCreateAuthority(bound, { ...ACTION, calendarId: 'shared' })).toEqual(operation);
  for (const action of [{ ...ACTION, calendarId: 'other' }, { ...ACTION, summary: 'Changed', calendarId: 'shared' }]) {
    expect(() => requireCreateAuthority(bound, action)).toThrow('OPERATION_AUTHORITY_REQUIRED');
  }
  expect(() => requireCreateAuthority(binding({ operation: dispatchingOperation() as never }), ACTION))
    .toThrow('OPERATION_AUTHORITY_REQUIRED');
  expect(calendarEventId(operation.operationId)).toBe(operation.googleEventId);
});
```

- [x] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/tools-validation.spec.ts -t "hashes canonical target"`. Expect equal target hashes and v2 authority rejection.
- [x] **Minimal implementation:** add `calendarId` to the canonical hash object **only when defined**, preserving legacy hash bytes. Add a v2 overload to `requireCreateAuthority`, parse the v2 binding and operation, and require all of the following before returning the record: `dispatching`, non-null action/target, live audit deadline measured against the later of trusted time and actual executor clock, matching user/session/current accepted turn, account/subject/revisions/canonical target, matching schema/proof revision, canonical action target equal to persisted target, equal request/authorization/action hashes, valid stored Google ID. A changed attempt ID alone is allowed; the operation's originating attempt/intent remains fixed. Reject a legacy binding for **create**, rather than pretending it has v2 approval evidence.

The hash change is exactly:

```ts
const canonical = JSON.stringify({
  ...(input.calendarId === undefined ? {} : { calendarId: input.calendarId }),
  summary: input.summary, start: input.start, end: input.end, timeZone: input.timeZone,
  ...(input.description === undefined ? {} : { description: input.description }),
  ...(input.location === undefined ? {} : { location: input.location }),
});
```

For an omitted create selector, compare against `{ ...action, calendarId: binding.target.calendarId }` only after P6 has supplied that resolved target and the persisted operation has the same canonical ID. Do not resolve a new default here or mutate `operation.action`. Preserve the old `calendarEventId` body byte-for-byte.

- [x] **Verify green**, cwd `backend`: `npm test -- test/plugins/google-calendar/tools-validation.spec.ts -t "hashes canonical target"`. Migrate the existing active create-authority tests to v2 fixtures and retain all state/audit/user/turn/revision/hash rejection cases. Add `unknown`, `failed`, `cancelled`, reader/free-busy target capability denials, and target/subject mismatch cases; a legacy readback fixture remains explicitly legacy.
- [x] **Commit these three paths:** `git commit -m "fix(calendar): bind create authority and action hashes to canonical targets"`.

## Task 3: Issue signed v2 event and snapshot-page cursors without default coupling

**Files:** `backend/src/plugins/google-calendar/calendar-api-cursor.ts`; `backend/test/plugins/google-calendar/calendar-api-cursor.spec.ts`.

- [x] **Write failing tests**, importing `multiTarget` and the frozen payload decoder:

```ts
it('issues v2 cursors bound to target discovery, kind and expiry', () => {
  const now = Date.now();
  const target = multiTarget('writer', 'shared', new Date(now).toISOString());
  const cursor = new CalendarCursor(key(), () => now);
  const scope = { kind: 'events' as const, discoveryRevision: 1,
    expiresAt: new Date(now + 300000).toISOString() };
  const encoded = cursor.encode('provider-2', target, args, scope);
  const payload = JSON.parse(Buffer.from(encoded.split('.')[0]!, 'base64url').toString('utf8'));
  expect(payload).toMatchObject({ v: 2, kind: 'events', discoveryRevision: 1, expiresAt: scope.expiresAt });
  expect(cursor.decode(encoded, target, args, scope)).toBe('provider-2');
  for (const changed of [{ ...target, calendarId: 'other' }, { ...target, googleSubjectId: 'replacement' },
    { ...target, connectionRevision: 2 }, { ...target, targetRevision: 2 }]) {
    expect(() => cursor.decode(encoded, changed, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
  }
  expect(() => cursor.decode(encoded, target, args, { ...scope, kind: 'calendars' }))
    .toThrow('CALENDAR_INPUT_REJECTED');
  expect(() => cursor.decode(encoded, target, args, { ...scope, discoveryRevision: 2 }))
    .toThrow('CALENDAR_INPUT_REJECTED');
  expect(() => new CalendarCursor(key(), () => now + 300000).decode(encoded, target, args, scope))
    .toThrow('CALENDAR_INPUT_REJECTED');
});

it('rejects correctly sized nonhex signatures and legacy tokens for v2 dispatch', () => {
  const target = multiTarget();
  const cursor = new CalendarCursor(key());
  const scope = { kind: 'events' as const, discoveryRevision: 1,
    expiresAt: new Date(Date.now() + 300000).toISOString() };
  const encoded = cursor.encode('provider-2', target, args, scope);
  expect(() => cursor.decode(encoded.split('.')[0] + '.' + 'z'.repeat(64), target, args, scope))
    .toThrow('CALENDAR_INPUT_REJECTED');
  const legacy = Buffer.from(JSON.stringify({ v: 1, b: 'a'.repeat(64), q: 'b'.repeat(64), t: 'p2' }))
    .toString('base64url');
  const signature = createHmac('sha256', key()).update(legacy).digest('hex');
  expect(() => cursor.decode(`${legacy}.${signature}`, target, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
});
```

- [x] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-api-cursor.spec.ts -t "issues v2|correctly sized"`. Expect v1 payload/missing scope checks, not no tests.
- [x] **Minimal implementation:** retain process-local HMAC and ceiling; add optional clock constructor argument. Encode only `calendarCursorV2PayloadSchema.parse({ v: CALENDAR_CURSOR_VERSION, b, q, t, kind, discoveryRevision, expiresAt })`. Scope fingerprints use account/user/subject/revision plus canonical target ID and targetRevision for events; calendar pages bind account and snapshot revision/hash without an invented target. Add `CalendarCursorScope` and a union of event-query arguments versus `{ snapshotHash: string; pageSize: number }`, using the existing hashing helper. The `t` for calendar pages is a validated nonnegative decimal **next offset**, never Google's token. No `defaultSettingRevision` enters any fingerprint.

Use these explicit local cursor types, not a second shared schema:

```ts
type CalendarCursorBinding = CalendarAccountBinding | CalendarResolvedTarget;
export type CalendarCursorScope = { kind: 'events' | 'calendars'; discoveryRevision: number; expiresAt: string };
export type CalendarCursorArgs = { timeMin: string; timeMax: string; maxResults: number }
  | { snapshotHash: string; pageSize: number };
```

The event binding fingerprint contains account fields and target ID/revision; the calendar-page fingerprint contains account fields only. Select these exact projections by `scope.kind`, validating that an event scope actually has a resolved target. Do not hash the whole injected object (which could accidentally include a default revision). Query fingerprint is the explicit corresponding argument projection. Validate signature text before `Buffer.from`/constant-time comparison; malformed input must throw the bounded cursor fault, not `RangeError`:

```ts
if (!/^[a-f0-9]{64}$/u.test(signature)) rejectCursor();
const parsed = calendarCursorV2PayloadSchema.safeParse(decoded);
if (!parsed.success || parsed.data.kind !== scope.kind
  || parsed.data.discoveryRevision !== scope.discoveryRevision
  || parsed.data.expiresAt !== scope.expiresAt
  || Date.parse(parsed.data.expiresAt) <= this.clock()
  || parsed.data.b !== bindingFingerprint(binding)
  || parsed.data.q !== queryFingerprint(args)) rejectCursor();
return parsed.data.t;
```

Keep an explicitly named `decodeLegacy` for valid signed `calendarCursorV1PayloadSchema` inspection/read-only reconciliation. Do not let active `decode` accept a compatible union and forward a v1 token to Google. Canonical base64url, exact payload keys, positive finite expiry ≤5 minutes and total ≤2,048 characters remain required. Invalid issuing input is `CALENDAR_RESPONSE_INVALID`; invalid consuming input is `CALENDAR_INPUT_REJECTED`. No persistent signing key or cross-process cursor promise is added.

- [x] **Verify green**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-api-cursor.spec.ts`. Migrate active existing cursor roundtrip/range/size/process-key/query-injection tests to v2 scope, preserving every old boundary. Add a separately labelled legacy payload/decode test; no v1 issuance in an active tool test.
- [x] **Commit both paths:** `git commit -m "feat(calendar): bind v2 continuations to target snapshot and expiry"`.

## Task 4: Project events on authorized canonical calendars and preserve stable write/readback

**Files:** `backend/src/plugins/google-calendar/calendar-api.ts`; `backend/test/plugins/google-calendar/calendar-api.spec.ts`; `backend/test/plugins/google-calendar/tools-multi-fixtures.ts` (add context helper).

- [x] **Add this context fixture**:

```ts
export function multiContext(target = multiTarget()) {
  return { binding: multiBinding(target), target, accessToken: 'fixture-access-token',
    signal: new AbortController().signal, deadlineAt: new Date(Date.now() + 10000).toISOString(),
    consumeRequest: async (_kind: import('../../../src/contracts/calendar-operations.js').CalendarRequestKindV2) => {} };
}
```

**Write failing tests** using the existing inert `fakeFetch`/`googleEvent`:

```ts
it('reads shared targets with provenance and masks private details for restricted readers', async () => {
  for (const role of ['writerWithoutPrivateAccess', 'reader'] as const) {
    const target = multiTarget(role, 'shared');
    const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234',
      response: () => Response.json(googleEvent({ visibility: 'private', summary: 'PRIVATE_TITLE',
        description: 'PRIVATE_BODY', location: 'PRIVATE_PLACE' })) }]);
    const result = await new CalendarApi({ fetcher: fake.fetcher }).get(multiContext(target),
      { calendarId: 'shared', eventId: 'abcde01234' });
    expect(result.result).toMatchObject({ schemaVersion: 2, tool: 'calendar_get_event', target: {
      calendarId: 'shared', calendarLabel: 'Calendar shared', privateAccess: false },
      event: { eventId: 'abcde01234', summary: '', htmlLink: null } });
    expect(JSON.stringify(result.result)).not.toMatch(/PRIVATE_TITLE|PRIVATE_BODY|PRIVATE_PLACE|attendees/);
    expect(fake.requests).toHaveLength(1);
  }
});

it('never sends an explicit selector to a different trusted target', async () => {
  const fake = fakeFetch([]);
  const api = new CalendarApi({ fetcher: fake.fetcher });
  const context = multiContext();
  await expect(api.get(context, { calendarId: 'other', eventId: 'abcde01234' }))
    .rejects.toThrow('CALENDAR_EXECUTION_DENIED');
  await expect(api.create(context, multiOperation(multiTarget('writer', 'other'))))
    .rejects.toThrow('OPERATION_AUTHORITY_MISMATCH');
  expect(fake.requests).toHaveLength(0);
});

it('creates on a shared writer and reads back only its original target and ID', async () => {
  const target = multiTarget('writer', 'shared');
  const operation = multiOperation(target);
  const body = { ...googleEvent(), id: operation.googleEventId,
    extendedProperties: { private: { aurvinOperationId: operation.operationId,
      aurvinRequestHash: operation.requestHash } } };
  const fake = fakeFetch([
    { method: 'POST', path: '/calendar/v3/calendars/shared/events', response: () => Response.json(body) },
    { method: 'GET', path: `/calendar/v3/calendars/shared/events/${operation.googleEventId}`,
      response: () => Response.json(body) },
  ]);
  const api = new CalendarApi({ fetcher: fake.fetcher });
  expect((await api.create(multiContext(target), operation)).result).toMatchObject({
    schemaVersion: 2, target: { calendarId: 'shared' }, event: { eventId: operation.googleEventId } });
  expect(await api.readback(multiContext(target), operation)).toMatchObject({ outcome: 'matched' });
  const request = fake.requests[0]!;
  expect(new URL(request.url).searchParams.get('sendUpdates')).toBe('none');
  const sent = await request.clone().json();
  expect(sent.id).toBe(operation.googleEventId);
  expect(sent).not.toHaveProperty('calendarId');
  expect(sent).not.toHaveProperty('attendees');
  expect(sent).not.toHaveProperty('recurrence');
  expect(sent.reminders).toEqual({ useDefault: false });
  expect(fake.requests.map(r => r.method)).toEqual(['POST', 'GET']);
});
```

- [x] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-api.spec.ts -t "reads shared|explicit selector|shared writer"`. Expect old context/result mismatch and missing private masking.
- [x] **Minimal implementation:** extend `CalendarHttpContext`/read response through explicit v1/v2 unions and overloads. A v2 context carries a parsed resolved `target`; never flatten a model selector into `CalendarConnectionBinding` or use `args.calendarId` directly for a path. Assert context account equals target account; assert selector absent or equal to canonical target (primary resolution belongs to the gate before this adapter). Require `readEvents` for list/get and `createEvents` for create; free-busy-only cannot enter event REST. Build every v2 path from `target.calendarId` and each write/readback ID from the persisted operation.

Add provider `visibility` to the **read projection field mask**, not to tool inputs. Change `projectEvent(item, privateAccess)` so private/confidential records with `privateAccess:false` omit description/location and return empty summary/null link while retaining permitted timed start/end/status/ID. Keep all-day omission/truncation, malformed response detection, Unicode/opaque IDs, safe links and no raw provider fields.

Add the frozen v2 result target to list/get/create/readback results:

```ts
const resultTarget = { calendarId: target.calendarId, calendarLabel: target.calendarLabel,
  discoveryRevision: target.discoveryRevision, privateAccess: target.privateAccess };
const result = calendarResultV2Schema.parse({ schemaVersion: 2,
  tool: 'calendar_get_event', target: resultTarget, event: projected });
```

Use the same target projection for the other three event response sites, including matched readback. V2 create accepts only a dispatching v2 operation with canonical action target, matching account/subject/targetRevision/proof, stored action/hash/event ID, and a write-capable target. Preserve exact body, no invitations, server-owned private linkage and existing instant/zone matching. A v1 create is denied before admission; v1 readback remains GET-only on the old target and returns v1 evidence. Do not change legacy owner-only proof into shared proof.

For v2 event cursors use `{ kind:'events', discoveryRevision: target.discoveryRevision, expiresAt: new Date(Date.parse(target.verifiedAt) + 300000).toISOString() }`; always honor any stricter known snapshot/privacy deadline supplied by the caller. Stale target proof cannot authorize a fresh page. Keep single delivery: there is no automatic POST retry, sleep loop, fresh ID or current-default lookup.

- [x] **Verify green**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-api.spec.ts test/plugins/google-calendar/calendar-api-cursor.spec.ts test/plugins/google-calendar/calendar-api-http.spec.ts`. Migrate existing active create/readback tests to v2 contexts, retaining all absent/mismatch/unknown/409/cancel/gone cases. Rename the old explicit rate-limit retry fixture to **caller-authorized same-ID redelivery**: assert each direct call sends one request and no adapter loop occurs. P6 decides whether a known rejection permits that explicit redelivery; ambiguous writes only read back.
- [x] **Commit the three named paths:** `git commit -m "feat(calendar): execute target-bound shared event reads and writes"`.

## Task 5: Compose v2 event execution with cheap account fencing and fresh capability gates

**Files:** `backend/src/plugins/google-calendar/tools.ts`; `backend/test/plugins/google-calendar/tools-fixtures.ts`; `backend/test/plugins/google-calendar/tools-multi-fixtures.ts`; `backend/test/plugins/google-calendar/tools.spec.ts`; new `backend/test/plugins/google-calendar/tools-multi.spec.ts`.

- [x] **Extend the explicit v2 fixture**, not production identity. Implement `multiToolsFixture` in `tools-multi-fixtures.ts` using `CalendarApi`, `CalendarApiTools`, existing `fakeFetch`, the helpers from Task 2, and strict stubs of `CalendarCapabilityGate`, `CalendarAccountCredentialPort`, `CalendarConnectionStoreV2['get']`, and `readDiscovery`. The fixture exposes `{ tools, input, fake, requests, counts, gate, credentials, record, snapshot }`. `counts` has `calendar`, `refresh`, `credential`, `capability`, and `kinds: CalendarRequestKindV2[]`. Start with one shared writer entry; `record` is a parsed **v2** connected record with all `CALENDAR_SCOPES`, encrypted dummy token fields, enabled true and matching account. `snapshot` is parsed with fetched/expiry based on the fixture clock and one explicit primary entry; no `primary` inferred from email.

The gate must resolve only IDs actually present in its snapshot and capabilities, return `CALENDAR_TARGET_UNKNOWN` for `other-calendar`, deny read on freeBusyReader and create on reader/freeBusyReader, and expose `disable()`/`revision(n)` for race tests. `requireCurrent` validates target account/role, not saved default. Credential fixture returns a fake token only after validating current account; the read-only store returns a structured clone. No fixture assertion may be implemented with `as never` to make a success compile. Preserve `fakeFetch`, `googleJson`, `googleEvent`, `savedOperation`, `readBinding`, and legacy `readContext` exports unchanged; they are used by P3 and other owners.

Append this concrete fixture implementation beneath Task 2's helpers, adding its named imports. The inert gate is deliberately not evidence of P4's real ACL/refresh behavior:

```ts
import { z } from 'zod';
import type { CalendarCapabilityGate } from '../../../src/contracts/calendar-authority.js';
import type { CalendarAccountCredentialPort } from '../../../src/contracts/calendar-connections.js';
import { calendarConnectionV2Schema, calendarDiscoverySnapshotSchema,
  type CalendarAccountBinding } from '../../../src/contracts/calendar-discovery.js';
import type { CalendarAvailabilityPort } from '../../../src/contracts/calendar-availability.js';
import type { CalendarOperationV2, CalendarRequestKindV2 } from '../../../src/contracts/calendar-operations.js';
import { CALENDAR_LIMITS, type CalendarLimits } from '../../../src/contracts/calendar-policy.js';
import { sourcePermissionSchema } from '../../../src/contracts/calendar-sources.js';
import type { CalendarCall } from '../../../src/contracts/calendar-tools.js';
import { CalendarApi } from '../../../src/plugins/google-calendar/calendar-api.js';
import { CalendarAvailabilityApi } from '../../../src/plugins/google-calendar/calendar-availability-api.js';
import { CalendarApiTools } from '../../../src/plugins/google-calendar/tools.js';
import { toolFault } from '../../../src/plugins/google-calendar/tools-validation.js';
import { fakeFetch, googleJson, googleEvent, type FakeStep } from './tools-fixtures.js';

type MultiOptions = {
  target?: ReturnType<typeof multiTarget>; operation?: CalendarOperationV2 | null;
  calendarCount?: number; steps?: FakeStep[]; call?: CalendarCall;
  availability?: CalendarAvailabilityPort; limits?: CalendarLimits;
  permission?: z.infer<typeof sourcePermissionSchema>; policyDeadlines?: readonly number[];
  headers?: Record<string, string>;
};
export function multiToolsFixture(options: MultiOptions = {}) {
  const target = options.target ?? multiTarget();
  const at = target.verifiedAt;
  const until = new Date(Date.parse(at) + 300000).toISOString();
  const snapshot = calendarDiscoverySnapshotSchema.parse({ schemaVersion: 2,
    connectionId: 'c', connectionRevision: 1, discoveryRevision: 1,
    entries: Array.from({ length: options.calendarCount ?? 1 }, (_, i) => ({
      calendarId: i === 0 ? target.calendarId : `cal-${i}`,
      label: i === 0 ? target.calendarLabel : `Calendar ${i}`, primary: i === 0,
      accessRole: target.accessRole, privateAccess: target.privateAccess,
      timeZone: 'Etc/UTC', selected: true, hidden: false, deleted: false,
      capabilities: target.capabilities })), fetchedAt: at, expiresAt: until,
    complete: true, truncated: false, nextPageToken: null, limitations: [],
    retentionPolicyId: 'fixture-policy', retentionExpiresAt: until });
  const secret = { version: 1, iv: 'fixture-iv', tag: 'fixture-tag', ciphertext: 'fixture-cipher' };
  const record = calendarConnectionV2Schema.parse({ schemaVersion: 2, userId: 'u',
    provider: 'google-calendar', connectionId: 'c', revision: 1, connectionRevision: 1,
    credentialVersion: 1, googleSubjectId: 'sub', accountEmail: null,
    enabled: true, status: 'connected', credentials: { access: secret, refresh: secret },
    tokenExpiresAt: until, grantedScopes: [...CALENDAR_SCOPES], updatedAt: at,
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 1 }, discovery: snapshot });
  const operation = options.operation === undefined ? multiOperation(target) : options.operation;
  const fake = fakeFetch(options.steps ?? [{ method: 'POST',
    path: `/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}/events`,
    response: () => googleJson({ ...googleEvent(), id: operation?.googleEventId,
      extendedProperties: { private: { aurvinOperationId: operation?.operationId,
        aurvinRequestHash: operation?.requestHash } } }, { headers: options.headers }) }]);
  const counts = { calendar: 0, refresh: 0, credential: 0, capability: 0,
    kinds: [] as CalendarRequestKindV2[] };
  const requireAccount = async (account: CalendarAccountBinding, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!record.enabled || record.status !== 'connected' || account.userId !== record.userId
      || account.connectionId !== record.connectionId || account.connectionRevision !== record.connectionRevision
      || account.googleSubjectId !== record.googleSubjectId) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
  };
  const denied = (operation: 'read' | 'create' | 'availability', entry: (typeof snapshot.entries)[number]) =>
    !entry.capabilities[operation === 'read' ? 'readEvents' : operation === 'create' ? 'createEvents' : 'availability'];
  const gate: CalendarCapabilityGate & {
    requireAccount: typeof requireAccount; disable(): void; revision(value: number): void;
  } = {
    requireAccount,
    disable() { record.enabled = false; },
    revision(value) { record.connectionRevision = value; },
    resolve: async input => {
      await requireAccount(input.account, input.signal);
      const id = input.selector === null || input.selector === 'primary'
        ? snapshot.entries.find(e => e.primary)?.calendarId : input.selector;
      const entry = snapshot.entries.find(e => e.calendarId === id);
      if (!entry) return { outcome: 'clarify', code: 'CALENDAR_TARGET_UNKNOWN', candidates: [] };
      if (denied(input.operation, entry)) return { outcome: 'denied', code: 'CALENDAR_TARGET_READ_ONLY' };
      return { outcome: 'resolved', target: calendarResolvedTargetSchema.parse({ ...target,
        calendarId: entry.calendarId, calendarLabel: entry.label, accessRole: entry.accessRole,
        privateAccess: entry.privateAccess, capabilities: entry.capabilities }) };
    },
    requireCurrent: async input => {
      counts.capability++;
      await requireAccount(input.target, input.signal);
      const entry = snapshot.entries.find(e => e.calendarId === input.target.calendarId);
      if (!entry || denied(input.operation, entry)) throw toolFault('policy', 'CALENDAR_TARGET_READ_ONLY');
      if (entry.accessRole !== input.target.accessRole || entry.privateAccess !== input.target.privateAccess) {
        throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      }
    },
  };
  const credentials: CalendarAccountCredentialPort = { withAccessToken: async (input, action) => {
    await requireAccount(input.account, input.signal); counts.credential++;
    return action('fixture-access-token');
  } };
  const tools = new CalendarApiTools({ api: new CalendarApi({ fetcher: fake.fetcher,
    cursorKey: new Uint8Array(32).fill(1) }), gate, credentials,
    connections: { get: async () => structuredClone(record) },
    readDiscovery: async input => {
      await requireAccount(input.account, input.signal);
      return { snapshot: structuredClone(snapshot), grantedScopes: [...record.grantedScopes] };
    }, availability: options.availability ?? new CalendarAvailabilityApi({ fetcher: fake.fetcher }),
    limits: options.limits ?? CALENDAR_LIMITS,
    permission: options.permission ?? { content: 'volatile', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
    policyDeadlines: options.policyDeadlines ?? [Date.now() + 10800000], cursorKey: new Uint8Array(32).fill(1) });
  const input = { binding: multiBinding(target, operation),
    call: options.call ?? { name: 'calendar_create_event' as const,
      arguments: { ...CREATE_ACTION, calendarId: target.calendarId } },
    signal: new AbortController().signal,
    consumeRequest: async (kind: CalendarRequestKindV2) => { counts.calendar++; counts.kinds.push(kind); },
    consumeRefreshRequest: async () => { counts.refresh++; } };
  return { tools, input, fake, requests: fake.requests, counts, gate, credentials, record, snapshot };
}
```

Change only the active `apiToolsFixture`/`ApiToolsFixture` to call this v2 fixture with an **owned** canonical target so its existing callers keep their `/owned/events` scripted paths. Update P5's active create test imports to `multiOperation(multiTarget('owner','owned'))`; do not silently convert a supplied v1 operation into v2 authority. A legacy operation override must be rejected, not promoted. The fixture code must use the exact dependency shape published above and leave clocks dynamic enough for real MCP deadlines. The replacement wrapper/type are:

```ts
export type ApiToolsFixture = ReturnType<typeof multiToolsFixture>;
export function apiToolsFixture(options: Omit<NonNullable<Parameters<typeof multiToolsFixture>[0]>, 'target'> = {}): ApiToolsFixture {
  return multiToolsFixture({ ...options, target: multiTarget('owner', OWNED_CALENDAR) });
}
```

Imports between the two fixture modules refer only to function/constant bindings used after module initialization; keep no module-level `multiToolsFixture()` call that would create an ESM initialization cycle.

**Failing test code** in `tools-multi.spec.ts`:

```ts
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { calendarAvailabilityResultSchema, type CalendarAvailabilityPort }
  from '../../../src/contracts/calendar-availability.js';
import { calendarExecutionEnvelopeV2Schema } from '../../../src/contracts/calendar-operations.js';
import { multiTarget, multiOperation, multiToolsFixture } from './tools-multi-fixtures.js';
import { googleJson, googleEvent } from './tools-fixtures.js';

it.each(['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader'] as const)
  ('intersects current %s capabilities with each event operation', async role => {
    const target = multiTarget(role);
    const f = multiToolsFixture({ target, operation: null, call: {
      name: 'calendar_get_event', arguments: { calendarId: 'shared', eventId: 'abcde01234' } },
      steps: [{ method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234',
        response: () => googleJson(googleEvent()) }] });
    const result = await f.tools.invoke(f.input);
    expect(result.outcome).toBe(role === 'freeBusyReader' ? 'failure' : 'success');
    expect(f.requests).toHaveLength(role === 'freeBusyReader' ? 0 : 1);
    await f.tools.close();
  });

it.each(['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader'] as const)
  ('creates only when current %s capability permits non-private events', async role => {
    const target = multiTarget(role);
    const f = multiToolsFixture({ target, operation: multiOperation(target) });
    const result = await f.tools.invoke(f.input);
    const writable = ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(role);
    expect(result.outcome).toBe(writable ? 'success' : 'failure');
    expect(f.requests).toHaveLength(writable ? 1 : 0);
    if (!writable) expect(result).toMatchObject({ failure: { retry: 'none' } });
    await f.tools.close();
  });

it('does not use a cached writer binding after current rights have been removed', async () => {
  const f = multiToolsFixture();
  f.snapshot.entries[0]!.capabilities.createEvents = false;
  expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: { retry: 'none' } });
  expect(f.requests).toHaveLength(0);
});

it('rejects an old full-private-access binding when the current writer becomes masked', async () => {
  const f = multiToolsFixture({ operation: null, steps: [], call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } } });
  f.snapshot.entries[0]!.accessRole = 'writerWithoutPrivateAccess';
  f.snapshot.entries[0]!.privateAccess = false;
  expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: { retry: 'none' } });
  expect(f.requests).toHaveLength(0);
});

it('denies unknown selectors and stale account bindings before event delivery', async () => {
  const f = multiToolsFixture({ operation: null, steps: [], call: {
    name: 'calendar_get_event', arguments: { calendarId: 'other-calendar', eventId: 'abcde01234' } } });
  f.input.binding = { ...f.input.binding, target: null };
  expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: {
    category: 'clarification', code: 'CALENDAR_TARGET_UNKNOWN', retry: 'none' } });
  expect(f.requests).toHaveLength(0);
  expect(f.counts.credential).toBe(0);
  f.gate.revision(2);
  expect(await f.tools.invoke({ ...f.input, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } } })).toMatchObject({ outcome: 'failure' });
  expect(f.requests).toHaveLength(0);
});

it('fences a disable during durable request admission without recursive capability HTTP', async () => {
  const f = multiToolsFixture({ operation: null, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } }, steps: [] });
  expect(await f.tools.invoke({ ...f.input, consumeRequest: async () => { f.gate.disable(); } }))
    .toMatchObject({ outcome: 'failure' });
  expect(f.requests).toHaveLength(0);
  expect(f.counts.capability).toBeLessThanOrEqual(2);
});
```

- [x] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/tools-multi.spec.ts -t "intersects current|creates only|cached writer|current writer becomes masked|unknown selectors|fences a disable"`. Expect v1-only executor rejection or missing v2 dependency/dispatch support.
- [x] **Minimal implementation:** add the v2 constructor/invoke/readback overloads described above. Use one parsed binding and one linked timeout/close signal. Validate call and v2 binding first. For an event call with a supplied trusted target, require selector consistency and fresh `gate.requireCurrent`; for an unresolved **read**, use `gate.resolve({ selector: call.arguments.calendarId ?? null, operation:'read', ... })`. A resolved primary alias must be canonicalized before calling `CalendarApi`. A create **never** resolves a fresh target from arguments/default: it requires P6's bound target plus `requireCreateAuthority`. Do not implement name matching, proposals, preflight or user acceptance here.

Implement one cheap account fence by parsing `connections.get(binding.userId)` as v2 and comparing current account/subject/connectionRevision, enabled/status and full `calendarGrantStatus`. Use it before/after durable admission and before a credential callback's effect. A preference document CAS/defaultSettingRevision change is not account invalidation. **Do not recursively call a fresh network capability check from the callback that counts that same capability check.** Fresh operation checks happen outside that callback; the cheap store fence wraps all request kinds.

```ts
const admit = async (kind: CalendarRequestKindV2): Promise<void> => {
  signal.throwIfAborted();
  await requireAccount();
  await input.consumeRequest(kind);
  signal.throwIfAborted();
  await requireAccount();
  signal.throwIfAborted();
};
```

`requireAccount` is a private method/closure in the same file, not a new service abstraction. A denied check never requests credentials or events. Supply the **same** `admit` and refresh callbacks to P4, P3 and event contexts. Do not increment logical model-tool/create/model-dispatch counters in this adapter; P6 owns them. `readback` checks current rights/account but pins the operation calendar/ID and returns unknown on replacement, target mismatch, deadline or unavailable evidence. Never resolve the latest default during reconciliation.

- [x] **Verify green**, cwd `backend`: `npm test -- test/plugins/google-calendar/tools-multi.spec.ts test/plugins/google-calendar/tools.spec.ts`. Migrate existing active tests to v2 source/receipt shapes without removing retention, no-credential-before-policy, counted delivery, cancellation or close assertions. Explicitly assert legacy `invoke` makes zero requests and legacy unknown-operation readback is GET-only, with no new v2 receipt.
- [x] **Commit the five named paths:** `git commit -m "feat(calendar): compose v2 execution with fresh capability and account fences"`.

## Task 6: Bind discovery and availability into the executor with bounded snapshot pagination

**Files:** `backend/src/plugins/google-calendar/tools.ts`; `backend/src/plugins/google-calendar/calendar-api-cursor.ts` (only calendar-page use if needed); `backend/test/plugins/google-calendar/tools-multi.spec.ts`; `backend/test/plugins/google-calendar/tools-multi-fixtures.ts`.

- [x] **Write failing tests**; fixture option `calendarCount` creates parsed unique entries and `availability` may inject a strict `CalendarAvailabilityPort` stub:

```ts
it('pages a stable authorized snapshot without exposing Google continuation tokens', async () => {
  const f = multiToolsFixture({ operation: null, calendarCount: 21,
    call: { name: 'calendar_list_calendars', arguments: {} }, steps: [] });
  const first = await f.tools.invoke(f.input);
  expect(first).toMatchObject({ outcome: 'success', result: {
    schemaVersion: 2, tool: 'calendar_list_calendars', complete: true } });
  if (first.outcome !== 'success' || first.result.tool !== 'calendar_list_calendars') throw new Error('wrong result');
  expect(first.result.calendars).toHaveLength(20);
  expect(first.result.nextPageToken).toEqual(expect.any(String));
  const second = await f.tools.invoke({ ...f.input, call: { name: 'calendar_list_calendars',
    arguments: { pageToken: first.result.nextPageToken! } } });
  expect(second).toMatchObject({ outcome: 'success', result: { calendars: [expect.any(Object)], nextPageToken: null } });
  expect(JSON.stringify(first)).not.toContain('raw-google-continuation');
  expect(f.requests).toHaveLength(0);
});

it('uses only the authorized discovery set for availability and preserves incomplete coverage', async () => {
  const seen: Array<Parameters<CalendarAvailabilityPort['check']>[0]> = [];
  const f = multiToolsFixture({ operation: null, calendarCount: 2,
    call: { name: 'calendar_check_availability', arguments: {
      timeMin: '2026-10-21T10:00:00Z', timeMax: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' } },
    availability: { check: async input => {
      seen.push(input);
      await input.consumeRequest('availability');
      return calendarAvailabilityResultSchema.parse({ schemaVersion: 2,
        tool: 'calendar_check_availability', connectionId: 'c', connectionRevision: 1,
        discoveryRevision: input.snapshot.discoveryRevision, availabilityRevision: input.availabilityRevision,
        calendarSetHash: createHash('sha256').update(JSON.stringify([...input.calendarIds].sort())).digest('hex'),
        timeMin: input.timeMin, timeMax: input.timeMax, timeZone: input.timeZone,
        checkedAt: input.now, expiresAt: input.now, semantics: 'google-opaque-busy-only',
        calendars: input.calendarIds.map(id => ({ calendarId: id,
          calendarLabel: input.snapshot.entries.find(e => e.calendarId === id)!.label,
          status: 'error', reason: 'not-found' })), busy: [], free: [],
        coverage: 'incomplete', conflict: 'unknown', truncated: false, limitations: ['calendar-error'] });
    } }, steps: [] });
  expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'success', result: {
    coverage: 'incomplete', conflict: 'unknown', free: [] }, receipt: null });
  expect(seen[0]!.calendarIds).toEqual(f.snapshot.entries.map(e => e.calendarId));
  expect(seen[0]!.purpose).toBe('availability');
  expect(f.counts.kinds).toEqual(['availability']);
  expect(await f.tools.invoke({ ...f.input, call: { name: 'calendar_check_availability', arguments: {
    ...f.input.call.arguments, calendarIds: ['not-discovered'] } } as never }))
    .toMatchObject({ outcome: 'failure', failure: { retry: 'none' } });
  expect(seen).toHaveLength(1);
});
```

- [x] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/tools-multi.spec.ts -t "pages a stable|authorized discovery set"`. Expect missing new-tool dispatch, not permissive mock success.
- [x] **Minimal implementation:** use exhaustive `switch(call.name)` with explicit cases for all five names; no non-get fallthrough to create. Both new cases obtain `readDiscovery` with the trusted account and admission closures, parse snapshot, compare account/revision and actual scopes, and apply current processing policy. List-calendars pages at `min(limits.calendarsPerPage,20)` and shrinks further to fit **whole envelope bytes**, not character count. If byte-limited before the 20th entry, next offset is the first undelivered entry; mark `truncated:true` and `byte-limit` so `complete:false`. A full snapshot spanning ordinary pages can stay `complete:true`, `truncated:false` with an Aurvin next-page cursor. Partial provider snapshot remains partial on every page; never put its raw Google continuation in the result. Invalid/stale/changed snapshot cursors clarify; do not fetch a different snapshot and silently apply the offset. No extra provider-page fetch loop in P5.

Availability defaults to the entire server-bound discovered calendar set, **not** only the write target or writable calendars. Optional `calendarIds` is a subset selector: canonicalize `primary` only via the current snapshot flag, reject unknown/duplicate aliases after canonicalization, and never query outside discovered IDs. Preserve unsupported/hidden/removed coverage honestly through P3 rather than dropping failures to claim clear. An empty/unknown discovered set returns bounded clarification or incomplete unknown coverage, never a complete all-clear.

Pass exact P3 context and lowered limits:

```ts
const result = await this.availability.check({ account, accessToken, signal,
  grantedScopes, policyAllows: true, retentionPolicy,
  now: new Date(this.clock()).toISOString(), deadlineAt: binding.deadlineAt,
  consumeRequest: admit, snapshot, calendarIds, timeMin: call.arguments.timeMin,
  timeMax: call.arguments.timeMax, timeZone: call.arguments.timeZone,
  availabilityRevision: snapshot.discoveryRevision, purpose: 'availability',
  limits: { batchCalendars: this.limits.availabilityBatchCalendars,
    batches: this.limits.availabilityBatches, busyIntervals: this.limits.busyIntervalsIngested,
    workingBytes: this.limits.snapshotBytes,
    resultBytes: availabilityBodyBytes } });
```

Before that call, build the bounded source skeleton for the requested calendar set (Task 7's exact v2 fields) and reserve **its real encoded overhead**, not a fixed 1 KiB assumption. Use fixed-width SHA-256 IDs and conservative ISO timestamps for its final-length fields. The body allowance is:

```ts
const overheadBytes = jsonBytes({ content: [], structuredContent: {
  outcome: 'success', result: null, source: sourceSkeleton, receipt: null } }) - 4;
const availabilityBodyBytes = Math.min(15360, this.limits.resultBytes - overheadBytes);
if (availabilityBodyBytes < 1) throw toolFault('delivery', 'CALENDAR_RESULT_TOO_LARGE');
```

`sourceSkeleton` is the explicit object in Task 7 with this invocation's account, targets, toolCallId, discovery/availability revision, known set hash and source permission; constructing it requires no result or provider call. P3 applies the smaller result allowance and returns honest truncated/incomplete coverage when representable. The final complete envelope is still validated after provider completion; a conservative reservation is not permission to skip the actual check. This matters for 100-calendar source metadata, which can exceed the nominal 1 KiB headroom by itself.

`availabilityRevision` here is bounded result observation metadata, not conflict approval authority; source IDs also include fetched time/result fingerprint. P6 owns persisted recheck revisions/fingerprints and may call P3 directly for preflight. If P6 needs a stronger monotonic revision allocator, return that requirement to P1/P2 rather than adding an in-memory global counter. Internal preflight must never appear as another logical model tool.

No P5 retry loop: a P3 provider error is returned with its classified bounded retry hint; the owning durable runtime decides if remaining budget permits another call. For a P4 401 replay within the same call, maintain discovery/batch delivery counters outside the credential callback and pass **remaining** ceilings to any repeated provider invocation. Refuse when no delivery remains; do not reset the snapshot/scan allowance.

- [x] **Verify green**, cwd `backend`: `npm test -- test/plugins/google-calendar/tools-multi.spec.ts test/plugins/google-calendar/calendar-discovery-api.spec.ts test/plugins/google-calendar/calendar-availability-api.spec.ts`. Add cases for 100 calendars/5 pages, byte-limited page, partial/stale/expired snapshot, changed revision cursor, primary-missing, denied grant, duplicate aliases, freeBusyReader availability, and ≤2 batch deliveries under a credential replay. Assert exact kinds and zero unrelated event-detail requests in availability.
- [x] **Commit the four named paths:** `git commit -m "feat(calendar): expose bounded discovery and honest availability tools"`.

## Task 7: Emit v2 sources and receipts that cannot be relabelled as the current default

**Files:** `backend/src/plugins/google-calendar/tools.ts`; `backend/test/plugins/google-calendar/tools-multi.spec.ts`; `backend/test/plugins/google-calendar/tools.spec.ts`.

- [x] **Write failing assertions**:

```ts
it('keeps source and receipt on the durable operation target after a default change', async () => {
  const target = multiTarget('writer', 'shared');
  const operation = multiOperation(target);
  const f = multiToolsFixture({ target, operation });
  f.record.defaultSetting = { defaultCalendarId: 'different-default', defaultSettingRevision: 9 };
  const value = await f.tools.invoke(f.input);
  expect(value).toMatchObject({ outcome: 'success', result: { target: { calendarId: 'shared' } },
    source: { schemaVersion: 2, operationIds: ['op_1'], toolCallIds: ['tc'],
      targets: [{ calendarId: 'shared', calendarLabel: null }] },
    receipt: { schemaVersion: 2, calendarId: 'shared', googleEventId: operation.googleEventId,
      calendarLabel: null, labelExpiresAt: null } });
  expect(JSON.stringify(value)).not.toContain('different-default');
});

it('does not call an unrelated read a create receipt and binds multi-calendar provenance', async () => {
  const f = multiToolsFixture({ operation: null, calendarCount: 2,
    call: { name: 'calendar_list_calendars', arguments: {} }, steps: [] });
  const value = await f.tools.invoke(f.input);
  expect(value).toMatchObject({ outcome: 'success', receipt: null, source: {
    schemaVersion: 2, operationIds: [], toolCallIds: ['tc'], availabilityRevision: null,
    calendarSetHash: null, discoveryRevision: 1 } });
  if (value.outcome !== 'success') throw new Error('expected discovery');
  expect(value.source.targets.map(t => t.calendarId)).toEqual(f.snapshot.entries.map(t => t.calendarId));
  expect(calendarExecutionEnvelopeV2Schema.safeParse(value).success).toBe(true);
});
```

- [x] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/tools-multi.spec.ts -t "durable operation target|multi-calendar provenance"`. Expect old v1 source/receipt or missing v2 binding.
- [x] **Minimal implementation:** replace v1-only source/receipt construction for the v2 branch with `sourceReferenceV2Schema` and `calendarReceiptV2Schema`. Source includes actual result targets, discovery revision, toolCallIds, optional operationIds and availability revision/set hash. For availability, retain the **entire trusted queried calendar set** in `source.targets`, even when the bounded result omits coverage rows with explicit `byte-limit`/incomplete status; its set hash always refers to that full queried set. Other tools use only their actual returned page/target. Source ID hash includes canonical target IDs, result/tool identity, connection/revision, toolCall/operation IDs and fetched time; equal event IDs on two calendars must produce different sources. Do not treat a read's toolCallId as an external operation ID.

Retention is the intersection of configured permission, all policy deadlines, provider cache/header evidence, discovery/availability expiry and existing 24-hour maximum. Volatile source has zero lifetime and **null target labels**; result data may be transient but is never persisted as retained. Receipt labels/link require retained permission and expire no later than source permission. Build receipt only from a successfully matched create/readback and its original operation ID/target/hash; no current-default lookup and no receipt for read-only tools. If `minimalEvidenceAllowed:false`, deny a create **before dispatch**, because the frozen v2 envelope requires a truthful durable receipt; do not execute then return success with null receipt. Reads can return transient results with no receipt subject to source schema.

```ts
const source = sourceReferenceV2Schema.parse({ schemaVersion: 2, sourceId,
  plugin: 'google-calendar', connectionId: binding.connectionId,
  connectionRevision: binding.connectionRevision,
  operationIds: operation === null ? [] : [operation.operationId], toolCallIds: [binding.toolCallId],
  fetchedAt, expiresAt, redactedAt: null, permission,
  discoveryRevision, availabilityRevision, calendarSetHash,
  targets: resultTargets.map(t => ({ calendarId: t.calendarId,
    calendarLabel: permission.content === 'retained' ? t.calendarLabel : null })) });
```

Finally validate the **whole** `calendarExecutionEnvelopeV2Schema`, including overhead. A read overflow returns `CALENDAR_RESULT_TOO_LARGE`; a potentially dispatched write with unrepresentable success remains `WRITE_OUTCOME_UNKNOWN` / readback, never definitely failed. Keep A1's explicit `.event` narrowing.

- [x] **Verify green**, cwd `backend`: `npm test -- test/plugins/google-calendar/tools.spec.ts test/plugins/google-calendar/tools-multi.spec.ts`. Preserve all existing no-store/no-cache/age/expired-policy and readback tests, now with v2 assertions. Replace the old “create succeeds without minimal evidence” test with pre-dispatch denial plus zero Google requests; this is enforcing P1's stronger v2 contract, not dropping the check. Retain an explicitly legacy receipt decode assertion separately.
- [x] **Commit the three named paths:** `git commit -m "fix(calendar): bind v2 provenance and receipts to actual calendar targets"`.

## Task 8: Register and verify the exact five-tool SDK catalogue including output schemas

**Files:** `backend/src/plugins/registry.ts`; `backend/src/plugins/mcp/calendar-server.ts`; new `backend/test/plugins/registry.spec.ts`; `backend/test/plugins/mcp/calendar-server.spec.ts`; `backend/test/plugins/google-calendar/tools-validation.spec.ts` (catalogue expectation migration).

- [x] **Write these registry tests**:

```ts
import { expect, it } from 'vitest';
import { CALENDAR_TOOLS } from '../../src/contracts/calendar-tools.js';
import { CALENDAR_TOOL_REVISION } from '../../src/contracts/calendar-policy.js';
import { calendarCatalogue, assertCalendarCatalogue } from '../../src/plugins/registry.js';

it('pins all five input/output schemas, revisions and annotations', () => {
  const catalogue = calendarCatalogue();
  expect(catalogue.map(t => t.name)).toEqual(CALENDAR_TOOLS.map(t => t.name));
  for (const [i, tool] of catalogue.entries()) {
    expect(tool.inputSchema).toEqual(CALENDAR_TOOLS[i]!.inputSchema);
    expect(tool.annotations).toEqual(CALENDAR_TOOLS[i]!.annotations);
    expect(tool._meta).toEqual({ 'aurvin/toolRevision': CALENDAR_TOOL_REVISION });
    expect(tool.outputSchema).not.toEqual({ type: 'object' });
  }
  expect(() => assertCalendarCatalogue({ tools: catalogue })).not.toThrow();
  for (const change of [
    (copy: typeof catalogue) => { copy[0]!.outputSchema = { type: 'object' }; },
    (copy: typeof catalogue) => { copy[0]!._meta = { 'aurvin/toolRevision': 'google-calendar.v1' }; },
    (copy: typeof catalogue) => { copy[2]!.annotations.idempotentHint = true; },
    (copy: typeof catalogue) => { copy[0]!.inputSchema.additionalProperties = true; },
  ]) {
    const copy = structuredClone(catalogue); change(copy);
    expect(() => assertCalendarCatalogue({ tools: copy })).toThrow('CATALOGUE_CHANGED');
  }
});
```

Add this exact production-handler assertion inside the existing `withCalendarClient` harness after migrating its active fixture to v2:

```ts
it('advertises and calls exactly five v2 tools through the actual SDK handler', async () => {
  const f = calendarFixture({ operation: null, call: { name: 'calendar_list_calendars', arguments: {} }, steps: [] });
  await withCalendarClient(f, async (client, observed) => {
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(5);
    expect(listed.nextCursor).toBeUndefined();
    expect(() => assertCalendarCatalogue(listed)).not.toThrow();
    for (const definition of CALENDAR_TOOLS) {
      const tool = listed.tools.find(t => t.name === definition.name)!;
      expect(tool.inputSchema).toEqual(definition.inputSchema);
      expect(tool.annotations).toEqual(definition.annotations);
      expect(tool._meta).toEqual({ 'aurvin/toolRevision': 'google-calendar.v2' });
      expect(tool.outputSchema).toEqual(calendarCatalogue().find(t => t.name === tool.name)!.outputSchema);
    }
    const result = await client.callTool({ name: 'calendar_list_calendars', arguments: {} });
    expect(result.structuredContent).toMatchObject({ outcome: 'success', result: { tool: 'calendar_list_calendars' } });
    expect(observed).toContain(CALENDAR_MCP_WIRE);
  });
});
```

- [x] **Prove red**, cwd `backend`: `npm test -- test/plugins/registry.spec.ts test/plugins/mcp/calendar-server.spec.ts -t "pins all five|exactly five v2"`. Expect missing output/revision metadata or old envelope, not a mocked handler.
- [x] **Minimal implementation, only after the required P1 descriptor amendment commits:** consume its exact frozen output descriptor, not a handwritten partial schema, private SDK import, new dependency or `{ type:'object' }` advertisement:

```ts
import { calendarExecutionEnvelopeV2JsonSchema } from '../contracts/calendar-mcp-schema.js';

export function calendarCatalogue(): CalendarCatalogueEntry[] {
  return structuredClone(CALENDAR_TOOLS.map(({ name, description, inputSchema, annotations, revision }) => ({
    name, description, inputSchema, outputSchema: calendarExecutionEnvelopeV2JsonSchema, annotations,
    _meta: { 'aurvin/toolRevision': revision },
  })));
}
```

The installed public `@langchain/core/utils/json_schema` export handles Zod v3 using its shipped converter. P1 must verify/freeze that conversion. Server-side Standard Schema validation still uses P1's actual Zod schema, because JSON Schema cannot encode every cross-field refinement. Do not claim JSON-only validation proves target authority. A missing descriptor/export or unsupported converter is an upstream handoff blocker; no P5 contract edit, manifest amendment or private transitive import is authorized.

Extend `CalendarCatalogueEntry` with `name: CalendarToolName` (not an unbounded string), `outputSchema: Record<string, unknown>`, exact annotations and namespaced revision metadata. Parse/project an advertised name with `calendarToolNameSchema` before indexing shared schemas. Compare the new fields with `isDeepStrictEqual`, not merely accept them as ignorable SDK fields. Keep safe SDK presentation metadata (title/icons) optional/ignored only as currently documented; an unknown field, changed schema, duplicate/missing/extra tool, revision mismatch or paginated catalogue fails closed. Deep copies prevent mutable schema aliases. Assert equality with P1's exact descriptor, retaining every frozen union/strict property/ref rather than replacing it with a permissive object.

Register each tool from that one catalogue using the existing Standard Schema bridge:

```ts
server.registerTool(definition.name, {
  description: definition.description,
  inputSchema: withStandardJsonSchema(calendarInputSchemas[definition.name], definition.inputSchema),
  outputSchema: withStandardJsonSchema(calendarExecutionEnvelopeV2Schema, definition.outputSchema),
  annotations: definition.annotations,
  _meta: definition._meta,
}, handler);
```

`handler` is the existing bound callback, changed to invoke the v2 port and encode the v2 envelope. All identity/account/operation/request callbacks stay in the closure, not parameters, headers or `_meta`. `createCalendarMcpHandler` must reject legacy execution binding for an active handler; keep its old callable type for compilation only, not a v1 catalogue. Catalogue discovery itself performs no Google/capability HTTP request; use the cheap account fence, not a fresh target check for every `tools/list`. The actual invocation performs the fresh operation-specific gate in the direct executor.

Change server version to `2.0.0`; retain `legacy:'reject'`, fetch handler, `content:[]`, failure `isError:true`, bound signal and exact result ceiling. Add actual calls for **each of the five tools** using real direct tools/P3 fixture adapters, including availability success **and** incomplete coverage. Keep every unknown-tool/identity/credential/approval/unsupported-field failure and zero-effect assertion. Replace the old three-tool inline snapshot with exact five-tool structural equality to `calendarCatalogue()` plus explicit literal names/count/revision/selector assertions; do not merely delete it.

- [x] **Verify green**, cwd `backend`: `npm test -- test/plugins/registry.spec.ts test/plugins/mcp/calendar-server.spec.ts test/plugins/google-calendar/tools-validation.spec.ts test/contracts/calendar-multi-mcp.spec.ts`. Add a bad-result fixture whose actual output is malformed; real `client.callTool` must reject/return bounded error under registered output validation, not accept an envelope that merely has a tool name.
- [x] **Commit the five named paths:** `git commit -m "feat(calendar): pin five-tool MCP catalogue and validated v2 outputs"`.

## Task 9: Decode v2 MCP results against trusted call/target and retain transport teardown

**Files:** `backend/src/plugins/mcp/calendar-client.ts`; `backend/src/plugins/mcp/calendar-server.ts` (v2 encoder only); `backend/test/plugins/mcp/calendar-client.spec.ts`; `backend/test/plugins/mcp/calendar-bounds.spec.ts`.

- [x] **Write this failing tamper test** using the existing real-handler response-tampering harness and the v2 active `calendarFixture`:

```ts
it('rejects a valid-shaped wrong-calendar result and source after actual MCP execution', async () => {
  const f = calendarFixture({ operation: null, steps: [GET_STEP], call: {
    name: 'calendar_get_event', arguments: { calendarId: 'owned', eventId: 'abcde01234' } } });
  harness.tamper = body => {
    const rpc = body.result as { structuredContent?: Record<string, unknown> } | undefined;
    if (!rpc?.structuredContent || rpc.structuredContent.outcome !== 'success') return false;
    const result = rpc.structuredContent.result as { target: { calendarId: string } };
    const source = rpc.structuredContent.source as { targets: Array<{ calendarId: string }> };
    result.target.calendarId = 'different-authorized-calendar';
    source.targets[0]!.calendarId = 'different-authorized-calendar';
    return true;
  };
  const host = new EmbeddedCalendarExecution({ tools: f.tools, gate: f.gate, limits: CALENDAR_LIMITS });
  try {
    expect(await host.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: {
      category: 'delivery', code: 'CALENDAR_RESPONSE_INVALID', retry: 'none' } });
    expect(f.requests).toHaveLength(1);
    expect(host.openChannels).toBe(0);
  } finally { await host.close(); }
});
```

Also add a create variant tampering the calendar/event ID/receipt/hash and expect **uncertain / readback**, never a fresh write. For unknown selectors, use the direct gate fixture and assert zero event requests; no assertion that all `calendarId` keys are forbidden.

- [x] **Prove red**, cwd `backend`: `npm test -- test/plugins/mcp/calendar-client.spec.ts -t "valid-shaped wrong-calendar"`. Expect old decoder's missing v2 target checks or envelope incompatibility.
- [x] **Minimal implementation:** add v2 port overloads to `EmbeddedCalendarExecution`, preserving one real channel lifecycle. Parse binding up front; v1 invoke fails with no MCP/Google traffic. Set client negotiation to `{ mode: { pin: CALENDAR_MCP_WIRE } }`, not `auto`; retain endpoint equality and protocol-header checks. Verify the full catalogue from Task 8 before call. Clone the trusted binding once; do not merge request `_meta` or model arguments into it.

Parse the whole emitted MCP result byte length, strict envelope, source and receipt with v2 schemas. Failure envelopes require `isError:true`; success must not have it, content remains empty, no unexpected structured keys are accepted. Check:

- exact requested tool discriminant and requested get-event ID;
- source account/revision/toolCallId, actual result targets, discovery revision and availability set/revision;
- event result canonical target equals bound target or the authorized explicit selector (the direct executor resolves omitted read targets through the gate); no latest-default-derived label;
- availability result account/revision and source/set hash agree; recompute the sorted full queried set hash from `source.targets`, and compare a fully canonical explicit requested subset with that full source set. Complete coverage must have exactly that set of rows; truncated/incomplete rows may be a subset only with honest limitations and no free/all-clear. Do not recompute a full-set hash from truncated rows. Alias/default-set authorization is established against P4's snapshot in the trusted direct executor, not manufactured by the client from a returned label. Do not claim this client has an independent discovery snapshot when none was injected. No detail fields or false complete/clear are accepted;
- create operation/account/target/event ID/request hash/targetRevision/receipt/source agree, and receipt is mandatory under the v2 contract;
- read-only result receipt is null.

For unresolved reads, resolve and bind the read target **once in the host** before constructing its MCP closure, using the injected capability gate and the same counters. Pass that resolved target to the direct executor; the direct executor rechecks current capabilities but does not pick a different default. This gives the client a trusted target to compare against and avoids accepting whichever target a handler claims. Metadata tools keep `target:null`; their account/snapshot set is validated in the direct executor and envelope. Never resolve a create in the host: operation target must already exist.

Keep transport malformed-result errors terminal (`retry:'none'`), not automatically delivery-retryable merely because the SDK threw during a read. Real transient delivery errors retain only the existing bounded durable retry hint. Any malformed/cut-short result after create call phase stays uncertain and readback-only. Preserve finally-close ordering, client-close failure handling, aborted readers, ≤1-second drain, channel removal, idempotent close and closing the one owned direct executor once.

Update `encodeCalendarExecution` to validate v2 before output. Measure the entire `{ content:[], structuredContent, isError? }` object and distinguish valid-but-oversized reads from malformed data **before** collapsing schema errors. Preserve exact 16,384 accepted / 16,385 refused tests by migrating their source/result/receipt builders to valid v2 shapes, including target labels and operation/tool linkage. Do not raise limits or drop the UTF-8 padding test.

- [x] **Verify green**, cwd `backend`: `npm test -- test/plugins/mcp/calendar-client.spec.ts test/plugins/mcp/calendar-bounds.spec.ts test/plugins/integration/embedded-mcp.spec.ts`. Add all-five-tool host coverage, two simultaneous different target bindings, forged target proof, changed output/revision/annotations catalogue, known wrong get ID, mismatch failure flag, no credential in MCP headers, and source/receipt overflow after dispatch. Read-only integration file stays unchanged; its unknown ID case passes through capability denial, with a positive authorized ID test in the owned client suite.
- [x] **Commit the four owned paths:** `git commit -m "fix(calendar): validate target-bound MCP results and preserve safe teardown"`.

## Task 10: Migrate active model dispatches and bounded repairs to v2 without granting authority

**Files:** `backend/src/model/calendar-validation.ts`, `calendar-policy.ts`, `calendar-adapter.ts`, `calendar-repair.ts`; `backend/test/model/calendar-fixtures.ts`, `calendar-validation.spec.ts`, `calendar-policy.spec.ts`, `calendar-adapter.spec.ts`, `calendar-repair.spec.ts`, `calendar-repair-flow.spec.ts`.

- [x] **Write failing diagnostic and repair tests** in their existing files:

```ts
it('preserves bounded selector diagnostics for v2 inputs without echoing values', () => {
  const batch = candidate('{"eventId":"abcde","calendarId":7}');
  expect(validateCalendarCandidate(batch, CALENDAR_TOOLS, CALENDAR_LIMITS)).toMatchObject({
    kind: 'rejected', diagnostics: [{ path: 'calendarId', code: 'wrong-type', expected: 'string' }] });
  expect(normalizeDiagnostics([{ path: 'calendarIds', code: 'wrong-type', expected: 'bounded-value' }],
    CALENDAR_LIMITS)).toEqual([{ path: 'calendarIds', code: 'wrong-type', expected: 'bounded-value' }]);
});

it('repairs selector structure once but never repairs an approval or credential denial', async () => {
  const run = await runFixtureTurn(['{"eventId":"abcde","calendarId":7}',
    '{"eventId":"abcde","calendarId":"shared"}']);
  expect(run.posts).toBe(2);
  expect(run.repairsUsed).toBe(1);
  expect(run.execute).toHaveBeenCalledWith(expect.objectContaining({ call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde', calendarId: 'shared' } } }));
  expect(run.observedDispatchIds.size).toBe(2);
  for (const field of ['confirmed', 'conflictAccepted', 'accessToken', 'connectionId']) {
    const denied = await runFixtureTurn([JSON.stringify({ eventId: 'abcde', [field]: true }),
      '{"eventId":"abcde","calendarId":"shared"}']);
    expect(denied.posts).toBe(1);
    expect(denied.execute).not.toHaveBeenCalled();
    expect(denied.repairsUsed).toBe(0);
  }
});
```

In `calendar-policy.spec.ts`, use the existing config/request/limits fixture to add:

```ts
it('requires a v2 charged dispatch for the five-tool catalogue', () => {
  const request = calendarRequest();
  const binding = calendarBinding(); // Migrate this active helper to v2 below.
  const body = buildCalendarBody(config(), calendarLimits, request, binding);
  expect((body.tools as Array<{ function: { name: string; parameters: unknown } }>).map(t => t.function.name))
    .toEqual(CALENDAR_TOOLS.map(t => t.name));
  expect(body.user).toBe(config().identity.userId);
  const before = structuredClone(binding.budget);
  expect(() => buildCalendarBody(config(), calendarLimits, request, { ...binding,
    dispatch: { ...binding.dispatch, schemaVersion: 1, schemaRevision: 'google-calendar.v1' } as never }))
    .toThrow();
  expect(binding.budget).toEqual(before);
});
```

- [x] **Prove red**, cwd `backend`: `npm test -- test/model/calendar-validation.spec.ts test/model/calendar-policy.spec.ts test/model/calendar-repair-flow.spec.ts -t "selector diagnostics|repairs selector|v2 charged"`. Expect new paths collapsed to `$` and v1-only dispatch parsing. Distinguish currently passing policy-denial regressions from the actual newly red cases.
- [x] **Minimal implementation:** add `calendarId`/`calendarIds` to `calendar-validation.ts`'s local diagnostic allowlist, keeping safe enum normalization, deduplication, count/char budget, strict JSON duplicate-key/escaped-key/depth/byte scanning and forbidden-field precedence. Do not invent an `array` expected enum: P1's enum has no array member, so invalid array shape uses **`bounded-value`** and the allowed `calendarIds` path. No raw selector/provider prose enters diagnostics.

Use the existing frozen `CALENDAR_TOOLS` for model inputs and exact revision comparison (preserve A1). Add a versioned dispatch binding type in `calendar-policy.ts` using `CalendarModelDispatchV2`; keep the legacy input type accepted only so old callers compile and receive bounded rejection. Parse **new** tool-bearing dispatches with `modelDispatchV2Schema`; preserve the existing v1 turn-budget schema because P1 intentionally did not change it. Do not change prices, model catalogue evidence, user attribution, reservation math, deadline, spend/token estimation, repair counters, dispatch indexes, or history inclusion.

Add `createCalendarModelPortV2` exported from `calendar-adapter.ts`, returning `CalendarModelPortV2`. Reuse the existing stream body and one-shot `used` guard; emit `rejectedDecisionV2Schema` evidence with `schemaVersion:2`, `schemaRevision:CALENDAR_TOOL_REVISION` and unchanged charged indexes. Keep the old factory/class signatures as a legacy entry path that refuses a new tool dispatch before HTTP; do not parse v1 with the v2 schema and fabricate fields. A small version-dispatched implementation is preferable to duplicating the stream parser/retry/accounting loop. P6 imports the v2 factory directly; `model/index.ts` remains outside this task's write set.

Migrate **active** `calendarBinding()`/`calendarHarness()` fixtures to v2 dispatch/schema and v2 factory. Keep `fixturePricing`, `nativeFrame`, wire data, and turn-budget formats unchanged because other owners consume them. Update owned tests importing the old factory from `model/index.ts` to import the v2 factory from `model/calendar-adapter.js`; keep a separate explicit legacy factory test with zero `fetcher` calls. Do not silently upgrade a legacy persisted model dispatch in a fixture helper.

For native tool history, accept `completeToolGroupV2Schema` with v2 provenance on the v2 path and preserve complete assistant/result adjacency, same tool identity, unique toolCallIds, accepted input once and source expiry. Legacy groups may be rendered/read as legacy history; never turn a legacy resumable decision/checkpoint into fresh execution. Keep `repairInstruction`'s prohibition on changing authorized targets/accounts or bypassing denials; no canonical-JSON confirmation instruction is added here. P8 owns fixed system/product instructions and P6 owns actual authorization.

- [x] **Verify green**, cwd `backend`: `npm test -- test/model/calendar-`. Retain charged-second-repair and ninth-dispatch rejection tests, two-repair exhaustion, malformed/extra/missing fields, structural-versus-policy classification, complete native groups, attribution on every attempt, no private reasoning and no earlier tool re-execution. Add streamed fixture cases for both new tool names using the five exact schema definitions; a structurally valid selector never itself asserts permission or executes Google.
- [x] **Commit the ten named paths:** `git commit -m "feat(calendar): migrate model catalogue validation and charged repairs to v2"`.

## Sequential verification and worker handoff

After every task: `git diff --check`, inspect only named task files, ask for the serialized commit slot, stage explicit paths and commit the stated message. Never `git add .`, amend another owner's commit, or include concurrent P4 work. No commit until the orchestrator grants the index turn. Each task's test command must discover at least one named test; a no-tests result is not green.

When all focused checks pass, run these commands **individually and sequentially**, cwd `backend`:

1. `npm run build`
2. `npm run lint`
3. `npm test`
4. `npm run test:e2e`

Never race build with bootstrap tests. Then run `npm test -- test/plugins/integration/embedded-mcp.spec.ts` separately to record the previously red selector consumer, and the explicit P5 discovery/availability/registry/model suites if their results were obscured by another owner's failure. P3's 44 focused provider tests and P1's contract/MCP compatibility suites remain read-only regressions, not replacements for production SDK tests.

Native suites require operator-supplied `AURVIN_TEST_MONGODB_URI` and exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; do not set them, print them, create/drop databases, or connect to a database in this task without the separate authorization/prerequisites. Report prerequisite skips separately (the current baseline is 22 e2e passes / 125 native skips). No Google OAuth, real Calendar/model calls, browser deployment, Google Cloud setting changes, application-data migrations or live writes are authorized. Live owned/shared/read-only/ACL/quota/consent evidence remains P9's separately authorized service gate.

Report exact commits and environment, focused test counts, package pass/fail/skip counts and warnings. P4 OAuth and P8 assembly failures may remain while their workers are pending; name each remaining file/owner and compare against the 34-test baseline. They are open integration gates, **not** a P5 full-suite pass. Newly introduced failures must be corrected by their owner before P5's exit gate is claimed. Do not change neighboring assertions or increase budgets to clear them.

### Exit-gate mapping

| P5 exit requirement | Tasks / concrete evidence |
| --- | --- |
| Exactly five real SDK tools, authoritative schemas/revisions, output validation | 1, 8, 9; real handler/client/fetch calls for all five, catalogue tampering and output-schema validation |
| Selector positions only; IDs never create authority | 1, 2, 5, 9, 10; positive shared selectors plus unknown/forged/nested/approval/credential denial |
| Owner/shared writer/private-masked writer/reader/free-busy matrix | 4, 5, 6; separate read/create/availability assertions and zero prohibited event deliveries |
| Target-bound cursors, event IDs, sources and receipts | 2, 3, 4, 7, 9; wrong calendar/range/snapshot/account/kind/expiry and default-change tests |
| Stable IDs, no invitations, matched readback, no silent create replay | 2, 4, 5, 7, 9; exact POST body/query, uncertain outcomes, original-target GET readback |
| Strict policy versus structural repairs and unchanged finite budgets | 1, 6, 9, 10; exact request categories, lowered bytes, charged repairs/exhaustion/ninth dispatch |
| Legacy read-only compatibility and preserved A1 fixes | 2–5, 8–10; explicit v1 decode/GET-only reconciliation, zero legacy fresh dispatch, current revision constant |
| No P6 preflight/proposal orchestration or P4/P8/P9 ownership violation | File map and handoff checks; no runtime/lifecycle/assembly/reserved integration writes |

Acceptance contributions: **AC03, AC06, AC08, AC09, AC10, AC12, AC13**. Full AC07 preflight/approval, AC04/05 conversational precedence, UI, isolated native/live service acceptance and final workflow completion remain downstream, not established by this plan.

P5 handoff to P6/P8 must include the exact constructor overloads and discovery/account-fence adapter mapping, v2 execution/model factory imports, selector canonicalization rules, failure categories, source/receipt/cursor versions, counted request/refresh callbacks, non-retryable create boundary, legacy quarantine/readback behavior, and the exact tested commit set. Call out the required **P1 output-descriptor amendment**, any unresolved P4 lifecycle/account-fence mapping, write-aware credential replay, SDK JSON-schema incompatibility or frozen-port mismatch before integration. No schema/ownership amendment is implicit in this plan.
