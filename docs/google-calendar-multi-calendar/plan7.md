# P7 — Calendar picker, client/state, and truthful chat target UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use executing-plans and test-driven-development to implement this plan task-by-task. Remain the assigned P7 worker; do not dispatch another agent or reviewer. Track the checkbox steps below. Obtain the orchestrator's exclusive commit slot before each named-file commit.

**Goal:** Connect without copying a target ID, browse bounded discovered calendars, save/reset an optional default safely, and display truthful server-issued clarification and durable target receipts without losing drafts or changing unrelated chat behavior.

**Architecture:** Extend the existing Calendar protocol/client, setup reducer/panel, and Calendar turn region; isolate the native paged default controls in one Calendar-only presentational component. Connection controls, discovery reads/refresh, and preference writes remain separate requests; server revisions and durable operation evidence, never the picker or model prose, determine authority and receipt labels. Preserve legacy wire decoding and the existing composer-based natural-language reply path; do not invent an approval endpoint or browser authorization.

**Tech Stack:** Existing React 19.2, TypeScript 6, Vite 8, Node-environment Vitest 4, React DOM server rendering, native fetch/AbortController/DOM controls and development-only browser fixtures. Node `^22.22.3 || ^24.15.0 || >=26.0.0`; no new dependency, manifest change, DOM test framework, or live Google/model/OAuth action.

---

## Prerequisites, ownership, and source reconciliation

Read the approved `goal.md`, current `state.md` (especially P7 and its exit gate), `research.md`, P1/P4 handoffs, root `AGENTS.md`, and the actual frontend/upstream source. Inspected baseline: `51b350f`, including completed P1–P5 workers. Research's suggestions to fall back from an unavailable saved default, require confirmation for every create, and use alternative settings routes are superseded by the approved goal and committed contracts. The approved precedence is explicit → saved override → primary; multiple calendars alone do not imply a clarification. Unified review remains **skipped**, not passed.

The planner writes only this file and does not stage/commit. The worker has these exact planned source/test writes:

| Path | Responsibility |
| --- | --- |
| `frontend/src/api/calendar-protocol.ts`, `calendar-protocol.test.ts` | v2 status/discovery/settings, v3 streams, compatible historical receipt validation |
| `frontend/src/api/calendar-client.ts`, `calendar-client.test.ts` | Cached paging, explicit refresh, independent CAS preference writes and safe error handling |
| `frontend/src/features/plugins/google-calendar/calendar-setup-state.ts`, `calendar-setup-state.test.ts` | Bounded page/draft state, revision/response fencing, rollback and clear user messages |
| New `frontend/src/features/plugins/google-calendar/CalendarDefaults.tsx`, `calendar-defaults.test.ts` | Native accessible paged radio picker, role/capability/freshness/default presentation |
| `frontend/src/features/plugins/google-calendar/GoogleCalendarPanel.tsx`, `google-calendar-panel.test.ts` | No-ID Connect and abortable request orchestration; reuse existing disconnect flow |
| `frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx`, `calendar-turn-region.test.ts` | Durable target badges, clarification/coverage/conflict display, metadata expiry |
| New `frontend/src/features/plugins/google-calendar/testing/multi-calendar-fixtures.ts` | Small shared deterministic values for owned unit/browser fixtures, not a new test framework |
| `frontend/src/features/plugins/google-calendar/testing/calendar-browser.tsx`, `calendar-browser.html` | Actual local DOM/interaction evidence, using mocked fetch only |
| `frontend/src/features/plugins/google-calendar/calendar-plugin.css` | Scoped layout, wrapping and focus-visible styles for new controls only |
| `frontend/src/features/chat/state/chat-types.ts`, `chat-reducer.ts`, `use-chat.ts` | Calendar-specific stream/action state and stale-event fencing only |
| New `frontend/src/features/chat/state/calendar-chat-state.test.ts` | Focused Calendar reducer/projection regression checks |

No other file is implicitly writable. In particular, **do not modify any `integration-tests/**`, `frontend/src/api/protocol.ts`, `frontend/src/api/client.ts`, backend source, shared manifests, App/admin shell, composer, voice, canvas, minimap, or another phase's records**. Read-only regression suites outside P7 remain intact. Every new code/test file needs the repository's full filename/location/purpose/role/components banner; existing files changed >30% need that banner too. Snippets omit only the repeated banner and unchanged surrounding source.

### Actual interfaces to consume

Source of truth: `backend/src/contracts/calendar-wire.ts`, `calendar-discovery.ts`, `calendar-operations.ts`, P4 `controller.ts`, `connection.ts`, `discovery.ts` and `options.ts`.

| Request | Exact request/response |
| --- | --- |
| `GET /api/plugins/google-calendar/status` | Current controller returns status **protocolVersion 2**, without `targetCalendarId` |
| `GET /api/plugins/google-calendar/calendars` | Optional one encoded `pageToken` (1–2048 characters); `{protocolVersion:2,page}`; cache-only, not a Google refresh |
| `POST /api/plugins/google-calendar/calendars/refresh` | `{expectedConnectionRevision: positive integer}`; same bounded page response; mutation CSRF boundary |
| `PATCH /api/plugins/google-calendar/settings` | `{enabled?:boolean,defaultSetting?:{calendarId:string|null,expectedRevision:positive integer,expectedConnectionRevision:positive integer}}`; at least one field; returns v2 status |
| `POST /oauth/start` | Existing empty object; no calendar ID, identity, approval or credentials |
| Disconnect | Existing local/project-wide-revocation request and separate revocation outcome, unchanged |
| v2 status | Existing state/enabled/accountEmail/disclosure plus `connectionRevision:number|null`, `defaultSetting:{defaultCalendarId:string|null,defaultSettingRevision:number}|null`, `primaryCalendarId:string|null`, `discovery:{discoveryRevision,fetchedAt,expiresAt,complete,truncated,stale}|null`, `missingScopes:string[]` (≤5) |
| Calendar page | `{schemaVersion:2,tool:'calendar_list_calendars',calendars:entry[],discoveryRevision,fetchedAt,expiresAt,complete,truncated,nextPageToken:string|null,limitations:limitation[]}`; ≤20 entries and ≤15,360 encoded bytes, wrapper ≤16,384 |
| Entry | `{calendarId,label,primary,accessRole,privateAccess,timeZone:string|null,selected,hidden,deleted,capabilities:{readEvents,createEvents,availability}}`; IDs ≤1024 and not `primary`; labels ≤200; timezone ≤100 |
| Roles | `owner`, `writer`, `writerWithoutPrivateAccess`, `reader`, `freeBusyReader`; use server capabilities, not role alone, to enable a creation-default choice |
| Limitations | `page-limit`, `calendar-limit`, `byte-limit`, `provider-error`, `unsupported-entry`, `primary-missing`, `stale` (≤7) |
| v3 SSE | `protocolVersion:3`; ordinary stream/progress events, a schemaVersion-2 Calendar operation, or `{type:'calendar-clarification',proposalId,expiresAt,reason:'target'|'details'|'conflict'|'coverage',message,candidates:[{calendarId,label,role}]}` (≤20 candidates, message ≤1000) |
| v2 operation payload | `schemaVersion:2`, existing operation/narration/retry/receipt fields; states add `failed` and `cancelled`; receipt adds **`calendarLabel:string|null`**, not a raw target ID or account |

Status/default revisions and discovery revisions have different purposes. `defaultSettingRevision` is used as `expectedRevision` for preference CAS. Never substitute it for `expectedConnectionRevision`; never invent either for v1 status. A complete discovery **snapshot** may have a non-null **UI page** token; do not mark it incomplete just because more retained entries are on another page. Partial/truncated results and missing primary are legitimate, not malformed responses. An absent saved default on the first page does not establish loss of access.

### Interface gaps to report, not fix across ownership

1. **Shared frontend submit/retry protocol blocks v3.** `frontend/src/api/protocol.ts` types and validators admit only `calendarProtocol:2`; `client.ts` uses those validators. Backend P1 admits 2/3, but P8 `backend/src/http/chat-http.service.ts` still rejects values other than 2 when Calendar is enabled. P7 may parse/fixture v3 now. Switching the two Calendar negotiation literals in owned `use-chat.ts` is gated on an orchestrator-assigned owner adding shared frontend protocol-3 support and P8 admitting/routing v3. Do not cast `3 as 2`, omit negotiation, fork generic transport, or pretend v2 carries v3 clarification. Task 8 records this gate.
2. **Assembled calendar GETs remain blocked until P8.** Existing `controller-http.ts` rejects non-callback queries and admits only status GET. Direct P4 routes are implemented; P8 must admit cached calendars GET and its strict page query under the existing local security boundary. P7 client fixtures are not assembled HTTP evidence.
3. **P4 refresh response has a paging discrepancy.** `refreshCalendars` builds its first page with `entries.slice(0,20)` and `currentDiscovery.nextPageToken` (provider discovery continuation), whereas `discoveryService.page()` creates signed Aurvin offset tokens. A complete 21-entry refresh may therefore advertise no UI continuation; a truncated provider token is not an Aurvin page token. After refresh, discard its token/rows as navigation authority and explicitly GET cached page one, then status; only that GET supplies UI continuation. Report this to P4/P8; do not patch their files or parse provider tokens.
4. **CAS errors are intentionally generic on the public wire.** P4 maps settings conflict to HTTP 409 / `CONFLICT_ACTIVE_TURN`, not `CALENDAR_SETTINGS_CONFLICT`. For a preference write, interpret 409 as concurrent-settings/setup conflict, reload status/page, restore the confirmed selection and require another deliberate save. Do not auto-retry/overwrite or demand a new wire error code.
5. **No structured reply endpoint or history proposal projection is frozen.** Use the existing composer for normal natural-language follow-ups; render candidate IDs only as inert disambiguating text, never manufacture an approval flag. P6 must emit the frozen clarification envelope and durable receipt label; P8 must project v2 status/history. Existing visible-message history does not expose Calendar receipts, so do not synthesize old badges from assistant text. If reload/history restoration is required beyond current turn-status/SSE, report its missing transport projection to P6/P8/P1 rather than adding a browser cache.
6. **No discovery retention-expiry field reaches the browser.** `expiresAt` is freshness, not a client claim of indefinite retention. Keep Calendar metadata in memory only, clear it on disconnect/account-authority change/unmount, and conservatively hide cached entry names/choices at freshness expiry until another server read/refresh. Preserve only confirmed default settings and non-content freshness diagnostics. A v2 receipt's single `expiresAt` gates both its link and label; P6/P8 must project a deadline no later than either source-content deadline.

