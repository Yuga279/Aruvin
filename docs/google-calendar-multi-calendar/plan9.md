# Google Calendar Multi-calendar P9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish an honest AC01–AC14 acceptance record for the assembled multi-calendar implementation, adding only missing integrated checks and explicitly preserving every unmet native, browser, policy, and live-service gate.

**Architecture:** Reuse the committed AppService composition, source-owner fixtures, production SDK MCP handler/transport, and generated-database native harness. P9 adds read-only assertions and small test adapters inside its reserved integration paths, not a second runtime, provider, migration command, approval service, or browser runner. Deterministic fixtures, actual browser observations, native persistence, documentation support, and authorized live-service observations remain separate evidence classes.

**Tech Stack:** Existing TypeScript/ESM/NodeNext, NestJS testing/Supertest, Vitest, native fetch fixtures, MongoDB native test harness, LangGraph, pinned MCP SDK client/server 2.3.1 and wire `2026-07-28`, React server rendering and the existing Vite development browser fixture; Markdown evidence; no dependency changes.

---

## Preconditions, authority, and inspected behavior

- Read [goal.md](goal.md), [state.md](state.md), the P8 planner handoff in state, and the **completed P8 worker's** reported commit/interface/verification handoff. Planning is authorized now; P9 implementation requires both this committed plan and P8 implementation completion. A committed P8 plan alone does not satisfy that dependency.
- Use the available `executing-plans` and `test-driven-development` skills. The header preserves the writing-plans template; it does not require installing `superpowers:` aliases. Unified review is **skipped, not passed**. No reviewer or review-triggered fixer is dispatched.
- Planner inspected `7960bdb20cf81da92f863d414d832640f8ac3e52`, `codex/google-calendar-plugin`, initially clean, on 25 October 2026. Environment: Windows x64, Node `v24.19.0`, npm `11.17.0`; both test invocations actually reported Vitest `4.1.11`. Do not infer installed versions solely from manifest ranges. Native URI was absent and exact native prefix was not supplied; only those booleans were inspected, not credentials.
- Planner independently executed, sequentially:
  - In `backend/`: `npm test -- test/plugins/mcp/calendar-server.spec.ts test/plugins/google-calendar/calendar-discovery-api.spec.ts test/plugins/google-calendar/calendar-availability-api.spec.ts test/runtime/calendar-preflight.spec.ts test/plugins/integration/assembled-http.spec.ts` → exit 0, **5 files / 51 tests passed**, no skips reported. The backend emitted the existing `vite-tsconfig-paths` deprecation notice.
  - In `frontend/`: `npm test -- src/features/plugins/google-calendar/calendar-defaults.test.ts src/features/plugins/google-calendar/calendar-turn-region.test.ts src/api/calendar-client.test.ts` → exit 0, **3 files / 20 tests passed**, no skips reported, Node environment.
- These limited planner checks are not the P9 final run, not package-wide results, and not browser/native/live evidence. No package build/lint/full suite, browser session, database action, OAuth, Google/model service call, package installation, provisioning, paid check, or deployment was performed by the planner. The old 34 downstream failures and P8 planner's 12/49 baseline are not current P9 results.
- P8's named findings are **owner gates**, not presumed resolved: `P8-GATE-P4-CALENDAR-GET`, `P8-GATE-P6-REQUEST-ACCOUNTING`, `P8-GATE-P2-INVALIDATION`, and `P8-GATE-MIGRATION-ENTRYPOINT`. Check their actual dispositions in P8's handoff. Reproduce an observed failure, record its exact command/assertion/commit, and return it to P4/P6/P2/P8 as appropriate. Do not patch another owner's files or weaken the assertion.
- An especially important fixture limitation exists in current source: `calendarFixture()` installs a prototype spy replacing `CalendarTurnLedger.chargeCalendarRequest`. P9's assembled adapter must restore that spy **before** measuring production accounting. Its fixture gate also emits non-network notifications; it is not proof that real P4 discovery deliveries were counted. Use the assembled production gate plus independently observed HTTP deliveries for that assertion.
- Existing `calendar-browser.tsx` is a development-only, intercepted-fetch browser fixture. Source includes a `defaultCalendarId`/`calendarId` request-body inconsistency, a declared-but-unused 409 switch, and no executed Phase 2 browser record. These are inspection concerns, not executed failures. Run the actual fixture and return any fixture/source defect to P7; do not claim its source covers missing browser scenarios or repair it in P9.
- New backend code uses `.js` local imports; frontend follows `.ts`/`.tsx` imports. Every new code file gets the full repository FILE/LOCATION/PURPOSE/ROLE/KEY COMPONENTS header, included below. Do not add banner comments to Markdown.
- Each code block below is complete for its named file or an explicitly named insertion. Characterization tests may be GREEN immediately. Record that honestly; never break working code to manufacture RED. RED is a meaningful assertion failure, not missing imports, syntax errors, empty discovery, or absent external prerequisites. With P9 owning no production code, a behavior RED goes to the source owner; P9 implements only its test adapter/evidence correction and reruns after the owner commit.
- Commits below are **future worker** instructions. Obtain the orchestrator's serialized commit slot first and stage only the named task paths. The planner does not stage/commit. Never edit this plan during execution, goal/state, P8 operations, Phase 1 evidence, manifests/locks, or source-owner tests. No `git add .`.

## Exact P9 write map

All paths are new. Existing helpers named later are read-only imports/verification inputs.

| Path | Responsibility |
| --- | --- |
| `backend/test/integration/plugins/multi-calendar/assembled.ts` | Small Nest HTTP adapter over P8's single shared-store assembly; production ledger restored; bounded SSE collection. |
| `backend/test/integration/plugins/multi-calendar/acceptance.spec.ts` | Cached discovery/security/default CAS, no-target boot, natural-language precedence, denial without fallback. |
| `backend/test/integration/plugins/multi-calendar/authority.spec.ts` | Durable selection/conflict replies, unchanged/changed coverage, same-session competing tabs, cross-session reference denial. |
| `backend/test/integration/plugins/multi-calendar/accounting-recovery.spec.ts` | Real assembled delivery accounting, bounded repair, grouped context, default changes during dispatch, pinned unknown-effect readback. |
| `backend/test/plugins/integration/multi-calendar/sdk.ts` | Actual pinned SDK client/StreamableHTTP transport to production handler; deterministic teardown. |
| `backend/test/plugins/integration/multi-calendar/catalogue.spec.ts` | Five-tool schema parity, event selectors, roles, forged authority and schema tampering. |
| `backend/test/plugins/integration/multi-calendar/provider-coverage.spec.ts` | Actual SDK → real free/busy adapter → scripted Google batching, HTTP-200 errors, DST/all-day intervals and limits. |
| `backend/test/integration/plugins/multi-calendar/native-recovery.native.e2e-spec.ts` | Conditional generated-native-database recovery/default/budget assertions; never a live Google test. |
| `frontend/src/features/plugins/integration-tests/multi-calendar-settings.test.ts` | Actual frontend client → parsed protocol → setup reducer → native-control SSR, failed-save rollback. |
| `frontend/src/features/plugins/integration-tests/multi-calendar-chat.test.ts` | Parsed v3 clarification/receipt → chat reducer → safe, expiry-aware render; Node, not browser. |
| `backend/test/integration/plugins/multi-calendar/evidence.spec.ts` | AC/gate/document-link consistency, not a substitute for behavior evidence. |
| `docs/google-calendar-multi-calendar/verification.md` | Actual commit/environment/command/result ledger and AC01–AC14 mapping. |
| `docs/google-calendar-multi-calendar/staging-evidence.md` | Separately classified browser/native/policy/live drills, exact authorization and limitations. |
| `docs/google-calendar-multi-calendar/final_report.md` | Verified subset, defects, pending gates and truthful completion disposition. |

Do not create files outside these paths. In particular, no `operations.md`, source edits, new migration executable, browser HTML/TSX runner, fixture edits under other prefixes, or Phase 1 evidence updates are authorized.

## Acceptance/evidence map

The new tests supplement, rather than copy, existing owner suites. Task 9 reruns those suites on the final commit set; merely linking their source is not passing evidence.

| AC | New P9 check / task | Existing checks rerun and non-fixture gate |
| --- | --- | --- |
| AC01 | Task 1 no-target configured boot, Task 2 cached/local-security routes, Task 7 no-ID Connect rendering | P4 setup/OAuth, P8 config/default-off/passive health; actual incremental/partial consent remains `P9-LIVE-CONSENT`. |
| AC02 | Task 2 HTTP count-bounded pagination and truthfulness; Task 5 SDK result bound | P3 discovery and P4 discovery/pages suites: token on short page, missing primary in truncated data, duplicates/conflicting roles, hidden/deleted/unknown role, masked writer, 100/101 entries, 2/10 deliveries, UTF-8 bytes, expiry, failed/coalesced/racing refresh. |
| AC03 | Task 5 shared writer/masked writer versus reader/freeBusyReader through SDK | P4 partial/old grants and encryption/rotation/OAuth protections; live ACL matrix `P9-LIVE-ACL`. |
| AC04 | Tasks 2–3 explicit/default/primary, no fallback, HTTP independent revision/reset | P2 default persistence/reconnect; Task 6 native restart; Task 8 actual picker flow. |
| AC05 | Tasks 2–3 ordinary scheduling, normalized names, duplicate-name choice reply | P6 targeting/intent/authority for unknown/fuzzy/incomplete details; Task 8 human reply/focus. No JSON echo is added. |
| AC06 | Task 5 100 calendars in 2×50 batches, errors inside 200, 23/25-hour opaque all-day blocks, interval/byte limits | P3 availability timezone/half-open/transparent-event semantics. Fixtures model Google's supplied busy projection, not Google's live event classification; `P9-LIVE-BUSY`. |
| AC07 | Task 3 zero create before disclosure acceptance, unchanged acceptance and material-change renewal, reference/session/race checks | P6 preflight/authority/concurrency for expiry, replay, supersession, edited event/time/target, account and rights changes; live conflict drill `P9-LIVE-BUSY`. |
| AC08 | Task 5 actual SDK schema equality/all five calls/selector denial/output validation; Task 4 repair tests in assembled app | P5 MCP bounds/client/model/repair suites: malformed calls, tampered envelopes/catalogue/cursors, repair exhaustion, no model-supplied proof. |
| AC09 | Task 4 default switch at POST plus receipt-failure readback, Task 6 native pinned identity | P6 crash/recovery/lifecycle/publication suites for account replacement, all dispatch windows, retry and successful receipt despite narration failure; live safe-retry `P9-LIVE-RETRY`. |
| AC10 | Task 4 observed HTTP versus persisted budget, repair/dispatch counts, attribution and grouped context | P2 accounting/reporting/retention and P6 budget/graph/context/concurrency, native lost-debit acknowledgement. No private reasoning payloads. |
| AC11 | Task 7 Node client/reducer/SSR, Task 8 actual browser/keyboard/assistive-technology observations | P7 protocol/client/setup/default/turn/chat suites; Node SSR does not certify focus, browser navigation or screen-reader announcements. |
| AC12 | Task 1 one assembly/store/runtime and Task 6 native default persistence | P2 migration/rollback/checkpoints; P8 config/assets/text plus unchanged voice/canvas suites via package run. Explicit fixture migration is not application-data migration. |
| AC13 | Task 2 Host/Origin/CSRF/no-store, Task 4 content/attribution assertions | P8 policy/readiness/shutdown/telemetry/assets/docs and P2 retention; `P8-GATE-P2-INVALIDATION`, backup/restore/policy and migration-entrypoint dispositions stay explicit. |
| AC14 | Tasks 6, 8–10 exact SHA/environment/results, named pending gates, skipped review | Live owned/shared create/readback/retry and policy acceptance are separately authorized prerequisites. Required pending gates prevent whole-workflow completion. |

## Task 1: Add the smallest truthful assembled adapter

**Files:** Create `backend/test/integration/plugins/multi-calendar/assembled.ts` and `backend/test/integration/plugins/multi-calendar/acceptance.spec.ts`.

- [ ] **Step 1 (2–5 minutes): Write this first characterization in `acceptance.spec.ts`.** It deliberately verifies P8's fixture promises instead of duplicating its implementation.

