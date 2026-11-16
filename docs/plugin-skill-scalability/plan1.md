# Compact Catalog and Stable Model Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a compact Calendar catalog, two invariant native tools, bounded discovery/dispatch/result contracts, and streaming/history support without moving Calendar argument validation out of its executor.

**Architecture:** Keep `CALENDAR_TOOLS` and `calendarCallSchema` as the real operation/schema authority; derive catalog entries and disclosures from them. Adapt the existing Calendar model transport to one stable protocol, preserving raw accepted native calls and accepting legacy evidence for reading only. P2 supplies local activation, durable history reconstruction, loaded-revision checks, correction accounting, and executor integration using these contracts.

**Tech Stack:** Existing Node.js 24, ESM TypeScript/NodeNext (`.js` local imports), Zod 3, Vitest 4, native OpenRouter SSE transport; no new dependencies.

---

## Boundaries and implementation conventions

- Scope: P1 only. Inputs are [goal.md](goal.md), research commit `86dd3974d5e000ab05f4d2285879a723fcd3f69f`, and [state.md](state.md). Do not edit runtime, context, persistence, plugin executor, voice, composition, instructions, frontend, or workflow state.
- Code review is **skipped**. There is no reviewer, review task, or review-triggered fixer. Tests and correction of owned defects remain required.
- This document intentionally omits decorative code-file/documentation headers from snippets. The implementing worker must add the repository-required language-valid file header to every new code file, and existing files changed by more than 30%, before writing code. Do not add those headers to this plan.
- All `npm` commands below run from `backend`; all `git` commands run from the repository root. Use PowerShell-compatible commands, one invocation per line. Stage only named files. Obtain the orchestrator's serialized commit slot before each commit.
- Step granularity: write one shown test block, run its focused command and observe red, make its shown implementation change, rerun green, commit. Within larger tasks, repeat this cycle for the separately labelled blocks rather than making one unchecked bulk edit.
- Existing domain argument tests already live at the executor boundary. Do not import `validateCalendarCall` into the model adapter or add a second argument validator. Retain JSON lexical safety scanning, forbidden-key screening, finite bytes/depth, one-call cardinality, terminal framing, and server identity checks.
- Keep `google-calendar.v2` for actual operation schemas, accounting, proof, connection, and execution bindings. Introduce `plugin-skills.v1` only as the model/history protocol marker. These revisions are not interchangeable.
- Do not modify `backend/src/model/policy.ts`, `openrouter-adapter.ts`, or `catalogue.ts`: tracing found no need. In particular, never put tools into common `providerParameters()` or disabled/internal voice requests.

### File structure and responsibilities

| File | Change |
| --- | --- |
| `backend/src/contracts/calendar-policy.ts` | Stable protocol marker and selection ceiling; existing operational budgets unchanged. |
| `backend/src/contracts/calendar-tools.ts` | Compact projection, frozen native definitions, wrapper schemas, pure local selection, disclosure/ack/error schemas. |
| `backend/src/contracts/calendar-model.ts` | Stable decisions/port/request, raw identity, widened readable native names/groups, bounded diagnostic extensions, new resumable record. |
| `backend/src/contracts/calendar-sources.ts` | Source-free local tool-result record using the existing result identity/ordering fields. |
| `backend/src/contracts/calendar-compatibility.ts` | Additive old/new decoders and bounded current-turn protocol checkpoint refs. |
| `backend/src/contracts/calendar-accounting.ts` | No production change expected; preserve existing v2 dispatch reasons, attribution, prices, and counters. |
| `backend/src/model/calendar-validation.ts` | Replace plugin-argument validation with stable wrapper validation; reuse existing scanner/diagnostic machinery. |
| `backend/src/model/calendar-stream.ts` | Same SSE assembly with stable candidate result and retained assistant content. |
| `backend/src/model/calendar-repair.ts` | Structural historical validation, complete stable/legacy pairs, ordered native prefix, bounded wrapper repair guidance. |
| `backend/src/model/calendar-policy.ts` | Serialize/estimate exactly the two stable tools; retain all charged-dispatch admission. |
| `backend/src/model/calendar-adapter.ts` | Emit stable decisions after the existing observation barrier; preserve all transport/accounting semantics. |
| `backend/test/contracts/skill-protocol.spec.ts` | Catalog, selection, envelope, disclosure/ack/error, records and compatibility tests. |
| `backend/test/model/calendar-validation.spec.ts` | Wrapper and JSON-safety regressions replacing the adapter's duplicate domain-validation assertions. |
| `backend/test/model/calendar-stream.spec.ts` | Stable fragmented calls and raw/content preservation; retain framing regressions. |
| `backend/test/model/calendar-repair.spec.ts` | Stable/legacy ordered history and correction instruction checks. |
| `backend/test/model/calendar-policy.spec.ts` | Exact two-tool request invariants and unchanged admission checks. |
| `backend/test/model/calendar-fixtures.ts` | Stable fixture request/wire helpers; preserve old exports used by unowned fixtures. |
| `backend/test/model/prompt-caching.spec.ts` | Adapt Calendar request/tools fixture while preserving existing cache-policy checks. |
| `backend/test/model/calendar-adapter.spec.ts` | Stable decisions with transport and accounting checks retained. |
| `backend/test/model/calendar-repair-flow.spec.ts` | Existing bounded structural repair fixture adapted to wrappers. |

### Compile-safe ownership handoff

Do not expand the existing `CalendarDecision` union in place: unowned runtime callers access `decision.call.name`, and unowned persistence callers assume source-bearing records. Preserve the old decision/record types and decoders as readable compatibility types, and export the stable types separately below. This avoids forcing P1 to edit P2-owned callers.

There must be only one live serializer/validator/adapter implementation. `buildCalendarBody()` accepts the old request type for source compatibility but rejects its five-operation `tools` array before dispatch. The adapter exposes two TypeScript overloads, with only stable requests able to reach fetch; the old overload can produce a failure but cannot emit a legacy tool decision. This is a fail-closed transition, not a second legacy router or a rollout switch. P1 is **not deployable alone**: until P2 switches its owned callers to the stable request/decision types, old Calendar requests fail admission. Ordinary text remains unchanged. Report this integration gate explicitly rather than claiming assembled chat readiness at P1 completion.

## Task 1: Derive the compact catalog and freeze the two native definitions

**Files:**
- Modify: `backend/src/contracts/calendar-policy.ts`
- Modify: `backend/src/contracts/calendar-tools.ts`
- Create: `backend/test/contracts/skill-protocol.spec.ts`

- [ ] **Step 1: Add the following failing catalog/definition tests.**

```typescript
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_TOOLS, SKILL_NATIVE_TOOLS, compactSkillCatalog,
} from '../../src/contracts/calendar-tools.js';

describe('compact skill catalog and stable native definitions', () => {
  it('projects deterministic canonical metadata without parameter schemas', () => {
    const catalog = compactSkillCatalog();
    expect(catalog).toMatchObject({ plugin: 'google-calendar', label: 'Calendar',
      description: 'Scheduling and availability' });
    expect(catalog.tools.map(t => t.name)).toEqual(CALENDAR_TOOLS.map(t => t.name).sort());
    expect(catalog.tools.every(t => Object.keys(t).sort().join(',') === 'description,name')).toBe(true);
    expect(JSON.stringify(catalog)).not.toMatch(/inputSchema|properties|required|additionalProperties/);
    expect(compactSkillCatalog([...CALENDAR_TOOLS].reverse())).toEqual(catalog);
    expect(catalog.tools.every(t => t.description.length > 0 && t.description.length <= 240)).toBe(true);
  });

  it('exports exactly two deeply frozen definitions independent of activation', () => {
    expect(SKILL_NATIVE_TOOLS.map(t => t.name)).toEqual(['activate_skill', 'call_tool']);
    const assertFrozen = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).forEach(assertFrozen);
    };
    assertFrozen(SKILL_NATIVE_TOOLS);
    expect(JSON.stringify(SKILL_NATIVE_TOOLS)).not.toContain('calendar_get_event');
    expect(SKILL_NATIVE_TOOLS[1].inputSchema).toMatchObject({ type: 'object',
      additionalProperties: false, required: ['plugin', 'tool', 'arguments'],
      properties: { arguments: { type: 'object', additionalProperties: true } } });
    expect(JSON.stringify(SKILL_NATIVE_TOOLS)).not.toContain('"strict":true');
  });
});
```

- [ ] **Step 2: Observe the missing-export failure.**

Run: `npm test -- test/contracts/skill-protocol.spec.ts`

Expected: FAIL because `compactSkillCatalog` / `SKILL_NATIVE_TOOLS` do not exist; no network or database prerequisites.

- [ ] **Step 3: Add these constants to `calendar-policy.ts`.**

```typescript
export const SKILL_PROTOCOL_VERSION = 'plugin-skills.v1' as const;
export const SKILL_SELECTION_LIMIT = 64;
```

The 64-name ceiling bounds a batch independently of Calendar's current five operations. It does not raise the six-logical-operation, eight-model-dispatch, two-repair, 16,384-byte, or context ceilings. Do not add another runtime configuration surface.

- [ ] **Step 4: Append the following production definitions to `calendar-tools.ts`; import the three named policy constants alongside its existing revision imports.**

```typescript
export type SkillRegistryTool = {
  name: string; description: string; revision: string;
  inputSchema: Record<string, unknown>;
};

export function compactSkillCatalog(tools: readonly SkillRegistryTool[] = CALENDAR_TOOLS) {
  return { plugin: CALENDAR_PLUGIN_ID, label: 'Calendar', description: 'Scheduling and availability',
    tools: [...tools].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      .map(t => ({ name: t.name, description: t.description.split('. ')[0].slice(0, 240) })) };
}

function freezeNative<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeNative);
    Object.freeze(value);
  }
  return value;
}

export const SKILL_NATIVE_TOOLS = freezeNative([
  { name: 'activate_skill',
    description: 'Load one, several, or all argument schemas from a listed plugin. Batch tools you already need; reuse loaded schemas.',
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['plugin', 'tools'], properties: {
        plugin: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' },
        tools: { anyOf: [{ type: 'string', enum: ['all'] },
          { type: 'array', minItems: 1, maxItems: SKILL_SELECTION_LIMIT, uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' } }] },
      } } },
  { name: 'call_tool',
    description: 'Execute a canonical tool using its loaded argument schema. Loading is not permission; existing action safety still applies.',
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['plugin', 'tool', 'arguments'], properties: {
        plugin: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' },
        tool: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' },
        arguments: { type: 'object', additionalProperties: true },
      } } },
] as const);
export type SkillNativeDefinition = (typeof SKILL_NATIVE_TOOLS)[number];
export const skillNativeNameSchema = z.enum(['activate_skill', 'call_tool']);
```

This tiny private freezer is needed because `Object.freeze(array)` alone leaves nested parameter definitions mutable. Do not freeze/rewrite the real registry or create a general freezing utility. Synthetic fixtures can call the projection with metadata without registering another plugin.

- [ ] **Step 5: Verify and commit.**

Run: `npm test -- test/contracts/skill-protocol.spec.ts test/contracts/calendar-tools.spec.ts test/contracts/calendar-multi-tools.spec.ts`

Expected: PASS; existing canonical operation definitions and revisions unchanged.

```powershell
git add backend/src/contracts/calendar-policy.ts backend/src/contracts/calendar-tools.ts backend/test/contracts/skill-protocol.spec.ts
git commit -m "feat(skills): derive compact catalog and freeze native tools"
```

## Task 2: Define strict envelopes, atomic selection, disclosures, acknowledgements, and safe errors

**Files:**
- Modify: `backend/src/contracts/calendar-tools.ts`
- Modify: `backend/test/contracts/skill-protocol.spec.ts`

- [ ] **Step 1: Add these imports and failing tests to the contract test.**

