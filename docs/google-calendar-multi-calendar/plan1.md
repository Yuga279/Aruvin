# P1 — Contracts, authority, limits, and compatibility freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze additive, executable Phase 2 Calendar contracts that downstream storage, provider, MCP, runtime, and UI workers can consume without losing the meaning of stored Phase 1 evidence.

**Architecture:** Keep the existing eight collections and embedded MCP architecture. Introduce explicit v2 schemas/ports next to immutable v1 decoders; distinguish account authority, discovery freshness, default preference, resolved targets, accepted intent, and external outcomes. Contract tests prove bounds and authority relationships, not a working Google connection or completed migration.

**Tech Stack:** TypeScript/NodeNext, Node `^22.22.3 || ^24.15.0 || >=26.0.0`, existing Zod 3.25.76 and Vitest, MCP client/server 2.3.1 with wire `2026-07-28`; no dependency changes.

---

## Execution boundary and source corrections requiring orchestrator acknowledgement

Read `goal.md`, P1 and shared-file sections of `state.md`, the research handoff, root `AGENTS.md`, and the actual contracts before execution. This document plans **P1 only**. P1 owns `backend/src/contracts/**` and `backend/test/contracts/**`; this planner owns only this Markdown file. Do not edit root `AGENTS.md`, goal/state/research, another plan, runtime, persistence, provider, frontend, `.env`, or `.openchamber/`.

Two literal research statements do not describe this checkout, and the approved text has one contradictory range sentence. Report these before the worker starts; the orchestrator must acknowledge/reconcile the wording rather than silently treating the research as source:

1. **No `calendarSuccessSchema.data` exists.** Actual `calendar-tools.ts` exports a three-branch `calendarResultSchema` discriminated by `tool`. Actual `plugins/mcp/calendar-server.ts:89-93` registers **inputSchema only**, and returns `{ outcome, result, source, receipt }`, not `{ data }`. Task 4 extends the actual result union with `calendarListCalendarsResultSchema` and `calendarCheckAvailabilityResultSchema`; Task 9 proves SDK output validation with the actual envelope in a contract-owned fixture. P5 must register that output contract in production. Do not introduce a fictitious `data` envelope solely to match research prose.
2. **Actual operation states are `planned`, `dispatching`, `succeeded`, `definitely-failed`, `unknown`, `evidence-expired`, not `pending`/`resumable`.** Decisions separately represent resumable work. Task 7 defines a terminal v2 **admission disposition** (`failed`/`cancelled`) referencing unchanged v1 evidence. A dispatched/unknown v1 write remains quarantined for original-target reconciliation; it must never be labelled definitely failed or erased. Proposed correction: “terminal failed/cancelled admission disposition, preserving uncertain external outcome and deduplication evidence,” rather than rewriting an unknown external effect as a known failure.
3. **Goal availability prose says the usable provider window is “far shorter than a month,” while its finite limits explicitly retain a 31-day event/availability ceiling; research §6.2 instead describes approximately 90 days.** P1 follows the explicit approved 31-day application ceiling and does not certify a provider maximum. Proposed correction: remove the contradictory qualitative sentence, retain 31 days as Aurvin's policy ceiling, and leave actual provider-window behavior as a P3 fixture/live compatibility gate. Do not silently lower or raise the frozen ceiling.

Stale pre-approval prose in goal/state does not reopen the dated approval/resume gates. Review is **skipped**, never passed. This plan does not authorize account/API/model calls, installs, database access, migration of application data, provisioning, or deployment.

### Worker conventions

- Use executing-plans and test-driven-development. Each task below has five checkbox actions: test, red, implementation, green, commit. Do not dispatch a reviewer.
- ESM/TypeScript NodeNext: local imports end in `.js`. Use existing Vitest/plain-object fixtures; no test framework/dependency additions.
- New code files, and existing files changed by more than 30%, require the repository documentation banner containing **FILE / LOCATION / PURPOSE / ROLE IN PROJECT / KEY COMPONENTS**. Prepend the proper banner to executable files written from the snippets below. This plan Markdown deliberately has no such banner.
- Keep unmodified v1 schemas as the v1 decoders. No permissive `.passthrough()`, coercion, fabricated scopes, default primary flags, or automatic data migration. New formats are only written through explicit v2 ports after their consumers migrate.
- New active tool/scope constants become v2, while legacy schema literals and scope checks explicitly use v1 constants. Consumers still using old runtime assumptions may fail; record exact failures and route them to P2/P4/P5/P6/P7/P8. Do not weaken schemas or edit another owner's files to manufacture a green build.
- Run every command individually in its named package directory; never overlap build/test processes. Serialize named-path staging/commits with the orchestrator. No `git add .`, amend, branch, worktree, reset, secret output, or unrelated staging.

## File map and frozen downstream handoff

| Files (all under `backend/`) | Responsibility |
| --- | --- |
| `src/contracts/calendar-policy.ts`, `calendar-connections.ts` | Version/scope/limit constants; preserve v1 grant validation and add account-only credential access |
| New `src/contracts/calendar-discovery.ts` | Roles, capability intersection, bounded snapshot/default/target schemas, discovery and connection-store v2 ports |
| New `src/contracts/calendar-availability.ts` | Range/coverage/busy projection, material-condition fingerprint, provider port |
| `src/contracts/calendar-tools.ts`, `calendar-model.ts` | Authoritative five-tool input/result catalogue; versioned model decision and diagnostic schemas |
| New `src/contracts/calendar-authority.ts` | Bounded proposal, selection, conflict acknowledgement, single-consumption/tombstone/store/gate contracts |
| `src/contracts/calendar-sources.ts`, `calendar-operations.ts` | Versioned multi-calendar provenance, pinned operation and durable receipt schemas |
| New `src/contracts/calendar-compatibility.ts` | Legacy read-only dispositions, cursor/checkpoint v2 payloads, safe compatible decoders |
| `src/contracts/calendar-accounting.ts`, `calendar-wire.ts` | Additive accounting versions, bounded public API/receipt/proposal contracts |
| `src/contracts/calendar-mcp-schema.ts` | Existing Standard Schema bridge, reused without package changes |
| `test/contracts/calendar-multi-fixtures.ts`, new `calendar-multi-*.spec.ts` | Shared inert fixtures and focused meaningful regressions |
| Existing `test/contracts/calendar-{policy,tools,mcp-compatibility}.spec.ts` | Update active catalogue expectations while retaining explicit v1 assertions |

No new collection. `collections.ts` remains unchanged; test its exact eight names. No manifest/lockfile change is warranted by the research.

**P2:** implement `CalendarConnectionStoreV2` and `CalendarProposalStore`, consume `CalendarConnectionRecordV2`, `CalendarProposalRecord`, `CalendarProposalConsumption`, `CalendarOperationV2`, compatible decoders, and `CalendarLegacyDisposition`. Existing store interfaces remain v1 until P2 explicitly migrates consumers.

**P3:** implement `CalendarDiscoveryPort.discover` and `CalendarAvailabilityPort.check`; consume `CalendarProviderContext`, `CalendarAccountBinding`, `CalendarDiscoverySnapshot`, `CalendarAvailabilityResult`, and request-admission callbacks. Provider ports receive a transient access token from trusted code, never from tools/wire/results. P4 supplies `CalendarAccountCredentialPort` and `CalendarCapabilityGate`; P3 does not own tokens.

**P5:** consume `CALENDAR_TOOLS`, `calendarInputSchemas`, `calendarCallSchema`, `calendarResultV2Schema`, `CalendarExecutionBindingV2`, `CalendarExecutionPortV2`, `CalendarCapabilityGate`, and the P3 ports. Production output envelope registration is P5-owned. P1 freezes the shape and verifies it through real SDK handler/fetch fixtures.

### Target and revision semantics (contract, not implementation of routing)

- `CalendarAccountBinding` has user/connection/revision/Google subject only, never a default calendar.
- `defaultSettingRevision` advances on preference writes; it is not part of provider cursor authority or a persisted operation target. `revision` remains the connection document CAS revision; `connectionRevision` fences disable/revoke/replacement as defined by P2/P4.
- `CalendarResolvedTarget` pins canonical ID, label, role/capabilities and discovery revision. An alias `primary` must resolve using the entry's `primary === true`; absence is valid discovery data but cannot authorize a primary target. No email-derived alias.
- Explicit selector → valid saved override → primary is a P6 algorithm. P1 supplies `selectedBy` and invalid-default/missing-primary clarification failure codes; it does not implement a second routing service.
- Busy is a **provider event-driven conflict signal**, not working-hours advice/reservation. Transparent, declined/cancelled entries and nights/weekends are not implied busy. Incomplete coverage cannot be called clear. Private event content is absent from availability schemas.

## Task 1: Freeze v2 policy, exact scopes, and independently configurable finite ceilings

**Files:** Modify `backend/src/contracts/calendar-policy.ts`, `backend/src/contracts/calendar-connections.ts`, `backend/test/contracts/calendar-policy.spec.ts`; create `backend/test/contracts/calendar-multi-policy.spec.ts`.

- [ ] **Write this failing test** in `backend/test/contracts/calendar-multi-policy.spec.ts`:

```ts
import { expect, it } from 'vitest';
import { CALENDAR_SCOPES, CALENDAR_SCOPES_V1, CALENDAR_TOOL_REVISION,
  CALENDAR_PROOF_REVISION, CALENDAR_CURSOR_VERSION, CALENDAR_LIMITS,
  calendarLimitsSchema, calendarGrantSchema, calendarGrantStatus,
} from '../../src/contracts/calendar-policy.js';

it('freezes v2 scopes and all new ceilings without certifying old grants', () => {
  expect(CALENDAR_TOOL_REVISION).toBe('google-calendar.v2');
  expect(CALENDAR_PROOF_REVISION).toBe('google-calendar.multi.v2');
  expect(CALENDAR_CURSOR_VERSION).toBe(2);
  expect(CALENDAR_SCOPES).toEqual(['openid', 'email',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.freebusy']);
  expect(calendarGrantStatus(CALENDAR_SCOPES_V1).state).toBe('reconnect-required');
  expect(calendarGrantStatus(CALENDAR_SCOPES).state).toBe('complete');
  expect(calendarGrantStatus(CALENDAR_SCOPES.slice(0, -1)).missingScopes)
    .toEqual(['https://www.googleapis.com/auth/calendar.freebusy']);
  for (const forbidden of ['calendar', 'calendar.readonly']) {
    expect(calendarGrantSchema.safeParse([
      ...CALENDAR_SCOPES, `https://www.googleapis.com/auth/${forbidden}`]).success).toBe(false);
  }
  const ceilings = { retainedCalendars: 100, calendarsPerPage: 20,
    discoveryPagesInTurn: 2, discoveryPagesOutOfTurn: 10,
    availabilityCalendars: 100, availabilityBatchCalendars: 50,
    availabilityBatches: 2, busyIntervalsIngested: 2000,
    snapshotBytes: 262144, discoveryFreshnessMs: 300000, proposalLifetimeMs: 600000 };
  expect(CALENDAR_LIMITS).toMatchObject(ceilings);
  for (const [key, ceiling] of Object.entries(ceilings)) {
    expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, [key]: ceiling }).success).toBe(true);
    expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, [key]: ceiling + 1 }).success).toBe(false);
    expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, [key]: 0 }).success).toBe(false);
  }
  expect(CALENDAR_LIMITS.resultBytes).toBe(16384);
  expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, retainedCalendars: 3 }).success).toBe(true);
  expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, arbitraryLimit: 1 }).success).toBe(false);
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/contracts/calendar-multi-policy.spec.ts -t "freezes v2 scopes"`. Expect missing new exports or v1 revision assertion failure, not “no tests found”.
- [ ] **Minimal implementation.** Keep `CALENDAR_SCHEMA_VERSION = 1` as the historical marker; add `CALENDAR_SCHEMA_VERSION_V2 = 2`. Replace only active scope/revision declarations with:

```ts
export const CALENDAR_TOOL_REVISION_V1 = 'google-calendar.v1' as const;
export const CALENDAR_TOOL_REVISION = 'google-calendar.v2' as const;
export const CALENDAR_PROOF_REVISION_V1 = 'google-calendar.events-owned.v1' as const;
export const CALENDAR_PROOF_REVISION = 'google-calendar.multi.v2' as const;
export const CALENDAR_CURSOR_VERSION = 2 as const;
export const CALENDAR_SCHEMA_VERSION_V2 = 2 as const;
export const CALENDAR_SCOPES_V1 = ['openid', 'email',
  'https://www.googleapis.com/auth/calendar.events.owned'] as const;
export const CALENDAR_SCOPES = ['openid', 'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy'] as const;
const forbiddenScopes = new Set(['https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.readonly']);
export const calendarGrantSchema = z.array(z.string().min(1).max(200)).max(10)
  .refine(scopes => new Set(scopes).size === scopes.length
    && !scopes.some(s => forbiddenScopes.has(s)));
export function calendarGrantStatus(scopes: readonly string[]): {
  state: 'complete' | 'reconnect-required'; missingScopes: string[];
} {
  const parsed = calendarGrantSchema.parse(scopes);
  const missingScopes = CALENDAR_SCOPES.filter(s => !parsed.includes(s));
  return { state: missingScopes.length ? 'reconnect-required' : 'complete', missingScopes };
}
```

Append the following properties to **both** the existing `CALENDAR_LIMITS` object and its strict schema. Do not raise/remove any old ceiling. Optional-with-default new fields preserve decoding of old configured limits; the parsed output and default object have concrete numbers.

```ts
// CALENDAR_LIMITS additional properties
retainedCalendars: 100, calendarsPerPage: 20, discoveryPagesInTurn: 2,
discoveryPagesOutOfTurn: 10, availabilityCalendars: 100,
availabilityBatchCalendars: 50, availabilityBatches: 2,
busyIntervalsIngested: 2000, snapshotBytes: 262144,
discoveryFreshnessMs: 300000, proposalLifetimeMs: 600000,
```

```ts
// calendarLimitsSchema additional properties
retainedCalendars: cap(100).default(100), calendarsPerPage: cap(20).default(20),
discoveryPagesInTurn: cap(2).default(2), discoveryPagesOutOfTurn: cap(10).default(10),
availabilityCalendars: cap(100).default(100), availabilityBatchCalendars: cap(50).default(50),
availabilityBatches: cap(2).default(2), busyIntervalsIngested: cap(2000).default(2000),
snapshotBytes: cap(262144).default(262144), discoveryFreshnessMs: cap(300000).default(300000),
proposalLifetimeMs: cap(600000).default(600000),
```

In `calendar-connections.ts`, change its import and the v1 connected-record check from `CALENDAR_SCOPES` to **`CALENDAR_SCOPES_V1`** before advancing the active constant. Its v1 credentials/AAD/state schema remains byte-for-byte equivalent. Existing policy test: use `toMatchObject` for its existing old-limit assertion, expect active scope length 5, and add `expect(CALENDAR_SCOPES_V1).toHaveLength(3)` with that import. Do not alter non-contract OAuth consumers; P4 migrates them.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/contracts/calendar-multi-policy.spec.ts test/contracts/calendar-policy.spec.ts test/contracts/calendar-connections.spec.ts`.
- [ ] **Commit named files only:** `git commit -m "feat(calendar): freeze versioned multi-calendar policy and ceilings"` after staging the four paths above.

## Task 2: Define discovery, role/scope intersection, canonical primary, and independent default revisions

**Files:** Create `backend/src/contracts/calendar-discovery.ts`, `backend/test/contracts/calendar-multi-fixtures.ts`, `backend/test/contracts/calendar-multi-discovery.spec.ts`; append account-only credential types to `backend/src/contracts/calendar-connections.ts`.

- [ ] **Write fixtures and failing tests.** Initial fixture file:

```ts
export const at = '2026-10-22T10:00:00.000Z';
export const until = '2026-10-22T10:05:00.000Z';
export const hash = 'a'.repeat(64);
export const account = { userId: 'u', connectionId: 'c', connectionRevision: 1,
  googleSubjectId: 'sub' } as const;
export const entry = { calendarId: 'canonical@group.calendar.google.com', label: 'Team',
  primary: true, accessRole: 'writer', privateAccess: true, timeZone: 'Europe/London',
  selected: true, hidden: false, deleted: false,
  capabilities: { readEvents: true, createEvents: true, availability: true } } as const;
export const snapshot = { schemaVersion: 2, discoveryRevision: 1,
  connectionId: 'c', connectionRevision: 1, entries: [entry], fetchedAt: at,
  expiresAt: until, complete: true, truncated: false, nextPageToken: null,
  limitations: [], retentionPolicyId: 'approved-fixture', retentionExpiresAt: until } as const;
export const target = { ...account, calendarId: entry.calendarId, calendarLabel: entry.label,
  targetRevision: 1, discoveryRevision: 1, selectedBy: 'primary',
  accessRole: entry.accessRole, privateAccess: true, capabilities: entry.capabilities,
  verifiedAt: at, proofRevision: 'google-calendar.multi.v2' } as const;
export const action = { calendarId: entry.calendarId, summary: 'Visit',
  start: '2026-10-22T11:00:00+01:00', end: '2026-10-22T12:00:00+01:00',
  timeZone: 'Europe/London' } as const;
export const event = { eventId: 'abcde01234', summary: 'Visit', start: action.start,
  end: action.end, timeZone: action.timeZone, status: 'confirmed', htmlLink: null } as const;
export const permission = { content: 'retained', minimalEvidenceAllowed: true,
  policyId: 'approved-fixture' } as const;
```

