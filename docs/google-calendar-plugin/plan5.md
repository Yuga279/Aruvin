# P5 Calendar Adapter and Embedded MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` and `test-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is one assigned MAW worker, not authorization to dispatch additional agents.

**Goal:** Implement exactly three bounded Calendar tools over an Aurvin-owned Calendar REST adapter and prove their production discovery/execution through the official embedded MCP handler/client.

**Architecture:** A small fixed registry reuses P1's schemas. A stateless API/tools implementation consumes trusted connection, credential, request-accounting, and operation bindings; an embedded MCP execution port invokes that same implementation through real SDK `Request`/`Response` handling. P6 persists operation authority and all turn-wide counters; P3 owns credentials and current connection checks; P8 owns application assembly and shutdown registration.

**Tech Stack:** Node `^22.22.3 || ^24.15.0 || >=26.0.0`, TypeScript NodeNext with `.js` local imports, native fetch/URL/Intl/AbortSignal/crypto, existing Zod 3.25.76 and Vitest, exact `@modelcontextprotocol/client@2.3.1` and `@modelcontextprotocol/server@2.3.1` (core 2.3.1), modern MCP wire `2026-07-28`.

---

## Steps

- [ ] 1. Freeze the fixed registry and semantic/action helpers.
- [ ] 2. Implement bounded Calendar HTTP decoding and safe failure classification.
- [ ] 3. Implement bounded list/get, target preflight, projections, and opaque cursors.
- [ ] 4. Implement supplied-ID create and linkage-verifying readback.
- [ ] 5. Implement direct API tools with trusted credentials, authority, and source permissions.
- [ ] 6. Register the production bound MCP server with the frozen schemas.
- [ ] 7. Implement the production embedded client/execution port and genuine SDK tests.
- [ ] 8. Close cancellation/drain/error regressions and publish the P6/P8 handoff.

## Execution boundary and compatibility baseline

Read `goal.md`, `research.md`, and the P5 section of `state.md`. Approval is recorded in state; old pending-approval prose in the goal is historical. P1 is implemented, including dependency freeze commit `916427a`; its `backend/test/contracts/calendar-mcp-compatibility.spec.ts` is the executable SDK syntax reference, not a substitute for P5's production tests.

Consume, without changing:

- `backend/src/contracts/calendar-tools.ts`: `CALENDAR_TOOLS`, `calendarInputSchemas`, `calendarCallSchema`, `calendarResultSchema`, `forbiddenCalendarKeys`, `jsonBytes`, `CalendarCall`, `CalendarCreateInput`, `CalendarResult`.
- `backend/src/contracts/calendar-mcp-schema.ts`: `withStandardJsonSchema`. Do not create another Zod bridge or switch root Zod to v4.
- `backend/src/contracts/calendar-policy.ts`: plugin/schema/wire revisions, `CALENDAR_LIMITS`, `CalendarLimits`, `CalendarFailure` and `calendarFailureSchema`.
- `backend/src/contracts/calendar-connections.ts`: `CalendarCredentialPort`, `CalendarConnectionGate`, `CalendarTargetPort`, `CalendarConnectionBinding`.
- `backend/src/contracts/calendar-operations.ts`: `CalendarExecutionPort`, `CalendarExecutionBinding`, `CalendarExecutionResult`, `CalendarRequestKind`, `CalendarOperation`, receipt/operation schemas.
- `backend/src/contracts/calendar-sources.ts`: source/permission schemas, `effectiveSourceExpiry` and `CalendarSourceReference`.

No P2/P4 implementation is a prerequisite. Use deterministic implementations of those ports. Do not import their stores, instantiate MongoDB, modify contracts/manifests, or edit P3's `oauth*`, `connection*`, `controller*`, `module*`, `options*` paths. P5 does not parse raw provider JSON, repair model decisions, grant authorization, reserve operations, persist counters, mark durable success, or expose HTTP routes. Do not introduce a generic plugin framework.

The entire frozen advertised surface is:

| Tool | Exact model arguments | Stable REST operation |
| --- | --- | --- |
| `calendar_list_events` | `timeMin`, `timeMax`, `maxResults` (required); `pageToken` (optional) | One `events.list` page on the bound owned calendar |
| `calendar_get_event` | `eventId` (required) | `events.get` on the bound owned calendar |
| `calendar_create_event` | `summary`, `start`, `end`, `timeZone` (required); `description`, `location` (optional) | `events.insert` with the persisted server-supplied event ID |

`summary` is P1's frozen name for the goal's event title; do not advertise a second `title` alias. Identity, credentials, calendar, revision, operation authority and endpoint are never model arguments. Readback and target preflight are internal ports, not additional model tools.

Preserve all approved ceilings: 20 events, 31-day list range, 16,384 UTF-8 bytes per arguments/result, 20-second tool timeout bounded by the remaining turn deadline, two delivery retries after the original, and all smaller supplied limits. There is **no** 24-hour event-duration cap. P6 owns the 20-request Calendar total, separate two-refresh total, six logical calls, one logical create, and persisted retry counts. The direct adapter does one delivery per call; it returns retry/readback advice rather than hiding a loop. P6 persists delivery admission and calls the port again with the same operation/event ID.

Stop and report an incompatibility requiring changed transport, local/member scope, limits, actions, repair behavior, retention, or a shared contract amendment. Do not silently fall back to an SDK mock, v1 SDK, linked in-memory transport, socket server, broader scope, `primary` target, new write ID, or unconditional retention. Unified review remains **skipped**, never passed.

### File map (all new; do not create files outside these ownership prefixes)

| Path | Single responsibility |
| --- | --- |
| `backend/src/plugins/registry.ts` | Fixed catalogue, deep-parity check; no plugin loading |
| `backend/src/plugins/google-calendar/tools-validation.ts` | Strict arguments, temporal semantics, canonical action/hash, supplied-ID/authority checks |
| `backend/src/plugins/google-calendar/calendar-api-http.ts` | Fixed-origin fetch, bounded decoding, response-header evidence and safe faults |
| `backend/src/plugins/google-calendar/calendar-api-cursor.ts` | Process-local signed bounded continuation tied to target/revision/query |
| `backend/src/plugins/google-calendar/calendar-api.ts` | Stable list/get/create/readback/owned-target preflight and minimized event projection |
| `backend/src/plugins/google-calendar/tools.ts` | Direct `CalendarExecutionPort`, trusted gates/credentials, source/receipt construction |
| `backend/src/plugins/mcp/calendar-server.ts` | Production MCP factory, bound callbacks, result encoding |
| `backend/src/plugins/mcp/calendar-client.ts` | Real embedded SDK client, catalogue verification, decoded execution port and channel lifetime |
| `backend/test/plugins/google-calendar/tools-fixtures.ts` | Bounded fake bindings/operations, scripted Google fetch, gate/credential/accounting probes |
| `backend/test/plugins/google-calendar/tools-validation.spec.ts` | Semantics/authority/hash regression cases |
| `backend/test/plugins/google-calendar/calendar-api-http.spec.ts` | HTTP/body/error/deadline bounds |
| `backend/test/plugins/google-calendar/calendar-api-cursor.spec.ts` | Cursor integrity and query/target binding |
| `backend/test/plugins/google-calendar/calendar-api.spec.ts` | REST operations, safe defaults and readback |
| `backend/test/plugins/google-calendar/tools.spec.ts` | Direct API tool behavior before MCP |
| `backend/test/plugins/mcp/calendar-server.spec.ts` | Real SDK-to-production-handler schemas and denials |
| `backend/test/plugins/mcp/calendar-client.spec.ts` | Production embedded host discovery/calls/tamper/closure |

Use inline Vitest snapshots, so no snapshot directory outside the listed paths is needed. Keep shared fixtures in `tools-fixtures.ts`; they are fake services, **not** a fake MCP client or server. If an existing helper actually fits when execution begins, reuse it without changing another owner's file; otherwise the narrow helpers above suffice.

All `npm` commands below run from `backend/`. Git paths are repository-relative and commit commands run at the repository root. Obtain the orchestrator's staging/commit turn for each task; stage only the named task files. Never stage this plan's progress with implementation files unless specifically authorized. Tick completed steps in this plan as required by the execution workflow and report that documentation change separately.

Within a task, run the red/implementation/green sequence for one small table case at a time; do not write the entire table's implementation first. The broader commands at each task's end verify accumulated coverage. Plans are not test results: all checks below are required worker actions, not claims of passes by this planner.

## Task 1: Fixed registry and exact Calendar semantics

