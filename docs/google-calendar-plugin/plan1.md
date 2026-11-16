# Google Calendar P1: Contracts and Dependency Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. In this MAW assignment, use `executing-plans`, retain P1 ownership, and do not dispatch additional workers. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the narrow, versioned Calendar contracts and reproducible dependencies that let P2, P3, P4 and P5 work independently without changing the approved local-proof scope.

**Architecture:** Add Calendar-specific schemas and ports beside existing text/voice contracts, preserving legacy schemas and adapters. Keep trusted identity, target, credentials, authorization and durable operation authority outside model arguments; expose exactly three tools. Persistence, OAuth, provider parsing, real production MCP handlers, runtime loops, HTTP wiring and UI remain with their assigned owners.

**Tech Stack:** Existing TypeScript/ESM NodeNext, Zod 3.25.76, Vitest; candidate official MCP server/client 2.3.1, reproduced through handler/fetch before freezing. Both npm packages retain Node `^22.22.3 || ^24.15.0 || >=26.0.0`.

## Steps

- [ ] Freeze finite limits, classifications and default-off options.
- [ ] Freeze three strict tool schemas, bounded results and JSON-schema parity.
- [ ] Freeze permission-aware source expiry and legacy archive compatibility.
- [ ] Freeze connection, OAuth-state, identity and credential ports.
- [ ] Freeze operation intent, receipt and reconciliation contracts.
- [ ] Freeze native provider messages, repair and dispatch/accounting seams.
- [ ] Freeze client-safe setup/status/stream contracts with legacy compatibility.
- [ ] Reproduce and pin MCP compatibility, run package checks and publish handoff.

## Authority, boundaries and prerequisites

Read `goal.md`, reconciled `research.md` at `85db0a9bb3587336a96433bc4552326d8418efb4`, and P1/shared-file/acceptance rows in `state.md`. Approval in state supersedes stale approval prose in the goal. The research repair corrects the old 25-result limit, shortened repair prompt, derived-content retention exception, automatic remote revocation, invented event-duration ceiling and optional live gate. Do not restore those mistakes.

P1 owns only `backend/src/contracts/**`, `backend/test/contracts/**`, and package manifests/lockfiles in `backend/` and `frontend/`. This plan adds no source outside those paths. Do not edit `AGENTS.md`, persistence, model, plugin implementation, runtime, frontend source, goal or state. P2 adds guarded collection admission; a contracts-only collection name does not establish fencing. No database, OAuth, Google, OpenRouter, provisioning or deployment action is authorized here. Review is **skipped**, not passed.

Use TDD for each task: add the shown test, observe the named failure, add the minimal shown contract, rerun, then request the orchestrator's serialized commit turn. All `npm` commands below run from the indicated package directory, never the repository root. Git commands run from the repository root. Never stage unrelated work. Omit generated directories, environment files and `.openchamber/`.

The code snippets contain complete additions/replacements for the named code sections; preserve surrounding existing code. New numeric/string bounds below are representation/parser bounds, not additional Calendar action restrictions. In particular, creation has **no new duration cap**. Actual temporal/intent/target semantics belong to P5/P6; P1 freezes their inputs and error classifications, not their implementation.

## File map

| Path | Responsibility |
| --- | --- |
| `backend/src/contracts/calendar-policy.ts` | Fixed identity/scope/transport constants; limits; failure categories; default-off options |
| `backend/src/contracts/calendar-tools.ts` | Three allowlisted input/result schemas and model/MCP JSON definitions |
| `backend/src/contracts/calendar-sources.ts` | Source permissions, expiry references and permitted durable result variants |
| `backend/src/contracts/calendar-connections.ts` | Encrypted connection/OAuth records and P2/P3/P5 ports |
| `backend/src/contracts/calendar-operations.ts` | Canonical action, operation states/events, receipt, binding and execution ports |
| `backend/src/contracts/calendar-accounting.ts` | Decimal reservation evidence, durable per-turn budgets and dispatch/aggregate ports |
| `backend/src/contracts/calendar-model.ts` | Native complete message groups, candidates, repair diagnostics and P4/P6 model seam |
| `backend/src/contracts/calendar-wire.ts` | Safe setup/status/operation snapshots and separate v2 stream schema |
| `backend/src/contracts/calendar-mcp-schema.ts` | Small, tested Zod-3/SDK Standard Schema bridge |
| `backend/src/contracts/{collections,message,api,runtime,config-runtime,index}.ts` | Additive exports/fields only; no legacy version reinterpretation |
| `backend/test/contracts/calendar-*.spec.ts` | Deterministic contract, port, compatibility and dependency-freeze checks |
| `backend/package.json`, `backend/package-lock.json` | Two exact MCP direct pins, verified peers/transitives |
| `frontend/package.json`, `frontend/package-lock.json` | Inspect/verify only; no new frontend dependency is justified |

## Task 1: Finite policy and default-off configuration

**Files:** create `backend/src/contracts/calendar-policy.ts`; create `backend/test/contracts/calendar-policy.spec.ts`.

- [ ] **1. Write this failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { CALENDAR_LIMITS, calendarLimitsSchema, calendarOptionsSchema,
  calendarFailureSchema, CALENDAR_SCOPES } from '../../src/contracts/calendar-policy.js';

describe('Calendar proof policy', () => {
  it('freezes approved finite ceilings and starts disabled', () => {
    expect(CALENDAR_LIMITS).toEqual({ modelDispatches: 8, repairs: 2, logicalTools: 6,
      creates: 1, calendarRequests: 20, refreshRequests: 2, deliveryRetries: 2,
      eventsPerResult: 20, listDays: 31, argumentBytes: 16384, resultBytes: 16384,
      diagnosticCount: 10, diagnosticChars: 2048, toolTimeoutMs: 20000,
      modelSpendUsd: '1', sourceLifetimeMs: 86400000, auditLifetimeMs: 2592000000,
      oauthStateMs: 600000, jsonDepth: 8 });
    expect(calendarOptionsSchema.parse({}).enabled).toBe(false);
    expect(CALENDAR_SCOPES).toHaveLength(3);
    for (const [key, value] of Object.entries(CALENDAR_LIMITS)) {
      if (typeof value === 'number') {
        expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, [key]: value + 1 }).success).toBe(false);
        expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, [key]: -1 }).success).toBe(false);
      }
    }
    expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, modelSpendUsd: '1.01' }).success).toBe(false);
    expect(calendarOptionsSchema.safeParse({ endpoint: 'https://evil.invalid' }).success).toBe(false);
  });
  it('keeps structural, policy, semantic, transport and uncertain outcomes distinct', () => {
    for (const category of ['structural', 'policy', 'clarification', 'provider', 'credential',
      'delivery', 'uncertain', 'persistence', 'budget', 'cancelled'] as const) {
      const value = calendarFailureSchema.parse({ category, code: 'STOPPED', retry: 'none' });
      expect(value.category).toBe(category);
    }
    expect(calendarFailureSchema.safeParse({ category: 'policy', code: 'DENIED', retry: 'schema-repair' }).success).toBe(false);
  });
});
```

- [ ] **2. Run red from `backend/`:** `npm test -- test/contracts/calendar-policy.spec.ts -t "Calendar proof policy"`. Expected: unresolved `calendar-policy.js`; no passing substitute.
- [ ] **3. Add this implementation.**

```ts
import { z } from 'zod';
import { decimalSchema } from './usage-evidence.js';

export const CALENDAR_SCHEMA_VERSION = 1 as const;
export const CALENDAR_PLUGIN_ID = 'google-calendar' as const;
export const CALENDAR_TOOL_REVISION = 'google-calendar.v1' as const;
export const CALENDAR_MCP_WIRE = '2026-07-28' as const;
export const CALENDAR_SCOPES = ['openid', 'email',
  'https://www.googleapis.com/auth/calendar.events.owned'] as const;
export const CALENDAR_LIMITS = Object.freeze({ modelDispatches: 8, repairs: 2,
  logicalTools: 6, creates: 1, calendarRequests: 20, refreshRequests: 2,
  deliveryRetries: 2, eventsPerResult: 20, listDays: 31, argumentBytes: 16384,
  resultBytes: 16384, diagnosticCount: 10, diagnosticChars: 2048,
  toolTimeoutMs: 20000, modelSpendUsd: '1', sourceLifetimeMs: 86400000,
  auditLifetimeMs: 2592000000, oauthStateMs: 600000, jsonDepth: 8 });
const cap = (maximum: number) => z.number().int().positive().max(maximum);
export const calendarLimitsSchema = z.object({
  modelDispatches: cap(8), repairs: z.number().int().min(0).max(2), logicalTools: cap(6),
  creates: z.literal(1), calendarRequests: cap(20), refreshRequests: cap(2),
  deliveryRetries: z.number().int().min(0).max(2), eventsPerResult: cap(20), listDays: cap(31),
  argumentBytes: cap(16384), resultBytes: cap(16384), diagnosticCount: cap(10),
  diagnosticChars: cap(2048), toolTimeoutMs: cap(20000),
  modelSpendUsd: decimalSchema.refine(v => v === '1' || v.startsWith('0.')),
  sourceLifetimeMs: cap(86400000), auditLifetimeMs: cap(2592000000),
  oauthStateMs: cap(600000), jsonDepth: cap(8),
}).strict();
export type CalendarLimits = z.infer<typeof calendarLimitsSchema>;
export const calendarOptionsSchema = z.object({ enabled: z.boolean().default(false),
  limits: calendarLimitsSchema.default(CALENDAR_LIMITS),
  processingPolicyId: z.string().min(1).max(128).nullable().default(null),
}).strict();
export type CalendarOptions = z.infer<typeof calendarOptionsSchema>;
export const calendarFailureSchema = z.object({
  category: z.enum(['structural', 'policy', 'clarification', 'provider', 'credential',
    'delivery', 'uncertain', 'persistence', 'budget', 'cancelled']),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  retry: z.enum(['none', 'schema-repair', 'provider-rejection', 'delivery-same-id', 'readback']),
}).strict().superRefine((v, ctx) => {
  const allowed = v.retry === 'none'
    || (v.retry === 'schema-repair' && v.category === 'structural')
    || (v.retry === 'provider-rejection' && v.category === 'provider')
    || (v.retry === 'delivery-same-id' && v.category === 'delivery')
    || (v.retry === 'readback' && v.category === 'uncertain');
  if (!allowed) ctx.addIssue({ code: 'custom', message: 'Retry category mismatch.' });
});
export type CalendarFailure = z.infer<typeof calendarFailureSchema>;
```

The canonical-decimal spend ceiling accepts `(0,1]` without floating-point comparison; Task 6 uses exact decimal arithmetic for monetary admission. Keep `totalRunTimeoutMs` in existing `BudgetConfig`, default 180000; do not create a second/resetting deadline. P6 takes the minimum remaining configured deadline and tool timeout, enforces smaller context/output/document limits, and counts provider retries inside eight dispatches. `jsonDepth=8` bounds hostile JSON scanning, not event duration/semantics. A smaller `repairs=0` or `deliveryRetries=0` disables that retry class, never increases another budget.

- [ ] **4. Rerun the focused command.** Expected: both tests pass; run `npm run build` in `backend/`.
- [ ] **5. Commit named files:** `git add -- backend/src/contracts/calendar-policy.ts backend/test/contracts/calendar-policy.spec.ts`; then `git commit -m "feat(calendar): freeze proof limits and failure categories"`.

## Task 2: Strict three-tool catalogue and bounded results

**Files:** create `backend/src/contracts/calendar-tools.ts`; create `backend/test/contracts/calendar-tools.spec.ts`.

Mapping: the approved user-facing title maps to model/API field `summary`; date fields are `start`, `end`, `timeZone`; list fields are `timeMin`, `timeMax`, optional `pageToken`, required `maxResults`. Do not introduce model arguments for calendar, identity, credentials, event IDs on create, invitations or endpoint URLs. String bounds are summary 200, description 2000, location 500, timestamp 96, timezone 100, event ID 1024 and cursor 2048 characters, always within raw UTF-8 caps. P5 must validate calendar cursors as opaque server-bound continuations, not executable URLs. An explicitly empty optional field is allowed; absence never changes permissions.

- [ ] **1. Write this failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CALENDAR_TOOLS, calendarInputSchemas, calendarResultSchema,
  forbiddenCalendarKeys, jsonBytes } from '../../src/contracts/calendar-tools.js';

const create = { summary: 'Visit', start: '2026-10-21T10:00:00+01:00',
  end: '2026-10-21T11:00:00+01:00', timeZone: 'Europe/London' };
describe('strict Calendar catalogue', () => {
  it('has exactly three versioned tools with strict matching field definitions', () => {
    expect(CALENDAR_TOOLS.map(t => t.name)).toEqual([
      'calendar_list_events', 'calendar_get_event', 'calendar_create_event']);
    for (const t of CALENDAR_TOOLS) {
      expect(t.revision).toBe('google-calendar.v1');
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(Object.keys(t.inputSchema.properties)).toEqual(Object.keys(calendarInputSchemas[t.name].shape));
      const shape: Record<string, z.ZodTypeAny> = calendarInputSchemas[t.name].shape;
      for (const [key, rawProperty] of Object.entries(t.inputSchema.properties)) {
        const property: Record<string, unknown> = rawProperty;
        expect(shape[key].isOptional()).toBe(!t.inputSchema.required.includes(key));
        if (property.type === 'string') {
          const min = Number(property.minLength), max = Number(property.maxLength);
          expect(shape[key].safeParse('x'.repeat(min)).success).toBe(true);
          expect(shape[key].safeParse('x'.repeat(max)).success).toBe(true);
          expect(shape[key].safeParse('x'.repeat(max + 1)).success).toBe(false);
          if (min > 0) expect(shape[key].safeParse('').success).toBe(false);
        } else {
          expect(shape[key].safeParse(property.minimum).success).toBe(true);
          expect(shape[key].safeParse(property.maximum).success).toBe(true);
          expect(shape[key].safeParse(Number(property.maximum) + 1).success).toBe(false);
        }
      }
    }
    expect(calendarInputSchemas.calendar_create_event.parse(create)).toEqual(create);
    for (const key of forbiddenCalendarKeys) {
      expect(calendarInputSchemas.calendar_create_event.safeParse({ ...create, [key]: 'override' }).success).toBe(false);
    }
    expect(calendarInputSchemas.calendar_create_event.safeParse({ ...create, extraLabel: 'x' }).success).toBe(false);
    expect(calendarInputSchemas.calendar_create_event.safeParse({ ...create, summary: 'x'.repeat(201) }).success).toBe(false);
    expect(calendarInputSchemas.calendar_create_event.safeParse({ ...create, description: 'x'.repeat(2001) }).success).toBe(false);
    expect(calendarInputSchemas.calendar_create_event.safeParse({ ...create, location: 'x'.repeat(501) }).success).toBe(false);
    const list = { timeMin: create.start, timeMax: create.end, maxResults: 20 };
    expect(calendarInputSchemas.calendar_list_events.safeParse(list).success).toBe(true);
    for (const maxResults of [0, 21, 1.5, '20']) {
      expect(calendarInputSchemas.calendar_list_events.safeParse({ ...list, maxResults }).success).toBe(false);
    }
  });
  it('bounds UTF-8 results, projection fields and list cardinality', () => {
    const event = { eventId: 'abcde', summary: 'Visit', start: create.start, end: create.end,
      timeZone: create.timeZone, status: 'confirmed', htmlLink: null };
    const result = { tool: 'calendar_list_events', events: Array.from({ length: 20 }, () => event),
      nextPageToken: null, truncated: false };
    expect(calendarResultSchema.safeParse(result).success).toBe(true);
    expect(calendarResultSchema.safeParse({ ...result, events: [...result.events, event] }).success).toBe(false);
    expect(calendarResultSchema.safeParse({ tool: 'calendar_get_event', event: { ...event, accessToken: 'secret' } }).success).toBe(false);
    const exact = { ...result, events: result.events.map(e => ({ ...e, description: '' })) };
    let remaining = 16384 - jsonBytes(exact);
    for (const projected of exact.events) {
      const fill = Math.min(2000, remaining); projected.description = 'x'.repeat(fill); remaining -= fill;
    }
    expect(remaining).toBe(0); expect(jsonBytes(exact)).toBe(16384);
    expect(calendarResultSchema.safeParse(exact).success).toBe(true);
    exact.events.find(e => e.description.length < 2000)!.description += 'x';
    expect(calendarResultSchema.safeParse(exact).success).toBe(false);
    const large = { ...result, events: result.events.map(e => ({ ...e, description: 'é'.repeat(2000) })) };
    expect(jsonBytes(large)).toBeGreaterThan(16384);
    expect(calendarResultSchema.safeParse(large).success).toBe(false);
  });
});
```