```typescript
/**
 * ============================================================================
 * FILE: acceptance.spec.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/acceptance.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify multi-calendar acceptance through the assembled local HTTP boundary.
 * ROLE IN PROJECT:
 *    Reuses P8 assembly and scripted external responses without another owner.
 *    Checks settings and effects without claiming live Google acceptance.
 * KEY COMPONENTS:
 *    - Assembly truth: No target configuration and one shared composition.
 *    - Acceptance: Cached routes, target precedence and permission denials.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { openApp } from './assembled.js';

it('boots without a configured target over one shared assembly', async () => {
  const h = await openApp();
  try {
    expect(h.bootstrap.calendar?.setup.oauth?.targetCalendarId).toBeUndefined();
    expect(h.f.ports.open).toHaveBeenCalledTimes(1);
    expect(h.f.ports.runtime).toHaveBeenCalledTimes(1);
    const saved = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
    const status = await h.plugin('get', 'status');
    expect(status.status).toBe(200);
    expect(status.body.connectionRevision).toBe(saved?.connectionRevision);
    expect(status.body.primaryCalendarId).toBe('owned');
    const before = h.fetcher.mock.calls.length;
    await h.plugin('get', 'status');
    await h.service.operations.readiness.read();
    expect(h.fetcher.mock.calls.length).toBe(before);
  } finally { await h.dispose(); }
});
```

- [ ] **Step 2 (2 minutes): Read P8's actual helper export and run the check.** In `backend/`:

```powershell
npm test -- test/integration/plugins/multi-calendar/acceptance.spec.ts -t "boots without"
```

The absent P9 adapter is initially an infrastructure failure, **not behavioral RED**. Record it as such. P8 must already have supplied the shared-store/no-target/spyable-port helper documented in its plan; if its final interface differs, adapt this P9 file to that actual interface without editing P8 fixtures. A missing P8 promise blocks this task and returns to P8.

- [ ] **Step 3 (2–5 minutes): Create the complete `assembled.ts` adapter.** It closes even on failed boot, restores only the known ledger spy, uses loopback with bounded stream timeout, and does not start a backend against `.env`.

```typescript
/**
 * ============================================================================
 * FILE: assembled.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/assembled.ts
 * ============================================================================
 * PURPOSE:
 *    Adapt P8's single Calendar assembly to bounded local integration requests.
 * ROLE IN PROJECT:
 *    Installs production Nest middleware and retains the same AppService/store.
 *    External HTTP remains P8's injected scripted fetch, never global fetch.
 * KEY COMPONENTS:
 *    - openApp: HTTP boot, submission, SSE collection and deterministic disposal.
 *    - Ledger restoration: Measure production accounting, not fixture replacement.
 * ============================================================================
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect, vi } from 'vitest';
import { AppModule } from '../../../../src/app.module.js';
import { AppService } from '../../../../src/app.service.js';
import { configureApplication } from '../../../../src/main.js';
import { AURVIN_CONFIG } from '../../../../src/platform/tokens.js';
import { CalendarTurnLedger } from '../../../../src/chat-runtime/calendar-budget.js';
import { submitTurnResponseSchema, type SubmitTurnResponse } from '../../../../src/contracts/api.js';
import type { CalendarReplyReference } from '../../../../src/contracts/calendar-authority.js';
import { calendarCompatibleEnvelopeSchema } from '../../../../src/contracts/calendar-wire.js';
import { assembledCalendarApp } from '../../../assembly/calendar-fixture.js';

const origin = 'http://127.0.0.1:5173';
const host = '127.0.0.1:3000';

export async function openApp() {
  const h = await assembledCalendarApp();
  const ledger = CalendarTurnLedger.prototype.chargeCalendarRequest;
  if (vi.isMockFunction(ledger)) ledger.mockRestore();
  expect(vi.isMockFunction(CalendarTurnLedger.prototype.chargeCalendarRequest)).toBe(false);
  let app: NestExpressApplication | undefined;
  let serial = 0;
  const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
  try {
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_ORIGIN = origin;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(h.bootstrap)
      .overrideProvider(AppService).useValue(h.service).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    try { await app?.close(); } finally { await h.dispose(); }
    throw error;
  } finally {
    for (const key of ['NODE_ENV', 'FRONTEND_ORIGIN'] as const) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  const running = app;
  const address = running.getHttpServer().address();
  if (!address || typeof address === 'string') {
    try { await running.close(); } finally { await h.dispose(); }
    throw new Error('Expected a loopback fixture port.');
  }
  function accept(content: string, sessionId: string | null = null,
    key = `multi-calendar-${++serial}`, calendarReplyTo?: CalendarReplyReference) {
    return request(running.getHttpServer()).post('/api/sessions')
      .set('Host', host).set('Origin', origin).send({ sessionId, content,
        idempotencyKey: key, calendarProtocol: 3,
        ...(calendarReplyTo ? { calendarReplyTo } : {}) });
  }
  async function submit(content: string, sessionId: string | null = null,
    calendarReplyTo?: CalendarReplyReference): Promise<SubmitTurnResponse> {
    const response = await accept(content, sessionId, undefined, calendarReplyTo);
    expect(response.status).toBe(202);
    return submitTurnResponseSchema.parse(response.body);
  }
  return {
    ...h, app: running, accept, submit,
    plugin(method: 'get' | 'post' | 'patch', path: string, body?: object) {
      const call = request(running.getHttpServer())[method](`/api/plugins/google-calendar/${path}`)
        .set('Host', host).set('Origin', origin);
      return method === 'get' ? call : call.set('X-Aurvin-Calendar-CSRF', '1').send(body ?? {});
    },
    async stream(ids: SubmitTurnResponse) {
      const path = ids.streamPath.startsWith('/api/') ? ids.streamPath : `/api${ids.streamPath}`;
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        headers: { Host: host, Origin: origin, Accept: 'text/event-stream' },
        signal: AbortSignal.timeout(20000),
      });
      expect(response.status).toBe(200);
      const frames = (await response.text()).split('\n').filter(line => line.startsWith('data:'))
        .map(line => calendarCompatibleEnvelopeSchema.parse(JSON.parse(line.slice(5).trim())));
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.map(frame => frame.sequence)).toEqual(frames.map((_, index) => index));
      return frames;
    },
    async dispose() {
      try { await running.close(); } finally { await h.dispose(); }
    },
  };
}
```

- [ ] **Step 4 (2 minutes): Rerun Step 2.** Expected GREEN after P8; any failed shared-store/boot assertion is a P8 dependency defect, not a reason to seed another connection or change primary expectations arbitrarily. Keep the backend suite timeout at least 20 seconds for HTTP scenarios, using the existing `it(..., 20000)` third argument when necessary.
- [ ] **Step 5 (2 minutes): Commit in the assigned slot.** From root:

```powershell
git add backend/test/integration/plugins/multi-calendar/assembled.ts backend/test/integration/plugins/multi-calendar/acceptance.spec.ts
git commit -m "test(calendar): add truthful multi-calendar assembly adapter"
```

## Task 2: Exercise cached routes, preference CAS and conversational precedence

**File:** Append to `backend/test/integration/plugins/multi-calendar/acceptance.spec.ts`.

- [ ] **Step 1 (2–5 minutes): Add these imports and HTTP assertions.** They do not bypass plugin middleware or mutate source fixtures.

```typescript
import request from 'supertest';
import { createWire, textWire } from '../../../runtime/calendar-runtime.fixture.js';
import { event } from '../../../runtime/calendar-multi-fixture.js';

it('pages cached discovery and saves or resets only the default without restart', async () => {
  const h = await openApp();
  try {
    const raw = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
    if (!raw || raw.schemaVersion !== 2 || !raw.discovery) throw new Error('Missing v2 fixture account.');
    await h.cal.setDiscovery({ entries: Array.from({ length: 21 }, (_, i) => ({
      ...raw.discovery!.entries[0], calendarId: i === 0 ? 'owned' : `shared-${i}`,
      label: `Calendar ${i}`, primary: i === 0,
    })) });
    h.fetcher.mockClear();
    const first = await h.plugin('get', 'calendars');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toContain('no-store');
    expect(first.body.page.calendars).toHaveLength(20);
    expect(typeof first.body.page.nextPageToken).toBe('string');
    const next = await h.plugin('get', `calendars?pageToken=${encodeURIComponent(first.body.page.nextPageToken)}`);
    expect(next.status).toBe(200);
    expect(next.body.page.calendars).toHaveLength(1);
    expect(next.body.page.nextPageToken).toBeNull();
    expect(h.fetcher).not.toHaveBeenCalled();
    const status = await h.plugin('get', 'status');
    const setting = { calendarId: 'shared-1', expectedRevision: status.body.defaultSetting.defaultSettingRevision,
      expectedConnectionRevision: status.body.connectionRevision };
    const saved = await h.plugin('patch', 'settings', { defaultSetting: setting });
    expect(saved.status).toBe(200);
    expect(saved.body.enabled).toBe(status.body.enabled);
    expect(saved.body.connectionRevision).toBe(status.body.connectionRevision);
    expect(saved.body.defaultSetting).toEqual({ defaultCalendarId: 'shared-1',
      defaultSettingRevision: setting.expectedRevision + 1 });
    expect((await h.plugin('patch', 'settings', { defaultSetting: setting })).status).toBe(409);
    const reset = await h.plugin('patch', 'settings', { defaultSetting: { ...setting,
      calendarId: null, expectedRevision: saved.body.defaultSetting.defaultSettingRevision } });
    expect(reset.status).toBe(200);
    expect(reset.body.defaultSetting.defaultCalendarId).toBeNull();
    expect(h.f.ports.open).toHaveBeenCalledTimes(1);
    expect(h.f.ports.runtime).toHaveBeenCalledTimes(1);
  } finally { await h.dispose(); }
}, 20000);

it('rejects hostile Host Origin CSRF and unknown cached-route query fields', async () => {
  const h = await openApp();
  try {
    h.fetcher.mockClear();
    expect((await request(h.app.getHttpServer()).get('/api/plugins/google-calendar/calendars')
      .set('Host', 'hostile.example').set('Origin', 'http://127.0.0.1:5173')).status).toBe(403);
    expect((await request(h.app.getHttpServer()).post('/api/plugins/google-calendar/calendars/refresh')
      .set('Host', '127.0.0.1:3000').set('Origin', 'https://hostile.example')
      .set('X-Aurvin-Calendar-CSRF', '1').send({ expectedConnectionRevision: 1 })).status).toBe(403);
    expect((await request(h.app.getHttpServer()).patch('/api/plugins/google-calendar/settings')
      .set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:5173')
      .send({ enabled: false })).status).toBe(403);
    expect((await h.plugin('get', 'calendars?userId=forged')).status).toBe(400);
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.dispose(); }
}, 20000);
```

- [ ] **Step 2 (2 minutes): Run the two tests before any owner correction.** In `backend/`:

```powershell
npm test -- test/integration/plugins/multi-calendar/acceptance.spec.ts -t "cached|hostile"
```

Expected: GREEN only after the P4 cached-GET boundary amendment and P8 integration. If GET still returns 400, record `P8-GATE-P4-CALENDAR-GET` RED with the exact response status; do not mount an alternate route or strip its query in the helper. A default write may legitimately perform bounded fresh provider checks; only cached GET/status/readiness are asserted network-free.

- [ ] **Step 3 (2–5 minutes): Add these table-driven natural-language checks.** Tests omit a model `calendarId` intentionally: the accepted user's request/default/primary, not a model-provided proof, controls resolution.

```typescript
it.each([
  [null, '', 'owned'],
  ['team@example.test', '', 'team@example.test'],
  ['owned', ' in my   work   calendar', 'team@example.test'],
] as const)('resolves default %s and wording %s to %s without JSON echo', async (saved, suffix, calendarId) => {
  const h = await openApp();
  try {
    await h.cal.setDefault(saved);
    h.cal.modelWires.push(createWire(event()), textWire('Created.'));
    const ids = await h.submit(`Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC${suffix}.`);
    const frames = await h.stream(ids);
    expect(await h.cal.operationFor(ids)).toMatchObject({ state: 'succeeded', calendarId });
    expect(frames.some(frame => frame.event.type === 'calendar-clarification')).toBe(false);
    const posts = h.fetcher.mock.calls.filter(([url, init]) => String(url).includes('/events') && init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(decodeURIComponent(new URL(String(posts[0][0])).pathname)).toBe(`/calendar/v3/calendars/${calendarId}/events`);
    expect(h.cal.modelBodies).toHaveLength(2);
  } finally { await h.dispose(); }
}, 20000);

it.each(['unknown-explicit', 'lost-default', 'reader', 'freeBusyReader'] as const)
('never substitutes primary for %s', async condition => {
  const h = await openApp();
  try {
    let suffix = ' in my Work calendar';
    if (condition === 'unknown-explicit') suffix = ' in my Missing calendar';
    else if (condition === 'lost-default') {
      suffix = '';
      await h.cal.setDefault('missing-calendar');
    } else await h.cal.setRole('team@example.test', condition);
    h.cal.modelWires.push(createWire(event()));
    const ids = await h.submit(`Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC${suffix}.`);
    await h.stream(ids);
    expect(await h.cal.operationFor(ids)).toBeNull();
    expect(h.fetcher.mock.calls.filter(([url, init]) => String(url).includes('/events') && init?.method === 'POST'))
      .toHaveLength(0);
  } finally { await h.dispose(); }
}, 20000);
```

