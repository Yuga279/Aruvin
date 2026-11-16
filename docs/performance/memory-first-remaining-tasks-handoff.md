# Memory-first remaining work — handoff

> **Execution update, 7 November 2026:** Task 3's current implementation report is now written. Subsequent text/voice, observation-writer and frontend/save-retry changes are recorded in [execution evidence and remaining admission gates](memory-first-remaining-tasks-implementation.md). Everything remains unstaged and uncommitted. The snapshot below is retained as the original handoff; its statements that voice is exclusively durable and frontend behavior is unchanged are superseded by that report. Package-wide failures and deployment gates remain open; this is not a production-readiness declaration.

7 November 2026. Working tree based on `89e0d4ee94c14f92d383efd1e114a1b8b57463c9`, Node `v24.19.0`, installed Vitest `4.1.11`, Windows PowerShell. **Task 3 implementation exists in the working tree; final verification and its implementation report are unfinished.** This handoff supersedes the old blocked status in the Task 3 investigation. No production performance or readiness claim is made.

## Resume instructions and authorization

- Read root `AGENTS.md` and the Task 1/2 documents below. The user explicitly approved the transitional cross-mode handoff; do not ask for that approval again.
- The latest user constraints override the repository workflow instructions: **no skills, subagents, staging or commits**. Preserve all tracked and untracked changes. No installs, provisioning, live database/provider/Azure calls, credentials or `.env` inspection.
- Use existing deterministic Vitest fixtures and failing-test-first practice. Keep mandatory source headers and backend ESM `.js` imports. Do not weaken historical performance thresholds or safety tests. Review remains **skipped**.
- No source changes should be inferred committed. The index was empty at handoff. No known tool process remains running; the last commands returned completion.

Inputs:

- [Task 1 contract](memory-first-task-1-contract.md)
- [Task 1 baseline](memory-first-task-1-baseline.md)
- [Task 2 implementation and exports](memory-first-task-2-implementation.md)
- [Earlier Task 3 investigation and approved handoff](memory-first-task-3-implementation.md)
- [Recovery research](persistence-recovery-workarounds-research-2026-11-07.md)
- [Latency research](../../CONVERSATION_LATENCY_RESEARCHER_2.md)

## Current implementation

Ordinary text is connected through `DurableChatRuntime.memoryText`, using one `MemoryFirstFoundation`. `AppService` enables it by supplying `PROPOSED_MEMORY_TEXT_POLICY`; `AssemblyPorts.memoryFirstPolicy` accepts an explicit policy or `null` for the durable path. The constructor validates finite foundation limits. Proposed defaults are **not operator-approved memory sizes or measured V8/RSS ceilings**.

- New/warm plain text accepts, assembles context, invokes the actual model adapter, streams and completes in memory without awaited repository work. Eligible follow-up consumes the previous unsaved answer once. Model accounting observations use an in-memory sink; only the terminal accounting snapshot is projected.
- Plain LangGraph invocation has no checkpointer. Background projection publishes a compatible stock graph boundary for later durable execution; global Calendar graph durability was not changed.
- Calendar-enabled text and replies carrying Calendar references retain the durable route. Cold history with Calendar provenance falls back to the durable route. No lexical intent guessing is used.
- Entering voice/Calendar on a dirty plain conversation is rejected until full save confirmation. Durable execution marks the memory view stale; the next plain admission hydrates trusted storage again. Both durable new-turn and retry entry clear the plain publication marker under real ownership.
- Cold hydration loads the session, manifest, referenced context, bounded attempts/archive pages, graph boundary, optional voice delivery evidence and ordering counter. It never accepts browser history. Limits reject oversized histories rather than silently truncate them.
- Status, stream terminal frames and memory history expose independent save facts. Accepted responses optionally include `processEpoch`; submissions optionally accept `expectedEpoch`. A supplied old epoch is rejected before dispatch. **Existing clients that do not retain/send an epoch still lack restart-ambiguity protection.** Browser key/epoch retention is outstanding.
- Pending session/history/status reads consult memory. Session lists overlay memory rows onto durable pagination. List requests still await the durable index; optimistic sidebar/freshness UX is not implemented.
- The save adapter writes terminal absolute records, acceptance/accounting/order evidence, manifest, compatible checkpoint boundary and a conditional session watermark. It does not replay old generating/finalizing transitions or inference. Immutable records are compared by stable IDs; retries skip confirmed matching records. Partial cold publications are hidden/rejected using `memoryPublication`.
- Rename/delete during dirty state returns retryable not-ready. Clean mutation invalidates the memory view. Projection checks lifecycle, lease generation and publication version, preserves title/pin and uses monotonic activity updates.
- Shutdown retains raw saves and refuses persistence close while saving is unresolved. Generation and save drain share the requested deadline. Unknown ownership release is retained and reconciled on save-only retry.
- Terminal entries release credential-bearing snapshots and the extra accounting copy. Public config revisions, bounded identity evidence and results remain retained.