- [ ] **2. Run red from `backend/`:** `npm test -- test/contracts/calendar-tools.spec.ts -t "strict Calendar catalogue"`. Expected: missing module.
- [ ] **3. Implement the following complete module.**

```ts
import { z } from 'zod';
import { CALENDAR_TOOL_REVISION } from './calendar-policy.js';

export const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
const text = (max: number, min = 1) => z.string().min(min).max(max);
const timestamp = text(96);
const zone = text(100);
export const calendarInputSchemas = {
  calendar_list_events: z.object({ timeMin: timestamp, timeMax: timestamp,
    maxResults: z.number().int().min(1).max(20), pageToken: text(2048).optional() }).strict(),
  calendar_get_event: z.object({ eventId: text(1024) }).strict(),
  calendar_create_event: z.object({ summary: text(200), start: timestamp, end: timestamp,
    timeZone: zone, description: text(2000, 0).optional(), location: text(500, 0).optional() }).strict(),
} as const;
export type CalendarToolName = keyof typeof calendarInputSchemas;
export const calendarToolNameSchema = z.enum([
  'calendar_list_events', 'calendar_get_event', 'calendar_create_event']);
export type CalendarCreateInput = z.infer<typeof calendarInputSchemas.calendar_create_event>;
export const forbiddenCalendarKeys = ['attendees', 'sendUpdates', 'sendNotifications',
  'recurrence', 'attachments', 'conferenceData', 'reminders', 'visibility', 'transparency',
  'guestsCanModify', 'guestsCanInviteOthers', 'guestsCanSeeOtherGuests', 'anyoneCanAddSelf',
  'organizer', 'creator', 'iCalUID', 'id', 'date', 'userId', 'calendarId', 'accountId',
  'connectionId', 'connectionRevision', 'accessToken', 'refreshToken', 'authorization',
  'headers', '_meta', 'endpoint', 'url', 'model', 'modelId', 'allDay', 'eventType',
  'privateCopy', 'extendedProperties', 'endTimeUnspecified', 'apiKey', 'clientSecret',
  'codeVerifier', 'credentialVersion', 'targetRevision'] as const;
const stringProperty = (maxLength: number, minLength = 1) => ({ type: 'string' as const, minLength, maxLength });
const definitions = [
  { name: 'calendar_list_events' as const, description: 'List timed events in an explicit bounded range.',
    required: ['timeMin', 'timeMax', 'maxResults'], properties: {
      timeMin: stringProperty(96), timeMax: stringProperty(96),
      maxResults: { type: 'integer', minimum: 1, maximum: 20 }, pageToken: stringProperty(2048) } },
  { name: 'calendar_get_event' as const, description: 'Read one known event on the configured owned calendar.',
    required: ['eventId'], properties: { eventId: stringProperty(1024) } },
  { name: 'calendar_create_event' as const, description: 'Create one ordinary timed event without invitations.',
    required: ['summary', 'start', 'end', 'timeZone'], properties: { summary: stringProperty(200),
      start: stringProperty(96), end: stringProperty(96), timeZone: stringProperty(100),
      description: stringProperty(2000, 0), location: stringProperty(500, 0) } },
];
export const CALENDAR_TOOLS = definitions.map(({ name, description, required, properties }) => ({
  name, description, revision: CALENDAR_TOOL_REVISION,
  inputSchema: { type: 'object' as const, additionalProperties: false as const, required, properties },
}));
export const calendarEventSchema = z.object({ eventId: text(1024), summary: text(200, 0),
  start: timestamp, end: timestamp, timeZone: zone,
  status: z.enum(['confirmed', 'tentative', 'cancelled']),
  htmlLink: text(2048).nullable(), description: text(2000, 0).optional(), location: text(500, 0).optional(),
}).strict();
export const calendarResultSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('calendar_list_events'), events: z.array(calendarEventSchema).max(20),
    nextPageToken: text(2048).nullable(), truncated: z.boolean() }).strict(),
  z.object({ tool: z.literal('calendar_get_event'), event: calendarEventSchema }).strict(),
  z.object({ tool: z.literal('calendar_create_event'), event: calendarEventSchema }).strict(),
]).superRefine((v, ctx) => {
  if (jsonBytes(v) > 16384) ctx.addIssue({ code: 'custom', message: 'Tool result exceeds UTF-8 byte limit.' });
});
export type CalendarResult = z.infer<typeof calendarResultSchema>;
export const calendarCallSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('calendar_list_events'), arguments: calendarInputSchemas.calendar_list_events }).strict(),
  z.object({ name: z.literal('calendar_get_event'), arguments: calendarInputSchemas.calendar_get_event }).strict(),
  z.object({ name: z.literal('calendar_create_event'), arguments: calendarInputSchemas.calendar_create_event }).strict(),
]).superRefine((v, ctx) => {
  if (jsonBytes(v.arguments) > 16384) ctx.addIssue({ code: 'custom', message: 'Arguments exceed UTF-8 byte limit.' });
});
export type CalendarCall = z.infer<typeof calendarCallSchema>;
```

These schemas deliberately do not parse relative dates, accept invitations or authorize a target. P4 screens forbidden keys recursively before classifying generic schema errors and also enforces the **raw** 16384-byte cap before JSON parsing. P5 validates strict RFC3339/offset/IANA/DST semantics and end-after-start, range <=31 days, safe Google links, bounded pagination and target binding. Invalid dates needing user clarification are not schema repair. Results are a minimized projection, not the original Google response. P5 reports unsupported/all-day fetched shapes without inventing timed values; explicit truncation/pagination must describe omitted content. Oversized results fail or return a deliberately bounded projection with limit evidence, never silent truncation.

- [ ] **4. Run green:** the focused command above, then `npm run build` in `backend/`.
- [ ] **5. Commit:** stage only these two task paths; `git commit -m "feat(calendar): define strict three-tool catalogue and bounded projections"`.

## Task 3: Source permission, expiry and additive archive compatibility

**Files:** create `backend/src/contracts/calendar-sources.ts`; create `backend/test/contracts/calendar-sources.spec.ts`; modify `backend/src/contracts/message.ts` only by an import and optional field.

- [ ] **1. Write this failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { sourceReferenceSchema, persistedCalendarResultSchema, calendarToolResultRecordSchema, effectiveSourceExpiry,
  CALENDAR_TOMBSTONE } from '../../src/contracts/calendar-sources.js';
import { messageRecordSchema } from '../../src/contracts/message.js';
const now = '2026-10-20T10:00:00.000Z';
const ref = { schemaVersion: 1, sourceId: 'src_1', plugin: 'google-calendar', connectionId: 'con_1',
  connectionRevision: 1, operationIds: ['op_1'], fetchedAt: now,
  expiresAt: '2026-10-20T10:01:00.000Z', redactedAt: null,
  permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'approved_1' } };
describe('Calendar source permission', () => {
  it('uses the strictest absolute expiry without a derived-content exception', () => {
    expect(effectiveSourceExpiry(now, [Date.parse(now) + 60000], true)).toBe(ref.expiresAt);
    expect(effectiveSourceExpiry(now, [], false)).toBe(now);
    expect(effectiveSourceExpiry(now, [Date.parse(now)], true)).toBe(now);
    expect(sourceReferenceSchema.safeParse({ ...ref, expiresAt: '2026-10-22T10:00:00.000Z' }).success).toBe(false);
    expect(sourceReferenceSchema.safeParse({ ...ref, operationIds: Array(7).fill('op') }).success).toBe(false);
  });
  it('never makes volatile result bodies durable and preserves legacy messages', () => {
    const volatile = { ...ref, expiresAt: now, permission: { content: 'volatile',
      minimalEvidenceAllowed: true, policyId: 'pending' } };
    expect(persistedCalendarResultSchema.safeParse({ storage: 'reference', source: volatile,
      toolCallId: 'call_1', operationId: 'op_1', outcome: 'ok' }).success).toBe(true);
    expect(persistedCalendarResultSchema.safeParse({ storage: 'reference', source: volatile,
      toolCallId: 'call_1', operationId: 'op_1', outcome: 'ok', rawBody: 'secret' }).success).toBe(false);
    expect(calendarToolResultRecordSchema.safeParse({ schemaVersion: 1, kind: 'calendar-tool-result',
      userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', eventId: 'e', sequence: 2,
      toolCallId: 'call_1', createdAt: now, resultRef: { storage: 'reference', source: volatile,
        toolCallId: 'wrong', operationId: 'op_1', outcome: 'ok' } }).success).toBe(false);
    const legacy = { schemaVersion: 1, userId: 'u', sessionId: 's', turnId: 't', messageId: 'm',
      eventId: 'e', sequence: 1, role: 'assistant', content: 'Hello', createdAt: now,
      completionStatus: 'completed', attemptId: 'a', truncated: false };
    expect(messageRecordSchema.parse(legacy)).toEqual(legacy);
    expect(messageRecordSchema.parse({ ...legacy, content: CALENDAR_TOMBSTONE,
      sourceProvenance: [volatile] }).messageId).toBe('m');
  });
});
```

- [ ] **2. Run red in `backend/`:** `npm test -- test/contracts/calendar-sources.spec.ts -t "Calendar source permission"`. Expected: missing module; optional archive field not yet supported.
- [ ] **3. Add this source module.**

```ts
import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { calendarResultSchema } from './calendar-tools.js';

