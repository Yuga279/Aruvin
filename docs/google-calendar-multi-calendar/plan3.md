# P3 — Provider discovery and availability primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Remain the assigned P3 worker; do not dispatch a reviewer or another worker.

**Goal:** Implement bounded, deterministic Google Calendar discovery and opaque free/busy REST primitives through the existing P1 provider ports, without treating cached metadata or partial coverage as authorization or an all-clear.

**Architecture:** Add two small adapters beside the existing event adapter and reuse the single-delivery HTTP helper. Discovery returns the frozen v2 snapshot; availability consumes a server-bound discovered set and returns the frozen v2 interval/coverage result. Connection lifecycle, credentials, durable retries, target resolution, MCP envelopes, and create preflight orchestration stay with P4/P5/P6.

**Tech Stack:** TypeScript/NodeNext with `.js` local imports, native fetch/AbortSignal/Intl/crypto, existing Zod and Vitest; Node `^22.22.3 || ^24.15.0 || >=26.0.0`. No dependency, OAuth, database, or live Google changes.

---

## Execution boundary and inspected source

Read [goal.md](goal.md), P3/A1/ownership/readiness in [state.md](state.md), [research.md](research.md), [plan1.md](plan1.md), root `AGENTS.md`, and the actual named source/tests before execution. This planner owns only this Markdown artifact. The worker owns only the paths below. The P1 worker and A1 compile amendment are committed prerequisites, not work to repeat. Review is **skipped**, never passed.

The consumed P1 provider signatures match current source. Account bindings do not contain a target/default. `CalendarAvailabilityResult` includes the Task 10 full-range partition refinement in addition to the earlier Task 3 snippet: complete `busy + free` must cover the entire query exactly. Do not copy just the earlier snippet and weaken it.

Source corrections already recorded by P1 remain important:

- `calendar-api-http.ts` already classifies 403 `rateLimitExceeded`/`userRateLimitExceeded`, 429, 5xx, terminal 400/401/404, and explicit gone reasons. Reuse it; add the missing distinct terminal `quotaExceeded` mapping. Its 404 is resource-local and does not mutate a connection.
- `calendarHttp` deliberately sends **one delivery**, not a retry loop. Neither P1 provider port has a durable remaining-retry counter or a refresh callback. Do not invent a fresh two-retry allowance inside either adapter. Propagate eligible first-delivery failures to the existing caller's persisted delivery-retry budget; count every subsequent invocation/delivery. A partial-result limitation is not a retry instruction. P4/P5/P6 decide whether a remaining eligible retry can run.
- Page/batch ceilings count **deliveries, including caller-authorized retries**, within one refresh/scan. P4/P5 must preserve the same admission closure across retries and pass the remaining `pageDeliveries`/`batches`, not restart those allowances. An in-turn refresh may therefore use only one retry after its first delivery, and a two-batch 100-calendar scan has no third delivery available. The provider ports carry no durable refresh/scan identity; the owning caller supplies that accounting scope. Refresh after 401 is also a counted Calendar replay, not a free delivery.
- P4 owns `CalendarAccountCredentialPort.withAccessToken`, including at most one refresh/replay following 401 and the existing refresh-request ceiling. P3 neither refreshes a token nor changes connection state. A second 401 remains terminal `RECONNECT_REQUIRED`; a calendar 404 never invokes disconnect/reconnect.
- Goal availability prose still says “far shorter than a month”; its finite ceiling and P1's actual contracts instead enforce **31 elapsed days**. Use that explicit ceiling; report the inconsistent qualitative sentence for orchestrator reconciliation. Do not certify a provider maximum or silently change the frozen policy.
- Research's “deleted saved default falls back” recommendation conflicts with the approved goal: never implement fallback here. P4/P6 must clarify an unavailable saved default.

### Owned file map

| Path | Responsibility |
| --- | --- |
| `backend/src/plugins/google-calendar/calendar-api-http.ts` | Existing single-delivery transport; narrowly add response-byte control and terminal quota classification; retain all existing event/write behavior |
| `backend/src/plugins/google-calendar/calendar-discovery-api.ts` | `CalendarDiscoveryApi implements CalendarDiscoveryPort`; bounded list, canonical primary metadata, normalization, cache evidence |
| `backend/src/plugins/google-calendar/calendar-availability-api.ts` | `CalendarAvailabilityApi implements CalendarAvailabilityPort`; bounded POST batches, coverage, interval projection |
| `backend/test/plugins/google-calendar/calendar-api-http.spec.ts` | Shared-helper regressions; preserve every existing assertion |
| `backend/test/plugins/google-calendar/calendar-discovery-api-fixtures.ts` | Inert typed P3 fixtures only; reuse existing `fakeFetch`/`googleJson` read-only |
| `backend/test/plugins/google-calendar/calendar-discovery-api.spec.ts` | Discovery/role/count/privacy/admission regressions |
| `backend/test/plugins/google-calendar/calendar-availability-api.spec.ts` | Availability/busy/coverage/time/bounds/admission regressions |

No other write paths. In particular, do not modify contracts/manifests (P1), persistence (P2), `calendar-api.ts`, cursor, tools, validation or MCP (P5), connection/OAuth/controllers (P4), runtime (P6), assembly (P8), goal/state/research/other plans, `.env`, or `.openchamber/`. Existing event/cursor tests are read-only regression checks. If an additional companion file is genuinely necessary, use a reserved P3 discovery/availability prefix and report it before adding it; this plan does not need one.

New executable files require the repository FILE/LOCATION/PURPOSE/ROLE IN PROJECT/KEY COMPONENTS header. Add that header to an existing file if its change exceeds 30%. This plan intentionally has no code-file banner. Preserve shebang/directive positions and ESM imports. Every task is test → red → minimal implementation → green → focused named-path commit. Never lower an assertion to make a neighboring owner's tests pass.

## Exact P1 contract handoff

Use type aliases derived from these actual interfaces instead of maintaining another provider input contract:

```ts
// backend/src/contracts/calendar-discovery.ts
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
// backend/src/contracts/calendar-availability.ts
export interface CalendarAvailabilityPort {
  check(input: CalendarProviderContext & { snapshot: CalendarDiscoverySnapshot;
    calendarIds: readonly string[]; timeMin: string; timeMax: string; timeZone: string;
    availabilityRevision: number; purpose: 'availability' | 'preflight';
    limits: { batchCalendars: number; batches: number; busyIntervals: number;
      workingBytes: number; resultBytes: number } }): Promise<CalendarAvailabilityResult>;
}
```

Also consume, never redefine:

- `CalendarAccountBinding` / `calendarAccountBindingSchema`, `CalendarDiscoveryEntry` / `calendarDiscoveryEntrySchema`, `CalendarDiscoverySnapshot` / `calendarDiscoverySnapshotSchema`, `calendarRoleSchema`, `effectiveCalendarCapabilities`, `primaryCalendarId` from `contracts/calendar-discovery.ts`.
- `CalendarAvailabilityResult`, `calendarAvailabilityResultSchema`, `calendarAvailabilityBatchSchema`, `calendarIntervalSchema`, `calendarAvailabilityFingerprint` and the coverage/limitation enums from `contracts/calendar-availability.ts`.
- `CALENDAR_SCOPES`, `CALENDAR_LIMITS`, `calendarGrantStatus`, `CalendarFailure`, `calendarFailureSchema` from `contracts/calendar-policy.ts`; shared `jsonBytes` from `contracts/calendar-tools.ts`.
- `parseCalendarTimestamp`, `compareCalendarTimes`, `formatCalendarUtc`, `CalendarToolFault`, `toolFault` from existing P5-owned `tools-validation.ts`, read-only. Do not call its old three-tool `validateCalendarCall` for the new tools.

`effectiveCalendarCapabilities` deliberately requires the whole verified Phase 2 scope set and `policyAllows`; role alone is not sufficient. `owner`/`writer`: read/create/availability, private access true. `writerWithoutPrivateAccess`: read/create/availability, private access false. `reader`: read/availability only, private access false. `freeBusyReader`: availability only, private access false. Hidden/deleted entries have all capabilities false; `selected:false` alone does not revoke capabilities. Unknown roles are omitted with `unsupported-entry`, never promoted to writer and never fatal to otherwise usable metadata.

Freshness is not authority. P4 must obtain current account/grant/policy evidence for each invocation, implement `CalendarCapabilityGate.resolve/requireCurrent`, and perform a **fresh** operation-specific metadata check before event dispatch. With the existing P1 surface it can invoke `discover` afresh and map its `consumeRequest('discovery')` callback to the caller's `capability-recheck` category; a target omitted by a bounded scan cannot be authorized. P3 does not add a parallel capability-gate or a private `calendarList.get` port. If P4 requires an efficient single-entry recheck, return that explicit port amendment to P1 before implementing it. Availability itself uses current trusted scopes/policy plus the live per-calendar free/busy response, not cached `createEvents` flags. No adapter owns credentials, default selection, or a restart/background cache.

Snapshot `nextPageToken` is a **Google** continuation; an Aurvin UI/tool page cursor is a different P4/P5 concern and a complete snapshot may have multiple 20-entry UI pages. P1's `discover` has no continuation-input parameter: each invocation is a bounded new refresh; do not expose the raw provider token as a model/browser cursor or silently invent resume semantics.

## Task 1: Preserve single-delivery HTTP behavior and close quota/lowered-byte gaps

**Files:** Modify only `backend/src/plugins/google-calendar/calendar-api-http.ts` and `backend/test/plugins/google-calendar/calendar-api-http.spec.ts`.

- [ ] **Write failing tests** in the existing HTTP describe block (reuse its `context` and `json`):

```ts
it('keeps daily quota terminal and distinct from secondary rate limits', async () => {
  let calls = 0;
  const fault = await calendarHttp(context({ fetcher: async () => {
    calls++;
    return json({ error: { message: 'private-provider-prose', errors: [
      { reason: 'quotaExceeded' }, { reason: 'rateLimitExceeded' },
    ] } }, { status: 403 });
  } })).catch((error: unknown) => error);
  expect(fault).toHaveProperty('failure', {
    category: 'delivery', code: 'CALENDAR_QUOTA_EXCEEDED', retry: 'none',
  });
  expect(calls).toBe(1);
  expect(String(fault)).not.toContain('private-provider-prose');
});

it('honors a lower response byte allowance without raising the global ceiling', async () => {
  const exact = '{"s":"é"}';
  const bytes = Buffer.byteLength(exact, 'utf8');
  const good = await calendarHttp(context({ responseBytes: bytes,
    fetcher: async () => new Response(exact, { headers: { 'content-type': 'application/json' } }),
  }));
  expect(good.body).toEqual({ s: 'é' });
  expect(good.bodyBytes).toBe(bytes);
  await expect(calendarHttp(context({ responseBytes: bytes - 1,
    fetcher: async () => new Response(exact, { headers: { 'content-type': 'application/json' } }),
  }))).rejects.toThrow('CALENDAR_RESPONSE_INVALID');
  await expect(calendarHttp(context({ responseBytes: 262145,
    fetcher: async () => json({}),
  }))).rejects.toThrow('CALENDAR_RESPONSE_INVALID');
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-api-http.spec.ts -t "keeps daily quota|honors a lower"`. Expect quota-code failure/missing `bodyBytes`/ignored allowance, not empty discovery.
- [ ] **Minimal implementation:** add `responseBytes?: number` to `CalendarHttpInput`; add `bodyBytes: number` to `CalendarHttpResult`. In `decodeCalendarFailure`, before the rate-limited branch for status 403:

