# Plugin skill scalability — verification evidence

## Scope and tested revisions

P3 owns tests, fixtures, and this evidence only. No production application, package manifest,
frontend, `state.md`, or `final_report.md` file was changed by P3. `git diff --stat 86e717f..HEAD --
backend/src backend/package.json backend/package-lock.json frontend` is empty; the only changed
paths are under `backend/test/` plus this document.

| Item | Value |
| --- | --- |
| Branch | `codex/plugin-skill-scalability-v1` |
| Base application | `118ba21` (with `04485ad`) |
| Research baseline | `86dd3974d5e000ab05f4d2285879a723fcd3f69f` |
| P1 worker | `d2699f4`..`7fb2b4d` |
| P2 worker | `76b1a45`..`dde096f` |
| P3 worker (this evidence) | `ff05576`, `43f0113`, `5deaf1d`, `d1173e4`, `1c6b99e`, `81f5115`, `59fdbec`, `269b9ae`, `72e76ef`, `14f1885`, `a47d1b7` (evidence; later documentation-only follow-ups recorded in the worker report) |
| HEAD during evidence capture | `14f188535f18c80cf1b1da3285cb9dff266d7b8b` |
| Working tree | clean before the evidence commit |

Code review is **SKIPPED** (`--skip review`), never passed. No reviewer or review-triggered fixer was
dispatched.

## Environment and prerequisite admission

| Item | Value |
| --- | --- |
| OS | Windows (`win32`) |
| Node | `v24.18.0` |
| npm | `12.0.1` |
| Test runner | Vitest `4.1.11` (`npm test` -> `vitest run`) |
| Working directory for npm | `backend` |
| `npm run build` | exit 0 (`nest build`); run before the emitted-`dist` suite |
| `AURVIN_TEST_MONGODB_URI` | absent |
| `AURVIN_TEST_DB_PREFIX` | absent (not `aurvin_p2_test_`) |
| Live OpenRouter / Google / Azure calls | none |

Native MongoDB suites therefore **skipped**; a skip is not a pass. Deterministic scripted provider
responses and fake BSON storage stand in for external services. The assembled checks exercise the
real `AppService`, runtime, serializer, streaming adapter, repositories, and Calendar executor, but
they are not native-database, Azure, Google, or OpenRouter certification.

Local logs (not committed): `C:/Users/Peter/AppData/Local/Temp/opencode/p3-*.log`.

## Executed commands and pass/fail/skip counts

All commands ran in `backend` unless stated. Counts are the runner's final summary, not inferred
from file presence.

| Command | Files | Tests | Result |
| --- | --- | --- | --- |
| `npm run build` | - | - | exit 0 |
| `npm run lint` | 612 files | 0 errors, 585 warnings (type-aware lint) | exit 0 |
| `npm test -- test/assembly/skill-workflow.spec.ts test/assembly/skill-history.spec.ts test/performance/skill-evidence.spec.ts test/performance/skill-scale.spec.ts test/performance/skill-latency.spec.ts` | 5 passed | 15 passed, 0 failed, 0 skipped | exit 0 |
| `npm test -- test/assembly/ test/integration/plugins/multi-calendar/ test/benchmark/ test/voice/ test/performance/calendar-critical-path.spec.ts test/performance/durable-latency.spec.ts` (before consumer migration) | 41 passed / 13 failed / 2 skipped | 502 passed / 58 failed / 8 skipped | exit 1 |
| same consumer command (after consumer migration) | 52 passed / 2 failed / 2 skipped | 540 passed / 20 failed / 8 skipped | exit 1 |
| `npm test -- test/performance/skill-latency.spec.ts test/performance/confirmed-state-cache.spec.ts test/performance/admission-context-reuse.spec.ts test/benchmark/latency.spec.ts` | 3 passed / 1 failed | 41 passed / 3 failed / 0 skipped | exit 1 |
| `npm test -- test/contracts/skill-protocol.spec.ts test/model/ test/context/ test/runtime/ test/persistence/ test/plugins/ test/assembly/ test/integration/plugins/multi-calendar/ test/performance/confirmed-state-cache.spec.ts test/benchmark/ test/voice/ test/http/voice-exclusion.spec.ts` | 183 passed / 3 failed / 2 skipped | 1872 passed / 5 failed / 8 skipped | exit 1 |
| `npm run test:e2e -- test/integration/skill-restart.native.e2e-spec.ts` | 1 skipped | 1 skipped | skip only |
| `git diff --check` (repository root) | - | - | clean |