export const CALENDAR_TOMBSTONE = '[Google Calendar details expired or disconnected]';
export function effectiveSourceExpiry(fetchedAt: string, deadlines: readonly number[], permitted: boolean): string {
  const start = Date.parse(isoDateSchema.parse(fetchedAt));
  if (!deadlines.every(Number.isFinite)) throw new Error('Invalid source deadline.');
  return new Date(permitted ? Math.min(start + 86400000, ...deadlines) : start).toISOString();
}
export const sourcePermissionSchema = z.object({ content: z.enum(['volatile', 'retained']),
  minimalEvidenceAllowed: z.boolean(), policyId: idSchema }).strict();
export const sourceReferenceSchema = z.object({ schemaVersion: z.literal(1),
  sourceId: idSchema, plugin: z.literal('google-calendar'), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), operationIds: z.array(idSchema).min(1).max(6),
  fetchedAt: isoDateSchema, expiresAt: isoDateSchema, redactedAt: isoDateSchema.nullable(),
  permission: sourcePermissionSchema,
}).strict().superRefine((v, ctx) => {
  const lifetime = Date.parse(v.expiresAt) - Date.parse(v.fetchedAt);
  if (lifetime > 86400000 || (v.permission.content === 'volatile' && lifetime > 0))
    ctx.addIssue({ code: 'custom', message: 'Source lifetime exceeds permission.' });
});
export type CalendarSourceReference = z.infer<typeof sourceReferenceSchema>;
export const persistedCalendarResultSchema = z.discriminatedUnion('storage', [
  z.object({ storage: z.literal('reference'), source: sourceReferenceSchema,
    toolCallId: idSchema, operationId: idSchema, outcome: z.enum(['ok', 'error', 'unknown']) }).strict(),
  z.object({ storage: z.literal('retained'), source: sourceReferenceSchema,
    toolCallId: idSchema, operationId: idSchema, result: calendarResultSchema }).strict(),
  z.object({ storage: z.literal('tombstone'), source: sourceReferenceSchema,
    toolCallId: idSchema, operationId: idSchema, reason: z.enum(['expired', 'disconnected', 'not-permitted']) }).strict(),
]).superRefine((v, ctx) => {
  if (!v.source.permission.minimalEvidenceAllowed || !v.source.operationIds.includes(v.operationId)
    || (v.storage === 'retained' && (v.source.permission.content !== 'retained'
      || Date.parse(v.source.expiresAt) <= Date.parse(v.source.fetchedAt))))
    ctx.addIssue({ code: 'custom', message: 'Durable evidence is not permitted.' });
});
export type PersistedCalendarResult = z.infer<typeof persistedCalendarResultSchema>;
export const calendarToolResultRecordSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-tool-result'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema,
  decisionId: idSchema, eventId: idSchema, sequence: z.number().int().nonnegative(),
  toolCallId: idSchema, createdAt: isoDateSchema, resultRef: persistedCalendarResultSchema,
}).strict().refine(v => v.toolCallId === v.resultRef.toolCallId);
export type CalendarToolResultRecord = z.infer<typeof calendarToolResultRecordSchema>;
export interface CalendarResultStore {
  put(record: CalendarToolResultRecord): Promise<void>;
  get(userId: string, sessionId: string, toolCallId: string): Promise<CalendarToolResultRecord | null>;
}
```

In `message.ts`, add:

```ts
import { sourceReferenceSchema } from './calendar-sources.js';
```

Inside the existing strict `messageRecordSchema` object, add:

```ts
sourceProvenance: z.array(sourceReferenceSchema).min(1).max(6).optional(),
```

`permission.content=volatile` permits only an independently permitted reference/tombstone, not durable derived message text. P2/P6 enforce this at write/read boundaries; this optional field alone is not enforcement. No raw Google bodies enter checkpoints. P2 must reject `minimalEvidenceAllowed=false` rather than erase dedup authority. P6 supplies the earliest header, source and policy deadlines to `effectiveSourceExpiry`; a refetch/derivation cannot renew an existing copy. P2 owns owner-fenced cleanup and preserved IDs/sequences; P8 owns backup/restore runbooks. No TTL is admitted here.

- [ ] **4. Run green** using the focused command; also `npm test -- src/contracts/archive.spec.ts` from `backend/` to preserve legacy fixtures.
- [ ] **5. Commit:** stage the three named task files; `git commit -m "feat(calendar): define source expiry and compatible archive provenance"`.

## Task 4: Trusted connection, OAuth-state and credential ports

**Files:** create `backend/src/contracts/calendar-connections.ts`; create `backend/test/contracts/calendar-connections.spec.ts`; add one collection entry to `backend/src/contracts/collections.ts`.

The native built-ins remain the proposed OAuth/security implementation: `fetch`, `node:crypto` PKCE S256 and RSA-SHA256 verification using fixed Google JWKS. P3 must verify signature/key selection, issuer, audience/authorized party, expiry/issued-at, subject and requested nonce under the supported Google OIDC flow; **decoding alone is forbidden**. No general JWT/remote-issuer abstraction or Google API client package is justified by this contract. If P3 cannot establish the supported flow with built-ins, return the exact dependency/security requirement to P1 before implementing; do not silently weaken verification. This is an explicit P3 execution gate, not a declaration that real OIDC compatibility passed.

- [ ] **1. Write this failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { connectionRecordSchema, oauthStateSchema, type CalendarConnectionStore,
  type CalendarCredentialPort, type GoogleIdentityPort } from '../../src/contracts/calendar-connections.js';
import { COLLECTIONS } from '../../src/contracts/collections.js';
const at = '2026-10-20T10:00:00.000Z';
const record = { schemaVersion: 1, userId: 'u', provider: 'google-calendar', connectionId: 'c',
  revision: 1, connectionRevision: 1, credentialVersion: 1, googleSubjectId: 'sub', accountEmail: null,
  calendarId: 'disposable@group.calendar.google.com', targetRevision: 1, enabled: false,
  status: 'disconnected', credentials: null, tokenExpiresAt: null, grantedScopes: [], updatedAt: at };
describe('Calendar connection handoff', () => {
  it('keeps encrypted bounded records separate from singleton config', () => {
    expect(COLLECTIONS.integrationConnections).toBe('integration_connections');
    expect(connectionRecordSchema.parse(record).status).toBe('disconnected');
    expect(connectionRecordSchema.safeParse({ ...record, accessToken: 'raw' }).success).toBe(false);
    expect(connectionRecordSchema.safeParse({ ...record, status: 'connected' }).success).toBe(false);
    const state = { schemaVersion: 1, kind: 'calendar-oauth-state', userId: 'u',
      stateHash: 'a'.repeat(64), browserHash: 'b'.repeat(64), oidcNonceHash: 'c'.repeat(64),
      encryptedVerifier: { version: 1, iv: 'i', tag: 't', ciphertext: 'cipher' },
      redirectUri: 'http://localhost:5173/api/plugins/google-calendar/oauth/callback',
      createdAt: at, expiresAt: '2026-10-20T10:10:00.000Z', consumedAt: null };
    expect(oauthStateSchema.safeParse(state).success).toBe(true);
    expect(oauthStateSchema.safeParse({ ...state, expiresAt: '2026-10-20T10:10:00.001Z' }).success).toBe(false);
    expect(oauthStateSchema.safeParse({ ...state, verifier: 'raw' }).success).toBe(false);
  });
  it('allows independent implementations without another persistence owner', async () => {
    const store: CalendarConnectionStore = { get: async () => null,
      create: async r => ({ outcome: 'confirmed', record: r }),
      compareAndSwap: async (_u, _r, next) => ({ outcome: 'confirmed', record: next }),
      putState: async () => undefined, consumeState: async () => null };
    const credentials: CalendarCredentialPort = { withAccessToken: async () => { throw new Error('Reconnect required'); } };
    const identity: GoogleIdentityPort = { verify: async () => ({ subject: 'verified-sub', email: null }) };
    expect(await store.get('u')).toBeNull();
    expect(await identity.verify({ idToken: 'fixture-only', clientId: 'client',
      expectedNonceHash: 'c'.repeat(64), now: at, signal: new AbortController().signal })).toEqual({ subject: 'verified-sub', email: null });
    expect(credentials.withAccessToken).toBeTypeOf('function');
  });
});
```

- [ ] **2. Run red in `backend/`:** `npm test -- test/contracts/calendar-connections.spec.ts -t "Calendar connection handoff"`. Expected: missing module and collection entry.
- [ ] **3. Implement the module.**

```ts
import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { CALENDAR_SCOPES } from './calendar-policy.js';

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const encryptedCalendarSecretSchema = z.object({ version: z.literal(1),
  iv: z.string().min(1).max(64), tag: z.string().min(1).max(64),
  ciphertext: z.string().min(1).max(16384) }).strict();
export type EncryptedCalendarSecret = z.infer<typeof encryptedCalendarSecretSchema>;
export const calendarCredentialAadSchema = z.object({ version: z.literal(1), userId: idSchema,
  provider: z.literal('google-calendar'), connectionId: idSchema,
  credentialVersion: z.number().int().positive(), googleSubjectId: z.string().min(1).max(255),
  tokenKind: z.enum(['access', 'refresh']) }).strict();
export const loopbackRedirectSchema = z.string().max(2048).url().refine(value => {
  const u = new URL(value);
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    && !u.username && !u.password && !u.search && !u.hash
    && u.pathname === '/api/plugins/google-calendar/oauth/callback';
});
export const calendarOAuthOptionsSchema = z.object({ clientId: z.string().min(1).max(500),
  redirectUri: loopbackRedirectSchema, targetCalendarId: z.string().min(1).max(1024),
}).strict();
export const connectionRecordSchema = z.object({ schemaVersion: z.literal(1), userId: idSchema,
  provider: z.literal('google-calendar'), connectionId: idSchema,
  revision: z.number().int().positive(), connectionRevision: z.number().int().positive(),
  credentialVersion: z.number().int().positive(),
  googleSubjectId: z.string().min(1).max(255), accountEmail: z.string().email().max(320).nullable(),
  calendarId: z.string().min(1).max(1024), targetRevision: z.number().int().positive(),
  enabled: z.boolean(), status: z.enum(['connected', 'disconnected', 'reconnect-required', 'degraded']),
  credentials: z.object({ access: encryptedCalendarSecretSchema.nullable(),
    refresh: encryptedCalendarSecretSchema }).strict().nullable(),
  tokenExpiresAt: isoDateSchema.nullable(), grantedScopes: z.array(z.string().min(1).max(200)).max(10),
  updatedAt: isoDateSchema,
}).strict().superRefine((v, ctx) => {
  if (v.status === 'connected' && (!v.credentials || !CALENDAR_SCOPES.every(s => v.grantedScopes.includes(s))))
    ctx.addIssue({ code: 'custom', message: 'Connected state requires credentials and verified scopes.' });
  if (v.status === 'disconnected' && (v.credentials !== null || v.enabled))
    ctx.addIssue({ code: 'custom', message: 'Disconnected credentials must be cleared and disabled.' });
});
export type CalendarConnectionRecord = z.infer<typeof connectionRecordSchema>;
export const oauthStateSchema = z.object({ schemaVersion: z.literal(1),
  kind: z.literal('calendar-oauth-state'), userId: idSchema,
  stateHash: sha256Schema, browserHash: sha256Schema, oidcNonceHash: sha256Schema,
  encryptedVerifier: encryptedCalendarSecretSchema, redirectUri: loopbackRedirectSchema,
  createdAt: isoDateSchema, expiresAt: isoDateSchema, consumedAt: isoDateSchema.nullable(),
}).strict().refine(v => Date.parse(v.expiresAt) > Date.parse(v.createdAt)
  && Date.parse(v.expiresAt) - Date.parse(v.createdAt) <= 600000);
export type CalendarOAuthState = z.infer<typeof oauthStateSchema>;
export type CalendarConnectionCas =
  | { outcome: 'confirmed'; record: CalendarConnectionRecord }
  | { outcome: 'conflict'; currentRevision: number }
  | { outcome: 'uncertain' };
export interface CalendarConnectionStore {
  get(userId: string): Promise<CalendarConnectionRecord | null>;
  create(record: CalendarConnectionRecord): Promise<CalendarConnectionCas>;
  compareAndSwap(userId: string, expectedRevision: number, next: CalendarConnectionRecord): Promise<CalendarConnectionCas>;
  putState(record: CalendarOAuthState): Promise<void>;
  consumeState(input: { userId: string; stateHash: string; browserHash: string; now: string }): Promise<CalendarOAuthState | null>;
}
export type CalendarConnectionBinding = Readonly<{ userId: string; connectionId: string;
  connectionRevision: number; googleSubjectId: string; calendarId: string; targetRevision: number }>;
export interface CalendarCredentialPort {
  withAccessToken<T>(input: { binding: CalendarConnectionBinding; signal: AbortSignal;
    deadlineAt: string; consumeRefreshRequest: () => Promise<void> },
    action: (accessToken: string) => Promise<T>): Promise<T>;
}
export interface GoogleIdentityPort {
  verify(input: { idToken: string; clientId: string; expectedNonceHash: string;
    now: string; signal: AbortSignal }): Promise<{ subject: string; email: string | null }>;
}
export interface CalendarConnectionGate {
  requireCurrent(binding: CalendarConnectionBinding, signal: AbortSignal): Promise<void>;
}
export interface CalendarTargetPort {
  verifyOwnedTarget(input: { calendarId: string; googleSubjectId: string; accessToken: string;
    signal: AbortSignal; deadlineAt: string; consumeRequest: () => Promise<void> }): Promise<{
      calendarId: string; googleSubjectId: string; verifiedAt: string; proofRevision: string;
    }>;
}
```

