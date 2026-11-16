# Follow-up chat latency investigation

2026-11-02. **Investigation complete; implementation not started; real latency unmeasured.** Unified review remains **skipped**, not passed. This is a new investigation, not approval to weaken the existing durability contract or certification of earlier optimization work.

## Conclusion

The reported composer lock and repeated history reconstruction are real. The deeper issue is amplification: a normal text follow-up still causes **169 emulated database commands**, including **128 reads and 41 writes**, before runtime settlement. The existing harness records **69 storage dependency waves before model dispatch**. Optimizing React alone will not fix that path.

Recommend a focused simplification of the existing implementation: separate drafting from generation, replace repeated full reconstruction with bounded reuse of verified admission evidence, remove duplicate persistence work, and keep recovery/auditing off the healthy path where equivalent correctness evidence exists. Do not introduce another service, dependency, generic cache framework, or new persistence engine as a first step.

**Sub-100 ms should be an explicitly measured application-overhead target, not a promise for the remote model's first token or a whole generated answer.** The supplied millisecond ranges are estimates. No current evidence measures this deployment's MongoDB round trips, provider latency, browser connection contention, or UI paint times.

## Fresh offline evidence

The existing harness runs the real runtime, ownership code, repositories and stock MongoDB saver against a BSON-capable fake driver and deterministic provider responses. These are emulated command counts and dependency waves, not MongoDB wire captures, physical network round trips, provider benchmarks, or CPU timings. Its injected `67/449ms` profile is a sensitivity experiment, not discovered service latency. Its `modelEndMs` marker is a fixture fetch-response marker, not actual provider stream completion.

| Text scenario | Reads / writes | Complete commands | Pre-dispatch waves | First emitted text waves | After sealed checkpoint waves |
| --- | --- | --- | --- | --- | --- |
| New chat | 129 / 45 | 174 | 75 | 84 | 44 |
| Follow-up after 1 completed turn | 128 / 41 | 169 | 69 | 78 | 44 |
| Follow-up after 20 completed turns | 128 / 41 | 169 | 69 | 78 | 44 |

The follow-up measurement includes **29 checkpoint-related reads and 11 checkpoint-related writes**. Those are subsets of the totals. Phase attribution reports 34 admission, 8 attachment, 11 context, 35 model-observation, 40 seal, 39 publication and 2 release commands. Phase counts are not elapsed durations; the graph invocation's seal scope also surrounds other work. None of these categories establishes which deployed component is slowest.

The unchanged command counts at 1 and 20 turns matter: both archives fit within the same page bounds. History payload and processing still grow, but a growing transcript does not necessarily add a query per turn. Full archive walks are scoped to one session and bounded to 100 pages; they are not collection-wide unbounded scans. Acceptance markers are already batch-read when supported.

### Actual checks

- Complete offline performance selection: **117 passed / 21 failed**, 9 files, exit 1. Four scenario failures are the two near-message-ceiling scenarios in both profiles; two fixed-baseline cases then lack their scenario measurement. All 15 combined acceptance cases fail, including two without scenario measurements. The context failures are consistent with the concurrently added environment system message crossing the existing fixture ceilings; that separate work and its tests were not changed here. This run is not a clean, stable release baseline.
- A second focused run: **14 passed / 55 filtered**, 3 files, exit 0. This reran new-chat, 1-turn and 20-turn text measurements in both profiles, plus admission/receipt safety checks. SHA-256 comparisons before/after were equal for seven selected runtime, history, finalization, ownership, checkpoint and context files. This is selected-file stability, not a whole-checkout attestation. The counts in the table above were freshly extracted from this run.
- No application build, full correctness suite, native database test, browser benchmark, paid provider call, Calendar service call, backend restart, migration, or deployment was performed. No credentials or application environment files were read. Existing user changes were preserved. No product code was modified by this investigation.

## Confirmed findings and boundaries

### 1. Drafting is unnecessarily tied to durable completion

[`Composer.tsx`](../../frontend/src/components/Composer.tsx) disables the entire textarea while `state.isStreaming`; [`chat-reducer.ts`](../../frontend/src/features/chat/state/chat-reducer.ts) clears that flag on terminal processing. [`chat-stream.transport.ts`](../../backend/src/http/chat-stream.transport.ts) buffers terminal frames until the runtime and its stream reservation settle.

The terminal barrier serves a legitimate purpose: the next submission must not race unfinished durable publication or a still-owned session. **Typing a draft does not require that barrier.** Allow drafting while generating/finalizing, keep Send gated until the current turn is durably released, and preserve the draft across terminal/error/cancel processing. Do not infer completion from the last delta or EOF. Automatic queued sending is a separate product decision, not necessary for the first change.

### 2. Admission evidence exists, but does not remove the second full boundary check

