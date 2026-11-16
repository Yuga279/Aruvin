# Google Calendar Multi-Calendar (Phase 2) — Compatibility and Policy Research

## 1. Summary of Decisions and Recommendations

### Evidence Classification Legend
Every finding in this document is classified into exactly one of the three required verification buckets:
- **[Bucket 1 — Primary documentation support]:** Verified directly against official Google Calendar API v3 reference docs, Google OAuth 2.0 / Workspace API policy docs, RFCs, or the local repository source and installed `@modelcontextprotocol/*@2.3.1` type definitions.
- **[Bucket 2 — Isolated compatibility evidence actually executed]:** None claimed in this research pass (per read-only investigation constraints: no live network calls, credential access, database actions, or test suites were executed).
- **[Bucket 3 — Still-unrun service gate]:** Live Google OAuth incremental/granular consent behavior, live multi-calendar ACL edge cases (`writerWithoutPrivateAccess`, domain/secondary shared calendars, `freeBusyReader` error isolation), and replica-set MongoDB persistence checks that require operator credentials and live/isolated service execution during P10.

### Phase 1 Carryover Findings vs Phase 2 Delta Findings

| Area | Phase 1 Carryover (Committed Baseline) | Phase 2 Multi-Calendar Delta (This Research) | Bucket |
| --- | --- | --- | --- |
| **OAuth Identity & Transport** | Confidential web-server OAuth (`authorization_code` + PKCE S256, `access_type=offline`, loopback redirect, AES-256-GCM token storage, OIDC `sub` binding, single-flight refresh) in `backend/src/plugins/google-calendar/oauth.ts` and `connection.ts`. | Retain confidential OAuth flow and `sub` binding; add `include_granted_scopes=true`, granular partial-grant verification against the full Phase 2 required scope set, and automatic transition of Phase 1 `calendar.events.owned`-only connections to `reconnect-required`. | Bucket 1 (live consent UX is Bucket 3) |
| **OAuth Scopes** | `openid`, `email`, `https://www.googleapis.com/auth/calendar.events.owned` (`backend/src/contracts/calendar-policy.ts:17`). | Replace `calendar.events.owned` with `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, `https://www.googleapis.com/auth/calendar.events`, and **`https://www.googleapis.com/auth/calendar.freebusy`** (see Section 4 and Section 14 Contradiction 1: `calendar.events` does **not** authorize `freebusy.query`). | Bucket 1 |
| **Target Calendar Resolution** | Startup env pin `AURVIN_GOOGLE_CALENDAR_TARGET_ID` (`options.ts:76-103`), rejecting `'primary'` and requiring `accessRole === 'owner'`. | Remove startup env pin requirement; discover calendars dynamically via `calendarList.list`, allow `'primary'` alias or concrete calendar IDs, persist a user-selectable default calendar (initially primary), and resolve per-operation target calendar (`explicit > saved default > primary`). | Bucket 1 |
| **MCP Tool Surface** | 3 tools (`calendar_list_events`, `calendar_get_event`, `calendar_create_event`) over `@modelcontextprotocol/server@2.3.1` and `@modelcontextprotocol/client@2.3.1` (`calendar-tools.ts`, `calendar-server.ts`). | Expand to 5 tools by adding `calendar_list_calendars` and `calendar_check_availability`, plus optional `calendarId` on `calendar_list_events`, `calendar_get_event`, and `calendar_create_event`. Fits pinned SDK `2.3.1` with zero new npm dependencies. | Bucket 1 |
| **Write Approval Gate** | `authorizeCreate` in `backend/src/chat-runtime/calendar-operation.ts:18-31` requires user message to equal `Create this Google Calendar event: ${JSON.stringify(action)}`. | Replace raw canonical-JSON user prompt with a durable 10-minute server-stored create proposal (`metadata` collection) displaying target calendar label/ID, summary, start/end, and timezone, confirmed or cancelled by natural user reply or UI action while preserving `requestHash` idempotency. | Bucket 1 |
| **Persistence Layout** | 8 collections in `backend/src/contracts/collections.ts:20-29` (`sessions`, `messages`, `agent-memory`, `metadata`, `checkpoints`, `checkpoint_writes`, `config`, `integration_connections`); 7 allowlisted in `mutation-journal.ts:74`. | Keep the exact same 8 collections. Store bounded discovery snapshots (<=100 calendars, <=256 KiB, 5-min TTL) and `defaultSettingRevision` on `integration_connections`, and v2 operation/proposal/availability records in `metadata` and `agent-memory`. | Bucket 1 |

---

## 2. Source and Authority Notes

| Claim / Topic | Authoritative Source (URL or Local Path) | Authority / Status |
| --- | --- | --- |
| Phase 2 approved scope, ceilings, and acceptance criteria | `docs/google-calendar-multi-calendar/goal.md`, `docs/google-calendar-multi-calendar/state.md` | Authoritative Phase 2 specification (commit `a31e548`) |
| Phase 1 committed research and boundaries | `docs/google-calendar-plugin/research.md`, `docs/google-calendar-plugin/goal.md`, `docs/google-calendar-plugin/state.md` | Authoritative Phase 1 baseline |
| Multi-calendar source roadmap (input only) | `docs/google-calendar-plugin/future-phase-multi-calendar.md` | Non-authoritative input; sensitivity/scope claims audited and corrected in Sections 4 and 14 |
| `calendarList.list` & `CalendarListEntry` resource representation | `https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list`, `https://developers.google.com/workspace/calendar/api/v3/reference/calendarList#resource` | Primary Google Calendar API v3 documentation (Bucket 1) |
| `freebusy.query` method, scopes, limits, and response schema | `https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query` | Primary Google Calendar API v3 documentation (Bucket 1) |
| `events.list`, `events.get`, `events.insert` methods and scopes | `https://developers.google.com/workspace/calendar/api/v3/reference/events/list`, `.../events/get`, `.../events/insert` | Primary Google Calendar API v3 documentation (Bucket 1) |
| Google Calendar API OAuth 2.0 scopes & sensitivity tiers | `https://developers.google.com/workspace/calendar/api/auth`, `https://developers.google.com/identity/protocols/oauth2/scopes#calendar` | Primary Google Identity / Workspace documentation (Bucket 1) |
| Incremental auth (`include_granted_scopes`) & granular consent | `https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth`, `https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions` | Primary Google Identity documentation (Bucket 1) |
| Calendar API quotas, rate limits, and error codes | `https://developers.google.com/workspace/calendar/api/guides/ quota`, `https://developers.google.com/workspace/calendar/api/guides/errors` | Primary Google Calendar API v3 documentation (Bucket 1) |
| Google Workspace API User Data & Developer Policy (Limited Use / AI) | `https://developers.google.com/terms/api-services-user-data-policy`, `https://developers.google.com/workspace/workspace-api-user-data-developer-policy` | Primary Google API policy documentation (Bucket 1) |
| Pinned MCP SDK v2.3.1 server/client contracts | `backend/node_modules/@modelcontextprotocol/server/package.json`, `backend/node_modules/@modelcontextprotocol/server/dist/index.d.mts`, `backend/node_modules/@modelcontextprotocol/server/dist/createMcpHandler-D4NN8WsG.d.mts`, `backend/node_modules/@modelcontextprotocol/client/package.json`, `backend/node_modules/@modelcontextprotocol/client/dist/index.d.mts` | Installed package types in repository (Bucket 1) |
| Current backend contracts, persistence, plugin, runtime, and frontend wiring | `backend/src/contracts/calendar-*.ts`, `backend/src/persistence/calendar-*.ts`, `backend/src/plugins/google-calendar/*.ts`, `backend/src/plugins/mcp/*.ts`, `backend/src/chat-runtime/calendar-*.ts`, `frontend/src/features/plugins/google-calendar/*`, `frontend/src/api/calendar-*.ts` | Actual repository source (Bucket 1) |

---

## 3. Capability Matrix (Read / Create / Availability per Calendar Role)

**[Bucket 1 — Primary documentation support]** (`https://developers.google.com/workspace/calendar/api/v3/reference/calendarList#resource`, `https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query`)