- [ ] **Step 4 (2 minutes): Run all Task 1–2 cases.** In `backend/`: `npm test -- test/integration/plugins/multi-calendar/acceptance.spec.ts`. Expected all discovered tests GREEN; return target/capability/clarification failures to P4/P6, not P9 source edits.
- [ ] **Step 5 (2 minutes): Commit.** From root:

```powershell
git add backend/test/integration/plugins/multi-calendar/acceptance.spec.ts
git commit -m "test(calendar): verify assembled discovery defaults and targeting"
```

## Task 3: Prove durable proposals across turns and competing tabs

**File:** Create `backend/test/integration/plugins/multi-calendar/authority.spec.ts`.

- [ ] **Step 1 (2–5 minutes): Write the file through its first test, run it, then add one remaining case per 2–5 minute step.** The complete final file is below. The shared helper only submits the already accepted intent; it does not mint proposal authority.

```typescript
/**
 * ============================================================================
 * FILE: authority.spec.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/authority.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify durable multi-calendar selection and condition acceptance over HTTP.
 * ROLE IN PROJECT:
 *    Runs real runtime/MCP logic against scripted Google/model responses.
 *    Confirms that browser references and competing tabs grant no extra authority.
 * KEY COMPONENTS:
 *    - Disclosure: Zero effect before a durable current proposal is answered.
 *    - Recheck: Material condition changes require renewed acceptance.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { submitTurnResponseSchema } from '../../../../src/contracts/api.js';
import { createWire, textWire } from '../../../runtime/calendar-runtime.fixture.js';
import { event } from '../../../runtime/calendar-multi-fixture.js';
import { openApp } from './assembled.js';

const content = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.';
const busy = [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }];
type App = Awaited<ReturnType<typeof openApp>>;
const posts = (h: App) => h.fetcher.mock.calls.filter(([url, init]) =>
  String(url).includes('/events') && init?.method === 'POST');
async function disclose(h: App) {
  h.cal.modelWires.push(createWire(event()));
  const ids = await h.submit(content);
  await h.stream(ids);
  const proposal = await h.cal.currentProposal(ids.sessionId);
  if (!proposal) throw new Error('Expected a durable proposal.');
  expect(posts(h)).toHaveLength(0);
  expect(proposal.originatingAcceptedMessageId).toBe(ids.userMessageId);
  expect(Date.parse(proposal.expiresAt) - Date.parse(proposal.createdAt)).toBeLessThanOrEqual(600000);
  return { ids, proposal, reference: { proposalId: proposal.proposalId, revision: proposal.revision } };
}

it('accepts a natural choice once without exposing internal JSON or IDs to the user', async () => {
  const h = await openApp();
  try {
    await h.cal.setDiscovery({ duplicateWorkNames: true });
    const first = await disclose(h);
    expect(first.proposal.purpose).toBe('selection');
    h.cal.modelWires.push(textWire('Created on the selected calendar.'));
    const reply = await h.submit('Use the second one', first.ids.sessionId, first.reference);
    await h.stream(reply);
    expect(await h.cal.operationFor(reply)).toMatchObject({ state: 'succeeded',
      intentId: first.proposal.intentId, originatingAcceptedMessageId: first.ids.userMessageId,
      authorization: { acceptedUserMessageId: reply.userMessageId, basis: 'proposal-selection' } });
    expect(posts(h)).toHaveLength(1);
  } finally { await h.dispose(); }
}, 20000);

it.each(['conflict', 'coverage'] as const)('accepts unchanged disclosed %s but never before a reply', async mode => {
  const h = await openApp();
  try {
    h.cal.setAvailability(mode === 'conflict' ? { busy }
      : { calendarErrors: { 'read@example.test': 'notFound' } });
    const first = await disclose(h);
    expect(first.proposal.conditionFingerprint).toBeTruthy();
    h.cal.modelWires.push(textWire('Created with your acceptance.'));
    const reply = await h.submit('Yes, go ahead', first.ids.sessionId, first.reference);
    const frames = await h.stream(reply);
    expect(await h.cal.operationFor(reply)).toMatchObject({ state: 'succeeded',
      authorization: { basis: 'conflict-acceptance', conditionFingerprint: first.proposal.conditionFingerprint } });
    expect(posts(h)).toHaveLength(1);
    expect(frames.some(frame => frame.event.type === 'calendar-clarification')).toBe(false);
  } finally { await h.dispose(); }
}, 20000);

it('renews acceptance when fresh coverage changes instead of replaying the old yes', async () => {
  const h = await openApp();
  try {
    h.cal.setAvailability({ busy });
    const first = await disclose(h);
    h.cal.setAvailability({ busy, calendarErrors: { 'read@example.test': 'notFound' } });
    const reply = await h.submit('Go ahead', first.ids.sessionId, first.reference);
    const frames = await h.stream(reply);
    expect(posts(h)).toHaveLength(0);
    expect(frames.some(frame => frame.event.type === 'calendar-clarification')).toBe(true);
    const next = await h.cal.currentProposal(reply.sessionId);
    expect(next?.conditionFingerprint).toBeTruthy();
    expect(next?.conditionFingerprint).not.toBe(first.proposal.conditionFingerprint);
  } finally { await h.dispose(); }
}, 20000);

it('admits one competing same-session reply and does not consume a cross-session reference', async () => {
  const h = await openApp();
  try {
    h.cal.setAvailability({ busy });
    const first = await disclose(h);
    const foreign = await h.submit('Go ahead', null, first.reference);
    await h.stream(foreign);
    expect(posts(h)).toHaveLength(0);
    expect(await h.cal.p.calendarProposals.getAuthority('aurvin-dev-user', first.ids.sessionId,
      first.proposal.proposalId)).toMatchObject({ state: 'pending' });
    const replies = await Promise.all([
      h.accept('Yes', first.ids.sessionId, 'multi-tab-one', first.reference),
      h.accept('Go ahead', first.ids.sessionId, 'multi-tab-two', first.reference),
    ]);
    expect(replies.map(reply => reply.status).sort()).toEqual([202, 409]);
    h.cal.modelWires.push(textWire('Created once.'));
    await h.stream(submitTurnResponseSchema.parse(replies.find(reply => reply.status === 202)!.body));
    expect(posts(h)).toHaveLength(1);
    expect(await h.cal.p.calendarProposals.getAuthority('aurvin-dev-user', first.ids.sessionId,
      first.proposal.proposalId)).toMatchObject({ state: 'consumed' });
    const replay = await h.submit('Go ahead', first.ids.sessionId, first.reference);
    await h.stream(replay);
    expect(posts(h)).toHaveLength(1);
  } finally { await h.dispose(); }
}, 20000);
```

- [ ] **Step 2 (2 minutes per case): Run the focused new assertion before proceeding.** In `backend/`:

```powershell
npm test -- test/integration/plugins/multi-calendar/authority.spec.ts -t "natural choice"
npm test -- test/integration/plugins/multi-calendar/authority.spec.ts -t "unchanged"
npm test -- test/integration/plugins/multi-calendar/authority.spec.ts -t "fresh coverage"
npm test -- test/integration/plugins/multi-calendar/authority.spec.ts -t "competing"
```

Execute one command at a time. Expected behavior: only the admitted unchanged reply creates; changed coverage, foreign reference, and replay cannot create. An unexpected model dispatch during a stale reply is not fixed by adding a fake approval/model response. Capture the failing expectation and return it to P6. Run the owner authority/concurrency suites below as well: these new HTTP cases do not replace expiry, supersession, material event edits, account replacement or lost-ack tests.
- [ ] **Step 3 (2 minutes): Run the complete file and the owner authority regressions.** In `backend/`:

```powershell
npm test -- test/integration/plugins/multi-calendar/authority.spec.ts test/runtime/calendar-authority.spec.ts test/runtime/calendar-multi-concurrency.spec.ts test/runtime/calendar-intent.spec.ts
```

- [ ] **Step 4 (2 minutes): Commit.** From root:

```powershell
git add backend/test/integration/plugins/multi-calendar/authority.spec.ts
git commit -m "test(calendar): exercise durable multi-turn approvals over HTTP"
```

## Task 4: Keep assembled accounting and recovery independent of fixture shortcuts

**File:** Create `backend/test/integration/plugins/multi-calendar/accounting-recovery.spec.ts`.

- [ ] **Step 1 (2–5 minutes): Write the first test below, run it, then add the remaining tests one at a time.** In-memory failure injection is applied to the shared operation store, not a replacement production writer. The final file is:

```typescript
/**
 * ============================================================================
 * FILE: accounting-recovery.spec.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/accounting-recovery.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Compare real assembled deliveries with durable budgets and pinned effects.
 * ROLE IN PROJECT:
 *    Measures the production ledger and real connection/MCP paths over fixtures.
 *    Distinguishes unknown effects from permission to repeat inference or writes.
 * KEY COMPONENTS:
 *    - Accounting: Independent fetch counts, dispatch attribution and grouping.
 *    - Recovery: Original calendar/event identity after preference changes.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { EmbeddedCalendarExecution } from '../../../../src/plugins/mcp/calendar-client.js';
import { createWire, malformedCreateWire, textWire } from '../../../runtime/calendar-runtime.fixture.js';
import { event } from '../../../runtime/calendar-multi-fixture.js';
import { openApp } from './assembled.js';

const content = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.';
type App = Awaited<ReturnType<typeof openApp>>;
const calendarCalls = (h: App) => h.fetcher.mock.calls.filter(([url]) =>
  new URL(String(url)).origin === 'https://www.googleapis.com'
    && new URL(String(url)).pathname.startsWith('/calendar/v3/'));

it('counts every actual discovery capability preflight and create delivery exactly once', async () => {
  const h = await openApp();
  const invoke = vi.spyOn(EmbeddedCalendarExecution.prototype, 'invoke');
  try {
    h.fetcher.mockClear();
    h.cal.modelWires.push(malformedCreateWire(), createWire(event()), textWire('Created.'));
    const ids = await h.submit(content);
    await h.stream(ids);
    const budget = await h.cal.p.calendarAccountingV2.getBudget('aurvin-dev-user', ids.sessionId, ids.turnId);
    expect(budget).toMatchObject({ modelDispatches: 3, repairs: 1, logicalTools: 1, creates: 1 });
    expect(calendarCalls(h).length).toBeGreaterThan(1);
    expect(budget?.calendarRequests).toBe(calendarCalls(h).length);
    expect(budget!.calendarRequests).toBeLessThanOrEqual(20);
    expect(budget!.refreshRequests).toBeLessThanOrEqual(2);
    const dispatches = await h.cal.p.calendarAccountingV2.listDispatches('aurvin-dev-user', ids.turnId);
    expect(dispatches).toHaveLength(3);
    expect(new Set(dispatches.map(row => row.dispatchId)).size).toBe(3);
    expect(dispatches.every(row => row.openRouterUser === 'aurvin-dev-user'
      && row.schemaRevision === 'google-calendar.v2' && row.pricing.modelId.length > 0)).toBe(true);
    expect(h.cal.modelBodies.every(body => body.user === 'aurvin-dev-user')).toBe(true);
    expect(invoke).toHaveBeenCalled();
    const messages = h.cal.modelBodies.at(-1)!.messages as Array<{
      role: string; content?: string; tool_call_id?: string; tool_calls?: Array<{ id: string }>;
    }>;
    expect(messages.filter(message => message.role === 'user' && message.content === content)).toHaveLength(1);
    const calls = messages.flatMap(message => message.tool_calls ?? []).map(call => call.id);
    const results = messages.filter(message => message.role === 'tool').map(message => message.tool_call_id);
    expect(calls.length).toBeGreaterThan(0);
    expect(results).toEqual(calls);
    expect(JSON.stringify(h.cal.modelBodies)).not.toMatch(/fixture-access-token|refresh_token|client_secret|private_reasoning/iu);
  } finally { invoke.mockRestore(); await h.dispose(); }
}, 20000);

it('does not exceed two structural repairs or perform an effect on exhausted repair', async () => {
  const h = await openApp();
  try {
    h.cal.modelWires.push(malformedCreateWire(), malformedCreateWire(), malformedCreateWire());
    const ids = await h.submit(content);
    await h.stream(ids);
    const budget = await h.cal.p.calendarAccountingV2.getBudget('aurvin-dev-user', ids.sessionId, ids.turnId);
    expect(budget).toMatchObject({ modelDispatches: 3, repairs: 2, creates: 0 });
    expect(h.cal.modelBodies).toHaveLength(3);
    expect(calendarCalls(h).filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(await h.cal.operationFor(ids)).toBeNull();
  } finally { await h.dispose(); }
}, 20000);

it('pins the target when the saved default changes during provider dispatch', async () => {
  const h = await openApp();
  const original = h.fetcher.getMockImplementation()!;
  let changed = false;
  h.fetcher.mockImplementation(async (url, init) => {
    if (!changed && String(url).includes('/events') && init?.method === 'POST') {
      changed = true;
      await h.cal.setDefault('owned');
    }
    return original(url, init);
  });
  try {
    h.cal.modelWires.push(createWire(event()), textWire('Created.'));
    const ids = await h.submit(content);
    await h.stream(ids);
    expect(changed).toBe(true);
    expect(await h.cal.operationFor(ids)).toMatchObject({ state: 'succeeded', calendarId: 'team@example.test',
      action: { calendarId: 'team@example.test' }, receipt: { calendarId: 'team@example.test' } });
    expect(calendarCalls(h).filter(([, init]) => init?.method === 'POST'
      && String(init?.body).includes('aurvinOperationId'))).toHaveLength(1);
  } finally { await h.dispose(); }
}, 20000);

it('readbacks only the original effect after receipt failure and a default switch', async () => {
  const h = await openApp();
  try {
    h.cal.failOnce('receipt-save');
    h.cal.modelWires.push(createWire(event()));
    const ids = await h.submit(content);
    await h.stream(ids);
    const old = await h.cal.operationFor(ids);
    expect(['dispatching', 'unknown']).toContain(old?.state);
    await h.cal.setDefault('owned');
    const before = h.fetcher.mock.calls.length;
    await h.service.operations.runtime.reconcileSession('aurvin-dev-user', ids.sessionId);
    const next = await h.cal.operationFor(ids);
    expect(next).toMatchObject({ state: 'succeeded', operationId: old!.operationId,
      calendarId: 'team@example.test', googleEventId: old!.googleEventId });
    const after = h.fetcher.mock.calls.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every(([url, init]) => (init?.method ?? 'GET') === 'GET'
      && !String(url).includes('/chat/completions') && !String(url).includes('/freeBusy'))).toBe(true);
    const reads = after.filter(([url]) => String(url).includes('/events/'));
    expect(reads).toHaveLength(1);
    expect(decodeURIComponent(new URL(String(reads[0][0])).pathname))
      .toBe(`/calendar/v3/calendars/team@example.test/events/${old!.googleEventId}`);
    expect(h.cal.modelBodies).toHaveLength(1);
  } finally { await h.dispose(); }
}, 20000);
```

