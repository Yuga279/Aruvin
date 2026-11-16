# Google Calendar plugin final report

## Disposition

Workflow completion: **not complete - blocked on operator input**. Unified review: **skipped, not
passed**. The orchestrator accepts or retains this gate; this report does not mark the workflow
complete.

Every defect found during verification is now closed and re-proved, and the **isolated-native gate
has been executed**: the native suites ran against a real single-node MongoDB replica set and the
whole backend e2e suite is green with them. That clears the technical blockers. It does **not**
clear the workflow: the approved goal additionally requires a bounded live Calendar
create/readback/safe-retry proof and a real-data processing admission, and **no** Google OAuth client,
operator grant, disposable owned calendar, processing approval or spend authorization was supplied.
The workflow therefore stays blocked on the named gates below, and the tested subset is recorded
exactly as measured.

Measured on 2026-10-21 (14:13:35Z-14:29:47Z; browser fixture 14:27Z-14:28Z) on
`codex/google-calendar-plugin` at tip `f3db04f25d3e5deb90e64c9a8d6e11d9dda2b3d2`, Node `v24.18.0`,
npm `12.0.1`, Vitest `4.1.11`, Windows 11 Pro 10.0.26200 (AMD Ryzen 7 9700X, 16 logical
processors). Full command evidence, AC matrix, commit hashes and defects are in
[verification.md](verification.md); browser, native and gate evidence are in
[staging-evidence.md](staging-evidence.md).

## Tested subset

**22 October follow-up:** D7 (missing production Calendar capability evidence) is closed in `3b198c9` and `e45e8b6`. The orchestrator independently verified 19 new model/assembly regression tests and the full backend suite (1572 passed, 10 skipped), plus build/lint exit 0. The existing native/browser figures below are historical 21 October evidence, not reruns at this tip. The user selected the standard OAuth web-client/Connect-button path; the live Google/provider gate remains unrun pending setup and exact action/spend authorization.

Exited 0 with the cited test discovered:

| Check | Result |
| --- | --- |
| `backend npm run build` | exit 0 |
| `backend npm run lint` | exit 0, 0 errors, 0 warnings in P9-owned files (395 pre-existing warnings elsewhere) |
| `backend npm test` (no native URI) | **exit 0, 192 files / 1563 tests, 0 failed** (190 files / 1553 tests passed, 2 files / 10 tests skipped) |
| `backend npm test` (native URI present) | **exit 0, 192 files passed, 1563 tests, 0 failed** (1562 passed, 1 skipped) |
| `backend npm run test:e2e` **with** the native replica set | **exit 0, 41 files / 145 tests passed, 0 skipped** |
| `backend npm run test:e2e` **without** the native prerequisites | **exit 0, 41 files (4 passed, 37 skipped), 145 tests (22 passed, 123 skipped), 0 failed** |
| `frontend npm run build` | exit 0 (`tsc -b` + `vite build`, 85 modules) |
| `frontend npm run lint` | exit 0, 0 errors, 0 warnings in the P9 file (41 pre-existing warnings, 5 in the untracked user file) |
| `frontend npm test` | exit 0, 63 files / 456 tests passed |
| `backend npm test -- test/plugins/integration/scripted-model.spec.ts` | exit 0, 7 passed |
| `backend npm test -- test/plugins/integration/embedded-mcp.spec.ts` | exit 0, 3 passed |
| `backend npm test -- test/plugins/integration/recovery-limits.spec.ts` | exit 0, 7 passed |
| `backend npm test -- test/plugins/integration/assembled-http.spec.ts` | exit 0, 4 passed |
| `backend npm test -- test/runtime/calendar-logical-tools.spec.ts` | exit 0, 5 passed (D3 proof) |
| `backend npm test -- test/runtime/calendar-operation.spec.ts` | exit 0, 3 passed (D3 owner assertion) |
| `backend npm test -- test/runtime/calendar-recovery-unavailable.spec.ts` | exit 0, 4 passed (D6 proof) |
| `frontend npm test -- src/features/plugins/integration-tests/calendar-node-flows.test.ts` | exit 0, 3 passed |
| `backend npm test -- test/plugins/google-calendar/tools.spec.ts` | exit 0, 20 passed (D1, current clock) |
| `backend npm test -- test/plugins/google-calendar/tools.spec.ts` (wall clock shifted +365 days) | exit 0, 20 passed (D1 time independence) |
| `backend npm test -- test/plugins/google-calendar/tools.spec.ts` (pre-fix fixture, same clock) | exit 1, 15 failed / 5 passed (D1 A/B control) |
| `backend npm test -- test/operations/bootstrap.spec.ts` (isolated) | exit 0, 8 passed, 29.64 s (D2) |
| `backend npm test -- plugins/mcp` | exit 0, 3 files / 39 passed |
| `backend npm test -- model/calendar-repair model/calendar-repair-flow model/strict-json model/calendar-stream` | exit 0, 4 files / 73 passed |
| `backend npm test -- test/plugins/google-calendar/oauth plugins/google-calendar/connection plugins/google-calendar/setup` | exit 0, 6 files / 55 passed |
| `backend npm test -- runtime/calendar context/calendar` | exit 0, 9 files / 48 passed |
| `backend npm test -- test/assembly/calendar` | exit 0, 5 files / 11 passed |
| `backend npm test -- test/assembly/calendar-flow.spec.ts` | exit 0, 2 passed |
| `backend npm test -- persistence/calendar` | exit 0, 9 files / 46 passed |
| `backend npm test -- test/http/calendar` | exit 0, 3 files / 6 passed |
| `backend npm test -- test/plugins/google-calendar/tools-validation.spec.ts test/plugins/google-calendar/calendar-api` | exit 0, 4 files / 59 passed |
| `backend npm test -- test/assembly/voice-context.spec.ts test/voice test/assembly/admin-config.spec.ts` | exit 0, 24 files (22 passed, 2 skipped), 257 tests (249 passed, 8 skipped) |
| `backend npm test -- test/assembly test/http test/operations runtime/calendar context/calendar plugins/google-calendar plugins/mcp` (`operations.md` §13) | **exit 0, 65 files / 394 tests passed** |
| `backend npm run test:e2e -- <the 5 Calendar native e2e files>` | **exit 0, 5 files / 13 tests passed**, 0 skipped |
| `backend npm run test:e2e -- test/integration/recovery.native.e2e-spec.ts` (phase-1 AC12, real assembled path) | **exit 0, 1 file / 3 tests passed** |
| `frontend npm test -- src/features/chat/integration-tests/welcome-and-safe-render.test.ts src/App.assembly.test.ts` | exit 0, 2 files / 11 passed |
| Closed Vite browser fixture | 4/4 passed, exact text recorded in `staging-evidence.md` |