Main new implementation files:

- [Text integration](../../backend/src/chat-runtime/memory-text.ts)
- [Save-only native adapter](../../backend/src/persistence/memory-text-archive.ts)
- [Runtime integration tests](../../backend/test/performance/memory-first-text.spec.ts)
- [Projection/lifecycle/composition tests](../../backend/test/performance/memory-text-archive.spec.ts)

Task 2 ownership delta is limited to [the foundation](../../backend/src/chat-runtime/memory-first-foundation.ts): trusted bounded cold hydration/archive retention, request/turn/history lookup, retry linkage/original user identity, an epoch getter, caller-bounded drain, sequence-overflow admission protection and monotonic hydration. Replacement hydration charges replace the old source charge. The original Task 2 test and evidence document were not edited.

Known ceilings: the integration retains its bounded session/request ledgers until restart; automatic coordinated clean eviction is not implemented. Do not call `foundation.evictClean` behind the integration's other maps. Dirty state is never silently evicted. Adapter operation ceilings count explicit adapter operations, with existing ownership/checkpointer guards underneath; they are not a certified Mongo wire-command or RU cap.

## 1. Finish Task 3 verification and reporting first

The last implementation change added native save-adapter admission validation and corrected a legacy Calendar assembly fixture. That hybrid fixture lacks a full native `RecordStore` and now explicitly selects the durable path. A new AppService/native-fake composition test verifies the actual default memory path, no Calendar tools without an account, one runtime/writer and one close after drain. This fixes a **newly introduced assembly timeout**, not a presumed baseline failure.

Required next actions:

1. Run backend build/lint and focused checks on the current source. The last successful build/lint preceded that final constructor/fixture change. The last focused run **after** the change passed `calendar-capability.spec.ts` and `memory-text-archive.spec.ts`: **24 tests, 2 files**.
2. Run the routine package suite with native integration explicitly disabled. Save full output outside the checkout. Classify remaining failures; do not claim all are pre-existing merely because their filenames appeared before. Do not extend timeout budgets or weaken assertions to make the suite green.
3. Recheck the full required matrix: actual blocked native writes through dispatch/delta/completion/follow-up, cold/legacy hydration, idempotency during execution, three-attempt linkage across handoff, cancellation/disconnect, bounded backlog, partial/unknown saves, tombstones, stream/status/history consistency, Calendar barrier and voice preservation, and shutdown close exclusion. Existing new tests cover much of this; identify actual coverage gaps rather than assuming source presence is evidence.
4. Complete `memory-first-task-3-implementation.md` with current choices/defaults, API exports, exact changed paths, RED/GREEN and package evidence, limitations and remaining ownership. Preserve its earlier investigation as history or clearly supersede it. It still contains the old investigation body; the status notice now directs here.
5. Validate links, `git diff --check`, headers and named-file ownership. Leave everything unstaged and uncommitted.

Suggested focused command from `backend`:

```powershell
npm test -- test/performance/memory-first-foundation.spec.ts test/performance/memory-first-text.spec.ts test/performance/memory-text-archive.spec.ts test/performance/voice-critical-path.spec.ts test/assembly/calendar-capability.spec.ts test/context/ test/runtime/execution-reservations.spec.ts test/runtime/identity.spec.ts test/runtime/work.spec.ts test/model/observation-writer.spec.ts test/voice/agent/voice-delivery.spec.ts test/operations/readiness.spec.ts test/http/
```

No current service-backed compatibility, staging, browser/device or production latency measurements exist. Cosmos product/API/tier remains unknown.

## 2. Voice integration

Task 2 calls this Task 4; task numbering should be reconciled with the user's frontend-task naming before scheduling, without changing the scope by assumption.

- Extend the **same** foundation/writer and lifecycle. Do not create a second runtime, persistence owner or per-socket unbounded queue.
- Keep generated text, synthesized output, proven heard text and unknown hearing distinct. Use existing `VoiceDelivery` proof/settlement ownership; never manufacture hearing evidence.
- Move ordinary speech/model/socket observations off setup, first Speak/PCM, playback-report and next-utterance boundaries. Preserve quota admission, identity, epochs, interruption/barge-in and bounded unknown-delivery settlement.
- Retain durable Calendar effect barriers. The approved Task 3 gate remains necessary until voice can consume memory authority safely.
- Add blocked-writer same-call follow-up and barge-in tests using existing voice fixtures; saving retry must never repeat inference or TTS.

Relevant current exports: `MemoryFirstFoundation.accept/complete/context/deliveries/session/saveState`, `MemoryTurn`, `MemoryTerminal`, `TerminalEnvelope`, `SaveTerminal` and `SaveOutcome`. Voice evidence is supported by the foundation but the production voice route is still durable.

## 3. Frontend behavior and save UX

Only API types/strict parser support changed in this task; no chat/sidebar/voice UX migration was performed.

- Retain the original submission key/payload through ambiguous POST delivery. Persist and send the optional `expectedEpoch` where available; distinguish unknown old-process outcomes from an explicit new attempt.
- Treat `completed` as generation completion in memory. Use `save.state`, `save.version`, `save.durableVersion` and `save.epoch` for saving facts. A complete answer may still be pending, failed or unknown remotely.
- Add pending sidebar rows and version-aware reconciliation. Preserve unsaved messages, active selection and rename/pin state against stale list/history responses; avoid compulsory list refresh after every turn.
- Add useful pending/failed/unknown save status and a save-only retry action. **There is no new HTTP retry-save endpoint yet**; the internal foundation retry uses its existing finite total-attempt/backoff budget. Define the endpoint/client contract without silently resetting that budget or invoking the model.
- Keep drafts/copies/export as user recovery aids, never trusted backend history, billing evidence or tool authority. Browser recovery and spoken replay are separate decisions.

Wire additions already understood by the included parser:

- `SubmitTurnRequest.expectedEpoch?: string`
- `SubmitTurnResponse.processEpoch?: string`
- `TurnStatusResponse.save?`, `ListMessagesResponse.save?`
- Stream `status.save?` and `completed.save?`
- Save shape: `{ state, epoch, version, durableVersion }`; states are pending/saving/saved/failed/unknown/fenced.

Old strict external clients may need a coordinated parser release. Do not advertise universal backward compatibility.

## 4. Recovery, operator policy and final measurement

- Unsaved memory/accounting may be lost on process death, as approved. No spool was added.
- Complete plain publications are compatible with durable history and subsequent graph execution. A crash during partial terminal publication currently fails closed; automatic cold repair of every partial projection is **not implemented**. Specify record-driven sealed-result repair or an honest unknown/interrupted outcome without model replay. Never infer “not dispatched” from absent storage.
- Establish actual host memory headroom, process/rollover enforcement, graceful termination time, native/Azure product capabilities and isolated test authorization before deployment admission. The proposed policy is not operator approval.
- Finish deterministic failure classification before requesting separately authorized native/service/browser measurements. Measure complete commands/document mutations after background settlement, save lag, actual fetch/first output and next-turn readiness. No p50/p95 promise follows from fake-driver timing.
- Keep the original six collections. No transactions, new infrastructure, live tools, compaction, cross-session retrieval or voice migration should be introduced incidentally.