- [ ] **Step 2 (2 minutes per case): Run each behavior check before continuing.** In `backend/`:

```powershell
npm test -- test/integration/plugins/multi-calendar/accounting-recovery.spec.ts -t "every actual"
npm test -- test/integration/plugins/multi-calendar/accounting-recovery.spec.ts -t "structural repairs"
npm test -- test/integration/plugins/multi-calendar/accounting-recovery.spec.ts -t "during provider"
npm test -- test/integration/plugins/multi-calendar/accounting-recovery.spec.ts -t "receipt failure"
```

The first assertion is deliberately stronger than P6's fixture-category counts. If RED, reproduce `P8-GATE-P6-REQUEST-ACCOUNTING` using the real P4 provider deliveries, preserve observed count versus persisted count, and return it to P6/P4/P5. Do not restore the fixture replacement, translate request categories in P9, or accept `>=` instead of equality. Recovery may legitimately refresh discovery/current rights via GET, but cannot run new availability, model inference or insertion for an already dispatched effect.
- [ ] **Step 3 (2 minutes): Run the whole new file plus unchanged runtime/context regression files.** In `backend/`:

```powershell
npm test -- test/integration/plugins/multi-calendar/accounting-recovery.spec.ts test/runtime/calendar-recovery.spec.ts test/runtime/calendar-multi-recovery.spec.ts test/runtime/calendar-recovery-unavailable.spec.ts test/runtime/calendar-publication.spec.ts test/runtime/calendar-graph.spec.ts test/runtime/calendar-budget.spec.ts test/context/calendar-context.spec.ts
```

Expected all discovered deterministic checks pass. Exact spend accounting, lower caps, delivery-retry eligibility, provider attribution, unknown spend, reference-only graph state and successful-receipt/narration-failure remain covered by these owner suites and the Task 9 package run. A green check containing an intentionally rejected model call is not paid-provider evidence.
- [ ] **Step 4 (2 minutes): Commit.** From root:

```powershell
git add backend/test/integration/plugins/multi-calendar/accounting-recovery.spec.ts
git commit -m "test(calendar): verify assembled request accounting and pinned recovery"
```

## Task 5: Exercise the actual SDK catalogue and provider projection

**Files:** Create `backend/test/plugins/integration/multi-calendar/sdk.ts`, `catalogue.spec.ts`, and `provider-coverage.spec.ts` in that same directory.

- [ ] **Step 1 (2–5 minutes): Write `catalogue.spec.ts` through its first assertion.** Run it once before the adapter exists to identify infrastructure discovery, then supply the adapter and obtain an actual behavior result. Add remaining cases separately. Complete file:

```typescript
/**
 * ============================================================================
 * FILE: catalogue.spec.ts
 * LOCATION: backend/test/plugins/integration/multi-calendar/catalogue.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify the frozen five-tool catalogue and target authority through real MCP.
 * ROLE IN PROJECT:
 *    Uses installed SDK transport and production handler with scripted REST.
 *    Never substitutes a mocked SDK client or a public MCP endpoint.
 * KEY COMPONENTS:
 *    - Catalogue parity: Input/output schemas, annotations and revision pin.
 *    - Selector authority: Shared writes, read denials and forged-field refusal.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { calendarCatalogue, assertCalendarCatalogue } from '../../../../src/plugins/registry.js';
import { calendarExecutionEnvelopeV2Schema } from '../../../../src/contracts/calendar-operations.js';
import { multiTarget, multiToolsFixture } from '../../google-calendar/tools-multi-fixtures.js';
import { googleEvent, googleJson } from '../../google-calendar/tools-fixtures.js';
import { withSdk } from './sdk.js';

it('advertises the exact five revised schemas and refuses catalogue tampering', async () => {
  const f = multiToolsFixture({ operation: null, steps: [] });
  await withSdk(f, async client => {
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(5);
    expect(listed.nextCursor).toBeUndefined();
    expect(() => assertCalendarCatalogue(listed)).not.toThrow();
    for (const expected of calendarCatalogue()) {
      const actual = listed.tools.find(tool => tool.name === expected.name);
      expect(actual?.inputSchema).toEqual(expected.inputSchema);
      expect(actual?.outputSchema).toEqual(expected.outputSchema);
      expect(actual?.annotations).toEqual(expected.annotations);
      expect(actual?._meta).toEqual(expected._meta);
    }
    const changed = structuredClone(listed);
    changed.tools[0].inputSchema.additionalProperties = true;
    expect(() => assertCalendarCatalogue(changed)).toThrow();
    const result = await client.callTool({ name: 'calendar_list_calendars', arguments: {} });
    expect(calendarExecutionEnvelopeV2Schema.parse(result.structuredContent))
      .toMatchObject({ outcome: 'success', result: { tool: 'calendar_list_calendars' } });
    expect(f.requests).toHaveLength(0);
  });
});

it.each(['writer', 'writerWithoutPrivateAccess'] as const)('creates on a shared %s target via real SDK', async role => {
  const f = multiToolsFixture({ target: multiTarget(role, 'shared') });
  await withSdk(f, async client => {
    const result = await client.callTool({ name: f.input.call.name, arguments: f.input.call.arguments });
    expect(calendarExecutionEnvelopeV2Schema.parse(result.structuredContent)).toMatchObject({ outcome: 'success',
      receipt: { calendarId: 'shared', googleEventId: f.input.binding.operation!.googleEventId } });
    expect(f.requests).toHaveLength(1);
    const url = new URL(f.requests[0].url);
    expect(url.pathname).toBe('/calendar/v3/calendars/shared/events');
    expect(url.searchParams.get('sendUpdates')).toBe('none');
  });
});

it.each(['reader', 'freeBusyReader'] as const)('refuses create on %s before Google', async role => {
  const f = multiToolsFixture({ target: multiTarget(role, 'shared'), steps: [] });
  await withSdk(f, async client => {
    const result = await client.callTool({ name: f.input.call.name, arguments: f.input.call.arguments })
      .then(value => value.isError === true, () => true);
    expect(result).toBe(true);
    expect(f.requests).toHaveLength(0);
  });
});

it.each(['calendar_list_events', 'calendar_get_event'] as const)('reads a shared reader with %s', async name => {
  const get = name === 'calendar_get_event';
  const f = multiToolsFixture({ target: multiTarget('reader', 'shared'), operation: null,
    call: get ? { name, arguments: { calendarId: 'shared', eventId: 'abcde01234' } }
      : { name, arguments: { calendarId: 'shared', timeMin: '2026-10-21T00:00:00Z',
        timeMax: '2026-10-22T00:00:00Z', maxResults: 20 } },
    steps: [{ method: 'GET', path: `/calendar/v3/calendars/shared/events${get ? '/abcde01234' : ''}`,
      response: () => googleJson(get ? googleEvent({ visibility: 'private' })
        : { timeZone: 'Etc/UTC', items: [googleEvent({ visibility: 'private' })] }) }] });
  await withSdk(f, async client => {
    const result = await client.callTool({ name, arguments: f.input.call.arguments });
    expect(calendarExecutionEnvelopeV2Schema.parse(result.structuredContent)).toMatchObject({ outcome: 'success',
      result: { tool: name, target: { calendarId: 'shared', privateAccess: false } } });
    expect(JSON.stringify(result)).not.toContain('fixture-private-attendee');
    expect(f.requests).toHaveLength(1);
  });
});

it.each([
  { calendarId: 'not-discovered' }, { confirmed: true }, { conflictOverride: true },
  { connectionId: 'forged' }, { userId: 'forged' }, { accessToken: 'forged' },
  { attendees: [{ email: 'forged@example.invalid' }] },
])('refuses untrusted create fields %j without a provider effect', async patch => {
  const f = multiToolsFixture({ steps: [] });
  await withSdk(f, async client => {
    const refused = await client.callTool({ name: 'calendar_create_event',
      arguments: { ...f.input.call.arguments, ...patch } }).then(value => value.isError === true, () => true);
    expect(refused).toBe(true);
    expect(f.requests).toHaveLength(0);
  });
});
```

- [ ] **Step 2 (2–5 minutes): Create `sdk.ts` with the actual SDK connection.** No SDK, handler, registry or validation module is mocked.

```typescript
/**
 * ============================================================================
 * FILE: sdk.ts
 * LOCATION: backend/test/plugins/integration/multi-calendar/sdk.ts
 * ============================================================================
 * PURPOSE:
 *    Connect the installed MCP SDK transport to the production embedded handler.
 * ROLE IN PROJECT:
 *    Reuses owner tools fixtures while observing the real internal wire pin.
 *    Guarantees cleanup without opening an external socket or exposing tokens.
 * KEY COMPONENTS:
 *    - withSdk: Real initialize/discover/call transport with bounded fixture lifetime.
 * ============================================================================
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect } from 'vitest';
import { createCalendarMcpHandler } from '../../../../src/plugins/mcp/calendar-server.js';
import { CALENDAR_LIMITS, CALENDAR_MCP_WIRE } from '../../../../src/contracts/calendar-policy.js';
import type { multiToolsFixture } from '../../google-calendar/tools-multi-fixtures.js';

export async function withSdk(f: ReturnType<typeof multiToolsFixture>, action: (client: Client) => Promise<void>) {
  f.input.binding = { ...f.input.binding, deadlineAt: new Date(Date.now() + 20000).toISOString() };
  const handler = createCalendarMcpHandler({ binding: f.input.binding, tools: f.tools,
    gate: f.gate, limits: CALENDAR_LIMITS, signal: f.input.signal,
    consumeRequest: f.input.consumeRequest, consumeRefreshRequest: f.input.consumeRefreshRequest });
  const wires: string[] = [];
  const client = new Client({ name: 'aurvin-p9-multi-calendar', version: '2.0.0' },
    { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL('http://aurvin.internal/mcp'), {
    fetch: (url, init) => {
      const request = new Request(url as RequestInfo, init);
      expect(new URL(request.url).hostname).toBe('aurvin.internal');
      expect(request.headers.has('authorization')).toBe(false);
      const wire = request.headers.get('mcp-protocol-version');
      if (wire) wires.push(wire);
      return handler.fetch(request);
    },
  });
  try {
    await client.connect(transport);
    await action(client);
    expect(wires.length).toBeGreaterThan(0);
    expect(wires.every(wire => wire === CALENDAR_MCP_WIRE)).toBe(true);
  } finally {
    try { await client.close(); }
    finally { try { await handler.close(); } finally { await f.tools.close(); } }
  }
}
```