| Calendar `accessRole` / State | `calendarList.list` Discovery | `freebusy.query` (`calendar_check_availability`) | `events.list` & `events.get` (`calendar_list_events`, `calendar_get_event`) | `events.insert` (`calendar_create_event`) | Phase 2 Aurvin Policy & UI Badge |
| --- | --- | --- | --- | --- | --- |
| **`owner`** (Primary or secondary owned calendar) | Returned (`primary: true` on primary calendar) | Allowed: returns `{ start, end }` busy blocks for opaque non-declined events | Allowed: returns full event metadata (including private events) | **Allowed** | Writable (`owner`); eligible as saved default calendar and explicit/default write target |
| **`writer`** (Shared team/secondary calendar with full edit access) | Returned (when subscribed in user's `calendarList`) | Allowed: returns `{ start, end }` busy blocks | Allowed: returns full event metadata (including private events) | **Allowed** | Writable (`writer`); eligible as saved default calendar and explicit/default write target |
| **`writerWithoutPrivateAccess`** (Workspace/shared calendar with edit access to non-private events) | Returned (documented Google `CalendarListEntry.accessRole` value) | Allowed: returns `{ start, end }` busy blocks (including private events) | Allowed: returns full metadata for non-private events; private events have masked details (`visibility: "private"`) | **Allowed** (creates non-private events) | Writable (`writerWithoutPrivateAccess` — must be admitted in schema or normalized to `writer` with `privateAccess: false`; see Section 14) |
| **`reader`** (Shared/subscribed read-only calendar, e.g. holidays, team view-only) | Returned | Allowed: returns `{ start, end }` busy blocks | Allowed: returns public/default events; private events return only start/end with masked summary/description | **Denied by Google (`403 insufficientPermissions`) & Aurvin preflight** | Read-only (`reader`); eligible for event reads and availability checks; **rejected before provider call** for event creation and default-write selection |
| **`freeBusyReader`** (Shared calendar exposing only free/busy times) | Returned | Allowed: returns `{ start, end }` busy blocks | **Denied (`403` / masked)** — `events.list` is not usable for event details; `goal.md:29` forbids treating `freeBusyReader` as event-readable | **Denied by Google (`403`) & Aurvin preflight** | Free/busy-only (`freeBusyReader`); eligible **only** for `calendar_check_availability`; rejected before provider call for `calendar_list_events`, `calendar_get_event`, `calendar_create_event`, and default-write selection |
| **`deleted: true`** (Removed from user's `calendarList`) | Omitted when `showDeleted=false` (default) | N/A | N/A | N/A | Excluded from retained discovery snapshot; if previously selected as default, fall back to `primary` with user-visible notice |
| **`hidden: true`** (Hidden by user in Google Calendar UI sidebar) | Omitted when `showHidden=false` (default); returned when `showHidden=true` | Allowed if queried by ID | Allowed if role >= `reader` | Allowed if role >= `writer` | Query `calendarList.list` with `showDeleted=false` and `showHidden=false` by default (or expose `hidden: boolean` if `showHidden=true`); never silently select a hidden calendar as default |
| **`selected: false`** (Unchecked in Google Calendar web UI) | Returned with `selected: false` | Allowed | Allowed if role >= `reader` | Allowed if role >= `writer` | `selected` is purely a Google UI display toggle; retain in discovery snapshot (`selected: boolean`) so Aurvin can distinguish UI-checked calendars without revoking API eligibility |
| **Unsubscribed Workspace / domain calendar** (Not in user's `calendarList`) | **Not returned** by `calendarList.list` | Queryable by raw ID if domain ACL allows, **but** outside Aurvin's discovered-calendar boundary | Outside discovered-calendar boundary | **Denied by Aurvin policy** (writes require verified discovered `owner`/`writer` role) | Reject unknown/undiscovered `calendarId` after one expiry-aware discovery refresh (`goal.md:36`) |

---

## 4. Exact Scope Candidates with Least-Sufficient Rationale

### 4.1 Scope Candidate Comparison
**[Bucket 1 — Primary documentation support]** (`https://developers.google.com/workspace/calendar/api/auth`, `https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list`, `https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query`, `https://developers.google.com/workspace/calendar/api/v3/reference/events/insert`)

| Scope URI | Google Sensitivity Tier | `calendarList.list` | `events.list` / `events.get` (Owned + Shared) | `events.insert` (Owned + Shared Writable) | `freebusy.query` (`POST /calendar/v3/freeBusy`) | Verdict for Phase 2 |
| --- | --- | --- | --- | --- | --- | --- |
| `openid` + `email` | Non-sensitive | No | No | No | No | **Required** (OIDC `sub` and account email binding) |
| `.../auth/calendar.events.owned` | Sensitive | No | Owned only (fails on shared calendars) | Owned only (fails on shared `writer` calendars) | **No** | **Drop / Upgrade** (Phase 1 scope; insufficient for shared calendars and discovery) |
| `.../auth/calendar.calendarlist.readonly` | Sensitive | **Yes** (read-only) | No | No | **No** | **Required** (least-sufficient scope to list `calendarList` entries without modifying subscriptions) |
| `.../auth/calendar.events` | Sensitive | No | **Yes** (all accessible `owner`/`writer`/`reader` calendars) | **Yes** (all `owner` and shared `writer` calendars) | **No** (not in `freebusy.query` accepted scopes) | **Required** (least-sufficient scope for reading and creating events across owned and shared calendars without granting ACL/calendar deletion) |
| `.../auth/calendar.freebusy` | Sensitive | No | No | No | **Yes** | **Required addition** (least-sufficient scope to authorize `POST /calendar/v3/freeBusy`, including `freeBusyReader` calendars; see Section 14 Contradiction 1) |
| `.../auth/calendar.readonly` | Sensitive | Yes | Yes (read-only) | No | Yes | Reject (redundant if `calendar.calendarlist.readonly` + `calendar.events` + `calendar.freebusy` are used, and broader on calendar settings) |
| `.../auth/calendar` | Sensitive | Yes (read/write) | Yes | Yes | Yes | **Forbidden by `goal.md:20`** (grants full calendar container deletion, ACL sharing modification, and settings write) |

### 4.2 Why `calendar.freebusy` Must Be Added to the Goal's Scope Set
In `docs/google-calendar-multi-calendar/goal.md:20`, the approved goal lists four scopes:
- `openid`
- `email`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events`

However, `goal.md:27`, `goal.md:50`, and `goal.md:57` also require `calendar_check_availability` across selected calendars **including `freeBusyReader` calendars**. Per Google's official `freebusy.query` reference (`https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query`), `POST https://www.googleapis.com/calendar/v3/freeBusy` requires one of:
1. `https://www.googleapis.com/auth/calendar.freebusy` (or legacy `calendar.events.freebusy`)
2. `https://www.googleapis.com/auth/calendar.readonly`
3. `https://www.googleapis.com/auth/calendar`

`https://www.googleapis.com/auth/calendar.events` is scoped strictly to the `/calendars/{calendarId}/events` resource and is **not** listed as an accepted scope for `/freeBusy`. Furthermore, Aurvin cannot emulate `freebusy.query` via `events.list` on `freeBusyReader` calendars because `freeBusyReader` does not permit `events.list` reads (and calling `events.list` across up to 100 calendars would require 100 HTTP requests, blowing past the 20-request turn budget). Therefore, adding `https://www.googleapis.com/auth/calendar.freebusy` yields the true 5-scope least-sufficient set:
```ts
export const CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
] as const;
```

### 4.3 Sensitivity Classification and Incremental / Granular Consent Behavior
- **Google OAuth Sensitivity Classification [Bucket 1]:** Per `https://developers.google.com/identity/protocols/oauth2/scopes#calendar`, `calendar.calendarlist.readonly`, `calendar.events`, `calendar.freebusy`, and `calendar.events.owned` are all classified as **Sensitive** scopes. None of the Google Calendar API scopes are classified as **Restricted** (Restricted scopes apply to Gmail, Drive, Fitness, etc., which require annual CASA third-party security assessments). However, any public external OAuth client requesting Sensitive Calendar scopes still requires standard Google OAuth App Verification (demo video + justification) to remove the unverified-app screen. The source roadmap's (`docs/google-calendar-plugin/future-phase-multi-calendar.md:45-53`) suggestion that scope selection alone might exempt the app from verification is **false** for external production publishing.
- **Incremental Authorization (`include_granted_scopes=true`) [Bucket 1]:** Per `https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth`, passing `include_granted_scopes=true` on `https://accounts.google.com/o/oauth2/v2/auth` instructs Google to merge previously granted scopes with the newly requested scopes on the resulting token. Currently, `backend/src/plugins/google-calendar/oauth.ts:102-112` does **not** set `include_granted_scopes`; Phase 2 should set `include_granted_scopes: 'true'` when initiating re-consent/upgrade flows for an already-bound `googleSubjectId`.
- **Granular Permissions and Partial Grants [Bucket 1 / Live UX is Bucket 3]:** Per `https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions`, Google's consent screen presents separate checkboxes for each requested Calendar scope (`calendar.calendarlist.readonly`, `calendar.events`, `calendar.freebusy`). A user can check `calendar.calendarlist.readonly` while unchecking `calendar.events` or `calendar.freebusy`.
  - On token exchange (`oauth-client.ts:171-189`), Google returns the space-delimited `scope` string actually granted by the user.
  - Because `goal.md:22` and `goal.md:59` require failing closed when any required multi-calendar scope is missing, `oauth.ts` and `connection.ts` must verify that **every** scope in `CALENDAR_SCOPES` is present in `grantedScopes`. If the user grants only a partial subset during OAuth callback, Aurvin must **not** mark the connection `connected`; it must reject the incomplete grant (or mark `reconnect-required` / `setup-required`) with an explicit missing-scope diagnostic telling the operator which permission checkbox was left unchecked.
  - Refresh tokens cannot widen scopes (`RFC 6749 §6`). Existing Phase 1 connections stored with only `calendar.events.owned` cannot acquire `calendar.calendarlist.readonly`, `calendar.events`, or `calendar.freebusy` via `refreshAccessToken`; they must transition to `reconnect-required` and complete interactive re-consent.

---

## 5. Calendar List Semantics and Completeness

**[Bucket 1 — Primary documentation support]** (`https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list`, `https://developers.google.com/workspace/calendar/api/v3/reference/calendarList#resource`)

### 5.1 Endpoint and Pagination Semantics
- **Endpoint:** `GET https://www.googleapis.com/calendar/v3/users/me/calendarList`
- **Query Parameters:**
  - `maxResults`: Integer. Default is `100`; maximum allowed by Google is `250`.
  - `pageToken`: Opaque continuation token from a prior response's `nextPageToken`.
  - `minAccessRole`: Optional filter (`freeBusyReader`, `reader`, `writer`, `owner`). Do **not** set `minAccessRole=writer` during discovery, because Aurvin needs to discover `reader` and `freeBusyReader` calendars for read and availability tools (`goal.md:27-31`).
  - `showDeleted`: Boolean, default `false`. Keep `false` so removed entries are omitted.
  - `showHidden`: Boolean, default `false`. Keep `false` so calendars hidden by the user in Google Calendar UI are omitted unless explicitly needed.
- **Pagination Completeness:** Google does **not** guarantee that a single page contains `maxResults` items even when more items exist; a page may contain fewer entries (for example, when filtered entries are skipped internally) while still returning a non-empty `nextPageToken`. Pagination is complete **only** when `nextPageToken` is absent/undefined, or when Aurvin hits its configured discovery ceiling (`100` retained calendar entries or `10` HTTP page deliveries) and records `truncated: true`.

### 5.2 `primary` Boolean vs `'primary'` Alias
- Every Google Calendar account has **at most one** primary calendar entry where `CalendarListEntry.primary === true`.
- In all `/calendars/{calendarId}/...` endpoints and `freebusy.query`, the string literal `'primary'` is a first-class alias resolved by Google to the authenticated user's primary calendar ID (which is normally identical to the user's primary email address, though after primary-email renames in Google Workspace they can differ—making `primary: true` on `calendarList` the authoritative way to map `'primary'` to its canonical `id`).
- **Edge Case:** If a user has >100 calendars and `calendarList.list` is truncated at 100 entries, `primary: true` is almost always first, but if `primary: true` is not found in the first page, Aurvin can either resolve `'primary'` via `calendars/primary` (`calendarList.get({ calendarId: 'primary' })`) or ensure the primary entry is always retained in the 100-entry snapshot.

### 5.3 Field Semantics on `CalendarListEntry`
- `id` (`string`): Stable provider calendar identifier (e.g. `user@example.com`, `c_...@group.calendar.google.com`, `en.usa#holiday@group.v.calendar.google.com`).
- `summary` (`string`): Global title of the calendar set by its owner.
- `summaryOverride` (`string`, optional): User-specific custom label set by the authenticated user for their own sidebar. **Recommendation:** Persist both or compute `displaySummary = entry.summaryOverride ?? entry.summary` so the user's custom calendar name is recognizable in chat and settings.
- `accessRole` (`string`): Effective permission of the authenticated user (`'freeBusyReader' | 'reader' | 'writerWithoutPrivateAccess' | 'writer' | 'owner'`).
- `timeZone` (`string`, optional): IANA time zone of the calendar (e.g. `'America/New_York'`). Used as the default `timeZone` when creating events on that calendar or interpreting date boundaries.
- `primary` (`boolean`, optional): `true` only on the user's primary calendar (`default: false`).
- `selected` (`boolean`, optional): `true` if checked/visible in the user's Google Calendar UI (`default: false`).
- `hidden` (`boolean`, optional): `true` if hidden from the user's UI list (`default: false`).
- `deleted` (`boolean`, optional): `true` if deleted/unsubscribed (`default: false`).

### 5.4 Shared / Subscribed Exposure & Workspace Enumeration Limits
- **What IS enumerated:** Owned primary calendar, owned secondary calendars, shared team/colleague calendars, resource/room calendars, and public/holiday calendars **that have been added to the authenticated user's `calendarList`**.
- **What CANNOT be enumerated via `calendarList.list`:**
  1. Colleague or Workspace domain calendars that are shared with the user (or domain-wide) but **not yet subscribed/added** to the user's `calendarList`.
  2. Google Workspace building/room resource directories (which live in the Admin SDK Directory API, outside Calendar `calendarList.list`).
  3. Calendars to which the user has `none` access.

---

## 6. Availability / Free-Busy Semantics and Limits

**[Bucket 1 — Primary documentation support]** (`https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query`)

### 6.1 Request and Response Contract
- **Endpoint:** `POST https://www.googleapis.com/calendar/v3/freeBusy`
- **Request JSON:**
  ```json
  {
    "timeMin": "2026-10-22T00:00:00Z",
    "timeMax": "2026-10-29T00:00:00Z",
    "timeZone": "America/New_York",
    "calendarExpansionMax": 50,
    "items": [
      { "id": "user@example.com" },
      { "id": "team_cal@group.calendar.google.com" }
    ]
  }
  ```
- **Response JSON:**
  ```json
  {
    "kind": "calendar#freeBusy",
    "timeMin": "2026-10-22T00:00:00.000Z",
    "timeMax": "2026-10-29T00:00:00.000Z",
    "calendars": {
      "user@example.com": {
        "busy": [
          { "start": "2026-10-22T09:00:00-04:00", "end": "2026-10-22T10:00:00-04:00" }
        ]
      },
      "inaccessible@group.calendar.google.com": {
        "errors": [
          { "domain": "global", "reason": "notFound" }
        ],
        "busy": []
      }
    }
  }
  ```

### 6.2 Provider Ceilings on `freebusy.query`
- **Maximum calendars per request (`calendarExpansionMax`):** **50 calendars** (`https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query`). If `items` contains more than 50 calendars (or `calendarExpansionMax > 50`), Google returns per-calendar error `{ domain: "global", reason: "tooManyCalendarsRequested" }` or HTTP `400`.
- **Maximum group members (`groupExpansionMax`):** **100** identifiers per group. Aurvin should **not** pass Google Groups (`groups` expansion) in Phase 2; Aurvin should query only concrete discovered `calendarId`s from the user's `calendarList`.
- **Maximum time window (`timeMax - timeMin`):** Google enforces a server-side window ceiling of approximately **3 months (~90 days)** on `freebusy.query` (`400 Bad Request` if exceeded) and returns `400 timeRangeEmpty` if `timeMax <= timeMin`. Aurvin's existing `CALENDAR_LIMITS.listDays = 31` (`backend/src/contracts/calendar-policy.ts:12`) is well within Google's 3-month ceiling and should be reused as the maximum range for `calendar_check_availability`.

### 6.3 Exact Semantics of "Busy" vs "Free"
What **DOES** produce a `{ start, end }` block in `calendars[id].busy`:
1. **Standard Timed Events (`transparency: "opaque"` or omitted):** Included when the calendar owner/user's attendee status is `accepted`, `tentative`, or `needsAction` (unresponded invite), or when the event has no attendees.
2. **Tentative Events (`status: "tentative"` or `responseStatus: "tentative"`):** Included as busy in `freebusy.query` (`freebusy.query` does **not** distinguish tentative from accepted—both appear as identical `{ start, end }` busy blocks).
3. **Recurring Events:** Expanded server-side by Google across `[timeMin, timeMax]`; each opaque non-declined instance contributes a busy block.
4. **All-Day Events (`start.date` / `end.date`) when `transparency: "opaque"`:** Converted by Google into RFC3339 timestamps spanning midnight-to-midnight in the **target calendar's own time zone** (then formatted in the request's `timeZone` or `UTC`).
   - *Critical Caveat:* In the Google Calendar web/mobile UI, all-day events created by users default to `transparency: "transparent"` ("Free"), whereas all-day events created via the API without a `transparency` field default to `"opaque"` ("Busy"). Transparent all-day events will **not** appear in `freebusy.query` `busy[]`!
5. **Out-of-Office (`eventType: "outOfOffice"`) and Focus Time (`eventType: "focusTime"`):** Created as `transparency: "opaque"` by default and **included** in `busy[]`.
6. **Private / Confidential Events & `freeBusyReader` Calendars:** Included in `busy[]` as `{ start, end }` intervals without exposing `summary`, `description`, or `attendees`.

What **DOES NOT** produce a block in `calendars[id].busy` (what "Free" cannot guarantee):
1. **Transparent Events (`transparency: "transparent"`):** Omitted completely (including default UI-created all-day events, `workingLocation`, and `birthday` events).
2. **Declined Events (`responseStatus: "declined"`):** Automatically excluded by Google for that user's calendar.
3. **Cancelled Events (`status: "cancelled"`):** Excluded.
4. **Working Hours / Outside-Of-Hours Settings:** `freebusy.query` returns only event-driven busy blocks; it does **not** mark nights, weekends, or configured out-of-working-hours periods as `busy`.

### 6.4 TimeZone, DST Boundaries, and Per-Calendar Error Isolation
- **`timeZone` Handling & DST:** If `timeZone` is supplied in the `freebusy.query` request body (e.g., `"America/New_York"`), returned `busy[].start` and `busy[].end` strings use that zone's RFC3339 offset for each instant (e.g., `-04:00` before the November DST fallback and `-05:00` after). Across a DST transition day, an all-day opaque event spans `00:00:00-04:00` to `00:00:00-05:00` (25 elapsed hours in autumn, 23 in spring). All interval merging and free-window computation in Aurvin **must** parse RFC3339 strings to epoch milliseconds (`Date.parse`), merge/compare in UTC epoch space, and format output in the requested IANA `timeZone`.
- **Per-Calendar Error Isolation:** A `freebusy.query` request that includes a deleted, unshared, or non-existent calendar ID still returns HTTP `200 OK`! The failure is reported inside `response.calendars[calendarId].errors` (e.g., `[{ domain: "global", reason: "notFound" }]`) alongside `busy: []`. **Critical rule (`goal.md:28`):** If `calendars[id].errors` is non-empty (or if `calendars[id]` is missing from the response map), Aurvin **must** classify that calendar as `status: 'error'` (unavailable/unverified) in the availability result and **never** report it as free/available.

---

## 7. Provider Error, Batching and Quota Behavior

**[Bucket 1 — Primary documentation support]** (`https://developers.google.com/workspace/calendar/api/guides/errors`, `https://developers.google.com/workspace/calendar/api/guides/quota`, `backend/src/plugins/google-calendar/calendar-api-http.ts`)

### 7.1 Batching Ceilings
- **`calendarList.list`:** Up to `250` entries per GET request (`maxResults=250`). Setting `maxResults=100` (or `250`) fetches Aurvin's entire 100-calendar retained snapshot ceiling in **1 HTTP request** unless the account has deleted/hidden entries interspersed or >100 calendars.
- **`freebusy.query`:** Up to **50 calendars per POST request** (`calendarExpansionMax: 50`). To check availability across 51–100 calendars, Aurvin must split `items` into **2 sequential or parallel `freebusy.query` POST requests** of <=50 calendars each.
- **`events.list` / `events.get` / `events.insert`:** Strictly single-calendar per REST endpoint (`/calendar/v3/calendars/{ encodeURIComponent(calendarId) }/events`). Do **not** use Google's multipart/mixed `/batch/calendar/v3` endpoint—it is legacy/deprecated for heterogeneous error handling and unnecessary when `freebusy.query` natively batches 50 calendars per JSON POST.

### 7.2 Provider Error Taxonomy and Retry / Connection-State Rules

| HTTP Status | Google `error.errors[].reason` / OAuth Code | Meaning | Retryable? | Connection State Impact & Aurvin Fault Mapping |
| --- | --- | --- | --- | --- |
| `400` | `badRequest`, `invalid`, `timeRangeEmpty`, `timeRangeTooLarge` | Invalid query parameter, malformed RFC3339 timestamp, or range > ~90 days | **No (Terminal)** | Keep `connected`; return `CALENDAR_INVALID_INPUT` |
| `400` / `401` (OAuth token endpoint) | `invalid_grant` | Refresh token revoked, expired (e.g. 7-day testing mode expiry or user revocation), or password changed | **No (Terminal)** | Transition connection to **`reconnect-required`** (`CALENDAR_RECONNECT_REQUIRED`) |
| `401` (Calendar API) | `authError`, `invalidCredentials` | Access token expired or revoked | **Refresh once** via single-flight refresh lock; if refresh fails or second attempt returns `401`, **Terminal** | If refresh succeeds, stay `connected`; if refresh fails with `invalid_grant` or repeated `401`, transition to **`reconnect-required`** |
| `403` | `insufficientPermissions` | (a) Token lacks required OAuth scope (e.g., `calendar.freebusy`), OR (b) user's `accessRole` on the target calendar is `reader`/`freeBusyReader` during a write or `freeBusyReader` during `events.list` | **No (Terminal)** | Inspect stored `grantedScopes` & discovered `accessRole`: if required OAuth scope is missing on the grant, transition to **`reconnect-required`**; if grant has all Phase 2 scopes but calendar ACL denies the action, **keep `connected`**, refresh discovery snapshot, and return `CALENDAR_FORBIDDEN` / `CALENDAR_TARGET_READ_ONLY` |
| `403` | `rateLimitExceeded`, `userRateLimitExceeded`, `calendarUsageLimitsExceeded` | Per-user or per-project short-term flood protection / secondary rate limit triggered | **Yes (Bounded)** — up to `deliveryRetries: 2` (`retryBaseDelayMs: 500`, `retryMaxDelayMs: 5000` + jitter) | Keep `connected`; Note: `backend/src/plugins/google-calendar/calendar-api-http.ts:154-160` currently does **not** retry `403 rateLimitExceeded` (it only retries `429` and `5xx`). Phase 2 should parse the JSON error `reason` on `403` so `rateLimitExceeded` / `userRateLimitExceeded` is classified as `rate-limit` rather than target/permission failure |
| `403` | `quotaExceeded` | Daily/project quota or Workspace external-invite anti-abuse cap exhausted | **No (Terminal)** | Keep `connected`; return `CALENDAR_RATE_LIMITED` / `CALENDAR_QUOTA_EXCEEDED` |
| `404` | `notFound` | Target calendar or event ID was deleted, unshared, or does not exist | **No (Terminal)** | **Keep `connected`** (unlike Phase 1 where `404` on the single pinned calendar meant `CALENDAR_TARGET_UNAVAILABLE` for the whole plugin); mark the specific calendar/event unavailable, invalidate/refresh the discovery snapshot if a calendar 404s, and surface a clear per-calendar error |
| `429` | `rateLimitExceeded` | Too many requests (may include `Retry-After` header) | **Yes (Bounded)** — up to `deliveryRetries: 2` | Keep `connected`; return `CALENDAR_RATE_LIMITED` if retries exhausted |
| `500`, `502`, `503`, `504` | `backendError`, `internalError` | Transient Google server error | **Yes (Bounded)** — up to `deliveryRetries: 2` (read/availability/discovery only; see create idempotency rule below) | Keep `connected`; return `CALENDAR_PROVIDER_UNAVAILABLE` if retries exhausted |

> **Critical Create Retry Rule (Carryover from Phase 1 `calendar-api.ts:276-288`):** `events.insert` (`POST /calendars/{calendarId}/events`) is **not** idempotent at the Google REST layer unless a deterministic `id` or `iCalUID` is supplied, and Phase 1 intentionally sets `retryable: false` on `createEvent` after dispatch to prevent duplicate event creation on ambiguous network timeouts (`calendar-loop.ts:242-254` transitions ambiguous post-dispatch failures to `uncertain` reconciliation). Phase 2 must preserve `retryable: false` on `events.insert`.

---

## 8. MCP SDK 2.3.1 Compatibility Findings

**[Bucket 1 — Primary documentation support]** (`backend/node_modules/@modelcontextprotocol/server/package.json`, `backend/node_modules/@modelcontextprotocol/client/package.json`, `backend/src/plugins/mcp/calendar-server.ts`, `backend/src/plugins/mcp/calendar-client.ts`)

### 8.1 Installed Packages and Wire Era
- Installed versions in `backend/node_modules`:
  - `@modelcontextprotocol/server`: `2.3.1` (depends on `@modelcontextprotocol/core@2.3.1`, `zod@^4.2.0`)
  - `@modelcontextprotocol/client`: `2.3.1` (depends on `@modelcontextprotocol/core@2.3.1`, `zod@^4.2.0`)
- Aurvin's internal MCP bridge (`backend/src/plugins/mcp/calendar-client.ts:25-39` and `calendar-server.ts:32-58`) connects `Client` and `McpServer` in-process over `InMemoryTransport.createLinkedPair()` with `versionNegotiation: { mode: { pin: CALENDAR_MCP_WIRE } }` where `CALENDAR_MCP_WIRE = '2026-07-28'`.

### 8.2 Tool Registration, Annotations, and Output Validation Contract
- `McpServer.registerTool` (`createMcpHandler-D4NN8WsG.d.mts:3372-3382`) accepts:
  ```ts
  server.registerTool(name, {
    title?: string;
    description?: string;
    inputSchema?: StandardSchemaWithJSON; // Zod v4 object schema
    outputSchema?: StandardSchemaWithJSON; // Zod v4 schema
    annotations?: ToolAnnotations; // { title?, readOnlyHint?, destructiveHint?, idempotentHint?, openWorldHint? }
    _meta?: Record<string, unknown>;
  }, cb: (args, ctx: ServerContext) => Promise<CallToolResult>);
  ```
- **Important SDK 2.3.1 Behavior (`calendar-client.ts` & `calendar-server.ts`):**
  1. Both `McpServer.executeToolHandler` (`createMcpHandler-D4NN8WsG.d.mts:3302`) and `Client.callTool` (`client/dist/index.d.mts:2654`) **automatically validate `result.structuredContent` against the tool's registered `outputSchema`**!
  2. In `backend/src/plugins/mcp/calendar-server.ts:47`, every tool in `CALENDAR_TOOLS` is registered with `outputSchema: calendarOutputSchema` (`calendarResultSchema` in `backend/src/contracts/calendar-tools.ts:53-55`).
  3. Currently, `calendarSuccessSchema` (`calendar-tools.ts:42-46`) defines:
     ```ts
     data: z.union([
       calendarListEventsResultSchema,
       calendarEventItemSchema,
       calendarCreateResultSchema,
     ])
     ```
     When adding `calendar_list_calendars` and `calendar_check_availability`, `calendarSuccessSchema.data` **must** be extended to include `calendarListCalendarsResultSchema` and `calendarCheckAvailabilityResultSchema`, or `McpServer` and `Client.callTool` will throw an `InvalidResult` / output-schema validation error at runtime!
  4. `Client.listTools()` (`client/dist/index.d.mts:2722`) auto-aggregates up to `listMaxPages: 64` and caches the tool definitions in `InMemoryResponseCacheStore` for `callTool` output validation. Registering 5 tools at `McpServer` construction time in `calendar-server.ts:39` requires zero `list_changed` notifications and zero new dependencies.

### 8.3 Recommended Annotations for the 5-Tool Surface

| Tool Name | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` | Input Schema Summary |
| --- | --- | --- | --- | --- | --- |
| `calendar_list_calendars` | `true` | `false` | `true` | `true` | `{ pageToken?: string(2048), includeHidden?: boolean }` (or `{ pageToken?: string(2048) }`, page size fixed/bounded <= 20) |
| `calendar_check_availability` | `true` | `false` | `true` | `true` | `{ timeMin: string(96), timeMax: string(96), timeZone?: string(100), calendarIds?: string(1024)[1..100] }` |
| `calendar_list_events` | `true` | `false` | `true` | `true` | `{ calendarId?: string(1024), timeMin: string(96), timeMax: string(96), maxResults: int(1..20), pageToken?: string(2048) }` |
| `calendar_get_event` | `true` | `false` | `true` | `true` | `{ calendarId?: string(1024), eventId: string(1024) }` |
| `calendar_create_event` | `false` | `false` | `false` | `true` | `{ calendarId?: string(1024), summary: string(200), start: string(96), end: string(96), timeZone: string(100), description?: string(2000, 0), location?: string(500, 0) }` |

---

## 9. External Processing, Privacy and Retention

**[Bucket 1 — Primary documentation support]** (`https://developers.google.com/terms/api-services-user-data-policy`, `https://developers.google.com/workspace/workspace-api-user-data-developer-policy`)

1. **Google Workspace API Limited Use & Third-Party LLM Transfers:**
   - Google's *Workspace API User Data and Developer Policy* strictly prohibits using Google Workspace data to train, fine-tune, or improve generalized/non-personalized AI/ML models.
   - Sending Google Calendar data to an external LLM provider (OpenRouter) is permissible **only** to provide the user-facing chat/scheduling assistant feature explicitly invoked by the authenticated user, and requires that prompts/completions containing Workspace data are not retained to train third-party foundation models.
2. **Data Minimization Across Tool Calls:**
   - **Discovery metadata (`calendar_list_calendars`):** Exposes only bounded calendar container metadata (`id`, `summary`, `accessRole`, `primary`, `selected`, `timeZone`).
   - **Availability (`calendar_check_availability`):** Exposes **only** `{ start, end }` busy intervals and per-calendar availability status—never event titles, descriptions, locations, or attendee identities. Model policy instructions (`backend/src/model/calendar-policy.ts`) should instruct the model to prefer `calendar_check_availability` over `calendar_list_events` whenever the user asks whether times are free/busy across multiple calendars.
   - **Event details (`calendar_list_events`, `calendar_get_event`):** Continue Phase 1's strict projection (`calendar-api.ts:448-493`) that strips `attendees`, `creator`, `organizer`, `conferenceData`, `attachments`, and `extendedProperties` before returning results to the MCP layer or LLM context.
3. **Cache & Retention Compliance:**
   - Google's policy forbids building permanent databases of Workspace user data and restricts caching to what is operationally necessary.
   - The goal's **5-minute freshness TTL** (`300,000 ms`), **<=100 calendar entries**, and **<=256 KiB** cap for the persisted discovery snapshot in `integration_connections`, combined with the existing **24-hour `sourceLifetimeMs`** for `agent-memory` tool results and **immediate purging/redaction on disconnect** (`backend/src/persistence/calendar-retention.ts`), satisfy Google's caching and deletion requirements.

---

## 10. Existing Repository Constraints (Exact Codebase Inspection)

**[Bucket 1 — Primary documentation support]** (Inspected directly in repository on branch `codex/google-calendar-plugin`)

### 10.1 Exact Version Constants and Revision Identifiers
- `backend/src/contracts/calendar-policy.ts:6-9`:
  - `CALENDAR_SCHEMA_VERSION = 1 as const`
  - `CALENDAR_PLUGIN_ID = 'google-calendar' as const`
  - `CALENDAR_TOOL_REVISION = 'google-calendar.v1' as const`
  - `CALENDAR_MCP_WIRE = '2026-07-28' as const`
- `backend/src/plugins/google-calendar/calendar-api.ts:23` & `connection.ts:75`:
  - `PROOF_REVISION = 'google-calendar.events-owned.v1'`
- `backend/src/contracts/calendar-wire.ts:27, 134` & `frontend/src/api/calendar-protocol.ts:7-8`:
  - `CALENDAR_PROTOCOL_VERSION = 1` (`calendarStatusResponseSchema.protocolVersion: z.literal(1)`)
  - `CALENDAR_STREAM_PROTOCOL_VERSION = 2` (`calendarStreamEnvelopeSchema.protocolVersion: z.literal(2)`)
- Persisted record schemas enforcing literal versions:
  - `schemaVersion: z.literal(1)` in `connectionRecordSchema`, `oauthStateSchema`, `oauthTombstoneSchema` (`calendar-connections.ts:44, 65, 81`), `operationRecordSchema`, `operationEventSchema`, `resumableDecisionSchema`, `rejectedDecisionSchema` (`calendar-operations.ts:22, 41, 56, 76`), `sourceReferenceSchema`, `calendarToolResultRecordSchema` (`calendar-sources.ts:30, 56`), `turnBudgetRecordSchema`, `modelDispatchSchema`, `modelAggregateSchema`, `reconciliationSchema`, `calendarSourceRecordSchema` (`calendar-accounting.ts:15, 29, 44, 57, 74`).
  - `schemaRevision: z.literal('google-calendar.v1')` in `operationRecordSchema` (`calendar-operations.ts:34`), `resumableDecisionSchema` (`calendar-operations.ts:57`), `CalendarExecutionBinding` (`calendar-tools.ts:138`), and `modelDispatchSchema` (`calendar-accounting.ts:34`).
  - `calendarCheckpointRefsSchema` (`backend/src/persistence/calendar-checkpoints.ts:9-14`): `version: z.literal(1)`, `decisionIds: z.array(idSchema).max(8)`, `toolCallIds: z.array(idSchema).max(6)`, `operationId: idSchema.nullable()`.
  - `CURSOR_VERSION = 1`, `CALENDAR_CURSOR_MAX_LENGTH = 2048` (`backend/src/plugins/google-calendar/calendar-api-cursor.ts:14-15`).

### 10.2 Collections in Use (8 Total in `collections.ts`, 7 in `guardedClient`)
- `backend/src/contracts/collections.ts:20-29` (`COLLECTIONS`) defines **8 collections**:
  1. `sessions` (`'sessions'`)
  2. `messages` (`'messages'`)
  3. `agentMemory` (`'agent-memory'`)
  4. `metadata` (`'metadata'`)
  5. `checkpoints` (`'checkpoints'`)
  6. `checkpointWrites` (`'checkpoint_writes'`)
  7. `config` (`'config'`)
  8. `integrationConnections` (`'integration_connections'`)
- `backend/src/persistence/mutation-journal.ts:74` allowlists the 7 runtime-mutated collections (`'sessions'`, `'messages'`, `'agent-memory'`, `'metadata'`, `'checkpoints'`, `'checkpoint_writes'`, `'integration_connections'`).
- **Phase 2 Impact:** No new MongoDB collection is needed. Discovery snapshots and default calendar settings belong on the `integration_connections` document (or bounded sub-documents in `integration_connections` / `metadata`), and create proposals / availability evidence belong in `metadata` and `agent-memory`.

### 10.3 Existing Tool Catalogue, `forbiddenCalendarKeys`, and `repairDiagnosticsSchema`
- `backend/src/contracts/calendar-tools.ts:7-11`: `CALENDAR_TOOLS = ['calendar_list_events', 'calendar_get_event', 'calendar_create_event'] as const`.
- **Critical Blocker in `forbiddenCalendarKeys` (`calendar-tools.ts:19-26`):**
  - `'calendarId'` and `'targetRevision'` are currently listed in `forbiddenCalendarKeys`!
  - `backend/src/plugins/google-calendar/tools-validation.ts:139-149` (`assertNoForbiddenKeys`) recursively walks the entire tool call `{ name, arguments }` and throws `CALENDAR_FORBIDDEN` if any key in `FORBIDDEN_KEYS` appears at any nesting level.
  - **Phase 2 Requirement:** Remove `'calendarId'` from `forbiddenCalendarKeys` (and add `'calendarIds'` only where appropriate), while keeping `'targetRevision'`, `'connectionId'`, `'connectionRevision'`, `'userId'`, `'attendees'`, etc. forbidden. Strict `.strict()` Zod input schemas per tool (`calendarInputSchemas`) will naturally forbid `calendarId` on `calendar_list_calendars` and `calendar_check_availability` (which uses `calendarIds?: string[]`) while admitting optional `calendarId?: string` on `calendar_list_events`, `calendar_get_event`, and `calendar_create_event`.
- **Critical Blocker in `repairDiagnosticsSchema` (`backend/src/contracts/calendar-model.ts:29-36`):**
  - Hardcodes an enum of allowed diagnostic paths: `['$', 'tool_calls', 'tool_calls.id', 'tool_calls.name', 'tool_calls.arguments', 'timeMin', 'timeMax', 'maxResults', 'pageToken', 'eventId', 'summary', 'start', 'end', 'timeZone', 'description', 'location']`.
  - **Phase 2 Requirement:** Add `'calendarId'`, `'calendarIds'`, and any new tool input keys to this enum so bounded model-argument repair (`backend/src/model/calendar-policy.ts:271-294`) does not fail schema validation when reporting a validation issue on `calendarId` or `calendarIds`.

### 10.4 Current `authorizeCreate` Canonical-JSON Check Location and Callers
- **Definition:** `backend/src/chat-runtime/calendar-operation.ts:18-31`:
  - `canonicalCreateRequest(action)` returns ``Create this Google Calendar event: ${JSON.stringify(calendarInputSchemas.calendar_create_event.parse(action))}``.
  - `authorizeCreate(input: MessageRecord, action: CalendarCreateInput)` compares `input.content.trim() !== canonicalCreateRequest(action)` and returns `{ outcome: 'clarify', message: 'Please confirm the exact event by sending: Create this Google Calendar event: {...}' }`.
- **Callers:**
  1. `CalendarOperationWriter.admitCreate` (`backend/src/chat-runtime/calendar-operation.ts:87`) calls `authorizeCreate(input.message, input.action)`.
  2. `CalendarLoop.execute` (`backend/src/chat-runtime/calendar-loop.ts:222`) calls `this.deps.operations.admitCreate(...)`; when `admitted.outcome === 'clarify'`, it records a `resumable` decision (`calendar-loop.ts:224-236`) and halts the turn with the clarification message.
  3. `backend/src/model/calendar-policy.ts:107-111` (`CALENDAR_POLICY_INSTRUCTIONS`) instructs the model: *"Before calling `calendar_create_event`, ensure the user message explicitly authorizes the exact create payload using `Create this Google Calendar event: <canonical JSON>`."*
  4. `backend/src/contracts/calendar-operations.ts:29-35` (`operationRecordSchema`) requires `authorization.canonicalActionHash === requestHash`.
- **Phase 2 Seam:** Replace the raw canonical-JSON string comparison in `authorizeCreate` and `CALENDAR_POLICY_INSTRUCTIONS` with a durable server-stored create proposal record (10-minute TTL, bound to `userId`, `sessionId`, `connectionId`, `connectionRevision`, `targetCalendarId`, `targetCalendarLabel`, `targetRevision`, and canonical payload hash `requestHash`). When the user has not yet confirmed an active matching proposal, `admitCreate` persists the proposal and returns a human-readable confirmation prompt showing the target calendar name + ID, summary, start/end, and timeZone. When the user replies with a confirmation (or confirms via UI) within 10 minutes, `admitCreate` resolves the stored proposal, verifies its binding/freshness/role, and admits the create with `authorization.canonicalActionHash = proposal.requestHash`.

### 10.5 Current `AURVIN_GOOGLE_CALENDAR_TARGET_ID` Env Pin & Coupling Locations
1. `backend/src/platform/config/calendar-config.ts:11, 70-72`: Reads `env.AURVIN_GOOGLE_CALENDAR_TARGET_ID` into `oauth.targetCalendarId`.
2. `backend/src/contracts/calendar-connections.ts:20-22`: `calendarOAuthOptionsSchema` requires `targetCalendarId: z.string().min(1).max(1024)`.
3. `backend/src/plugins/google-calendar/options.ts:76-80, 99-103, 154`: `assertOwnedTarget` rejects `'primary'` (`if (calendarId === 'primary') configError()`) and fails startup/config if `AURVIN_GOOGLE_CALENDAR_TARGET_ID` is absent in OAuth mode.
4. `backend/src/plugins/google-calendar/connection.ts:148, 171-186, 372-374`: Pins `targetCalendarId` in `SetupSnapshot`, calls `verifyOwnedTarget` (requiring `accessRole === 'owner'` in `calendar-api.ts:405`) during `installGrant`, and throws `CALENDAR_EXECUTION_DENIED` in `requireUsable` if `record.calendarId !== this.options.oauth.targetCalendarId`.
5. `backend/src/persistence/calendar-connections.ts:210-218` (`assertTransition`):
   ```ts
   const targetChanged = next.calendarId !== current.calendarId;
   const invalidateConnection = subjectChanged || connectionChanged || targetChanged || disconnected;
   if (invalidateConnection && next.connectionRevision !== current.connectionRevision + 1) ...
   ```
   **Critical Seam:** Currently, changing `calendarId` on `ConnectionRecord` forces `connectionRevision + 1`, which fences and invalidates all active operations, cursors, and checkpoints! In Phase 2, changing the user's saved default calendar (`defaultCalendarId`) must increment `defaultSettingRevision` (or `targetRevision`) **without** incrementing `connectionRevision` (`goal.md:26, 39, 55`).
6. `backend/src/plugins/google-calendar/controller-http.ts:152-194`:
   - Line 152 rejects any URL containing `?` on non-callback routes (`if ((req.url ?? '').includes('?')) sendFault(res, 'INVALID_REQUEST')`).
   - Lines 157-194 only route `GET /api/plugins/google-calendar/status` and `POST` control actions (`enable`, `disable`, `oauth/start`, `disconnect`).
   - **Phase 2 Seam:** `controller-http.ts` must admit `GET /api/plugins/google-calendar/calendars` (with bounded query params `pageToken` / `refresh` if used) and `POST /api/plugins/google-calendar/default-calendar` (or `PATCH`).
7. `frontend/src/features/plugins/google-calendar/GoogleCalendarPanel.tsx:179-183, 253, 269`: Gates `canStartOAuth` on `status.targetCalendarId !== null` and displays `Target calendar (owned)`.

---

## 11. Proposed Phase 2 Ceilings vs Actual Provider and Existing Limits

**[Bucket 1 — Primary documentation support]** (`docs/google-calendar-multi-calendar/goal.md:43-47`, `backend/src/contracts/calendar-policy.ts:10-15`, `backend/src/contracts/budgets.ts:82-107`, `backend/src/plugins/google-calendar/calendar-api-http.ts:5-6`, `frontend/src/api/calendar-client.ts:18-19`)

| Proposed Phase 2 Ceiling (`goal.md`) | Provider Limit (Google Calendar API v3) | Existing Repository Limit | Conflict / Compatibility Verdict |
| --- | --- | --- | --- |
| **At most `100` retained calendar entries** per user discovery snapshot | `calendarList.list` `maxResults` up to `250` per page; no hard account cap | None (Phase 1 stored 1 `calendarId`) | **Compatible.** Fetching with `maxResults=100` (or `250`) retrieves 100 entries in 1 HTTP call in the common case. If >100 entries exist, retain deterministic priority order (`primary`, `owner`, `writer`, `selected`, lexical `id`) and set `truncated: true`. |
| **At most `10` discovery HTTP page deliveries** per refresh | No page count limit; `maxResults` default `100`, max `250` | `CALENDAR_LIMITS.calendarRequests = 20` per turn (`calendar-policy.ts:11`) | **Tension with per-turn HTTP budget (See Section 14 Contradiction 4).** Consuming 10 HTTP requests for an in-turn discovery refresh would eat 50% of the 20-request turn budget. Request `maxResults=100` per page so discovery normally takes 1 HTTP call, and cap *in-turn* discovery refresh at `<=2` HTTP requests (keeping the `10`-page ceiling for OAuth install / explicit out-of-turn UI refresh). |
| **At most `20` calendar entries** per UI or tool page | N/A (Aurvin pagination over retained snapshot) | `CALENDAR_LIMITS.resultBytes = 16384` (16 KiB) & frontend `MAX_RESPONSE_BYTES = 16384` (`calendar-client.ts:19`) | **Compatible and necessary.** 20 normalized calendar entries (~200–350 bytes each = ~4–7 KiB) fit comfortably inside both the 16 KiB MCP tool result budget (`tools.ts:193`) and the 16 KiB frontend HTTP response cap (`calendar-client.ts:19`). |
| **At most `5` minutes (`300,000 ms`)** discovery freshness before expiry-aware refresh | Google Workspace policy requires bounded operational caching | `oauthStateMs = 600000` (10m), `sourceLifetimeMs = 86400000` (24h) | **Compatible.** Add `discoveryFreshnessMs: 300_000` to `CALENDAR_LIMITS`. |
| **At most `100` calendars** per availability scan | **`freebusy.query` `calendarExpansionMax` hard maximum is `50` calendars per request** | `CALENDAR_LIMITS.calendarRequests = 20` per turn | **Provider ceiling conflict (See Section 14 Contradiction 2).** Google rejects >50 calendars in a single `freebusy.query` call (`tooManyCalendarsRequested`). To support up to `100` calendars per availability scan, `calendar-api.ts` **must batch** `calendarIds` into chunks of at most **50 calendars per `freebusy.query` POST request** (at most 2 HTTP requests for 100 calendars, both counted in `calendarRequests`). |
| **At most `2,000` busy intervals** per availability scan | Google `freebusy.query` returns all busy blocks in `[timeMin, timeMax]` | **`CALENDAR_LIMITS.resultBytes = 16384` (16 KiB; 15,360 bytes after 1 KiB envelope headroom in `tools.ts:193`)**; `CALENDAR_RESPONSE_BYTES = 262144` (256 KiB raw HTTP) | **Hard MCP result-size conflict (See Section 14 Contradiction 3).** 2,000 JSON busy intervals (`{"start":"...","end":"..."}` ~65 bytes each) serialize to **~130 KiB**, which is **8.5x larger** than the 16 KiB MCP tool result cap (`calendar-policy.ts:13`, `tools.ts:193`, `calendar-server.ts:61`)! `2,000` busy intervals can **only** be the raw provider-ingestion ceiling before interval merging/projection; the MCP tool result returned by `calendar_check_availability` must still fit within `resultBytes` (16 KiB) by merging overlapping intervals and/or capping serialized output with `truncated: true`. |
| **At most `256 KiB` (`262,144` bytes)** persisted discovery snapshot size | N/A | `maxDocumentBytes = 1_800_000` (1.8 MB in `persistence-profile.ts:33`); `CALENDAR_RESPONSE_BYTES = 262_144` | **Compatible with MongoDB storage (`1.8 MB` headroom).** Note that 100 normalized calendar entries with bounded strings (`id <= 1024`, `summary <= 256`, `timeZone <= 100`) will occupy <=150 KiB, well within 256 KiB. Never return the full 256 KiB snapshot in one HTTP/MCP response; always paginate at <=20 entries per page so responses stay <=16 KiB. |
| **At most `10` minutes (`600,000 ms`)** create-proposal lifetime before re-confirmation | N/A | Matches `CALENDAR_LIMITS.oauthStateMs = 600_000` (10 min in `calendar-policy.ts:14`) | **Compatible.** Store create proposals in `metadata` with `expiresAt = createdAt + 600_000` and clean up via existing retention sweep (`calendar-retention.ts`). |
| **Existing per-turn budgets** (`modelDispatches: 8`, `repairs: 2`, `logicalTools: 6`, `creates: 1`, `calendarRequests: 20`, `refreshRequests: 2`, `deliveryRetries: 2`, `listDays: 31`, `eventsPerResult: 20`, `argumentBytes: 16384`, `resultBytes: 16384`, `toolTimeoutMs: 20000`, `totalRunTimeoutMs: 180000`, `modelSpendUsd: '1'`) | Google per-user quota: 600 req/min | Enforced in `calendar-policy.ts`, `calendar-budget.ts`, `calendar-loop.ts` | **Compatible**, provided in-turn discovery refresh uses `maxResults=100` (<=2 HTTP requests) and `freebusy.query` batches <=50 calendars per request (<=2 HTTP requests). |

---

## 12. Migration and Consent Implications

**[Bucket 1 — Primary documentation support]** (`backend/src/contracts/calendar-*.ts`, `backend/src/persistence/calendar-connections.ts`, `backend/src/chat-runtime/calendar-recovery.ts`)

1. **Schema Version & Revision Bump:**
   - Advance `CALENDAR_TOOL_REVISION` from `'google-calendar.v1'` to `'google-calendar.v2'` (or admit both v1 and v2 in read schemas while writing v2).
   - Advance `PROOF_REVISION` from `'google-calendar.events-owned.v1'` to `'google-calendar.multi.v2'`.
   - In `connectionRecordSchema` (`backend/src/contracts/calendar-connections.ts:43-62`), support reading legacy v1 connection records (`schemaVersion: 1`, single `calendarId`, `calendar.events.owned` grant) and migrating/Projecting them deterministically:
     - If a stored `connected` record lacks any required Phase 2 scope (`calendar.calendarlist.readonly`, `calendar.events`, `calendar.freebusy`) or lacks a v2 discovery proof, `getStatus` / `requireUsable` must classify it as **`reconnect-required`** (`reason: 'scope-upgrade-required'`) without crashing startup or corrupting historical records.
2. **Incremental Re-Consent Flow (`include_granted_scopes=true`):**
   - When an existing connection in `reconnect-required` initiates `oauth/start`, pass `include_granted_scopes=true` and `prompt=consent` on the Google authorization URL so the user is prompted to grant the new multi-calendar scopes (`calendar.calendarlist.readonly`, `calendar.events`, `calendar.freebusy`) and Google issues a fresh token covering the full scope set.
   - Verify on callback that the returned `googleSubjectId` (`sub`) matches the existing connection's `googleSubjectId` (or, if account switching is allowed only after disconnect, enforce the existing `subjectChanged` guard in `connection.ts:192-199`).
   - Increment `connectionRevision` on re-consent/reconnect, which automatically invalidates any pre-upgrade cursors, resumable decisions, and pending proposals.
3. **Decoupling `connectionRevision` from Default Calendar Changes (`assertTransition` in `backend/src/persistence/calendar-connections.ts:210-218`):**
   - Separate connection-level fields from target/default-calendar fields:
     - `connectionRevision`: increments **only** on initial connect, reconnect/re-consent, subject change, or disconnect.
     - `defaultCalendarId` + `defaultSettingRevision`: increments when the user changes their saved default calendar in the UI (`POST /api/plugins/google-calendar/default-calendar`). Changing `defaultCalendarId` must **not** increment `connectionRevision` and must **not** invalidate in-flight operations or cursors that already bound a concrete `targetCalendarId` and `targetRevision`!
4. **Legacy v1 Operation / Checkpoint / Cursor Recovery (`calendar-recovery.ts`, `calendar-checkpoints.ts`):**
   - Existing v1 completed/failed/cancelled operation receipts in `metadata` and `messages` must remain readable for historical session rendering (`CalendarOperationReceipt.tsx`).
   - Any non-terminal v1 operation (`planned`, `pending`, `resumable` with `schemaRevision === 'google-calendar.v1'` or missing `targetCalendarId`) encountered during startup/turn recovery (`calendar-recovery.ts`) must fail closed to a terminal `failed` / `cancelled` state requiring a fresh v2 proposal rather than attempting to execute against an unverified target.
   - Cursors (`calendar-api-cursor.ts`) already bind `calendarId` and `targetRevision` inside `bindingFingerprint`; bumping `CURSOR_VERSION` to `2` (or keeping `bindingFingerprint` with concrete `calendarId` + per-calendar `targetRevision`) ensures Phase 1 cursors are rejected cleanly with `CALENDAR_INVALID_CURSOR`.

---

## 13. Fixtures and Live Prerequisites

### What Can Be Proven Offline in Deterministic Suites (P10 Routine / Behavior / E2E Checks)
- **OAuth & Scope Validation:** Partial scope grants (missing `calendar.calendarlist.readonly`, `calendar.events`, or `calendar.freebusy`), Phase 1 `calendar.events.owned` upgrade detection -> `reconnect-required`, `include_granted_scopes=true` URL generation, and `sub` mismatch rejection.
- **Discovery Snapshot & Pagination:** Multi-page `calendarList.list` assembly, 100-calendar truncation ordering (`primary`, `owner`, `writer`, `selected`, lexical `id`), 10-page delivery cap, 256 KiB snapshot cap, 5-minute TTL expiry refresh, `deleted`/`hidden` filtering, and 20-item UI/tool pagination with bound cursors.
- **Role Matrix & Target Precedence:** `owner` and `writer` (and `writerWithoutPrivateAccess`) write admission; `reader` and `freeBusyReader` write rejection before provider call; `freeBusyReader` event-read rejection before provider call; `explicit > saved default > primary` resolution; and fencing against mid-turn default calendar changes (`defaultSettingRevision` vs `connectionRevision`).
- **Availability (`freebusy.query`):** 50-calendar batching up to 100 calendars (2 batches), interval merging across timezones and DST transitions, all-day/recurring/tentative/transparent fixture handling, and per-calendar `errors[]` isolation (reporting errored calendars as `unavailable`/`error`, never `free`).
- **Two-Step Create Confirmation:** 10-minute proposal creation, natural confirmation/cancellation, expiry handling, parameter-tamper rejection, and idempotent replay without duplicate `events.insert`.

### What Remains a `[Bucket 3 — Still-Unrun Service Gate]` Requiring Operator Action
1. **Live Google OAuth Consent Screen & Granular Checkbox Drill:** Requires an operator-controlled Google Cloud OAuth client configured with `openid`, `email`, `calendar.calendarlist.readonly`, `calendar.events`, and `calendar.freebusy`, verifying actual Google consent screen prompts, `include_granted_scopes=true` upgrade from a Phase 1 grant, and partial-checkbox rejection.
2. **Live Multi-Calendar ACL Drill:** Requires a real Google account subscribed to (a) its `primary` calendar, (b) a secondary `owner` calendar, (c) a shared `writer` calendar owned by another account, (d) a `reader` calendar, and (e) a `freeBusyReader` calendar, verifying live `calendarList.list`, `freebusy.query`, `events.list`, and `events.insert` behavior.
3. **Replica-Set MongoDB Persistence Drill:** Requires operator-supplied `AURVIN_TEST_MONGODB_URI` pointing to a replica-set instance (`AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`) to certify native persistence indexes and mutation journal behavior beyond standalone smoke.

---

## 14. Contradictions and Corrections to the Approved Goal

The orchestrator must review the following contradictions and tensions between `docs/google-calendar-multi-calendar/goal.md` (and the input roadmap `docs/google-calendar-plugin/future-phase-multi-calendar.md`) and primary Google Calendar API v3 documentation / existing repository budgets:

1. **CONTRADICTION 1 — Approved Scope Set Omits `https://www.googleapis.com/auth/calendar.freebusy`, Which `freebusy.query` Requires:**
   - *Goal statement (`goal.md:20`):* "Adopt the least-sufficient scope set for multi-calendar operation: `openid`, `email`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and `https://www.googleapis.com/auth/calendar.events`."
   - *Goal requirement (`goal.md:27, 50, 57`):* Support `calendar_check_availability` across selected calendars, including `freeBusyReader` calendars.
   - *Primary doc fact (`https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query`):* `POST https://www.googleapis.com/calendar/v3/freeBusy` (`freebusy.query`) is **not** authorized by `calendar.events` or `calendar.calendarlist.readonly`. It requires `https://www.googleapis.com/auth/calendar.freebusy` (or `calendar.events.freebusy`, `calendar.readonly`, or `calendar`). Furthermore, `freeBusyReader` calendars cannot be queried via `events.list`.
   - *Required correction:* Add `https://www.googleapis.com/auth/calendar.freebusy` to the Phase 2 required scope set (`openid`, `email`, `calendar.calendarlist.readonly`, `calendar.events`, `calendar.freebusy`).

2. **CONTRADICTION 2 — `100` Calendars per Availability Scan vs Google `freebusy.query` Hard Limit of `50` Calendars per Request:**
   - *Goal statement (`goal.md:45`):* "Enforce availability bounds of at most `100` calendars ... per availability scan."
   - *Primary doc fact (`https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query`):* Google's `freebusy.query` parameter `calendarExpansionMax` has a hard maximum of **`50` calendars per HTTP request** (exceeding 50 yields `tooManyCalendarsRequested`).
   - *Required correction:* Planners (P1/P3) must specify that an availability scan of 51–100 calendars is **batched into at most 2 `freebusy.query` HTTP requests of <=50 calendars each**, with each HTTP request counted against the per-turn `calendarRequests: 20` budget.

3. **CONTRADICTION 3 — `2,000` Busy Intervals Ceiling vs Existing `16 KiB` (`16,384` bytes) MCP Tool Result Budget:**
   - *Goal statement (`goal.md:45`):* "Enforce availability bounds of at most `100` calendars and at most `2,000` busy intervals per availability scan."
   - *Repository fact (`backend/src/contracts/calendar-policy.ts:13`, `backend/src/plugins/google-calendar/tools.ts:193`, `backend/src/plugins/mcp/calendar-server.ts:61`):* Every MCP tool result is hard-capped at `CALENDAR_LIMITS.resultBytes = 16384` bytes (`15,360` bytes of payload after `ENVELOPE_HEADROOM_BYTES = 1024`). Serializing 2,000 busy intervals (`{"start":"...","end":"..."}`) requires **~130 KiB**, which will fail `tools.ts:193` and `calendar-server.ts:61` with `CALENDAR_RESULT_OVERSIZE`!
   - *Required correction:* Define `2,000` busy intervals as the **provider-response ingestion ceiling** (before interval coalescing/merging, within `CALENDAR_RESPONSE_BYTES = 256 KiB`), and require `calendar_check_availability` to coalesce overlapping intervals and bound the returned MCP `structuredContent` payload within `15,360` bytes (e.g., <=150 merged busy intervals across the scan or explicit `truncated: true` status when serialized output would exceed `resultBytes`).

4. **CONTRADICTION 4 — `10` Discovery HTTP Page Deliveries per Refresh vs `20` Calendar HTTP Requests per Turn Budget:**
   - *Goal statement (`goal.md:44`):* "Enforce discovery bounds of ... at most `10` discovery HTTP page deliveries per refresh... Perform an expiry-aware refresh before use."
   - *Repository fact (`backend/src/contracts/calendar-policy.ts:11`):* `CALENDAR_LIMITS.calendarRequests = 20` caps total Calendar HTTP requests per accepted chat turn across all tool calls and retries.
   - *Required correction:* Always pass `maxResults=100` (or `250`) to `calendarList.list` so up to 100 calendars are fetched in **1 HTTP request** normally; reserve the 10-page delivery ceiling for out-of-turn discovery (OAuth connect / UI refresh) or bound in-turn auto-refresh to at most 2 page deliveries so a chat turn retains budget for availability/event calls and retries.

5. **CORRECTION 5 — Undocumented Google `accessRole` Value `writerWithoutPrivateAccess`:**
   - *Goal statement (`goal.md:30-31`):* Mentions only `owner`, `writer`, `reader`, and `freeBusyReader`.
   - *Primary doc fact (`https://developers.google.com/workspace/calendar/api/v3/reference/calendarList#resource`):* Google Calendar API v3 also returns `accessRole: "writerWithoutPrivateAccess"` on shared/Workspace calendars where the user can read/write non-private events and view free/busy for private events.
   - *Required correction:* P1/P2 must either include `'writerWithoutPrivateAccess'` in `calendarAccessRoleSchema` (treating it as writable alongside `'owner'` and `'writer'`) or normalize `'writerWithoutPrivateAccess'` to `'writer'` with `privateAccess: false` at the provider ingestion boundary so a single Workspace calendar with that role does not fail Zod parsing of the entire discovery snapshot.

6. **CORRECTION 6 — Source Roadmap Sensitivity & Verification Assumptions (`docs/google-calendar-plugin/future-phase-multi-calendar.md`):**
   - The source roadmap treated scope sensitivity classifications and verification exemptions as open assumptions. Primary Google OAuth documentation (`https://developers.google.com/identity/protocols/oauth2/scopes#calendar`) classifies `calendar.calendarlist.readonly`, `calendar.events`, `calendar.freebusy`, and `calendar.events.owned` all as **Sensitive** scopes (none are Non-Sensitive, and none are Restricted). Switching from `calendar.events.owned` to the Phase 2 scopes does **not** trigger Restricted-scope CASA audits, nor does it exempt a public external app from standard Sensitive-scope OAuth verification.

---

## 15. Open Questions for the Orchestrator / User

1. **Scope Addition Approval (`calendar.freebusy`):** Should P1 add `https://www.googleapis.com/auth/calendar.freebusy` to `CALENDAR_SCOPES` alongside `openid`, `email`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and `https://www.googleapis.com/auth/calendar.events` so `POST /calendar/v3/freeBusy` (`calendar_check_availability`) is authorized by Google on all calendars including `freeBusyReader`? *(Recommended: Yes — required by Google Calendar API v3 `freebusy.query` reference.)*
2. **Availability Scan Batching (50 vs 100 Calendars):** Should P1/P3 keep the `100`-calendar ceiling on `calendar_check_availability` by batching >50 calendars into 2 `freebusy.query` HTTP requests of <=50 calendars each, or lower the per-call tool ceiling to `50` calendars to match a single Google `freebusy.query` request? *(Recommended: Keep `100` in the contract and batch into at most 2 `freebusy.query` requests of `<=50` calendars each.)*
3. **MCP Result Byte Budget for `calendar_check_availability`:** Should `CALENDAR_LIMITS.resultBytes` remain `16,384` bytes (with `2,000` busy intervals treated as the raw provider-ingestion cap before interval merging and 16 KiB output truncation), or should `resultBytes` be raised for `calendar_check_availability`? *(Recommended: Keep `resultBytes = 16_384` to protect the 16K context/history token budget in `DEFAULT_BUDGETS`, treat `2,000` as the raw provider-ingestion cap, merge overlapping busy intervals, and return an explicit `truncated: true` indicator if serialized output would exceed `15,360` bytes.)*
4. **Handling `writerWithoutPrivateAccess`:** Should `calendarAccessRoleSchema` include `'writerWithoutPrivateAccess'` as a 5th enum member (treated as writable), or should `calendar-api.ts` normalize it to `'writer'` during `calendarList.list` ingestion? *(Recommended: Admit `'writerWithoutPrivateAccess'` in the provider parser and either include it in `calendarAccessRoleSchema` as writable or normalize to `'writer'` so discovery never fails on Workspace calendars.)*
