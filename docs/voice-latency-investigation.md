# Voice latency investigation — 3 November 2026

## Outcome

Implemented five targeted changes:

1. **Parallel speech startup:** `backend/src/voice/session/live-flow.ts` connects recognition and synthesis concurrently. Failure aborts pending connection work and closes successful peers, including late arrivals. Initial startup and paused-call reopening share this path.
2. **Fewer ownership round trips:** `backend/src/chat-runtime/durable-chat-runtime.ts` groups initial manifest/checkpoint bootstrap into one bounded storage-only phase, and groups the two required generation-identity persistence operations into another. No model request, client callback, or playback wait is inside either phase. Writes, deadline/operation bounds, and the identity-before-output barrier remain required. Local journal mode retains its existing strict behavior.
3. **No redundant pre-execution voice status reads:** the existing fresh, store-confirmed admission evidence supplies the idle accepted status. Running work, expired evidence, cancellation, and recovery use durable reads; reservation validation still runs first.
4. **No repeated linkage reads for every speech journal update:** `backend/src/persistence/metadata.ts` can consume the existing store-bound attempt/input receipts while the runtime owns the execution lease. It verifies receipt provenance, collection/key, user/session/turn/attempt/input linkage, and live/internal classification. Missing evidence and recovery retain the strict database lookup path. Voice journal CAS and immutable bindings remain unchanged. This removes **two reads per journal write**, including the first generated-prose persistence before speech.
5. **Correct voice lease lifetime:** the text combined `finishAttempt` operation was also releasing voice ownership before `live.settle()` journaled completion/playback. A real-repository offline fixture reproduced `INTERRUPTED: Execution ownership was lost`. Voice now clears the completed attempt but retains its lease until settlement and tracked writes drain; text keeps its combined release. The regression verifies completed heard evidence and eventual lease release.

**These fixes are implemented, but live end-to-end latency improvement is not measured.** No paid microphone/provider reproduction was performed. Database inspection commands were read-only; no manual chat-record edits, fixture create/drop against the application database, credential changes, model changes, or threshold changes were made. No explicit application restart was issued; an already-running development watcher may reload edited source.

## Read-only evidence

The newest stored voice delivery was associated with an attempt created at `2026-11-03T06:01:50.241Z`. Its model accounting recorded dispatch at `06:02:06.331Z` and first output at `06:02:18.005Z`:

- Attempt creation to provider dispatch: **16.090 seconds**. This interval spans application admission/execution work; it is not an individual Mongo query measurement or a speech-end timestamp.
- Recorded dispatch-to-first-output metric: **11.673 seconds**. **Correction to the initial session summary:** `OpenRouterAttemptAdapter` starts this clock before its dispatch-accounting save and timestamps first output after the generation identity barrier. It therefore includes local persistence waits and cannot be attributed entirely to external model compute/network latency. The requested model was `anthropic/claude-haiku-5.5`.
- The initial graph boundary checkpoint timestamp was `06:01:54.613Z`; graph input/loop checkpoints were timestamped `06:02:02.924Z` and `06:02:02.927Z`. These are checkpoint creation timestamps, not write-acknowledgement timings.
- The associated attempt was ultimately interrupted and delivery unknown; it must not be represented as a successful completed response.
- The saved session had no active attempt or lease owner at inspection. A `currentOp` snapshot reported no operations waiting for a lock. This does not exclude historical lock/queue delays during the slow response.
- Initial sampled metadata/checkpoint reads took approximately **3–12 ms**; ten executor-record lookups took **3–6 ms**. Later representative scoped reads varied substantially: session **29–38 ms**, attempt **10–40 ms**, latest-turn attempt **50–304 ms**, checkpoint **40–179 ms**. These are observations under differing load, not stable percentiles or historical write timings. An unscoped idempotency probe was not identical to the repository's actual primary-key-filtered lookup and is not evidence of that method's cost.
- Checkpoint compound lookup indexes were present. `serverStatus` was unsupported, so storage-engine lock/disk statistics were unavailable.
- Bootstrap configuration had local crash recovery disabled. Stored administrator settings take precedence for manageable model/speech settings; `.env` alone is not proof of their effective values.