In `collections.ts`, add only:

```ts
integrationConnections: 'integration_connections',
```

The unique ownership key is `(userId, provider)`; state consumption must be atomic, single-use and expiry/browser-bound. Storage `revision` is the CAS counter, including rotation; lifecycle `connectionRevision` fences reconnect/account/target/enablement changes. Ordinary refresh advances storage revision/credentialVersion, not the lifecycle binding; otherwise refreshing a token would invalidate the very operation awaiting it. All callbacks recheck lifecycle revision/enablement before any request and after waits. Rotation safely reseals both tokens when AAD changes; absent rotated refresh token retains/reseals the existing value. P3 uses one bounded per-connection refresh lock, not one per tab. `consumeRefreshRequest` is the P6-owned persisted request-cap hook and must execute before each refresh delivery. No token enters an MCP parameter/header chosen by the model. Only the backend-owned Calendar adapter receives the token inside the callback. P2 preserves old config AAD `['aurvin','config',1,provider]`; new Calendar AAD must not reinterpret old ciphertext. OAuth PKCE AAD is separately bound to `userId`, record kind and state hash; it is not the access/refresh AAD above.

P3 keeps OAuth client secret/environment key backend-only through its own service constructor; they are not browser settings or model config. `CalendarTargetPort` is the direct backend-only P3/P5 seam for bounded target verification before activating a connection; an exchanged access token is volatile inside this call, never an MCP/model argument. P3 can implement against a fixture while P5 implements this port; do not add an implicit P5 worker prerequisite. `proofRevision` identifies the verified ownership mechanism and its evidence; if the narrow grant cannot establish ownership, the method fails and connection activation remains blocked. Target selection must be explicit, with no fallback to `primary`; an ACL owner label alone does not certify data ownership. Local disconnect disables/fences first, clears credentials and source-linked content, and does **not** call Google revoke. Explicit remote revoke is a separate operator action with disclosed project-wide implications; token use is volatile and bounded, then destroyed regardless of remote success. No indefinite credential-bearing revoke queue.

- [ ] **4. Run green** with the focused command, then `npm run build` in `backend/`. Task 8 type-checks all new test fakes using `tsc --noEmit` explicitly; Vitest transpilation is not a type check.
- [ ] **5. Commit:** stage only the three named task files; `git commit -m "feat(calendar): freeze connection OAuth and credential ports"`.

## Task 5: Operation authority, immutable receipts and same-ID reconciliation

**Files:** create `backend/src/contracts/calendar-operations.ts`; create `backend/test/contracts/calendar-operations.spec.ts`.

- [ ] **1. Write this failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { operationRecordSchema, operationEventSchema, type CalendarOperationStore,
  type CalendarExecutionPort } from '../../src/contracts/calendar-operations.js';
const at = '2026-10-20T10:00:00.000Z';
const intent = { schemaVersion: 1, kind: 'calendar-operation', userId: 'u', sessionId: 's',
  turnId: 't', operationId: 'o', originatingAttemptId: 'a', revision: 1, sequence: 0,
  connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub', calendarId: 'owned', targetRevision: 1,
  requestHash: 'a'.repeat(64), googleEventId: 'abcde01234', schemaRevision: 'google-calendar.v1',
  action: { summary: 'Visit', start: '2026-10-21T10:00:00Z', end: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' },
  authorization: { acceptedUserMessageId: 'm', canonicalActionHash: 'a'.repeat(64),
    approvedAt: at, basis: 'explicit-request' }, deliveryRetries: 0,
  createdAt: at, updatedAt: at, auditExpiresAt: '2026-11-19T10:00:00.000Z',
  state: 'planned', receipt: null, failure: null };
describe('Calendar operation authority', () => {
  it('requires stable write authority and does not confuse success with narration', () => {
    expect(operationRecordSchema.safeParse(intent).success).toBe(true);
    expect(operationRecordSchema.safeParse({ ...intent, state: 'succeeded' }).success).toBe(false);
    expect(operationRecordSchema.safeParse({ ...intent, googleEventId: 'bad-ID' }).success).toBe(false);
    expect(operationRecordSchema.safeParse({ ...intent, deliveryRetries: 3 }).success).toBe(false);
    expect(operationRecordSchema.safeParse({ ...intent, requestHash: 'b'.repeat(64) }).success).toBe(false);
    expect(operationEventSchema.safeParse({ schemaVersion: 1, kind: 'calendar-operation-event',
      userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', operationId: 'o', eventId: 'e',
      sequence: 1, state: 'unknown', createdAt: at, failure: { category: 'uncertain',
        code: 'WRITE_OUTCOME_UNKNOWN', retry: 'readback' } }).success).toBe(true);
  });
  it('exposes no unsafe create-again fallback to storage or MCP consumers', async () => {
    const store: CalendarOperationStore = { getByTurn: async () => null,
      reserve: async record => ({ outcome: 'existing', record }),
      compareAndSwap: async () => ({ outcome: 'uncertain' }),
      appendEvent: async () => undefined, listEvents: async () => ({ items: [], nextCursor: null }) };
    const execute: CalendarExecutionPort = { invoke: async () => ({ outcome: 'failure',
      failure: { category: 'credential', code: 'RECONNECT_REQUIRED', retry: 'none' } }),
      readback: async () => ({ outcome: 'unknown' }), close: async () => undefined };
    expect(await store.getByTurn('u', 's', 't')).toBeNull();
    expect(execute.readback).toBeTypeOf('function');
  });
});
```

- [ ] **2. Run red in `backend/`:** `npm test -- test/contracts/calendar-operations.spec.ts -t "Calendar operation authority"`. Expected: missing module.
- [ ] **3. Implement the following module.**

```ts
import { z } from 'zod';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { calendarInputSchemas, type CalendarCall, type CalendarResult } from './calendar-tools.js';
import { calendarFailureSchema, type CalendarFailure } from './calendar-policy.js';
import { sha256Schema, type CalendarConnectionBinding } from './calendar-connections.js';
import { sourceReferenceSchema, type CalendarSourceReference } from './calendar-sources.js';

export const calendarReceiptSchema = z.object({ operationId: idSchema, googleEventId: z.string().min(5).max(1024),
  connectionId: idSchema, connectionRevision: z.number().int().positive(), targetRevision: z.number().int().positive(),
  calendarIdHash: sha256Schema, requestHash: sha256Schema, verifiedAt: isoDateSchema,
  source: sourceReferenceSchema, htmlLink: z.string().max(2048).nullable(),
}).strict().superRefine((v, ctx) => {
  if (!v.source.permission.minimalEvidenceAllowed || !v.source.operationIds.includes(v.operationId)
    || v.source.connectionId !== v.connectionId || v.source.connectionRevision !== v.connectionRevision
    || (v.htmlLink !== null && v.source.permission.content !== 'retained'))
    ctx.addIssue({ code: 'custom', message: 'Receipt content exceeds retention permission.' });
});
export type CalendarReceipt = z.infer<typeof calendarReceiptSchema>;
export const operationStateSchema = z.enum(['planned', 'dispatching', 'succeeded',
  'definitely-failed', 'unknown', 'evidence-expired']);
export const operationRecordSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-operation'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, operationId: idSchema,
  originatingAttemptId: idSchema, revision: z.number().int().positive(), sequence: sequenceSchema,
  connectionId: idSchema, connectionRevision: z.number().int().positive(), googleSubjectId: z.string().min(1).max(255),
  calendarId: z.string().min(1).max(1024), targetRevision: z.number().int().positive(),
  requestHash: sha256Schema, googleEventId: z.string().regex(/^[0-9a-v]{5,1024}$/),
  schemaRevision: z.literal('google-calendar.v1'), action: calendarInputSchemas.calendar_create_event.nullable(),
  actionSources: z.array(sourceReferenceSchema).max(6).default([]),
  authorization: z.object({ acceptedUserMessageId: idSchema, canonicalActionHash: sha256Schema,
    approvedAt: isoDateSchema, basis: z.enum(['explicit-request', 'canonical-approval']) }).strict(),
  deliveryRetries: z.number().int().min(0).max(2), createdAt: isoDateSchema, updatedAt: isoDateSchema,
  auditExpiresAt: isoDateSchema, state: operationStateSchema, receipt: calendarReceiptSchema.nullable(),
  failure: calendarFailureSchema.nullable(),
}).strict().superRefine((v, ctx) => {
  const invalid = v.authorization.canonicalActionHash !== v.requestHash
    || (['planned', 'dispatching'].includes(v.state) && v.action === null)
    || (v.state === 'succeeded' && v.receipt === null)
    || (v.state !== 'succeeded' && v.receipt !== null)
    || (v.state === 'evidence-expired' && v.action !== null)
    || v.actionSources.some(s => !s.permission.minimalEvidenceAllowed)
    || (v.action !== null && v.actionSources.some(s => s.permission.content !== 'retained'))
    || Date.parse(v.auditExpiresAt) - Date.parse(v.createdAt) > 2592000000
    || (v.receipt !== null && (v.receipt.operationId !== v.operationId
      || v.receipt.googleEventId !== v.googleEventId || v.receipt.requestHash !== v.requestHash
      || v.receipt.connectionId !== v.connectionId || v.receipt.connectionRevision !== v.connectionRevision
      || v.receipt.targetRevision !== v.targetRevision));
  if (invalid) ctx.addIssue({ code: 'custom', message: 'Inconsistent operation authority.' });
});
export type CalendarOperation = z.infer<typeof operationRecordSchema>;
export const operationEventSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-operation-event'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema,
  operationId: idSchema, eventId: idSchema, sequence: sequenceSchema, state: operationStateSchema,
  createdAt: isoDateSchema, failure: calendarFailureSchema.nullable(),
}).strict();
export type CalendarOperationEvent = z.infer<typeof operationEventSchema>;
export type OperationCas = { outcome: 'confirmed'; record: CalendarOperation }
  | { outcome: 'conflict' } | { outcome: 'uncertain' };
export interface CalendarOperationStore {
  getByTurn(userId: string, sessionId: string, turnId: string): Promise<CalendarOperation | null>;
  reserve(record: CalendarOperation): Promise<{ outcome: 'created' | 'existing'; record: CalendarOperation }>;
  compareAndSwap(expectedRevision: number, next: CalendarOperation): Promise<OperationCas>;
  appendEvent(event: CalendarOperationEvent): Promise<void>;
  listEvents(input: { userId: string; operationId: string; cursor: string | null; limit: number }):
    Promise<{ items: CalendarOperationEvent[]; nextCursor: string | null }>;
}
export type CalendarExecutionBinding = Readonly<CalendarConnectionBinding & {
  sessionId: string; turnId: string; attemptId: string; decisionId: string; toolCallId: string;
  schemaRevision: 'google-calendar.v1'; operation: CalendarOperation | null;
  trustedNow: string; trustedTimeZone: string; deadlineAt: string;
}>;
export type CalendarRequestKind = 'list' | 'get' | 'create' | 'readback';
export type CalendarExecutionResult =
  | { outcome: 'success'; result: CalendarResult; source: CalendarSourceReference; receipt: CalendarReceipt | null }
  | { outcome: 'failure'; failure: CalendarFailure };