```ts
import { expect, it } from 'vitest';
import { CALENDAR_SCOPES, CALENDAR_SCOPES_V1 } from '../../src/contracts/calendar-policy.js';
import { calendarDiscoverySnapshotSchema, calendarDiscoveryEntrySchema, calendarDefaultSettingSchema,
  effectiveCalendarCapabilities, primaryCalendarId, calendarConnectionV2Schema,
  type CalendarConnectionStoreV2, type CalendarDiscoveryPort,
} from '../../src/contracts/calendar-discovery.js';
import { snapshot, entry, at, until } from './calendar-multi-fixtures.js';
import { calendarOAuthOptionsSchema, calendarOAuthOptionsV2Schema } from '../../src/contracts/calendar-connections.js';

it('admits bounded discovery and shared roles without inventing a primary or scope', () => {
  const oauth = { clientId: 'client', redirectUri: 'http://localhost:3000/api/plugins/google-calendar/oauth/callback' };
  expect(calendarOAuthOptionsV2Schema.safeParse(oauth).success).toBe(true);
  expect(calendarOAuthOptionsSchema.safeParse(oauth).success).toBe(false);
  expect(primaryCalendarId(calendarDiscoverySnapshotSchema.parse(snapshot))).toBe(entry.calendarId);
  const absent = { ...snapshot, entries: [{ ...entry, primary: false }], complete: false,
    limitations: ['primary-missing'] };
  expect(calendarDiscoverySnapshotSchema.safeParse(absent).success).toBe(true);
  expect(primaryCalendarId(calendarDiscoverySnapshotSchema.parse(absent))).toBeNull();
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, entries: [entry,
    { ...entry, calendarId: 'other' }] }).success).toBe(false);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, nextPageToken: 'short-page-more' }).success).toBe(false);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot,
    expiresAt: '2026-10-22T10:05:00.001Z' }).success).toBe(false);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot,
    entries: Array.from({ length: 101 }, (_, i) => ({ ...entry, primary: i === 0,
      calendarId: `cal-${i}` })) }).success).toBe(false);
  expect(calendarDiscoveryEntrySchema.safeParse({ ...entry, accessRole: 'superOwner' }).success).toBe(false);
  for (const role of ['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader'] as const) {
    const caps = effectiveCalendarCapabilities(role, CALENDAR_SCOPES, true);
    expect(caps.createEvents).toBe(['owner', 'writer', 'writerWithoutPrivateAccess'].includes(role));
    expect(caps.readEvents).toBe(role !== 'freeBusyReader');
    expect(caps.availability).toBe(true);
    expect(effectiveCalendarCapabilities(role, CALENDAR_SCOPES_V1, true))
      .toEqual({ readEvents: false, createEvents: false, availability: false });
  }
  expect(calendarDiscoveryEntrySchema.safeParse({ ...entry,
    accessRole: 'writerWithoutPrivateAccess', privateAccess: false }).success).toBe(true);
  expect(calendarDiscoveryEntrySchema.safeParse({ ...entry,
    accessRole: 'writerWithoutPrivateAccess', privateAccess: true }).success).toBe(false);
  const pref = calendarDefaultSettingSchema.parse({ defaultCalendarId: null, defaultSettingRevision: 1 });
  const connection = { schemaVersion: 2, connectionId: 'c', connectionRevision: 1,
    userId: 'u', provider: 'google-calendar',
    revision: 1, credentialVersion: 1, googleSubjectId: 'sub', accountEmail: null,
    enabled: false, status: 'reconnect-required', credentials: null, tokenExpiresAt: null,
    grantedScopes: [], updatedAt: at, defaultSetting: pref, discovery: snapshot };
  const first = calendarConnectionV2Schema.parse(connection);
  const changed = calendarConnectionV2Schema.parse({ ...first, revision: 2,
    defaultSetting: { defaultCalendarId: entry.calendarId, defaultSettingRevision: 2 } });
  expect(changed.connectionRevision).toBe(first.connectionRevision);
  expect(until).toBe(snapshot.expiresAt);
  const store: CalendarConnectionStoreV2 = { get: async () => null,
    create: async () => ({ outcome: 'uncertain' }),
    compareAndSwap: async () => ({ outcome: 'uncertain' }) };
  const discovery: CalendarDiscoveryPort = { discover: async () => calendarDiscoverySnapshotSchema.parse(snapshot) };
  expect(store.get).toBeTypeOf('function'); expect(discovery.discover).toBeTypeOf('function');
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/contracts/calendar-multi-discovery.spec.ts -t "admits bounded discovery"`. Missing `calendar-discovery.js` is expected.
- [ ] **Minimal implementation:** create `calendar-discovery.ts` with the following concrete schemas/ports. Import encrypted secrets from the existing module, not a new cipher. Entry flags are explicit normalized values, not fabricated evidence of primary membership.

```ts
import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { CALENDAR_SCOPES, calendarGrantSchema, calendarGrantStatus } from './calendar-policy.js';
import { encryptedCalendarSecretSchema, type CalendarConnectionRecord } from './calendar-connections.js';

export const calendarIdSchema = z.string().min(1).max(1024);
export const calendarCanonicalIdSchema = calendarIdSchema.refine(v => v !== 'primary');
export const calendarRoleSchema = z.enum(['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader']);
export const calendarCapabilitiesSchema = z.object({ readEvents: z.boolean(),
  createEvents: z.boolean(), availability: z.boolean() }).strict();
export type CalendarCapabilities = z.infer<typeof calendarCapabilitiesSchema>;
export function effectiveCalendarCapabilities(role: z.infer<typeof calendarRoleSchema>,
  scopes: readonly string[], policyAllows: boolean): CalendarCapabilities {
  const active = policyAllows && CALENDAR_SCOPES.every(s => scopes.includes(s));
  return { readEvents: active && role !== 'freeBusyReader',
    createEvents: active && ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(role),
    availability: active };
}
export const calendarDiscoveryEntrySchema = z.object({ calendarId: calendarCanonicalIdSchema,
  label: z.string().min(1).max(200), primary: z.boolean(), accessRole: calendarRoleSchema,
  privateAccess: z.boolean(), timeZone: z.string().min(1).max(100).nullable(), selected: z.boolean(),
  hidden: z.boolean(), deleted: z.boolean(), capabilities: calendarCapabilitiesSchema,
}).strict().refine(v => (!['reader', 'freeBusyReader', 'writerWithoutPrivateAccess'].includes(v.accessRole)
    || !v.privateAccess)
  && (!v.capabilities.createEvents || ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(v.accessRole))
  && (!v.capabilities.readEvents || v.accessRole !== 'freeBusyReader')
  && (!(v.hidden || v.deleted) || !Object.values(v.capabilities).some(Boolean)));
export type CalendarDiscoveryEntry = z.infer<typeof calendarDiscoveryEntrySchema>;
export const calendarDiscoveryLimitationSchema = z.enum(['page-limit', 'calendar-limit', 'byte-limit',
  'provider-error', 'unsupported-entry', 'primary-missing', 'stale']);
const snapshotObject = z.object({ schemaVersion: z.literal(2), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), discoveryRevision: z.number().int().positive(),
  entries: z.array(calendarDiscoveryEntrySchema).max(100), fetchedAt: isoDateSchema, expiresAt: isoDateSchema,
  complete: z.boolean(), truncated: z.boolean(), nextPageToken: z.string().min(1).max(2048).nullable(),
  limitations: z.array(calendarDiscoveryLimitationSchema).max(7),
  retentionPolicyId: idSchema.nullable(), retentionExpiresAt: isoDateSchema,
}).strict();
export const calendarDiscoverySnapshotSchema = snapshotObject.refine(v => {
  const lifetime = Date.parse(v.expiresAt) - Date.parse(v.fetchedAt);
  return lifetime >= 0 && lifetime <= 300000 && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 262144
    && Date.parse(v.expiresAt) <= Date.parse(v.retentionExpiresAt)
    && (v.retentionPolicyId !== null || lifetime === 0)
    && new Set(v.entries.map(e => e.calendarId)).size === v.entries.length
    && v.entries.filter(e => e.primary).length <= 1
    && (!v.complete || (!v.truncated && v.nextPageToken === null && !v.limitations.length))
    && (v.entries.some(e => e.primary) || (!v.complete && v.limitations.includes('primary-missing')))
    && (!v.truncated || !v.complete);
});
export type CalendarDiscoverySnapshot = z.infer<typeof calendarDiscoverySnapshotSchema>;
export function primaryCalendarId(snapshot: CalendarDiscoverySnapshot): string | null {
  return snapshot.entries.find(e => e.primary)?.calendarId ?? null;
}
export const calendarDefaultSettingSchema = z.object({ defaultCalendarId: calendarCanonicalIdSchema.nullable(),
  defaultSettingRevision: z.number().int().positive() }).strict();
export const calendarAccountBindingSchema = z.object({ userId: idSchema, connectionId: idSchema,
  connectionRevision: z.number().int().positive(), googleSubjectId: z.string().min(1).max(255) }).strict();
export type CalendarAccountBinding = z.infer<typeof calendarAccountBindingSchema>;
export const calendarResolvedTargetSchema = calendarAccountBindingSchema.extend({
  calendarId: calendarCanonicalIdSchema, calendarLabel: z.string().min(1).max(200),
  targetRevision: z.number().int().positive(), discoveryRevision: z.number().int().positive(),
  selectedBy: z.enum(['explicit', 'saved-default', 'primary', 'proposal']), accessRole: calendarRoleSchema,
  privateAccess: z.boolean(), capabilities: calendarCapabilitiesSchema, verifiedAt: isoDateSchema,
  proofRevision: z.literal('google-calendar.multi.v2'),
}).strict().refine(v => (!v.capabilities.createEvents || ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(v.accessRole))
  && (!v.capabilities.readEvents || v.accessRole !== 'freeBusyReader')
  && (!['reader', 'freeBusyReader', 'writerWithoutPrivateAccess'].includes(v.accessRole) || !v.privateAccess));
export type CalendarResolvedTarget = z.infer<typeof calendarResolvedTargetSchema>;
export const calendarConnectionV2Schema = z.object({ schemaVersion: z.literal(2), userId: idSchema,
  provider: z.literal('google-calendar'), connectionId: idSchema, revision: z.number().int().positive(),
  connectionRevision: z.number().int().positive(), credentialVersion: z.number().int().positive(),
  googleSubjectId: z.string().min(1).max(255), accountEmail: z.string().email().max(320).nullable(),
  enabled: z.boolean(), status: z.enum(['connected', 'disconnected', 'reconnect-required', 'degraded']),
  credentials: z.object({ access: encryptedCalendarSecretSchema.nullable(),
    refresh: encryptedCalendarSecretSchema }).strict().nullable(), tokenExpiresAt: isoDateSchema.nullable(),
  grantedScopes: calendarGrantSchema, updatedAt: isoDateSchema,
  defaultSetting: calendarDefaultSettingSchema, discovery: calendarDiscoverySnapshotSchema.nullable(),
}).strict().refine(v => (v.status !== 'connected' || (v.credentials !== null
    && calendarGrantStatus(v.grantedScopes).state === 'complete'))
  && (v.status !== 'disconnected' || (v.credentials === null && !v.enabled && v.discovery === null))
  && (v.discovery === null || (v.discovery.connectionId === v.connectionId
    && v.discovery.connectionRevision === v.connectionRevision
    && v.discovery.retentionPolicyId !== null
    && Date.parse(v.discovery.expiresAt) > Date.parse(v.discovery.fetchedAt)))
  && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 262144);
export type CalendarConnectionRecordV2 = z.infer<typeof calendarConnectionV2Schema>;
export interface CalendarConnectionStoreV2 {
  get(userId: string): Promise<CalendarConnectionRecord | CalendarConnectionRecordV2 | null>;
  create(record: CalendarConnectionRecordV2): Promise<{ outcome: 'confirmed'; record: CalendarConnectionRecordV2 }
    | { outcome: 'conflict'; currentRevision: number; currentDefaultSettingRevision: number }
    | { outcome: 'uncertain' }>;
  compareAndSwap(input: { userId: string; expectedRevision: number;
    expectedConnectionRevision: number; expectedDefaultSettingRevision: number;
    next: CalendarConnectionRecordV2 }): Promise<
      { outcome: 'confirmed'; record: CalendarConnectionRecordV2 }
      | { outcome: 'conflict'; currentRevision: number; currentDefaultSettingRevision: number }
      | { outcome: 'uncertain' }>;
}
export type CalendarProviderContext = {
  account: CalendarAccountBinding; accessToken: string; signal: AbortSignal;
  grantedScopes: readonly string[]; policyAllows: boolean;
  retentionPolicy: { policyId: string; expiresAt: string } | null;
  deadlineAt: string; now: string;
  consumeRequest: (kind: 'discovery' | 'availability' | 'preflight' | 'capability-recheck') => Promise<void>;
};
export interface CalendarDiscoveryPort {
  discover(input: CalendarProviderContext & { mode: 'in-turn' | 'out-of-turn';
    discoveryRevision: number; limits: { retainedCalendars: number; pageDeliveries: number;
      snapshotBytes: number; freshnessMs: number } }): Promise<CalendarDiscoverySnapshot>;
}
```

Append these **new**, account-only ports to `calendar-connections.ts`, leaving `CalendarCredentialPort`/`CalendarConnectionBinding` v1 intact. Use type-only imports from `calendar-discovery.ts` (the reverse runtime import already used for encrypted secret schema must not become a runtime cycle).

```ts
import type { CalendarAccountBinding } from './calendar-discovery.js';
export const calendarOAuthOptionsV2Schema = calendarOAuthOptionsSchema.extend({
  // Deprecated configuration is accepted for compatibility, never a v2 targeting authority.
  targetCalendarId: z.string().min(1).max(1024).optional(),
}).strict();
export type CalendarOAuthOptionsV2 = z.infer<typeof calendarOAuthOptionsV2Schema>;
export interface CalendarAccountCredentialPort {
  withAccessToken<T>(input: { account: CalendarAccountBinding; signal: AbortSignal;
    deadlineAt: string; consumeRefreshRequest: () => Promise<void> },
    action: (accessToken: string) => Promise<T>): Promise<T>;
}
```

Add these exact assertions to the discovery test (before the `store` declaration) and include `calendarConnectionTransitionV2Schema` in its import:

```ts
expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, entries: [entry, entry] }).success).toBe(false);
expect(primaryCalendarId(calendarDiscoverySnapshotSchema.parse(snapshot))).not.toBe('renamed@example.com');
expect(calendarDiscoveryEntrySchema.safeParse({ ...entry, calendarId: 'primary' }).success).toBe(false);
expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, entries: [], complete: false,
  limitations: ['primary-missing'] }).success).toBe(true);
expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot,
  retentionExpiresAt: '2026-10-22T10:01:00.000Z' }).success).toBe(false);
const volatile = { ...snapshot, retentionPolicyId: null, expiresAt: at, retentionExpiresAt: at };
expect(calendarDiscoverySnapshotSchema.safeParse(volatile).success).toBe(true);
expect(calendarConnectionV2Schema.safeParse({ ...first, discovery: volatile }).success).toBe(false);
expect(calendarConnectionV2Schema.safeParse({ ...first, connectionRevision: 2 }).success).toBe(false);
expect(calendarConnectionTransitionV2Schema.safeParse({ previous: first, next: changed }).success).toBe(true);
expect(calendarConnectionTransitionV2Schema.safeParse({ previous: first,
  next: { ...changed, connectionRevision: 2, discovery: null } }).success).toBe(false);
```

Append this pair schema to `calendar-discovery.ts` so revision independence is an executable contract, not just documentation. The snapshot's account revision must match its parent, and token rotation/refresh/default preference alone does not fence account authority:

```ts
export const calendarConnectionTransitionV2Schema = z.object({ previous: calendarConnectionV2Schema,
  next: calendarConnectionV2Schema }).strict().refine(({ previous: p, next: n }) => {
  const replaced = p.connectionId !== n.connectionId || p.googleSubjectId !== n.googleSubjectId;
  const sameAuthority = !replaced && p.enabled === n.enabled && p.status === n.status
    && JSON.stringify([...p.grantedScopes].sort()) === JSON.stringify([...n.grantedScopes].sort());
  const defaultChanged = replaced || p.defaultSetting.defaultCalendarId !== n.defaultSetting.defaultCalendarId;
  return p.userId === n.userId && n.revision === p.revision + 1
    && (sameAuthority ? n.connectionRevision === p.connectionRevision
      : n.connectionRevision >= p.connectionRevision && n.connectionRevision <= p.connectionRevision + 1)
    && (!replaced || n.connectionRevision === p.connectionRevision + 1)
    && n.defaultSetting.defaultSettingRevision === p.defaultSetting.defaultSettingRevision + (defaultChanged ? 1 : 0)
    && (!replaced || (n.defaultSetting.defaultCalendarId === null && n.discovery === null));
});
```

Actual enablement/re-consent/disconnect revisions must now be reconciled by P2/P4 against this port. A combined preference and disable request may advance account authority because disablement changed, not because the preference changed. Selecting the already-saved value is idempotent and does not increment its setting revision. Discovery refresh and credential rotation advance document CAS only. Deleted/unknown role normalization to `unsupported-entry`, retaining primary on overflow, and HTTP behavior belong to P3, not this schema task. Task 10 supplies the exact 100-entry and UTF-8 overflow checks.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/contracts/calendar-multi-discovery.spec.ts -t "admits bounded discovery"`.
- [ ] **Commit named files:** `git commit -m "feat(calendar): define bounded discovery and independent default authority"`.

## Task 3: Freeze honest availability coverage, material fingerprints, and the provider port

**Files:** Create `backend/src/contracts/calendar-availability.ts`, `backend/test/contracts/calendar-multi-availability.spec.ts`.

- [ ] **Write the failing test:**

```ts
import { expect, it } from 'vitest';
import { calendarAvailabilityResultSchema, calendarAvailabilityBatchSchema,
  calendarAvailabilityIngestionSchema, calendarAvailabilityFingerprint,
  type CalendarAvailabilityPort,
} from '../../src/contracts/calendar-availability.js';
import { at, until, entry } from './calendar-multi-fixtures.js';

it('never encodes unknown coverage as clear and bounds ingestion separately from output', () => {
  const result = { schemaVersion: 2, tool: 'calendar_check_availability',
    connectionId: 'c', connectionRevision: 1, discoveryRevision: 1, availabilityRevision: 1,
    calendarSetHash: 'a'.repeat(64), timeMin: at, timeMax: until, timeZone: 'Europe/London',
    checkedAt: at, expiresAt: until, semantics: 'google-opaque-busy-only',
    calendars: [{ calendarId: entry.calendarId, calendarLabel: entry.label,
      status: 'ok', reason: null }], busy: [], free: [{ start: at, end: until }],
    coverage: 'complete', conflict: 'clear', truncated: false, limitations: [] };
  expect(calendarAvailabilityResultSchema.safeParse(result).success).toBe(true);
  const unknown = { ...result, calendars: [{ ...result.calendars[0], status: 'error',
    reason: 'not-found' }], free: [], coverage: 'incomplete', conflict: 'unknown',
    limitations: ['calendar-error'] };
  expect(calendarAvailabilityResultSchema.safeParse(unknown).success).toBe(true);
  expect(calendarAvailabilityResultSchema.safeParse({ ...unknown, conflict: 'clear' }).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...unknown, free: result.free }).success).toBe(false);
  const fingerprint = calendarAvailabilityFingerprint(calendarAvailabilityResultSchema.parse(unknown));
  expect(calendarAvailabilityFingerprint(calendarAvailabilityResultSchema.parse({ ...unknown,
    availabilityRevision: 2, checkedAt: '2026-10-22T10:00:01.000Z' }))).toBe(fingerprint);
  expect(calendarAvailabilityFingerprint(calendarAvailabilityResultSchema.parse({ ...unknown,
    limitations: ['calendar-error', 'discovery-partial'] }))).not.toBe(fingerprint);
  expect(calendarAvailabilityBatchSchema.safeParse({ calendarIds: Array.from({ length: 50 }, (_, i) => `c${i}`) }).success).toBe(true);
  expect(calendarAvailabilityBatchSchema.safeParse({ calendarIds: Array.from({ length: 51 }, (_, i) => `c${i}`) }).success).toBe(false);
  const interval = { start: at, end: until };
  expect(calendarAvailabilityIngestionSchema.safeParse(Array(2000).fill(interval)).success).toBe(true);
  expect(calendarAvailabilityIngestionSchema.safeParse(Array(2001).fill(interval)).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...result, busy: Array(2000).fill(interval),
    free: [], conflict: 'conflict' }).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...result, groups: [] }).success).toBe(false);
  const provider: CalendarAvailabilityPort = { check: async () => calendarAvailabilityResultSchema.parse(result) };
  expect(provider.check).toBeTypeOf('function');
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/contracts/calendar-multi-availability.spec.ts -t "never encodes unknown coverage"`.
- [ ] **Minimal implementation:**

```ts
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { sha256Schema } from './calendar-connections.js';
import { calendarCanonicalIdSchema, type CalendarDiscoverySnapshot,
  type CalendarProviderContext } from './calendar-discovery.js';