These gaps do not justify edits outside ownership or a false full exit. Unblocked setup/client/unit work can proceed; end-to-end v3 acceptance is explicitly pending until owners land their interfaces.

## Task 1: Add strict compatible status, calendar-page, and settings protocols

**Files:** modify `frontend/src/api/calendar-protocol.ts`, `calendar-protocol.test.ts`; create `frontend/src/features/plugins/google-calendar/testing/multi-calendar-fixtures.ts`.

- [ ] **Write deterministic fixtures and failing tests.** Keep legacy `CalendarPublicStatus`/`CalendarTurnState` source compatibility by naming old shapes `CalendarLegacyPublicStatus` / `CalendarLegacyTurnState`, then exporting compatible unions. Introduce these exact v2 types before using them below: `CalendarPublicStatusV2`, `CalendarDiscoveryEntry`, `CalendarCalendarPage`, `CalendarCalendarsResponse`. The fixture file exports:

```ts
import type { CalendarPublicStatusV2, CalendarDiscoveryEntry,
  CalendarCalendarsResponse } from '../../../../api/calendar-protocol.ts';

export function calendarEntry(
  patch: Partial<CalendarDiscoveryEntry> = {},
): CalendarDiscoveryEntry {
  return { calendarId: 'team@example.com', label: 'Team', primary: false,
    accessRole: 'writer', privateAccess: true, timeZone: 'Europe/London',
    selected: true, hidden: false, deleted: false,
    capabilities: { readEvents: true, createEvents: true, availability: true },
    ...patch };
}
export function multiStatus(
  patch: Partial<CalendarPublicStatusV2> = {},
): CalendarPublicStatusV2 {
  return { protocolVersion: 2, state: 'connected', enabled: true,
    accountEmail: 'operator@example.com', processingDisclosure: {
      policyId: 'policy-local-1',
      processors: 'Google, OpenRouter and the configured model provider',
      dataCollection: 'deny' }, connectionRevision: 3,
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 7 },
    primaryCalendarId: 'primary-canonical@example.com', discovery: {
      discoveryRevision: 11, fetchedAt: '2026-10-24T10:00:00.000Z',
      expiresAt: '2026-10-24T10:05:00.000Z', complete: true,
      truncated: false, stale: false }, missingScopes: [], ...patch };
}
export function calendarPage(
  patch: Partial<CalendarCalendarsResponse['page']> = {},
): CalendarCalendarsResponse {
  return { protocolVersion: 2, page: { schemaVersion: 2,
    tool: 'calendar_list_calendars', calendars: [calendarEntry()],
    discoveryRevision: 11, fetchedAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:05:00.000Z', complete: true,
    truncated: false, nextPageToken: null, limitations: [], ...patch } };
}
```

Add to the existing protocol suite, importing these factories:

```ts
it('accepts no-ID v2 status and independent default CAS without enablement', () => {
  expect(isCalendarPublicStatus(multiStatus())).toBe(true);
  expect(isCalendarSettingsRequest({ defaultSetting: {
    calendarId: 'team@example.com', expectedRevision: 7,
    expectedConnectionRevision: 3 } })).toBe(true);
  expect(isCalendarSettingsRequest({ defaultSetting: {
    calendarId: null, expectedRevision: 7,
    expectedConnectionRevision: 3 } })).toBe(true);
  expect(isCalendarSettingsRequest({})).toBe(false);
  expect(isCalendarSettingsRequest({ defaultSetting: {
    calendarId: 'primary', expectedRevision: 7,
    expectedConnectionRevision: 3 } })).toBe(false);
  expect(isCalendarSettingsRequest({ enabled: true, userId: 'spoof' })).toBe(false);
  expect(isCalendarPublicStatus({ ...multiStatus(), accessToken: 'secret' })).toBe(false);
});
it('bounds pages without confusing snapshot completeness with page continuation', () => {
  expect(isCalendarCalendarsResponse(calendarPage({ nextPageToken: 'signed.opaque' }))).toBe(true);
  expect(isCalendarCalendarsResponse(calendarPage({ complete: false, truncated: true,
    limitations: ['calendar-limit', 'primary-missing'] }))).toBe(true);
  expect(isCalendarCalendarsResponse(calendarPage({ calendars:
    Array.from({ length: 21 }, (_, i) => calendarEntry({ calendarId: `cal-${i}` })) }))).toBe(false);
  expect(isCalendarCalendarsResponse(calendarPage({ calendars:
    [calendarEntry(), calendarEntry()] }))).toBe(false);
  expect(isCalendarCalendarsResponse(calendarPage({ calendars: [calendarEntry({
    accessRole: 'reader', privateAccess: false,
    capabilities: { readEvents: true, createEvents: true, availability: true } })] }))).toBe(false);
});
```

- [ ] **Run red**, cwd `frontend`: `npm test -- src/api/calendar-protocol.test.ts -t "accepts no-ID"` and `npm test -- src/api/calendar-protocol.test.ts -t "bounds pages"`. Expected: missing types/guard or rejection of v2, not a skipped suite.
- [ ] **Implement the minimum compatible types/guards.** Preserve all legacy URL/callback/secret checks and constants; add `CALENDAR_STATUS_PROTOCOL_V2 = 2`, `CALENDAR_STREAM_PROTOCOL_V2 = 3`, `calendars` and `calendarsRefresh` routes. Do not change the old constants 1/2 and thereby break historical fixtures. Define v2 status exactly as the table. Define page/entry/limitation shapes exactly as the table; export `CalendarSettingsRequest` with optional `enabled` and optional strict `defaultSetting`; add `CalendarRefreshRequest` and `isCalendarRefreshRequest`.

Use these small primitives alongside existing `isRecord`, `hasExactKeys`, `isIsoDate`:

```ts
function isPositiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function isCalendarId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024
    && value !== 'primary' && !CONTROL_CHARS.test(value);
}
function withinBytes(value: unknown, cap: number): boolean {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= cap; }
  catch { return false; }
}
```

For settings require only allowed keys, ≥1 actual field, booleans/revisions with correct types, explicit nullable canonical ID, and all three nested keys. Reject an own property with `undefined`; it must not serialize into an empty mutation. `isCalendarPublicStatus` branches on version and exact keys; v2 connected+nonempty missingScopes is invalid. Entry validation enforces five roles, private masking for reader/freeBusyReader/writerWithoutPrivateAccess, no event-read for freeBusyReader, no create for non-writer roles, and hidden/deleted ⇒ all capabilities false. Unknown roles/fields fail closed, not default to writer. Page validation enforces ≤20 unique canonical IDs, ≤1 primary, bounded strings/tokens/limitations, `0 <= expires-fetched <= 300000`, complete ⇒ !truncated and no limitations, and page/wrapper encoded byte caps. Do not require primary on every page. Do not forbid `complete:true,nextPageToken:non-null`.
- [ ] **Extend boundary tests and run green.** Add data-driven cases for all five roles, missing/partial grants, null discovery/default, no primary in partial page, wrong role/private capability combinations, malformed dates, 0/fractional/negative revisions, nested extras, 2048/2049 tokens, 200/201 labels, 20/21 candidates later, control characters, and multibyte payloads just over 15,360 bytes despite fewer characters. Run `npm test -- src/api/calendar-protocol.test.ts` and keep existing v1/v2 assertions green.
- [ ] **Commit after permission:**

```powershell
git add frontend/src/api/calendar-protocol.ts frontend/src/api/calendar-protocol.test.ts frontend/src/features/plugins/google-calendar/testing/multi-calendar-fixtures.ts
git commit -m "feat(calendar-ui): add bounded multi-calendar setup protocol"
```

## Task 2: Add cached paging and explicit refresh to the existing client

**Files:** modify `frontend/src/api/calendar-client.ts`, `calendar-client.test.ts`.

- [ ] **Write failing client assertions.** Import `multiStatus` / `calendarPage` and `vi` into the existing suite:

```ts
it('encodes one calendar page token and keeps preference saves independent', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(calendarPage()))
    .mockResolvedValueOnce(Response.json(multiStatus()))
    .mockResolvedValueOnce(Response.json(calendarPage()));
  const client = createCalendarClient({ baseUrl: '/api', fetch: fetcher });
  await client.listCalendars({ pageToken: 'a+b/c= d' });
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    '/api/plugins/google-calendar/calendars?pageToken=a%2Bb%2Fc%3D+d');
  await client.updateSettings({ defaultSetting: { calendarId: null,
    expectedRevision: 7, expectedConnectionRevision: 3 } });
  const settings = fetcher.mock.calls[1]?.[1];
  expect(JSON.parse(String(settings?.body))).toEqual({ defaultSetting: {
    calendarId: null, expectedRevision: 7, expectedConnectionRevision: 3 } });
  expect(settings?.headers).toEqual(expect.objectContaining({
    [CALENDAR_CSRF_HEADER]: CALENDAR_CSRF_VALUE }));
  await client.refreshCalendars({ expectedConnectionRevision: 3 });
  expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: 'POST',
    body: '{"expectedConnectionRevision":3}' });
});
it('returns a conflict without retrying or echoing an untrusted server message', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({
    code: 'CONFLICT_ACTIVE_TURN', message: 'provider secret payload', retryable: true,
  }, { status: 409 }));
  const client = createCalendarClient({ fetch: fetcher });
  await expect(client.updateSettings({ defaultSetting: { calendarId: 'team@example.com',
    expectedRevision: 7, expectedConnectionRevision: 3 } })).rejects.toMatchObject({
      status: 409, code: 'CONFLICT_ACTIVE_TURN', retryable: false });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await client.getStatus().catch((error: CalendarClientError) => {
    expect(error.message).not.toContain('secret payload');
  });
});
```

