# Calendar memory-first integration — production handoff continuation

## Current continuation — 9 November 2026

The requested Calendar-v2 memory-first route, durable promotion, memory import,
and lifecycle synchronization are implemented. The production acceptance suite is
**30/30 passing without eligibility overrides**. Backend build and lint pass.
Focused acceptance is implemented and verified. The full routine suite is **not**
green: **2,856 passed / 30 failed / 10 skipped** across 316 files. Review is
**skipped**, per instruction. No whole-backend, deployed-service, native-database,
Azure or live-provider claim follows.

The previously running final routine log completed. Remaining-work collection,
classification, report and hygiene are recorded in
[the continuation handoff](../calendar-memory-first-production-handoff/HANDOFF.md)
and [`final_report.md`](../calendar-memory-first-production-handoff/final_report.md).

This continuation uses the user's production handoff as the approved design. MAW
planning and three workers were used, with disjoint support, integration and test
ownership. New execution artifacts are in
[`../calendar-memory-first-production-handoff/state.md`](../calendar-memory-first-production-handoff/state.md).
No existing workflow state or prior benchmark artifact was changed. Nothing was
staged or committed; no dependency, live provider, external database, Azure,
provisioning or deployment check ran.

### Actual implementation

- **Production admission:** Calendar-v2 ordinary text and voice enter the existing
  shared memory foundation and `CalendarLoop`. Real AppService tests block every
  repository and account-authority method while new/warm ordinary turns stream and
  complete. Native tool definitions, trusted server user attribution and budgets
  remain unchanged. Cold hydration loads durable Calendar groups, validated native
  capsules, the proposal slot and connection binding rather than forcing durable
  chat solely because these exist.
- **Ordered durable boundary:** `flushSession` waits session saves in order and
  refuses failures, timeout or fencing while retaining pinned dirty state. Active
  promotion persists input, accepted attempt, acceptance confirmation, generating
  CAS, base context manifest, reply reference and sequence reservations. Account
  resolution follows successful prefix persistence. Volatile accounting becomes
  actual confirmed budget/dispatch records through the required
  reserved → dispatched → terminal transitions. The owned LangGraph cursor retains
  `next: execute`, the original pending decision and context refs before external
  dispatch. No synthetic store receipt or alternate dispatcher grants effects.
- **Effect, publication and import:** Reads still use the existing execution port;
  mutations still use `CalendarOperationWriter`. The original decision/call IDs
  survive promotion. The existing publisher persists narration, provenance,
  boundary and terminal completion. Durable `memoryPublication`, sequence counters
  and shared foundation version/durableVersion advance together, without queuing a
  duplicate archive. Completed tool groups, binding and pending proposal are
  immediately available to subsequent text/voice turns.
- **Retries and recovery:** Failed prefix persistence retains the same attempt,
  native decision and stage. Existing bounded `retrySave` semantics are preserved;
  a retry resumes persistence without another model decision. Generation retries
  seed turn-wide accounting and prior local disclosure, while excluding failed
  assistant text from context and retaining it in UI history. Uncertain create
  recovery reads the original operation/event; saved-seal recovery republishes
  without inference. Both repair publication markers and import the terminal
  result so the next ordinary turn can save. Interruption uses the originally
  reserved assistant sequence.
- **Lifecycle and expiry:** Runtime invalidation redacts retained foundation
  messages, voice delivery/replay projections and cached tool groups, then purges
  affected bindings/proposals. AppService forwards account revision invalidation
  before its durable sweep. Context/history redaction uses the injected clock.
  Proposal consumption, cancellation and expiry are reflected in warm state. A
  reproduced invalidation-after-prefix race now closes durable ownership and
  imports the interrupted result, allowing the next turn to save with zero
  external calls from the refused attempt.

### Test-first and acceptance evidence

Entry focused run reproduced the original admission failure: **1 failed / 6
passed**. After removing all eligibility overrides, **7/7 failed** through real
routing. Support tests first failed on missing flush/import, ignored retry seed
and capsule history. Further executed RED checks exposed failed-attempt retry
context, voice redaction, reconciliation followup markers and the late lifecycle
race; each received a verified correction.

The final 30-test acceptance file covers all nine requested matrix categories:
real AppService Mongo/account-blocked admission; local activation/schema repair;
cold external history and dynamic tombstones; warm/cold yes/no/reference replies
before inference; dirty/partial/timeout persistence failures; read/create
promotion; post-effect and saved-seal reconciliation plus following turns;
disconnect/revoke/disable races; text → voice → Calendar projections and shared
retry budgets. At the actual external invocation it inspects the saved generating
attempt, acceptance, input, original decision/call, confirmed budget and resumable
cursor. Partial-prefix failure asserts zero account reads and zero Google calls.

### Executed verification

Windows PowerShell; Node **v24.19.0**; installed Vitest **4.1.11**; unchanged HEAD
`89e0d4ee94c14f92d383efd1e114a1b8b57463c9` plus preserved dirty work. Every test
command runs in `backend` with `AURVIN_TEST_MONGODB_URI=''` and `--maxWorkers=1`.