export const calendarIntervalSchema = z.object({ start: isoDateSchema, end: isoDateSchema })
  .strict().refine(v => Date.parse(v.end) > Date.parse(v.start));
export const calendarAvailabilityBatchSchema = z.object({
  calendarIds: z.array(calendarCanonicalIdSchema).min(1).max(50)
    .refine(v => new Set(v).size === v.length),
}).strict();
export const calendarAvailabilityIngestionSchema = z.array(calendarIntervalSchema).max(2000);
export const calendarCoverageReasonSchema = z.enum(['not-found', 'forbidden', 'rate-limit', 'quota',
  'provider-error', 'missing-response', 'unsupported', 'stale']);
export const calendarAvailabilityLimitationSchema = z.enum(['calendar-error', 'discovery-partial',
  'discovery-stale', 'calendar-limit', 'interval-limit', 'byte-limit', 'deadline', 'request-limit']);
export const calendarAvailabilityResultSchema = z.object({ schemaVersion: z.literal(2),
  tool: z.literal('calendar_check_availability'), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), discoveryRevision: z.number().int().positive(),
  availabilityRevision: z.number().int().positive(), calendarSetHash: sha256Schema,
  timeMin: isoDateSchema, timeMax: isoDateSchema, timeZone: z.string().min(1).max(100),
  checkedAt: isoDateSchema, expiresAt: isoDateSchema,
  semantics: z.literal('google-opaque-busy-only'),
  calendars: z.array(z.object({ calendarId: calendarCanonicalIdSchema,
    calendarLabel: z.string().min(1).max(200), status: z.enum(['ok', 'error', 'unsupported', 'stale']),
    reason: calendarCoverageReasonSchema.nullable() }).strict()
    .refine(v => (v.status === 'ok') === (v.reason === null))).max(100),
  busy: z.array(calendarIntervalSchema).max(2000), free: z.array(calendarIntervalSchema).max(2001),
  coverage: z.enum(['complete', 'incomplete']), conflict: z.enum(['clear', 'conflict', 'unknown']),
  truncated: z.boolean(), limitations: z.array(calendarAvailabilityLimitationSchema).max(8),
}).strict().refine(v => {
  const low = Date.parse(v.timeMin), high = Date.parse(v.timeMax);
  const ttl = Date.parse(v.expiresAt) - Date.parse(v.checkedAt);
  const complete = v.coverage === 'complete';
  const ordered = (items: typeof v.busy) => items.every((b, i) => Date.parse(b.start) >= low
    && Date.parse(b.end) <= high && (i === 0 || Date.parse(items[i - 1].end) < Date.parse(b.start)));
  // ponytail: at most 2000 x 2001 comparisons; use a two-pointer scan if these ceilings grow.
  const overlap = v.busy.some(b => v.free.some(f => Date.parse(b.start) < Date.parse(f.end)
    && Date.parse(f.start) < Date.parse(b.end)));
  return high > low && high - low <= 31 * 86400000 && ttl >= 0 && ttl <= 300000
    && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 15360
    && new Set(v.calendars.map(c => c.calendarId)).size === v.calendars.length
    && ordered(v.busy) && ordered(v.free) && !overlap
    && (!complete || (v.calendars.length > 0 && v.calendars.every(c => c.status === 'ok')
      && !v.truncated && v.limitations.length === 0))
    && (complete || (v.free.length === 0 && v.limitations.length > 0))
    && (v.busy.length > 0 ? v.conflict === 'conflict'
      : v.conflict === (complete ? 'clear' : 'unknown'));
});
export const calendarCheckAvailabilityResultSchema = calendarAvailabilityResultSchema;
export type CalendarAvailabilityResult = z.infer<typeof calendarAvailabilityResultSchema>;
export function calendarAvailabilityFingerprint(v: CalendarAvailabilityResult): string {
  return createHash('sha256').update(JSON.stringify({ connectionId: v.connectionId,
    connectionRevision: v.connectionRevision, calendarSetHash: v.calendarSetHash,
    timeMin: Date.parse(v.timeMin), timeMax: Date.parse(v.timeMax),
    busy: v.busy.map(b => [Date.parse(b.start), Date.parse(b.end)]),
    coverage: v.coverage, truncated: v.truncated,
    limitations: [...v.limitations].sort(),
    calendars: v.calendars.map(c => ({ calendarId: c.calendarId, status: c.status, reason: c.reason }))
      .sort((a, b) => a.calendarId < b.calendarId ? -1 : a.calendarId > b.calendarId ? 1 : 0),
  }), 'utf8').digest('hex');
}
export interface CalendarAvailabilityPort {
  check(input: CalendarProviderContext & { snapshot: CalendarDiscoverySnapshot;
    calendarIds: readonly string[]; timeMin: string; timeMax: string; timeZone: string;
    availabilityRevision: number; purpose: 'availability' | 'preflight';
    limits: { batchCalendars: number; batches: number; busyIntervals: number;
      workingBytes: number; resultBytes: number } }): Promise<CalendarAvailabilityResult>;
}
```

The 15,360-byte result-body ceiling deliberately reserves 1 KiB of the existing 16 KiB MCP limit for normal envelope/provenance overhead. It does **not** replace the final whole-envelope check or guarantee that unusually long provenance fits: Task 9 rejects any whole result >16,384. P3 coalesces raw intervals in epoch space before this schema; the 2,000 count is ingestion only, not a right to return 2,000 intervals. Batching, per-calendar HTTP-200 errors, transport classification and actual time-zone validation remain P3-owned; the port explicitly bounds them. No `groups`, event summary, attendees, or arbitrary remote URL is admitted.

Before green add exact-range assertions using this implementation's public schemas:

```ts
it('rejects reversed and over-31-day availability and noncoalesced intervals', () => {
  expect(calendarAvailabilityIngestionSchema.safeParse([{ start: until, end: at }]).success).toBe(false);
  expect(calendarAvailabilityBatchSchema.safeParse({ calendarIds: ['same', 'same'] }).success).toBe(false);
  expect(calendarAvailabilityBatchSchema.safeParse({ calendarIds: ['primary'] }).success).toBe(false);
});
```

- [ ] **Prove green**, cwd `backend`: `npm test -- test/contracts/calendar-multi-availability.spec.ts`.
- [ ] **Commit named files:** `git commit -m "feat(calendar): freeze bounded availability coverage and provider port"`.

## Task 4: Freeze the five-tool catalogue, selectors, result union, and repair paths

**Files:** Modify `backend/src/contracts/calendar-tools.ts`, `calendar-model.ts`, `calendar-operations.ts`, `backend/test/contracts/calendar-tools.spec.ts`, `calendar-mcp-compatibility.spec.ts`; append public result page schema to `calendar-discovery.ts`; create `backend/test/contracts/calendar-multi-tools.spec.ts`.

- [ ] **Write the failing test:**

```ts
import { expect, it } from 'vitest';
import { CALENDAR_TOOLS, CALENDAR_TOOLS_V1, calendarInputSchemas, calendarCallSchema,
  calendarResultSchema, calendarResultV1Schema, forbiddenCalendarKeys,
} from '../../src/contracts/calendar-tools.js';
import { repairDiagnosticsSchema } from '../../src/contracts/calendar-model.js';
import { entry, action, at, until } from './calendar-multi-fixtures.js';

it('freezes five strict v2 tools and admits selectors without model authority', () => {
  expect(CALENDAR_TOOLS.map(t => t.name)).toEqual(['calendar_list_events', 'calendar_get_event',
    'calendar_create_event', 'calendar_list_calendars', 'calendar_check_availability']);
  expect(CALENDAR_TOOLS.every(t => t.revision === 'google-calendar.v2')).toBe(true);
  expect(CALENDAR_TOOLS.find(t => t.name === 'calendar_create_event')?.deliveryRetry).toBe('never');
  expect(CALENDAR_TOOLS.find(t => t.name === 'calendar_create_event')?.annotations.idempotentHint).toBe(false);
  expect(CALENDAR_TOOLS_V1).toHaveLength(3);
  const samples = { calendar_list_events: { calendarId: entry.calendarId, timeMin: at,
    timeMax: until, maxResults: 20 }, calendar_get_event: { calendarId: entry.calendarId, eventId: 'abcde' },
    calendar_create_event: action, calendar_list_calendars: {},
    calendar_check_availability: { timeMin: at, timeMax: until, timeZone: 'Europe/London',
      calendarIds: [entry.calendarId] } };
  for (const definition of CALENDAR_TOOLS) {
    expect(definition.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(definition.inputSchema.properties))
      .toEqual(Object.keys(calendarInputSchemas[definition.name].shape));
    expect(calendarCallSchema.safeParse({ name: definition.name,
      arguments: samples[definition.name] }).success).toBe(true);
    for (const key of ['connectionId', 'targetRevision', 'attendees', 'accessToken', 'userId',
      'confirmed', 'proposalId', 'conflictAccepted', 'defaultSettingRevision']) {
      expect(calendarInputSchemas[definition.name].safeParse({ ...samples[definition.name], [key]: 'forged' }).success).toBe(false);
    }
  }
  expect(forbiddenCalendarKeys).not.toContain('calendarId');
  expect(forbiddenCalendarKeys).toContain('targetRevision');
  expect(calendarInputSchemas.calendar_list_calendars.safeParse({ calendarId: entry.calendarId }).success).toBe(false);
  expect(calendarInputSchemas.calendar_check_availability.safeParse({ ...samples.calendar_check_availability,
    calendarIds: Array.from({ length: 101 }, (_, i) => `c${i}`) }).success).toBe(false);
  for (const path of ['calendarId', 'calendarIds', 'pageToken', 'timeMin', 'timeMax', 'timeZone']) {
    expect(repairDiagnosticsSchema.safeParse([{ path, code: 'wrong-type', expected: 'string' }]).success).toBe(true);
  }
  const page = { schemaVersion: 2, tool: 'calendar_list_calendars', calendars: [entry],
    discoveryRevision: 1, fetchedAt: at, expiresAt: until, complete: true,
    truncated: false, limitations: [], nextPageToken: null };
  expect(calendarResultSchema.safeParse(page).success).toBe(true);
  expect(calendarResultV1Schema.safeParse(page).success).toBe(false);
  expect(calendarResultSchema.safeParse({ ...page, calendars: Array(21).fill(entry) }).success).toBe(false);
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/contracts/calendar-multi-tools.spec.ts -t "freezes five strict v2 tools"`.
- [ ] **Minimal implementation, preserve explicit v1 before extending.** In `calendar-tools.ts`:
  1. Rename the original three-input object to `calendarInputSchemasV1`; retain its exact fields and strictness. Rename the original `definitions` to `definitionsV1`, and export their mapped array as `CALENDAR_TOOLS_V1` with `revision: CALENDAR_TOOL_REVISION_V1` (import this constant). Rename the original result union to `calendarResultV1Schema` and original call union to `calendarCallV1Schema`, pointing its inputs at `calendarInputSchemasV1`. Existing legacy operation `action` must use `calendarInputSchemasV1.calendar_create_event`, not the active schema.
  2. Remove only `'calendarId'` from the forbidden list. Add `'confirmed'`, `'conflictAccepted'`, `'proposalId'`, `'approvalId'`, `'defaultSettingRevision'`, `'discoveryRevision'`, `'availabilityRevision'`, `'googleSubjectId'`, and `'proofRevision'`. Keep every other existing forbidden field, especially `targetRevision`, `connectionId`, `connectionRevision`, `attendees`, tokens, identity and notification/unsupported-write keys. Presence of `calendarId` inside an unapproved nested object is still rejected by strict tool schemas; removal is not global authorization.
  3. Replace active inputs/calls/catalogue/result exports with the following. Reuse original `text`, `timestamp`, `zone`, `stringProperty`, `jsonBytes`, `calendarEventSchema`; add the named imports shown. `CalendarCreateInput` and `CalendarToolName` now infer from active v2 inputs. Do not loosen v1 validators.

Append to `calendar-discovery.ts`:

```ts
export const calendarListCalendarsResultSchema = z.object({ schemaVersion: z.literal(2),
  tool: z.literal('calendar_list_calendars'), calendars: z.array(calendarDiscoveryEntrySchema).max(20),
  discoveryRevision: z.number().int().positive(), fetchedAt: isoDateSchema, expiresAt: isoDateSchema,
  complete: z.boolean(), truncated: z.boolean(), nextPageToken: z.string().min(1).max(2048).nullable(),
  limitations: z.array(calendarDiscoveryLimitationSchema).max(7),
}).strict().refine(v => Date.parse(v.expiresAt) >= Date.parse(v.fetchedAt)
  && Date.parse(v.expiresAt) - Date.parse(v.fetchedAt) <= 300000
  && (!v.complete || (!v.truncated && v.limitations.length === 0))
  && new Set(v.calendars.map(c => c.calendarId)).size === v.calendars.length
  && v.calendars.filter(c => c.primary).length <= 1
  && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 15360);
```

`complete` on a **page** describes its source snapshot's discovery completeness; `nextPageToken` on the page is Aurvin's signed UI/tool cursor, not Google's pagination token. A complete 100-entry snapshot can therefore have five UI pages. On the persisted **snapshot**, `nextPageToken` is the bounded provider continuation and complete requires it absent. This distinction must survive P2/P3/P4/P5 implementations.

```ts
// New imports in calendar-tools.ts
import { calendarIdSchema, calendarListCalendarsResultSchema,
  calendarCanonicalIdSchema } from './calendar-discovery.js';
import { calendarCheckAvailabilityResultSchema } from './calendar-availability.js';

export const calendarInputSchemas = {
  calendar_list_events: calendarInputSchemasV1.calendar_list_events.extend({ calendarId: calendarIdSchema.optional() }).strict(),
  calendar_get_event: calendarInputSchemasV1.calendar_get_event.extend({ calendarId: calendarIdSchema.optional() }).strict(),
  calendar_create_event: calendarInputSchemasV1.calendar_create_event.extend({ calendarId: calendarIdSchema.optional() }).strict(),
  calendar_list_calendars: z.object({ pageToken: text(2048).optional() }).strict(),
  calendar_check_availability: z.object({ timeMin: timestamp, timeMax: timestamp, timeZone: zone,
    calendarIds: z.array(calendarIdSchema).min(1).max(100)
      .refine(v => new Set(v).size === v.length).optional() }).strict(),
} as const;
export type CalendarToolName = keyof typeof calendarInputSchemas;
export type CalendarCreateInput = z.infer<typeof calendarInputSchemas.calendar_create_event>;
export const calendarToolNameSchema = z.enum(['calendar_list_events', 'calendar_get_event',
  'calendar_create_event', 'calendar_list_calendars', 'calendar_check_availability']);
const definitionsV2 = [
  { name: 'calendar_list_events' as const, description: 'List timed events on one authorized resolved calendar.',
    required: ['timeMin', 'timeMax', 'maxResults'], properties: {
      timeMin: stringProperty(96), timeMax: stringProperty(96),
      maxResults: { type: 'integer', minimum: 1, maximum: 20 }, pageToken: stringProperty(2048),
      calendarId: stringProperty(1024) } },
  { name: 'calendar_get_event' as const, description: 'Read one known event on one authorized resolved calendar.',
    required: ['eventId'], properties: { eventId: stringProperty(1024), calendarId: stringProperty(1024) } },
  { name: 'calendar_create_event' as const, description: 'Create one ordinary timed event after server authorization and preflight.',
    required: ['summary', 'start', 'end', 'timeZone'], properties: { summary: stringProperty(200),
      start: stringProperty(96), end: stringProperty(96), timeZone: stringProperty(100),
      description: stringProperty(2000, 0), location: stringProperty(500, 0), calendarId: stringProperty(1024) } },
  { name: 'calendar_list_calendars' as const, description: 'List one bounded page of authorized calendar metadata.',
    required: [], properties: { pageToken: stringProperty(2048) } },
  { name: 'calendar_check_availability' as const, description: 'Check opaque busy intervals with explicit coverage limitations.',
    required: ['timeMin', 'timeMax', 'timeZone'], properties: { timeMin: stringProperty(96),
      timeMax: stringProperty(96), timeZone: stringProperty(100), calendarIds: {
        type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: stringProperty(1024) } } },
];
export const CALENDAR_TOOLS = definitionsV2.map(({ name, description, required, properties }) => ({
  name, description, revision: CALENDAR_TOOL_REVISION,
  deliveryRetry: name === 'calendar_create_event' ? 'never' as const : 'bounded-read' as const,
  annotations: { readOnlyHint: name !== 'calendar_create_event', destructiveHint: false,
    idempotentHint: name !== 'calendar_create_event', openWorldHint: true },
  inputSchema: { type: 'object' as const, additionalProperties: false as const, required, properties },
}));
export const calendarResultTargetSchema = z.object({ calendarId: calendarCanonicalIdSchema,
  calendarLabel: text(200), discoveryRevision: z.number().int().positive(),
  privateAccess: z.boolean() }).strict();
export const calendarResultV2Schema = z.union([
  z.object({ schemaVersion: z.literal(2), tool: z.literal('calendar_list_events'),
    target: calendarResultTargetSchema, events: z.array(calendarEventSchema).max(20),
    nextPageToken: text(2048).nullable(), truncated: z.boolean() }).strict(),
  z.object({ schemaVersion: z.literal(2), tool: z.literal('calendar_get_event'),
    target: calendarResultTargetSchema, event: calendarEventSchema }).strict(),
  z.object({ schemaVersion: z.literal(2), tool: z.literal('calendar_create_event'),
    target: calendarResultTargetSchema, event: calendarEventSchema }).strict(),
  calendarListCalendarsResultSchema, calendarCheckAvailabilityResultSchema,
]).refine(v => jsonBytes(v) <= 16384);
export const calendarResultSchema = z.union([calendarResultV1Schema, calendarResultV2Schema]);
export type CalendarResult = z.infer<typeof calendarResultSchema>;
export type CalendarResultV2 = z.infer<typeof calendarResultV2Schema>;
export const calendarCallSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('calendar_list_events'), arguments: calendarInputSchemas.calendar_list_events }).strict(),
  z.object({ name: z.literal('calendar_get_event'), arguments: calendarInputSchemas.calendar_get_event }).strict(),
  z.object({ name: z.literal('calendar_create_event'), arguments: calendarInputSchemas.calendar_create_event }).strict(),
  z.object({ name: z.literal('calendar_list_calendars'), arguments: calendarInputSchemas.calendar_list_calendars }).strict(),
  z.object({ name: z.literal('calendar_check_availability'), arguments: calendarInputSchemas.calendar_check_availability }).strict(),
]).refine(v => jsonBytes(v.arguments) <= 16384);
export type CalendarCall = z.infer<typeof calendarCallSchema>;
```

In `calendar-model.ts`, append `calendarId` and `calendarIds` to the existing path enum. These are the only new input keys; add a test that every catalogue property has an admitted diagnostic path. Keep code/expected enums and count/length caps unchanged. Freeze the old `calendarDecisionSchema` first as `calendarDecisionV1Schema` using `calendarCallV1Schema`; v1 `resumableDecisionSchema` must reference that legacy version. Active `calendarDecisionSchema` continues to use the active call schema. For the v1 decision freeze use the exact two existing text/tool object branches, changing only the call import/reference. This avoids v2 selectors silently decoding inside v1 resumable records.

Existing contract test adjustments are deliberate version assertions, not bypasses:

- `calendar-tools.spec.ts`: rename the first test to “has exactly five versioned tools…”, expect the ordered five names/revision v2. Its property-boundary loop must handle `property.type === 'array'` with explicit `minItems`, `maxItems`, uniqueness, and item limits instead of treating arrays as numbers. Keep the existing byte boundary and forbidden-key tests.
- `calendar-mcp-compatibility.spec.ts`: add `{ calendar_list_calendars: {}, calendar_check_availability: { timeMin: '2026-10-21T10:00:00Z', timeMax: '2026-10-22T10:00:00Z', timeZone: 'Etc/UTC' } }` to its `inputs` object and rename “all three schemas” to “all five schemas”. Task 9 adds real output validation; this existing test retains its input/transport purpose.
- Preserve all old result fixtures under `calendarResultV1Schema`; legacy results are not relabelled with a new target or primary flag.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/contracts/calendar-multi-tools.spec.ts test/contracts/calendar-tools.spec.ts test/contracts/calendar-model.spec.ts test/contracts/calendar-operations.spec.ts test/contracts/calendar-mcp-compatibility.spec.ts`.
- [ ] **Commit named files:** `git commit -m "feat(calendar): freeze five-tool selectors results and repair diagnostics"`.