The server's `hello` response reports `msg: isdbgrid` and `internal.kind: azuredocumentdb`, with DocumentDB version identifiers. It is **not a verified native MongoDB replica set**, despite the bootstrap `native-mongodb` profile and localhost connection. The user subsequently supplied the nonsecret endpoint suffix `.global.mongocluster.cosmos.azure.com:10260`, confirming an Azure-hosted DocumentDB endpoint (formerly Azure Cosmos DB for MongoDB vCore). Local application execution therefore does not imply local database execution. The server response alone did not establish hosting; the supplied hostname resolves that earlier uncertainty. Azure/DocumentDB compatibility remains uncertified; no automatic migration or database replacement was attempted.

**Correction to the initial listener check:** `run.bat` uses **8001/5179**, not package defaults 3000/5173. Both actual listeners were present. A read-only request to `/api/operations/metrics` reported 13 Mongo reads totaling 6427 ms, maximum 1932 ms; pool wait maximum was 1 ms. Runtime active work and unresolved writes were both zero at that snapshot. These process-lifetime aggregates are not a correlated voice-turn trace, but they establish that real application database operations can be much slower than the earliest direct probes.

## Remaining bottlenecks and boundaries

The substantial historical pre-dispatch delay is **not claimed eliminated**. The fixes remove demonstrated unnecessary round trips and a reproduced lease-lifetime defect, but durable admission, context validation, and synchronous checkpoints remain. Capture the existing correlated `voice-pipeline` and persistence/runtime diagnostics during the next reproduction: `stt-end-of-turn`, `response-prepared`, `model-first-output`, `tts-first-submit`, `tts-first-audio`, and `playback-first-ack`. Separate wire-frame timing from the persistence-inclusive stored first-output timer.

The deterministic shared first-turn comparison recorded **98 → 94 reads**, **42 → 42 writes**, pre-dispatch dependency waves **56 → 54**, and first-answer waves **65 → 61**, toggling only the two new storage phases. These are offline command/dependency counts, not live millisecond savings. Separate voice regressions prove **two → zero** status reads at fresh handoff and **two fewer linkage reads per journal write**, with unchanged write counts and completed heard evidence.

The default checkpoint path validates checkpoint/pending-write data and then lets the stock saver reread it: normally four reads instead of two for a nonempty checkpoint. An existing bounded facade avoids duplication, but its native conformance activation gate remains open in `docs/latency-reduction/verification.md`. It was **not enabled** merely on the strength of offline tests or application-data reads. Use an operator-authorized isolated native test database for that gate; never run create/drop fixtures against the application database.

Running Aurvin locally does not make OpenRouter/Deepgram local. No paid warm-up, automatic inference replay, provider/model switch, reduced durability, relaxed lease checks, or speculative speech submission was introduced.

## Verification

- Startup, missing ownership phases, repeated status reads, and repeated journal linkage reads each had failing regressions before the fixes. The real-repository voice fixture additionally exposed the premature lease release.
- Latest focused six-file selection: **97 passed**. An earlier broader voice/runtime/persistence selection passed **290 / 8 skipped** before adding the real-repository voice regression.
- Full parallel routine run at that point: **2474 passed / 18 failed / 10 skipped**. Seventeen failures were in frozen performance/context-ceiling scenarios; one was the existing built-artifact rebuild/import race. The built assembly passed when run alone after a build.
- A separate read-only `git archive HEAD` baseline exported under the approved temp directory, using installed dependencies, reproduced the **same 17 performance test failures** (44 passed). These were not waived or rebased, and no application database was used.
- Concurrent user-owned voice-delivery work changed during broad testing; a later parallel correctness run had one failure in that evolving test file. Its six-file rerun passed. **Final serial correctness run: 2437 passed / 10 skipped, 279 passing files / 2 skipped**, excluding only the independently failing frozen-performance file. It includes the built assembly test and all new regressions. Full-suite performance acceptance is still not passed.
- Backend build passed.
- Backend lint exited successfully with warnings, including existing repository warnings and the established unbound-method test pattern.
- Live speech, paid provider, browser playback, and native create/drop suites were not run. Review was skipped; no reviewer or other agent was dispatched for this task.

The user's existing `backend/src/instructions/system.md` changes and concurrent speech-delivery/provider changes were preserved. This report claims only this session's startup, runtime, receipt-linkage, and matching regression changes.

The checkout advanced during testing to concurrent commit `b088bb5` (`fix(voice): keep long answers alive across one TTS reconnect`), which also includes the parallel-startup change/tests. The user subsequently requested a commit of this session's remaining runtime/persistence fixes, regressions, and report. That follow-up commit excludes the user's unrelated `backend/src/instructions/system.md` changes.