| Check | Actual result |
| --- | --- |
| Final root Calendar acceptance | **30 passed**, 1 file; 6.35 s |
| Root requested four related suites | **79 passed**, 4 files; 11.22 s (before final late-race integration fix; full routine covers final source) |
| Worker related text/voice and Calendar runtime checks | **71 passed** |
| Worker TypeScript `tsc --noEmit -p tsconfig.build.json` | Exit 0 |
| Backend `npm.cmd run build` | Exit 0 |
| Backend `npm.cmd run lint`, after build completed | Exit 0; **647 warnings / 0 errors** |
| Requested `test/assembly/built-assembly.spec.ts` | Exit 1, **no test files found**; path does not exist |
| Existing `test/assembly/calendar-simplification.built.spec.ts`, after build | **1 passed**, 1 file; 5.70 s |
| Full routine `npm.cmd test -- --maxWorkers=1` | **2,856 passed / 30 failed / 10 skipped**; 316 files (308 passed / 6 failed / 2 skipped); 378.13 s; started 11:48:25; log has no numeric wrapper exit, Vitest reported 30 failures so the run is not green |

Exact commands, from `backend`:

```powershell
$env:AURVIN_TEST_MONGODB_URI=''
npm.cmd test -- --maxWorkers=1 test/performance/calendar-memory-first.spec.ts
npm.cmd test -- --maxWorkers=1 test/performance/memory-first-foundation.spec.ts test/performance/memory-text-archive.spec.ts test/performance/memory-first-text.spec.ts test/performance/memory-calendar-state.spec.ts
npm.cmd run build
npm.cmd run lint
npm.cmd test -- --maxWorkers=1 test/assembly/built-assembly.spec.ts
npm.cmd test -- --maxWorkers=1 test/assembly/calendar-simplification.built.spec.ts
npm.cmd test -- --maxWorkers=1
```

Lint and routine logs are retained in system temp as
`aurvin-calendar-handoff-lint-20261109.log` and
`aurvin-calendar-handoff-routine-20261109.log`. A broad entry run was stopped before
production edits; its partial failure evidence is in
`aurvin-calendar-handoff-baseline-20261109.log`. It is **not** a completed entry
baseline.

### Full routine classification (9 November 2026)

The completed log is `aurvin-calendar-handoff-routine-20261109.log`. No duplicate
full-suite process was started; the existing run had already printed its summary.

| Result | Count |
| --- | --- |
| Tests | 2,856 passed / 30 failed / 10 skipped (2,896) |
| Files | 308 passed / 6 failed / 2 skipped (316) |
| Duration | 378.13 s (transform 6.26 s, import 215.59 s, tests 106.98 s) |
| Environment | Windows PowerShell, Node `v24.19.0`, Vitest `4.1.11`, `AURVIN_TEST_MONGODB_URI=''`, `--maxWorkers=1`, fake repositories/provider responses |

**Skips.** The completed reporter printed skip *counts* only, not names. They
are not passes. Under this command (empty Mongo URI, no native authorization,
no hardware-pilot artifact, no live smoke) the routine-discovery `skipIf` sites
are:

| Location | Why skipped | Tests |
| --- | --- | --- |
| `test/voice/integration/multi-mode.spec.ts` (whole file) | `describe.skipIf(!nativeConfigured)` | 4 |
| `test/voice/integration/fault-recovery.spec.ts` (whole file) | `describe.skipIf(!nativeConfigured)` | 4 |
| `src/app.controller.spec.ts` native assembled fixture | `AURVIN_TEST_MONGODB_URI` empty / prefix not `aurvin_p2_test_` | 1 |
| `test/evaluations/voice/latency-eval.spec.ts` hardware-pilot describe | `AURVIN_VOICE_PILOT_EVIDENCE` unset | 1 |

That accounts for **10 tests / 2 skipped files**. Azure, `*.behavior.spec.ts` and
`*.e2e-spec.ts` are excluded from routine discovery, not counted as skips here.

**Baseline comparison.** Exact failing *names* in the completed run match the
stopped pre-edit partial log, except the entry Calendar admission failure is
gone.

| Source | Tests | Files | Notes |
| --- | --- | --- | --- |
| Stopped entry partial (`aurvin-calendar-handoff-baseline-20261109.log`) | Incomplete; 31 named failures seen before stop | Partial | Same 30 remaining names **plus** `calendar-memory-first.spec.ts`: “Calendar enabled new and warm text dispatch with unchanged native tools before any database work”. Not a completed baseline. |
| Historical 8 November full routine (older incomplete source, preserved below) | 2,820 passed / 31 failed / 10 skipped | 307 passed / 7 failed / 2 skipped (316) | Extra failure was original admission. Skip counts identical. |
| This completed 9 November run | 2,856 passed / 30 failed / 10 skipped | 308 passed / 6 failed / 2 skipped (316) | Admission file now passes (30/30). No new failing name. Passing-count increase includes the expanded focused suite, not a claim that historical failures were fixed. |