## Task 5: Freeze bounded cross-turn proposal, selection, consumption, and conflict authority

**Files:** Create `backend/src/contracts/calendar-authority.ts`, `backend/test/contracts/calendar-multi-authority.spec.ts`; append proposal fixture to `backend/test/contracts/calendar-multi-fixtures.ts`.

- [ ] **Write this fixture and failing test.** Append:

```ts
export const proposal = { schemaVersion: 2, kind: 'calendar-proposal', userId: 'u', sessionId: 's',
  proposalId: 'p', revision: 1, originatingTurnId: 'origin-turn', originatingAcceptedMessageId: 'origin-message',
  originatingAttemptId: 'origin-attempt', intentId: 'intent', connectionId: 'c', connectionRevision: 1,
  googleSubjectId: 'sub', target, action, canonicalActionHash: hash, discoveryRevision: 1,
  availabilityRevision: 1, conditionFingerprint: hash, disclosedLimitations: ['calendar-error'],
  candidates: [], purpose: 'conflict', createdAt: at, expiresAt: '2026-10-22T10:10:00.000Z',
  state: 'pending', consumedBy: null } as const;
```

```ts
import { expect, it } from 'vitest';
import { calendarProposalSchema, calendarProposalConsumptionSchema, calendarProposalTombstoneSchema,
  calendarProposalReplySchema, proposalMatchesReply, type CalendarProposalStore,
} from '../../src/contracts/calendar-authority.js';
import { proposal, at, hash } from './calendar-multi-fixtures.js';

it('binds one expiring proposal consumption across turns without model approval', () => {
  const p = calendarProposalSchema.parse(proposal);
  expect(calendarProposalSchema.safeParse({ ...proposal, expiresAt: '2026-10-22T10:10:00.001Z' }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...proposal, state: 'consumed' }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...proposal, candidates: Array(21).fill({
    target: proposal.target, canonicalActionHash: hash }) }).success).toBe(false);
  const reply = calendarProposalReplySchema.parse({ userId: 'u', sessionId: 's', proposalId: 'p',
    expectedProposalRevision: 1, acceptedMessageId: 'followup-message', acceptedTurnId: 'followup-turn',
    connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub',
    canonicalActionHash: hash, conditionFingerprint: hash, choiceCalendarId: null,
    receivedAt: '2026-10-22T10:01:00.000Z', decision: 'accept' });
  expect(proposalMatchesReply(p, reply)).toBe(true);
  for (const patch of [{ sessionId: 'other' }, { connectionRevision: 2 },
    { canonicalActionHash: 'b'.repeat(64) }, { conditionFingerprint: 'b'.repeat(64) },
    { receivedAt: proposal.expiresAt }, { expectedProposalRevision: 2 }]) {
    expect(proposalMatchesReply(p, { ...reply, ...patch })).toBe(false);
  }
  const consumed = calendarProposalConsumptionSchema.parse({ userId: 'u', sessionId: 's', proposalId: 'p',
    intentId: 'intent', operationId: 'op', acceptedMessageId: reply.acceptedMessageId,
    acceptedTurnId: reply.acceptedTurnId, canonicalActionHash: hash,
    calendarId: proposal.target.calendarId, consumedAt: reply.receivedAt });
  expect(proposalMatchesReply({ ...p, state: 'consumed', consumedBy: consumed }, reply)).toBe(false);
  expect(calendarProposalTombstoneSchema.safeParse({ schemaVersion: 2, kind: 'calendar-proposal-tombstone',
    userId: 'u', sessionId: 's', proposalId: 'p', intentId: 'intent', revision: 2,
    reason: 'expired', operationId: null, canonicalActionHash: hash, at,
    unresolvedOperation: false }).success).toBe(true);
  expect(calendarProposalReplySchema.safeParse({ ...reply, confirmed: true }).success).toBe(false);
  const store: CalendarProposalStore = { getCurrent: async () => null,
    putCurrent: async () => ({ outcome: 'uncertain' }),
    consume: async () => ({ outcome: 'uncertain' }), tombstone: async () => 'uncertain' };
  expect(store.consume).toBeTypeOf('function');
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/contracts/calendar-multi-authority.spec.ts -t "binds one expiring proposal"`.
- [ ] **Minimal implementation:**

```ts
import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { sha256Schema } from './calendar-connections.js';
import { calendarInputSchemas } from './calendar-tools.js';
import { calendarAccountBindingSchema, calendarCanonicalIdSchema, calendarResolvedTargetSchema,
  type CalendarAccountBinding, type CalendarResolvedTarget } from './calendar-discovery.js';
import { calendarAvailabilityLimitationSchema } from './calendar-availability.js';

export const calendarProposalConsumptionSchema = z.object({ userId: idSchema, sessionId: idSchema,
  proposalId: idSchema, intentId: idSchema, operationId: idSchema, acceptedMessageId: idSchema,
  acceptedTurnId: idSchema, canonicalActionHash: sha256Schema, calendarId: calendarCanonicalIdSchema,
  consumedAt: isoDateSchema }).strict();
export type CalendarProposalConsumption = z.infer<typeof calendarProposalConsumptionSchema>;
export const calendarProposalSchema = calendarAccountBindingSchema.extend({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-proposal'), sessionId: idSchema, proposalId: idSchema,
  revision: z.number().int().positive(), originatingTurnId: idSchema,
  originatingAcceptedMessageId: idSchema, originatingAttemptId: idSchema, intentId: idSchema,
  target: calendarResolvedTargetSchema.nullable(),
  action: calendarInputSchemas.calendar_create_event.nullable(), canonicalActionHash: sha256Schema.nullable(),
  discoveryRevision: z.number().int().positive(), availabilityRevision: z.number().int().positive().nullable(),
  conditionFingerprint: sha256Schema.nullable(), disclosedLimitations: z.array(calendarAvailabilityLimitationSchema).max(8),
  candidates: z.array(z.object({ target: calendarResolvedTargetSchema,
    canonicalActionHash: sha256Schema }).strict()).max(20), purpose: z.enum(['selection', 'details', 'conflict']),
  createdAt: isoDateSchema, expiresAt: isoDateSchema,
  state: z.enum(['pending', 'consumed', 'cancelled', 'superseded', 'expired']),
  consumedBy: calendarProposalConsumptionSchema.nullable(),
}).strict().refine(v => {
  const ttl = Date.parse(v.expiresAt) - Date.parse(v.createdAt), c = v.consumedBy;
  const bound = (t: CalendarResolvedTarget) => t.userId === v.userId && t.connectionId === v.connectionId
    && t.connectionRevision === v.connectionRevision && t.googleSubjectId === v.googleSubjectId
    && t.discoveryRevision === v.discoveryRevision;
  return ttl > 0 && ttl <= 600000 && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 16384
    && (v.target === null || bound(v.target)) && v.candidates.every(c => bound(c.target))
    && new Set(v.candidates.map(c => c.target.calendarId)).size === v.candidates.length
    && (v.purpose !== 'selection' || (v.candidates.length > 0 && v.target === null
      && v.canonicalActionHash === null && v.action?.calendarId === undefined))
    && (v.purpose === 'selection' || v.canonicalActionHash !== null)
    && (v.purpose !== 'conflict' || (v.target !== null && v.action !== null
      && v.conditionFingerprint !== null && v.availabilityRevision !== null))
    && (v.action?.calendarId === undefined || v.target === null || v.action.calendarId === v.target.calendarId)
    && ((v.state === 'consumed') === (c !== null))
    && (c === null || (c.userId === v.userId && c.sessionId === v.sessionId && c.proposalId === v.proposalId
      && c.intentId === v.intentId
      && (v.purpose === 'selection' ? v.candidates.some(option => option.target.calendarId === c.calendarId
        && option.canonicalActionHash === c.canonicalActionHash)
        : c.canonicalActionHash === v.canonicalActionHash && v.target?.calendarId === c.calendarId)
      && Date.parse(c.consumedAt) >= Date.parse(v.createdAt) && Date.parse(c.consumedAt) < Date.parse(v.expiresAt)));
});
export type CalendarProposalRecord = z.infer<typeof calendarProposalSchema>;
export const calendarProposalReplySchema = calendarAccountBindingSchema.extend({ sessionId: idSchema,
  proposalId: idSchema, expectedProposalRevision: z.number().int().positive(),
  acceptedMessageId: idSchema, acceptedTurnId: idSchema, canonicalActionHash: sha256Schema,
  conditionFingerprint: sha256Schema.nullable(), choiceCalendarId: calendarCanonicalIdSchema.nullable(),
  receivedAt: isoDateSchema, decision: z.enum(['accept', 'cancel', 'select']) }).strict();
export type CalendarProposalReply = z.infer<typeof calendarProposalReplySchema>;
export function proposalMatchesReply(p: CalendarProposalRecord, r: CalendarProposalReply): boolean {
  return p.state === 'pending' && p.userId === r.userId && p.sessionId === r.sessionId
    && p.proposalId === r.proposalId && p.revision === r.expectedProposalRevision
    && p.connectionId === r.connectionId && p.connectionRevision === r.connectionRevision
    && p.googleSubjectId === r.googleSubjectId
    && (p.purpose === 'selection' ? r.decision === 'cancel' || p.candidates.some(c => c.target.calendarId === r.choiceCalendarId
      && c.canonicalActionHash === r.canonicalActionHash) : p.canonicalActionHash === r.canonicalActionHash)
    && p.conditionFingerprint === r.conditionFingerprint
    && Date.parse(r.receivedAt) >= Date.parse(p.createdAt) && Date.parse(r.receivedAt) < Date.parse(p.expiresAt)
    && (r.decision !== 'select' || (p.purpose === 'selection'
      && p.candidates.some(c => c.target.calendarId === r.choiceCalendarId)));
}
export const calendarProposalTombstoneSchema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-proposal-tombstone'), userId: idSchema, sessionId: idSchema,
  proposalId: idSchema, intentId: idSchema, revision: z.number().int().positive(),
  reason: z.enum(['expired', 'cancelled', 'superseded', 'consumed', 'disconnected', 'redacted']),
  operationId: idSchema.nullable(), canonicalActionHash: sha256Schema.nullable(), at: isoDateSchema,
  unresolvedOperation: z.boolean(),
}).strict().refine(v => (!v.unresolvedOperation || v.operationId !== null)
  && (v.reason !== 'consumed' || (v.operationId !== null && v.canonicalActionHash !== null)));
export type CalendarProposalTombstone = z.infer<typeof calendarProposalTombstoneSchema>;
export type CalendarProposalConsumeResult =
  | { outcome: 'consumed' | 'existing'; consumption: CalendarProposalConsumption }
  | { outcome: 'rejected'; reason: 'expired' | 'stale' | 'wrong-session' | 'changed-action' | 'changed-condition' | 'cancelled' }
  | { outcome: 'uncertain' };
export interface CalendarProposalStore {
  getCurrent(userId: string, sessionId: string): Promise<CalendarProposalRecord | null>;
  putCurrent(input: { expectedProposalId: string | null; expectedRevision: number | null;
    proposal: CalendarProposalRecord }): Promise<{ outcome: 'confirmed'; proposal: CalendarProposalRecord }
      | { outcome: 'conflict' | 'uncertain' }>;
  consume(input: { reply: CalendarProposalReply; operationId: string; intentId: string }): Promise<CalendarProposalConsumeResult>;
  tombstone(input: { expectedRevision: number; tombstone: CalendarProposalTombstone }): Promise<'confirmed' | 'conflict' | 'uncertain'>;
}
export interface CalendarCapabilityGate {
  resolve(input: { account: CalendarAccountBinding; selector: string | null;
    operation: 'read' | 'create' | 'availability'; signal: AbortSignal; deadlineAt: string;
    consumeRequest: (kind: 'discovery' | 'capability-recheck') => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<
      { outcome: 'resolved'; target: CalendarResolvedTarget }
      | { outcome: 'clarify'; code: 'CALENDAR_TARGET_AMBIGUOUS' | 'CALENDAR_TARGET_UNKNOWN'
          | 'CALENDAR_DEFAULT_UNAVAILABLE' | 'CALENDAR_PRIMARY_MISSING'; candidates: CalendarResolvedTarget[] }
      | { outcome: 'denied'; code: 'CALENDAR_RECONNECT_REQUIRED' | 'CALENDAR_TARGET_READ_ONLY' | 'CALENDAR_EXECUTION_DENIED' }>;
  requireCurrent(input: { target: CalendarResolvedTarget; operation: 'read' | 'create' | 'availability';
    signal: AbortSignal; deadlineAt: string; consumeRequest: (kind: 'capability-recheck') => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<void>;
}
```

Single-consumption **storage semantics are normative port requirements**, not something the pure predicate proves: P2 serializes one current proposal per user/session and one `intentId -> operationId` link across turns, keeps a consumed result for idempotent retries, and must return the **same** operation ID for repeated acceptance. It must not allocate a fresh effect on `uncertain`, reset budgets, use text similarity, or TTL-delete unresolved-operation authority. P6 alone derives replies from an actual durably accepted user message; `calendarProposalReplySchema` is **not a browser/model request body**. The helper only validates matching already-trusted evidence and is not proof of consent by itself.

Direct unambiguous accepted requests can use `explicit-request` authorization without a redundant proposal; selection/details/conflict pauses use these durable records. Material action/target/account/calendar-set/coverage changes require a new bounded proposal. Re-reading an unchanged condition may change `availabilityRevision` without changing the material fingerprint. Neither write permission nor account replacement is an overridable warning.

A selection proposal has no single resolved action hash: its root hash is null and each bounded candidate carries the hash of the **same event with that exact canonical target**. Its action omits `calendarId`. After an actual user choice, the server supplies that candidate's hash in the trusted reply and consumption; the eventual operation uses it unchanged. Do not hash a missing target and then pretend choosing a target preserves that hash. Add this exact positive selection check to the task's test:

```ts
const selection = calendarProposalSchema.parse({ ...proposal, purpose: 'selection', target: null,
  canonicalActionHash: null, action: { ...proposal.action, calendarId: undefined },
  candidates: [{ target: proposal.target, canonicalActionHash: hash }],
  conditionFingerprint: null, availabilityRevision: null, disclosedLimitations: [] });
expect(proposalMatchesReply(selection, { ...reply, decision: 'select',
  choiceCalendarId: proposal.target.calendarId, conditionFingerprint: null })).toBe(true);
```

- [ ] **Prove green**, cwd `backend`: `npm test -- test/contracts/calendar-multi-authority.spec.ts -t "binds one expiring proposal"`.
- [ ] **Commit named files:** `git commit -m "feat(calendar): define durable cross-turn proposal authority ports"`.

## Task 6: Freeze multi-calendar source provenance, pinned operation identity, and renderable receipts

**Files:** Append v2 exports to `backend/src/contracts/calendar-sources.ts`, `calendar-operations.ts`; append fixtures to `backend/test/contracts/calendar-multi-fixtures.ts`; create `backend/test/contracts/calendar-multi-operations.spec.ts`.

- [ ] **Write these fixtures and failing tests.** Append:

```ts
export const sourceV1 = { schemaVersion: 1, sourceId: 'src', plugin: 'google-calendar',
  connectionId: 'c', connectionRevision: 1, operationIds: ['op'], fetchedAt: at,
  expiresAt: until, redactedAt: null, permission } as const;
export const sourceV2 = { ...sourceV1, schemaVersion: 2, toolCallIds: ['call'],
  discoveryRevision: 1, availabilityRevision: null, calendarSetHash: null,
  targets: [{ calendarId: entry.calendarId, calendarLabel: entry.label }] } as const;
export const operationV1 = { schemaVersion: 1, kind: 'calendar-operation', userId: 'u',
  sessionId: 's', turnId: 't', operationId: 'op', originatingAttemptId: 'a', revision: 1,
  sequence: 0, connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub',
  calendarId: entry.calendarId, targetRevision: 1, requestHash: hash,
  googleEventId: 'abcde01234', schemaRevision: 'google-calendar.v1',
  action: { summary: action.summary, start: action.start, end: action.end, timeZone: action.timeZone },
  actionSources: [], authorization: { acceptedUserMessageId: 'm', canonicalActionHash: hash,
    approvedAt: at, basis: 'explicit-request' }, deliveryRetries: 0, createdAt: at,
  updatedAt: at, auditExpiresAt: '2026-11-21T10:00:00.000Z', state: 'planned',
  receipt: null, failure: null } as const;
export const operationV2 = { ...operationV1, schemaVersion: 2, schemaRevision: 'google-calendar.v2',
  intentId: 'intent', originatingTurnId: 'origin-turn', originatingAcceptedMessageId: 'origin-message',
  calendarLabel: entry.label, labelExpiresAt: until, discoveryRevision: 1,
  proofRevision: 'google-calendar.multi.v2', action,
  authorization: { ...operationV1.authorization, acceptedTurnId: 't', proposalId: null,
    conditionFingerprint: null, basis: 'explicit-request' } } as const;
export const receiptV1 = { operationId: 'op', googleEventId: 'abcde01234', connectionId: 'c',
  connectionRevision: 1, targetRevision: 1, calendarIdHash: hash, requestHash: hash,
  verifiedAt: at, source: sourceV1, htmlLink: null } as const;
```

