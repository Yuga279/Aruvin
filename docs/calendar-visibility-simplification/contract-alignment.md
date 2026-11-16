# Calendar contract alignment and P2 evidence

**Status:** P2 offline implementation Tasks 1–7 recorded. This is not the orchestrator's `verification.md`/`final_report.md` and does not establish live incident resolution or native-database certification.

## Baseline and evidence boundary

- Worker baseline: clean worktree at `0e35418ad863af063ad7a63f3dbd761512b8d088` (`docs(calendar): record P2 plan readiness`), 27 October 2026. The committed P2 plan is `f4c4a69`; P1 worker commits include `4326a1c` and the P1 implementation/evidence commits recorded in `observability.md`.
- P1 diagnostic contract: `process` event version 1. Its allowlisted stages include `model-dispatch` and `model-decision`; `dispatchKind` is optional and permits `initial`, `continuation`, or `schema-repair`. Keep the existing correlation, allowlist, redaction, byte/count bounds, and sink-failure isolation. Do not change `diagnosticVersion` for P2.
- **Observed on fixtures before P2 source edits:** `npm test -- test/assembly/calendar-observability.spec.ts` — 1 file, 10 tests passed; `npm test -- test/runtime/calendar-feedback.spec.ts` — 1 file, 5 tests passed. Both emitted the existing Vite `vite-tsconfig-paths` informational warning. These are characterization results, not live evidence.
- **Public documentation:** the linked Google Calendar REST references below were read on 27 October 2026. Public documentation reads are not Google account/provider acceptance calls.
- **Unobserved live incident:** its actual model arguments, rejected boundary, selected-model repair behavior, and owned-calendar answer remain unknown. Neither the model's page-token explanation nor these fixture results identify its cause.
- No live Google/OpenRouter call, application database access, provisioning, credential use, or OAuth change was performed for this baseline.

## Supported five-tool subset

Aurvin exposes only these five model tools. Runtime Zod schemas in `backend/src/contracts/calendar-tools.ts` are authoritative for parsed inputs; the advertised JSON Schema is a separately checked projection, not an authorization boundary. The actual native request builder is `backend/src/model/calendar-policy.ts::buildCalendarBody`.

