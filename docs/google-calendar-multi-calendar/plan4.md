# P4 — OAuth re-consent, discovery lifecycle, capabilities and settings API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use executing-plans and test-driven-development to implement this plan task-by-task. Remain the assigned P4 worker; do not dispatch another worker or a reviewer. Track each action using the checkboxes below.

**Goal:** Connect without a calendar-ID pin, upgrade consent safely, maintain bounded discovery, authorize each Calendar operation separately, and expose versioned calendar/default APIs without weakening account or mutation fencing.

**Architecture:** Extend the existing connection/OAuth services, using P2's explicit v2 connection facade and P3's `CalendarDiscoveryPort`; put cache refresh and cached-page projection in one `discovery.ts` service. Keep account authority, token AAD, discovery revisions, and preference revisions independent. The capability gate freshly checks the pinned canonical calendar, while settings affect only future unresolved targeting.

**Tech Stack:** TypeScript/ESM NodeNext (`.js` local imports), native fetch/AbortSignal/crypto, existing NestJS/Express, Zod and Vitest fixtures; Node `^22.22.3 || ^24.15.0 || >=26.0.0`. No dependency changes, live OAuth/Google/model requests, provisioning, or application-data migration.

---

## Execution boundary and prerequisites

Read `goal.md`, P4/readiness/ownership/evidence in `state.md`, `research.md`, `plan1.md`–`plan3.md`, root `AGENTS.md`, and actual source before execution. P1/A1, P2 and P3 workers are committed prerequisites; baseline inspected for this plan is `814e30f`, including P3 `656fa76` and P2 through `098d6f2`. Preparation-era approval-stop prose does not reopen the recorded dated approval/resume gates. Review remains **skipped**, not passed.

The planner writes **only this Markdown file**. The worker owns:

| Owned path under `backend/` | Responsibility |
| --- | --- |
| `src/plugins/google-calendar/options.ts` | No-target OAuth options; safe v1 compatibility projection and new v2 public status |
| `src/plugins/google-calendar/oauth-client.ts`, `oauth.ts` | Exact grants, incremental consent, partial-grant diagnostic, same-subject callback, existing browser/state/PKCE flow |
| `src/plugins/google-calendar/connection.ts` | v2 install/settings/credentials/disconnect; account and capability gates; lifecycle fencing |
| New `src/plugins/google-calendar/discovery.ts` | Bounded refresh/coalescing/CAS, cache-only pages and signed calendar-page cursors |
| `src/plugins/google-calendar/controller.ts` | Strict v2 query/settings/refresh routes and safe errors |
| `src/plugins/google-calendar/module.ts` | Reuse the same injected connection/OAuth instances; no new owner |
| `test/plugins/google-calendar/connection-fixtures.ts`, `connection.spec.ts`, `connection-refresh.spec.ts` | Migrate active lifecycle fixtures to v2 while retaining explicit v1 history fixtures |
| New `test/plugins/google-calendar/connection-multi-fixtures.ts`, `connection-multi.spec.ts`, `connection-capabilities.spec.ts`, `connection-settings.spec.ts` | Real P2 memory-store facade, lifecycle, capability and preference regressions |
| Existing `test/plugins/google-calendar/oauth-fixtures.ts`, `oauth.spec.ts`, `oauth-http.spec.ts`, `oauth-identity.spec.ts`, `setup.spec.ts` | Preserve OAuth/security assertions and correct stale scope/status expectations |
| New `test/plugins/google-calendar/discovery.spec.ts`, `discovery-pages.spec.ts`, `setup-multi.spec.ts`, `options.spec.ts` | Refresh races, paging, direct route contracts and no-ID options |

`oauth-http.ts` and `oauth-identity.ts` are owned but require no planned behavior change: their bounded readers, endpoint pins, RS256/issuer/audience/nonce validation remain regression checks. Add a change only for a demonstrated P4 defect, with a failing test first.

Do **not** edit contracts/manifests (P1), persistence (P2), `calendar-discovery-api*` / `calendar-availability-api*` / `calendar-api-http.ts` (P3), event REST/cursor/tools/MCP/model catalogue or their tests (P5), runtime/context/agent (P6), frontend (P7), central config/bootstrap/operations/HTTP tests (P8), or integrated acceptance files (P9). Although `controller*.ts` is a broad P4 reservation, **leave `controller-http.ts` unchanged**: its local Host/Origin/CSRF/query admission is the explicitly retained P8 HTTP-boundary handoff. No other plan, goal/state/research, `.env`, or `.openchamber/` edits.

Every new code/test file starts with the repository `FILE / LOCATION / PURPOSE / ROLE IN PROJECT / KEY COMPONENTS` header; add it to an existing file if modifying >30%. Snippets below omit repeated headers; prepend the filename-specific valid TypeScript banner before writing. Preserve Vitest discovery and fixtures. Every task is test → observed red → minimum code → green → named-file conventional commit. A pre-existing failure is useful red evidence only when the assertion tests the intended behavior, not when fixture parsing prevents the scenario.

### Source reconciliation and explicit downstream gates

1. **P2 normal CAS cannot migrate v1.** `MongoCalendarConnections.v2.get` reads both versions, but `create` conflicts with an existing v1 row and v2 CAS refuses it. The explicit `migrateLegacy({ userId, expectedRevision, expectedConnectionRevision, legacy, now, admissionStopped, executorDrained })` requires stopped admission and a drained executor. P4 must project legacy status as reconnect-required / internal reason `scope-upgrade-required`, never refresh it into v2 or mutate it on GET/startup. A legacy OAuth start fails safely until that explicit maintenance step has been authorized/performed through P8. Test re-consent using an **explicitly migrated fixture**, not a fake automatic conversion. This is a real maintenance precondition, not seamless live migration.
2. **P2 invalidates on authority changes, and forbids complete → partial replacement.** Changes of enabled/status/scopes/account require `connectionRevision + 1` and `discovery:null`; credential-only and default-only writes must not bump that revision. A full re-consent from connected first enters reconnect-required, then installs the new grant. This supplies a real authority transition instead of inventing an otherwise forbidden revision-only bump. Keep a complete snapshot on partial/failed refresh without extending its times; use the fresh partial result only transiently and report the limitation to the caller.
3. **No stored/public `reason` field exists.** Use the existing `calendarGrantStatus` and `calendarStatusV2ResponseSchema.missingScopes`; `scope-upgrade-required` is a bounded internal lifecycle diagnostic, not an invented wire/storage field. A partial callback error carries only required-scope identifiers. The persisted reconnect-required state survives restart; the finer partial-callback diagnostic may be process-local and is cleared on a newer flow/disconnect/replacement. Never store an unverified callback subject or partial token as a connected record.
4. **Research's claimed pre-existing subject-change guard is absent.** Actual `installGrant` replaces any subject and generates a new connection ID. Add an explicit expected-subject guard for re-consent. Account switching is permitted only after local disconnect; its callback has no old expected subject and must reset the override. Do not describe an absent check as preserved evidence.
5. **An arbitrary credential callback is not replay-safe.** `CalendarAccountCredentialPort.withAccessToken` has no operation/retry hint. It must not replay `action` automatically, because P5 uses it for a create as well as reads. P4's discovery service can perform one specifically read-only 401 refresh/replay using a concrete trusted lifecycle method, retaining the same counted delivery scope. Publish that method to P5/P8; any broader shared refresh/retry port amendment belongs to P1. A second 401 marks reconnect-required. Generic event callback replay is not authorized here.
6. **P8 assembly is still legacy.** Preserve compile-compatible legacy constructor fields/method signatures while adding optional `storeV2`, `discovery`, retention and account-invalidation hooks. Missing new ports fail closed for new setup/dispatch; they never create a fallback store or a second runtime. `status()` can retain its old return type for the current `AppService` caller; the controller uses new `statusV2()`. Legacy execution methods must reject v1/new admissions rather than launder a v2 target into v1 authority. P8 must adopt the v2 facade/gate/status and the single existing owner.
7. **P8's actual boundary rejects every non-callback query and every non-status GET.** P4 can prove the new controller and its standalone Nest route contracts, but deployed `GET calendars?pageToken=...` cannot pass until P8 updates that boundary. Keep existing real-boundary security checks in `setup.spec.ts`; do not remove middleware or weaken origin/CSRF checks to pretend assembled acceptance passed. P4's route evidence and P8's assembled/security gate are distinct.
8. The approved exact-scope rule intentionally rejects an `email` alias-only response; current `oauth-client.ts` rewrites `userinfo.email` into `email`. Remove that substitution for new consent and retain literal scope evidence. Google's real returned scope spellings/granular consent remain an explicitly unrun live gate, not a reason to silently relax the approved rule. Research's deleted-default fallback recommendation is superseded by the goal: retain an unavailable saved ID and ask/reset, never silently select primary.

No other P4 goal/port mismatch is known. These are explicit compatibility/ownership gates, not permission to expand P4 files or call failing integrated checks passed.

## Exact committed contracts consumed

Use the existing identifiers; do not copy their schemas or create alternative shared ports.

| Source | Exact consumption |
| --- | --- |
| `contracts/calendar-policy.ts` | `CALENDAR_SCOPES`, `CALENDAR_SCOPES_V1`, `CALENDAR_LIMITS`, `CALENDAR_PROOF_REVISION`, `CALENDAR_CURSOR_VERSION`, `calendarGrantSchema`, `calendarGrantStatus`, `CalendarFailure` |
| `contracts/calendar-connections.ts` | `calendarOAuthOptionsV2Schema`, `CalendarOAuthOptionsV2`, `CalendarAccountCredentialPort`; unchanged `CalendarConnectionStore.putState/consumeState`, `GoogleIdentityPort`, `CalendarConnectionRecord`, `calendarCredentialAadSchema` and v1 compatibility types |
| `contracts/calendar-discovery.ts` | `CalendarConnectionStoreV2`, `CalendarConnectionRecordV2`, `calendarConnectionV2Schema`, `calendarConnectionTransitionV2Schema`, `CalendarAccountBinding`, `calendarAccountBindingSchema`, `CalendarResolvedTarget`, `calendarResolvedTargetSchema`, `CalendarDiscoveryPort`, `CalendarProviderContext`, `CalendarDiscoverySnapshot`, `calendarDiscoverySnapshotSchema`, `effectiveCalendarCapabilities`, `primaryCalendarId`, `calendarListCalendarsResultSchema` |
| `contracts/calendar-authority.ts` | `CalendarCapabilityGate.resolve/requireCurrent`; exact resolved/clarify/denied result unions |
| `contracts/calendar-wire.ts` | `calendarSettingsV2RequestSchema`, `calendarStatusV2ResponseSchema`, `calendarCalendarsQuerySchema`, `calendarCalendarsResponseSchema`, `calendarRefreshRequestSchema`; unchanged OAuth/disconnect schemas and `CALENDAR_API_ROUTES` |
| `contracts/calendar-compatibility.ts` | `compatibleCalendarConnectionSchema`, `calendarCursorV2PayloadSchema` (strict payload only; signature verification remains P4 code) |
| P2 `persistence/calendar-connections.ts` / bundle | Existing `MongoCalendarConnections.v2` / `calendarConnectionsV2`, `getCompatible`, explicit maintenance-only `migrateLegacy`; no new adapter instance in production |
| P3 `plugins/google-calendar/calendar-discovery-api.ts` | `CalendarDiscoveryApi({ fetcher?, now? }).discover`, implementing `CalendarDiscoveryPort.discover` unchanged |

The exact discovery call is:

```ts
type DiscoverInput = Parameters<CalendarDiscoveryPort['discover']>[0];
// account, accessToken, signal, grantedScopes, policyAllows, retentionPolicy,
// deadlineAt, now, consumeRequest, mode, discoveryRevision, limits:
// {retainedCalendars, pageDeliveries, snapshotBytes, freshnessMs}
```