```typescript
import { activateSkillEnvelopeSchema, callToolEnvelopeSchema, selectSkillTools,
  skillLocalResultSchema, serializeSkillLocalResult, skillError }
  from '../../src/contracts/calendar-tools.js';

describe('bounded skill envelopes and local results', () => {
  it('accepts one/many/all but rejects empty, duplicate, oversized, or extra selections', () => {
    for (const tools of [['calendar_get_event'], ['calendar_get_event', 'calendar_list_events'], 'all']) {
      expect(activateSkillEnvelopeSchema.safeParse({ plugin: 'google-calendar', tools }).success).toBe(true);
    }
    for (const tools of [[], ['calendar_get_event', 'calendar_get_event'],
      Array.from({ length: 65 }, (_, i) => `tool_${i}`), '*', null]) {
      expect(activateSkillEnvelopeSchema.safeParse({ plugin: 'google-calendar', tools }).success).toBe(false);
    }
    expect(activateSkillEnvelopeSchema.safeParse({ plugin: 'google-calendar', tools: 'all', userId: 'u' }).success).toBe(false);
    // A safe wrapper is not proof of a valid Calendar argument or a known plugin/tool.
    expect(callToolEnvelopeSchema.parse({ plugin: 'unknown-plugin', tool: 'unknown_tool',
      arguments: { eventId: 7 } }).arguments).toEqual({ eventId: 7 });
    for (const arguments_ of [null, [], 'text']) {
      expect(callToolEnvelopeSchema.safeParse({ plugin: 'google-calendar', tool: 'calendar_get_event',
        arguments: arguments_ }).success).toBe(false);
    }
    expect(callToolEnvelopeSchema.safeParse({ plugin: 'google-calendar', tool: 'calendar_get_event',
      arguments: { description: 'é'.repeat(8192) } }).success).toBe(false);
  });

  it('resolves only enabled metadata atomically and uses the authoritative schema objects', () => {
    const result = selectSkillTools({ plugin: 'google-calendar', tools: ['calendar_get_event'] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected selection');
    expect(result.tools[0]).toBe(CALENDAR_TOOLS.find(t => t.name === 'calendar_get_event'));
    expect(selectSkillTools({ plugin: 'google-calendar', tools: 'all' })).toMatchObject({ ok: true,
      tools: expect.arrayContaining(CALENDAR_TOOLS) });
    expect(selectSkillTools({ plugin: 'google-calendar', tools: ['calendar_list_events', 'calendar_get_event'] }))
      .toEqual(selectSkillTools({ plugin: 'google-calendar', tools: ['calendar_get_event', 'calendar_list_events'] }));
    expect(selectSkillTools({ plugin: 'other', tools: 'all' })).toEqual({ ok: false, code: 'UNKNOWN_PLUGIN' });
    expect(selectSkillTools({ plugin: 'google-calendar', tools: ['calendar_get_event', 'calendar_nope'] }))
      .toEqual({ ok: false, code: 'UNKNOWN_TOOL' });
    expect(selectSkillTools({ plugin: 'google-calendar', tools: [] })).toEqual({ ok: false, code: 'INVALID_SELECTION' });
    expect(selectSkillTools({ plugin: 'google-calendar', tools: 'all' }, []))
      .toEqual({ ok: false, code: 'UNKNOWN_PLUGIN' });
  });

  it('bounds complete disclosure batches and permits compact references without replacing originals', () => {
    const tool = CALENDAR_TOOLS.find(t => t.name === 'calendar_get_event')!;
    const result = { kind: 'skill-disclosure', protocolVersion: 'plugin-skills.v1', plugin: 'google-calendar',
      disclosures: [{ tool: tool.name, revision: tool.revision,
        inputSchema: tool.inputSchema, instructions: tool.description }], alreadyLoaded: [] };
    expect(skillLocalResultSchema.parse(result)).toEqual(result);
    const ack = { ...result, disclosures: [], alreadyLoaded: [{ tool: tool.name,
      revision: tool.revision, disclosureCallId: 'original_call' }] };
    expect(serializeSkillLocalResult(ack)).not.toContain('inputSchema');
    expect(skillLocalResultSchema.safeParse({ ...ack, alreadyLoaded: [] }).success).toBe(false);
    expect(skillLocalResultSchema.safeParse({ ...result, alreadyLoaded: ack.alreadyLoaded }).success).toBe(false);
    expect(() => serializeSkillLocalResult(result, 10)).toThrow(RangeError);
    const oversized = { ...result, disclosures: Array.from({ length: 64 }, (_, i) => ({
      ...result.disclosures[0], tool: `tool_${i}`, instructions: 'é'.repeat(1000) })) };
    expect(skillLocalResultSchema.safeParse(oversized).success).toBe(false);
    expect(JSON.stringify(result)).toContain('inputSchema'); // no silently truncated success
  });

  it('distinguishes missing/stale/argument failures from non-repairable metadata errors', () => {
    for (const code of ['SCHEMA_NOT_LOADED', 'SCHEMA_STALE'] as const) {
      const result = skillError(code, 'google-calendar', 'calendar_get_event');
      expect(result.retry).toBe('activate-skill');
      expect(result.instruction).toContain('activate_skill');
      expect(result.instruction).toContain('call_tool');
      expect(serializeSkillLocalResult(result).length).toBeLessThan(2048);
    }
    const argumentError = skillError('ARGUMENTS_INVALID', 'google-calendar', 'calendar_get_event',
      [{ path: 'eventId', code: 'wrong-type', expected: 'string' }]);
    expect(argumentError.retry).toBe('correct-arguments');
    for (const code of ['UNKNOWN_PLUGIN', 'UNKNOWN_TOOL', 'INVALID_SELECTION', 'DISCLOSURE_BUDGET_EXCEEDED'] as const) {
      expect(skillError(code, 'google-calendar', null).retry).toBe('none');
    }
    expect(skillLocalResultSchema.safeParse({ ...argumentError, instruction: 'arbitrary instructions' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run red.**

Run: `npm test -- test/contracts/skill-protocol.spec.ts -t "bounded skill"`

Expected: FAIL for absent envelope/selection/result exports.

- [ ] **Step 3: Add wrapper schemas and pure metadata selection to `calendar-tools.ts`.**

```typescript
export const skillIdentifierSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/);
export const activateSkillEnvelopeSchema = z.object({ plugin: skillIdentifierSchema,
  tools: z.union([z.literal('all'), z.array(skillIdentifierSchema).min(1).max(SKILL_SELECTION_LIMIT)
    .refine(v => new Set(v).size === v.length)]) }).strict().refine(v => jsonBytes(v) <= 16384);
export const callToolEnvelopeSchema = z.object({ plugin: skillIdentifierSchema,
  tool: skillIdentifierSchema, arguments: z.record(z.unknown()) }).strict().refine(v => jsonBytes(v) <= 16384);
export type ActivateSkillEnvelope = z.infer<typeof activateSkillEnvelopeSchema>;
export type CallToolEnvelope = z.infer<typeof callToolEnvelopeSchema>;

export function selectSkillTools(value: unknown, available: readonly SkillRegistryTool[] = CALENDAR_TOOLS):
  { ok: true; tools: SkillRegistryTool[] }
  | { ok: false; code: 'INVALID_SELECTION' | 'UNKNOWN_PLUGIN' | 'UNKNOWN_TOOL' } {
  const parsed = activateSkillEnvelopeSchema.safeParse(value);
  if (!parsed.success) return { ok: false, code: 'INVALID_SELECTION' };
  if (parsed.data.plugin !== CALENDAR_PLUGIN_ID || available.length === 0)
    return { ok: false, code: 'UNKNOWN_PLUGIN' };
  const selection = parsed.data.tools;
  if (selection !== 'all' && selection.some(name => !available.some(t => t.name === name)))
    return { ok: false, code: 'UNKNOWN_TOOL' };
  return { ok: true, tools: available.filter(t => selection === 'all' || selection.includes(t.name))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) };
}
```

`available` is the already enabled server metadata supplied by P2, not a client catalog. This helper has no provider, OAuth, account, connection, persistence, or execution dependency. Unknown identifiers pass syntactic wrapper validation so P2 can return matched, distinct local errors; they are not executable authority.

- [ ] **Step 4: Implement the local result schemas without introducing an import cycle.**

`calendar-model.ts` already imports `calendar-tools.ts`; therefore **do not** import model diagnostics into tools. Move the existing `repairDiagnosticsSchema` declaration unchanged from `calendar-model.ts` to `calendar-tools.ts`, extend its `path` enum with `plugin`, `tool`, `tools`, `arguments`, and its `code` enum with `schema-not-loaded`, `schema-stale`. Re-export it from `calendar-model.ts` and keep `CalendarRepairDiagnostics` defined there for all existing consumers. Retain its minimum 1, maximum 10, 2,048-character bound, strict entries, and all existing domain paths. This is relocation of the same authority, not copied schemas.

Add the following to `calendar-tools.ts` and add `idSchema` from `./identifiers.js` to imports:

```typescript
const skillRevisionSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/);
const disclosedSkillSchema = z.object({ tool: skillIdentifierSchema, revision: skillRevisionSchema,
  inputSchema: z.record(z.unknown()), instructions: z.string().min(1).max(1000) }).strict();
const loadedSkillReferenceSchema = z.object({ tool: skillIdentifierSchema,
  revision: skillRevisionSchema, disclosureCallId: idSchema }).strict();
export const skillDisclosureSchema = z.object({ kind: z.literal('skill-disclosure'),
  protocolVersion: z.literal(SKILL_PROTOCOL_VERSION), plugin: skillIdentifierSchema,
  disclosures: z.array(disclosedSkillSchema).max(SKILL_SELECTION_LIMIT),
  alreadyLoaded: z.array(loadedSkillReferenceSchema).max(SKILL_SELECTION_LIMIT),
}).strict().refine(v => {
  const names = [...v.disclosures, ...v.alreadyLoaded].map(t => t.tool);
  return names.length > 0 && names.length <= SKILL_SELECTION_LIMIT && new Set(names).size === names.length;
});

const skillErrorRules = {
  SCHEMA_NOT_LOADED: { retry: 'activate-skill', instruction: 'Call activate_skill for this plugin and tool, then retry call_tool using the revealed schema.' },
  SCHEMA_STALE: { retry: 'activate-skill', instruction: 'Call activate_skill for this plugin and tool to load its current revision, then retry call_tool using that schema.' },
  ARGUMENTS_INVALID: { retry: 'correct-arguments', instruction: 'Correct call_tool arguments using the retained schema and validation diagnostics; do not repeat an attempted write.' },
  UNKNOWN_PLUGIN: { retry: 'none', instruction: 'Use a plugin from the enabled compact catalog.' },
  UNKNOWN_TOOL: { retry: 'none', instruction: 'Use a canonical tool name from this plugin catalog.' },
  INVALID_SELECTION: { retry: 'none', instruction: 'Select all or a nonempty bounded list of distinct canonical tool names.' },
  DISCLOSURE_BUDGET_EXCEEDED: { retry: 'none', instruction: 'Request a smaller explicit tool selection. If retained context is full, start a new chat.' },
} as const;
const skillErrorCodeSchema = z.enum(['SCHEMA_NOT_LOADED', 'SCHEMA_STALE', 'ARGUMENTS_INVALID',
  'UNKNOWN_PLUGIN', 'UNKNOWN_TOOL', 'INVALID_SELECTION', 'DISCLOSURE_BUDGET_EXCEEDED']);
