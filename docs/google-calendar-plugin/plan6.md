# P6 — Durable Calendar Tool Loop and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task; use `test-driven-development` before implementation and `systematic-debugging` for observed failures. Do not dispatch a reviewer: unified review is **skipped**.

**Goal:** Execute bounded text-chat Calendar decisions with durable authority, accounting, complete native message groups, honest operation outcomes, and recovery that never silently repeats inference or an external write.

**Architecture:** Extend the existing single `DurableChatRuntime`, owner lease, acceptance marker, reference assembler, and prepare/generate/seal graph. A small Calendar branch consumes P1 contracts and the committed P2/P3/P4/P5 ports; MongoDB evidence, not a graph checkpoint or streamed narration, authorizes continuation. Keep native messages and volatile Calendar content outside checkpoints; preserve the existing legacy finalization path.

**Tech Stack:** Existing TypeScript/NodeNext, LangGraph, Zod, Vitest, P2 repositories, P4 native OpenRouter port, and P5 embedded MCP execution port. No dependencies, routes, collections, OAuth flow, or persistence owner are added by P6.

## Steps

- [ ] Establish runtime seams and deterministic fixtures without changing existing text behavior.
- [ ] Assemble complete, bounded, permission-aware current-turn tool groups.
- [ ] Persist budgets, reservations, dispatch observations, and terminal aggregates.
- [ ] Establish canonical authorization and operation-first single-write dispatch.
- [ ] Implement bounded graph decision, repair, execution, and narration routing.
- [ ] Publish durable Calendar results independently of narration success.
- [ ] Reconcile crash windows and explicit retries without unsafe replay.
- [ ] Enforce cancellation, disconnect, drain, connection invalidation, and voice separation.
- [ ] Run focused and package checks; report exact P8 interfaces and remaining gates.

## 1. Scope and execution rules

Read [goal.md](goal.md), [research.md](research.md), and the P6 ownership/exit gate in [state.md](state.md). The dated approval in state closes the stale pending-approval paragraph in goal. P1–P5 workers are complete; P3 OAuth is **not** a planning or implementation task here.

Own only:

- `backend/src/agent/**`, `backend/src/chat-runtime/**`, `backend/src/context/**`.
- `backend/test/runtime/**`, `backend/test/context/**`.
- Only necessary type compatibility changes to `backend/src/voice/agent/agent-voice-adapter.ts` and its corresponding existing tests. Prefer no voice source change.

Do not edit `app.service.ts`, `app.module.ts`, `main.ts`, HTTP/operations, instructions, contracts, model adapters, plugin implementations, persistence, dependency files, or frontend. P8 owns composition, transport, fixed instructions, operations, and runbooks. Return a discovered upstream defect or missing shared contract to its owner; never work around it with a raw database write, new owner, invented field, or broader permission.

All commands below run from `backend/`, except explicit Git commands, which run from the repository root. Node must satisfy `^22.22.3 || ^24.15.0 || >=26.0.0`. Tests use deterministic model/Google fixtures, never live Google/OpenRouter. Native suites run only with the operator-supplied isolated URI and exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; do not print credentials. Native absence is a skip, not evidence of a pass.

Before each commit obtain the orchestrator's serialized staging/commit turn. Stage the task's named files only; leave `plan7.md`, `.openchamber/`, private settings, and unrelated changes alone. Use separate PowerShell commands, not `&&`.

**Stop and report** if implementing this plan would change the approved embedded transport, single-user/local boundary, tools/actions, finite limits, repair contract, or retention. Conservative refusal/clarification when authority or evidence is missing is required, not permission to weaken a gate.

## 2. Source-backed contracts to reuse

Do not reinterpret these interfaces from older Phase 1 descriptions:

| Committed surface | P6 use and important constraint |
| --- | --- |
| `src/contracts/calendar-policy.ts` | `CALENDAR_LIMITS`, `CalendarLimits`, `CalendarOptions`, `CalendarFailure`. Defaults: 8 dispatches, 2 corrections, 6 sequential logical tools, 1 create, 20 Calendar requests, 2 refresh requests, 2 delivery retries; 16 KiB arguments/results; 20 seconds/tool within original turn deadline; estimated USD 1.00 admission. Smaller configured values apply. |
| `src/contracts/calendar-model.ts` | `CalendarModelPort`, `CalendarDecisionRequest`, decision/rejection/resumable schemas, `CompleteCalendarToolGroup`. A result is paired with exactly one native assistant call by ID **and name**. |
| `src/model/calendar-adapter.ts`, `calendar-policy.ts`, `calendar-repair.ts` | `createCalendarModelPort`, `CalendarDispatchBinding`, `estimateCalendarInput`, `rebuildCalendarMessages`, `repairInstruction`. Each adapter is single-use and makes **one** HTTP dispatch. P6 owns retries. `beforeDispatch` must persist the dispatched marker; observations are durably saved before the adapter advances. |
| `src/contracts/calendar-accounting.ts`; `src/persistence/calendar-accounting.ts` | `reserveUsd`, `sumUsd`, `withinSpendCap`; the `CalendarAccountingStore` methods. **`putDispatch(reserved)` claims modelDispatches, repairs, and money itself**. `compareAndSwapBudget` is only for logical tools/creates/Calendar/refresh counters; do not increment dispatch/repair/money there. |
| Concrete P2 accounting extension | `reconcileReservations(userId, sessionId, turnId)` repairs a persisted reservation draft/claim gap; `listAttemptAccounting` supplies preferred aggregate-versus-legacy reads. Consume these existing methods through narrowed local ports, not direct driver access. |
| `src/contracts/calendar-operations.ts`; `src/persistence/calendar-operations.ts` | `getByTurn`, `reserve`, CAS, append/list events; one operation key per accepted turn. States: planned, dispatching, succeeded, definitely-failed, unknown, evidence-expired. Immutable authority/receipt; revisions and event sequences advance together. `unknown -> dispatching` requires consumed absent-readback evidence. |
| Concrete P2 operation extension | `putReconciliation` records `{ operationRevision, eventId: googleEventId, outcome, connectionRevision, targetRevision, checkedAt }` before an absent-readback retry. Its observation key is immutable: do not overwrite an unknown/mismatch observation with an invented absent result. If this prevents a later safe transition, quarantine and report rather than bypass it. |
| `src/persistence/calendar-evidence.ts` | Immutable `calendarDecisions.put/get/putRejected`, `calendarResults.put/get`. `get` redacts expired sources. A stored decision cannot later be rewritten to attach an operation; assign a deterministic operation ID before its first save. |
| `src/persistence/calendar-retention.ts` | `registerSource`, `redactSource` and source-linked reads. Use ports under the existing owner. P8 owns cleanup scheduling and backup/restore policy. |
| `src/persistence/calendar-checkpoints.ts` | `calendarRefs` shape is exactly `{version:1,userId,sessionId,turnId,decisionIds,toolCallIds,operationId}` (max 8 decisions/6 calls). Checkpoints reject native `tool_calls`/`tool_call_id` and credential keys. Do not serialize provider messages, raw arguments/results, config snapshots, or tokens. |
| `src/plugins/google-calendar/connection.ts` | P3 `currentBinding()` and `requireCurrent(binding, signal)`; refresh/rotation live in `CalendarCredentialPort`. Bind trusted identity and recheck current connection/target before advertisement, after awaits/pauses, and before effects. Never resume with a replacement account. |
| `src/plugins/google-calendar/tools-validation.ts` | Reuse `validateCalendarCall`, `calendarActionHash`, `calendarEventId`, `CalendarToolFault`. Semantic/timezone/unsupported-feature validation already exists; do not write a second date parser or add a creation-duration cap. Schema-valid arguments are not proof of user authorization. |
| `src/plugins/mcp/calendar-client.ts` | Inject `CalendarExecutionPort` implemented by `EmbeddedCalendarExecution`; model-requested calls go through real MCP. `readback` is the trusted same-ID recovery path and intentionally uses the underlying readback port. P6 supplies durable request callbacks. P5 does not own durable counters, operation transitions, or retry loops. |
| `src/contracts/calendar-sources.ts`, `calendar-wire.ts`, `message.ts` | Permission-aware retained/reference/tombstone results; independently permitted minimal evidence; `sourceProvenance` on derived assistant messages; `CalendarTurnState` and protocol-v2 progress/operation frames. A receipt is emitted only after succeeded operation + durable event evidence. |
| Existing `durable-chat-runtime.ts`, `work.ts`, `finalization.ts`, `reconciliation.ts` | Preserve acceptance-before-inference, one active session attempt, sync saver, owner fencing, tracked pending writes, finalizing recovery, and existing text/live-voice accounting. Never call `graph.invoke(null)` during automatic recovery. |

Current LangGraph documentation confirms conditional edges and `durability: 'sync'`; replay resumes by **re-executing downstream nodes**, not by making side effects exactly-once. `recursionLimit` is a top-level invoke option. Keep the installed `Annotation` API/pinned version, verify it with real `MemorySaver` tests, and do not upgrade packages based on newer documentation examples.

## 3. File map and fixed design choices

New focused source files:

| File | Responsibility |
| --- | --- |
| `backend/src/chat-runtime/calendar-ports.ts` | Optional Calendar dependency seam and internal reference-only cursor/seal types. Narrow the concrete P2 extensions here. |
| `backend/src/context/calendar-context.ts` | Reconstruct complete current-turn native groups from validated decisions/results; permission, size, group, and schema-headroom checks. |
| `backend/src/chat-runtime/calendar-budget.ts` | Durable counter admission, dispatch reservations/observations, and once-per-attempt terminal aggregate. |
| `backend/src/chat-runtime/calendar-operation.ts` | Exact user-action authorization, one operation reservation, CAS/events, same-ID delivery/readback. |
| `backend/src/chat-runtime/calendar-loop.ts` | One native decision per graph step, clean repair routing, current binding checks, and terminal decision references. |
| `backend/src/chat-runtime/calendar-publication.ts` | Reference-only seal verification, archive/manifest publication and safe operation wire projection. |
| `backend/src/chat-runtime/calendar-recovery.ts` | Read evidence before continuation; classify missing decisions, partial results, uncertain effects and explicit retry eligibility. |

Modify:

- `backend/src/chat-runtime/ports.ts`: optional dependencies, additive Calendar emit callback and status method.
- `backend/src/chat-runtime/index.ts`: export the new public runtime types.
- `backend/src/chat-runtime/durable-chat-runtime.ts`: acceptance, execution branch, cancellation/retry/reconciliation and publication delegation. Do not duplicate its legacy inference body.
- `backend/src/chat-runtime/finalization.ts`, `reconciliation.ts`: delegate Calendar evidence handling before legacy finalization/interruption; retain legacy behavior.
- `backend/src/chat-runtime/work.ts`: enforce stop-dispatch barrier if needed; retain tracking of timed-out writes.
- `backend/src/agent/state.ts`, `turn-graph.ts`: bounded reference-only Calendar channels and conditional branch; retain `seal` as the terminal attribution node.
- `backend/src/context/referenced-context-assembler.ts`: reject/redact expired derived history at read time without changing message identity or silently dropping history.

Tests:

- Extend `backend/test/runtime/text-config-fixture.ts` with a dependency decorator and same-store restart helper; leave defaults unchanged.
- Create `backend/test/runtime/calendar-runtime.fixture.ts`, `calendar-budget.spec.ts`, `calendar-loop.spec.ts`, `calendar-operation.spec.ts`, `calendar-publication.spec.ts`, `calendar-recovery.spec.ts`, `calendar-lifecycle.spec.ts`.
- Create `backend/test/context/calendar-context.spec.ts`; extend `backend/test/context/referenced-context-assembler.spec.ts` for source expiry.
- Extend `backend/test/runtime/graph.spec.ts`, `voice-output.spec.ts` for reference-only graph and live-voice exclusion. Change corresponding voice-agent tests only if the optional emit typing actually requires it.
- Create `backend/test/runtime/calendar-recovery.native.e2e-spec.ts` using the existing `native-harness.ts` only for isolated DB durability checks; all Google/model behavior remains scripted.

### Internal API and invariants

Keep the existing `ExecuteTurn.emit(StreamEnvelope)` signature so P6 does not force edits to P8-owned HTTP or voice assembly. Add `emitCalendar?: (event: CalendarStreamEnvelope) => Promise<void>`. For a tool-enabled accepted attempt it is required; missing support fails before inference, rather than dropping receipts or running an already-bound turn as legacy text. For legacy/live attempts it is never used. All frames for a Calendar execution, including ordinary delta/status/completed frames, use the one protocol-v2 callback and one increasing sequence. Do not interleave two independent sequence counters.

Add `getCalendarTurnState(userId, sessionId, turnId): Promise<CalendarTurnState | null>` to the concrete runtime and as an optional additive `ChatRuntime` capability. This does not change the P1 status HTTP schema. P8 consumes it for durable operation replay/transport composition.

In `calendar-ports.ts`, use these types (imports use `.js`):

```typescript
export type CalendarRuntimeDependencies = {
  connection: CalendarConnectionGate & {
    currentBinding(): Promise<CalendarConnectionBinding>;
  };
  execution: CalendarExecutionPort;
  createModelPort: typeof createCalendarModelPort;
  trustedTimeZone: string;
  permission: { content: 'volatile' | 'retained'; minimalEvidenceAllowed: boolean; policyId: string };
  auditDeadlineAt?: string;
};

export type CalendarAccountingPort = CalendarAccountingStore &
  Pick<PersistenceBundle['calendarAccounting'], 'reconcileReservations'>;
export type CalendarOperationsPort = CalendarOperationStore &
  Pick<PersistenceBundle['calendarOperations'], 'putReconciliation'>;

export type CalendarCursor = {
  version: 1;
  configRevision: number;
  connectionId: string;
  connectionRevision: number;
  targetRevision: number;
  trustedNow: string;
  trustedTimeZone: string;
  limits: CalendarLimits;
  next: 'decide' | 'execute' | 'seal';
  pendingDecisionId: string | null;
  repair: { rejectedDecisionId: string; diagnostics: CalendarRepairDiagnostics } | null;
};

export type CalendarSeal = {
  version: 1;
  input: GraphInput;
  base: Boundary;
  target: AgentMemoryManifest;
  finalDecisionId: string;
  dispatchIds: string[];
  operationId: string | null;
  outcome: 'completed' | 'truncated';
  assistantCreatedAt: string;
};
```

`CalendarCursor`/`CalendarSeal` need local strict Zod schemas in `agent/state.ts`, using existing schemas, at most 8 unique dispatch IDs, no message content, and exact scope/linkage checks at use sites. `calendarRefs` uses P2's exact bounded shape; its arrays replace rather than append with a reducer. Calendar evidence is **not** added to the legacy `SavedResult` shape. Add separate nullable `calendarCursor`, `calendarSeal`, `calendarRefs` channels to `TurnState`; leave missing legacy channels readable as null. A single graph seal marker may validate either a legacy result or a Calendar seal, never both.

Deadlines originate at the accepted turn's first `createdAt` plus its captured `totalRunTimeoutMs`; capture and persist once. The Work timer, model request, delivery request, retries, and repairs all use the remaining duration. Explicit retry cannot extend it. Never generate a replacement deadline because settings or process changed.

## Task 1: Add the optional seam and reusable deterministic harness

**Files:** Create `backend/src/chat-runtime/calendar-ports.ts`, `backend/test/runtime/calendar-runtime.fixture.ts`; modify `backend/src/chat-runtime/ports.ts`, `index.ts`, `backend/test/runtime/text-config-fixture.ts`; test `backend/test/runtime/calendar-lifecycle.spec.ts`.

- [ ] **1. Write the first failing seam test.** Add this test before introducing the optional types/dependency decorator:

```typescript
import { textConfigFixture } from './text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';

it('keeps ordinary text working when Calendar dependencies are absent', async () => {
  const h = textConfigFixture(textSnapshot(1), dependencies => dependencies);
  try {
    const ids = await h.submit('Hello');
    await h.execute(ids);
    expect((await h.runtime.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status)
      .toBe('completed');
    expect(await h.runtime.getCalendarTurnState(h.identity.userId, ids.sessionId, ids.turnId))
      .toBeNull();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  } finally { await h.dispose(); }
});
```

- [ ] **2. Run red.** `npm test -- test/runtime/calendar-lifecycle.spec.ts -t "keeps ordinary text"`. Expect the missing decorator/status-method failure, not a service/network prerequisite.
- [ ] **3. Add the minimal optional seam.** Add `calendar?: CalendarRuntimeDependencies` to `RuntimeDependencies`, `emitCalendar?` to `ExecuteTurn`, and the additive status method. Until operation support is implemented its null result is valid only when the Calendar dependency is absent. Do not ship a null stub for enabled Calendar. Extend the fixture factory's second optional parameter with this exact default and preserve the existing fixture construction:

```typescript
decorate: (dependencies: RuntimeDependencies) => RuntimeDependencies = value => value
```

Build the existing dependencies object as a `RuntimeDependencies` value, pass that complete value to `decorate`, then construct `let runtime = new DurableChatRuntime(deps)`. Return a getter `get runtime() { return runtime; }` and `restart()` that stops/drains the old runtime, then creates `runtime = new DurableChatRuntime(deps)` without replacing `p`, current-config pointer or `saver`. Preserve `dispose`, `submit`, and `execute` closing over the current runtime. Never drain an intentionally unresolved promise in a crash fixture; use a write-fails-before/after-commit injection and release its latch explicitly. This restart helper proves persisted-evidence selection, not OS-level process death; native checks supply real repository evidence.

The new Calendar harness decorates this existing fixture, rather than copying its sessions/messages/owner implementation. Attach small schema-valid in-memory Calendar port doubles to `p`; implement only the existing public methods, including the concrete `reconcileReservations`/`putReconciliation` extensions. Enforce the real P2 rules in the doubles: immutable decision/result/aggregate inserts; turn-keyed operation uniqueness; revision/sequence CAS; persisted dispatch claims consume budgets; dispatched holds cannot become released; absent evidence consumed before unknown-write redelivery. Compare these doubles against P2 tests while writing them. P9/native tests must cover actual repositories as well, so a permissive double cannot certify durability.

Provide these exact fixture controls for the following tasks:

```typescript
type CalendarFixtureControls = {
  modelWires: string[];
  modelBodies: Record<string, unknown>[];
  effects: { kind: 'create' | 'readback' | 'get' | 'list'; eventId: string | null }[];
  order: string[];
  frames: CalendarStreamEnvelope[];
  setBinding(binding: CalendarConnectionBinding | null): void;
  failOnce(point: 'acceptance' | 'dispatch-claim' | 'before-provider' | 'decision-save' |
    'operation-reserve' | 'operation-dispatch' | 'operation-event' | 'receipt-save' |
    'result-save' | 'checkpoint-seal' | 'aggregate-save' | 'archive-save' |
    'manifest-save' | 'terminal-cas', afterCommit?: boolean): void;
  execute(ids: SubmitTurnResponse, signal?: AbortSignal): Promise<void>;
};
```

`calendarFixture()` returns the base fixture plus these controls. Its snapshot has `calendar.enabled: true`, `processingPolicyId: 'fixture-policy'`, approved fixture-only permissions, known fixture pricing, and valid model limits. Use existing `nativeFrame`/`nativeWire` helpers from `test/model/calendar-fixtures.ts`, `googleJson`/`googleEvent` from `test/plugins/google-calendar/tools-fixtures.ts`, and actual P4 adapter factory. The fetcher accepts only scripted OpenRouter chat-completion and Calendar URLs, rejects every other request, and records no Authorization header. For the full-loop tests wrap `CalendarApiTools` with the real `EmbeddedCalendarExecution`; for single ledger tests inject the narrow port double. The owner double must reject competing active attempts and expose fences, not just always return true.

When dequeuing a model wire, replace helper defaults `gen_fixture`/`call_1` consistently throughout that wire with dispatch-specific fixture IDs; rejected and regenerated calls must have different identities. Preserve explicitly named test IDs. The Calendar fixture records accepted POST bodies by supplied event ID and returns exactly their summary/start/end/zone/optional fields/private operation linkage; a subsequent readback GET reads that same saved fixture event. GET-by-ID returns the requested ID, not the helpers' unrelated default. An unexpected or unqueued model request fails immediately; never fabricate a default final narration. This makes the external-success/receipt-loss test a real fixture success followed by a local fault rather than an accidentally mismatched provider response.

