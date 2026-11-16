# Task 3 — memory-first text implementation

7 November 2026. Implemented in the **unstaged, uncommitted working tree** based on `89e0d4ee94c14f92d383efd1e114a1b8b57463c9`. Deterministic focused verification passes; package-wide verification has failures, classified below. Review is **skipped**. Deployment, service compatibility and production latency remain unverified. The earlier investigation follows this report as historical evidence and does not describe the current source.

## Choices and public integration surfaces

- One `DurableChatRuntime.memoryText`, one `MemoryFirstFoundation` and one save-only `MemoryTextArchive` share the existing application identity, runtime work registry, persistence client and close owner. `AssemblyPorts.memoryFirstPolicy` selects an explicit policy, defaults to `PROPOSED_MEMORY_TEXT_POLICY`, or accepts `null` for the durable route. Native adapter validation fails startup when required store capabilities are absent.
- New/warm eligible text validates and reserves memory, assembles trusted context, runs the actual model adapter and publishes its terminal result without awaiting repositories. The next eligible text turn consumes the previous unsaved answer once. Each invocation uses a graph without a checkpointer; background saving publishes a compatible stock graph boundary. Calendar-enabled text and Calendar references retain durable execution. Cold Calendar-provenance history falls back to that route.
- Entry to voice/Calendar remains gated while plain memory is dirty. Durable entry invalidates the memory view and clears its publication marker under ownership; the next plain turn hydrates bounded trusted session/manifest/archive/attempt/checkpoint/order evidence. Hydration rejects oversized histories. Browser history is never an authority source.
- `MemoryFirstFoundation` exports `MemoryAcceptance`, `MemoryTurn`, `MemoryTerminal`, `TerminalEnvelope`, `SaveTerminal`, `SaveOutcome`, `SaveState` and `MemoryFirstPolicy`. `accept`, `complete`, `context`, `deliveries`, `session`, `history`, `find`, `byTurn`, `retrySave`, `drain` and `epoch` support subsequent integration. The production adapter currently accepts text envelopes only.
- Wire/API additions: optional `SubmitTurnRequest.expectedEpoch`, `SubmitTurnResponse.processEpoch`, status/history `save`, and stream status/completed `save`. Save facts are `{ state, epoch, version, durableVersion }`; states are pending/saving/saved/failed/unknown/fenced. Generation completion is independent of saving. A supplied old epoch is rejected before dispatch. Strict external clients require coordinated parser updates; browser retention is a later task.
- Pending session/history/status reads consult memory. Session lists overlay memory on the durable page but still await that index. Dirty rename/delete fails with retryable not-ready; clean mutation invalidates the view. Projection preserves title/pin, checks lifecycle and generation, and advances publication conditionally. Unknown release remains tracked. Shutdown shares one deadline across generation and raw saves and excludes persistence close while saves remain unresolved.
- Terminal entries release credential-bearing configuration snapshots and the extra accounting copy. Model accounting uses a volatile sink during execution; only the terminal accounting record is saved.

## Proposed finite defaults

These values are encoded-data/count limits, **not operator-approved memory allocations or measured V8/RSS ceilings**:

| Bound | Proposed value |
| --- | --- |
| Sessions / encoded bytes per session / total reserved bytes | 16 / 8,388,608 / 134,217,728 |
| Requests and turns per session | 128 each |
| Envelopes / bytes per envelope / reserved backlog bytes | 32 / 524,288 / 16,777,216 |
| Input / output / evidence encoded bytes | 65,536 / 131,072 / 16,384 |
| Adapter operations per save / concurrent saves / total attempts | 32 / 2 / 3 |
| Retry backoff / visible write timeout | 1,000 ms / 15,000 ms |
| Maximum dirty age / request retention / shutdown save drain | 60,000 ms / 300,000 ms / 20,000 ms |