Skips are `test/voice/integration/fault-recovery.spec.ts` (4) and
`test/voice/integration/multi-mode.spec.ts` (4); both require absent native prerequisites.

## Matched assembled scenarios and correctness

Source: `SKILL_TASK` rows emitted by `backend/test/assembly/skill-workflow.spec.ts` over the real
assembled path. `External` counts non-chat-completions fetch calls. `Discovery window` compares the
boundary at the request after a disclosure with the boundary at the disclosure request.

| Scenario | Selected canonical tools | Requests | Repairs | Executor invokes | External deliveries | Discovery window | OAuth | Success |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- |
| Ordinary question | none | 1 | 0 | 0 | 0 | n/a (single request) | 0 | yes |
| Single cold operation | `calendar_list_calendars` | 3 | 0 | 1 | 0 | unchanged (all zero) | 0 | yes |
| Batched multi-tool | `calendar_list_calendars`, `calendar_get_event` | 4 | 0 | 2 | 2 | unchanged (all zero) | 0 | yes |
| All tools in one disclosure | all 5 | 3 | 0 | 1 | 0 | unchanged (all zero) | 0 | yes |
| Warm follow-up 1 | `calendar_list_calendars` (retained) | 2 | 0 | 1 | 0 | n/a (no disclosure) | 0 | yes |
| Warm follow-up 2 | `calendar_list_calendars` (retained) | 2 | 0 | 1 | 0 | n/a (no disclosure) | 0 | yes |
| Later newly needed tool | `calendar_get_event` (new disclosure) | 3 | 0 | 1 | 2 | unchanged (all zero) | 0 | yes |
| Missing-schema correction | `calendar_list_calendars` | 4 | 1 | 1 | 0 | unchanged (all zero) | 0 | yes |
| Repair exhaustion | `calendar_list_calendars` | 4 | 2 | 0 | 0 | immediate | 0 | completed with explicit local narration |

Observed request sequences: cold operation 3 (`initial`, `continuation`, `continuation`); batch 4;
all-tool 3; warm 2 each; later tool 3; correction 4 with one `schema-repair`; exhaustion 4 with two
shared repairs and **no fifth model request**.

Exhaustion detail: the integrated runtime ends through the existing `answerAndSeal` narration path
("I could not complete the calendar request after correcting my tool calls...") and the attempt
status is `completed`, not a stream error. `plan3.md` Task 4 predicted a terminal `error`/failed
status; the committed P2 design (`plan2.md`: "The existing `answerAndSeal` is the terminal path")
seals an explicit bounded outcome instead. This is recorded as a plan/implementation reconciliation,
not a fabricated passing assertion. See "Failures, owner-routed corrections, and rerun evidence".

Selected canonical tool correctness is asserted from real executor invocations
(`CalendarApiTools.prototype.invoke` arguments), not from model text. Discovery is not counted as a
logical Calendar operation or create allowance.

## Discovery, execution, model, OAuth, and preflight call counts

Boundary counters cover target resolution, target-current checks, access-token acquisition,
resource-discovery refresh, OAuth refresh, and non-model external fetches.

- Every disclosure continuation (ordinary, one operation, batch, all tools, correction, later tool)
  has an identical boundary before the disclosure response and before its continuation:
  `{invoke:0, resolve:0, check:0, token:0, resource:0, oauth:0, external:0}`.
- Warm follow-ups perform exactly one real `invoke` and no discovery, OAuth, or external call.
- Batch and later-tool turns perform their two external deliveries only at the actual operation
  boundary after the disclosure; `ensureFresh` is never called during discovery.
- OAuth refresh count is 0 in every scenario.
- Ordinary questions send one model request with the two stable native definitions and no plugin
  work.
- Persisted budgets: one operation `{modelDispatches:3, repairs:0, logicalTools:1, creates:0}`;
  batch `{modelDispatches:4, repairs:0, logicalTools:2}`; all-tool `{modelDispatches:3,
  repairs:0, logicalTools:1}`; warm `{modelDispatches:2, repairs:0, logicalTools:1}`; correction
  `{repairs:1, modelDispatches:4, logicalTools:1}`; exhaustion `{repairs:2, modelDispatches:4}`.