```ts
import { expect, it } from 'vitest';
import { operationRecordV2Schema, calendarReceiptV2Schema, calendarExecutionBindingV2Schema,
  calendarRequestKindSchema, type CalendarExecutionPortV2,
} from '../../src/contracts/calendar-operations.js';
import { sourceReferenceV2Schema, persistedCalendarResultV2Schema } from '../../src/contracts/calendar-sources.js';
import { operationV2, sourceV2, event, entry, account, target, hash, at, until } from './calendar-multi-fixtures.js';

it('pins v2 operation receipt and read provenance independently of current preferences', () => {
  const op = operationRecordV2Schema.parse(operationV2);
  expect(op.calendarId).toBe(entry.calendarId);
  expect(operationRecordV2Schema.safeParse({ ...operationV2, requestHash: 'b'.repeat(64) }).success).toBe(false);
  expect(operationRecordV2Schema.safeParse({ ...operationV2, action: { ...operationV2.action,
    calendarId: 'different' } }).success).toBe(false);
  expect(operationRecordV2Schema.safeParse({ ...operationV2, defaultSettingRevision: 2 }).success).toBe(false);
  const source = sourceReferenceV2Schema.parse(sourceV2);
  const receipt = calendarReceiptV2Schema.parse({ schemaVersion: 2, operationId: 'op',
    googleEventId: event.eventId, connectionId: 'c', connectionRevision: 1, targetRevision: 1,
    calendarId: entry.calendarId, calendarLabel: entry.label, labelExpiresAt: until,
    requestHash: hash, verifiedAt: at, source, htmlLink: null });
  expect(operationRecordV2Schema.safeParse({ ...op, state: 'succeeded', receipt }).success).toBe(true);
  expect(operationRecordV2Schema.safeParse({ ...op, state: 'succeeded', receipt: {
    ...receipt, calendarId: 'wrong' } }).success).toBe(false);
  const readSource = sourceReferenceV2Schema.parse({ ...sourceV2, operationIds: [] });
  const retained = { storage: 'retained', source: readSource, toolCallId: 'call', operationId: null,
    result: { schemaVersion: 2, tool: 'calendar_get_event', event,
      target: { calendarId: entry.calendarId, calendarLabel: entry.label,
        discoveryRevision: 1, privateAccess: true } } };
  expect(persistedCalendarResultV2Schema.safeParse(retained).success).toBe(true);
  expect(persistedCalendarResultV2Schema.safeParse({ ...retained, result: { ...retained.result,
    target: { ...retained.result.target, calendarId: 'wrong' } } }).success).toBe(false);
  expect(persistedCalendarResultV2Schema.safeParse({ ...retained, source: { ...readSource,
    permission: { ...readSource.permission, content: 'volatile' }, expiresAt: at } }).success).toBe(false);
  const binding = calendarExecutionBindingV2Schema.parse({ ...account, target, sessionId: 's', turnId: 't',
    attemptId: 'a', decisionId: 'd', toolCallId: 'call', schemaRevision: 'google-calendar.v2',
    trustedNow: at, trustedTimeZone: 'Europe/London', deadlineAt: until, operation: null });
  expect(binding.target?.calendarId).toBe(entry.calendarId);
  expect(calendarExecutionBindingV2Schema.safeParse({ ...binding, target: null }).success).toBe(true);
  for (const kind of ['discovery', 'availability', 'preflight', 'capability-recheck', 'list', 'get', 'create', 'readback']) {
    expect(calendarRequestKindSchema.safeParse(kind).success).toBe(true);
  }
  const executor: CalendarExecutionPortV2 = { invoke: async () => ({ outcome: 'failure',
    failure: { category: 'policy', code: 'CALENDAR_EXECUTION_DENIED', retry: 'none' } }),
    readback: async () => ({ outcome: 'unknown' }), close: async () => undefined };
  expect(executor.invoke).toBeTypeOf('function');
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/contracts/calendar-multi-operations.spec.ts -t "pins v2 operation receipt"`.
- [ ] **Minimal implementation.** Keep all existing v1 exports unchanged except Task 4's explicit v1 action freeze. Append to `calendar-sources.ts` (import `calendarResultV2Schema`, `calendarCanonicalIdSchema`, `sha256Schema`):

```ts
export const sourceReferenceV2Schema = z.object({ schemaVersion: z.literal(2), sourceId: idSchema,
  plugin: z.literal('google-calendar'), connectionId: idSchema, connectionRevision: z.number().int().positive(),
  operationIds: z.array(idSchema).max(6), toolCallIds: z.array(idSchema).min(1).max(6),
  fetchedAt: isoDateSchema, expiresAt: isoDateSchema, redactedAt: isoDateSchema.nullable(),
  permission: sourcePermissionSchema, discoveryRevision: z.number().int().positive(),
  availabilityRevision: z.number().int().positive().nullable(), calendarSetHash: sha256Schema.nullable(),
  targets: z.array(z.object({ calendarId: calendarCanonicalIdSchema,
    calendarLabel: z.string().min(1).max(200).nullable() }).strict()).max(100),
}).strict().refine(v => {
  const lifetime = Date.parse(v.expiresAt) - Date.parse(v.fetchedAt);
  return lifetime >= 0 && lifetime <= 86400000
    && (v.permission.content === 'retained' || (lifetime === 0 && v.targets.every(t => t.calendarLabel === null)))
    && new Set(v.targets.map(t => t.calendarId)).size === v.targets.length
    && new Set(v.toolCallIds).size === v.toolCallIds.length
    && new Set(v.operationIds).size === v.operationIds.length
    && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 262144;
});
export type CalendarSourceReferenceV2 = z.infer<typeof sourceReferenceV2Schema>;
export const persistedCalendarResultV2Schema = z.union([
  z.object({ storage: z.literal('reference'), source: sourceReferenceV2Schema,
    toolCallId: idSchema, operationId: idSchema.nullable(), outcome: z.enum(['ok', 'error', 'unknown']) }).strict(),
  z.object({ storage: z.literal('retained'), source: sourceReferenceV2Schema,
    toolCallId: idSchema, operationId: idSchema.nullable(), result: calendarResultV2Schema }).strict(),
  z.object({ storage: z.literal('tombstone'), source: sourceReferenceV2Schema,
    toolCallId: idSchema, operationId: idSchema.nullable(), reason: z.enum(['expired', 'disconnected', 'not-permitted']) }).strict(),
]).refine(v => {
  if (!v.source.permission.minimalEvidenceAllowed || !v.source.toolCallIds.includes(v.toolCallId)
    || (v.operationId !== null && !v.source.operationIds.includes(v.operationId))) return false;
  if (v.storage !== 'retained') return true;
  if (v.source.permission.content !== 'retained' || Date.parse(v.source.expiresAt) <= Date.parse(v.source.fetchedAt)) return false;
  const result = v.result;
  const targets = 'target' in result ? [result.target]
    : result.tool === 'calendar_list_calendars' ? result.calendars.map(c => ({ calendarId: c.calendarId, calendarLabel: c.label }))
      : result.calendars;
  return targets.every(t => v.source.targets.some(s => s.calendarId === t.calendarId && s.calendarLabel === t.calendarLabel))
    && (result.tool !== 'calendar_check_availability' || (v.source.calendarSetHash === result.calendarSetHash
      && v.source.availabilityRevision === result.availabilityRevision
      && v.source.discoveryRevision === result.discoveryRevision));
});
export const calendarToolResultRecordV2Schema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-tool-result'), userId: idSchema, sessionId: idSchema, turnId: idSchema,
  attemptId: idSchema, decisionId: idSchema, eventId: idSchema, sequence: z.number().int().nonnegative(),
  toolCallId: idSchema, createdAt: isoDateSchema, resultRef: persistedCalendarResultV2Schema,
}).strict().refine(v => v.toolCallId === v.resultRef.toolCallId);
export type CalendarToolResultRecordV2 = z.infer<typeof calendarToolResultRecordV2Schema>;
```

For v1 `persistedCalendarResultSchema`, point its retained branch to **`calendarResultV1Schema`**, not the now-compatible result union. This prevents laundering a new result through a v1 source record. Do the same for any v1 schema nested into a compatible decoder. Existing source lifetimes and `effectiveSourceExpiry` stay unchanged.

Append to `calendar-operations.ts`, with imports for v2 source/result, `calendarResolvedTargetSchema`, `CalendarCall`, and account types:

```ts
export const calendarReceiptV2Schema = z.object({ schemaVersion: z.literal(2), operationId: idSchema,
  googleEventId: z.string().regex(/^[0-9a-v]{5,1024}$/), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), targetRevision: z.number().int().positive(),
  calendarId: calendarCanonicalIdSchema, calendarLabel: z.string().min(1).max(200).nullable(),
  labelExpiresAt: isoDateSchema.nullable(), requestHash: sha256Schema, verifiedAt: isoDateSchema,
  source: sourceReferenceV2Schema, htmlLink: z.string().max(2048).nullable(),
}).strict().refine(v => v.source.permission.minimalEvidenceAllowed
  && v.source.operationIds.includes(v.operationId) && v.source.connectionId === v.connectionId
  && v.source.connectionRevision === v.connectionRevision
  && v.source.targets.some(t => t.calendarId === v.calendarId && t.calendarLabel === v.calendarLabel)
  && ((v.calendarLabel === null) === (v.labelExpiresAt === null))
  && (v.labelExpiresAt === null || (v.source.permission.content === 'retained'
    && Date.parse(v.labelExpiresAt) <= Date.parse(v.source.expiresAt)))
  && (v.htmlLink === null || v.source.permission.content === 'retained'));
export type CalendarReceiptV2 = z.infer<typeof calendarReceiptV2Schema>;
export const operationStateV2Schema = z.enum(['planned', 'dispatching', 'succeeded',
  'definitely-failed', 'unknown', 'evidence-expired', 'failed', 'cancelled']);
export const operationRecordV2Schema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-operation'), userId: idSchema, sessionId: idSchema, turnId: idSchema,
  operationId: idSchema, originatingAttemptId: idSchema, revision: z.number().int().positive(), sequence: sequenceSchema,
  intentId: idSchema, originatingTurnId: idSchema, originatingAcceptedMessageId: idSchema,
  connectionId: idSchema, connectionRevision: z.number().int().positive(), googleSubjectId: z.string().min(1).max(255),
  calendarId: calendarCanonicalIdSchema, targetRevision: z.number().int().positive(),
  calendarLabel: z.string().min(1).max(200).nullable(), labelExpiresAt: isoDateSchema.nullable(),
  discoveryRevision: z.number().int().positive(), proofRevision: z.literal('google-calendar.multi.v2'),
  requestHash: sha256Schema, googleEventId: z.string().regex(/^[0-9a-v]{5,1024}$/),
  schemaRevision: z.literal('google-calendar.v2'), action: calendarInputSchemas.calendar_create_event.nullable(),
  actionSources: z.array(sourceReferenceV2Schema).max(6).default([]),
  authorization: z.object({ acceptedUserMessageId: idSchema, acceptedTurnId: idSchema,
    canonicalActionHash: sha256Schema, approvedAt: isoDateSchema,
    basis: z.enum(['explicit-request', 'proposal-selection', 'conflict-acceptance']),
    proposalId: idSchema.nullable(), conditionFingerprint: sha256Schema.nullable() }).strict(),
  deliveryRetries: z.number().int().min(0).max(2), createdAt: isoDateSchema, updatedAt: isoDateSchema,
  auditExpiresAt: isoDateSchema, state: operationStateV2Schema, receipt: calendarReceiptV2Schema.nullable(),
  failure: calendarFailureSchema.nullable(),
}).strict().refine(v => {
  const a = v.authorization, r = v.receipt;
  return a.canonicalActionHash === v.requestHash
    && a.acceptedTurnId === v.turnId
    && (a.basis === 'explicit-request' || a.proposalId !== null)
    && (a.basis !== 'conflict-acceptance' || a.conditionFingerprint !== null)
    && (!['planned', 'dispatching'].includes(v.state) || v.action !== null)
    && (v.action === null || v.action.calendarId === v.calendarId)
    && ((v.state === 'succeeded') === (r !== null))
    && (v.state !== 'evidence-expired' || v.action === null)
    && ((v.calendarLabel === null) === (v.labelExpiresAt === null))
    && v.actionSources.every(s => s.permission.minimalEvidenceAllowed
      && s.connectionId === v.connectionId && s.connectionRevision === v.connectionRevision
      && (v.action === null || s.permission.content === 'retained'))
    && Date.parse(v.auditExpiresAt) >= Date.parse(v.createdAt)
    && Date.parse(v.auditExpiresAt) - Date.parse(v.createdAt) <= 2592000000
    && (r === null || (r.operationId === v.operationId && r.googleEventId === v.googleEventId
      && r.requestHash === v.requestHash && r.calendarId === v.calendarId
      && r.connectionId === v.connectionId && r.connectionRevision === v.connectionRevision
      && r.targetRevision === v.targetRevision));
});
export type CalendarOperationV2 = z.infer<typeof operationRecordV2Schema>;
export const calendarExecutionBindingV2Schema = calendarAccountBindingSchema.extend({
  target: calendarResolvedTargetSchema.nullable(),
  sessionId: idSchema, turnId: idSchema, attemptId: idSchema, decisionId: idSchema, toolCallId: idSchema,
  schemaRevision: z.literal('google-calendar.v2'), operation: operationRecordV2Schema.nullable(),
  trustedNow: isoDateSchema, trustedTimeZone: z.string().min(1).max(100), deadlineAt: isoDateSchema,
}).strict().refine(v => {
  const t = v.target, o = v.operation;
  return Date.parse(v.deadlineAt) > Date.parse(v.trustedNow)
    && (t === null || (t.userId === v.userId && t.connectionId === v.connectionId
      && t.connectionRevision === v.connectionRevision && t.googleSubjectId === v.googleSubjectId))
    && (o === null || (t !== null && o.userId === v.userId && o.sessionId === v.sessionId
      && o.connectionId === v.connectionId && o.connectionRevision === v.connectionRevision
      && o.googleSubjectId === v.googleSubjectId && o.calendarId === t.calendarId
      && o.targetRevision === t.targetRevision));
});
export type CalendarExecutionBindingV2 = z.infer<typeof calendarExecutionBindingV2Schema>;
export const calendarRequestKindSchema = z.enum(['list', 'get', 'create', 'readback',
  'discovery', 'availability', 'preflight', 'capability-recheck']);
export type CalendarRequestKindV2 = z.infer<typeof calendarRequestKindSchema>;
export type CalendarExecutionResultV2 =
  | { outcome: 'success'; result: CalendarResultV2; source: CalendarSourceReferenceV2; receipt: CalendarReceiptV2 | null }
  | { outcome: 'failure'; failure: CalendarFailure };
export interface CalendarExecutionPortV2 {
  invoke(input: { binding: CalendarExecutionBindingV2; call: CalendarCall; signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKindV2) => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<CalendarExecutionResultV2>;
  readback(input: { binding: CalendarExecutionBindingV2; operation: CalendarOperationV2; signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKindV2) => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<{ outcome: 'matched'; receipt: CalendarReceiptV2 }
      | { outcome: 'absent' | 'mismatch' | 'unknown' }>;
  close(): Promise<void>;
}
```

The fixture's canonical create has `calendarId` resolved before persistence, even when the model omitted it. Do not hash a mutable default. P6 computes the canonical hash from validated target/action; these schemas enforce equality of references, not extraction of user intent. A preference is absent from `CalendarExecutionBindingV2` and the cursor fingerprint by design. Its nested `target` is nullable so discovery and cross-calendar availability remain callable when primary/default is missing; P5 must resolve/check a non-null target before any of the three event tools, and readback always rebinds the original operation's target. Do not require a default merely to list calendars. P2 freezes root target/account/event IDs across all transitions and unique intent reservation; P6 consumes the authority on admission. Internal discovery/preflight/rechecks consume `calendarRequests`, **not** an extra logical model tool; every retry delivery counts. The existing delivery-retry fields retain maximum 2 and do not grant retry permission to create.

**Retention completion inside this task:** Add the following exact fields/conjuncts to the named object/refinement. This makes the 10-minute proposal ceiling subordinate to actual permission for cached labels. Change `operationV2.actionSources` to `[sourceV2]` in the fixture; the extra source is needed because its label is retained content.

```ts
// calendarProposalSchema object fields:
retentionPolicyId: idSchema, contentExpiresAt: isoDateSchema,
// calendarProposalSchema refinement return conjunct:
&& Date.parse(v.expiresAt) <= Date.parse(v.contentExpiresAt)
// proposal fixture fields:
retentionPolicyId: 'approved-fixture', contentExpiresAt: '2026-10-22T10:10:00.000Z',
// operationRecordV2Schema refinement return conjunct:
&& (v.calendarLabel === null || (v.labelExpiresAt !== null
  && Date.parse(v.labelExpiresAt) >= Date.parse(v.createdAt)
  && Date.parse(v.labelExpiresAt) <= Date.parse(v.createdAt) + 86400000
  && v.actionSources.some(s => s.permission.content === 'retained'
    && Date.parse(s.expiresAt) >= Date.parse(v.labelExpiresAt!)
    && s.targets.some(t => t.calendarId === v.calendarId && t.calendarLabel === v.calendarLabel))))
// calendarReceiptV2Schema refinement return conjunct:
&& (v.labelExpiresAt === null || Date.parse(v.labelExpiresAt) >= Date.parse(v.verifiedAt))
```

Record tombstones without names on expiry; P2/P6 implement actual redaction. A denied retention policy cannot be converted into permission by these fields; P4/P8 must supply approved evidence or refuse durable content. Do not treat a discovery freshness expiry as independent permission to retain content longer.

Add the exact tests below before green:

```ts
it('refuses label or proposal content beyond its source permission', () => {
  expect(operationRecordV2Schema.safeParse({ ...operationV2, actionSources: [] }).success).toBe(false);
  expect(operationRecordV2Schema.safeParse({ ...operationV2, labelExpiresAt: '2026-10-23T10:00:00.001Z' }).success).toBe(false);
  expect(sourceReferenceV2Schema.safeParse({ ...sourceV2, expiresAt: at,
    permission: { ...sourceV2.permission, content: 'volatile' } }).success).toBe(false);
});
```

Add `calendarOperationTransitionV2Schema` to the operation test import and append this exact additional regression and pair schema. P2 remains the transition writer; P1 freezes its immutable authority rather than relying on prose.

```ts
it('does not retarget a persisted operation during revision transitions', () => {
  const previous = operationRecordV2Schema.parse(operationV2);
  const next = { ...previous, revision: 2, sequence: 1, updatedAt: until };
  expect(calendarOperationTransitionV2Schema.safeParse({ previous, next }).success).toBe(true);
  const changed = { ...next, calendarId: 'other', calendarLabel: null, labelExpiresAt: null,
    action: { ...next.action!, calendarId: 'other' }, actionSources: [] };
  expect(operationRecordV2Schema.safeParse(changed).success).toBe(true);
  expect(calendarOperationTransitionV2Schema.safeParse({ previous, next: changed }).success).toBe(false);
});
```

```ts
export const calendarOperationTransitionV2Schema = z.object({ previous: operationRecordV2Schema,
  next: operationRecordV2Schema }).strict().refine(({ previous: p, next: n }) =>
  n.revision === p.revision + 1 && n.sequence > p.sequence
  && (['userId', 'sessionId', 'turnId', 'operationId', 'originatingAttemptId', 'intentId',
    'originatingTurnId', 'originatingAcceptedMessageId', 'connectionId', 'connectionRevision',
    'googleSubjectId', 'calendarId', 'targetRevision', 'requestHash', 'googleEventId',
    'schemaRevision', 'proofRevision'] as const).every(key => p[key] === n[key])
  && JSON.stringify(p.authorization) === JSON.stringify(n.authorization)
  && (!['succeeded', 'definitely-failed', 'failed', 'cancelled', 'evidence-expired'].includes(p.state)
    || n.state === p.state || n.state === 'evidence-expired')
  && (p.state !== 'unknown' || n.state !== 'dispatching'));
```