- [ ] **Run red:** `npm test -- src/api/calendar-client.test.ts -t "encodes one"`; expected missing method. Then run `-t "returns a conflict"`; expected raw message/incorrect retry policy.
- [ ] **Implement through the current bounded `send`, not a second fetch stack.** To retain read-only historical integration fixtures whose mock `CalendarClient` has only four methods, add optional discovery methods to that interface; the actual factory returns `CalendarMultiClient`, which makes both required. Optional methods are only a legacy-injected-client compatibility seam; a v2 panel without them reports unavailable discovery, never fabricated success.

```ts
// Add to CalendarClient:
listCalendars?(query?: { pageToken?: string }, signal?: AbortSignal):
  Promise<CalendarCalendarsResponse>;
refreshCalendars?(request: CalendarRefreshRequest, signal?: AbortSignal):
  Promise<CalendarCalendarsResponse>;
// Export and use as createCalendarClient's return type:
export type CalendarMultiClient = CalendarClient & Required<Pick<CalendarClient,
  'listCalendars' | 'refreshCalendars'>>;
```

Add these actual returned methods (import the Task 1 types/guards):

```ts
async listCalendars(query = {}, signal) {
  if (Object.keys(query).some(key => key !== 'pageToken') ||
      (Object.hasOwn(query, 'pageToken') && (typeof query.pageToken !== 'string' ||
        query.pageToken.length < 1 || query.pageToken.length > 2048))) {
    throw new CalendarClientError({ code: 'INVALID_REQUEST' });
  }
  const search = query.pageToken === undefined ? ''
    : `?${new URLSearchParams({ pageToken: query.pageToken })}`;
  return send('GET', `${CALENDAR_API_ROUTES.calendars}${search}`, undefined,
    isCalendarCalendarsResponse, signal);
},
async refreshCalendars(request, signal) {
  if (!isCalendarRefreshRequest(request)) {
    throw new CalendarClientError({ code: 'INVALID_REQUEST' });
  }
  return send('POST', CALENDAR_API_ROUTES.calendarsRefresh, request,
    isCalendarCalendarsResponse, signal);
},
```

Keep existing 20-second timeout, byte-bounded fatal UTF-8 reader, no-store, same-origin credentials, redirect:error and mutation CSRF for every method. Settings' nested calendar selector is allowed by its strict guard, not by removing identity protections. A preference PATCH requires a v2 status acknowledgement; reject a v1 success response as an invalid/unconfirmed mutation response instead of pretending it confirms a saved default. Map public error **code/status** to local safe copy; do not expose arbitrary payload messages or retryable hints. Allowed diagnostic copies: 409 concurrent change, 400 invalid/unavailable selection, 429 rate limit, 503 setup/reconnect unavailable, 504 timeout, `PERSISTENCE_ERROR` save unconfirmed. Use `uncertain:true` for transport/timeout/aborted mutation, invalid success payload and `PERSISTENCE_ERROR`; do not claim save failure proves no write. Never retry a mutation automatically.
- [ ] **Run green plus negative transport checks.** Add tests for cached GET issuing no POST, refresh POST body/CSRF, empty/overlong tokens/unknown query keys rejected before fetch, disabled-only PATCH omitting `defaultSetting`, default-only PATCH omitting `enabled`, missing revisions, forbidden identity/credentials, malformed and oversize UTF-8, unsafe OAuth redirect, passed abort signal, timeout with fake timers restored in `finally`, safe 409 and ambiguous acknowledgement. Run `npm test -- src/api/calendar-client.test.ts src/api/calendar-protocol.test.ts`.
- [ ] **Commit after permission:**

```powershell
git add frontend/src/api/calendar-client.ts frontend/src/api/calendar-client.test.ts
git commit -m "feat(calendar-ui): add cached pages refresh and CAS settings client"
```

## Task 3: Make setup state bounded, race-safe, and non-optimistic

**Files:** modify `frontend/src/features/plugins/google-calendar/calendar-setup-state.ts`, `calendar-setup-state.test.ts`.

- [ ] **Write failing reducer checks.** Add the following state/action members before implementing cases; existing actions remain supported for historical setup tests:

```ts
// CalendarSetupState additions:
requestId: number;
listPhase: 'idle' | 'loading' | 'ready' | 'error';
page: CalendarCalendarPage | null;
entries: CalendarDiscoveryEntry[]; // unique known entries, maximum 100
seenPageTokens: string[]; // maximum 100; no automatic fetch loop
listError: string | null;
draftCalendarId: string | null;
settingsUnconfirmed: boolean;
// Extend pending with 'save-default' | 'refresh'; add these CalendarSetupAction variants:
| { type: 'requestStarted'; requestId: number;
    pending: CalendarSetupState['pending']; listLoading?: boolean }
| { type: 'statusReceived'; requestId: number; status: CalendarPublicStatus }
| { type: 'pageReceived'; requestId: number; response: CalendarCalendarsResponse;
    requestedToken: string | null; connectionRevision: number }
| { type: 'selectDefault'; calendarId: string | null }
| { type: 'defaultSaved'; requestId: number; status: CalendarPublicStatus }
| { type: 'requestFailed'; requestId: number; message: string;
    resetDraft: boolean; listOnly?: boolean; unconfirmed?: boolean }
| { type: 'discoveryExpired'; discoveryRevision: number }
```

```ts
it('keeps confirmed settings until save and rolls back only the failed draft', () => {
  let state = createInitialCalendarSetupState(multiStatus());
  state = calendarSetupReducer(state, { type: 'selectDefault', calendarId: 'team@example.com' });
  expect(state.status).toEqual(multiStatus());
  state = calendarSetupReducer(state, { type: 'requestStarted', requestId: 1,
    pending: 'save-default' });
  state = calendarSetupReducer(state, { type: 'requestFailed', requestId: 1,
    message: 'Default save could not be confirmed. Reload before saving again.',
    resetDraft: true, unconfirmed: true });
  expect(state.draftCalendarId).toBeNull();
  expect(state.status?.enabled).toBe(true);
  expect(state.error).toContain('could not be confirmed');
  expect(state.settingsUnconfirmed).toBe(true);
});
it('ignores stale pages and never resurrects a replaced connection', () => {
  let state = createInitialCalendarSetupState(multiStatus());
  state = calendarSetupReducer(state, { type: 'requestStarted', requestId: 1, pending: null });
  state = calendarSetupReducer(state, { type: 'requestStarted', requestId: 2, pending: null });
  state = calendarSetupReducer(state, { type: 'statusReceived', requestId: 2,
    status: multiStatus({ connectionRevision: 4, discovery: null }) });
  const current = state;
  expect(calendarSetupReducer(state, { type: 'pageReceived', requestId: 1,
    connectionRevision: 3, requestedToken: null, response: calendarPage() })).toBe(current);
  expect(state.entries).toEqual([]);
});
```

- [ ] **Run red:** `npm test -- src/features/plugins/google-calendar/calendar-setup-state.test.ts -t "keeps confirmed"`; expected old reducer does not rollback/track draft. Then `-t "ignores stale"`.
- [ ] **Implement only pure transitions.** Initialize extra state with requestId 0, `settingsUnconfirmed:false`, empty bounded cache/list state and confirmed v2 default or null (not legacy target). `requestStarted` requires an increasing ID, sets the new ID and phase but never optimistically changes status/default/enabled. Response/failure cases return the original state when `requestId !== state.requestId`. `statusReceived` compares version and `connectionRevision`; on changed authority/disabled/disconnected/reconnect clear cached entries/page/tokens. It sets the confirmed status and clears `settingsUnconfirmed`; preserve a dirty preference draft only for the same authority and a list/status-only read. `defaultSaved` resets the draft to the server-confirmed default, clears `settingsUnconfirmed` and announces saved/reset; no connection-revision invention. `requestFailed` with `unconfirmed:true` sets that flag until a successful accepted status read/save.

Implement these invariants directly in reducer cases:

```ts
// Response fence before interpreting a page:
if (action.requestId !== state.requestId || state.status?.protocolVersion !== 2 ||
    action.connectionRevision !== state.status.connectionRevision) return state;
const oldRevision = state.page?.discoveryRevision;
if (oldRevision !== undefined && action.response.page.discoveryRevision < oldRevision) return state;
// A continuation belongs to one snapshot; never merge across revisions.
if (action.requestedToken !== null && oldRevision !== action.response.page.discoveryRevision) {
  return { ...state, pending: null, listPhase: 'error',
    listError: 'Calendar list changed. Refresh or reload the first page.' };
}
```