The 10 skipped backend unit tests **without** the native prerequisites are prerequisite guards, not
Calendar evidence: `src/app.controller.spec.ts` (1), `test/evaluations/voice/latency-eval.spec.ts`
(1, needs the operator `AURVIN_VOICE_PILOT_EVIDENCE` artifact),
`test/voice/integration/fault-recovery.spec.ts` (4) and
`test/voice/integration/multi-mode.spec.ts` (4), the latter two being the fully-skipped files. With
the native prerequisites present only **1** skip remains, the operator
`AURVIN_VOICE_PILOT_EVIDENCE` artifact. Neither is Calendar-related and neither is a defect.

Exited non-zero:

| Check | Result | Cause |
| --- | --- | --- |
| `backend npm run test:azure` | exit 1 - 2 files / 2 tests failed | Not Calendar evidence. Needs an authorized Azure capability target (`Authorized generated capability target is required.` / `Azure is not certified.`). |
| `backend npm run test:behavior` | exit 1 - 2 files (1 failed, 1 passed); 6 tests (2 failed, 3 passed, 1 skipped) | Not Calendar evidence. Needs an authorized live-behaviour target. |
| `backend npm test -- test/plugins/google-calendar/tools.spec.ts` with the pre-fix fixture | exit 1 - 15 failed / 5 passed | Deliberate D1 A/B control against the pre-correction fixture; the tree was restored from `HEAD` immediately afterwards and verified clean. |

Evidence classes, kept distinct:

- **Executed isolated native MongoDB** (a real single-node replica set on loopback, no external
  service): the full backend e2e suite (41 files / 145 tests), the 5 Calendar native e2e files
  (13 tests) and the phase-1 assembled native harness (3 tests). The harness generated and dropped
  its own `aurvin_p2_test_<uuid>` databases - the inventory before and after the run is identical -
  and no application database was touched. **Caveat: a single-node replica set satisfies native
  admission but is not a multi-member or production topology.**