Use `CalendarSourceReferenceV2` in v2 complete tool groups/messages, not v1 source slots. `message.ts` consumers may require an explicit compatible source union once P6 migrates; that schema is P1-owned, so any request for such an amendment returns to P1 with a focused failing contract test. Do not widen generic transcript/history semantics speculatively.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/contracts/calendar-multi-operations.spec.ts test/contracts/calendar-multi-authority.spec.ts test/contracts/calendar-sources.spec.ts test/contracts/calendar-operations.spec.ts`.
- [ ] **Commit named files:** `git commit -m "feat(calendar): pin operation authority and multi-calendar result provenance"`.

## Task 7: Freeze read-only compatibility, terminal legacy admission, cursor/checkpoint, model, and accounting versions

**Files:** Create `backend/src/contracts/calendar-compatibility.ts`, `backend/test/contracts/calendar-multi-compatibility.spec.ts`; append v2 exports to `calendar-model.ts`, `calendar-accounting.ts`, `calendar-operations.ts`.

- [ ] **Write the failing test:**

```ts
import { expect, it } from 'vitest';
import { compatibleCalendarConnectionSchema, compatibleCalendarOperationSchema,
  compatibleCalendarReceiptSchema, calendarCursorV2PayloadSchema, compatibleCalendarCursorPayloadSchema,
  compatibleCalendarCheckpointRefsSchema, legacyOperationDisposition, calendarLegacyDispositionSchema,
} from '../../src/contracts/calendar-compatibility.js';
import { CALENDAR_SCOPES_V1 } from '../../src/contracts/calendar-policy.js';
import { resumableDecisionV2Schema, rejectedDecisionV2Schema } from '../../src/contracts/calendar-model.js';
import { modelDispatchV2Schema } from '../../src/contracts/calendar-accounting.js';
import { operationV1, receiptV1, at, hash } from './calendar-multi-fixtures.js';