[`durable-chat-runtime.ts`](../../backend/src/chat-runtime/durable-chat-runtime.ts) runs `checkBoundary` during submit/retry admission and again during execution, even when the in-process admission receipt is present. Plain text then assembles the same context a **third time** in the graph's prepare hook, with another manifest read and fence. Context assembly can also perform voice-delivery lookups for mixed-history sessions.

[`admission-receipt.ts`](../../backend/src/chat-runtime/admission-receipt.ts) already retains the input/attempt receipts, manifest and source records. However, its checkpoint ID is currently a synthetic `${sessionId}-0`, the graph epoch map is not advanced, and the execution branch does not use its sensitive-record refresh list. **The current receipt is not sufficient proof to simply delete `checkBoundary`.**

The smaller sound change is to finish using the existing evidence path, not add another cache: pin actual checkpoint/manifest evidence and the accepted settings; reuse ordinary immutable history; refresh privacy-sensitive Calendar/voice evidence and time-dependent projections; retain compact ownership/version checks. Expired, oversized, absent, invalidated or mismatched evidence must use the strict existing path or fail safely. Test retry, reconnect, context overflow, retention/revocation, configuration changes and concurrent tabs. Full reconstruction remains appropriate for recovery/reconciliation and cache misses.

### 3. Ownership checks multiply ordinary storage operations

[`ownership.ts`](../../backend/src/persistence/ownership.ts) implements ordinary `run` as an executor-sentinel read followed by a session-lease read, then the operation. The queue is process-wide, not per session. This serializes guarded operations across sessions; the optional local crash journal adds its own global serialization.

The repository already has bounded `runPhase` support that validates ownership once around a small storage-only phase. Admission staging and assistant/accounting staging already use it. Extend or consolidate only proven consecutive storage-only dependencies; do not stretch a phase across model/tool/network waits or client callbacks. Preserve deadlines, operation bounds, invalidation, all-settled cleanup and fencing. A session-generation CAS is not by itself proof that message privacy or manifest state stayed unchanged.

### 4. The default checkpoint reader reads the same data twice

[`checkpoints.ts`](../../backend/src/persistence/checkpoints.ts) performs bounded checkpoint and pending-write prechecks, then calls stock `getTuple`, which reads them again for a nonempty checkpoint. That is ordinarily **four queries instead of two**. The bounded read facade already exists, but [`persistence.ts`](../../backend/src/persistence/persistence.ts) does not enable it.

Reuse/validate that implementation rather than write another saver. Its existing native conformance gate remains open: compare stock/facade restart, pending-write, scope, bound and failure behavior on an explicitly authorized isolated database before activation. Removing bounds or enabling it because an offline fixture passes is not equivalent verification.