The 30 remaining failures, by exact name:

| File | Failed tests | Classification |
| --- | --- | --- |
| `test/performance/durable-latency.spec.ts` | 19: `follow-up-38-at-80-msg-ceiling` and `follow-up-39` measure gates (0ms and 67/449ms); fixed caps for those two plus `calendar-read`, `calendar-conflict`, `calendar-proposal-reply`; acceptance targets for those plus `calendar-text`, `calendar-create`, `cancel-before-dispatch`, `cancel-midstream`, `reconnect-finalization-recovery` | Present at entry. Historical command/wave/context-budget thresholds. Not weakened. Not a focused-acceptance defect. |
| `test/operations/local-guard.spec.ts` | 3: duplicate live owners; unexpected helper death; PID reuse/foreign machine | Present at entry. Local lifetime helper/fixture (`UNSUPPORTED_TOPOLOGY` / fixture-guard). Unrelated to Calendar memory-first. |
| `test/persistence/local-open.spec.ts` | 3: raw-client listeners; production opt-in guarded setup; ambiguous busy sentinel | Present at entry. Same local-lifetime exclusion. Unrelated. |
| `test/performance/confirmed-state-cache.spec.ts` | 3: retention-sweep stale content; 1024-session eviction; process-restart redaction | Present at entry, before this continuation touched `calendar-history.ts`. Same `NOT_READY` “Calendar history is no longer available”. Not a new regression. |
| `test/runtime/calendar-recovery-unavailable.spec.ts` | 1: “recovers an ordinary text turn while the Calendar plugin is not connected” | Present at entry and in the 8 November record. `execute` resolves instead of rejecting after injected `archive-save` failure. Not waived. |
| `test/integration/plugins/multi-calendar/authority.spec.ts` | 1: “renews acceptance when fresh coverage changes instead of replaying the old yes” | Present at entry. Still expects `calendar-clarification`. Prior clean-at-entry loop comparison remains historical; this is still a failure. |

No task-related new failure was found, so no idle P1/P2/P3 worker was reactivated.
Focused Calendar memory-first acceptance remains **implemented**. Broad routine
readiness remains **open**. No threshold, timeout or safety assertion was
weakened. Native MongoDB, Azure, e2e, behavior and live/paid checks did not run.

### Continuation file diffs and preservation

Production changes are limited to:

- `backend/src/chat-runtime/memory-text.ts`: admission, hydration, prefix promotion,
  native retry, durable completion/import, recovery and warm invalidation.
- `backend/src/chat-runtime/memory-first-foundation.ts`: ordered flush, durable
  import, retry-context filtering and dynamic text/voice redaction.
- `backend/src/chat-runtime/memory-calendar-ledger.ts` and
  `memory-calendar-state.ts`: shared retry counters, job rebinding and validation
  of contiguous per-attempt dispatch suffixes.
- `backend/src/chat-runtime/calendar-history.ts`: validated capsule fallback for
  local native turns without durable dispatches.
- `backend/src/chat-runtime/calendar-loop.ts`: promotion/cursor handoff, proposal
  gates, retry disclosure and deterministic expiry.
- `backend/src/chat-runtime/durable-chat-runtime.ts`: production text/voice routes,
  invalidation forwarding and reconciled-memory synchronization.
- `backend/src/app.service.ts`: memory invalidation alongside durable redaction.
- `backend/src/chat-runtime/calendar-publication.ts`: optional promoted assistant
  projection and injected redaction clock, keeping the same publisher.
- `backend/src/chat-runtime/reconciliation.ts`: optional reserved assistant
  sequence for memory-promoted interruption.

Test changes: `calendar-memory-first.spec.ts`, `memory-first-foundation.spec.ts`,
`memory-calendar-state.spec.ts`, and the obsolete Calendar-routing expectation in
`memory-first-text.spec.ts`, all under `backend/test/performance/`. Documentation
changes are this report and the new goal/research/three plans/state under
`docs/calendar-memory-first-production-handoff/`. No frontend source was changed
by this continuation.

Final hygiene, 9 November 2026: **78/78** entry paths present. **12/78** hashes
differ, all in the listed continuation edit set. Extra versus entry: the three
previously clean tracked files `calendar-history.ts`, `calendar-publication.ts`
and `reconciliation.ts`, plus `docs/calendar-memory-first-production-handoff/`.
HEAD remains `89e0d4ee94c14f92d383efd1e114a1b8b57463c9`. `git diff --check`
exit 0. Staged list empty. Nothing committed. No multi-instance authority,
exactly-once billing, live latency improvement, external service compatibility
or Azure certification is claimed. Single-process ownership and existing finite
retention, save-retry and budget limits remain in force.

---

# Prior implementation record — preserved

# Calendar memory-first implementation — incomplete

## Current continuation — 8 November 2026

**The requested working integration is still incomplete. Production Calendar admission remains RED.** This continuation adds real native-loop execution inside `MemoryText`, but intentionally does not open `eligible()` or AppService admission without a working durable promoter and lifecycle synchronization. It does not identify a fundamental contradiction in the approved design. The remaining work is implementation, not a request for renewed design approval. Review remains **skipped**.

