# P4 Model Tools and Structural Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task, within the orchestrator's slot/ownership rules. Steps use checkboxes for tracking. Unified review is **skipped**; do not dispatch a reviewer.

**Goal:** Add a fixture-proven, one-dispatch native Calendar model boundary with strict bounded parsing, exact corrective instructions, clean provider history, and complete usage observations while leaving ordinary text behavior intact.

**Architecture:** Implement the frozen `CalendarModelPort` alongside the existing `ModelAdapter`, reusing the raw bounded SSE reader, provider request parameters, deadline utilities and usage primitives. A Calendar port instance performs at most one POST; P6 admits every initial/continuation/repair/provider-retry dispatch, durably consumes counters/reservations, and owns graph execution. P4 never calls MCP, persists a record, executes a tool, or internally regenerates a decision.

**Tech Stack:** Existing Node `^22.22.3 || ^24.15.0 || >=26.0.0`, TypeScript NodeNext/ESM with `.js` imports, raw Fetch/SSE, pinned `@langchain/openrouter`, Zod v3, `node:crypto`, and Vitest. No dependency changes.

---

## Authority, ownership and stop conditions

- Read [goal.md](goal.md), [research.md](research.md), and [state.md](state.md#p4--provider-tools-strict-parsing-and-repair). The dated approval in state closes the stale pending-approval prose in the goal. P1 worker completion, not another planner's document, is this worker's prerequisite. Do not wait for P2 or P5.
- Read frozen `backend/src/contracts/calendar-model.ts`, `calendar-policy.ts`, `calendar-tools.ts`, `calendar-accounting.ts`, `calendar-sources.ts`, `calendar-wire.ts`, `config-runtime.ts`, and `usage-evidence.ts`. Do not edit them. Any necessary shared API/manifest amendment returns to P1 before the affected work continues.
- Own only `backend/src/model/**` and `backend/test/model/**`. P4 implements the corrective instruction. P8 owns general fixed instruction assets; P6 owns context selection, graph dispatch, durable counters/reservations, permissions/intent and storage; P5 owns Calendar semantics and MCP execution. No central assembly edits.
- Preserve approved embedded MCP transport, single-user local boundary, exactly three Calendar actions, limits, exact repair contract and retention. If a finding requires changing one, stop and report; do not substitute scope or silently change a contract.
- Tests inject Fetch and observations. No Google grant, paid inference, network catalogue request, application database, migration, deployment or live compatibility claim is authorized here. Published APIs and declarations are not live certification.
- In this plan all runnable package commands execute from `backend/`; Git commands execute from the repository root. Ask the orchestrator for the serialized commit turn before staging each task; use named paths only. Preserve other planners/workers' dirty files and index entries.
- Each numbered red/implementation/green action is one small TDD increment. Where a task has a case table or ordered gate list, take **one row/gate at a time**: add that failing assertion, run its named focused command, implement only that transition, and rerun before starting the next. The commit closes the cohesive task, not a single untested multi-hour implementation block.

## Frozen seams and invariants

1. `CalendarDecisionRequest` supplies dispatch/decision IDs, server-resolved OpenRouter `user`, configured model, native messages, currently permitted `CALENDAR_TOOLS` definitions, output/context allowance, the original absolute `deadlineAt`, cancellation signal, denied data collection, an approved processing-policy ID, and optional repair provenance/diagnostics.
2. `CalendarDecisionChunk` is the public output: `text-delta`, `decision`, `usage`, `rejected`, or `failure`. Do not invent a new stream wire protocol. P6/P8 map safe progress separately; raw tool arguments, provider diagnostics and rejected content never become UI deltas.
3. A one-shot model factory binds immutable copies of a P6-admitted `CalendarModelDispatch`, post-admission `CalendarTurnBudget`, effective `CalendarLimits`, processing policy and awaited hooks. This supplies the session/turn/attempt IDs and `repairsUsed` required by `CalendarRejectedDecision` without changing the frozen request. No mutable counter is kept in a model singleton.
4. P6 increments `modelDispatches` and, for a correction, `repairs`, and creates a held reservation **before** creating/using this port. Validate a *charged* snapshot: dispatch index equals budget model dispatch count and is within the effective cap. A second correction with `repairs === 2` is permitted when already admitted; a third correction is never admitted. A rejected second correction yields evidence plus `REPAIR_EXHAUSTED`, not another regeneration.
5. The model boundary validates structure and known forbidden keys/tool identity. A structurally valid `CalendarCall` is **not execution authority**. Invalid/missing intent, dates/timezone/DST, range, changed connection/account, credentials and external outcomes belong to P5/P6's non-schema paths; do not coerce or guess them.
6. No invalid assistant call or fabricated tool result enters provider history. Repair reconstructs a fresh request from trusted text prefix + accepted user input once + complete previously executed current-turn groups + one trusted repair system message. No content-based history deduplication: identical text in an older turn is legitimate.
7. Every real POST, including rejected/malformed/empty/cancelled output, retains user attribution and a terminal usage observation. Missing cost remains pending/unknown, never zero. Token-count-only reasoning evidence is allowed; private reasoning text/signatures/details are discarded before any output/hook/evidence object.

## File map

| Path | Responsibility |
| --- | --- |
| `backend/src/model/strict-json.ts` (new) | One RFC8259 object, decoded duplicate-key detection, depth/byte bounds, forbidden-key sightings; no schema/repair loop |
| `backend/src/model/calendar-validation.ts` (new) | Candidate-call/envelope classification, allowlisted normalized diagnostics, canonical valid calls and rejected-argument hashes |
| `backend/src/model/calendar-repair.ts` (new) | Exact instruction, complete-group validation and clean-history reconstruction |
| `backend/src/model/calendar-policy.ts` (new) | Bound dispatch snapshot, native request validation/serialization and conservative input estimate |
| `backend/src/model/calendar-stream.ts` (new) | Stream decision state machine; fragmented calls indexed by stable index/ID, no execution |
| `backend/src/model/calendar-usage.ts` (new) | Absolute allowlisted per-dispatch observations; no persistence or aggregation |
| `backend/src/model/calendar-adapter.ts` (new) | One POST, awaited hooks, finite deadlines and cleanup, terminal chunks |
| `backend/src/model/policy.ts` | Reuse shared provider parameters; alias the already-frozen `VerifiedModelLimits` instead of maintaining a second limits shape |
| `backend/src/model/catalogue.ts` | Add optional verified Calendar capability/pricing evidence; preserve text-only admission |
| `backend/src/model/deadlines.ts` | Optional absolute deadline on the existing timer owner, preserving old callers |
| `backend/src/model/index.ts` | Export the Calendar factory/helpers; preserve `createModelServices` |
| `backend/test/model/calendar-fixtures.ts` (new) | Deterministic native SSE frames, admitted seeds, Fetch/hook harness; fixtures remain under P4 ownership |
| `backend/test/model/strict-json.spec.ts` (new) | Strict grammar, escapes, duplicate keys, UTF8/depth/boundedness |
| `backend/test/model/calendar-validation.spec.ts` (new) | Schema diagnostics versus policy/clarification classification |
| `backend/test/model/calendar-repair.spec.ts` (new) | Exact prompt and matched history; injection/privacy checks |
| `backend/test/model/calendar-policy.spec.ts` (new) | Native outbound body, identity/schema/pricing/spend/context admission |
| `backend/test/model/calendar-stream.spec.ts` (new) | Fragmentation/interleaving/terminal machine |
| `backend/test/model/calendar-usage.spec.ts` (new) | Every path's absolute tokens/canonical cost/unknown evidence |
| `backend/test/model/calendar-adapter.spec.ts` (new) | One-shot provider transport, callbacks, cancellation and eligible rejection |
| `backend/test/model/calendar-repair-flow.spec.ts` (new) | Tiny fixture caller exercising malformed→valid and turn-wide exhaustion without implementing a graph |
| `backend/test/model/policy.spec.ts`, `catalogue.spec.ts`, `deadlines.spec.ts` | Narrow regression additions for shared helpers |

Do not move existing `backend/test/fixtures/openrouter/**`, create a generic plugin framework, replace Vitest, or modify runtime/voice/HTTP callers. `backend/src/model/openrouter-adapter.ts` and legacy accounting remain on their existing text path unless a proven shared-helper defect requires a narrowly tested model-directory fix.

## Task 1: Strict JSON object scanner before native parsing

**Files:** Create `backend/src/model/strict-json.ts` and `backend/test/model/strict-json.spec.ts`.

- [ ] **1. Write the failing tests.** Import the real scanner and frozen limits, then add these assertions. Include the explicit test title so the focused command discovers tests.

```typescript
import { scanJsonObject } from '../../src/model/strict-json.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';

describe('strict Calendar JSON', () => {
  it('rejects decoded duplicate keys and trailing content', () => {
    for (const raw of [
      '{"eventId":"a","eventId":"b"}',
      '{"\\u0065ventId":"a","eventId":"b"}',
      '{"x":{"k":1,"\\u006b":2}}',
    ]) expect(scanJsonObject(raw, CALENDAR_LIMITS)).toMatchObject({ code: 'duplicate-key' });
    for (const raw of ['{}{}', '{} true', '```json\n{}\n```', '[]', 'null', '{"x":01}', '{"x":1,}', '{"x":NaN}']) {
      expect(scanJsonObject(raw, CALENDAR_LIMITS)).toMatchObject({ code: 'malformed-json' });
    }
    expect(scanJsonObject(' {"eventId":"a\\\"b"}\r\n', CALENDAR_LIMITS)).toMatchObject({ code: null });
  });
  it('bounds UTF8 bytes and object-array nesting before allocation', () => {
    expect(scanJsonObject('{"x":"' + 'é'.repeat(8192) + '"}', CALENDAR_LIMITS).code).toBe('byte-limit');
    const depth8 = '{"x":'.repeat(8) + '0' + '}'.repeat(8);
    expect(scanJsonObject(depth8, CALENDAR_LIMITS).code).toBeNull();
    expect(scanJsonObject('{"x":' + depth8 + '}', CALENDAR_LIMITS).code).toBe('depth-limit');
    expect(scanJsonObject('{"x":[{"attendees":[]}] trailing', CALENDAR_LIMITS).forbidden).toBe(true);
  });
});
```

Add table rows for valid JSON whitespace, negative/fractional/exponent values, arrays nested inside objects, empty keys, same keys in different objects, control characters, invalid escapes, incomplete Unicode escapes, string braces/commas, prototype-like keys, lone surrogate escapes and trailing escaped whitespace. Only four JSON whitespace characters are accepted; no `trim()` acceptance of non-JSON whitespace. Numbers must remain finite after parsing; huge exponents must not become `Infinity`.

- [ ] **2. Run red:** `npm test -- test/model/strict-json.spec.ts -t "strict Calendar JSON"`. Expected: missing module/export, then failing grammar assertions; never accept a no-tests exit.
- [ ] **3. Implement the scanner with the following bounded algorithm.** This is the whole scanner, not a duplicate implementation of value construction. The decoded-key set catches `eventId` versus `\u0065ventId` before `JSON.parse` can overwrite it. Forbidden sightings survive an ensuing syntax/duplicate error so a recognizable denial cannot be turned into a repair.

```typescript
import { CALENDAR_LIMITS, type CalendarLimits } from '../contracts/calendar-policy.js';
import { forbiddenCalendarKeys } from '../contracts/calendar-tools.js';

export type ScanCode = 'malformed-json' | 'duplicate-key' | 'byte-limit' | 'depth-limit';
export type JsonScan = { code: ScanCode | null; forbidden: boolean };
const denied = new Set<string>(forbiddenCalendarKeys);

export function scanJsonObject(raw: string, limits: Pick<CalendarLimits, 'argumentBytes' | 'jsonDepth'> = CALENDAR_LIMITS): JsonScan {
  if (Buffer.byteLength(raw, 'utf8') > limits.argumentBytes) return { code: 'byte-limit', forbidden: false };
  let i = 0, forbidden = false, duplicate = false;
  const fail = (code: ScanCode): never => { throw code; };
  const ws = () => { while (i < raw.length && /[\x20\t\r\n]/.test(raw[i])) i++; };
  const string = (): string => {
    const begin = i;
    if (raw[i++] !== '"') return fail('malformed-json');
    while (i < raw.length) {
      const c = raw[i++];
      if (c === '"') return JSON.parse(raw.slice(begin, i)) as string;
      if (c.charCodeAt(0) < 32) return fail('malformed-json');
      if (c === '\\') {
        const escape = raw[i++];
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(raw.slice(i, i + 4))) return fail('malformed-json');
          i += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) return fail('malformed-json');
      }
    }
    return fail('malformed-json');
  };
  const value = (depth: number): void => {
    ws();
    if (raw[i] === '{' || raw[i] === '[') {
      if (depth >= limits.jsonDepth) return fail('depth-limit');
      const object = raw[i++] === '{', end = object ? '}' : ']';
      const keys = new Set<string>();
      ws(); if (raw[i] === end) { i++; return; }
      while (i < raw.length) {
        if (object) {
          ws(); const key = string();
          forbidden ||= denied.has(key);
          if (keys.has(key)) duplicate = true;
          keys.add(key); ws();
          if (raw[i++] !== ':') return fail('malformed-json');
        }
        value(depth + 1); ws();
        if (raw[i] === end) { i++; return; }
        if (raw[i++] !== ',') return fail('malformed-json');
      }
      return fail('malformed-json');
    }
    if (raw[i] === '"') { string(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(i))?.[0];
    if (!token) return fail('malformed-json');
    if (/^-?\d/.test(token) && !Number.isFinite(Number(token))) return fail('malformed-json');
    i += token.length;
  };
  try {
    ws(); if (raw[i] !== '{') return fail('malformed-json');
    value(0); ws(); if (i !== raw.length) return fail('malformed-json');
    return { code: duplicate ? 'duplicate-key' : null, forbidden };
  } catch (code) {
    return { code: typeof code === 'string' ? code as ScanCode : 'malformed-json', forbidden };
  }
}
```

Byte checks precede allocation of parser state. Recursion counts all object/array containers, root depth 1; cap is frozen `jsonDepth: 8`, reduced by effective limits. Per-object sets are transient and bounded by the 16 KiB input. A duplicate sets a rejection flag but scanning continues through otherwise well-formed grammar so a subsequent forbidden field cannot hide behind that duplicate. Do not copy decoded values into diagnostics. Native `JSON.parse` constructs the final object only after scanner success; this scanner is not used to guess a repaired object.

- [ ] **4. Verify green:** rerun the focused command, then `npm test -- test/model/strict-json.spec.ts`. Include exact 16,384-byte ASCII and multibyte valid objects, 16,385-byte rejection, configured smaller caps and depth 8/9. Expected: all discovered scanner tests pass.
- [ ] **5. Commit:** `git add -- "backend/src/model/strict-json.ts" "backend/test/model/strict-json.spec.ts"`; `git commit -m "feat(model): strictly scan bounded Calendar JSON arguments"`.

## Task 2: Classify the entire candidate before permitting repair

**Files:** Create `backend/src/model/calendar-validation.ts` and `backend/test/model/calendar-validation.spec.ts`.

- [ ] **1. Write failing tests with this public local API.** Export these local types; shared contracts stay unchanged.

```typescript
export type CandidateCall = { index: number; id: string | null; type: string | null;
  name: string; arguments: string; envelopeInvalid: boolean };
export type CandidateBatch = { calls: readonly CandidateCall[]; terminal: string;
  envelopeInvalid: boolean };
export type ValidatedCandidate =
  | { kind: 'valid'; toolCallId: string; call: CalendarCall }
  | { kind: 'rejected'; diagnostics: CalendarRepairDiagnostics; rawArgumentsSha256: string }
  | { kind: 'failure'; failure: CalendarFailure };
export function validateCalendarCandidate(batch: CandidateBatch,
  allowed: readonly (typeof CALENDAR_TOOLS)[number][], limits: CalendarLimits): ValidatedCandidate;
```

Use `CalendarCall`, `CalendarFailure`, `CalendarRepairDiagnostics`, `CalendarLimits`, and `CALENDAR_TOOLS` imported from frozen contracts. Add a local `candidate(raw, name = 'calendar_get_event')` test helper returning one index-0 call with ID `call_1`, type `function`, terminal `tool_calls`, and no envelope flags. Actual executable assertions:

```typescript
it('classifies structural defects without repairing denials', () => {
  for (const raw of ['{', '{}', '{"eventId":4}', '{"eventId":"abcde","extraLabel":"x"}',
    '{"eventId":"abcde","eventId":"fghij"}']) {
    expect(validateCalendarCandidate(candidate(raw), CALENDAR_TOOLS, CALENDAR_LIMITS)).toMatchObject({ kind: 'rejected' });
  }
  for (const raw of ['{"eventId":"abcde","attendees":[]}',
    '{"eventId":"abcde","calendarId":"other"}', '{"accessToken":"SECRET",']) {
    expect(validateCalendarCandidate(candidate(raw), CALENDAR_TOOLS, CALENDAR_LIMITS)).toMatchObject({
      kind: 'failure', failure: { category: 'policy', retry: 'none' },
    });
  }
  expect(validateCalendarCandidate(candidate('{}', 'calendar_delete_event'), CALENDAR_TOOLS, CALENDAR_LIMITS))
    .toMatchObject({ kind: 'failure', failure: { category: 'policy', code: 'UNKNOWN_OR_DISABLED_TOOL' } });
});
```

Also table-test all three tools' missing required fields, wrong primitive types, numeric `maxResults` bounds, innocuous extras, string-length bounds, empty required values, missing name/ID/type, contradictory envelope, nonzero/sparse indices, and 2+ calls. Test every frozen forbidden key recursively, including Unicode-escaped names and fields inside an otherwise invalid extra object. Test `{"eventId":"a","eventId":"b","attendees":[]}` and its field-order reversal: a duplicate cannot hide a later forbidden field in otherwise parseable grammar. An unknown/disabled tool or known forbidden field in *any* call takes priority over cardinality/structural diagnostics. Same string occurring inside a legitimate description value is not a forbidden key and never an instruction.

- [ ] **2. Run red:** `npm test -- test/model/calendar-validation.spec.ts -t "classifies structural defects without repairing denials"`. Expected: missing implementation or failing classifications.
- [ ] **3. Implement the ordered gates below.** Use the frozen Zod schemas, not duplicate hand-written Calendar input schemas. Implement `normalizeDiagnostics` in this file; its contract is shown as code to make the sanitation rule precise:

```typescript
const paths = new Set(['$', 'tool_calls', 'tool_calls.id', 'tool_calls.name', 'tool_calls.arguments',
  'timeMin', 'timeMax', 'maxResults', 'pageToken', 'eventId', 'summary', 'start', 'end',
  'timeZone', 'description', 'location']);
export function normalizeDiagnostics(input: CalendarRepairDiagnostics, limits: CalendarLimits): CalendarRepairDiagnostics {
  const out: CalendarRepairDiagnostics = [];
  for (const entry of input) {
    const safe = { ...entry, path: paths.has(entry.path) ? entry.path : '$' } as CalendarRepairDiagnostics[number];
    if (out.some(v => JSON.stringify(v) === JSON.stringify(safe))) continue;
    if (out.length >= limits.diagnosticCount || JSON.stringify([...out, safe]).length > limits.diagnosticChars) break;
    out.push(safe);
  }
  const bounded = out.length ? out : [{ path: '$', code: 'invalid-envelope', expected: 'native-envelope' }];
  if (JSON.stringify(bounded).length > limits.diagnosticChars) throw new Error('Diagnostic budget exhausted.');
  return repairDiagnosticsSchema.parse(bounded);
}
```

For Zod issues build entries only from fixed codes/types: known first field name or `$`; missing `invalid_type` with `received === 'undefined'` → `missing`; other `invalid_type` → `wrong-type`; `unrecognized_keys` → `unknown-field` at `$` without echoing its `keys`; size violations → `wrong-type` with expected `bounded-value`. Expected primitive type comes from the registered JSON Schema property (`integer` or `string`), not a validator message. Use at most 10 entries and 2,048 JSON characters, or smaller effective settings. If even one safe diagnostic cannot fit a smaller configured cap, map the controlled failure to `budget/DIAGNOSTIC_BUDGET_EXCEEDED/none`, not an over-cap fallback or a repair. Never copy `.message`, `.received`, arbitrary property names, values, paths or raw errors.

Implement `validateCalendarCandidate` in this exact order:

1. Compute scans for each bounded call. Before generic repair, identify any explicit name not in the **currently allowed** names and any scanner forbidden sighting. Those return `policy/UNKNOWN_OR_DISABLED_TOOL` or `policy/FORBIDDEN_TOOL_FIELD`, `retry: none`. Empty/incomplete missing names are structural only when no explicit denial is identified. Classify a nonempty name as incomplete only when terminal is `length` and it is a strict prefix of an allowed name; a complete disabled registered name or any other unknown name remains a denial. The stream provides terminal integrity first (Task 5).
2. A scanner byte-limit or stream resource overflow returns `budget/ARGUMENT_BUDGET_EXCEEDED`, `retry: none`; do not spend correction budget on actual capacity exhaustion. An in-budget depth violation is a bounded structural rejection. Respect smaller limits.
3. `calls.length !== 1` or sole `index !== 0` → normalized `tool_calls/cardinality/one-call`. Scan *all* candidates for denials before returning it. Missing/contradictory ID/type/name/envelope → normalized `invalid-envelope`. A `length` terminal with tools → normalized `truncated`; `stop` with calls → `invalid-envelope`. No rejected batch yields a valid subcall.
4. Map scanner `duplicate-key`/`malformed-json`/`depth-limit` to normalized diagnostics at `$` and expected `complete-json`/`bounded-value`. Hash the ordered raw argument strings with `createHash('sha256')`; use `JSON.stringify(batch.calls.map(c => [c.index, c.arguments]))` as the unambiguous hash input. Persist neither these strings nor the envelope; evidence is hash/diagnostics only.
5. After scanner success, `JSON.parse` once. Before generic missing/type errors, date-only `start`/`end` strings (`/^\d{4}-\d{2}-\d{2}$/`) are a recognized unsupported all-day/clarification shape: return `clarification/TIMED_EVENT_REQUIRED/none`. Then validate with `calendarInputSchemas[name].safeParse` and `calendarCallSchema`. Never coerce, strip unknown fields, parse fences, accept trailing content or infer defaults. Return `kind: valid` only with strict `CalendarCall` and validated `idSchema` tool ID.
6. Nonempty strings with invalid time/zone semantics otherwise pass the structural seam to P5/P6; no second temporal validator here. Empty required strings remain structural schema errors, while missing *user intent* remains P6's clarification responsibility.

These are finite failure values, not `AppError` messages containing provider output. Test the diagnostics through `repairDiagnosticsSchema` and all failure values through `calendarFailureSchema`.

- [ ] **4. Verify:** rerun the focused command and `npm test -- test/model/calendar-validation.spec.ts`. Assert no diagnostic/hash object contains `SECRET`, injected text, the unknown key or the raw JSON. A test `execute = vi.fn()` is invoked only for `kind === 'valid'`; each rejected/denied batch must leave it at zero calls.
- [ ] **5. Commit:** stage the two exact files; `git commit -m "feat(model): classify Calendar structure separately from policy denials"`.

## Task 3: Exact corrective instruction and last-valid-boundary history

**Files:** Create `backend/src/model/calendar-repair.ts` and `backend/test/model/calendar-repair.spec.ts`.

- [ ] **1. Write failing tests** named `reconstructs repair history without rejected or fabricated messages`. Use a prefix `[system('Rules'), user('Earlier question'), assistant('Earlier answer'), system('Response mode: text.')]`, one accepted current user message, and a complete already-executed `calendar_get_event` group with assistant `call_old` and matching tool result. Run `rebuildCalendarMessages` twice from this same immutable boundary with different rejected-decision IDs. Assert the accepted current user object occurs once after the prefix; the old group occurs once in each request; there is exactly one repair system message; neither rejected call appears; no fabricated role-tool error is inserted; original arrays remain unchanged.

Test exact equality of `repairInstruction(diagnostics)` against the full literal below with only `JSON.stringify(diagnostics)` substituted. Test malicious field/value diagnostics fail the frozen schema rather than being interpolated. Test unmatched, reversed, duplicate-ID and extra result groups fail before any Fetch. Include a later structural failure after a completed creation: history preserves that same complete group without calling its execution spy again.

```typescript
import { rebuildCalendarMessages, repairInstruction } from '../../src/model/calendar-repair.js';
import type { CompleteCalendarToolGroup } from '../../src/contracts/calendar-model.js';

it('reconstructs repair history without rejected or fabricated messages', () => {
  const acceptedInput = { role: 'user' as const, content: 'Read event abcde' };
  const group: CompleteCalendarToolGroup = {
    assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call_old', type: 'function',
      function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde"}' } }] },
    result: { role: 'tool', tool_call_id: 'call_old', name: 'calendar_get_event', content: '{"ok":true}' },
    sources: [],
  };
  const boundary = { prefix: [{ role: 'system' as const, content: 'Rules' }], acceptedInput, groups: [group] };
  const before = JSON.stringify(boundary);
  for (const rejectedDecisionId of ['rejected_1', 'rejected_2']) {
    const diagnostics = [{ path: 'eventId' as const, code: 'missing' as const, expected: 'string' as const }];
    const messages = rebuildCalendarMessages(boundary, { rejectedDecisionId, diagnostics });
    expect(messages).toEqual([...boundary.prefix, acceptedInput, group.assistant, group.result,
      { role: 'system', content: repairInstruction(diagnostics) }]);
    expect(messages.filter(m => m.role === 'user')).toHaveLength(1);
    expect(messages.filter(m => m.role === 'tool')).toHaveLength(1);
    expect(JSON.stringify(messages)).not.toContain(rejectedDecisionId);
  }
  expect(JSON.stringify(boundary)).toBe(before);
  expect(() => rebuildCalendarMessages({ ...boundary,
    groups: [{ ...group, result: { ...group.result, tool_call_id: 'unmatched' } }] }, null)).toThrow();
});
```

- [ ] **2. Run red:** `npm test -- test/model/calendar-repair.spec.ts -t "reconstructs repair history without rejected or fabricated messages"`.
- [ ] **3. Implement the full repair builder and matched-message guard.** All diagnostics must already be normalized; validate again at this trust boundary.

```typescript
import type { ContextChatMessage } from '../contracts/context.js';
import { completeToolGroupSchema, nativeModelMessageSchema, repairDiagnosticsSchema,
  type CalendarDecisionRequest, type CalendarRepairDiagnostics,
  type CompleteCalendarToolGroup, type NativeCalendarModelMessage } from '../contracts/calendar-model.js';
import { CALENDAR_TOOLS } from '../contracts/calendar-tools.js';
import { CALENDAR_LIMITS } from '../contracts/calendar-policy.js';
import { validateCalendarCandidate } from './calendar-validation.js';

export function repairInstruction(input: CalendarRepairDiagnostics): string {
  const diagnostics = JSON.stringify(repairDiagnosticsSchema.parse(input));
  return `The previous tool decision failed structural validation. Regenerate the decision using only the currently allowed tool definitions and the provider's native tool-call format. Correct these validation errors: ${diagnostics}. Preserve the user's requested action, date, time, and authorized target. Do not invent missing information, add unsupported fields, change accounts, or switch tools to bypass a denial. Do not wrap a tool call in Markdown or prose. If required user information is missing, ask a concise clarification instead. No tool from the rejected decision has been executed.`;
}

export function assertNativeHistory(input: readonly NativeCalendarModelMessage[]): void {
  const ids = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const message = nativeModelMessageSchema.parse(input[i]);
    if (message.role === 'tool') throw new Error('Unmatched native result.');
    if ('tool_calls' in message) {
      const result = input[++i];
      const group = completeToolGroupSchema.parse({ assistant: message, result, sources: [] });
      const id = group.assistant.tool_calls[0].id;
      if (ids.has(id)) throw new Error('Duplicate native call identity.');
      const call = group.assistant.tool_calls[0];
      const valid = validateCalendarCandidate({ calls: [{ index: 0, id: call.id, type: call.type,
        name: call.function.name, arguments: call.function.arguments, envelopeInvalid: false }],
        terminal: 'tool_calls', envelopeInvalid: false }, CALENDAR_TOOLS, CALENDAR_LIMITS);
      if (valid.kind !== 'valid') throw new Error('Invalid native history call.');
      ids.add(id);
    }
  }
}

export type CalendarHistoryBoundary = {
  prefix: readonly ContextChatMessage[];
  acceptedInput: { role: 'user'; content: string };
  groups: readonly CompleteCalendarToolGroup[];
};
export function rebuildCalendarMessages(boundary: CalendarHistoryBoundary,
  repair: CalendarDecisionRequest['repair']): NativeCalendarModelMessage[] {
  const messages: NativeCalendarModelMessage[] = boundary.prefix.map(m => {
    const parsed = nativeModelMessageSchema.parse(m);
    if (parsed.role === 'tool' || 'tool_calls' in parsed) throw new Error('Prefix must be text history.');
    return parsed;
  });
  if (boundary.acceptedInput.role !== 'user') throw new Error('Accepted input must be user text.');
  messages.push(nativeModelMessageSchema.parse(boundary.acceptedInput));
  for (const input of boundary.groups) {
    const group = completeToolGroupSchema.parse(input);
    messages.push(group.assistant, group.result);
  }
  if (repair) messages.push({ role: 'system', content: repairInstruction(repair.diagnostics) });
  assertNativeHistory(messages);
  return messages;
}
```

P6 supplies permitted, currently valid/volatile groups and separates the assembler's last accepted user message into `acceptedInput` instead of leaving it in `prefix`. This helper does not read storage, renew source expiry or claim permission to retain a group. The outgoing request additionally enforces smaller effective limits and current permissions. `CalendarDecisionRequest.repair.rejectedDecisionId` is provenance only and never pasted into the instruction. Registered authoritative schemas travel in the native `tools` body, not as untrusted event text inside this prompt.

- [ ] **4. Verify:** `npm test -- test/model/calendar-repair.spec.ts`. Assert every assistant tool-call message has exactly the immediate matching result and no other tool message; valid text history, including repeated older user text, is preserved. Repair is rebuilt from the clean boundary on every attempt rather than appending another instruction to the last failed request.
- [ ] **5. Commit:** stage the two exact files; `git commit -m "feat(model): rebuild clean Calendar repair requests with exact instruction"`.

## Task 4: Native serialization, verified capabilities and shared admission

**Files:** Create `backend/src/model/calendar-policy.ts`, `backend/test/model/calendar-policy.spec.ts`, and `backend/test/model/calendar-fixtures.ts`; modify `backend/src/model/policy.ts`, `backend/src/model/catalogue.ts`, `backend/test/model/policy.spec.ts`, and `backend/test/model/catalogue.spec.ts`.

- [ ] **1. Write failing tests** named `serializes only admitted native Calendar requests`. Fixture seeds use frozen `modelDispatchSchema`, `turnBudgetRecordSchema`, `tokenPricingSchema`, effective `CALENDAR_LIMITS`, `config()` and `limits` from `test/model/helpers.ts`. Declare the factory binding now so later tasks use the same names:

```typescript
export type CalendarDispatchHooks = {
  beforeDispatch(): Promise<void>;
  onObservation(observation: CalendarDispatchObservation): Promise<void>;
};
export type CalendarDispatchBinding = {
  dispatch: CalendarModelDispatch; budget: CalendarTurnBudget; limits: CalendarLimits;
  processingPolicyId: string; hooks: CalendarDispatchHooks;
};
export function estimateCalendarInput(messages: readonly NativeCalendarModelMessage[],
  tools: readonly (typeof CALENDAR_TOOLS)[number][]): number;
export function buildCalendarBody(config: ModelConfig, limits: ModelLimits,
  request: CalendarDecisionRequest, binding: CalendarDispatchBinding): Record<string, unknown>;
```

Imports come from the corresponding frozen `calendar-model`, `calendar-accounting`, `calendar-policy`, `calendar-tools` contracts and existing model `policy.ts`. In **this task** the fixtures export only `calendarRequest(signal?)`, `calendarBinding(reason?)`, and `calendarLimits` (a `ModelLimits` with verified `.calendar`); add frame helpers in Task 5 and the adapter harness in Task 7 so no passing test depends on a future module. Use fixed IDs `dispatch_1`, `decision_1`, `call_1`, `sess_fixture`, `turn_fixture`, `att_fixture`, `conn_fixture`; use `config().identity.userId`, `fixture/model`, a future bounded deadline derived once from fixture time and shared by request/budget, and `processingPolicyId: 'fixture-policy'`. Pricing uses `promptUsdPerToken: '0.000001'`, `completionUsdPerToken: '0.000002'`, `requestUsd: '0'`, `version: 'fixture-v1'`, `source: 'fixture'`, and `providerRoute: 'fixture-route'`. Reservations are computed with `reserveUsd`, not an arbitrary magic amount. `calendarBinding('schema-repair')` uses a newly charged dispatch and repair count and non-null `repairedDecisionId`; no same-ID retry seed. Initial request messages are `system: Rules`, then `user: Read event abcde`; tools are `CALENDAR_TOOLS`, output allowance 256, input allowance the configured context ceiling minus output and margin, data collection denied and repair null.

```typescript
import { buildCalendarBody } from '../../src/model/calendar-policy.js';
import { CALENDAR_TOOLS } from '../../src/contracts/calendar-tools.js';
import { config } from './helpers.js';
import { calendarRequest, calendarBinding, calendarLimits } from './calendar-fixtures.js';

it('serializes only admitted native Calendar requests', () => {
  const request = calendarRequest();
  const body = buildCalendarBody(config(), calendarLimits, request, calendarBinding());
  expect(body).toMatchObject({ user: config().identity.userId, model: 'fixture/model',
    max_tokens: 256, transforms: [], provider: { data_collection: 'deny', require_parameters: true } });
  expect(body.messages).toEqual(request.messages);
  expect(body.tools).toEqual(CALENDAR_TOOLS.map(t => ({ type: 'function', function: {
    name: t.name, description: t.description, parameters: t.inputSchema,
  } })));
  expect(() => buildCalendarBody(config(), calendarLimits, { ...request, user: 'other' }, calendarBinding())).toThrow();
  expect(() => buildCalendarBody(config(), calendarLimits, { ...request, remainingContextTokens: 1 }, calendarBinding())).toThrow();
});
```

Assert the outbound body contains native assistant/tool messages unchanged, `{type:'function',function:{name,description,parameters}}` definitions exactly equivalent to the allowed frozen definitions, `user`, configured `model`, `max_tokens`, `transforms: []`, disabled built-in plugins, and `provider.data_collection: 'deny'`. No connection/identity/token argument, processing-policy ID, rejected raw output, `session_id`, tracing or reasoning payload is serialized.

Negative tests: identity/model/dispatch/decision/provenance mismatch; absent/mismatched processing-policy ID; non-held/unreserved record; absent/unknown pricing; unsupported tools; tampered catalogue/schema; forged extra definitions; disabled tool; unmatched group; reduced input/context/output/byte allowance; deadline expiry; 9th dispatch; 3rd repair; spend-cap breach. Expiry/revocation of a previously approved policy is P6's current-policy hook, tested as a failed `beforeDispatch` in Task 7, not an invented expiry field in these contracts. Use effective smaller caps, not only defaults. A malformed call may return a text clarification; do not force `tool_choice: required`.

- [ ] **2. Run red:** `npm test -- test/model/calendar-policy.spec.ts -t "serializes only admitted native Calendar requests"`.
- [ ] **3. Implement the smallest shared request extraction.** In `policy.ts`, import `VerifiedModelLimits` and replace its duplicate `ModelLimits` declaration with `export type ModelLimits = VerifiedModelLimits`. Extract the existing `ChatOpenRouter` invocation-parameter construction unchanged into `providerParameters(config, {user, maxOutputTokens})`. Existing `buildBody` still calls `assertRequest`, uses those parameters and serializes **only** text roles; ordinary text must continue rejecting native calls. Calendar uses the same provider parameters, not `buildBody` with fake tool-as-text history.

```typescript
export function estimateCalendarInput(messages: readonly NativeCalendarModelMessage[],
  tools: readonly (typeof CALENDAR_TOOLS)[number][]): number {
  const nativeTools = tools.map(t => ({ type: 'function', function: {
    name: t.name, description: t.description, parameters: t.inputSchema,
  } }));
  // ponytail: conservative byte-based estimate, not tokenizer certification;
  // retain the existing margin and replace with a verified tokenizer if needed.
  return 64 + Buffer.byteLength(JSON.stringify({ messages, tools: nativeTools }), 'utf8') + messages.length * 32;
}
```

`remainingContextTokens` is the caller's **input allowance after reserving output and model margin**, not a fresh total context limit. Export this estimator for P6 reservations. Require `estimate <= request.remainingContextTokens` and `estimate + maxOutputTokens + margin <= min(configured maxContextTokens, verified contextTokens)`; include the repair message and complete groups/schemas. Do not drop history or split groups to make it fit.

`buildCalendarBody` performs all these checks before returning a body:

```typescript
const dispatch = modelDispatchSchema.parse(binding.dispatch);
const budget = turnBudgetRecordSchema.parse(binding.budget);
const effective = calendarLimitsSchema.parse(binding.limits);
const estimate = estimateCalendarInput(request.messages, request.tools);
const needed = reserveUsd(dispatch.pricing, estimate, request.maxOutputTokens);
const admitted = withinSpendCap(budget.settledUsd, budget.reservedUsd, '0', effective.modelSpendUsd)
  && withinSpendCap('0', '0', needed, dispatch.reservationUsd)
  && withinSpendCap('0', '0', dispatch.reservationUsd, budget.reservedUsd);
if (!admitted) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The model budget is exhausted.', false);
```

The post-admission `budget.reservedUsd` already includes this dispatch; never add `needed` to it a second time or subtract monetary evidence using floating point. No new reservation or counter increment occurs here. The adapter maps this safe local error to `budget/MODEL_SPEND_EXCEEDED/none` rather than implying a persistence failure.

Validate the bound dispatch through its frozen schema; match its user/session/turn with the budget, request user/model/dispatch/decision IDs with the record, and user/model with server configuration. The request deliberately has no client-controlled session/attempt/config/connection revision fields: P6 binds those from its admitted record/snapshot and rechecks current policy through the hook; do not add request properties. Match `request.deadlineAt === budget.deadlineAt`, charged dispatch index, `repairs <= effective.repairs`, and `request.processingPolicyId === binding.processingPolicyId`. `reason: schema-repair` requires request repair provenance, the same `repairedDecisionId` and a charged repair count at least 1. A `provider-retry` of that correction preserves the same repair provenance/instruction without charging a new structural repair; a provider retry of initial/continuation has null repair provenance. Initial/continuation requests themselves have null repair provenance. Preserve the already-charged second correction, and reject a reused port separately in Task 7. When `request.repair` is present, require the final message to be exactly `{role:'system', content: repairInstruction(request.repair.diagnostics)}`; a missing/altered instruction fails before Fetch. P6 reconstructs through P4's builder rather than pasting its own prompt or mutating the prior request. Allow ordinary no-tool text decisions even in this native path.

Require known matching pricing and `.calendar.tools === true`; `.calendar.pricing` and dispatch `.pricing` identify the same approved model/route/version/rates. The native request tools must be a unique, exact subset of `CALENDAR_TOOLS` at revision `google-calendar.v1`, not just matching names; no extra tool/schema metadata is forwarded. Validate native histories and every complete group's argument/result bytes against effective caps. Input bytes/messages/output must also meet the existing smaller configured limits.

Body code after checks:

```typescript
const tools = request.tools.map(t => ({ type: 'function', function: {
  name: t.name, description: t.description, parameters: t.inputSchema,
} }));
return { ...providerParameters(config, request),
  messages: request.messages.map(m => nativeModelMessageSchema.parse(m)),
  ...(tools.length ? { tools } : {}),
  ...(tools.length && limits.calendar?.parallelToolCallsParameter ? { parallel_tool_calls: false } : {}),
  stream: true, stream_options: { include_usage: true } };
```

Do not turn on `strict: true` merely because a catalogue lists structured outputs; optional properties in these frozen schemas may not meet a provider's strict-mode subset. Default `nativeStrict` to false unless exact frozen schemas and the pinned route have independent compatibility evidence. Server validation always remains authoritative. Native tools permit normal automatic text answers without requiring a `tool_choice` capability that is absent from the frozen limits seam.

Extend `loadModelLimits` with one **optional trailing local argument**, after `fetcher`, named `calendarEvidence` with `{ pricing: CalendarTokenPricing; nativeStrict: boolean; parallelToolCallsParameter: boolean }`. With no argument preserve its exact existing text result. With it, require catalogue `supported_parameters` contains `tools`, verify selected-model decimal prompt/completion pricing against the approved frozen pricing snapshot, and publish frozen `.calendar` only when all checks succeed. Unknown/negative/dynamic/NaN/missing prices do not become zero; missing request-fee pricing needs independent evidence in the supplied snapshot. Never invent `providerRoute`, version, rate or a verified-policy claim from a model ID. Unsupported requested capabilities fail Calendar admission without breaking ordinary `loadModelLimits`/text readiness. `parallelToolCallsParameter` and native strict are evidence flags checked against reported support, not inferred from a model name. P8 supplies this evidence later; P4 tests use fixture evidence only.

- [ ] **4. Verify:** `npm test -- test/model/calendar-policy.spec.ts`; `npm test -- test/model/policy.spec.ts`; `npm test -- test/model/catalogue.spec.ts`. Expected: native bounds/privacy cases and existing text/voice-compatible parameter shape pass. No paid POST in catalogue tests. Check exact context/reservation boundaries and smaller limits. No shared contract or package edit.
- [ ] **5. Commit:** explicitly stage the seven named files; `git commit -m "feat(model): admit native Calendar requests with shared budgets and pricing evidence"`.

## Task 5: Bounded fragmented native decision assembly

**Files:** Create `backend/src/model/calendar-stream.ts` and `backend/test/model/calendar-stream.spec.ts`; extend `backend/test/model/calendar-fixtures.ts`.

- [ ] **1. Write failing tests** named `assembles fragmented calls only after native terminal framing`. Fixture-frame generation must use JSON serialization, not embedding invalid SSE JSON by accident:

```typescript
export const nativeFrame = (delta: unknown, finish: string | null = null) =>
  'data: ' + JSON.stringify({ id: 'gen_fixture', model: 'fixture/model', provider: 'Fixture',
    choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n';
export const nativeWire = (args: string, terminal = 'tool_calls') =>
  nativeFrame({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function',
    function: { name: 'calendar_get_event', arguments: args } }] })
  + nativeFrame({}, terminal) + 'data: [DONE]\n\n';
```

Drive the state machine with byte-split SSE from existing `response(text, width)` and `parseSse`: widths 1/2/7/65,536, CRLF splits, multibyte strings, escaped strings split between every character, arguments/name split across frames, absent later IDs, repeated consistent IDs and interleaved index 0/index 1 fragments. Before terminal + `[DONE]`, assert no decision/call escapes. Two interleaved calls remain one rejected batch, not two executable decisions.

```typescript
it('assembles fragmented calls only after native terminal framing', async () => {
  const assembly = new CalendarStreamAssembly(CALENDAR_TOOLS, CALENDAR_LIMITS);
  const wire = nativeFrame({ tool_calls: [{ index: 0, id: 'call_1', type: 'function',
    function: { name: 'calendar_get_', arguments: '{"eventId":' } }] })
    + nativeFrame({ tool_calls: [{ index: 0, function: { name: 'event', arguments: '"abcde"}' } }] })
    + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
  let done = false;
  for await (const frame of parseSse(response(wire, 1).body!)) {
    if (frame.type === 'comment') continue;
    if (frame.data === '[DONE]') { done = true; break; }
    const provisional = assembly.push(JSON.parse(frame.data));
    expect(provisional.text).toBeNull();
    expect('call' in provisional).toBe(false);
  }
  expect(done).toBe(true);
  expect(assembly.finish()).toMatchObject({ kind: 'valid', toolCallId: 'call_1',
    call: { name: 'calendar_get_event', arguments: { eventId: 'abcde' } } });
});
```

Import `CalendarStreamAssembly`, `CALENDAR_TOOLS`, `CALENDAR_LIMITS`, `parseSse`, `response`, and `nativeFrame` from their exact source/fixture paths in this task's file map. This test does not construct an adapter that has not been written yet.

Add stream tables: valid tool terminal; text `stop`; text `length`; call `length`; call with `stop`; missing `finish_reason`; missing `[DONE]`; EOF after finish; malformed JSON frame; invalid UTF8; empty body; unknown terminal; conflicting repeated terminal; late content/tool fragment after terminal; usage-only empty choices; OpenRouter usage chunk with repeated terminal and empty delta; role mismatch; multiple choices; index/ID/type collisions; legacy `function_call`; incomplete envelope with usable terminal; argument bytes overflow; stream/frame/item overflow; reasoning-only frames. An optional absent generation ID must not invalidate an otherwise correctly framed Calendar decision.

- [ ] **2. Run red:** `npm test -- test/model/calendar-stream.spec.ts -t "assembles fragmented calls only after native terminal framing"`.
- [ ] **3. Implement one accumulator with this local API and transition table.** It consumes already-bounded parsed frames and uses Task 2 only at confirmed terminal framing:

```typescript
export class CalendarStreamAssembly {
  constructor(private allowed: readonly (typeof CALENDAR_TOOLS)[number][], private limits: CalendarLimits) {}
  push(raw: unknown): { text: string | null; meaningfulOutput: boolean };
  finish(): { kind: 'text'; content: string; truncated: boolean } | ValidatedCandidate;
}
```

`push` does not expose raw calls. The adapter calls `finish()` **only after** a recognized finish plus `[DONE]`, never on EOF. Store fixed envelope state, bounded visible text, `Map<number, CandidateCall>`, native terminal and flag for safely classifiable malformed envelope. The following rules are the implementation checklist:

| Input/state | Minimal transition |
| --- | --- |
| `choices` absent on a usage frame / `choices: []` | Accounting-only; no output and no terminal change |
| `choices` wrong type, >1 choice, choice index other than 0, wrong role | Provider failure; never structural retry from a broken provider stream |
| `delta.content` string before finish | Bound before append/yield; ordinary text delta stays supported; tool arguments never become content |
| `delta.tool_calls` array | Require finite nonnegative integer indices; append name/argument fragments by index, assign first ID/type, require later repeated IDs/type agree; duplicate ID across different indices flags invalid envelope |
| Malformed native fragment index/ID/type with otherwise usable terminal | Keep bounded unindexed evidence for policy screening, flag structural invalid envelope; never key an array with an unsafe index or invent the missing value |
| Explicit unknown names / forbidden keys in candidate | Preserve for whole-batch policy priority at validation; no eager execution or correction |
| Incomplete name/ID/type or legacy call envelope with usable tool terminal | Bounded structural envelope rejection; no guessed identity/function conversion |
| More than one index | Buffer within existing resource limits to screen all candidates for denial; terminal result is cardinality rejection, never execute index 0 alone |
| Tool argument bytes over effective 16 KiB | Stop immediately with budget failure, abort/cancel stream; do not truncate or repair an aborted runaway stream |
| Recognized finish `stop` / `length` / `tool_calls` | Record once; identical content-free repeated finish accepted for final usage; differing finish is provider failure |
| Any new nonempty content/call fragment after finish | Provider failure, even if terminal repeats |
| `[DONE]` with no recognized finish / EOF without `[DONE]` | Provider/transport failure, no rejection evidence advertising schema repair |
| Confirmed native terminal | Validate entire batch. No calls + `stop`/`length` → text; `tool_calls` without a call → structural envelope rejection |

For fragmented `function.name`, concatenate bounded fragments; do not guess a prefix into a registered name. IDs are stable identifiers, not appended string fragments. Track all retained argument/name/ID metadata against existing `TRANSPORT_LIMITS.streamBytes`, with per-call `argumentBytes`, name maximum 64 and ID maximum 128. Map growth is bounded by the raw 1 MiB stream cap and a retained-byte charge including per-entry overhead; do not allocate an unbounded array indexed by attacker-controlled call index. Do not silently ignore excess calls just because only index 0 can ever execute. Any resource overflow is non-repair budget/provider failure, not a partial executable decision.

Pure text containing JSON, fences or injection-shaped prose stays text: never infer a tool call from it. Mixed content followed by a valid tool call is provisional text plus one native decision, not a second accepted assistant message. Retain ordinary text streaming; P6 decides UI/final transcript publication and does not commit provisional mixed prose as an extra conversation boundary. A rejected decision's prose is not included in the repair request or rejection evidence. Record only `meaningfulOutput` for first-output timing on nonempty visible text or a nonempty native call fragment; comments and reasoning do not defeat first-output timeout.

- [ ] **4. Verify:** `npm test -- test/model/calendar-stream.spec.ts`; `npm test -- test/model/sse.spec.ts`. Expected: all terminal/fragmentation checks pass, ordinary bounded SSE semantics unchanged. For each invalid stream assert `execute` and `repair` spies remain zero unless the stream is completely framed and Task 2 returns repairable structural diagnostics.
- [ ] **5. Commit:** stage the three exact files; `git commit -m "feat(model): assemble bounded native Calendar decisions from SSE"`.

## Task 6: Per-dispatch usage observations without private reasoning

**Files:** Create `backend/src/model/calendar-usage.ts` and `backend/test/model/calendar-usage.spec.ts`.

- [ ] **1. Write failing tests** named `retains cost evidence for every native dispatch outcome`. Test absolute prompt/completion tokens, cache reads/writes, reasoning **counts**, requested/reported model/provider, optional generation/request IDs, first-output/ended times, reported canonical decimal money, missing cost, explicit zero cost, repeated final usage, partial usage, conflicting costs/IDs and invalid counts. Use both terminal formats in Task 5. Every malformed/policy-rejected/length/tool-only/empty-visible-text/provider-error/cancelled case must reach the same observation normalizer and retain its known evidence.

```typescript
it('retains cost evidence for every native dispatch outcome', () => {
  const empty = emptyCalendarObservation();
  const raw = { id: 'gen_fixture', model: 'fixture/model', provider: 'Fixture',
    usage: { prompt_tokens: 12, completion_tokens: 8, cost: 0.00002,
      prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
      completion_tokens_details: { reasoning_tokens: 3 } },
    choices: [{ delta: { reasoning: 'PRIVATE_REASONING_CANARY', reasoning_details: [{ text: 'SECRET' }] } }] };
  const first = mergeCalendarObservation(empty, raw);
  expect(first).toMatchObject({ generationId: 'gen_fixture', promptTokens: 12, completionTokens: 8,
    cachedPromptTokens: 4, cacheWriteTokens: 2, reasoningOutputTokens: 3,
    money: { reportedAmount: '0.00002', costStatus: 'known', source: 'provider-response' } });
  expect(mergeCalendarObservation(first, raw)).toEqual(first);
  expect(JSON.stringify(first)).not.toMatch(/PRIVATE_REASONING_CANARY|SECRET|reasoning_details/);
  expect(empty.money.reportedAmount).toBeNull();
});
```

- [ ] **2. Run red:** `npm test -- test/model/calendar-usage.spec.ts -t "retains cost evidence for every native dispatch outcome"`.
- [ ] **3. Implement pure allowlisted snapshots.** Reuse `number`/`identifier` from existing accounting, `unavailableMoney`, `decimalFromNumber`, `canonicalDecimal` and `moneyEvidenceSchema`. Do not instantiate `AccountingService` or write a legacy one-generation row for Calendar dispatches.

```typescript
export function emptyCalendarObservation(): CalendarDispatchObservation {
  return { reportedModel: null, reportedProvider: null, generationId: null, providerRequestId: null,
    promptTokens: null, completionTokens: null, cachedPromptTokens: null, cacheWriteTokens: null,
    reasoningOutputTokens: null, money: unavailableMoney(true), firstOutputAt: null, endedAt: null };
}
```

Implement `mergeCalendarObservation(previous, raw)` as a whitelist: read only `id`, `model`, `provider`, and documented usage fields from `object(raw)`; validate IDs with bounded primitives, preserve previously known values if omitted, and reject contradictory non-null generation IDs/canonical reported charges. Map counts with `number(value, true)`; invalid/absent counts remain null or retain prior evidence, never default to zero. Merge counts as absolute snapshots, not deltas. Cost `0` is known; absent/negative/NaN/infinite/invalid cost does not become zero. Numeric costs use `decimalFromNumber` under the existing compatibility convention; valid decimal string fixture input uses canonical validation, never floating-point sums. Known monetary evidence has `currency:'USD'`, `source:'provider-response'`, valid `observedAt`, `pricing:null`; unknown/pending evidence uses `unavailableMoney`. Duplicate evidence retains the original observation timestamp.

No spread of `raw`, `delta`, `usage` or provider `error.metadata` into a returned object. Ignore reasoning/reasoning_details/signatures/encrypted reasoning everywhere; do not ask for or replay private reasoning in request history. If a configured route requires persisting private reasoning to continue tool use, its compatibility gate is blocked rather than weakening this rule. Capture only a documented/fixture-proven provider request ID header, validated to the contract bound; absent IDs stay null and do not block terminal acceptance.

The adapter's local hook receives this snapshot on new evidence and once terminally on every dispatched path, with `endedAt` set, including error and consumer iterator return. It is awaited before yielding terminal decision/rejection/failure. P6 binds the dispatch ID in the closure and stores under that ID; duplicate callbacks do not imply another cost. P6 alone settles/retains reservations and reconciles missing evidence; P4 does no invoice estimation, generation-GET retry loop or attempt aggregation.

- [ ] **4. Verify:** `npm test -- test/model/calendar-usage.spec.ts`; `npm test -- test/model/usage-evidence.spec.ts`; `npm test -- test/model/accounting.spec.ts`. Check repeated usage never sums twice; usage-only/error-bearing frames retain evidence before classification, and the serialized callback arguments contain no canaries or provider-body dump.
- [ ] **5. Commit:** stage the two exact files; `git commit -m "feat(model): observe native dispatch usage without reasoning content"`.

## Task 7: One-shot Calendar transport with absolute deadlines and awaited hooks

**Files:** Create `backend/src/model/calendar-adapter.ts` and `backend/test/model/calendar-adapter.spec.ts`; modify `backend/src/model/deadlines.ts`, `backend/src/model/index.ts`, `backend/test/model/deadlines.spec.ts`, and `backend/test/model/calendar-fixtures.ts`.

- [ ] **1. Write failing tests** named `performs one admitted POST and awaits observations before terminal decisions`. The harness factory constructs `OpenRouterCalendarAdapter(config(), calendarLimits, binding, fetcher)`, where `binding.hooks` are mocked promises and Fetch resolves a deterministic SSE response. Assert native body/user/IDs, delayed `beforeDispatch` prevents Fetch until resolved, delayed terminal `onObservation` prevents decision publication, and callback rejection yields only a sanitized `persistence` failure with no executable decision.

Test pre-cancel, cancel while waiting for admission hook, cancel during native argument streaming, cancel during repair, timeout on connect/first output/idle/absolute deadline, blocked headers/body, early iterator return, EOF, content type mismatch, malformed/error frames, callback timeout and one-shot reuse. Hook code must not be able to leak private thrown errors. Test zero Fetch on expired budget, policy mismatch or failed pre-dispatch hook.

In `calendar-fixtures.ts`, `calendarHarness(wire)` returns `{ adapter, binding, fetcher }`: build a fresh `calendarBinding()`, replace its hooks with `vi.fn().mockResolvedValue(undefined)`, inject `vi.fn<typeof fetch>().mockImplementation(async () => response(wire))`, and construct `OpenRouterCalendarAdapter` with those exact values. Never import this adapter in earlier task commits.

```typescript
it('performs one admitted POST and awaits observations before terminal decisions', async () => {
  const h = calendarHarness(nativeWire('{"eventId":"abcde"}'));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  h.binding.hooks.onObservation = vi.fn(async (observation: CalendarDispatchObservation) => { if (observation.endedAt) await gate; });
  // Recreate from the changed binding because production constructors copy it.
  const adapter = new OpenRouterCalendarAdapter(config(), calendarLimits, h.binding, h.fetcher);
  const out: CalendarDecisionChunk[] = [];
  const pending = (async () => { for await (const chunk of adapter.stream(calendarRequest())) out.push(chunk); })();
  await vi.waitFor(() => expect(h.binding.hooks.onObservation).toHaveBeenCalledWith(
    expect.objectContaining({ endedAt: expect.any(String) })));
  expect(out.some(c => c.type === 'decision')).toBe(false);
  release(); await pending;
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(out).toContainEqual(expect.objectContaining({ type: 'decision',
    decision: expect.objectContaining({ kind: 'tool' }) }));
  expect(JSON.parse(String(h.fetcher.mock.calls[0][1]?.body)).user).toBe(config().identity.userId);
});
```

Import the class, `CalendarDecisionChunk`/`CalendarDispatchObservation`, native fixtures and existing `config` helper from the exact paths above. Add the complementary failed/delayed `beforeDispatch` tests before implementing their ordered block.

HTTP 429/503 with well-formed definitive rejection/no generation gets one `provider-rejection` failure, not an internal retry; 401/402/400/413/network ambiguity/malformed error body/generated rejection do not advertise that retry. Every Fetch count for a single port is at most one, including schema-repair requests. Existing text adapter eligible-rejection policy stays intact.

- [ ] **2. Run red:** `npm test -- test/model/calendar-adapter.spec.ts -t "performs one admitted POST and awaits observations before terminal decisions"`.
- [ ] **3. Extend the existing timer constructor without changing old call sites.** Validate the optional deadline before arming timers, expire immediately when the absolute budget is gone, and do not extend it during output/repair:

```typescript
constructor(private budgets: BudgetConfig, private outer: AbortSignal, deadlineAt?: string) {
  const remaining = deadlineAt === undefined ? budgets.totalRunTimeoutMs : Date.parse(deadlineAt) - Date.now();
  if (!Number.isFinite(remaining)) throw new AppError('INVALID_REQUEST', 'The deadline is invalid.', false);
  if (outer.aborted) this.abort();
  else if (remaining <= 0) { this.timedOut = true; this.abort(); }
  else {
    outer.addEventListener('abort', this.abort, { once: true });
    this.arm('total', Math.min(budgets.totalRunTimeoutMs, remaining));
  }
}
```

Run `npm test -- test/model/deadlines.spec.ts` immediately. New fake-clock tests start two model dispatches near the same absolute deadline and show the second gets only the remaining time, not another 180 seconds. Timer/listener counts return to zero. Keep sub-timeouts inside this abort owner's total deadline. Do not put a second total-run clock in each helper.

- [ ] **4. Implement `OpenRouterCalendarAdapter implements CalendarModelPort`.** Constructor copies the bound records/limits; export `createCalendarModelPort(config, modelLimits, binding, fetcher = fetch): CalendarModelPort` from `index.ts`. Preserve every old export/factory. The one-shot lifecycle below defines the implementation, including failure ordering:

```typescript
export class OpenRouterCalendarAdapter implements CalendarModelPort {
  private used = false;
  constructor(private config: ModelConfig, private modelLimits: ModelLimits,
    private binding: CalendarDispatchBinding, private fetcher: typeof fetch = fetch) {}
  stream(request: CalendarDecisionRequest): AsyncGenerator<CalendarDecisionChunk>;
}
```

Implement the generator in these ordered small blocks, keeping the tests red/green per block:

1. Reject reuse before Fetch. Set `used`, build and validate `buildCalendarBody`, construct `RunDeadlines(config.budgets, request.signal, request.deadlineAt)`, initialize `emptyCalendarObservation`, one `CalendarStreamAssembly`, and terminal/result/HTTP flags. If invalid request, cancelled or expired, emit a sanitized failure and never call either Fetch or a paid fallback.
2. Await `beforeDispatch` with `bounded(..., persistenceTimeoutMs, d.signal, 'PERSISTENCE_ERROR')`. This is P6's final durable/current-policy gate, not a P4 store call. Recheck signal/deadline after it. P6 writes pessimistic dispatched evidence at this boundary; a cancellation race is not a claim that charges or writes were prevented. Record `started = true` immediately before Fetch, `d.armConnect()`, then POST only to constant `OPENROUTER_BASE + '/chat/completions'`, `redirect:'error'`, trusted Authorization header, JSON body, `d.signal`. No endpoint from request/model/connection.
3. For non-OK responses, use existing bounded `readJson`, merge any safe generation/usage evidence first, then `providerFault` and `mayRetryRejection(status, parsed, hasGeneration, false)` for the narrow retry classification. Emit at most one failure; P6 later uses existing `retryDelay`/Retry-After handling under its persistent dispatch/deadline/spend limits. Do not sleep/re-POST inside this port and do not silently discard Retry-After requirements: use the existing bounded `retryDelay` calculation before offering an eligible retry, wait that finite delay with `sleep(delay, d.signal)` before returning the retryable failure, and return a non-retry failure if it exceeds policy or deadline. The wait never creates another dispatch; P6 must not apply the same delay twice.
4. On OK require an SSE body/content type. `d.headers()`. Iterate `parseSse(http.body)`: `d.check()`, `d.frame()`; comments count as activity only, do not forward arbitrary provider comments as UI payloads. `[DONE]` requires a recorded recognized terminal; mark `providerEnd` and break. Parse each data JSON frame with bounded native parsing; malformed frame is provider failure. Merge observations **before** inspecting in-band provider errors; await changed observation hooks, then yield the frozen `{ type: 'usage', observation }` chunk. The final ended observation is also awaited/yielded before a terminal decision/rejection/failure; callbacks and usage chunks describe the **same absolute snapshot**, not two charges. Feed only safe envelope/choice fields to the assembly. Nonempty text emits `text-delta`; first meaningful native/text output clears first-output timer and sets observation time. Never yield native call fragments or reasoning.
5. If loop ends without `[DONE]`, fail transport without structural repair. With terminal framing, call `assembly.finish()`. Valid text → `calendarDecisionSchema.parse({kind:'text', decisionId, content, truncated})`. Valid call → the same frozen schema with `kind:'tool'`, validated call/tool ID and terminal `tool_calls`. No execution happens here.
6. For structural rejection build `rejectedDecisionSchema.parse` from the bound record's user/session/turn/attempt/dispatch/decision/index, charged `budget.repairs`, hash/normalized diagnostics and current time. Emit no raw output. After final observation hook, yield `rejected`, then a `failure`: `structural/STRUCTURAL_VALIDATION_FAILED/schema-repair` if `repairs < effective.repairs`, otherwise `budget/REPAIR_EXHAUSTED/none`. P6 additionally refuses repairs when any global dispatch/spend/deadline/permission budget is exhausted; P4 never increments one or loops. For a policy/budget/clarification candidate failure emit only that failure after observation.
7. For provider/timeout/cancel/hook failures, abort upstream, retain IDs/tokens/money already seen, set terminal observation `endedAt`, and await a bounded final hook using a fresh cleanup signal independent of the cancelled inference signal. Cleanup has only the existing `persistenceTimeoutMs`, cannot perform inference or prolong execution; callback failure becomes `persistence/PERSISTENCE_ERROR/none`, not another model request. Do not swallow accounting errors or substitute zero cost. If a final hook already failed, avoid an unbounded repeat; at most one bounded final cleanup attempt.
8. `finally`: abort/cancel the body and dispose timers/listeners. On consumer `return()` before terminal, persist the same bounded ended/pending observation through the hook even though no further chunk is consumed. An observation callback can be repeated idempotently with the same dispatch ID; no success/decision is published before terminal callback succeeds. Do not call `http.body.cancel()` on a still-locked reader; iterator cleanup releases/cancels it as the existing reader does.

Use `calendarFailureSchema` for emitted failures and fixed safe reason codes. Ordinary `AppError` names map to frozen categories (`provider`, `budget`, `cancelled`, `persistence`) without exposing `.message` or raw upstream exceptions. HTTP authentication is provider failure; Google credential failure never originates here. Keep `reason: provider-retry` distinct from `reason: schema-repair` in the bound record and verify both use the configured server `user`.

- [ ] **5. Verify:** `npm test -- test/model/calendar-adapter.spec.ts`; `npm test -- test/model/deadlines.spec.ts`; `npm test -- test/model/adapter.spec.ts`; `npm test -- test/model/catalogue.spec.ts`. Assert one POST maximum, abort before a second dispatch, awaited error/terminal observations, and no unknown provider details in output. Existing text adapter fixtures must remain green with their original retry behavior.
- [ ] **6. Commit:** explicitly stage the six named files; `git commit -m "feat(model): expose one-dispatch Calendar transport with durable observation hooks"`.

## Task 8: Fixture caller proves repair path and turn-wide exhaustion

**Files:** Create `backend/test/model/calendar-repair-flow.spec.ts`; extend only `backend/test/model/calendar-fixtures.ts` if a reusable fixture constructor is needed. Production graph code is outside scope.

- [ ] **1. Write the failing end-to-end boundary assertions.** Use real `createCalendarModelPort`, `rebuildCalendarMessages`, native wire/Fetch and hooks. The test caller is deliberately a tiny **test-only** admission owner, not production retry logic. Its sequence is explicit:

```typescript
const cases = [
  ['malformed then valid', ['{"eventId":', '{"eventId":"abcde"}'], 2, 1],
  ['two-correction exhaustion', ['{"eventId":', '{}', '{"eventId":5}'], 3, 0],
] as const;
it.each(cases)('%s', async (_name, argumentsByDispatch, expectedPosts, expectedExecutions) => {
  const run = await runFixtureTurn(argumentsByDispatch);
  expect(run.posts).toBe(expectedPosts);
  expect(run.execute).toHaveBeenCalledTimes(expectedExecutions);
  expect(run.repairsUsed).toBe(expectedPosts - 1);
  expect(run.bodies.every(b => b.user === config().identity.userId)).toBe(true);
  expect(run.observedDispatchIds.size).toBe(expectedPosts);
  expect(run.bodies.every(b => b.messages.filter(m => m.role === 'user' && m.content === 'Read event abcde').length === 1)).toBe(true);
});
```

`runFixtureTurn` lives in this spec. It creates fresh charged record/request/port instances with monotonically increasing `dispatchIndex`, unique dispatch/decision IDs and `repairs` 0/1/2; records bounded observation callbacks by dispatch ID; records `rejected` evidence; rebuilds messages from the *same* trusted boundary; calls `execute` only on a validated `decision.kind === 'tool'`; and stops on non-schema failure, cancellation, exhausted cap or consumed fixture sequence. It can use an ordinary finite `for` over at most 3 scripted responses: this is not a reusable retry service. Real counter durability/restart verification remains P2/P6.

- [ ] **2. Run red:** `npm test -- test/model/calendar-repair-flow.spec.ts -t "malformed then valid|two-correction exhaustion"`. Expected: assertions fail if malformed decisions leak, a third correction is sent or callback/attribution/provenance is missing.
- [ ] **3. Complete this fixture with the following explicit scenarios.** All checks use the production P4 helpers, never a mock parser/repair builder:

| Scenario | Assertions |
| --- | --- |
| Malformed then valid | Two POSTs, one charged correction, rejected call zero executions, repaired new tool ID executes once, exact goal instruction, hash-only rejection |
| Missing/wrong/extra innocuous fields then valid | Correct fixed path/type diagnostics and same accepted intent; no invented values |
| Three repairable invalid decisions | Initial + exactly two corrections, three observed dispatches, last failure `REPAIR_EXHAUSTED`, zero executions, no fourth POST |
| Already charged second correction | Valid output can execute once; it is not refused merely because repairs equals 2 |
| Persisted repairs 2 / dispatches 8 fixture snapshot | No further correction/provider retry; rebuilding a new port cannot replenish admission |
| Multiple otherwise allowed calls | Entire batch rejected, no index-0 execution; sanitized cardinality repair |
| Extra call contains forbidden/unknown action | Policy refusal, zero corrections and zero executions for the whole batch |
| Prior list or creation executed, later malformed decision | Completed native group appears once in repair history; prior execution spy stays at one; no re-execution for narration repair |
| Repaired call ID/provenance | New dispatch/decision and regenerated native call identity; new decision links rejected decision through request/record, same accepted turn/input; no caller-generated copy of the rejected call |
| Cancel after rejection/before correction | One POST and its terminal cost evidence, zero corrective POSTs/executions |
| Cancel during correction | Initial + admitted correction only; both have final observations; no further correction/tool execution |
| Definitive provider rejection then admitted retry | New `provider-retry` record/port, no repair-counter increment, all POSTs globally charged, user attribution unchanged |
| Definitively rejected correction dispatch then provider retry | Same clean correction instruction/provenance and repair count, a new charged dispatch ID, reason `provider-retry`, no mistaken schema-repair rejection or extra repair increment |
| Broken/truncated transport vs clean `length` | Missing `[DONE]` never repairs/executes; native clean `length` repairs; text clean `length` returns truncated text |
| Plain valid text/clarification | No tool execution/repair, ordinary content preserved and fully observed |
| Injection-shaped arguments/content/result/error/reasoning | Forbidden keys rejected, harmless value text not executed as instructions, raw rejected payload/private reasoning absent from history/evidence/hooks |
| Known/absent/zero/duplicate usage on rejected and successful dispatches | One absolute cost snapshot per dispatch ID, canonical decimals, absent cost not zero, unknown reservation remains P6's responsibility |

For the new-ID test, configure repaired wire `call_2`/`gen_repair` rather than reusing `nativeWire`'s default IDs. Production P4 has no durable cross-port registry; P6 must enforce new logical decision/tool-call identities and link provenance. Do not claim this test proves recovery or execution authorization; the executable spy tests the boundary only, while P5/P6 must test real MCP/durable effects.

- [ ] **4. Verify:** rerun focused flow command and `npm test -- test/model/calendar-repair-flow.spec.ts`. Inspect every outgoing body's message groups with a separate test assertion, not just `assertNativeHistory` itself, to avoid testing the guard with the same buggy guard. Check rejected calls execute zero times, no fabricated/unmatched provider group, user exactly once per dispatch, all usage observed, canary reasoning absent.
- [ ] **5. Commit:** explicitly stage the named spec/fixture files; `git commit -m "test(model): prove bounded Calendar correction and clean provider history"`.

## Task 9: Verification and P6 handoff

**Files:** No new implementation files. Repair observed P4 defects only in the exact owned files above, with a failing regression first. Do not edit state/other plans/evidence runbooks.

- [ ] **1. Run focused boundary suites:** `npm test -- test/model`. Record discovered file/test counts, actual failures and zero-test/skipped cases separately. No test here should require network or MongoDB.
- [ ] **2. Run contract compatibility:** `npm test -- test/contracts`. Frozen contracts are read-only; return any genuine mismatch to P1 rather than loosening a schema locally.
- [ ] **3. Run package verification:** `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`, each as a separate command. Report native e2e skips/prerequisites explicitly; absent isolated MongoDB is not a passing native result. No live/service test is implied. Frontend behavior and assembled P9 acceptance remain downstream, not P4 claims.
- [ ] **4. If any P4-owned defect was corrected,** rerun its focused test and affected full checks, then use a named-file commit `fix(model): close Calendar boundary regression`. If failure is outside ownership, report the exact check/error/owner and leave the dependency gate pending instead of editing it.
- [ ] **5. Return this concrete handoff with implementation hashes and actual checks:**

```text
Exports:
  createCalendarModelPort(config, modelLimits, binding, fetcher?) -> CalendarModelPort
  rebuildCalendarMessages({prefix, acceptedInput, groups}, repair) -> native messages
  repairInstruction(normalizedDiagnostics) -> exact trusted instruction
  estimateCalendarInput(messages, tools) -> conservative input reservation units
Binding:
  dispatch: already persisted/charged CalendarModelDispatch
  budget: already CAS-charged CalendarTurnBudget, original absolute deadline
  limits: effective frozen CalendarLimits (smaller configured limits retained)
  processingPolicyId: server-approved, never model supplied
  hooks.beforeDispatch: awaited P6 durability/current-policy gate
  hooks.onObservation: awaited absolute dispatch snapshots including final failure/return
Output:
  text-delta is provisional; decision is validated structure, not execution authority
  rejected = bounded hash + diagnostics + scope/counter provenance, never raw candidate
  structural/schema-repair versus policy/clarification/provider/budget/cancel/persistence are distinct
  one port == at most one POST; no internal correction or transport retry POST
P6 duties:
  persist rejection, decisions, budgets and reservations under permission/retention rules
  at most 2 corrections / 8 global POSTs per accepted turn across recovery
  pre-admit each dispatch, including eligible provider-rejection retries; no double backoff
  retain existing retryMaxAttempts rejection-chain ceiling as well as the global cap
  preserve accepted input once and only complete previously executed current-turn groups
  recheck permission/intent/connection and invoke P5 only after durable authority
  never replay a completed tool because later narration needed structural correction
  new IDs/provenance per corrected decision; retain unknown costs/reservations, aggregate once
Evidence:
  deterministic fixtures only; live OpenRouter compatibility unrun, not certified
  unified review skipped; native/build/lint/test results reported as actually observed
```

## Completion/acceptance checklist

- [ ] AC04: malformed→valid, strict missing/type/extra validation, decoded duplicate keys, fragmented/interleaved calls, cardinality, terminal/truncation, two-correction exhaustion.
- [ ] AC05: unknown/disabled tools and every forbidden key outrank structural correction; temporal/intent/credential/provider/external/persistence/budget failures are not schema repairs.
- [ ] AC06: native format, matched complete call/result groups, clean last-valid-boundary reconstruction and exactly one accepted user input; no partial decision execution.
- [ ] AC09: attributed server user on every POST; separate per-dispatch IDs/reasons, canonical money/tokens including rejected/cancelled/tool-only output, no fabricated zero or double sums.
- [ ] AC10: shared charged caps, smaller configured limits, original absolute deadline, argument bytes/depth/context/diagnostic limits at exact boundaries; production durable counters remain P6's gate.
- [ ] AC12/AC13: injection-safe diagnostics and repair instructions, no private reasoning/secret/raw candidate persistence, ordinary text tests unchanged; no retention exception is introduced by a provider message/checkpoint helper.
- [ ] All P4 implementation commits and meaningful test output reported; cross-owner blockers explicit; no live compatibility certification, no unified review verdict and no whole-workflow completion claim.

## Planning evidence (not implementation evidence)

This plan was grounded in the committed P1 contract source and the existing model/test flow. Current OpenRouter documentation was consulted through Context7 (`/websites/openrouter_ai`): [API overview](https://openrouter.ai/docs/api_reference/overview) and [streaming](https://openrouter.ai/docs/api_reference/streaming) document native calls, usage token/cost fields, and the content-free final usage chunk that repeats `finish_reason` before `[DONE]`. These references justify fixture shapes, not the actual selected model/provider's compatibility. The worker must test the exact local implementation with deterministic fixtures and report the later service gate unrun.

The plan changes no frozen contract, approved action/transport/scope/budget/retention rule, runtime storage owner or general fixed asset. Planning itself runs only document/path/whitespace/ownership consistency checks; application checks above are worker requirements, not claimed planning passes.

Planning checks on 20 October 2026: exact substantive repair-instruction comparison passed; three local document links resolved; 44 code-fence delimiters balanced; nine task headings present; forbidden-banner/unfinished-marker scan clear. Scope inspection confirms source/test changes are confined to the model owner and this planner's sole deliverable is `plan4.md`. No application suite or external service check was run during planning.