- [ ] **4. Run green and regressions.** `npm test -- test/runtime/calendar-lifecycle.spec.ts test/runtime/text-config.spec.ts test/runtime/execution-reservations.spec.ts`. Expect executed passes and zero external requests.
- [ ] **5. Commit.** `git add -- backend/src/chat-runtime/calendar-ports.ts backend/src/chat-runtime/ports.ts backend/src/chat-runtime/index.ts backend/test/runtime/text-config-fixture.ts backend/test/runtime/calendar-runtime.fixture.ts backend/test/runtime/calendar-lifecycle.spec.ts`; `git commit -m "feat(calendar-runtime): add optional text execution seam and fixtures"`.

## Task 2: Build valid, bounded Calendar context without checkpoint content

**Files:** Create `backend/src/context/calendar-context.ts`, `backend/test/context/calendar-context.spec.ts`; modify `backend/src/context/referenced-context-assembler.ts`, `backend/test/context/referenced-context-assembler.spec.ts`.

- [ ] **1. Add failing context tests.** Export `calendarContext` with this input/output contract; the first tests must exercise real `rebuildCalendarMessages`/`estimateCalendarInput` rather than stubbing them:

```typescript
type CalendarContextInput = {
  context: AssembledContext;
  acceptedInput: string;
  groups: readonly CompleteCalendarToolGroup[];
  repair: CalendarDecisionRequest['repair'];
  tools: CalendarDecisionRequest['tools'];
  budgets: BudgetConfig;
  limits: CalendarLimits;
  binding: CalendarConnectionBinding;
  volatileSourceIds?: ReadonlySet<string>;
  now: number;
};
type CalendarContextOutput = {
  messages: NativeCalendarModelMessage[];
  estimatedInputTokens: number;
  remainingContextTokens: number;
};
```

In the test import `AssembledContext` from `contracts/context`, the Calendar schemas/types from their frozen contract files, P4 `repairInstruction`, `CALENDAR_TOOLS`, `CALENDAR_LIMITS`, and `DEFAULT_BUDGETS`. Define the complete deterministic boundary before the assertions:

```typescript
const now = Date.parse('2026-10-21T09:00:00.000Z');
const binding: CalendarConnectionBinding = { userId: 'u', connectionId: 'c',
  connectionRevision: 1, googleSubjectId: 'sub', calendarId: 'owned', targetRevision: 1 };
const source: CalendarSourceReference = { schemaVersion: 1, sourceId: 'source-one',
  plugin: 'google-calendar', connectionId: 'c', connectionRevision: 1,
  operationIds: ['call-one'], fetchedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60000).toISOString(), redactedAt: null,
  permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' } };
const group = completeToolGroupSchema.parse({
  assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call-one', type: 'function',
    function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde"}' } }] },
  result: { role: 'tool', tool_call_id: 'call-one', name: 'calendar_get_event',
    content: JSON.stringify({ tool: 'calendar_get_event', event: {
      eventId: 'abcde', summary: 'Planning', start: '2026-10-22T10:00:00Z',
      end: '2026-10-22T11:00:00Z', timeZone: 'Etc/UTC', status: 'confirmed', htmlLink: null,
    } }) }, sources: [source],
});
const context: AssembledContext = { contextVersion: 0, instructionVersion: 'fixture-v1',
  knowledgeContentHash: 'a'.repeat(64), graphSchemaVersion: 'fixture-v1', messages: [
    { role: 'system', content: 'Fixture rules' },
    { role: 'user', content: 'Check my event' },
  ] };
```

Assert:

```typescript
const repair = { rejectedDecisionId: 'bad-decision', diagnostics: [
  { path: 'summary', code: 'missing', expected: 'string' },
] } satisfies NonNullable<CalendarDecisionRequest['repair']>;
const result = calendarContext({ context, acceptedInput: 'Check my event',
  groups: [group], repair, tools: CALENDAR_TOOLS, budgets: DEFAULT_BUDGETS,
  limits: CALENDAR_LIMITS, binding, now });
expect(result.messages.filter(m => m.role === 'user' && m.content === 'Check my event'))
  .toHaveLength(1);
expect(result.messages.slice(-3)).toEqual([
  group.assistant, group.result, { role: 'system', content: repairInstruction(repair.diagnostics) },
]);
expect(JSON.stringify(result.messages)).not.toContain('bad-json-secret');
expect(() => calendarContext({ context, acceptedInput: 'Check my event',
  groups: [{ ...group, result: { ...group.result, tool_call_id: 'other-call' } }],
  repair: null, tools: CALENDAR_TOOLS, budgets: DEFAULT_BUDGETS,
  limits: CALENDAR_LIMITS, binding, now })).toThrow();
```

Add named cases for duplicate call IDs, wrong tool name, orphan group, seven groups, expired/redacted source, 16 KiB exact/one-byte-over results, schema/repair/result headroom overflow and message-count overflow. Reject complete-group overflow as a whole; do not slice messages or silently drop old history. A volatile result is usable only in the currently running loop's explicitly volatile boundary, never loaded from persistence as retained; test that distinction separately from expired retained data.

- [ ] **2. Run red.** `npm test -- test/context/calendar-context.spec.ts`. Expect missing function/module before implementation.
- [ ] **3. Implement context construction.** The central path is:

```typescript
const last = input.context.messages.at(-1);
if (!last || last.role !== 'user' || last.content !== input.acceptedInput) {
  throw new AppError('NOT_READY', 'Accepted chat context is unavailable.');
}
const messages = rebuildCalendarMessages({
  prefix: input.context.messages.slice(0, -1),
  acceptedInput: { role: 'user', content: input.acceptedInput },
  groups: input.groups,
}, input.repair);
const estimatedInputTokens = estimateCalendarInput(messages, input.tools);
const remainingContextTokens = input.budgets.maxContextTokens
  - input.budgets.maxOutputTokens - input.budgets.modelMarginTokens;
if (estimatedInputTokens > remainingContextTokens ||
    messages.length > input.budgets.maxMessagesInContext) {
  throw new AppError('CONTEXT_BUDGET_EXCEEDED', 'This chat has reached its context limit. Start a new chat.', false);
}
return { messages, estimatedInputTokens, remainingContextTokens };
```

Keep the implementation actions individually checkable: (a) last-input/prefix extraction and one-input test; (b) complete-group validation and matching-ID test; (c) source/byte/headroom checks and one exact-boundary test; (d) read-time derived-history tombstone and one expiry test. Run the corresponding focused test red then green after each action before the combined command below.

Before that path parse every group, require at most six unique call IDs, check argument/result UTF-8 limits against effective smaller Calendar limits passed by the caller, and validate retained sources against current time and current connection revision. `limits` and `binding` are authoritative inputs, not inferred from result text. `volatileSourceIds` defaults to an empty set and is populated only from the active execution's in-memory results; it never enters graph state. Volatile permission has zero durable lifetime but can be processed in the same admitted live turn. An expired retained source or a source missing from this set cannot masquerade as an active volatile result.

For derived prior assistant history, replace expired/redacted/volatile details with `CALENDAR_TOMBSTONE` **at read time**, preserving original message/event/sequence and `sourceProvenance`. Put the check in `ReferencedContextAssembler` before `heardMessage` returns ordinary assistant text; do not modify canonical user input. Check source deadlines as well as `redactedAt`; a delayed P8 sweep is not permission to use expired content. Do not import the database driver or mutate archives here.

- [ ] **4. Run green.** `npm test -- test/context test/runtime/voice-history.spec.ts`. Expect complete groups, exactly-once current input, explicit overflow, and existing heard-voice history passes.
- [ ] **5. Commit.** `git add -- backend/src/context/calendar-context.ts backend/src/context/referenced-context-assembler.ts backend/test/context/calendar-context.spec.ts backend/test/context/referenced-context-assembler.spec.ts`; `git commit -m "feat(calendar-runtime): preserve complete permission-aware tool context"`.

## Task 3: Persist turn-wide admission and accounting before every dispatch

**Files:** Create `backend/src/chat-runtime/calendar-budget.ts`, `backend/test/runtime/calendar-budget.spec.ts`; extend `backend/test/runtime/calendar-runtime.fixture.ts`.

- [ ] **1. Write failing budget tests.** Use the fixture store through the real public methods. Verify that one `reserveDispatch` followed by its duplicate consumes exactly one dispatch/hold; a correction consumes one additional dispatch and one repair; a provider retry consumes a dispatch but not another repair. The retry of an already corrected decision preserves `repairedDecisionId` and `request.repair` while using reason `provider-retry`.

```typescript
it('retains unknown dispatched spend and original deadline across restart', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Check event abcde');
    h.modelWires.push(nativeWire('{"eventId":"abcde"}'));
    h.failOnce('decision-save');
    await expect(h.execute(ids)).rejects.toBeDefined();
    const before = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    await h.restart();
    const after = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(after).toEqual(before);
    expect(after?.modelDispatches).toBe(1);
    expect(after?.reservedUsd).not.toBe('0');
    expect((await h.p.calendarAccounting.listDispatches(h.identity.userId, ids.turnId))[0])
      .toMatchObject({ reservationStatus: 'held' });
  } finally { await h.dispose(); }
});
```

Add exact-cap/one-over parameterized tests for dispatches 8/9, repairs 2/3, tools 6/7, creates 1/2, Calendar 20/21, refresh 2/3, USD 1.00/1.00000001, original deadline equal/past, and smaller configured caps. Use actual decimal strings; never compare floating-point money. Include missing pricing, unknown connector cost, tool-only/empty/cancelled/broken-stream usage, repeated observation, reservation draft/claim gap, uncertain CAS, and aggregate publication twice.

- [ ] **2. Run red.** `npm test -- test/runtime/calendar-budget.spec.ts`. Expect missing Calendar ledger behavior; no native prerequisites.
- [ ] **3. Implement `CalendarTurnLedger`.** Its constructor holds the narrowed accounting port, accepted turn identity, effective limits, a fenced write wrapper, and clock; it does not own MongoDB or credentials. Expose `ensureBudget`, `consume`, `reserveDispatch`, `bindingFor`, `beforeDispatch`, `observe`, `finishDispatch`, `aggregate`. Use the actual P2 semantics:

```typescript
async function consumeCounter(
  store: CalendarAccountingStore,
  current: CalendarTurnBudget,
  change: Partial<Pick<CalendarTurnBudget, 'logicalTools' | 'creates' | 'calendarRequests' | 'refreshRequests'>>,
): Promise<CalendarTurnBudget> {
  const next = turnBudgetRecordSchema.parse({ ...current, ...change, revision: current.revision + 1 });
  const outcome = await store.compareAndSwapBudget(current.revision, next);
  if (outcome !== 'confirmed') throw new AppError('PERSISTENCE_ERROR', 'Calendar progress could not be saved.', false);
  return next;
}
```

