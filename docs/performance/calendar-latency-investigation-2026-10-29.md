# Calendar latency investigation — 29 October 2026

## Conclusion

**Sequential persistence and checkpoint barriers are a demonstrated latency amplifier in the current runtime. Calendar adds more of those barriers and usually a second model call. The supplied benchmark report does not establish that provider TTFT dominates real latency.**

Several optimizations exist but are only partly connected to the execution path: admission receipts retain context that attachment rereads, ownership phases are used for acceptance but not publication, and the combined terminal release primitive has no runtime caller. These gaps explain why the earlier point-read improvements do not make the complete path fast.

This investigation made **no application-source, configuration, model, dependency, database, deployment, or provider changes**. Existing uncommitted benchmark work was preserved. No paid calls, external Calendar reads/mutations, or application backend starts/restarts were performed. Unified review remains **skipped**, not passed. This is an investigation, not an optimization implementation or production performance certification.

## Scope and evidence

- Checkout: `main`, HEAD `35eb6e85d0b80f3d88abf32218120ce19a7a32d8`, plus the pre-existing uncommitted benchmark instrumentation listed by `git status`.
- Traced acceptance → stream attachment → context → graph → model observations → Calendar reads/creates/preflight/proposals → durable publication → ownership release → HTTP terminal delivery. Also checked live-voice wiring and benchmark interpretation.
- Reran the existing deterministic performance suites against this working tree: **3 files / 48 tests passed**, twice, including a verbose evidence run.
- Raw verbose evidence: `C:/Users/Peter/AppData/Local/Temp/opencode/calendar-latency-current-probes.log`.
- Commands, from `backend/`:

  ```text
  npm test -- test/performance
  npm test -- test/performance --silent=false --reporter=verbose
  ```

- Additional focused verification completed in the background: **88 files / 933 tests passed** using `npm test -- test/benchmark test/model test/operations test/runtime/calendar test/plugins/google-calendar test/http/calendar-stream.spec.ts test/assembly/calendar-capability.spec.ts --maxWorkers=1` from `backend/`. These are deterministic regression checks, not live latency certification.
- Document checks: all **42 links** resolve locally or are external references; no trailing whitespace; `git diff --check` passed. Only this new investigation document was added by this task; no commit was created.
- No new instrumentation was necessary to reproduce amplification: the existing [whole-runtime fixture](../../backend/test/performance/latency-runtime-fixture.ts) composes real persistence, ownership, observer, stock MongoDB saver and runtime code over a BSON fake driver, with scripted model/Google responses. Calendar capability/credential services remain simplified fixtures; the real connection/discovery service is covered by separate probes, not by this complete-runtime composition.

## 1. Reproduced whole-runtime dependency profile

All values below are **synthetic dependency-wave elapsed time**, using 67 ms per read and 449 ms per write, not live wall-clock latency or percentiles. Model and Google transports return scripted responses without simulated network/model generation time. The profile starts before submission and ends after runtime terminal delivery; it does not run the HTTP transport/browser or its post-completion status request.

| Scenario | First model dispatch | First answer delta | Terminal delivery | Driver reads / writes | Saver reads / writes |
| --- | ---: | ---: | ---: | ---: | ---: |
| New text, no Calendar runtime | 13.650 s | 15.533 s | 30.838 s | 159 / 46 | 31 / 12 |
| Text follow-up, 20 prior turns | 11.787 s | 13.670 s | 29.109 s | 159 / 42 | 33 / 11 |
| Calendar-enabled text, no tool | 16.337 s | 16.920 s | 29.404 s | 151 / 44 | 31 / 12 |
| Calendar event read + answer | 16.337 s | 28.171 s | 40.655 s | 205 / 61 | 33 / 16 |
| Calendar create + answer | 16.337 s | 34.845 s | 47.329 s | 251 / 69 | 33 / 16 |
| Calendar conflict question | 16.337 s | 35.475 s | 35.475 s | 188 / 52 | 32 / 14 |
| Confirm an existing proposal | 26.482 s | 27.065 s | 39.616 s | 222 / 56 | 33 / 11 |

Interpretation:

- **16.337 s before the first Calendar model call cannot be provider TTFT:** the provider has not been called yet.
- Read/create have **11.834 / 18.508 s between initial dispatch and first answer text**, despite instant fixture transports. This includes round-one processing, tool/evidence work, intervening checkpoints and narration dispatch; it is not a measurement of Google latency.
- Calendar text/read/create all retain **12.484 s after the first answer delta**. Of this, **6.768 s follows the finalization-start marker**. The earlier portion includes final model observations, decision/aggregate evidence and graph sealing.
- A proposal confirmation executes authorized Calendar work before the first model call, so its late dispatch does **not** mean 26 seconds of context assembly. Phase labels can group different business work.
- A conflict clarification is emitted as a Calendar-specific event before the final durable text replacement. `firstDeltaMs` does not measure first honest feedback or the first clarification card.
- The 0 ms dependency profile completes at 0 simulated ms by construction. It does not prove zero CPU or serialization cost.

The [scheduler](../../backend/test/performance/dependency-probe.ts#L40) defaults to **wave** mode: simultaneous reads/writes advance to the longest duration in the wave. This can overstate mixed-duration overlap compared with its timer mode. The whole-runtime tests currently use wave mode. Counts and ordering are useful evidence; these absolute values are not a calibrated forecast for a particular database.

## 2. Highest-priority causes and integration gaps

### A. Admission receipts do not reuse their validated context

**Confirmed by caller tracing; savings not independently measured.**

[AdmissionReceipt](../../backend/src/chat-runtime/admission-receipt.ts#L29) stores a manifest, original source records, refresh references, boundary, checkpoint identity, graph epoch, response mode and configuration revision. Its header describes avoiding repeated history and manifest validation.

But the [receipt attachment branch](../../backend/src/chat-runtime/durable-chat-runtime.ts#L762) uses only the released generation, input and sequence reservation, then calls `checkBoundary` again. [checkBoundary](../../backend/src/chat-runtime/durable-chat-runtime.ts#L225) reloads accepted history and manifest and calls `graph.getState`. The same operation already ran during [admission](../../backend/src/chat-runtime/durable-chat-runtime.ts#L350).

Source search finds the context/epoch fields being constructed, not consumed for attachment validation. `sessionGraphEpoch` is read during receipt construction but has no update caller. Receipt checkpoint IDs are constructed as `${sessionId}-0`, not obtained from the saver. These fields cannot simply be trusted as a completed invalidation protocol.

**Recommended direction:** finish the bounded same-process receipt fast path only after verifying real checkpoint/manifest identity, generation, configuration/mode, expiry and account/source lifecycle invalidation. Refresh volatile Calendar/voice evidence. Retain the strict recovery path for expired, evicted or invalid receipts. Do not skip boundary checks merely because an object is cached.

### B. Ownership batching exists only at acceptance

**Confirmed by all production callers.**

[MongoOwnership.run](../../backend/src/persistence/ownership.ts#L435), outside an owned phase, queues globally and performs an executor read plus a session-lease read before the action. [runPhase](../../backend/src/persistence/ownership.ts#L384) can share that fence across bounded database work, but runtime callers are only acceptance-stage/acceptance-publish in submission and retry.

[inPhase](../../backend/src/chat-runtime/durable-chat-runtime.ts#L87) is **diagnostic tagging**, not `owner.runPhase`: naming publication/model-observation phases does not batch their guards or remove serialization.

[Calendar publication](../../backend/src/chat-runtime/calendar-publication.ts#L274) still separately awaits assistant append, completion update, session activity, manifest update, graph boundary commit/confirmation, and attempt transitions. [Cleanup](../../backend/src/chat-runtime/durable-chat-runtime.ts#L1133) then clears the active attempt and separately releases ownership. `MongoOwnership.finishAttempt` [exists](../../backend/src/persistence/ownership.ts#L963), accepts confirmed terminal evidence and combines session cleanup/activity, but has **no production caller**. Confirmed message/accounting/attempt APIs also exist while much publication still invokes legacy read-before-write methods.

The complete fixture reports **63 ownership-origin reads for an event read and 61 for create**, counted from telemetry's **bounded detail sample** (128 details per scope). These are lower-bound observations, not complete ownership-read totals; the aggregate driver counts are not subject to that detail-sample cap. Total driver counts are substantially larger than repository-method counts.

**Recommended direction:** group only bounded, dependency-compatible database publication work using existing confirmed records and owned phases; connect the combined finish primitive where crash/replay contracts permit. Never hold a process-global phase across provider inference or Google requests. Retain message → manifest → graph boundary → terminal evidence ordering, uncertain-write confirmation and cleanup-before-ready behavior.

### C. Model-frame observation persistence blocks output delivery

**Confirmed directly in both adapters.**

The [Calendar adapter](../../backend/src/model/calendar-adapter.ts#L217) records wire timing, merges each frame's metadata, then **awaits `publish(false)` before assembling/yielding text**. [publish](../../backend/src/model/calendar-adapter.ts#L104) awaits `onObservation`, wired to the serialized [Calendar ledger](../../backend/src/chat-runtime/calendar-budget.ts#L503). That path may issue a guarded dispatch write and a budget update. Identical observations are deduplicated; changed generation/model/usage/first-output/ended fields still cause barriers.

The [ordinary text adapter](../../backend/src/model/openrouter-adapter.ts#L48) awaits generation-ID persistence and accounting save before yielding the frame; usage changes also save synchronously. In the synthetic profile, first text follows instant initial dispatch by **1.883 s for plain text** and **0.583 s for Calendar no-tool narration**.

The [wire-first timing hook](../../backend/src/benchmark/stream-timing.ts#L33) correctly precedes frame-specific writes. However, successive frames are consumed by the same blocked async iterator: full stream duration and throughput still include consumer-side persistence/backpressure. They do not isolate provider decode speed.

**Recommended direction:** distinguish required identity/spend durability from optional enrichment; consider one bounded coalescing writer for eligible observations with an awaited drain before spend-sensitive continuation, terminal publication, cancellation and shutdown. This needs failure/unknown-cost proof, not fire-and-forget writes. Generation identity and reservation-before-paid-dispatch cannot be weakened for faster first text.

### D. Checkpoints and repeated graph-state reads remain expensive

**Confirmed by source and real installed-saver fixture counts.**

[graphConfig](../../backend/src/chat-runtime/finalization.ts#L34) explicitly uses `durability: 'sync'`. Calendar normally traverses prepare → decide → execute → decide → seal, with checkpoints and task writes between steps. The read/create fixture records **33 saver reads and 16 saver writes**, in addition to application evidence.

[ScopedMongoSaver.getTuple](../../backend/src/persistence/checkpoints.ts#L201) pre-reads the checkpoint and pending writes for bounds and then delegates to stock `super.getTuple`, which fetches them again for a nonempty checkpoint. Serialization reuse and the empty-thread short circuit already exist; they do not remove this nonempty duplication.

Calendar also calls `graph.getState` [inside prepare](../../backend/src/chat-runtime/durable-chat-runtime.ts#L1082), after invoke, and after publication's graph-boundary update. Boundary checks run at both admission and attachment.

Current [LangGraph documentation](https://docs.langchain.com/oss/javascript/langgraph/checkpointers), checked through Context7, confirms synchronous checkpointing before the next super-step and separate pending task writes. `async` or `exit` changes crash guarantees; neither is a safe configuration-only optimization under this repository's durability requirements.

**Recommended direction:** eliminate redundant reads of an already pinned immutable checkpoint and unnecessary graph round trips using supported extension points; evaluate fewer intermediate steps only with exact recovery proofs. Keep the standard checkpointer and required acceptance/external-effect/seal/publication boundaries. Do not delete checkpoints, disable journaling or relax write concern to improve a benchmark.

## 3. Calendar-specific work beyond the shared storage problem

### Model → tool → model is normally sequential

[CalendarLoop.decide](../../backend/src/chat-runtime/calendar-loop.ts#L655) reserves a model dispatch; [executeReadV2](../../backend/src/chat-runtime/calendar-loop.ts#L1496) executes and persists the result; the graph routes back to decide for narration. The successful create path likewise records the verified result and resumes the model. The current probe shows **one model call for Calendar-enabled ordinary text, two for a read or create**.

No blind parallelism can remove these data dependencies. Deterministic narration from a verified create receipt could avoid one model round for narrow requests, but deciding when it may replace a broader user-requested answer is a product decision. Existing preflight guidance already discourages a separate model-requested availability call solely for create; whether the live model follows it is unmeasured.

### Ordinary text still advertises Calendar tools when Calendar is enabled

[admitCalendarBudget](../../backend/src/chat-runtime/durable-chat-runtime.ts#L1022) records eligibility/deadline in memory; [execution](../../backend/src/chat-runtime/durable-chat-runtime.ts#L820) chooses the Calendar path on that basis, **not prompt intent**. Lazy budget creation postpones storage until paid dispatch; it does not remove accounting or schemas for an eventual no-tool answer.

The current Calendar-enabled ordinary-text fixture sends **6,195 serialized bytes of tool schemas**, creates a dispatch/budget and performs accounting. It does not magically become the lightweight text adapter when the prompt is "hello". An explicit text-only capability policy would be needed to omit tools safely; keyword routing would mishandle "yes", "tomorrow" and proposal replies.

### Real capability checks exceed the simplified runtime fixture

[Target selection](../../backend/src/plugins/google-calendar/connection.ts#L923) already uses fresh discovery caching; [effect-boundary validation](../../backend/src/plugins/google-calendar/connection.ts#L1053) uses a narrow current-target request. The separate real-service capability probe reproduces **0 / 0 / 1 discovery-provider calls** across selection, repeated selection, and current-rights validation, with **15 storage commands**. The old repeated-full-catalogue problem is not unchanged.

Nevertheless, [checkTarget](../../backend/src/plugins/google-calendar/discovery.ts#L175) and the surrounding connection, credential and tool layers still reread account state and durably debit requests. [tools.ts](../../backend/src/plugins/google-calendar/tools.ts#L264) reads the account at invocation, before and after each admitted request. Those lifecycle/security boundaries matter, but they add database latency as well as the actual Google request.

The whole-runtime fixture's capability/credential gate is simplified and does not perform the real network capability recheck, discovery refresh or OAuth refresh. Its Google counts are therefore **not production request totals**. No live Google latency is established here.

### Creates have mandatory availability, operation and receipt barriers

[runCalendarPreflight](../../backend/src/chat-runtime/calendar-preflight.ts#L86) scans all discovered calendars for the exact event interval. [Availability batches](../../backend/src/plugins/google-calendar/calendar-availability-api.ts#L253) are capped at two batches of up to 50 calendars and processed sequentially with shared byte/interval/coverage limits.

[CalendarOperationWriter](../../backend/src/chat-runtime/calendar-operation.ts#L332) verifies accepted authority, checks existing intent, resolves capability, performs preflight, charges create, confirms the planned operation/event, fences, confirms dispatching/event, invokes Google once, and confirms success/receipt/event. This is why a create is not merely one POST.

The current profile has **81 driver commands tagged tool-evidence for create versus 27 for read**. These counts establish extra work, not a CPU-time breakdown. Proposal-reply effects execute inside decide and appear under model-observation tagging instead; those tags must not be mistaken for isolated model-only cost.

Narrowing conflict checks to only the target calendar changes product semantics. Parallel availability requires preallocated shared budgets and deterministic incomplete-coverage handling. Neither should precede reducing the demonstrated shared persistence overhead.

## 4. Corrections to the supplied benchmark report

The original [final_report.md](../voice-latency-benchmark/final_report.md) is preserved as supplied. These are investigation errata, not edits to that existing work.

1. **"Over 95%" and live TTFT ranges are unsupported.** Its final limitations correctly say no live provider benchmark occurred. Neither instant component fixtures nor a dry run can establish live TTFT dominance or typical 1.0–1.8-second speech latency.
2. **"Pre-model <15 ms" is not a whole-runtime bound.** The small history fixture measures selected repository methods over in-memory adapters. The whole-runtime delayed-driver fixture demonstrates seconds before inference. The 5 ms timer probe delays only selected point reads, not all database/ownership/checkpoint work; rerun result was 59 ms before model / 103 ms total.
3. **No-tool does not imply no schemas/bookkeeping.** A no-tool answer in a Calendar-enabled session still takes the Calendar-capable path described above. A Calendar-disabled text fixture is a different configuration, not the benchmark client's automatic baseline behavior.
4. **Subset storage counts are not system totals.** Current smaller-fixture Calendar-store counts are **20 / 53 / 90** for ordinary text/read/create, versus the old ceilings 27 / 67 / 105. Full runtime driver totals are **195 / 266 / 320**. These are different harnesses/scopes; subtracting one from the other is not a valid attribution model.
5. **The fragmented-response save probe spies on the wrong API now.** [It observes `putDispatch`](../../backend/test/performance/conversation-latency.spec.ts#L149); the confirmed-record fast path uses `updateDispatchConfirmed`. Current output is **zero observed `putDispatch` calls**, which still passes `<= 6`. This does not establish zero saves or an actual six-write ceiling. Observe the active confirmed API and actual driver commands, with a nonzero/control assertion.
6. **Passing performance tests do not enforce fast completion.** Whole-runtime [assertions](../../backend/test/performance/durable-latency.spec.ts#L232) check cleanup, telemetry parity, attribution and context/tool grouping, but have no scenario-specific first-dispatch, first-text, terminal-time or total-command upper bounds. A 47-second synthetic create still passes. Add non-self-derived performance budgets after an approved implementation target is chosen.
7. **Tool span is not CPU time.** `tool-execution` includes awaited storage, rights checks, credentials and transport; one first-run 13 ms result does not isolate schema/validation CPU or steady-state p50/p95.
8. **Voice provider description is stale.** [Application wiring](../../backend/src/app.service.ts#L833) uses Nova for dictation and **Flux STT + Flux TTS for live voice**. Current [defaults](../../backend/src/platform/config/manageable-config.ts#L143) are `flux-general-en` and `flux-haley-en`, not Nova-2/Aura. Flux waits for final `EndOfTurn`; [eager signals](../../backend/src/voice/providers/flux-stt.ts#L83) explicitly do not authorize inference. Runtime configuration was not queried, so no live effective setting or endpointing duration is claimed.
9. **Calendar-in-live-voice exclusion is confirmed**, via `!internal` in Calendar runtime selection. It is unsupported execution, not a measured slow Calendar path. Dictation followed by normal text submission is a different path.
10. **Benchmark terminal duration includes a status confirmation.** [runText](../../backend/src/benchmark/runner.ts#L92) makes a durable-status GET after SSE finishes. Its end-to-end duration is useful but not identical to server terminal-event latency. Current [stage projection](../../backend/src/benchmark/runner.ts#L109) also omits database counts/phase details, and successful persistence-read spans are not emitted by [observePersistence](../../backend/src/operations/observe-persistence.ts#L47); unattributed time cannot safely be labelled provider or CPU time.

## 5. What appears fixed, and what remains unknown

**Reproduced as working:** bounded point-read counts across 0/5/20/50 prior turns; real-service cached target selection; unchanged-revision event continuation with two successful event-page requests; cleanup withheld before completion; immediate follow-up callbacks. Do not re-fix the historical pagination or terminal-release race without a new reproduction.

**Still a source-supported risk:** [one global ownership tail](../../backend/src/persistence/ownership.ts#L107) serializes owned work across sessions. Longer Calendar phases can delay another session's writes or cleanup; phase labels do not prove absence of lock contention. No concurrent production workload/queue percentile was measured. Per-session queues would need executor/drain/crash-safety redesign and are not the first change recommended.

**Unknown:** deployed revision, actual database product/topology/region/tier, live read/write latency distribution and majority acknowledgment cost, real provider first-output/decode behavior, prompt caching/reasoning cost, browser/proxy delivery, device playback latency, and production queue contention. The synthetic 67/449 ms profile is a sensitivity test, not a new measurement of those services.

## 6. Recommended next order — not implemented

1. Correct benchmark interpretation and make current probes observe confirmed dispatch writes; establish whole-runtime dependency/command budgets for no-tool, read, create, conflict and proposal reply, not only selected point-reader counts.
2. Complete same-process admission receipt reuse with real version/invalidation evidence and strict fallback. This targets delay before either model or Google can help.
3. Reuse confirmed state and bounded owned phases during publication/terminal release; reduce duplicate graph reads. Compare full driver counts and milestones, not only high-level method calls.
4. Remove eligible observation-enrichment barriers from the text-delivery critical path using one bounded writer and mandatory drains, preserving identity, spend and uncertain-write safety.
5. Recheck read/create pipelines with the **real connection/discovery/credential services** plus fake Google transport in an assembled offline fixture; retain existing tool validation, cancellation, recovery, disclosure and no-duplicate-effect suites.
6. Only then obtain operator-approved isolated database timing and bounded live provider/browser evidence. Correlate submit receipt, acceptance, attachment, dispatch, raw first meaningful frame, browser first answer, each Google request, model end, saved seal, durable terminal and released slot. Separate cold/warm and short/long sessions; include enough successful repetitions for the reported percentile.

Model substitution, deterministic receipt-only narration, text-only capability mode, reduced conflict coverage and durability-mode changes are **not authorized by this investigation**. No speedup is promised until measured on the actual running revision/environment.