```ts
if (googleErrorReasons(body).includes('quotaExceeded')) {
  return calendarFailureSchema.parse({ category: 'delivery',
    code: 'CALENDAR_QUOTA_EXCEEDED', retry: 'none' });
}
```

At the start of `calendarHttp`, validate the lowered limit before admission; pass it to the successful-body reader and report actual bytes:

```ts
const responseBytes = input.responseBytes ?? CALENDAR_RESPONSE_BYTES;
if (!Number.isInteger(responseBytes) || responseBytes < 1
  || responseBytes > CALENDAR_RESPONSE_BYTES) failure('delivery', 'CALENDAR_RESPONSE_INVALID');
// Replace only the success-body read's CALENDAR_RESPONSE_BYTES argument:
text = await readBoundedText(response, responseBytes, signal);
// Replace the success return:
return { body: JSON.parse(text) as unknown, headers: response.headers, fetchedAt,
  bodyBytes: Buffer.byteLength(text, 'utf8') };
```

Keep the 8,192-byte error-body ceiling, redirect denial, fatal UTF-8 decoding, Retry-After behavior, one request-admission callback, no internal retries, write uncertainty, and all existing event/gone semantics unchanged. Do not move the P5-owned fault class merely to remove an existing import.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-api-http.spec.ts test/plugins/google-calendar/calendar-api.spec.ts test/plugins/google-calendar/calendar-api-cursor.spec.ts`.
- [ ] **Commit** the two explicit paths after index-slot confirmation: `fix(calendar): distinguish quota failures and bound provider response bytes`.

## Task 2: Discover pages and normalize roles through the exact v2 port

**Files:** Create `backend/src/plugins/google-calendar/calendar-discovery-api.ts`, `backend/test/plugins/google-calendar/calendar-discovery-api-fixtures.ts`, and `backend/test/plugins/google-calendar/calendar-discovery-api.spec.ts`.

- [ ] **Write the typed fixture file** (prepend the mandatory header):

```ts
import type { CalendarDiscoveryPort } from '../../../src/contracts/calendar-discovery.js';
import { calendarDiscoverySnapshotSchema } from '../../../src/contracts/calendar-discovery.js';
import type { CalendarAvailabilityPort } from '../../../src/contracts/calendar-availability.js';
import { CALENDAR_SCOPES } from '../../../src/contracts/calendar-policy.js';

export const NOW = '2026-10-22T10:00:00.000Z';
export const clock = () => Date.parse(NOW);
export type DiscoveryInput = Parameters<CalendarDiscoveryPort['discover']>[0];
export type AvailabilityInput = Parameters<CalendarAvailabilityPort['check']>[0];
export function discoveryInput(patch: Partial<DiscoveryInput> = {}): DiscoveryInput {
  return { account: { userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' },
    accessToken: 'fixture-token', signal: new AbortController().signal,
    grantedScopes: CALENDAR_SCOPES, policyAllows: true,
    retentionPolicy: { policyId: 'fixture-policy', expiresAt: '2026-10-22T10:05:00.000Z' },
    now: NOW, deadlineAt: '2026-10-22T10:00:20.000Z',
    consumeRequest: async () => {}, mode: 'in-turn', discoveryRevision: 1,
    limits: { retainedCalendars: 100, pageDeliveries: 2, snapshotBytes: 262144, freshnessMs: 300000 },
    ...patch };
}
export function providerEntry(id = 'canonical-primary', patch: Record<string, unknown> = {}) {
  return { id, summary: id, accessRole: 'owner', primary: id === 'canonical-primary',
    timeZone: 'Europe/London', selected: true, ...patch };
}
export function snapshot(count = 1) {
  return calendarDiscoverySnapshotSchema.parse({ schemaVersion: 2,
    connectionId: 'c', connectionRevision: 1, discoveryRevision: 1,
    entries: Array.from({ length: count }, (_, i) => ({ calendarId: `c${i}`, label: `Calendar ${i}`,
      primary: i === 0, accessRole: 'owner', privateAccess: true, timeZone: 'Europe/London',
      selected: true, hidden: false, deleted: false,
      capabilities: { readEvents: true, createEvents: true, availability: true } })),
    fetchedAt: NOW, expiresAt: '2026-10-22T10:05:00.000Z', complete: true,
    truncated: false, nextPageToken: null, limitations: [], retentionPolicyId: 'fixture-policy',
    retentionExpiresAt: '2026-10-22T10:05:00.000Z' });
}
export function availabilityInput(patch: Partial<AvailabilityInput> = {}): AvailabilityInput {
  const { mode: _mode, discoveryRevision: _revision, limits: _limits, ...context } = discoveryInput();
  return { ...context, snapshot: snapshot(), calendarIds: ['c0'],
    timeMin: '2026-10-22T11:00:00.000Z', timeMax: '2026-10-22T12:00:00.000Z',
    timeZone: 'Europe/London', purpose: 'availability', availabilityRevision: 1,
    limits: { batchCalendars: 50, batches: 2, busyIntervals: 2000,
      workingBytes: 262144, resultBytes: 15360 }, ...patch };
}
```

**Write these failing discovery tests** (initial imports remain available to subsequent tasks):

```ts
import { expect, it } from 'vitest';
import { CalendarDiscoveryApi } from '../../../src/plugins/google-calendar/calendar-discovery-api.js';
import { calendarDiscoverySnapshotSchema, primaryCalendarId }
  from '../../../src/contracts/calendar-discovery.js';
import { CALENDAR_SCOPES_V1 } from '../../../src/contracts/calendar-policy.js';
import { fakeFetch, googleJson } from './tools-fixtures.js';
import { clock, discoveryInput, providerEntry, NOW } from './calendar-discovery-api-fixtures.js';

it('follows a short page token and derives separate shared capabilities', async () => {
  const roles = ['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader'];
  const fake = fakeFetch([
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
      items: [providerEntry()], nextPageToken: 'opaque&a=b' }) },
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
      items: roles.map((role, i) => providerEntry(`shared-${i}`, { accessRole: role,
        summaryOverride: `Label ${i}`, selected: false })) }) },
  ]);
  const kinds: string[] = [];
  const api = new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock });
  const result = await api.discover(discoveryInput({ consumeRequest: async kind => { kinds.push(kind); } }));
  expect(calendarDiscoverySnapshotSchema.safeParse(result).success).toBe(true);
  expect(result.complete).toBe(true);
  expect(primaryCalendarId(result)).toBe('canonical-primary');
  expect(kinds).toEqual(['discovery', 'discovery']);
  for (const [i, role] of roles.entries()) {
    expect(result.entries.find(e => e.calendarId === `shared-${i}`)).toMatchObject({
      label: `Label ${i}`, accessRole: role, selected: false,
      privateAccess: role === 'owner' || role === 'writer',
      capabilities: { readEvents: role !== 'freeBusyReader',
        createEvents: ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(role), availability: true },
    });
  }
  expect(fake.requests).toHaveLength(2);
  for (const request of fake.requests) {
    const q = new URL(request.url).searchParams;
    expect(q.get('maxResults')).toBe('100');
    expect(q.has('minAccessRole')).toBe(false);
    expect(q.get('showDeleted')).toBe('false');
    expect(q.get('showHidden')).toBe('false');
    expect(request.headers.get('authorization')).toBe('Bearer fixture-token');
  }
  expect(new URL(fake.requests[1]!.url).searchParams.getAll('pageToken')).toEqual(['opaque&a=b']);
  expect(JSON.stringify(result)).not.toContain('fixture-token');
});

it('does not fabricate primary or authorize an old grant', async () => {
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ items: [providerEntry('renamed@example.com')] }) }]);
  const api = new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock });
  const result = await api.discover(discoveryInput());
  expect(primaryCalendarId(result)).toBeNull();
  expect(result).toMatchObject({ complete: false, nextPageToken: null });
  expect(result.limitations).toContain('primary-missing');
  await expect(api.discover(discoveryInput({ grantedScopes: CALENDAR_SCOPES_V1 })))
    .rejects.toThrow('CALENDAR_RECONNECT_REQUIRED');
  await expect(api.discover(discoveryInput({ policyAllows: false })))
    .rejects.toThrow('CALENDAR_EXECUTION_DENIED');
  expect(fake.requests).toHaveLength(1);
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-discovery-api.spec.ts -t "follows a short|does not fabricate"`. Expect missing adapter export.
- [ ] **Minimal implementation:** create `CalendarDiscoveryApi` with constructor `{ fetcher?: typeof fetch; now?: () => number }`, deriving `DiscoveryInput` from the port exactly. Export the following small shared provider helpers from this P3 file for the availability adapter, not a second contract:

```ts
import { calendarAccountBindingSchema, calendarDiscoveryEntrySchema, calendarDiscoverySnapshotSchema,
  calendarRoleSchema, effectiveCalendarCapabilities, type CalendarDiscoveryEntry,
  type CalendarDiscoveryPort, type CalendarProviderContext } from '../../contracts/calendar-discovery.js';
import { CALENDAR_LIMITS, calendarGrantStatus } from '../../contracts/calendar-policy.js';
import { calendarHttp } from './calendar-api-http.js';
import { toolFault } from './tools-validation.js';