export interface CalendarExecutionPort {
  invoke(input: { binding: CalendarExecutionBinding; call: CalendarCall; signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKind) => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<CalendarExecutionResult>;
  readback(input: { binding: CalendarExecutionBinding; operation: CalendarOperation; signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKind) => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<
      { outcome: 'matched'; receipt: CalendarReceipt }
      | { outcome: 'absent' | 'mismatch' | 'unknown' }>;
  close(): Promise<void>;
}
```

P2 must enforce legal CAS transitions, immutable operation identity/action/hash/event ID, monotonic ordered event sequences and unique `(userId,sessionId,turnId)` creation intent. `reserve` returns an existing operation even across a new application attempt; a differing action needs clarification/new accepted intent, not overwrite. `evidence-expired` is a safe refusal marker, not permission to create. `action=null` supports permitted evidence minimization after terminal outcomes, never a missing dispatch authority. Canonical action content derived from Google is not automatically user-authored or exempt: preserve its `actionSources` and honor their permission/expiry. If required canonical authority cannot legally be persisted, block dispatch rather than weaken durability or retention. `unknown` is quarantined, not “failed, try again.” P6 alone reserves/changes durable state before dispatch; P5 consumes that authority through a server-created closure and never writes storage itself.

P5 calls `consumeRequest` before **every** Calendar delivery, including retry/readback, and passes `consumeRefreshRequest` unchanged into P3's credential callback for the separate two-request refresh budget. Both hooks are P6-owned and persisted before delivery. Enforce request timeout <=20s and remaining deadline. `readback` always uses the saved ID and verifies request/operation/target linkage; `absent` is not automatically permission for blind resubmission. Explicit safe delivery retries use the same ID and count separately from six logical calls. Receipt linkage, not text or checkpoint existence, establishes a created operation. P2/P6 preserve that success if narration fails. A receipt link is only retained/rendered when separately permitted and safe; otherwise durable outcome/reference and an expiry explanation remain authoritative. No exactly-once billing/external transaction guarantee is introduced.

- [ ] **4. Run green** with the focused command and `npm run build` in `backend/`.
- [ ] **5. Commit:** stage only these two task files; `git commit -m "feat(calendar): freeze operation receipt and reconciliation ports"`.

## Task 6: Dispatch accounting, decimal reservations and durable turn budgets

**Files:** create `backend/src/contracts/calendar-accounting.ts`; create `backend/test/contracts/calendar-accounting.spec.ts`. Keep `metadata.ts` accounting/tool-shaped legacy schemas and `usage-evidence.ts` character pricing semantics unchanged.

- [ ] **1. Write this failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { reserveUsd, sumUsd, withinSpendCap, turnBudgetRecordSchema,
  modelDispatchSchema, preferredAttemptAccounting } from '../../src/contracts/calendar-accounting.js';
import { unavailableMoney } from '../../src/contracts/usage-evidence.js';
const at = '2026-10-20T10:00:00.000Z';
const price = { version: 'p1', source: 'verified-fixture', observedAt: at, modelId: 'test/model',
  providerRoute: 'fixture-provider', promptUsdPerToken: '0.0000025', completionUsdPerToken: '0.00001', requestUsd: '0' };
describe('Calendar dispatch accounting', () => {
  it('uses exact canonical decimals and never drops unknown reservations', () => {
    expect(sumUsd(['0.1', '0.2'])).toBe('0.3');
    expect(reserveUsd(price, 100, 100)).toBe('0.00125');
    expect(withinSpendCap('0.5', '0.4', '0.1', '1')).toBe(true);
    expect(withinSpendCap('0.5', '0.4', '0.10000000000000000000000000000001', '1')).toBe(false);
    const dispatch = { schemaVersion: 1, kind: 'calendar-model-dispatch', userId: 'u', sessionId: 's',
      turnId: 't', attemptId: 'a', dispatchId: 'd', decisionId: 'decision', dispatchIndex: 1,
      reason: 'initial', repairedDecisionId: null, requestedModel: 'test/model', reportedModel: null,
      reportedProvider: null, openRouterUser: 'u', generationId: null, providerRequestId: null,
      configRevision: 1, connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v1',
      status: 'terminal', startedAt: at, endedAt: at, firstOutputAt: null,
      promptTokens: null, completionTokens: null, cachedPromptTokens: null, cacheWriteTokens: null,
      reasoningOutputTokens: null, money: unavailableMoney(true), pricing: price,
      reservationUsd: '0.00125', reservationStatus: 'held', failure: null };
    expect(modelDispatchSchema.parse(dispatch).reservationStatus).toBe('held');
    expect(modelDispatchSchema.safeParse({ ...dispatch, reservationStatus: 'settled' }).success).toBe(false);
    expect(modelDispatchSchema.safeParse({ ...dispatch, reasoning: 'private' }).success).toBe(false);
    const legacy = { userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', kind: 'accounting' as const };
    const aggregate = { userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', kind: 'calendar-model-aggregate' as const };
    expect(preferredAttemptAccounting(legacy, aggregate)).toBe(aggregate);
    expect(preferredAttemptAccounting(legacy, null)).toBe(legacy);
  });
  it('persists global counters and rejects overflow after reload', () => {
    const budget = { schemaVersion: 1, kind: 'calendar-turn-budget', userId: 'u', sessionId: 's', turnId: 't',
      revision: 3, modelDispatches: 8, repairs: 2, logicalTools: 6, creates: 1,
      calendarRequests: 20, refreshRequests: 2, deadlineAt: '2026-10-20T10:03:00.000Z',
      createdAt: at, settledUsd: '0.5', reservedUsd: '0.5' };
    const restored = turnBudgetRecordSchema.parse(JSON.parse(JSON.stringify(budget)));
    expect(restored).toEqual(budget);
    for (const key of ['modelDispatches', 'repairs', 'logicalTools', 'creates', 'calendarRequests', 'refreshRequests'] as const) {
      expect(turnBudgetRecordSchema.safeParse({ ...budget, [key]: budget[key] + 1 }).success).toBe(false);
    }
  });
});
```

- [ ] **2. Run red from `backend/`:** `npm test -- test/contracts/calendar-accounting.spec.ts -t "Calendar dispatch accounting"`. Expected: missing module.
- [ ] **3. Add the implementation.**

```ts
import { z } from 'zod';
import { canonicalDecimal, decimalSchema, moneyEvidenceSchema, usageCountSchema } from './usage-evidence.js';
import { idSchema, isoDateSchema } from './identifiers.js';
import { calendarFailureSchema } from './calendar-policy.js';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const scaleOf = (v: string) => v.split('.')[1]?.length ?? 0;
const scaled = (v: string, scale: number) => BigInt(v.replace('.', '')) * 10n ** BigInt(scale - scaleOf(v));
export function sumUsd(values: readonly string[]): string {
  values.forEach(v => decimalSchema.parse(v));
  const scale = Math.max(0, ...values.map(scaleOf));
  return canonicalDecimal(`${values.reduce((sum, v) => sum + scaled(v, scale), 0n)}e-${scale}`);
}
function timesUsd(value: string, units: number): string {
  decimalSchema.parse(value); count.parse(units);
  return canonicalDecimal(`${BigInt(value.replace('.', '')) * BigInt(units)}e-${scaleOf(value)}`);
}
export function withinSpendCap(settled: string, held: string, next: string, cap: string): boolean {
  const total = sumUsd([settled, held, next]); decimalSchema.parse(cap);
  const scale = Math.max(scaleOf(total), scaleOf(cap));
  return scaled(total, scale) <= scaled(cap, scale);
}
export const tokenPricingSchema = z.object({ version: idSchema, source: z.string().min(1).max(200),
  observedAt: isoDateSchema, modelId: z.string().min(1).max(200), providerRoute: z.string().min(1).max(200),
  promptUsdPerToken: decimalSchema, completionUsdPerToken: decimalSchema, requestUsd: decimalSchema,
}).strict();
export type CalendarTokenPricing = z.infer<typeof tokenPricingSchema>;
export function reserveUsd(pricing: CalendarTokenPricing, input: number, output: number): string {
  const p = tokenPricingSchema.parse(pricing);
  return sumUsd([timesUsd(p.promptUsdPerToken, input), timesUsd(p.completionUsdPerToken, output), p.requestUsd]);
}
export const turnBudgetRecordSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-turn-budget'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, revision: z.number().int().positive(),
  modelDispatches: z.number().int().min(0).max(8), repairs: z.number().int().min(0).max(2),
  logicalTools: z.number().int().min(0).max(6), creates: z.number().int().min(0).max(1),
  calendarRequests: z.number().int().min(0).max(20), refreshRequests: z.number().int().min(0).max(2),
  deadlineAt: isoDateSchema, createdAt: isoDateSchema, settledUsd: decimalSchema, reservedUsd: decimalSchema,
}).strict().refine(v => v.repairs <= v.modelDispatches && v.creates <= v.logicalTools
  && Date.parse(v.deadlineAt) > Date.parse(v.createdAt));
export type CalendarTurnBudget = z.infer<typeof turnBudgetRecordSchema>;
export const modelDispatchSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-model-dispatch'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema, dispatchId: idSchema,
  decisionId: idSchema, dispatchIndex: z.number().int().min(1).max(8),
  reason: z.enum(['initial', 'continuation', 'schema-repair', 'provider-retry']), repairedDecisionId: idSchema.nullable(),
  requestedModel: z.string().min(1).max(200), reportedModel: z.string().min(1).max(200).nullable(),
  reportedProvider: z.string().min(1).max(200).nullable(), openRouterUser: idSchema,
  configRevision: z.number().int().nonnegative(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v1'),
  generationId: z.string().min(1).max(200).nullable(), providerRequestId: z.string().min(1).max(200).nullable(),
  status: z.enum(['reserved', 'dispatched', 'terminal', 'not-dispatched']),
  startedAt: isoDateSchema, endedAt: isoDateSchema.nullable(), firstOutputAt: isoDateSchema.nullable(),
  promptTokens: usageCountSchema, completionTokens: usageCountSchema,
  cachedPromptTokens: usageCountSchema, cacheWriteTokens: usageCountSchema, reasoningOutputTokens: usageCountSchema,
  money: moneyEvidenceSchema, pricing: tokenPricingSchema, reservationUsd: decimalSchema,
  reservationStatus: z.enum(['held', 'settled', 'released-not-dispatched']), failure: calendarFailureSchema.nullable(),
}).strict().superRefine((v, ctx) => {
  if ((v.reservationStatus === 'settled' && v.money.costStatus !== 'known')
    || (v.money.costStatus === 'known' && v.reservationStatus !== 'settled')
    || (v.reservationStatus === 'released-not-dispatched' && v.status !== 'not-dispatched')
    || (v.reason === 'schema-repair' && v.repairedDecisionId === null))
    ctx.addIssue({ code: 'custom', message: 'Dispatch reservation/provenance mismatch.' });
});
export type CalendarModelDispatch = z.infer<typeof modelDispatchSchema>;
export const modelAggregateSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-model-aggregate'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema,
  dispatchIds: z.array(idSchema).min(1).max(8).refine(ids => new Set(ids).size === ids.length),
  reportedUsd: decimalSchema.nullable(), heldReservationUsd: decimalSchema,
  costStatus: z.enum(['known', 'pending', 'unknown']), promptTokens: usageCountSchema,
  completionTokens: usageCountSchema, calendarRequests: count.max(20), refreshRequests: count.max(2),
  connectorMoney: moneyEvidenceSchema, updatedAt: isoDateSchema,
}).strict().refine(v => (v.costStatus !== 'known' || (v.reportedUsd !== null && v.heldReservationUsd === '0')));
export type CalendarModelAggregate = z.infer<typeof modelAggregateSchema>;
type AttemptAccountingKey = { userId: string; sessionId: string; turnId: string; attemptId: string };
export function preferredAttemptAccounting<T extends AttemptAccountingKey, U extends AttemptAccountingKey>(
  legacy: T | null, aggregate: U | null): T | U | null {
  if (legacy && aggregate && (legacy.userId !== aggregate.userId || legacy.sessionId !== aggregate.sessionId
    || legacy.turnId !== aggregate.turnId || legacy.attemptId !== aggregate.attemptId)) throw new Error('Mixed attempts.');
  return aggregate ?? legacy;
}
export interface CalendarAccountingStore {
  getBudget(userId: string, sessionId: string, turnId: string): Promise<CalendarTurnBudget | null>;
  createBudget(record: CalendarTurnBudget): Promise<CalendarTurnBudget>;
  compareAndSwapBudget(expectedRevision: number, next: CalendarTurnBudget): Promise<'confirmed' | 'conflict' | 'uncertain'>;
  putDispatch(record: CalendarModelDispatch): Promise<void>;
  getDispatch(userId: string, dispatchId: string): Promise<CalendarModelDispatch | null>;
  listDispatches(userId: string, turnId: string): Promise<CalendarModelDispatch[]>;
  putAggregate(record: CalendarModelAggregate): Promise<void>;
}
```

P2 implements idempotent dispatch uniqueness, durable reservation transitions and bounded lists (at most eight dispatch records), never append-only arrays in one record. P6 consumes **turn-level** budgets before every dispatch/repair/HTTP delivery and retains the original deadline across restart/attempt retry. Separate application attempt IDs do not replenish counters. Unknown actual cost retains its reservation beyond turn termination until bounded reconciliation; it is never zeroed due to failure, empty narration, cancellation or disconnect. P4 supplies provider/model IDs, attribution, counts and canonical cost, without reasoning content. P2 aggregates each dispatch once and selects **either** a legacy attempt accounting row **or** its new aggregate for the same user/session/turn/attempt; do not add dispatch rows, aggregate and legacy row together. `preferredAttemptAccounting` is the single-attempt selection primitive, not a migration or completed reporting implementation. Legacy cost doubles remain compatibility projections, never decimal summands. Existing text/voice monetary schemas stay readable and unchanged. Unknown connector charges remain explicit `unavailableMoney()`, independent of model spend.

- [ ] **4. Run green:** the focused command, then `npm test -- src/contracts/metadata.spec.ts` from `backend/` to retain legacy coverage.
- [ ] **5. Commit:** stage only the two task files; `git commit -m "feat(calendar): freeze dispatch reservations and accounting contracts"`.

## Task 7: Native provider groups, structural diagnostics and model seam

**Files:** create `backend/src/contracts/calendar-model.ts`; create `backend/test/contracts/calendar-model.spec.ts`; modify `backend/src/contracts/config-runtime.ts` with optional capability/options types only.

Do not widen existing `ContextChatMessage`, `ChatMessage`, `ModelChunk` or `ModelAdapter` in place. Existing graph/voice adapters assume text-only content; adding nullable/tool-role messages to that path would force edits outside P1 ownership. Instead P4 implements the additive `CalendarModelPort`; P6 explicitly selects it for tool-enabled **text** turns. Live-voice remains on the old path. Dictated ordinary text is eligible under the normal text boundary.

- [ ] **1. Write this failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { completeToolGroupSchema, repairDiagnosticsSchema, rejectedDecisionSchema,
  nativeToolFragmentSchema, resumableDecisionSchema, type CalendarModelPort } from '../../src/contracts/calendar-model.js';
import type { ModelInvokeRequest } from '../../src/contracts/runtime.js';
import type { VerifiedModelLimits } from '../../src/contracts/config-runtime.js';
describe('Calendar native model seam', () => {
  it('requires matched complete groups and bounded normalized diagnostics', () => {
    const group = { assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1',
      type: 'function', function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde"}' } }] },
      result: { role: 'tool', tool_call_id: 'call_1', name: 'calendar_get_event', content: '{"ok":true}' }, sources: [] };
    expect(completeToolGroupSchema.safeParse(group).success).toBe(true);
    expect(completeToolGroupSchema.safeParse({ ...group, result: { ...group.result, tool_call_id: 'other' } }).success).toBe(false);
    expect(completeToolGroupSchema.safeParse({ ...group, assistant: { ...group.assistant,
      tool_calls: [...group.assistant.tool_calls, group.assistant.tool_calls[0]] } }).success).toBe(false);
    const error = { path: 'summary', code: 'missing', expected: 'string' };
    expect(repairDiagnosticsSchema.safeParse([error]).success).toBe(true);
    expect(repairDiagnosticsSchema.safeParse(Array(11).fill(error)).success).toBe(false);
    expect(repairDiagnosticsSchema.safeParse([{ ...error, path: 'accessToken=SECRET' }]).success).toBe(false);
    expect(nativeToolFragmentSchema.safeParse({ index: 0, function: { arguments: 'x'.repeat(16385) } }).success).toBe(false);
    expect(nativeToolFragmentSchema.safeParse({ index: 0, function: { arguments: 'é'.repeat(8192) } }).success).toBe(true);
    expect(nativeToolFragmentSchema.safeParse({ index: 0, function: { arguments: 'é'.repeat(8192) + 'x' } }).success).toBe(false);
    expect(rejectedDecisionSchema.safeParse({ schemaVersion: 1, kind: 'calendar-rejected-decision',
      userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch',
      dispatchIndex: 1, repairsUsed: 0, rawArgumentsSha256: 'a'.repeat(64), diagnostics: [error],
      createdAt: '2026-10-20T10:00:00.000Z', rawArguments: 'secret' }).success).toBe(false);
    const at = '2026-10-20T10:00:00.000Z';
    const saved = { schemaVersion: 1, kind: 'calendar-model-decision', userId: 'u', sessionId: 's',
      turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch', configRevision: 1,
      connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v1',
      rejectedDecisionId: null, decision: null, sources: [], operationId: null, createdAt: at };
    expect(resumableDecisionSchema.safeParse(saved).success).toBe(true);
    expect(resumableDecisionSchema.safeParse({ ...saved, accessToken: 'secret' }).success).toBe(false);
    const source = { schemaVersion: 1, sourceId: 'source', plugin: 'google-calendar', connectionId: 'c',
      connectionRevision: 1, operationIds: ['op'], fetchedAt: at, expiresAt: at, redactedAt: null,
      permission: { content: 'volatile', minimalEvidenceAllowed: true, policyId: 'pending' } };
    expect(resumableDecisionSchema.safeParse({ ...saved, sources: [source], decision: {
      kind: 'text', decisionId: 'd', content: 'Derived event details', truncated: false } }).success).toBe(false);
  });
  it('keeps old text requests assignable and exposes a separate one-dispatch port', () => {
    const old: ModelInvokeRequest = { modelId: 'fixture', user: 'server-user',
      messages: [{ role: 'user', content: 'Hi' }], maxOutputTokens: 10,
      abortSignal: new AbortController().signal, transforms: [], dataCollection: 'deny' };
    const limits: VerifiedModelLimits = { modelId: 'fixture', contextTokens: 1000,
      outputTokens: 10, supportsMaxTokens: true, source: 'fixture' };
    const model: CalendarModelPort = { async *stream() {
      yield { type: 'failure', failure: { category: 'provider', code: 'INTERRUPTED', retry: 'none' } };
    } };
    expect(old.user).toBe('server-user'); expect(limits.calendar).toBeUndefined();
    expect(model.stream).toBeTypeOf('function');
  });
});
```

- [ ] **2. Run red in `backend/`:** `npm test -- test/contracts/calendar-model.spec.ts -t "Calendar native model seam"`. Expected: missing module; `VerifiedModelLimits.calendar` not yet defined at the Task 9 type check.
- [ ] **3. Add the module.**

```ts
import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import type { CalendarFailure } from './calendar-policy.js';
import { calendarCallSchema, calendarToolNameSchema, CALENDAR_TOOLS } from './calendar-tools.js';
import { sourceReferenceSchema } from './calendar-sources.js';
import { sha256Schema } from './calendar-connections.js';
import type { CalendarModelDispatch } from './calendar-accounting.js';

const boundedArguments = z.string().refine(v => Buffer.byteLength(v, 'utf8') <= 16384);
export const nativeToolCallSchema = z.object({ id: idSchema, type: z.literal('function'),
  function: z.object({ name: calendarToolNameSchema, arguments: boundedArguments }).strict() }).strict();
export const nativeAssistantToolSchema = z.object({ role: z.literal('assistant'),
  content: z.string().max(32000).nullable(), tool_calls: z.array(nativeToolCallSchema).length(1) }).strict();
const textMessageSchema = z.object({ role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(131072) }).strict();
export const nativeToolResultSchema = z.object({ role: z.literal('tool'), tool_call_id: idSchema,
  name: calendarToolNameSchema, content: boundedArguments }).strict();
export const nativeModelMessageSchema = z.union([textMessageSchema, nativeAssistantToolSchema, nativeToolResultSchema]);
export type NativeCalendarModelMessage = z.infer<typeof nativeModelMessageSchema>;
export const completeToolGroupSchema = z.object({ assistant: nativeAssistantToolSchema,
  result: nativeToolResultSchema, sources: z.array(sourceReferenceSchema).max(6) }).strict().refine(v =>
  v.assistant.tool_calls[0].id === v.result.tool_call_id
  && v.assistant.tool_calls[0].function.name === v.result.name);
export type CompleteCalendarToolGroup = z.infer<typeof completeToolGroupSchema>;
export const nativeToolFragmentSchema = z.object({ index: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  id: idSchema.optional(), type: z.literal('function').optional(),
  function: z.object({ name: z.string().max(64).optional(), arguments: boundedArguments.optional() }).strict().optional(),
}).strict();
export const repairDiagnosticsSchema = z.array(z.object({
  path: z.enum(['$', 'tool_calls', 'tool_calls.id', 'tool_calls.name', 'tool_calls.arguments',
    'timeMin', 'timeMax', 'maxResults', 'pageToken', 'eventId', 'summary', 'start', 'end',
    'timeZone', 'description', 'location']),
  code: z.enum(['missing', 'wrong-type', 'unknown-field', 'malformed-json', 'duplicate-key',
    'invalid-envelope', 'cardinality', 'truncated', 'byte-limit', 'depth-limit']),
  expected: z.enum(['object', 'string', 'integer', 'one-call', 'complete-json', 'bounded-value', 'native-envelope']),
}).strict()).min(1).max(10).refine(v => JSON.stringify(v).length <= 2048);
export type CalendarRepairDiagnostics = z.infer<typeof repairDiagnosticsSchema>;
export const rejectedDecisionSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-rejected-decision'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema,
  decisionId: idSchema, dispatchId: idSchema, dispatchIndex: z.number().int().min(1).max(8),
  repairsUsed: z.number().int().min(0).max(2), rawArgumentsSha256: sha256Schema,
  diagnostics: repairDiagnosticsSchema, createdAt: isoDateSchema,
}).strict();
export type CalendarRejectedDecision = z.infer<typeof rejectedDecisionSchema>;
export const calendarDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), decisionId: idSchema, content: z.string().max(32000),
    truncated: z.boolean() }).strict(),
  z.object({ kind: z.literal('tool'), decisionId: idSchema, toolCallId: idSchema,
    call: calendarCallSchema, terminal: z.literal('tool_calls') }).strict(),
]);
export type CalendarDecision = z.infer<typeof calendarDecisionSchema>;
export type CalendarDispatchObservation = Pick<CalendarModelDispatch,
  'reportedModel' | 'reportedProvider' | 'generationId' | 'providerRequestId' | 'promptTokens'
  | 'completionTokens' | 'cachedPromptTokens' | 'cacheWriteTokens' | 'reasoningOutputTokens'
  | 'money' | 'firstOutputAt' | 'endedAt'>;