| Aurvin tool | Model arguments and runtime limits | Google REST mapping and Aurvin result/limits |
| --- | --- | --- |
| `calendar_list_calendars` | Optional `pageToken`; `{}` is the first page. | [`CalendarList.list`](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), `GET /users/me/calendarList`. Google `pageToken` is optional and Google returns `nextPageToken`; Aurvin's model-facing `pageToken` instead carries an opaque signed Aurvin snapshot continuation. It returns visible-list entries with `accessRole`/`primary`, discovery completeness/limitations, and a nullable `nextPageToken`. Aurvin pages at most 20 retained entries; discovery requests Google pages of at most 100 and retains at most 100 calendars. A local continuation resumes the retained snapshot, not calendars omitted by a capped/incomplete Google discovery. Hidden/deleted entries are excluded by default. |
| `calendar_list_events` | Required offset timestamps `timeMin`, `timeMax`, and integer `maxResults` 1–20; optional `calendarId` and `pageToken`. | [`Events.list`](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), `GET /calendars/{calendarId}/events`. Aurvin requires a valid increasing interval no longer than 31 days, expands recurring instances, orders by start time, projects timed events, and marks all-day omissions as truncated. Google time bounds are exclusive against event end/start respectively; an empty page may still return a Google continuation. Aurvin signs/scopes the continuation and never exposes the raw Google token. |
| `calendar_get_event` | Required Google `eventId`; optional `calendarId`. | [`Events.get`](https://developers.google.com/workspace/calendar/api/v3/reference/events/get), `GET /calendars/{calendarId}/events/{eventId}`. The identifier is the Google event ID, not `iCalUID`. Aurvin returns its supported timed-event projection; private details may be masked and sparse cancelled/all-day shapes are not evidence of absence. |
| `calendar_create_event` | Required `summary`, offset `start`/`end`, and IANA `timeZone`; optional `description`, `location`, and `calendarId`. | [`Events.insert`](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), `POST /calendars/{calendarId}/events`. The server requires accepted intent, a fixed authorized target, current capabilities and availability preflight; the model arguments do not grant write authority. It creates one ordinary timed event without model-supplied invitations/recurrence/arbitrary REST fields. Aurvin uses `sendUpdates=none`, which does not guarantee no email or external synchronization. A matching durable operation/receipt/readback confirms creation; uncertain POST outcomes are not blindly repeated. |
| `calendar_check_availability` | Required `timeMin`, `timeMax`, and `timeZone`; optional unique `calendarIds` of 1–100 IDs. | [`Freebusy.query`](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), `POST /freeBusy`. Aurvin requires an increasing offset-timestamp interval of at most 31 days, resolves requested calendars through discovery/capabilities, batches at most 50, and reports opaque busy intervals, per-calendar errors, and incomplete coverage. Google intervals are inclusive-start/exclusive-end. “Clear” is not a reservation, events listing, or working-hours guarantee. |

The narrow existing grant set remains `openid`, `email`, `calendar.calendarlist.readonly`, `calendar.events`, and `calendar.freebusy`; broad `calendar` and `calendar.readonly` grants remain rejected. See [Google's scope guide](https://developers.google.com/workspace/calendar/api/auth). The applicable current Calendar REST path is assembled in `backend/src/operations/calendar-assembly.ts`, `backend/src/plugins/google-calendar/tools.ts`, `calendar-discovery-api.ts`, `calendar-api.ts`, and `calendar-availability-api.ts`. The limits/projections in the Aurvin column are source-derived; Google request semantics are from the primary references linked per row.

For event read/create tools, omitted `calendarId` follows Aurvin's explicit target → saved default → primary resolution; it is not an unconditional Google REST default. Availability omission uses Aurvin's discovered set. A malformed/unauthorized decision is rejected locally before a Google request. P1 distinguishes local rejection (`not-sent`), cache use (zero Calendar HTTP), actual fetch attempt, and received response; a provider response is not automatically a confirmed write.

## Ownership and coverage semantics

Google's [`CalendarList` resource](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList) defines `accessRole: "owner"` as manager access, not proof of data ownership; a calendar can have multiple managers and one data owner. `primary` identifies the authenticated user's primary calendar. Current Aurvin discovery stores `accessRole` and `primary`, but deliberately does not ingest or persist Google `dataOwner` or infer ownership from email/ID spelling.

Therefore an evidence-qualified answer may identify the authenticated primary calendar, describe `owner` as manager access and other non-primary roles as shared access, and state that secondary-calendar data ownership is not established. It must qualify hidden/deleted exclusions, incomplete/truncated discovery, and retained-page exhaustion. A definitive exhaustive list of secondary data owners is not supported by these fields and is an acceptance conflict if required; do not overclaim or add a `dataOwner`/`owned` field without an approved privacy and compatibility strategy. A scripted final answer verifies publication/context, not a live model's reasoning.

The existing REST adapter remains preferable to [Google's hosted Calendar MCP setup](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server): that hosted service is documented as Developer Preview, requires extra enrollment/configuration, advertises actions beyond Aurvin's supported subset, and its documented [`list_calendars` tool](https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/list_calendars) does not provide the REST calendar-list `accessRole`/`primary` evidence used here. No hosted service, provisioning, or scope change is selected.

## Contract and compatibility decisions before source changes

- Preserve all five tool names, argument keys, result keys, strict v1/v2 stored shapes, revision literals, source/capability semantics, operation receipts, and checkpoint references. No persistent-schema migration or result-field addition is selected.
- Keep `pageToken`/`nextPageToken` as historical field names for an opaque Aurvin continuation, not a raw Google token. Continuations are signed, not encrypted, scoped to account/query/discovery and process key, and expire within five minutes. Treat them as sensitive. Restart/refresh/expiry invalidation remains fail-closed with bounded restart-at-first-page correction; never reinterpret an old cursor as a Google token.
- Catalogue descriptions/repair prose may change the content-independent catalogue fingerprint; the diagnostic version and stored tool revision do not change. `calendarInputSchemas` remains runtime authority and native parameters must equal the parity-checked projection on initial, continuation, and correction requests.
- Existing server identity and OpenRouter `user` attribution, denied data collection, fixed OAuth scopes, account/credential/capability fences, request/deadline/spend/context/output limits, source privacy/expiry, result/receipt binding, durable publication, create authority, cancellation, and saved-result recovery remain mandatory.
- Rollout remains stop-admission → drain the one executor → replace the full release without overlap. Do not delete histories, receipts, operations, checkpoints, or cursors as cleanup. Fixture compatibility does not prove an old binary/database rollback drill; use a complete prior release and block unattended rollback unless that prior-binary behavior is separately established. No deployment is authorized here.

## Retained and removable execution layers

**Retain:** the raw native JSON scanner (duplicate keys, forbidden/reserved fields and byte/depth bounds); separate direct-executor semantic/binding validation; `CalendarApiTools` account/credential/scope/capability checks, request debits, deadlines, signed cursor isolation, source provenance, receipt/readback and response-size checks; runtime's durable decision/result ordering, correction budget and saved-result recovery; P1 diagnostic injection and active-work shutdown/drain.

**Candidate removal after replacement coverage:** same-process MCP client/transport/server setup, version negotiation, `listTools` catalogue handshake, SDK request/result encoding and redundant parsed-schema pass. These are protocol-only round trips, not a remote service. Any result-to-call/source/target/receipt binding, conservative create uncertainty, one-instance lifecycle and drain guarantees they currently provide must move to or remain at the direct execution boundary before the wrapper is retired. The native tool catalogue itself is not removed.

## Task 2 — native contracts, single structural parse and P1 trace

- **Observed red:** `npm test -- test/model/calendar-repair.spec.ts test/contracts/calendar-contract-parity.spec.ts` ran 2 files / 8 tests: 3 intended failures (repair schema dump/effect and absent description semantics), 5 passes.
- **Observed baseline assembly red:** `npm test -- test/assembly/calendar-simplification.spec.ts` ran 1 test and failed at the first diagnostic assertion: three actual `model-dispatch` events had no `dispatchKind`. The actual request-catalogue equality and server `user`/provider privacy assertions had already passed. Source inspection also showed no `model-decision` emissions; that assertion was present before the source edit and passed after the bounded emissions were added, but the baseline test stopped earlier at `dispatchKind`.
- **Observed green:** the planned Task 2 command (`npm test -- test/contracts/calendar-tools.spec.ts test/contracts/calendar-multi-tools.spec.ts test/contracts/calendar-contract-parity.spec.ts test/model/calendar-validation.spec.ts test/model/calendar-repair.spec.ts test/model/calendar-policy.spec.ts test/model/calendar-adapter.spec.ts test/model/calendar-repair-flow.spec.ts test/assembly/calendar-simplification.spec.ts`) passed 9 files / 145 tests. Follow-up changed-test battery (`calendar-tools`, repair, repair-flow, runtime feedback, runtime loop, assembly simplification) passed 6 files / 35 tests. `npm test -- test/plugins/integration/scripted-model.spec.ts` passed 1 file / 7 tests after replacing its stale prompt-text expectation with native-request schema assertions. Each command emitted the existing Vite `vite-tsconfig-paths` informational warning.
- `calendarInputSchemas` remains the runtime authority; model candidate handling now performs one envelope parse after the raw scanner while direct executor validation remains separate. Repair prose no longer contains a second schema dump; the serialized OpenRouter `tools` field remains present and is asserted on initial, correction, and continuation requests.
- The five v2 descriptions now qualify Aurvin's restrictions, defaults, pagination and ownership evidence. Bounded text properties disclose UTF-16 and UTF-8 limits. Structural parity covers required/optional fields, types/bounds, wrong JSON types, reserved/unknown keys, array bounds/uniqueness, and maxResults/cursor edge values. Semantic boundaries remain separately enforced by `tools-validation.spec.ts` (time/order/window/zone, safe IDs, direct semantic checks and create authority) and cursor suites (signature/scope/expiry); JSON Schema does not confer execution authority.
- P1 remains `diagnosticVersion: 1`: the actual assembled trace now asserts `dispatchKind` values `initial`, `schema-repair`, `continuation` and a content-free `model-decision` tool observation. The static catalogue fingerprint remains computed from the actual `CALENDAR_TOOLS` value; no stale constant or persistent revision was changed. Record the final computed fingerprint after the built-application gate.

## Task 3 — direct execution without embedded MCP

- **Observed red (binding):** `npm test -- test/plugins/google-calendar/tools-multi.spec.ts -t "binds the direct result"` — 1 failed / 33 skipped. The direct executor accepted a valid-shaped wrong `eventId` (`outcome: 'success'`). That check previously lived in MCP `decodeCalendarExecution`.
- **Observed red (lifecycle):** `npm test -- test/plugins/google-calendar/tools-boundaries.spec.ts` — `activeExecutions` was `undefined` while `invoke` waited.
- **Observed green:** `npm test -- test/plugins/google-calendar test/plugins/integration test/contracts/calendar-multi-operations.spec.ts test/contracts/calendar-contract-parity.spec.ts test/assembly/calendar-flow.spec.ts test/assembly/calendar-multi-flow.spec.ts test/integration/plugins/multi-calendar/accounting-recovery.spec.ts test/operations/calendar-shutdown.spec.ts` passed 36 files / 325 tests. Existing Vite `vite-tsconfig-paths` informational warning only. No live Google/OpenRouter calls and no application database access.
- Assembly now uses `const execution = tools`. `AppService.drainCalendar` reads `activeExecutions` after `close()`. Runtime fixtures record effects around the same `CalendarApiTools` instance.

### Retained checks and their boundary

| Check | Boundary after Task 3 |
| --- | --- |
| Wrong event / wrong calendar / extra availability calendar | `CalendarApiTools.checkedSuccessV2` on adapter output; `CALENDAR_RESPONSE_INVALID` |
| Malformed create result after dispatch | Same method + create-adapter exception wrap; `WRITE_OUTCOME_UNKNOWN/readback`; no second POST |
| Cut-short dispatched create | HTTP write abort after POST remains uncertain; close never claims absence |
| Result/source/receipt/target binding | Direct envelope vs trusted binding/call/target/expected IDs; schema still required |
| Encoded 16,384-byte ceiling | `jsonBytes({ content: [], structuredContent })` in `checkedSuccessV2`; list shrinking uses the same encoded size; lower `resultBytes` still `CALENDAR_RESULT_TOO_LARGE` |
| Active work / drain | `activeExecutions` counts invoke and readback until `finally`; close is idempotent, aborts, refuses later invoke as failure and later readback as `unknown` |
| All-five tools, hostile fields, role/capability, 31-day window, identity refusal | Direct `f.tools.invoke(f.input)` in `tools-multi`, `catalogue`, `calendar-execution` |
| Availability batches, DST opaque intervals, 2000-interval cap | `provider-coverage.spec.ts` through `CalendarApiTools` |
| Native catalogue / engine / Zod | `calendar-contract-parity.spec.ts`; Node engine and Zod unchanged; retired MCP SDK packages absent |
| HTTP/SSE correlation, receipts, attribution, accounting | Assembly spies moved to `CalendarApiTools.prototype.invoke` |
| v1 read-only decoders and uncertain dispositions | Unchanged; no new v1 execution branch |

### Removed protocol-only assertions

Removed with the MCP wrapper, not replaced: initialize/`listTools`/version negotiation, `mcp-protocol-version` / `CALENDAR_MCP_WIRE` pin, `aurvin.internal` MCP endpoint/headers, JSON-RPC `isError` flag consistency, handler-close/channel accumulation, catalogue-wire tampering (`assertCalendarCatalogue`, extra tools, `nextCursor`), SDK `callTool`/`structuredContent` encoding. Native request tampering remains rejected by `buildCalendarBody`. Historical docs may still name the retired path. `rg` over `backend/src` after deletion has no executable MCP/client/server/catalogue-wire references.

## Task 4 — first page, continuation and qualified ownership

- **Observed red (fields mask):** `npm test -- test/plugins/google-calendar/calendar-discovery-api.spec.ts -t "collection kind"` failed because `fields` started with `nextPageToken`, not `kind`.
- **Observed red (ownership instruction):** `npm test -- test/assembly/calendar-simplification.spec.ts -t "qualified roles"` reached the real-asset request and failed on absent `manager access` in system messages. Pagination `{}` / returned `nextPageToken` already succeeded on that run. This is not live-incident evidence.
- **Observed green:** `npm test -- test/assembly/calendar-simplification.spec.ts test/plugins/google-calendar/calendar-discovery-api.spec.ts test/plugins/google-calendar/calendar-api-cursor.spec.ts test/plugins/google-calendar/tools-multi.spec.ts test/plugins/google-calendar/calendar-api.spec.ts` passed 5 files / 93 tests. Vite `vite-tsconfig-paths` warning only.
- Discovery requests `kind` in the CalendarList fields mask so an empty collection can be validated. Extra Google `dataOwner` is not ingested, persisted, or turned into `owned`.
- Production assembly accepts `{}` then a dynamically returned Aurvin continuation (20+1 retained entries), identifies `owned` as primary, and treats a secondary `accessRole: owner` as manager access. Scripted final text proves publication/context, **not** selected-model ownership reasoning.
- AC6 is evidence-qualified only: primary can be identified; manager/shared roles can be described; secondary data ownership remains unknown. Hidden/deleted exclusions and incomplete discovery prevent an exhaustive ownership claim. No `dataOwner` field was added.
- `realAssets` loads checkout `system.md` / `product_knowledge.md`. The fixture chat context is raised to `calendarLimits.contextTokens` (32768) only for that option because the default 16384 budget is a byte-estimate ceiling that the real assets plus native schemas exceed.

## Task 5 — one correction transition and semantic duplicates

- **Observed red:** `npm test -- test/runtime/calendar-feedback.spec.ts -t "property order|malformed-argument exhaustion"` — property-order duplicate was already suppressed (characterization: parsed argument stringify matched the first raw order); malformed `{` exhaustion threw `PROVIDER_ERROR` at the adapter-rejected ceiling instead of sealing like a cursor failure.
- **Observed green:** `npm test -- test/runtime/calendar-feedback.spec.ts test/runtime/calendar-answer-regressions.spec.ts test/runtime/calendar-budget.spec.ts test/runtime/calendar-preflight.spec.ts test/runtime/calendar-recovery.spec.ts test/model/calendar-repair.spec.ts test/model/calendar-validation.spec.ts test/assembly/calendar-simplification.spec.ts` passed 8 files / 161 tests. Vite warning only.
- Duplicate comparison now uses `isDeepStrictEqual` on parsed calls, sorting availability `calendarIds`. Distinct event IDs still execute independently. Malformed-argument exhaustion seals with the same user-facing “my tool calls” fallback as cursor exhaustion; `repairOrSeal` is the single correction transition. Permission denials and uncertain creates do not enter it.

## Task 6 — compatibility, preserved guarantees, rollout

- **Observed:** compatibility/safety batteries from `backend`, Vite warning only, no skips:
  - contracts/persistence/context: 9 files / 50 tests
  - runtime authority/intent/preflight/operation/publication/recovery: 9 files / 64 tests
  - plugin/operations privacy/shutdown/restart: 8 files / 85 tests
- Pre-P2 unknown v1 operation, receipt and checkpoint refs round-trip through current compatibility decoders. `legacyOperationDisposition` stays `unknown` / `reconcileOriginal: true`; history is not executable authority.
- `git diff 37f7618 -- backend/src/contracts backend/src/agent backend/src/persistence backend/src/context/calendar-context.ts`: no agent/persistence/`calendar-context.ts` decoder changes. Contract diffs are the retired MCP schema/export/`CALENDAR_MCP_WIRE` and truthful v2 tool descriptions/JSON Schema projections. Stored v1/v2 revision literals and record shapes are unchanged.
- **Rollout/rollback (fixture compatibility, not a binary drill):** no persistent migration; stop admission and drain the one executor before replacing the binary; completed saved results finalize through existing recovery without new inference or POST; invalid restart cursors fail closed with a local reason and `{}` repair, never as Google tokens; rollback uses a complete previous release with its own lockfile, not the new pruned MCP-free lock against an old binary. Previous-binary/database rollback drill is **unrun**; unattended rollback is blocked. This plan does not authorize deployment.

## Task 7 — built assembly, AC9, offline backend checks

- Environment: Node `v24.18.0`, npm `12.0.1`, Windows. No `AURVIN_TEST_MONGODB_URI` / `AURVIN_TEST_DB_PREFIX` in the child PowerShell used for routine/e2e. No live Google/OpenRouter, no `.env` app start, no application database.
- No `dist` existed at the Task 7 red gate; a missing-module failure would not have been meaningful. `npm run build` completed, then `npm test -- test/assembly/calendar-simplification.built.spec.ts` passed 1 file / 1 test: compiled `CALENDAR_TOOLS` equals source, execution is `CalendarApiTools`, three native dispatches `initial` / `schema-repair` / `continuation`, local `cursor-format` `not-sent`, durable completion, zero Google HTTP.
- Actual static catalogue fingerprint (SHA-256 of `JSON.stringify(CALENDAR_TOOLS)` from built `dist/contracts/calendar-tools.js`): `bd00654035fe6af3725b8a86bded218ec0e741e0c6091e27ea3b24b0af5b02ea`. `diagnosticVersion` remains 1; stored schema revision remains v2.
- AC9 path suite: `npm test -- test/assembly/calendar-observability.spec.ts test/assembly/calendar-flow.spec.ts test/assembly/calendar-simplification.spec.ts test/operations/telemetry.spec.ts test/operations/runtime.spec.ts test/operations/persistence.spec.ts test/runtime/calendar-feedback.spec.ts test/runtime/calendar-recovery.spec.ts` passed 8 files / 47 tests.
- `npm run lint`: oxlint warnings only (pre-existing voice/unbound-method and unused-import noise); no oxlint errors.
- Routine: `npm test -- --no-file-parallelism` with native env vars removed: 246 files passed / 2 skipped; **2001 passed / 10 skipped**. Vite `vite-tsconfig-paths` informational warning. First full run had 5 failures from stale `PROVIDER_ERROR` / hardcoded 10 Google deliveries; those tests now expect sealed repair exhaustion and charge-once against actual delivery count (direct path is 5 Google deliveries, not the old MCP-era 10).
- E2e: `npm run test:e2e` with native env vars removed: 4 files passed / 40 skipped; **22 passed / 129 skipped**. Skipped native suites are **not** native evidence.
- At Task 7, `test:azure` / `test:behavior` had **not yet run**. Discovery is not empty (`test/compatibility/*.azure.spec.ts`, `test/evaluations/*.behavior.spec.ts` exist); the Azure suite is not Azure service certification. The deterministic behavior suite was run later; see the post-Task-7 follow-up below. Its guarded live smoke remained skipped.
- Caller audit after Task 3: no `EmbeddedCalendarExecution` / MCP SDK / `openChannels` / `CALENDAR_MCP_WIRE` in `backend/src` or `backend/test` except the explicit dependency-absence check. `git diff --check` clean. Frontend checks not run: no frontend/shared wire change.
- Remaining gates: native isolated MongoDB, selected-model + connected Google owned-calendar reproduction, previous-binary rollback drill. AC6 is evidence-qualified only. Original incident remains unobserved. Review **skipped**. At worker handoff the orchestrator artifacts were pending; final integrated records are in `verification.md`, `final_report.md`, and `state.md`.

## Post-Task-7 prompt release follow-up

- The P2 ownership wording changed the system instruction asset after Task 7. The separate deterministic behavior suite then exposed its stale sentence and SHA pin. Commit `36a9f89` updates the system asset to `phase1.v2`, updates the fixed-asset release/hash, and pins the new behavior expectation. Product knowledge and the evaluation case catalog remain `phase1.v1`.
- TDD evidence: the updated assertions failed against the old `phase1.v1` system prompt (1 failed / 3 passed); after the source/release update, the focused deterministic spec passed 4/4. Full `npm run test:behavior` passed 5 with 1 live-smoke test skipped because `AURVIN_LIVE_SMOKE` was not authorized. No live request was made.
- The fix was integrated in `920e2c2`. Final integrated offline build, lint, routine, e2e, and behavior outcomes are recorded in `verification.md`; native database and live provider gates remain unrun.

## Verification ledger

| Evidence | State |
| --- | --- |
| Baseline characterization | Observed on deterministic fixtures: assembly observability 10/10 and runtime feedback 5/5, as recorded above. |
| Task 2 production changes and focused red/green checks | Complete and committed in `252f2fe`. |
| Task 3 direct execution without embedded MCP | Complete in `00a1e39`. Green suite 36 files / 325 tests. |
| Task 4 ownership/continuation | Complete in `920f60d`. Green 5 files / 93 tests. |
| Task 5 bounded repairs / duplicates | Complete in `250d742`. Green 8 files / 161 tests. |
| Task 6 compatibility/safety | Complete in `cdffbd2`. Batteries 9/50, 9/64, 8/85. |
| Task 7 built assembly, AC9, offline backend | Build + built spec 1/1; AC9 8/47; lint warnings only; routine 2001 passed / 10 skipped; e2e 22 passed / 129 skipped. Commit follows. |
| Native database/service compatibility | **Not run** / blocked; needs isolated operator `AURVIN_TEST_MONGODB_URI` + `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. E2e skips are not this evidence. |
| Azure / behavior suites | **Not run**; files exist so empty discovery is not claimed. |
| Live OpenRouter/Google behavior and original incident | **Not run/blocked**; requires separate explicit bounded authorization. Scripted tests do not resolve it. |
| Previous-binary rollback drill | **Unrun**; unattended rollback blocked. |
| Unified review | **Skipped**, not passed; no reviewer or review-triggered fixer. |
| Orchestrator verification.md / final_report.md / state.md | Complete after integration; see the linked artifacts. |