The class checks current deadline/limits before this helper and serializes consume callbacks for one attempt, including refresh. Re-read the current budget after `putDispatch` or observation updates because P2 may advance its revision/money. A conflict/uncertain result stops dispatch; do not blindly repeat a counter increment.

`ensureBudget` creates only an all-zero version-1 budget for the original turn. If dispatches/operation exist without its budget, fail closed; missing evidence is not a new budget. Existing `createdAt`/`deadlineAt` never change. Execute all store writes through `job.wait(p.owner.run(lease, action), persistenceTimeoutMs)`. Track promises even when their wait times out, and prohibit further effects while unresolved.

Build dispatch IDs deterministically from turn and **global** next index using the existing `key` helper, not new random IDs on each save retry. Decision IDs are new for a native regeneration; provider retry is also a new dispatch/decision identity with the same repair provenance. Initial, continuation, correction, provider retry are distinct reasons. Fill every P1 dispatch field using accepted attempt identity, frozen model/pricing/config/schema/connection evidence and `unavailableMoney(true)`; initialize all usage counts/IDs/times as null, `status: 'reserved'`, `reservationStatus: 'held'`, and `failure: null`.

Use this admission sequence:

```typescript
const reservationUsd = reserveUsd(pricing, context.estimatedInputTokens, maxOutputTokens);
if (!withinSpendCap(budget.settledUsd, budget.reservedUsd, reservationUsd, limits.modelSpendUsd)) {
  throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The Calendar model budget is exhausted.', false);
}
await write(() => accounting.putDispatch(reservedDispatch));
const saved = await accounting.getDispatch(userId, reservedDispatch.dispatchId);
const claimed = await accounting.getBudget(userId, sessionId, turnId);
if (!saved || !claimed || claimed.modelDispatches !== reservedDispatch.dispatchIndex) {
  throw new AppError('PERSISTENCE_ERROR', 'Calendar accounting could not be confirmed.', false);
}
```

Pass the post-claim budget to P4. `beforeDispatch` checks the Work signal, executor fence, current binding/config disable state and remaining deadline; persists `status: 'dispatched'`; checks again; then allows P4 to fetch. A crash after this marker but before network is conservatively ambiguous. Only the currently executing owner with proven no-dispatch may transition reserved -> not-dispatched/released. A restarted process cannot assume an unsaved fetch did not happen.

`observe` rereads the dispatch and merges P4's observation with immutable identity. Known money settles the reservation once; unknown/pending money leaves the hold, including on failure, cancellation, disconnect, empty text, rejected JSON or turn termination. Set terminal status at the terminal outcome, preserving provider/request IDs and token counts when supplied. Never fabricate missing usage/connector charges as zero. Do not overwrite known cost with later unknown observation. Persist failure category separately from operation outcome.

`aggregate` reads only this attempt's dispatch rows in global index order, sums each known decimal once with `sumUsd`, sums held reservations separately, and propagates unknown/pending token totals rather than substituting zero for null. `connectorMoney` is independently unknown unless there is verified evidence. Store one immutable terminal aggregate after all observations are finished; duplicate publication must be byte-identical. Do not publish an interim aggregate and then try to update P2's immutable insert. Keep legacy accounting only as the established compatibility projection; reports prefer aggregate over legacy, never add both. Do not run legacy one-generation reconciliation against a multi-dispatch attempt.

Implement this step in short TDD slices, checking off each before proceeding:

- [ ] All-zero `ensureBudget` and same-turn restart test.
- [ ] One `consume` counter/CAS gate and exact-limit test; then parameterize the other three counter fields.
- [ ] `reserveDispatch`/`bindingFor` and one duplicate-claim test.
- [ ] `beforeDispatch` and provider-not-called-on-save-failure test.
- [ ] `observe`/`finishDispatch` and known/unknown hold tests.
- [ ] Terminal `aggregate` and duplicate/legacy-preference test.

- [ ] **4. Run green.** `npm test -- test/runtime/calendar-budget.spec.ts test/persistence/calendar-accounting.spec.ts test/persistence/calendar-accounting-reporting.spec.ts test/model/calendar-policy.spec.ts`. Expect precise counters/decimals and no double accounting.
- [ ] **5. Commit.** `git add -- backend/src/chat-runtime/calendar-budget.ts backend/test/runtime/calendar-budget.spec.ts backend/test/runtime/calendar-runtime.fixture.ts`; `git commit -m "feat(calendar-runtime): persist dispatch budgets and monetary holds"`.

## Task 4: Establish authorization and durable operation-first creation

**Files:** Create `backend/src/chat-runtime/calendar-operation.ts`, `backend/test/runtime/calendar-operation.spec.ts`; extend `backend/test/runtime/calendar-runtime.fixture.ts`.

- [ ] **1. Write failing authority/order tests.** A model-generated create is not authorization. Use a self-contained canonical user approval for executable fixtures; ambiguous/missing/mismatched input must produce clarification with zero operation dispatches and zero correction dispatches.

```typescript
import { calendarInputSchemas } from '../../src/contracts/calendar-tools.js';

const action = calendarInputSchemas.calendar_create_event.parse({
  summary: 'Planning', start: '2026-10-22T10:00:00+00:00',
  end: '2026-10-22T11:00:00+00:00', timeZone: 'Etc/UTC',
});
const approvedInput = `Create this Google Calendar event: ${JSON.stringify(action)}`;

it('saves one authorized operation and its dispatch event before Google', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(approvedInput);
    h.modelWires.push(createWire(action, 'call-create'), textWire('The event is created.'));
    await h.execute(ids);
    const saved = await h.p.calendarOperations.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(saved).toMatchObject({ state: 'succeeded', deliveryRetries: 0,
      authorization: { basis: 'explicit-request' } });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    expect(h.order.indexOf('acceptance')).toBeLessThan(h.order.indexOf('provider'));
    expect(h.order.indexOf('operation-dispatch-event')).toBeLessThan(h.order.indexOf('google-create'));
    expect(saved?.googleEventId).toBe(calendarEventId(saved!.operationId));
  } finally { await h.dispose(); }
});
```

Define `createWire` and `textWire` in the fixture using the existing P4 native-frame helper, unique call/generation IDs, complete finish frame and `[DONE]`. Include no private reasoning. Add tests for model changing title/start/end/timezone/description/location, another target, multiple requested creates, missing fields, offset/DST errors, current connection revocation during authority save, and a second logical create after a successful first. Rejected/clarification paths execute zero calls; they are not schema repair.

- [ ] **2. Run red.** `npm test -- test/runtime/calendar-operation.spec.ts -t "saves one authorized operation"`.
- [ ] **3. Implement exact, non-heuristic authority and operation admission.** Reuse P5 semantic validation and canonical hashing. The safe minimum for this proof is to ask for canonical approval whenever an ordinary natural-language request cannot be mechanically matched to the exact action. Do not invent a natural-language permission classifier, accept an LLM's assertion that approval exists, or treat substring/verb/date matching as authority. A precise natural-language request can be clarified with its canonical action; the next self-contained accepted approval is a distinct turn and exact authorization, not a new tool/HTTP contract. Support this deterministic explicit-request representation:

```typescript
export function canonicalCreateRequest(action: CalendarCreateInput): string {
  return `Create this Google Calendar event: ${JSON.stringify(calendarInputSchemas.calendar_create_event.parse(action))}`;
}

export function authorizeCreate(input: MessageRecord, action: CalendarCreateInput) {
  if (input.role !== 'user' || input.visibility === 'internal' ||
      input.content.trim() !== canonicalCreateRequest(action)) {
    return { outcome: 'clarify' as const,
      message: `Please confirm the exact event by sending: ${canonicalCreateRequest(action)}` };
  }
  return { outcome: 'authorized' as const, acceptedUserMessageId: input.messageId,
    canonicalActionHash: calendarActionHash(action), approvedAt: input.createdAt,
    basis: 'explicit-request' as const };
}
```

This is a conservative canonical-approval fallback allowed by goal §Tool surface, not a relaxation of intent checks. Never create from incomplete time data just to generate an approval suggestion. No extra creation-duration ceiling, calendar picker, confirmation endpoint, or client-supplied connection field is introduced. If broader automatic natural-language authorization is required by a later user decision, return that design decision to the orchestrator rather than adding an unsafe heuristic here.

For first create: validate semantics -> exact authority -> current binding/fence -> check existing turn operation -> durably consume logical tool/create capacity -> reserve planned operation -> append planned event -> CAS dispatching -> append dispatch event -> current gate/fence/signal -> MCP invoke. Compute stable `operationId = key('calendar-operation', userId, sessionId, turnId)` and `googleEventId = calendarEventId(operationId)` before the first decision/operation save. `requestHash = calendarActionHash(action)`; bind the original accepted message ID, connection/subject/calendar/target/schema revision. `auditExpiresAt` is the minimum approved audit deadline and createdAt+30 days; an absent permission for minimal authority blocks the feature before a model/tool call.

If `authorizeCreate` returns clarify, emit its trusted bounded question as assistant text and archive it through the Calendar-aware incomplete-result path with all consulted source provenance (or a permitted tombstone), then terminate this attempted action without dispatch and without the ordinary retry button. Do not save that runtime-authored question as a fabricated provider-native decision/tool response, or emit a false completed/created operation. The operator's self-contained canonical response is a new accepted input, not an explicit retry of the unauthorized call. P8's fixed instructions should normally have the model ask this clarification as a text decision before requesting create; the runtime gate remains necessary when it does not. Test that the visible question contains the exact safe canonical command and no hidden account/token/target fields.

The operation is per accepted turn, not per attempt/model call/provider ID, and not deduplicated by similar text. A different accepted turn may express the same event details and is a separate intent. On any retry first call `getByTurn`; reuse succeeded/unknown/planned authority with its original ID and hash. Never call `reserve` with fresh timestamps/authorization for an existing record. A missing operation while the persisted creates counter is already spent is an evidence gap, not permission to manufacture another operation.

Implement a shared transition helper that validates the full next record, calls CAS through the owner wrapper, verifies the confirmed saved revision, and appends the corresponding deterministic event **before the next effect or public operation frame**:

```typescript
const next = operationRecordSchema.parse({ ...current, ...change,
  revision: current.revision + 1, sequence: current.sequence + 1, updatedAt: now });
const result = await write(() => operations.compareAndSwap(current.revision, next));
if (result.outcome !== 'confirmed') {
  throw new AppError('PERSISTENCE_ERROR', 'Calendar progress could not be confirmed.', false);
}
await write(() => operations.appendEvent({ schemaVersion: 1, kind: 'calendar-operation-event',
  userId: next.userId, sessionId: next.sessionId, turnId: next.turnId, attemptId,
  operationId: next.operationId, eventId: key('calendar-operation-event', next.operationId, next.sequence),
  sequence: next.sequence, state: next.state, createdAt: next.updatedAt, failure: next.failure }));
return result.record;
```

If append fails after CAS, recovery repairs the event from the current record using deterministic identity; do not advance another transition or dispatch until it is confirmed. Store receipt/succeeded state first, then succeeded event, then source/result evidence before another model round. A successful MCP result without a permitted verified receipt is unknown for creation, not success. Validate receipt IDs/hash/revisions/calendar hash using the frozen schemas and operation before saving.

For reads, count one logical call and persist its validated decision first; its result record's `operationId` is the toolCallId as P5 specifies. Reads do not create mutation-operation rows. Register returned sources under the owner before saving result evidence. Retained projection if allowed/unexpired; otherwise separately permitted reference/tombstone only. Never persist a volatile result in a disguised assistant decision, checkpoint, tool record, cache or log. Link all fetched/derived sources; never renew expiry at narration time. If action fields are derived from fetched content, retain their sources and obey their permission, or ask the user to restate the canonical action; a user-authored restatement has its own transcript policy.

- [ ] **4. Run green.** `npm test -- test/runtime/calendar-operation.spec.ts test/plugins/google-calendar/tools-validation.spec.ts test/persistence/calendar-operations.spec.ts`. Expect operation-first ordering, zero unauthorized effects and stable IDs.
- [ ] **5. Commit.** `git add -- backend/src/chat-runtime/calendar-operation.ts backend/test/runtime/calendar-operation.spec.ts backend/test/runtime/calendar-runtime.fixture.ts`; `git commit -m "feat(calendar-runtime): require durable authority before Calendar effects"`.

## Task 5: Add the bounded graph branch and clean structural repair routing

**Files:** Create `backend/src/chat-runtime/calendar-loop.ts`, `backend/test/runtime/calendar-loop.spec.ts`; modify `backend/src/agent/state.ts`, `turn-graph.ts`, `backend/src/chat-runtime/durable-chat-runtime.ts`, `backend/test/runtime/graph.spec.ts`, `calendar-runtime.fixture.ts`.

- [ ] **1. Write the failing malformed-then-valid full-loop test.** Use actual P4 adapter and real embedded MCP/Calendar fixture, not a mocked parser or MCP client:

```typescript
it('repairs a rejected decision from the last valid boundary and executes the repair once', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(nativeWire('{"eventId":'), nativeWire('{"eventId":"abcde"}'), textWire('Found it.'));
    await h.execute(ids);
    const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(budget).toMatchObject({ modelDispatches: 3, repairs: 1, logicalTools: 1, creates: 0 });
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(1);
    const repaired = h.modelBodies[1].messages as NativeCalendarModelMessage[];
    expect(repaired.filter(m => m.role === 'user' && m.content === 'Read event abcde')).toHaveLength(1);
    expect(repaired.some(m => 'tool_calls' in m || m.role === 'tool')).toBe(false);
    expect(repaired.at(-1)?.content).toContain('No tool from the rejected decision has been executed.');
  } finally { await h.dispose(); }
});
```

Add table-driven rejected wires: malformed/trailing/fenced/duplicate-key/escaped duplicate-key, missing/wrong/innocuous extra fields, malformed envelope/cardinality, length-truncated calls with usable terminal framing. Assert each rejected identity reaches zero MCP calls. Include TR-07–TR-13 from research: initial + two failed repairs stops with repairs=2, no third correction; list/read group survives a later create correction; repaired action cannot change approved details.

Non-repair table: forbidden attendees/recurrence/identity/target/token keys, unknown/disabled tool, missing user intent, semantic dates/DST ambiguity, revoked grant, price/deadline/budget denial, persistence failure, uncertain write, stream missing `[DONE]`, malformed SSE. Assert zero structural correction dispatches. A permitted multi-call batch is repairable as a whole; a batch containing a policy denial is denied as a whole. A final text-only answer in the tool-enabled branch remains valid.

- [ ] **2. Run red.** `npm test -- test/runtime/calendar-loop.spec.ts -t "repairs a rejected decision"`.
- [ ] **3. Add the strict reference state and graph routing.** Add the nullable channels described in §3; no transcript/message reducer. Extend `buildTurnGraph` hooks with optional Calendar functions `decide(input)`, `execute(input)`, `seal(input)`, each returning a typed state patch. Route `prepare` to legacy `generate` when no Calendar cursor, otherwise `calendar_decide`. Route each Calendar step by `calendarCursor.next`; `calendar_decide -> calendar_execute | calendar_decide | seal`; `calendar_execute -> calendar_decide | seal`. Legacy generate still goes directly to seal. The existing `seal` node validates either `result` or `calendarSeal` and terminates; `graph.updateState(..., 'seal')` must still schedule no model/effect node.

Bound the branch with top-level `recursionLimit: 48` (8 decision nodes, at most 6 execution nodes plus prepare/seal and bounded bookkeeping comfortably fit; this is a safety ceiling, not a new turn budget). Every decision is also gated by the durable global dispatch count. A repeatedly requested seventh tool/ninth model call fails before effect even if graph recursion remains. Do not put budget authority only in graph state.

Before writing a reference checkpoint after a model terminal result, save its `ResumableCalendarDecision` or rejected evidence. References are capped/unique and linked to accepted turn/attempt/dispatch; `decisionId` matches decision payload. For a create use its predetermined operation ID before the immutable decision insert. For retained derived decisions attach all consulted sources (max six); for volatile/unpermitted derived content store `decision: null` and the permitted minimized sources/outcome rather than content. Store only sanitized hash/diagnostics for rejections. No provider raw body, private reasoning, credentials, schemas or tools message array enters graph state.

`CalendarLoop.decide` performs one model dispatch using this order:

```typescript
job.check();
await requireDispatchAllowed();
const context = calendarContext(contextInput);
const dispatch = await ledger.reserveDispatch(reason, context, repair);
const binding = await ledger.bindingFor(dispatch);
const model = dependencies.createModelPort(modelConfig, modelLimits, binding, fetcher);
let decision: CalendarDecision | null = null;
let rejection: CalendarRejectedDecision | null = null;
let failure: CalendarFailure | null = null;
for await (const chunk of model.stream(request)) {
  if (chunk.type === 'decision') decision = calendarDecisionSchema.parse(chunk.decision);
  else if (chunk.type === 'rejected') rejection = rejectedDecisionSchema.parse(chunk.evidence);
  else if (chunk.type === 'failure') failure = calendarFailureSchema.parse(chunk.failure);
  else if (chunk.type === 'text-delta') await emitProvisionalText(chunk.text);
}
await ledger.finishDispatch(dispatch.dispatchId, failure);
```

`bindingFor` reads the confirmed post-claim budget; `request` has exact model/user/processing-policy/repair identities, original deadline, bounded messages/tools/output and Work signal. `onObservation` handles usage; do not write it twice merely because the adapter also yields a `usage` chunk. Verify exactly one terminal decision or classified failure; multiple decisions or an invalid combination are a protocol failure, never executable. `emitProvisionalText` enforces the existing visible-byte budget; it does not add native fragments or raw tool JSON to SSE. A decision accompanied by provisional mixed text cannot make the text a receipt. Do not expose raw schema diagnostics to users.

On structural rejection: save rejection -> safe `repairing` progress -> if durable limits permit, rebuild from last valid boundary with exact P4 instruction -> reserve a new `schema-repair` dispatch before invoking it. Do not append the rejected assistant candidate or fabricate a tool response. One repair attempt can be followed by eligible provider-rejection retries without incrementing repairs again; all dispatches count globally. Preserve `repairedDecisionId` across that provider retry. Cap provider rejection attempts with the existing captured `budgets.retryMaxAttempts` (default 2 total attempts, not 2 extra retries). Derive attempts already used from the persisted contiguous dispatch sequence since the latest initial/continuation/schema-repair anchor, rather than resetting an in-memory retry count after restart. P4 already sleeps eligible Retry-After/backoff before returning its retry category. Do not add a resetting retry loop inside the adapter or retry ambiguous accepted inference.

On valid tool: validate again with P5 semantics/current permissions, save resumable decision, route execute. `CalendarLoop.execute` first checks existing result/operation evidence, then invokes the operation/read executor once. It builds the complete assistant-call/tool-result group only from the valid decision plus **actual** successful tool result; append it atomically to the in-memory boundary only after durable permitted evidence is confirmed. A failed/rejected/unknown call does not get a fabricated success/error tool message to enable another model round. Stop with the classified safe failure/clarification; preserve any earlier completed operations.

On final text: save terminal decision (or null-content minimized reference when derived data is volatile), assemble a reference-only `CalendarSeal` for publication, and route seal. Retained final text uses source provenance at earliest source expiry; volatile final text may be streamed but archive publication uses an explicit tombstone. No automatic paid narration retry after a failure, and no tool replay to repair narration.

Implement the branch as separate red/green slices rather than one large edit:

- [ ] Strict channels/schema and one serialized-state rejection test.
- [ ] Conditional graph routing and one real MemorySaver terminal-`seal` test.
- [ ] One `CalendarLoop.decide` call with request/context/ledger binding and one valid text test.
- [ ] Rejection save + clean correction boundary and the malformed-then-valid test.
- [ ] Non-repair classifications and one forbidden-field test before adding its table cases.
- [ ] One `CalendarLoop.execute` call with saved decision/result and one matching group test.
- [ ] Original acceptance/budget/cursor integration and acceptance-before-provider test.

`requireDispatchAllowed` in the decision code is the loop's private async method: check Work, accepting/effect-dispatch barrier, current server Calendar options/policy, captured binding, original deadline and `p.owner.fence(lease)`; throw before fetch if any check fails. `emitProvisionalText` is its private async method: enforce remaining visible UTF-8 bytes, accumulate only permitted current narration text in memory, and send a v2 delta through the execution callback; it never constructs a receipt. `request` is a fully constructed `CalendarDecisionRequest` from the current post-claim dispatch/budget, `calendarContext` output and accepted attempt, with `dataCollection: 'deny'`, empty or frozen authoritative tools and original processing-policy ID. These are local methods, not new plugin/model ports.