For a first page clear previous page-token history and replace known entries. For a continuation reject reused token, >100 page visits, duplicate entries with contradictory metadata, or >100 retained unique IDs; report a bounded-list error rather than append/drop silently. Before accepting the next state also require `new TextEncoder().encode(JSON.stringify({entries,page,seenPageTokens})).byteLength <= 262144`; the combined in-memory discovery data, not just individual responses, is bounded. If it would overflow, retain the previous bounded state and report “The local calendar list limit was reached; refresh or use a narrower available selection.” Do not silently raise the ceiling or claim complete client traversal. Append entries immutably by canonical ID, display only the returned page, and preserve the draft across pagination. `complete` describes snapshot coverage, not whether all UI pages are loaded. An absent saved ID remains stored/unverified until all pages of a complete snapshot are known; never reset to automatic. Empty partial results do not establish that no writable calendar exists. `requestFailed(resetDraft:true)` restores the confirmed default (or null), preserving enablement; `listOnly:true` preserves connection state and separate mutation error. `discoveryExpired` clears page entries/labels and makes refresh required only when the revision matches, keeping non-content times/revision in status. Known saved ID settings are not an authorization cache.

Update existing connection/OAuth copy to remove owned-calendar/configured-target claims; preserve fixture-vs-live, single-user, project-wide-revocation and ordinary-text-chat distinctions. Reconnect with missingScopes means additional permissions are required, even when disabled masks the top-level state. Do not print arbitrary scope strings as an instruction; show static labels for the three known Calendar permissions and a generic permission notice for other allowed identifiers.
- [ ] **Run green and expand race matrix.** Test partial→complete, complete→failed refresh keeping confirmed status, fresh→expired, older discovery revision, changed revision during continuation, duplicate/repeated tokens, bounded cache/page visits, rights loss on saved default, absent saved ID before/after final complete page, dirty draft retained on list-only reads, rollback after 400/409/uncertain write, default-only save preserving enabled:false, disable/disconnect clearing metadata, and late failure not overwriting a newer success. Run `npm test -- src/features/plugins/google-calendar/calendar-setup-state.test.ts`.
- [ ] **Commit after permission:**

```powershell
git add frontend/src/features/plugins/google-calendar/calendar-setup-state.ts frontend/src/features/plugins/google-calendar/calendar-setup-state.test.ts
git commit -m "feat(calendar-ui): fence setup responses and rollback failed defaults"
```

## Task 4: Render a native bounded default picker and honest discovery states

**Files:** create `frontend/src/features/plugins/google-calendar/CalendarDefaults.tsx`, `calendar-defaults.test.ts`; modify `calendar-plugin.css` in that directory.

- [ ] **Write failing static-render tests.** Import `createElement`, `renderToStaticMarkup`, `expect`, `it`, `vi`, Task 1 factories and Task 3 reducer/initializer. Define this local test helper and tests:

```ts
function setupWithPage(response = calendarPage()) {
  let state = createInitialCalendarSetupState(multiStatus());
  state = calendarSetupReducer(state, { type: 'requestStarted', requestId: 1,
    pending: null, listLoading: true });
  return calendarSetupReducer(state, { type: 'pageReceived', requestId: 1,
    connectionRevision: 3, requestedToken: null, response });
}
function renderDefaults(state: CalendarSetupState) {
  return renderToStaticMarkup(createElement(CalendarDefaults, {
    state, disabled: false, nowMs: Date.parse('2026-10-24T10:01:00Z'),
    onSelect: vi.fn(), onSave: vi.fn(), onReset: vi.fn(),
    onRefresh: vi.fn(), onNextPage: vi.fn(),
  }));
}
it('labels native choices with roles while refusing read-only creation defaults', () => {
  const html = renderDefaults(setupWithPage(calendarPage({ calendars: [
    calendarEntry({ label: '<script>untrusted</script>' }),
    calendarEntry({ calendarId: 'holidays', label: 'Holidays', accessRole: 'reader',
      privateAccess: false, capabilities: {
        readEvents: true, createEvents: false, availability: true } }),
  ] })));
  expect(html).toContain('<fieldset');
  expect(html).toContain('<legend>Default calendar for new events</legend>');
  expect(html).toContain('type="radio"');
  expect(html).toContain('Use primary automatically');
  expect(html).toContain('Read-only');
  expect(html).toContain('Cannot create events');
  expect(html).toContain('&lt;script&gt;untrusted&lt;/script&gt;');
  expect(html).not.toContain('<script>');
});
it('reports partial and stale coverage without silently selecting primary', () => {
  let state = setupWithPage(calendarPage({ complete: false, truncated: true,
    limitations: ['calendar-limit', 'primary-missing'], nextPageToken: null }));
  state = { ...state, status: multiStatus({ defaultSetting: {
    defaultCalendarId: 'missing-from-page', defaultSettingRevision: 7 } }),
    draftCalendarId: 'missing-from-page' };
  const html = renderDefaults(state);
  expect(html).toContain('Calendar discovery is incomplete');
  expect(html).toContain('Saved default');
  expect(html).toContain('missing-from-page');
  expect(html).not.toContain('All calendars are available');
  expect(html).not.toMatch(/value=""[^>]*checked/);
});
```

- [ ] **Run red:** `npm test -- src/features/plugins/google-calendar/calendar-defaults.test.ts`; expected missing component.
- [ ] **Implement one pure presentational component with these exact props.** It receives state/actions; it does not fetch, persist, authorize, or import chat/default state from elsewhere:

```ts
export type CalendarDefaultsProps = {
  state: CalendarSetupState;
  disabled: boolean;
  nowMs: number;
  onSelect: (calendarId: string | null) => void;
  onSave: () => void;
  onReset: () => void;
  onRefresh: () => void;
  onNextPage: () => void;
};
```

Use `useId()` for labels/help, a real `<fieldset><legend>`, automatic-primary radio and ≤20 entry radios from `state.page.calendars`, plus existing-style native buttons. A paged radio list avoids an unbounded dropdown and does not require a custom keyboard/listbox implementation. Keep a separate textual “Selected for save” summary when the dirty selection is on another loaded page; never replace it on pagination. Use the canonical ID as the React key and radio value, not display name; duplicate names display ID/timezone/role as safe inert disambiguation. Preserve the server primary flag; do not compare the account email to the ID.