- [ ] **Step 3 (2 minutes): Run catalogue/roles/selectors.** In `backend/`:

```powershell
npm test -- test/plugins/integration/multi-calendar/catalogue.spec.ts
```

Expected GREEN or a meaningful P5-owned schema/selector/capability failure. SDK validation of `structuredContent` is part of the check. The direct MCP create fixture carries a **trusted test operation**; it does not prove a raw model call can bypass P6's runtime preflight. Task 3 is the runtime proof.

- [ ] **Step 4 (2–5 minutes per test): Create `provider-coverage.spec.ts`.** Add/run one test group at a time. This exercises the fifth tool through actual SDK output validation, not an availability-port stub.

```typescript
/**
 * ============================================================================
 * FILE: provider-coverage.spec.ts
 * LOCATION: backend/test/plugins/integration/multi-calendar/provider-coverage.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify bounded Google free/busy projection through the actual MCP transport.
 * ROLE IN PROJECT:
 *    Runs real provider parsing on scripted payloads and validates SDK results.
 *    Records opaque-busy fixture semantics without asserting live Google behavior.
 * KEY COMPONENTS:
 *    - Coverage: Fifty-item batches, per-calendar errors and interval ceilings.
 *    - DST: Twenty-three and twenty-five elapsed-hour opaque all-day intervals.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { calendarExecutionEnvelopeV2Schema } from '../../../../src/contracts/calendar-operations.js';
import { multiToolsFixture } from '../../google-calendar/tools-multi-fixtures.js';
import { googleJson } from '../../google-calendar/tools-fixtures.js';
import { withSdk } from './sdk.js';

const range = { timeMin: '2026-11-03T10:00:00Z', timeMax: '2026-11-03T11:00:00Z', timeZone: 'Etc/UTC' };
it.each([false, true])('batches one hundred authorized IDs with honest HTTP-200 errors=%s', async hasError => {
  const ids = ['shared', ...Array.from({ length: 99 }, (_, i) => `cal-${i + 1}`)];
  const f = multiToolsFixture({ calendarCount: 100, operation: null,
    call: { name: 'calendar_check_availability', arguments: range },
    steps: [0, 50].map(offset => ({ method: 'POST', path: '/calendar/v3/freeBusy',
      response: () => googleJson({ timeMin: range.timeMin, timeMax: range.timeMax,
        calendars: Object.fromEntries(ids.slice(offset, offset + 50).map(id => [id,
          hasError && id === 'cal-99' ? { errors: [{ reason: 'notFound' }], busy: [] } : { busy: [] }])) }) })) });
  f.input.binding = { ...f.input.binding, target: null };
  await withSdk(f, async client => {
    const actual = await client.callTool({ name: 'calendar_check_availability', arguments: range });
    const parsed = calendarExecutionEnvelopeV2Schema.parse(actual.structuredContent);
    expect(parsed.outcome).toBe('success');
    if (parsed.outcome !== 'success' || parsed.result.tool !== 'calendar_check_availability') {
      throw new Error('Expected availability through the SDK output schema.');
    }
    expect(parsed.result.coverage).toBe(hasError ? 'incomplete' : 'complete');
    expect(parsed.result.conflict).toBe(hasError ? 'unknown' : 'clear');
    expect(parsed.result.semantics).toBe('google-opaque-busy-only');
    if (hasError) expect(parsed.result.free).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(actual), 'utf8')).toBeLessThanOrEqual(16384);
    expect(f.requests).toHaveLength(2);
    const sent: string[] = [];
    for (const request of f.requests) {
      const body = await request.clone().json();
      expect(body.items).toHaveLength(50);
      expect(body).not.toHaveProperty('groups');
      expect(body).not.toHaveProperty('groupExpansionMax');
      sent.push(...body.items.map((item: { id: string }) => item.id));
    }
    expect(sent).toEqual(ids);
    expect(f.counts.kinds).toEqual(['availability', 'availability']);
  });
});

it.each([
  ['2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00', 23],
  ['2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', 25],
] as const)('preserves opaque all-day elapsed time from %s', async (start, end, hours) => {
  const args = { timeMin: start, timeMax: end, timeZone: 'America/New_York' };
  const f = multiToolsFixture({ operation: null,
    call: { name: 'calendar_check_availability', arguments: args },
    steps: [{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: start, timeMax: end, calendars: { shared: { busy: [{ start, end }],
        summary: 'unrelated-private-title', attendees: ['private-person@example.invalid'] } },
    }) }] });
  await withSdk(f, async client => {
    const actual = await client.callTool({ name: 'calendar_check_availability', arguments: args });
    const value = calendarExecutionEnvelopeV2Schema.parse(actual.structuredContent);
    if (value.outcome !== 'success' || value.result.tool !== 'calendar_check_availability') {
      throw new Error('Expected SDK availability success.');
    }
    expect(value.result).toMatchObject({ coverage: 'complete', conflict: 'conflict', free: [],
      semantics: 'google-opaque-busy-only' });
    expect(value.result.busy).toHaveLength(1);
    expect(Date.parse(value.result.busy[0].end) - Date.parse(value.result.busy[0].start)).toBe(hours * 3600000);
    expect(JSON.stringify(actual)).not.toMatch(/unrelated-private-title|private-person/iu);
  });
});

it.each([2000, 2001])('processes at most two thousand busy intervals: supplied %s', async count => {
  const interval = { start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' };
  const f = multiToolsFixture({ operation: null,
    call: { name: 'calendar_check_availability', arguments: range },
    steps: [{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: range.timeMin, timeMax: range.timeMax,
      calendars: { shared: { busy: Array.from({ length: count }, () => interval) } },
    }) }] });
  await withSdk(f, async client => {
    const actual = await client.callTool({ name: 'calendar_check_availability', arguments: range });
    const value = calendarExecutionEnvelopeV2Schema.parse(actual.structuredContent);
    if (value.outcome !== 'success' || value.result.tool !== 'calendar_check_availability') {
      throw new Error('Expected a bounded availability projection.');
    }
    expect(value.result.busy).toHaveLength(1);
    expect(value.result.coverage).toBe(count === 2000 ? 'complete' : 'incomplete');
    expect(value.result.truncated).toBe(count > 2000);
    expect(Buffer.byteLength(JSON.stringify(actual), 'utf8')).toBeLessThanOrEqual(16384);
    if (count > 2000) expect(value.result.free).toEqual([]);
  });
});
```

- [ ] **Step 5 (2 minutes): Run the new MCP files and existing provider boundary suites.** In `backend/`:

```powershell
npm test -- test/plugins/integration/multi-calendar test/plugins/mcp test/plugins/google-calendar/calendar-discovery-api.spec.ts test/plugins/google-calendar/calendar-availability-api.spec.ts test/plugins/google-calendar/calendar-api-http.spec.ts test/plugins/google-calendar/discovery.spec.ts test/plugins/google-calendar/discovery-pages.spec.ts
```

Expected non-empty discovery and all deterministic tests GREEN. Explicitly retain P3 tests proving transparent events/declined/cancelled/working-hours are not invented as busy: this API cannot recover invisible information. Owner suites cover 31-day/window validation, lower byte limits, 100/101 discovery bounds, unknown roles/primary omission, token loops, cache headers, 403 rate-limit versus insufficient/quota semantics, 401 refresh bounds, and per-calendar 404 without disconnect. Do not duplicate these matrices or present scripted responses as live busy/ACL/quota evidence.
- [ ] **Step 6 (2 minutes): Commit.** From root:

```powershell
git add backend/test/plugins/integration/multi-calendar/sdk.ts backend/test/plugins/integration/multi-calendar/catalogue.spec.ts backend/test/plugins/integration/multi-calendar/provider-coverage.spec.ts
git commit -m "test(calendar): verify multi-calendar SDK transport and provider coverage"
```

## Task 6: Add conditional isolated-native evidence without initiating a database action

**File:** Create `backend/test/integration/plugins/multi-calendar/native-recovery.native.e2e-spec.ts`.

- [ ] **Step 1 (2–5 minutes): Write this test.** Importing the harness does not open a database; only the guarded test body does. The worker may create this file without any native authorization.

```typescript
/**
 * ============================================================================
 * FILE: native-recovery.native.e2e-spec.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/native-recovery.native.e2e-spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify pinned multi-calendar recovery and budgets on an isolated native store.
 * ROLE IN PROJECT:
 *    Uses operator-supplied generated-database prerequisites and scripted providers.
 *    Never borrows an application database or treats native storage as live Google.
 * KEY COMPONENTS:
 *    - Prerequisite guard: Exact test prefix and explicitly enabled native run.
 *    - Recovery: One event identity and persistent counters after stopped restart.
 * ============================================================================
 */
import { describe, expect, it } from 'vitest';
import { disclose, event, nativeCalendarFixture } from '../../../runtime/calendar-multi-fixture.js';
import { createWire, textWire } from '../../../runtime/calendar-runtime.fixture.js';

const configured = process.env.AURVIN_P9_NATIVE_AUTHORIZED === 'true'
  && Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';
const request = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.';

describe.skipIf(!configured)('P9 isolated native multi-calendar', () => {
  it('retains the original effect and budget after a stopped executor and default switch', async () => {
    const h = await nativeCalendarFixture();
    try {
      h.setAvailability({ busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }] });
      const first = await disclose(h, request, event());
      const reply = await h.reply(first.proposal, 'Go ahead');
      h.failOnce('receipt-save');
      await expect(h.execute(reply)).rejects.toBeDefined();
      const original = await h.operationFor(reply);
      const before = await h.budgetFor(reply);
      expect(original?.calendarId).toBe('team@example.test');
      expect(before?.creates).toBe(1);
      await h.setDefault('personal@example.test');
      await h.restartStoppedExecutor();
      await h.runtime.reconcileSession(h.identity.userId, reply.sessionId);
      expect(await h.operationFor(reply)).toMatchObject({ state: 'succeeded',
        operationId: original!.operationId, calendarId: original!.calendarId,
        googleEventId: original!.googleEventId });
      const after = await h.budgetFor(reply);
      expect(after?.creates).toBe(before?.creates);
      expect(after?.logicalTools).toBe(before?.logicalTools);
      expect(after?.modelDispatches).toBe(before?.modelDispatches);
      expect(after?.deadlineAt).toBe(before?.deadlineAt);
      expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
      expect(h.effects.filter(effect => effect.kind === 'readback')).toEqual([
        { kind: 'readback', calendarId: original!.calendarId, eventId: original!.googleEventId },
      ]);
      const newTurn = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
      h.setAvailability({ busy: [] });
      h.modelWires.push(createWire(event()), textWire('Created on the new default.'));
      await h.execute(newTurn);
      expect(await h.operationFor(newTurn)).toMatchObject({ state: 'succeeded', calendarId: 'personal@example.test' });
    } finally { await h.dispose(); }
  }, 60000);
});
```

`AURVIN_P9_NATIVE_AUTHORIZED` is a **test-only second safety latch**, not application configuration or proof of user authorization. Never set it merely because a URI exists. Existing native suites have only their established URI/prefix guard; the command branch below is therefore also authorization-gated.

- [ ] **Step 2 (2 minutes): Demonstrate skip without touching a service.** In a fresh shell with working directory `backend/`, clear only that child shell's native test variables before running the discovery check:

```powershell
$env:AURVIN_TEST_MONGODB_URI = $null
$env:AURVIN_TEST_DB_PREFIX = $null
$env:AURVIN_P9_NATIVE_AUTHORIZED = $null
npm run test:e2e -- test/integration/plugins/multi-calendar/native-recovery.native.e2e-spec.ts
```

Expected: exactly one discovered skipped test, zero executed native tests. Record **skipped — missing operator authorization/isolated prerequisites**, not PASS and not a TDD RED. These process-local removals do not delete `.env` or user configuration. No native command is run by this planner.

- [ ] **Step 3 (2–5 minutes): Record `P9-NATIVE` pending unless separately authorized prerequisites are supplied.** Required: explicit authorization to create/drop only generated fixture databases, operator-supplied isolated native MongoDB replica-set URI, exact prefix `aurvin_p2_test_`, one stopped/owned executor per generated database, adequate permissions, and cleanup evidence. Do not create/start/configure MongoDB, reuse a historical URI, read application `.env`, or silently set up a replica set. URI presence alone is not authority. Missing input means record the gate and continue deterministic work.

