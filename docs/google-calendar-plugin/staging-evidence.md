# Google Calendar plugin staging evidence

Review: **skipped, not passed**. No deployment is authorized. No live Google Calendar mutation and
no paid OpenRouter inference was performed by this plan.

This revision replaces the second P9 evidence pass. Every entry below was re-measured by P9 after the
native gate was executed. The **native** section is now executed evidence against a real MongoDB
replica set; the **live gate** section is unchanged in substance and remains blocked.

## Browser

- URL: `http://127.0.0.1:5173/src/features/plugins/google-calendar/testing/calendar-browser.html`
- Runner: the existing closed Vite fixture at
  `frontend/src/features/plugins/google-calendar/testing/calendar-browser.html`, served by
  `npm run dev -- --host 127.0.0.1 --port 5173` from `frontend/`. No new test runner was added,
  no live backend was started, and `vite preview` was not used (the fixture refuses
  non-development execution).
- Measured at: 2026-10-21T14:27Z-14:28Z (dev server started at 14:26:56Z, fixture loaded, dev
  server stopped afterwards; the pre-existing user Vite server on port 5179 and the user backend
  `dist/main.js` were left untouched).
- Status text (`#fixture-status`), exact: `4/4 passed`
- Checks (`#fixture-checks`), exact list items:
  1. `pass: OAuth callback query is scrubbed and opens Google Calendar panel with fixture notice`
  2. `pass: Enable/disable and project-wide grant revocation enforce CSRF and checkbox acknowledgment`
  3. `pass: Chat displays correcting progress, durable receipt on failed narration, and preserves draft on Reconnect navigation`
  4. `pass: No secrets or OAuth codes written to browser storage`
- Address bar contained `code=` or `state=` after load: **no**. The fixture loads
  `/?plugin=google-calendar&oauth=fixture&code=secret-code-123&state=secret-state-456` and the
  application scrubbed it; the observed address bar was `http://127.0.0.1:5173/` with no query
  string.
- Observed console error (not a failed check): React logged
  `An update to %s inside a test was not wrapped in act(...)` for `ChatProvider`. All 4 fixture checks
  passed; this warning is recorded rather than hidden.
- Result: **pass** (4 of 4, total > 0).
- Limit: this is browser evidence for the local fixture only. It is **not** Node Vitest evidence
  and it is **not** a live Google grant, a real Calendar event, or a production-readiness claim.
  No screenshot was committed.

## Native

The native gate has now been **executed** against a real database. This section replaces the earlier
"prerequisites absent / unrun" record.

- Prerequisites present: **yes** for the native rows - `AURVIN_TEST_MONGODB_URI` pointing at an
  isolated local replica set and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. The URI value is never
  printed or recorded.
- URI printed: **no**. Credentials printed: **no**.
- Prefix required: `aurvin_p2_test_`
- Topology (read-only probe, executed outside the repository): replica set `aurvinNative`,
  `setVersion: 1`, `isWritablePrimary: true`, **one member** (`127.0.0.1:27099`, `stateStr: PRIMARY`,
  `health: 1`), `replSetGetStatus` ok, loopback-only listener, temporary dbpath.
- **Topology caveat**: a **single-node** replica set satisfies the native admission requirement of a
  replica set, but it is **not** a multi-member and **not** a production topology. Azure
  certification, multi-instance admission and public deployment stay out of scope.
- Generated database dropped by the fixture: **yes**. A database inventory taken before and after the
  full native e2e run is identical - 109 databases in total, 106 of them `aurvin_p2_test_*`, and the
  only other names are MongoDB's own `admin`, `config` and `local`. The run therefore created and
  dropped its own generated `aurvin_p2_test_<uuid>` databases and **no application database was
  touched**. The 106 remaining `aurvin_p2_test_*` databases are residue from earlier, interrupted
  runs against this same temporary instance; they predate this measurement window and are confined to
  the `aurvin_p2_test_` prefix.
- Command results:
  - `npm run test:e2e` **with** the native replica set: exit **0** - `Test Files 41 passed (41)` /
    `Tests 145 passed (145)`, **0 skipped, 0 failed** (2026-10-21T14:16:13Z; repeated at 14:25:01Z
    with the identical result and an unchanged database inventory).
  - The 5 Calendar native e2e files together (calendar accounting, calendar retention, calendar
    storage, calendar recovery, and the P9 recovery/accounting file): exit **0** -
    `Test Files 5 passed (5)` / `Tests 13 passed (13)`, **0 skipped** (14:18:21Z). Previously these
    13 tests were discovered skips; they now pass.
  - The phase-1 assembled native harness `test/integration/recovery.native.e2e-spec.ts`: exit **0** -
    `Test Files 1 passed (1)` / `Tests 3 passed (3)` (14:18:56Z). This suite exercises the **real
    assembled path** with the Calendar composition present and no Google Calendar connected.
  - `npm run test:e2e` **without** the native prerequisites: exit **0** -
    `Test Files 4 passed | 37 skipped (41)` / `Tests 22 passed | 123 skipped (145)`, **0 failed**
    (14:17:27Z). The suites skip cleanly when the operator prerequisites are absent and pass when
    they are present.
  - `npm test` without the native URI: exit **0** - 192 files (190 passed, 2 skipped) / 1563 tests
    (1553 passed, 10 skipped) / 0 failed (14:14:04Z).
  - `npm test` with the native URI: exit **0** - 192 files passed / 1563 tests (1562 passed, 1
    skipped) / 0 failed (14:15:07Z).
- Replica-set certification: **single-node only**. The suites assert `hello.isWritablePrimary` and
  that a replica-set name is present; there is no multi-member failover evidence and none is claimed.

## Live gate

- G8: **blocked / live acceptance unrun**
- Missing inputs (all of them):
  - a Google project/consent configuration with the exact registered redirect and scopes
  - the operator's own Google grant
  - a disposable owned calendar id confirmed as the authorized target
  - exact permitted event data and cleanup authority
  - a tool-capable configured model with an approved external-data policy
  - a bounded authorized spend limit
- Environment name scan for `AURVIN|MONGO|OPENROUTER|GOOGLE`: **no matching name present** outside
  the two native test variables used by the native rows. `AURVIN_LIVE_SMOKE` is the older text smoke
  and is not Calendar create permission. Goal approval and the written plan are not that
  authorization.
- Event ID reused on safe retry: **unrun**
- Second event created: **unrun**
- G9 real-data policy: **blocked**. `operations.md` section 11 lists the still-required Google
  terms, observed response headers and approved provider routing/retention policy, and keeps
  `P8-GATE-P2-RETENTION` and `P8-GATE-P2-INVALIDATION` open. A configured policy id is not that
  evidence.
- Spend initiated by this plan: **no**. No Google call, no OpenRouter call, no provisioning and
  no deployment was performed.
- Consequence: the workflow completion gate stays **pending** on G8 and G9. The native gate is
  executed and passing, but a local replica set and a local fixture do not close the live gate.