## Assembled prefix, ordered history, and reconstruction

`backend/test/assembly/skill-history.spec.ts` (4 tests, all passing):

- Cold initial, post-disclosure continuation, and post-execution continuation request prefixes are
  byte-identical JSON for the already-assembled messages. Disclosures are appended in position, not
  rewritten.
- A warm follow-up prefix repeats the prior executed prefix exactly and appends only
  `[{role:'assistant',content:'Listed.'},{role:'user',content:'List them again.'}]`.
- The prior user content appears exactly once; no duplicate application-loaded history.
- Every request body carries the identical two-tool array.
- `assertPairs` verifies unique native call IDs, assistant/tool adjacency, and exactly one result
  per call in cold, warm, correction, and fresh-chat bodies.
- A clean `AppService` reconstruction after `operations.shutdown()` over the same saved stores
  reproduces the prior prefix byte-for-byte, completes a new turn, and records a completed attempt.
- Repeated activation returns `disclosures: []` plus `alreadyLoaded` referencing the original
  disclosure call ID; the original schema is not duplicated.
- A fresh chat rejects `call_tool` with `SCHEMA_NOT_LOADED` and performs zero executor invocations;
  no disclosure IDs leak into the new chat.

## Recorded baseline and like-for-like comparison limits

Immutable research observations (`backend/test/assembly/skill-evidence.ts`, source
`86dd3974d5e000ab05f4d2285879a723fcd3f69f`, application `118ba21`): five native schemas 2774 bytes
(SHA-256 `fbed2721...f844f8f8`), fixed prefix 9680 bytes (SHA-256 `fffdb37f...0be14ea`), cold body
bytes `[12884,12886,12919,12892,12894]`, reservation units `[12743,12745,12778,12751,12753]`.

Current equivalent serializer probe (`SKILL_COLD_PROBES`):

| Input | Baseline body bytes | Current body bytes | Current message bytes | Current tools bytes | Current reservation units | Comparable prefix |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `What is 2 + 2?` | 12884 | 11428 | 9918 | 1123 | 11287 | no |
| `Read event abcde` | 12886 | 11430 | 9920 | 1123 | 11289 | no |
| `List my calendars and check availability tomorrow` | 12919 | 11463 | 9953 | 1123 | 11322 | no |
| `Read event abcde again` | 12892 | 11436 | 9926 | 1123 | 11295 | no |
| `Now find events tomorrow` | 12894 | 11438 | 9928 | 1123 | 11297 | no |

Current prefix SHA-256 is `e7d0b2e6e5a87b719a46b359694d776ba73cb5f5d7f5d63eac66f90f9a4ee897`,
not the baseline hash, because P2 changed the fixed system instructions. **Total-body deltas are
not like-for-like** and no savings percentage is asserted. The tools-array comparison is valid under
the same serializer: the five-schema baseline was 2774 bytes and the two stable definitions are
1123 bytes (a 1651-byte, ~59.5% smaller tool array). Current message bytes are 195 bytes larger than
the baseline for the first probe because of the changed instructions. These cold probes exclude the
runtime catalog message; actual assembled task bodies include it.

## Serialized bytes and conservative reservation units