**Files:** Create `backend/src/plugins/registry.ts`, `backend/src/plugins/google-calendar/tools-validation.ts`; test `backend/test/plugins/google-calendar/tools-validation.spec.ts`.

- [ ] **1.1 Write the failing tests.** Import the exports named below from those paths. Start with this complete regression; add the table entries immediately below as separate `it.each` cases in the same file.

```typescript
import { expect, it } from 'vitest';
import { CALENDAR_TOOLS } from '../../../src/contracts/calendar-tools.js';
import { assertCalendarCatalogue } from '../../../src/plugins/registry.js';
import { validateCalendarCall, calendarActionHash, calendarEventId }
  from '../../../src/plugins/google-calendar/tools-validation.js';

it('validates explicit offsets without an invented creation duration cap', () => {
  const call = { name: 'calendar_create_event', arguments: {
    summary: 'Two-day visit', start: '2026-10-21T10:00:00+01:00',
    end: '2026-10-23T11:00:00+01:00', timeZone: 'Europe/London',
  } };
  expect(validateCalendarCall(call)).toEqual(call);
  expect(() => validateCalendarCall({ ...call, arguments: {
    ...call.arguments, start: '2026-10-21T10:00:00Z',
  } })).toThrow('TIME_REQUIRES_CLARIFICATION');
  expect(calendarActionHash(call.arguments)).toBe(calendarActionHash({
    timeZone: call.arguments.timeZone, end: call.arguments.end,
    start: call.arguments.start, summary: call.arguments.summary,
  }));
  expect(calendarEventId('operation-1')).toMatch(/^[0-9a-v]{64}$/);
  expect(calendarEventId('operation-1')).toBe(calendarEventId('operation-1'));
  expect(calendarEventId('operation-2')).not.toBe(calendarEventId('operation-1'));
  const catalogue = CALENDAR_TOOLS.map(({ revision: _revision, ...tool }) => tool);
  expect(() => assertCalendarCatalogue(catalogue)).not.toThrow();
  expect(() => assertCalendarCatalogue(catalogue.slice(1))).toThrow('CATALOGUE_CHANGED');
});
```

Required semantic fixtures:

| Case | Expected |
| --- | --- |
| Exact 31 days / 31 days plus a fractional second / reversed or equal range | Accept / clarification / clarification |
| Page sizes 1, 20, 0, 21, noninteger; unknown innocuous field | First two accept; remaining structural failure |
| Date-only, local time without offset, invalid calendar date, trailing prose, `-00:00`, invalid IANA zone | Clarification; zero fetches |
| New York gap `2026-03-08T02:30:00-05:00` | Clarification, no normalization to 03:30 |
| New York fold `2026-11-01T01:30:00-04:00` and `-05:00` | Both accept; either invalid offset rejects |
| London `+01:00` summer and `Z` winter; UTC `Z` and `+00:00` | Accept consistent offsets |
| End after start by a fraction smaller than one millisecond | Accept, not rounded equal |
| Invalid day/month, 24:00, unsupported leap-second representation | Clarification, never silently normalized |
| Each `forbiddenCalendarKeys` entry at root or nested; all-day shape; attempted updates/deletes as tool names | Policy failure, never schema repair |
| Innocuous extra key, wrong primitive, absent required field | Structural failure; normalized code only |
| Event ID with `/`, `?`, `%`, Unicode, CR/LF, `.` or `..` | Opaque reads may percent-encode non-control characters; reject controls and standalone dot segments; never interpolate an unescaped path |

- [ ] **1.2 Run red.** `npm test -- test/plugins/google-calendar/tools-validation.spec.ts -t "validates explicit offsets"`. Expected: missing module/export, not a passing zero-test run.

- [ ] **1.3 Implement the minimum fixed helpers.** Registry exports `calendarCatalogue()` returning a fresh deep copy of P1 name/description/inputSchema, `assertCalendarCatalogue(actual: unknown): void`, and no registry mutation API. Compare complete sorted-by-name definitions with `node:util.isDeepStrictEqual`; reject duplicates, extra/missing tools, descriptions, properties, required arrays, additional-properties changes, or unexpected catalogue pagination. SDK metadata not part of a tool definition must be handled explicitly, not by dropping unknown schema fields. Keep the authoritative P1 objects untouched.

Use this canonical identity/hash implementation; P6 reuses it before saving authority:

```typescript
import { createHash } from 'node:crypto';
import { calendarInputSchemas, type CalendarCreateInput }
  from '../../contracts/calendar-tools.js';

export function calendarActionHash(value: CalendarCreateInput): string {
  const input = calendarInputSchemas.calendar_create_event.parse(value);
  const canonical = JSON.stringify({ summary: input.summary, start: input.start,
    end: input.end, timeZone: input.timeZone,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.location === undefined ? {} : { location: input.location }) });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
export function calendarEventId(operationId: string): string {
  return createHash('sha256').update(`aurvin.google-calendar.v1:${operationId}`, 'utf8').digest('hex');
}
```

`CalendarToolFault extends Error` carries only a validated `CalendarFailure`; `message` equals its allowlisted code, not raw Zod/Google text. Export `toolFault(category, code, retry = 'none')` to construct it. `validateCalendarCall(value: unknown, limits = CALENDAR_LIMITS): CalendarCall` first checks byte/depth bounds and forbidden keys recursively, then strict P1 schema, then semantics. Reject forbidden keys before generic schema failures. On an SDK direct call that rejected arguments before the callback, a sanitized protocol validation error is sufficient; it must still execute nothing. P4/P6 remain responsible for model repair classification before this boundary.