Core row shape (in the component's return):

```tsx
<label className="aurvin-calendar-choice" key={entry.calendarId}>
  <input type="radio" name={`${ids}-default`} value={entry.calendarId}
    checked={state.draftCalendarId === entry.calendarId}
    disabled={disabled || !fresh || !canChoose || !entry.capabilities.createEvents
      || entry.hidden || entry.deleted}
    onChange={() => onSelect(entry.calendarId)} />
  <span>
    <strong>{entry.label}</strong>{entry.primary ? ' · Primary' : ''}
    <span className="aurvin-calendar-choice-meta">{entry.calendarId}</span>
    <span>{roleLabels[entry.accessRole]}</span>
    {!entry.capabilities.createEvents ? <span> · Cannot create events</span> : null}
    {!entry.privateAccess ? <span> · Private details are masked</span> : null}
  </span>
</label>
```

Define `roleLabels` in this component file as owner→`Owner`, writer→`Shared writer`, writerWithoutPrivateAccess→`Shared writer (private details masked)`, reader→`Read-only`, freeBusyReader→`Free/busy only`. The local variables `fresh`, `canChoose`, `ids` come from the validated status/page, current clock and `useId`; `canChoose` means v2 + enabled + connected + no missing scopes + both confirmed revisions, not a role-derived browser authorization. A degraded fixture remains explicitly degraded; allow its trusted fake service to demonstrate controls only if it supplies current capabilities and no missing scopes, with fixture disclosure retained. New live functionality never infers readiness from fixture status.

Show fetched/expiry `<time dateTime>` values with meaningful text. Use `page.complete`, `truncated`, `limitations` and `status.discovery.stale` honestly: “Calendar discovery is incomplete”, “Cached list is stale; refresh before choosing a calendar”, “Primary calendar could not be established”, or “Refresh failed; the last confirmed setting is unchanged.” At expiry hide cached entry names/rows, not just re-enable them under a stale badge. Use a manual Refresh button; no effectful GET/status auto-refresh. Present known role/capability reasons and static limitation labels, not raw provider payloads.

“No writable calendars on this page” is different from “No writable calendars were discovered.” Use the latter only after all retained pages of a **complete** snapshot have been loaded and `state.entries` has no writable entry. On partial results append “Discovery is incomplete; other calendars may be missing.” If a saved ID is absent from only the current page say “Saved default is not on this page; its current access is unverified.” After fully loaded complete discovery or a known rights loss say “Saved default is unavailable or no longer writable. Choose another calendar or reset it.” Keep the stored ID selected in state; never auto-select primary.

Save is disabled for unchanged/invalid/non-writable/stale draft, pending operation, missing revisions or reconnect; it only signals `onSave`. Reset says “Use primary automatically”/“Reset to primary automatically”, signals `onReset`, and sends null even when primary is presently missing (clear the preference, do not claim creation is possible). Disabled Calendar may clear an existing preference without enabling it; do not offer non-null saves while disabled because P4 rejects them. Refresh likewise requires a connected enabled account; enable/disable and disconnect remain usable independently of preference validity. A legacy status shows an upgrade/reconnect notice, not fake v2 revisions.

Add scoped CSS only:

```css
.aurvin-calendar-defaults { min-width: 0; border: 1px solid var(--aurvin-border); }
.aurvin-calendar-choice { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; }
.aurvin-calendar-choice > span { min-width: 0; overflow-wrap: anywhere; }
.aurvin-calendar-choice-meta { display: block; font-size: 12px; color: var(--aurvin-text-secondary); }
.aurvin-calendar-defaults :is(input, button):focus-visible {
  outline: 2px solid var(--aurvin-primary); outline-offset: 3px;
}
.aurvin-calendar-target-badge { overflow-wrap: anywhere; }
```

- [ ] **Run green.** Add SSR cases for loading, empty complete discovery, no writable page versus whole complete set, shared writer/private-masked writer, free/busy-only reason, saved ID off-page, reset without known primary, partial/truncated/stale list, missing scopes even under disabled, pending save/refresh, unsafe names escaped, disabled defaults, complete pages with continuation, and dirty selected summary across pages. Check label/legend/help IDs and `aria-describedby`/busy/status markup; do not call SSR keyboard evidence. Run `npm test -- src/features/plugins/google-calendar/calendar-defaults.test.ts`.
- [ ] **Commit after permission:**

```powershell
git add frontend/src/features/plugins/google-calendar/CalendarDefaults.tsx frontend/src/features/plugins/google-calendar/calendar-defaults.test.ts frontend/src/features/plugins/google-calendar/calendar-plugin.css
git commit -m "feat(calendar-ui): render accessible paged default calendar controls"
```

## Task 5: Wire no-ID Connect, refresh, CAS save/reset, and rollback into the panel

**Files:** modify `frontend/src/features/plugins/google-calendar/GoogleCalendarPanel.tsx`, `google-calendar-panel.test.ts`; extend owned reducer tests only if a new panel transition is necessary.

- [ ] **Write the no-ID failing render test.** Retain existing legacy fixtures/tests and augment the existing mock client with optional multi-calendar methods when testing v2:

```ts
it('offers Connect without a target ID while retaining operator processing setup', () => {
  const status = multiStatus({ state: 'setup-required', enabled: true,
    accountEmail: null, connectionRevision: null, defaultSetting: null,
    primaryCalendarId: null, discovery: null });
  const html = renderToStaticMarkup(createElement(GoogleCalendarPanel, {
    client: mockClient(status), initialStatus: status,
  }));
  expect(html).toContain('Connect Google Calendar');
  expect(html).not.toMatch(/disabled=""[^>]*>Connect Google Calendar/);
  expect(html).not.toContain('disposable owned target calendar ID');
  expect(html).not.toContain('Not configured on server');
  expect(html).toContain('approved processing policy');
});
```

For a reliable disabled assertion also extract the actual Connect opening tag from the rendered button element, rather than relying on attribute order. Add a missing-disclosure variant that still disables Connect; no-ID does not mean zero operator setup.
- [ ] **Run red:** `npm test -- src/features/plugins/google-calendar/google-calendar-panel.test.ts -t "offers Connect"`; expected target-ID access/gating or wrong copy.
- [ ] **Remove only the target-ID prerequisite and old target metadata.** `canStartOAuth` requires available status, configured disclosure, no pending/disabled prop and enabled state (or the existing explicit Enable action), never `targetCalendarId`. Render current saved preference/primary/account metadata for v2; legacy metadata is explicitly “Legacy configured target (requires upgrade)”, not new authority. Tell operators OAuth credentials, exact callback/origin and approved processing policy are server setup; they do not enter IDs/keys in the browser. Keep local single-user/default-off and fixture notices. Mount `CalendarDefaults` with reducer state and actions; do not copy its markup into the panel.
- [ ] **Fence every async handler, including success and `finally`.** Add `requestCounterRef`, `activeRequestRef` (`AbortController|null`) and the unmount/client-change cleanup. Request IDs increase before any await; mark the ref busy synchronously so double click cannot start a second mutation. All reads and mutations use the passed abort signal, guard success/catch/finally with the active ID, and clean up timeouts through existing clients. React effect cleanup aborts **and** invalidates the ID; an abort alone does not make later `.then` safe. Keep `onBusy` balanced on success/failure/unmount. Use React's documented ignore/cleanup pattern for effect fetches; documentation reference checked during planning: `https://react.dev/reference/react/useEffect#fetching-data-with-effects`.

For the save/reset handler, capture confirmed revisions at click time; never derive them from the draft:

```ts
const status = state.status;
if (status?.protocolVersion !== 2 || status.connectionRevision === null ||
    status.defaultSetting === null || inflightRef.current || disabled) return;
const request: CalendarSettingsRequest = { defaultSetting: {
  calendarId: reset ? null : state.draftCalendarId,
  expectedRevision: status.defaultSetting.defaultSettingRevision,
  expectedConnectionRevision: status.connectionRevision,
} };
// updateSettings(request, controller.signal), then defaultSaved for this request ID.
// No enabled property; do not send connection identity, approval or account fields.
```

Implement one nested `readCachedPage(requestId, controller, requestedToken)` helper for repeated page reads. It calls `getStatus(signal)`, accepts only the current request ID, then optional `listCalendars(query,signal)` for an eligible v2 account, then dispatches `pageReceived` with the **captured** connection revision. Re-read status once after receiving a page before accepting it if the prior request performed a mutation/refresh; reject changed authority/discovery rather than splice old rows. Never let page metadata silently override a newer status default. Do not fetch every page; only one page per user load-next action.

Refresh handler sequence:

```ts
await client.refreshCalendars!({ expectedConnectionRevision: capturedRevision }, signal);
// The POST is not a UI-page cursor authority (reported P4 discrepancy).
// Re-read GET status and GET calendars with NO pageToken through readCachedPage.
// Their signed cached-page continuation is the only next-page token the UI uses.
```

If refresh returns/fails partial, keep the last confirmed default and show explicit failed/incomplete refresh feedback; read cached status/page to show what the server still retains. Do not mark an old complete snapshot fresh or advance its timestamps after a failed refresh. `refresh` and `load-next` errors go to `listError`, not to a false disconnected state. If metadata expired, read/refresh again only following an explicit action; one timer at the returned expiry may update presentation/clear cached names but must not issue a POST.

Preference failure handling: definite 400 rolls back to confirmed selection with invalid/unavailable message; 409 reloads confirmed status/first page, resets selection to the winning default and says “Settings changed elsewhere. Review the current default and save again.” Uncertain transport/ack failure says “Default save could not be confirmed. Reload before saving again.” Dispatch Task 3's `requestFailed` with `unconfirmed:true`; reload once for reconciliation. If it fails, keep the last confirmed display but disable preference saves while `settingsUnconfirmed` remains true. Never auto-retry the PATCH or report the old value as certainly still stored. Status reads that succeed after an uncertain save show the actual current setting without claiming an unreceived acknowledgement.

Enable/disable calls stay `{enabled:boolean}` only. On enable/disable status response changes, clear old discovery via the reducer and re-read eligible cached pages; do not save a dirty default as a side effect. Disconnect retains both confirmation modes/required acknowledgement and server revocation distinction. Once disconnect succeeds, immediately invalidate/clear local Calendar rows before the follow-up status read; a failed status reload must not redisplay old connected data. Abort/revision fences prevent a late list/refresh from resurrecting it. Failed connection changes retain confirmed status with unconfirmed/failure copy rather than optimistic success.

Preserve focus on native button/radio during reads/saves; use stable keys, do not remount the whole section on pending. If a disabled/stale removed row held focus, move to Refresh after render, not to an unrelated page field. Escape closes only the existing disconnect confirmation and restores its trigger. Use existing polite `role=status` notices and `role=alert` errors, not repeated announcements on every render. An opened confirmation moves focus to its labelled group/first safe action, without pretending an inline group is a trapped modal.
- [ ] **Run green and reserve actual interaction proof for Task 9.** Run `npm test -- src/features/plugins/google-calendar/google-calendar-panel.test.ts src/features/plugins/google-calendar/calendar-setup-state.test.ts src/features/plugins/google-calendar/calendar-defaults.test.ts`. SSR checks no-ID connect, disclosure gate, reconnect scopes, v1 fallback, no writable/partial state, unchanged disconnect text, and native controls. Task 9 must click these real handlers with deferred fetches to prove rollback/fences; mock function existence/SSR is insufficient.
- [ ] **Commit after permission:**

```powershell
git add frontend/src/features/plugins/google-calendar/GoogleCalendarPanel.tsx frontend/src/features/plugins/google-calendar/google-calendar-panel.test.ts frontend/src/features/plugins/google-calendar/calendar-setup-state.ts frontend/src/features/plugins/google-calendar/calendar-setup-state.test.ts
git commit -m "feat(calendar-ui): connect without target IDs and save defaults safely"
```

## Task 6: Decode v3 clarification and durable target receipts without losing legacy streams

**Files:** modify `frontend/src/api/calendar-protocol.ts`, `calendar-protocol.test.ts`; extend `testing/multi-calendar-fixtures.ts`.

- [ ] **Add exact operation/clarification fixtures and failing guards.** Export `createdOperation` and `clarification` from the owned fixtures:

```ts
export function createdOperation(): CalendarTurnStateV2 {
  return { schemaVersion: 2, operationId: 'op-multi-1', state: 'succeeded',
    narration: 'failed', retryAction: 'none', receipt: { durable: true,
      eventId: 'event12345', htmlLink: 'https://calendar.google.com/calendar/event?eid=event12345',
      expiresAt: '2026-10-24T10:05:00.000Z', calendarLabel: 'Original Team' } };
}
export function clarification(
  patch: Partial<CalendarClarificationEvent> = {},
): CalendarClarificationEvent {
  return { type: 'calendar-clarification', proposalId: 'proposal-1',
    expiresAt: '2026-10-24T10:10:00.000Z', reason: 'conflict',
    message: 'This time overlaps a busy interval. Accept this conflict or choose another time.',
    candidates: [], ...patch };
}
```

Import `CalendarTurnStateV2` and `CalendarClarificationEvent` into that file. Test:

```ts
it('parses v3 clarification and target receipts while enforcing versioned envelopes', () => {
  const envelope = { protocolVersion: 3, sessionId: 'session-1', turnId: 'turn-1',
    attemptId: 'attempt-1', sequence: 2, event: clarification() };
  expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(envelope)}`)).toEqual(envelope);
  expect(isCalendarTurnState(createdOperation())).toBe(true);
  expect(() => parseCalendarCompatibleFrame(`data: ${JSON.stringify({
    ...envelope, protocolVersion: 2 })}`)).toThrow('invalid_stream_envelope');
  expect(isCalendarTurnState({ ...createdOperation(), receipt: {
    ...createdOperation().receipt!, expiresAt: null } })).toBe(false);
  expect(() => parseCalendarCompatibleFrame(`data: ${JSON.stringify({
    ...envelope, event: { ...clarification(), confirmed: true } })}`))
    .toThrow('invalid_stream_envelope');
});
```

- [ ] **Run red:** `npm test -- src/api/calendar-protocol.test.ts -t "parses v3"`; expected unsupported v3 envelope/receipt.
- [ ] **Implement the strict compatible union at the existing parsing seam.** Keep legacy payload shape exact, add `CalendarTurnStateV2` / `CalendarClarificationEvent` as frozen above; rename the old receipt shape to `CalendarLegacyDurableReceipt`, define `CalendarDurableReceiptV2 = CalendarLegacyDurableReceipt & {calendarLabel:string|null}`, and export `CalendarDurableReceipt` as their union. The old turn uses the old receipt shape; the new turn requires the new shape. Extend the exported compatible `CalendarOperationState` type with `failed`/`cancelled`, while the legacy turn/guard keeps only the original six states. Extend `CalendarStreamEvent`, `CalendarCompatibleEnvelope`, and `isCalendarTurnState` to compatible unions. Preserve a separate legacy guard when validating protocol-2 operation events so a new payload cannot be smuggled inside an old envelope. The v3 guard admits only schemaVersion-2 operations, ordinary stream/progress events and the frozen clarification; ≤16,384 encoded bytes total. `isCalendarTurnState` remains what shared `protocol.ts` uses for optional turn-status `calendar`, so broadening that imported guard/type is enough for v2 turn-state status decoding without editing generic transport.

Receipt checks retain succeeded⇔non-null durable receipt, safe links, bounded event ID, expiry for either link or non-null label, exact nullable label ≤200, and no fields for identity/raw provider result/approval. New failed/cancelled states must not be interpreted as succeeded or certainly absent after an ambiguous dispatch. Clarification checks require exact keys, bounded valid proposal ID/expiry/message, four reasons, ≤20 strict canonical-ID/label/role candidates, no authorization fields, no raw tool arguments or private busy-event titles. Unknown reason/version/state fails closed. Keep legacy statuses/receipts and v1/v2 SSE parse tests unchanged and executable.
- [ ] **Run green and test tampering/bounds.** Include v1 text/v2 old receipt/v3 new receipt replay, narration failure with durable receipt, failed/cancelled without receipt, unsafe link/credential hostname tricks, label with HTML escaped later, 20/21 candidates, oversized multibyte message/frame, unknown fields nested at all levels, and v3 operation with missing schemaVersion. Run `npm test -- src/api/calendar-protocol.test.ts src/api/calendar-client.test.ts`.
- [ ] **Commit after permission:**

```powershell
git add frontend/src/api/calendar-protocol.ts frontend/src/api/calendar-protocol.test.ts frontend/src/features/plugins/google-calendar/testing/multi-calendar-fixtures.ts
git commit -m "feat(calendar-ui): decode v3 clarification and durable target receipts"
```

## Task 7: Route Calendar events into session/attempt-fenced chat state

**Files:** modify `frontend/src/features/chat/state/chat-types.ts`, `chat-reducer.ts`, `use-chat.ts`; create `calendar-chat-state.test.ts` in the same directory. Do not edit unrelated reducers/actions or generic API files.

- [ ] **Write failing Calendar reducer tests.** Add `calendarClarification:{turnId:string,event:CalendarClarificationEvent}|null` and `calendarLastSequence:number` to state (initially null/-1), plus `CALENDAR_CLARIFICATION`. Extend Calendar-only action payloads with optional `sessionId`, `attemptId`, `sequence` (old focused fixtures retain compatibility; real stream dispatch always supplies all three). Define a local `activeState` and tests:

```ts
const activeState = (): ChatState => ({ ...initialChatState,
  activeSessionId: 'session-1', activeTurnId: 'turn-1', activeAttemptId: 'attempt-1',
  isStreaming: true, draftInput: 'Keep my draft' });