Integrate acceptance in `acceptNewTurn`: capture Calendar options/binding only for ordinary text with optional dependencies, current valid policy/pricing and usable connection. Do not enable tools merely because credentials exist. Calendar unavailable/disabled leaves ordinary text healthy; the trusted context says capability unavailable and no tool schemas are advertised. A tool-enabled accepted turn gets its all-zero original budget before acceptance confirmation and first inference; preserve already-created orphan evidence on uncertain acceptance. Live acceptance never captures a Calendar cursor/budget. During execution require `emitCalendar` for a bound Calendar turn before any model dispatch; do not downshift an already-bound/retried turn into legacy inference. Bind budget/cursor before the first dispatch, not after provider output.

Persist the accepted effective Calendar limits in the nonsecret cursor. On continuation also enforce any smaller currently configured limit; a settings increase/restart cannot enlarge the accepted allowance. For the decimal spend cap choose the smaller canonical decimal with `withinSpendCap`, not floating-point conversion. Preserve the originally captured model/provider/pricing/config evidence for a running attempt; any explicit new-attempt snapshot must still obey the old turn-wide deadline/counters/holds and current connection disable/revocation.

- [ ] **4. Run green.** `npm test -- test/runtime/calendar-loop.spec.ts test/runtime/graph.spec.ts test/model/calendar-adapter.spec.ts test/model/calendar-repair.spec.ts test/plugins/mcp`. Expect real MCP fixture calls, valid groups, exact correction wording, and no message content in saver snapshots.
- [ ] **5. Commit.** `git add -- backend/src/chat-runtime/calendar-loop.ts backend/src/agent/state.ts backend/src/agent/turn-graph.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/test/runtime/calendar-loop.spec.ts backend/test/runtime/graph.spec.ts backend/test/runtime/calendar-runtime.fixture.ts`; `git commit -m "feat(calendar-runtime): run bounded native decisions and clean schema repair"`.

## Task 6: Save results and publish receipts independently of narration

**Files:** Create `backend/src/chat-runtime/calendar-publication.ts`, `backend/test/runtime/calendar-publication.spec.ts`; modify `backend/src/chat-runtime/finalization.ts`, `durable-chat-runtime.ts`, `reconciliation.ts`; extend `calendar-loop.ts` as necessary.

- [ ] **1. Write failing publication tests.** Inject a successful create followed by a narration failure and assert the durable operation remains visible:

```typescript
it('keeps a verified successful action visible when final narration fails', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(approvedInput);
    h.modelWires.push(createWire(action, 'create-one'), brokenTextWire());
    await expect(h.execute(ids)).rejects.toBeDefined();
    const state = await h.runtime.getCalendarTurnState(h.identity.userId, ids.sessionId, ids.turnId);
    expect(state).toMatchObject({ state: 'succeeded', narration: 'interrupted',
      retryAction: 'none', receipt: { durable: true } });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    expect(h.frames.filter(f => f.event.type === 'completed')).toHaveLength(0);
    expect(h.frames.some(f => f.event.type === 'calendar-operation' &&
      f.event.operation.state === 'succeeded')).toBe(true);
  } finally { await h.dispose(); }
});
```

Also assert: a non-retryable provider error after a successful action projects narration `failed`; streamed “Created” without receipt never creates a success frame; source permission false/expired strips link/content; malicious Google links are null via `safeCalendarLinkSchema`; incomplete terminal evidence emits no completed event; tool-only response and no-create text answer finalize correctly; optional post-completion telemetry failure cannot undo durable success. `brokenTextWire()` is a partial text SSE stream without `[DONE]`, not an HTTP retryable rejection, and correctly projects narration `interrupted`.

- [ ] **2. Run red.** `npm test -- test/runtime/calendar-publication.spec.ts`.
- [ ] **3. Implement reference-only publication.** `calendar-publication.ts` exposes `projectCalendarTurnState`, `checkedCalendarSeal`, `publishCalendarResult`. `projectCalendarTurnState` reads attempt + operation + current operation event evidence. It projects narration separately (`pending`, `completed`, `failed`, `interrupted`); no operation row means null, not fabricated “failed create.” A dispatching operation after a crash is reconciled to unknown before public terminal projection. A succeeded row missing its matching event is not publicly confirmed until that evidence is repaired.

Use this projection boundary for a verified current receipt:

```typescript
const source = operation.receipt!.source;
const contentUsable = source.permission.content === 'retained' && source.redactedAt === null
  && Date.parse(source.expiresAt) > now;
const link = contentUsable ? safeCalendarLinkSchema.safeParse(operation.receipt!.htmlLink) : null;
const receipt = { durable: true as const, eventId: operation.googleEventId,
  htmlLink: link?.success ? link.data : null,
  expiresAt: contentUsable ? source.expiresAt : null };
```

Minimal receipt identifiers are usable only under the independently permitted minimal-evidence policy; no general exemption for event IDs/URLs. Expired evidence markers project `evidence-expired`/`blocked-expired`, not another create. Unknown/mismatch outcomes have no receipt, never “Created.” Retry action is `resume-reconciliation` only when permission, original binding/deadline, remaining requests and authority permit it; otherwise reconnect/clarify/blocked-expired/none accurately reflect the reason. An operation that succeeded but narration failed must not advertise an ordinary retry that could write again.

`checkedCalendarSeal` validates this chain before completion:

1. Accepted user message + acceptance marker + attempt payload hash/server identity.
2. Cursor's captured config/connection/schema and original turn budget, with all dispatch IDs unique and in global order; no unexplained dispatched row without decision/terminal classification.
3. Each saved valid decision and corresponding result, matched call ID/name/turn/attempt and source permissions. Rejections are not conversational tool groups.
4. For a create: immutable operation/action hash/authorization, verified receipt, current state and matching succeeded event. A graph checkpoint alone proves none of these.
5. Final decision or permitted redaction/tombstone reference, immutable terminal accounting aggregate, and actual sync sealed checkpoint with no scheduled nodes/tasks/errors.
6. Archive assistant record and target manifest linkage, followed by manifest and graph boundary confirmation, message completion update, session touch, attempt terminal CAS and clear-attempt. Only then emit terminal completed/status.

Keep the existing order/idempotence discipline of `publishResult`, but do not send Calendar through its legacy generationId/one-accounting assumptions. Preserve legacy `publishResult` for historical `SavedResult`. Publication of Calendar output loads its terminal decision by ID; stores a bounded source-provenance assistant record, or `CALENDAR_TOMBSTONE` if details are volatile/expired/redacted. Do not put the resolved text in `calendarSeal`, checkpoint metadata, pending writes or recovery logs. Repeated publication confirms the same message/event/sequence/manifest and aggregate; it never changes content to resurrect a previously redacted answer. Clear Calendar channels on subsequent legacy turns/rebase so previous references do not become current-turn authority.

When final narration fails before seal, publish operation state separately and interrupt/fail the attempt via a Calendar-aware path. Save only permitted bounded partial narration with source provenance or tombstone; do not route through legacy interruption's raw `partial` append. Do not clear operation/dispatch/result evidence while clearing the graph's execution cursor. Store the terminal aggregate after final observation cleanup. If its persistence fails, leave finalization/recovery pending; do not synthesize a terminal success or remove active ownership evidence prematurely.

- [ ] **4. Run green.** `npm test -- test/runtime/calendar-publication.spec.ts test/runtime/accounting-completion.spec.ts test/runtime/local-reconciliation.spec.ts test/runtime/text-config.spec.ts`. Expect operation/narration separation and intact legacy sealed-result recovery.
- [ ] **5. Commit.** `git add -- backend/src/chat-runtime/calendar-publication.ts backend/src/chat-runtime/finalization.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/src/chat-runtime/reconciliation.ts backend/src/chat-runtime/calendar-loop.ts backend/test/runtime/calendar-publication.spec.ts`; `git commit -m "feat(calendar-runtime): publish verified receipts independently of narration"`.

## Task 7: Reconcile same-ID effects and retain explicit uncertainty

**Files:** Extend `backend/src/chat-runtime/calendar-operation.ts`; create `backend/src/chat-runtime/calendar-recovery.ts`, `backend/test/runtime/calendar-recovery.spec.ts`; modify `durable-chat-runtime.ts`, `reconciliation.ts`.

- [ ] **1. Add failing same-ID recovery and conflict tests.** Script Google receiving the first POST but the application losing the receipt, then a matched GET of its saved ID. Reconciliation must not POST a second event:

```typescript
it('readbacks the original event after Google success and local receipt failure', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(approvedInput);
    h.modelWires.push(createWire(action, 'create-one'));
    h.failOnce('receipt-save');
    await expect(h.execute(ids)).rejects.toBeDefined();
    const old = await h.p.calendarOperations.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(['dispatching', 'unknown']).toContain(old?.state);
    await h.restart();
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    const next = await h.p.calendarOperations.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(next).toMatchObject({ state: 'succeeded', googleEventId: old!.googleEventId });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    expect(h.effects.filter(e => e.kind === 'readback').map(e => e.eventId))
      .toEqual([old!.googleEventId]);
    expect(h.modelBodies).toHaveLength(1);
  } finally { await h.dispose(); }
});
```

Table-test same-ID 409 matched/mismatched linkage, absent/unknown readback, timeout/5xx after dispatch, revoked or replaced account/target, receipt saved before result save, succeeded state before event append, and evidence expiry. Mismatch/unknown never becomes success and blocks a new mutation. A known failed create is not an unknown charge or a successful action; preserve the independent model reservation.

- [ ] **2. Run red.** `npm test -- test/runtime/calendar-recovery.spec.ts -t "readbacks the original event"`.
- [ ] **3. Implement reconciliation and delivery policy.** On ambiguous create (including abort after effect admission, duplicate ID, malformed/oversize successful HTTP response, MCP teardown, or local failure after Google may have accepted), persist/retain unknown and first read back the same ID under original connection/target binding, current permission, original deadline and durable request counters. Never treat a generic `delivery` error on a dispatched create as definite noncreation: some P5 failures occur while decoding a successful response. Only explicit provider rejection/no-dispatch evidence can establish definitely-failed. A write in flight remains uncertain after cancellation; cancellation cannot undo it.