Implement strict timestamp parsing as `parseCalendarTimestamp` plus `compareCalendarTimes`, used by both validation and readback. Require a complete RFC3339 timestamp, real Gregorian date, explicit known numeric offset or `Z`, hours/minutes/seconds in range, and finite representable instant. Do not use permissive `Date.parse` alone. Preserve fractional precision for order/range comparison: return integer `epochSeconds: bigint`, `fraction: string` and the parsed wall-clock/offset components, then compare fractions right-padded to the same length. A `Date` truncated to milliseconds is only for Intl zone lookup, not the order decision. Validate local components with a UTC round-trip using `setUTCFullYear` (avoids `Date.UTC`'s year 0–99 behavior). Normalize neither invalid dates nor DST gaps. Also export `formatCalendarUtc` for read-only projections: format only the integral epoch second with Date, replace its `.000Z` suffix with the original fraction plus `Z`, and never round away submillisecond digits.

For creates, use `Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant)` to compare the named zone's wall-clock components with the supplied timestamp. Explicit valid fold offsets are unambiguous and accepted. The list range compares instants, at most `limits.listDays * 86400` seconds including fractions. Empty/whitespace-only titles and materially missing time information require clarification. Do not parse relative dates here; P6 supplies canonical explicit user-authorized times using its trusted request context.

Export `requireCreateAuthority(binding, action): CalendarOperation`. Parse its operation with P1's schema and require `dispatching`, nonexpired audit evidence, non-null action, same user/session/turn, current connection/subject/target revisions, frozen schema revision, same canonical action hash as both `requestHash` and `authorization.canonicalActionHash`, and matching actual action fields. A changed execution attempt may resume an originating operation; do not require `originatingAttemptId === binding.attemptId`. Require the persisted base32hex `googleEventId`; **never** allocate it in an invocation. An absent/planned/succeeded/unknown/evidence-expired operation cannot dispatch a new POST. P6 handles completed reuse and unknown-state readback. Validate the supplied deadline/trusted time rather than accepting malformed dates.

- [ ] **1.4 Run green.** `npm test -- test/plugins/google-calendar/tools-validation.spec.ts`; then `npm test -- test/contracts/calendar-tools.spec.ts`. Expect every table case discovered and passing.
- [ ] **1.5 Commit on the granted turn.** Stage exactly the three Task 1 files. Message: `feat(calendar): add fixed catalogue and timed action validation`.

## Task 2: Bounded HTTP delivery, safe errors, and deterministic fixture

**Files:** Create `backend/src/plugins/google-calendar/calendar-api-http.ts`, `backend/test/plugins/google-calendar/tools-fixtures.ts`, `backend/test/plugins/google-calendar/calendar-api-http.spec.ts`.

- [ ] **2.1 Write the failing test and fixture.** The scripted fetch must throw if the URL's origin differs from `https://www.googleapis.com`, if the script is exhausted, or if method/path differ. Return fake Google JSON with `Content-Type: application/json`; capture calls only in test memory and do not log them. `fakeFetch(steps)` returns `{ fetcher: typeof fetch, requests: Request[] }`; each step is `{ method, path, response: () => Response | Promise<Response> }`. Build `Request(input, init)` to observe real encoding, body and signal. `calendarHttp` has the signature shown here:

```typescript
import { expect, it } from 'vitest';
import { calendarHttp } from '../../../src/plugins/google-calendar/calendar-api-http.js';

it('cancels oversized error bodies without leaking provider content', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new TextEncoder().encode('secret'.repeat(10000))); },
    cancel() { cancelled = true; },
  }), { status: 503, headers: { 'content-type': 'application/json' } });
  let consumed = 0;
  const fault = await calendarHttp({ fetcher: async () => response,
    path: '/calendars/owned/events', method: 'GET', query: new URLSearchParams(),
    accessToken: 'fixture-token', signal: new AbortController().signal,
    deadlineAt: new Date(Date.now() + 10000).toISOString(),
    consumeRequest: async () => { consumed++; },
  }).catch((error: unknown) => error);
  expect(fault).toHaveProperty('failure.category', 'delivery');
  expect(String(fault)).not.toContain('secret');
  expect(cancelled).toBe(true);
  expect(consumed).toBe(1);
});
```

Add deterministic tests for exact byte limit and one byte over, multibyte UTF-8 split across chunks, malformed UTF-8/JSON, empty/missing bodies, wrong content type, oversized `Content-Length`, actual streamed size despite a false small header, 302 redirect, abort before dispatch, timeout while reading, callback rejection, network rejection, and all status rows below. Fake timers may control deadlines; do not make wall-clock sleeps part of the suite.

- [ ] **2.2 Run red.** `npm test -- test/plugins/google-calendar/calendar-api-http.spec.ts -t "cancels oversized error bodies"`. Expected: missing `calendarHttp`.

- [ ] **2.3 Implement one bounded delivery, without retries.** Export `calendarHttp(input): Promise<{ body: unknown; headers: Headers; fetchedAt: string }>`; input contains the fields above plus optional JSON `body`, `now?: () => number`, and `write?: boolean`. Fix the base URL to `https://www.googleapis.com/calendar/v3`; append only an internally built `/calendars/{encoded}/events...` path and `URLSearchParams`. Never accept a model URL or follow redirects. Use `redirect: 'error'`, explicit GET/POST, Accept JSON, server-only `Authorization: Bearer`, and JSON Content-Type for POST. No token/query/body logging or raw exception propagation.

Before every fetch: validate deadline; check signal; await the request-consumption callback; recheck signal/deadline; then deliver once. A callback failure sends no request and is returned as persistence/budget failure to the tools boundary, never delivery retry. Set a linked signal using `AbortSignal.any([input.signal, AbortSignal.timeout(remainingMs)])`; the outer tools deadline already enforces the 20-second cap. Bound reading as well as initial headers. A malicious fixture ignoring abort must not hang: the reader's pending `read()` must race an abort listener; remove the listener and cancel/release the reader in `finally`.

Use a private bounded UTF-8 reader with `TextDecoder('utf-8', { fatal: true })`; check `Content-Length` as an early hint but enforce actual cumulative bytes. Export constants `CALENDAR_RESPONSE_BYTES = 262144` and `CALENDAR_ERROR_BYTES = 8192`: these are defensive HTTP decoding caps, **not** increases to 16-KiB arguments/tool results. Parse into `unknown`, never cast Google JSON straight to a result. Cancel an unread/oversized stream. Do not call unbounded `response.json()`/`response.text()`. Existing `model/deadlines.ts` demonstrates reader cancellation but is provider-specific; do not import/modify that owner's code just to reuse its model-specific errors.

The reader's abort-race core is this complete private helper; its caller counts/decodes bytes and owns the reader's final cancellation/release:

```typescript
async function readCalendarChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  signal.throwIfAborted();
  let abort = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([reader.read(), stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}
```

Map only status and allowlisted Google `error.errors[].reason` strings, inspecting at most ten entries. Ignore arbitrary messages, URLs, domains, tokens, echoed inputs, and stack traces. Export `decodeCalendarFailure(status, body, write): CalendarFailure` and `calendarRetryAfter(headers, now): number | null` (seconds or HTTP date, returned in milliseconds; invalid/nonfinite values yield null). For a definitive rate-limit rejection with a valid Retry-After, consume the bounded abortable wait **before returning retry advice**, using `node:timers/promises.setTimeout` and the same linked deadline. This is not another HTTP delivery. If the wait cannot fit, return the same safe rate-limit category/code with `retry: 'none'`; do not return advice permitting an early retry. This keeps Retry-After safe without adding an unapproved field to the frozen execution port.

| Delivery outcome | Safe classification |
| --- | --- |
| 401 | credential / `RECONNECT_REQUIRED` / none; no hidden refresh loop |
| 403 ordinary permission / insufficient scope | policy / `CALENDAR_FORBIDDEN` / none |
| 403 allowlisted `rateLimitExceeded`, `userRateLimitExceeded`; 429 | delivery / `CALENDAR_RATE_LIMITED` / delivery-same-id |
| 404 get | delivery / `EVENT_NOT_FOUND` / none; readback maps to absent |
| 409 create | uncertain / `EVENT_ID_CONFLICT` / readback |
| 410 readback | absent only for a positively decoded deleted/gone response; otherwise unknown |
| 400 / invalid or expired cursor | clarification / `CALENDAR_INPUT_REJECTED` / none |
| 408, 5xx, network/timeout after a POST was handed to fetch, unreadable 2xx create | uncertain / `WRITE_OUTCOME_UNKNOWN` / readback |
| 5xx, network/timeout on reads | delivery / `CALENDAR_TEMPORARILY_UNAVAILABLE` / delivery-same-id |
| Caller cancellation before any dispatch | cancelled / `CALENDAR_CANCELLED` / none |
| Caller cancellation after POST dispatch | uncertain / `WRITE_OUTCOME_UNKNOWN` / readback; cancellation is not rollback |
| Malformed/unexpected read response | delivery / `CALENDAR_RESPONSE_INVALID` / none |

For reads `delivery-same-id` means retry the same read, not permission to mutate. An oversized/malformed **error** body cannot override a trustworthy status classification; a 503 read still gets a safe delivery fault. Unknown 4xx failures are definitive non-retryable delivery errors. No failure includes Google prose or a schema-repair retry.

- [ ] **2.4 Run green.** `npm test -- test/plugins/google-calendar/calendar-api-http.spec.ts`. Assert aborted/oversized readers close and no request occurs when budget persistence fails.
- [ ] **2.5 Commit.** Stage exactly the three Task 2 files. Message: `feat(calendar): bound REST delivery and sanitize failures`.

## Task 3: Read operations, target preflight, projections, and cursors

**Files:** Create `backend/src/plugins/google-calendar/calendar-api-cursor.ts`, `backend/src/plugins/google-calendar/calendar-api.ts`, `backend/test/plugins/google-calendar/calendar-api-cursor.spec.ts`, `backend/test/plugins/google-calendar/calendar-api.spec.ts`; extend the Task 2 fixture.

- [ ] **3.1 Write failing REST/cursor tests.** Export `CalendarApi` with constructor `{ fetcher?: typeof fetch; cursorKey?: Uint8Array; now?: () => number }`. Define `CalendarHttpContext` in `calendar-api.ts` as `{ binding: CalendarConnectionBinding; accessToken: string; signal: AbortSignal; deadlineAt: string; consumeRequest: (kind: CalendarRequestKind) => Promise<void> }`. `list(context, args)` and `get(context, args)` return `{ result: CalendarResult; headers: Headers; fetchedAt: string }`.

```typescript
import { expect, it } from 'vitest';
import { CalendarApi } from '../../../src/plugins/google-calendar/calendar-api.js';
import { fakeFetch, readContext, googleEvent } from './tools-fixtures.js';

it('reads one bounded page with explicit continuation and no secret projection', async () => {
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/calendars/owned/events',
    response: () => Response.json({ timeZone: 'Etc/UTC', items: [googleEvent()],
      nextPageToken: 'google-page-2', accessRole: 'owner' }), }]);
  const api = new CalendarApi({ fetcher: fake.fetcher, cursorKey: new Uint8Array(32).fill(1) });
  const read = await api.list(readContext(), { timeMin: '2026-10-21T00:00:00Z',
    timeMax: '2026-10-22T00:00:00Z', maxResults: 20 });
  expect(read.result).toMatchObject({ tool: 'calendar_list_events', truncated: true,
    events: [{ eventId: 'abcde01234', summary: 'Visit' }] });
  expect(JSON.stringify(read.result)).not.toContain('fixture-private-attendee');
  const query = new URL(fake.requests[0].url).searchParams;
  expect(query.get('maxResults')).toBe('20');
  expect(query.get('singleEvents')).toBe('true');
  expect(query.get('showDeleted')).toBe('false');
  expect(query.get('orderBy')).toBe('startTime');
  expect(query.get('timeZone')).toBe('Etc/UTC');
  expect(query.has('syncToken')).toBe(false);
  expect(query.has('q')).toBe(false);
  expect(fake.requests).toHaveLength(1);
});
```

`readContext()` uses a fake server binding (`u/s/t`, `connectionId: 'c'`, revision 1, subject `sub`, calendar `owned`, target revision 1), fake access token, live abort signal, ten-second deadline and no-op accounting. `googleEvent()` returns `id: 'abcde01234'`, summary `Visit`, `2026-10-21T10:00:00Z` to `11:00:00Z`, zone `Etc/UTC`, confirmed status, a Google Calendar link, plus an attendee marker that must never appear in the projection. Tests must not contact Google.

Cursor tests: encode/decode round trip; altered signature; malformed/oversized input; changed range, page size, calendar, subject, user, connection or target revision; another process key; provider token containing `&pageToken=...` (must be one query value, never injection); provider continuation too large to wrap. List tests: zero items plus next-page cursor; exactly 20; server returning 21; no auto-pagination; final page; wrong/missing envelope; invalid timezone; unsupported all-day get; all-day item omitted with `truncated: true`; large optional fields; total UTF-8 overflow; malicious links and instruction-like descriptions remain data.

- [ ] **3.2 Run red.** `npm test -- test/plugins/google-calendar/calendar-api.spec.ts -t "reads one bounded page"`; `npm test -- test/plugins/google-calendar/calendar-api-cursor.spec.ts`. Expected: missing `CalendarApi`/cursor exports.

- [ ] **3.3 Implement the minimal bounded read adapter.** Cursor exports `CalendarCursor` with constructor `(key: Uint8Array = randomBytes(32))`, `encode(token, binding, listArgs): string`, and `decode(cursor, binding, listArgs): string`. Use HMAC-SHA256 over a base64url JSON payload containing version 1, SHA256 of the complete trusted binding, SHA256 of `{ timeMin, timeMax, maxResults }`, and the Google page token. Verify exact keys/types, byte bounds and fixed-length signature with `timingSafeEqual`; reject before HTTP if anything differs. Both emitted/input cursors must fit P1's 2,048-character bound. A cursor from another backend lifetime fails clearly; it is not durable write authority. Do not use a token cache, database, unsigned JSON, or caller-selectable endpoint. Mark the deliberate ceiling in code: `ponytail: process-local cursor signatures invalidate on restart; a future cross-process deployment needs a managed rotation key.`

List maps only to `GET /calendars/{encodeURIComponent(calendarId)}/events` with validated `timeMin`, `timeMax`, `maxResults`, decoded pageToken if present, `singleEvents=true`, `showDeleted=false`, `orderBy=startTime`, explicit response `timeZone=Etc/UTC`, and a bounded fields mask. Request only envelope `timeZone,nextPageToken` and event `id,summary,start,end,status,htmlLink,description,location`; do not request attendees, bodies beyond the projection, account lists, or sync state. The response fields list is a code constant, not model input. Get uses the same encoded target plus encoded opaque event ID, with the event fields mask and explicit UTC response zone. Empty/control-containing IDs and standalone `.`/`..` fail before URL construction (WHATWG URL normalization otherwise removes dot segments); do not impose the write-only base32hex format on existing Google IDs (recurrence instance IDs can contain underscores).

Use this exact fields/path core in `calendar-api.ts`; no argument may replace the origin or fields selection:

```typescript
const EVENT_FIELDS = 'id,summary,start,end,status,htmlLink,description,location';
const LIST_FIELDS = `timeZone,nextPageToken,items(${EVENT_FIELDS})`;
function calendarEventsPath(calendarId: string): string {
  if (!calendarId || ['.', '..'].includes(calendarId) || /[\u0000-\u001f\u007f]/u.test(calendarId))
    throw toolFault('policy', 'CALENDAR_TARGET_REQUIRED');
  return `/calendars/${encodeURIComponent(calendarId)}/events`;
}
function listQuery(args: { timeMin: string; timeMax: string; maxResults: number }, token?: string) {
  const query = new URLSearchParams({ timeMin: args.timeMin, timeMax: args.timeMax,
    maxResults: String(args.maxResults), singleEvents: 'true', showDeleted: 'false',
    orderBy: 'startTime', timeZone: 'Etc/UTC', fields: LIST_FIELDS });
  if (token !== undefined) query.set('pageToken', token);
  return query;
}
```

Project through P1's `calendarEventSchema`, never object spread. Accept only real timed start/end; normalize read-only timestamps to UTC with `parseCalendarTimestamp`/`formatCalendarUtc`, preserving exact instants/fractions, and project `timeZone: 'Etc/UTC'`. The explicit REST response zone and this canonical read representation avoid guessing a missing event zone or using server locale. Validate any supplied IANA zone's syntax but do not mistake a response-zone-converted offset for an inconsistent original event zone. This read representation does not change user-authorized create times or readback linkage: those preserve and verify the canonical action's named zone. Include a half-hour-offset event with omitted event timeZone and a DST-spanning read fixture. Missing summary may project as `''`; missing status may use Google's documented confirmed default only with a fixture asserting it. Missing optional description/location stay omitted; missing link becomes null. A link is allowed only when parsed as HTTPS, without credentials, with hostname exactly `calendar.google.com` or `www.google.com` and a Calendar event path; otherwise return null, never fetch it. Non-timed/all-day list items are omitted and set `truncated: true`, even on the last page; all-day get is an explicit unsupported-content failure. This supports timed reads, not all-day creation. Existing timed events can be read without exposing their attendees or recurrence metadata; no write action on them is added.

Validate Google's item count against both requested maxResults and the <=20 limit. Get must verify the returned `id` exactly matches the requested event ID. `truncated` is true if there is a provider continuation or an explicitly omitted unsupported all-day item; never silently clip oversized items or discard arbitrary invalid entries. Empty pages can still have a next token. Return an encoded next token, or null. If a continuation/projection/result cannot fit the frozen schema/16-KiB cap, fail explicitly rather than claim a complete list or silently drop fields. No automatic next-page request.

Implement `CalendarApi.verifyOwnedTarget(input)` satisfying the frozen `CalendarTargetPort`. It performs exactly one bounded `events.list` preflight (`maxResults=1`, `singleEvents=true`, `showDeleted=false`, fields `accessRole,timeZone`, no content projection), using the provided token, configured exact calendar ID, subject and deadline. Call `input.consumeRequest` once. Reject missing target, inaccessible/non-owner response, malformed envelope/zone, or missing subject; never use a `primary` fallback or CalendarList/ACL APIs. Return the exact supplied target/subject, fetched timestamp and versioned `proofRevision: 'google-calendar.events-owned.v1'` on a valid fixture response.

**Ownership proof is compositional, not an ACL assertion:** P3 must first verify identity and the actual granted `calendar.events.owned` scope and provide that token; this preflight verifies this exact target is accessible under that grant and checks the owner role. The method's return is not independent proof that an arbitrary token has narrow scope, nor live certification of Google data ownership. P3 must not activate on an owner label alone or an unverified broader token. The actual narrow-scope/data-ownership behavior remains G3/G5 live admission evidence; if it cannot be established, admission stays blocked rather than adding permissions or inventing subject/ownership evidence.

- [ ] **3.4 Run green.** `npm test -- test/plugins/google-calendar/calendar-api-cursor.spec.ts`; `npm test -- test/plugins/google-calendar/calendar-api.spec.ts`. All executed reads are fixture-backed, target preflight included.
- [ ] **3.5 Commit.** Stage exactly the four new Task 3 files plus `backend/test/plugins/google-calendar/tools-fixtures.ts`. Message: `feat(calendar): add bounded owned-target reads and pagination`.

## Task 4: Supplied-ID creation and safe readback

**Files:** Modify `backend/src/plugins/google-calendar/calendar-api.ts`, `backend/src/plugins/google-calendar/tools-validation.ts`, `backend/test/plugins/google-calendar/calendar-api.spec.ts`, `backend/test/plugins/google-calendar/tools-fixtures.ts`.

- [ ] **4.1 Write failing create/readback tests.** Add `savedOperation()` to the fixture: construct a schema-valid dispatching operation whose action is the `Visit` timed action, whose hashes come from `calendarActionHash`, and whose event ID comes from `calendarEventId('op_1')`. Use explicit `u/s/t/c`, subject `sub`, revisions 1, authorization `explicit-request`, accepted message `m_1`, sequence 1, fixed schema revision and bounded valid audit lifetime. Its `googleEventId` must be persisted fixture input, never assigned by a mock response.

```typescript
it('reuses supplied event identity and never enables invitation fan-out', async () => {
  const operation = savedOperation();
  const fake = fakeFetch([0, 1].map(() => ({ method: 'POST',
    path: '/calendar/v3/calendars/owned/events', response: () => Response.json({
      ...googleEvent(), id: operation.googleEventId,
      extendedProperties: { private: { aurvinOperationId: operation.operationId,
        aurvinRequestHash: operation.requestHash } },
    }) })));
  const api = new CalendarApi({ fetcher: fake.fetcher });
  await api.create(readContext(), operation);
  await api.create(readContext(), operation);
  const bodies = await Promise.all(fake.requests.map(r => r.clone().json()));
  expect(bodies.map(b => b.id)).toEqual([operation.googleEventId, operation.googleEventId]);
  for (const [index, body] of bodies.entries()) {
    const query = new URL(fake.requests[index].url).searchParams;
    expect(query.get('sendUpdates')).toBe('none');
    expect(query.get('conferenceDataVersion')).toBe('0');
    expect(query.get('supportsAttachments')).toBe('false');
    expect(body).not.toHaveProperty('attendees');
    expect(body).not.toHaveProperty('recurrence');
    expect(body.start).not.toHaveProperty('date');
    expect(body.reminders).toEqual({ useDefault: false });
    expect(body.guestsCanInviteOthers).toBe(false);
  }
});
```

This lower-level delivery test deliberately calls twice; P6, not this test, authorizes when a retry is safe. Add fixtures for 429 rejection then same-ID retry, timeout/503 ambiguity requiring readback with **no automatic POST**, 409 then matching readback, 409 mismatch, missing marker, wrong hash/ID/action/zone/subject/target/revision, absent resource, gone resource, invalid successful response, and success followed by a hypothetical local-save failure. A readback never invokes POST. Cancellation after dispatch never reports definitive noncreation.

- [ ] **4.2 Run red.** `npm test -- test/plugins/google-calendar/calendar-api.spec.ts -t "reuses supplied event identity"`. Expected: no create implementation.

- [ ] **4.3 Implement create and readback only.** Add `create(context, operation)` returning the same response envelope as reads and `readback(context, operation)` returning `{ outcome: 'matched'; response: { result; headers; fetchedAt } } | { outcome: 'absent' | 'mismatch' | 'unknown' }`. The outer tools class converts matched response to the frozen receipt. Both revalidate trusted binding/operation linkage; readback permits dispatching/unknown authority but never an evidence-expired or mismatched operation. A succeeded operation may be read back for verification, never recreated.

Construct a new explicit POST body; do not pass model arguments through wholesale:

```typescript
export function calendarCreateBody(operation: CalendarOperation) {
  const action = operation.action;
  if (!action) throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
  return { id: operation.googleEventId, summary: action.summary,
    start: { dateTime: action.start, timeZone: action.timeZone },
    end: { dateTime: action.end, timeZone: action.timeZone },
    ...(action.description === undefined ? {} : { description: action.description }),
    ...(action.location === undefined ? {} : { location: action.location }),
    eventType: 'default', reminders: { useDefault: false },
    guestsCanInviteOthers: false, guestsCanModify: false, guestsCanSeeOtherGuests: false,
    extendedProperties: { private: { aurvinOperationId: operation.operationId,
      aurvinRequestHash: operation.requestHash } },
  };
}
```

The private linkage fields and guest/reminder controls are server-owned, never model parameters. They introduce no new tool capability. Use `POST .../events?sendUpdates=none&conferenceDataVersion=0&supportsAttachments=false&fields=...` with a response mask including the projected fields and private linkage. Attendees are absent; do not rely on `sendUpdates=none` alone to guarantee no invitation email (Google warns notification suppression is not an absolute guarantee). No reminders/invitations/conference/attachments, recurrence, date-only shapes, update/patch/delete/import/move methods, secondary creates, or batch endpoints are exposed. If caller input requests those, fail before credentials/fetch.

A successful create response must match persisted event ID, noncancelled status, action summary, exact start/end instants (including fractional comparison), semantically equal canonical IANA zone, optional description/location, and both private linkage values. Do not accept a different returned ID, normalize a materially different action, or let `htmlLink` establish success. An unreadable/mismatching success after POST is uncertain, not a definitely failed write. Use the persisted ID for GET readback and check the same linkage/action; mismatches are not success. A matching response produces evidence, not a durable operation transition. A 404/positively established gone result is absent; auth/network/quota/decode failure is unknown. Retain no raw Google body.

No mutation retries happen in this class. Return bounded failure/readback advice. P6 performs same-ID readback before retrying an ambiguous create, durably admits retries 0..2, and may not convert a mismatch into success or create another ID. Since `CalendarFailure` has no delay field, do not append a wire field or depend on hidden cross-invocation state. Task 2's one-delivery HTTP function honors a known Retry-After before releasing retry advice, or returns `retry: 'none'` when it cannot fit the deadline. P6 may add its own bounded backoff after that point. Add fake-timer regressions proving no advice escapes before the header deadline and no second HTTP request occurs during the wait.

- [ ] **4.4 Run green.** `npm test -- test/plugins/google-calendar/calendar-api.spec.ts`; `npm test -- test/plugins/google-calendar/tools-validation.spec.ts`. Assert all retry fixture bodies use the original event ID and no auto-retry on ambiguity.
- [ ] **4.5 Commit.** Stage exactly the four Task 4 files. Message: `feat(calendar): add stable-id create and verified readback`.

## Task 5: Direct API tools, trusted binding and permission-aware evidence

**Files:** Create `backend/src/plugins/google-calendar/tools.ts`, `backend/test/plugins/google-calendar/tools.spec.ts`; extend `backend/test/plugins/google-calendar/tools-fixtures.ts`.

- [ ] **5.1 Write the failing direct-tool test.** Define `apiToolsFixture()` in the shared fixture returning `{ tools, input, requests, counts, gate, credentials }`. `tools` is the production `CalendarApiTools`; its Google adapter is the production `CalendarApi` with scripted fetch, not a mocked adapter. `input` is a valid `CalendarExecutionPort.invoke` input with one saved dispatching operation, trusted now/zone/deadline and counter probes. Credential fixture calls the closure with `fixture-access-token`, never returns it. Gate fixture compares all current binding fields and can be switched disabled/revision-changed. The independently supplied fixture permission is explicitly fake (`policyId: 'fixture-policy'`, content retained or volatile); it is not approval of real processing.

```typescript
import { expect, it } from 'vitest';
import { apiToolsFixture } from './tools-fixtures.js';

it('executes direct API tools only under current persisted operation authority', async () => {
  const f = apiToolsFixture();
  const denied = await f.tools.invoke({ ...f.input,
    binding: { ...f.input.binding, operation: null } });
  expect(denied).toMatchObject({ outcome: 'failure', failure: {
    category: 'policy', code: 'OPERATION_AUTHORITY_REQUIRED', retry: 'none',
  } });
  expect(f.requests).toHaveLength(0);
  const result = await f.tools.invoke(f.input);
  expect(result).toMatchObject({ outcome: 'success', receipt: {
    operationId: f.input.binding.operation!.operationId,
    googleEventId: f.input.binding.operation!.googleEventId,
  } });
  expect(f.counts.calendar).toBe(1);
  expect(JSON.stringify(result)).not.toContain('fixture-access-token');
  expect(f.requests).toHaveLength(1);
  await f.tools.close();
});
```

Add direct successful list/get/create cases **before** MCP tests; forbidden field and disabled gate cases execute zero HTTP requests. Include gate changes after credential refresh/pause, same subject with changed target revision, another user/subject, rejected request/refresh counter callbacks, expired turn, aborted signal, max timeout, lower supplied limits, repeated invocation without fresh operation authority, all operation mismatches from Task 1, and successful readback without POST.

- [ ] **5.2 Run red.** `npm test -- test/plugins/google-calendar/tools.spec.ts -t "executes direct API tools"`. Expected: missing class/fixture behavior.

- [ ] **5.3 Implement the direct port.** Export `CalendarApiTools implements CalendarExecutionPort`, constructor:

```typescript
type CalendarToolsDependencies = {
  api: CalendarApi;
  gate: CalendarConnectionGate;
  credentials: CalendarCredentialPort;
  limits: CalendarLimits;
  permission: z.infer<typeof sourcePermissionSchema>;
  policyDeadlines: readonly number[];
  now?: () => number;
};
```

This is concrete composition input, not another persistence/policy framework. Parse `limits` and `permission`; require independently permitted minimal evidence before dispatching writes (otherwise safe deduplication is unavailable). Constructor policy/absolute deadlines are supplied by trusted assembly, never model arguments. A missing real policy is not replaced with `'fixture-policy'` in production. P8 may leave the feature default-off until G9 is approved.

`invoke` calls Task 1 validation, checks `binding.schemaRevision`, deadline and trusted fields, and for create calls `requireCreateAuthority`. Check `gate.requireCurrent` before any advertisement/dispatch and again immediately before each HTTP effect, including after any credential refresh/pause. Use only `credentials.withAccessToken({ binding, signal, deadlineAt, consumeRefreshRequest }, token => ...)`. No raw token in the returned object, registry, native tool messages, MCP request parameters/headers, or saved binding; only the final Google HTTP Authorization header contains it. Do not refresh yourself. A credential/gate exception must be converted to a safe failure (known safe `CalendarToolFault` category retained; unclassified error fails closed and is never a schema-repair recommendation).

Within the trusted callback, route the three call names to `CalendarApi.list/get/create`, passing `consumeRequest(kind)` for each **actual** HTTP delivery. Request admission can reject; a failed callback never delivers. Combine caller/port-close signal with a single per-invocation timeout equal to `min(limits.toolTimeoutMs, remainingTurnMs)`; never reset it for catalogue/connect/credential wait/HTTP/body read. Recheck immediately after awaited accounting and gate checks. `readback` uses the same gate/credential/counter/deadline path with kind `readback`; refresh uses only the separate callback. No retries, operation writes, or counter resets here. P6 is the durable owner.

Construct source evidence from safe bound identifiers, current fetched time and the **earliest** of approved policy deadlines, applicable response-header restrictions and the 24-hour ceiling, using `effectiveSourceExpiry`. Parse `Cache-Control` conservatively: no-store/no-cache/zero freshness/invalid conflicting freshness means volatile; subtract nonnegative Age from max-age; honor an earlier Expires; never infer policy permission from absent headers. An explicit trusted retention permission and nonexpired permitted absolute policy deadline are both required for retained content. With absent permission or zero allowance, fetched projections remain volatile with `expiresAt === fetchedAt`. Missing/invalid permission does not default to retained. Do not persist any body or create a cache.

The final permission reduction is explicit, after computing header/policy deadlines; use this core rather than a default `+24h` assignment:

```typescript
const proposedExpiry = effectiveSourceExpiry(fetchedAt,
  [...policyDeadlines, ...headerDeadlines], permission.content === 'retained');
const retained = permission.content === 'retained' && policyDeadlines.length > 0
  && Date.parse(proposedExpiry) > Date.parse(fetchedAt) && !headerForbidsRetention;
const sourcePermission = { ...permission, content: retained ? 'retained' as const : 'volatile' as const };
const expiresAt = retained ? proposedExpiry : fetchedAt;
```

Here `headerDeadlines: number[]` and `headerForbidsRetention: boolean` are outputs of the conservative header parsing described immediately above; `policyDeadlines`/`permission` come from constructor options and `fetchedAt` from the one HTTP response. These values never come from event content or model arguments.

For `operationIds`, use `[operation.operationId]` on creates/readback; on read-only tools use `[binding.toolCallId]` as the stable logical-read operation identity. P6 must use that same read identifier for result references; do not mint a new unrelated operation ID on restart. Set `sourceId` deterministically from connection revision, logical operation/tool-call ID and fetched response identity/time using SHA256, no secrets. Source/receipt objects must pass P1 schemas. Receipt uses persisted IDs/hashes/revisions, `calendarIdHash = sha256(binding.calendarId)`, source evidence and fetched verification time. Receipt `htmlLink` is null unless retention is permitted; event projections may still contain transient safe links for this live round. Dates/links/IDs/hashes are not automatically exempt from policy. Return no receipt if independently permitted minimal evidence is absent.

Validate every `CalendarResult` and the complete encoded MCP execution envelope against byte limits before returning it; reserve metadata/envelope headroom rather than exceeding 16 KiB by wrapping a 16-KiB projection. If a post-create projection/source cannot be represented, preserve uncertainty and require readback; never call it definitely failed or repeat POST. P6 separately handles durable receipts, reference-only volatile results, message/checkpoint expiry and tombstones. This class must not hide volatile details inside an otherwise durable object.

`close` is idempotent, fences new work and aborts active local channels/requests, but closes neither credentials nor persistence. An in-flight dispatched POST remains uncertain if cancellation prevents a verified response.

- [ ] **5.4 Run green and assert retention fixtures.** `npm test -- test/plugins/google-calendar/tools.spec.ts`. Test retained + 60-second cache, no-store, no-cache, `max-age=0`, earlier Expires, Age exhausts max-age, expired/missing policy deadline, volatile permission, and denied minimal evidence. Assert <=24 hours, earliest absolute expiry, no result/receipt credential fields, no durable-content assumption and zero credential calls on pre-execution policy rejection.
- [ ] **5.5 Commit.** Stage exactly the three Task 5 files. Message: `feat(calendar): bind direct tools to current authority and source policy`.

## Task 6: Production server and real SDK discovery/call

**Files:** Create `backend/src/plugins/mcp/calendar-server.ts`, `backend/test/plugins/mcp/calendar-server.spec.ts`; extend the shared fixture only if an additional scripted response is necessary.

- [ ] **6.1 Write a failing genuine SDK test.** Export `createCalendarMcpHandler({ binding, tools, gate, limits, signal, consumeRequest, consumeRefreshRequest })`; the tools port is the direct production implementation, with the fixture's Google fetch. Use the frozen SDK imports, not `@modelcontextprotocol/sdk`.

```typescript
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, it } from 'vitest';
import { CALENDAR_LIMITS, CALENDAR_MCP_WIRE } from '../../../src/contracts/calendar-policy.js';
import { CALENDAR_TOOLS } from '../../../src/contracts/calendar-tools.js';
import { createCalendarMcpHandler } from '../../../src/plugins/mcp/calendar-server.js';
import { apiToolsFixture } from '../google-calendar/tools-fixtures.js';

it('discovers and invokes the production Calendar handler over pinned real MCP', async () => {
  const f = apiToolsFixture();
  const observed: string[] = [];
  const handler = createCalendarMcpHandler({ binding: f.input.binding, tools: f.tools,
    gate: f.gate, limits: CALENDAR_LIMITS, signal: f.input.signal, consumeRequest: f.input.consumeRequest,
    consumeRefreshRequest: f.input.consumeRefreshRequest });
  const client = new Client({ name: 'aurvin-p5-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL('http://aurvin.internal/mcp'), {
    fetch: (url, init) => {
      const request = new Request(url, init);
      const revision = request.headers.get('mcp-protocol-version');
      if (revision) observed.push(revision);
      return handler.fetch(request);
    },
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map(t => ({ name: t.name, description: t.description,
      inputSchema: t.inputSchema }))).toEqual(CALENDAR_TOOLS.map(({ revision: _r, ...t }) => t));
    const actual = await client.callTool({ name: f.input.call.name,
      arguments: f.input.call.arguments });
    expect(actual.structuredContent).toMatchObject({ outcome: 'success', receipt: {
      googleEventId: f.input.binding.operation!.googleEventId,
    } });
    expect(observed).toContain(CALENDAR_MCP_WIRE);
    expect(f.requests).toHaveLength(1);
  } finally {
    await client.close();
    await handler.close();
    await f.tools.close();
  }
});
```

Extend this to invoke **all three** tools with separate correctly bound fixtures and real SDK clients, not just create. Add exact inline snapshots of name/description/inputSchema for the production catalogue and compare every JSON Schema field with P1. Assert there is no fourth tool and no catalogue pagination. Real SDK call with unknown fields, attendee/identity/token/calendar overrides, unsupported action name, or missing valid closure fails and sends zero Google requests. Reject mismatched operation binding even if a valid-looking MCP request/header attempts to replace it. Disabled-before-list and disabled-between-list-and-call fixtures fail safely.

- [ ] **6.2 Run red.** `npm test -- test/plugins/mcp/calendar-server.spec.ts -t "discovers and invokes the production"`. Expected: missing production factory. Do not replace this test with a mocked `client.listTools`.

- [ ] **6.3 Implement the small official factory.** Use this registration pattern (complete factory control flow); `encodeCalendarExecution` is the bounded envelope helper defined in this task:

```typescript
export function createCalendarMcpHandler(context: BoundCalendarMcpContext) {
  if (!context?.binding || !context.tools || !context.gate)
    throw toolFault('policy', 'EXECUTION_BINDING_REQUIRED');
  return createMcpHandler(async () => {
    context.signal.throwIfAborted();
    await context.gate.requireCurrent(context.binding, context.signal);
    const server = new McpServer({ name: 'aurvin-google-calendar', version: '1.0.0' });
    for (const definition of CALENDAR_TOOLS) {
      server.registerTool(definition.name, {
        description: definition.description,
        inputSchema: withStandardJsonSchema(calendarInputSchemas[definition.name], definition.inputSchema),
      }, async (args) => {
        const call = validateCalendarCall({ name: definition.name, arguments: args });
        const value = await context.tools.invoke({ binding: context.binding, call,
          signal: context.signal, consumeRequest: context.consumeRequest,
          consumeRefreshRequest: context.consumeRefreshRequest });
        return encodeCalendarExecution(value, context.limits);
      });
    }
    return server;
  }, { legacy: 'reject' });
}
```

`BoundCalendarMcpContext` names exactly the factory input above, using P1 port/binding/counter types. Copy trusted binding/action data into the private closure so caller mutation cannot retarget it; do not serialize credentials or service instances. The handler callback rechecks the current gate through the tools implementation after pauses and before effects. P1 input schemas and JSON Schema bridge are reused verbatim; don't add input fields for authority or tokens. Catch callback validation faults and return bounded allowlisted failure envelopes, without raw Zod diagnostics or internal exceptions. A missing closure is rejected before constructing a handler. No HTTP header can bind identity; the only `http://aurvin.internal/mcp` URL is an SDK transport label consumed by the local injected fetch, never resolved on the network.

`encodeCalendarExecution(value, limits)` validates success via `calendarResultSchema`, `sourceReferenceSchema` and nullable `calendarReceiptSchema`, or failure via `calendarFailureSchema`. Require exact envelope keys; no raw extra properties. Return `{ content: [], structuredContent: validatedValue, ...(failure ? { isError: true } : {}) }` and enforce `jsonBytes(fullMcpToolResult) <= limits.resultBytes`. Empty content avoids duplicating large text/JSON and is valid in the pinned SDK; demonstrate this in the real test. Failure messages contain only safe code/category/retry. A too-large post-write result returns uncertain/readback, never a false definitive failure. The host must decode structured content and not interpret text as executable JSON. There is no route decorator, Nest module, listening server, stdio, WebSocket or second process.

- [ ] **6.4 Run green.** `npm test -- test/plugins/mcp/calendar-server.spec.ts`; `npm test -- test/contracts/calendar-mcp-compatibility.spec.ts`. Observe the actual `mcp-protocol-version: 2026-07-28` on catalogue/call exchanges, not just a constant assertion. The auto probe may have no revision; legacy call acceptance is forbidden.
- [ ] **6.5 Commit.** Stage exactly Task 6 source/test and the fixture if changed. Message: `feat(calendar): expose bound tools through production embedded MCP handler`.

## Task 7: Production embedded execution port and catalogue pinning

**Files:** Create `backend/src/plugins/mcp/calendar-client.ts`, `backend/test/plugins/mcp/calendar-client.spec.ts`; modify the server/registry only to share already-defined bounded encoding/decoding helpers if needed.

- [ ] **7.1 Write the failing host tests.** Export `EmbeddedCalendarExecution implements CalendarExecutionPort`, constructor `{ tools: CalendarApiTools; gate: CalendarConnectionGate; limits: CalendarLimits; observeRequest?: (request: Request) => void }`. The optional observer is synchronous test instrumentation; it receives only internal MCP traffic, never Google HTTP or credentials. It must not replace the production factory, client, transport, fetch, or catalogue verifier.

```typescript
import { expect, it } from 'vitest';
import { EmbeddedCalendarExecution } from '../../../src/plugins/mcp/calendar-client.js';
import { CALENDAR_LIMITS, CALENDAR_MCP_WIRE } from '../../../src/contracts/calendar-policy.js';
import { apiToolsFixture } from '../google-calendar/tools-fixtures.js';

it('uses the production embedded port and closes every real MCP channel', async () => {
  const f = apiToolsFixture();
  const revisions: string[] = [];
  const host = new EmbeddedCalendarExecution({ tools: f.tools, gate: f.gate,
    limits: CALENDAR_LIMITS, observeRequest(request) {
      const wire = request.headers.get('mcp-protocol-version');
      if (wire) revisions.push(wire);
      expect(request.headers.has('authorization')).toBe(false);
    } });
  try {
    expect(await host.invoke(f.input)).toMatchObject({ outcome: 'success' });
    expect(revisions.filter(r => r === CALENDAR_MCP_WIRE).length).toBeGreaterThanOrEqual(2);
    expect(f.requests).toHaveLength(1);
  } finally { await host.close(); }
  const afterClose = await host.invoke(f.input);
  expect(afterClose).toMatchObject({ outcome: 'failure' });
  expect(f.requests).toHaveLength(1);
});
```

Add real-channel tests for discovery then call for list/get/create, schema tamper, extra/missing tool, unexpected next cursor, legacy revision, malformed/oversized result and error envelope, host closure while a read is blocked, closure while create is dispatched, rejection before setup completes, invocation cancellation, deadline spanning discovery and call, and simultaneous independent bindings. Tamper tests may intercept/alter a real handler `Response` **inside the test harness** or call `assertCalendarCatalogue` with a modified real discovery payload; do not add a production remote-handler override. Assert the verified catalogue is rejected before any Google fetch and verify the host calls that assertion in its real flow.

- [ ] **7.2 Run red.** `npm test -- test/plugins/mcp/calendar-client.spec.ts -t "uses the production embedded port"`. Expected: missing execution class.

- [ ] **7.3 Implement the host without a fake bypass.** Each `invoke` creates one closure bound to the supplied validated trusted context and a fresh cancellation channel. Construct the real `Client({ name: 'aurvin-calendar-host', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })`, real `StreamableHTTPClientTransport(new URL('http://aurvin.internal/mcp'), { fetch })`, and production handler. Fetch does only `handler.fetch(new Request(input, { ...init, signal: linkedSignal }))`, rejects another URL/unsupported protocol revision, and observes successful negotiated modern requests. There must be no fallback to native network fetch for an MCP URL and no credentials in parameters/headers. The protocol's auto-discovery probe is allowed; nonmodern actual catalogue/call traffic is not.

Sequence: validate call/binding and current gate; establish one combined timeout for the entire invocation; connect; `listTools`; call `assertCalendarCatalogue` on exact definitions and reject any pagination; check gate/signal/deadline again; then `callTool` once. Never trust a caller-provided catalogue or retain a verified catalogue across a new binding without rechecking current policy. Do not infer that schema parity establishes authorization. Validate decoded structured content with the exact success/failure schemas and byte cap; reject extraneous keys, missing discriminators, text-only payload, invalid receipt linkage, wrong tool discriminant and mismatching result event ID for create. Recheck receipt IDs/revisions/hash/source against the trusted operation. A server `isError` inconsistent with the structured envelope is a protocol failure. A malformed/lost response **after create call dispatch** is uncertain/readback, never eligible for a fresh creation.

Use `try/finally` on every path to close client and handler; a client-close rejection must not prevent handler-close. Track active invocation controllers/channels in one process-local set, with cleanup in `finally`. `close()` fences new invocations, aborts active channels, waits for bounded closure, and then closes the owned direct tools once; it does not own persistence or the connection service. Multiple close calls share the same completion. No new process signal handler is installed by P5; P8 calls the port from the existing drain path. No reusable per-turn message/result arrays or handler leases accumulate.

Put the actual channel teardown behind this one local helper, called from `invoke`'s `finally` and tracked shutdown completion. The enclosing deadline/cancellation path must already have aborted outstanding work; do not await an unbounded active call before aborting it:

```typescript
async function closeCalendarChannel(
  client: Client, handler: ReturnType<typeof createCalendarMcpHandler>,
): Promise<void> {
  try { await client.close(); }
  finally { await handler.close(); }
}
```

`readback(input)` invokes the direct tools' internal readback path, with the same close/gate/deadline/accounting checks; do not advertise a fourth MCP tool or fabricate a new model call. This is runtime-only recovery of a known operation, not model-requested execution. P6 separately decides/persists reconciliation admission. The three advertised operations themselves always use real MCP, not a direct fast path.

- [ ] **7.4 Run green.** `npm test -- test/plugins/mcp/calendar-client.spec.ts`; `npm test -- test/plugins/mcp/calendar-server.spec.ts`. Include request-header observations and real calls for every tool in the retained test output/assertions. A mocked client alone is insufficient evidence.
- [ ] **7.5 Commit.** Stage Task 7 source/test and only actually changed P5-owned registry/server files. Message: `feat(calendar): add verified embedded MCP execution lifecycle`.

## Task 8: Exact boundaries, clean closure, and owner handoff

**Files:** Modify only the existing P5-owned implementation/tests identified above when a reproduced defect requires it. Do not edit P6/P8 files or final evidence documents.

- [ ] **8.1 Add the final failing regression cases.** Add this precise disabled-after-advertisement test to `calendar-server.spec.ts` using its real SDK helper (factor the Task 6 setup/teardown into `withCalendarClient(fixture, action)` within that test file, with `finally` closing client/handler/tools):

```typescript
it('rejects disconnect after discovery without an external effect', async () => {
  const f = apiToolsFixture();
  await withCalendarClient(f, async (client) => {
    await client.listTools();
    f.gate.disable();
    const refused = await client.callTool({ name: f.input.call.name,
      arguments: f.input.call.arguments }).then(r => r.isError === true, () => true);
    expect(refused).toBe(true);
    expect(f.requests).toHaveLength(0);
  });
});
```

Also add exact 16,384/16,385-byte **encoded** execution result tests (multibyte and envelope overhead), exact lower configured argument/result/event/range limits, cursor validation at 2,048/2,049 characters, <=20-second timeout and shorter remaining deadline, gate change while credential callback waits, counter failure after gate check, cancellation during decoding, and handler closure after connect/call/error failures. Assert no open reader/controller survives and repeat invocations do not accumulate channels. Retain real request/response flow for closure tests; an assertion merely that a mock `.close` was called does not prove channel closure.

- [ ] **8.2 Run the targeted red case before correcting it.** `npm test -- test/plugins/mcp/calendar-server.spec.ts -t "rejects disconnect after discovery"`. Expected failure if a stale snapshot still authorizes a call; if already green, retain it and use the next newly added boundary case to demonstrate the TDD red/green cycle. Do not deliberately break correct production code to manufacture red.
- [ ] **8.3 Apply only the demonstrated correction.** Keep the gate immediately before the effect rather than adding ad hoc guards to individual tools. Keep size checking in the shared encoding/decoding boundary, not one check per model tool. Maintain the classification table: no schema repair for policy, credentials, uncertain effects, budget or persistence failures. Preserve same event ID in every delivery fixture; never add an automatic retry loop to make a test pass.

The single effect-admission callback shared by all direct tools has this ordering. In `tools.ts`, close it over the current binding, gate, signal and P6 callback, then supply it as the Calendar API context's `consumeRequest`:

```typescript
const consumeRequest = async (kind: CalendarRequestKind): Promise<void> => {
  signal.throwIfAborted();
  await gate.requireCurrent(binding, signal);
  await input.consumeRequest(kind);
  signal.throwIfAborted();
  await gate.requireCurrent(binding, signal);
  signal.throwIfAborted();
};
```

This spends durable request admission before an effect, and rejects a disable that happened during that admission. A spent-but-undelivered request reservation is conservative, not grounds to replenish a turn's cap. The HTTP function rechecks signal/deadline and calls fetch immediately after this callback resolves.
- [ ] **8.4 Verify the owned and frozen suites.** Run each from `backend/` and record actual counts, failures, and skips:

```powershell
npm test -- test/plugins/google-calendar
npm test -- test/plugins/mcp
npm test -- test/contracts/calendar-mcp-compatibility.spec.ts
npm test -- test/contracts/calendar-tools.spec.ts
npm test -- test/contracts/calendar-operations.spec.ts
npm test -- test/contracts/calendar-sources.spec.ts
npm run build
npm run lint
npm test
```

The package-wide run may include native suites that skip without operator fixtures. Report those separately; no DB/service prerequisites are introduced for P5's deterministic suites. Record an unrelated concurrent worker's failure by path/owner instead of modifying it. Native MongoDB/e2e/browser/Google/OpenRouter/live tests are not replaced by P5 unit checks; final integrated evidence belongs to P9. Do not run credentials, grants or real Calendar writes. Do not claim SDK or Google production certification from deterministic passes.

- [ ] **8.5 Commit actual P5 fixes/tests on the granted turn.** Stage explicit changed owned paths only. Message: `test(calendar): verify embedded MCP bounds and safe channel shutdown`. If there is no code change beyond the retained regression tests, do not invent a production change. Report every implementation hash and the exact commands/counts to the orchestrator.

## P6/P3/P8 integration handoff (report this summary, not a request to read the plan)

- P6 constructs a `CalendarExecutionBinding` from server identity/current connection and durable causal IDs; it passes `operation: null` for read-only tools and the already-persisted **dispatching** operation for create. Persist `calendarActionHash` and one `calendarEventId(operationId)` **before** dispatch, and reuse the stored ID thereafter. P5 never writes operation storage or declares durable success.
- P6 calls `EmbeddedCalendarExecution.invoke` with typed validated call, abort signal and durable `consumeRequest(kind)` / `consumeRefreshRequest()` callbacks. Every actual Calendar HTTP request, including retry/readback, consumes the appropriate counter; MCP discovery does not. There is no hidden retry/repair/counter loop. P6 persists <=2 delivery retries, reads back the same ID first after ambiguity, and does not retry a mismatch or unresolved unknown operation. A new execution attempt of the same accepted input does not mint a new logical operation.
- P6 uses `readback` for non-model reconciliation and persists matched receipt/current state before publishing success. Unknown/absent/mismatch are distinct; absent alone is not authority for an unrelated write. A failed narration or finalization never erases a completed external action. Honour retention/minimal-evidence gates; expired evidence never permits replay.
- On read-only results, the logical read operation identity is `binding.toolCallId`, included in `source.operationIds`; P6 uses the same ID for source-linked result records. On create/readback it is the saved mutation `operationId`. Preserve complete current-turn native tool-call/result groups and volatile-vs-retained handling; P5 does not checkpoint model context.
- P3 supplies `CalendarCredentialPort` and `CalendarConnectionGate`, owns refresh locking/rotation and actual verified narrow-scope grants. `CalendarApi.verifyOwnedTarget` satisfies `CalendarTargetPort` with one bounded exact-target preflight; its owner-role result is not a standalone ownership/subject/scope certificate. G3/G5 actual owned-scope verification and G9 real-data policy remain explicit admission gates.
- P8 assembles one `CalendarApi`, one direct `CalendarApiTools` and one owned embedded execution port with trusted limits/permission deadlines; tools are disabled until current connection and policy permit advertising. Only P8 registers close/drain with the existing process/persistence owner. No MCP route, port, socket or second persistence owner exists.
- Publish exact production exports, task commit hashes, observed wire `2026-07-28`, direct-API and genuine-SDK test counts, negative cases, closure evidence, skips/blocks. No OAuth grants, real Google calls, credentials, paid inference or live Calendar mutations were used. Review is **skipped**.

## P5 exit checklist

- [ ] Exact three-tool catalogue/schema inline snapshots match P1, with no permissions/identity fields.
- [ ] Actual SDK client discovers and invokes each production handler operation; modern negotiated header is observed on real exchanges.
- [ ] Disabled, tampered, unknown/unbound, account/target/revision-substituted and schema-invalid calls execute zero external effects.
- [ ] Direct REST fixture validation runs first; same production adapter is then exercised through MCP.
- [ ] Stable stored event ID survives delivery retry/readback; conflict mismatch cannot become success or allocate another ID.
- [ ] Timezone/offset/DST/range/fraction/cursor/unsupported-action/no-invitations fixtures pass without an invented event-duration cap.
- [ ] UTF-8 argument/result/error/HTTP limits, continuation metadata, source expiry and permission boundaries pass.
- [ ] Cancellation, deadline and drain close real client/handler/read channels with no false noncreation claim after POST dispatch.
- [ ] P6 authority/counter ownership, P3 credential/target seam and P8 single-owner close handoff are reported.
- [ ] Required deterministic results and exact commits are reported; unresolved real-data/live ownership/processing gates are named, not certified or silently bypassed.