it('stores one current clarification without generating approval or changing the draft', () => {
  const state = chatReducer(activeState(), { type: 'CALENDAR_CLARIFICATION', payload: {
    sessionId: 'session-1', turnId: 'turn-1', attemptId: 'attempt-1', sequence: 3,
    clarification: clarification(),
  } });
  expect(state.calendarClarification?.event.reason).toBe('conflict');
  expect(state.draftInput).toBe('Keep my draft');
  expect(state.calendarOperationsByTurn).toEqual({});
});
it('ignores wrong-session, old-attempt and duplicate Calendar stream responses', () => {
  const state = activeState();
  for (const patch of [{ sessionId: 'other-session' }, { attemptId: 'old-attempt' },
    { turnId: 'old-turn' }]) {
    expect(chatReducer(state, { type: 'CALENDAR_OPERATION', payload: {
      sessionId: 'session-1', turnId: 'turn-1', attemptId: 'attempt-1', sequence: 4,
      operation: createdOperation(), ...patch,
    } })).toBe(state);
  }
  const accepted = chatReducer(state, { type: 'CALENDAR_OPERATION', payload: {
    sessionId: 'session-1', turnId: 'turn-1', attemptId: 'attempt-1', sequence: 4,
    operation: createdOperation(),
  } });
  expect(chatReducer(accepted, { type: 'CALENDAR_OPERATION', payload: {
    sessionId: 'session-1', turnId: 'turn-1', attemptId: 'attempt-1', sequence: 4,
    operation: { ...createdOperation(), state: 'unknown', receipt: null },
  } })).toBe(accepted);
});
it('preserves the durable original target after narration failure and a new chat keeps only the draft', () => {
  let state = chatReducer(activeState(), { type: 'CALENDAR_OPERATION', payload: {
    turnId: 'turn-1', operation: { ...createdOperation(), narration: 'pending' },
  } });
  state = chatReducer(state, { type: 'STREAM_ERROR', payload: {
    code: 'PROVIDER_ERROR', message: 'Narration failed', retryable: true,
  } });
  expect(state.calendarOperationsByTurn['turn-1']?.receipt).toMatchObject({
    calendarLabel: 'Original Team' });
  const reset = chatReducer(state, { type: 'NEW_CHAT' });
  expect(reset.calendarClarification).toBeNull();
  expect(reset.calendarOperationsByTurn).toEqual({});
  expect(reset.draftInput).toBe('Keep my draft');
});
```

- [ ] **Run red:** `npm test -- src/features/chat/state/calendar-chat-state.test.ts`; expected missing action/member or stale events accepted.
- [ ] **Implement the Calendar-only cases and reset points.** Import the Task 6 types into chat-types. Every production Calendar action includes envelope identity/sequence. Add one local reducer predicate, used for **all three** Calendar cases (progress, operation, clarification), not three slightly different guards:

```ts
function ignoreCalendarAction(state: ChatState, payload: {
  turnId: string; sessionId?: string; attemptId?: string; sequence?: number;
}): boolean {
  if (payload.turnId !== state.activeTurnId) return true;
  if (payload.sessionId !== undefined && payload.sessionId !== state.activeSessionId) return true;
  if (payload.attemptId !== undefined && payload.attemptId !== state.activeAttemptId) return true;
  return payload.sequence !== undefined && payload.sequence <= state.calendarLastSequence;
}
```

Accepted Calendar events advance `calendarLastSequence`; clarification replaces the one previous proposal, clears progress, and does not create an operation or modify draft/messages. A terminal operation clears the matching clarification/progress and preserves the full compatible receipt object. Reset Calendar sequence/proposal on `NEW_CHAT`, `SELECT_SESSION`, authority to a different `TURN_ACCEPTED` attempt, and accepted fresh reply; retain completed operation receipts while accepting a new turn. Do not clear a visible proposal just because an unaccepted submit fails. Failed/interrupted narration keeps receipt/label unchanged using the existing `syncActiveCalendarNarration`; add failed/cancelled to terminal operation detection without mislabelling them succeeded.

In `use-chat.ts`, add `calendar-clarification` to the existing dispatcher and pass full Calendar envelope identity in all Calendar payloads:

```ts
} else if (event.type === 'calendar-clarification') {
  dispatch({ type: 'CALENDAR_CLARIFICATION', payload: {
    sessionId: envelope.sessionId, turnId: envelope.turnId,
    attemptId: envelope.attemptId, sequence: envelope.sequence,
    clarification: event,
  } });
}
```

In both submit and retry `onEvent` callbacks, before dispatching a Calendar event, require the captured abort controller is still active, not aborted, and the envelope session/turn/attempt equals that accepted response. Apply the same captured-stream check before Calendar-affecting transport-error handling after navigation so an obsolete stream cannot mark a newer durable operation's narration interrupted. Keep general stream semantics/voice/canvas unchanged; do not implement a new general SSE transport.

**Negotiation gate:** once the orchestrator confirms the named shared frontend protocol and P8 boundary amendments, replace the two owned `calendarProtocol:2` literals (submit and retry) with `calendarProtocol:3`. Before that handoff, do not bypass validation and do not report assembled v3 acceptance. This is a dependency, not a permission to edit `api/protocol.ts`. Add a fixture assertion in Task 9 that both request bodies use 3 after the gate lands. If no owner is assigned, stop this one negotiation step and hand off the completed parser/state work with the explicit block.
- [ ] **Run green and stale-event regression checks.** Add new-chat/navigation reset, accepted new attempt versus old attempt, lower/out-of-order sequence, details/target/coverage proposals, candidate replacement, expiry presentation (Task 8), cancelled/failed operation, and completed receipt surviving repeated narration terminal events. Run `npm test -- src/features/chat/state/calendar-chat-state.test.ts src/features/chat/state/chat-reducer.test.ts` and the full frontend suite later; do not weaken legacy tests.
- [ ] **Commit after permission:**

```powershell
git add frontend/src/features/chat/state/chat-types.ts frontend/src/features/chat/state/chat-reducer.ts frontend/src/features/chat/state/use-chat.ts frontend/src/features/chat/state/calendar-chat-state.test.ts
git commit -m "feat(calendar-ui): handle fenced Calendar clarification in chat state"
```

## Task 8: Show durable target badges and truthful clarification/conflict outcomes

**Files:** modify `frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx`, `calendar-turn-region.test.ts`; scoped CSS already created in Task 4. The existing `ChatView.tsx` composer-focus callback is sufficient; do not change it merely to add a reply affordance.

- [ ] **Write failing render/expiry assertions.** Extend `CalendarTurnViewProps` with `clarification?:{turnId:string,event:CalendarClarificationEvent}|null` (default null to preserve old callers), and export `resolveReceiptCalendarLabel(receipt,nowMs)` from the existing region file:

```ts
it('shows only durable receipt target metadata and hides it at content expiry', () => {
  const operation = createdOperation();
  const html = renderToStaticMarkup(createElement(CalendarTurnView, {
    progress: null, operations: [{ turnId: 'turn-1', operation }], disabled: false,
    nowMs: Date.parse('2026-10-24T10:01:00Z'), onRetryTurn: vi.fn(),
  }));
  expect(html).toContain('Calendar: Original Team');
  expect(html).toContain('Calendar event created');
  expect(html).toContain('final assistant response failed');
  expect(resolveReceiptCalendarLabel(operation.receipt,
    Date.parse('2026-10-24T10:05:00Z'))).toBeNull();
});
it('presents conflict and incomplete coverage as reply-needed, never a created receipt', () => {
  const html = renderToStaticMarkup(createElement(CalendarTurnView, {
    progress: null, operations: [], disabled: false,
    nowMs: Date.parse('2026-10-24T10:01:00Z'), onRetryTurn: vi.fn(),
    onFocusComposer: vi.fn(), clarification: { turnId: 'turn-1',
      event: clarification({ reason: 'coverage',
        message: 'Availability could not be checked on all calendars.' }) },
  }));
  expect(html).toContain('Availability coverage is incomplete');
  expect(html).toContain('Reply in composer');
  expect(html).not.toContain('Calendar event created');
  expect(html).not.toContain('All clear');
});
```

- [ ] **Run red:** `npm test -- src/features/plugins/google-calendar/calendar-turn-region.test.ts -t "durable receipt target"` and `-t "incomplete coverage"`; expected missing badge/proposal display.
- [ ] **Implement the minimal label projection and native reply region.** The label helper accepts both old/new receipt types, does not read the setup/default state, and expires at the boundary:

```ts
export function resolveReceiptCalendarLabel(
  receipt: CalendarDurableReceipt | null, nowMs = Date.now(),
): string | null {
  if (!receipt?.durable || !('calendarLabel' in receipt) ||
      receipt.calendarLabel === null || receipt.expiresAt === null) return null;
  const expires = Date.parse(receipt.expiresAt);
  return Number.isFinite(expires) && expires > nowMs ? receipt.calendarLabel : null;
}
```

Only `state:succeeded` + durable receipt gets “Calendar event created”, event link, event ID and an available target badge. Use `<span className="aurvin-calendar-target-badge">Calendar: {label}</span>` with text escaping. A legacy or redacted/expired receipt shows “Calendar label unavailable or expired”; do not replace it with the current default, infer it from a link, or echo provisional assistant prose. Changing the picker therefore cannot retarget an existing card. Keep link allowlist/expiry and `target=_blank rel="noopener noreferrer"`; unknown/planned/dispatching/failed/cancelled have no Created receipt or event link. Add conservative copy for new `failed` / `cancelled`: “Calendar action failed; no successful creation is confirmed.” / “Calendar action was cancelled; check any previously reported uncertain outcome before sending a new request.” Do not promise provider charge prevention, guaranteed absence, or a universal no-clash reservation.

Render one optional clarification article in the existing activity region, even when operations/progress are empty. Static reason headings: target→“Choose a calendar”, details→“More event details needed”, conflict→“Calendar conflict needs your reply”, coverage→“Availability coverage is incomplete”. Render server `message` as text, candidate labels/roles/canonical IDs as a bounded `<ul>` of inert text, and expiry notice. Untrusted names/messages are never HTML/Markdown instructions. A single native “Reply in composer” button calls the existing `onFocusComposer` only; **no** `setDraft`, `submitMessage`, hidden confirmation, JSON echo, synthetic proposal ID message, or approval flag. The user types an ordinary reply and P6 validates the current proposal. Busy/voice-owned state disables reply/retry actions consistently; navigation to setup remains an explicit action and retains the draft.

At proposal expiry hide message/candidate content and replace it with “This Calendar request expired. Ask again or provide updated details in the composer.” Do not offer an Accept/Proceed action for expired or stale evidence. An unknown operation remains “uncertain; resume reconciliation”, never a conflict override. Successful create plus failed/interrupted narration retains original target/event receipt and its existing safe narration-only retry explanation.

`CalendarTurnRegion` passes `state.calendarClarification` to the view. Add a single cleaned-up timer for the nearest future receipt/proposal content expiry so labels/links expire while the page sits open; no network or mutation occurs. Keep optional `nowMs` as a deterministic test seam. Use `Math.min(2_147_483_647, remaining)` for long fixture dates, exclude already-expired deadlines, and clean up on unmount/change. Polite announcements should describe new state once (`aria-atomic=true` on the relevant status), not repeatedly read all old receipts whenever the timer ticks. Do not move keyboard focus when a proposal arrives; only the user-triggered reply button focuses the composer.
- [ ] **Run green and all truthful-state assertions.** Include duplicate candidate names with safe IDs, malicious labels/message escaped, empty/expired proposal, each reason, failed/cancelled/unknown non-created state, narration failed/interrupted after durable success, legacy receipt without invented label, link/label expiry at equality, and durable label unchanged after unrelated default update. Use fake timers or browser expiry checks for the mounted timer; SSR `nowMs` alone does not prove timer cleanup. Run `npm test -- src/features/plugins/google-calendar/calendar-turn-region.test.ts src/features/chat/state/calendar-chat-state.test.ts`.
- [ ] **Commit after permission:**

```powershell
git add frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx frontend/src/features/plugins/google-calendar/calendar-turn-region.test.ts
git commit -m "feat(calendar-ui): show durable targets and truthful clarification states"
```

## Task 9: Extend the real development-only browser fixture with focused P7 interactions

**Files:** modify `frontend/src/features/plugins/google-calendar/testing/calendar-browser.tsx`, `calendar-browser.html`. No `integration-tests/**` additions/edits and no browser-library installation.

- [ ] **Write browser assertions before adjusting the production handlers.** Reuse the existing `act`, `check`, `press`, `typeInput`, `createRoot`, captured fetch requests and fixture pass/fail list. Retain prior OAuth scrubbing, grant revocation, storage privacy, progress/narration and draft tests. Replace fixture v1 setup status with factories returning **v2**, using `Date.now()`-relative fetched/expiry times (≤5 minutes), and keep one explicit old v2-SSE historical case. Add a second complete calendar page via a fake signed opaque token, shared writer/private-masked writer/reader/free-busy fixtures, and mutable CAS revision state.

The fake fetch router must reject every unexpected method/origin/path and parse query with `new URL`; do not discard search like the old `pathname()` helper when testing paging. Never pass an unexpected request through to real fetch. Inject safe navigation into a **standalone GoogleCalendarPanel** for the no-ID Connect test instead of navigating the real App to Google. Restore mocked fetch/storage hooks and unmount roots in `finally`. Then mount the existing App for Calendar chat/draft scenarios. Neither mode needs backend credentials.

Add representative assertions to the fixture's existing named `step` runner; `calendarMutations` is the existing captured request array, not a new production API:

```tsx
await step('Default-only save and reset never toggle enablement', async () => {
  const panelMount = document.getElementById('root');
  check(panelMount, 'Panel fixture root missing');
  const choose = panelMount.querySelector<HTMLInputElement>('input[value="team@example.com"]');
  check(choose, 'Team choice missing');
  await act(() => choose.click());
  const save = [...panelMount.querySelectorAll('button')]
    .find(button => button.textContent === 'Save default calendar');
  check(save, 'Save default button missing');
  await act(() => save.click());
  await flush();
  const request = calendarMutations.filter(change => change.method === 'PATCH').at(-1);
  check(request && request.csrf === '1', 'Default save lost CSRF');
  const body = request.body as { enabled?: boolean; defaultSetting?: {
    calendarId: string | null; expectedRevision: number; expectedConnectionRevision: number } };
  check(!Object.hasOwn(body, 'enabled'), 'Default save toggled enablement');
  check(body.defaultSetting?.calendarId === 'team@example.com', 'Wrong canonical target');
  check(body.defaultSetting?.expectedRevision === 7, 'Wrong preference CAS revision');
  check(body.defaultSetting?.expectedConnectionRevision === 3, 'Wrong connection revision');
});
```

For deferred-response races use one controlled Promise (no sleep loop):

```ts
let releasePage!: (response: Response) => void;
const delayedPage = new Promise<Response>(resolve => { releasePage = resolve; });
// Configure the fake GET calendars branch to return delayedPage once.
// Start the panel read; unmount it or replace its client with a newer account fixture.
// Mount/resolve the newer client first, then release the old result:
releasePage(Response.json(calendarPage({ calendars: [calendarEntry({ label: 'OLD ACCOUNT' })] })));
await flush();
const panelMount = document.getElementById('root');
check(panelMount, 'Panel fixture root missing');
check(!panelMount.textContent?.includes('OLD ACCOUNT'), 'Stale page resurrected old account metadata');
```

- [ ] **Run red in an actual local browser, not Node.** Cwd `frontend`: `npm run dev -- --host 127.0.0.1` (coordinate a free port with the orchestrator; do not start a second conflicting server). Open `http://127.0.0.1:5173/src/features/plugins/google-calendar/testing/calendar-browser.html`. Initial new steps should visibly fail on missing picker/CAS/v3 behavior. Record failed step text/console error, then correct only the owning implementation with a focused regression. The fixture imports the App only after `window.fetch` is replaced; no request may reach Google, OpenRouter, real backend, OAuth or a database.
- [ ] **Implement all of these named scenarios with actual assertions:**

| Fixture scenario | Observable assertion |
| --- | --- |
| No target-ID Connect | Labelled enabled Connect button with configured processing disclosure, POST body `{}`, injected safe navigation called once, no ID input |
| Default save/reset | Select Team by its labelled native radio, explicit save, exact CAS body without enabled, null reset preserves server enabled value, primary-auto summary |
| Independent enable/disable | PATCH contains only enabled; does not save dirty Team draft; disable clears old metadata but does not delete events or discard composer text |
| Paging/bounds | Click next page once, GET has exactly one encoded token, only ≤20 calendar entry radios visible, previous draft summary retained, no automatic page loop; short page with token still allows next |
| Roles/no-writable/partial | Reader/free-busy radios disabled with reason, masked writer enabled under fresh capabilities, empty partial results do not assert no calendars exist, no primary is not guessed |
| Refresh | Exactly one CSRF POST with expectedConnectionRevision followed by cached first-page GET; a deliberately wrong POST token is never reused; refresh failure does not relabel retained old data as fresh |
| 400 save failure | Confirmed default/enablement unchanged, radio/summary restored, labelled alert shown, no success notice |
| 409 cross-tab CAS | Fake another tab winning default/revision, reload displays winner, rejected selection rolls back, zero automatic PATCH retry, review-and-save-again message |
| Uncertain save | Simulate acknowledgement failure after fake persistence, reload reflects actual winner; if reload also fails disable new saves and show unconfirmed, never claim no write |
| Response lifecycle | Deferred old page/status/refresh after new client/unmount/disconnect cannot restore names/status/busy or erase a newer error; late cleanup cannot unlock a newer request |
| Reconnect/missing scopes | Old/partial consent presents reconnect/additional-permissions notice with no enabled write choices; no model or HTTP effect is attempted |
| v3 target/conflict/coverage | Stream frozen envelopes into App, visible reason/message/duplicate candidates; no Created receipt; reply focuses composer without altering its existing draft or issuing submit |
| Durable target remains original | Emit succeeded v2 operation with Original Team label; change fake saved default to Personal; existing receipt remains Original Team, including failed final narration and safe retry copy |
| Stale/expiry | Very short valid freshness/proposal/receipt deadline, await its one scheduled timer under `act` (not a polling loop); stale choices disappear, expired proposal not actionable, label/link disappear, event ID remains |
| Draft retention | Type unsent text, open Calendar setup via existing reconnect affordance, return, value unchanged; radio/refresh/save/reply do not overwrite it; voice lock prevents Calendar reply submission |
| Keyboard/focus/announcements | Real labelled native radios/fieldset, visible focus style, Escape closes inline disconnect group and restores trigger, save failure retains/returns sensible focus, arrival of proposal does not steal focus, status/error live-region attributes and accessible names present |
| Safe data | HTML-like names/candidates render text only, safe link rel/host, zero localStorage/sessionStorage writes, OAuth code/state removed, identity/credential/confirmed/operation fields absent from outgoing settings |

Simulated `press(Tab)` does **not** perform the browser's native tab traversal. Use actual keyboard navigation for Tab/Shift+Tab and radio-arrow checks; record the observed order and selected state. DOM assertions prove labels/live-region semantics, not that an unspecified screen reader spoke them. If a screen reader is available, record its name/version and observed polite/error announcements; otherwise mark spoken-announcement verification pending instead of claiming it passed. A browser or harness unavailable in the environment is a named pending gate, not an excuse to replace this fixture with SSR.

The two App submit/retry negotiation assertions require the Task 7 owner handoff; fake acceptance of protocol 2 cannot discharge v3 transport acceptance. Before that gate lands, test parser/state and standalone view with injected frozen v3 events and record assembled negotiation as blocked. The actual full-App v3 fixture must be rerun after the gate, not silently counted as already passed.
- [ ] **Run green in the browser and collect exact evidence.** Record URL, browser/version, OS, commit set, visible `passed/total`, each failing step (if any), keyboard/focus observations, console errors and any screen-reader limitation. A local mocked-fetch browser pass is not real Google behavior or shared-calendar ACL proof. Re-run Node focused tests after any production correction.
- [ ] **Commit after permission:**

```powershell
git add frontend/src/features/plugins/google-calendar/testing/calendar-browser.tsx frontend/src/features/plugins/google-calendar/testing/calendar-browser.html
git commit -m "test(calendar-ui): exercise picker races accessibility and durable targets in browser"
```

## Task 10: Sequential verification and exact P7 handoff

**Files:** no new source or evidence document. Return evidence to the orchestrator for state and to P9 for phase evidence; only amend an owned source/test after a demonstrated failing check, with red/green evidence and its own focused commit.

- [ ] **Run the focused Node suites**, cwd `frontend`:

```powershell
npm test -- src/api/calendar-protocol.test.ts src/api/calendar-client.test.ts
npm test -- src/features/plugins/google-calendar/calendar-setup-state.test.ts src/features/plugins/google-calendar/calendar-defaults.test.ts src/features/plugins/google-calendar/google-calendar-panel.test.ts src/features/plugins/google-calendar/calendar-turn-region.test.ts
npm test -- src/features/chat/state/calendar-chat-state.test.ts src/features/chat/state/chat-reducer.test.ts
```

Expected: each requested file discovered with actual passing tests; no skipped/empty suite counted as evidence. Report counts/failures, not just exit codes.
- [ ] **Coordinate the shared-package check slot and run sequentially**, cwd `frontend`: `npm run build`, then `npm run lint`, then `npm test` as three separate commands. Preserve historical plugin integration, text chat, admin, voice, canvas and minimap checks without editing them. Report actual totals/skips and any pre-existing versus new failures. A missing amendment causing a type error is a real blocked check, not something to silence with optional identity/unsafe casts. Do not run backend builds/tests in parallel with P6/P8 and cause the documented bootstrap race; backend verification belongs to its owner/integrator.
- [ ] **Re-run the Task 9 actual browser fixture** on the verified commit set after the final source change. Do not claim physical keyboard/screen-reader results from Node SSR, fixture services from Google, or v2 negotiation from v3 parsing. If prerequisite/browser tooling is missing, give a named pending gate and exact rerun procedure.
- [ ] **Check the diff and ownership**, repository root:

```powershell
git diff --check
git status --short
git diff --name-only
```

Confirm all task changes are named P7 paths, no `integration-tests/**`, secrets, `.env`, browser storage state, generated/dependency files or unrelated worker changes are staged. Do not stage another worker's files. No final verification/final report is written by P7.
- [ ] **Return the handoff** with exact implementation commits, new exported types/guards/client methods, status/settings/refresh request examples, default-only versus enabled-only behavior, safe 409/uncertain-save semantics, legacy decode compatibility, actual package/focused/browser evidence, and remaining owner gaps. Explicitly state no live actions were run and review was skipped. This final evidence step needs no empty commit; each source task already supplies its conventional commit message.

## Acceptance/exit checklist

| P7 obligation | Evidence task |
| --- | --- |
| AC01 no-ID Connect; server-side setup/privacy remains explicit | 1, 2, 5, 9 |
| AC02 roles/primary/partial/freshness/count/byte/paging honesty | 1, 3, 4, 5, 9 |
| AC03 re-consent/missing scopes/non-writable distinctions | 1, 4, 5, 9 |
| AC04 independent default save/reset/CAS and no fallback | 2, 3, 4, 5, 9 |
| AC05/AC07 ordinary composer clarification/conflict/coverage with no browser approval | 6, 7, 8, 9; P6/P8 service semantics remain their gate |
| AC09 durable target badge independent of latest default/narration | 6, 7, 8, 9 |
| AC11 native controls, keyboard/focus/announcements/drafts, rollback and stale response fences | 3–5, 7–9 |
| AC12 no unrelated chat/voice/canvas/admin regression or legacy evidence fabrication | 1, 6, 7, 10 |
| AC13 safe untrusted metadata/links, expiry, no credentials/storage overrides | 1, 2, 5, 6, 8, 9 |
| AC14 exact Node/browser/owner-gate distinction; no live-service claim | 9, 10 |

P7 is implementation-complete only when its focused/package checks pass, actual browser evidence is supplied (or its required gate explicitly remains pending), and upstream negotiation/transport gaps are not hidden by mocks. The full phase is not complete on P7's handoff. P9 retains integrated/native/service acceptance; the orchestrator retains final evidence acceptance. No live OAuth, Google, model, application-data change, provisioning, paid check, or deployment is authorized by this plan.
