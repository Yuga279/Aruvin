# Chat HTTP transport

## P9 assembly
ChatHttpModule.register / registerAsync accepts existing ChatRuntime, SessionRepository,
MessageRepository, ServerIdentityResolver, and BudgetConfig. Register once. Bootstrap with
bodyParser:false; configureChatHttp(app,budgets) before init/listen; set global prefix api.
No HTTP module constructs a second runtime or changes application entry points.

## Routes and lifecycle
GET sessions/session/messages/status; POST sessions accepts first input with sessionId:null;
POST session turns requires matching body/path session ID; retry returns original-user-linked
attempt; cancel returns 204 acknowledgment. Submit/retry return 202 acceptance IDs, including
duplicates. GET status/archive recovers durable state; reconnect never resubmits the prompt.
GET stream executes the latest accepted attempt once. Early errors are safe JSON; after first
event, errors are application frames. Compatible v1 and v2 envelopes share one wire sequence:
the transport remumbers independent producers without changing durable operation IDs.
Calendar progress and operation receipts flush immediately and are not terminal; a durable
receipt can exist while narration fails. Streamed text remains provisional until a matching
completed/truncated status precedes `completed`. EOF or HTTP 200 is not completion.
GET status is read-only and may include durable `calendar` turn state when present.
Headers disable caching/proxy buffering.
No SSE replay cursor, broadcast queue, private state, model override, or detached run exists.

### Session management
`PATCH /api/sessions/:sessionId` accepts a strict nonempty `{ title?: string, pinned?: boolean }`
body. Titles are trimmed and bounded to 80 characters. Pins persist in MongoDB and sort before
unpinned sessions, including across paginated history and reloads.
`DELETE /api/sessions/:sessionId` returns 204 and soft-deletes the session by atomically setting
its lifecycle to `archived` only when no execution owner or active attempt remains. Deleted chats
are hidden from navigation and HTTP archive reads, and cannot accept new turns. Underlying
messages, checkpoints and accounting remain subject to the existing retention policy; this is
not immediate physical erasure. Both commands resolve user identity on the server.

Session-action checks added 2026-10-08: deterministic adapter/service checks and fake-port route
checks pass. Native Mongo integration coverage was added, but the full e2e command fails its
configuration guard because `AURVIN_TEST_MONGODB_URI`/`AURVIN_TEST_DB_PREFIX` were not supplied
in this session. No live database/provider verification is claimed for these changes.
Both package builds and routine test suites pass; lint reports warnings only. A separate full
backend TypeScript check reports errors in untouched compatibility/integration/bootstrap tests
(Mongo ObjectId typing, fixture close ports, and nullable child-process streams).

## Resource and security boundary
Strict body/unknown-field validation, path-safe bounded IDs, bounded scalar cursor/page size,
configured UTF-8/input checks, finite JSON body cap, one awaited bounded frame/drain deadline.
Server identity ignores forged client headers. Error messages are fixed allowlisted public text.
Disconnect interrupts unless a sealed result must finalize; cancelled and truncated are distinct.
Cancel acknowledgment does not guarantee stopped charges. EOF/HTTP 200 never means completion.

## P8 hooks and rollout limits
ChatStreamTransport.snapshot exports active/backpressured aggregate counts only. P8 wraps
acceptance/retry/stream admission, rate/readiness/telemetry, runtime drain/reconcile, staging
gateway/proxy and retention/backup policy. Single-process sentinel topology remains mandatory.
No recovery/rebase admin endpoint. Actual Azure service, live provider capabilities, proxy/access,
process-kill/backup/restore evidence and public-production decisions are external gates.

## Actual verification
- **P6 commits (2026-10-06):** `8c1ef67` validate HTTP inputs/public errors; `8dae290` scoped service delegation; `c79bbca` awaited SSE frames; `6255711` request-owned attachments; `259ab6d` Nest routes/parser boundary; `33cfd97` native acceptance/disconnect recovery; `17c9215` pagination and finalization barriers; plus this evidence commit. Plan `b6cb724`. P5 prerequisite `3fd9e1f`..`bb90fcb`.
- **Runtime:** Node `v24.18.0`, npm `12.0.1`, OS Windows (`win32`). NestJS 12 / Express 5 adapter, TypeScript ESM, Zod 3, Vitest 4, Supertest. No new dependency.
- **Measured limits (DEFAULT_BUDGETS):** JSON parser cap `196096` bytes (`min(262144, min(maxInputChars,32000)*6+4096)`); SSE frame cap `397312` bytes (`6*min(maxMessageBytes,65536)+4096`); drain deadline `idleStreamTimeoutMs=20000`. Input precheck maps overlength to `INPUT_TOO_LARGE` (413) before the shared schema.
- **Native topology:** operator loopback MongoDB at `127.0.0.1:27017`, `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, P2 `nativeDatabase()` generated/dropped isolated databases. URI not recorded. No application `.env`, Azure target, or live OpenRouter key was read. Fixture fetch only.
- **Commands:**
  - `npx vitest run test/http/validation.spec.ts test/http/service.spec.ts test/http/sse-writer.spec.ts test/http/stream-transport.spec.ts` — **PASS** 4 files, 16 tests (strict queries, identity forwarding, awaited backpressure, one attachment, no premature success).
  - `npm run test:e2e -- test/http/routes.e2e-spec.ts` — **PASS** 1 file, 5 tests (P7 routes, parser/identity, P5 conflict JSON, async register, terminal reattachment).
  - `npm run test:e2e -- test/http/runtime.native.e2e-spec.ts test/http/pagination.native.e2e-spec.ts` — **PASS** 2 files, 10 tests (duplicate/retry/cancel/EOF/truncated/disconnect/finalization recovery, stable session ties, older message pages).
  - `npx tsc --noEmit --incremental false -p tsconfig.json` — **PASS** (source and tests).
  - `npm run build` — **PASS**.
  - `npm run lint` — no new errors. Warnings: control-regex in `validation.ts` path IDs (same class as P5 `titleFor`); Vitest `unbound-method` on `vi.fn` mocks; `no-base-to-string` on fixture fetch body. Upstream P4/P5 warnings unchanged.
  - `npm test` — **PASS** 40 files, 265 tests (e2e excluded).
  - `npm run test:e2e` (full backend, native fixture environment) — **PASS** 12 files, 61 tests. Existing P2/P5 native suites remain covered.
- **git hygiene:** `git diff --check` clean; ownership confined to `backend/src/http/**` and `backend/test/http/**`.
- **Not proven here:** genuine process kill, selected Azure, staging proxy/access/backup/restore/drain, live paid model, public production access, AC16. Unified review is **skipped**, not passed. Distinguish fixtures from staging. A local chat success does not establish production readiness.