## Verification evidence available now

| Check | Actual evidence |
| --- | --- |
| Initial Task 3 RED | Missing integration module; suite could not import. Subsequent RED cases caught ignored old epochs, duplicate retry payload changes, sequence-overflow corruption, regressing hydration and legacy retry handoff. |
| Focused backend before final constructor/fixture correction | **56 passed, 4 files**: foundation, text integration, archive integration and voice critical path. |
| Latest focused check after that correction | **24 passed, 2 files**: Calendar capability assembly and archive/composition checks. |
| Backend build | Passed before the last constructor/fixture correction; rerun current source. |
| Backend lint | Exit 0, **647 warning lines**, none naming the new memory files; before last correction. |
| Frontend build/lint/tests | Passed; **671 tests, 80 files**. Lint warnings and Vite chunk-size warning remain outside the protocol edits. |
| Historical standalone performance | **44 passed / 19 failed**, 63 tests. Thresholds unchanged; voice passed with a memory-enabled preservation check. |
| First routine run | **2,779 passed / 34 failed / 10 skipped**, 312 files, 96.18 s; before later handoff/fixture refinements. |
| Second routine run | **2,779 passed / 36 failed / 10 skipped**, 312 files, 103.77 s; before the final assembly-fixture correction. Not a final-source green result. |

The second routine run failed in `assembly/calendar-capability`, `assembly/calendar-simplification.built`, `operations/local-guard`, `persistence/local-open`, `performance/confirmed-state-cache`, `performance/durable-latency`, `runtime/calendar-recovery-unavailable` and `integration/plugins/multi-calendar/authority`. Calendar capability was subsequently reproduced and corrected as described above. Other failures overlap reported Task 2 files, but there is no controlled package-wide baseline establishing that every individual failure is pre-existing. Performance cases include load-sensitive timeouts and strict historical command gates; do not hide either.

Logs outside the checkout:

- `C:/Users/Peter/AppData/Local/Temp/aurvin-task3-routine-47918002b0fa487f91fc282009bc1540.log`
- `C:/Users/Peter/AppData/Local/Temp/aurvin-task3-final-routine-e856d8b94d9544c18b6d5abfb8d44ba2.log`
- `C:/Users/Peter/AppData/Local/Temp/aurvin-task3-verified-lint-f67340c3e9e34fe287473f5dad8a2e17.log`

Routine commands explicitly set `AURVIN_TEST_MONGODB_URI` to an empty value without reading credentials, preventing service-backed native fixtures from running. No e2e/service/Azure suite was run or counted as passing.

## Exact implementation worktree paths

Tracked modifications:

```text
backend/src/agent/turn-graph.ts
backend/src/app.service.ts
backend/src/chat-runtime/durable-chat-runtime.ts
backend/src/chat-runtime/ports.ts
backend/src/contracts/api.ts
backend/src/contracts/repositories.ts
backend/src/contracts/runtime.ts
backend/src/contracts/session.ts
backend/src/contracts/stream.ts
backend/src/http/chat-http.service.ts
backend/src/operations/observe-persistence.ts
backend/src/operations/observed-runtime.ts
backend/src/operations/operations.service.ts
backend/src/operations/readiness.ts
backend/src/persistence/messages.ts
backend/test/assembly/calendar-fixture.ts
backend/test/performance/latency-runtime-fixture.ts
backend/test/performance/voice-critical-path.spec.ts
backend/test/persistence/calendar-multi-memory.ts
backend/test/runtime/calendar-runtime.fixture.ts
frontend/src/api/protocol.ts
frontend/src/api/protocol.test.ts
```

New implementation/test files are the four linked above. Existing untracked foundation source was modified as explicitly described; its test and Task 1/2 documents/research inputs remain preserved. The existing Task 3 investigation gains only a superseding notice linking to this handoff. This handoff is new. Root instructions, earlier workflow state and prior research documents were not rewritten.