- [ ] **Step 4 (2 minutes, conditional only): After exact authorization, run this native group in `backend/`.** Operator injects URI/prefix privately; print neither. Set the test-only latch only in that authorized child process:

```powershell
$env:AURVIN_P9_NATIVE_AUTHORIZED = 'true'
npm run test:e2e -- test/integration/plugins/multi-calendar/native-recovery.native.e2e-spec.ts test/runtime/calendar-recovery.native.e2e-spec.ts test/persistence/calendar-multi-storage.native.e2e-spec.ts test/persistence/calendar-migration.native.e2e-spec.ts test/persistence/calendar-retention.native.e2e-spec.ts test/persistence/calendar-accounting.native.e2e-spec.ts test/integration/recovery.native.e2e-spec.ts
```

Expected: all discovered cases execute, pass, and generated DB cleanup completes; no prerequisite skips. Existing storage test checks `hello.setName` and `isWritablePrimary`. Record actual topology/member count only when observed; a replica-set name does not prove multi-member failover. Record generated-database cleanup from the fixture result and authorized test-local observation; do not inventory unrelated databases. No hand-deleted sentinel or expired-lease takeover. The existing three P6 native cases additionally prove competing consumption and exact debit after lost acknowledgement; execute rather than rewrite them. The existing `test/integration/recovery.native.e2e-spec.ts` separately exercises actual AppService/native text recovery with Calendar composed but **not connected**. Do not describe P6's custom-gate native runtime fixture as an AppService-connected native Calendar test; the assembled-memory and native-runtime evidence are complementary, not one end-to-end native/service certification. If a native test fails, use systematic debugging and return the defect to P2/P6/P8. If cleanup is uncertain, report the **specific generated** database privately and stop; do not recursively clean a prefix.

- [ ] **Step 5 (2 minutes): Commit the new test only.** From root:

```powershell
git add backend/test/integration/plugins/multi-calendar/native-recovery.native.e2e-spec.ts
git commit -m "test(calendar): add gated native target and budget recovery proof"
```

## Task 7: Integrate frontend client/protocol/state/render in Node

**Files:** Create the two exact frontend `multi-calendar-*.test.ts` paths from the write map. These are Node Vitest checks, not a DOM environment and not browser acceptance.

- [ ] **Step 1 (2–5 minutes): Create `multi-calendar-settings.test.ts`.** It uses the actual client and safe error mapping, not a `CalendarClient` mock returning arbitrary typed data.

```typescript
/**
 * ============================================================================
 * FILE: multi-calendar-settings.test.ts
 * LOCATION: frontend/src/features/plugins/integration-tests/multi-calendar-settings.test.ts
 * ============================================================================
 * PURPOSE:
 *    Exercise the multi-calendar HTTP client through reducer and safe SSR output.
 * ROLE IN PROJECT:
 *    Checks parsed protocol, independent default updates and rollback in Node.
 *    Does not assert browser focus, screen-reader behavior or Google service ACLs.
 * KEY COMPONENTS:
 *    - Client/settings: CSRF and confirmed-only preference state.
 *    - Picker: Native semantics, partial coverage and inaccessible defaults.
 * ============================================================================
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { createCalendarClient, CalendarClientError } from '../../../api/calendar-client.ts';
import { CalendarDefaults } from '../google-calendar/CalendarDefaults.tsx';
import { GoogleCalendarPanel } from '../google-calendar/GoogleCalendarPanel.tsx';
import { calendarSetupReducer, createInitialCalendarSetupState } from '../google-calendar/calendar-setup-state.ts';
import { calendarEntry, calendarPage, multiStatus } from '../google-calendar/testing/multi-calendar-fixtures.ts';

it('renders no-ID Connect and composes parsed cached pages with accessible truthful picker state', async () => {
  expect(typeof document).toBe('undefined');
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(calendarPage({ complete: false,
    truncated: true, limitations: ['calendar-limit', 'primary-missing'], calendars: [
      calendarEntry({ label: '<script>unsafe</script>' }),
      calendarEntry({ calendarId: 'reader', label: 'Reading', accessRole: 'reader', privateAccess: false,
        capabilities: { readEvents: true, createEvents: false, availability: true } }),
    ] })));
  const client = createCalendarClient({ fetch: fetcher });
  const status = multiStatus({ defaultSetting: { defaultCalendarId: 'lost-default', defaultSettingRevision: 7 } });
  let state = createInitialCalendarSetupState(status);
  state = calendarSetupReducer(state, { type: 'requestStarted', requestId: 1, pending: null, listLoading: true });
  const response = await client.listCalendars({});
  state = calendarSetupReducer(state, { type: 'pageReceived', requestId: 1,
    connectionRevision: 3, requestedToken: null, response });
  const html = renderToStaticMarkup(createElement(CalendarDefaults, { state, disabled: false,
    nowMs: Date.parse('2026-10-24T10:01:00Z'), onSelect: vi.fn(), onSave: vi.fn(), onReset: vi.fn(),
    onRefresh: vi.fn(), onNextPage: vi.fn() }));
  expect(html).toContain('<fieldset');
  expect(html).toContain('<legend>Default calendar for new events</legend>');
  expect(html).toContain('Calendar discovery is incomplete');
  expect(html).toContain('lost-default');
  expect(html).toContain('Cannot create events');
  expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(state.draftCalendarId).toBe('lost-default');
  const panel = renderToStaticMarkup(createElement(GoogleCalendarPanel, { client,
    initialStatus: multiStatus({ state: 'setup-required', enabled: true,
      connectionRevision: null, defaultSetting: null, discovery: null, primaryCalendarId: null }) }));
  expect(panel).toContain('Connect Google Calendar');
  expect(panel).not.toContain('targetCalendarId');
});

it('rolls a failed default save back to confirmed state without toggling enablement or leaking errors', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ code: 'CONFLICT',
    message: 'internal secret provider detail' }, { status: 409 }));
  const client = createCalendarClient({ fetch: fetcher });
  let state = createInitialCalendarSetupState(multiStatus());
  state = calendarSetupReducer(state, { type: 'selectDefault', calendarId: 'team@example.com' });
  state = calendarSetupReducer(state, { type: 'requestStarted', requestId: 1, pending: 'save-default' });
  const error = await client.updateSettings({ defaultSetting: { calendarId: state.draftCalendarId,
    expectedRevision: 7, expectedConnectionRevision: 3 } }).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(CalendarClientError);
  if (!(error instanceof CalendarClientError)) throw new Error('Expected the safe client error.');
  state = calendarSetupReducer(state, { type: 'requestFailed', requestId: 1,
    message: error.message, resetDraft: true });
  expect(state.draftCalendarId).toBeNull();
  expect(state.status?.enabled).toBe(true);
  expect(state.error).not.toContain('internal secret');
  const init = fetcher.mock.calls[0][1]!;
  expect(new Headers(init.headers).get('X-Aurvin-Calendar-CSRF')).toBe('1');
  expect(JSON.parse(String(init.body))).toEqual({ defaultSetting: { calendarId: 'team@example.com',
    expectedRevision: 7, expectedConnectionRevision: 3 } });
});
```

- [ ] **Step 2 (2 minutes): Run it.** In `frontend/`:

```powershell
npm test -- src/features/plugins/integration-tests/multi-calendar-settings.test.ts
```

Expected GREEN or a P7-owned protocol/state/presentation defect. Add no DOM shim or dependency; SSR cannot prove focus. Existing P7 tests provide success/reset, loading/empty/stale/refresh-error, reconnect/scope diagnostics, paging/account races and uncertain-write confirmation cases; run them in Task 9 rather than copying their matrices.

- [ ] **Step 3 (2–5 minutes): Create `multi-calendar-chat.test.ts`.** Use v3 parser output as the reducer input and render from the reducer's durable operation, never from the current picker.

```typescript
/**
 * ============================================================================
 * FILE: multi-calendar-chat.test.ts
 * LOCATION: frontend/src/features/plugins/integration-tests/multi-calendar-chat.test.ts
 * ============================================================================
 * PURPOSE:
 *    Verify v3 clarification and durable receipt presentation through client state.
 * ROLE IN PROJECT:
 *    Connects strict SSE parsing to the real chat reducer and safe SSR components.
 *    Preserves drafts and target provenance without browser authorization logic.
 * KEY COMPONENTS:
 *    - Parsed clarification: Current-session fencing and no synthesized approval.
 *    - Durable receipt: Failed narration and expiry-aware original target display.
 * ============================================================================
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { parseCalendarCompatibleFrame } from '../../../api/calendar-protocol.ts';
import { chatReducer, initialChatState } from '../../chat/state/chat-reducer.ts';
import type { ChatState } from '../../chat/state/chat-types.ts';
import { CalendarTurnView } from '../google-calendar/CalendarTurnRegion.tsx';
import { clarification, createdOperation, multiStatus } from '../google-calendar/testing/multi-calendar-fixtures.ts';

it('parses clarification without approval or draft mutation and retains the durable original target', () => {
  expect(typeof document).toBe('undefined');
  let state: ChatState = { ...initialChatState, activeSessionId: 's', activeTurnId: 't', activeAttemptId: 'a',
    isStreaming: true, draftInput: 'Keep my draft' };
  const parsed = parseCalendarCompatibleFrame(`data: ${JSON.stringify({ protocolVersion: 3,
    sessionId: 's', turnId: 't', attemptId: 'a', sequence: 1, event: clarification() })}`);
  if (parsed.event.type !== 'calendar-clarification') throw new Error('Expected parsed clarification.');
  state = chatReducer(state, { type: 'CALENDAR_CLARIFICATION', payload: { sessionId: 's',
    turnId: 't', attemptId: 'a', sequence: 1, clarification: parsed.event } });
  expect(state.draftInput).toBe('Keep my draft');
  expect(state.calendarOperationsByTurn).toEqual({});
  const operationFrame = parseCalendarCompatibleFrame(`data: ${JSON.stringify({ protocolVersion: 3,
    sessionId: 's', turnId: 't', attemptId: 'a', sequence: 2,
    event: { type: 'calendar-operation', operation: createdOperation() } })}`);
  if (operationFrame.event.type !== 'calendar-operation') throw new Error('Expected parsed receipt.');
  state = chatReducer(state, { type: 'CALENDAR_OPERATION', payload: { sessionId: 's', turnId: 't',
    attemptId: 'a', sequence: 2, operation: operationFrame.event.operation } });
  const changedDefault = multiStatus({ defaultSetting: { defaultCalendarId: 'different', defaultSettingRevision: 8 } });
  expect(changedDefault.defaultSetting?.defaultCalendarId).toBe('different');
  const render = (nowMs: number) => renderToStaticMarkup(createElement(CalendarTurnView, {
    progress: null, operations: [{ turnId: 't', operation: state.calendarOperationsByTurn.t }],
    disabled: false, nowMs, onRetryTurn: vi.fn(), onFocusComposer: vi.fn(),
  }));
  const current = render(Date.parse('2026-10-24T10:01:00Z'));
  expect(current).toContain('Calendar: Original Team');
  expect(current).toContain('The Calendar event was created and saved, but the final assistant response failed.');
  expect(current).not.toContain('Calendar: different');
  const expired = render(Date.parse('2026-10-24T10:06:00Z'));
  expect(expired).not.toContain('Calendar: Original Team');
  expect(expired).not.toContain('href="https://calendar.google.com');
  expect(expired).toContain('event12345');
});
```

Treat actual response discriminants/types as authoritative; do not cast malformed frames to bypass validation.
- [ ] **Step 4 (2 minutes): Run both new files and P7 chat-state/expiry regressions.** In `frontend/`:

```powershell
npm test -- src/features/plugins/integration-tests/multi-calendar-settings.test.ts src/features/plugins/integration-tests/multi-calendar-chat.test.ts src/features/chat/state/calendar-chat-state.test.ts src/features/plugins/google-calendar/calendar-turn-region.test.ts
```

- [ ] **Step 5 (2 minutes): Commit.** From root:

```powershell
git add frontend/src/features/plugins/integration-tests/multi-calendar-settings.test.ts frontend/src/features/plugins/integration-tests/multi-calendar-chat.test.ts
git commit -m "test(calendar): integrate multi-calendar client state and receipt rendering"
```

## Task 8: Execute browser fixtures only with an available local browser; gate all service drills

**Files:** Create/update only `docs/google-calendar-multi-calendar/staging-evidence.md` in this task. P7's browser files and P8's operations runbook remain read-only.

- [ ] **Step 1 (2–5 minutes): Create this honest initial evidence document before any browser/native/live execution.** Replace an `unrun` entry only with an actual observation, retaining dates/commit/limits and failed prior outcomes. Do not copy historical Phase 1 measurements into Phase 2 result columns.