Adapter-operation limits count explicit adapter work with additional ownership/checkpointer guards underneath; they do not certify wire commands or Azure RUs. Bounded session/request ledgers stay retained until restart. Automatic coordinated clean eviction is absent; calling foundation eviction without clearing integration maps is unsafe. At capacity admission rejects rather than losing dirty state.

## Verification and coverage

Environment: Windows PowerShell, Node v24.19.0, installed Vitest 4.1.11. All tests used deterministic provider/fake-driver fixtures and explicitly blank `AURVIN_TEST_MONGODB_URI`. No installation, `.env`/credential inspection, live service call, provisioning, staging or commit occurred. One initial MAW skill read preceded discovering the handoff's no-skills override; no subagent was dispatched.

| Check | Actual evidence |
| --- | --- |
| Prior implementation RED | Missing integration module; subsequent failing tests caught old-epoch acceptance, changed duplicate payload, sequence overflow, regressing hydration and legacy retry linkage. See handoff for earlier runs. |
| Current backend build/lint | Both exit 0; logs `aurvin-handoff-build.log` and `aurvin-handoff-lint.log` in the system temp directory. |
| First current focused matrix | 285 passed / 1 failed in 32 files. The Calendar-memory test selected a save adapter that its hybrid fixture could not provide. Supplying its explicit deterministic save port corrected the fixture without changing native admission or production code. |
| Focused matrix after correction | **286 passed, 32 files**; `aurvin-handoff-focused-green.log`. |
| Additional matrix coverage | **18 passed, 1 file**; `aurvin-handoff-matrix.log`. Added disconnect/partial-history follow-up, shared backlog rejection before paid work, and three-attempt cap/linkage checks. These checks passed on existing behavior; they are coverage evidence, not invented RED evidence. |
| Routine suite | Exit 1: **2,777 passed / 39 failed / 10 skipped**, 312 files, 150.88 s; `aurvin-handoff-routine.log`. This run began before the Calendar fixture correction and overlapped the build; do not call it final-source green. |
| Isolated failure classification | **32 passed / 11 failed**, 6 files; `aurvin-handoff-classification.log`. The built Calendar assembly passes when run after build. Remaining classifications and controlled comparison are recorded below as available. |

Runnable focused matrix from `backend`:

```powershell
$env:AURVIN_TEST_MONGODB_URI=''
npm test -- test/performance/memory-first-foundation.spec.ts test/performance/memory-first-text.spec.ts test/performance/memory-text-archive.spec.ts test/performance/voice-critical-path.spec.ts test/assembly/calendar-capability.spec.ts test/context/ test/runtime/execution-reservations.spec.ts test/runtime/identity.spec.ts test/runtime/work.spec.ts test/model/observation-writer.spec.ts test/voice/agent/voice-delivery.spec.ts test/operations/readiness.spec.ts test/http/
```

| Required behavior | Executed deterministic coverage |
| --- | --- |
| Blocked actual native writes through completion and follow-up | Archive test pauses a real fake-driver update; memory status/history and second model dispatch finish before releasing it. |
| Cold/legacy history and retry handoff | Text cold publication/hydration and archive durable-handoff/third-attempt tests; no inference replay and original user input/causal linkage preserved. |
| Idempotency during execution and multi-tab exclusion | Text tests hold actual fetch, replay the same submission, reject changed input and duplicate execution, and allow independent sessions. |
| Cancellation/disconnect and retry bound | Accepted cancellation without dispatch, running cancellation, disconnect partial-history follow-up, and three linked attempts followed by explicit rejection. |
| Bounded backlog and raw timeout | Foundation byte/count/age/concurrency tests plus runtime one-envelope ceiling reject before another fetch; foundation drain keeps unresolved raw writes. |
| Partial/unknown publication and tombstones | Archive partial-publication cold rejection, commit-then-error reconciliation, immutable payload identity, stale version and archived-session refusal. |
| Stream/status/history consistency | Text completed/status/save facts and memory history, provider failure/truncation, replay without inference; archive pending HTTP reads. |
| Calendar/voice preservation | Calendar-enabled test runs the durable loop; dirty text rejects live binding; saved handoff refreshes after durable graph execution; existing voice-critical-path and VoiceDelivery checks pass. This does not prove voice migration. |
| Close exclusion and composition | Archive OperationsService test excludes close during paused raw save; AppService native fake proves one default runtime/writer and one close after complete drain. |