- **In-memory fixture** (no service): the P9 backend and frontend suites
  (`scripted-model.spec.ts`, `embedded-mcp.spec.ts`, `recovery-limits.spec.ts`,
  `assembled-http.spec.ts`, `calendar-recovery-unavailable.spec.ts`, `calendar-node-flows.test.ts`)
  plus the owner suites `test/runtime/calendar-logical-tools.spec.ts` and
  `test/runtime/calendar-operation.spec.ts`. 29 P9-owned tests executed and all passing, plus 8
  owner accounting tests. This proves the repair contract, the real embedded MCP handler, the
  deterministic Calendar bounds, the in-memory crash windows, the assembled HTTP boundary, the
  recovery-without-a-Calendar-connection behaviour, the Node UI markup and the corrected
  logical-tool accounting. It is **not** native durability and **not** a Google grant.
- **Committed owner suites re-run**: MCP, repair, strict-JSON, stream, OAuth, connection, setup,
  runtime, context, persistence, assembly, HTTP, voice, admin-config, frontend legacy.
- **Browser**: the closed Vite fixture, 4/4, a local fixture session and not a live Google session.
- **Live Google Calendar / paid OpenRouter**: **not run**, blocked.

## Acceptance criteria

| ID | Result | Note |
| --- | --- | --- |
| AC01 | pass | Local boundary, identity and default-off enforced; member accounts/RBAC deferred by design |
| AC02 | pass | Real embedded MCP handler, three curated tools; fixture transport only |
| AC03 | pass | Deterministic half passed; the isolated-native half now ran against the real replica set (storage 5 + retention 3 tests passed) |
| AC04 | pass | Malformed-then-valid repair executes once; exhaustion executes zero rejected calls |
| AC05 | pass | Policy denial, unknown tools and intent separation distinguished from schema repair |
| AC06 | pass | Ordered call/result groups, no duplicate user input, single ordered stream |
| AC07 | pass | Timed creation validates, forbids unsupported features, returns a verified receipt |
| AC08 | pass | Deterministic crash-window half passed; the isolated-native same-ID reconnect now ran and passed |
| AC09 | pass | Deterministic attribution half passed; the isolated-native double-count half now ran and passed |
| AC10 | pass | Corrected accounting: 1 logical call per create, 6-call ceiling enforced (7th rejected), 1 create per turn, retries/readback spend request budget |
| AC11 | pass | Node UI flows plus the closed browser fixture; not a live Google session |
| AC12 | pass | Injection, hostile origin, safe link, redaction and storage covered, now also on the real assembled native path; G9 still blocks real data |
| AC13 | pass | `backend npm test` exits 0 with 0 failed in both configurations and `npm run test:e2e` exits 0 with **and** without the native prerequisites |
| AC14 | blocked | Final evidence recorded; review skipped; G8 and G9 named and unrun |

AC03, AC08 and AC09 moved from **skipped** to **pass**: their isolated-native halves were no longer
discovered skips but ran against the real replica set and every cited test passed. AC12 is **pass**
for the technical injection/origin/link/redaction/storage/telemetry coverage and is now additionally
backed by the phase-1 assembled native recovery suite, which asserts that the assembled deployment
carries the Calendar composition while no Google Calendar is connected and still recovers the saved
result. AC13 is **pass** because the two required backend commands that previously failed it are both
green: `backend npm test` exits 0 with 0 failed, and `backend npm run test:e2e` now exits 0 in **both**
configurations - 41 files / 145 tests passed with the replica set, and 41 files with 37 discovered
skips and 0 failures without it. AC14 stays **blocked** because the bounded live Calendar
create/readback/safe-retry proof still has no supplied prerequisites.

## Named gates

- `P9-GATE-P8-WORKER`: **passed before tests started**. `operations.md` at
  `286490dcfeb428e2a1f6d546ef61ec205fc2ff95` and
  `backend/test/assembly/calendar-fixture.ts` at
  `ec5f39e76ce86ea8b2678708079f8d74b0cccb35` were both committed before the first P9 file was
  written. Node `v24.18.0` satisfies the repository engine range, so `P9-GATE-NODE` did not fire.
- `P9-GATE-NODE`: **passed** (Node `v24.18.0`).
- **Isolated native MongoDB**: **executed and passing**. The native suites ran against a real
  single-node replica set (`aurvinNative`, PRIMARY, one member, loopback, temporary dbpath). Full
  `backend npm run test:e2e`: exit 0, 41 files / 145 tests passed, 0 skipped. The 5 Calendar native
  e2e files: 13 tests passed. The phase-1 assembled native harness: 3 tests passed. The harness
  generated and dropped its own `aurvin_p2_test_<uuid>` databases; the inventory before and after
  was identical and no application database was touched. **Caveat: a single-node replica set
  satisfies native admission but is not a multi-member or production topology; Azure
  certification, multi-instance admission and public deployment stay out of scope.**