```markdown
# Multi-calendar staging and service evidence

Review: **skipped, not passed**. Deployment and provisioning: not authorized.
This document starts with no P9 native, browser, or live-service result. The planner's
limited deterministic runs are recorded in plan9.md and do not discharge these gates.

## Evidence classification

- Scripted Google/model fixtures: not live Google, OAuth, quota, ACL or paid inference evidence.
- Frontend Node/SSR tests: not browser keyboard, focus or assistive-technology evidence.
- Native fixture: real isolated persistence plus scripted Google/model, not a live Calendar write.
- Historical Phase 1 records: preserved separately, not remeasured Phase 2 evidence.

| Gate | Status | Missing prerequisite / required observation |
| --- | --- | --- |
| P9-BROWSER | unrun | Local development fixture in an actual available browser, nonzero check list, console/network observation. |
| P9-ACCESSIBILITY | unrun | Actual keyboard/focus and assistive-technology observations; native markup alone is insufficient. |
| P9-NATIVE | blocked | Explicit generated-database create/drop authorization, isolated operator URI, exact prefix, replica-set and cleanup evidence. |
| P9-LIVE-CONSENT | blocked | Exact operator project/client/redirect/grant authorization, incremental consent and partial-grant rejection drill. |
| P9-LIVE-ACL | blocked | Named disposable secondary owner, externally owned shared writer, reader, freeBusyReader and Workspace scope/role drill. |
| P9-LIVE-BUSY | blocked | Authorized fixture event data/ranges covering conflict, opaque all-day/DST and transparent gaps; disclosed incomplete-coverage acceptance. |
| P9-LIVE-RETRY | blocked | Authorized owned/shared create/readback, original event identity on safe retry and no second insertion. |
| P9-LIVE-QUOTA | blocked | Bounded explicitly permitted quota/rate-limit observation; no quota exhaustion or load generation authorization exists. |
| P9-REAL-DATA-POLICY | blocked | Approved processing/routing/retention and actual provider-header evidence, shared-calendar metadata handling and backup/restore/invalidation disposition. |
| P8-GATE-P2-INVALIDATION | blocked | Owner-provided executed all-copy account-revision invalidation evidence; expiry sweep is not immediate invalidation. |
| P8-GATE-MIGRATION-ENTRYPOINT | blocked | Explicit approved operator migration/rollback procedure and executable ownership disposition; no automatic migration authorized. |

## Browser record

Status: unrun. Fixture URL path:
`/src/features/plugins/google-calendar/testing/calendar-browser.html`.
No browser version, check count, keyboard result, screen-reader result or screenshot is asserted.
The source's own status/check list must be observed, including every failure and console warning.
No live backend or provider is required by this intercepted-fetch development fixture.

## Native record

Status: blocked. URI and credentials must never be printed. Required prefix:
`aurvin_p2_test_`. No database was created, reconnected, migrated or dropped for this record.
No replica-set member count, failover capability or cleanup success is asserted.

## Live authorization and drill record

Status: blocked; no authorization for a Google, OAuth or model service action is recorded here.
Before any action, record the authorizing user message/reference, permitted account and exact
disposable calendar roles/targets, data/time range, operation ceiling, request/spend ceiling,
processing policy, cleanup authority and expiry of authorization. Keep secrets outside this file.
Consent or discovery alone never authorizes writing to primary, personal, work or shared calendars.
No live create, readback, retry, Google configuration change, paid model call, provisioning or deployment ran.

## Carryover limitations

Phase 1 live acceptance and real-data policy gates remain historical pending gates until separately
satisfied. Its earlier local native/browser results do not certify this phase. Single-node native
results, if later obtained, are not multi-member failover, Azure, multi-instance or production proof.
Whole-workflow completion remains pending while a required gate is blocked or unrun.
```

- [ ] **Step 2 (2–5 minutes): Check browser capability without installing a runner or starting an application backend.** If no actual browser interaction tool/authorized local browser is available, record `P9-BROWSER` and `P9-ACCESSIBILITY` blocked with that exact prerequisite and stop this branch. Do not use `npx playwright`, `npm install`, a source grep, an HTTP page fetch, or SSR as substitute browser evidence.
- [ ] **Step 3 (2 minutes, local-fixture branch only): Use a free loopback Vite port without displacing a user's server.** In `frontend/`:

```powershell
npm run dev -- --host 127.0.0.1 --port 5187 --strictPort
```

Run as a tracked background command if a browser is available. If occupied, stop and choose a confirmed unused loopback port; do not kill unrelated processes. Open `http://127.0.0.1:5187/src/features/plugins/google-calendar/testing/calendar-browser.html` in the actual browser. The fixture refuses production/preview mode; never use `vite preview`. Record UTC time, exact SHA, browser/OS, fixture URL, literal `#fixture-status`, every `#fixture-checks li`, console warnings/errors and observed network destinations. All intercepted API traffic must stay within the fixture; unexpected outbound traffic stops the check. Keep screenshots/logs sanitized; commit no OAuth codes, credentials or raw personal payloads.
- [ ] **Step 4 (2–5 minutes per observation): Verify the real available browser scenarios, not the fixture comment.** Observe save/reset without enable toggle, next page, stale-response fence, scrubbed OAuth query, disclosure, conflict reply focus/draft preservation and original receipt target after a real settings UI change. Record failed fixture assertions literally and return them to P7. The current source does not execute every requested state (409/refresh failure/partial/stale/reconnect/no-ID Connect/keyboard+AT); those browser scenarios remain unrun until P7 supplies an executable fixture extension or the operator demonstrates them with the actual local app and scripted fixture. P9 must not edit the P7 runner or create browser code outside its ownership to hide that gap.
- [ ] **Step 5 (2–5 minutes): Record actual keyboard/AT evidence separately.** Keyboard: Tab reaches the picker group, arrows/Space select only writable choices, save/reset/refresh controls have visible focus, reply focuses composer without altering an unsent draft, Escape restores focus after revoke confirmation. Assistive technology: record product/version and observed accessible group/legend/role, disabled reasons, status/error/reconnect/partial-coverage announcements. If AT unavailable, mark only that subgate unrun; programmatic `.click()` and native labels are not a screen-reader run. Stop only the server started in Step 3 when finished.
- [ ] **Step 6 (2–5 minutes): Keep live drills blocked unless a separate exact authorization is supplied.** No live execution command is part of this plan. If authorized later, request an owner/orchestrator-approved bounded drill against that authorization and P8's actual runbook, then record:
  1. Incremental consent from an old grant; per-scope denial/partial rejection; preserved same-account default and reset on account replacement. OAuth project/configuration changes need their own authority.
  2. ACL discovery/read/free-busy for primary, secondary owner, shared writer owned by another account, reader and freeBusyReader; masked writer/Workspace shape where actually available. Primary-default behavior stays a fixture unless a specific primary action is named.
  3. Exactly authorized one-off timed creation/readback on disposable **secondary owned and shared writable** targets; deny reader/freeBusyReader effects. Record original operation/calendar/event identity on retry/readback without dispatching another insert; do not claim exactly-once billing.
  4. Conflict/incomplete coverage disclosure, unchanged acceptance versus material change, all-day/DST busy projection and transparent-event limitations. Google free/busy→insert is not atomic or a reservation.
  5. Quota classification/observed `403 rateLimitExceeded`/secondary-rate-limit semantics only within separately bounded permitted observations; never induce quota exhaustion, alter quota, stress a service or claim fixture errors are live rate-limit evidence.
  6. Exact request/model dispatch/spend ceilings and measured usage, sanitized evidence, permitted cleanup performed by an authorized operator (event deletion is not an Aurvin Phase 2 tool), and remaining uncertainty. A drill not explicitly authorized stays blocked, even if other live drills pass.
- [ ] **Step 7 (2 minutes): Commit the truthful evidence record.** From root:

```powershell
git add docs/google-calendar-multi-calendar/staging-evidence.md
git commit -m "docs(calendar): record multi-calendar browser native and service gates"
```

## Task 9: Rerun the final deterministic/package checks sequentially

**Files:** No source writes. Results go only into the three P9 evidence documents in Task 10.

- [ ] **Step 1 (2 minutes): Freeze the source commit set after all owner corrections.** From root:

```powershell
git status --short
git rev-parse HEAD
git log --format="%H %s" b3497f10bf4d8a205b6f7866d563965163498a95..HEAD
node -p "JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,nativeUriSupplied:Boolean(process.env.AURVIN_TEST_MONGODB_URI),nativePrefixValid:process.env.AURVIN_TEST_DB_PREFIX==='aurvin_p2_test_'})"
npm --version
```

Execute commands separately. Record the exact tested full SHA/branch, source-owner correction hashes and dirty paths; do not call a dirty run a clean-commit result. Do not dump environment variables, configuration files, provider keys or URI values. Record installed Vitest/MCP/MongoDB/React versions via `npm ls --depth=0` in each package, with no install or dependency reconciliation.

- [ ] **Step 2 (2–5 minutes per command): Run source-owner focused suites on this SHA, one command at a time.** In `backend/`:

```powershell
npm test -- test/contracts/calendar- test/persistence/calendar- test/plugins/google-calendar test/plugins/mcp test/plugins/registry test/model/calendar- test/runtime/calendar- test/context/calendar-context.spec.ts test/assembly/calendar- test/operations/calendar- test/http/calendar- src/platform/config/calendar-config.spec.ts
npm test -- test/integration/plugins/multi-calendar test/plugins/integration/multi-calendar
```

In `frontend/`:

```powershell
npm test -- src/api/calendar- src/features/plugins/google-calendar src/features/plugins/integration-tests/multi-calendar- src/features/chat/state/calendar-chat-state.test.ts
```

These selectors must discover nonzero test files. Backend routine discovery is `*.spec.ts`; it does **not** execute `*.e2e-spec.ts`. The frontend environment is Node. Record current pass/fail/skip counts, failing test names and duration from actual output; never replace counts with historical planner/worker totals. Owner code, owner tests and Phase 1 suites remain unchanged.

- [ ] **Step 3 (2–5 minutes per command): Run all seven package commands in exactly this serial order.** Before commands that may discover native checks, inspect only prerequisite booleans. Without separate DB authorization, run in a fresh shell with `AURVIN_TEST_MONGODB_URI`, `AURVIN_TEST_DB_PREFIX`, and `AURVIN_P9_NATIVE_AUTHORIZED` removed process-locally as in Task 6; never allow pre-existing URI/prefix values to initiate unauthorized DB actions. Do not load application `.env` or enable live/behavior smoke flags. Routine provider fixtures must be the only Google/model transport.

| Order | Working directory | Exact command | Expected result / classification |
| --- | --- | --- | --- |
| 1 | `backend/` | `npm run build` | Exit 0; type/module compatibility, not test evidence. |
| 2 | `backend/` | `npm run lint` | Exit 0; record warnings separately. |
| 3 | `backend/` | `npm test` | All required deterministic tests pass; enumerate every skip and reason. |
| 4 | `backend/` | `npm run test:e2e` | Deterministic e2e pass; absent native prereqs produce reported skips, not native PASS. |
| 5 | `frontend/` | `npm run build` | Exit 0; record chunk warnings/assets. |
| 6 | `frontend/` | `npm run lint` | Exit 0; record warnings separately. |
| 7 | `frontend/` | `npm test` | Nonzero discovered tests pass in Node; not actual browser. |

Never run a build concurrently with tests: dist/bootstrap tests race known build output. Do not run `test:azure` or `test:behavior` as substitute coverage; empty discovery exits are not evidence. No Azure, live-voice tools, multi-instance or production admission follows from these commands. If separately authorized native inputs later arrive, rerun the native group and native-aware full e2e sequentially on the same commit and record **both** prerequisite-absent and prerequisite-present results, not overwritten counts.

- [ ] **Step 4 (2–5 minutes): Resolve every required failed check through its owner.** Include exact failing command/test/observed value, expected goal criterion, tested SHA, sanitized reproduction and affected downstream gates in the handoff. Owner commits are serialized; after each correction rerun focused checks and the affected package checks. No P9 production patch or reviewer/fixer is introduced. Pending policy/native/browser/live gates remain pending even if deterministic suites pass.

## Task 10: Make evidence complete, linked and impossible to misread as full acceptance

**Files:** Create `backend/test/integration/plugins/multi-calendar/evidence.spec.ts`, `docs/google-calendar-multi-calendar/verification.md`, and `docs/google-calendar-multi-calendar/final_report.md`; update only P9's `staging-evidence.md` with measured results.

- [ ] **Step 1 (2–5 minutes): Write the evidence consistency test, then run it before creating the missing documents.** Complete file:

```typescript
/**
 * ============================================================================
 * FILE: evidence.spec.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/evidence.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Keep multi-calendar acceptance evidence linked and explicitly gate-qualified.
 * ROLE IN PROJECT:
 *    Guards document consistency only, never certifies the application or service.
 *    Prevents omitted acceptance rows or silently omitted required live gates.
 * KEY COMPONENTS:
 *    - Evidence paths: Required documents and local links exist.
 *    - Acceptance map: Every AC and skipped-review/pending-gate language is present.
 * ============================================================================
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(process.cwd(), '../docs/google-calendar-multi-calendar');
const read = (name: string) => readFileSync(resolve(root, name), 'utf8');
it('records every acceptance criterion and named evidence class without broken local links', () => {
  const verification = read('verification.md');
  const staging = read('staging-evidence.md');
  const report = read('final_report.md');
  const ids = Array.from({ length: 14 }, (_, i) => `AC${String(i + 1).padStart(2, '0')}`);
  for (const id of ids) expect(verification).toContain(`| ${id} |`);
  for (const text of [verification, staging, report]) {
    expect(text).toMatch(/skipped, not passed/iu);
    expect(text).toMatch(/pending|blocked|unrun|satisfied/iu);
  }
  for (const gate of ['P9-NATIVE', 'P9-BROWSER', 'P9-ACCESSIBILITY', 'P9-LIVE-CONSENT',
    'P9-LIVE-ACL', 'P9-LIVE-BUSY', 'P9-LIVE-RETRY', 'P9-LIVE-QUOTA', 'P9-REAL-DATA-POLICY']) {
    expect(staging).toContain(gate);
    expect(verification).toContain(gate);
  }
  for (const name of ['verification.md', 'staging-evidence.md', 'final_report.md']) {
    for (const match of read(name).matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      if (/^(?:https?:|mailto:|#)/u.test(match[1])) continue;
      const path = decodeURIComponent(match[1].split('#')[0]);
      expect(existsSync(resolve(dirname(resolve(root, name)), path)), `${name}: ${path}`).toBe(true);
    }
  }
});
```

Run in `backend/`:

```powershell
npm test -- test/integration/plugins/multi-calendar/evidence.spec.ts
```

Expected initial RED: the required P9 documents do not exist. This is an evidence requirement failure, not proof of an application defect. Later GREEN proves only documentation consistency; humans still compare result rows against actual output and gate authority.

- [ ] **Step 2 (2–5 minutes): Create `verification.md` with this complete honest initial content, then populate measured rows from Task 9 output, not estimates.** A count is written only after the command actually ran; retain the tested implementation SHA even when the subsequent evidence-only commit changes HEAD.

```markdown
# Multi-calendar verification

Review: **skipped, not passed**. Whole-workflow acceptance: pending.

## Commit and environment

P9 final verification is unrun in this initial record. The planner inspected
`7960bdb20cf81da92f863d414d832640f8ac3e52` on Windows x64 with Node `v24.19.0`,
npm `11.17.0` and observed Vitest `4.1.11`. That is a planning baseline, not the
final tested source set. Final source SHA, branch, dirty paths, owner correction
hashes, installed versions and UTC execution times must accompany executed rows.
No credentials or MongoDB URI are recorded.

## Actual result ledger

| Check | Status | Evidence / limits |
| --- | --- | --- |
| Planner backend focused command in plan9.md | passed | 5 files / 51 tests; 25 October 2026; deterministic subset only. |
| Planner frontend focused command in plan9.md | passed | 3 files / 20 tests; 25 October 2026; Node only. |
| Final backend build/lint/unit/e2e | unrun | Requires completed P8 and committed P9 checks on one recorded source SHA. |
| Final frontend build/lint/unit | unrun | Node results and warnings must be reported separately from browser. |
| New assembled and actual SDK MCP checks | unrun | Require production ledger, real SDK transport and nonzero discovered tests. |
| Native checks | blocked | P9-NATIVE; no DB action authorized or performed by this record. |
| Browser checks | unrun | P9-BROWSER and P9-ACCESSIBILITY; no actual browser observation yet. |
| Live Google/model/policy | blocked | Separate named gates in staging-evidence.md; fixtures are not service evidence. |

## Acceptance mapping

Each row is initially unrun for final P9 acceptance. The plan's acceptance map gives
the exact new files and read-only owner suites; update this table with actual command,
test name/result and any named remaining gate after execution.

| Criterion | Status | Required integrated evidence / remaining gate |
| --- | --- | --- |
| AC01 | unrun | No-target/default-off assembly and local boundaries; P9-LIVE-CONSENT. |
| AC02 | unrun | Bounded discovery/pages/expiry/races/roles/primary and bytes. |
| AC03 | unrun | Scoped role matrix and old/partial grants; P9-LIVE-ACL. |
| AC04 | unrun | Explicit/default/primary, durable save/reset, no silent fallback. |
| AC05 | unrun | Ordinary scheduling and natural durable choice replies without JSON echo. |
| AC06 | unrun | Real SDK/free-busy batching/errors/DST/opaque semantics; P9-LIVE-BUSY. |
| AC07 | unrun | Mandatory preflight and current durable acceptance, changed-condition renewal. |
| AC08 | unrun | Actual five-tool SDK catalogue/schema/selector/repair/policy checks. |
| AC09 | unrun | Immutable operation identity across dispatch/default/recovery/retry; P9-LIVE-RETRY. |
| AC10 | unrun | Actual deliveries versus persistent counters, attribution/spend/context/retention. |
| AC11 | unrun | Client Node plus P9-BROWSER and P9-ACCESSIBILITY. |
| AC12 | unrun | Migration/rollback/checkpoints, one owner, text/config/voice/canvas regressions. |
| AC13 | unrun | Security/privacy/drain/assets/setup, policy/backup/invalidation gate dispositions. |
| AC14 | pending | Exact source/environment and separated results; required service evidence absent. |

## Named pending gates and limitations

P9-NATIVE, P9-BROWSER, P9-ACCESSIBILITY, P9-LIVE-CONSENT, P9-LIVE-ACL,
P9-LIVE-BUSY, P9-LIVE-RETRY, P9-LIVE-QUOTA and P9-REAL-DATA-POLICY are not
satisfied by source existence or fixtures. P8-GATE-P2-INVALIDATION and
P8-GATE-MIGRATION-ENTRYPOINT require explicit owner dispositions.
P8-GATE-P4-CALENDAR-GET and P8-GATE-P6-REQUEST-ACCOUNTING require reproduced
test results and owner correction hashes if confirmed; this initial record makes
no claim that they remain broken or have been fixed.

Skipped or empty suites are not passing evidence. Historical Phase 1 native/browser
results and pending live/policy gates remain separate. No provisioning, application
data migration, paid inference, live service action, deployment, Azure, multi-instance
or production certification is inferred.

See [staging evidence](staging-evidence.md), [final report](final_report.md),
[approved goal](goal.md) and [execution state](state.md).
```

- [ ] **Step 3 (2–5 minutes): Create the initial `final_report.md` below and then replace its disposition only from the completed actual ledger.** Add tested scope, all P9/owner correction commits, exact check totals/skips and precise pending inputs when results exist. No completion claim is permitted while any required gate is pending.

```markdown
# Multi-calendar final report

Outcome: final verification and full service acceptance remain pending.
Review: **skipped, not passed**.

## Verified subset

This initial report contains no P9 final acceptance claim. Planning baseline checks
were deterministic backend 5 files / 51 tests and frontend Node 3 files / 20 tests;
their exact commands, environment and inspected commit are in plan9.md. They are
not native, browser, live Google or production evidence.

## Required outstanding evidence

The final commit set and package/integrated results must be recorded in
[verification](verification.md). Native generated-database, actual browser and
accessibility observations, live consent/ACL/busy/retry/quota and real-data policy
gates are individually recorded in [staging evidence](staging-evidence.md).
Owner findings require reproduced outcomes and correction commits, not assumptions
from old failure counts. Existing Phase 1 live-policy limitations are not erased.

## Completion and authority

The deterministic subset may be reported as tested only after its checks execute.
Unrun or prerequisite-skipped checks remain unrun/skipped; no fixture substitutes
for required live owned/shared target creation/readback/safe-retry evidence.
Whole-workflow completion is blocked until the required evidence and orchestrator
V acceptance are satisfied. No live OAuth/Google/model action, package installation,
application-data migration, provisioning, paid test or deployment is authorized by
this report. Review was skipped and was never passed.
```

- [ ] **Step 4 (2–5 minutes): Populate all three evidence files from actual results, keeping classes separate.** For each executed command record working directory, exact command, full tested SHA, UTC time, exit code, discovered file/test totals, passed/failed/skipped counts, warnings and limitations. For each skip name the file/test and missing prerequisite. For unrun prerequisites record who must supply what authority/input, not a fictitious zero-failure result. Expand the AC table with test-name/command links and **partial** when only fixture evidence exists. Record owner-routed RED→owner commit→rerun outcomes. Record native cleanup/topology and browser literal check lists only if observed. Record live authorization/action/cost/cleanup only if separately authorized and executed. Keep review skipped. If gates remain pending, final report says **verified subset; full acceptance pending**, not complete.

- [ ] **Step 5 (2 minutes): Run evidence/link/whitespace checks and the new evidence test.** In `backend/` run Step 1's test again; expected GREEN. From root:

```powershell
git diff --check
git diff --name-only
git status --short
```

Check every P9 changed path against the write map. Do not silently include other workers' uncommitted files in P9's report/commit. Use relative Markdown links only to existing artifacts; do not link a pending operations file before P8 creates it. When evidence changes after the package run, rerun the evidence test and state that the final evidence-only commit was not the earlier source-run SHA; never retroactively attribute a test to a commit not yet created.

- [ ] **Step 6 (2 minutes): Commit only the named evidence paths in the serialized slot.** From root:

```powershell
git add backend/test/integration/plugins/multi-calendar/evidence.spec.ts docs/google-calendar-multi-calendar/verification.md docs/google-calendar-multi-calendar/staging-evidence.md docs/google-calendar-multi-calendar/final_report.md
git commit -m "docs(calendar): publish exact multi-calendar verification and pending gates"
```

- [ ] **Step 7 (2–5 minutes): Hand off to orchestrator V without modifying state.** Report exact implementation/evidence hashes, seven package command outcomes, focused/MCP/native/browser counts and skipped/unrun gates separately, AC01–AC14 mapping, owner correction dispositions, whether the tree contains other work, and all three clickable evidence paths. Ask V to verify the commit set and truthful disposition. Required native/browser/live/policy evidence that remains unrun blocks **whole-workflow completion**, not permission to publish the verified deterministic subset. Review remains **skipped**.

## Planner consistency checklist

- [x] Goal/state AC01–AC14 map to tasks, reused executable owner suites and explicitly named non-fixture gates.
- [x] P9 writes only new reserved integration paths and its three evidence documents; this planner writes only `plan9.md`.
- [x] P8 implementation completion remains a worker prerequisite; old baseline failures and historical Phase 1 results are not reused as current acceptance.
- [x] Real SDK transport/output validation and actual provider parsing supplement assembled HTTP; no public MCP or new dependency.
- [x] Production request counting is restored before assembled measurements; skipped native discovery is not RED/PASS and authorization gates are explicit.
- [x] Browser fixture source, Node SSR, real browser/AT and live Google behavior are distinguished; missing P7 browser scenarios remain named gaps.
- [x] Source-owner defects route to owners, migration executable/invalidation are not invented, package checks are sequential and review remains skipped.

### Planner validation actually performed

- Acceptance/ownership/link/task checks: all 14 criteria mapped, 2 existing local prose links resolved, 10 task headings/references consistent, 11 proposed code files inside P9 ownership, 86 balanced fence markers, no unresolved template markers. Embedded future evidence-document examples were not treated as already-created link targets.
- In-memory TypeScript validation of the 13 TypeScript blocks assembled into their 11 proposed files: syntax checks passed and **0 diagnostics in those virtual files** against the installed source/types. No virtual file was written to disk; this is plan snippet compatibility, not execution of the proposed tests or a package build.
- Plan-specific whitespace: no trailing whitespace; final newline present. A final repository-wide `git diff --check` returned exit 1 for `backend/test/assembly/calendar-capability.spec.ts:283: new blank line at EOF` while P8 was editing its owned files concurrently. That is not a plan-file failure; P9 did not modify or repair it. Recheck after P8 commits.
- Exact executed application-check subset remains the backend **5 files / 51 passed** and frontend Node **3 files / 20 passed** commands recorded above. No other test class or full-package result is claimed. No staging or commit was performed by this planner.