Routine failures are not hidden or excused by filenames: six Windows guard/bootstrap cases cannot acquire their local helper; three Calendar cache cases reject unavailable retained decision history; Calendar recovery's injected failure does not reject as expected; multi-Calendar authority misses renewed clarification. Performance has load-sensitive 5 s timeouts, dependent missing measurements, and strict historical command/wave target failures. The built-module failure in the concurrent routine run is absent from the sequential classification run. No timeout or historical assertion was weakened. A controlled HEAD comparison is needed before assigning remaining failures to the baseline.

Controlled comparison subsequently completed: untouched HEAD was extracted to a temporary directory outside this checkout, reused installed dependencies through a junction, and built without installs. The same five non-performance files reproduce **11 failed / 31 passed** tests (`aurvin-handoff-baseline.log`), matching the **11 failures** in the current isolated classification run (the extra current passing test was the separately run built assembly). HEAD and current isolated `durable-latency.spec.ts` both report **19 failed / 42 passed**; logs are `aurvin-handoff-baseline-performance.log` and `aurvin-handoff-performance.log`. This establishes those individual isolated failures on HEAD; package-load timeouts are still reported independently rather than inferred pre-existing. The later voice/frontend work and its final checks are recorded in [the execution report](memory-first-remaining-tasks-implementation.md).

## Exact Task 3 paths and remaining ownership

New source/tests: `backend/src/chat-runtime/memory-text.ts`, `backend/src/persistence/memory-text-archive.ts`, `backend/test/performance/memory-first-text.spec.ts`, `backend/test/performance/memory-text-archive.spec.ts`.

Tracked modifications: `backend/src/agent/turn-graph.ts`, `backend/src/app.service.ts`, `backend/src/chat-runtime/durable-chat-runtime.ts`, `backend/src/chat-runtime/ports.ts`, `backend/src/contracts/api.ts`, `backend/src/contracts/repositories.ts`, `backend/src/contracts/runtime.ts`, `backend/src/contracts/session.ts`, `backend/src/contracts/stream.ts`, `backend/src/http/chat-http.service.ts`, `backend/src/operations/observe-persistence.ts`, `backend/src/operations/observed-runtime.ts`, `backend/src/operations/operations.service.ts`, `backend/src/operations/readiness.ts`, `backend/src/persistence/messages.ts`, `backend/test/assembly/calendar-fixture.ts`, `backend/test/performance/latency-runtime-fixture.ts`, `backend/test/performance/voice-critical-path.spec.ts`, `backend/test/persistence/calendar-multi-memory.ts`, `backend/test/runtime/calendar-runtime.fixture.ts`, `frontend/src/api/protocol.ts`, `frontend/src/api/protocol.test.ts`. Documentation: this report and the remaining-task handoff.

Task 2 source ownership delta is limited to the existing untracked `backend/src/chat-runtime/memory-first-foundation.ts`: bounded trusted hydration/archive, request/turn/history lookup, original-input retry linkage, epoch, caller-bounded drain, sequence overflow protection and monotonic replacement hydration. Task 2's tests/report and all Task 1/research inputs are preserved.

Remaining: voice integration is Task 4 and frontend/save UX is Task 5, following the existing Task 2 numbering; operator/recovery/measurement is the final gate. No new HTTP retry-save endpoint, browser retained key/epoch, optimistic sidebar migration, standalone voice accounting queue, automatic partial cold repair or operator policy approval is claimed by Task 3. No spool exists. A partial crash fails closed without model replay. Actual memory headroom, host termination time, native topology/service tests and the unknown Cosmos product/API/tier remain deployment prerequisites. Service/e2e/Azure/browser measurements were not run or counted as passing.