The entry Git status was recorded before reads or writes. HEAD remains `89e0d4ee94c14f92d383efd1e114a1b8b57463c9`; the extensive existing modified/untracked tree was preserved. No skills, other agents, reviewer, staging, commits, installs, external provisioning, deployment, live provider/database/Azure check, service suite, environment/secret inspection or operator-script inspection ran. Checks use installed packages, fake fetch responses and deterministic repositories/drivers. No live latency improvement is claimed.

### Implemented in this continuation

- The **existing `CalendarLoop`** now has an explicit volatile evidence port. Local decisions, rejected decisions and local results enter `MemoryCalendarStage`; model reservation/observations enter `MemoryCalendarLedger`. Volatile execution has **no lease** and never passes invented ownership or receipts to persistence. Native model requests still use `SKILL_NATIVE_TOOLS`, `calendarContext`, the same loaded-schema checks/repair, trusted user attribution and accepted input. The shared durable loop continues using its existing repositories and account gates.
- `MemoryText.execute` can run that loop over the **same foundation and request Work** as ordinary memory text. Its completion attaches the original native evidence to the existing immutable terminal envelope, archive and cold reader. There is no second runtime, persistence owner, writer or graph-config change. Six deterministic runtime checks explicitly override `MemoryText.eligible()` to exercise this dormant branch. **That test-only override is not production enablement and is not a passing result for the original acceptance test.**
- Actual external calls reach an explicit promotion hook before the existing executor/writer. The current integration hook **refuses with `NOT_READY`**. The original pending native decision/call ID remains in the failed memory envelope; a generation retry of that pending external decision is refused instead of paying for another decision. This proves a refusal boundary only. There is no successful promoter, save-only promotion resume or durable external cursor implementation in this continuation. Cold pending proposals conservatively retain the existing durable route.
- A native cancellation test exposed that LangGraph may return on abort while a node is still unwinding. Native decide/execute node promises now belong to request Work, and the branch awaits their actual settlement before freezing accounting. Interrupted dispatches retain terminal failure evidence and held unknown cost. A separately blocked adapter-finally fixture proves bounded drain reports the raw active work and keeps the foundation turn pinned. Disconnect remains `interrupted`; it was not relabeled as explicit user cancellation.
- New native archive attempts carry an optional **publication dependency** (`epoch`, `version`, `fence`, content hash). The actual cold-hydration caller supplies its already bounded trusted attempt list. The reader rejects missing/altered published capsules, version/attempt/turn disagreement and fence mismatch. Legacy records without the new dependency remain readable; the change cannot prove completeness for historical capsules that never recorded a dependency. This is local native evidence integrity, not external-source retention/redaction or account authority.

### Executed evidence in this continuation

Windows PowerShell, installed Node/Vitest and package scripts; every test command used `AURVIN_TEST_MONGODB_URI=''` and `--maxWorkers=1`. Filtered runs report their unselected tests as skipped; no skipped test is counted as passed. The original admission test is still an ordinary failing test, with its assertions preserved.

| Check | Actual result |
| --- | --- |
| Entry admission RED | **1 failed**, 3.02 s: the same blocked `acceptNewTurn:737` session read before provider fetch. This failure existed at entry. |
| Integrated local activation first RED → GREEN | The new runtime test first completed as `failed` through the ordinary adapter; after native-loop integration it passes. A temporary implementation build error used a nonexistent timeout field; corrected to the existing accepted `totalRunTimeoutMs`. |
| Pending external retry RED → GREEN | The new test initially received a new retry attempt; now `NOT_READY`, original pending native call retained and zero external calls. |
| Cancellation RED → GREEN | After correcting the fixture's disconnect expectation to existing `interrupted`, the executed RED was retained dispatch `dispatched`/null failure. Tracking/settling the raw native node produces terminal cancelled-dispatch evidence; reconnect makes no further fetch. |
| Native publication dependency RED → GREEN | First failed on the absent dependency. Final **7 passed**, 6.73 s, including real archive retry, missing/altered capsule refusal and original-pair hydration. |
| Six new integrated runtime checks | Native tools/input/pairs; schema-not-loaded repair; real archive/cold hydration; pending external refusal/no paid retry; disconnect/reconnect; blocked raw adapter/drain. Final isolated file: **6 passed / 1 failed / 0 skipped**, 6.58 s; only original admission failed. Cold runtime fixture initially used the lightweight repository stub without `owner.store`; corrected to the existing real fake-driver bundle, preserving the constructor guard. |
| Final focused memory matrix | **81 passed / 1 failed / 0 skipped**, seven files, 34.67 s. The only failure is the unchanged production admission test. |
| Calendar/model/accounting/authority/recovery/memory/HTTP matrix | **247 passed / 1 failed / 0 skipped**, 28 files, 102.55 s. Failure: the previously reported `calendar-recovery-unavailable.spec.ts:45` archive-save rejection expectation. The later final focused runs cover subsequent local reader/native changes. |
| Final native-state/HTTP/WebRTC/telemetry matrix | **69 passed / 1 failed / 0 skipped**, nine files, 27.32 s. Failure: original admission. Existing buffered WebRTC and bounded normal-level logging regressions pass. |
| Additional authority failure isolation | `test/integration/plugins/multi-calendar/authority.spec.ts:82`, changed coverage should emit `calendar-clarification`: **1 failed / 4 unselected** both on current loop and with an exact import alias to the loop clean at entry (HEAD). Current 10.81 s; comparison 10.22 s. The temporary source/config were removed. This is a narrow loop-delta comparison, not a whole-tree HEAD baseline or a passing authority result. |
| Backend lint | **Exit 0; 647 warnings / 0 errors**. The four warnings in `calendar-loop.ts` are unchanged existing unused imports. No new native test/reader warning appeared. |
| Full routine suite | **2,820 passed / 31 failed / 10 skipped**, 316 files (307 passed / 7 failed / 2 skipped), 803.83 s. Actual failure classification follows. This is the current run's discovery/count, not the earlier report's historical 452-file run. |
| Final backend build | **Exit 0**, `npm.cmd run build` after the full routine suite and its built fixtures had finished; no concurrent build/dist fixture race. |
| Final lint / Git | **Exit 0**, 647 warnings / 0 errors on final source/tests; `git diff --check` exit 0. Staged list empty. Existing unrelated line-ending/ignore-file-access warnings were not changed. |