Matched readback: validate receipt/linkage -> CAS succeeded -> append event -> reuse receipt; do not require/perform another model invocation just to announce success. A final assistant narration may remain failed/interrupted, while operation receipt becomes succeeded. Absent readback: persist `putReconciliation` using the **current unknown operation revision** before considering any retry. Only an explicit accepted retry within all original budgets and unchanged authority may consume that evidence to transition unknown -> dispatching. Automatic startup reconciliation is read-only externally and never creates. Unknown/mismatch: persist the observation if not already present, keep quarantine, do not loop indefinitely or alter the immutable observation to manufacture absent authority.

Transient delivery failures that P5 classifies `delivery-same-id` may retry at most twice after the original delivery, sequentially, under the same operation ID/event ID and original authority. Persist `deliveryRetries + 1` plus the transition event **before** retry. Read deliveries also have at most two retries in the active execution; restart does not resume an incomplete read delivery automatically. P5 already honors rate-limit Retry-After within its request. For other eligible transient deliveries use bounded existing delay policy (captured initial/max backoff and Work signal), rechecking permission/fence/deadline after waiting. A create with uncertain acceptance follows readback, not this definite-rejection loop.

Do not increment `logicalTools`/`creates` on delivery/readback. Every actual Calendar HTTP request consumes `calendarRequests` before network; every actual OAuth refresh request consumes `refreshRequests` separately. Recheck current binding after each counter save and any pause. There is no new retry allowance after process restart. If original deadline is exhausted, retain unknown and return a bounded operator-reconciliation requirement for P8's runbook; never silently extend the turn or create a fresh ID.

Recovery walks at most eight persisted dispatches, follows their decision IDs and at most six result IDs; it does not enumerate raw messages looking for executable JSON. Use ordered records/causal IDs, not timestamps as authority. It is allowed to finish pending record/event/publication writes using the same IDs; never blindly invoke a graph's pending effect/model node. After an unsafe exit require existing stopped-owner proof (`allowStoppedOwner`, owner recovery/fence/drain) before any mutation. Do not infer a stopped executor from lease expiry or delete its sentinel.

- [ ] **4. Run green.** `npm test -- test/runtime/calendar-recovery.spec.ts test/runtime/calendar-operation.spec.ts test/persistence/calendar-operations.spec.ts test/plugins/google-calendar/calendar-api.spec.ts`. Expect bounded readbacks, stable IDs and honest unknown outcomes.
- [ ] **5. Commit.** `git add -- backend/src/chat-runtime/calendar-operation.ts backend/src/chat-runtime/calendar-recovery.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/src/chat-runtime/reconciliation.ts backend/test/runtime/calendar-recovery.spec.ts`; `git commit -m "feat(calendar-runtime): reconcile uncertain Calendar effects by saved event ID"`.

## Task 8: Cover every persistence crash boundary and explicit retry

**Files:** Extend `backend/test/runtime/calendar-recovery.spec.ts`, `calendar-runtime.fixture.ts`, `backend/src/chat-runtime/calendar-recovery.ts`, `durable-chat-runtime.ts`, `calendar-publication.ts`; create `backend/test/runtime/calendar-recovery.native.e2e-spec.ts`.

- [ ] **1. Write the failing crash matrix.** Run both reject-before-commit and commit-then-throw injection where the port can have an uncertain acknowledgment. Reconstruct a fresh runtime against the **same** store/saver. The minimum named matrix is:

| Failure point | Expected durable continuation; forbidden action |
| --- | --- |
| User message/attempt before acceptance marker | No inference/effect. Same idempotency can finish acceptance after reconciliation; no second user message. |
| Budget draft/dispatch claim, before provider marker | Reconcile reservation gap; never reset dispatch/repair/money. Proven no-dispatch may release only in current owner; restart does not infer safety from absence. |
| Dispatched marker before provider response | Interrupted/unknown inference accounting, held reservation; **no automatic or explicit blind replay of that decision**. |
| Terminal provider response before decision save | Preserve dispatch cost/hold, interrupt; no second paid inference to reconstruct the lost response. |
| Valid decision save before graph reference save | Discover via dispatch.decisionId; reuse decision under current binding/authority without paid replay. |
| Logical/create counter spent before operation reserve | Evidence gap blocks write; no reset and no new event ID. |
| Planned operation before dispatching event | Repair missing event/confirm authority; automatic startup never creates; explicit retry may deliver only saved authorized operation. |
| Dispatching marker/event before POST | Treat as uncertain on restart; same-ID readback before any delivery. |
| Google accepts before receipt save | Same-ID readback; matching receipt succeeds, mismatch/unknown quarantines. |
| Receipt/state save before succeeded event | Repair deterministic event, reuse immutable receipt; no POST. |
| Tool result save before graph references | Rebuild complete group from saved decision/result; no tool/model replay. |
| Result missing, expired or volatile after execution | No fabricated tool result/group. Reuse permitted success receipt; interrupt/clarify if continuation cannot be proved; never replay a write for content. |
| Terminal decision before checkpoint seal | Verify same terminal decision and finish seal/publication, no inference. |
| Seal before aggregate/archive/manifest/boundary/message completion/terminal CAS | Finish original reference-only publication idempotently; no model/tool execution. |
| Durable terminal CAS before client completed frame | Reconnect reads durable status/receipt and emits terminal replay without inference. |

Use a parameterized test that executes this matrix with explicit expected model/create counts; do not assert only “throws.” For each row check user archive count=1, unchanged original budget.deadlineAt/counters, stable operation/event IDs, no unmatched provider messages, and no credentials/private reasoning/native tool messages in saver checkpoints/pending writes.

Add explicit retry tests: duplicate request key returns same accepted IDs; changed payload with same key fails; two tabs executing same accepted attempt cause one owner and one model/write; retry links `previousAttemptId` and original user message; same-turn success/unknown operation is reused instead of a new ID; missing/expired evidence blocks replay; new independent accepted turn may create a distinct operation. Preserve existing latest-turn/attempt-count restrictions. No automatic narration retry on `reconcileSession`.

- [ ] **2. Run red.** `npm test -- test/runtime/calendar-recovery.spec.ts`. Expect failures at uncovered crash seams, not a timed-out hanging fixture.
- [ ] **3. Implement evidence-driven retry selection.** Export a pure classification result from `calendar-recovery.ts`:

```typescript
export type CalendarContinuation =
  | { kind: 'publish'; seal: CalendarSeal }
  | { kind: 'reuse-decision'; decisionId: string }
  | { kind: 'reuse-result'; decisionId: string; toolCallId: string }
  | { kind: 'reconcile-operation'; operationId: string }
  | { kind: 'fresh-dispatch'; reason: 'initial' | 'continuation' | 'schema-repair' }
  | { kind: 'interrupt'; code: 'EVIDENCE_MISSING' | 'EVIDENCE_EXPIRED' | 'INFERENCE_OUTCOME_UNKNOWN' |
      'CONNECTION_CHANGED' | 'TURN_DEADLINE_EXCEEDED' };
```

`fresh-dispatch` is allowed only by an explicit request-owned execution/accepted retry with complete valid boundary, no unresolved previously dispatched decision, persisted remaining limits and current policy; **never** by automatic startup reconciliation. An explicit repair continuation can reuse sanitized diagnostics from the reference cursor; if that cursor/evidence is missing do not invent diagnostics from the raw rejected output. It cannot replenish corrections. A stopped accepted attempt with missing captured secret settings is interrupted; never save API keys to make it restart-resumable.

For a durable valid decision/result pending at restart, reconstruct the reference cursor from its dispatch row, original binding and saved evidence. Do not issue inference to regenerate the same call. On an explicitly accepted retry, a new paid continuation is allowed only after reuse of completed groups and original budgets; new attempt accounting includes only new dispatch IDs while turn limits include all prior attempts. Prior result/operation causal links continue naming their original attempts; do not rewrite immutable evidence to the new attempt. A new request key for retry never means a new accepted user input.

Automatic `reconcileSession` must inspect Calendar evidence before the legacy `!activeAttemptId` early return and before legacy `interruptAttempt`, so an already-interrupted narration with unknown operation can still reconcile. Bound discovery to the latest affected turn and its at most eight dispatches; do not build a global unbounded sweep. P8 schedules/operator-invokes additional recovery. Preserve unknown markers after clearing an execution slot so future retries cannot mistake absence for new authority. If owner/storage is uncertain, degrade/quarantine and do not clear the slot merely to make another submission pass.

The native e2e file reuses `nativeHarness` and generated isolated DB cleanup, injects scripted model/Google adapters and the optional Calendar dependency. Cover acceptance uniqueness/cross-tab contention, dispatch/repair/hold survival across a new runtime, Google success/receipt-loss same-ID recovery, and seal-before-publication replay. No URI default, no app DB, no live HTTP. Use the exact existing P2 prerequisite pattern (there is no exported `nativeFixtureEnabled` helper):

```typescript
const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';
describe.skipIf(!configured)('Calendar runtime isolated native recovery', () => {
  it('uses only an isolated generated database', async () => {
    const h = await nativeHarness();
    try { expect(h.db.name.startsWith('aurvin_p2_test_')).toBe(true); }
    finally { await h.persistence.owner.releaseExecutor(); await h.close(); }
  });
});
```

Extend this same suite with the four durability cases above, checking replica-set `hello` as P2's native Calendar suite does. The ordinary existing runtime e2e files are not all prerequisite-skipped; if full `test:e2e` fails solely because their required configuration is absent, report that unrun prerequisite limitation rather than editing their policy or claiming a pass. This new suite may remain skipped locally when prerequisites are absent, and must be reported distinctly.

- [ ] **4. Run green.** `npm test -- test/runtime/calendar-recovery.spec.ts test/runtime/calendar-publication.spec.ts test/runtime/text-config.spec.ts`; `npm run test:e2e -- test/runtime/calendar-recovery.native.e2e-spec.ts`. Expected deterministic pass; native real executed pass or explicitly reported prerequisite skip, never a no-tests “pass.”
- [ ] **5. Commit.** `git add -- backend/src/chat-runtime/calendar-recovery.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/src/chat-runtime/calendar-publication.ts backend/test/runtime/calendar-recovery.spec.ts backend/test/runtime/calendar-runtime.fixture.ts backend/test/runtime/calendar-recovery.native.e2e-spec.ts`; `git commit -m "test(calendar-runtime): cover restart retry and durable crash boundaries"`.

## Task 9: Fence cancellation/drain and retain text/dictation/live-voice separation

**Files:** Modify `backend/src/chat-runtime/work.ts`, `durable-chat-runtime.ts`, `calendar-loop.ts`, `calendar-operation.ts`, `ports.ts` only as necessary; extend `backend/test/runtime/calendar-lifecycle.spec.ts`, `voice-output.spec.ts`, `graph.spec.ts`.