- G8 live Calendar create/readback/safe-retry: **blocked / live acceptance unrun**. The exact
  missing operator inputs are: a Google project/consent configuration with the exact registered
  redirect and scopes; the operator's own Google grant; a disposable owned calendar id confirmed as
  the authorized target; the exact permitted event data and cleanup authority; a tool-capable
  configured model with an approved external-data policy; and a bounded authorized spend limit.
- G9 real-data processing admission: **blocked**. `P8-GATE-P2-RETENTION` and
  `P8-GATE-P2-INVALIDATION` remain open, and `operations.md` section 11 still requires the Google
  terms, the observed response headers and the approved provider routing/retention policy to be
  documented. A configured policy id is not that evidence.
- Azure/behavior suites: **not Calendar evidence**; run and recorded as failing for missing
  authorization.
- Review: **skipped, never passed**. No reviewer and no review-triggered fixer was dispatched.

## Defects

| ID | Owner | Status | Fix commit | Corrected measurement / proof |
| --- | --- | --- | --- | --- |
| D1 | P5 | **closed** | `5f0354a3a40b51c7840c9ac5315fc1ad7633834d` | `tools-fixtures.ts` now derives the deadline and policy deadline from the wall clock instead of pinning `2026-10-21T09:00:10.000Z`. `tools.spec.ts` passes 20/20 at the current clock **and** 20/20 with the wall clock shifted +365 days. The pre-fix fixture at the same clock still fails 15/20 (A/B control). |
| D2 | P8 | **closed** | `ebb8dfb8ab7ebaf92d63887855a9e7b7a133d2a1` | `bootstrap.spec.ts` no longer bounds a child at 10 s (now 60 s child, 120 s case, 600 s build, still kills and still fails the child). It passes 8/8 in isolation (29.64 s) **and** inside the full default-parallelism `npm test` (0 failed in both the no-URI and the native-URI configuration) **and** inside the 41-file `npm run test:e2e` (0 failed in both configurations). |
| D3 | P6 | **closed** | `a0bd63ff08553f75d1b90b7d73f3dfa7ca236785` | One create now measures `logicalTools: 1` with `creates: 1` on its own row (was 2). The 6-call ceiling is enforced - the 6th call is allowed and the 7th is rejected with `STORAGE_BUDGET_EXCEEDED` at `logicalTools: 6`. A second create in the same turn is refused with `IDEMPOTENCY_PAYLOAD_MISMATCH` and `creates` stays 1. Delivery retries measure `logicalTools: 1, creates: 1, calendarRequests: 2` and a readback reconcile measures `logicalTools: 1, creates: 1` - request budget, not logical calls. |
| D4 | owner of each pre-existing native e2e file | **closed** | `c45c3be6994a803901e5b7c60095adc9e04b0245`, `a7e0ed3529de52f55a2060c4d2a369d31d7a9859`, `aa7a46d25a520a914b0110dc0bd802e609da8a98` | 17 pre-existing native suites called `nativeDatabase()` without a `describe.skipIf` guard and failed with `Error: Isolated native test configuration is required.` (70 tests) when the operator URI/prefix were absent. Each owner now guards its files: `npm run test:e2e` **without** the prerequisites is exit 0 with 37 discovered skips and **0 failures**, and **with** the prerequisites it is exit 0 with 41 files / 145 tests passed and 0 skipped. |
| D5 | phase-1 harness owner | **closed** | `196cdecb0a2b0a45e51c285e1e80ccc7368ef4d0` | The phase-1 native integration harness passed a legacy `AurvinConfig` into `AppService.create(bootstrap: BootstrapConfig)`, so all 11 assembled native suites died with `CONFIGURATION_ERROR` (pre-existing since the baseline `989d6b1`, previously masked by D4). The harness now uses `loadBootstrapConfig` with `AURVIN_CONFIG_ENCRYPTION_KEY`. `npm run test:e2e -- test/integration/recovery.native.e2e-spec.ts` exits 0 with 3 tests passed and no `CONFIGURATION_ERROR` anywhere in the native output. |
| D5b/D5c | native-suite owners | **closed** | `fe1c1d7ff5bd68eaca4ba2660f699f0d8e037eff`, `759266dd35389444a568d9e6ca0c6e34b35776fe`, `c1b65b05538c8c068ebeafedd8ec430b9ffadbe0` | The Calendar native suites had no explicit per-test timeouts (now 30 s / 60 s); the voice integration specs predated the committed `SubmitLiveTurn.configSnapshot` contract and the visible-live-message projection and failed closed with `NOT_READY 'Voice configuration is unavailable.'` (now supplied and asserted); and the shared Calendar budget fixture pinned a past instant, which the accounting store's wall-clock comparison rejected (now anchored to the current time). Proof: the 5 Calendar native files pass 13/13 in 12.40 s and the whole 41-file native e2e suite passes 145/145. |
| D6 | P9 (real production defect) | **closed** | `86cd063eeb2144e5893654beaa5d869530505631` | `DurableChatRuntime.reconcileSession` guarded Calendar reconciliation only on dependency presence, so chat recovery always called `currentBinding()` and threw `CALENDAR_EXECUTION_DENIED` when no Google Calendar was connected - a text-only deployment failed ordinary chat recovery. The fix reconciles only for a pending operation, derives the binding from the operation's own dispatch binding, and treats an uncompletable readback as an unknown external outcome. Proof: the new `test/runtime/calendar-recovery-unavailable.spec.ts` passes 4/4, and the phase-1 native AC12 recovery suite (real assembled path, no workaround) passes 3/3 while asserting `calendarConnections.isConfigured() === false`. |