P3 has **no continuation input**, token refresh, cache or retry loop. Every call is a bounded new scan, not a resume from its provider `nextPageToken`. Retain ≤100 entries, ≤256 KiB snapshot/connection, freshness ≤5 minutes, ≤2 in-turn / ≤10 out-of-turn page **deliveries including replay**. Lower configured ceilings win. The same callback/deadline/delivery counter survives token refresh and CAS rebase. Do not turn a replay into a new refresh allowance. UI/tool page tokens are signed Aurvin offsets, never Google's continuation.

P3's availability handoff is `CalendarAvailabilityApi({fetcher?,now?}).check` implementing `CalendarAvailabilityPort.check` from `contracts/calendar-availability.ts`, with ≤50 IDs per batch, ≤2 batches and honest coverage. P4 **does not implement or call availability** for connection/settings: P5/P6 consume it. P4 supplies its current account/credential/capability ports and ensures `operation:'availability'` does not require event-write rights. Availability/preflight is not a Connect probe or a default-save side effect.

## Task 1: Accept no-ID options and add compatible, network-free v2 status

**Files:** modify `backend/src/plugins/google-calendar/options.ts`, `connection.ts`, `backend/test/plugins/google-calendar/connection.spec.ts`; create `backend/test/plugins/google-calendar/options.spec.ts`. Preserve existing public `status()` signature for P8's not-yet-migrated caller.

- [ ] **Write these failing assertions** (existing `fixtureSetupOptions` is available):

```ts
import { expect, it } from 'vitest';
import { parseCalendarSetupOptions } from '../../../src/plugins/google-calendar/options.js';
import { calendarStatusV2ResponseSchema } from '../../../src/contracts/calendar-wire.js';
import { connectionFixture, fixtureSetupOptions } from './connection-fixtures.js';

it('accepts no target and treats an old pin as inert compatibility configuration', async () => {
  const old = fixtureSetupOptions({ configured: true, enabled: true });
  const { targetCalendarId: _pin, ...oauth } = old.oauth!;
  const parsed = parseCalendarSetupOptions({ ...old, oauth });
  expect(parsed.oauth).not.toBeNull();
  expect(parsed.oauth?.targetCalendarId).toBeUndefined();
  expect(parseCalendarSetupOptions({ ...old, oauth: { ...oauth, targetCalendarId: 'primary' } })
    .oauth?.targetCalendarId).toBe('primary');
  const f = connectionFixture();
  const status = calendarStatusV2ResponseSchema.parse(await f.service.statusV2());
  expect(status).toMatchObject({ protocolVersion: 2, enabled: false, state: 'disabled',
    connectionRevision: null, defaultSetting: null, primaryCalendarId: null,
    discovery: null, missingScopes: [] });
  expect(JSON.stringify(status)).not.toMatch(/targetCalendarId|credentials|clientSecret|googleSubjectId/);
  expect(f.network).not.toHaveBeenCalled();
});
```

- [ ] **Run red:** cwd `backend`, `npm test -- test/plugins/google-calendar/options.spec.ts -t "accepts no target"`. Expected: old options parser rejects missing/primary target or `statusV2` is missing.
- [ ] **Minimum implementation.** Change the options schema import/type to `calendarOAuthOptionsV2Schema` / `CalendarOAuthOptionsV2`. Keep client secret, control-character/dot-segment, loopback callback and exact-origin validation. Rename `assertOwnedTarget` to `assertLegacyTarget`, remove its primary rejection, invoke it only for a supplied ID. Its presence does not make otherwise empty credentials configured. Add the new optional lifecycle dependencies without removing legacy fields:

```ts
// Add to ConnectionDependencies; imports are type-only from the named P1 modules.
storeV2?: CalendarConnectionStoreV2;
discovery?: CalendarDiscoveryPort;
retentionPolicy?: () => { policyId: string; expiresAt: string } | null;
onAccountInvalidated?: (account: CalendarAccountBinding,
  reason: 'disconnect' | 'replacement' | 'disabled' | 'reconnect-required') => Promise<void>;
```

The actual parse change is:

```ts
const parsed = calendarOAuthOptionsV2Schema.safeParse({
  clientId: raw.clientId, redirectUri: raw.redirectUri,
  ...(raw.targetCalendarId === undefined ? {} : { targetCalendarId: raw.targetCalendarId }),
});
if (!parsed.success) configError();
if (parsed.data.targetCalendarId !== undefined) assertLegacyTarget(parsed.data.targetCalendarId);
```

`statusV2` reads `storeV2.get(userId)` when supplied, otherwise the legacy getter. Never call migration, refresh, discovery, Google, or a paid probe here. Build `publicStatusV2` in `options.ts` from that compatible record and clock. Compute missing scopes using `calendarGrantStatus` only after `calendarGrantSchema.safeParse`: a legacy grant allowed by the historical decoder may contain scopes forbidden for new consent. That is a reconnect/maintenance condition, not a reason to crash status/startup or rewrite history. Disabled remains the highest-priority public state. Populate v2 default/discovery only from actual v2 fields; v1 has no invented primary/discovery/default revision. Treat missing/expired approved processing policy as unconfigured/degraded, not permission.

```ts
const discovery = record?.schemaVersion === 2 ? record.discovery : null;
const visible = discovery && now < Date.parse(discovery.retentionExpiresAt) ? discovery : null;
const validGrant = record ? calendarGrantSchema.safeParse(record.grantedScopes).success : false;
const missingScopes = record && record.status !== 'disconnected'
  ? validGrant ? calendarGrantStatus(record.grantedScopes).missingScopes
    : CALENDAR_SCOPES.filter(s => !record.grantedScopes.includes(s)) : [];
const primary = visible ? primaryCalendarId(visible) : null;
const defaultSetting = record?.schemaVersion === 2 ? record.defaultSetting : null;
return calendarStatusV2ResponseSchema.parse({
  protocolVersion: 2, state, enabled, accountEmail: record?.accountEmail ?? null,
  processingDisclosure, connectionRevision: record?.connectionRevision ?? null,
  defaultSetting, primaryCalendarId: primary,
  discovery: visible ? { discoveryRevision: visible.discoveryRevision,
    fetchedAt: visible.fetchedAt, expiresAt: visible.expiresAt, complete: visible.complete,
    truncated: visible.truncated, stale: now >= Date.parse(visible.expiresAt) } : null,
  missingScopes,
});
```

Retain the existing processing disclosure literal and derive `state` with the existing precedence plus `schemaVersion===1 || !validGrant || missingScopes.length>0` → reconnect-required for an existing non-disconnected record. `status()` projects the same safe information into its historical schema, with `targetCalendarId` derived only from the stored legacy pin or the persisted v2 override/known canonical primary, **never from options**. This old projection is not execution authority and is not the new HTTP payload. No new shared status type: use `z.infer<typeof calendarStatusV2ResponseSchema>` locally.
- [ ] **Run green:** `npm test -- test/plugins/google-calendar/options.spec.ts`. Run `npm test -- test/plugins/google-calendar/connection.spec.ts -t "empty options|missing encryption"` separately; migrate the obsolete target-status assertions, retaining secret/configuration checks. Remove only the old omitted/primary **rejection cases** from its table and replace them with Task 1's positive tests; keep hostile origin/control/dot cases.
- [ ] **Commit:** `feat(calendar): accept no-target setup and expose versioned reconnect status` (only the named changed owned paths).

## Task 2: Require literal returned scopes and incremental consent without token leakage

**Files:** modify `backend/src/plugins/google-calendar/oauth-client.ts`; modify `backend/test/plugins/google-calendar/oauth-http.spec.ts`, `oauth-fixtures.ts`.

- [ ] **Write these failing tests.** Change the existing `VALID_GRANT.scope` to `CALENDAR_SCOPES.join(' ')`; retain the old owned-only grant as a separate negative fixture, not a new connected fixture.

```ts
it('requests incremental consent and rejects every incomplete literal grant', async () => {
  const url = new URL(authorizationUrl(oauthHttpFixture([]).options, {
    state: 's'.repeat(43), nonce: 'n'.repeat(43), challenge: 'c'.repeat(43),
  }));
  expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  expect(url.searchParams.get('prompt')).toBe('consent');
  expect(url.searchParams.get('scope')?.split(' ')).toEqual([...CALENDAR_SCOPES]);
  for (const missing of CALENDAR_SCOPES) {
    const f = oauthHttpFixture([{ body: { ...VALID_GRANT,
      scope: CALENDAR_SCOPES.filter(s => s !== missing).join(' ') } }]);
    const failure = await f.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
      signal: new AbortController().signal, deadlineAt: f.deadlineAt }).catch(e => e);
    expect(failure).toMatchObject({ failure: { code: 'OAUTH_SCOPE_REJECTED', retry: 'none' },
      missingScopes: [missing] });
    expectSafe(failure);
    expect(f.requests).toHaveLength(1);
  }
});

it('does not manufacture email consent from a returned alias', async () => {
  const f = oauthHttpFixture([{ body: { ...VALID_GRANT,
    scope: CALENDAR_SCOPES.map(s => s === 'email'
      ? 'https://www.googleapis.com/auth/userinfo.email' : s).join(' ') } }]);
  await expect(f.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: f.deadlineAt }))
    .rejects.toMatchObject({ missingScopes: ['email'] });
});
```

- [ ] **Run red:** `npm test -- test/plugins/google-calendar/oauth-http.spec.ts -t "incremental consent|manufacture email"`. Expect `include_granted_scopes=false`, missing diagnostic, or alias accepted.
- [ ] **Minimum implementation.** Set `include_granted_scopes:'true'` and retain `prompt:'consent'`, offline, state, nonce, exact redirect and S256. Remove `EMAIL_ALIAS` and its substitution. Split literal scopes, deduplicate without inventing entries, validate `calendarGrantSchema`, and require the entire exact set for exchange and any explicit refresh scope response. Export this local diagnostic error from `oauth-client.ts`:

```ts
export class OAuthScopeRejected extends CalendarToolFault {
  readonly missingScopes: readonly string[];
  constructor(scopes: readonly string[]) {
    super(calendarFailureSchema.parse({ category: 'credential', code: 'OAUTH_SCOPE_REJECTED', retry: 'none' }));
    this.missingScopes = Object.freeze(CALENDAR_SCOPES.filter(s => !scopes.includes(s)));
  }
}

function requireScopes(scopes: string[]): string[] {
  if (calendarGrantStatus(scopes).state !== 'complete') throw new OAuthScopeRejected(scopes);
  return scopes;
}
```

Do not attach response bodies, tokens, code, verifier or untrusted scope text to that error; `missingScopes` is selected from the frozen five strings. Missing/non-string scope remains rejected, and a malformed/forbidden scope array is a safe `OAUTH_SCOPE_REJECTED` failure. Refresh with omitted `scope` returns `null`; the connection may retain only the previously verified full grant. No refresh request includes `scope`, and no token exchange/refresh is automatically retried.

Update the existing URL test's false expectation to true; retain pin/PKCE checks. Existing negative expiry/missing-refresh/body limits/UTF-8/duplicate JSON/error-redaction tests stay meaningful with the corrected full `VALID_GRANT`.
- [ ] **Run green:** `npm test -- test/plugins/google-calendar/oauth-http.spec.ts test/plugins/google-calendar/oauth-identity.spec.ts`.
- [ ] **Commit:** `feat(calendar): enforce incremental consent and exact scope diagnostics`.

## Task 3: Install v2 grants with same-subject re-consent and explicit legacy maintenance

**Files:** modify `backend/src/plugins/google-calendar/connection.ts`, `oauth.ts`; create `backend/test/plugins/google-calendar/connection-multi-fixtures.ts`, `connection-multi.spec.ts`; migrate `connection-fixtures.ts`, `oauth-fixtures.ts`, `connection.spec.ts`, `oauth.spec.ts` only where their active fixtures/obsolete owned-proof assertions change.

- [ ] **Create this fixture's concrete setup** in `connection-multi-fixtures.ts`. Use actual P2 memory/storage code read-only, not a permissive hand-written CAS fake:

```ts
import { vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../../src/contracts/budgets.js';
import { CALENDAR_SCOPES } from '../../../src/contracts/calendar-policy.js';
import { calendarConnectionV2Schema, calendarDiscoverySnapshotSchema,
  type CalendarConnectionRecordV2, type CalendarDiscoveryPort } from '../../../src/contracts/calendar-discovery.js';
import { MongoCalendarConnections } from '../../../src/persistence/calendar-connections.js';
import { CalendarSecretCipher } from '../../../src/platform/crypto/calendar-secret-cipher.js';
import { GoogleCalendarConnections, tokenAad } from '../../../src/plugins/google-calendar/connection.js';
import { calendarMemory } from '../../persistence/calendar-multi-memory.js';
import { connectionV2 } from '../../persistence/calendar-multi-fixtures.js';
import { connectionFixture, fixtureSetupOptions } from './connection-fixtures.js';

export async function multiConnectionFixture(input: {
  empty?: boolean; enabled?: boolean; scopes?: readonly string[];
  defaultCalendarId?: string | null; expiredToken?: boolean;
} = {}) {
  let now = Date.parse('2026-10-22T10:00:00.000Z');
  const memory = calendarMemory();
  const adapter = new MongoCalendarConnections(memory.store, DEFAULT_BUDGETS);
  const base = connectionFixture({ configured: true, enabled: true });
  const cipher = new CalendarSecretCipher({ status: 'ready', key: Buffer.alloc(32, 7) });
  const { targetCalendarId: _pin, ...oauth } = fixtureSetupOptions({ configured: true }).oauth!;
  const options = { ...base.options, oauth, evidence: 'google' as const };
  const initial = connectionV2();
  const entries = [
    { ...initial.discovery!.entries[0]!, calendarId: 'canonical-primary', label: 'Primary', primary: true },
    { ...initial.discovery!.entries[0]!, calendarId: 'shared-team', label: 'Team', primary: false },
  ];
  const scopes = [...(input.scopes ?? CALENDAR_SCOPES)];
  const record = calendarConnectionV2Schema.parse({ ...initial, userId: 'u1',
    googleSubjectId: 'fixture-sub', enabled: input.enabled ?? true,
    status: CALENDAR_SCOPES.every(s => scopes.includes(s)) ? 'connected' : 'reconnect-required',
    grantedScopes: scopes, defaultSetting: { defaultCalendarId: input.defaultCalendarId ?? null,
      defaultSettingRevision: 1 },
    credentials: {
      access: cipher.sealToken(tokenAad({ ...initial, userId: 'u1', googleSubjectId: 'fixture-sub' }, 'access'), 'fixture-access'),
      refresh: cipher.sealToken(tokenAad({ ...initial, userId: 'u1', googleSubjectId: 'fixture-sub' }, 'refresh'), 'fixture-refresh'),
    }, tokenExpiresAt: new Date(now + (input.expiredToken ? -1 : 3600000)).toISOString(),
    discovery: CALENDAR_SCOPES.every(s => scopes.includes(s))
      ? { ...initial.discovery!, entries } : null,
  });
  if (!input.empty) await adapter.v2.create(record);
  const discover = vi.fn<CalendarDiscoveryPort['discover']>(async request => {
    await request.consumeRequest('discovery');
    return calendarDiscoverySnapshotSchema.parse({ ...initial.discovery!,
      connectionId: request.account.connectionId, connectionRevision: request.account.connectionRevision,
      discoveryRevision: request.discoveryRevision, entries,
      fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString(),
      retentionExpiresAt: new Date(now + 300000).toISOString() });
  });
  const invalidated = vi.fn(async () => undefined);
  const dependencies = { store: base.store, storeV2: adapter.v2, cipher, options,
    identity: base.identity, client: base.client, discovery: { discover }, now: () => now,
    retentionPolicy: () => ({ policyId: 'fixture-policy', expiresAt: new Date(now + 300000).toISOString() }),
    onInvalidated: async () => undefined,
    onAccountInvalidated: invalidated };
  const service = new GoogleCalendarConnections(dependencies);
  const read = async () => {
    const value = await adapter.v2.get('u1');
    return value?.schemaVersion === 2 ? value : null;
  };
  const patch = async (changes: Partial<CalendarConnectionRecordV2>) => {
    const current = (await read())!;
    const next = calendarConnectionV2Schema.parse({ ...current, revision: current.revision + 1, ...changes });
    return adapter.v2.compareAndSwap({ userId: 'u1', expectedRevision: current.revision,
      expectedConnectionRevision: current.connectionRevision,
      expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision, next });
  };
  const request = async (operation: 'read' | 'create' | 'availability' = 'read', selector: string | null = null) => ({
    account: await service.currentAccount(), operation, selector,
    signal: new AbortController().signal, deadlineAt: new Date(now + 20000).toISOString(),
    consumeRequest: vi.fn(async () => undefined), consumeRefreshRequest: vi.fn(async () => undefined),
  });
  return { service, adapter, memory, cipher, options, client: base.client, discover,
    invalidated, entries, read, patch, request, now: () => now,
    advance: (ms: number) => { now += ms; },
    restart: () => new GoogleCalendarConnections(dependencies) };
}
```

Retain legacy-invalidation assertions in the existing fixture. Use the P2 snapshot's actual retention policy ID consistently; a fixture's supplied provider policy may be stricter, never absent. Seed incomplete grants with `discovery:null`; on a later enable/disable mutation P2 also requires clearing discovery. The fixture's `request` closure is used from Task 6 onward; introduce its `currentAccount` method in this task as specified below. Keep the existing base fixture independently constructible; do not make `connectionFixture` call `multiConnectionFixture`, which would recurse through this helper.

- [ ] **Write the failing installation tests:**

```ts
import { expect, it, vi } from 'vitest';
import { CALENDAR_SCOPES } from '../../../src/contracts/calendar-policy.js';
import { deferred } from './oauth-fixtures.js';
import { multiConnectionFixture } from './connection-multi-fixtures.js';

it('connects without a pin and leaves primary selection automatic', async () => {
  const f = await multiConnectionFixture({ empty: true });
  const snapshot = await f.service.captureSetupSnapshot();
  expect(snapshot).not.toHaveProperty('targetCalendarId');
  await f.service.installGrant({ snapshot, grant: { accessToken: 'new-access', refreshToken: 'new-refresh',
    idToken: 'fixture-id-token', scopes: [...CALENDAR_SCOPES],
    expiresAt: new Date(f.now() + 3600000).toISOString() },
    account: { subject: 'fixture-sub', email: 'renamed@example.invalid' },
    signal: new AbortController().signal, deadlineAt: new Date(f.now() + 20000).toISOString(),
    isCurrentFlow: () => true });
  expect(await f.read()).toMatchObject({ schemaVersion: 2, status: 'connected',
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 1 } });
  expect((await f.read())!.discovery).toBeNull();
  expect(f.discover).not.toHaveBeenCalled();
});

it('refuses a subject switch during re-consent without overwriting tokens or preferences', async () => {
  const f = await multiConnectionFixture({ defaultCalendarId: 'shared-team' });
  const snapshot = await f.service.captureSetupSnapshot();
  const before = await f.read();
  await expect(f.service.installGrant({ snapshot, grant: { accessToken: 'wrong-access',
    refreshToken: 'wrong-refresh', idToken: 'fixture-id-token', scopes: [...CALENDAR_SCOPES],
    expiresAt: new Date(f.now() + 3600000).toISOString() },
    account: { subject: 'another-subject', email: null }, signal: new AbortController().signal,
    deadlineAt: new Date(f.now() + 20000).toISOString(), isCurrentFlow: () => true }))
    .rejects.toMatchObject({ failure: { code: 'OAUTH_SUBJECT_CHANGED' } });
  expect(await f.read()).toEqual(before);
  expect(f.discover).not.toHaveBeenCalled();
});
```

