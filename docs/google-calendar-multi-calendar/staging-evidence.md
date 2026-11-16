# Multi-calendar staging and service evidence

Review: **skipped, not passed**. Deployment and provisioning: not authorized.

## Evidence classification

- Scripted Google/model fixtures: not live Google, OAuth, quota, ACL or paid inference evidence.
- Frontend Node/SSR tests: not browser keyboard, focus or assistive-technology evidence.
- Native fixture: real isolated persistence plus scripted Google/model, not a live Calendar write.
- Historical Phase 1 records: preserved separately, not remeasured Phase 2 evidence.

| Gate | Status | Missing prerequisite / required observation |
| --- | --- | --- |
| P9-BROWSER | tested, incomplete | Intercepted-fetch fixture P9-observed 2026-10-26T07:31:43Z at SHA `7e59b78`; `#fixture-status` was `8/8 passed`. Owner-reported 8/8 after P7 `eb1203c` is independently confirmed. Not live Google. Keyboard/AT and fixture-absent scenarios remain unrun. |
| P9-ACCESSIBILITY | unrun | Keyboard/focus and assistive-technology product/version observations were not executed. Native markup and Node SSR are insufficient. |
| P9-NATIVE | blocked | Explicit generated-database create/drop authorization, isolated operator URI, exact prefix, replica-set and cleanup evidence. |
| P9-LIVE-CONSENT | blocked | Exact operator project/client/redirect/grant authorization, incremental consent and partial-grant rejection drill. |
| P9-LIVE-ACL | blocked | Named disposable secondary owner, externally owned shared writer, reader, freeBusyReader and Workspace scope/role drill. |
| P9-LIVE-BUSY | blocked | Authorized fixture event data/ranges covering conflict, opaque all-day/DST and transparent gaps; disclosed incomplete-coverage acceptance. |
| P9-LIVE-RETRY | blocked | Authorized owned/shared create/readback, original event identity on safe retry and no second insertion. |
| P9-LIVE-QUOTA | blocked | Bounded explicitly permitted quota/rate-limit observation; no quota exhaustion or load generation authorization exists. |
| P9-REAL-DATA-POLICY | blocked | Approved processing/routing/retention and actual provider-header evidence, shared-calendar metadata handling and backup/restore/invalidation disposition. |
| P8-GATE-P2-INVALIDATION | blocked | P8 A3 source wiring is committed (`340bb28`); native index `explain`, backup/restore, and retained real-data admission remain unrun. Expiry sweep is not immediate invalidation. |
| P8-GATE-MIGRATION-ENTRYPOINT | blocked | Explicit approved operator migration/rollback procedure and executable ownership disposition; no automatic migration authorized. |

## Browser record

Status: tested, incomplete (fixture 8/8 passed; accessibility and extra scenarios unrun).
UTC: `2026-10-26T07:31:43Z`. SHA: `7e59b78b72dcec11a0e563a256020f3b775f25ac`.
OS: Windows x64. Node `v24.18.0`. Vite `8.3.3` on `http://127.0.0.1:5187` (`--strictPort`).
Fixture path: `/src/features/plugins/google-calendar/testing/calendar-browser.html`.
Opened URL settled at `http://127.0.0.1:5187/` with title `Aurvin Google Calendar Browser Fixture`.
No live backend or Google/OAuth network destination was authorized; the fixture uses intercepted fetch.

Literal `#fixture-status`: `8/8 passed`.

Literal `#fixture-checks` items:

- pass: Standalone GoogleCalendarPanel renders paged defaults and saves without toggling enablement
- pass: Deferred page response from old client cannot overwrite newer state
- pass: OAuth callback query is scrubbed and opens Google Calendar panel with fixture notice
- pass: Enable/disable and project-wide grant revocation enforce CSRF and checkbox acknowledgment
- pass: Chat displays correcting progress, durable receipt on failed narration, and preserves draft on Reconnect navigation
- pass: v3 clarification proposal renders conflict card and Reply focuses composer without altering draft
- pass: Durable target badge displays Original Team and persists after settings change
- pass: No secrets or OAuth codes written to browser storage

Console: React `act(...)` warnings from `ChatProvider`/`Root`. These are fixture-runner diagnostics, not production Google traffic. No unexpected outbound Google/OAuth destination was observed.

This is a P9 observation, not only the P7 owner report. P9 did not edit the P7 runner. Keyboard/AT subgate remains unrun. The executable fixture still does not cover every requested browser state (409/refresh failure/partial/stale/reconnect/no-ID Connect/keyboard+AT). Node Vitest is not this record.

Prior P9 observation at `af36a3f` (`5/8 passed`, 2026-10-26T06:51:57Z) is superseded by this record.

## Native record

Status: blocked. URI and credentials must never be printed. Required prefix:
`aurvin_p2_test_`. No database was created, reconnected, migrated or dropped for this record.
No replica-set member count, failover capability or cleanup success is asserted.
`AURVIN_P9_NATIVE_AUTHORIZED` was not set. `AURVIN_TEST_MONGODB_URI` was absent and
`AURVIN_TEST_DB_PREFIX` was not `aurvin_p2_test_`. e2e was not re-run this pass;
the prior skip of
`backend/test/integration/plugins/multi-calendar/native-recovery.native.e2e-spec.ts`
remains the last native discovery record.

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