type DiscoveryInput = Parameters<CalendarDiscoveryPort['discover']>[0];
type Snapshot = Awaited<ReturnType<CalendarDiscoveryPort['discover']>>;
export const providerRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export function providerInvalid(): never { throw toolFault('delivery', 'CALENDAR_RESPONSE_INVALID'); }
export function providerDeadline(input: CalendarProviderContext, now: number): string {
  if (!calendarAccountBindingSchema.safeParse(input.account).success
    || !Number.isFinite(Date.parse(input.now)) || !Number.isFinite(Date.parse(input.deadlineAt))
    || typeof input.accessToken !== 'string' || !input.accessToken
    || /[\u0000-\u001f\u007f]/u.test(input.accessToken)) {
    throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
  }
  if (!input.policyAllows) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
  if (calendarGrantStatus(input.grantedScopes).state !== 'complete') {
    throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
  }
  return new Date(Math.min(Date.parse(input.deadlineAt), now + CALENDAR_LIMITS.toolTimeoutMs)).toISOString();
}
export function providerZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: value }); return true; }
  catch { return false; }
}
function projectEntry(raw: unknown, input: CalendarProviderContext): CalendarDiscoveryEntry | null {
  if (!providerRecord(raw)) return null;
  const role = calendarRoleSchema.safeParse(raw.accessRole);
  if (!role.success) return null;
  for (const key of ['primary', 'selected', 'hidden', 'deleted']) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') return null;
  }
  if (raw.timeZone !== undefined && !providerZone(raw.timeZone)) return null;
  const hidden = raw.hidden === true, deleted = raw.deleted === true;
  const parsed = calendarDiscoveryEntrySchema.safeParse({ calendarId: raw.id,
    label: raw.summaryOverride ?? raw.summary, primary: raw.primary === true,
    accessRole: role.data, privateAccess: role.data === 'owner' || role.data === 'writer',
    timeZone: raw.timeZone ?? null, selected: raw.selected === true, hidden, deleted,
    capabilities: effectiveCalendarCapabilities(role.data, input.grantedScopes,
      input.policyAllows && !hidden && !deleted) });
  if (!parsed.success || /[\u0000-\u001f\u007f]/u.test(parsed.data.calendarId)
    || ['.', '..'].includes(parsed.data.calendarId)) return null;
  return parsed.data;
}
```

Use a fresh per-invocation map and fixed query; there is no adapter cache. Implement the method below, then Task 3 strengthens duplicates/bytes/cache evidence without changing the port:

```ts
export class CalendarDiscoveryApi implements CalendarDiscoveryPort {
  private readonly fetcher: typeof fetch;
  private readonly clock: () => number;
  constructor(options: { fetcher?: typeof fetch; now?: () => number } = {}) {
    this.fetcher = options.fetcher ?? fetch; this.clock = options.now ?? Date.now;
  }
  async discover(input: DiscoveryInput): Promise<Snapshot> {
    const deadlineAt = providerDeadline(input, this.clock());
    const pageCap = Math.min(input.limits.pageDeliveries,
      input.mode === 'in-turn' ? CALENDAR_LIMITS.discoveryPagesInTurn : CALENDAR_LIMITS.discoveryPagesOutOfTurn);
    const countCap = Math.min(input.limits.retainedCalendars, CALENDAR_LIMITS.retainedCalendars);
    if (![pageCap, countCap, input.discoveryRevision, input.limits.snapshotBytes, input.limits.freshnessMs]
      .every(n => Number.isInteger(n) && n > 0)) throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
    const entries = new Map<string, CalendarDiscoveryEntry>();
    const limitations = new Set<Snapshot['limitations'][number]>();
    const seenTokens = new Set<string>();
    let token: string | null = null;
    const fetchedAt = new Date(this.clock()).toISOString();
    let expires = Math.min(Date.parse(fetchedAt) + Math.min(input.limits.freshnessMs, 300000),
      input.retentionPolicy ? Date.parse(input.retentionPolicy.expiresAt) : Date.parse(fetchedAt));
    if (!Number.isFinite(expires) || expires < Date.parse(fetchedAt)) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
    for (let page = 0; page < pageCap; page++) {
      const query = new URLSearchParams({ maxResults: '100', showDeleted: 'false', showHidden: 'false',
        fields: 'nextPageToken,items(id,summary,summaryOverride,primary,accessRole,timeZone,selected,hidden,deleted)' });
      if (token !== null) query.set('pageToken', token);
      const response = await calendarHttp({ fetcher: this.fetcher, path: '/users/me/calendarList',
        method: 'GET', query, accessToken: input.accessToken, signal: input.signal, deadlineAt,
        consumeRequest: () => input.consumeRequest('discovery'), now: this.clock });
      if (!providerRecord(response.body) || !Array.isArray(response.body.items)
        || response.body.items.length > 100) providerInvalid();
      for (const item of response.body.items) {
        const entry = projectEntry(item, input);
        if (entry === null) { limitations.add('unsupported-entry'); continue; }
        entries.set(entry.calendarId, entry);
      }
      const next = response.body.nextPageToken;
      if (next !== undefined && (typeof next !== 'string' || next.length === 0 || next.length > 2048)) providerInvalid();
      token = typeof next === 'string' ? next : null;
      if (token === null) break;
      if (seenTokens.has(token)) { limitations.add('provider-error'); break; }
      seenTokens.add(token);
      if (entries.size >= countCap) { limitations.add('calendar-limit'); break; }
      if (page + 1 === pageCap) limitations.add('page-limit');
    }
    const retained = [...entries.values()].sort((a, b) => Number(b.primary) - Number(a.primary)
      || (a.calendarId < b.calendarId ? -1 : a.calendarId > b.calendarId ? 1 : 0));
    if (retained.length > countCap) limitations.add('calendar-limit');
    if (!retained.slice(0, countCap).some(e => e.primary)) limitations.add('primary-missing');
    return calendarDiscoverySnapshotSchema.parse({ schemaVersion: 2,
      connectionId: input.account.connectionId, connectionRevision: input.account.connectionRevision,
      discoveryRevision: input.discoveryRevision, entries: retained.slice(0, countCap), fetchedAt,
      expiresAt: new Date(expires).toISOString(), complete: token === null && limitations.size === 0,
      truncated: ['calendar-limit', 'page-limit', 'byte-limit'].some(v => limitations.has(v as Snapshot['limitations'][number])),
      nextPageToken: token, limitations: [...limitations],
      retentionPolicyId: input.retentionPolicy?.policyId ?? null,
      retentionExpiresAt: input.retentionPolicy?.expiresAt ?? fetchedAt });
  }
}
```

Missing `items` is an empty list **only** for a Google `kind:'calendar#calendarList'` envelope; arbitrary `{}` remains malformed. In Task 3 add the explicit fixture before admitting that provider variant. Normal valid empty discovery uses `items: []` and returns `primary-missing`, not complete.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-discovery-api.spec.ts -t "follows a short|does not fabricate"`.
- [ ] **Commit** the three explicit new paths: `feat(calendar): discover bounded pages and shared role capabilities`.

## Task 3: Make discovery duplicates, overflow, partial refresh and privacy honest

**Files:** Modify only `backend/src/plugins/google-calendar/calendar-discovery-api.ts` and `backend/test/plugins/google-calendar/calendar-discovery-api.spec.ts`.

- [ ] **Write failing tests:**

```ts
it('keeps primary on overflow and never calls a token-bearing short page complete', async () => {
  const fake = fakeFetch([
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
      items: [providerEntry('first')], nextPageToken: 'p2' }) },
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
      items: [providerEntry('second'), providerEntry()], nextPageToken: 'p3' }) },
  ]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(
    discoveryInput({ limits: { retainedCalendars: 2, pageDeliveries: 2, snapshotBytes: 262144, freshnessMs: 300000 } }));
  expect(result.entries).toHaveLength(2);
  expect(primaryCalendarId(result)).toBe('canonical-primary');
  expect(result).toMatchObject({ complete: false, truncated: true, nextPageToken: 'p3' });
  expect(result.limitations).toContain('calendar-limit');
  expect(fake.requests).toHaveLength(2);
});

it('deduplicates identical entries but quarantines conflicting roles and multiple primaries', async () => {
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
    items: [providerEntry(), providerEntry(), providerEntry('shared', { accessRole: 'writer' }),
      providerEntry('shared', { accessRole: 'reader' }), providerEntry('other-primary', { primary: true }),
      providerEntry('unknown', { accessRole: 'superOwner' }),
      providerEntry('masked', { accessRole: 'writerWithoutPrivateAccess' }),
      providerEntry('hidden', { hidden: true }), providerEntry('deleted', { deleted: true })] }) }]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput());
  expect(result.complete).toBe(false);
  expect(result.limitations).toEqual(expect.arrayContaining(['unsupported-entry', 'primary-missing']));
  expect(primaryCalendarId(result)).toBeNull();
  expect(result.entries.some(e => ['shared', 'unknown'].includes(e.calendarId))).toBe(false);
  expect(result.entries.find(e => e.calendarId === 'masked')).toMatchObject({ privateAccess: false,
    capabilities: { readEvents: true, createEvents: true, availability: true } });
  for (const id of ['hidden', 'deleted']) expect(result.entries.find(e => e.calendarId === id)?.capabilities)
    .toEqual({ readEvents: false, createEvents: false, availability: false });
});

it('returns bounded partial data on later failure and applies the strictest cache evidence', async () => {
  const fake = fakeFetch([
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
      items: [providerEntry()], nextPageToken: 'p2' }, { headers: { 'cache-control': 'max-age=120', age: '30' } }) },
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({}, { status: 503 }) },
  ]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput());
  expect(result).toMatchObject({ complete: false, expiresAt: '2026-10-22T10:01:30.000Z' });
  expect(result.limitations).toContain('provider-error');
  expect(result.entries).toHaveLength(1);
  expect(fake.requests).toHaveLength(2);
  const noStore = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ items: [providerEntry()] }, { headers: { 'cache-control': 'no-store' } }) }]);
  const volatile = await new CalendarDiscoveryApi({ fetcher: noStore.fetcher, now: clock }).discover(discoveryInput());
  expect(volatile.expiresAt).toBe(volatile.fetchedAt);
  expect(volatile.retentionExpiresAt).toBe(volatile.fetchedAt);
});

it('obeys lower UTF-8 snapshot bytes and refuses to invent a continuation inside a page', async () => {
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
    items: [providerEntry(), ...Array.from({ length: 8 }, (_, i) => providerEntry(`c${i}`, { summary: '界'.repeat(200) }))] }) }]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput({
    limits: { retainedCalendars: 100, pageDeliveries: 2, snapshotBytes: 5000, freshnessMs: 300000 } }));
  expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(5000);
  expect(result).toMatchObject({ complete: false, truncated: true, nextPageToken: null });
  expect(result.limitations).toContain('byte-limit');
  expect(primaryCalendarId(result)).toBe('canonical-primary');
});
```

The last fixture needs a raw response allowance larger than 5,000 because it intentionally tests **normalized snapshot** trimming. `snapshotBytes` bounds persisted normalized data; use the separate fixed 262,144-byte **working** ceiling for raw discovery ingestion. Count raw UTF-8 ingestion plus retained serialized metadata against that ceiling as described below. Do not confuse these two bounds or reject the fixture solely because a response is bigger than the configured normalized snapshot cap.

