# Local Activation, Durable History, and Executor Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Calendar through local schema activation and the stable dispatcher while preserving ordered durable history, bounded correction, existing action safety, and confirmed-state follow-ups.

**Architecture:** Extend the existing Calendar loop, metadata adapters, context assembly, and executor; do not add a collection, activation store, permission layer, or second execution engine. Replay complete metadata-backed call/result groups in their originating turns and derive loaded revisions only from disclosures actually present in the assembled model messages. Keep raw native identity separate from the validated Calendar operation passed to the existing read/create paths.

**Tech Stack:** Existing Node.js 24, TypeScript ESM/NodeNext with `.js` imports, Zod 3, Vitest 4, MongoDB adapters, LangGraph reference-only checkpoints, existing OpenRouter SSE and Calendar executor; no dependencies added.

---

## Execution boundary and conventions

- This is **P2 planning**, not implementation or test evidence. P2 implementation waits for the P1 worker's verified commit, not just its plan at `e30b1a961057b9a697c137330e9b47aa4b6cc109`. Read that worker's actual exports and reconcile changed names before starting; send contract defects to P1 rather than editing P1-owned files.
- Inputs: [goal.md](goal.md), [state.md](state.md), the upstream P1 handoff, and existing production/test code. Only P2-owned files below may change. P3 owns assembled/performance/voice evidence; the orchestrator owns state and final evidence. Do not modify their files to make tests green.
- **Code review is skipped.** There are no review tasks, reviewer dispatches, or review-triggered fixes. Red/green tests and correction of owned defects are still required.
- Commands beginning with `npm` run in `backend`; `git` commands run at repository root. Get the orchestrator's serialized commit slot before staging/committing. Stage named task files only. Do not switch branches or create worktrees.
- Each checkbox is one action. Repeat red/implementation/green for each separately named test before moving on. A task can span several such small cycles; do not implement every test in one bulk edit.
- Add the mandatory repository code header before writing every new code file; retain existing headers and add them when changing more than 30% of an existing file. Snippets below omit decorative headers only. Local imports always end in `.js`.
- Use existing fixture stores and failure injection. No live provider/Google/OAuth calls, paid checks, application database, or provisioning. Native tests require operator-supplied isolated replica-set prerequisites and must report skips separately.
- Keep `google-calendar.v2` for operation schemas, authority, execution bindings, diagnostics, and accounting. Use `plugin-skills.v1` for native protocol/history only. Stable wrapper acceptance is **not** executable Calendar-argument validity.
- LangGraph documentation checked during planning: [node re-execution and idempotency](https://docs.langchain.com/oss/javascript/langgraph/graph-api), [persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence). Checkpoints are super-step boundaries, not mid-node transactions. Reuse durable evidence; do not infer that a restarted node is safe to repeat a write. Do not add a message reducer or copy native transcripts into graph state.

## File map before implementation

| Exact path | Responsibility/change |
| --- | --- |
| `backend/src/persistence/calendar-evidence.ts` | Add `.skills` facades on the existing decision/result adapters, preserving keys and immutable-write confirmation. |
| `backend/src/persistence/calendar-records.ts` | Widen existing redaction functions to v3 decisions; local result records are source-free and are not Google content. |
| `backend/src/persistence/calendar-retention.ts` | Read v3 decisions during existing sweeps/invalidation; never dereference `source` on local results. |
| `backend/src/persistence/persistence.ts` | Expose `skillDecisions`/`skillResults` as facades of the already-created adapters. |
| `backend/src/persistence/calendar-checkpoints.ts` | Admit P1's compatible v3 refs with the existing scope/content walker. |
| `backend/src/agent/state.ts` | Switch `CalendarRefs` to compatible skill refs; cursor/seal stay existing reference-only schemas. |
| `backend/src/chat-runtime/calendar-skills.ts` (new) | Small pure functions: assembled-disclosure lookup, local activation, loaded-revision guard, raw-native group construction. Not a service/store. |
| `backend/src/chat-runtime/calendar-history.ts` (new) | Join existing dispatches, decisions, and results with strict identities; return ordered complete groups keyed by originating turn. |
| `backend/src/context/referenced-context-assembler.ts` | Add internal message-position metadata as text history is projected; no shared contract or wire-schema edit. |
| `backend/src/context/calendar-context.ts` | Insert historical groups at those positions, distinguish local results from external provenance, estimate the complete stable request. |
| `backend/src/chat-runtime/calendar-loop.ts` | Switch the sole live model path to stable decisions; persist local outcomes before using them; gate dispatch then reuse existing read/create methods. |
| `backend/src/chat-runtime/calendar-budget.ts` | Keep existing dispatch/repair accounting; type repair input using stable request alias if needed. No new counter/store. |
| `backend/src/chat-runtime/durable-chat-runtime.ts` | Load historical groups from scoped selected records, switch saved narration reads to compatible skill decisions, keep confirmed cache and recovery safety. |
| `backend/src/chat-runtime/calendar-ports.ts` | Type the existing factory as returning `SkillModelPort` for live v2 requests. |
| `backend/src/operations/calendar-assembly.ts` | Preserve the one existing model/executor composition; remove obsolete casts only where required. |
| `backend/src/instructions/system.md` | Replace direct-native Calendar instructions with compact catalog + stable dispatch guidance while retaining action safety. |
| `backend/test/runtime/calendar-runtime.fixture.ts` | Expose the new facades, stable wire helper, and existing failure injection for local writes. |
| `backend/test/runtime/calendar-multi-fixture.ts` | Teach the shared proposal helper and native fixture to use the same stable path. |
| `backend/test/runtime/skill-activation.spec.ts` (new) | Cold/warm/batch/all activation, dedup, zero plugin calls, raw identity. |
| `backend/test/runtime/skill-correction.spec.ts` (new) | Missing/stale/invalid arguments, shared repairs, atomic budget failures, no action before admission. |
| `backend/test/runtime/skill-history.spec.ts` (new) | Turn placement, restart/reopen/isolation, complete groups, failed local saves. |
| `backend/test/persistence/skill-evidence.spec.ts` (new) | v3 local/decision storage, idempotency, isolation, compatibility and checkpoint safety. |
| `backend/test/context/skill-context.spec.ts` (new) | Source-free groups, retained disclosure authority, context limits and stable prefix. |
| Existing `backend/test/runtime/calendar-*.spec.ts`, `backend/test/context/calendar-context.spec.ts` | Migrate affected requests/wires and preserve their original safety assertions. |

Do not change `backend/src/app.service.ts`, voice, plugin execution, or the confirmed-cache implementation merely because ownership permits it. The existing application factory already creates the right adapter and executor; text-only capability admission already excludes live voice. If tracing after P1 identifies another genuine consumer, name it to the orchestrator before broadening the patch. Do not fix the unrelated baseline failures recorded in state by weakening assertions.

## Contract reconciliation checklist (before Task 1)

- [ ] Confirm P1 exports `SKILL_NATIVE_TOOLS`, `compactSkillCatalog`, `selectSkillTools`, `skillLocalResultSchema`, `skillError`, `serializeSkillLocalResult`, `SkillDecision`, `SkillDecisionRequest`, `SkillModelPort`, `ResumableSkillDecision`, `SkillDecisionStore`, `LocalSkillResultRecord`, `SkillResultStore`, and the compatible skill decoders/checkpoint schema.
- [ ] Confirm stable native calls carry `nativeCall`, `assistantContent`, and `envelope`; use `nativeCall.id`, never a reserialized operation, for history identity. Confirm the v3 result's `resultRef.storage === 'local'` preserves exact `content` and has no `source`.
- [ ] Capture the initial `git status --short` and P1 commit with `git log -1 --oneline`. P1 alone fails closed for old advertised tool arrays; close that integration gate in this plan before reporting usable Calendar chat.

## Task 1: Persist stable decisions and local results in existing metadata

**Files:** Modify `backend/src/persistence/calendar-evidence.ts`, `calendar-records.ts`, `calendar-retention.ts`, `persistence.ts`; create `backend/test/persistence/skill-evidence.spec.ts`.

- [ ] **Step 1: Write this failing test.** The valid fixture below is self-contained and requires no current Calendar connection for local discovery.

```typescript
import { expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { skillError } from '../../src/contracts/calendar-tools.js';
import { localSkillResultRecordSchema } from '../../src/contracts/calendar-sources.js';
import { resumableSkillDecisionSchema } from '../../src/contracts/calendar-model.js';
import { MongoCalendarDecisions, MongoCalendarResults } from '../../src/persistence/calendar-evidence.js';
import { calendarMemory } from './calendar-multi-memory.js';

it('stores exact source-free local results once under existing metadata identity', async () => {
  const mem = calendarMemory();
  const results = new MongoCalendarResults(mem.store, DEFAULT_BUDGETS);
  const content = JSON.stringify(skillError('SCHEMA_NOT_LOADED', 'google-calendar', 'calendar_get_event'));
  const record = localSkillResultRecordSchema.parse({ schemaVersion: 3,
    protocolVersion: 'plugin-skills.v1', kind: 'calendar-tool-result',
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd',
    eventId: 'e', sequence: 0, toolCallId: 'call', createdAt: '2026-11-04T10:00:00.000Z',
    resultRef: { storage: 'local', toolCallId: 'call', content } });
  await results.skills.put(record);
  await results.skills.put(record);
  expect(await results.skills.get('u', 's', 'call')).toEqual(record);
  expect(await results.skills.get('other', 's', 'call')).toBeNull();
  expect(await results.skills.get('u', 'other', 'call')).toBeNull();
  const changed = { ...record, resultRef: { ...record.resultRef,
    content: JSON.stringify(skillError('SCHEMA_STALE', 'google-calendar', 'calendar_get_event')) } };
  await expect(results.skills.put(changed)).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  expect(mem.calls.filter(c => c.collection === 'integration_connections')).toHaveLength(0);
});

it('round-trips stable discovery decisions without a second authorization lookup', async () => {
  const mem = calendarMemory();
  const decisions = new MongoCalendarDecisions(mem.store, DEFAULT_BUDGETS);
  const raw = '{ "plugin":"google-calendar", "tools":["calendar_get_event"] }';
  const record = resumableSkillDecisionSchema.parse({ schemaVersion: 3,
    protocolVersion: 'plugin-skills.v1', kind: 'calendar-model-decision',
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch',
    configRevision: 1, connectionId: 'connection', connectionRevision: 1, schemaRevision: 'google-calendar.v2',
    rejectedDecisionId: null, sources: [], operationId: null, intentId: null, proposalId: null,
    createdAt: '2026-11-04T10:00:00.000Z', decision: { kind: 'activate_skill', decisionId: 'd',
      assistantContent: 'Loading.', nativeCall: { id: 'call', type: 'function', function: { name: 'activate_skill', arguments: raw } },
      envelope: JSON.parse(raw), terminal: 'tool_calls' } });
  await decisions.skills.put(record);
  await decisions.skills.put(record);
  expect(await decisions.skills.get('u', 'd')).toEqual(record);
  expect(await decisions.skills.get('other', 'd')).toBeNull();
  expect(mem.calls.filter(c => c.collection === 'integration_connections')).toHaveLength(0);
});
```

- [ ] **Step 2: Run red:** `npm test -- test/persistence/skill-evidence.spec.ts`. Expected: missing `.skills` facade, not a database prerequisite skip.
- [ ] **Step 3: Add these facades inside the existing classes, using P1's types and compatible schemas.** Imports are the exports named in the reconciliation checklist plus existing `resultKey`, `decisionKey`, `decodeCalendar`, and redaction functions. Existing v1/v2 methods remain for reading old consumers, not a second live routing implementation.

```typescript
// MongoCalendarResults
readonly skills: SkillResultStore = {
  put: async record => {
    if (record.schemaVersion === 2) return this.putV2(record);
    const value = localSkillResultRecordSchema.parse(record);
    await this.store.insert('metadata', localSkillResultRecordSchema, value,
      resultKey(value.userId, value.sessionId, value.toolCallId), this.budgets.maxDocumentBytes);
  },
  get: async (userId, sessionId, toolCallId) => {
    const parsed = decodeCalendar(compatibleSkillResultRecordSchema,
      await this.store.raw('metadata', { _id: resultKey(userId, sessionId, toolCallId),
        userId, sessionId, kind: 'calendar-tool-result' }));
    return !parsed || parsed.schemaVersion === 3 ? parsed : redactCalendarResult(parsed, this.clock());
  },
};

// MongoCalendarDecisions
readonly skills: SkillDecisionStore = {
  put: async record => {
    const value = redactCalendarDecision(resumableSkillDecisionSchema.parse(record), this.clock());
    // Local disclosures have no Google content or authorization side effects.
    // Source-bearing text decisions keep the existing authoritative account race check.
    const account = value.sources.length ? await requireCalendarAccountRevision(this.store, value) : null;
    await this.store.insert('metadata', resumableSkillDecisionSchema, value,
      decisionKey('calendar-model-decision', value.userId, value.decisionId), this.budgets.maxDocumentBytes);
    if (account) await this.confirmDecisionAccount(value, account);
  },
  get: async (userId, decisionId) => {
    const parsed = decodeCalendar(compatibleSkillDecisionRecordSchema,
      await this.store.raw('metadata', { _id: decisionKey('calendar-model-decision', userId, decisionId),
        userId, kind: 'calendar-model-decision' }));
    return parsed ? redactCalendarDecision(parsed, this.clock()) : null;
  },
  putRejected: record => this.putRejectedV2(record),
};
```

- [ ] **Step 4: Make existing redaction unions additive rather than bypassing privacy.** Include `ResumableSkillDecision` in the existing overloads and private account-confirm/redact method parameters. At each existing schema selection use v3 first; the redaction body and account-race checks stay unchanged:

```typescript
const schema = record.schemaVersion === 3 ? resumableSkillDecisionSchema
  : record.schemaVersion === 2 ? resumableDecisionV2Schema : resumableDecisionSchema;
const parsed = schema.parse(record);
if (!parsed.sources.some(source => calendarSourceExpired(source, nowMs))) return parsed;
return schema.parse({ ...parsed, decision: null,
  sources: parsed.sources.map(source => markSourceRedacted(source, nowMs)) });
```

For `redactCalendarDecisionForAccount`, retain matching-user/account guard; retain source-free activation decisions because they contain only trusted registry selection metadata, but redact raw `call_tool`/text decisions on an account invalidation just as existing Calendar decisions. The concrete discriminator is:

```typescript
if (parsed.schemaVersion === 3 && parsed.decision?.kind === 'activate_skill') return parsed;
```

Switch decision decoding in retention's decision branches to `compatibleSkillDecisionRecordSchema`; choose the same three-way schema for writes. Keep source-bearing result decoding/redaction unchanged; local result records must be explicitly recognized and left alone (not passed to code that reads `resultRef.source`). Local records remain subject to existing session deletion/retention lifecycle, not Google-source expiry. Do not register local results with `calendarRetention.registerSource`.

- [ ] **Step 5: Expose the aliases in `createPersistenceBundle` beside existing `.v2` aliases.**

```typescript
skillDecisions: calendarDecisions.skills,
skillResults: calendarResults.skills,
```

- [ ] **Step 6: Run green:** `npm test -- test/persistence/skill-evidence.spec.ts test/persistence/calendar-retention.spec.ts`. If the second path differs after P1, use `npm test -- test/persistence/` and record actual failures rather than silently dropping coverage.
- [ ] **Step 7: Commit:**

```powershell
git add backend/src/persistence/calendar-evidence.ts backend/src/persistence/calendar-records.ts backend/src/persistence/calendar-retention.ts backend/src/persistence/persistence.ts backend/test/persistence/skill-evidence.spec.ts
git commit -m "feat(skills): persist local discovery in existing Calendar evidence"
```

## Task 2: Derive loaded revisions and resolve local discovery without side effects

**Files:** Create `backend/src/chat-runtime/calendar-skills.ts`, `backend/test/runtime/skill-activation.spec.ts`.

- [ ] **Step 1: Write these failing pure tests.**

```typescript
import { expect, it } from 'vitest';
import { CALENDAR_TOOLS } from '../../src/contracts/calendar-tools.js';
import { activateLocalSkill, loadedSkillRevisions, requireLoadedSkill }
  from '../../src/chat-runtime/calendar-skills.js';
import type { NativeCalendarModelMessage } from '../../src/contracts/calendar-model.js';

it('loads a batch atomically and acknowledges only assembled original disclosures', () => {
  const names = ['calendar_get_event', 'calendar_list_events'];
  const first = activateLocalSkill({ plugin: 'google-calendar', tools: names }, new Map(), 16384);
  expect(first).toMatchObject({ kind: 'skill-disclosure', alreadyLoaded: [] });
  if (first.kind !== 'skill-disclosure') throw new Error('Expected disclosure');
  expect(first.disclosures.map(d => d.tool)).toEqual(names);
  const messages: NativeCalendarModelMessage[] = [
    { role: 'assistant', content: null, tool_calls: [{ id: 'load', type: 'function', function: {
      name: 'activate_skill', arguments: JSON.stringify({ plugin: 'google-calendar', tools: names }) } }] },
    { role: 'tool', name: 'activate_skill', tool_call_id: 'load', content: JSON.stringify(first) },
  ];
  const loaded = loadedSkillRevisions(messages);
  expect(loaded.get('google-calendar:calendar_get_event')).toMatchObject({ disclosureCallId: 'load' });
  const again = activateLocalSkill({ plugin: 'google-calendar', tools: names }, loaded, 16384);
  expect(again).toMatchObject({ disclosures: [], alreadyLoaded: [
    { tool: names[0], disclosureCallId: 'load' }, { tool: names[1], disclosureCallId: 'load' }] });
  expect(JSON.stringify(again)).not.toContain('inputSchema');
  // An acknowledgement is not an original disclosure.
  expect(loadedSkillRevisions([{ role: 'assistant', content: null, tool_calls: [{ id: 'ack', type: 'function',
    function: { name: 'activate_skill', arguments: JSON.stringify({ plugin: 'google-calendar', tools: names }) } }] },
    { role: 'tool', name: 'activate_skill', tool_call_id: 'ack', content: JSON.stringify(again) }]).size).toBe(0);
  expect(activateLocalSkill({ plugin: 'google-calendar', tools: [...names, 'calendar_nope'] }, loaded, 16384))
    .toMatchObject({ code: 'UNKNOWN_TOOL' });
  expect(activateLocalSkill({ plugin: 'google-calendar', tools: 'all' }, new Map(), 100))
    .toMatchObject({ code: 'DISCLOSURE_BUDGET_EXCEEDED' });
  expect(requireLoadedSkill({ plugin: 'google-calendar', tool: names[0]!, arguments: {} }, new Map()))
    .toMatchObject({ code: 'SCHEMA_NOT_LOADED' });
  loaded.set('google-calendar:calendar_get_event', { revision: 'retired.v0', disclosureCallId: 'load' });
  expect(requireLoadedSkill({ plugin: 'google-calendar', tool: names[0]!, arguments: {} }, loaded))
    .toMatchObject({ code: 'SCHEMA_STALE' });
  expect(CALENDAR_TOOLS).toHaveLength(5);
});
```

- [ ] **Step 2: Run red:** `npm test -- test/runtime/skill-activation.spec.ts`. Expected: missing module/exports.
- [ ] **Step 3: Implement these pure functions.** Import P1's selection/serialization/result/envelope types and the existing native history validator. `SkillLocalResult`, `ActivateSkillEnvelope`, `CallToolEnvelope`, `SkillRegistryTool` come from `calendar-tools.ts`; `NativeCalendarModelMessage` comes from `calendar-model.ts`.

```typescript
export type LoadedSkill = { revision: string; disclosureCallId: string };
export type LoadedSkills = ReadonlyMap<string, LoadedSkill>;

export function loadedSkillRevisions(messages: readonly NativeCalendarModelMessage[]): Map<string, LoadedSkill> {
  assertNativeHistory(messages);
  const loaded = new Map<string, LoadedSkill>();
  for (let i = 0; i < messages.length - 1; i++) {
    const assistant = messages[i]!;
    if (!('tool_calls' in assistant)) continue;
    const call = assistant.tool_calls[0];
    const result = messages[i + 1]!;
    if (call.function.name !== 'activate_skill' || result.role !== 'tool'
      || result.name !== 'activate_skill' || result.tool_call_id !== call.id) continue;
    let value: unknown;
    try { value = JSON.parse(result.content); } catch { continue; }
    const parsed = skillLocalResultSchema.safeParse(value);
    if (!parsed.success || parsed.data.kind !== 'skill-disclosure') continue;
    const envelope = activateSkillEnvelopeSchema.parse(JSON.parse(call.function.arguments));
    if (envelope.plugin !== parsed.data.plugin) throw new AppError('INVALID_REQUEST', 'Skill history is incomplete.');
    for (const disclosure of parsed.data.disclosures) {
      if (envelope.tools !== 'all' && !envelope.tools.includes(disclosure.tool))
        throw new AppError('INVALID_REQUEST', 'Skill history is incomplete.');
      loaded.set(`${parsed.data.plugin}:${disclosure.tool}`, {
        revision: disclosure.revision, disclosureCallId: call.id,
      });
    }
  }
  return loaded;
}

export function activateLocalSkill(envelope: ActivateSkillEnvelope, loaded: LoadedSkills,
  resultBytes: number, available: readonly SkillRegistryTool[] = CALENDAR_TOOLS): SkillLocalResult {
  const selected = selectSkillTools(envelope, available);
  if (!selected.ok) return skillError(selected.code, envelope.plugin, null);
  const disclosures: Extract<SkillLocalResult, { kind: 'skill-disclosure' }>['disclosures'] = [];
  const alreadyLoaded: Extract<SkillLocalResult, { kind: 'skill-disclosure' }>['alreadyLoaded'] = [];
  for (const tool of selected.tools) {
    const prior = loaded.get(`${envelope.plugin}:${tool.name}`);
    if (prior?.revision === tool.revision) alreadyLoaded.push({ tool: tool.name, ...prior });
    else disclosures.push({ tool: tool.name, revision: tool.revision,
      inputSchema: tool.inputSchema, instructions: tool.description });
  }
  const result: SkillLocalResult = { kind: 'skill-disclosure', protocolVersion: 'plugin-skills.v1',
    plugin: envelope.plugin, disclosures, alreadyLoaded };
  try { serializeSkillLocalResult(result, resultBytes); }
  catch { return skillError('DISCLOSURE_BUDGET_EXCEEDED', envelope.plugin, null); }
  return result;
}

export function requireLoadedSkill(envelope: CallToolEnvelope, loaded: LoadedSkills): SkillLocalResult | null {
  if (envelope.plugin !== 'google-calendar') return skillError('UNKNOWN_PLUGIN', envelope.plugin, envelope.tool);
  const tool = CALENDAR_TOOLS.find(candidate => candidate.name === envelope.tool);
  if (!tool) return skillError('UNKNOWN_TOOL', envelope.plugin, envelope.tool);
  const prior = loaded.get(`${envelope.plugin}:${envelope.tool}`);
  return !prior ? skillError('SCHEMA_NOT_LOADED', envelope.plugin, envelope.tool)
    : prior.revision !== tool.revision ? skillError('SCHEMA_STALE', envelope.plugin, envelope.tool) : null;
}
```

No callback here can execute a plugin, refresh OAuth, check permissions, or persist state. The default registry is valid only inside an already enabled Calendar runtime; disabled requests must never enter this path. An acknowledgement never moves the map's original disclosure reference. Full context assembly, not this map, is the authority for admission.

- [ ] **Step 4: Run green:** `npm test -- test/runtime/skill-activation.spec.ts`.
- [ ] **Step 5: Commit:**

```powershell
git add backend/src/chat-runtime/calendar-skills.ts backend/test/runtime/skill-activation.spec.ts
git commit -m "feat(skills): derive local activation from assembled disclosures"
```

## Task 3: Preserve turn positions while assembling complete native context

**Files:** Modify `backend/src/context/referenced-context-assembler.ts`, `backend/src/context/calendar-context.ts`; create `backend/test/context/skill-context.spec.ts`.

This task does not widen P1-owned shared context contracts. Add an internal structural extension on the existing context object, not a persistence field, client field, or activation cache:

```typescript
// Export from referenced-context-assembler.ts.
export type PositionedContext = AssembledContext & {
  historyPositions: readonly { messageId: string; turnId: string; role: 'user' | 'assistant'; index: number }[];
};
```

- [ ] **Step 1: Add this failing test (all fixtures are defined here).**

```typescript
import { expect, it } from 'vitest';
import { CALENDAR_TOOLS, SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { calendarContext } from '../../src/context/calendar-context.js';
import type { PositionedContext } from '../../src/context/referenced-context-assembler.js';
import { activateLocalSkill } from '../../src/chat-runtime/calendar-skills.js';
import { completeToolGroupV2Schema } from '../../src/contracts/calendar-model.js';

it('inserts local groups in the original turn without rewriting the existing prefix', () => {
  const envelope = { plugin: 'google-calendar', tools: ['calendar_get_event'] };
  const result = activateLocalSkill(envelope, new Map(), 16384);
  const group = completeToolGroupV2Schema.parse({ assistant: { role: 'assistant', content: 'Looking up the schema.',
    tool_calls: [{ id: 'load-old', type: 'function', function: { name: 'activate_skill',
      arguments: JSON.stringify(envelope) } }] }, result: { role: 'tool', name: 'activate_skill',
    tool_call_id: 'load-old', content: JSON.stringify(result) }, sources: [] });
  const context: PositionedContext = { contextVersion: 1, instructionVersion: 'i', knowledgeContentHash: 'k',
    graphSchemaVersion: 'g', messages: [{ role: 'system', content: 'unchanged' },
      { role: 'user', content: 'Read it' }, { role: 'assistant', content: 'Done' },
      { role: 'user', content: 'Read it' }], historyPositions: [
      { messageId: 'u1', turnId: 't1', role: 'user', index: 1 },
      { messageId: 'a1', turnId: 't1', role: 'assistant', index: 2 }] };
  const assembled = calendarContext({ context, acceptedInput: 'Read it', groups: [], repair: null,
    tools: SKILL_NATIVE_TOOLS, historicalGroups: new Map([['t1', [group]]]),
    budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS, binding: {
      userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' }, now: Date.now() });
  const withoutCatalog = assembled.messages.filter(message => !message.content?.startsWith('Enabled plugin catalog (trusted application metadata):'));
  expect(withoutCatalog).toEqual([context.messages[0], context.messages[1],
    group.assistant, group.result, context.messages[2], context.messages[3]]);
  expect(assembled.loadedSkills.get('google-calendar:calendar_get_event')).toMatchObject({ disclosureCallId: 'load-old' });
  expect(CALENDAR_TOOLS.find(t => t.name === 'calendar_get_event')!.inputSchema).toEqual(
    result.kind === 'skill-disclosure' ? result.disclosures[0]!.inputSchema : null);
  expect(() => calendarContext({ context, acceptedInput: 'Read it', groups: [], repair: null,
    tools: SKILL_NATIVE_TOOLS, historicalGroups: new Map([['t1', [group]]]),
    budgets: { ...DEFAULT_BUDGETS, maxMessagesInContext: 4 }, limits: CALENDAR_LIMITS,
    binding: { userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' }, now: Date.now() }))
    .toThrow(/context limit/);
});
```

- [ ] **Step 2: Run red:** `npm test -- test/context/skill-context.spec.ts`. Expected: local result rejected as a Calendar API result, absent loaded output, or wrong insertion position.
- [ ] **Step 3: Record positions in the existing assembler's `history` loop.** Import `AssembledContext`; create `historyPositions` next to `heardHistory`; before pushing the projected message add the following. `fixedCount` is the exact already-built fixed/environment/response-mode prefix length, not an assumed magic number. Build that prefix once and reuse it in the final `messages` array.

```typescript
const prefix = [...this.fixedMessages(), environmentContextMessage(request.environment),
  responseModeMessage(request.responseMode)];
const historyPositions: PositionedContext['historyPositions'][number][] = [];
// Inside the existing loop, immediately before pushing a non-null heard message:
if (message) {
  historyPositions.push({ messageId: record.messageId, turnId: record.turnId,
    role: record.role, index: prefix.length + heardHistory.length });
  heardHistory.push(message);
}
// Preserve the existing Canvas-artifact projection immediately after this block.
const context: PositionedContext = {
  contextVersion: manifest.contextVersion, instructionVersion: this.assets.instructionVersion,
  knowledgeContentHash: this.assets.knowledgeContentHash, graphSchemaVersion: this.assets.graphSchemaVersion,
  messages, historyPositions,
};
return { ok: true, context };
```

This is per-assembly identity/position metadata only. It stores no loaded state or schemas, is never serialized to checkpoints or model messages, and does not alter plain-text model requests. Keep all current input/reference/voice-delivery validation and overflow behavior.

- [ ] **Step 4: Extend `CalendarContextInput` with `historicalGroups?: ReadonlyMap<string, readonly CompatibleCalendarToolGroup[]>`; type its `tools` and repair using `SkillDecisionRequest`.** Split local validation from external source validation before `assertV2Provenance`:

```typescript
const local = value.result.name === 'activate_skill'
  || (value.result.name === 'call_tool' && value.sources.length === 0);
if (local) {
  if (value.sources.length !== 0) incomplete();
  const result = skillLocalResultSchema.safeParse(JSON.parse(value.result.content));
  if (!result.success) incomplete();
  if (value.result.name === 'activate_skill' && result.data.kind === 'skill-disclosure'
    && JSON.parse(call.function.arguments).plugin !== result.data.plugin) incomplete();
} else if (isV2Group(value)) assertV2Provenance(value);
else if (!historical) incomplete();
```

Do not use `sources.every(...)` alone to classify local groups: an empty array vacuously passes. For current-turn groups use `limits.modelDispatches` (8), not `limits.logicalTools` (6): discovery and repair results are native groups, not external logical operations. Historical lifetime groups are bounded by retained context/messages/bytes, not six groups per chat; validate each originating turn with the eight-call ceiling and the whole assembled request against existing context bounds. Reject global duplicate call IDs. Do not reject reuse of a source merely because two valid references point to the same source; preserve existing source ownership/lifetime checks.

- [ ] **Step 5: Insert historical groups using the positions, then call P1's existing native reconstruction once.** Prefix assembly helper code inside `calendar-context.ts`:

```typescript
const positions = (input.context as Partial<PositionedContext>).historyPositions ?? [];
const insertions = new Map<number, CompatibleCalendarToolGroup[]>();
for (const [turnId, oldGroups] of input.historicalGroups ?? []) {
  if (oldGroups.length === 0) continue;
  const origin = positions.find(position => position.turnId === turnId && position.role === 'user');
  if (!origin) incomplete();
  const after = positions.find(position => position.index > origin.index
    && (position.turnId !== turnId || position.role === 'assistant'));
  const index = after?.index ?? input.context.messages.length - 1;
  if (insertions.has(index)) incomplete();
  insertions.set(index, [...oldGroups]);
}
const prefix: NativeCalendarModelMessage[] = [];
for (let index = 0; index < input.context.messages.length - 1; index++) {
  for (const group of insertions.get(index) ?? []) prefix.push(group.assistant, group.result);
  prefix.push(input.context.messages[index]!);
}
for (const group of insertions.get(input.context.messages.length - 1) ?? []) prefix.push(group.assistant, group.result);
```

Validate historical groups with the same source checks and `compatibility: 'historical'` before insertion. For removed/expired/reference-only external payloads, reconstruct an explicit paired tombstone as specified in Task 4; do not treat a tombstone as a validated API success. Pass this native `prefix` to P1's widened `rebuildCalendarMessages`, append the accepted input once and current groups once, then run the existing estimate/message-count gates using `SKILL_NATIVE_TOOLS`. Finally return:

```typescript
return { messages, estimatedInputTokens, remainingContextTokens,
  loadedSkills: loadedSkillRevisions(messages) };
```

Add `loadedSkills: ReadonlyMap<string, LoadedSkill>` to the local output type. Never derive the map before the complete history/prefix has passed assembly. Context failure admits no partial disclosure and no execution.

- [ ] **Step 6: Run green:** `npm test -- test/context/skill-context.spec.ts test/context/`. Migrate `calendar-context.spec.ts` tool-definition arguments to `SKILL_NATIVE_TOOLS` without changing legacy-group assertions. Record any unrelated existing failures.
- [ ] **Step 7: Commit:**

```powershell
git add backend/src/context/referenced-context-assembler.ts backend/src/context/calendar-context.ts backend/test/context/skill-context.spec.ts backend/test/context/calendar-context.spec.ts
git commit -m "feat(skills): assemble native history at stable turn positions"
```

## Task 4: Reconstruct ordered complete groups from existing dispatch metadata

**Files:** Create `backend/src/chat-runtime/calendar-history.ts`, `backend/test/runtime/skill-history.spec.ts`; modify `backend/src/chat-runtime/calendar-skills.ts` for shared raw group construction.

- [ ] **Step 1: Add the raw-native group helper and test its exact output before writing the metadata reader.** This helper has one responsibility and is reused for new results and replay.

```typescript
// calendar-skills.ts; imports SkillDecision and completeToolGroupV2Schema.
export function skillGroup(decision: Exclude<SkillDecision, { kind: 'text' }>,
  content: string, sources: z.infer<typeof completeToolGroupV2Schema>['sources'] = []) {
  return completeToolGroupV2Schema.parse({
    assistant: { role: 'assistant', content: decision.assistantContent, tool_calls: [decision.nativeCall] },
    result: { role: 'tool', name: decision.nativeCall.function.name,
      tool_call_id: decision.nativeCall.id, content }, sources,
  });
}
```

Test (in `skill-history.spec.ts`):

```typescript
import { expect, it } from 'vitest';
import { skillDecisionSchema } from '../../src/contracts/calendar-model.js';
import { skillError } from '../../src/contracts/calendar-tools.js';
import { skillGroup } from '../../src/chat-runtime/calendar-skills.js';

it('preserves raw arguments, native call ID, assistant content, and stored local bytes', () => {
  const raw = '{ "plugin":"google-calendar", "tool":"calendar_get_event", "arguments":{"eventId":7} }';
  const decision = skillDecisionSchema.parse({ kind: 'call_tool', decisionId: 'd', assistantContent: 'Checking.',
    nativeCall: { id: 'native-original', type: 'function', function: { name: 'call_tool', arguments: raw } },
    envelope: JSON.parse(raw), terminal: 'tool_calls' });
  if (decision.kind === 'text') throw new Error('Expected native decision');
  const content = JSON.stringify(skillError('SCHEMA_NOT_LOADED', 'google-calendar', 'calendar_get_event'), null, 1);
  const group = skillGroup(decision, content);
  expect(group.assistant.tool_calls[0].function.arguments).toBe(raw);
  expect(group.assistant.content).toBe('Checking.');
  expect(group.result).toEqual({ role: 'tool', name: 'call_tool', tool_call_id: 'native-original', content });
  expect(group.sources).toEqual([]);
});
```

- [ ] **Step 2: Run red:** `npm test -- test/runtime/skill-history.spec.ts`. Expected: missing helper. Implement the shown helper, then rerun green.
- [ ] **Step 3: Add this failing metadata-join test before the reader implementation.** These are bounded typed port doubles for the join itself; Task 9 also checks the real adapters/runtime. Add the shown imports to `skill-history.spec.ts`.

```typescript
import { vi } from 'vitest';
import { calendarBinding } from '../model/calendar-fixtures.js';
import { accepted } from './calendar-multi-fixture.js';
import { resumableSkillDecisionSchema } from '../../src/contracts/calendar-model.js';
import { localSkillResultRecordSchema } from '../../src/contracts/calendar-sources.js';
import type { PersistenceBundle } from '../../src/persistence/persistence.js';
import { calendarHistory } from '../../src/chat-runtime/calendar-history.js';

it('joins complete evidence by scoped identities and rejects mismatched result ownership', async () => {
  const dispatch = calendarBinding().dispatch;
  const raw = JSON.stringify({ plugin: 'google-calendar', tools: ['calendar_get_event'] });
  const saved = resumableSkillDecisionSchema.parse({ schemaVersion: 3,
    protocolVersion: 'plugin-skills.v1', kind: 'calendar-model-decision',
    userId: dispatch.userId, sessionId: dispatch.sessionId, turnId: dispatch.turnId,
    attemptId: dispatch.attemptId, dispatchId: dispatch.dispatchId, decisionId: dispatch.decisionId,
    configRevision: 1, connectionId: dispatch.connectionId, connectionRevision: 1,
    schemaRevision: 'google-calendar.v2', rejectedDecisionId: null, sources: [],
    operationId: null, intentId: null, proposalId: null, createdAt: dispatch.startedAt,
    decision: { kind: 'activate_skill', decisionId: dispatch.decisionId, assistantContent: null,
      nativeCall: { id: 'load', type: 'function', function: { name: 'activate_skill', arguments: raw } },
      envelope: JSON.parse(raw), terminal: 'tool_calls' } });
  const result = localSkillResultRecordSchema.parse({ schemaVersion: 3,
    protocolVersion: 'plugin-skills.v1', kind: 'calendar-tool-result',
    userId: dispatch.userId, sessionId: dispatch.sessionId, turnId: dispatch.turnId,
    attemptId: dispatch.attemptId, decisionId: dispatch.decisionId, eventId: 'e', sequence: 0,
    toolCallId: 'load', createdAt: dispatch.startedAt, resultRef: { storage: 'local', toolCallId: 'load',
      content: JSON.stringify(skillError('UNKNOWN_TOOL', 'google-calendar', null)) } });
  const get = vi.fn().mockResolvedValue(result);
  const p = { calendarAccountingV2: { listDispatches: vi.fn().mockResolvedValue([dispatch]) },
    skillDecisions: { get: vi.fn().mockResolvedValue(saved) }, skillResults: { get } } as unknown as PersistenceBundle;
  const records = [accepted('Load', { userId: dispatch.userId, sessionId: dispatch.sessionId,
    turnId: dispatch.turnId }).message];
  const groups = await calendarHistory(p, dispatch.userId, dispatch.sessionId, records);
  expect(groups.get(dispatch.turnId)?.map(g => g.result.tool_call_id)).toEqual(['load']);
  get.mockResolvedValueOnce({ ...result, turnId: 'other-turn' });
  await expect(calendarHistory(p, dispatch.userId, dispatch.sessionId, records)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  get.mockResolvedValueOnce(null);
  expect((await calendarHistory(p, dispatch.userId, dispatch.sessionId, records)).get(dispatch.turnId)).toEqual([]);
});
```

Run: `npm test -- test/runtime/skill-history.spec.ts -t "joins complete evidence"`. Expected: FAIL for the missing reader export.

- [ ] **Step 4: Add the metadata reader.** Its signature is:

```typescript
export async function calendarHistory(p: PersistenceBundle, userId: string, sessionId: string,
  records: readonly MessageRecord[]): Promise<Map<string, CompatibleCalendarToolGroup[]>>
```

Use accepted, manifest-selected `records`, not arbitrary client turn IDs or raw newest-page results. Implement this bounded join; imports are existing `CALENDAR_TOMBSTONE`, `calendarCallSchema`, compatibility/group types, `skillGroup`, and `AppError`:

```typescript
const history = new Map<string, CompatibleCalendarToolGroup[]>();
const seen = new Set<string>();
for (const turnId of [...new Set(records.filter(record => record.role === 'user').map(record => record.turnId))]) {
  const dispatches = await p.calendarAccountingV2.listDispatches(userId, turnId);
  if (dispatches.length > 8) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Calendar history needs recovery.');
  const groups: { attemptId: string; sequence: number; group: CompatibleCalendarToolGroup }[] = [];
  for (const dispatch of [...dispatches].sort((a, b) => a.dispatchIndex - b.dispatchIndex)) {
    if (dispatch.userId !== userId || dispatch.sessionId !== sessionId || dispatch.turnId !== turnId)
      throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
    const saved = await p.skillDecisions.get(userId, dispatch.decisionId);
    if (!saved) continue; // Structurally rejected/unknown inference has no accepted native call.
    if (saved.userId !== userId || saved.sessionId !== sessionId || saved.turnId !== turnId
      || saved.attemptId !== dispatch.attemptId || saved.dispatchId !== dispatch.dispatchId)
      throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
    const decision = saved.decision;
    if (!decision) {
      // Never resurrect a redacted decision from raw collection data or guess its arguments.
      throw new AppError('NOT_READY', 'Calendar history is no longer available. Start a new chat.');
    }
    if (decision.kind === 'text') continue;
    const callId = decision.kind === 'tool' ? decision.toolCallId : decision.nativeCall.id;
    const result = await p.skillResults.get(userId, sessionId, callId);
    if (!result) continue; // A terminal clarification/denial may have no model-visible result.
    if (result.userId !== userId || result.sessionId !== sessionId
      || result.turnId !== turnId || result.attemptId !== saved.attemptId
      || result.decisionId !== saved.decisionId || result.toolCallId !== callId || seen.has(callId))
      throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
    seen.add(callId);
    let content: string;
    let sources: CompatibleCalendarToolGroup['sources'];
    if (result.schemaVersion === 3) {
      if (decision.kind === 'tool') throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
      content = result.resultRef.content;
      sources = [];
    } else if (result.resultRef.storage === 'retained') {
      content = JSON.stringify(result.resultRef.result);
      sources = [result.resultRef.source];
    } else {
      content = JSON.stringify({ kind: 'calendar-history-unavailable', message: CALENDAR_TOMBSTONE });
      sources = []; // Explicit unavailable pair, never an API-success payload or schema authority.
    }
    const legacyGroupSchema = sources.some(source => source.schemaVersion === 1)
      ? completeToolGroupSchema : completeToolGroupV2Schema;
    const group = decision.kind === 'tool'
      ? legacyGroupSchema.parse({ assistant: { role: 'assistant', content: null,
          tool_calls: [{ id: callId, type: 'function', function: { name: decision.call.name,
            arguments: JSON.stringify(decision.call.arguments) } }] },
        result: { role: 'tool', name: decision.call.name, tool_call_id: callId, content }, sources })
      : skillGroup(decision, content, sources.filter(source => source.schemaVersion === 2));
    groups.push({ attemptId: result.attemptId, sequence: result.sequence, group });
  }
  if (new Set(groups.map(item => JSON.stringify([item.attemptId, item.sequence]))).size !== groups.length)
    throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
  // Dispatch index orders the logical turn; a deliberate retry may restart its per-attempt result sequence.
  const lastSequence = new Map<string, number>();
  for (const item of groups) {
    if (item.sequence <= (lastSequence.get(item.attemptId) ?? -1))
      throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
    lastSequence.set(item.attemptId, item.sequence);
  }
  history.set(turnId, groups.map(item => item.group));
}
return history;
```

The schema selection above preserves v1 retained source groups. Do not discard old records merely because their revision differs from the executable v2 registry. Loaded revisions come from stable disclosure results only, not old direct-native Calendar calls. Dispatch ordering is authoritative across attempts in one logical turn; per-attempt `sequence` is validated only within its attempt, so explicit retry does not create a false sequence collision or reorder earlier disclosures.

Add this narrow explicit tombstone branch to `calendarContext` **before** local/API schema checks. It is historical-only and does not assert loaded knowledge:

```typescript
const unavailable = value.result.content === JSON.stringify({
  kind: 'calendar-history-unavailable', message: CALENDAR_TOMBSTONE,
});
if (unavailable) {
  if (!historical || value.sources.length !== 0) incomplete();
  parsed.push(value);
  continue;
}
```

A raw decision with provenance that has expired or been redacted must not leak assistant content or arguments; if existing redaction removed that decision, fail closed as above rather than inventing a native call. Real current execution still requires current account authority. No privacy relaxation for prefix caching.

- [ ] **Step 5: Run green:** `npm test -- test/runtime/skill-history.spec.ts`. Tasks 5–9 additionally verify the reader through real adapters/runtime, including two identical user texts, restart, partial saves, and no duplicate checkpoint replay.
- [ ] **Step 6: Commit:**

```powershell
git add backend/src/chat-runtime/calendar-skills.ts backend/src/chat-runtime/calendar-history.ts backend/src/context/calendar-context.ts backend/test/runtime/skill-history.spec.ts
git commit -m "feat(skills): reconstruct ordered groups from durable Calendar metadata"
```

## Task 5: Migrate the one live model path to stable requests and checkpoint refs

**Files:** Modify `backend/src/chat-runtime/calendar-loop.ts`, `calendar-ports.ts`, `durable-chat-runtime.ts`, `backend/src/persistence/calendar-checkpoints.ts`, `backend/src/agent/state.ts`, `backend/src/operations/calendar-assembly.ts`, `backend/test/runtime/calendar-runtime.fixture.ts`; extend `skill-activation.spec.ts` and `skill-evidence.spec.ts`.

- [ ] **Step 1: Add this reusable stable wire helper to the owned runtime fixture.** It deliberately accepts a raw string to test exact native identity; do not change P1's shared fixture exports.

```typescript
export function skillWire(name: 'activate_skill' | 'call_tool', envelope: unknown,
  callId = 'skill-call', assistantContent: string | null = null): string {
  return nativeFrame({ role: 'assistant', content: assistantContent, tool_calls: [{
    index: 0, id: callId, type: 'function', function: { name,
      arguments: typeof envelope === 'string' ? envelope : JSON.stringify(envelope) },
  }] }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}
```

Add `skillDecisions`/`skillResults` to the fixture persistence composition using the same `.skills` aliases as production. Route the existing `decision-save` and `result-save` injections through these facades as well; do not install a separate in-memory activation map.

- [ ] **Step 2: Add this failing runtime test to `skill-activation.spec.ts`.**

```typescript
import { calendarFixture, textWire } from './calendar-runtime.fixture.js';

it('advertises exactly two tools and preserves ordinary text with zero plugin effects', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('What is a leap year?');
    h.modelWires.push(textWire('A year with an extra day.'));
    await h.execute(ids);
    expect(h.modelBodies).toHaveLength(1);
    expect((h.modelBodies[0]!.tools as { function: { name: string } }[]).map(t => t.function.name))
      .toEqual(['activate_skill', 'call_tool']);
    expect(h.effects).toEqual([]);
    expect(h.requestKinds).toEqual([]);
    expect((await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status).toBe('completed');
  } finally { await h.dispose(); }
});
```

- [ ] **Step 3: Run red:** `npm test -- test/runtime/skill-activation.spec.ts -t "advertises exactly"`. Expected: old five-tool request fails P1 admission or body has the old tool array.
- [ ] **Step 4: Replace the loop's model request/decision boundary.** Both the context estimate and the outgoing request use `SKILL_NATIVE_TOOLS`. Use `SkillDecision | null` and `skillDecisionSchema.parse(chunk.decision)`. Replace the v1/v2 accepted-decision write with one v3 write:

```typescript
await this.ctx.persistence.skillDecisions.put(resumableSkillDecisionSchema.parse({
  schemaVersion: 3, protocolVersion: 'plugin-skills.v1', kind: 'calendar-model-decision',
  userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
  attemptId: this.ctx.attempt.attemptId, decisionId: decision.decisionId, dispatchId: dispatch.dispatchId,
  configRevision: this.ctx.snapshot.revision, connectionId: this.ctx.binding.connectionId,
  connectionRevision: this.ctx.binding.connectionRevision, schemaRevision: 'google-calendar.v2',
  rejectedDecisionId: repair?.rejectedDecisionId ?? null,
  decision: decision.kind === 'text' && sources.some(source => source.permission.content === 'volatile') ? null : decision,
  sources, operationId: null, intentId: null, proposalId: null, createdAt: this.ctx.now(),
}));
```

`sources` is the existing text provenance filtered to v2 for a text decision, otherwise `[]`. Do not guess an operation ID for activation or a rejected wrapper; the existing intent writer owns operation identity. Preserve the adapter observation barrier, `finishDispatch`, provider user attribution, text streaming, failure categories, and existing structural rejection persistence. Replace the old live `if (decision.kind === 'tool')` block in `decide` with this non-text transition; the old canonical helper-method types remain for existing executor methods:

```typescript
if (decision.kind !== 'text') {
  this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'execute',
    pendingDecisionId: decision.decisionId, repair: null });
  return { calendarCursor: this.cursor, calendarRefs: this.refs() };
}
```

The `execute` loader uses `skillDecisions.get` and narrows stable non-text decisions; replace the obsolete legacy live execution branch with the stable branching in Tasks 6–7. Until those branches are implemented, fail closed with `NOT_READY` for non-text requests, not a cast to `CalendarDecision`. Tasks 6–8 close that temporary integration gate; ordinary text is already testable here. In the failure diagnostic branch, use `decision.kind === 'call_tool'` and its resolved canonical name only when the registry recognizes it; never access `decision.call` on a stable decision.

At the loop's `refs()` return v3 and the stable protocol marker, still current-turn only:

```typescript
version: 3 as const,
protocolVersion: 'plugin-skills.v1' as const,
```

Replace compatible-checkpoint schema imports/usages in both `calendar-checkpoints.ts` and `agent/state.ts` with P1's `compatibleSkillCheckpointRefsSchema`; retain the exported legacy aliases for old callers. Do not add schemas/results/loaded maps to cursor, seal, or checkpoint payload. `decisionIds` are the existing dispatch/decision identity refs, bounded to eight by P1's decoder; tool refs include activation/error groups as well as executed tools.

Use the existing factory return type as `SkillModelPort` at the v2 runtime boundary; do not add a factory. Keep the same `createCalendarModelPortV2` call in assembly and preserve diagnostics propagation. Change saved text-decision reads in durable publication/recovery from `calendarDecisionsV2` to `skillDecisions`, checking `decision.kind === 'text'` before reading text. Old v1/v2 reads remain accepted through the additive decoder.

- [ ] **Step 5: Add this failing checkpoint regression to `skill-evidence.spec.ts`, then switch the schemas and rerun it green.**

```typescript
import { assertCalendarCheckpointSafe } from '../../src/persistence/calendar-checkpoints.js';
it('admits eight scoped protocol refs but no ninth call or embedded schema', () => {
  const refs = { version: 3, protocolVersion: 'plugin-skills.v1', userId: 'u', sessionId: 's', turnId: 't',
    decisionIds: Array.from({ length: 8 }, (_, i) => `d-${i}`),
    toolCallIds: Array.from({ length: 8 }, (_, i) => `c-${i}`), operationId: null,
    intentId: null, proposalId: null, connectionId: 'conn', connectionRevision: 1, schemaRevision: 'google-calendar.v2' };
  expect(() => assertCalendarCheckpointSafe({ calendarRefs: refs }, { userId: 'u', sessionId: 's' })).not.toThrow();
  expect(() => assertCalendarCheckpointSafe({ calendarRefs: { ...refs, toolCallIds: [...refs.toolCallIds, 'ninth'] } },
    { userId: 'u', sessionId: 's' })).toThrow();
  expect(() => assertCalendarCheckpointSafe({ calendarRefs: { ...refs, schemas: [{}] } },
    { userId: 'u', sessionId: 's' })).toThrow();
  expect(() => assertCalendarCheckpointSafe({ calendarRefs: refs }, { userId: 'u', sessionId: 'other' })).toThrow();
});
```

- [ ] **Step 6: Run green:** `npm test -- test/runtime/skill-activation.spec.ts -t "advertises exactly"`, then `npm test -- test/persistence/skill-evidence.spec.ts`, then `npm run build`.
- [ ] **Step 7: Commit:**

```powershell
git add backend/src/chat-runtime/calendar-loop.ts backend/src/chat-runtime/calendar-ports.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/src/persistence/calendar-checkpoints.ts backend/src/agent/state.ts backend/src/operations/calendar-assembly.ts backend/test/runtime/calendar-runtime.fixture.ts backend/test/runtime/skill-activation.spec.ts backend/test/persistence/skill-evidence.spec.ts
git commit -m "feat(skills): migrate live Calendar model requests to stable protocol"
```

## Task 6: Persist atomic discovery before the next model decision

**Files:** Modify `backend/src/chat-runtime/calendar-loop.ts`, `backend/src/instructions/system.md`; extend `backend/test/runtime/skill-activation.spec.ts`.

- [ ] **Step 1: Add this failing test.**

```typescript
import { skillWire } from './calendar-runtime.fixture.js';
import type { NativeCalendarModelMessage } from '../../src/contracts/calendar-model.js';

it.each([{ tools: ['calendar_get_event'] }, { tools: ['calendar_get_event', 'calendar_list_events'] }, { tools: 'all' }])(
  'resolves selection $tools locally in one durable result with no plugin preflight', async ({ tools }) => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Load the Calendar schemas.');
      h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools }, 'load-batch'), textWire('Ready.'));
      await h.execute(ids);
      expect(h.modelBodies).toHaveLength(2);
      expect(h.effects).toEqual([]);
      expect(h.requestKinds).toEqual([]);
      const messages = h.modelBodies[1]!.messages as NativeCalendarModelMessage[];
      const results = messages.filter(m => m.role === 'tool');
      expect(results).toHaveLength(1);
      const result = results[0]!;
      if (result.role !== 'tool') throw new Error('Expected tool result');
      expect(JSON.parse(result.content)).toMatchObject({ kind: 'skill-disclosure' });
      const saved = await h.p.skillResults.get(h.identity.userId, ids.sessionId, result.tool_call_id);
      expect(saved).toMatchObject({ schemaVersion: 3, resultRef: { storage: 'local', content: result.content } });
      expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
        .toMatchObject({ modelDispatches: 2, repairs: 0, logicalTools: 0, creates: 0, calendarRequests: 0, refreshRequests: 0 });
      expect(h.modelBodies[1]!.tools).toEqual(h.modelBodies[0]!.tools);
    } finally { await h.dispose(); }
  });
```

- [ ] **Step 2: Run red:** `npm test -- test/runtime/skill-activation.spec.ts -t "resolves selection"`. Expected: non-text stable decision has no activation branch.
- [ ] **Step 3: Add `recordLocal` and use it for all local outcomes.** This helper constructs one complete group, checks the candidate assembled context first, persists exactly one existing result record, then updates in-memory groups. It must not call `requireDispatchAllowed()` in a way that adds an activation-specific Google/account preflight. Existing model-dispatch fences/current-account checks remain in their existing positions; `requireAccountCurrent` is a local authoritative store read, not an OAuth refresh.

```typescript
private async recordLocal(decision: Exclude<SkillDecision, { kind: 'text' }>,
  result: SkillLocalResult): Promise<void> {
  const content = serializeSkillLocalResult(result, this.ctx.limits.resultBytes);
  const group = skillGroup(decision, content);
  // Same context gate as the next decide, before any disclosure becomes durable/loaded.
  calendarContext({ context: this.ctx.context, acceptedInput: this.ctx.input.content,
    groups: [...this.groups, group], historicalGroups: this.ctx.historicalGroups,
    repair: null, tools: SKILL_NATIVE_TOOLS, budgets: this.ctx.snapshot.budgets,
    limits: this.ctx.limits, binding: this.ctx.binding, compatibility: 'historical',
    volatileSourceIds: this.volatileSourceIds, now: Date.parse(this.ctx.now()), note: this.modelNote });
  this.ctx.job.check();
  if (!await this.ctx.persistence.owner.fence(this.ctx.lease)) throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
  await this.ctx.persistence.skillResults.put(localSkillResultRecordSchema.parse({
    schemaVersion: 3, protocolVersion: 'plugin-skills.v1', kind: 'calendar-tool-result',
    userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
    attemptId: this.ctx.attempt.attemptId, decisionId: decision.decisionId,
    eventId: key('calendar-tool-result-event', this.ctx.attempt.userId, decision.nativeCall.id),
    sequence: this.groups.length, toolCallId: decision.nativeCall.id, createdAt: this.ctx.now(),
    resultRef: { storage: 'local', toolCallId: decision.nativeCall.id, content },
  }));
  this.groups.push(group);
}
```

Add optional `historicalGroups` to `CalendarLoopContext` (default empty map) and pass it at **every** `calendarContext` call. Activation uses `activateLocalSkill(decision.envelope, assembled.loadedSkills, limits.resultBytes)`. On candidate disclosure overflow, replace the **whole** candidate with `skillError('DISCLOSURE_BUDGET_EXCEEDED', decision.envelope.plugin, null)` and run the small result through the same context gate. If even the error will not fit, throw the existing `CONTEXT_BUDGET_EXCEEDED`; do not trim history or write a partial disclosure. After `recordLocal`, return the existing cursor patch with `next: 'decide'`, pending decision cleared, and `repair: null`. Discovery success does not reset persisted repairs.

Local metadata selection errors have `retry: 'none'`; record their matched result, then end with a useful bounded answer (no discovery correction loop for unknown metadata). A fully over-budget selection advises a smaller explicit selection/new chat and seals; do not attempt any plugin operation. The existing `answerAndSeal` is the terminal path.

- [ ] **Step 4: Update the fixed instructions, not an activation-dependent system prompt.** Replace the direct-native advertisement sentence and the first Calendar create instruction with these exact sentences; retain all other target precedence, one-call, confirmation, uncertain-outcome, and voice restrictions:

```text
Text chat may use only currently advertised native tools. For enabled plugins, activate_skill loads one, several, or all canonical tool schemas locally; call_tool executes a loaded tool. Batch schemas already needed in one activation and reuse retained disclosures on follow-ups. If the plugin tools are disabled or unadvertised, do not claim access or invent results. Live voice has no Calendar tools.

If the user wants an event created, load calendar_create_event if needed, then use call_tool with plugin google-calendar, tool calendar_create_event, and the best-known arguments, including a one-hour end when omitted. The runtime shows a Yes/Cancel preview; do not interrogate for every field. Do not require a JSON echo.
```

Append the deterministic compact catalog once in the enabled Calendar context prefix, immediately before historical/current user messages, not on every activation. In `calendarContext` compute the original insertion index from the first positioned historical message, or the accepted-input position for an empty chat. Add this statement at that index in the prefix-building loop (also handle the accepted-input boundary after the loop):

```typescript
const catalogIndex = positions[0]?.index ?? input.context.messages.length - 1;
const catalogMessage = { role: 'system' as const,
  content: 'Enabled plugin catalog (trusted application metadata):\n' + JSON.stringify(compactSkillCatalog()) };
// At the beginning of each original index, before historical insertion/text:
if (index === catalogIndex) prefix.push(catalogMessage);
// After the loop, before groups inserted at the accepted-input boundary:
if (catalogIndex === input.context.messages.length - 1) prefix.push(catalogMessage);
```

This is the Calendar-only assembly function, so disabled/plain/voice requests do not acquire the catalog. Subsequent context calls use the same catalog bytes and position. Do not put full schemas in this prefix, and do not mutate the original positions when adding the catalog.

- [ ] **Step 5: Run green:** `npm test -- test/runtime/skill-activation.spec.ts test/context/skill-context.spec.ts`.
- [ ] **Step 6: Commit:**

```powershell
git add backend/src/chat-runtime/calendar-loop.ts backend/src/context/calendar-context.ts backend/src/instructions/system.md backend/test/runtime/skill-activation.spec.ts
git commit -m "feat(skills): persist bounded local schema batches without plugin calls"
```

## Task 7: Gate execution and share the existing bounded correction loop

**Files:** Modify `backend/src/chat-runtime/calendar-loop.ts`, `calendar-budget.ts`; create `backend/test/runtime/skill-correction.spec.ts`.

- [ ] **Step 1: Write this failing missing-load/argument-correction test.**

```typescript
import { expect, it } from 'vitest';
import type { NativeCalendarModelMessage } from '../../src/contracts/calendar-model.js';
import { calendarFixture, skillWire, textWire } from './calendar-runtime.fixture.js';

it('shares two repairs across missing schema and invalid arguments before one real read', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    const envelope = { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } };
    h.modelWires.push(skillWire('call_tool', envelope, 'missing'),
      skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'load'),
      skillWire('call_tool', { ...envelope, arguments: { eventId: 7 } }, 'bad'),
      skillWire('call_tool', envelope, 'good'), textWire('Found it.'));
    await h.execute(ids);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(5);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 2, logicalTools: 1, creates: 0, modelDispatches: 5 });
    const local = (h.modelBodies.at(-1)!.messages as NativeCalendarModelMessage[])
      .filter(m => m.role === 'tool').map(m => JSON.parse(m.content) as { code?: string });
    expect(local.map(r => r.code).filter(Boolean)).toEqual(['SCHEMA_NOT_LOADED', 'ARGUMENTS_INVALID']);
    for (const body of h.modelBodies) expect(body.user).toBe(h.identity.openRouterUser);
  } finally { await h.dispose(); }
});

it('seals after two repair cycles and never executes the third rejected request', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    const envelope = { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } };
    h.modelWires.push(...['one', 'two', 'three'].map(id => skillWire('call_tool', envelope, id)));
    await h.execute(ids);
    expect(h.effects).toEqual([]);
    expect(h.modelBodies).toHaveLength(3);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 2, logicalTools: 0, creates: 0 });
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 100 });
    expect(messages.items.find(m => m.role === 'assistant')?.content).toContain('correcting');
  } finally { await h.dispose(); }
});
```

- [ ] **Step 2: Run red:** `npm test -- test/runtime/skill-correction.spec.ts`. Expected: wrappers are not routed to guarded execution or no matched local rejection is recorded.
- [ ] **Step 3: Keep `SkillDecision` as durable/native identity and create a temporary typed execution view only after guards.** Do not persist this view or use it to serialize history:

```typescript
// In execute after re-reading the exact saved stable decision and assembling current context:
if (decision.kind === 'call_tool') {
  const rejection = requireLoadedSkill(decision.envelope, assembled.loadedSkills);
  if (rejection) {
    await this.recordLocal(decision, rejection);
    if (rejection.kind === 'skill-error' && rejection.retry === 'activate-skill') {
      const code = rejection.code === 'SCHEMA_STALE' ? 'schema-stale' : 'schema-not-loaded';
      return this.repairOrSeal(input, decision.decisionId, [{ path: 'tool', code, expected: 'bounded-value' }]);
    }
    return this.answerAndSeal(input, 'That plugin or tool is not available.', decision.decisionId);
  }
  let call: CalendarCall;
  try {
    // Established executor validator is the authority, reused here as before.
    call = validateCalendarCall({ name: decision.envelope.tool, arguments: decision.envelope.arguments },
      this.ctx.limits, this.ctx.diagnostics?.emit);
  } catch (error) {
    if (!(error instanceof CalendarToolFault)) throw error;
    if (error.failure.retry === 'schema-repair' || error.failure.code === 'CALENDAR_INPUT_REJECTED'
      || error.failure.code === 'CALENDAR_ARGUMENTS_INVALID') {
      const diagnostics: CalendarRepairDiagnostics = [{ path: 'tool_calls.arguments',
        code: 'invalid-value', expected: 'bounded-value' }];
      await this.recordLocal(decision, skillError('ARGUMENTS_INVALID', decision.envelope.plugin,
        decision.envelope.tool, diagnostics));
      return this.repairOrSeal(input, decision.decisionId, diagnostics);
    }
    return this.failConversationally(input, error.failure, decision.decisionId);
  }
  const executionDecision = { kind: 'tool' as const, decisionId: decision.decisionId,
    toolCallId: decision.nativeCall.id, call, terminal: 'tool_calls' as const };
  return call.name === 'calendar_create_event'
    ? this.executeCreateV2(input, executionDecision)
    : this.executeReadV2(input, executionDecision);
}
```

`validateCalendarCall` already accepts `unknown` and returns the validated `CalendarCall` (`tools-validation.ts:267–304`); reuse that return without modifying its API or reparsing. **Do not duplicate Zod/domain validation in the model adapter or local-discovery helper.** Existing executor checks still run at their own boundary, as they already do for trusted direct invocation.

Perform this guard before logical-tool charging, target resolution, credentials, preflight, operation reservation, or external execution. Recompute it against the exact assembled context at execution, not a client flag or an in-memory registry of previously loaded tools. `requireDispatchAllowed` retains its existing lease/deadline/account fencing but adds no new preflight.

- [ ] **Step 4: Reuse `repairOrSeal` and `CalendarTurnLedger.reserveDispatch`.** Existing `schema-repair` dispatch reservation increments the persisted repair counter once. Missing/stale/argument local results call that same path; successful discovery sets `repair: null` but never resets `budget.repairs`. Do not increment at both the error and the next dispatch. The third rejection is saved for history and seals with the existing explicit correction-exhausted answer; no fourth dispatch. Existing raw structural model rejection also shares this counter. Every model request still reserves spend/output/context and observes the original deadline.

For post-executor read validation failures such as invalid page tokens, save `ARGUMENTS_INVALID` against the original stable decision before using the existing correction path. Only failures proving no external mutation was attempted are repairable. Provider/credential/access failures and uncertain writes must retain their existing failure/reconciliation path, not become schema errors. Preserve redundant-read detection by extracting canonical operations from both legacy direct calls and stable `call_tool` envelopes; skip discovery/error groups and stop reusing earlier read results after a successful create. The guard's valid call is the operation compared by `sameCalendarCall`.

- [ ] **Step 5: Run green:** `npm test -- test/runtime/skill-correction.spec.ts test/runtime/calendar-budget.spec.ts test/plugins/`.
- [ ] **Step 6: Commit:**

```powershell
git add backend/src/chat-runtime/calendar-loop.ts backend/src/chat-runtime/calendar-budget.ts backend/test/runtime/skill-correction.spec.ts
git commit -m "feat(skills): reject unloaded dispatch and share bounded corrections"
```

No plugin validator change or new validation/permission service is needed.

## Task 8: Preserve original native identity through real reads, creates, and confirmation

**Files:** Modify `backend/src/chat-runtime/calendar-loop.ts`, `backend/test/runtime/calendar-runtime.fixture.ts`, `backend/test/runtime/calendar-multi-fixture.ts`; extend `skill-activation.spec.ts`, existing `calendar-confirmation.spec.ts`, `calendar-multi-recovery.spec.ts` only where fixture wire migration requires it.

- [ ] **Step 1: Add this failing cold-read test.**

```typescript
it('adds one cold discovery request then executes once with the original dispatcher identity', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    const raw = '{ "tool":"calendar_get_event", "plugin":"google-calendar", "arguments":{"eventId":"abcde"} }';
    h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'load'),
      skillWire('call_tool', raw, 'dispatch-original', 'I will read it.'), textWire('Found it.'));
    await h.execute(ids);
    expect(h.modelBodies).toHaveLength(3);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(1);
    const messages = h.modelBodies[2]!.messages as NativeCalendarModelMessage[];
    const native = messages.find(m => 'tool_calls' in m && m.tool_calls[0].function.name === 'call_tool');
    expect(native).toMatchObject({ content: 'I will read it.', tool_calls: [{ function: { name: 'call_tool', arguments: raw } }] });
    const result = messages.find(m => m.role === 'tool' && m.name === 'call_tool');
    expect(result).toBeDefined();
    if (!native || !('tool_calls' in native) || !result || result.role !== 'tool') throw new Error('Expected matched pair');
    expect(result.tool_call_id).toBe(native.tool_calls[0].id);
    expect(JSON.parse(result.content)).toMatchObject({ tool: 'calendar_get_event' });
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ logicalTools: 1, creates: 0, repairs: 0 });
  } finally { await h.dispose(); }
});
```

- [ ] **Step 2: Run red:** `npm test -- test/runtime/skill-activation.spec.ts -t "adds one cold"`. Expected: record/group uses direct Calendar name or drops raw native content.
- [ ] **Step 3: Pass the already re-read stable decision from `execute` through the existing read/create method arguments to result recording.** This avoids another metadata read or a separate identity cache. Add a `native: Extract<SkillDecision, { kind: 'call_tool' }>` parameter to `executeReadV2`, `executeCreateV2`, and `recordResult`; pass `decision` from the guarded stable branch. For `finishCreate`, add optional `native` on its existing context argument because proposal-confirmed creates have no model call. Result persistence and retention still happen first, followed by:

```typescript
if (native.decisionId !== decision.decisionId || native.nativeCall.id !== decision.toolCallId)
  throw new AppError('NOT_READY', 'Calendar decision is unavailable.');
this.groups.push(skillGroup(native, JSON.stringify(invoked.result), [invoked.source]));
```

Use exactly that passed native decision in `finishCreate` for a model-requested create:

```typescript
if (context.native) this.groups.push(skillGroup(context.native, JSON.stringify(outcome.result), [outcome.source]));
```

For a proposal-confirmed create with no model decision, keep the existing deterministic operation/proposal receipt path and do not fabricate an `activate_skill`/`call_tool` call. Persist its receipt and emit/seal exactly as before; it need not add a model group because no model call originated it. Do not produce a result group whose assistant native call was never emitted. Keep `CalendarOperationWriter`, intent/proposal IDs, budget debit identities, capability/preflight checks, event-ID idempotency, and receipt-first narration unchanged.

If a model-requested create ends with a clarification or denial rather than a native result, preserve the durable decision/proposal and terminal answer; do not invent a Google result or loaded state. Executing an already authorized proposal is not a new model dispatch and does not require a ceremonial schema-discovery call. The original proposal's accepted authority, not retained schema knowledge, authorizes that path.

- [ ] **Step 4: Migrate owned fixture helpers honestly.** Add an explicit activation wire before the stable dispatch in `disclose` and change `createWire` to emit the `call_tool` wrapper. Callers must enqueue a cold activation explicitly; do not make `skillWire` auto-load or fake loaded state in fixtures. Keep helpers for intentionally malformed wrapper tests distinct from valid domain-argument failures. Tests asserting no second model request for confirmation must still assert exactly that after the first cold discovery+proposal sequence.

Update the native fixture's persistence facades and emitted wires the same way; do not run native tests without prerequisites. P3 migrates its integration/voice/benchmark fixtures after P2's handoff.

- [ ] **Step 5: Run green:** `npm test -- test/runtime/skill-activation.spec.ts test/runtime/calendar-confirmation.spec.ts test/runtime/calendar-authority.spec.ts test/runtime/calendar-operation.spec.ts test/runtime/calendar-multi-recovery.spec.ts`.
- [ ] **Step 6: Commit:**

```powershell
git add backend/src/chat-runtime/calendar-loop.ts backend/test/runtime/calendar-runtime.fixture.ts backend/test/runtime/calendar-multi-fixture.ts backend/test/runtime/skill-activation.spec.ts backend/test/runtime/calendar-confirmation.spec.ts backend/test/runtime/calendar-multi-recovery.spec.ts
git commit -m "feat(skills): preserve dispatcher identity through Calendar safety paths"
```

## Task 9: Restore disclosures on warm follow-up, reopening, and restart without cache authority

**Files:** Modify `backend/src/chat-runtime/durable-chat-runtime.ts`; extend `backend/test/runtime/skill-history.spec.ts` and `skill-activation.spec.ts`.

- [ ] **Step 1: Add this failing end-to-end history test.**

```typescript
import type { NativeCalendarModelMessage } from '../../src/contracts/calendar-model.js';
import { calendarFixture, skillWire, textWire } from './calendar-runtime.fixture.js';

it.each([false, true])('restores disclosures in the original turn with restart=%s and zero warm discovery', async restart => {
  const h = calendarFixture();
  try {
    const first = await h.submit('Read event abcde');
    h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'load'),
      skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'get-first'),
      textWire('First answer.'));
    await h.execute(first);
    if (restart) await h.restart();
    const second = await h.submit('Read event abcde', first.sessionId);
    const before = h.modelBodies.length;
    h.modelWires.push(skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'get-second'),
      textWire('Second answer.'));
    await h.execute(second);
    expect(h.modelBodies.length - before).toBe(2);
    const messages = h.modelBodies[before]!.messages as NativeCalendarModelMessage[];
    const firstUser = messages.findIndex(m => m.role === 'user' && m.content === 'Read event abcde');
    const load = messages.findIndex(m => 'tool_calls' in m && m.tool_calls[0].function.name === 'activate_skill');
    const firstAnswer = messages.findIndex(m => m.role === 'assistant' && m.content === 'First answer.');
    const nextUser = messages.findLastIndex(m => m.role === 'user' && m.content === 'Read event abcde');
    expect(firstUser).toBeLessThan(load);
    expect(load).toBeLessThan(firstAnswer);
    expect(firstAnswer).toBeLessThan(nextUser);
    expect(messages.filter(m => m.role === 'tool' && m.name === 'activate_skill')).toHaveLength(1);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(2);
    const other = await h.submit('Read event abcde');
    h.modelWires.push(skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'unloaded'),
      textWire('Load it first.'));
    const otherBefore = h.modelBodies.length;
    await h.execute(other);
    const correction = h.modelBodies[otherBefore + 1]!.messages as NativeCalendarModelMessage[];
    expect(correction.some(m => m.role === 'tool' && m.content.includes('SCHEMA_NOT_LOADED'))).toBe(true);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(2);
  } finally { await h.dispose(); }
});
```

- [ ] **Step 2: Run red:** `npm test -- test/runtime/skill-history.spec.ts -t "restores disclosures"`. Expected: warm call rejected as missing or old groups appear after the second user.
- [ ] **Step 3: Load history in `executeCalendarTurn` from the already-validated context source.** Before constructing the loop:

```typescript
const records = input.sourceRecords ?? await p.messages.getReferences(a.userId, a.sessionId, manifest.messageRefs);
const selected = selectReferences({ userId: a.userId, sessionId: a.sessionId, turnId: a.turnId,
  newUserInput: input.input.content, responseMode: 'text' }, manifest, [...records], this.d.assets, snapshot.budgets);
const historicalGroups = await calendarHistory(p, a.userId, a.sessionId, selected);
```

Pass `historicalGroups` to the loop. The source records must be exactly the accepted, manifest-selected history, excluding the new input. Never rebuild from timestamps, text matching, checkpoint-restored messages, or a newest-page transcript. Let the positioned context establish placement; validate every returned group before using it.

Keep `ConfirmedStateCache` as a cache of confirmed manifests/immutable records only. **Do not add loaded booleans/revisions or external payloads to it.** On a cache hit, reload the same metadata-backed native groups through the same redaction-aware adapters and derive loaded knowledge from the assembled messages. On restart/cache miss the same reader produces identical groups. Existing generation/checkpoint/hash/TTL checks and refreshed sensitive transcript refs remain unchanged; no new cache invalidation protocol is needed. Discovery persistence failure must not populate `groups` or loaded state, nor create a confirmed cache entry for the failed turn.

Continue respecting the existing unsealed-inference rule: no saved terminal decision means unknown inference, not permission to redispatch. A succeeded/unknown operation follows existing publication/readback paths; schema activation never authorizes repeating a mutation. This plan restores retained knowledge across completed/accepted chat history; it does not introduce automatic in-flight replay for unsafe graph nodes.

- [ ] **Step 4: Add this failing compact-repeat test, then implement only any missing path through existing helpers.**

```typescript
it('acknowledges a retained original disclosure without copying its schema on follow-up', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('Load one schema');
    const load = { plugin: 'google-calendar', tools: ['calendar_get_event'] };
    h.modelWires.push(skillWire('activate_skill', load, 'original'), textWire('Ready.'));
    await h.execute(first);
    const second = await h.submit('Load that schema again', first.sessionId);
    h.modelWires.push(skillWire('activate_skill', load, 'repeat'), textWire('Still ready.'));
    await h.execute(second);
    const results = (h.modelBodies.at(-1)!.messages as NativeCalendarModelMessage[])
      .filter(m => m.role === 'tool' && m.name === 'activate_skill');
    expect(results).toHaveLength(2);
    expect(results[0]!.content).toContain('inputSchema');
    expect(results[1]!.content).not.toContain('inputSchema');
    expect(JSON.parse(results[1]!.content)).toMatchObject({ disclosures: [],
      alreadyLoaded: [{ tool: 'calendar_get_event', disclosureCallId: results[0]!.tool_call_id }] });
  } finally { await h.dispose(); }
});
```

- [ ] **Step 5: Run green:** `npm test -- test/runtime/skill-history.spec.ts test/runtime/skill-activation.spec.ts test/runtime/calendar-recovery-unavailable.spec.ts test/runtime/calendar-recovery.spec.ts`. Ask P3 to run its owned `backend/test/performance/confirmed-state-cache.spec.ts`; do not silently claim the cache regressions passed.
- [ ] **Step 6: Commit:**

```powershell
git add backend/src/chat-runtime/durable-chat-runtime.ts backend/test/runtime/skill-history.spec.ts backend/test/runtime/skill-activation.spec.ts
git commit -m "feat(skills): restore disclosed schemas across cache hits and restarts"
```

## Task 10: Lock down failed saves, stale refresh, and no partial activation

**Files:** Extend `backend/test/runtime/skill-history.spec.ts`, `skill-correction.spec.ts`, `skill-activation.spec.ts`; make necessary corrections only in the owned paths already named above.

- [ ] **Step 1: Add these exact failing tests one at a time.**

```typescript
// skill-history.spec.ts
it('does not execute or infer loaded knowledge after an unconfirmed local result save', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.failOnce('result-save');
    h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'load'),
      skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'never'));
    await expect(h.execute(ids)).rejects.toBeDefined();
    expect(h.modelBodies).toHaveLength(1);
    expect(h.effects).toEqual([]);
    expect((await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status).not.toBe('completed');
    const graph = await h.calendarGraphState(ids.sessionId);
    expect(JSON.stringify(graph.values)).not.toContain('inputSchema');
  } finally { await h.dispose(); }
});
```

```typescript
// skill-correction.spec.ts: add these imports; the test injects historical metadata, not an executor.
import { vi } from 'vitest';
import { CALENDAR_TOOLS } from '../../src/contracts/calendar-tools.js';
import { localSkillResultRecordSchema } from '../../src/contracts/calendar-sources.js';

it('rejects an unsupported retained revision before action then appends the current disclosure', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('Load the event schema');
    h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'old-load'), textWire('Ready.'));
    await h.execute(first);
    const originalGet = h.p.skillResults.get.bind(h.p.skillResults);
    const spy = vi.spyOn(h.p.skillResults, 'get').mockImplementation(async (...args) => {
      const result = await originalGet(...args);
      if (!result || result.schemaVersion !== 3) return result;
      const value = JSON.parse(result.resultRef.content);
      if (value.kind !== 'skill-disclosure' || value.disclosures.length === 0) return result;
      return localSkillResultRecordSchema.parse({ ...result, resultRef: { ...result.resultRef,
        content: JSON.stringify({ ...value, disclosures: value.disclosures.map((d: Record<string, unknown>) => ({ ...d, revision: 'retired.v0' })) }) } });
    });
    const second = await h.submit('Read event abcde', first.sessionId);
    h.modelWires.push(skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'stale'),
      skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'refresh'),
      skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'fresh'), textWire('Found it.'));
    await h.execute(second);
    spy.mockRestore();
    const messages = h.modelBodies.at(-1)!.messages as NativeCalendarModelMessage[];
    expect(messages.some(m => m.role === 'tool' && m.content.includes('SCHEMA_STALE'))).toBe(true);
    const disclosures = messages.filter(m => m.role === 'tool' && m.name === 'activate_skill').map(m => JSON.parse(m.content));
    expect(disclosures.map(d => d.disclosures[0]?.revision)).toEqual(['retired.v0', CALENDAR_TOOLS[0]!.revision]);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(1);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, second.sessionId, second.turnId)).toMatchObject({ repairs: 1 });
  } finally { vi.restoreAllMocks(); await h.dispose(); }
});
```

```typescript
// skill-activation.spec.ts
it('rejects an unknown batch atomically without disclosing its valid subset', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Load a batch');
    h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar',
      tools: ['calendar_get_event', 'calendar_nope'] }, 'bad-batch'));
    await h.execute(ids);
    expect(h.effects).toEqual([]);
    expect(h.requestKinds).toEqual([]);
    expect(h.modelBodies).toHaveLength(1);
    const dispatches = await h.p.calendarAccountingV2.listDispatches(h.identity.userId, ids.turnId);
    const saved = await h.p.skillDecisions.get(h.identity.userId, dispatches[0]!.decisionId);
    if (!saved?.decision || saved.decision.kind !== 'activate_skill') throw new Error('Expected stable decision');
    const record = await h.p.skillResults.get(h.identity.userId, ids.sessionId, saved.decision.nativeCall.id);
    expect(record).toMatchObject({ resultRef: { storage: 'local' } });
    if (!record || record.schemaVersion !== 3) throw new Error('Expected local result');
    expect(JSON.parse(record.resultRef.content)).toMatchObject({ code: 'UNKNOWN_TOOL', retry: 'none' });
    expect(record.resultRef.content).not.toContain('inputSchema');
  } finally { await h.dispose(); }
});
```

- [ ] **Step 2: Run red/green for each:** `npm test -- test/runtime/skill-history.spec.ts -t "unconfirmed local"`; `npm test -- test/runtime/skill-correction.spec.ts -t "unsupported retained"`; `npm test -- test/runtime/skill-activation.spec.ts -t "unknown batch"`.
- [ ] **Step 3: Correct only the broken shared path, preserving the implementation order already specified:** validate complete selection, assemble complete candidate, persist one local result, then append its group. Never put an attempted/unconfirmed disclosure into a loaded map. For stale reload append the new original disclosure; do not edit or replace the old one, and do not acknowledge the retired revision as current. Use the same `repairOrSeal`; no new retry loop.
- [ ] **Step 4: Write this failing durable-terminal-narration regression in `skill-history.spec.ts`.** Local errors do not have a provider text decision; their final answer must still be recoverable without inference.

```typescript
it('saves local terminal narration before the seal so publication never needs inference', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Load an unknown plugin');
    h.modelWires.push(skillWire('activate_skill', { plugin: 'not-enabled', tools: 'all' }, 'unknown'));
    await h.execute(ids);
    const snapshot = await h.calendarGraphState(ids.sessionId);
    const seal = snapshot.values.calendarSeal;
    expect(seal.narrationRef.kind).toBe('text-decision');
    const record = await h.p.skillDecisions.get(h.identity.userId, seal.narrationRef.decisionId);
    expect(record?.decision).toMatchObject({ kind: 'text', truncated: false });
    if (record?.decision?.kind !== 'text') throw new Error('Expected saved local narration');
    const archived = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 100 });
    expect(record.decision.content).toBe(archived.items.find(m => m.role === 'assistant')?.content);
    const before = h.modelBodies.length;
    await h.restart();
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    expect(h.modelBodies).toHaveLength(before);
    expect(h.effects).toEqual([]);
  } finally { await h.dispose(); }
});
```

Run: `npm test -- test/runtime/skill-history.spec.ts -t "saves local terminal"`. Expected: FAIL because the seal points to a non-text native decision rather than durably saved terminal narration.

- [ ] **Step 5: Save a deterministic source-bearing text decision for runtime-authored narration in `CalendarLoop.seal`, before creating its narration reference.** Reuse existing decision storage, not a new seal payload or message copy in checkpoints. This applies to local terminal errors/exhaustion and receipt-authored narration; a model text decision or proposal-message reference already provides its own durable source.

```typescript
if (!this.textDecisionId && !this.lastProposalId) {
  const decisionId = key('calendar-local-narration', this.ctx.attempt.userId,
    this.ctx.attempt.sessionId, this.ctx.attempt.attemptId);
  const sources = this.provenance().filter(source => source.schemaVersion === 2);
  await this.ctx.persistence.skillDecisions.put(resumableSkillDecisionSchema.parse({
    schemaVersion: 3, protocolVersion: 'plugin-skills.v1', kind: 'calendar-model-decision',
    userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
    attemptId: this.ctx.attempt.attemptId, decisionId,
    dispatchId: this.dispatchIds.at(-1) ?? key('calendar-local-dispatch-ref', this.ctx.attempt.attemptId),
    configRevision: this.ctx.snapshot.revision, connectionId: this.ctx.binding.connectionId,
    connectionRevision: this.ctx.binding.connectionRevision, schemaRevision: 'google-calendar.v2',
    rejectedDecisionId: null, sources,
    decision: sources.some(source => source.permission.content === 'volatile') ? null
      : { kind: 'text', decisionId, content: this.lastText, truncated: this.truncated },
    operationId: this.lastOperationId, intentId: this.lastIntentId, proposalId: this.lastProposalId,
    createdAt: this.ctx.attempt.createdAt,
  }));
  this.textDecisionId = decisionId;
}
```

The deterministic record is local narration linked to the last real dispatch/operation, **not** a charged model dispatch, tool call, or ninth call ref. Do not add it to `dispatchIds`, reserve tokens for it, or infer a provider request occurred. Keep volatile-content refusal/redaction intact. Publication recovery uses the saved narration through `skillDecisions.get`; it never asks a model to recreate a local error or confirmed receipt. If P1's implemented decision record has an additional provenance discriminator, use that compatible contract rather than adding a new shared schema without P1 ownership.

- [ ] **Step 6: Run the full focused additions:** `npm test -- test/runtime/skill-activation.spec.ts test/runtime/skill-correction.spec.ts test/runtime/skill-history.spec.ts test/context/skill-context.spec.ts test/persistence/skill-evidence.spec.ts`.
- [ ] **Step 7: Commit the exact tests and the owned terminal-narration correction:**

```powershell
git add backend/src/chat-runtime/calendar-loop.ts backend/test/runtime/skill-history.spec.ts backend/test/runtime/skill-correction.spec.ts backend/test/runtime/skill-activation.spec.ts
git commit -m "test(skills): cover stale disclosures and durable activation failures"
```

## Task 11: Migrate affected owned regressions and verify the P2 integration gate

**Files:** Necessary existing tests under `backend/test/runtime/`, `backend/test/context/`, `backend/test/persistence/`, `backend/test/plugins/` only; production corrections remain in the exact owned files above. Do not edit P1/P3 tests.

- [ ] **Step 1: Find every remaining owned legacy request/wire caller.**

```powershell
rg -n "CALENDAR_TOOLS|nativeWire|createWire|calendar_create_event|calendar_get_event" backend/test/runtime backend/test/context backend/test/persistence backend/test/plugins
rg -n "calendarDecisionsV2|calendarResultsV2|CALENDAR_TOOLS|kind === 'tool'" backend/src/chat-runtime backend/src/context backend/src/operations backend/src/voice
```

Separate historical-read tests (keep original native names) from live-model fixtures (migrate to `skillWire` and explicit cold activation). Preserve meaningful recovery/confirmation/idempotency assertions; update expected request counts by exactly the cold discovery increment, not arbitrary new counts. Existing exact pagination calls require `{ cursor: null, limit: 100 }` where the current API requires options; do not misdiagnose the research baseline's stale callers as skill defects. List unrelated baseline failures and send them to the orchestrator instead of performing broad cleanup.

- [ ] **Step 2: For each failing affected regression, run its exact focused command before changing it.** Example: `npm test -- test/runtime/calendar-loop.spec.ts -t "adds one matched result group"`. Its new valid cold sequence is:

```typescript
h.modelWires.push(
  skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'load'),
  skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'get'),
  textWire('Found it.'),
);
```

Its assertion becomes two complete groups (activation and execution), both matching original native call IDs/names. A warm fixture first establishes a durable disclosure, not a mocked loaded flag. Malformed wrapper tests use `skillWire('call_tool', '{')`; valid wrapper/invalid Calendar arguments reach the existing executor validator. Keep missing input/semantic clarification outcomes distinct from schema repair. A write that may have reached Google never becomes a repairable `ARGUMENTS_INVALID`.

- [ ] **Step 3: Run and record these deterministic commands with pass/fail/skip counts.**

```powershell
npm run build
npm run lint
npm test -- test/runtime/ test/context/ test/persistence/ test/plugins/
npm test
```

Do not run unrelated frontend checks as a substitute for P2 evidence. The orchestrator runs both packages at final verification. A known baseline failure is still a failed command; report it separately and do not claim a passing P2 gate until relevant new/affected behavior is green. Any P1 model-contract defect returns to P1; any P3 fixture migration waits for P3 ownership.

- [ ] **Step 4: Run native suites only when the operator supplied isolated prerequisites.** From `backend`: `npm run test:e2e -- test/runtime/calendar-recovery.native.e2e-spec.ts test/runtime/isolation.native.e2e-spec.ts`. Record absent MongoDB prerequisites as skipped/not executed, not passed. Never discover application credentials or point fixtures at application data.
- [ ] **Step 5: Check patch hygiene:** `git diff --check` and `git diff --stat`. No new collection/index/platform/dependency, no activation authorization/preflight call, no legacy advertised tool array in live P2 callers, no loaded state independent of assembled disclosures.
- [ ] **Step 6: Commit named changed owned regressions/corrections using:** `git commit -m "test(skills): migrate Calendar regressions to durable stable dispatch"`. List each actual path in `git add`; do not stage a directory or use `git add .`.

## Acceptance mapping and handoff

| Requirement | Planned evidence |
| --- | --- |
| Local one/many/all; no Google/OAuth/preflight or create debit | Tasks 2, 6; activation budgets and requestKinds/effects assertions |
| Atomic invalid/over-budget batches; no partial loaded state | Tasks 2, 3, 6, 10; serializer + full candidate context gate |
| Compact repeat acknowledgement; original disclosure retained | Tasks 2, 9 |
| Missing/stale rejection before action and automatic correction | Tasks 7, 10 |
| At most two shared repair cycles, finite dispatch/spend/deadline | Task 7 and existing ledger regressions |
| Exact native IDs/names/raw arguments/assistant text; complete ordered groups | Tasks 3–5, 8–9 |
| Original turn placement, no checkpoint duplication or silent truncation | Tasks 3–4, 9 |
| Cold +1 discovery request, warm +0, one batch result | Tasks 6, 8–9; P3 independently counts assembled paths |
| Reopen/restart and new-chat/user isolation | Task 1 scoped adapter tests, Task 9 runtime tests; P3 native isolation if available |
| Confirmation, idempotency, uncertain write, durable completion | Tasks 8, 11 retain existing authority/operation/recovery suites |
| Confirmed cache cannot grant loaded knowledge or bypass privacy | Tasks 4, 9–10; P3 cache regressions |
| Stable two-tool array/catalog/prefix; no disabled/voice advertisement | Tasks 3, 5–6; P3 assembled disabled/voice/prefix assertions |

### P3 handoff (return with implementation commits, not this plan alone)

- Stable runtime entry remains `DurableChatRuntime` plus existing `createCalendarAssembly`; no new integration API or rollout switch. `calendarFixture`, `skillWire`, and the owned native fixture expose the real stable path.
- Persistence aliases: `p.skillDecisions` and `p.skillResults`; underlying collection, keys, owner, and close lifecycle unchanged. Native checkpoint refs are version 3, at most eight current-turn decisions/calls; operation revision stays v2.
- Request identity/history: `activate_skill`/`call_tool` names and original IDs/raw strings persist; API success bodies still identify their canonical Calendar operation. Local results are source-free; schema knowledge derives only from full original disclosures in assembled messages.
- Expected deterministic counts: no-plugin enabled text = one model request/no Calendar action; cold read = activation + execution + answer (three); warm read = execution + answer (two); batch selection = one activation result, then ordinary necessary sequential calls. Creates retain receipt-first sealing and proposal confirmation with no additional model request on Yes. Error repairs and new dependencies are separately counted.
- Ask P3 to test disabled Calendar and live voice, larger synthetic catalogs, prefix bytes across activation, multi-tool/later-tool tasks, cross-user/session isolation, existing confirmed-cache measurements, cancellation, and interrupted-write receipt/readback. P3 must not edit P2 production paths: send defects back with the failing command.
- Report live usage/cache tokens as unavailable without separate authorization; fixture sizes/timings do not establish provider cache hits or cost wins. Research baseline already records failures; pass them to the orchestrator with new failures distinguished.

### Orchestrator handoff

- Output plan path and its documentation commit; implementation has not started merely because this plan exists.
- Worker starts only after P1 implementation/focused checks are committed. Reconcile actual P1 exports first, then close the fail-closed legacy-request integration gate.
- Return exact implementation commit list, changed owned files, focused/build/lint/full-suite commands and outcomes, native skips, and any ownership/contract blockers. Preserve the three-child capacity and serialized index/commit slot.
- Review remains **skipped**. Do not mark final workflow complete; P3 evidence and orchestrator package verification/final report remain required.