The routine run's **31 failed tests** are: 19 in `performance/durable-latency.spec.ts`; three each in `performance/confirmed-state-cache.spec.ts`, `operations/local-guard.spec.ts`, and `persistence/local-open.spec.ts`; one each in the original Calendar memory admission, `runtime/calendar-recovery-unavailable.spec.ts`, and `integration/plugins/multi-calendar/authority.spec.ts`. The 19/3/3/3/1 groups correspond to failure cases recorded by the earlier controlled historical comparison; that comparison remains **historical evidence**, not a new whole-tree comparison in this continuation. No threshold, timeout or safety assertion was weakened. Original admission was rerun RED before edits and at final source. The authority failure received the narrower clean-at-entry-loop comparison above; it is not labeled a whole-tree baseline or waived. No unexpected failure was silently assigned to the historical 103-failure classification. Ten skips are reported separately and provide no native database or hardware-pilot acceptance. No separate e2e/Azure/behavior/service suites ran.

Test commands use the existing `npm.cmd test -- --maxWorkers=1 <paths>` convention. Full routine output is retained in system temp `aurvin-calendar-memory-routine-20261108.log`; lint output is `aurvin-calendar-memory-lint-20261108.log`. No prior live or research artifact was edited. Frontend contracts/source did not change in this continuation, so frontend checks were not rerun.

### Exact continuation edit set and next gate

Previously clean tracked files modified: `backend/src/chat-runtime/calendar-loop.ts`, `backend/src/contracts/attempt.ts`.

Files already untracked at entry and modified here: `backend/src/chat-runtime/memory-text.ts`, `backend/src/persistence/memory-text-archive.ts`, `backend/src/persistence/memory-calendar-reader.ts`, `backend/test/performance/calendar-memory-first.spec.ts`, `backend/test/performance/memory-calendar-state.spec.ts`, and this report. **No new retained files** were added in this continuation. Other entry changes remain outside this edit set. All work is unstaged/uncommitted.

The next gate is **implementation and acceptance of active-prefix promotion and lifecycle synchronization**, followed by removing the eligibility exclusion only when the original runtime acceptance passes. Still absent: real receipt-bound prefix/accounting/cursor publication, ordered save/promotion ownership and late-save fencing, successful same-decision resume, save-only promotion retry, original-ID uncertain-effect readback through the new route, durable proposal/effect import into memory, lifecycle invalidation wiring, and Calendar-enabled memory voice/cross-mode acceptance. Combined native evidence reservations and turn-wide budgets across generation retries also need acceptance before enablement. Existing durable authority/recovery checks do not prove those missing contracts. No operator sizing approval, selected Azure product/tier or service certification is inferred.

## Prior partial-pass provenance (preserved)

8 November 2026. Working tree based on `89e0d4ee94c14f92d383efd1e114a1b8b57463c9` plus the extensive changes present at worker entry. **The requested Calendar-enabled runtime path is not implemented. Its acceptance test remains RED.** This pass implements and verifies part of the native memory/accounting/archive foundation; it does not complete the approved design or establish a new irreconcilable safety blocker. Remaining work is implementation work. Review: **skipped**.

No skills, agents, reviewers, commits, staging, installs, environment/credential/operator-script inspection, provider/database/Azure calls, loopback services, provisioning or deployment ran. Checks used installed packages and deterministic Vitest/fake-driver fixtures. Prior live reports, buffered WebRTC changes, timing logging, root instructions and workflow state were not edited.