export type CalendarDecisionRequest = {
  dispatchId: string; decisionId: string; user: string; modelId: string;
  messages: readonly NativeCalendarModelMessage[]; tools: readonly (typeof CALENDAR_TOOLS)[number][];
  maxOutputTokens: number; remainingContextTokens: number; deadlineAt: string; signal: AbortSignal;
  dataCollection: 'deny'; processingPolicyId: string;
  repair: { rejectedDecisionId: string; diagnostics: CalendarRepairDiagnostics } | null;
};
export type CalendarDecisionChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'decision'; decision: CalendarDecision }
  | { type: 'usage'; observation: CalendarDispatchObservation }
  | { type: 'rejected'; evidence: CalendarRejectedDecision }
  | { type: 'failure'; failure: CalendarFailure };
export interface CalendarModelPort {
  stream(request: CalendarDecisionRequest): AsyncIterable<CalendarDecisionChunk>;
}
export const resumableDecisionSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-model-decision'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema, decisionId: idSchema,
  dispatchId: idSchema, configRevision: z.number().int().nonnegative(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v1'),
  rejectedDecisionId: idSchema.nullable(), decision: calendarDecisionSchema.nullable(),
  sources: z.array(sourceReferenceSchema).max(6), operationId: idSchema.nullable(), createdAt: isoDateSchema,
}).strict().refine(v => v.sources.every(s => s.permission.minimalEvidenceAllowed)
  && (v.decision === null || (v.decision.decisionId === v.decisionId
    && v.sources.every(s => s.permission.content === 'retained'
      && Date.parse(s.expiresAt) > Date.parse(v.createdAt)))));
export type ResumableCalendarDecision = z.infer<typeof resumableDecisionSchema>;
export interface CalendarDecisionStore {
  put(record: ResumableCalendarDecision): Promise<void>;
  get(userId: string, decisionId: string): Promise<ResumableCalendarDecision | null>;
  putRejected(record: CalendarRejectedDecision): Promise<void>;
}
```

In `config-runtime.ts`, add these type imports:

```ts
import type { CalendarOptions } from './calendar-policy.js';
import type { CalendarTokenPricing } from './calendar-accounting.js';
```

Add this optional member inside `VerifiedModelLimits`:

```ts
calendar?: Readonly<{ tools: true; nativeStrict: boolean; parallelToolCallsParameter: boolean;
  pricing: CalendarTokenPricing }>;