it('decodes v1 faithfully while denying new authority and preserving uncertain effects', () => {
  const credentials = { access: null, refresh: { version: 1, iv: 'i', tag: 't', ciphertext: 'cipher' } };
  const old = { schemaVersion: 1, userId: 'u', provider: 'google-calendar', connectionId: 'c',
    revision: 1, connectionRevision: 1, credentialVersion: 1, googleSubjectId: 'sub', accountEmail: null,
    calendarId: operationV1.calendarId, targetRevision: 1, enabled: true, status: 'connected',
    credentials, tokenExpiresAt: null, grantedScopes: [...CALENDAR_SCOPES_V1], updatedAt: at };
  expect(compatibleCalendarConnectionSchema.parse(old)).toEqual(old);
  expect(compatibleCalendarOperationSchema.parse(operationV1)).toEqual({ ...operationV1, actionSources: [] });
  expect(compatibleCalendarReceiptSchema.parse(receiptV1)).toEqual(receiptV1);
  const complete = { ...operationV1, state: 'succeeded', receipt: receiptV1 };
  expect(compatibleCalendarOperationSchema.parse(complete).receipt).toEqual(receiptV1);
  expect(legacyOperationDisposition(compatibleCalendarOperationSchema.parse(operationV1), at))
    .toMatchObject({ state: 'failed', externalOutcome: 'not-dispatched', reconcileOriginal: false });
  const unknown = compatibleCalendarOperationSchema.parse({ ...operationV1, state: 'unknown' });
  const disposition = legacyOperationDisposition(unknown, at);
  expect(disposition).toMatchObject({ state: 'cancelled', externalOutcome: 'unknown', reconcileOriginal: true });
  expect(calendarLegacyDispositionSchema.safeParse({ ...disposition, reconcileOriginal: false }).success).toBe(false);
  expect(legacyOperationDisposition(compatibleCalendarOperationSchema.parse(complete), at)).toBeNull();
  const v1cursor = { v: 1, b: hash, q: hash, t: 'opaque-provider-token' };
  expect(compatibleCalendarCursorPayloadSchema.parse(v1cursor)).toEqual(v1cursor);
  expect(calendarCursorV2PayloadSchema.safeParse(v1cursor).success).toBe(false);
  const v2cursor = { ...v1cursor, v: 2, kind: 'events', discoveryRevision: 1, expiresAt: at };
  expect(calendarCursorV2PayloadSchema.safeParse(v2cursor).success).toBe(true);
  expect(calendarCursorV2PayloadSchema.safeParse({ ...v2cursor, defaultSettingRevision: 2 }).success).toBe(false);
  const checkpoint = { version: 1, userId: 'u', sessionId: 's', turnId: 't',
    decisionIds: ['d'], toolCallIds: ['call'], operationId: 'op' };
  expect(compatibleCalendarCheckpointRefsSchema.parse(checkpoint)).toEqual(checkpoint);
  expect(resumableDecisionV2Schema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  expect(rejectedDecisionV2Schema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  expect(modelDispatchV2Schema.safeParse({ schemaVersion: 1 }).success).toBe(false);
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/contracts/calendar-multi-compatibility.spec.ts -t "decodes v1 faithfully"`.
- [ ] **Minimal implementation**, `calendar-compatibility.ts`:

```ts
import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { connectionRecordSchema, sha256Schema } from './calendar-connections.js';
import { calendarConnectionV2Schema } from './calendar-discovery.js';
import { operationRecordSchema, operationRecordV2Schema, calendarReceiptSchema, calendarReceiptV2Schema,
  type CalendarOperation, type CalendarOperationV2 } from './calendar-operations.js';
import { sourceReferenceSchema, sourceReferenceV2Schema, calendarToolResultRecordSchema,
  calendarToolResultRecordV2Schema } from './calendar-sources.js';
import { resumableDecisionSchema, resumableDecisionV2Schema,
  rejectedDecisionSchema, rejectedDecisionV2Schema } from './calendar-model.js';
import { modelDispatchSchema, modelDispatchV2Schema } from './calendar-accounting.js';

export const compatibleCalendarConnectionSchema = z.union([connectionRecordSchema, calendarConnectionV2Schema]);
export const compatibleCalendarOperationSchema = z.union([operationRecordSchema, operationRecordV2Schema]);
export const compatibleCalendarReceiptSchema = z.union([calendarReceiptSchema, calendarReceiptV2Schema]);
export const compatibleCalendarSourceSchema = z.union([sourceReferenceSchema, sourceReferenceV2Schema]);
export const compatibleCalendarResultRecordSchema = z.union([calendarToolResultRecordSchema, calendarToolResultRecordV2Schema]);
export const compatibleCalendarDecisionSchema = z.union([resumableDecisionSchema, resumableDecisionV2Schema]);
export const compatibleCalendarRejectedDecisionSchema = z.union([rejectedDecisionSchema, rejectedDecisionV2Schema]);
export const compatibleCalendarDispatchSchema = z.union([modelDispatchSchema, modelDispatchV2Schema]);
export const calendarCursorV1PayloadSchema = z.object({ v: z.literal(1), b: sha256Schema,
  q: sha256Schema, t: z.string().min(1).max(2048) }).strict();
export const calendarCursorV2PayloadSchema = z.object({ v: z.literal(2), b: sha256Schema,
  q: sha256Schema, t: z.string().min(1).max(2048), kind: z.enum(['events', 'calendars']),
  discoveryRevision: z.number().int().positive(), expiresAt: isoDateSchema }).strict();
export const compatibleCalendarCursorPayloadSchema = z.union([calendarCursorV1PayloadSchema, calendarCursorV2PayloadSchema]);
export const calendarCheckpointRefsV1Schema = z.object({ version: z.literal(1), userId: idSchema,
  sessionId: idSchema, turnId: idSchema, decisionIds: z.array(idSchema).max(8),
  toolCallIds: z.array(idSchema).max(6), operationId: idSchema.nullable() }).strict();
export const calendarCheckpointRefsV2Schema = z.object({ version: z.literal(2), userId: idSchema,
  sessionId: idSchema, turnId: idSchema, decisionIds: z.array(idSchema).max(8),
  toolCallIds: z.array(idSchema).max(6), operationId: idSchema.nullable(),
  intentId: idSchema.nullable(), proposalId: idSchema.nullable(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v2'),
}).strict();
export const compatibleCalendarCheckpointRefsSchema = z.union([calendarCheckpointRefsV1Schema, calendarCheckpointRefsV2Schema]);
export const calendarLegacyDispositionSchema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-legacy-disposition'), userId: idSchema, sessionId: idSchema,
  turnId: idSchema, legacyKind: z.enum(['operation', 'decision', 'checkpoint']), legacyRecordId: idSchema,
  operationId: idSchema.nullable(), state: z.enum(['failed', 'cancelled']),
  externalOutcome: z.enum(['not-dispatched', 'unknown', 'known-terminal']),
  reconcileOriginal: z.boolean(), reason: z.literal('legacy-read-only'), at: isoDateSchema,
}).strict().refine(v => (v.externalOutcome !== 'unknown' || (v.reconcileOriginal && v.operationId !== null))
  && (!v.reconcileOriginal || v.operationId !== null));
export type CalendarLegacyDisposition = z.infer<typeof calendarLegacyDispositionSchema>;
export function legacyOperationDisposition(op: CalendarOperation | CalendarOperationV2,
  now: string): CalendarLegacyDisposition | null {
  if (op.schemaVersion !== 1 || ['succeeded', 'definitely-failed', 'evidence-expired'].includes(op.state)) return null;
  const uncertain = ['dispatching', 'unknown'].includes(op.state);
  return calendarLegacyDispositionSchema.parse({ schemaVersion: 2, kind: 'calendar-legacy-disposition',
    userId: op.userId, sessionId: op.sessionId, turnId: op.turnId, legacyKind: 'operation',
    legacyRecordId: op.operationId, operationId: op.operationId,
    state: uncertain ? 'cancelled' : 'failed', externalOutcome: uncertain ? 'unknown' : 'not-dispatched',
    reconcileOriginal: uncertain, reason: 'legacy-read-only', at: now });
}
```

**Cursor handoff:** P5 replaces its local `CURSOR_VERSION = 1` with the shared version 2 and uses the v2 payload schema, HMAC, ≤2048 encoded characters, canonical target/query/account/discovery binding and expiry. These payload decoders **do not** verify HMAC and are never accepted as bearer authority. Stored legacy cursors are inspectable, not dispatchable; offer a fresh bounded query after re-consent instead of promoting an old signature. P2 explicitly migrates its existing checkpoint validator to the compatible schema; a v1 checkpoint never resumes a v2 effect. Keep the original scope/role/proof evidence unchanged.

**Model additive schemas**, append to `calendar-model.ts` with `sourceReferenceV2Schema` imported:

```ts
export const completeToolGroupV2Schema = z.object({ assistant: nativeAssistantToolSchema,
  result: nativeToolResultSchema, sources: z.array(sourceReferenceV2Schema).max(6) }).strict().refine(v =>
  v.assistant.tool_calls[0].id === v.result.tool_call_id
    && v.assistant.tool_calls[0].function.name === v.result.name);
export const rejectedDecisionV2Schema = rejectedDecisionSchema.extend({ schemaVersion: z.literal(2),
  schemaRevision: z.literal('google-calendar.v2') }).strict();
export const resumableDecisionV2Schema = z.object({ schemaVersion: z.literal(2), kind: z.literal('calendar-model-decision'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema, decisionId: idSchema,
  dispatchId: idSchema, configRevision: z.number().int().nonnegative(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v2'),
  rejectedDecisionId: idSchema.nullable(), decision: calendarDecisionSchema.nullable(),
  sources: z.array(sourceReferenceV2Schema).max(6), operationId: idSchema.nullable(),
  intentId: idSchema.nullable(), proposalId: idSchema.nullable(), createdAt: isoDateSchema,
}).strict().refine(v => v.sources.every(s => s.permission.minimalEvidenceAllowed
    && s.connectionId === v.connectionId && s.connectionRevision === v.connectionRevision)
  && (v.decision === null || (v.decision.decisionId === v.decisionId
    && v.sources.every(s => s.permission.content === 'retained'
      && Date.parse(s.expiresAt) > Date.parse(v.createdAt)))));
export type CalendarRejectedDecisionV2 = z.infer<typeof rejectedDecisionV2Schema>;
export type ResumableCalendarDecisionV2 = z.infer<typeof resumableDecisionV2Schema>;
export type CalendarDecisionChunkV2 = Exclude<CalendarDecisionChunk, { type: 'rejected' }>
  | { type: 'rejected'; evidence: CalendarRejectedDecisionV2 };
export interface CalendarModelPortV2 {
  stream(request: CalendarDecisionRequest): AsyncIterable<CalendarDecisionChunkV2>;
}
export interface CalendarDecisionStoreV2 {
  put(record: ResumableCalendarDecisionV2): Promise<void>;
  get(userId: string, decisionId: string): Promise<ResumableCalendarDecision | ResumableCalendarDecisionV2 | null>;
  putRejected(record: CalendarRejectedDecisionV2): Promise<void>;
}
```

**Accounting additive schema**, append to `calendar-accounting.ts`:

```ts
export const modelDispatchV2Schema = z.object({ schemaVersion: z.literal(2), kind: z.literal('calendar-model-dispatch'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema, dispatchId: idSchema,
  decisionId: idSchema, dispatchIndex: z.number().int().min(1).max(8),
  reason: z.enum(['initial', 'continuation', 'schema-repair', 'provider-retry']), repairedDecisionId: idSchema.nullable(),
  requestedModel: z.string().min(1).max(200), reportedModel: z.string().min(1).max(200).nullable(),
  reportedProvider: z.string().min(1).max(200).nullable(), openRouterUser: idSchema,
  configRevision: z.number().int().nonnegative(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v2'),
  generationId: z.string().min(1).max(200).nullable(), providerRequestId: z.string().min(1).max(200).nullable(),
  status: z.enum(['reserved', 'dispatched', 'terminal', 'not-dispatched']),
  startedAt: isoDateSchema, endedAt: isoDateSchema.nullable(), firstOutputAt: isoDateSchema.nullable(),
  promptTokens: usageCountSchema, completionTokens: usageCountSchema, cachedPromptTokens: usageCountSchema,
  cacheWriteTokens: usageCountSchema, reasoningOutputTokens: usageCountSchema,
  money: moneyEvidenceSchema, pricing: tokenPricingSchema, reservationUsd: decimalSchema,
  reservationStatus: z.enum(['held', 'settled', 'released-not-dispatched']), failure: calendarFailureSchema.nullable(),
}).strict().refine(v => (v.reservationStatus !== 'settled' || v.money.costStatus === 'known')
  && (v.money.costStatus !== 'known' || v.reservationStatus === 'settled')
  && (v.reservationStatus !== 'released-not-dispatched' || v.status === 'not-dispatched')
  && (v.reason !== 'schema-repair' || v.repairedDecisionId !== null));
export type CalendarModelDispatchV2 = z.infer<typeof modelDispatchV2Schema>;
export interface CalendarAccountingStoreV2 extends Omit<CalendarAccountingStore,
  'putDispatch' | 'getDispatch' | 'listDispatches'> {
  putDispatch(record: CalendarModelDispatchV2): Promise<void>;
  getDispatch(userId: string, dispatchId: string): Promise<CalendarModelDispatch | CalendarModelDispatchV2 | null>;
  listDispatches(userId: string, turnId: string): Promise<(CalendarModelDispatch | CalendarModelDispatchV2)[]>;
}
```

Do **not** bump `turnBudgetRecordSchema` or `modelAggregateSchema` merely because tools changed: their existing v1 format and ceilings remain semantically sufficient. Exact money arithmetic/unknown reservation/legacy preference functions stay unchanged. Request categories extend attribution, not spend math. Add `CalendarRequestKindV2` to the new v2 execution/accounting handoff; old request-kind interfaces remain intact until their owners migrate.

**Operation-store port**, append to `calendar-operations.ts`:

```ts
export interface CalendarOperationStoreV2 {
  getByTurn(userId: string, sessionId: string, turnId: string): Promise<CalendarOperation | CalendarOperationV2 | null>;
  getByIntent(userId: string, sessionId: string, intentId: string): Promise<CalendarOperationV2 | null>;
  reserveByIntent(input: { operation: CalendarOperationV2; consumption: CalendarProposalConsumption | null }):
    Promise<{ outcome: 'created' | 'existing'; operation: CalendarOperationV2 } | { outcome: 'uncertain' }>;
  compareAndSwap(input: { expectedRevision: number; next: CalendarOperationV2 }):
    Promise<{ outcome: 'confirmed'; operation: CalendarOperationV2 } | { outcome: 'conflict' | 'uncertain' }>;
}
```

Import `CalendarProposalConsumption` as **type-only** from `calendar-authority.js`. The consumption link and reserve share idempotent intent authority but do not presume a transaction: P2 documents recovery if either acknowledgement is uncertain. Pending proposal expiry cannot erase the reserved operation.

Append this source-result store port to `calendar-sources.ts`; it admits only v2 writes but returns both versions for explicit compatibility handling. It is not a second persistence owner.

```ts
export interface CalendarResultStoreV2 {
  put(record: CalendarToolResultRecordV2): Promise<void>;
  get(userId: string, sessionId: string, toolCallId: string):
    Promise<CalendarToolResultRecord | CalendarToolResultRecordV2 | null>;
}
```

P2 consumes `CalendarDecisionStoreV2`, `CalendarAccountingStoreV2` and `CalendarResultStoreV2`; P5 consumes `CalendarModelPortV2` where it publishes revised model decisions. The old names remain legacy ports, not aliases silently accepting v2 writes. Include `calendar-sources.ts` among this task's named staged files.

Add positive tests for v2 rejected/decision/dispatch records, not just missing-field refusals. Use these exact small checks (add imports for `sourceV2`, `until`, `unavailableMoney`):

```ts
it('admits explicit v2 model evidence without replenishing v1 counters', () => {
  const rejected = { schemaVersion: 2, schemaRevision: 'google-calendar.v2', kind: 'calendar-rejected-decision',
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch',
    dispatchIndex: 1, repairsUsed: 0, rawArgumentsSha256: hash,
    diagnostics: [{ path: 'calendarId', code: 'wrong-type', expected: 'string' }], createdAt: at };
  expect(rejectedDecisionV2Schema.safeParse(rejected).success).toBe(true);
  const decision = { schemaVersion: 2, kind: 'calendar-model-decision', userId: 'u', sessionId: 's',
    turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch', configRevision: 1,
    connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v2', rejectedDecisionId: null,
    decision: null, sources: [], operationId: null, intentId: null, proposalId: null, createdAt: at };
  expect(resumableDecisionV2Schema.safeParse(decision).success).toBe(true);
  const dispatch = { schemaVersion: 2, kind: 'calendar-model-dispatch', userId: 'u', sessionId: 's',
    turnId: 't', attemptId: 'a', dispatchId: 'dispatch', decisionId: 'd', dispatchIndex: 1,
    reason: 'initial', repairedDecisionId: null, requestedModel: 'fixture', reportedModel: null,
    reportedProvider: null, openRouterUser: 'u', configRevision: 1, connectionId: 'c', connectionRevision: 1,
    schemaRevision: 'google-calendar.v2', generationId: null, providerRequestId: null, status: 'reserved',
    startedAt: at, endedAt: null, firstOutputAt: null, promptTokens: null, completionTokens: null,
    cachedPromptTokens: null, cacheWriteTokens: null, reasoningOutputTokens: null,
    money: unavailableMoney(true), reservationUsd: '0.1', reservationStatus: 'held', failure: null,
    pricing: { version: 'p', source: 'fixture', observedAt: at, modelId: 'fixture', providerRoute: 'fixture',
      promptUsdPerToken: '0', completionUsdPerToken: '0', requestUsd: '0' } };
  expect(modelDispatchV2Schema.safeParse(dispatch).success).toBe(true);
  expect(modelDispatchV2Schema.safeParse({ ...dispatch, reasoning: 'forbidden' }).success).toBe(false);
  expect(modelDispatchV2Schema.safeParse({ ...dispatch, dispatchIndex: 9 }).success).toBe(false);
  expect(sourceV2.expiresAt).toBe(until);
});
```

P2 migrates codecs/stores/checkpoints; P5 migrates cursor signing and active model consumers; P6 migrates graph/runtime. These are handoffs, not permission for P1 to edit their implementation. Rollback is **read-only v2 evidence preservation**, not loading v2 into the old binary or downgrading scopes. P2/P8 must stop admission and preserve/quarantine nonterminal effects before rollback; restoring an old binary without explicit compatible storage is not certified by these decoders.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/contracts/calendar-multi-compatibility.spec.ts test/contracts/calendar-model.spec.ts test/contracts/calendar-accounting.spec.ts`.
- [ ] **Commit named files:** `git commit -m "feat(calendar): preserve read-only v1 evidence and freeze v2 recovery contracts"`.

## Task 8: Freeze additive status/settings/discovery and truthful target receipt wire contracts

**Files:** Modify `backend/src/contracts/calendar-wire.ts`, `api.ts`, `runtime.ts`; create `backend/test/contracts/calendar-multi-wire.spec.ts`. Existing wire v1/status and stream v2 fixtures remain unchanged.

- [ ] **Write the failing test:**

```ts
import { expect, it } from 'vitest';
import { calendarSettingsV2RequestSchema, calendarStatusV2ResponseSchema,
  calendarTurnStateV2Schema, calendarMultiStreamEnvelopeSchema, parseCalendarCompatibleFrame,
  CALENDAR_API_ROUTES, calendarCalendarsQuerySchema,
} from '../../src/contracts/calendar-wire.js';
import { submitTurnRequestSchema, retryTurnRequestSchema } from '../../src/contracts/api.js';
import { at, until } from './calendar-multi-fixtures.js';

it('versions public targeting without toggling enablement or manufacturing receipt authority', () => {
  const preference = { defaultSetting: { calendarId: null, expectedRevision: 1,
    expectedConnectionRevision: 1 } };
  expect(calendarSettingsV2RequestSchema.parse(preference)).toEqual(preference);
  expect(calendarSettingsV2RequestSchema.safeParse({ enabled: false }).success).toBe(true);
  expect(calendarSettingsV2RequestSchema.safeParse({}).success).toBe(false);
  expect(calendarSettingsV2RequestSchema.safeParse({ defaultSetting: { calendarId: 'primary' } }).success).toBe(false);
  expect(calendarSettingsV2RequestSchema.safeParse({ ...preference, userId: 'forged' }).success).toBe(false);
  expect(CALENDAR_API_ROUTES.calendars).toBe('/plugins/google-calendar/calendars');
  expect(CALENDAR_API_ROUTES.calendarsRefresh).toBe('/plugins/google-calendar/calendars/refresh');
  expect(calendarCalendarsQuerySchema.safeParse({ pageToken: 'x'.repeat(2049) }).success).toBe(false);
  const status = { protocolVersion: 2, state: 'reconnect-required', enabled: false,
    accountEmail: null, processingDisclosure: null, connectionRevision: 1,
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 1 },
    primaryCalendarId: null, discovery: null,
    missingScopes: ['https://www.googleapis.com/auth/calendar.freebusy'] };
  expect(calendarStatusV2ResponseSchema.safeParse(status).success).toBe(true);
  expect(calendarStatusV2ResponseSchema.safeParse({ ...status, accessToken: 'secret' }).success).toBe(false);
  const operation = { schemaVersion: 2, operationId: 'op', state: 'succeeded', narration: 'failed',
    retryAction: 'none', receipt: { durable: true, eventId: 'abcde01234', htmlLink: null,
      expiresAt: until, calendarLabel: 'Team' } };
  expect(calendarTurnStateV2Schema.safeParse(operation).success).toBe(true);
  expect(calendarTurnStateV2Schema.safeParse({ ...operation, state: 'unknown' }).success).toBe(false);
  expect(calendarTurnStateV2Schema.safeParse({ ...operation, receipt: { ...operation.receipt,
    htmlLink: 'javascript:alert(1)' } }).success).toBe(false);
  const frame = { protocolVersion: 3, sessionId: 's', turnId: 't', attemptId: 'a', sequence: 1,
    event: { type: 'calendar-operation', operation } };
  expect(calendarMultiStreamEnvelopeSchema.safeParse(frame).success).toBe(true);
  expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(frame)}`)).toEqual(frame);
  expect(submitTurnRequestSchema.safeParse({ sessionId: null, content: 'hello',
    idempotencyKey: 'request-key', calendarProtocol: 3 }).success).toBe(true);
  expect(retryTurnRequestSchema.safeParse({ idempotencyKey: 'request-key', calendarProtocol: 3 }).success).toBe(true);
  expect(at).not.toBe(until);
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/contracts/calendar-multi-wire.spec.ts -t "versions public targeting"`.
- [ ] **Minimal implementation:** append to `calendar-wire.ts`; add imports for `calendarCanonicalIdSchema`, `calendarDefaultSettingSchema`, `calendarListCalendarsResultSchema`, `operationStateV2Schema`. Add `calendars`/`calendarsRefresh` to the existing `CALENDAR_API_ROUTES` object (do not redeclare it).

```ts
export const calendarSettingsV2RequestSchema = z.object({ enabled: z.boolean().optional(),
  defaultSetting: z.object({ calendarId: calendarCanonicalIdSchema.nullable(),
    expectedRevision: z.number().int().positive(), expectedConnectionRevision: z.number().int().positive() })
    .strict().optional(),
}).strict().refine(v => v.enabled !== undefined || v.defaultSetting !== undefined);
export const calendarCalendarsQuerySchema = z.object({ pageToken: z.string().min(1).max(2048).optional() }).strict();
export const calendarCalendarsResponseSchema = z.object({ protocolVersion: z.literal(2),
  page: calendarListCalendarsResultSchema }).strict();
export const calendarRefreshRequestSchema = z.object({ expectedConnectionRevision: z.number().int().positive() }).strict();
export const calendarStatusV2ResponseSchema = calendarStatusResponseSchema.omit({ targetCalendarId: true }).extend({
  protocolVersion: z.literal(2), connectionRevision: z.number().int().positive().nullable(),
  defaultSetting: calendarDefaultSettingSchema.nullable(), primaryCalendarId: calendarCanonicalIdSchema.nullable(),
  discovery: z.object({ discoveryRevision: z.number().int().positive(), fetchedAt: isoDateSchema,
    expiresAt: isoDateSchema, complete: z.boolean(), truncated: z.boolean(), stale: z.boolean() }).strict().nullable(),
  missingScopes: z.array(z.string().min(1).max(200)).max(5),
}).strict().refine(v => v.state !== 'connected' || v.missingScopes.length === 0);
export const calendarTurnStateV2Schema = z.object({ schemaVersion: z.literal(2), operationId: idSchema,
  state: operationStateV2Schema, narration: z.enum(['pending', 'completed', 'failed', 'interrupted']),
  retryAction: z.enum(['none', 'resume-reconciliation', 'reconnect', 'clarify', 'blocked-expired']),
  receipt: z.object({ durable: z.literal(true), eventId: z.string().min(5).max(1024),
    htmlLink: safeCalendarLinkSchema.nullable(), expiresAt: isoDateSchema.nullable(),
    calendarLabel: z.string().min(1).max(200).nullable() }).strict().nullable(),
}).strict().refine(v => (v.state === 'succeeded') === (v.receipt !== null)
  && ((v.receipt?.htmlLink == null && v.receipt?.calendarLabel == null) || v.receipt?.expiresAt != null));
export const calendarCompatibleTurnStateSchema = z.union([calendarTurnStateSchema, calendarTurnStateV2Schema]);
export const calendarClarificationWireSchema = z.object({ type: z.literal('calendar-clarification'),
  proposalId: idSchema, expiresAt: isoDateSchema, reason: z.enum(['target', 'details', 'conflict', 'coverage']),
  message: z.string().min(1).max(1000), candidates: z.array(z.object({
    calendarId: calendarCanonicalIdSchema, label: z.string().min(1).max(200),
    role: z.enum(['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader']),
  }).strict()).max(20),
}).strict();
export const calendarMultiStreamEnvelopeSchema = z.object({ protocolVersion: z.literal(3),
  sessionId: idSchema, turnId: idSchema, attemptId: idSchema, sequence: sequenceSchema,
  event: z.union([streamEventSchema, calendarProgressEventSchema,
    z.object({ type: z.literal('calendar-operation'), operation: calendarTurnStateV2Schema }).strict(),
    calendarClarificationWireSchema]),
}).strict().refine(v => Buffer.byteLength(JSON.stringify(v), 'utf8') <= 16384);
```

Replace the existing compatible stream union with:

```ts
export const calendarCompatibleEnvelopeSchema = z.union([
  streamEnvelopeSchema, calendarStreamEnvelopeSchema, calendarMultiStreamEnvelopeSchema,
]);
```

Move that compatible union and `parseCalendarCompatibleFrame` below the new declarations to avoid initialization before declaration. Keep their function/type names. Their legacy stream schemas are unchanged. Add `export const CALENDAR_STATUS_PROTOCOL_V2 = 2 as const` and `export const CALENDAR_STREAM_PROTOCOL_V2 = 3 as const`; the historical stream protocol is already 2, so Phase 2 uses 3 instead of reinterpreting it. P7/P8 migrate negotiation explicitly; no v3 frame is sent to an old client simply because a decoder supports it.

In `api.ts`, both optional `calendarProtocol` fields become `z.union([z.literal(2), z.literal(3)]).optional()`; change the status `calendar` field/import to `calendarCompatibleTurnStateSchema`. In `runtime.ts`, both `calendarProtocol?: 2` fields become `calendarProtocol?: 2 | 3`. No ordinary text/voice/canvas field changes.

**Frozen error outcome handoff (P3/P4/P5/P6, not P1 provider code):**

| Condition | Contract outcome/code | Retry / connection semantics |
| --- | --- | --- |
| Missing Phase 2 grant scope | credential / `CALENDAR_RECONNECT_REQUIRED` | `none`; expose bounded `missingScopes`, refresh cannot widen grant |
| Unknown explicit target / missing primary / invalid saved default | clarification / `CALENDAR_TARGET_UNKNOWN`, `CALENDAR_PRIMARY_MISSING`, `CALENDAR_DEFAULT_UNAVAILABLE` | `none`; no fallback |
| Read-only target for create | policy / `CALENDAR_TARGET_READ_ONLY` | `none`; never conflict-overridable |
| 403 `rateLimitExceeded` or `userRateLimitExceeded`, 429 | delivery / `CALENDAR_RATE_LIMITED` | reads/discovery/availability only: eligible bounded delivery retry; create never reinserted |
| 5xx read | delivery / existing `CALENDAR_TEMPORARILY_UNAVAILABLE` | eligible bounded retry; same remaining turn deadline/request/retry budget |
| 5xx/transport uncertainty after create | uncertain / existing `WRITE_OUTCOME_UNKNOWN` | `readback` of original event/target only |
| 400 | clarification / existing `CALENDAR_INPUT_REJECTED` | `none` |
| 401 after one bounded refresh | credential / existing `RECONNECT_REQUIRED` | `none`; reconnect |
| 403 `insufficientPermissions` | policy / existing `CALENDAR_FORBIDDEN` | `none`; reconnect only if actual scope missing, not ACL-only denial |
| 403 `quotaExceeded` | delivery / `CALENDAR_QUOTA_EXCEEDED` | `none`; keep connected |
| Per-calendar 404 | coverage reason `not-found` / event `EVENT_NOT_FOUND` | `none`; connection remains connected |
| HTTP-200 per-calendar errors/missing entry | coverage status `error`, reason allowlist, incomplete | never clear/free |
| Expired/stale/changed proposal | clarification / `CALENDAR_PROPOSAL_STALE` | `none`; new disclosure/acceptance, not model repair |

The existing flexible failure-code schema must still decode old stored failures; do not replace it with a new restrictive enum. The exact new discriminated coverage/authority code enums are already frozen in Tasks 3/5. P3 may report already-supported HTTP behavior instead of rewriting it: actual `calendar-api-http.ts` already classifies 403 rate reasons and per-resource 404, contrary to the research's older line descriptions.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/contracts/calendar-multi-wire.spec.ts test/contracts/calendar-wire.spec.ts`.
- [ ] **Commit named files:** `git commit -m "feat(calendar): version multi-calendar settings status and target receipt wire"`.

## Task 9: Prove the output union and envelope through the pinned real MCP SDK

**Files:** Append v2 execution-envelope exports to `backend/src/contracts/calendar-operations.ts`; create `backend/test/contracts/calendar-multi-mcp.spec.ts`; extend `backend/test/contracts/calendar-multi-fixtures.ts`. Reuse `calendar-mcp-schema.ts` unchanged. Production `plugins/mcp/**` remains P5-owned.

- [ ] **Write these fixtures and the failing test.** Append:

```ts
export const availability = { schemaVersion: 2, tool: 'calendar_check_availability',
  connectionId: 'c', connectionRevision: 1, discoveryRevision: 1, availabilityRevision: 1,
  calendarSetHash: hash, timeMin: at, timeMax: until, timeZone: 'Europe/London', checkedAt: at,
  expiresAt: until, semantics: 'google-opaque-busy-only', calendars: [{ calendarId: entry.calendarId,
    calendarLabel: entry.label, status: 'ok', reason: null }], busy: [],
  free: [{ start: at, end: until }], coverage: 'complete', conflict: 'clear', truncated: false,
  limitations: [] } as const;
export const calendarPage = { schemaVersion: 2, tool: 'calendar_list_calendars', calendars: [entry],
  discoveryRevision: 1, fetchedAt: at, expiresAt: until, complete: true, truncated: false,
  limitations: [], nextPageToken: null } as const;
```

```ts
import { expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { CALENDAR_TOOLS, calendarInputSchemas, calendarResultV2Schema } from '../../src/contracts/calendar-tools.js';
import { calendarExecutionEnvelopeV2Schema } from '../../src/contracts/calendar-operations.js';
import { withStandardJsonSchema } from '../../src/contracts/calendar-mcp-schema.js';
import { at, until, entry, action, event, sourceV2, hash, availability, calendarPage } from './calendar-multi-fixtures.js';

it('auto-validates new success results on the real pinned MCP handler without new dependencies', async () => {
  const resultTarget = { calendarId: entry.calendarId, calendarLabel: entry.label,
    discoveryRevision: 1, privateAccess: true };
  const outputs = {
    calendar_list_events: { schemaVersion: 2, tool: 'calendar_list_events', target: resultTarget,
      events: [event], nextPageToken: null, truncated: false },
    calendar_get_event: { schemaVersion: 2, tool: 'calendar_get_event', target: resultTarget, event },
    calendar_create_event: { schemaVersion: 2, tool: 'calendar_create_event', target: resultTarget, event },
    calendar_list_calendars: calendarPage, calendar_check_availability: availability,
  };
  const inputs = { calendar_list_events: { calendarId: entry.calendarId, timeMin: at, timeMax: until, maxResults: 20 },
    calendar_get_event: { calendarId: entry.calendarId, eventId: event.eventId },
    calendar_create_event: action, calendar_list_calendars: {}, calendar_check_availability: {
      timeMin: at, timeMax: until, timeZone: 'Europe/London' } };
  let malformed = false;
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'multi-contract-fixture', version: '2.0.0' });
    for (const definition of CALENDAR_TOOLS) {
      server.registerTool(definition.name, { description: definition.description,
        inputSchema: withStandardJsonSchema(calendarInputSchemas[definition.name], definition.inputSchema),
        // Fixture-only advertisement. The complete server validator is the shared Zod envelope.
        // Production output JSON Schema registration/parity is P5-owned, not certified here.
        outputSchema: withStandardJsonSchema(calendarExecutionEnvelopeV2Schema, { type: 'object' }),
      }, async () => {
        const source = definition.name === 'calendar_check_availability'
          ? { ...sourceV2, availabilityRevision: 1, calendarSetHash: hash }
          : sourceV2;
        const receipt = definition.name === 'calendar_create_event' ? { schemaVersion: 2,
          operationId: 'op', googleEventId: event.eventId, connectionId: 'c', connectionRevision: 1,
          targetRevision: 1, calendarId: entry.calendarId, calendarLabel: entry.label, labelExpiresAt: until,
          requestHash: hash, verifiedAt: at, source, htmlLink: null } : null;
        return { content: [], structuredContent: { outcome: 'success',
          result: malformed ? { tool: definition.name, unknownField: true } : outputs[definition.name],
          source, receipt } };
      });
    }
    return server;
  }, { legacy: 'reject' });
  const client = new Client({ name: 'multi-contract-client', version: '2.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  const transport = new StreamableHTTPClientTransport(new URL('http://aurvin.internal/mcp'), {
    fetch: (input, init) => handler.fetch(new Request(input, init)),
  });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(Object.keys(outputs).sort());
    for (const definition of CALENDAR_TOOLS) {
      expect(calendarResultV2Schema.safeParse(outputs[definition.name]).success).toBe(true);
      const result = await client.callTool({ name: definition.name, arguments: inputs[definition.name] });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ outcome: 'success', result: outputs[definition.name] });
    }
    malformed = true;
    const refused = await client.callTool({ name: 'calendar_list_calendars', arguments: {} })
      .then(r => r.isError === true, () => true);
    expect(refused).toBe(true);
  } finally {
    await client.close();
    await handler.close();
  }
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/contracts/calendar-multi-mcp.spec.ts -t "auto-validates new success results"`. Expect missing `calendarExecutionEnvelopeV2Schema`, not a live socket/network failure.
- [ ] **Minimal implementation**, append to `calendar-operations.ts` with runtime imports for `calendarResultV2Schema` and `jsonBytes`:

```ts
export const calendarExecutionEnvelopeV2Schema = z.union([
  z.object({ outcome: z.literal('success'), result: calendarResultV2Schema,
    source: sourceReferenceV2Schema, receipt: calendarReceiptV2Schema.nullable() }).strict(),
  z.object({ outcome: z.literal('failure'), failure: calendarFailureSchema }).strict(),
]).refine(v => {
  const encoded = { content: [], structuredContent: v, ...(v.outcome === 'failure' ? { isError: true } : {}) };
  if (jsonBytes(encoded) > 16384) return false;
  if (v.outcome === 'failure') return true;
  const r = v.result;
  const targets = 'target' in r ? [r.target]
    : r.tool === 'calendar_list_calendars' ? r.calendars.map(c => ({ calendarId: c.calendarId, calendarLabel: c.label }))
      : r.calendars;
  if (!targets.every(t => v.source.targets.some(s => s.calendarId === t.calendarId
    && (s.calendarLabel === null || s.calendarLabel === t.calendarLabel)))) return false;
  if (r.tool === 'calendar_check_availability' && (v.source.availabilityRevision !== r.availabilityRevision
    || v.source.discoveryRevision !== r.discoveryRevision || v.source.calendarSetHash !== r.calendarSetHash)) return false;
  return r.tool === 'calendar_create_event'
    ? v.receipt !== null && v.receipt.googleEventId === r.event.eventId
      && v.receipt.calendarId === r.target.calendarId
      && v.receipt.connectionId === v.source.connectionId
      && v.receipt.connectionRevision === v.source.connectionRevision
    : v.receipt === null;
});
```

The contract test proves full **server-side** automatic output validation with registered Standard Schema and real SDK handler/fetch. Its intentionally minimal fixture JSON descriptor does **not** prove client-side validation of the advertised output schema, nor production registration. P5 must obtain a P1-owned exact output JSON descriptor/parity amendment if it adds production `outputSchema`; it cannot copy this fixture-only descriptor as a production freeze. The existing production handler has no output registration today, so a new tool result must still be admitted by the actual shared result union even without that future registration. Do not claim the nonexistent `calendarSuccessSchema.data` was fixed. This is the explicit source correction from the execution boundary, not a changed product requirement.

Add a direct whole-envelope negative test to the same file:

```ts
it('checks the final 16 KiB envelope including multi-calendar source overhead', () => {
  const oversized = { outcome: 'success', result: calendarPage, receipt: null,
    source: { ...sourceV2, targets: [sourceV2.targets[0], ...Array.from({ length: 99 }, (_, i) => ({
      calendarId: `${i}-${'x'.repeat(1000)}`, calendarLabel: '界'.repeat(200),
    }))] } };
  expect(calendarExecutionEnvelopeV2Schema.safeParse(oversized).success).toBe(false);
  expect(calendarExecutionEnvelopeV2Schema.safeParse({ outcome: 'failure', failure: {
    category: 'policy', code: 'CALENDAR_TARGET_READ_ONLY', retry: 'schema-repair' } }).success).toBe(false);
});

it('accepts exactly 16384 envelope bytes and refuses the next byte', () => {
  const envelope = { outcome: 'success', result: calendarPage, receipt: null,
    source: { ...sourceV2, targets: [{ ...sourceV2.targets[0] }, ...Array.from({ length: 20 }, (_, i) => ({
      calendarId: `pad-${i}`, calendarLabel: null,
    }))] } };
  const encodedBytes = () => Buffer.byteLength(JSON.stringify({ content: [], structuredContent: envelope }), 'utf8');
  let remaining = 16384 - encodedBytes();
  for (const target of envelope.source.targets.slice(1)) {
    const fill = Math.min(1024 - target.calendarId.length, remaining);
    target.calendarId += 'x'.repeat(fill); remaining -= fill;
  }
  expect(remaining).toBe(0); expect(encodedBytes()).toBe(16384);
  expect(calendarExecutionEnvelopeV2Schema.safeParse(envelope).success).toBe(true);
  envelope.source.targets.find((t, i) => i > 0 && t.calendarId.length < 1024)!.calendarId += 'x';
  expect(encodedBytes()).toBe(16385);
  expect(calendarExecutionEnvelopeV2Schema.safeParse(envelope).success).toBe(false);
});
```

- [ ] **Prove green**, cwd `backend`: `npm test -- test/contracts/calendar-multi-mcp.spec.ts test/contracts/calendar-mcp-compatibility.spec.ts`.
- [ ] **Commit named files:** `git commit -m "test(calendar): verify v2 output contracts through the pinned MCP SDK"`.

## Task 10: Close strictness, boundary, version, and handoff checks without borrowing downstream ownership

**Files:** Create `backend/test/contracts/calendar-multi-boundaries.spec.ts`; adjust **only P1-owned** schemas if a demonstrated boundary fails. No runtime or application-data edits.

- [ ] **Write the failing test:**

```ts
import { expect, it } from 'vitest';
import { COLLECTIONS } from '../../src/contracts/collections.js';
import { calendarDiscoverySnapshotSchema, calendarDiscoveryEntrySchema } from '../../src/contracts/calendar-discovery.js';
import { calendarAvailabilityResultSchema } from '../../src/contracts/calendar-availability.js';
import { calendarProposalSchema, proposalMatchesReply, calendarProposalReplySchema } from '../../src/contracts/calendar-authority.js';
import { calendarResultV2Schema, calendarInputSchemas, CALENDAR_TOOLS } from '../../src/contracts/calendar-tools.js';
import { repairDiagnosticsSchema } from '../../src/contracts/calendar-model.js';
import { calendarTurnStateV2Schema } from '../../src/contracts/calendar-wire.js';
import { snapshot, entry, proposal, availability, at } from './calendar-multi-fixtures.js';

it('rejects unknown fields and new-version laundering at every public authority boundary', () => {
  expect(Object.values(COLLECTIONS)).toEqual(['sessions', 'messages', 'agent-memory', 'metadata',
    'checkpoints', 'checkpoint_writes', 'config', 'integration_connections']);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, extra: true }).success).toBe(false);
  expect(calendarDiscoveryEntrySchema.safeParse({ ...entry, accessToken: 'secret' }).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...availability, schemaVersion: 1 }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...proposal, approvedByModel: true }).success).toBe(false);
  for (const definition of CALENDAR_TOOLS) {
    for (const path of Object.keys(definition.inputSchema.properties)) {
      expect(repairDiagnosticsSchema.safeParse([{ path, code: 'missing', expected: 'bounded-value' }]).success).toBe(true);
    }
  }
  const reply = calendarProposalReplySchema.parse({ userId: 'u', sessionId: 's', connectionId: 'c',
    connectionRevision: 1, googleSubjectId: 'sub', proposalId: 'p', expectedProposalRevision: 1,
    acceptedMessageId: 'followup', acceptedTurnId: 'next', canonicalActionHash: proposal.canonicalActionHash,
    conditionFingerprint: proposal.conditionFingerprint, choiceCalendarId: null, receivedAt: at, decision: 'accept' });
  // A selection proposal must not be consumed as a generic yes without choosing a candidate.
  const selection = calendarProposalSchema.parse({ ...proposal, purpose: 'selection', target: null,
    canonicalActionHash: null, action: { ...proposal.action, calendarId: undefined },
    candidates: [{ target: proposal.target, canonicalActionHash: proposal.canonicalActionHash }],
    conditionFingerprint: null, availabilityRevision: null, disclosedLimitations: [] });
  expect(proposalMatchesReply(selection, { ...reply, conditionFingerprint: null,
    choiceCalendarId: proposal.target.calendarId })).toBe(false);
  // Free windows must partition the whole checked range; a gap is not a complete free result.
  expect(calendarAvailabilityResultSchema.safeParse({ ...availability, free: [] }).success).toBe(false);
  const parsed = calendarResultV2Schema.safeParse({ ...availability, calendars: [], free: [],
    coverage: 'incomplete', conflict: 'unknown', limitations: ['calendar-limit'], truncated: true });
  expect(parsed.success).toBe(true);
  expect(calendarInputSchemas.calendar_check_availability.safeParse({ timeMin: at, timeMax: at,
    timeZone: 'UTC', calendarIds: ['same', 'same'] }).success).toBe(false);
  expect(calendarTurnStateV2Schema.safeParse({ schemaVersion: 2, operationId: 'o', state: 'failed',
    narration: 'failed', retryAction: 'none', receipt: null }).success).toBe(true);
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/contracts/calendar-multi-boundaries.spec.ts -t "rejects unknown fields"`. Two intended failures reveal missing selection-decision binding and incomplete free-window partition enforcement; do not remove those assertions.
- [ ] **Minimal implementation:** append these predicates to their existing task refinements (no new helper/service):

```ts
// Additional conjuncts in proposalMatchesReply's return expression:
&& (p.purpose !== 'selection' || r.decision === 'select' || r.decision === 'cancel')
&& (r.decision !== 'accept' || p.purpose !== 'selection')
&& (r.decision !== 'select' || r.choiceCalendarId !== null)
```

```ts
// In calendarAvailabilityResultSchema refinement, after ordered/overlap checks:
const partition = [...v.busy, ...v.free].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
const fullRange = partition.length > 0 && Date.parse(partition[0].start) === low
  && Date.parse(partition[partition.length - 1].end) === high
  && partition.every((b, i) => i === 0 || Date.parse(partition[i - 1].end) === Date.parse(b.start));
// Additional conjunct in its return expression:
&& (!complete || fullRange)
```

Use epoch comparisons so offset spelling does not create a false boundary gap. No service call or interval-generation algorithm belongs in P1. This test is the one small runnable check that fails if coverage starts claiming clear without covering the range.

Before committing, include the following exact count/byte/time boundary checks in this file. They are deterministic contract checks, not UI/provider certification:

```ts
it('honors exact count time and UTF-8 limits without raising ceilings', () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ ...entry, calendarId: `c${i}`, primary: i === 0 }));
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, entries }).success).toBe(true);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, entries: [...entries,
    { ...entry, primary: false, calendarId: 'overflow' }] }).success).toBe(false);
  const huge = entries.map((e, i) => ({ ...e, calendarId: `${i}-${'界'.repeat(1019)}`,
    label: '界'.repeat(200), timeZone: '界'.repeat(100) }));
  const oversized = { ...snapshot, entries: huge };
  expect(Buffer.byteLength(JSON.stringify(oversized), 'utf8')).toBeGreaterThan(262144);
  expect(calendarDiscoverySnapshotSchema.safeParse(oversized).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...availability,
    timeMax: '2026-11-22T10:00:00.001Z', free: [{ start: at, end: '2026-11-22T10:00:00.001Z' }] }).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...availability, timeMax: at }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...proposal, expiresAt: proposal.createdAt }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...proposal, expiresAt: '2026-10-22T10:10:00.001Z' }).success).toBe(false);
  expect(repairDiagnosticsSchema.safeParse(Array(11).fill({ path: 'calendarIds', code: 'missing', expected: 'object' })).success).toBe(false);
});
```

Exact argument/result 16,384/16,385-byte checks already remain in the existing `calendar-tools.spec.ts`; the MCP envelope-overhead test supplements them. Task 1 exercises every new numeric exact/max+1/zero ceiling. Task 3 tests 50/51 batching and 2,000/2,001 ingestion; Task 4 tests 20/21 pages and 100/101 selector arrays. Actual page-delivery counting, ACL intersection on dispatch, HTTP-200 classification, DST conversion and conflict preflight execution are P3/P5/P6 checks, not implied by schema passes.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/contracts/calendar-multi-boundaries.spec.ts` followed, separately, by `npm test -- test/contracts`. Confirm nonzero discovered tests and report exact failures/skips.
- [ ] **Commit named files:** `git commit -m "test(calendar): close strict version and authority boundary coverage"`.

## Final sequential verification and handoff gate

These commands are **worker execution requirements**, not checks run by this planner. First record `git rev-parse HEAD`, `git status --short`, `node --version`, `npm --version`, package dependency lock state, and the task commit hashes. Node must satisfy `^22.22.3 || ^24.15.0 || >=26.0.0`. No root `package.json`/npm workspace exists. No installs are needed for this plan; if dependencies are absent, report a prerequisite, do not install without authorization.

Run individually, **sequentially**, never in parallel:

1. cwd `backend`: `npm test -- test/contracts/calendar-multi-policy.spec.ts -t "freezes v2 scopes"`
2. cwd `backend`: `npm test -- test/contracts/calendar-multi-discovery.spec.ts -t "admits bounded discovery"`
3. cwd `backend`: `npm test -- test/contracts/calendar-multi-availability.spec.ts -t "never encodes unknown coverage"`
4. cwd `backend`: `npm test -- test/contracts/calendar-multi-tools.spec.ts -t "freezes five strict v2 tools"`
5. cwd `backend`: `npm test -- test/contracts/calendar-multi-authority.spec.ts -t "binds one expiring proposal"`
6. cwd `backend`: `npm test -- test/contracts/calendar-multi-operations.spec.ts -t "pins v2 operation receipt"`
7. cwd `backend`: `npm test -- test/contracts/calendar-multi-compatibility.spec.ts -t "decodes v1 faithfully"`
8. cwd `backend`: `npm test -- test/contracts/calendar-multi-wire.spec.ts -t "versions public targeting"`
9. cwd `backend`: `npm test -- test/contracts/calendar-multi-mcp.spec.ts -t "auto-validates new success results"`
10. cwd `backend`: `npm test -- test/contracts/calendar-multi-boundaries.spec.ts -t "rejects unknown fields"`
11. cwd `backend`: `npm test -- test/contracts`
12. cwd `backend`: `npm run build`
13. cwd `backend`: `npm run lint`
14. cwd `backend`: `npm test`
15. cwd `backend`: `npm run test:e2e`
16. cwd `frontend`: `npm run build`
17. cwd `frontend`: `npm run lint`
18. cwd `frontend`: `npm test`
19. repository root: `git diff --check`
20. repository root: `git status --short`

General focused format in either package: `npm test -- <relative-test-path> -t "<test-name>"`. Do not use a root npm command or run backend/frontend simultaneously; bootstrap tests can observe rewritten `dist` if builds overlap.

**Required report classifications:** Record actual test discovery/counts, red-before-green evidence, exact package outputs and commit set. Empty discovery is not passing evidence. Native tests require operator-supplied `AURVIN_TEST_MONGODB_URI` and exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; report prerequisite skips separately, never print the URI, and do not access application data. No live consent/API/model action, database fixture, browser result, policy approval, Azure certification or deployment is implied by P1. No package changes are planned; existing SDK version/lock/engine/Zod tests run in Task 9 and final contract checks. If package changes become necessary, stop for a P1-owned compatibility amendment, not an unreviewed dependency bump.

**Intermediate failures are expected possibilities, not permission to hide failures:** Scope/catalogue/type advances can expose old hardcoded assumptions in OAuth (P4), MCP/model/event adapters (P5), graph/runtime/context (P6), frontend (P7), or assembly/config/HTTP (P8). Capture command, failing file/test/diagnostic and owner. Stop dependent execution until the orchestrator accepts a tracked consumer-migration gate; do not call a failing package check passed and do not edit the foreign file. P1 schema tests and compiled port fixtures must pass; unresolved contract-internal failures block P1. A source-owned failure elsewhere must be explicitly dispositioned by the orchestrator before downstream readiness is asserted. The P1 worker cannot declare all ACs or the workflow complete.

### Acceptance and research-specific coverage map

| Coverage | Tasks / contract evidence |
| --- | --- |
| AC01 no mandatory target-ID contract | 2 account-only binding; 8 v2 status/settings; P4/P8 runtime removal remains downstream |
| AC02 discovery/pages/roles/primary/bounds | 1, 2, 4, 10 |
| AC03 scopes/partial grant/shared roles | 1, 2, 5; live ACL/consent evidence remains unrun |
| AC04 preference vs pinned target/precedence ports | 2, 5, 6, 8 |
| AC05 natural-language and cross-turn authority | 5, 6, 7, 8; no canonical JSON echo in new authorization contract |
| AC06 availability batches/coverage/semantics | 1, 3, 9, 10 |
| AC07 conflict fingerprint/expiry/single consumption | 3, 5, 6, 10; enforced preflight is P6 execution |
| AC08 five-tool catalogue/repair/output/strict selectors | 4, 5, 9, 10 |
| AC09 account/target/event/intent/receipt invariants | 5, 6, 7, 8 |
| AC10 finite counters/categories/price/source groups | 1, 6, 7, 9; no new private reasoning fields |
| AC11 truthful public states/labels contract | 8; P7 owns actual accessibility/browser behavior |
| AC12 v1 decoding/versioned migration/rollback | 1, 4, 6, 7; no migration execution |
| AC13 expiry/privacy/local boundary contract | 2, 5, 6, 8, 10; actual security/operations/policy gates remain downstream |
| Research specific 1: scope set/freebusy/no owned shared path | 1, 2 |
| Specific 2: tools/proof/cursor advance, v1 read-only/terminal/receipts | 1, 4, 6, 7, 8 |
| Specific 3: permitted selector vs forbidden authority | 4, 10 |
| Specific 4: repair paths | 4, 10 |
| Specific 5: two new success result branches / actual source correction | 4, 9 |
| Specific 6: writerWithoutPrivateAccess | 2, 4, 8 |
| Specific 7: defaultSettingRevision separation | 2, 6, 8 |
| Specific 8: reconciled count/byte/freshness/proposal ceilings | 1, 2, 3, 4, 5, 9, 10 |
| Specific 9: primary flag and legitimate missing primary | 2, 10 |
| Specific 10: executable P2/P3 ports and P5 catalogue | 2, 3, 4, 5, 6, 7 |
| Specific 11: bounded durable proposal/selection/conflict authority | 3, 5, 6, 7, 10 |
| Specific 12: multi-calendar provenance/target labels | 2, 3, 4, 6, 8, 9 |

### Exit gate and serialized handoff

- [ ] All new contract suites discover meaningful tests and pass strict version/unknown-field/role/scope/byte/count/time/authority boundaries, with recorded red/green evidence.
- [ ] v1 grants/operations/sources/results/receipts/checkpoints decode without scope/primary/target fabrication; new writes only use explicit v2 schemas/ports; unknown old effects remain quarantined and never replayed.
- [ ] Hash/accepted-message/intent/session/account/connection/target/event identities are checked; preference changes do not change operation authority; consumed/expired proposals cannot mint another effect.
- [ ] Compilable port fixtures and exact exported names/signatures are handed to P2/P3/P5. Include `CalendarOperationStoreV2`, `CalendarAccountCredentialPort`, `CalendarCapabilityGate`, `CalendarExecutionPortV2`, and the compatible decoders, not only the provider interfaces.
- [ ] SDK/engine/lock compatibility checks execute unchanged; whole-envelope byte limits and new output branches pass real SDK handler/fetch checks. Fixture-only versus production output registration is explicit.
- [ ] Sequential package results and cross-package failures/skips are reported truthfully and routed to their owners. Contract-internal failures are fixed by P1; no foreign-owner workaround or weakened gate.
- [ ] Orchestrator acknowledges the three source/spec wording corrections before execution; unified review remains **skipped**. Report precise planned/implemented/tested/pending status, not Phase 2 completion.

At each task commit, run `git diff --check`, stage the task's explicit owned file paths only, check `git diff --cached --name-only`, and commit only after the orchestrator grants the shared-index slot. The final worker report names all task commits, the executable interfaces above, actual checks and unresolved owner gates. The planner's documentation commit is separate from these future implementation commits.