## Actual routing and implemented scope

`MemoryText.eligible()` still excludes enabled Calendar. `DurableChatRuntime.submitTurn` still requires ordinary memory eligibility and excludes Calendar reply references; `submitLiveTurn` still excludes enabled Calendar snapshots. Readiness therefore retains its existing durable gate for this configuration. The existing plain-memory and voice paths remain assembled through the one application runtime, foundation and bounded save writer.

The new native ledger/stage are **not called by the production decision loop**. `MemoryText.finish` does not yet attach native evidence. The archive/foundation extension is exercised by deterministic fixtures, and the cold-hydration reader is connected to `MemoryText.hydrate`. Production cannot yet realize the requested no-DB Calendar conversation behavior. No eligibility-only workaround, tool omission, intent classifier, fake durability receipt or global graph setting change was made.

Implemented components:

- [`MemoryCalendarLedger`](../../backend/src/chat-runtime/memory-calendar-ledger.ts) accepts no persistence port or ownership/current-account callback. It reserves finite model-dispatch, repair, token-price/spend and deadline budgets before adapter dispatch. IDs include the trusted user/session/turn/**attempt** and dispatch index. A dispatch hook permits one dispatch only; freeze prevents new reservations, observations and dispatch. Absolute usage and provider generation identity are checked, contradictory known cost is rejected, and null observations cannot erase known cost or usage. Export is explicitly `storage: 'volatile'`, with no `ConfirmedRecord` or durable-account claim.
- [`MemoryCalendarStage` and schemas](../../backend/src/chat-runtime/memory-calendar-state.ts) retain bounded original skill decisions, local results and rejected decisions with exact IDs and payload mismatch rejection. Snapshot validation checks scope, dispatch linkage, unique result IDs/sequences and matching complete native call/result pairs. Each stage map is capped at eight entries, with a caller-supplied encoded-byte cap. Returned records are copies rather than mutable references to retained state.
- [`MemoryFirstFoundation`](../../backend/src/chat-runtime/memory-first-foundation.ts) accepts optional native terminal evidence, charges it to the existing evidence/envelope/session reservation, freezes it with the terminal envelope and exposes complete original pairs via `nativeGroups`. Trusted hydration validates scope and bounded native snapshots; clean source replacement subtracts previous native source bytes. Native evidence shares the existing ordered save queue, pinned dirty state, request retention, raw-write tracking and drain. Generated/heard voice projection was not changed.
- [`MemoryTextArchive`](../../backend/src/persistence/memory-text-archive.ts) can publish one immutable `memory-calendar-native` metadata record per attempt before the manifest/checkpoint/publication watermark. That record includes epoch, fence, version and native accounting/local evidence. Native publication is charged against the existing adapter operation/byte limits. Terminal capsules refuse pending native decisions without local results or nonterminal dispatches. A save failing later remains unknown with the old foundation watermark; retry compares the original deterministic record instead of repeating inference.
- [`readMemoryCalendarStates`](../../backend/src/persistence/memory-calendar-reader.ts) reads only bounded scoped attempts from an active published session. Future/unpublished versions are invisible; fence and message linkage mismatches fail closed. Cold hydration imports the exact original local pairs. This adds bounded cold reads; it adds no warm-turn reads. It does not implement a complete external-source retention/invalidation reader.

The proposed existing limits remain unchanged: 16 sessions, 128 requests/turns per session, 32 save envelopes, 524,288 encoded bytes per envelope, 131,072 evidence bytes, two concurrent saves and three save attempts. Native stage maxima are additionally eight records per map. These are encoded-data/count bounds, not operator-approved host sizing or measured RSS ceilings. The ledger has no independent network executor, map of sessions, persistence owner or save queue.

## Safe boundary and unfinished contracts

The current external access boundary remains the existing **durable** Calendar path. The new volatile ledger's `connectionId: 'memory-unbound'` is an explicit absence-of-account hint used for native model request validation; it is not a trusted current-account binding and is never passed to `CalendarOperationWriter` or a credential/capability gate. A future promoter must replace that hint with freshly validated account authority while preserving the original paid dispatch/decision/native-call identities.

The traced durable flow remains `admitCalendarBudget` → `runCalendarTurn` → `CalendarLoop`/`CalendarTurnLedger` → existing connection/capability gates and operation writer. `CalendarLoop.decide` checks the proposal slot before inference, including expired proposals, validates the reply reference/disclosure, and can execute an authorized reply without another model decision. Local activation currently writes its original decision/result durably. Model request assembly still uses `SKILL_NATIVE_TOOLS`, `calendarContext`, local disclosure, loaded-schema validation and bounded repair.

`CalendarOperationWriter.executeCreate` still validates the accepted message, proposal consumption and canonical action; resolves the original stable operation; confirms the planned operation/event and dispatch state before provider mutation; and handles uncertain dispatch by original-ID readback rather than another create. `requireAccountCurrent` and fresh capability/preflight checks were not removed or cached away. Nothing in the new modules grants external access or bypasses the dirty memory handoff guard.

Still required before changing eligibility:

1. Integrate volatile decision accounting/staging into the **existing** native loop, including rejection/repair, finite logical-tool budgets, streamed deltas, cancellation and terminal accounting; carry the same native definitions and original input exactly once. The direct-adapter fixture below is not runtime integration.
2. Extend shared hydration with complete external groups/provenance, pending proposal/revision/disclosure and connection/capability hints, and wire invalidation on revoke/disconnect/disable/refresh/expiry/consumption/retention. The implemented capsule permits local source-free evidence only. Existing external-provenance hydration still falls back to the durable path.
3. Implement bounded active-prefix promotion: freeze memory/context plus pending native IDs, serialize earlier save work, publish referenced history/input/native evidence/accounting, obtain actual write receipts, acquire valid ownership and publish/verify a compatible resumable graph cursor. No such promoter or receipt contract is implemented here. Partial/timeout promotion must retain unsaved state and make zero external calls. Do not clear the existing handoff guard.
4. Resume the exact pending native decision once through the existing Calendar executor/writer; handle proposal replies before inference; merge turn budgets across generation retries; retain original-ID unknown-effect reconciliation; and import resulting durable proposals/results/effects into the shared memory version stream before subsequent text/voice.
5. Finish explicit native completeness references and retention/tombstone invalidation for consolidated records. The current reader checks existing committed capsules and refuses invalid scope/fence, but does not prove completeness after arbitrary metadata deletion or implement external-content redaction. No native-enabled production admission is justified by this partial reader.
6. Complete the requested promotion-failure/partial/timeout, revoke/disable race, successful same-decision resume, mixed dirty text→voice→Calendar, pending confirmation, external read provenance, retry/reconnect, shutdown and capacity acceptance matrix. Existing durable authority/recovery tests below are preservation evidence, not tests of the missing promoter.

No real latency improvement, complete Calendar mutation-volume reduction, audible voice success, supported deployment or Cosmos compatibility is claimed. Operator facts still include the actual Azure product/API/tier/limits/features, host memory/headroom and single-process rollout/termination behavior. No service certification or universal Mongo/Cosmos transaction/document-limit assumption was made.

## Verification and failure classification

Windows PowerShell, Node **v24.19.0**, installed Vitest **4.1.11**. All test commands ran from `backend` with `$env:AURVIN_TEST_MONGODB_URI=''` and `--maxWorkers=1`. No service prerequisites were supplied. No assertion, timeout or historical performance threshold was weakened. The integration acceptance test remains an ordinary failing test, not skipped, TODO or `it.fails`.

| Check | Actual result |
| --- | --- |
| Required first acceptance RED | **1 failed**, 4.67 s. Blocked session read in `DurableChatRuntime.acceptNewTurn:737` precedes actual fake provider fetch. |
| Native foundation first run | **1 passed / 4 failed**. Failures exposed an invalid hand-written local-result fixture and under-reserved model fixture input. Fixtures now use the real local disclosure resolver and actual input estimator. Mutable stage snapshot exposure was separately found by source inspection and corrected before that assertion was reached; it is not claimed as an executed RED. No budget assertion was removed. |
| Initial native foundation + five existing memory suites | **73 passed / 0 failed**, six files, 17.76 s. |
| Expanded foundation, exact IDs/cost and native archive retry | **75 passed / 0 failed**, six files, 14.63 s. Native tests include actual adapter fetch and unchanged serialized tool definitions, separate attempt IDs, knownness/usage contradiction checks, complete pairs exactly once through the real context assembler, partial publication invisibility, idempotent retry, cold hydration and archived-session refusal. |
| Final native-only run after context assertion addition | **7 passed / 0 failed**, one file, 3.52 s. |
| Calendar/runtime/model/memory matrix | **227 passed / 2 failed / 0 skipped**, 27 discovered files, 67.23 s. Failures classified below. |
| Additional HTTP/context/accounting/benchmark/logging matrix | **104 passed / 0 failed / 0 skipped**, 14 files, 11.91 s. Includes existing buffered WebRTC and normal-level timing filter regressions. |
| Final enabled-Calendar acceptance | **1 failed**, 3.35 s. Every exposed repository/ownership method and both account authority methods are blocked. Execution still reaches the blocked admission session read; dispatch/completion/follow-up assertions are not reached. This is a newly added acceptance failure, not a baseline failure. |
| Backend build, final source | **Exit 0**, `npm.cmd run build` (`nest build`). No `.built` fixture ran concurrently. |
| Backend lint, final | **Exit 0**, **647 warnings / 0 errors**, no warnings referencing either new `memory-calendar*` or `calendar-memory-first` files. Log: system temp `aurvin-calendar-memory-lint-final.log`. |
| Git whitespace/staging | `git diff --check` exit 0. No staged files or commits. Initial modified/untracked files were retained. |

The matrix's other failure is `test/runtime/calendar-recovery-unavailable.spec.ts:45`, **“recovers an ordinary text turn while the Calendar plugin is not connected”**: `expect(h.execute(ids)).rejects` receives resolved `undefined` after an injected archive-save failure. This matches the prior follow-up report's known failure. No fresh controlled-HEAD comparison was run in this worker, so that earlier controlled comparison remains historical evidence; the present result is still a failure and is not waived.

The production adapter is exercised in a standalone new ledger test: actual fake fetch, streamed text and native decision validation pass without any persistence port. That proves the adapter accepts explicit volatile bookkeeping; it does **not** make the enabled-Calendar runtime acceptance green. The committed metadata capsule likewise proves only the implemented local-evidence archive extension. Broad/routine backend green, service/e2e/Azure/live checks and performance promises are not established. Frontend files were not changed and frontend checks were not rerun; the prior 683 passing tests remain prior evidence.

Context7 discovery returned no tools. Installed primary source was inspected: LangGraph **1.4.19**, checkpoint **1.1.5**, Mongo saver **1.4.1**. `pregel/loop.js` tracks pending saver operations and awaits them before advancing in sync durability. Mongo saver's `put` separately awaits the checkpoint upsert, while `putWrites` separately awaits its pending-write bulk operation. These are separate acknowledgements, not an atomic cross-collection transaction or an active-prefix promotion receipt. The existing `graphConfig` remains sync. This is installed-source verification, not independent current online documentation or selected-service certification.

Reproduction commands (all from `backend`):

```powershell
$env:AURVIN_TEST_MONGODB_URI=''
npm.cmd test -- --maxWorkers=1 test/performance/calendar-memory-first.spec.ts
npm.cmd test -- --maxWorkers=1 test/performance/memory-calendar-state.spec.ts test/performance/memory-first-foundation.spec.ts test/performance/memory-text-archive.spec.ts test/performance/memory-first-text.spec.ts test/performance/memory-first-voice.spec.ts test/performance/memory-voice-observations.spec.ts
npm.cmd test -- --maxWorkers=1 test/performance/calendar-memory-first.spec.ts test/performance/memory-calendar-state.spec.ts test/performance/memory-first-foundation.spec.ts test/performance/memory-text-archive.spec.ts test/performance/memory-first-text.spec.ts test/performance/memory-first-voice.spec.ts test/performance/memory-voice-observations.spec.ts test/performance/voice-critical-path.spec.ts test/runtime/calendar-loop.spec.ts test/runtime/calendar-logical-tools.spec.ts test/runtime/calendar-budget.spec.ts test/runtime/calendar-authority.spec.ts test/runtime/calendar-operation.spec.ts test/runtime/calendar-confirmation.spec.ts test/runtime/calendar-recovery.spec.ts test/runtime/calendar-multi-recovery.spec.ts test/runtime/calendar-recovery-unavailable.spec.ts test/runtime/calendar-preflight.spec.ts test/runtime/calendar-publication.spec.ts test/runtime/execution-reservations.spec.ts test/model/calendar-adapter.spec.ts test/model/calendar-repair-flow.spec.ts test/model/calendar-usage.spec.ts test/model/observation-writer.spec.ts test/http/chat-http.spec.ts test/http/calendar-boundary.spec.ts test/http/calendar-stream.spec.ts test/operations/readiness.spec.ts
npm.cmd test -- --maxWorkers=1 test/performance/memory-calendar-state.spec.ts test/http/service.spec.ts test/http/session-actions.spec.ts test/http/stream-transport.spec.ts test/http/sse-writer.spec.ts test/http/validation.spec.ts test/http/voice-exclusion.spec.ts test/http/calendar-status.spec.ts test/context/calendar-context.spec.ts test/contracts/calendar-accounting.spec.ts test/contracts/calendar-model.spec.ts test/contracts/calendar-tools.spec.ts test/benchmark/webrtc-voice.spec.ts test/operations/telemetry.spec.ts
npm.cmd run build
npm.cmd run lint
```

The broad command included the nonexistent filter path `test/http/chat-http.spec.ts`; a filter argument is not proof a file ran. Use the actual 27-file Vitest result. Relevant existing HTTP service/transport coverage was separately executed in the 14-file matrix. No empty discovery exit was treated as passing test evidence.

## Worker delta relative to entry

Modified files already untracked at entry:

- `backend/src/chat-runtime/memory-first-foundation.ts`
- `backend/src/chat-runtime/memory-text.ts`
- `backend/src/persistence/memory-text-archive.ts`

New files:

- `backend/src/chat-runtime/memory-calendar-ledger.ts`
- `backend/src/chat-runtime/memory-calendar-state.ts`
- `backend/src/persistence/memory-calendar-reader.ts`
- `backend/test/performance/calendar-memory-first.spec.ts`
- `backend/test/performance/memory-calendar-state.spec.ts`
- this report.

Initial Git status was inspected before changes. All tracked modifications listed at entry remain outside this worker's edit set. No existing report was rewritten. The new files have mandatory code headers and backend relative imports use `.js`. There is intentionally no claim of completed eligibility, native runtime migration, prefix promotion or final feature acceptance.
