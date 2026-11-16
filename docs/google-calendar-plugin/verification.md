# Google Calendar plugin verification

Unified review: **skipped, not passed**. This file does not authorize provisioning, deployment, or live spend.
Workflow completion is **not** claimed; see [final_report.md](final_report.md) for the named gates.

This revision replaces the second P9 evidence pass. It is a full re-measurement taken **after the native
gate was executed**: every command below was re-run by P9 and every count is the count observed in this
run. Nothing here is copied from the orchestrator's report. The native half of the suite now runs
against a real MongoDB replica set, so the AC03/AC08/AC09 disposition changed from *skipped* to
*pass*; the live Google/provider half remains **not run, blocked**.

## Environment

### Subsequent D7 verification — 22 October 2026

At `e45e8b6` (model evidence `3b198c9`), the orchestrator independently ran the new model/assembly capability suites: 2 files / 19 tests passed. Full backend `npm test`: 192 files passed, 2 skipped; 1572 tests passed, 10 skipped. Backend build and lint exited 0, run sequentially after tests. D7 is closed: frozen evidence now reaches the real configuration preparation path; unknown pricing, price drift or missing tool capability withhold Calendar tools while preserving text chat. No live Google/provider proof was executed. The native/browser measurements in the original tables below remain dated 21 October and were not repeated at this tip.