LangGraph uses synchronous durability here. Its documented `async` and `exit` modes trade crash guarantees for performance; changing the mode is not a free optimization. First investigate fewer application-induced checkpoint boundaries and readbacks without weakening saved-result recovery. References: [LangGraph durability modes](https://docs.langchain.com/oss/javascript/langgraph/checkpointers), [MongoDB driver result semantics](https://github.com/mongodb/node-mongodb-native/blob/v6.20.0/etc/notes/CHANGES_6.0.0.md). Installed saver code was also inspected.

### 5. Publication contains duplicate session activity work

[`finalization.ts`](../../backend/src/chat-runtime/finalization.ts) calls `sessions.touchActivity` before terminal attempt publication. The normal receipt-bearing execution path then calls `finishAttempt`, which already atomically updates activity and clears both ownership and the active slot in one session update.

Eliminate the earlier activity write only on the proven combined-finish path; recovery and legacy fallback callers still need an explicit activity-update owner. Separately, `memory.put` rereads a manifest revision despite `putConfirmed(expected)` already supporting confirmed evidence. Carrying the existing store-bound manifest receipt can avoid that reread if it is correctly retained and validated. Acknowledged normal writes should not need unconditional confirmation reads; uncertain writes still do.

### 6. The first visible delta waits on more than one persistence operation

[`openrouter-adapter.ts`](../../backend/src/model/openrouter-adapter.ts) captures the generation ID by awaiting the runtime attempt update **and then an accounting save** before yielding the frame. The dispatch-bearing accounting save before the provider request is intentional possible-billing evidence, not an empty initialization that can simply be deleted. The empty initialization was already removed by earlier work.

Investigate combining repeated generation-identity observation work under the existing writer/receipt protocol. Preserve durable identity before visible output, possible-billing evidence before paid dispatch, failure supervision, bounded drain and terminal accounting. Do not fire-and-forget these writes or hide failure after reporting completion.

### 7. Sidebar refresh is unnecessary foreground-adjacent work, not a demonstrated bottleneck

[`use-chat.ts`](../../frontend/src/features/chat/state/use-chat.ts) reloads sessions after every completed submit/retry. [`sessions.ts`](../../backend/src/persistence/sessions.ts) uses a computed-pin aggregation and sort for listing. Update the known active sidebar entry locally and reconcile later/off the send path where practical. Browser connection starvation or database contention from that request remains unmeasured; do not rank it above confirmed backend amplification without a trace.

### 8. Prompt caching and UI delta batching already exist

[`policy.ts`](../../backend/src/model/policy.ts) already adds Anthropic automatic cache control for applicable model IDs. Stable-prefix work and [`stream-delta-coalescer.ts`](../../frontend/src/features/chat/state/stream-delta-coalescer.ts) are already implemented. Do not rebuild either. Cache hits, routing, thresholds and actual TTFT still need provider evidence. More context does not necessarily make every follow-up slower: cache reuse can materially change prefill cost. Do not silently discard history or introduce compaction to make a benchmark pass.

## Recommended implementation scope for approval

1. **Immediate interaction:** keep the text draft editable during generation/finalization; preserve current send serialization, voice input ownership and draft safety. Remove the immediate sidebar reload where the active entry can be updated accurately.
2. **One healthy-path context preparation:** finish the existing verified-admission-evidence path and replace redundant full reconstruction/reassembly with bounded checks and necessary fresh privacy/time projections. Keep cold/recovery behavior strict.
3. **Shorter durable persistence path:** remove duplicate activity publication on combined finish, reuse existing confirmed manifest/accounting evidence, and consolidate only demonstrated storage-only ownership phases. Prove each deletion with a focused failing regression before its fix.
4. **Checkpoint read duplication:** validate/reuse the existing bounded facade; native activation stays separately gated. Consider graph-boundary simplification only if the earlier changes cannot meet the measured budget.
5. **Measure the real result:** use existing diagnostics first; add only missing correlated milestones for browser Send, durable acceptance, provider dispatch, first parsed text, first delivered/painted text, provider end and ready-after-release. Record p50/p95, history length, payload size, model/cache state, database placement/topology and crash-journal mode. Use deterministic provider data for application-only tests. Native/live checks require explicit isolated-resource and numerical cost/data authorization.

Proposed performance goals, **not achieved results**: immediate drafting with no backend-dependent lock; visible send feedback within 50 ms; browser Send-to-provider-dispatch p95 below 100 ms and provider-end-to-ready p95 below 100 ms on an agreed topology/workload; report first-text delivery/render overhead separately from provider TTFT. Both latency targets include the relevant application storage work, not just JavaScript CPU time. If either misses, report the actual residual rather than relabeling waiting time, weakening durability or rebasing the frozen regression gates.

Prefer this scope over UI-only changes (insufficient for backend delay) or a wholesale persistence rewrite (large correctness/migration surface without native measurements). No Redis, new queue service, alternate database, model switch, protocol rewrite, automatic compaction or deployment is proposed. Preserve durable acceptance, idempotency, one active attempt per session, privacy/retention, saved-result recovery without inference replay, finite budgets and honest terminal events. Shared changes must retain Calendar/voice behavior and explicit side-effect confirmation.

## Reproduction and evidence paths

From `backend/`, using the existing temporary wrapper importing the repository Vitest config with `envDir:false`:

```powershell
$T = 'C:/Users/Peter/AppData/Local/Temp/opencode'
$env:AURVIN_NATIVE_PERF_ENABLE='disabled'
$env:AURVIN_TEST_MONGODB_URI=''
$env:AURVIN_TEST_DB_PREFIX=''
npm test -- test/performance --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 --silent=false --disableConsoleIntercept --reporter=verbose
npm test -- test/performance/durable-latency.spec.ts test/performance/shared-admission-critical-path.spec.ts test/performance/text-critical-path.spec.ts --config "$T/latency-step4-backend-offline.config.mjs" --maxWorkers=1 -t 'measures.*(new-text|follow-up-1|follow-up-20)|starts the independent|keeps reservation|keeps acceptance honest|carries the actual|retains acquisition|forwards each confirmed' --reporter=verbose
```

Raw local logs: `C:/Users/Peter/AppData/Local/Temp/opencode/followup-latency-investigation-20261102.log` and `C:/Users/Peter/AppData/Local/Temp/opencode/followup-latency-focused-20261102.log`. They are local diagnostic artifacts, not committed release/CI evidence. Earlier [acceptance evidence](acceptance-report.md), [text critical-path results](text-critical-path-results.md), and [report optimizations](../report-optimizations/final_report.md) were read as history, not represented as fresh tests.

**Investigation closeout gate:** select/approve the implementation scope before MAW planning or worker dispatch. The checkout was modified and committed by other work during this investigation, including the runtime/context paths. No implementation branch/worktree or commit was created during the investigation itself.

**Subsequent direction approval, 2026-11-02:** the user selected focused simplification and an isolated worktree. This session moved to branch `codex/chat-followup-latency`, carrying only this report and leaving original checkout edits behind. The proposed written specification and current approval gate are now in [goal.md](../chat-followup-latency/goal.md) and [state.md](../chat-followup-latency/state.md). Earlier measurements above remain original-checkout evidence, not a clean-branch baseline.