export type SkillErrorCode = z.infer<typeof skillErrorCodeSchema>;
export const skillErrorSchema = z.object({ kind: z.literal('skill-error'),
  protocolVersion: z.literal(SKILL_PROTOCOL_VERSION), plugin: skillIdentifierSchema,
  tool: skillIdentifierSchema.nullable(), code: skillErrorCodeSchema,
  retry: z.enum(['activate-skill', 'correct-arguments', 'none']),
  instruction: z.string().min(1).max(512), diagnostics: repairDiagnosticsSchema.nullable(),
}).strict().refine(v => v.retry === skillErrorRules[v.code].retry
  && v.instruction === skillErrorRules[v.code].instruction
  && (v.code === 'ARGUMENTS_INVALID' ? v.diagnostics !== null : v.diagnostics === null)
  && (!['SCHEMA_NOT_LOADED', 'SCHEMA_STALE', 'ARGUMENTS_INVALID'].includes(v.code) || v.tool !== null));
export const skillLocalResultSchema = z.union([skillDisclosureSchema, skillErrorSchema])
  .refine(v => jsonBytes(v) <= 16384);
export type SkillLocalResult = z.infer<typeof skillLocalResultSchema>;
export function skillError(code: SkillErrorCode, plugin: string, tool: string | null,
  diagnostics: z.infer<typeof repairDiagnosticsSchema> | null = null) {
  return skillErrorSchema.parse({ kind: 'skill-error', protocolVersion: SKILL_PROTOCOL_VERSION,
    plugin, tool, code, ...skillErrorRules[code], diagnostics });
}
export function serializeSkillLocalResult(value: unknown, resultBytes = 16384): string {
  const result = skillLocalResultSchema.parse(value);
  const content = JSON.stringify(result);
  if (!Number.isSafeInteger(resultBytes) || resultBytes < 1 || resultBytes > 16384
    || Buffer.byteLength(content, 'utf8') > resultBytes) throw new RangeError('Skill result byte limit.');
  return content;
}
```

For a globally over-16,384-byte value, `skillLocalResultSchema.parse()` raises a Zod error; for an otherwise valid result over a reduced effective result budget, the serializer raises `RangeError`. P2 must map either to one bounded error before any disclosure write. The context estimate is a separate existing context gate, not encoded as a guessed token count here. The `alreadyLoaded` reference is merely a pointer; P2 must find the prior matching disclosure in assembled context before using it as loaded evidence. Never manufacture one from an acknowledgement alone.

- [ ] **Step 5: Run the green suite and commit.**

Run: `npm test -- test/contracts/skill-protocol.spec.ts test/contracts/calendar-model.spec.ts`

Expected: PASS, including the old diagnostics imports after re-export.

```powershell
git add backend/src/contracts/calendar-tools.ts backend/src/contracts/calendar-model.ts backend/test/contracts/skill-protocol.spec.ts
git commit -m "feat(skills): define bounded discovery dispatch and result envelopes"
```

## Task 3: Preserve native identity in decisions and define source-free durable history

**Files:**
- Modify: `backend/src/contracts/calendar-model.ts`
- Modify: `backend/src/contracts/calendar-sources.ts`
- Modify: `backend/src/contracts/calendar-compatibility.ts`
- Modify: `backend/test/contracts/skill-protocol.spec.ts`

- [ ] **Step 1: Add the following failing decision and record tests.**

```typescript
import { skillDecisionSchema, resumableSkillDecisionSchema, completeToolGroupV2Schema }
  from '../../src/contracts/calendar-model.js';
import { localSkillResultRecordSchema } from '../../src/contracts/calendar-sources.js';
import { compatibleSkillDecisionRecordSchema, compatibleSkillResultRecordSchema,
  skillCheckpointRefsSchema } from '../../src/contracts/calendar-compatibility.js';

const rawDispatch = '{ "tool":"calendar_get_event", "plugin":"google-calendar", "arguments": {"eventId":7} }';
const nativeDispatch = { id: 'call_raw', type: 'function' as const,
  function: { name: 'call_tool' as const, arguments: rawDispatch } };
const stableDecision = { kind: 'call_tool', decisionId: 'd', nativeCall: nativeDispatch,
  assistantContent: 'I will look that up.', envelope: JSON.parse(rawDispatch), terminal: 'tool_calls' };
const localContent = JSON.stringify(skillError('SCHEMA_NOT_LOADED', 'google-calendar', 'calendar_get_event'));
const localRecord = { schemaVersion: 3, kind: 'calendar-tool-result', protocolVersion: 'plugin-skills.v1',
  userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', eventId: 'e',
  sequence: 1, toolCallId: 'call_raw', createdAt: '2026-11-04T10:00:00.000Z',
  resultRef: { storage: 'local', toolCallId: 'call_raw', content: localContent } };