```

Add this optional member inside `RuntimeConfigSnapshot`:

```ts
readonly calendar?: Readonly<CalendarOptions>;
```

Optional absence means unavailable/disabled, **not** inferred tool support or free pricing. P4 verifies supported parameters and price/provider-route evidence; unknown fees/pricing disable tool-enabled inference. P8 explicitly supplies a processing policy before real-data admission. No UI model picker or client model override is added.

Provider-native strict mode is optional and only usable when the pinned provider can express these exact input semantics. Do not turn omitted description/location into required nulls and then coerce them away; the goal forbids guessed/coerced fields. Omit unsupported strict-mode parameters while retaining server validation, or block an incompatible native tool path. `parallel_tool_calls: false` is likewise sent only when supported; the server always enforces one call.

`CalendarModelPort.stream` performs **one dispatch only**. P4 may not hide a retry/regeneration loop behind it. It emits no usable tool decision before complete native terminal framing, strict duplicate-key-rejecting parsing, allowlist validation and batch classification; optional provider IDs remain optional. More than one candidate call is a repairable cardinality error only if no policy denial is present. A missing/irrecoverable terminal stream is provider failure. P4 buffers fragments by stable index/ID, enforces raw byte/depth ceilings, and maps attacker-controlled keys to the fixed diagnostic paths rather than echoing them. P6 persists counters/reservations and chooses the next dispatch, preserving existing eligible provider-rejection limits as well as eight global dispatches. Rejected candidates never enter native history or get a fabricated tool result. Already complete groups remain intact during repair. P2 validates `resumableDecisionSchema` at its persistence boundary and excludes `decision` content when linked retention permission is absent/expired; the port is not permission to store volatile bodies.

**Required P4 corrective instruction contract** (P4 implements substitution and tests exact substantive wording, using only the authoritative schema and bounded normalized diagnostics):

> The previous tool decision failed structural validation. Regenerate the decision using only the currently allowed tool definitions and the provider's native tool-call format. Correct these validation errors: {bounded field-path and expected-type diagnostics}. Preserve the user's requested action, date, time, and authorized target. Do not invent missing information, add unsupported fields, change accounts, or switch tools to bypass a denial. Do not wrap a tool call in Markdown or prose. If required user information is missing, ask a concise clarification instead. No tool from the rejected decision has been executed.

- [ ] **4. Run green:** the focused command plus `npm test -- src/contracts/interfaces.spec.ts src/contracts/config-runtime.spec.ts` from `backend/`; run `npm run build`.
- [ ] **5. Commit:** stage only the three task files; `git commit -m "feat(calendar): freeze native model and corrective decision contracts"`.

## Task 8: Client-safe setup, durable operation snapshots and v2 events

**Files:** create `backend/src/contracts/calendar-wire.ts`; create `backend/test/contracts/calendar-wire.spec.ts`; add optional Calendar state/stream negotiation to `backend/src/contracts/api.ts`; add optional negotiation flags to the submit/retry command types in `backend/src/contracts/runtime.ts`; export all new contract modules from `backend/src/contracts/index.ts`.

Compatibility policy: legacy API/message/accounting records stay version 1 and remain readable with absent optional Calendar fields. New Calendar-enabled streams explicitly use **protocol 2**; ordinary text/voice emitters keep protocol 1. A new compatible decoder accepts both, but the old strict decoder is not silently loosened to accept unknown events. Submit/retry requests optionally advertise `calendarProtocol: 2`; absence leaves tools unadvertised and preserves the old stream. This flag is decoder capability, **not** authorization, connection selection or permission. P7/P8 pass/select it for tool-enabled text; older clients must not consume an unnegotiated v2 stream. No public MCP route is created.

- [ ] **1. Write this failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { calendarStatusResponseSchema, calendarDisconnectRequestSchema, calendarSettingsRequestSchema,
  calendarStreamEnvelopeSchema, parseCalendarCompatibleFrame,
  calendarTurnStateSchema } from '../../src/contracts/calendar-wire.js';
import { streamEnvelopeSchema } from '../../src/contracts/stream.js';
import { turnStatusResponseSchema, submitTurnRequestSchema, retryTurnRequestSchema } from '../../src/contracts/api.js';
describe('Calendar compatible wire', () => {
  it('reads old streams and new progress without leaking implementation payloads', () => {
    const old = { protocolVersion: 1, sessionId: 's', turnId: 't', attemptId: 'a', sequence: 1,
      event: { type: 'delta', text: 'Hello' } };
    expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(old)}`)).toEqual(streamEnvelopeSchema.parse(old));
    const frame = { ...old, protocolVersion: 2, event: { type: 'calendar-progress', phase: 'repairing' } };
    expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(frame)}`)).toEqual(frame);
    expect(streamEnvelopeSchema.safeParse(frame).success).toBe(false);
    for (const field of ['accessToken', 'refreshToken', 'arguments', 'checkpoint', 'diagnostics']) {
      expect(calendarStreamEnvelopeSchema.safeParse({ ...frame, event: { ...frame.event, [field]: 'secret' } }).success).toBe(false);
    }
    const oldStatus = { sessionId: 's', turnId: 't', attemptId: 'a', status: 'completed', truncated: false, error: null };
    expect(turnStatusResponseSchema.parse(oldStatus)).toEqual(oldStatus);
    const submit = { sessionId: null, content: 'Hello', idempotencyKey: 'idempotency_1' };
    expect(submitTurnRequestSchema.parse(submit)).toEqual(submit);
    expect(submitTurnRequestSchema.safeParse({ ...submit, calendarProtocol: 2 }).success).toBe(true);
    expect(submitTurnRequestSchema.safeParse({ ...submit, calendarProtocol: 1 }).success).toBe(false);
    expect(retryTurnRequestSchema.safeParse({ idempotencyKey: 'idempotency_2', calendarProtocol: 2 }).success).toBe(true);
  });
  it('distinguishes local disconnect, explicit revoke and durable action/narration outcomes', () => {
    expect(calendarDisconnectRequestSchema.safeParse({ mode: 'local' }).success).toBe(true);
    expect(calendarDisconnectRequestSchema.safeParse({ mode: 'revoke-google-grant' }).success).toBe(false);
    expect(calendarSettingsRequestSchema.safeParse({ enabled: true, userId: 'spoofed' }).success).toBe(false);
    expect(calendarStatusResponseSchema.safeParse({ protocolVersion: 1, state: 'setup-required',
      enabled: false, accountEmail: null, targetCalendarId: null, processingDisclosure: null }).success).toBe(true);
    const action = { operationId: 'op', state: 'succeeded', narration: 'failed', retryAction: 'none',
      receipt: { durable: true, eventId: 'abcde', htmlLink: null, expiresAt: null } };
    expect(calendarTurnStateSchema.parse(action).state).toBe('succeeded');
    expect(calendarTurnStateSchema.safeParse({ ...action, state: 'unknown' }).success).toBe(false);
    expect(calendarTurnStateSchema.safeParse({ ...action, receipt: { ...action.receipt, htmlLink: 'javascript:alert(1)' } }).success).toBe(false);
  });
});
```

- [ ] **2. Run red in `backend/`:** `npm test -- test/contracts/calendar-wire.spec.ts -t "Calendar compatible wire"`. Expected: missing module.
- [ ] **3. Implement this complete module.**

```ts
import { z } from 'zod';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { operationStateSchema } from './calendar-operations.js';
import { streamEnvelopeSchema, streamEventSchema } from './stream.js';

export const CALENDAR_API_ROUTES = { status: '/plugins/google-calendar/status',
  settings: '/plugins/google-calendar/settings', oauthStart: '/plugins/google-calendar/oauth/start',
  oauthCallback: '/plugins/google-calendar/oauth/callback', disconnect: '/plugins/google-calendar/disconnect' } as const;
export const calendarSettingsRequestSchema = z.object({ enabled: z.boolean() }).strict();
export const calendarOAuthStartRequestSchema = z.object({}).strict();
export const calendarOAuthStartResponseSchema = z.object({ authorizationUrl: z.string().max(8192).url().refine(v => {
  const u = new URL(v);
  return u.origin === 'https://accounts.google.com' && u.pathname === '/o/oauth2/v2/auth'
    && !u.username && !u.password && !u.hash;
}) }).strict();
export const calendarDisconnectRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('local') }).strict(),
  z.object({ mode: z.literal('revoke-google-grant'), acknowledgeProjectWideRevocation: z.literal(true) }).strict(),
]);
export const calendarDisconnectResponseSchema = z.object({ disconnected: z.literal(true),
  remoteRevocation: z.enum(['not-requested', 'confirmed', 'failed', 'unknown']) }).strict();
export const calendarStatusResponseSchema = z.object({ protocolVersion: z.literal(1),
  state: z.enum(['disabled', 'setup-required', 'connected', 'reconnect-required', 'degraded']),
  enabled: z.boolean(), accountEmail: z.string().email().max(320).nullable(),
  targetCalendarId: z.string().min(1).max(1024).nullable(),
  processingDisclosure: z.object({ policyId: idSchema, processors: z.literal('Google, OpenRouter and the configured model provider'),
    dataCollection: z.literal('deny') }).strict().nullable(),
}).strict();
export type CalendarPublicStatus = z.infer<typeof calendarStatusResponseSchema>;
export const safeCalendarLinkSchema = z.string().max(2048).url().refine(v => {
  const u = new URL(v);
  return u.protocol === 'https:' && !u.username && !u.password && !u.port
    && ['www.google.com', 'calendar.google.com', 'google.com'].includes(u.hostname)
    && u.pathname === '/calendar/event';
});
export const calendarTurnStateSchema = z.object({ operationId: idSchema, state: operationStateSchema,
  narration: z.enum(['pending', 'completed', 'failed', 'interrupted']),
  retryAction: z.enum(['none', 'resume-reconciliation', 'reconnect', 'clarify', 'blocked-expired']),
  receipt: z.object({ durable: z.literal(true), eventId: z.string().min(5).max(1024),
    htmlLink: safeCalendarLinkSchema.nullable(), expiresAt: isoDateSchema.nullable() }).strict().nullable(),
}).strict().refine(v => (v.state === 'succeeded') === (v.receipt !== null)
  && (v.receipt?.htmlLink == null || v.receipt.expiresAt !== null));
export type CalendarTurnState = z.infer<typeof calendarTurnStateSchema>;
export const calendarProgressEventSchema = z.object({ type: z.literal('calendar-progress'),
  phase: z.enum(['validating', 'repairing', 'executing', 'reconciling']) }).strict();
export const calendarOperationWireEventSchema = z.object({ type: z.literal('calendar-operation'),
  operation: calendarTurnStateSchema }).strict();
export const calendarStreamEnvelopeSchema = z.object({ protocolVersion: z.literal(2),
  sessionId: idSchema, turnId: idSchema, attemptId: idSchema, sequence: sequenceSchema,
  event: z.union([streamEventSchema, calendarProgressEventSchema, calendarOperationWireEventSchema]),
}).strict();
export type CalendarStreamEnvelope = z.infer<typeof calendarStreamEnvelopeSchema>;
export const calendarCompatibleEnvelopeSchema = z.union([streamEnvelopeSchema, calendarStreamEnvelopeSchema]);
export function parseCalendarCompatibleFrame(line: string): z.infer<typeof calendarCompatibleEnvelopeSchema> {
  const value = line.trim();
  if (!value.startsWith('data:')) throw new Error('invalid_sse_line');
  return calendarCompatibleEnvelopeSchema.parse(JSON.parse(value.slice(5).trim()));
}
```

In `api.ts`, import and add the **optional** status member (keep all other fields unchanged):

```ts
import { calendarTurnStateSchema } from './calendar-wire.js';
```

```ts
calendar: calendarTurnStateSchema.optional(),
```

The second snippet belongs only inside `turnStatusResponseSchema`. Inside each of `submitTurnRequestSchema` and `retryTurnRequestSchema`, add this optional member after `idempotencyKey`:

```ts
calendarProtocol: z.literal(2).optional(),
```

Inside each of `SubmitTurnCommand` and `RetryTurnCommand` in `runtime.ts`, add:

```ts
calendarProtocol?: 2;
```

No existing ModelAdapter/ModelChunk signature changes. New Chat remains unsaved until accepted input; no client identity/connection/credential/model fields are accepted. P8 carries the decoded capability flag into P6 and uses the v2 envelope only for the negotiated tool-enabled path. A retry from a legacy client cannot dispatch/resume Calendar work without the negotiated safe path; it must expose a safe refusal/status rather than replay anything. P3 owns exact Host/port, Origin, browser/CSRF guard and OAuth callback state handling; the callback must not demand an Aurvin-page Origin. A UI state/action object cannot authorize the effect. Durable status polling and stream events derive from the same persisted operation receipt, not a model delta. On source expiry, remove links/details before returning them even if cleanup is delayed. P8/P7 render a permitted durable success reference independently of failed narration. If no minimal evidence is permitted, readiness is blocked rather than emitting a fabricated created receipt.

Append the following exports to `index.ts`:

```ts
export * from './calendar-policy.js';
export * from './calendar-tools.js';
export * from './calendar-sources.js';
export * from './calendar-connections.js';
export * from './calendar-operations.js';
export * from './calendar-accounting.js';
export * from './calendar-model.js';
export * from './calendar-wire.js';
```

- [ ] **4. Run green:** the focused command; `npm test -- src/contracts/api.spec.ts src/contracts/stream.spec.ts` and `npm run build` from `backend/`.
- [ ] **5. Commit:** stage only the five task files; `git commit -m "feat(calendar): define safe setup and compatible stream contracts"`.

## Task 9: Reproduce SDK/Zod compatibility and freeze dependencies

**Files:** create `backend/src/contracts/calendar-mcp-schema.ts`; create `backend/test/contracts/calendar-mcp-compatibility.spec.ts`; modify `backend/package.json` and `backend/package-lock.json`; add the bridge export to `backend/src/contracts/index.ts`. Inspect but do not change frontend manifests/lockfile without a demonstrated requirement.

Candidate evidence is research, not a certified freeze. Current version-specific primary documentation was also queried during planning via Context7 `/modelcontextprotocol/typescript-sdk/v2.3.1` (testing, HTTP and 2026-07-28 migration examples): imports are from the package roots, the handler exposes `fetch`/`close`, and client negotiation is explicit. Worker execution below remains mandatory. Do not fall back to SDK v1, linked-memory/mock-only transports, a Zod major bump or an arbitrary remote MCP server.