- [ ] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-discovery-api.spec.ts -t "deduplicates identical|later failure|lower UTF-8"`. Expected duplicate-primary schema rejection, propagated second-page error, and missing byte/privacy enforcement.
- [ ] **Minimal implementation**, in the discovery module:

1. Add a `rejectedIds` set and a `seenEntries` map of canonical ID → SHA-256 of normalized entry (each ≤1,000 IDs: 10 deliveries ×100), use `jsonBytes` from contracts, and increment raw byte work using `response.bodyBytes`. Normalize only the allowlisted fields. A duplicate with identical normalized JSON is harmless; a conflicting duplicate removes that ID and permanently quarantines it for this refresh, even if the first copy was evicted by the retained-calendar ceiling. Unknown/invalid metadata adds `unsupported-entry`; if its bounded canonical ID matches a previously seen valid entry, quarantine that ID too. Distinct primary claims quarantine **both** claiming IDs, including claims discovered after eviction; never pick one or manufacture an email-based primary. Keep a separate bounded primary-claim ID to detect that case. Reject malformed top-level envelopes/tokens as `CALENDAR_RESPONSE_INVALID`; after an earlier valid page, convert those read failures to partial `provider-error` without erasing retained entries.

```ts
// Inside ingestion, replacing the unconditional entries.set:
if (rejectedIds.has(entry.calendarId)) continue;
const fingerprint = createHash('sha256').update(JSON.stringify(entry), 'utf8').digest('hex');
const previous = seenEntries.get(entry.calendarId);
if (previous !== undefined && previous !== fingerprint) {
  entries.delete(entry.calendarId); rejectedIds.add(entry.calendarId);
  limitations.add('unsupported-entry'); continue;
}
seenEntries.set(entry.calendarId, fingerprint);
entries.set(entry.calendarId, entry);
```

Import `createHash` from `node:crypto` in the discovery module. Quarantine duplicate-primary IDs before retention/eviction. When a third primary claim arrives, quarantine that too. Keep at most `countCap` normalized entries after processing each item, with primary first, then lexical canonical ID; scan the rest of the already-delivered page to retain an encountered primary. No extra request solely to guess missing primary. A primary absent from unvisited pages remains unknown. Stop on a repeated token and retain that bounded token with `provider-error`; stop at count/page ceiling with explicit limitations. Out-of-turn cap is 10 deliveries; in-turn cap is 2 even if the input asks for 10. Lower positive limits apply; NaN/zero/fractional limits fail before admission.

```ts
// Retention/eviction order (also use before the final snapshot projection):
const priority = (a: CalendarDiscoveryEntry, b: CalendarDiscoveryEntry) =>
  Number(b.primary) - Number(a.primary)
  || (a.calendarId < b.calendarId ? -1 : a.calendarId > b.calendarId ? 1 : 0);
// ponytail: bounded top-k sort, at most 100 retained entries plus one candidate;
// use a bounded heap only if the approved calendar ceiling grows.
if (entries.size > countCap) {
  const ordered = [...entries.values()].sort(priority);
  entries.delete(ordered[ordered.length - 1]!.calendarId);
  limitations.add('calendar-limit');
}
```

Do not keep all pages or unbounded raw payloads. Before each HTTP delivery calculate remaining working capacity as `262144 - rawBytesAlreadyIngested - jsonBytes([...entries.values()]) - jsonBytes([...rejectedIds]) - jsonBytes([...seenEntries])`; pass its positive remainder as `responseBytes` (clamped to 262144). Recheck this serialized ledger while normalizing: raw bytes already received plus retained entries/fingerprints must not exceed 262144. If no capacity remains, stop with `byte-limit` and incomplete coverage. After receiving a page count `bodyBytes` and release its raw reference before the next page. This is a conservative serialized-data work budget, **not a claim about exact V8 heap allocation**. Cap each page at 100 items and at most 10 deliveries so all auxiliary loops/sets are finite. Until Task 7 adds an explicit transport byte-failure distinction, a malformed/oversized read after an earlier page is conservatively `provider-error`; never infer the exact cause from private provider prose. Do not retry a malformed body.

2. Add this shared helper in the same P3 module (availability reuses it). It can only shorten retention/freshness:

```ts
export function providerCacheDeadline(headers: Headers, fetchedAt: string, ceiling: number): number {
  const at = Date.parse(fetchedAt);
  let end = ceiling;
  const directives = (headers.get('cache-control') ?? '').split(',').map(v => v.trim().toLowerCase());
  const age = Number(headers.get('age') ?? '0');
  if (!Number.isFinite(age) || age < 0) return at;
  for (const directive of directives) {
    if (['no-store', 'no-cache'].includes(directive)) return at;
    if (directive.startsWith('max-age=')) {
      const value = directive.slice(8).replace(/^"|"$/gu, '');
      if (!/^\d+$/u.test(value)) return at;
      end = Math.min(end, at + Math.max(0, Number(value) - age) * 1000);
    }
  }
  const expires = headers.get('expires');
  if (expires !== null) {
    const parsed = Date.parse(expires);
    if (!Number.isFinite(parsed)) return at;
    end = Math.min(end, parsed);
  }
  return Math.max(at, end);
}
```

Take the minimum deadline across every page and the operator retention policy. Clamp snapshots to ≤5 minutes and set `retentionExpiresAt` to that stricter deadline too; a no-store/expired policy result is volatile (`expiresAt === fetchedAt`, no persisted-content permission). The helper uses each response's real `fetchedAt`; the snapshot's overall expiry must still be ≥ its first `fetchedAt` and ≤ that first time +5 minutes. A zero-lifetime result remains valid only as a transient return; P2/P4 must not store it as an active connection snapshot.

3. Catch only provider read/parse/size failures after a successful page; propagate credential, cancellation, policy, and admission/persistence faults. Never turn an admission uncertainty into an apparently authoritative subset. For a first-page provider failure propagate its safe `CalendarToolFault` so the caller can use its existing bounded retry mechanism. Subsequent failures yield partial data and a limitation; P4 decides whether to keep the previous complete persisted snapshot. P3 does not merge new partial data with an old snapshot it never received.

4. Build a candidate snapshot with all limitation flags, then trim normalized entries until `jsonBytes(candidate) <= min(input.limits.snapshotBytes, 262144)`. Remove lowest-priority non-primary entries first; set `truncated:true`, `complete:false`, and `byte-limit` **before measuring**. If even primary plus the envelope does not fit, omit primary with `primary-missing`; if the empty truthful envelope cannot fit, throw `CALENDAR_RESULT_TOO_LARGE`, never return oversized data. Tokens are nullable only when no provider continuation exists; trimming inside a delivered page does not create a continuation. Final `calendarDiscoverySnapshotSchema.parse` is mandatory. Do not mark complete merely because fewer than 100 entries arrived or because a loop stopped.

Add the following exact matrix tests before green; these often already pass and remain regression evidence rather than fabricated red evidence:

```ts
it('bounds token loops, missing primary and malformed metadata without leaking payloads', async () => {
  const cases = [
    [{ items: [], nextPageToken: 'again' }, { items: [], nextPageToken: 'again' }],
    [{ items: [providerEntry('unknown', { accessRole: 'superOwner' })] }],
    [{ items: [providerEntry('bad-zone', { timeZone: 'Invalid/Zone' }), providerEntry()] }],
  ];
  for (const pages of cases) {
    const fake = fakeFetch(pages.map(body => ({ method: 'GET', path: '/calendar/v3/users/me/calendarList',
      response: () => googleJson(body) })));
    const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput());
    expect(result.complete).toBe(false);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(fake.requests.length).toBeLessThanOrEqual(2);
  }
  for (const body of [{}, { items: {} }, { items: [], nextPageToken: 42 },
    { items: [], nextPageToken: '' }, { items: [], nextPageToken: 'x'.repeat(2049) }]) {
    const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson(body) }]);
    await expect(new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput()))
      .rejects.toThrow('CALENDAR_RESPONSE_INVALID');
  }
});
```

Add these concrete boundary checks in the same file before green:

```ts
it('caps ten out-of-turn deliveries and two in-turn deliveries even on empty pages', async () => {
  for (const mode of ['in-turn', 'out-of-turn'] as const) {
    const cap = mode === 'in-turn' ? 2 : 10;
    const fake = fakeFetch(Array.from({ length: 11 }, (_, i) => ({ method: 'GET',
      path: '/calendar/v3/users/me/calendarList', response: () => googleJson({ items: [], nextPageToken: `p${i}` }) })));
    const base = discoveryInput();
    const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover({ ...base,
      mode, limits: { ...base.limits, pageDeliveries: 10 } });
    expect(fake.requests).toHaveLength(cap);
    expect(result).toMatchObject({ complete: false, truncated: true, nextPageToken: `p${cap - 1}` });
    expect(result.limitations).toEqual(expect.arrayContaining(['page-limit', 'primary-missing']));
  }
});

it('retains exactly one hundred entries and marks candidate one hundred one as overflow', async () => {
  for (const count of [100, 101]) {
    const first = Array.from({ length: 99 }, (_, i) => providerEntry(`c${i}`));
    const second = [providerEntry(), ...(count === 101 ? [providerEntry('extra')] : [])];
    const fake = fakeFetch([
      { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({ items: first, nextPageToken: 'p2' }) },
      { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({ items: second }) },
    ]);
    const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput());
    expect(result.entries).toHaveLength(100);
    expect(primaryCalendarId(result)).toBe('canonical-primary');
    expect(result.complete).toBe(count === 100);
    expect(result.truncated).toBe(count === 101);
    expect(fake.requests).toHaveLength(2);
  }
});

it('bounds hostile metadata and leaves denied caching volatile', async () => {
  const bad = [providerEntry('primary'), providerEntry('bad\nID'), providerEntry('x'.repeat(1025)),
    providerEntry('long-label', { summary: 'x'.repeat(201) }), providerEntry('null-zone', { timeZone: null }),
    providerEntry('unknown-zone', { timeZone: 'Invalid/Zone' }), providerEntry('bad-flag', { hidden: 'false' })];
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ items: [providerEntry(), ...bad] }) }]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput({ retentionPolicy: null }));
  expect(result.entries).toHaveLength(1);
  expect(result).toMatchObject({ complete: false, retentionPolicyId: null, expiresAt: NOW });
  expect(result.expiresAt).toBe(result.fetchedAt);
  expect(result.limitations).toContain('unsupported-entry');
  const empty = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ kind: 'calendar#calendarList' }) }]);
  const emptyResult = await new CalendarDiscoveryApi({ fetcher: empty.fetcher, now: clock }).discover(discoveryInput());
  expect(emptyResult).toMatchObject({ entries: [], complete: false, limitations: ['primary-missing'] });
});
```

For the missing-items fixture, replace the envelope array guard with `items = response.body.items === undefined && response.body.kind === 'calendar#calendarList' ? [] : response.body.items`, then require `Array.isArray(items)` and `items.length <=100`. No arbitrary object coercion. Keep optional flag defaults false and missing timezone null, not an invented provider timezone. A null timezone is malformed provider metadata rather than an IANA zone.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-discovery-api.spec.ts`.
- [ ] **Commit** the two explicit paths: `fix(calendar): bound discovery refreshes and preserve honest snapshot evidence`.

## Task 4: Validate availability authority/range and deliver no more than two concrete batches

**Files:** Create `backend/src/plugins/google-calendar/calendar-availability-api.ts` and `backend/test/plugins/google-calendar/calendar-availability-api.spec.ts`; read/reuse the P3 fixture and discovery helpers.

- [ ] **Write failing tests:**