No P9-owned defect is open: all 29 P9-owned executed tests pass, the P9 native file passes against the
real replica set, and the P9 files are lint-clean.

## Documentation follow-up (other workflows; not fixed here)

| Document | Location | Stale reference | Action |
| --- | --- | --- | --- |
| `docs/backend-startup-fix/plan1.md` | around lines 270-272 | `new Error('Bootstrap fixture exceeded its 10-second bound.')` and `}, 10_000);` | Owner of the `backend-startup-fix` workflow should reconcile with the D2 correction (`ebb8dfb`) |
| `docs/backend-startup-fix/plan1.md` | around line 340 | "The process-fixture tests use `15_000` so the fixture's own 10-second timeout ... owns cleanup" | Same owner |
| `docs/mongodb-usage-accounting/implementation-report.md` | around line 218 | the intermittent-bootstrap investigation records "missing-counter/10-second-bound failures" and the "10-second deadline" | Owner of the `mongodb-usage-accounting` workflow should reconcile with the D2 correction |

These documents are outside this workflow's ownership. P9 records them as a named stale-reference
follow-up so they are not lost, and changed nothing in them.

## Limitations

- Local single-user proof. No member isolation, sign-in or RBAC; explicitly deferred by the goal.
- No Azure certification, no multi-instance admission, no public MCP route and no public access.
- Cancellation is not a billing guarantee, and a dispatched Google write can still succeed.
- A fixture grant is not a Google connection; a fixture Google transport is not a live Google API.
- The browser fixture is a local closed fixture, not a live Google session and not a Node Vitest
  result.
- The native evidence was produced on a **single-node** replica set. It satisfies the native
  admission requirement of a replica set, but it is **not** a multi-member and **not** a production
  topology; no failover, no multi-instance admission and no Azure certification is claimed.
- The assembled application builds its own Calendar execution port, so at the HTTP level the
  durable "one create" evidence is the single Google write on the shared fixture fetcher, not the
  in-memory runtime fixture's effect log.
- A concurrent, unrelated frontend working-tree change (chat transcript, styles and a new
  `PromptTraveler` component) was present while the frontend matrix ran. It was not owned by P9,
  was never staged and was not reverted; the frontend build/lint/test results include it, including
  5 of the 41 frontend lint warnings.
- The native instance is a temporary local database with a temporary dbpath. 106 `aurvin_p2_test_*`
  databases from earlier, interrupted runs remain on it; they predate this measurement window, are
  confined to the `aurvin_p2_test_` prefix, and this run created and dropped its own.
- Review remains **skipped** throughout. No reviewer or review-triggered fixer was dispatched.
- Package checks were run **sequentially** on purpose: a concurrent `nest build` rewrites
  `backend/dist/` and makes the child spawned by `backend/test/operations/bootstrap.spec.ts` fail
  with a module-load error rather than a real assertion failure.