- [ ] **1. Write this failing test before installing packages.**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { withStandardJsonSchema } from '../../src/contracts/calendar-mcp-schema.js';
import { CALENDAR_TOOLS, calendarInputSchemas } from '../../src/contracts/calendar-tools.js';
import { CALENDAR_MCP_WIRE } from '../../src/contracts/calendar-policy.js';

describe('Calendar dependency freeze', () => {
  it('pins compatible exact SDKs while preserving existing package engines and Zod', () => {
    const backend = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const frontend = JSON.parse(readFileSync(new URL('../../../frontend/package.json', import.meta.url), 'utf8'));
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
    const engine = '^22.22.3 || ^24.15.0 || >=26.0.0';
    expect(backend.engines.node).toBe(engine); expect(frontend.engines.node).toBe(engine);
    expect(backend.dependencies['@modelcontextprotocol/server']).toBe('2.3.1');
    expect(backend.dependencies['@modelcontextprotocol/client']).toBe('2.3.1');
    expect(backend.dependencies.zod).toBe('^3.25.32');
    for (const name of ['server', 'client', 'core']) {
      expect(lock.packages[`node_modules/@modelcontextprotocol/${name}`].version).toBe('2.3.1');
    }
    expect(lock.packages['node_modules/zod'].version).toBe('3.25.76');
    for (const name of ['@modelcontextprotocol/sdk', '@langchain/mcp-adapters', 'googleapis']) {
      expect(backend.dependencies[name]).toBeUndefined();
      expect(frontend.dependencies[name]).toBeUndefined();
    }
    expect(frontend.dependencies['@modelcontextprotocol/client']).toBeUndefined();
  });
  it('discovers all three schemas and calls through real modern handler fetch without sockets', async () => {
    const observed: string[] = [];
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'aurvin-contract-fixture', version: '1.0.0' });
      for (const definition of CALENDAR_TOOLS) {
        server.registerTool(definition.name, { description: definition.description,
          inputSchema: withStandardJsonSchema(calendarInputSchemas[definition.name], definition.inputSchema) },
          async () => ({ content: [{ type: 'text', text: definition.name }],
            structuredContent: { tool: definition.name } }));
      }
      return server;
    }, { legacy: 'reject' });
    const client = new Client({ name: 'aurvin-contract-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } });
    const transport = new StreamableHTTPClientTransport(new URL('http://aurvin.internal/mcp'), {
      fetch: (input, init) => {
        const request = new Request(input, init);
        const revision = request.headers.get('mcp-protocol-version');
        if (revision) observed.push(revision);
        return handler.fetch(request);
      },
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map(t => t.name).sort()).toEqual(CALENDAR_TOOLS.map(t => t.name).sort());
      for (const definition of CALENDAR_TOOLS) {
        expect(listed.tools.find(t => t.name === definition.name)?.inputSchema).toEqual(definition.inputSchema);
      }
      const inputs = { calendar_list_events: { timeMin: '2026-10-21T10:00:00Z',
        timeMax: '2026-10-22T10:00:00Z', maxResults: 20 },
        calendar_get_event: { eventId: 'abcde' },
        calendar_create_event: { summary: 'Fixture', start: '2026-10-21T10:00:00Z',
          end: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' } };
      for (const definition of CALENDAR_TOOLS) {
        const args = inputs[definition.name];
        const standard = withStandardJsonSchema(calendarInputSchemas[definition.name], definition.inputSchema);
        expect(await standard['~standard'].validate(args)).toHaveProperty('value');
        const result = await client.callTool({ name: definition.name, arguments: args });
        expect(result.structuredContent).toEqual({ tool: definition.name });
        const refused = await client.callTool({ name: definition.name, arguments: { ...args, userId: 'spoof' } })
          .then(r => r.isError === true, () => true);
        expect(refused).toBe(true);
      }
      expect(observed).toContain(CALENDAR_MCP_WIRE);
    } finally {
      await client.close();
      await handler.close();
    }
  });
});
```

- [ ] **2. Run red in `backend/`:** `npm test -- test/contracts/calendar-mcp-compatibility.spec.ts -t "Calendar dependency freeze"`. Expected: MCP imports/bridge unavailable or missing exact manifest pins. Record the actual failure, not an assumed pass. If SDKs already exist from unrelated user work, do not remove them; missing bridge/pins still demonstrates the change.
- [ ] **3. Record exact declared compatibility before installation.** From `backend/`, run each command separately and retain results in the worker handoff (no secrets; no registry credentials):

```powershell
node --version
npm --version
npm view @modelcontextprotocol/server@2.3.1 version engines peerDependencies dependencies dist.integrity --json
npm view @modelcontextprotocol/client@2.3.1 version engines peerDependencies dependencies dist.integrity --json
npm view @modelcontextprotocol/core@2.3.1 version engines peerDependencies dependencies dist.integrity --json
```

Verify actual `node`/TypeScript/Zod peers against this checkout and the declared engine range. Registry/declaration mismatch is a **stop gate**, not permission to invent a different version. Preserve each registry integrity and the actual peer findings in the commit/handoff evidence; lockfile integrity alone is not runtime proof. Report the tested runtime versus the wider supported-engine declaration distinctly.

- [ ] **4. Install only the justified exact backend dependencies** from `backend/`:

```powershell
npm install --save-exact --ignore-scripts @modelcontextprotocol/server@2.3.1 @modelcontextprotocol/client@2.3.1
```

The intended `dependencies` additions are exactly:

```json
"@modelcontextprotocol/client": "2.3.1",
"@modelcontextprotocol/server": "2.3.1"
```

Retain existing Zod declaration `^3.25.32`, lock resolution `3.25.76`, TypeScript declaration/resolution and all unrelated package versions. Expected core resolution is `2.3.1`; reported client transitive candidates are eventsource `3.0.7` and eventsource-parser `3.0.6`, which must be inspected and reported, not assumed or silently overridden. Inspect `git diff -- backend/package.json backend/package-lock.json` from the repository root before accepting the freeze. If the candidate needs an extra peer or different dependency, report the exact need and resolve it in this P1 ownership turn before releasing dependents. Do not add an unused direct core dependency or override merely to make an assertion green. No new frontend, OAuth, JSON parser, decimal or generic plugin dependency is planned.

- [ ] **5. Add this bridge module** (the actual SDK type/import is checked below):

```ts
import { z } from 'zod';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';

export function withStandardJsonSchema<T extends z.ZodTypeAny>(
  schema: T, jsonSchema: Record<string, unknown>,
): StandardSchemaWithJSON<z.input<T>, z.output<T>> {
  return { '~standard': { version: 1, vendor: 'aurvin-zod',
    validate: (value: unknown) => {
      const parsed = schema.safeParse(value);
      return parsed.success ? { value: parsed.data }
        : { issues: parsed.error.issues.map(issue => ({ message: issue.message, path: issue.path })) };
    },
    jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
  } };
}
```

Append to `index.ts`:

```ts
export * from './calendar-mcp-schema.js';
```

This bridge does not replace strict parsing, semantic validation or authorization. Its internal issues are not repair-prompt diagnostics; P4 normalizes paths/types into the fixed allowlist. It is a small schema bridge, not a plugin framework. The real fixture test proves SDK transport/schema compatibility only; production Calendar REST/MCP semantics, trusted closure binding and catalogue-change refusal remain P5 tests.

- [ ] **6. Run green and inspect the freeze** from `backend/`:

```powershell
npm test -- test/contracts/calendar-mcp-compatibility.spec.ts -t "Calendar dependency freeze"
npm ls @modelcontextprotocol/server @modelcontextprotocol/client @modelcontextprotocol/core zod typescript
npx tsc --ignoreConfig --noEmit --module NodeNext --moduleResolution NodeNext --target ES2023 --strict --skipLibCheck --esModuleInterop --types "node,vitest/globals" test/contracts/calendar-policy.spec.ts test/contracts/calendar-tools.spec.ts test/contracts/calendar-sources.spec.ts test/contracts/calendar-connections.spec.ts test/contracts/calendar-operations.spec.ts test/contracts/calendar-accounting.spec.ts test/contracts/calendar-model.spec.ts test/contracts/calendar-wire.spec.ts test/contracts/calendar-mcp-compatibility.spec.ts
npm run build
npm run lint
npm test
```

All new specs must be discovered and pass. The explicit `tsc` command includes tests because Nest's build excludes them; `--ignoreConfig` selects the explicit TypeScript 6 file-list invocation. Existing routine native tests can skip for absent prerequisites: list their counts/reasons separately. Do not run DB fixtures with guessed credentials or treat skips as proof. Any contract-only change that requires a dependent source edit returns to the orchestrator for ownership coordination; do not patch another owner's file. No review phase is added.

- [ ] **7. Verify the unaffected frontend from `frontend/`:** run the following commands separately. If `node_modules` is absent, `npm ci` in this directory is the existing install path, not a workspace command.

```powershell
npm run build
npm run lint
npm test
```

Expected: existing client package checks pass, with no manifest/lockfile diff. This does not prove future Calendar browser flows; P7/P9 own those checks. Backend e2e/service/browser verification remains its later owning gate, not fabricated P1 evidence.

- [ ] **8. Commit** only the named Task 9 files after a serialized commit turn:

```powershell
git add -- backend/src/contracts/calendar-mcp-schema.ts backend/src/contracts/index.ts backend/test/contracts/calendar-mcp-compatibility.spec.ts backend/package.json backend/package-lock.json
git diff --cached --check
git commit -m "build(calendar): pin and verify modern embedded MCP dependencies"
```

## Final P1 worker exit gate and interface handoff

- [ ] Confirm all nine tasks' source/test commits, clean named-file diffs, no unrelated staging and actual package/engine/peer evidence. P1 changes no root workspace, member identity, remote endpoint, voice tool capability or public route.
- [ ] Report exact commits, discovered/passed/failed/skipped counts, type/build/lint output and limits. No-tests exit is not a pass. If candidate compatibility cannot be reproduced, leave P1 blocked; dependent workers may not begin against an assumed freeze.
- [ ] Send the following concrete handoff to the orchestrator without asking it to ingest this plan:

| Consumer | Frozen seam / responsibility |
| --- | --- |
| P2 | `CalendarConnectionStore`, encrypted OAuth/connection records, additive eighth collection; `CalendarOperationStore` + ordered separate event rows; `CalendarAccountingStore` + persistent turn counters/reservations; `CalendarDecisionStore`, `CalendarResultStore` + causally linked result records; source/result expiry/tombstones and optional message provenance. Preserve legacy schemas and exclude double-counted legacy/aggregate/dispatch rows. Admit the collection through existing fenced storage; no extra owner/TTL shortcut. |
| P3 | Server-owned `CalendarConnectionBinding`, `CalendarConnectionGate`, callback-only `CalendarCredentialPort`, `GoogleIdentityPort`, state/hash/PKCE/nonce envelope, exact local redirect and explicit target. Storage revision differs from connection revision. Fixed scopes `openid email calendar.events.owned`; verify identity/owned-target behavior before admitting it. Local disconnect is separate from explicit project-grant revoke. Setup wire routes/schemas are frozen; publish guard/browser-binding details to P7/P8. |
| P4 | `CalendarModelPort` one dispatch per invocation; native messages/fragments/complete group schema, normalized rejection evidence and exact substantive repair wording; required server `user` every dispatch. Forbidden-field/policy/semantic/provider/credential/uncertain failures cannot become structural repair. Complete terminal framing and bounded strict JSON scanner remain P4 implementation. Existing text/voice adapter stays compatible. |
| P5 | `CALENDAR_TOOLS`, strict argument/result schemas, known tool revision; `CalendarExecutionBinding` supplied by trusted closure, operation authority + same event ID, `CalendarExecutionPort.invoke/readback/close`, callback request-budget hooks and credential gate. Fixed Google endpoints only, explicit no-invitation defaults, actual narrow target/time/cursor semantics, schema/tamper checks and real three-tool production MCP remain P5 work. |
| P6/P7/P8 | Persisted turn-wide 8/2/6/1 dispatch/repair/tool/create ceilings, 20 Calendar +2 refresh requests, <=2 delivery retries, 20-result/31-day bounds, 16 KiB UTF-8 arguments/results, 10/2048 diagnostics, <=20s tools inside unchanged shared run deadline, USD 1 estimate cap. Source <=24h **and** stricter permission deadlines; zero permission stays volatile; audit <=30d subject to policy and safe dedup quarantine. Safe status/receipt/progress wire v2 with explicit v1 compatibility, optional config/model capabilities and default-off state. |

The package handoff must name **actual verified** direct pins `@modelcontextprotocol/client@2.3.1`, `@modelcontextprotocol/server@2.3.1`, actual transitive core/peers, preserved Zod `^3.25.32` / `3.25.76`, actual TypeScript/runtime and observed modern wire `2026-07-28` versus legacy `2025-11-25`. Before worker verification these remain research candidates. No package/runtime fixture certifies live Google, real grant/PKCE, OpenRouter/model support, processing/retention policy, provider pricing, native MongoDB, browser or required P9 live create/readback/safe-retry acceptance. G9 real-data policy and G8 authorized live evidence remain explicit gates. Whole-workflow completion remains pending when a required gate is blocked. Review remains **skipped**.