```ts
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { CalendarAvailabilityApi } from '../../../src/plugins/google-calendar/calendar-availability-api.js';
import { calendarAvailabilityResultSchema, calendarAvailabilityFingerprint }
  from '../../../src/contracts/calendar-availability.js';
import { fakeFetch, googleJson } from './tools-fixtures.js';
import { availabilityInput, snapshot, clock, NOW } from './calendar-discovery-api-fixtures.js';

it('batches one hundred authorized calendars into two counted requests without groups', async () => {
  const snap = snapshot(100);
  const fake = fakeFetch([0, 50].map(offset => ({ method: 'POST', path: '/calendar/v3/freeBusy',
    response: () => googleJson({ timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z',
      calendars: Object.fromEntries(snap.entries.slice(offset, offset + 50).map(e => [e.calendarId, { busy: [] }])) }) })));
  const kinds: string[] = [];
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({
    snapshot: snap, calendarIds: snap.entries.map(e => e.calendarId),
    consumeRequest: async kind => { kinds.push(kind); } }));
  expect(result).toMatchObject({ coverage: 'complete', conflict: 'clear', semantics: 'google-opaque-busy-only',
    free: [{ start: '2026-10-22T11:00:00.000Z', end: '2026-10-22T12:00:00.000Z' }] });
  expect(result.calendars).toHaveLength(100);
  expect(kinds).toEqual(['availability', 'availability']);
  expect(fake.requests).toHaveLength(2);
  const ids: string[] = [];
  for (const request of fake.requests) {
    const body = await request.clone().json();
    expect(body.items).toHaveLength(50);
    expect(body.calendarExpansionMax).toBe(50);
    expect(body).not.toHaveProperty('groupExpansionMax');
    expect(body).not.toHaveProperty('groups');
    expect(body.timeZone).toBe('Europe/London');
    ids.push(...body.items.map((item: { id: string }) => item.id));
  }
  expect(new Set(ids).size).toBe(100);
  expect(result.calendarSetHash).toBe(createHash('sha256')
    .update(JSON.stringify([...ids].sort()), 'utf8').digest('hex'));
});

it('rejects forged authority, unknown IDs and invalid ranges before network admission', async () => {
  const fake = fakeFetch([]);
  const api = new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock });
  const base = availabilityInput();
  for (const patch of [{ calendarIds: ['not-discovered'] }, { calendarIds: ['primary'] },
    { calendarIds: ['c0', 'c0'] }, { timeZone: 'Invalid/Zone' },
    { timeMin: '2026-02-30T10:00:00Z' }, { timeMin: base.timeMax },
    { timeMax: '2026-11-22T11:00:00.001Z' }]) {
    await expect(api.check(availabilityInput(patch))).rejects.toThrow('CALENDAR_INPUT_REJECTED');
  }
  await expect(api.check(availabilityInput({ snapshot: { ...base.snapshot, connectionRevision: 2 } })))
    .rejects.toThrow('CALENDAR_EXECUTION_DENIED');
  expect(fake.requests).toHaveLength(0);
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-availability-api.spec.ts -t "batches one hundred|rejects forged"`.
- [ ] **Minimal implementation:** derive `AvailabilityInput` from the port; export `CalendarAvailabilityApi` with the same `{ fetcher?, now? }` constructor as discovery. Reuse the context/deadline/grant/zone guards, HTTP helper, and P1 result schema. Before any request, validate snapshot with its schema and exact account connection ID/revision; reject IDs not in the snapshot, duplicates, `primary`, controls, `.`/`..`, empty IDs and empty sets. Validate strict RFC3339 using the existing `parseCalendarTimestamp` rather than permissive `Date.parse` alone. Validate positive revisions and integer-positive port limits, clamp to frozen ceilings, and reject a range above 31 days or end ≤start. Zone is a presentation/query IANA zone, not a requirement that every timestamp use that zone's offset. Fixed UTC `Z` input with `Europe/London` is valid.

Use exact timestamp comparison for range boundaries (including submillisecond fractions), then epoch milliseconds for the finite interval sweep. For a range that cannot be represented losslessly at millisecond precision, fail closed `CALENDAR_INPUT_REJECTED`; do not round a requested window into an unrequested free interval. Busy endpoints may be conservatively rounded outward to millisecond precision in Task 6. Bound raw timestamp strings to 96 chars before parsing.

```ts
import { createHash } from 'node:crypto';
import type { CalendarAvailabilityPort } from '../../contracts/calendar-availability.js';
import { calendarAvailabilityBatchSchema, calendarAvailabilityResultSchema }
  from '../../contracts/calendar-availability.js';
import { calendarDiscoverySnapshotSchema } from '../../contracts/calendar-discovery.js';
import { CALENDAR_LIMITS } from '../../contracts/calendar-policy.js';
import { calendarHttp } from './calendar-api-http.js';
import { providerDeadline, providerInvalid, providerRecord, providerZone }
  from './calendar-discovery-api.js';
import { parseCalendarTimestamp, compareCalendarTimes, toolFault } from './tools-validation.js';

type AvailabilityInput = Parameters<CalendarAvailabilityPort['check']>[0];
type Availability = Awaited<ReturnType<CalendarAvailabilityPort['check']>>;
const iso = (at: number) => new Date(at).toISOString();
const inputRejected = (): never => { throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED'); };
```

Set `calendarSetHash = sha256(JSON.stringify([...canonicalRequestedIds].sort()))`; labels/order/timestamps/revisions are not part of the set hash. Sorting is account-local canonical ID ordering, not locale-dependent name matching. Build coverage from snapshot labels, never provider errors or event metadata. Query concrete IDs in sequential slices of `min(limits.batchCalendars,50)` and no more than `min(limits.batches,2)` batches. Do not use Google Groups, multipart batching, events.list, arbitrary URLs, or a write request. A lower batch-size limit may leave requested IDs unqueried after two batches: represent them as unsupported and add `calendar-limit`, never issue batch three.

The delivery and base projection are:

```ts
const query = new URLSearchParams({ fields: 'timeMin,timeMax,calendars' });
calendarAvailabilityBatchSchema.parse({ calendarIds: batch });
const response = await calendarHttp({ fetcher: this.fetcher, path: '/freeBusy', method: 'POST', query,
  accessToken: input.accessToken, signal: input.signal, deadlineAt, now: this.clock,
  consumeRequest: () => input.consumeRequest(input.purpose),
  body: { timeMin: input.timeMin, timeMax: input.timeMax, timeZone: input.timeZone,
    calendarExpansionMax: 50, items: batch.map(id => ({ id })) } });
if (!providerRecord(response.body) || !providerRecord(response.body.calendars)
  || typeof response.body.timeMin !== 'string' || typeof response.body.timeMax !== 'string'
  || Date.parse(response.body.timeMin) !== low || Date.parse(response.body.timeMax) !== high) providerInvalid();
```

Match provider response instants to the requested range; never use returned bounds to expand the query. For this task require each requested `calendars[id]` to contain an array `busy` with valid start<end RFC3339 intervals and no nonempty errors; otherwise throw a safe response fault. Ignore unrequested map keys; do not iterate/return their contents. Keep all decoded busy intervals for requested entries, clip to `[low,high)`, sort by start, and create the exact complementary free ranges only if coverage is complete. Task 6 adds overlapping/adjacent coalescing; until then the P1 schema safely rejects uncoalesced overlap rather than returning false free space.

Final result shape is fixed, not another response envelope:

```ts
return calendarAvailabilityResultSchema.parse({ schemaVersion: 2, tool: 'calendar_check_availability',
  connectionId: input.account.connectionId, connectionRevision: input.account.connectionRevision,
  discoveryRevision: input.snapshot.discoveryRevision, availabilityRevision: input.availabilityRevision,
  calendarSetHash, timeMin: iso(low), timeMax: iso(high), timeZone: input.timeZone,
  checkedAt, expiresAt, semantics: 'google-opaque-busy-only', calendars, busy, free,
  coverage: 'complete', conflict: busy.length ? 'conflict' : 'clear', truncated: false, limitations: [] });
```

`checkedAt` is this invocation's clock instant; `expiresAt` is no later than checkedAt +5 minutes, snapshot expiry, supplied retention policy, and the strictest response-header deadline. Without retention evidence, use zero lifetime. Task 5 replaces the complete-only branch with honest partial results. Do not return raw headers, tokens, full bodies, event titles, descriptions, attendees, or a guessed target. P5 still has to enforce the final 16,384-byte MCP envelope including source overhead; ≤15,360 bytes here is not a guarantee about a large envelope.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-availability-api.spec.ts -t "batches one hundred|rejects forged"`.
- [ ] **Commit** the two explicit new paths: `feat(calendar): add authorized bounded freebusy batch delivery`.

## Task 5: Treat HTTP-200 calendar errors and incomplete discovery as unknown coverage

**Files:** Modify only `backend/src/plugins/google-calendar/calendar-availability-api.ts` and `backend/test/plugins/google-calendar/calendar-availability-api.spec.ts`.

- [ ] **Write failing tests:**

```ts
it('isolates HTTP-200 per-calendar errors and never turns missing busy data into free', async () => {
  const entries = snapshot(3);
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: {
      c0: { busy: [] }, c1: { busy: [], errors: [{ domain: 'global', reason: 'notFound', message: 'private-detail' }] },
    } }) }]);
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({
    snapshot: entries, calendarIds: ['c0', 'c1', 'c2'] }));
  expect(result.calendars).toEqual([
    { calendarId: 'c0', calendarLabel: 'Calendar 0', status: 'ok', reason: null },
    { calendarId: 'c1', calendarLabel: 'Calendar 1', status: 'error', reason: 'not-found' },
    { calendarId: 'c2', calendarLabel: 'Calendar 2', status: 'error', reason: 'missing-response' },
  ]);
  expect(result).toMatchObject({ coverage: 'incomplete', conflict: 'unknown', free: [] });
  expect(result.limitations).toContain('calendar-error');
  expect(JSON.stringify(result)).not.toContain('private-detail');
  expect(fake.requests).toHaveLength(1); // No OAuth, disconnect, or alternate-calendar delivery.
});

it('retains known conflicts after a failed batch and never certifies stale or partial discovery', async () => {
  const snap = snapshot(51);
  const fake = fakeFetch([
    { method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z',
      calendars: Object.fromEntries(snap.entries.slice(0, 50).map(e => [e.calendarId,
        { busy: e.calendarId === 'c0' ? [{ start: '2026-10-22T11:15:00Z', end: '2026-10-22T11:30:00Z' }] : [] }])) }) },
    { method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({}, { status: 503 }) },
  ]);
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({
    snapshot: snap, calendarIds: snap.entries.map(e => e.calendarId), purpose: 'preflight' }));
  expect(result).toMatchObject({ coverage: 'incomplete', conflict: 'conflict', free: [] });
  expect(result.calendars.find(e => e.calendarId === 'c50')).toMatchObject({ status: 'error', reason: 'provider-error' });
  expect(result.busy).toHaveLength(1);
  const staleFake = fakeFetch([]);
  const stale = await new CalendarAvailabilityApi({ fetcher: staleFake.fetcher, now: clock }).check(availabilityInput({
    now: '2026-10-22T10:05:00.000Z' }));
  expect(stale).toMatchObject({ coverage: 'incomplete', conflict: 'unknown', free: [] });
  expect(stale.limitations).toContain('discovery-stale');
  expect(staleFake.requests).toHaveLength(0);
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-availability-api.spec.ts -t "isolates HTTP-200|retains known conflicts"`.
- [ ] **Minimal implementation:** initialize the requested coverage array with `status:'error',reason:'missing-response'` before batching; update only after validated responses. A requested calendar whose `errors` is nonempty **always** remains error even if `busy:[]` or plausible busy data appears beside it. Empty/malformed error entries fail closed `provider-error`. The allowlist mapping is:

```ts
function coverageReason(reason: unknown): Availability['calendars'][number]['reason'] {
  switch (reason) {
    case 'notFound': return 'not-found';
    case 'forbidden': case 'insufficientPermissions': return 'forbidden';
    case 'rateLimitExceeded': case 'userRateLimitExceeded': return 'rate-limit';
    case 'quotaExceeded': return 'quota';
    case 'tooManyCalendarsRequested': case 'groupTooBig': return 'unsupported';
    default: return 'provider-error';
  }
}
```

Inspect at most 10 reasons per calendar; errors beyond that still mean error, not success. Prefer terminal quota/forbidden/not-found when several reasons disagree; raw reason/message/domain strings are never copied. Do not expand returned `groups`. A group-shaped/unrequested identifier cannot become authority through the response map. A missing requested map entry maps `missing-response`; missing/malformed `busy`, date-only or invalid/reversed endpoints map `provider-error`. A malformed top-level envelope invalidates the affected batch. Do not reinterpret undefined busy as empty busy.

If the snapshot is stale at trusted `input.now` **or** the actual invocation clock, return `stale` per calendar, limitation `discovery-stale`, no requests and no free intervals. A fresh but incomplete/truncated snapshot may query its admitted requested entries, but add `discovery-partial` and withhold all free claims. Hidden/deleted/no-availability entries become `unsupported`/`unsupported`, are not queried, and force incomplete coverage. Recompute effective availability from current scopes/policy plus role rather than trusting a forged cached writable flag. An empty, over-100 or over-batch-cap set cannot yield clear: either reject invalid input before requests or return a compact `calendar-limit` incomplete result. Never query an unknown ID.

Catch a delivery failure after a prior successful batch and map the entire affected batch to an error reason: `EVENT_NOT_FOUND → not-found`, `CALENDAR_FORBIDDEN → forbidden`, `CALENDAR_RATE_LIMITED → rate-limit`, `CALENDAR_QUOTA_EXCEEDED → quota`, other provider failure → provider-error. Keep validated busy intervals from earlier successful calendars; do not claim complete coverage. A first-batch delivery fault remains a typed fault, preserving eligible retry metadata for the caller. Credential, policy, request-admission/persistence and explicit cancellation faults always propagate, even after earlier successes. Deadline/byte exhaustion that prevents another batch instead produces incomplete `deadline`/`byte-limit` with no further delivery. There are no connection-state mutation calls in P3.

The final coverage predicate and result fields replace the Task 4 complete-only values:

```ts
const complete = calendars.length > 0 && calendars.every(c => c.status === 'ok')
  && limitations.size === 0 && !truncated;
const coverage = complete ? 'complete' : 'incomplete';
const free = complete ? complement(busy, low, high) : [];
const conflict = busy.length ? 'conflict' : complete ? 'clear' : 'unknown';
```

`complement` is the bounded UTC sweep introduced in Task 6; initially use the existing Task 4 complementary-gap loop with the same behavior. Incomplete requires at least one P1 allowlisted limitation; per-calendar `error`/`unsupported` adds `calendar-error`, stale adds `discovery-stale`, omitted batches add `calendar-limit`. Do not set `truncated` for an ordinary provider error unless something was actually omitted due to a size/count bound. The final schema must pass; never adjust its rules locally.

Add exact error-reason and lower-batch-limit assertions before green:

```ts
it('maps per-calendar quota and unsupported errors without automatic retries', async () => {
  const reasons = ['insufficientPermissions', 'rateLimitExceeded', 'userRateLimitExceeded',
    'quotaExceeded', 'tooManyCalendarsRequested', 'unknown-private-provider-reason'];
  const expected = ['forbidden', 'rate-limit', 'rate-limit', 'quota', 'unsupported', 'provider-error'];
  for (const [i, reason] of reasons.entries()) {
    const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z',
      calendars: { c0: { busy: [], errors: [{ reason }] } } }) }]);
    const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput());
    expect(result.calendars[0]).toMatchObject({ status: 'error', reason: expected[i] });
    expect(result).toMatchObject({ coverage: 'incomplete', conflict: 'unknown', free: [] });
    expect(fake.requests).toHaveLength(1);
  }
});
```

Add the partial snapshot/fingerprint test as well. P6 owns durable acknowledgement, not this adapter:

```ts
it('keeps a fresh partial calendar set unknown and fingerprints coverage changes', async () => {
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { c0: { busy: [] } } }) }]);
  const partial = { ...snapshot(), complete: false, truncated: true, nextPageToken: 'unvisited',
    limitations: ['page-limit' as const] };
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({ snapshot: partial }));
  expect(result).toMatchObject({ coverage: 'incomplete', conflict: 'unknown', free: [] });
  expect(result.limitations).toContain('discovery-partial');
  const fingerprint = calendarAvailabilityFingerprint(result);
  expect(calendarAvailabilityFingerprint({ ...result, availabilityRevision: 2,
    checkedAt: '2026-10-22T10:00:01.000Z' })).toBe(fingerprint);
  expect(calendarAvailabilityFingerprint({ ...result, calendars: result.calendars.map(c => ({ ...c,
    status: 'error', reason: 'not-found' })), limitations: ['discovery-partial', 'calendar-error'] }))
    .not.toBe(fingerprint);
});
```

- [ ] **Prove green**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-availability-api.spec.ts`.
- [ ] **Commit** the two explicit paths: `fix(calendar): preserve unknown coverage for per-calendar freebusy failures`.

## Task 6: Merge provider busy intervals in UTC, including DST and all-day projections

**Files:** Modify only `backend/src/plugins/google-calendar/calendar-availability-api.ts` and `backend/test/plugins/google-calendar/calendar-availability-api.spec.ts`.

- [ ] **Write failing tests** for overlap/adjacency and authoritative provider busy semantics:

```ts
it('coalesces opaque all-day recurring tentative focus and private busy projections across DST', async () => {
  // Google already expanded recurrence and converted opaque all-day boundaries.
  // These names describe fixture provenance only, not event fields sent to P3.
  const opaqueAllDay = { start: '2026-11-01T00:00:00-04:00', end: '2026-11-02T00:00:00-05:00' };
  const recurring = { start: '2026-11-01T01:15:00-04:00', end: '2026-11-01T01:45:00-04:00' };
  const tentative = { start: '2026-11-01T01:30:00-05:00', end: '2026-11-01T02:00:00-05:00' };
  const outOfOffice = { start: '2026-11-02T00:00:00-05:00', end: '2026-11-02T01:00:00-05:00' };
  const focusPrivate = { start: '2026-11-02T00:30:00-05:00', end: '2026-11-02T01:30:00-05:00' };
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-11-01T04:00:00Z', timeMax: '2026-11-02T07:00:00Z',
    calendars: { c0: { busy: [focusPrivate, tentative, opaqueAllDay, recurring, outOfOffice],
      summary: 'must-not-escape', attendees: ['private@example.invalid'] } } }) }]);
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({
    timeMin: '2026-11-01T04:00:00Z', timeMax: '2026-11-02T07:00:00Z', timeZone: 'America/New_York' }));
  expect(result.busy).toEqual([{ start: '2026-11-01T04:00:00.000Z', end: '2026-11-02T06:30:00.000Z' }]);
  expect(result.free).toEqual([{ start: '2026-11-02T06:30:00.000Z', end: '2026-11-02T07:00:00.000Z' }]);
  expect(result).toMatchObject({ coverage: 'complete', conflict: 'conflict', semantics: 'google-opaque-busy-only' });
  expect(JSON.stringify(result)).not.toMatch(/must-not-escape|private@example/);
});

it('clips half-open intervals and does not invent busy for transparent events or working hours', async () => {
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { c0: { busy: [
      { start: '2026-10-22T10:00:00Z', end: '2026-10-22T11:00:00Z' },
      { start: '2026-10-22T12:00:00Z', end: '2026-10-22T13:00:00Z' },
    ] } } }) }]);
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput());
  expect(result.busy).toEqual([]);
  expect(result.free).toEqual([{ start: '2026-10-22T11:00:00.000Z', end: '2026-10-22T12:00:00.000Z' }]);
  expect(result.semantics).toBe('google-opaque-busy-only');
  expect(fake.requests.every(r => new URL(r.url).pathname === '/calendar/v3/freeBusy')).toBe(true);
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-availability-api.spec.ts -t "coalesces opaque"`. Expect P1 schema rejection for overlapping raw intervals or different uncoalesced output; retain the clipping check even if already green.
- [ ] **Minimal implementation:** validate raw RFC3339 endpoints strictly, round a submillisecond busy start **down** and busy end **up** (only after validation), then clip and merge. Do not infer busy from events fields, event type, tentative status, visibility, or Google UI selection. Use the server free/busy projection as the only busy source. A 23/25-hour opaque all-day block remains 23/25 elapsed hours, not a reconstructed 24-hour local day. Dates without offsets, invalid dates, end≤start and malformed arrays are errors, never empty busy.

```ts
type Interval = Availability['busy'][number];
function coalesce(intervals: Interval[], low: number, high: number): Interval[] {
  const sorted = intervals.map(v => ({ start: Math.max(low, Date.parse(v.start)),
    end: Math.min(high, Date.parse(v.end)) })).filter(v => v.end > v.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged.map(v => ({ start: iso(v.start), end: iso(v.end) }));
}
function complement(busy: Interval[], low: number, high: number): Interval[] {
  const free: Interval[] = [];
  let cursor = low;
  for (const interval of busy) {
    const start = Date.parse(interval.start), end = Date.parse(interval.end);
    if (start > cursor) free.push({ start: iso(cursor), end: iso(start) });
    cursor = Math.max(cursor, end);
  }
  if (cursor < high) free.push({ start: iso(cursor), end: iso(high) });
  return free;
}
```

Use `coalesce` before generating any complement or fingerprint. The result timestamps are canonical UTC `Z` instants, with requested IANA `timeZone` retained for presentation; do not add a wall-clock reformatting library. Existing private event details are never loaded. `freeBusyReader` may return the same intervals as owner despite having no event-read capability.

Before green add the parameterized DST and freeBusyReader checks (each uses a freebusy fixture, never an event-list fixture):

```ts
it('preserves twenty-three and twenty-five elapsed hour all-day blocks for freeBusyReader', async () => {
  for (const [start, end, hours] of [
    ['2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00', 23],
    ['2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', 25],
  ] as const) {
    const snap = snapshot();
    snap.entries[0] = { ...snap.entries[0]!, accessRole: 'freeBusyReader', privateAccess: false,
      capabilities: { readEvents: false, createEvents: false, availability: true } };
    const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: start, timeMax: end, calendars: { c0: { busy: [{ start, end }] } } }) }]);
    const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({
      snapshot: snap, timeMin: start, timeMax: end, timeZone: 'America/New_York' }));
    expect(result).toMatchObject({ coverage: 'complete', conflict: 'conflict', free: [] });
    expect(result.busy).toHaveLength(1);
    expect(Date.parse(result.busy[0]!.end) - Date.parse(result.busy[0]!.start)).toBe(hours * 3600000);
    expect(fake.requests).toHaveLength(1);
  }
});