- [ ] **1. Write failing lifecycle tests.** Use controllable fixture latches for before/after actual effect admission, not arbitrary sleeps:

```typescript
it('cancels during correction without executing the rejected call', async () => {
  const h = calendarFixture();
  const controller = new AbortController();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(nativeWire('{"eventId":'));
    h.onPhase = phase => { if (phase === 'repairing') controller.abort(); };
    await expect(h.execute(ids, controller.signal)).rejects.toBeDefined();
    expect(h.effects).toHaveLength(0);
    expect(h.modelBodies).toHaveLength(1);
    expect((await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId))?.repairs)
      .toBe(0);
  } finally { await h.dispose(); }
});
```

Add `onPhase?: (phase: 'validating' | 'repairing' | 'executing' | 'reconciling') => void` to the fixture controls; invoke it from actual emitted progress, not from a fake state transition. Cancellation after a correction's reserved claim may consume one repair even if no fetch occurs; assert the persisted actual boundary, not refund/reset semantics.

Required cases: explicit cancel before decision, during provider/correction, before operation dispatch, after Google admission; client disconnect; sink failure after seal; shutdown before next tool/model dispatch; bounded drain with pending DB write; late committed write; revoked grant/disable/replacement during repair/backoff/request-count persistence; ordinary text survives Calendar degradation. No post-stop new tool dispatch, and pending effects become unknown or confirmed using durable evidence, never “definitely cancelled.”

Live-voice test: enable Calendar dependencies and snapshot globally, submit via `submitLiveTurn`, execute with existing `live` reservation/delivery hooks. Assert provider request contains no `tools`, Calendar model factory/execution/currentBinding are not called, no Calendar budget/refs are saved, speech/accounting still complete. Dictated text uses ordinary `submitTurn`, so the same canonical text request can use Calendar through the text path. Client/body/model cannot choose this bypass: enforce persisted message `visibility/mode` plus reservation and server-owned execution path.

- [ ] **2. Run red.** `npm test -- test/runtime/calendar-lifecycle.spec.ts test/runtime/voice-output.spec.ts`.
- [ ] **3. Implement stop-dispatch checks at the shared effect seam.** Reuse WorkRegistry admission/stop state and existing owner fences; the central check must run before advertisement, each model dispatch, each tool invocation, request/refresh consume callback, after pause/counter save, and immediately before handing an effect to P5. Stopping acceptance also closes new tool dispatch, not just new submissions. Do not add per-caller ad hoc guards that leave readback/retry siblings open. Recovery writes that finalize already-durable evidence may continue while accepting=false; new inference/create cannot.

Cancellation/disconnect abort the active model/MCP signal. Complete accounting cleanup and preserve already-dispatched operation uncertainty with an independent bounded persistence cleanup path; do not use the already-aborted network signal to abandon the uncertainty save. Await all tracked writes and owner drain before releasing ownership; a timed-out mutation is still tracked and can later commit. If it cannot be confirmed, report degraded/unresolved rather than publish false terminal certainty. Existing sealed result wins over a disconnected sink, as in legacy finalization.

`runtime.drain()` stops dispatch, waits bounded active work, aborts at its existing deadline, and reports unresolved writes honestly. MCP channels are owned/closed by P5 execution; P8 calls the single shared execution port's `close()` after dispatch has stopped and active work is settled or safely fenced. Do not introduce a second persistence close. P6 may return drain evidence but must not close a globally shared connection service during a single turn.

For live voice, branch before any Calendar dependency read using persisted internal/live input and server reservation. Keep `AgentVoiceAdapter` unchanged if possible; its existing `executeTurn` call supplies no `emitCalendar` and must continue compiling. Do not widen voice provider capabilities, instructions or accounting here; P8 owns capability reporting/general fixed instructions. Ordinary text/dictation remains text-mode and may use Calendar when admitted.

- [ ] **4. Run green.** `npm test -- test/runtime/calendar-lifecycle.spec.ts test/runtime/voice-output.spec.ts test/runtime/voice-history.spec.ts test/runtime/work.spec.ts test/runtime/execution-reservations.spec.ts test/context/voice-context.spec.ts`. Expect zero live-voice Calendar access and preserved normal speech behavior.
- [ ] **5. Commit.** Stage only changed files from this task's named list (include the narrow voice adapter/test only if actually changed); `git commit -m "fix(calendar-runtime): fence paused effects and exclude live voice tools"`.

## Task 10: Verify the worker boundary and hand off to P8

**Files:** No new implementation files; correct only defects in P6-owned files, and report upstream defects to their owner. Do not mark the workflow complete or edit goal/state/evidence documents from P6.

- [ ] **1. Run focused discovery.**

```powershell
npm test -- test/runtime/calendar test/context/calendar-context.spec.ts
npm test -- test/runtime test/context
npm test -- test/model/calendar test/model/strict-json test/persistence/calendar test/plugins/google-calendar test/plugins/mcp
```

Expect named Calendar loop/budget/recovery/publication/lifecycle suites to be discovered and executed. Record exact files/test counts and skip counts; do not use an empty discovery result as evidence.

- [ ] **2. Run package compatibility.**

```powershell
npm run build
npm run lint
npm test
npm run test:e2e
```

Only deterministic model/Google fixtures are admitted. Native prerequisites remain operator-supplied; no URI/credential output. Report failing/unrun/skipped suites separately. Do not claim real OAuth, actual Google narrow-scope ownership, provider pricing/privacy approval, browser verification, Azure or production readiness from these checks.

- [ ] **3. Check scope/graph/retention evidence.** Confirm no out-of-scope writes, no private reasoning or secret data in snapshots, no `messages` reducer, no raw tool-call/result arrays in graph/pending writes, no new dependency/owner/routes. Check all copies of fetched/derived content: in-memory volatile boundary, permitted result record, saved model decision, UI message `sourceProvenance`, reference-only seal, read-time expiry. P8 still owns cleanup scheduling, disconnect invalidation wiring and backup/restore operations; a source implementation is not proof those operational tasks are complete.

- [ ] **4. Commit only any remaining named P6 corrections after their failing tests pass.** `git diff --check`; stage exact files; use `git commit -m "test(calendar-runtime): complete durable loop regression coverage"` only when there are actual remaining task changes. Do not create an empty verification commit or stage this plan's progress while another planner owns the index.

- [ ] **5. Return the handoff below with actual hashes/check output.** Review remains **skipped**. P8 starts only after P6/P7 worker prerequisites, not merely these plans.

### P8 runtime/recovery handoff

- Construct **one** `DurableChatRuntime` with existing persistence plus optional `CalendarRuntimeDependencies`: P3 `currentBinding/requireCurrent`; one P5 `EmbeddedCalendarExecution`; P4 `createCalendarModelPort`; trusted server timezone; independently approved content/minimal-evidence policy and optional stricter audit deadline. No tokens or browser identity enter these ports.
- Text execution has existing `emit` and additive `emitCalendar(CalendarStreamEnvelope)` callback. Tool-enabled accepted attempts require the latter; all their frames use protocol v2 and one sequence. `getCalendarTurnState` returns authoritative separate operation/narration/receipt/retry state; P8 transports it without changing P1 schemas ad hoc. Legacy text/live execution remains unchanged.
- Acceptance/budget/connection snapshot must be confirmed before inference. Default-off/disabled/unconfigured/degraded Calendar does not take ordinary text or liveness down. P8's local Host/Origin/CSRF gate must cover tool-enabled chat, not just setup routes. Do not enable the dependency in shared assembly before the matching transport/guard is ready.
- Never resume graph nodes blindly. Recover stopped-owner/fenced persistence first, then repair dispatch reservations/events, inspect saved decision/result/receipt chain, reuse sealed output, or same-ID read back an uncertain effect. Startup reconciliation performs no paid inference or creation. Explicit retry uses original user message, operation ID, original deadline, counters and monetary holds; evidence loss/expiry blocks unsafe replay.
- Successful action survives narration failure with a durable receipt/status frame and safe link only while content permission permits. Unknown/mismatched writes remain quarantined and do not authorize another create. Deadline-exhausted uncertainty needs bounded operator escalation; do not extend a turn or remove the sentinel/operation marker.
- Shutdown order: stop new acceptance/effect dispatch; bounded drain and durable uncertainty/accounting cleanup; close shared MCP/connection channels; close persistence once via its existing owner. Preserve unresolved-write/degraded evidence.
- Wire P3 invalidation to active runtime cancellation/rechecks and owner-fenced source invalidation/cleanup. Document source expiry/tombstones across archive/decisions/results and backups; reference-only Calendar checkpoints contain no fetched/derived content to resurrect. Do not claim source sweeps alone certify all retention/backup policy.
- The conservative authorization fallback asks for a self-contained canonical event approval in ordinary text when exact natural-language authority cannot be proved. Fixed instructions must not promise automatic arbitrary creation or imply an OAuth grant authorizes it. All-day/recurrence/invitations/update/delete/bulk and live-voice tools remain unsupported.
- Report exact actual P6 commit set, Node environment, deterministic pass counts, native skips/blocks, and any upstream amendment request. G8 live acceptance and G9 actual processing/retention/provider-policy admission remain separate gates; no live Google/OpenRouter test is authorized by this plan.

## Acceptance checklist for the worker report

- [ ] AC04/AC05: valid correction executes once; rejected batches execute zero times; two corrections total; denial/clarification/transport/persistence/uncertainty never enter structural repair.
- [ ] AC06: one accepted input, complete matching current-turn groups, clean repair boundary, explicit context/schema/result headroom; no silent history drop or tool replay.
- [ ] AC08: operation before effect; same-ID readback; every listed crash seam; duplicate/cross-tab/same-turn retries; current connection rechecks; cancellation/drain; no blind inference/write replay; sealed-result reuse.
- [ ] AC09/AC10: every dispatch attributed/accounted once; exact decimal admission/held unknown cost; independent connector evidence; original deadlines and all finite counters survive restart/attempt changes.
- [ ] AC11/AC12: only durable verified receipts; action/narration independent; permission-aware result/derived history and links; expired/missing evidence blocks replay; no secret/raw/private-reasoning leakage.
- [ ] AC13: ordinary text/dictation/live-voice behavior retained; Calendar excluded from live execution; one owner/shared assembly seam supplied to P8.
- [ ] Checks report actual execution, skips and blockers; review explicitly **skipped**; no real-service or whole-workflow completion claim.