describe('stable decision and durable local history contracts', () => {
  it('keeps raw identity and accepts safely parsed but invalid domain arguments', () => {
    const decision = skillDecisionSchema.parse(stableDecision);
    expect(decision).toEqual(stableDecision);
    expect(decision.kind).toBe('call_tool');
    expect(skillDecisionSchema.safeParse({ ...stableDecision,
      nativeCall: { ...nativeDispatch, function: { ...nativeDispatch.function, name: 'activate_skill' } } }).success).toBe(false);
    expect(skillDecisionSchema.safeParse({ ...stableDecision,
      envelope: { ...stableDecision.envelope, tool: 'calendar_create_event' } }).success).toBe(false);
    expect(skillDecisionSchema.safeParse({ ...stableDecision, call: { name: 'calendar_get_event' } }).success).toBe(false);
  });

  it('records local outcomes without fake Google sources and keeps exact result text', () => {
    expect(localSkillResultRecordSchema.parse(localRecord)).toEqual(localRecord);
    expect(compatibleSkillResultRecordSchema.parse(localRecord)).toEqual(localRecord);
    expect(localSkillResultRecordSchema.safeParse({ ...localRecord, source: {} }).success).toBe(false);
    expect(localSkillResultRecordSchema.safeParse({ ...localRecord,
      resultRef: { ...localRecord.resultRef, toolCallId: 'different' } }).success).toBe(false);
    expect(localSkillResultRecordSchema.safeParse({ ...localRecord,
      resultRef: { ...localRecord.resultRef, content: '{' } }).success).toBe(false);
    expect(completeToolGroupV2Schema.parse({ assistant: { role: 'assistant',
      content: stableDecision.assistantContent, tool_calls: [nativeDispatch] },
      result: { role: 'tool', name: 'call_tool', tool_call_id: 'call_raw', content: localContent }, sources: [] }))
      .toMatchObject({ sources: [], assistant: { content: 'I will look that up.' } });
  });

  it('reads old decisions without changing their operation revision', () => {
    const base = { kind: 'calendar-model-decision', userId: 'u', sessionId: 's', turnId: 't',
      attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch', configRevision: 1,
      connectionId: 'c', connectionRevision: 1, rejectedDecisionId: null, sources: [],
      operationId: null, createdAt: '2026-11-04T10:00:00.000Z' };
    const v1 = { ...base, schemaVersion: 1, schemaRevision: 'google-calendar.v1', decision: {
      kind: 'tool', decisionId: 'd', toolCallId: 'old_call',
      call: { name: 'calendar_get_event', arguments: { eventId: 'abcde' } }, terminal: 'tool_calls' } };
    const v2 = { ...base, schemaVersion: 2, schemaRevision: 'google-calendar.v2',
      decision: v1.decision, intentId: null, proposalId: null };
    const v3 = { ...v2, schemaVersion: 3, protocolVersion: 'plugin-skills.v1', decision: stableDecision };
    for (const record of [v1, v2, v3]) expect(compatibleSkillDecisionRecordSchema.parse(record)).toEqual(record);
    expect(resumableSkillDecisionSchema.parse(v3).schemaRevision).toBe('google-calendar.v2');
    const refs = { version: 3, protocolVersion: 'plugin-skills.v1', userId: 'u', sessionId: 's',
      turnId: 't', decisionIds: Array.from({ length: 8 }, (_, i) => `d_${i}`),
      toolCallIds: Array.from({ length: 8 }, (_, i) => `call_${i}`), operationId: null,
      intentId: null, proposalId: null, connectionId: 'c', connectionRevision: 1,
      schemaRevision: 'google-calendar.v2' };
    expect(skillCheckpointRefsSchema.parse(refs)).toEqual(refs);
    expect(skillCheckpointRefsSchema.safeParse({ ...refs, toolCallIds: [...refs.toolCallIds, 'ninth'] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run red.**

Run: `npm test -- test/contracts/skill-protocol.spec.ts -t "stable decision"`

Expected: FAIL for missing stable decision/local-record exports and current native-name restrictions.

- [ ] **Step 3: Widen only readable native name schemas and add separate stable decisions.**

In `calendar-model.ts`, import `isDeepStrictEqual` from `node:util`; import the new wrapper/name/definition/diagnostic exports from tools and `SKILL_PROTOCOL_VERSION` from policy. Replace the `calendarToolNameSchema` used in `nativeToolCallSchema` and `nativeToolResultSchema` with:

```typescript
const readableNativeNameSchema = z.union([calendarToolNameSchema, skillNativeNameSchema]);
```

The complete-group schemas continue to require exactly one assistant call, matching name/ID, bounded arguments/results and at most six sources. An empty `sources` array is correct for local trusted metadata. No Google provenance is fabricated.

Append these definitions; leave old `calendarDecisionSchema`, old v1/v2 record schemas, and old store interfaces unchanged:

```typescript
const skillNativeCallSchema = nativeToolCallSchema.refine(v => skillNativeNameSchema.safeParse(v.function.name).success);
export const skillDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), decisionId: idSchema,
    content: z.string().max(32000), truncated: z.boolean() }).strict(),
  z.object({ kind: z.literal('activate_skill'), decisionId: idSchema,
    nativeCall: skillNativeCallSchema, assistantContent: z.string().max(32000).nullable(),
    envelope: activateSkillEnvelopeSchema, terminal: z.literal('tool_calls') }).strict(),
  z.object({ kind: z.literal('call_tool'), decisionId: idSchema,
    nativeCall: skillNativeCallSchema, assistantContent: z.string().max(32000).nullable(),
    envelope: callToolEnvelopeSchema, terminal: z.literal('tool_calls') }).strict(),
]).superRefine((value, ctx) => {
  if (value.kind === 'text') return;
  let same = false;
  try { same = value.nativeCall.function.name === value.kind
    && isDeepStrictEqual(JSON.parse(value.nativeCall.function.arguments), value.envelope); }
  catch { same = false; }
  if (!same) ctx.addIssue({ code: 'custom', message: 'Native decision identity mismatch.' });
});
export type SkillDecision = z.infer<typeof skillDecisionSchema>;
export type SkillDecisionRequest = Omit<CalendarDecisionRequest, 'tools'> & {
  tools: readonly SkillNativeDefinition[];
};
export type SkillDecisionChunk = Exclude<CalendarDecisionChunkV2, { type: 'decision' }>
  | { type: 'decision'; decision: SkillDecision };
export interface SkillModelPort {
  stream(request: SkillDecisionRequest): AsyncIterable<SkillDecisionChunk>;
}

export const resumableSkillDecisionSchema = z.object({ schemaVersion: z.literal(3),
  kind: z.literal('calendar-model-decision'), protocolVersion: z.literal(SKILL_PROTOCOL_VERSION),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema, decisionId: idSchema,
  dispatchId: idSchema, configRevision: z.number().int().nonnegative(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v2'),
  rejectedDecisionId: idSchema.nullable(), decision: skillDecisionSchema.nullable(),
  sources: z.array(sourceReferenceV2Schema).max(6), operationId: idSchema.nullable(),
  intentId: idSchema.nullable(), proposalId: idSchema.nullable(), createdAt: isoDateSchema,
}).strict().refine(v => v.sources.every(s => s.permission.minimalEvidenceAllowed
    && s.connectionId === v.connectionId && s.connectionRevision === v.connectionRevision)
  && (v.decision === null || (v.decision.decisionId === v.decisionId
    && v.sources.every(s => s.permission.content === 'retained'
      && Date.parse(s.expiresAt) > Date.parse(v.createdAt)))));
export type ResumableSkillDecision = z.infer<typeof resumableSkillDecisionSchema>;
export interface SkillDecisionStore {
  put(record: ResumableSkillDecision): Promise<void>;
  get(userId: string, decisionId: string):
    Promise<ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision | null>;
  putRejected(record: CalendarRejectedDecisionV2): Promise<void>;
}
```

The decision contract checks identity agreement, not whether plugin arguments are executable. Duplicate-key/forbidden/depth scanning remains at candidate admission and historical replay in Tasks 4/5. Never reconstitute a `call_tool` decision by serializing a canonical `CalendarCall` back into its native call.

- [ ] **Step 4: Append the source-free local record to `calendar-sources.ts`.**

Import `skillLocalResultSchema` from tools and `SKILL_PROTOCOL_VERSION` from policy. Do not import the model module here (it already imports sources).

```typescript
const localSkillContentSchema = z.string().refine(content => {
  if (Buffer.byteLength(content, 'utf8') > 16384) return false;
  try { return skillLocalResultSchema.safeParse(JSON.parse(content)).success; }
  catch { return false; }
});
export const localSkillResultRecordSchema = z.object({ schemaVersion: z.literal(3),
  kind: z.literal('calendar-tool-result'), protocolVersion: z.literal(SKILL_PROTOCOL_VERSION),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema,
  decisionId: idSchema, eventId: idSchema, sequence: z.number().int().nonnegative(),
  toolCallId: idSchema, createdAt: isoDateSchema,
  resultRef: z.object({ storage: z.literal('local'), toolCallId: idSchema,
    content: localSkillContentSchema }).strict(),
}).strict().refine(v => v.toolCallId === v.resultRef.toolCallId);
export type LocalSkillResultRecord = z.infer<typeof localSkillResultRecordSchema>;
export interface SkillResultStore {
  put(record: CalendarToolResultRecordV2 | LocalSkillResultRecord): Promise<void>;
  get(userId: string, sessionId: string, toolCallId: string):
    Promise<CalendarToolResultRecord | CalendarToolResultRecordV2 | LocalSkillResultRecord | null>;
}
```

Existing source-bearing v1/v2 real execution records are unchanged. P2 joins them to the saved stable decision by decision/call identity and emits their canonical server-generated JSON content consistently. For local results retain the exact stored `content`; do not parse/stringify it during replay. Source-bearing expiry/redaction must still be applied before reconstructing history; an explicit paired tombstone/failure is safer than leaking raw expired content. Do not add a second raw external payload copy that bypasses existing redaction.

- [ ] **Step 5: Add the additive compatibility exports and current-turn checkpoint refs.**

Import the new record schemas and policy version into `calendar-compatibility.ts`, then append:

```typescript
export const compatibleSkillDecisionRecordSchema = z.union([
  resumableDecisionSchema, resumableDecisionV2Schema, resumableSkillDecisionSchema,
]);
export const compatibleSkillResultRecordSchema = z.union([
  calendarToolResultRecordSchema, calendarToolResultRecordV2Schema, localSkillResultRecordSchema,
]);
export const skillCheckpointRefsSchema = calendarCheckpointRefsV2Schema.extend({
  version: z.literal(3), protocolVersion: z.literal(SKILL_PROTOCOL_VERSION),
  toolCallIds: z.array(idSchema).max(8),
}).strict().refine(v => new Set(v.decisionIds).size === v.decisionIds.length
  && new Set(v.toolCallIds).size === v.toolCallIds.length
  && v.toolCallIds.length <= v.decisionIds.length);
export const compatibleSkillCheckpointRefsSchema = z.union([
  calendarCheckpointRefsV1Schema, calendarCheckpointRefsV2Schema, skillCheckpointRefsSchema,
]);
```

Do not widen the existing `compatibleCalendar*` exports in place: that would break P2-owned decoders before they handle the new variants. P2 switches its persistence/recovery consumers to these new additive exports and exposes the existing-store facades needed by its loop. Eight call refs match at most one native call per eight dispatches (discovery plus at most six logical operations); this is a **current-turn** boundary, never a lifetime loaded-state store. No cross-turn growth or new collection.

- [ ] **Step 6: Verify compatibility and build, then commit.**

Run: `npm test -- test/contracts/`

Run: `npm run build`

Expected: PASS for all contract tests and source compilation; old runtime types still compile. A passing build is not runtime integration evidence.

```powershell
git add backend/src/contracts/calendar-model.ts backend/src/contracts/calendar-sources.ts backend/src/contracts/calendar-compatibility.ts backend/test/contracts/skill-protocol.spec.ts
git commit -m "feat(skills): preserve native decisions and local history evidence"
```

## Task 4: Validate only the native wrapper and JSON safety at the model boundary

**Files:**
- Modify: `backend/src/model/calendar-validation.ts`
- Modify: `backend/test/model/calendar-validation.spec.ts`

- [ ] **Step 1: Replace duplicate Calendar domain-schema assertions with this focused wrapper suite.**

Keep the existing file header. This replacement deliberately removes tests expecting the model layer to reject `eventId:7`, out-of-range `maxResults`, date-only events, or invalid selectors: those become accepted envelopes and are tested by the authoritative executor/P2 instead. It retains the scanner, cardinality, safe diagnostics, and telemetry obligations with the new wrapper.

```typescript
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateCalendarCandidate, normalizeDiagnostics, type CandidateBatch }
  from '../../src/model/calendar-validation.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { SKILL_NATIVE_TOOLS, forbiddenCalendarKeys } from '../../src/contracts/calendar-tools.js';
import { repairDiagnosticsSchema } from '../../src/contracts/calendar-model.js';

const wrap = (args = '{}') => `{"plugin":"google-calendar","tool":"calendar_get_event","arguments":${args}}`;
function candidate(raw: string, name = 'call_tool'): CandidateBatch {
  return { calls: [{ index: 0, id: 'call_1', type: 'function', name,
    arguments: raw, envelopeInvalid: false }], terminal: 'tool_calls', envelopeInvalid: false };
}
const validate = (batch: CandidateBatch, limits = CALENDAR_LIMITS) =>
  validateCalendarCandidate(batch, SKILL_NATIVE_TOOLS, limits);

describe('stable native wrapper validation', () => {
  it('retains raw identity and delegates domain validity', () => {
    const raw = '{ "arguments": {"eventId":7}, "tool":"calendar_get_event", "plugin":"google-calendar" }';
    expect(validate(candidate(raw))).toEqual({ kind: 'valid',
      nativeCall: { id: 'call_1', type: 'function', function: { name: 'call_tool', arguments: raw } },
      envelope: { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 7 } } });
    expect(validate(candidate('{"plugin":"google-calendar","tools":["calendar_get_event"]}', 'activate_skill')))
      .toMatchObject({ kind: 'valid', envelope: { tools: ['calendar_get_event'] } });
    expect(validate(candidate('{"plugin":"unknown","tool":"unknown_tool","arguments":{}}'))).toMatchObject({ kind: 'valid' });
  });

  it.each([
    ['{}', 'plugin', 'missing'],
    ['{"plugin":7,"tool":"calendar_get_event","arguments":{}}', 'plugin', 'wrong-type'],
    ['{"plugin":"google-calendar","tool":"calendar_get_event"}', 'arguments', 'missing'],
    ['{"plugin":"google-calendar","tool":"calendar_get_event","arguments":[]}', 'arguments', 'wrong-type'],
    ['{"plugin":"google-calendar","tool":"calendar_get_event","arguments":{},"unknown":"SECRET"}', '$', 'unknown-field'],
  ])('returns bounded wrapper diagnostics for %s', (raw, path, code) => {
    const result = validate(candidate(raw));
    expect(result).toMatchObject({ kind: 'rejected', diagnostics: expect.arrayContaining([
      expect.objectContaining({ path, code }) ]) });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('"unknown"');
  });

  it.each(['[]', '["calendar_get_event","calendar_get_event"]', 'null'])('rejects selection %s', tools => {
    expect(validate(candidate(`{"plugin":"google-calendar","tools":${tools}}`, 'activate_skill')))
      .toMatchObject({ kind: 'rejected' });
  });

  it.each([...forbiddenCalendarKeys])('screens forbidden key %s even when escaped or nested', key => {
    const escaped = `\\u${key.charCodeAt(0).toString(16).padStart(4, '0')}${key.slice(1)}`;
    for (const raw of [wrap(`{"${key}":"SECRET"}`), wrap(`{"nested":{"${escaped}":1}}`)]) {
      expect(validate(candidate(raw))).toMatchObject({ kind: 'failure', failure: {
        category: 'policy', code: 'FORBIDDEN_TOOL_FIELD', retry: 'none' } });
    }
    expect(validate(candidate(wrap('{"description":"discuss attendees and accessToken"}')))).toMatchObject({ kind: 'valid' });
  });

  it.each([
    ['{', 'malformed-json'], [wrap('{"eventId":"a","eventId":"b"}'), 'duplicate-key'],
    [wrap('{"x":1e999}'), 'malformed-json'],
    [wrap('{"x":'.repeat(9) + '0' + '}'.repeat(9)), 'depth-limit'],
  ])('retains scanner rejection for %s', (raw, code) => {
    const batch = candidate(raw);
    const result = validate(batch);
    expect(result).toMatchObject({ kind: 'rejected', diagnostics: [expect.objectContaining({ code })] });
    expect(result).toHaveProperty('rawArgumentsSha256', createHash('sha256')
      .update(JSON.stringify(batch.calls.map(c => [c.index, c.arguments]))).digest('hex'));
  });

  it('charges bytes and depth for the entire wrapper, including multibyte content', () => {
    expect(validate(candidate(wrap('{"x":"' + 'é'.repeat(8192) + '"}')))).toMatchObject({
      kind: 'failure', failure: { code: 'ARGUMENT_BUDGET_EXCEEDED', retry: 'none' } });
    expect(validate(candidate(wrap('{"nested":{}}')), { ...CALENDAR_LIMITS, jsonDepth: 2 }))
      .toMatchObject({ kind: 'rejected', diagnostics: [expect.objectContaining({ code: 'depth-limit' })] });
    // The current Calendar flat/string-array inputs fit without increasing jsonDepth.
    expect(validate(candidate(wrap('{"calendarIds":["cal"]}')))).toMatchObject({ kind: 'valid' });
  });

  it('requires one complete native call with a valid ID and terminal', () => {
    const batch = candidate(wrap());
    for (const changed of [
      { ...batch, calls: [] },
      { ...batch, calls: [{ ...batch.calls[0]!, index: 1 }] },
      { ...batch, calls: [batch.calls[0]!, { ...batch.calls[0]!, index: 1, id: 'other' }] },
      { ...batch, calls: [{ ...batch.calls[0]!, id: null }] },
      { ...batch, calls: [{ ...batch.calls[0]!, type: null }] },
      { ...batch, calls: [{ ...batch.calls[0]!, name: '' }] },
      { ...batch, envelopeInvalid: true }, { ...batch, terminal: 'stop' }, { ...batch, terminal: 'length' },
    ]) expect(validate(changed)).toMatchObject({ kind: 'rejected' });
    expect(validate(candidate('{}', 'calendar_get_event'))).toMatchObject({ kind: 'failure',
      failure: { code: 'UNKNOWN_OR_DISABLED_TOOL' } });
    expect(validate({ ...candidate('{', 'activate_'), terminal: 'length' })).toMatchObject({ kind: 'rejected' });
  });

  it('retains denial priority, safe bounded observations, and diagnostic limits', () => {
    const base = candidate(wrap());
    expect(validate({ ...base, calls: [...base.calls, { ...base.calls[0]!, index: 1,
      arguments: wrap('{"accessToken":"SECRET"}') }] })).toMatchObject({ kind: 'failure', failure: { code: 'FORBIDDEN_TOOL_FIELD' } });
    const facts: Readonly<Record<string, unknown>>[] = [];
    const result = validateCalendarCandidate(candidate('{"plugin":7,"tool":8,"arguments":null}'),
      SKILL_NATIVE_TOOLS, { ...CALENDAR_LIMITS, diagnosticCount: 2 }, v => { facts.push(v); });
    expect(result).toMatchObject({ kind: 'rejected' });
    expect(facts.length).toBeLessThanOrEqual(2);
    expect(facts).toContainEqual(expect.objectContaining({ stage: 'validation', delivery: 'not-sent' }));
    expect(JSON.stringify(facts)).not.toMatch(/SECRET|rawArgumentsSha256/);
    const normalized = normalizeDiagnostics([
      { path: 'plugin', code: 'missing', expected: 'string' },
      { path: 'plugin', code: 'missing', expected: 'string' },
      { path: 'secret' as 'plugin', code: 'missing', expected: 'string' },
    ], CALENDAR_LIMITS);
    expect(normalized).toEqual([{ path: 'plugin', code: 'missing', expected: 'string' },
      { path: '$', code: 'missing', expected: 'string' }]);
    expect(repairDiagnosticsSchema.parse(normalized)).toEqual(normalized);
    expect(validate(candidate('{}'), { ...CALENDAR_LIMITS, diagnosticChars: 8 }))
      .toMatchObject({ kind: 'failure', failure: { code: 'DIAGNOSTIC_BUDGET_EXCEEDED' } });
  });
});
```

- [ ] **Step 2: Run red.**

Run: `npm test -- test/model/calendar-validation.spec.ts`

Expected: FAIL because the old validator rejects `call_tool` and produces `CalendarCall` rather than raw native identity plus envelope.

- [ ] **Step 3: Change the valid candidate type, allowlist type, diagnostic paths, and Zod mapping.**

Keep `CandidateCall`, `CandidateBatch`, hash generation, scanner rejection ordering, diagnostic caps, `incompleteName`, and the existing envelope/cardinality/terminal checks. Replace the `CalendarCall`/`calendarInputSchemas` imports with `activateSkillEnvelopeSchema`, `callToolEnvelopeSchema`, and `SkillNativeDefinition`. Add `nativeToolCallSchema` to model imports. Replace the valid variant with:

```typescript
| { kind: 'valid'; nativeCall: z.infer<typeof nativeToolCallSchema>;
    envelope: ActivateSkillEnvelope | CallToolEnvelope }
```

Import `type z` from Zod with the existing `ZodIssue` type and the two envelope types from tools. The argument `allowed` becomes `readonly SkillNativeDefinition[]`. Add the four wrapper paths to `paths`; retain domain paths for executor-originated diagnostics. Replace `expectedType` with:

```typescript
function expectedType(_name: string, field: string): CalendarRepairDiagnostics[number]['expected'] {
  if (field === 'arguments') return 'object';
  if (field === 'tools') return 'bounded-value';
  if (field === 'plugin' || field === 'tool') return 'string';
  return 'bounded-value';
}
```

In `observeIssues`, use `issue.path` directly rather than stripping a first `arguments` component; `arguments` is now an actual wrapper field. Do not inspect nested plugin fields. Keep the safe facts sink and count bound; for `tools`, emit expected `bounded-value` rather than an unbounded arbitrary field/type. `fromZod` can retain its existing general missing/wrong-type/unknown-field mapping using the updated `expectedType`; normalize a `custom` selection refinement as `invalid-value` / `bounded-value`:

```typescript
if (issue.code === 'custom') {
  entries.push({ path, code: 'invalid-value', expected: 'bounded-value' });
  continue;
}
```

Delete `dateOnly`, the date-only clarification block, the `calendarInputSchemas` membership block, and plugin `calendarCallSchema.safeParse` entirely. Replace the tail after `JSON.parse` with:

```typescript
const schema = call.name === 'activate_skill' ? activateSkillEnvelopeSchema : callToolEnvelopeSchema;
const validated = schema.safeParse(parsed);
if (!validated.success) {
  observeIssues(call, parsed, validated.error.issues, limits, diagnostic);
  return rejected(fromZod(call.name, validated.error.issues), batch, limits);
}
return { kind: 'valid', nativeCall: nativeToolCallSchema.parse({
  id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments },
}), envelope: validated.data };
```

`scanJsonObject` still scans the **whole wrapper** with the existing limits, including nested `arguments`; no new copy of that scanner and no relaxation of forbidden keys. Calendar's current shapes fit depth 8. The full raw wrapper, not just its nested arguments, must fit 16,384 bytes. This is a deliberate tighter effective payload ceiling, not an increased budget.

- [ ] **Step 4: Verify and commit the wrapper change.**

Run: `npm test -- test/model/calendar-validation.spec.ts`

Expected: PASS. Compilation of adapter/repair consumers is restored in Tasks 5–7; do not dispatch P2 until the entire P1 worker gate passes.

```powershell
git add backend/src/model/calendar-validation.ts backend/test/model/calendar-validation.spec.ts
git commit -m "refactor(skills): validate wrappers at the model boundary"
```

## Task 5: Validate history structurally and allow an already ordered native prefix

**Files:**
- Modify: `backend/src/model/calendar-repair.ts`
- Modify: `backend/test/model/calendar-repair.spec.ts`

- [ ] **Step 1: Append these failing history tests.**

```typescript
import { assertNativeHistory } from '../../src/model/calendar-repair.js';
import { skillError } from '../../src/contracts/calendar-tools.js';

it('keeps a rejected-domain stable pair and its raw call before historical narration', () => {
  const raw = '{ "plugin":"google-calendar", "tool":"calendar_get_event", "arguments":{"eventId":7} }';
  const assistant = { role: 'assistant' as const, content: 'Looking.', tool_calls: [{
    id: 'stable_old', type: 'function' as const, function: { name: 'call_tool' as const, arguments: raw } }] };
  const result = { role: 'tool' as const, name: 'call_tool' as const, tool_call_id: 'stable_old',
    content: JSON.stringify(skillError('ARGUMENTS_INVALID', 'google-calendar', 'calendar_get_event',
      [{ path: 'eventId', code: 'wrong-type', expected: 'string' }])) };
  const prefix = [{ role: 'system' as const, content: 'Rules' },
    { role: 'user' as const, content: 'Previous input' }, assistant, result,
    { role: 'assistant' as const, content: 'Previous narration' }];
  const boundary = { prefix, acceptedInput: { role: 'user' as const, content: 'Next input' }, groups: [] };
  const messages = rebuildCalendarMessages(boundary, null);
  expect(messages).toEqual([...prefix, boundary.acceptedInput]);
  expect(messages[2]).toEqual(assistant);
  expect(messages[3]).toEqual(result);
  expect(() => assertNativeHistory(messages)).not.toThrow();
  expect(() => assertNativeHistory([...messages, assistant, result])).toThrow('Duplicate');
  expect(() => assertNativeHistory([result, assistant])).toThrow();
  expect(() => assertNativeHistory([assistant, { ...result, name: 'activate_skill' }])).toThrow();
  expect(() => assertNativeHistory([{ ...assistant, tool_calls: [{ ...assistant.tool_calls[0],
    function: { name: 'call_tool', arguments: '{"plugin":"a","plugin":"b","tool":"x","arguments":{}}' } }] }, result])).toThrow();
});

it('gives specific bounded load-and-retry guidance without resetting any repair budget', () => {
  for (const code of ['schema-not-loaded', 'schema-stale'] as const) {
    const instruction = repairInstruction([{ path: 'tool', code, expected: 'bounded-value' }]);
    expect(instruction).toContain('activate_skill');
    expect(instruction).toContain('call_tool');
    expect(instruction).not.toContain('inputSchema');
  }
});
```

Change the existing import of `CalendarHistoryBoundary` naturally with the source type below; its previously text-only prefix now accepts native messages. Keep old legacy-group tests (they prove read compatibility).

- [ ] **Step 2: Run red.**

Run: `npm test -- test/model/calendar-repair.spec.ts`

Expected: FAIL: the old prefix rejects native pairs and calls the live plugin candidate validator for history.

- [ ] **Step 3: Replace live validation in `assertNativeHistory` with structural history evidence validation.**

Remove the `ContextChatMessage`, `CALENDAR_TOOLS`, and `validateCalendarCandidate` imports; import `activateSkillEnvelopeSchema`, `callToolEnvelopeSchema`, `skillNativeNameSchema` and `scanJsonObject`. Keep `CALENDAR_LIMITS` and existing schemas. Replace the candidate-validation block inside the matched-group branch with:

```typescript
const call = group.assistant.tool_calls[0];
const scan = scanJsonObject(call.function.arguments, CALENDAR_LIMITS);
if (scan.code || scan.forbidden) throw new Error('Invalid native history call.');
const args: unknown = JSON.parse(call.function.arguments);
if (skillNativeNameSchema.safeParse(call.function.name).success) {
  const schema = call.function.name === 'activate_skill' ? activateSkillEnvelopeSchema : callToolEnvelopeSchema;
  schema.parse(args);
}
ids.add(id);
```

Legacy native names are already bounded by `nativeToolCallSchema`; the scanner requires a JSON object, but do not revalidate old inputs against today's Calendar domain schema. Stable wrappers retain their envelope structure, including unknown-plugin/tool or invalid nested domain arguments paired with errors. Historical validation never grants execution permission or upgrades an old native call into a new dispatch.

Replace the boundary's prefix and prefix mapping only:

```typescript
export type CalendarHistoryBoundary = {
  prefix: readonly NativeCalendarModelMessage[];
  acceptedInput: { role: 'user'; content: string };
  groups: readonly (CompleteCalendarToolGroup | CompleteCalendarToolGroupV2)[];
};
```

```typescript
const messages: NativeCalendarModelMessage[] = boundary.prefix.map(m => nativeModelMessageSchema.parse(m));
assertNativeHistory(messages);
```

Leave accepted-input insertion, current-group append, repair append, note append and final `assertNativeHistory` in their existing order. P2 assembles old-turn groups **inside their turns** before passing the prefix; this helper does not fetch, reorder, or deduplicate checkpoint history. An unmatched prefix still fails; do not silently repair it by borrowing a result from current-turn groups.

- [ ] **Step 4: Extend `repairInstruction` with precise stable guidance, keeping existing diagnostic prose tests.**

Insert this branch before the existing redundant-call/cardinality branches:

```typescript
const needsSchema = input.some(item => item.code === 'schema-not-loaded' || item.code === 'schema-stale');
```

Use `needsSchema ? 'This rejected call was not executed. Call activate_skill for the identified plugin and tool, then retry call_tool using the revealed schema.' :` at the front of the existing `effect` ternary. In the common returned instruction add the literal sentence `For call_tool, validate arguments against the retained disclosed schema; an advertised wrapper is not the plugin argument schema.` Keep the old pagination sentence, no-account-bypass warning, native-format instruction, and bounded normalized diagnostic JSON. Successful discovery never alters a counter here; counters belong to P2's existing ledger.

- [ ] **Step 5: Verify and commit.**

Run: `npm test -- test/model/calendar-repair.spec.ts test/contracts/calendar-model.spec.ts`

Expected: PASS for old and new matched groups and unchanged malformed-history rejection.

```powershell
git add backend/src/model/calendar-repair.ts backend/test/model/calendar-repair.spec.ts
git commit -m "feat(skills): preserve ordered stable and legacy native history"
```

## Task 6: Assemble stable streamed calls without losing assistant text or raw arguments

**Files:**
- Modify: `backend/src/model/calendar-stream.ts`
- Modify: `backend/test/model/calendar-stream.spec.ts`

- [ ] **Step 1: Add this failing fragmented stable-call regression.**

```typescript
import { SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';

it('retains fragmented stable identity, raw arguments and assistant content', () => {
  const assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
  const raw = '{ "plugin":"google-calendar", "tools":["calendar_get_event"] }';
  assembly.push({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Loading.', tool_calls: [{
    index: 0, id: 'load_1', type: 'function', function: { name: 'activate_', arguments: raw.slice(0, 12) },
  }] }, finish_reason: null }] });
  expect(() => assembly.finish()).toThrow();
  assembly.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0,
    function: { name: 'skill', arguments: raw.slice(12) } }] }, finish_reason: 'tool_calls' }] });
  expect(assembly.finish()).toEqual({ kind: 'valid', assistantContent: 'Loading.',
    nativeCall: { id: 'load_1', type: 'function', function: { name: 'activate_skill', arguments: raw } },
    envelope: { plugin: 'google-calendar', tools: ['calendar_get_event'] } });
});

it.each([undefined, ''])('preserves absent versus empty assistant content: %s', content => {
  const assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
  assembly.push({ choices: [{ index: 0, delta: { role: 'assistant', content,
    reasoning: 'PRIVATE', tool_calls: [{ index: 0, id: 'empty_1', type: 'function',
      function: { name: 'activate_skill', arguments: '{"plugin":"google-calendar","tools":"all"}' } }] },
    finish_reason: 'tool_calls' }] });
  expect(assembly.finish()).toMatchObject({ kind: 'valid', assistantContent: content === undefined ? null : '' });
  expect(JSON.stringify(assembly.finish())).not.toContain('PRIVATE');
});
```

- [ ] **Step 2: Run red.**

Run: `npm test -- test/model/calendar-stream.spec.ts -t "retains fragmented stable"`

Expected: FAIL: old assembly does not return assistant content or use the stable allowed type.

- [ ] **Step 3: Make the two small assembly changes.**

Replace `CALENDAR_TOOLS` type import with `type SkillNativeDefinition`. Constructor `allowed` is `readonly SkillNativeDefinition[]`. Add a return type:

```typescript
export type AssembledSkillCandidate =
  | Exclude<ValidatedCandidate, { kind: 'valid' }>
  | (Extract<ValidatedCandidate, { kind: 'valid' }> & { assistantContent: string | null });
```

`finish()` returns the unchanged text variant or `AssembledSkillCandidate`. Replace its final `return validateCalendarCandidate(...)` expression with:

```typescript
const validated = validateCalendarCandidate({ calls: batchCalls, terminal: this.terminal,
  envelopeInvalid: this.envelopeInvalid || batchCalls.some(call => call.envelopeInvalid),
}, this.allowed, this.limits, this.diagnostic);
return validated.kind === 'valid' ? { ...validated, assistantContent: this.contentSeen ? this.text : null } : validated;
```

Add this field beside `private text`:

```typescript
private contentSeen = false;
```

Immediately after the existing `const content = delta.content` add:

```typescript
if (typeof content === 'string') this.contentSeen = true;
```

This preserves an explicitly emitted empty assistant string versus absent/null content. Capture safe assistant content only, never `reasoning`/`reasoning_details`. Preserve every existing terminal, byte, packet-fragment, ID collision, index, choice, role, and post-terminal guard. DONE framing remains the adapter's responsibility.

- [ ] **Step 4: Migrate the existing stream cases with these exact substitutions, retaining their assertions about framing and no early execution.**

Apply these source-level replacements in `calendar-stream.spec.ts` (not in production):

```typescript
// Replace the CALENDAR_TOOLS import/usages with SKILL_NATIVE_TOOLS.
// Define once near the existing execute/repair spies:
const dispatchArgs = (args: string) =>
  `{"plugin":"google-calendar","tool":"calendar_get_event","arguments":${args}}`;
```

For every hand-built test call change native name `calendar_get_event` to `call_tool` and wrap its argument JSON using `dispatchArgs(...)`. The fragmentation test's name fragments become `call_` / `tool`, and its argument fragments become `dispatchArgs('{"eventId":"abcde"}').slice(0, 40)` / `.slice(40)`. Valid-result assertions change from `toolCallId/call` to these exact fields:

```typescript
expect(assembly.finish()).toMatchObject({ kind: 'valid', nativeCall: { id: 'call_1',
  function: { name: 'call_tool', arguments: dispatchArgs('{"eventId":"abcde"}') } },
  envelope: { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } } });
```

Escaped-value assertions use `envelope.arguments.eventId`; no-generation-ID assertions use `nativeCall.id`. Native `function_call` tests still reject the legacy **transport form**, independent of the function name. `nativeWire()` is adapted in Task 7; until then only the new stable regression is expected green. Do not delete the existing 1/2/7/65,536-byte packet cases, forbidden extra call, contradictory terminals, usage-only, output-cap, or role/index checks.

- [ ] **Step 5: Verify the new regression and commit.**

Run: `npm test -- test/model/calendar-stream.spec.ts -t "retains fragmented stable|absent versus empty"`

Expected: PASS. Full stream suite follows after fixture migration in Task 7.

```powershell
git add backend/src/model/calendar-stream.ts backend/test/model/calendar-stream.spec.ts
git commit -m "feat(skills): retain raw stable calls through streaming assembly"
```

## Task 7: Serialize the same two definitions on every admitted plugin request

**Files:**
- Modify: `backend/src/model/calendar-policy.ts`
- Modify: `backend/test/model/calendar-fixtures.ts`
- Modify: `backend/test/model/calendar-policy.spec.ts`
- Modify: `backend/test/model/prompt-caching.spec.ts`
- Modify: `backend/test/model/calendar-stream.spec.ts` (stable wire import alias)
- Modify: `backend/test/model/calendar-adapter.spec.ts` (stable helper import aliases)
- Modify: `backend/test/model/calendar-repair-flow.spec.ts` (stable helper import aliases)

- [ ] **Step 1: Add the failing exact-protocol test to the policy suite.**

```typescript
import { SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';

it('requires the exact ordered stable pair and preserves it across appended results', () => {
  const first = calendarRequest();
  const tools = SKILL_NATIVE_TOOLS.map(t => ({ type: 'function', function: {
    name: t.name, description: t.description, parameters: t.inputSchema } }));
  expect(bodyOf({ ...first, tools: SKILL_NATIVE_TOOLS }).tools).toEqual(tools);
  const continued = { ...first, tools: SKILL_NATIVE_TOOLS, messages: [...first.messages,
    { role: 'assistant' as const, content: null, tool_calls: [{ id: 'load_1', type: 'function' as const,
      function: { name: 'activate_skill' as const, arguments: '{"plugin":"google-calendar","tools":"all"}' } }] },
    { role: 'tool' as const, tool_call_id: 'load_1', name: 'activate_skill' as const,
      content: '{"kind":"fixture-disclosure"}' }] };
  expect(JSON.stringify(bodyOf(continued).tools)).toBe(JSON.stringify(tools));
  expect(bodyOf(continued).messages.slice(0, first.messages.length)).toEqual(first.messages);
  for (const invalid of [[], [SKILL_NATIVE_TOOLS[0]], [...SKILL_NATIVE_TOOLS].reverse(),
    [...SKILL_NATIVE_TOOLS, SKILL_NATIVE_TOOLS[0]], CALENDAR_TOOLS]) {
    expect(() => bodyOf({ ...first, tools: invalid as never })).toThrow();
  }
  const mutated = structuredClone(SKILL_NATIVE_TOOLS);
  (mutated[0] as { description: string }).description = 'changed';
  expect(() => bodyOf({ ...first, tools: mutated })).toThrow();
});
```

This request-body test uses a deliberately opaque bounded server-result string; disclosure validity itself is asserted in the contract suite. It proves append positions and byte-identical tools, not loaded-state correctness or provider caching.

- [ ] **Step 2: Run red.**

Run: `npm test -- test/model/calendar-policy.spec.ts -t "exact ordered stable"`

Expected: FAIL because `assertTools()` still pins the five Calendar operation definitions.

- [ ] **Step 3: Replace only the tool serialization/admission parts of `calendar-policy.ts`.**

Import `SKILL_NATIVE_TOOLS` and `SkillNativeDefinition`; remove `CALENDAR_TOOL_REVISION` from this module. Import `SkillDecisionRequest` alongside the old request type. Use a small structural estimator input, preserving compatibility with existing callers until P2 migrates them:

```typescript
type ModelToolDefinition = { name: string; description: string; inputSchema: unknown };
const nativeDefinitions = (tools: readonly ModelToolDefinition[]) => tools.map(t => ({
  type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));

export function estimateCalendarInput(messages: readonly NativeCalendarModelMessage[],
  tools: readonly ModelToolDefinition[]): number {
  const nativeTools = nativeDefinitions(tools);
  // ponytail: conservative byte-based reservation, not tokenizer certification;
  // retain the margin and replace with a verified tokenizer if needed.
  return 64 + Buffer.byteLength(JSON.stringify({ messages, tools: nativeTools }), 'utf8') + messages.length * 32;
}

function assertTools(tools: readonly ModelToolDefinition[]): asserts tools is readonly SkillNativeDefinition[] {
  if (JSON.stringify(tools) !== JSON.stringify(SKILL_NATIVE_TOOLS)) {
    throw new AppError('INVALID_REQUEST', 'The calendar request is invalid.', false);
  }
}
```

Change `buildCalendarBody`'s request parameter to `CalendarDecisionRequest | SkillDecisionRequest`. All properties except tools are shared. Keep every existing configuration/identity/policy/held-reservation/price/deadline/repair/context/byte/spend check. Replace final `request.tools.map(...)` with `const tools = nativeDefinitions(SKILL_NATIVE_TOOLS);` and always return `tools`. Keep conditional `parallel_tool_calls:false` only for the existing supported-parameter evidence. Never attach `strict:true` merely because schemas have been disclosed in tool text.

- [ ] **Step 4: Add stable request/wire helpers without changing unowned fixture consumers.**

In `calendar-fixtures.ts`, add `SkillDecisionRequest` and `SKILL_NATIVE_TOOLS` imports. Keep the existing `calendarRequest()` and `nativeWire()` exports unchanged: runtime/benchmark fixtures outside P1 use them. Keep all dispatch/budget/pricing fixtures, timestamps, reservations, hooks, and the 32,768-context limit unchanged. Add:

```typescript
export function skillRequest(signal = new AbortController().signal): SkillDecisionRequest {
  return { ...calendarRequest(signal), tools: SKILL_NATIVE_TOOLS };
}
export const skillWire = (name: 'activate_skill' | 'call_tool', args: string, terminal = 'tool_calls') =>
  nativeFrame({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function',
    function: { name, arguments: args } }] })
  + nativeFrame({}, terminal) + 'data: [DONE]\n\n';
export const skillNativeWire = (args: string, terminal = 'tool_calls') => skillWire('call_tool',
  `{"plugin":"google-calendar","tool":"calendar_get_event","arguments":${args}}`, terminal);
```

In `calendar-policy.spec.ts`, `calendar-adapter.spec.ts`, and `calendar-repair-flow.spec.ts`, change the helper imports to `skillRequest as calendarRequest` and (where used) `skillNativeWire as nativeWire`. In `calendar-stream.spec.ts`, import `skillNativeWire as nativeWire`; it has no request helper. Keep importing `nativeFrame` unchanged. All code examples in those suites use these local aliases. The production adapter's accepted decision is now `kind:'call_tool'`, never `kind:'tool'`; retaining old test wires is read/baseline fixture compatibility, not a production legacy route.

Update `calendarHarness()` to continue constructing the existing adapter; its model tests now supply `skillRequest()` through the aliases. Do not change its dispatch, fetch, or observation fixtures.

- [ ] **Step 5: Update the old policy assertions, not their admission protections.**

Apply these exact changes to `calendar-policy.spec.ts`:

- Expected tools in the first and final serialization tests become `SKILL_NATIVE_TOOLS.map(t => ({type:'function', function:{name:t.name,description:t.description,parameters:t.inputSchema}}))`; final expected names are `['activate_skill','call_tool']`.
- Replace the old `allows ordinary text decisions without requiring tool_choice` test (which accepted `tools:[]`) with:

```typescript
it('does not force tool_choice for eligible general questions, but refuses an empty tool array', () => {
  const body = bodyOf();
  expect(body.tool_choice).toBeUndefined();
  expect(body.user).toBe(config().identity.userId);
  expect(body.tools).toHaveLength(2);
  expect(() => bodyOf({ ...calendarRequest(), tools: [] })).toThrow();
});
```

- Forged/mutated/duplicate tool test inputs use `SKILL_NATIVE_TOOLS`, with `as never` only on intentionally invalid fixtures; do not cast production protocol values. Keep the explicit rejection of `CALENDAR_TOOLS` in the new test.
- Estimator test passes `SKILL_NATIVE_TOOLS` instead of the five-schema registry. Existing retained legacy `group` tests remain unchanged: old pairs are valid history even though old tools cannot be advertised/executed as live native definitions.

- [ ] **Step 6: Migrate the independently built prompt-caching fixture, without changing provider policy.**

`prompt-caching.spec.ts` builds its own Calendar request rather than importing the shared helper. Replace its `CalendarDecisionRequest` type import and `calendarRequestFor` return annotation with `SkillDecisionRequest`; replace its `CALENDAR_TOOLS` import, request `tools` value, and expected serialized tools with `SKILL_NATIVE_TOOLS`. These are the exact changed expressions:

```typescript
const calendarRequestFor = (modelId: string): SkillDecisionRequest => ({
```

```typescript
tools: SKILL_NATIVE_TOOLS,
```

```typescript
expect(serialized.tools).toEqual(SKILL_NATIVE_TOOLS.map(t => ({
  type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema },
})));
```

Leave all other request fields, pricing/binding data, Anthropic `cache_control`, non-Anthropic omission, ordinary-text omission of tools, and private-field assertions untouched. This is source-local fixture adaptation, not a claim that a provider honored caching.

- [ ] **Step 7: Verify stable serializer, history, scanner, stream, and cache-policy tests.**

Run: `npm test -- test/model/calendar-policy.spec.ts test/model/calendar-repair.spec.ts test/model/calendar-validation.spec.ts test/model/calendar-stream.spec.ts test/model/prompt-caching.spec.ts`

Expected: PASS. Resolve any missed hand-built stream fixture conversion in the owned stream suite, preserving its original guard assertion. Do not relax production admission to keep an old fixture green.

```powershell
git add backend/src/model/calendar-policy.ts backend/test/model/calendar-fixtures.ts backend/test/model/calendar-policy.spec.ts backend/test/model/calendar-stream.spec.ts backend/test/model/prompt-caching.spec.ts backend/test/model/calendar-adapter.spec.ts backend/test/model/calendar-repair-flow.spec.ts
git commit -m "feat(skills): serialize an invariant two-tool model protocol"
```

## Task 8: Emit stable adapter decisions through the existing charged transport

**Files:**
- Modify: `backend/src/model/calendar-adapter.ts`
- Modify: `backend/test/model/calendar-adapter.spec.ts`
- Modify: `backend/test/model/calendar-repair-flow.spec.ts`
- Modify: `backend/test/model/calendar-fixtures.ts` (only inferred harness type if needed)

- [ ] **Step 1: Append these failing adapter tests.**

```typescript
import { skillWire } from './calendar-fixtures.js';

it('emits raw discovery/dispatch decisions only after durable observations', async () => {
  for (const name of ['activate_skill', 'call_tool'] as const) {
    const raw = name === 'activate_skill'
      ? '{ "plugin":"google-calendar", "tools":["calendar_get_event"] }'
      : '{ "arguments":{"eventId":7}, "tool":"calendar_get_event", "plugin":"google-calendar" }';
    const h = calendarHarness(skillWire(name, raw));
    const out = await collect(h.adapter.stream(calendarRequest()));
    expect(out).toContainEqual({ type: 'decision', decision: {
      kind: name, decisionId: 'decision_1', assistantContent: null,
      nativeCall: { id: 'call_1', type: 'function', function: { name, arguments: raw } },
      envelope: JSON.parse(raw), terminal: 'tool_calls' } });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(h.binding.hooks.onObservation).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String) }));
    const body = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
    expect(body.tools.map((t: { function: { name: string } }) => t.function.name))
      .toEqual(['activate_skill', 'call_tool']);
    expect(body.user).toBe(config().identity.userId);
  }
});

it('refuses legacy advertised tools and unfinished SSE without producing a tool decision', async () => {
  const { CALENDAR_TOOLS } = await import('../../src/contracts/calendar-tools.js');
  const h = calendarHarness(nativeWire('{"eventId":"abcde"}'));
  const rejected = await collect(h.adapter.stream({ ...calendarRequest(), tools: CALENDAR_TOOLS }));
  expect(h.fetcher).not.toHaveBeenCalled();
  expect(rejected.some(c => c.type === 'decision')).toBe(false);
  expect(rejected).toContainEqual(expect.objectContaining({ type: 'failure' }));
  const incomplete = calendarHarness(skillWire('activate_skill', '{"plugin":"google-calendar","tools":"all"}')
    .replace('data: [DONE]\n\n', ''));
  const out = await collect(incomplete.adapter.stream(calendarRequest()));
  expect(out.some(c => c.type === 'decision')).toBe(false);
  expect(out).toContainEqual(expect.objectContaining({ type: 'failure' }));
});
```

- [ ] **Step 2: Run red.**

Run: `npm test -- test/model/calendar-adapter.spec.ts -t "raw discovery|legacy advertised"`

Expected: FAIL because the adapter currently constructs a legacy decision from `result.call`.

- [ ] **Step 3: Adapt the existing adapter, without a second transport implementation.**

Import `SkillDecisionRequest`, `SkillDecisionChunk`, `SkillModelPort`, `skillDecisionSchema` and `SKILL_NATIVE_TOOLS`. Apply this declaration/signature diff, retaining the existing constructor, fields and generator body:

```diff
-export class OpenRouterCalendarAdapter implements CalendarModelPortV2 {
+export class OpenRouterCalendarAdapter implements CalendarModelPortV2, SkillModelPort {
```

```diff
-  async *stream(request: CalendarDecisionRequest): AsyncGenerator<CalendarDecisionChunkV2> {
+  stream(request: SkillDecisionRequest): AsyncGenerator<SkillDecisionChunk>;
+  stream(request: CalendarDecisionRequest): AsyncGenerator<CalendarDecisionChunkV2>;
+  async *stream(request: SkillDecisionRequest | CalendarDecisionRequest):
+    AsyncGenerator<SkillDecisionChunk | CalendarDecisionChunkV2> {
```

`buildCalendarBody` rejects legacy arrays before assembly construction. Move `new CalendarStreamAssembly(...)` from before `try` to immediately **after** successful body admission, and pass `SKILL_NATIVE_TOOLS`. Thus no old allowed-name array reaches the new candidate validator. The old typed overload can only fail closed; it cannot produce old live tool decisions.

Change the text-decision parser to `skillDecisionSchema` (text shape is unchanged). Replace the valid-result branch's decision construction with:

```typescript
const decision = skillDecisionSchema.parse({
  kind: result.nativeCall.function.name, decisionId: request.decisionId,
  nativeCall: result.nativeCall, assistantContent: result.assistantContent,
  envelope: result.envelope, terminal: 'tool_calls',
});
report({ stage: 'model-decision', state: 'ok', decisionKind: 'tool',
  tool: decision.kind === 'text' ? undefined : decision.kind,
  toolCallId: result.nativeCall.id, origin: 'local', delivery: 'not-sent' });
yield { type: 'decision', decision };
return;
```

Keep the observation barrier **before** this branch, all final-usage flushes, one-use protection, no inline retries, deadline/cancel/provider error mapping, hash-only rejected evidence, and all money/token collection unchanged. `publish` can keep its existing return type because usage/failure/rejected chunks are shared. Existing `createCalendarModelPortV2()` returns `OpenRouterCalendarAdapter` (a more specific return type, so existing P2 callers still compile); keep its v2 binding validation and the legacy factory's pre-fetch version refusal. The new overload is selected when P2 uses `SkillDecisionRequest`.

Do not reinterpret the existing accounting dispatch `schemaRevision` as the generic protocol revision. Keep `CALENDAR_DIAGNOSTIC_FINGERPRINTS` for real Calendar revisions, and additionally export:

```typescript
export const SKILL_NATIVE_FINGERPRINT = createHash('sha256')
  .update(JSON.stringify(SKILL_NATIVE_TOOLS)).digest('hex');
```

This is a testable definition fingerprint, not a new telemetry service. Existing diagnostic sanitizers may drop new native names; do not expand unowned telemetry contracts here. P2 keeps canonical execution diagnostics tied to the actual operation.

- [ ] **Step 4: Update the adapter suite's compile types and legacy decision assertion.**

In `calendar-adapter.spec.ts`, import `SkillDecisionChunk` / `SkillModelPort`; make the `chunks` helper accept `SkillModelPort`, with request default `calendarRequest()` (the Task 7 local alias of `skillRequest`). The old factory version-refusal test calls factories directly and does not need the helper. Replace the two `const out: CalendarDecisionChunk[]` declarations with `SkillDecisionChunk[]`; replace expected decision `kind:'tool'` with `kind:'call_tool'`. All existing assertions about one POST, observation-before-decision, beforeDispatch gating, cancel/expiry, two repairs, 429 behavior, reasoning exclusion, and version refusal remain. The local `nativeWire` alias now wraps the nested argument fixture correctly.

- [ ] **Step 5: Adapt the existing repair-flow fixture with these exact edits.**

Keep `runFixtureTurn`'s dispatch-index/repair/deadline/cancel/observation mechanics. Replace `CalendarDecisionChunk` with `SkillDecisionChunk`, and `decision.kind === 'tool'` with `decision.kind === 'call_tool'`; the execution spy now records the accepted wrapper decision rather than asserting plugin validity. In `wireFor()` change the native name to `call_tool`; its `args` input is now **the full raw wrapper**. Define these constants before `cases`:

```typescript
const validDispatch = '{"plugin":"google-calendar","tool":"calendar_get_event","arguments":{"eventId":"abcde"}}';
const missingPlugin = '{"tool":"calendar_get_event","arguments":{}}';
const wrongPluginType = '{"plugin":7,"tool":"calendar_get_event","arguments":{}}';
const wrongArgumentsType = '{"plugin":"google-calendar","tool":"calendar_get_event","arguments":[]}';
const extraWrapperField = '{"plugin":"google-calendar","tool":"calendar_get_event","arguments":{},"extraLabel":"SECRET"}';
const forbiddenDispatch = '{"plugin":"google-calendar","tool":"calendar_get_event","arguments":{"accessToken":"SECRET"}}';
```

Update each fixture case literally:

- `cases`: `['malformed then valid', ['{', validDispatch], 2, 1]`; `['two-correction exhaustion', ['{', missingPlugin, wrongArgumentsType], 3, 0]`.
- `repairs missing, wrong and extra innocuous fields then executes once`: loop `[missingPlugin, wrongPluginType, extraWrapperField]`, corrected value `validDispatch`.
- Already-charged and ninth-dispatch cases: `[validDispatch]`.
- Hand-built multiple/forbidden calls: function name `call_tool`, raw arguments `validDispatch` / `forbiddenDispatch`; preserve one-batch rejection/no-index-zero-execution assertions.
- Later malformed narration, new call ID, and cancel-after-rejection cases: `['{', validDispatch]`. The old retained group stays a five-name legacy pair, proving historical compatibility.
- Injection case: `[forbiddenDispatch, validDispatch]`.
- Matched-group independent checks: `['{', validDispatch]`.
- Replace the final domain-selector repair test with the following wrapper repair and delegation test:

```typescript
it('repairs wrappers but delegates safe invalid plugin arguments to execution', async () => {
  const repaired = await runFixtureTurn([wrongArgumentsType, validDispatch]);
  expect(repaired.posts).toBe(2);
  expect(repaired.repairsUsed).toBe(1);
  const invalidDomain = '{"plugin":"google-calendar","tool":"calendar_get_event","arguments":{"eventId":7}}';
  const delegated = await runFixtureTurn([invalidDomain]);
  expect(delegated.posts).toBe(1);
  expect(delegated.repairsUsed).toBe(0);
  expect(delegated.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'call_tool',
    envelope: { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 7 } } }));
  for (const field of ['confirmed', 'conflictAccepted', 'accessToken', 'connectionId']) {
    const denied = await runFixtureTurn([JSON.stringify({ plugin: 'google-calendar', tool: 'calendar_get_event',
      arguments: { eventId: 'abcde', [field]: true } }), validDispatch]);
    expect(denied.posts).toBe(1);
    expect(denied.execute).not.toHaveBeenCalled();
    expect(denied.repairsUsed).toBe(0);
  }
});
```

The old `new call identity` assertion reads `nativeCall.id`, not `toolCallId`. Replace it with:

```typescript
expect(run.execute).toHaveBeenCalledWith(expect.objectContaining({ nativeCall: expect.objectContaining({ id: 'call_2' }) }));
```

All assertion intent is retained except the duplicate plugin argument checks intentionally removed from this layer. Missing/stale schema and argument corrections sharing one ledger are **P2** tests: this fixture does not pretend to implement local activation or an executor.

- [ ] **Step 6: Verify the complete P1 seam and build.**

Run: `npm test -- test/contracts/ test/model/`

Run: `npm run build`

Run: `npm run lint`

Expected: contract/model suites PASS with actual test counts, source build PASS, lint PASS. Do not classify empty discovery or a skipped suite as passing. Fix owned compile/type/lint defects without editing P2-owned callers; the overload/additive exports are specifically intended to keep those callers compiling. Run checks serially after emitted-file builds; research observed one misleading failure from overlap with a build.

```powershell
git add backend/src/model/calendar-adapter.ts backend/test/model/calendar-adapter.spec.ts backend/test/model/calendar-repair-flow.spec.ts backend/test/model/calendar-fixtures.ts
git commit -m "feat(skills): emit stable decisions through charged model transport"
```

## Task 9: Freeze the downstream handoff and run focused regression gates

**Files:** No additional production files. If an owned test needs a correction, stage its explicit path in a focused test-fix commit; never include unrelated files or change unowned callers to hide integration failures.

- [ ] **Step 1: Confirm P1's focused tests and ordinary-text/provider/accounting regressions.**

Run: `npm test -- test/contracts/ test/model/ test/context/`

Run: `npm run build`

Run: `git diff --check`

Expected: contract/model tests PASS; record any context tests that still require P2's live request integration as pending P2 rather than weaken exact-tool admission. The source build must pass. Check the actual status with `git status --short`; preserve concurrent/untracked user work. No application source execution, Google/OAuth calls, paid model calls, or database provisioning is necessary for P1.

- [ ] **Step 2: Capture an exact handoff, not a readiness claim.**

Return implementation commit IDs, exact commands and counts, new exported types/functions listed below, and the known integration transition. Required full backend/frontend/e2e and assembled P3 gates remain pending. Research's existing 60 routine failures are not P1 successes and not permission to broaden ownership. Record code review as **skipped**.

If correcting an owned regression after Task 8, use named files and commit message `test(skills): lock stable protocol regression coverage`. Do not create an empty commit if no correction is needed.

## P2/P3 coordination contract (authoritative design handoff)

### Catalog and native tools

- `calendar-tools.ts`: `compactSkillCatalog(availableTools?)` returns `{plugin:'google-calendar',label:'Calendar',description,tools:[{name,description}]}` sorted by code-point canonical tool name. It contains no revision/parameter schemas. P2 places it once in the existing eligible Calendar instructions; ordinary continuations must not regenerate date-dependent wording into this catalog.
- `SKILL_NATIVE_TOOLS`: exactly two deeply frozen ordered definitions `[activate_skill, call_tool]`, with `name`, `description`, `inputSchema`; never append real Calendar definitions after activation. `SKILL_NATIVE_FINGERPRINT` hashes those definitions. No `strict:true` enforcement or provider-cache guarantee is claimed.
- `CALENDAR_TOOLS`, `calendarCallSchema`, existing Calendar operation identities/revisions/annotations are unchanged. P3 benchmarks continue to identify actual Calendar operations, not generic native names.

### Envelopes and local results

- `ActivateSkillEnvelope`: `{plugin,tools:'all'|string[]}`. Identifiers match `^[a-z][a-z0-9_-]*$`, length 1–64. Explicit lists contain 1–64 distinct names. Unknown valid identifiers are distinguished from malformed wrappers.
- `CallToolEnvelope`: `{plugin,tool,arguments:Record<string,unknown>}`. Native adapter validates this wrapper and strict JSON safety only. P2 resolves it and forwards `{name:envelope.tool,arguments:envelope.arguments}` to the existing validation/execution boundary, preserving the resulting typed `CalendarCall` for duplicate/create classification. Do not add a second domain-schema validation pass just to resolve that object.
- `selectSkillTools(value,availableMetadata=CALENDAR_TOOLS)`: pure atomic selection, returning `{ok:true,tools}` or `{ok:false,code:'INVALID_SELECTION'|'UNKNOWN_PLUGIN'|'UNKNOWN_TOOL'}`; no external access/preflight side effects.
- `skillDisclosureSchema` / `skillLocalResultSchema`: `{kind:'skill-disclosure',protocolVersion:'plugin-skills.v1',plugin,disclosures:[{tool,revision,inputSchema,instructions}],alreadyLoaded:[{tool,revision,disclosureCallId}]}`. Total selected entries 1–64, distinct tool names across both lists. Derive schemas/instructions from the real selected registry objects. First load has disclosures; repeated load can have only prior-disclosure references; mixed batches may have both. Every reference must resolve to an actually retained original disclosure in context. Never replace that original.
- `skillError(code,plugin,tool,diagnostics?)`: fixed safe guidance; missing/stale -> `retry:'activate-skill'`, argument error -> `retry:'correct-arguments'`, unknown/invalid/over-budget -> `retry:'none'`. Machine codes: `SCHEMA_NOT_LOADED`, `SCHEMA_STALE`, `ARGUMENTS_INVALID`, `UNKNOWN_PLUGIN`, `UNKNOWN_TOOL`, `INVALID_SELECTION`, `DISCLOSURE_BUDGET_EXCEEDED`. This `retry` is a model-workflow hint, **not** `CalendarFailure.retry` or permission to repeat a write. Existing access/disconnect/provider/uncertain outcomes keep their authoritative error handling.
- `serializeSkillLocalResult(value,effectiveResultBytes?)`: exact JSON string, hard max 16,384 UTF-8 bytes. P2 must also check existing remaining-context/dispatch/spend/deadline budgets before persisting an entire disclosure selection. If it cannot fit, persist one bounded error, not a partial success. No separate discovery persistence transaction or logical-create debit.

### Decisions, history, and records

- `SkillDecision` / `skillDecisionSchema`: text remains `{kind:'text',decisionId,content,truncated}`; native variants use `kind:'activate_skill'|'call_tool'`, `decisionId`, `nativeCall:{id,type:'function',function:{name,arguments:<original raw string>}}`, `assistantContent`, parsed `envelope`, and `terminal:'tool_calls'`. Raw call/name/arguments must match the parsed decision; never reconstruct them from canonical plugin arguments.
- `SkillDecisionRequest` differs from the old request only in `tools`; `SkillDecisionChunk` reuses existing usage/failure/rejected chunk shapes and adds stable decisions. Existing `createCalendarModelPortV2` returns the same single adapter with a stable-request overload. P2 switches `CalendarLoop`, context/model-port wiring and its factories to those types. The legacy overload is read-transition source compatibility only; legacy advertised tools fail before fetch. Do not deploy between P1 and P2.
- `NativeCalendarModelMessage` / complete group schemas accept the two stable names **and** five historical Calendar names; one assistant call must match the immediately following result by name and call ID. Preserve assistant content, raw arguments, result text, identities and causal order. Invalid plugin arguments with a safe wrapper are valid history when paired with a correction result. Malformed/forbidden raw calls are still hash-only rejection evidence, never fabricated pairs.
- `rebuildCalendarMessages({prefix,acceptedInput,groups},repair,note?)` accepts a validated ordered **native** prefix plus current-turn groups, then inserts accepted input exactly once. P2 reconstructs finalized attempts and places complete groups after their original user message and before narration; no checkpoint/application double injection. History validation is structural, not current execution authority.
- `resumableSkillDecisionSchema` / `ResumableSkillDecision` / `SkillDecisionStore`: existing decision metadata kind/identity fields, `schemaVersion:3`, `protocolVersion:'plugin-skills.v1'`, `schemaRevision:'google-calendar.v2'`, stable decision or redacted null, existing v2 source/account/operation/intent/proposal fields. The store has stable-record `put`, compatible `get`, and existing v2 `putRejected`. Decisions are persisted before execution by P2.
- `localSkillResultRecordSchema` / `LocalSkillResultRecord` / `SkillResultStore`: existing result metadata kind and user/session/turn/attempt/decision/event/sequence/call/createdAt fields, `schemaVersion:3`, protocol marker, `resultRef:{storage:'local',toolCallId,content}`. No source, Google operation, resource-discovery revision, or OAuth call is needed. Exact bounded content decodes as a disclosure/ack/error. Real execution results continue using existing source-bearing v1/v2 records and privacy projection. The store accepts v2 external or local records for `put`, and reads old/new records by scoped call identity. P2 implements these as facades on the existing metadata stores and adds its bounded manifest-attempt history query there, not in a new persistence subsystem.
- `compatibleSkillDecisionRecordSchema`, `compatibleSkillResultRecordSchema`, `compatibleSkillCheckpointRefsSchema`: additive read unions include old records without upgrading old calls into executable requests. P2 adopts them in evidence/codec/retention/recovery consumers. Existing old exports remain intact until those consumers are ready.
- `skillCheckpointRefsSchema`: version 3 + protocol marker, same v2 identity/operation/account fields, at most 8 distinct decisions and at most 8 distinct call refs, calls no more numerous than decisions. This is a per-turn resume boundary; never a growing lifetime registry. Lifetime loaded revisions are derived by P2 from actual complete disclosure groups present in context, scoped to the server user/session and accepted/finalized attempts.
- `repairDiagnosticsSchema` remains exported from `calendar-model.ts` for existing callers and has one implementation in tools to avoid an import cycle. New wrapper paths and missing/stale diagnostic codes fit the same 10-entry/2,048-character ceilings. P2 charges missing/stale/argument corrections against the **same** two-repair ledger; successful discovery does not reset it. Every extra model request is a charged dispatch.

### Required downstream evidence, not P1 claims

P2/P3 must prove local discovery with zero Google/OAuth/extra authorization requests; one cold batch discovery request and zero warm discovery requests; durability before loaded-state use; missing/stale correction and no action on rejection; domain-invalid arguments rejected at the existing executor; confirmation/unknown-write paths retaining original canonical operation identity; restart/reopen/isolation/redaction; complete history positions; and byte-stable tools/catalog with ordinary same-date/same-mode prefix comparison. Date/environment changes can legitimately change other prefix content. No paid provider calls, cache hits, latency win, production readiness, or final package success is established by this plan.