Per-task totals from `SKILL_TASK` (request arrays contain each request's values):

| Scenario | Requests | Body bytes | Reservation units |
| --- | ---: | ---: | ---: |
| Ordinary question | 1 | 2845 | 2735 |
| Single cold operation | 3 | 11669 | 11531 |
| Batched multi-tool | 4 | 19136 | 19080 |
| All tools in one disclosure | 3 | 17045 | 16907 |
| Warm follow-up 1 | 2 | 11824 | 12052 |
| Warm follow-up 2 | 2 | 14838 | 15322 |
| Later newly needed tool | 3 | 27256 | 28462 |

`reservationUnits` is the existing conservative byte-based unit
`64 + utf8(JSON.stringify({messages,tools})) + 32 * messages.length`. It is **not** a token count
and must not be divided by four and reported as provider usage.

## Task-level fixture timings and modeled storage latency

Wall fixture task time (`performance.now()` around submit plus execute in
`backend/test/assembly/skill-workflow.spec.ts`) is real elapsed test-process time with zero model
delay:

| Scenario | Model requests | Fixture task ms |
| --- | ---: | ---: |
| Ordinary question | 1 | 51.2 |
| Single cold operation | 3 | 40.8 |
| Batched multi-tool | 4 | 56.8 |
| All tools in one disclosure | 3 | 26.5 |
| Warm follow-up 1 | 2 | 30.9 |
| Warm follow-up 2 | 2 | 31.3 |
| Later newly needed tool | 3 | 41.4 |

Correction and exhaustion tests assert behavior, not timing; they emit no task-time row.

Fixture wall times are from one captured run and vary with CPU and parallel load; they are not
latency guarantees.

Stock repositories and saver (`SKILL_STORAGE_LATENCY`, `skill-latency.spec.ts`), explicit model:
`readMs=67`, `writeMs=449`, `modelDelayMs=0`, `pluginDelayMs=0`.

| Turn | Waves | Modeled elapsed ms | Wire reads | Wire writes | Failed | Saver writes | Pre-dispatch waves | First-answer waves | Post-seal waves |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold activation + list | 256 | 44656 | 192 | 72 | 0 | 20 | 81 | 194 | 32 |
| Warm list | 204 | 34678 | 153 | 55 | 0 | 15 | 77 | 141 | 32 |

Provider latency and native MongoDB latency are unavailable (`null`). These modeled storage numbers
are not wall-clock provider latency, suite duration, or native database timing, and cold/warm must
not be compared with the serializer cold probes.

## Synthetic catalog scaling

`SKILL_SCALE` from `backend/test/performance/skill-scale.spec.ts`; synthetic metadata only, no
plugin registration.

| Synthetic tools | Catalog bytes | All schemas bytes | Selected schema bytes | Native definitions bytes | Integrations added |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 421 | 3721 | 745 | 1063 | 0 |
| 50 | 3341 | 37241 | 745 | 1063 | 0 |
| 250 | 16491 | 186391 | 745 | 1063 | 0 |

Catalog order is stable and contains no `inputSchema`. These measurements do not prove admitted
execution or context capacity at 50 or 250 tools; P2's all-tool/context ceiling tests remain the
admission authority.

## Compatibility and existing safety regressions

Named suites executed in the broad compatibility command, all passing unless listed under failures:

- `test/contracts/skill-protocol.spec.ts` (9 tests): compact metadata without schemas, two frozen
  definitions, bounded one/many/all selection with invalid/oversized rejection, atomic local
  resolution, bounded disclosure batches with compact references, missing/stale/argument error
  distinction, raw identity and domain argument validation, source-free local outcomes, and old
  decision decoding.
- `test/runtime/skill-activation.spec.ts` (7), `test/runtime/skill-history.spec.ts` (7),
  `test/runtime/skill-correction.spec.ts` (3): local activation, durable group reconstruction,
  restart/reopen/isolation, unconfirmed local save, correction and shared repair budget.
- `test/persistence/skill-evidence.spec.ts` (3) plus the Calendar accounting/evidence/retention
  suites (all passing) cover scoped durable evidence and decoding.
- `test/integration/plugins/multi-calendar/acceptance.spec.ts` (10, passing) and
  `accounting-recovery.spec.ts` (4, passing) exercise HTTP acceptance plus durable budget/effect
  recovery after migration; `authority.spec.ts` has 4 passing and 1 pre-existing failure.
- Voice: `test/voice/**` (all discovered files passing), `test/http/voice-exclusion.spec.ts` (2),
  `test/context/voice-context.spec.ts` (26), `test/assembly/voice-context.spec.ts` (2), and the
  runtime voice suites passing. `test/runtime/calendar-lifecycle.spec.ts` proves a live-voice
  acceptance does not capture a Calendar budget while Calendar dependencies are present.
- `test/benchmark/workflows.spec.ts` (5) now drives the stable `call_tool` wire through the real
  adapter and `analyzeTurn`; synthetic component-path evidence only.

## Unavailable provider/cache/service evidence

Provider-reported total input/output, uncached/cached input tokens, billed cost, provider cache
hits, and live provider latency are **unavailable** (`null`), not zero. Schema context remains
present on warm requests. Usage-parser fixtures elsewhere do not establish provider cache hits.
No paid provider run, external provisioning, Azure compatibility run, or Google/OpenRouter
certification was performed.

### Limitations

- Matched baseline task latency is unavailable; research recorded cold request-shape probes and two
  specific three-request correction/pagination flows, not five-scenario task latency. No legacy
  routing path was retained or executed for comparison.
- New cold serializer probes exclude runtime catalog insertion; actual assembled task measurements
  include it. Base instructions changed, so total-body comparisons are not like-for-like.
- Prefix stability applies to ordinary same-date/same-mode/configuration/permission continuation.
  Date, permission, privacy, or asset changes may legitimately invalidate prefixes; none were
  removed to force stability.
- Real wall fixture time, modeled storage delay, suite duration, native database timing, and live
  provider latency are different quantities.
- Native checks without prerequisites are skipped; fake stores and scripted providers do not
  certify replica-set, Azure, Google, or OpenRouter behavior.
- Code review is **SKIPPED**. P3 passing does not close final verification: the orchestrator still
  owns the full backend/frontend build/lint/test and backend e2e gates, the actual final tested
  revision set, and `final_report.md`.

## Failures, owner-routed corrections, and rerun evidence

1. **P2 production issue — redacted Calendar decision blocks the chat.** Three
   `test/performance/confirmed-state-cache.spec.ts` tests fail with
   `AppError: Calendar history is no longer available. Start a new chat.` from
   `backend/src/chat-runtime/calendar-history.ts:49`: when a retention sweep nulls a saved decision,
   `calendarHistory` throws `NOT_READY` instead of omitting the group and letting the tombstoned
   transcript proceed. Reproducers: "excludes stale content through admission-receipt and
   confirmed-state cache reuse after classification is lost and redacted by actual retention
   sweep", "fails closed when 1024-session tracking eviction occurs, never granting immutable status
   to Calendar answers", and "fails closed after process restart when redaction occurs, excluding
   stale content in provider prompt". These tests passed in the research baseline; they are P2-owned
   and remain **RED** (not skipped, not weakened). P2 should omit a group whose decision was
   redacted and rerun the suite.
2. **Plan/implementation reconciliation — repair exhaustion.** `plan3.md` Task 4 expected an
   `error` event and failed attempt status; the integrated P2 design seals an explicit local
   narration through the pre-existing `answerAndSeal` path and records `completed`. All other
   Task 4 assertions hold (4 requests, 2 shared repairs, no fifth request, no external/OAuth call,
   `ARGUMENTS_INVALID` result). The P3 test records the actual bounded outcome; the orchestrator
   should confirm with P2 whether a contract change is intended.
3. **Pre-existing — changed-condition clarification.** `multi-calendar/authority.spec.ts > renews
   acceptance when fresh coverage changes instead of replaying the old yes` still fails the
   `calendar-clarification` frame assertion; research §5 already recorded one failure in this file
   as a changed-condition clarification assertion. Not caused by the discovery migration.
4. **Pre-existing — recovery-unavailable.** `test/runtime/calendar-recovery-unavailable.spec.ts >
   recovers an ordinary text turn ...` fails; it is in the research post-build failure inventory.
   P2-owned, unchanged.
5. **Strict durable-latency gates remain RED by design.** 19 of 61 tests fail under
   `('67/449ms')`/`('0ms')`. Eight are the pre-existing `follow-up-38`/`follow-up-39`
   context-limit cascades. The remainder are the deliberately strict fixed/accepted baseline gates,
   which were not rebased or skipped. Measured values (`DURABLE_BASELINE`, commands / pre-dispatch /
   first-answer / post-seal, cap in parentheses):
   - `calendar-text` 152/81/84/32 (195/107/110/48): under every fixed cap.
   - `calendar-read` 270/81/200/32 (266/107/181/48): +4 commands and +19 first-answer waves; pre
     and post storage phases remain under caps. Classification: expected cold-discovery protocol
     overhead (one activation request plus its local evidence writes), not a storage-phase
     regression.
   - `calendar-create` 292/81/231/32 (320/107/235/48): under every fixed cap.
   - `calendar-conflict` 247/81/239/32 (240/107/233/48): +7 commands and +6 first-answer waves;
     pre/post under caps; same classification.
   - `calendar-proposal-reply` 200/null/149/32 (278/190/193/48): commands and waves under caps, but
     the reply turn performs no model dispatch, so the fixed baseline's `preDispatch` boundary is
     correctly unavailable. The stale boundary expectation, not a storage regression, is the
     failure.
   - `new-text`, `follow-up-1`, `follow-up-20`, `follow-up-50-test-budget`, `rejection-retry` are
     under fixed caps; the acceptance targets are deliberately stricter than the fixed caps and
     remain red for the pre-existing text/calibration scenarios.
   Research recorded 17 pre-change durable-latency failures; the current count is 19, of which 8 are
   the same context-limit cascades and the rest are the strict baseline/acceptance gates. The
   consumer migration reduced failures from 58 to 20 across the Task 6 consumer command (13 to 2
   files).
6. **Built-suite timeout.** `calendar-simplification.built.spec.ts` passed alone (1971 ms) but timed
   out at the default 5000 ms under full-suite parallel load. An explicit 20000 ms per-test timeout
   was added, matching other heavy assembled/integration suites; it is not a storage or performance
   threshold change.
7. **Voice coverage gap for P2.** No committed runnable regression combines a live
   `submitLiveTurn` with retained Calendar disclosures in the same chat to prove the live turn
   bypasses enabled Calendar. `calendar-lifecycle.spec.ts` proves only that live acceptance captures
   no Calendar budget with Calendar dependencies present. This is reported to P2 as an exact
   coverage gap; no P3 voice integration was added.
8. **Fixture migrations completed.** `calendar-simplification(.built)`, `calendar-flow`,
   `calendar-multi-flow`, `calendar-observability`, `calendar-capability`, `calendar-assets`,
   `benchmark/workflows`, `multi-calendar/acceptance`, `multi-calendar/accounting-recovery`,
   `performance/calendar-critical-path`, `performance/durable-latency`, and
   `performance/confirmed-state-cache` now script stable `activate_skill`/`call_tool` wires and
   assert canonical names at the executor boundary. `calendar-assets` now asserts the stable skill
   wording after P2 changed `system.md`. Extra request counts equal only the explicitly added
   activation, except recovery flows whose documented local grouping adds one retained group
   (`accounting-recovery`).

## Final-verification handoff

- P3-owned paths: `backend/test/assembly/{skill-fixture.ts, skill-workflow.spec.ts,
  skill-history.spec.ts, skill-evidence.ts, calendar-*.spec.ts}`,
  `backend/test/performance/{skill-evidence.spec.ts, skill-scale.spec.ts, skill-latency.spec.ts,
  calendar-critical-path.spec.ts, durable-latency.spec.ts, confirmed-state-cache.spec.ts}`,
  `backend/test/integration/skill-restart.native.e2e-spec.ts`,
  `backend/test/integration/plugins/multi-calendar/{acceptance,authority,accounting-recovery}.spec.ts`,
  `backend/test/benchmark/workflows.spec.ts`, and this document.
- P3 commits: `ff05576`, `43f0113`, `5deaf1d`, `d1173e4`, `1c6b99e`, `81f5115`, `59fdbec`,
  `269b9ae`, `72e76ef`, `14f1885`, `a47d1b7` (evidence), plus documentation-only follow-ups.
- Focused P3 suite: **15/15 pass**, 5/5 files.
- Broad compatibility command: **1872 passed / 5 failed / 8 skipped** (1885 tests, 188 files).
- Remaining failures are enumerated above; three require P2 correction and two are pre-existing.
  No failure was converted to a skip, expected-fail, or relaxed threshold.
- Native restart: skipped (prerequisites absent); not a pass.
- V must run, from their packages, backend `npm run build`, `npm run lint`, `npm test`,
  `npm run test:e2e`; frontend `npm run build`, `npm run lint`, `npm test`; and repository
  `git diff --check`. The tested commit set above is a P3 evidence snapshot, not the final
  workflow revision.
- Code review remains **skipped**; P3 completion does not mark the workflow complete or substitute
  for `final_report.md`.