- [ ] **Run red:** `npm test -- test/plugins/google-calendar/connection-multi.spec.ts -t "without a pin|subject switch"`. Missing v2 lifecycle/account methods or old owned-target activation is expected. Fix missing fixture exports before claiming behavior-red; no tests may fail solely from an invalid connected v1 fixture.
- [ ] **Minimum implementation.** `SetupSnapshot` becomes `{ userId, recordRevision, lifecycleEpoch, redirectUri, expectedGoogleSubjectId:string|null, connectionId:string|null }`, with no target. Capture from compatible storage; expected subject is null only for absent/disconnected records. Check snapshot epoch/user/redirect plus exact record identity/revision at commit. Ignore the deprecated option pin everywhere. Make the old `ConnectionDependencies.target` optional and unused (P8's old constructor may still supply it); remove owned-target proof calls, not account/scope checks. `captureSetupSnapshot` rejects a v1 row with safe reconnect-required; it never migrates it.

Add `beginConsent(signal)` to transition a connected v2 record to reconnect-required (account revision +1, discovery null, preserve encrypted tokens/default), call the account invalidation hook and increment lifecycle epoch. `oauth.start` calls it **before** capturing the snapshot. Already reconnect-required and new/disconnected records need no preliminary write. This makes repeated starts supersede old flows while preserving replay/state logic.

In `installGrant` repeat the full `calendarGrantStatus` check even if a test/client bypasses exchange. Require expected subject equality before token encryption or discovery. For same-subject re-consent retain connection ID/default setting, increment credential version and increment account revision only for the genuine authority transition. For a new connection or a connection after explicit disconnect allocate a new random connection ID and null override; increment setting revision as required by P2. Account replacement never carries an override. This task saves connected credentials with `discovery:null`; Task 5 adds post-connect bounded out-of-turn discovery and canonical-primary evidence. Never combine discovery with an authority transition that P2 rejects.

```ts
const replacing = current !== null && (current.status === 'disconnected'
  || current.googleSubjectId !== input.account.subject);
if (input.snapshot.expectedGoogleSubjectId !== null
  && input.snapshot.expectedGoogleSubjectId !== input.account.subject) {
  throw toolFault('credential', 'OAUTH_SUBJECT_CHANGED');
}
const connectionId = !current || replacing ? randomBytes(16).toString('hex') : current.connectionId;
const credentialVersion = current ? current.credentialVersion + 1 : 1;
const aad = { userId: this.userId, connectionId, credentialVersion,
  googleSubjectId: input.account.subject };
const defaultSetting = current && !replacing ? current.defaultSetting
  : { defaultCalendarId: null,
    defaultSettingRevision: current ? current.defaultSetting.defaultSettingRevision + 1 : 1 };
const next = calendarConnectionV2Schema.parse({ schemaVersion: 2, userId: this.userId,
  provider: 'google-calendar', connectionId, revision: current ? current.revision + 1 : 1,
  connectionRevision: current ? current.connectionRevision + 1 : 1,
  credentialVersion, googleSubjectId: input.account.subject, accountEmail: input.account.email,
  enabled: true, status: 'connected', defaultSetting, discovery: null,
  credentials: { access: this.cipher.sealToken(tokenAad(aad, 'access'), input.grant.accessToken),
    refresh: this.cipher.sealToken(tokenAad(aad, 'refresh'), input.grant.refreshToken) },
  tokenExpiresAt: input.grant.expiresAt, grantedScopes: input.grant.scopes, updatedAt: now,
});
```

This construction is used after `beginConsent` or for new/disconnected rows. A direct install on an already connected unchanged authority is rejected as stale, not silently recaptured: its caller must invoke `beginConsent` and capture the resulting trusted snapshot first. Update the owned installation helpers to follow that order. Do not submit a revision-only authority bump to P2. Use `storeV2.create` or exact three-revision CAS; uncertainty fences and returns `PERSISTENCE_ERROR`. Recheck flow/epoch before/after every await. No token rollback or revocation on failed install: project-wide revoke is destructive.

Add `currentAccount():Promise<CalendarAccountBinding>` now, reading the compatible v2 facade, rejecting v1/incomplete/disconnected/disabled/unconfigured/fenced records, and returning `calendarAccountBindingSchema.parse({userId:record.userId,connectionId:record.connectionId,connectionRevision:record.connectionRevision,googleSubjectId:record.googleSubjectId})`. This is account-only evidence, not target authority. Task 4 adds the reusable exact-match recheck and credential handling.

Catch `OAuthScopeRejected` in `oauth.callback`: after state consumption, retain reconnect-required, store only a bounded epoch-bound `missingScopes` diagnostic and return `failed`. For an existing connected flow `beginConsent` already persisted reconnect-required; for no account expose reconnect-required while that diagnostic exists, otherwise setup-required after restart. Preserve old credentials/scopes, do not install/revoke partial tokens or attach them to an exception. Clear diagnostic only on a newer flow, full successful install, disconnect or replacement; an old failure cannot overwrite a newer result. Wrong-subject callbacks are failed, not account switches. Callback query `scope` is never evidence; only the token endpoint's returned scope is checked.

**Migrate the current red fixtures properly:** active `connection-fixtures`/`oauth-fixtures` installations now produce schemaVersion 2 with all five scopes and discovery, rather than passing active scopes into `connectionRecordSchema` v1. Existing explicit v1-history fixtures use `CALENDAR_SCOPES_V1` and remain v1. Replace old owned-target proof assertions with exact canonical discovery/account/role evidence, preserving the same mismatch/CAS/no-revoke/old-binding-denied assertions. OAuth fixtures expose the real discovery spy instead of `targetVerify`; never fake `owner` proof for shared writers. Keep state/PKCE tests unchanged in intent. Test legacy `v2.get/statusV2` causes zero writes/refresh calls; explicitly call P2 `migrateLegacy` only in an isolated memory fixture with true stopped/drained preconditions, then re-consent and assert its persisted old pin remains an override.
- [ ] **Run green:** `npm test -- test/plugins/google-calendar/connection-multi.spec.ts test/plugins/google-calendar/oauth.spec.ts`. Add assertions for successful same-subject override preservation after `beginConsent`, invalid override retained as an ID (its unavailable resolution is verified in Task 6), partial consent missing each required scope, state replay after partial failure, and no v1 writes on status/startup. Task 4 supplies v2 disconnect/enable-only settings; add disconnect→different-subject reset and migrate the remaining existing active connection tests there. Those still-red P4 files remain explicit open work, not passing evidence at this task checkpoint.
- [ ] **Commit:** `feat(calendar): install fenced v2 grants and preserve same-account defaults`.

## Task 4: Rotate credentials and fence disable/disconnect without preference coupling

**Files:** modify `backend/src/plugins/google-calendar/connection.ts`; modify `backend/test/plugins/google-calendar/connection-refresh.spec.ts`, `connection-fixtures.ts`, `connection-multi.spec.ts`.

- [ ] **Write the failing tests** using Task 3's real v2 fixture:

```ts
it('rotates the whole encrypted pair while preserving a concurrent preference', async () => {
  const f = await multiConnectionFixture({ expiredToken: true });
  const gate = deferred<{ accessToken: string; refreshToken: string | null;
    expiresAt: string; scopes: string[] | null }>();
  f.client.refresh.mockImplementationOnce(() => gate.promise);
  const account = await f.service.currentAccount();
  const consumeRefreshRequest = vi.fn(async () => undefined);
  const pending = f.service.withAccessToken({ account, signal: new AbortController().signal,
    deadlineAt: new Date(f.now() + 20000).toISOString(), consumeRefreshRequest }, async token => token);
  await vi.waitFor(() => expect(f.client.refresh).toHaveBeenCalledTimes(1));
  await f.patch({ defaultSetting: { defaultCalendarId: 'shared-team', defaultSettingRevision: 2 } });
  gate.resolve({ accessToken: 'rotated-access', refreshToken: null,
    expiresAt: new Date(f.now() + 3600000).toISOString(), scopes: null });
  expect(await pending).toBe('rotated-access');
  const saved = (await f.read())!;
  expect(saved.connectionRevision).toBe(account.connectionRevision);
  expect(saved.defaultSetting).toEqual({ defaultCalendarId: 'shared-team', defaultSettingRevision: 2 });
  expect(saved.credentialVersion).toBe(2);
  expect(f.cipher.openToken(tokenAad(saved, 'refresh'), saved.credentials!.refresh)).toBe('fixture-refresh');
  expect(consumeRefreshRequest).toHaveBeenCalledTimes(1);
});

it('never retries an arbitrary effect callback after an unauthorized response', async () => {
  const f = await multiConnectionFixture();
  const action = vi.fn(async () => { throw toolFault('credential', 'RECONNECT_REQUIRED'); });
  await expect(f.service.withAccessToken({ account: await f.service.currentAccount(),
    signal: new AbortController().signal, deadlineAt: new Date(f.now() + 20000).toISOString(),
    consumeRefreshRequest: vi.fn(async () => undefined) }, action)).rejects.toBeDefined();
  expect(action).toHaveBeenCalledTimes(1);
});
```

Import `deferred` from `./oauth-fixtures.js`, `tokenAad` from the existing source, `toolFault` from `tools-validation.js`, and `vi/expect/it` from Vitest. No new test utility is needed.
- [ ] **Run red:** `npm test -- test/plugins/google-calendar/connection-refresh.spec.ts -t "whole encrypted pair|arbitrary effect"`. The new account-only signature or preference-race rejection is expected; a test already green is retained regression evidence, not claimed red.
- [ ] **Minimum implementation.** Add `currentAccount():Promise<CalendarAccountBinding>` and `requireAccountCurrent(account,signal)` checking user/connection/revision/subject, enabled/connected/full verified grant, configured encryption/current approved policy, fence/closing. Account identity excludes default/discovery/credential versions. `tokenAad` remains version 1 and accepts the existing structural Pick; no schema-version/account-revision/default change enters AAD.

Overload `withAccessToken` with the exact P1 account input and retain the old binding signature only to compile unmigrated callers; the old v1 path refuses execution with `CALENDAR_RECONNECT_REQUIRED`. Implement `readonly credentials:CalendarAccountCredentialPort` if needed to expose the unambiguous account-only overload. Do not fabricate target authority to support old callers. Coalesce refresh by connection/account/credential version, not whole-document revision; preference/discovery writes do not start another OAuth request. Followers have independent abort/deadline waits; close/disconnect abort the leader's service-owned controller. Debit the supplied refresh admission once per actual request before calling the client; no request when denied.

After refresh reread and revalidate account/epoch plus the **original credentialVersion**. If only preferences/discovery changed, rebase once on the winner without another OAuth request; if credentials or authority changed, never overwrite it. Preserve exact granted scopes on token-only writes; omitted scope keeps the old full set, an explicit missing/changed required scope marks reconnect-required and clears discovery with account revision +1. Never infer new Phase 2 scopes from a refresh of a legacy record. Encrypt **both** access and retained/rotated refresh token under `credentialVersion+1`.

```ts
const nextVersion = latest.credentialVersion + 1;
const aad = { ...latest, credentialVersion: nextVersion };
const next = calendarConnectionV2Schema.parse({ ...latest,
  revision: latest.revision + 1, credentialVersion: nextVersion,
  credentials: { access: this.cipher.sealToken(tokenAad(aad, 'access'), refreshed.accessToken),
    refresh: this.cipher.sealToken(tokenAad(aad, 'refresh'), refreshed.refreshToken ?? refreshToken) },
  tokenExpiresAt: refreshed.expiresAt, updatedAt: new Date(this.clock()).toISOString(),
});
const result = await this.storeV2!.compareAndSwap({ userId: this.userId,
  expectedRevision: latest.revision, expectedConnectionRevision: latest.connectionRevision,
  expectedDefaultSettingRevision: latest.defaultSetting.defaultSettingRevision, next });
```

Only confirmed CAS permits token use. Uncertain ACK fences; a conflict permits at most one exact-account/unchanged-credential rebase, never an unbounded loop or a second refresh-token request. New ciphertext pairs may be rebuilt from the same returned plaintext only after the conflict has been confirmed; wipe local plaintext references in `finally` where possible without claiming JS memory erasure.

Keep generic `withAccessToken` single-action. Add concrete trusted `refreshAfterUnauthorized(input:Parameters<CalendarAccountCredentialPort['withAccessToken']>[0])` to force the existing single-flight refresh, and `rejectUnauthorizedAccount(account)` to persist reconnect-required after a second 401; Task 5 uses them only around read-only discovery. P5/P8 receive these names, not permission to replay create.

Migrate the existing enable-only `settings({enabled})` branch to the v2 store in this task; Task 7 adds preference fields without weakening it. Disable/disconnect fence synchronously before awaits, invalidate epoch and abort refresh/discovery leaders. Separate the existing boolean's two concerns: an **execution fence** for intentional disable/disconnect versus a **hard safety fence** for uncertain persistence/close. Fresh explicit Connect may capture a new snapshot after confirmed local disconnect, despite the execution fence; old snapshots/callbacks fail their epoch check. It may never clear a hard uncertainty fence. Capture refuses while another lifecycle mutation is unconfirmed. Only a confirmed current-flow new grant or explicit confirmed enable clears the execution fence, never a stale async callback. This separation fixes reconnect-after-disconnect without weakening disable/revoke or uncertainty fencing.

Disable keeps credentials, advances only document/account revisions and clears discovery (P2 requires null on authority changes). Re-enable advances account revision and must refresh discovery before authorizing operations. Disconnect clears tokens, token expiry and discovery, increments credential version iff removing tokens, status disconnected/enabled false/account revision +1. Local disconnect never revokes; explicit acknowledged revoke occurs only **after confirmed local clear**, with its token captured under original AAD. Never retry disconnect against a replacement account; a reread/rebase must match original connection/subject. Close does not mutate/revoke data.
- [ ] **Run green:** `npm test -- test/plugins/google-calendar/connection-refresh.spec.ts test/plugins/google-calendar/connection.spec.ts test/plugins/google-calendar/connection-multi.spec.ts`. Retain and rerun existing 1/2/10-caller refresh, omitted refresh token, denied budget and uncertain CAS tests. Add pending refresh→disable/disconnect/replacement/close and mismatched AAD cases; assert no token action and no old-token resurrection.
- [ ] **Commit:** `fix(calendar): rotate v2 credentials without coupling preferences or replaying effects`.

## Task 5: Maintain bounded post-connect, expiry and manual discovery with coalescing/CAS

**Files:** create `backend/src/plugins/google-calendar/discovery.ts`, `backend/test/plugins/google-calendar/discovery.spec.ts`; modify `connection.ts` and owned fixture only for composition/accessors.

- [ ] **Write the failing tests:**

```ts
import { expect, it, vi } from 'vitest';
import { deferred } from './oauth-fixtures.js';
import { multiConnectionFixture } from './connection-multi-fixtures.js';

it('coalesces manual refresh and cannot resurrect a disconnected account', async () => {
  const f = await multiConnectionFixture();
  const old = (await f.read())!;
  const result = deferred<NonNullable<typeof old.discovery>>();
  f.discover.mockImplementationOnce(() => result.promise);
  const signal = new AbortController().signal;
  const a = f.service.refreshCalendars({ expectedConnectionRevision: old.connectionRevision }, signal);
  const b = f.service.refreshCalendars({ expectedConnectionRevision: old.connectionRevision }, signal);
  await vi.waitFor(() => expect(f.discover).toHaveBeenCalledTimes(1));
  await f.service.disconnect({ mode: 'local' }, signal);
  result.resolve({ ...old.discovery!, discoveryRevision: old.revision + 1 });
  await Promise.allSettled([a, b]);
  expect(await f.read()).toMatchObject({ status: 'disconnected', credentials: null, discovery: null });
  expect(f.discover).toHaveBeenCalledTimes(1);
});

it('keeps complete evidence byte-for-byte after a partial refresh and does not extend expiry', async () => {
  const f = await multiConnectionFixture();
  const before = (await f.read())!;
  f.discover.mockResolvedValueOnce({ ...before.discovery!, discoveryRevision: before.revision + 1,
    complete: false, truncated: true, nextPageToken: 'provider-only', limitations: ['page-limit'] });
  await expect(f.service.refreshCalendars({ expectedConnectionRevision: before.connectionRevision },
    new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'CALENDAR_DISCOVERY_PARTIAL' } });
  expect((await f.read())!.discovery).toEqual(before.discovery);
  expect((await f.read())!.defaultSetting).toEqual(before.defaultSetting);
});
```

- [ ] Also extend Task 3's no-pin install test before implementation: replace its final `discovery:null` / zero-discovery assertions with `expect((await f.service.statusV2()).primaryCalendarId).toBe('canonical-primary')` and `expect(f.discover).toHaveBeenCalledTimes(1)`. It must still assert a null override. This is the post-connect/canonical-primary regression, not permission to manufacture primary from email.
- [ ] **Run red:** `npm test -- test/plugins/google-calendar/discovery.spec.ts -t "coalesces manual|complete evidence"`, then `npm test -- test/plugins/google-calendar/connection-multi.spec.ts -t "without a pin"`.
- [ ] **Minimum implementation.** Create `CalendarDiscoveryService` with dependencies `{store:CalendarConnectionStoreV2, provider:CalendarDiscoveryPort, credentials:CalendarAccountCredentialPort, requireAccountCurrent, refreshAfterUnauthorized, rejectUnauthorizedAccount, retentionPolicy, limits:CalendarLimits, now}`. The three lifecycle functions delegate to the **same** connection instance; they are concrete constructor callbacks, not new shared contracts or owners. Export a local `DiscoveryRefreshInput`:

```ts
export type DiscoveryRefreshInput = {
  account: CalendarAccountBinding; mode: 'in-turn' | 'out-of-turn';
  signal: AbortSignal; deadlineAt: string; force: boolean;
  purpose: 'discovery' | 'capability-recheck';
  consumeRequest: (kind: 'discovery' | 'capability-recheck') => Promise<void>;
  consumeRefreshRequest: () => Promise<void>;
};
```

Methods: `refresh(input):Promise<CalendarDiscoverySnapshot>`, `ensureFresh(input):Promise<CalendarDiscoverySnapshot>`, `page(query):Promise<CalendarCalendarsResponse>`, `invalidate():void`. The public `CalendarCalendarsResponse` is a local inference from P1's response schema. `ensureFresh` may use a retained fresh cached snapshot for **selection only**, never to satisfy forced `requireCurrent`. No timers/background daemon. Capture the existing lifecycle epoch and fixed deadline at start; reject after any account/fence change, including after provider returns/after CAS.

For out-of-turn UI/post-connect refresh use one service-owned flight per exact account + mode + purpose, local delivery admission capped by configured `min(10,discoveryPagesOutOfTurn)`, refresh requests `min(2,refreshRequests)`, and fixed ≤20-second deadline. Concurrent callers join that flight but can cancel their own wait; a follower cannot cancel the leader. In-turn coalescing is allowed only for the **same admission-callback identity** and account/mode/purpose, otherwise use separate flights so an unrelated accepted turn cannot obtain free accounting. Keep at most one active out-of-turn flight and finitely bounded in-turn entries by the admitted executor's existing concurrency; remove every settled flight in `finally`. If simpler, do not coalesce in-turn at all. Do not add a new concurrency service.

All provider calls consume the same closure. Decrement delivery allowance before delegating the caller's durable admission; a denial sends no HTTP and may not be swallowed as partial data. Out-of-turn local limits are admission for explicitly invoked setup/UI work, not a replacement for per-turn persisted budgets. `force:true` never expands count/deadline. No 429/5xx retry loop is introduced: propagate the typed fault to its existing budget owner. A discovery-only raw 401 (`RECONNECT_REQUIRED`) permits **one** call to `refreshAfterUnauthorized`, then one new provider scan with remaining page allowance; second 401 calls `rejectUnauthorizedAccount`. This replay counts as another Calendar delivery and cannot reset the 2/10-page allowance.

```ts
const cap = Math.min(input.mode === 'in-turn' ? limits.discoveryPagesInTurn
  : limits.discoveryPagesOutOfTurn, input.mode === 'in-turn' ? 2 : 10);
let used = 0;
const admit: CalendarProviderContext['consumeRequest'] = async () => {
  if (used >= cap) throw toolFault('budget', 'CALENDAR_REQUEST_BUDGET');
  used += 1;
  await requireAccountCurrent(input.account, input.signal);
  await input.consumeRequest(input.purpose);
  await requireAccountCurrent(input.account, input.signal);
};
// For each provider invocation, including the single eligible 401 replay:
const fresh = await credentials.withAccessToken({ account: input.account,
  signal: input.signal, deadlineAt: input.deadlineAt,
  consumeRefreshRequest: input.consumeRefreshRequest }, accessToken => provider.discover({
    account: input.account, accessToken, grantedScopes: current.grantedScopes,
    policyAllows: true, signal: input.signal, deadlineAt: input.deadlineAt,
    now: new Date(now()).toISOString(), retentionPolicy: retentionPolicy(), consumeRequest: admit,
    mode: input.mode, discoveryRevision: current.revision + 1,
    limits: { retainedCalendars: Math.min(100, limits.retainedCalendars), pageDeliveries: cap - used,
      snapshotBytes: Math.min(262144, limits.snapshotBytes, connectionSnapshotAllowance),
      freshnessMs: Math.min(300000, limits.discoveryFreshnessMs) },
  }));
```

Check positive remaining deliveries **before** invoking P3; never pass zero and mistake its input fault for partial success. P3 keeps its unchanged `consumeRequest('discovery')`; map it to `input.purpose` at this lifecycle boundary. Credentials/processing policy/retention must be current server evidence, not browser/model data.

`connectionSnapshotAllowance` is `262144 - jsonBytes({...current, revision:current.revision+1, discovery:null})`, using existing `jsonBytes` from `contracts/calendar-tools.ts`. This conservatively reserves the full encrypted-connection envelope as well as the snapshot, because P1 bounds the **whole connection** at 256 KiB too. Reject a nonpositive allowance before provider admission. Recheck whole-record bytes when rebasing over a token/default winner; if the result no longer fits, return `CALENDAR_RESULT_TOO_LARGE` and keep the previous cache. Never raise snapshot limits, omit tokens, or silently trim a snapshot while retaining its complete flag.

After provider return parse P1 snapshot and check its exact connection ID/revision. A new persisted snapshot's `discoveryRevision` is the **winning next document revision**, not old snapshot+1. Re-read current v2 record; if only document/default/token changes occurred on the same enabled/full-grant account, rebase snapshot revision once with no provider retry and preserve the winner's credentials/default. If another discovery with equal/newer fetchedAt or higher revision already won, use that winner only after validation; never replace it with an older result. On a second conflict return a safe conflict; uncertainty fences and returns `PERSISTENCE_ERROR`.

```ts
if (latest.discovery?.complete && !fresh.complete) {
  // Preserve persisted completeness/times; return only transient fresh diagnostic data.
  return fresh;
}
if (Date.parse(fresh.expiresAt) <= now() || fresh.retentionPolicyId === null
  || Date.parse(fresh.retentionExpiresAt) <= now()) {
  return fresh; // Volatile return only; never persist/extend no-store or expired evidence.
}
const discovery = { ...fresh, discoveryRevision: latest.revision + 1 };
const next = calendarConnectionV2Schema.parse({ ...latest, revision: latest.revision + 1,
  discovery, updatedAt: new Date(now()).toISOString() });
const saved = await store.compareAndSwap({ userId: latest.userId,
  expectedRevision: latest.revision, expectedConnectionRevision: latest.connectionRevision,
  expectedDefaultSettingRevision: latest.defaultSetting.defaultSettingRevision, next });
```

A partial initial snapshot may persist (positive retention lifetime) with all original limitations; no complete snapshot is fabricated. For an existing complete snapshot the transient partial may inform clarification/denial, but it is **not** merged or represented as the persisted authoritative set. It cannot produce a new resolved target/proposal tied to a nonexistent persisted discovery revision. Manual `refreshCalendars` compares the returned snapshot to the actual persisted snapshot: a transient unmatched partial returns `CALENDAR_DISCOVERY_PARTIAL`, while a newly persisted initial partial can return an honestly partial page. Leave GET/status showing the old snapshot honestly stale when expired. A volatile no-store result cannot populate later GET pages; manual refresh returns `NOT_READY` if no durable cache can be presented. Do not clear a complete snapshot just to evade P2's partial-replacement rule.

Now invoke this service after Task 3's **confirmed** grant install, using out-of-turn limits and the same fixed OAuth callback deadline. A failed/partial post-connect scan leaves connected credentials plus absent/partial cache; status is degraded while required discovery is absent/stale/partial, not a false fully ready target. Do not roll back credentials or let a post-connect discovery failure erase a valid same-account override. The first test above now proves canonical primary from discovered metadata without setting an override.

Add exact assertions before green: expiry at 300000ms triggers a scan, fresh ensureFresh does not; status/GET never scan; no snapshot+partial persists honestly; empty/primary-missing remains partial; failed first page keeps old cache/default; no-store result not persisted; default/token CAS winner preserved; disconnect/replacement/disable/close between fetch and CAS cannot publish; failed persistence admission produces zero provider calls; 401→refresh→success uses two Calendar deliveries/one refresh; 401→refresh→401 is terminal; a 2-delivery scan cannot issue a third replay. Each count assertion uses the spy actually called by P3, not a fake count returned by the service.
- [ ] **Run green:** `npm test -- test/plugins/google-calendar/discovery.spec.ts test/plugins/google-calendar/connection-multi.spec.ts test/plugins/google-calendar/connection-refresh.spec.ts`.
- [ ] **Commit:** `feat(calendar): maintain bounded discovery with coalesced fenced refreshes`.

## Task 6: Resolve canonical defaults and freshly check operation-specific capabilities

**Files:** modify `backend/src/plugins/google-calendar/connection.ts`, `discovery.ts`; create `backend/test/plugins/google-calendar/connection-capabilities.spec.ts`.

- [ ] **Write the failing role/operation test:**

```ts
import { expect, it } from 'vitest';
import { effectiveCalendarCapabilities } from '../../../src/contracts/calendar-discovery.js';
import { CALENDAR_SCOPES, CALENDAR_SCOPES_V1 } from '../../../src/contracts/calendar-policy.js';
import { multiConnectionFixture } from './connection-multi-fixtures.js';

it('gates read create and availability separately on fresh shared roles', async () => {
  for (const role of ['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader'] as const) {
    for (const operation of ['read', 'create', 'availability'] as const) {
      const f = await multiConnectionFixture();
      f.entries[1] = { ...f.entries[1]!, accessRole: role,
        privateAccess: role === 'owner' || role === 'writer',
        capabilities: effectiveCalendarCapabilities(role, CALENDAR_SCOPES, true) };
      const result = await f.service.capabilityGate.resolve(await f.request(operation, 'shared-team'));
      const allowed = operation === 'availability'
        || (operation === 'read' ? role !== 'freeBusyReader' : !['reader', 'freeBusyReader'].includes(role));
      expect(result.outcome).toBe(allowed ? 'resolved' : 'denied');
      if (result.outcome === 'resolved') {
        expect(result.target.calendarId).toBe('shared-team');
        expect(result.target.privateAccess).toBe(role === 'owner' || role === 'writer');
      }
      expect(f.discover).toHaveBeenCalled();
    }
  }
  const old = await multiConnectionFixture({ scopes: CALENDAR_SCOPES_V1 });
  await expect(old.service.currentAccount()).rejects.toMatchObject({ failure: { code: 'CALENDAR_RECONNECT_REQUIRED' } });
  expect(old.client.refresh).not.toHaveBeenCalled();
});

it('does not silently replace an unavailable saved default or invent primary from email', async () => {
  const f = await multiConnectionFixture({ defaultCalendarId: 'gone-calendar' });
  expect(await f.service.capabilityGate.resolve(await f.request('create')))
    .toMatchObject({ outcome: 'clarify', code: 'CALENDAR_DEFAULT_UNAVAILABLE' });
  expect(await f.service.capabilityGate.resolve(await f.request('create', 'unknown')))
    .toMatchObject({ outcome: 'clarify', code: 'CALENDAR_TARGET_UNKNOWN' });
  f.entries[0] = { ...f.entries[0]!, primary: false };
  f.discover.mockImplementationOnce(async input => ({ ...((await f.read())!.discovery!),
    discoveryRevision: input.discoveryRevision, entries: f.entries, complete: false,
    limitations: ['primary-missing'] }));
  expect(await f.service.capabilityGate.resolve(await f.request('create', 'primary')))
    .toMatchObject({ outcome: 'clarify', code: 'CALENDAR_PRIMARY_MISSING' });
});
```

- [ ] **Run red:** `npm test -- test/plugins/google-calendar/connection-capabilities.spec.ts -t "gates read|unavailable saved"`.
- [ ] **Minimum implementation.** Expose `readonly capabilityGate:CalendarCapabilityGate` delegating to `resolveTarget` / `requireTargetCurrent`. Use exact P1 inputs/results, not a second capability schema. For canonical IDs and `primary`, resolve explicit selector → stored override → primary from `primary:true`, without email guessing. P6 owns natural-language/fuzzy matching and accepted intent: P4 may resolve a unique exact normalized label using `trim().replace(/\s+/gu,' ').toLocaleLowerCase('en-US')`, but ambiguous labels return ≤20 bounded candidates, never invented aliases. If P6 provides a canonical selector, do not reinterpret it as another calendar's name. Unknown explicit target never falls back. Null selector with unavailable override returns `CALENDAR_DEFAULT_UNAVAILABLE`; missing primary returns `CALENDAR_PRIMARY_MISSING`.

Resolve always obtains a fresh bounded provider snapshot for authorization (it may first use ensureFresh metadata to identify the candidate). Force `requireCurrent` discovery even for a fresh cache, mapping each delivery to `capability-recheck`. A fresh bounded scan that omits the requested target denies/clarifies it; an old retained complete cache cannot authorize an omitted target after a partial refresh. A known entry in a newly persisted initial partial snapshot may prove that **specific** role, but cannot establish complete availability coverage or guess missing primary. A transient partial that P2 could not persist may supply unknown/default/primary clarification, not a resolved target with an unpersisted revision; deny otherwise. Recompute capabilities using current full grant/policy, role and hidden/deleted flags rather than trusting stored booleans.

```ts
const caps = effectiveCalendarCapabilities(entry.accessRole, record.grantedScopes,
  this.isConfigured() && !entry.hidden && !entry.deleted);
const key = input.operation === 'read' ? 'readEvents'
  : input.operation === 'create' ? 'createEvents' : 'availability';
if (!caps[key]) return { outcome: 'denied', code: input.operation === 'create'
  ? 'CALENDAR_TARGET_READ_ONLY' : 'CALENDAR_EXECUTION_DENIED' };
const target = calendarResolvedTargetSchema.parse({ ...input.account,
  calendarId: entry.calendarId, calendarLabel: entry.label,
  targetRevision: input.account.connectionRevision,
  discoveryRevision: fresh.discoveryRevision, selectedBy,
  accessRole: entry.accessRole, privateAccess: entry.privateAccess, capabilities: caps,
  verifiedAt: fresh.fetchedAt, proofRevision: CALENDAR_PROOF_REVISION });
return { outcome: 'resolved', target };
```

`targetRevision` is an immutable per-account canonical-target authority marker in this phase, **not** `defaultSettingRevision` and not the latest discovery revision. Use the existing account revision as that marker; `calendarId` supplies target identity, current rights are checked freshly, and a preference/ordinary refresh must not rewrite a pinned operation/cursor. Preserve an already-pinned target's marker in `requireCurrent`; return void rather than replacing its label/ID/selection/default. Discovery freshness revision is independent. If another owner requires a different shared target-version rule, report to P1 before changing it.

`requireCurrent({target,...})` parses target, requires current exact account, freshly discovers and checks the **same canonical ID** and operation. It must not call resolve with null or consult the latest saved default. Recheck account/epoch after provider/admission and before returning. Reader read/availability succeeds; freeBusyReader event reads/creates fail; shared writer and writerWithoutPrivateAccess create succeeds with privateAccess false for the latter. Unknown/hidden/deleted entries fail closed. An ACL-only 403 or target-local 404 does not disconnect a full-scope account; propagate safe denial/unavailable and let next refresh update discovery. Missing scopes are reconnect-required, not a read-only-target warning. No event API or availability call occurs here.

Add explicit tests before green for default-only change preserving a pinned target, role loss between resolve/requireCurrent, unknown role/hidden/deleted exclusion, current policy expiry, same-account partial grant, canonical primary after Workspace email rename, missing/truncated primary, duplicate labels, explicit canonical ID, aborted/deadline/admission denial, stale old account, and actual `capability-recheck` counts. Assert ≤2 counted in-turn scan deliveries and no cache-only success from a stale writable role.
- [ ] **Run green:** `npm test -- test/plugins/google-calendar/connection-capabilities.spec.ts test/plugins/google-calendar/discovery.spec.ts`.
- [ ] **Commit:** `feat(calendar): enforce fresh operation-specific calendar capabilities`.

## Task 7: Save/reset defaults with independent expected revisions and no accidental enablement

**Files:** modify `backend/src/plugins/google-calendar/connection.ts`; create `backend/test/plugins/google-calendar/connection-settings.spec.ts`.

- [ ] **Write the failing tests:**

```ts
import { expect, it } from 'vitest';
import { multiConnectionFixture } from './connection-multi-fixtures.js';

it('saves a preference without toggling enablement or fencing a pinned operation', async () => {
  const f = await multiConnectionFixture();
  const before = (await f.read())!;
  await f.service.settings({ defaultSetting: { calendarId: 'shared-team', expectedRevision: 1,
    expectedConnectionRevision: before.connectionRevision } }, new AbortController().signal);
  const saved = (await f.read())!;
  expect(saved.enabled).toBe(before.enabled);
  expect(saved.connectionId).toBe(before.connectionId);
  expect(saved.connectionRevision).toBe(before.connectionRevision);
  expect(saved.credentialVersion).toBe(before.credentialVersion);
  expect(saved.defaultSetting).toEqual({ defaultCalendarId: 'shared-team', defaultSettingRevision: 2 });
  expect(f.invalidated).not.toHaveBeenCalled();
  expect((await f.restart().statusV2()).defaultSetting).toEqual(saved.defaultSetting);
  await expect(f.service.settings({ defaultSetting: { calendarId: null, expectedRevision: 1,
    expectedConnectionRevision: saved.connectionRevision } }, new AbortController().signal))
    .rejects.toMatchObject({ failure: { code: 'CALENDAR_SETTINGS_CONFLICT' } });
  expect((await f.read())!.defaultSetting).toEqual(saved.defaultSetting);
});

it('resets to automatic primary without writing the primary alias or enabling a disabled plugin', async () => {
  const f = await multiConnectionFixture({ enabled: false, defaultCalendarId: 'shared-team' });
  const before = (await f.read())!;
  await f.service.settings({ defaultSetting: { calendarId: null, expectedRevision: 1,
    expectedConnectionRevision: before.connectionRevision } }, new AbortController().signal);
  const saved = (await f.read())!;
  expect(saved.enabled).toBe(false);
  expect(saved.defaultSetting).toEqual({ defaultCalendarId: null, defaultSettingRevision: 2 });
  expect(saved.connectionRevision).toBe(before.connectionRevision);
  expect(f.discover).not.toHaveBeenCalled();
});
```

- [ ] **Run red:** `npm test -- test/plugins/google-calendar/connection-settings.spec.ts -t "saves a preference|resets to automatic"`.
- [ ] **Minimum implementation.** Parse only `calendarSettingsV2RequestSchema` (it already accepts enable-only legacy shapes). `defaultSetting.expectedRevision` means **defaultSettingRevision**, not document CAS revision; `expectedConnectionRevision` must also match. `{}` / unknown fields / `calendarId:'primary'` fail schema validation; reset is `calendarId:null`. Do not let the default patch's absent `enabled` be interpreted as false. Use a local mutation guard for settings, but stale expected revisions still matter across tabs and async refresh.

If selecting a nonnull default, require currently enabled, connected, fully consented account and a fresh `create` gate result for that exact canonical ID. A disabled plugin may **clear** an override or save enable-only changes without network; nonnull selection while disabled returns a safe denied/not-ready outcome instead of enabling it implicitly. The UI can enable first. Unknown/read-only/hidden/unavailable targets reject without changing the stored preference. Reset requires no primary lookup and does not manufacture one. A missing primary can remain a clarification after a successful reset.

After fresh validation re-read and compare client expected account/setting revisions again. A concurrent default/account change is a settings conflict; do not transparently retry the user's stale preference against a newer setting. Disjoint token/discovery changes may rebase document CAS at most once after rechecking the same expected account/default versions and fresh evidence. Preserve tokens/snapshot unless enablement itself changes; combined disable clears discovery and account-fences because **disable changed**, not because of preference. The exact construction is:

```ts
const enabled = body.enabled ?? current.enabled;
const defaultId = body.defaultSetting === undefined ? current.defaultSetting.defaultCalendarId
  : body.defaultSetting.calendarId;
const settingChanged = defaultId !== current.defaultSetting.defaultCalendarId;
const authorityChanged = enabled !== current.enabled;
const next = calendarConnectionV2Schema.parse({ ...current, revision: current.revision + 1,
  enabled, connectionRevision: current.connectionRevision + Number(authorityChanged),
  defaultSetting: { defaultCalendarId: defaultId,
    defaultSettingRevision: current.defaultSetting.defaultSettingRevision + Number(settingChanged) },
  discovery: authorityChanged ? null : current.discovery,
  updatedAt: new Date(this.clock()).toISOString(),
});
```

An exact no-op with matching client expected revisions returns current status without a setting revision bump. A stale expected revision still conflicts even when its value matches: do not silently tell a stale tab it owns current authority. Disabled/account mutation fences before await. Preference-only mutations do **not** increment lifecycle epoch, abort unrelated generation, call invalidation hooks, or retarget a persisted operation. Uncertain saves return `PERSISTENCE_ERROR` and do not claim success. Publish `CALENDAR_SETTINGS_CONFLICT` as a bounded internal failure mapped to public HTTP 409 (Task 9).

Add exact tests for two tabs same expected revision (one save, one conflict), token/discovery write during validation (preserved after one rebase), default loss then explicit reset, reader/freeBusyReader/unknown default rejection, enable-only/default-only/combined shapes, unchanged value, account replacement between validation/CAS, uncertain ACK, invalid expected revisions, and no primary fallback after failed validation. Existing disable/revoke tests stay intact.
- [ ] **Run green:** `npm test -- test/plugins/google-calendar/connection-settings.spec.ts test/plugins/google-calendar/connection.spec.ts test/plugins/google-calendar/connection-capabilities.spec.ts`.
- [ ] **Commit:** `feat(calendar): save default preferences with independent revision conflicts`.

## Task 8: Return cache-only bounded pages with signed account/snapshot cursors

**Files:** modify `backend/src/plugins/google-calendar/discovery.ts`, `connection.ts`; create `backend/test/plugins/google-calendar/discovery-pages.spec.ts`. P5's event cursor file is read-only; do not edit or reuse its v1 payload as v2 authority.

- [ ] **Write the failing paging tests:**

```ts
import { expect, it } from 'vitest';
import { calendarCalendarsResponseSchema } from '../../../src/contracts/calendar-wire.js';
import { multiConnectionFixture } from './connection-multi-fixtures.js';

it('pages cached calendars by count and bytes without exposing provider continuation or refreshing', async () => {
  const f = await multiConnectionFixture();
  const old = (await f.read())!;
  const entries = Array.from({ length: 25 }, (_, i) => ({ ...f.entries[0]!,
    calendarId: `cal-${String(i).padStart(2, '0')}`, label: `Calendar ${i}`, primary: i === 0 }));
  expect((await f.patch({ discovery: null })).outcome).toBe('confirmed');
  const cleared = (await f.read())!;
  expect((await f.patch({ discovery: { ...old.discovery!, discoveryRevision: cleared.revision + 1,
    entries, complete: false, truncated: true, nextPageToken: 'private-provider-token',
    limitations: ['page-limit'] } })).outcome).toBe('confirmed');
  const a = calendarCalendarsResponseSchema.parse(await f.service.calendars({}));
  expect(a.page.calendars).toHaveLength(20);
  expect(a.page.nextPageToken).not.toBe('private-provider-token');
  const b = calendarCalendarsResponseSchema.parse(await f.service.calendars({ pageToken: a.page.nextPageToken! }));
  expect(b.page.calendars).toHaveLength(5);
  expect(b.page.nextPageToken).toBeNull();
  expect(new Set([...a.page.calendars, ...b.page.calendars].map(c => c.calendarId)).size).toBe(25);
  expect(a.page.complete).toBe(false);
  expect(Buffer.byteLength(JSON.stringify(a), 'utf8')).toBeLessThanOrEqual(16384);
  expect(f.discover).not.toHaveBeenCalled();
});

it('rejects tampered or expired calendar cursors without network or identity leakage', async () => {
  const f = await multiConnectionFixture();
  await expect(f.service.calendars({ pageToken: 'forged.signature' })).rejects.toBeDefined();
  const before = (await f.read())!;
  expect((await f.patch({ discovery: { ...before.discovery!, discoveryRevision: before.revision + 1,
    expiresAt: new Date(f.now() + 60000).toISOString(),
    retentionExpiresAt: new Date(f.now() + 300000).toISOString() } })).outcome).toBe('confirmed');
  f.advance(60000);
  const stale = await f.service.calendars({});
  expect(stale.page.limitations).toContain('stale');
  expect(stale.page.complete).toBe(false);
  expect(f.discover).not.toHaveBeenCalled();
});
```

The first test clears then seeds partial evidence in two **confirmed fixture-only** writes because P2 forbids complete → partial replacement; production refresh never clears a cache to evade that rule. The second test verifies stale output before retention expiry; add `f.advance(240000)` followed by `await expect(f.service.calendars({})).rejects.toMatchObject({code:'NOT_READY'})` at retention expiry, with no names returned.

- [ ] **Run red:** `npm test -- test/plugins/google-calendar/discovery-pages.spec.ts -t "pages cached|tampered or expired"`.
- [ ] **Minimum implementation.** `connections.calendars(query)` parses `calendarCalendarsQuerySchema` and delegates to `discovery.page`; it never calls `ensureFresh`. Read the current retained snapshot without network. No record/snapshot, disconnected/replaced account, or expired retention gives safe `NOT_READY` / empty-unavailable route error, not a fabricated snapshot revision. Before retention expiry, stale names may display with `complete:false`, allowlisted `stale` limitation and unchanged original times; they cannot authorize dispatch. A stale first page has no continuation authority beyond the original expiry. There is no query `refresh=true` or arbitrary calendar/account selector.

Generate process-local 32-byte HMAC key in `discovery.ts` (same native pattern as the existing cursor, no new dependency). Use P1's strict `calendarCursorV2PayloadSchema`:

```ts
const payload = calendarCursorV2PayloadSchema.parse({ v: CALENDAR_CURSOR_VERSION,
  kind: 'calendars', b: accountHash, q: queryHash, t: String(offset),
  discoveryRevision: snapshot.discoveryRevision, expiresAt: snapshot.expiresAt });
const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
const signature = createHmac('sha256', this.cursorKey).update(encoded, 'utf8').digest('hex');
const token = `${encoded}.${signature}`;
```

`accountHash` is SHA256 of `{userId,connectionId,connectionRevision,googleSubjectId}` with fixed property order; `queryHash` is SHA256 of `{kind:'calendars',pageSize:Math.min(20,limits.calendarsPerPage)}`. Neither includes defaultSettingRevision. Decode checks ≤2048 chars, one separator, canonical base64url, `/^[a-f0-9]{64}$/` signature before `timingSafeEqual`, strict P1 schema, exact kind/hash/discovery revision, expiry > trusted now, canonical nonnegative integer offset `< snapshot.entries.length`. Reject v1/event-kind/wrong-user/account/stale snapshot/expired tokens. Do not accept a validly signed token as credential or target authority. Restart invalidates cursors intentionally; annotate with `ponytail:` process-local single-executor ceiling and managed-key upgrade path.

Build pages with ≤configured 20 entries and ≤15360 serialized page bytes; whole HTTP wrapper ≤16384. Construct the final next cursor **before measuring**; pop last entries until the page fits and encode offset by actual delivered count. For fresh snapshots never drop an entry without continuation inside the retained set; if one entry plus envelope cannot fit, return `CALENDAR_RESULT_TOO_LARGE`. A stale first page is display-only with `nextPageToken:null`, `complete:false`, `stale` limitation and `truncated:true` if retained entries were omitted; require refresh to browse further rather than issuing a cursor whose freshness deadline already passed. Page `complete` describes source discovery completeness, not the absence of another UI page. Ordinary fresh 20-item pagination alone is not partial provider discovery. Never expose snapshot's Google `nextPageToken`. P5 should delegate list-calendars to this same pager using a trusted service callback, not implement a second cache/cursor format.

Add assertions for 0/1/20/21/100 entries, long multibyte labels/IDs forcing a shorter page with continuation, lower configured page/result limits, exact wrapper cap, no duplicated/skipped entries, complete snapshot with multiple UI pages, wrong-kind/account/revision/negative/noncanonical offset/expired/restart/tampered cursors, and default-only change preserving a still-current cursor. Retention-expired content is never returned, even before P2's sweeper runs.
- [ ] **Run green:** `npm test -- test/plugins/google-calendar/discovery-pages.spec.ts test/plugins/google-calendar/discovery.spec.ts`.
- [ ] **Commit:** `feat(calendar): expose bounded cached calendar pages with scoped cursors`.

## Task 9: Extend the existing controller/module without bypassing P8's local boundary

**Files:** modify `backend/src/plugins/google-calendar/controller.ts`, `module.ts`, existing `backend/test/plugins/google-calendar/setup.spec.ts`; create `backend/test/plugins/google-calendar/setup-multi.spec.ts`.

- [ ] **Write the failing direct-controller assertions** before adding routes. Use the concrete fixture/OAuth service, not HTTP mocks that claim middleware ran:

```ts
import { expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { GoogleCalendarController } from '../../../src/plugins/google-calendar/controller.js';
import { GoogleCalendarOAuthService } from '../../../src/plugins/google-calendar/oauth.js';
import { multiConnectionFixture } from './connection-multi-fixtures.js';

it('serves v2 status and strict cache-only calendars through the existing controller', async () => {
  const f = await multiConnectionFixture();
  const oauth = new GoogleCalendarOAuthService({ connections: f.service, store: f.adapter,
    cipher: f.cipher, options: f.options, client: f.client as never,
    googleIdentity: { verify: vi.fn() }, now: f.now });
  const controller = new GoogleCalendarController(f.service, oauth);
  expect(await controller.status()).toHaveProperty('protocolVersion', 2);
  const req = { url: '/api/plugins/google-calendar/calendars', on: vi.fn() } as unknown as Request;
  expect(await controller.calendars(req)).toHaveProperty('page.calendars');
  expect(f.discover).not.toHaveBeenCalled();
  for (const query of ['pageToken=a&pageToken=b', 'refresh=true', 'userId=forged']) {
    await expect(controller.calendars({ ...req, url: `${req.url}?${query}` } as Request))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  }
});
```

- [ ] **Run red:** `npm test -- test/plugins/google-calendar/setup-multi.spec.ts -t "strict cache-only calendars"`.
- [ ] **Minimum implementation.** Keep the same connection/OAuth injection tokens and module instance factories. Add controller methods, using exact P1 schemas:

```ts
@Get('calendars')
async calendars(@Req() req: Request) {
  const raw = (req.url ?? '').split('?', 2)[1] ?? '';
  if (Buffer.byteLength(raw, 'utf8') > 8192) throw new AppError('INVALID_REQUEST', 'The request is invalid.', false);
  const params = new URLSearchParams(raw);
  const entries = [...params.entries()];
  if (entries.some(([key]) => key !== 'pageToken') || params.getAll('pageToken').length > 1) {
    throw new AppError('INVALID_REQUEST', 'The request is invalid.', false);
  }
  const query = calendarCalendarsQuerySchema.parse(Object.fromEntries(entries));
  return calendarCalendarsResponseSchema.parse(await this.connections.calendars(query));
}

@Post('calendars/refresh')
@HttpCode(200)
async refresh(@Body() body: unknown, @Req() req: Request) {
  const parsed = calendarRefreshRequestSchema.parse(body);
  return calendarCalendarsResponseSchema.parse(await this.connections.refreshCalendars(parsed, abortOf(req)));
}
```

Make the calendars method `async` so schema/query throws are rejected promises in the direct fixture. `status` calls `statusV2`, `settings` validates v2 schema and returns `statusV2` after the same service mutation; retained internal legacy `settings` return signature may remain for current callers. `refreshCalendars` compares expected account revision before provider admission and again before publishing; returns first cached page after confirmed refresh, never full 100-entry snapshot. Partial/failed/volatile refresh uses safe error, not a complete success payload. Strictly malformed percent escapes/UTF-8 must reject before `URLSearchParams` can repair them: scan raw query component escapes with `decodeURIComponent` in a guarded try first, and reject duplicate decoded keys (including `page%54oken`). No extra query fields reach service or Google.

Extend `GoogleCalendarFilter` with a narrow allowlist: `CALENDAR_SETTINGS_CONFLICT`, stale account/cursor → HTTP 409 / public `CONFLICT_ACTIVE_TURN` (generic safe message); missing grant/config/discovery → 503 / `NOT_READY`; invalid/default read-only selector → 400 / `INVALID_REQUEST`; refresh rate-limit → 429 / `RATE_LIMITED`; timeout → 504 / `TIMEOUT`; uncertain persistence → 503 / `PERSISTENCE_ERROR`. Use existing `AppErrorCode` values; do not put provider internals, calendar names, credentials, scopes from untrusted strings, subject, stack or raw failure in error body. Re-consent detail comes only from bounded v2 status `missingScopes`. Preserve no-store/nosniff/no-referrer and suppressed ETag at the actual boundary. Controller-only responses are not security certification.

In the request abort helper do not abort merely on a normal fully received request's `close`; listen to `req.aborted`/the aborted event and keep the response-lifetime cancellation behavior consistent with the existing local flow. Cover this with an actual local request fixture before changing it. Do not mistake ordinary body completion for cancellation of refresh. No new module service instance is needed: `connections` owns/delegates its discovery service, module continues injecting that same instance.

Update **existing** `setup.spec.ts` response parsing to `calendarStatusV2ResponseSchema`, keeping real `configureGoogleCalendarHttp` and every Host/origin/CSRF/no-secret assertion. Its no-target OAuth flow must now reach a valid v2 fixture result (`evidence:'fixture'` still degraded, redirect `oauth=fixture`); do not fix it by claiming a fixture is Google evidence. In new `setup-multi.spec.ts`, also mount `GoogleCalendarModule` in a standalone Nest test app to exercise status, GET pages, PATCH and refresh decorators/JSON results. Label that app explicitly **controller/module fixture without P8 boundary**. Do not change/remove boundary from the existing security fixture.

Add direct/Nest assertions for duplicate/oversized/unknown queries, 20-entry paging and cache-only GET, empty/stale/partial state, default-only PATCH, safe invalid-default rejection, stale expected setting/account revision HTTP 409, POST refresh body strictness, no token/subject/Google raw token leaks, normal request completion not aborting, and actual client abort fencing the refresh result. Existing real-boundary tests must still reject hostile Host/Origin/CSRF before OAuth/storage work. Assembled GET admission is explicitly pending P8, never asserted green using the boundary-free fixture.
- [ ] **Run green:** `npm test -- test/plugins/google-calendar/setup-multi.spec.ts test/plugins/google-calendar/setup.spec.ts test/plugins/google-calendar/oauth.spec.ts`.
- [ ] **Commit:** `feat(calendar): add versioned calendar refresh and preference routes`.

## Task 10: Close lifecycle/security races and migrate all P4-owned red expectations

**Files:** only the preceding P4-owned source/spec/fixture paths, and `backend/test/plugins/google-calendar/oauth-identity.spec.ts` for retained identity regressions if needed. No P5 catalogue or P8 assembly tests are writable here.

- [ ] **Write this final failing account-replacement race assertion** in `connection-multi.spec.ts` before correcting any remaining P4 race:

```ts
it('cannot publish old-account discovery after disconnect and replacement', async () => {
  const f = await multiConnectionFixture({ defaultCalendarId: 'shared-team' });
  const old = (await f.read())!;
  const gate = deferred<NonNullable<typeof old.discovery>>();
  f.discover.mockImplementationOnce(() => gate.promise);
  const refresh = f.service.refreshCalendars({ expectedConnectionRevision: old.connectionRevision },
    new AbortController().signal).catch(e => e);
  await vi.waitFor(() => expect(f.discover).toHaveBeenCalledTimes(1));
  await f.service.disconnect({ mode: 'local' }, new AbortController().signal);
  const snapshot = await f.service.captureSetupSnapshot();
  await f.service.installGrant({ snapshot, grant: { accessToken: 'replacement-access',
    refreshToken: 'replacement-refresh', idToken: 'fixture-id-token', scopes: [...CALENDAR_SCOPES],
    expiresAt: new Date(f.now() + 3600000).toISOString() },
    account: { subject: 'replacement-sub', email: null }, signal: new AbortController().signal,
    deadlineAt: new Date(f.now() + 20000).toISOString(), isCurrentFlow: () => true });
  const replacement = (await f.read())!;
  gate.resolve({ ...old.discovery!, discoveryRevision: old.revision + 1 });
  await refresh;
  expect(await f.read()).toEqual(replacement);
  expect(replacement.googleSubjectId).toBe('replacement-sub');
  expect(replacement.defaultSetting.defaultCalendarId).toBeNull();
  expect(replacement.discovery?.connectionId).toBe(replacement.connectionId);
});
```

- [ ] **Run red:** `npm test -- test/plugins/google-calendar/connection-multi.spec.ts -t "old-account discovery"`. If Task 5 already prevents this race, record it as a passing regression and choose the first genuinely failing P4-owned test from the current full focused run; do not deliberately break correct code to manufacture red.
- [ ] **Minimum implementation only for demonstrated P4 defects.** Keep the same-account check at the single shared publish/CAS seam used by post-connect, expiry and manual refresh:

```ts
const matches = latest.schemaVersion === 2
  && latest.userId === captured.userId && latest.connectionId === captured.connectionId
  && latest.connectionRevision === captured.connectionRevision
  && latest.googleSubjectId === captured.googleSubjectId
  && latest.enabled && latest.status === 'connected';
if (!matches || signal.aborted || capturedEpoch !== this.getLifecycleEpoch()) {
  throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
}
```

Apply it before provider admission, after every asynchronous authorization boundary, before persistence, and before returning success. Do not add one guard per route or rebase old-account work onto a replacement. Never clear a newer service fence because an older callback succeeded.

Run and retain this exact **P4 regression matrix**, using deferred promises/fake clocks, not sleeps or live endpoints:

- Legacy connected v1 parses with actual v1 scopes; status returns scope-upgrade reconnect without a write/network; explicit fixture migration retains pin/encrypted pair/history, then full same-subject re-consent succeeds. Old or partial grants never trigger refresh to widen permissions.
- Missing each literal required scope, missing/non-string scope, forbidden broad scope and alias-only email fail; denial/partial/replay/restart/concurrent callbacks/state expiry remain single-use and browser-bound; nonce/PKCE/issuer/audience/sub checks remain intact. Same-subject re-consent preserves valid override; wrong-subject reconnect fails; explicit disconnect permits replacement and resets preferences.
- Refresh rotation persists both envelopes before use, retains omitted refresh token under new AAD, coalesces 10 callers, obeys budget/deadline/cancel, and preserves concurrent disjoint default/discovery CAS. Old account/token/flow cannot overwrite current credentials or defaults. Partial/complete/no-store/failed discovery semantics remain honest and count all HTTP deliveries.
- Read versus create versus availability matrix includes writerWithoutPrivateAccess, readers/freeBusyReader, unknown/deleted/hidden, actual scope/policy loss, default loss/no fallback and primary absence/rename. Fresh cache alone cannot authorize dispatch. Target identity stays pinned after preference changes.
- Default-only does not toggle enabled/account revision or invalidate operations; combined disable still fences; stale setting/account revision and uncertain saves are errors. Disconnect-before-revoke remains ordered, local disconnect never revokes, close never writes/revokes, stale async work never reconnects anything.
- All existing red P4 files (`connection-refresh.spec.ts`, `connection.spec.ts`, `oauth-http.spec.ts`, `oauth.spec.ts`, `setup.spec.ts`) now execute their intended assertions using valid v2 active fixtures. No new `.skip`, removed negative security assertion, broad `as never` around record validation, or v1-as-v2 cast is used to make green.

Current known full-suite baseline after P2/P3: **13 failing files / 34 tests; 1,622 tests passed, 10 skipped** (state's “199 passed” refers to passed **files**, not tests). These are P4/P5/P8 downstream consumer migrations. P4 closes its own files; record remaining exact P5/P8 failures with owners. New P4 defects block P4. P8's assembly failures are not fixed by editing them here and do not become passing evidence because the focused P4 suite is green.
- [ ] **Run green:** sequentially, `npm test -- test/plugins/google-calendar/connection` then `npm test -- test/plugins/google-calendar/oauth` then `npm test -- test/plugins/google-calendar/options.spec.ts test/plugins/google-calendar/discovery.spec.ts test/plugins/google-calendar/discovery-pages.spec.ts test/plugins/google-calendar/setup.spec.ts test/plugins/google-calendar/setup-multi.spec.ts`. Re-run P2/P3 contract consumers read-only as listed below.
- [ ] **Commit:** `test(calendar): close re-consent discovery and lifecycle security regressions` (stage only actually changed named P4-owned paths).

## Final verification sequence and reporting

No application check is claimed executed by this documentation-only planner. The worker first records exact `git rev-parse HEAD`, `git status --short`, task hashes, `node --version`, `npm --version`. Use supported Node; do not install packages or inspect/print credentials to fix prerequisites. Every command below runs individually and **sequentially**, cwd `backend/`:

1. `npm test -- test/plugins/google-calendar/options.spec.ts test/plugins/google-calendar/connection.spec.ts test/plugins/google-calendar/connection-refresh.spec.ts test/plugins/google-calendar/connection-multi.spec.ts test/plugins/google-calendar/connection-capabilities.spec.ts test/plugins/google-calendar/connection-settings.spec.ts`
2. `npm test -- test/plugins/google-calendar/oauth.spec.ts test/plugins/google-calendar/oauth-http.spec.ts test/plugins/google-calendar/oauth-identity.spec.ts test/plugins/google-calendar/setup.spec.ts test/plugins/google-calendar/setup-multi.spec.ts`
3. `npm test -- test/plugins/google-calendar/discovery.spec.ts test/plugins/google-calendar/discovery-pages.spec.ts`
4. `npm test -- test/persistence/calendar-multi-connections.spec.ts test/persistence/calendar-migration.spec.ts test/contracts/calendar-multi-discovery.spec.ts test/contracts/calendar-multi-wire.spec.ts`
5. `npm test -- test/plugins/google-calendar/calendar-discovery-api.spec.ts test/plugins/google-calendar/calendar-availability-api.spec.ts test/plugins/google-calendar/calendar-api-http.spec.ts`
6. `npm run build`
7. `npm run lint`
8. `npm test`
9. `npm run test:e2e`

Then repository root: `git diff --check`, `git status --short` as separate commands. No frontend/root package command is part of this backend-only P4 unit. Do not race build with bootstrap/e2e tests. Report actual nonzero discovery, red-before-green assertions, passed/failed/skipped counts and remaining source-owner gates. Never call the full package green while P5/P8 failures remain.

Native e2e checks require separately operator-supplied `AURVIN_TEST_MONGODB_URI` and exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, generated isolated databases, replica-set prerequisites and no secret output. Their absence is a **prerequisite skip**, not a pass. Do not provision MongoDB or obtain a fallback URI. Live granular consent, actual returned scope spellings, Workspace/shared ACLs, quotas, actual Calendar API behavior and provider processing approval remain named service/policy gates; no fixture discharges them. The P8 assembled boundary/configuration gate and P9 integrated evidence remain pending.

## Exit-gate and downstream handoff map

| P4 requirement / goal criteria | Tasks and required evidence | Remaining boundary |
| --- | --- | --- |
| No-target options/connect, canonical primary (AC01/04) | 1, 3, 6; new connection no override, canonical `primary:true`, no email/env pin | P7 UI, P8 central config/assembly |
| State/nonce/PKCE/replay/origin and encryption/rotation (AC03/12/13) | 2–4, 9–10; retain existing security checks, v2 fixtures exercise real scenarios | Real-boundary GET admission P8; live OAuth gate |
| Old/partial grants reconnect with safe missing-scope diagnostic (AC03/12) | 1–4, 10; exact scope set, no refresh widening, subject guard, no legacy rewrite | P8 explicit authorized maintenance before legacy re-consent |
| Post-connect/expiry/manual refresh, count/byte/time bounds, complete/partial/CAS/coalescing (AC02/10/13) | 3, 5, 8, 10; real P2 fixture, stale async no resurrection | P3 REST tests remain green; service evidence unrun |
| Separate operation permissions and fresh pinned authority (AC03/08/09) | 4, 6, 10; read/create/availability matrix, no write gate for reads, no default retargeting | P5 event/MCP, P6 preflight/recovery |
| Same-account default preservation/replacement reset and independent revisions (AC04/09) | 3–7, 10; actual P2 transitions, default-only no account/credential bump | P6 unresolved/proposal revalidation |
| GET calendars/POST refresh/PATCH settings strict pages/stale/empty/default-loss/conflict errors (AC02/04/11) | 7–9; schema-exact direct controller/module fixtures, existing boundary security retained | P8 boundary GET/query admission; P7 client/accessibility |

- [ ] All P4-owned focused checks pass with nonzero discovered tests and intended assertion execution; all old P4 failures are migrated rather than waived.
- [ ] Canonical primary/role/scopes and refresh/default/account/token revision rules are demonstrated; account/disable/disconnect fencing remains intact.
- [ ] Settings never accept a forged identity/revision/credential field, silently select primary after an invalid default, or turn a default-only save into an enablement change.
- [ ] API handoff uses exact P1 schemas and clear 409/503/400 meanings; cached GET/status have no network side effect. P8's unmodified middleware limitation is explicitly reported.
- [ ] Package/native/service results, required pending gates, exact commit set and review **skipped** are reported honestly. This unit does not mark the phase complete.

Publish concise service/API handoff, not this plan pasted back: `storeV2` dependency from existing `calendarConnectionsV2`; `currentAccount`, `requireAccountCurrent`, `credentials`/account overload, `capabilityGate`, trusted read-only `refreshAfterUnauthorized` / `rejectUnauthorizedAccount`, `calendars`, `refreshCalendars`, `statusV2`; discovery constructor/method signatures and callback/budget semantics; old execution path fails closed; exact expected setting/account revisions and P1 wire payloads; same-subject reconnect versus disconnect/account replacement; explicit v1 maintenance precondition; P8 central wiring/HTTP query-admission obligations. P5 delegates list-calendars paging to the same service and does not auto-replay create on 401. P6 handles natural-language authority/preflight, not P4.

For each worker commit obtain the orchestrator's shared-index slot, run `git diff --check`, stage only that task's named changed owned paths, inspect `git diff --cached --name-only`, commit the exact task message, and return the slot. Never `git add .`, amend/reset, change branch/worktree, or touch another agent's staged files. This planner's separate commit contains **only** `docs/google-calendar-multi-calendar/plan4.md` with message `docs(google-calendar-multi-calendar): plan P4 - OAuth re-consent, discovery lifecycle, capabilities and settings API`.