---

> Historical investigation below: superseded by the implementation report above and the approved handoff.

# Task 3 — earlier integration investigation

7 November 2026. This is a blocker/handoff report, **not implementation completion or passing integration evidence**. Ordinary text still follows the existing durable runtime. No latency reduction is claimed.

## Material scope decision

Task 3 requires immediate eligible text follow-up before persistence settles, while keeping the live voice path unchanged and excluding voice migration. These requirements need an explicit transitional cross-mode handoff policy for the **same conversation**. The Task 2 foundation has a text/live slot, but the existing live runtime does not use that slot or its history.

Concrete unsafe sequence:

1. A plain text turn completes in memory while its terminal save remains blocked. Its execution slot is released, as required for another text turn.
2. Another tab starts live voice bound to that conversation, or Calendar becomes enabled before the next text submission.
3. Current voice/Calendar admission reads durable session/attempt/manifest/checkpoint state. For a new unsaved conversation it cannot see the conversation; for an existing conversation it can see an older transcript. A process-local active-generation check alone no longer protects this boundary after text completion.
4. After terminal application projection eventually succeeds, the old durable graph boundary is still older unless the integration also deliberately reconstructs or publishes a compatible checkpoint. The durable runtime explicitly rejects the mismatch. Clearing the check or inventing receipts would undermine recovery/effect evidence.

This is not a request for external provisioning or permission to edit files. The unresolved choice is whether Task 3 may introduce temporary save-dependent **voice and Calendar admission** for conversations owned by the new plain path. That changes their admission behavior; silently introducing it would not justify reporting an unchanged voice path. Moving voice onto volatile history instead would widen into the explicitly excluded voice migration.

Recommended decision for the parent: authorize a bounded transitional handoff. Ordinary plain text remains memory-first. Entry to a durable voice/Calendar path on a dirty conversation returns a specific retryable not-ready response until a complete required publication and compatible graph boundary are confirmed; it must never start paid work from stale history. After durable execution, invalidate/re-hydrate the plain-memory view before another plain turn. Existing standalone voice and Calendar behavior remains on its current durable route. The alternative is to defer this integration until the shared voice authority is implemented. **Neither alternative is implemented here.**

## Source evidence

- [Foundation](../../backend/src/chat-runtime/memory-first-foundation.ts): `accept`, `complete`, `context`, `session`, and `drain` provide the volatile slot, version, terminal envelope and background writer. There is no cold hydration, cross-mode handoff, storage adapter or production caller.
- [Runtime](../../backend/src/chat-runtime/durable-chat-runtime.ts): constructor's reservation busy callback reads durable session execution; `submitLiveTurn` and `acceptNewTurn` use durable admission; `checkBoundary` and `loadHealthyContext` compare durable graph/manifest boundaries; `getLiveTurnStatus`, `findLiveSubmission` and `getLiveDelivery` read durable evidence. Ordinary status/replay currently requires durable terminal/checkpoint evidence.
- [Reservations](../../backend/src/chat-runtime/execution-reservations.ts): `acquire`/`bindConversation` reserve local mode slots before their injected busy check. `assertText` checks these mode slots, not foundation state. A live reservation can outlast one utterance; a handoff must cover reservation lifetime and terminal heard evidence, not just an individual model call.
- [Voice bridge](../../backend/src/voice/agent/agent-voice-adapter.ts): finalized speech uses durable dedup/status/recovery and delivery callbacks. Reusing a generated text result here would not establish heard evidence.
- [Graph](../../backend/src/agent/turn-graph.ts) and [finalization](../../backend/src/chat-runtime/finalization.ts): text and Calendar currently share the stock saved graph boundary; Calendar retains durable cursor/execute ordering. Changing global `graphConfig` durability is not an isolated plain-path strategy.
- [Composition](../../backend/src/app.service.ts): `createRuntime` supplies one application runtime to operations/HTTP and the voice bridge. `projectCurrent` projects changing Calendar eligibility. A second runtime or writer per HTTP request cannot solve the handoff.
- [Operations](../../backend/src/operations/operations.service.ts) and [readiness](../../backend/src/operations/readiness.ts): generation admission currently awaits the cached dependency probe, including database/executor checks. This must be addressed for a validated plain path separately from startup validity and durable voice/Calendar admission. It was not disabled.
- [HTTP](../../backend/src/http/chat-http.service.ts): session/status/messages currently consult durable repositories. A plain-path integration needs authoritative pending-session reads and bounded paging overlays together, not just a faster `executeTurn` branch.
- [Storage](../../backend/src/persistence/store.ts), [sessions](../../backend/src/persistence/sessions.ts), [memory](../../backend/src/persistence/memory.ts), [messages](../../backend/src/persistence/messages.ts), and [metadata](../../backend/src/persistence/metadata.ts): actual stored receipts/CAS and immutable IDs are available; existing session schema has no independent plain publication watermark. Final-only projections and partial-publication readers must change together.