it('merges equivalent offsets nested duplicates and adjacent clipped intervals', async () => {
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { c0: { busy: [
      { start: '2026-10-22T10:45:00Z', end: '2026-10-22T11:15:00Z' },
      { start: '2026-10-22T12:00:00+01:00', end: '2026-10-22T12:15:00+01:00' },
      { start: '2026-10-22T11:15:00Z', end: '2026-10-22T12:30:00Z' },
    ] } } }) }]);
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput());
  expect(result.busy).toEqual([{ start: '2026-10-22T11:00:00.000Z', end: '2026-10-22T12:00:00.000Z' }]);
  expect(result.free).toEqual([]);
  expect(result.conflict).toBe('conflict');
});
```

The transparent/cancelled/declined/working-hours fixture is simply provider `busy:[]`. Assert the result retains `semantics:'google-opaque-busy-only'` and makes **no** events.list calls. This proves the adapter does not invent blocked hours or fetch event details; it does **not** prove Google actually omits those event types. Actual provider all-day/recurrence/transparent/ACL behavior remains the named live-service gate. Never describe this fixture as all-event, schedule, reservation, or real-Google evidence.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-availability-api.spec.ts`.
- [ ] **Commit** the two explicit paths: `feat(calendar): coalesce opaque busy intervals across timezone boundaries`.

## Task 7: Bound ingestion/output and retain no false all-clear under exhaustion

**Files:** Modify `backend/src/plugins/google-calendar/calendar-availability-api.ts`, `backend/test/plugins/google-calendar/calendar-availability-api.spec.ts`; make the narrowly specified byte-failure amendment in `backend/src/plugins/google-calendar/calendar-api-http.ts` and `backend/test/plugins/google-calendar/calendar-api-http.spec.ts`, and opt discovery into that diagnostic in `backend/src/plugins/google-calendar/calendar-discovery-api.ts`.

- [ ] **Write failing tests:**

```ts
it('bounds two thousand ingested intervals separately from coalesced output', async () => {
  for (const count of [2000, 2001]) {
    const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { c0: { busy:
        Array.from({ length: count }, () => ({ start: '2026-10-22T11:15:00Z', end: '2026-10-22T11:30:00Z' })) } } }) }]);
    const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput());
    expect(result.busy).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(15360);
    expect(result.coverage).toBe(count === 2000 ? 'complete' : 'incomplete');
    if (count === 2001) {
      expect(result).toMatchObject({ truncated: true, free: [], conflict: 'conflict' });
      expect(result.limitations).toContain('interval-limit');
    }
  }
});

it('truncates disjoint results to lower bytes without returning free windows', async () => {
  const start = Date.parse('2026-10-22T11:00:00Z');
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { c0: { busy:
      Array.from({ length: 120 }, (_, i) => ({ start: new Date(start + i * 20000).toISOString(),
        end: new Date(start + i * 20000 + 10000).toISOString() })) } } }) }]);
  const input = availabilityInput();
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check({
    ...input, limits: { ...input.limits, resultBytes: 3000 } });
  expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(3000);
  expect(result).toMatchObject({ coverage: 'incomplete', truncated: true, free: [], conflict: 'conflict' });
  expect(result.limitations).toContain('byte-limit');
  expect(result.busy.length).toBeGreaterThan(0);
  expect(result.busy.length).toBeLessThan(120);
});

it('does not exceed lower batch limits and accounts preflight separately from logical tools', async () => {
  const snap = snapshot(3);
  const fake = fakeFetch([0, 1].map(i => ({ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { [`c${i}`]: { busy: [] } } }) })));
  const input = availabilityInput();
  const kinds: string[] = [];
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check({ ...input,
    snapshot: snap, calendarIds: ['c0', 'c1', 'c2'], purpose: 'preflight',
    consumeRequest: async kind => { kinds.push(kind); }, limits: { ...input.limits, batchCalendars: 1 } });
  expect(kinds).toEqual(['preflight', 'preflight']);
  expect(fake.requests).toHaveLength(2);
  expect(result).toMatchObject({ coverage: 'incomplete', conflict: 'unknown', free: [], truncated: true });
  expect(result.limitations).toContain('calendar-limit');
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-availability-api.spec.ts -t "two thousand|lower bytes|lower batch"`.
- [ ] **Minimal implementation:** enforce the smallest supplied/hard ceiling at every ingestion stage. The 2,000 counter is **raw processed intervals across all calendars/batches**, including duplicates and intervals later clipped out; do not reset it per calendar/batch or count only the merged output. Once exceeded, stop interval processing, retain already validated intervals, mark remaining data unsupported, set `interval-limit`, `truncated:true`, `coverage:'incomplete'`, `free:[]`. Do not iterate/normalize the remainder or issue an unnecessary later batch. The raw HTTP body is still bounded by the shared reader.

Use at most 262,144 aggregate UTF-8 serialized working bytes: before each delivery subtract prior response `bodyBytes`, retained intervals and coverage projection bytes from `min(input.limits.workingBytes,262144)`. Give the positive remainder to `calendarHttp.responseBytes`. Recheck that ledger while ingesting a response as well. Coalesce the retained interval accumulator incrementally, so 2,000 identical raw intervals are counted as 2,000 ingested but require only one retained interval; do not duplicate a whole normalized copy of a provider body. With disjoint data that cannot fit the combined serialized ledger, stop with `byte-limit` before exceeding it. If no room remains before a request, add `byte-limit` and return incomplete without a request. A lower-byte read rejection gives incomplete `byte-limit` (including on the first batch) rather than “clear” or a second fetch. Malformed JSON/UTF-8 remains a safe response failure, not a size claim; keep transport faults distinct.

Add this failing HTTP regression **before** the byte-error amendment, using the existing HTTP fixture functions:

```ts
it('distinguishes an opted-in byte overflow from malformed provider JSON', async () => {
  const over = await calendarHttp(context({ responseBytes: 10,
    responseByteFailure: 'CALENDAR_RESPONSE_TOO_LARGE',
    fetcher: async () => new Response('{"s":"xxxxxxxx"}', { headers: { 'content-type': 'application/json' } }),
  })).catch((error: unknown) => error);
  expect(over).toHaveProperty('failure.code', 'CALENDAR_RESPONSE_TOO_LARGE');
  const malformed = await calendarHttp(context({ responseBytes: 100,
    responseByteFailure: 'CALENDAR_RESPONSE_TOO_LARGE',
    fetcher: async () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
  })).catch((error: unknown) => error);
  expect(malformed).toHaveProperty('failure.code', 'CALENDAR_RESPONSE_INVALID');
});
```

Run cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-api-http.spec.ts -t "distinguishes an opted-in"`; expect the existing generic overflow code, then green after this exact narrow change. Add `responseByteFailure?: 'CALENDAR_RESPONSE_TOO_LARGE'` to `CalendarHttpInput`. Add a defaulted final parameter to `readBoundedText`:

```ts
sizeCode: 'CALENDAR_RESPONSE_INVALID' | 'CALENDAR_RESPONSE_TOO_LARGE' = 'CALENDAR_RESPONSE_INVALID'
```

Only `size > limit` and `received > limit` throw `failure('delivery', sizeCode)`; invalid/negative declared size stays `CALENDAR_RESPONSE_INVALID`. Import the existing `CalendarToolFault` next to `toolFault`, and preserve an existing byte fault through **both** the reader's catch and the successful-body caller's catch:

```ts
if (error instanceof CalendarToolFault && error.failure.code === 'CALENDAR_RESPONSE_TOO_LARGE') throw error;
```

Pass `input.responseByteFailure` only to the successful-body read. Error-body reads keep their old default 8,192-byte behavior. Both P3 adapters pass `responseByteFailure:'CALENDAR_RESPONSE_TOO_LARGE'` and map that exact code to `byte-limit`/truncated/incomplete; discovery first-page byte exhaustion returns an empty bounded partial snapshot with `primary-missing` rather than claiming clear or parsing malformed data as a byte error. Event callers omit the option and retain every existing failure code. P1's flexible failure schema already admits this bounded new code; no contract edit is needed.

Result limit is `min(input.limits.resultBytes,15360)`, never 16,384 raw-body bytes. Build a candidate including final limitations and metadata before measuring; coalesce first, then trim only if necessary:

```ts
// Use jsonBytes from contracts/calendar-tools.ts. candidate is the final result object.
const limit = Math.min(input.limits.resultBytes, 15360);
if (jsonBytes(candidate) > limit) {
  candidate.truncated = true; candidate.coverage = 'incomplete'; candidate.free = [];
  candidate.limitations = [...new Set([...candidate.limitations, 'byte-limit' as const])];
  candidate.conflict = candidate.busy.length ? 'conflict' : 'unknown';
  while (jsonBytes(candidate) > limit && candidate.busy.length > 1) candidate.busy.pop();
  while (jsonBytes(candidate) > limit && candidate.calendars.length > 0) candidate.calendars.pop();
  if (jsonBytes(candidate) > limit) throw toolFault('delivery', 'CALENDAR_RESULT_TOO_LARGE');
}
return calendarAvailabilityResultSchema.parse(candidate);
```

Preserve at least one known busy interval or return the terminal `CALENDAR_RESULT_TOO_LARGE` failure; never emit `clear` by concealing the only known conflict. Keep the set hash for the **entire requested canonical set**, even when output coverage rows are omitted. Trimming labels or IDs into a different identity is forbidden. A compact result with omitted rows must say `byte-limit` and incomplete; the surrounding MCP layer may still reject excess source-envelope overhead rather than raising any bound. Do not retain raw event fields or raw responses to make a fingerprint. Use the P1 fingerprint as-is; P6 must not reinterpret a truncated projection as proof that no undisclosed conflict changed.

Add exact 50/51 and 100 input batch-boundary tests, max-two batches with lower size/remaining batch cap, no third delivery after ingestion exhaustion, exact 2,000/2,001 **across two batches**, aggregate working bytes across two responses, lower snapshot/result bytes, UTF-8 calendar labels, and an envelope too small even for metadata. Assertions: nonzero discovered tests; bounded call count; `calendarAvailabilityResultSchema.safeParse(result).success === true` for every returned result; no incomplete result has free intervals or conflict clear. An impossible tiny output cap is a typed failure, not silently enlarged.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-availability-api.spec.ts test/plugins/google-calendar/calendar-api-http.spec.ts`.
- [ ] **Commit** the five explicit changed P3 paths named above: `fix(calendar): bound freebusy ingestion output and preflight deliveries`.

## Task 8: Prove admission, timeout, cancellation and caller-owned retry boundaries

**Files:** Modify only the three P3 source files and their named specs if a demonstrated defect requires it. The smallest expected transport correction is recalculating the timeout **after** asynchronous admission; discovery/availability remain single-delivery adapters.

- [ ] **Write this failing deterministic shared-helper timing regression** in `calendar-api-http.spec.ts`; add `vi` to that file's Vitest import. Spy on `AbortSignal.timeout` rather than depending on whether runtime-native timers are intercepted by fake timers; do not use real sleeps:

```ts
it('calculates transport timeout from the deadline remaining after admission', async () => {
  const durations: number[] = [];
  let at = Date.parse('2026-10-22T10:00:00.000Z');
  const end = at + 100;
  const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    durations.push(ms); return new AbortController().signal;
  });
  try {
    await calendarHttp(context({ now: () => at, deadlineAt: new Date(end).toISOString(),
      consumeRequest: async () => { at += 80; }, fetcher: async () => json({ ok: true }) }));
    expect(durations).toEqual([20]);
  } finally { spy.mockRestore(); }
});
```

Write this new provider retry-boundary test in discovery spec. It deliberately models only the already-owning caller's allowance; it is not a new production retry utility:

```ts
it('surfaces eligible delivery failures and counts caller-authorized retries without resetting budgets', async () => {
  for (const [status, reason] of [[429, 'rateLimitExceeded'], [503, 'backendError'],
    [403, 'rateLimitExceeded'], [403, 'userRateLimitExceeded']] as const) {
    const fake = fakeFetch([0, 1, 2].map(() => ({ method: 'GET', path: '/calendar/v3/users/me/calendarList',
      response: () => googleJson({ error: { errors: [{ reason }] } }, { status }) })));
    const api = new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock });
    let requests = 0;
    const input = discoveryInput({ mode: 'out-of-turn', consumeRequest: async () => { requests++; } });
    let remaining = 2;
    for (;;) {
      const fault = await api.discover(input).catch((error: unknown) => error);
      expect(fault).toHaveProperty('failure.retry', 'delivery-same-id');
      if (remaining-- === 0) break;
    }
    expect(fake.requests).toHaveLength(3);
    expect(requests).toBe(3);
  }
});
```

- [ ] **Prove red**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-api-http.spec.ts -t "calculates transport timeout"`. Expect `[100]` versus `[20]`. Run the discovery retry fixture separately and record it as regression evidence if already green: `npm test -- test/plugins/google-calendar/calendar-discovery-api.spec.ts -t "caller-authorized retries"`.
- [ ] **Minimal implementation:** in `calendarHttp` keep the original pre-admission checks, then change only timeout construction:

```ts
const afterAdmission = deadlineAt - clock();
if (afterAdmission <= 0) failure('delivery', 'CALENDAR_TEMPORARILY_UNAVAILABLE', 'delivery-same-id');
const timeout = AbortSignal.timeout(afterAdmission);
```

Both adapters capture their ≤20-second effective deadline **once** at operation entry and use it for all pages/batches; never extend it per request/retry. Recheck caller cancellation/deadline before every delivery and after receiving a batch; cancelled work cannot publish an authoritative result. The trusted admission callback may itself validate current account/connection before and after durable accounting; do not replace it with a local counter. Failed admission propagates `CALENDAR_REQUEST_NOT_ADMITTED` and sends no fetch. No callback means no authorized request; there is no fallback admission implementation.

Add deterministic matrix checks to the existing P3 specs before green:

```ts
// Discovery spec; same expectation applies to availability's first delivery.
it('keeps terminal provider errors terminal and sends no request after abort or denied admission', async () => {
  for (const [status, reason, code] of [[400, 'badRequest', 'CALENDAR_INPUT_REJECTED'],
    [401, 'authError', 'RECONNECT_REQUIRED'], [403, 'insufficientPermissions', 'CALENDAR_FORBIDDEN'],
    [403, 'quotaExceeded', 'CALENDAR_QUOTA_EXCEEDED'], [404, 'notFound', 'EVENT_NOT_FOUND']] as const) {
    const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
      response: () => googleJson({ error: { errors: [{ reason }] } }, { status }) }]);
    const fault = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock })
      .discover(discoveryInput()).catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure.code', code);
    expect(fault).toHaveProperty('failure.retry', 'none');
    expect(fake.requests).toHaveLength(1);
  }
  const fake = fakeFetch([]);
  const api = new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock });
  const abort = new AbortController(); abort.abort();
  await expect(api.discover(discoveryInput({ signal: abort.signal }))).rejects.toThrow('CALENDAR_CANCELLED');
  await expect(api.discover(discoveryInput({ consumeRequest: async () => { throw new Error('private-store-detail'); } })))
    .rejects.toThrow('CALENDAR_REQUEST_NOT_ADMITTED');
  expect(fake.requests).toHaveLength(0);
});
```

Add both adapters' mid-page/mid-batch cancellation, abort during body streaming, stalled body deadline, already-expired deadline, Retry-After zero/date/too-long/deadline cases, admission rejection on batch two, malformed UTF-8/JSON/content-type, wrong response bounds and provider no-store expiry tests. Reuse existing HTTP tests for raw streaming behavior and add only missing adapter-level propagation assertions. Exact important assertions: no post-abort delivery; no result with complete/clear after incomplete work; admission calls equal actual admitted deliveries; errors contain only allowlisted safe codes; P3 never invokes OAuth/connection mutation. A 401-refresh-401 fixture belongs to P4's credential wrapper: P3 proves each raw 401 is terminal and never refreshes by itself, and reports the P4 integration gate rather than implementing OAuth here.

For fresh-operation checks, invoke discovery twice on the same adapter with a changed provider role/scopes/policy on the second call; assert the second result is freshly read or safely denied, never the previous writable metadata. Map its callback to `capability-recheck` in a fixture and assert both actual requests are charged that category. Do not pretend this fixture implements the P4/P5 event-dispatch authorization gate. The availability preflight callback must similarly be exactly `['preflight', 'preflight']` for two batches, not an extra logical model tool or create call.

- [ ] **Prove green**, cwd `backend`: `npm test -- test/plugins/google-calendar/calendar-api-http.spec.ts test/plugins/google-calendar/calendar-discovery-api.spec.ts test/plugins/google-calendar/calendar-availability-api.spec.ts test/plugins/google-calendar/calendar-api.spec.ts test/plugins/google-calendar/calendar-api-cursor.spec.ts`.
- [ ] **Commit** only the actually changed named P3 paths: `test(calendar): verify provider admission deadlines and bounded retry handoff`.

## Final sequential verification and exit gate

These are **future worker commands**, not application checks executed by this documentation planner. Record `git rev-parse HEAD`, task commit hashes, `git status --short`, `node --version`, `npm --version`, red/green outputs and actual test counts. No installs, live API/OAuth/model calls, application data, or database prerequisites are needed for P3 focused checks. Do not inspect or print credentials.

Run individually, **sequentially**, with cwd `backend`:

1. `npm test -- test/plugins/google-calendar/calendar-api-http.spec.ts`
2. `npm test -- test/plugins/google-calendar/calendar-discovery-api.spec.ts`
3. `npm test -- test/plugins/google-calendar/calendar-availability-api.spec.ts`
4. `npm test -- test/plugins/google-calendar/calendar-api.spec.ts test/plugins/google-calendar/calendar-api-cursor.spec.ts`
5. `npm test -- test/contracts/calendar-multi-policy.spec.ts test/contracts/calendar-multi-discovery.spec.ts test/contracts/calendar-multi-availability.spec.ts`
6. `npm run build`
7. `npm run lint`
8. `npm test`
9. `npm run test:e2e`

Then at repository root run `git diff --check`, inspect `git status --short`, and report the exact commit set. Do not race build against bootstrap/e2e tests. Empty discovery is not a pass. Native e2e prerequisites may be absent: report skipped fixtures separately; any operator-supplied native URI must target generated isolated data with exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, never application data or printed credentials. P3 does not run native checks merely to prove REST fixtures.

### Known downstream baseline, not P3 ownership

The orchestrator's post-P1/A1 baseline is **13 failing test files / 34 failing tests, 1,563 passed, 10 skipped**: P4 OAuth/connection fixtures have old verified-scope assumptions; P5 tests retain old v1/three-tool catalogue assertions; P8 assembled capability/HTTP fixtures inherit those migrations. Record current actual outputs and compare failures; do not assume those counts remain current. Preserve stricter P1 contracts and all unrelated tests. A new P3 HTTP/event regression blocks P3 and must be corrected here; known P4/P5/P8 migration failures are reported by file/test/owner and remain downstream gates, not claimed passes. Do not edit foreign files to manufacture a green full suite.

### Acceptance mapping

| Required evidence | Tasks | Boundary that remains downstream/live |
| --- | --- | --- |
| AC02 pagination, duplicate/unknown roles, primary absence/overflow, count/bytes/freshness | 2–3, 8 | P2/P4 persisted refresh CAS/coalescing and UI pages |
| AC03 exact scopes, distinct shared/read/freeBusyReader capabilities, current evidence | 2–5, 8 | P4 credential/grant lifecycle and P5 event dispatch; live shared ACL drill |
| AC06 opaque all-day/recurring/tentative/focus/private semantics, DST, errors, batching, no false free | 4–7 | Live Google busy semantics are not proved by provider-shaped fixtures |
| AC07 fresh bounded availability primitive and material projection fingerprint | 4–8 | P6 mandatory create preflight/durable acceptance/recheck; not an atomic reservation |
| AC10 every discovery/availability/preflight/recheck delivery counted, finite bounds | 1–8 | P5/P6 persisted remaining retry/deadline/accounting ownership |
| AC13 minimized metadata, strict cache evidence, cancellation/errors/deadlines | 1, 3, 5, 7–8 | P2 retention sweeps; P8 processing policy/operations; no service certification |

- [ ] New adapters compile against **unchanged** P1 interfaces and final results validate with P1 schemas.
- [ ] Nonzero deterministic discovery/availability/HTTP tests pass, including all explicit matrices above; existing event/cursor tests remain green.
- [ ] Discovery never claims completeness with an outstanding provider token, unsupported entry, primary ambiguity/absence, failed page, or omitted data. Retained encountered primary survives bounds whenever a truthful envelope can fit.
- [ ] Availability makes ≤2 requests with ≤50 concrete calendars each; all raw ingestion/count/result/working/deadline limits hold. Empty busy is not clear when discovery/coverage failed. Per-calendar HTTP-200 errors/404s never disconnect anything.
- [ ] Every actual delivery uses the supplied admission callback; no adapter-local retry allowance, token refresh, default routing, second runtime, background sync, event write, or raw event-detail fetch exists.
- [ ] Package outputs, known consumer gates, native skips, and live service prerequisites are reported honestly; review remains **skipped**.

### Serialized commits and downstream handoff

For every task, obtain the shared-index slot from the orchestrator, run `git diff --check`, stage only its named changed owned paths, inspect `git diff --cached --name-only`, and commit using the task's exact message. If another agent has staged files, stop and leave them alone. Never use `git add .`, reset, amend, or overwrite concurrent work. The planner commits **only this document** as `docs(google-calendar-multi-calendar): plan P3 - provider discovery and availability primitives`.

Publish to P4/P5/P6: exact constructors, `CalendarDiscoveryApi.discover`/`CalendarAvailabilityApi.check` implementing the interfaces above; provider error/partial/volatile behavior; callback category/count rules; no hidden refresh/retries; UTC opaque-only interval semantics; final byte/envelope distinction; fresh capability-check responsibility; unchanged P1 fingerprint; and any requested P1 port amendment. Include all implementation commits and actual command results. P3 completion is not whole-phase acceptance or permission for live testing/deployment.