- Date UTC: 2026-10-21 (measurement window 14:13:35Z - 14:29:47Z; browser fixture 14:27Z - 14:28Z)
- Branch: `codex/google-calendar-plugin`
- Test tip (last commit before this evidence refresh): `f3db04f25d3e5deb90e64c9a8d6e11d9dda2b3d2`
- Node / npm: `v24.18.0` / `12.0.1` (satisfies `^22.22.3 || ^24.15.0 || >=26.0.0`)
- Test runner: Vitest `4.1.11`; Vite `8.3.3`
- OS: Microsoft Windows 11 Pro 10.0.26200, AMD64
- CPU: AMD Ryzen 7 9700X (8 cores / 16 logical processors)
- Native prefix required: `aurvin_p2_test_`
- Native prerequisites present: **yes, for the native rows only** (`AURVIN_TEST_MONGODB_URI` pointing at
  an isolated local single-node replica set and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`). The URI value
  is deliberately never printed or recorded here. The routine rows in this file were run with the
  prerequisites **absent** so that both configurations are measured.
- Native topology (read-only probe, executed outside the repository): replica set `aurvinNative`,
  `setVersion: 1`, `isWritablePrimary: true`, **one member** (`127.0.0.1:27099`, `stateStr: PRIMARY`,
  `health: 1`), `replSetGetStatus` ok, loopback-only listener, temporary dbpath.
- URI printed: **no**. Credentials printed: **no**.
- Live Calendar / paid OpenRouter: **not run - blocked** (G8/G9 have no authorization; see
  [staging-evidence.md](staging-evidence.md))
- Live env-var name scan: **no** name matching `AURVIN|MONGO|OPENROUTER|GOOGLE` was present in the
  process environment outside the two native test variables used by the native rows
- Review: **skipped**
- Concurrent unrelated work in the working tree during the run: `frontend/src/components/MessageItem.tsx`,
  `frontend/src/components/Transcript.tsx`, `frontend/src/styles/chat.css`,
  `frontend/src/styles/styles.test.ts` (modified) and `frontend/src/components/PromptTraveler.tsx`,
  `frontend/src/components/PromptTraveler.test.ts` (untracked). Not owned by P9, never staged, not
  reverted. The frontend build/lint/test results below were measured with that working-tree state
  present, and the frontend lint warning count includes 5 warnings in the untracked
  `PromptTraveler.tsx`.
- The backend working tree was verified clean (`git status --short -- backend` empty) after the
  temporary D1 A/B control was restored from `HEAD`.

### Native database hygiene (measured, not asserted)

A read-only probe (`hello`, `replSetGetStatus`, `listDatabases`) was run before and after the full
native e2e run:

| Measurement | Before | After |
| --- | --- | --- |
| total databases on the instance | 109 | 109 |
| `aurvin_p2_test_*` databases | 106 | 106 |
| other database names | `admin`, `config`, `local` | `admin`, `config`, `local` |

The native run therefore **created and dropped its own** generated `aurvin_p2_test_<uuid>` databases
and left the instance unchanged: the counts before and after are identical, and the only non-test
names are MongoDB's own system databases. No application or production database exists on this
instance and none was touched. The 106 `aurvin_p2_test_*` databases that remain are residue from
earlier, interrupted runs against this same temporary instance; they predate this measurement window,
are confined to the `aurvin_p2_test_` prefix, and this run neither created nor removed any of them.

## Commit set

Defect-correction commits applied since the baseline `989d6b17d09fc4f0c5393f1f92781030a78b6617`:

| Hash | Subject | Defect closed |
| --- | --- | --- |
| `5f0354a3a40b51c7840c9ac5315fc1ad7633834d` | test(calendar): make Calendar tool fixtures time independent | D1 (P5 owner fixture) |
| `a0bd63ff08553f75d1b90b7d73f3dfa7ca236785` | fix(calendar-runtime): charge one logical tool call per create | D3 (P6 owner accounting) |
| `ebb8dfb8ab7ebaf92d63887855a9e7b7a133d2a1` | test(operations): make the bootstrap fixture tolerant of loaded machines | D2 (P8 owner suite) |
| `c45c3be6994a803901e5b7c60095adc9e04b0245` | test(persistence): skip native suites when the isolated database is absent | D4 (persistence owner) |
| `a7e0ed3529de52f55a2060c4d2a369d31d7a9859` | test(http): skip native suites when the isolated database is absent | D4 (http owner) |
| `aa7a46d25a520a914b0110dc0bd802e609da8a98` | test(runtime): skip native suites when the isolated database is absent | D4 (runtime/voice owner) |
| `196cdecb0a2b0a45e51c285e1e80ccc7368ef4d0` | test(integration): repair the native assembled harness for the bootstrap config | D5 (phase-1 native harness) |
| `fe1c1d7ff5bd68eaca4ba2660f699f0d8e037eff` | test(calendar-persistence): bound the Calendar native suites explicitly | D5b (explicit native timeouts) |
| `759266dd35389444a568d9e6ca0c6e34b35776fe` | test(runtime): align the native recovery and voice suites with committed contracts | D5b/D5c (voice `SubmitLiveTurn.configSnapshot`, visible-live-message projection) |
| `c1b65b05538c8c068ebeafedd8ec430b9ffadbe0` | test(calendar-persistence): make the shared Calendar budget fixture time independent | D5c (shared Calendar budget fixture) |
| `86cd063eeb2144e5893654beaa5d869530505631` | fix(chat-runtime): keep text chat recovery healthy without a Calendar connection | D6 (real production defect) |

P9-owned commits on `codex/google-calendar-plugin` (all full hashes, in commit order):

| Hash | Subject |
| --- | --- |
| `ea019808f671019ebbf7b35d2d39a9b8369ecd45` | test(calendar): add P9 scripted wire helper |
| `30e7f89db9c9e4a9a084d03730e6c39d2ee7c4ec` | test(calendar): cover scripted repair exhaustion and policy separation |
| `79dc39f5b53b907eaf64b5b4bad19a2e19c7428f` | test(calendar): prove embedded MCP discovery and bounded Calendar fixtures |
| `551fd892ea65da8a5d6745887ae20f6b45921c36` | test(calendar): cover in-memory crash windows and same-turn reuse |
| `43cf5620254cc7b21d2d07ef2a41fd4547580a37` | test(calendar): cover assembled HTTP repair and boundary rejection |
| `cdeaacf38734b53ba210aae4c2746f096cbd8303` | test(calendar): add isolated native recovery and accounting proof |
| `7d19c70057696267b5331c45d77b65e1dee0197b` | test(frontend): add Calendar node integration flows |
| `71357f8da352ab17e16043fbf2f74e0f1515c841` | test(calendar): keep the P9 assembly binding lint clean |
| `e447f66c653ca606476194f84cd83470b0727baa` | docs(google-calendar-plugin): record P9 verification evidence |
| `c50a66c712b49ff63e67016af92395fdbdc33d53` | docs(google-calendar-plugin): record P9 worker and route defect D1 to P5 owner |
| `7a74a2a` | docs(google-calendar-plugin): refresh verification evidence after defect corrections |

P8-owned commits referenced by the gates: `286490dcfeb428e2a1f6d546ef61ec205fc2ff95`
(`operations.md`) and `ec5f39e76ce86ea8b2678708079f8d74b0cccb35`
(`backend/test/assembly/calendar-fixture.ts`).

Whole-plugin range: `git log --format=%H 989d6b17d09fc4f0c5393f1f92781030a78b6617..HEAD`
returned **122** commits before this evidence refresh (R, P1-P9 workers, plans, evidence and the
correction commits). The P1-P8 worker commit sets are recorded verbatim in [state.md](state.md).

P9 did not edit implementation source, contracts, manifests, lockfiles, or another worker's test in
this pass. The only P9-owned test file changed since the second evidence pass is
`backend/test/plugins/integration/recovery-limits.spec.ts`, and it was changed by the **P6 owner's**
correction commit `a0bd63f` - that file asserts the measured logical-tool value by design, so a
correction had to update it. The D5/D6 correction `196cdec`/`86cd063` touched the phase-1 harness
`backend/test/integration/assembled-harness.ts` and `backend/test/integration/recovery.native.e2e-spec.ts`,
both owned by the phase-1 workflow, and added
`backend/test/runtime/calendar-recovery-unavailable.spec.ts` (P9-owned D6 proof, 4 tests).

## AC matrix

`pass` is used only where a cited command exited 0 and discovered the cited test. `skipped` is used
only for a discovered skip. `blocked` is used where a required live or policy gate is absent.

| ID | Result | Evidence | Owner if failed | Limitation |
| --- | --- | --- | --- | --- |
| AC01 | pass | `assembled-http.spec.ts` (default-off status over HTTP, client identity override 400, hostile origin 403, missing CSRF 403, wrong Host 403); `calendar-node-flows.test.ts` ("Single-user local proof" disclosure); owner `test/assembly/calendar` (5 files / 11 tests) | P3/P8 | Local single-user only; member accounts/RBAC deferred by design |
| AC02 | pass | `embedded-mcp.spec.ts` (3 passed: three curated tools through the production `EmbeddedCalendarExecution`, observed wire `2026-07-28`); owner `plugins/mcp` (3 files / 39 passed) | P5 | Fixture Google transport, not a live Google grant |
| AC03 | pass | **Changed from skipped to pass**: the isolated-native half now runs against the real replica set. `calendar-storage.native.e2e-spec.ts` (5 tests: guarded ownership, unique connection owners and rotation CAS, OAuth consumed once and verifier destroyed, operation reservation and event sequencing across reconnect, unknown schema and uncertain mutation quarantine the owner); `calendar-retention.native.e2e-spec.ts` (3 tests: source expiry redacts archive ledger and graph references, disconnect and restore cannot re-admit content, audit expiry retains safe quarantine and refuses replay). Both files: exit 0, all tests passed. The deterministic half (owner OAuth/connection/setup, 6 files / 55 passed; `persistence/calendar`, 9 files / 46 passed) also passes | P2/P3 | A single-node local replica set is not a multi-member or production topology |
| AC04 | pass | `scripted-model.spec.ts` (7 passed: one malformed-then-valid repair executes the create exactly once; two repairs exhaust with `PROVIDER_ERROR` and zero executed creates); owner `model/calendar-repair*`, `model/strict-json`, `model/calendar-stream` (4 files / 73 passed) | P4/P6 | Fixture model |
| AC05 | pass | `scripted-model.spec.ts` (`attendees` override and unknown tool are policy failures with zero repairs; a non-canonical accepted input creates nothing) | P4/P5/P6 | Fixture model |
| AC06 | pass | `scripted-model.spec.ts` (repair request carries the accepted user input exactly once, no rejected tool message, repair prompt excludes raw malformed JSON; read repair survives checkpoint restart); `assembled-http.spec.ts` (single ordered v1/v2 stream) | P4/P6/P8 | Fixture model and Google transport |
| AC07 | pass | `embedded-mcp.spec.ts` (create returns a receipt whose `googleEventId` equals the saved operation event ID; the Google POST carries `sendUpdates=none`, `conferenceDataVersion=0`, `supportsAttachments=false`); owner `tools-validation.spec.ts` + `calendar-api*` (4 files / 59 passed); owner `test/plugins/google-calendar/tools.spec.ts` (1 file / 20 passed, D1 now closed) | P5/P6 | Fixture Google transport, not a live Google grant |
| AC08 | pass | **Changed from skipped to pass**: the isolated-native same-ID reconnect now runs. `recovery-accounting.native.e2e-spec.ts` (P9-owned: reconnects the same event id and does not double-count a dispatch; exit 0, 1 test passed); `calendar-recovery.native.e2e-spec.ts` (uses only an isolated generated database; 1 test passed); `calendar-accounting.native.e2e-spec.ts` (settlement crash overholds rather than frees unknown spend); `calendar-storage.native.e2e-spec.ts` (operation reservation and event sequencing survive reconnect). The deterministic half also passes (`recovery-limits.spec.ts` 7 passed, `scripted-model.spec.ts` cancellation during correction) | P2/P6/P8 | A single-node local replica set is not a multi-member or production topology |
| AC09 | pass | **Changed from skipped to pass**: the isolated-native dispatch double-count now runs. `calendar-accounting.native.e2e-spec.ts` (dispatch claims and repair counters survive reconnect; Decimal128 and mixed reports do not double count; settlement crash overholds rather than frees unknown spend - 3 tests passed); `recovery-accounting.native.e2e-spec.ts` (reconnects the same event id and does not double-count a dispatch - the stored `calendar-model-dispatch` row count stays 1 and the reserved amount stays `0.25` across a reconnect). The deterministic half also passes (`scripted-model.spec.ts` and `assembled-http.spec.ts` prove every dispatch body carries one non-empty server `user` and no secret) | P2/P4/P6 | A single-node local replica set is not a multi-member or production topology |
| AC10 | pass | **Corrected measurement**: one create spends `logicalTools: 1` with `creates: 1` on its own row (`recovery-limits.spec.ts`, and `test/runtime/calendar-logical-tools.spec.ts` "charges one logical tool call for one create", 1 passed / 4 skipped). The 6-call ceiling is enforced - the sixth logical call is allowed and the **seventh is rejected** with `STORAGE_BUDGET_EXCEEDED` at a measured `logicalTools: 6` (same file, "allows the sixth logical tool call and rejects the seventh"). The 1-create-per-turn limit is enforced - a second create in the same turn is refused with `IDEMPOTENCY_PAYLOAD_MISMATCH` and `creates` stays 1. Delivery retries and readback spend **request** budget, not logical calls: a re-delivered operation measures `logicalTools: 1, creates: 1, calendarRequests: 2`, and a readback reconcile measures `logicalTools: 1, creates: 1` with 1 readback effect and 1 model body. Also `scripted-model.spec.ts` (repair counter stops at 2); `embedded-mcp.spec.ts` (31-day list admitted, 31 days + 1 second rejected before any Google request) | P4/P5/P6 | Fixture model and fixture Google transport; the accounting assertions are deterministic, the native accounting rows are covered by AC09 |
| AC11 | pass | `calendar-node-flows.test.ts` (3 passed, Node environment, `typeof document === 'undefined'` asserted) and the closed Vite browser fixture (4/4 passed, exact text in `staging-evidence.md`) | P7/P8 | The Node suite is not browser evidence; the browser fixture is not a live Google session |
| AC12 | pass | `scripted-model.spec.ts` (repair prompt contains no raw malformed payload); `assembled-http.spec.ts` (hostile origin 403, missing CSRF 403); `calendar-node-flows.test.ts` (safe link only, no `javascript:`); browser fixture check 4 (no secrets in browser storage). **Newly backed by the assembled native path**: `test/integration/recovery.native.e2e-spec.ts` passes 3/3 against the real replica set, including "AC12 recovers a saved result without a second completion POST", which now asserts `calendarConnections.isConfigured() === false` - the assembled deployment carries the Calendar composition while no Google Calendar is connected | P4/P7/P8 | G9 real-data processing/retention admission is still blocked, so real plugin data is not admitted |
| AC13 | pass | `backend npm run build` exit 0; `backend npm run lint` exit 0 with 0 errors; `backend npm test` exit 0 in **both** configurations - without the native URI 192 files (190 passed, 2 skipped) / 1563 tests (1553 passed, 10 skipped) / 0 failed, and with the native URI 192 files passed / 1563 tests (1562 passed, 1 skipped) / 0 failed. `backend npm run test:e2e` exit 0 **with** the replica set: 41 files / 145 tests passed / 0 skipped. `backend npm run test:e2e` exit 0 **without** the prerequisites: 41 files (4 passed, 37 skipped) / 145 tests (22 passed, 123 skipped) / 0 failed - D4 no longer turns an absent prerequisite into a failure. The `operations.md` section 13 aggregate passes: 65 files / 394 tests, exit 0. Frontend `build`, `lint` and `test` all exit 0 | P8 and the failing owners | The single skipped unit test with the native prerequisites present is the operator `AURVIN_VOICE_PILOT_EVIDENCE` artifact, which is not Calendar-related and not a defect |
| AC14 | blocked | this file, [staging-evidence.md](staging-evidence.md), [final_report.md](final_report.md) | P9 | Review skipped; G8 and G9 named and unrun; the bounded live Calendar create/readback/safe-retry proof has no supplied prerequisites |

## Commands

Every row is a separate invocation. `UTC` is the invocation start. All package checks were run
**sequentially** (see the verification-hygiene note below).

### Required package commands

| Directory | Command | UTC | Exit | Counts |
| --- | --- | --- | --- | --- |
| backend | `npm run build` | 2026-10-21T14:13:35Z | 0 | `nest build` succeeded |
| backend | `npm run lint` | 2026-10-21T14:13:48Z | 0 | 0 errors; 395 pre-existing `typescript(unbound-method)`-class warnings (voice-test files); **0 warnings in P9-owned files** |
| backend | `npm test` (no native URI) | 2026-10-21T14:14:04Z | **0** | 192 files: 190 passed, 2 skipped, **0 failed**. 1563 tests: 1553 passed, 10 skipped, **0 failed**. 58.98 s |
| backend | `npm test` (native URI present) | 2026-10-21T14:15:07Z | **0** | 192 files: 192 passed, **0 failed**. 1563 tests: 1562 passed, 1 skipped, **0 failed**. 60.01 s |
| backend | `npm run test:e2e` (**with** the native replica set) | 2026-10-21T14:16:13Z | **0** | 41 files: 41 passed, **0 skipped, 0 failed**. 145 tests: 145 passed, **0 skipped, 0 failed**. 68.38 s |
| backend | `npm run test:e2e` (**with** the native replica set, repeat) | 2026-10-21T14:25:01Z | **0** | 41 files / 145 tests passed. Database inventory identical before and after (see the hygiene table) |
| backend | `npm run test:e2e` (without the native prerequisites) | 2026-10-21T14:17:27Z | **0** | 41 files: 4 passed, 37 skipped, **0 failed**. 145 tests: 22 passed, 123 skipped, **0 failed**. 18.29 s |
| frontend | `npm run build` | 2026-10-21T14:17:52Z | 0 | `tsc -b` + `vite build` succeeded, 85 modules transformed, built in 189 ms |
| frontend | `npm run lint` | 2026-10-21T14:18:02Z | 0 | 0 errors; 41 pre-existing warnings across 20 files (5 of them in the untracked user file `PromptTraveler.tsx`); **0 warnings in the P9 file** |
| frontend | `npm test` | 2026-10-21T14:18:06Z | 0 | 63 files passed, 456 tests passed. 3.23 s |
| backend | `npm run test:azure` | 2026-10-21T14:26:42Z | 1 | 2 files failed, 2 tests failed - **not Calendar evidence**; needs an authorized Azure capability target (`Error: Authorized generated capability target is required.` and `Error: Selected-service facts are required; Azure is not certified.`) |
| backend | `npm run test:behavior` | 2026-10-21T14:26:47Z | 1 | 2 files: 1 failed, 1 passed. 6 tests: 2 failed, 3 passed, 1 skipped - **not Calendar evidence**; needs an authorized live-behaviour target |

### Native (isolated replica-set) commands

| Directory | Command | UTC | Exit | Counts |
| --- | --- | --- | --- | --- |
| backend | `npm run test:e2e -- test/persistence/calendar-accounting.native.e2e-spec.ts test/persistence/calendar-retention.native.e2e-spec.ts test/persistence/calendar-storage.native.e2e-spec.ts test/runtime/calendar-recovery.native.e2e-spec.ts test/integration/plugins/recovery-accounting.native.e2e-spec.ts` | 2026-10-21T14:18:21Z | **0** | 5 files: 5 passed. 13 tests: **13 passed**, 0 skipped, 0 failed. 12.40 s |
| backend | `npm run test:e2e -- test/integration/recovery.native.e2e-spec.ts` (phase-1 AC12 recovery on the real assembled path) | 2026-10-21T14:18:56Z | **0** | 1 file passed. 3 tests passed, 0 failed. 13.05 s |
| backend | `npm run test:e2e -- test/persistence/calendar-storage.native.e2e-spec.ts` | 2026-10-21T14:54:16Z | **0** | 1 file passed, 5 tests passed. Database inventory unchanged (109 / 106 before and after) |
| backend | `npm run test:e2e -- test/integration/recovery.native.e2e-spec.ts` (repeat) | 2026-10-21T14:54:39Z | **0** | 1 file passed, 3 tests passed. Database inventory unchanged (109 / 106 before and after) |

### P9 focused commands

| Directory | Command | UTC | Exit | Counts |
| --- | --- | --- | --- | --- |
| backend | `npm test -- test/plugins/integration/scripted-model.spec.ts` | 2026-10-21T14:19:33Z | 0 | 1 file, 7 tests passed |
| backend | `npm test -- test/plugins/integration/embedded-mcp.spec.ts` | 2026-10-21T14:19:36Z | 0 | 1 file, 3 tests passed |
| backend | `npm test -- test/plugins/integration/recovery-limits.spec.ts` | 2026-10-21T14:19:38Z | 0 | 1 file, 7 tests passed |
| backend | `npm test -- test/plugins/integration/assembled-http.spec.ts` | 2026-10-21T14:19:41Z | 0 | 1 file, 4 tests passed |
| backend | `npm test -- test/runtime/calendar-logical-tools.spec.ts` | 2026-10-21T14:19:46Z | 0 | 1 file, 5 tests passed |
| backend | `npm test -- test/runtime/calendar-operation.spec.ts` | 2026-10-21T14:19:49Z | 0 | 1 file, 3 tests passed |
| backend | `npm test -- test/runtime/calendar-recovery-unavailable.spec.ts` (D6 proof) | 2026-10-21T14:19:19Z | 0 | 1 file, 4 tests passed |
| frontend | `npm test -- src/features/plugins/integration-tests/calendar-node-flows.test.ts` | 2026-10-21T14:23:17Z | 0 | 1 file, 3 tests passed |
| frontend | `npm test -- src/features/chat/integration-tests/welcome-and-safe-render.test.ts src/App.assembly.test.ts` | 2026-10-21T14:23:18Z | 0 | 2 files, 11 tests passed |

### Defect-proof commands

| Directory | Command | UTC | Exit | Counts |
| --- | --- | --- | --- | --- |
| backend | `npm test -- test/plugins/google-calendar/tools.spec.ts` (D1, current clock) | 2026-10-21T14:20:06Z | 0 | 1 file, **20 tests passed** |
| backend | `npm test -- test/plugins/google-calendar/tools.spec.ts` (D1, wall clock shifted +365 days) | 2026-10-21T14:20:12Z | 0 | 1 file, **20 tests passed** - the suite is time independent |
| backend | `npm test -- test/plugins/google-calendar/tools.spec.ts` (D1 A/B control: pre-fix fixture from `5f0354a^`, same current clock) | 2026-10-21T14:29:25Z | 1 | 1 file: **15 failed, 5 passed (20)** - the pre-fix fixture still fails exactly as D1 described. The two files were restored from `HEAD` immediately afterwards and `git status --short -- backend` was empty |
| backend | `npm test -- test/operations/bootstrap.spec.ts` (D2, isolated) | 2026-10-21T14:20:28Z | 0 | 1 file, 8 tests passed, 29.64 s |
| backend | `npm test -- test/runtime/calendar-logical-tools.spec.ts -t "charges one logical tool call for one create"` | 2026-10-21T14:21:26Z | 0 | 1 passed, 4 skipped |
| backend | `npm test -- test/runtime/calendar-logical-tools.spec.ts -t "allows the sixth logical tool call and rejects the seventh"` | 2026-10-21T14:21:29Z | 0 | 1 passed, 4 skipped |
| backend | `npm test -- test/runtime/calendar-logical-tools.spec.ts -t "rejects a second create in the same turn"` | 2026-10-21T14:21:32Z | 0 | 1 passed, 4 skipped |
| backend | `npm test -- test/runtime/calendar-logical-tools.spec.ts -t "spends request budget, not logical tool calls, when the same operation is delivered again"` | 2026-10-21T14:21:35Z | 0 | 1 passed, 4 skipped |
| backend | `npm test -- test/runtime/calendar-logical-tools.spec.ts -t "keeps one logical tool call when a readback reconciles the created event"` | 2026-10-21T14:21:39Z | 0 | 1 passed, 4 skipped |
| backend | `npm test -- src/app.controller.spec.ts test/evaluations/voice/latency-eval.spec.ts test/voice/integration/fault-recovery.spec.ts test/voice/integration/multi-mode.spec.ts` (D4, prerequisites absent) | 2026-10-21T14:29:39Z | 0 | 4 files: 2 passed, 2 skipped. 28 tests: 18 passed, **10 skipped, 0 failed** |
| backend | the same 4 files with the native prerequisites present (D4, prerequisites present) | 2026-10-21T14:32:09Z | 0 | 4 files: 4 passed. 28 tests: 27 passed, **1 skipped**, 0 failed |

### Owner and legacy commands

| Directory | Command | UTC | Exit | Counts |
| --- | --- | --- | --- | --- |
| backend | `npm test -- test/plugins/google-calendar/oauth plugins/google-calendar/connection plugins/google-calendar/setup` | 2026-10-21T14:21:51Z | 0 | 6 files, 55 tests passed |
| backend | `npm test -- plugins/mcp` | 2026-10-21T14:21:53Z | 0 | 3 files, 39 tests passed |
| backend | `npm test -- model/calendar-repair model/calendar-repair-flow model/strict-json model/calendar-stream` | 2026-10-21T14:21:55Z | 0 | 4 files, 73 tests passed |
| backend | `npm test -- runtime/calendar context/calendar` | 2026-10-21T14:21:57Z | 0 | 9 files, 48 tests passed |
| backend | `npm test -- test/assembly/calendar` | 2026-10-21T14:22:02Z | 0 | 5 files, 11 tests passed |
| backend | `npm test -- persistence/calendar` | 2026-10-21T14:22:08Z | 0 | 9 files, 46 tests passed |
| backend | `npm test -- test/http/calendar` | 2026-10-21T14:22:10Z | 0 | 3 files, 6 tests passed |
| backend | `npm test -- test/plugins/google-calendar/tools-validation.spec.ts test/plugins/google-calendar/calendar-api` | 2026-10-21T14:22:12Z | 0 | 4 files, 59 tests passed |
| backend | `npm test -- test/assembly/calendar-flow.spec.ts` | 2026-10-21T14:22:13Z | 0 | 1 file, 2 tests passed |
| backend | `npm test -- test/assembly test/http test/operations runtime/calendar context/calendar plugins/google-calendar plugins/mcp` (`operations.md` section 13) | 2026-10-21T14:22:18Z | 0 | **65 files, 394 tests passed** |
| backend | `npm test -- test/assembly/voice-context.spec.ts test/voice test/assembly/admin-config.spec.ts` | 2026-10-21T14:23:03Z | 0 | 24 files: 22 passed, 2 skipped. 257 tests: 249 passed, 8 skipped |

### Browser fixture

| Directory | Command | UTC | Exit | Counts |
| --- | --- | --- | --- | --- |
| frontend | `npm run dev -- --host 127.0.0.1 --port 5173` (dev server started for the fixture, then stopped) | 2026-10-21T14:26:56Z | - | fixture status `4/4 passed`; exact text in [staging-evidence.md](staging-evidence.md) |

## Defects

D1, D2, D3, D4, D5, D5b/D5c and D6 are all **closed** and re-proved by the commands in this run. No
assertion was weakened to hide a failure, and no owned defect remains open.

### D1 - CLOSED - P5 owner fixture: hard-coded absolute deadline

Fix commit: `5f0354a3a40b51c7840c9ac5315fc1ad7633834d`
("test(calendar): make Calendar tool fixtures time independent").

`backend/test/plugins/google-calendar/tools-fixtures.ts` no longer pins an absolute deadline.
`readBinding()` now uses `deadlineAt: new Date(Date.now() + 10_000).toISOString()` and the default
policy deadline is `Date.now() + POLICY_DEADLINE_AHEAD_MS` (3 hours ahead of the wall clock), so a
retained-source fixture stays live on any date.

Proof that the fix holds:

| Measurement | Result |
| --- | --- |
| `npm test -- test/plugins/google-calendar/tools.spec.ts` at the current clock | 1 file, **20 tests passed**, exit 0 |
| The same command with the process wall clock shifted **+365 days** (31 536 000 000 ms, applied through a temporary `node --require` preload outside the repository) | 1 file, **20 tests passed**, exit 0 - the suite no longer depends on the absolute date |
| A/B control: the pre-fix fixture from `5f0354a^` at the same current clock | 1 file, **15 failed, 5 passed**, exit 1 - the old pinned deadline still fails exactly as D1 described |

The two temporarily checked-out files were restored from `HEAD` immediately afterwards; the backend
working tree was verified clean.

### D2 - CLOSED - P8 owner suite: load-sensitive timeouts

Fix commit: `ebb8dfb8ab7ebaf92d63887855a9e7b7a133d2a1`
("test(operations): make the bootstrap fixture tolerant of loaded machines").

`backend/test/operations/bootstrap.spec.ts` no longer bounds a child at 10 s. It now uses a 60 s child
bound, a 120 s Vitest case timeout and a 600 s build bound, with the reasoning recorded in the file.
The bound still exists and still kills the child and fails the case, so it guards against a child that
never finishes rather than against CPU contention; the child is still killed, the case still fails and
the same counters and diagnostics are still reported.

Proof that the fix holds:

| Measurement | Result |
| --- | --- |
| `npm test -- test/operations/bootstrap.spec.ts` in isolation | 1 file, **8 tests passed**, 29.64 s, exit 0 |
| `npm test` at default parallelism (the file is inside this run) | 192 files / 1563 tests, **0 failed**, exit 0 - in **both** the no-URI and the native-URI configuration |
| `npm run test:e2e` at default parallelism (the file is inside the e2e discovery) | 41 files / 145 tests, **0 failed**, exit 0, with and without the native prerequisites |

### D3 - CLOSED - P6 owner accounting: a create was charged twice against `logicalTools`

Fix commit: `a0bd63ff08553f75d1b90b7d73f3dfa7ca236785`
("fix(calendar-runtime): charge one logical tool call per create").

`backend/src/chat-runtime/calendar-loop.ts` charges the model-requested logical tool call once, and
`backend/src/chat-runtime/calendar-operation.ts` `admitCreate()` now charges only `creates`, with a
guard that rejects an inconsistent budget. The create and the model-requested call are no longer
charged twice against the same counter.

Corrected measurement and proof that the fix holds (`test/runtime/calendar-logical-tools.spec.ts`,
5 tests passed, and `test/runtime/calendar-operation.spec.ts`, 3 tests passed):

| Property | Measured value | Proof |
| --- | --- | --- |
| One create spends one logical tool call | `logicalTools: 1`, `creates: 1` on its own row, `calendarRequests: 1` | "charges one logical tool call for one create" - 1 passed / 4 skipped, exit 0; the same values are asserted in `recovery-limits.spec.ts` before and after a restart |
| The 6-call ceiling is enforced | the **sixth** logical call is allowed; the **seventh** is rejected with `STORAGE_BUDGET_EXCEEDED` and the counter stops at `logicalTools: 6` with 6 executed reads | "allows the sixth logical tool call and rejects the seventh" - 1 passed / 4 skipped, exit 0 |
| One logical event creation per turn | a second create in the same turn is refused with `IDEMPOTENCY_PAYLOAD_MISMATCH`; `creates` stays 1 | "rejects a second create in the same turn" - 1 passed / 4 skipped, exit 0 |
| Delivery retries spend request budget, not logical calls | a re-delivered operation measures `logicalTools: 1, creates: 1, calendarRequests: 2` | "spends request budget, not logical tool calls, when the same operation is delivered again" - 1 passed / 4 skipped, exit 0 |
| Readback reconciliation spends request budget, not logical calls | `logicalTools: 1, creates: 1` with 1 readback effect and 1 model body | "keeps one logical tool call when a readback reconciles the created event" - 1 passed / 4 skipped, exit 0 |

### D4 - CLOSED - Pre-existing native e2e suites failed instead of skipping without the operator prerequisites

Fix commits: `c45c3be6994a803901e5b7c60095adc9e04b0245` (persistence owner),
`a7e0ed3529de52f55a2060c4d2a369d31d7a9859` (http owner) and
`aa7a46d25a520a914b0110dc0bd802e609da8a98` (runtime/voice owner).

Seventeen pre-existing native e2e files called `nativeDatabase()` without a `describe.skipIf` guard.
With the operator prerequisites absent they raised
`Error: Isolated native test configuration is required.` and were reported as **70 product
failures**. Each owner now guards its files with the repository's existing
`describe.skipIf(!configured)` pattern, so the files stay discovered and report as skipped.

Proof that the fix holds:

| Measurement | Result |
| --- | --- |
| `npm run test:e2e` **without** the native prerequisites | exit **0** - 41 files: 4 passed, **37 skipped, 0 failed**; 145 tests: 22 passed, **123 skipped, 0 failed**. The previous 70 failures are gone |
| `npm run test:e2e` **with** the native replica set | exit **0** - 41 files: 41 passed; 145 tests: 145 passed, **0 skipped, 0 failed**. The guarded files now execute instead of skipping |
| The four previously affected files (`src/app.controller.spec.ts`, `test/evaluations/voice/latency-eval.spec.ts`, `test/voice/integration/fault-recovery.spec.ts`, `test/voice/integration/multi-mode.spec.ts`) with the prerequisites absent | exit 0 - 28 tests: 18 passed, **10 skipped, 0 failed** |
| The same four files with the prerequisites present | exit 0 - 28 tests: 27 passed, **1 skipped**, 0 failed. The single remaining skip is the operator `AURVIN_VOICE_PILOT_EVIDENCE` artifact, not a native prerequisite |

This is a test-harness correction, not a product change: no production code was altered to make these
suites pass.

### D5 - CLOSED - The phase-1 native integration harness passed a legacy `AurvinConfig` into `AppService.create(bootstrap: BootstrapConfig)`

Fix commit: `196cdecb0a2b0a45e51c285e1e80ccc7368ef4d0`
("test(integration): repair the native assembled harness for the bootstrap config").

`backend/test/integration/assembled-harness.ts` and the four native integration specs built the
assembled application with `loadConfig({...})` and injected a legacy `AurvinConfig`, while
`AppService.create` takes a `BootstrapConfig`. Every one of the 11 assembled native suites therefore
died with `CONFIGURATION_ERROR` as soon as the native prerequisites were present. The harness now
uses `loadBootstrapConfig({...})` with `AURVIN_CONFIG_ENCRYPTION_KEY`, matching the committed
bootstrap contract. The defect was pre-existing since the baseline `989d6b1` and was invisible
because D4 had been masking it with a prerequisite error.

Proof that the fix holds:

| Measurement | Result |
| --- | --- |
| `npm run test:e2e -- test/integration/recovery.native.e2e-spec.ts` | exit **0** - 1 file passed, **3 tests passed**, 0 failed. These are the phase-1 AC12 suites: "AC12 recovers a saved result without a second completion POST", "AC12 interrupts a no-result turn and retries once", "AC12 refuses a second executor and unverified handoff" |
| `npm run test:e2e` with the native replica set (all 41 files) | exit **0** - 41 files passed, 145 tests passed, 0 failed. No `CONFIGURATION_ERROR` remains |

### D5b/D5c - CLOSED - Native suites without explicit timeouts, stale voice integration contracts, a shared Calendar budget fixture pinned to a past instant

Fix commits: `fe1c1d7ff5bd68eaca4ba2660f699f0d8e037eff` (explicit native timeouts),
`759266dd35389444a568d9e6ca0c6e34b35776fe` (voice contracts) and
`c1b65b05538c8c068ebeafedd8ec430b9ffadbe0` (shared Calendar budget fixture).

Three latent defects surfaced as soon as the native gate actually ran:

- The Calendar native suites inherited Vitest's default per-test timeout and had to be bounded
  explicitly (30 s / 60 s), so a slow native operation fails as a test timeout instead of hanging the
  suite.
- The voice integration specs predated the committed `SubmitLiveTurn.configSnapshot` contract
  (`115418c`) and the visible-live-message projection (`5b2d0af`), so live acceptance failed closed
  with `NOT_READY 'Voice configuration is unavailable.'`; they now supply the frozen snapshot the
  production voice path passes and assert the committed projection. The voice bridge waits also got
  the repository's explicit 5 s bound so the suite is stable inside the 41-file parallel run.
- The shared Calendar budget fixture pinned `createdAt`/`deadlineAt` to fixed instants, so the
  accounting store's wall-clock comparison against the turn deadline failed on any later date. The
  fixture now anchors the turn window to the current time.

Proof that the fix holds:

| Measurement | Result |
| --- | --- |
| `npm run test:e2e -- <the 5 Calendar native files>` | exit **0** - 5 files passed, **13 tests passed**, 0 skipped, 0 failed (12.40 s) |
| `npm run test:e2e` with the native replica set | exit **0** - 41 files / 145 tests passed, 0 failed. The voice native suites now execute and pass instead of failing closed |
| `npm test -- persistence/calendar` (the shared fixture's in-memory consumers, including the new "the shared turn window stays live against the real clock" assertion) | exit 0 - 9 files / 46 tests passed |

### D6 - CLOSED - A real production defect: text-chat recovery failed whenever no Google Calendar was connected

Fix commit: `86cd063eeb2144e5893654beaa5d869530505631`
("fix(chat-runtime): keep text chat recovery healthy without a Calendar connection").

`DurableChatRuntime.reconcileSession` guarded Calendar reconciliation only on **dependency presence**
(`if (this.d.calendar)`), so chat **recovery** always called `currentBinding()` and threw
`CALENDAR_EXECUTION_DENIED` when no Google Calendar was connected. In an assembled deployment the
Calendar composition is always present, so a text-only deployment failed ordinary chat recovery. The
phase-1 native harness had been working around this, which is why the defect survived.

The fix reconciles only when a pending Calendar operation exists, derives the reconciliation binding
from the **operation's own** dispatch binding rather than the live connection, and treats an
uncompletable readback as an **unknown** external outcome that never fails the surrounding text
recovery.

Proof that the fix holds:

| Measurement | Result |
| --- | --- |
| `npm test -- test/runtime/calendar-recovery-unavailable.spec.ts` (new P9-owned D6 proof) | exit **0** - 1 file, **4 tests passed**: an ordinary text turn recovers with the plugin not connected; a pending operation stays `unknown` with no receipt when the connection is gone; the same when the Calendar policy is unavailable; and a pending operation is not accepted through a replaced connection |
| `npm run test:e2e -- test/integration/recovery.native.e2e-spec.ts` (phase-1 AC12 recovery, **real assembled path**) | exit **0** - 1 file, **3 tests passed**. The suite now asserts `calendarConnections.isConfigured() === false` and then recovers the saved result without a second completion POST. The phase-1 harness workaround was undone, so the suite exercises the real assembled path |
| `npm run test:e2e` with the native replica set | exit **0** - 41 files / 145 tests passed, 0 failed |

### Follow-up - stale bootstrap-bound references in other workflows (documentation only, not fixed here)

Two documents owned by **other** workflows still describe the old 10-second bootstrap fixture bound
that D2 removed. They are outside this workflow's ownership and were deliberately **not** edited:

| Document | Location | Stale reference |
| --- | --- | --- |
| `docs/backend-startup-fix/plan1.md` | around lines 270-272 | `const error = new Error('Bootstrap fixture exceeded its 10-second bound.'); ... }, 10_000);` |
| `docs/backend-startup-fix/plan1.md` | around line 340 | "The process-fixture tests use `15_000` so the fixture's own 10-second timeout, not Vitest's default 5-second timeout, owns cleanup." |
| `docs/mongodb-usage-accounting/implementation-report.md` | around line 218 | the intermittent-bootstrap investigation records "missing-counter/10-second-bound failures" and the "10-second deadline" |

Action owner: the `backend-startup-fix` and `mongodb-usage-accounting` workflow owners. P9 records the
stale references so they are not lost; no implementation, test or documentation outside the three
P9-owned evidence files was changed.

## Skips and blocks

| Item | State | Reason |
| --- | --- | --- |
| G8 live Calendar create / readback / safe retry | **blocked / live acceptance unrun** | No Google project/consent configuration, no operator grant, no disposable owned calendar, no exact permitted event data or cleanup authority, no approved external-data policy, no tool-capable configured model, and no bounded authorized spend limit. `operations.md` records G8 and G9 as pending gates. |
| G9 real-data processing / retention admission | **blocked** | `operations.md` section 11 lists the required Google terms, observed retention headers and approved provider routing/retention policy as still to be documented, and keeps `P8-GATE-P2-RETENTION` and `P8-GATE-P2-INVALIDATION` open. A configured policy id is not that evidence. |
| Live Google Calendar / paid OpenRouter | **not run** | No live mutation, no paid inference, no provisioning and no deployment were performed by this plan. |
| Azure certification | **not certified** | `npm run test:azure` exits 1 for want of an authorized generated capability target; `npm run test:behavior` exits 1 for want of an authorized live-behaviour target. Neither is Calendar evidence. |
| Unit-suite skip with the native prerequisites present (1 test) | skipped, prerequisite-gated | `test/evaluations/voice/latency-eval.spec.ts` needs the operator `AURVIN_VOICE_PILOT_EVIDENCE` artifact. Pre-existing, not Calendar-related, not a defect. |
| Unit-suite skips with the native prerequisites absent (10 tests) | skipped, prerequisite-gated | The same voice artifact test plus `src/app.controller.spec.ts` (1), `test/voice/integration/fault-recovery.spec.ts` (4) and `test/voice/integration/multi-mode.spec.ts` (4), which need a configured native database. Pre-existing, not Calendar-related, not defects. |
| Native topology | **executed, single node** | A one-member replica set on loopback. It satisfies the native admission requirement of a replica set, and is **not** a multi-member or production topology. Azure/multi-instance admission and public deployment remain out of scope. |
| Unified code review | **skipped** | Selected by the user with `--skip review`. Not passed, not a verdict. No reviewer and no review-triggered fixer was dispatched. |

## Evidence classes

Kept distinct on purpose. A result in one class is never reported as a result in another.

- **Executed isolated native MongoDB** (this repository, a real single-node replica set on loopback, no
  external service): the full `backend npm run test:e2e` suite (41 files / 145 tests, exit 0), the
  5 Calendar native e2e files (13 tests), the phase-1 assembled native harness
  (`test/integration/recovery.native.e2e-spec.ts`, 3 tests), and the native-gated unit suites. The
  harness generated and dropped its own `aurvin_p2_test_<uuid>` databases; the database inventory was
  identical before and after the run and no application database was touched.
  **Caveat: a single-node replica set satisfies native admission but is not a multi-member or
  production topology.**
- **Deterministic / in-memory fixture** (this repository, no service): `scripted-model.spec.ts`,
  `embedded-mcp.spec.ts`, `recovery-limits.spec.ts`, `assembled-http.spec.ts`,
  `calendar-recovery-unavailable.spec.ts`, `calendar-node-flows.test.ts`, plus the owner suites
  `test/runtime/calendar-logical-tools.spec.ts` and `test/runtime/calendar-operation.spec.ts`.
- **Browser fixture** (local closed Vite fixture, no live Google session): recorded in
  [staging-evidence.md](staging-evidence.md).
- **Committed owner suites** re-run in this matrix: MCP, repair/strict-JSON/stream, OAuth,
  connection, setup, runtime/context, persistence, assembly, HTTP, voice, admin-config.
- **Live Google Calendar / paid OpenRouter**: **not run, blocked** on G8 and G9.

## Verification hygiene

- **Run the package checks sequentially.** A concurrent `nest build` rewrites `backend/dist/` while
  the Vitest run is in flight, and the child process spawned by
  `backend/test/operations/bootstrap.spec.ts` then fails with a module-load error rather than a real
  assertion failure. Every row in the command tables above was produced by a separate, sequential
  invocation for this reason.
- Do not print the native URI or any credential. The URI value is never recorded in this repository.
- The native fixture must only ever point at an isolated generated database under the
  `aurvin_p2_test_` prefix; never at an application or production database.
- A clean `git status --short -- backend` (and a named-path `git add`, never `git add .`) is required
  after any temporary working-tree manipulation, as with the D1 A/B control above.