## Task 3 implementation status and handoff

No save adapter, cold hydration, application-owned foundation composition, limit configuration, memory metrics port, plain graph strategy, save-state wire API, HTTP overlay, or lifecycle wiring was added. No frontend or voice-worker integration exports exist beyond the unchanged Task 2 exports described in [Task 2](memory-first-task-2-implementation.md). There are no enabled eligibility defaults and no changed completion semantics in running code. Proposed configuration values must still be distinguished from operator-approved memory limits; the foundation continues to require explicit validated policy.

The eventual implementation must test the cross-mode sequence above in addition to the requested blocked-writer text dispatch/delta/completion/immediate-follow-up checks. A terminal-only save must publish dependencies before a monotonic visibility watermark, condition against tombstones, reconcile unknown outcomes by stable IDs, and never replay inference. A successful local text test cannot establish these properties.

The existing Task 1/2 reports and historical performance thresholds are unchanged. Cosmos product/API/tier, operational memory headroom and service admission remain unresolved. No Azure or production compatibility claim is made.

## Checks actually run

From `backend`, deterministic fixtures only:

```powershell
npm test -- test/performance/memory-first-foundation.spec.ts test/context/ test/runtime/execution-reservations.spec.ts test/runtime/identity.spec.ts test/runtime/work.spec.ts test/model/observation-writer.spec.ts test/voice/agent/voice-delivery.spec.ts
```

Result: **201 passed across 18 files**, Vitest 4.1.11, reported duration 3.20 seconds. This confirms the unchanged foundation and selected existing contracts only, not Task 3 integration. The existing Vite tsconfig-paths deprecation warning is nonfatal.

A preliminary attempt to create/run `memory-first-text.spec.ts` used a repository-relative path from the backend working directory. File creation failed and Vitest reported no test files. No test file was created; **this is not failing-test-first RED evidence**. No implementation followed it.

Build, lint, full routine suite, historical performance suite and new Task 3 integration matrix were not run. Their earlier Task 2 results remain earlier evidence; no current failure comparison or pre-existing-failure claim is made. No service suites, database/provider/Azure calls, credentials or `.env` inspection, dependency installation, staging, commits, skills or agents were used. Review remains skipped.

## Exact workspace delta

Initial `git status --short` listed seven untracked user-owned files: the foundation, its test, the three Task 1/2 documents and the two research reports. No tracked changes or staged files were present.

Only this report was added:

- `docs/performance/memory-first-task-3-implementation.md`

**Task 2 ownership delta: none.** Its foundation, tests and evidence document were not modified. Previous documents, root instructions, workflow state, tracked code and all initial untracked files were preserved. No partial runtime migration was left enabled.
