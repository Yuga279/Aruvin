# Task 1 baseline and verification protocol

7 November 2026. [Behavior contract](memory-first-task-1-contract.md) is defined. **Current deployed text/voice latency measurement remains pending.** No service/provider baseline or p50/p95 has been collected. Offline synthetic counts below are current fixture observations, not current database or conversational latency.

## Revision, environment and observations

Baseline source: `89e0d4ee94c14f92d383efd1e114a1b8b57463c9`; Windows PowerShell, `D:/Peter/ECG/Aurvin`, Node `v24.19.0`, test runner Vitest `4.1.11` (installed version printed at execution). Dependencies already installed; no install/build/application startup performed. Initial worktree had only two untracked input reports, both preserved. This task adds two documentation files only; no staged files or commits.

Safe local command, run from `backend`:

```powershell
npm test -- test/performance/durable-latency.spec.ts test/performance/voice-critical-path.spec.ts
```

Actual result: exit **1**, **1 failed / 1 passed test files; 19 failed / 44 passed tests (63 total)**, 19.33 seconds reported runner duration. Voice critical-path file passed. Durable suite failures include strict historical reduction gates: cancel-before-dispatch counted 84 commands against a 69-command acceptance threshold; cancel-midstream 137 against 123; finalization recovery 67 against 66. Calendar proposal-reply gate encountered a null/unavailable pre-dispatch boundary (`TypeError`, line 846). Do not classify this run as a passing baseline or silently rebase the historical thresholds. Fixing these tests/runtime is outside Task 1.

The 0ms fake-driver profile emitted these current observations:

| Scenario | Repository logical R/W | Fake-driver command R/W | Pre-dispatch / first-answer / post-seal waves |
| --- | --- | --- | --- |
| New text | 17 / 27 | 94 / 42 | 54 / 60 / 31 |
| Warm follow-up 1 | 11 / 24 | 81 / 38 | 43 / 49 / 30 |
| Warm follow-up 20 | 11 / 24 | 81 / 38 | 43 / 49 / 30 |
| Calendar-connected ordinary text | 25 / 34 | 109 / 43 | 81 / 84 / 32 |

These are rerun fixture counts, including fake command events from real repositories/stock saver. Synthetic 0ms elapsed time is zero by construction. The suite also uses artificial 67/449ms read/write timing; neither profile establishes network RTT, browser latency, real driver/server behavior or percentiles. Historical `fixedBaseline` constants reference revision `35eb6e85...`; they are not today's measured latency. No quantitative voice latency was obtained; passing voice assertions verify linkage reuse, same-call follow-up/idempotency and retained heard evidence.

Skipped/unrun: native Mongo/Cosmos/Azure/service checks, live model/STT/TTS/LiveKit, browser/device audio measurements, CPU profiling, package-wide suites, build/lint, deployment. This documentation-only task does not require unrelated package-wide checks. Unified review remains skipped under existing workflow instructions. The existing Vite tsconfig-paths deprecation warning is nonfatal.

## Source-grounded measurement anchors

Paths below are current code, not evidence of passing requirements:

- [API schema](../../backend/src/contracts/api.ts), [attempt states](../../backend/src/contracts/attempt.ts), [voice states](../../backend/src/contracts/voice.ts): existing strict schemas need coordinated independent save states.
- [Runtime](../../backend/src/chat-runtime/durable-chat-runtime.ts), [finalization](../../backend/src/chat-runtime/finalization.ts), [transport](../../backend/src/http/chat-stream.transport.ts): acceptance/ownership, sync graph durability, publication and reservation release currently await storage. Terminal buffering must change together with runtime readiness.
- [OpenRouter adapter](../../backend/src/model/openrouter-adapter.ts): `dispatchClock` starts before text accounting save; actual `fetcher` call follows it. [StreamTiming](../../backend/src/benchmark/stream-timing.ts) starts immediately before fetch and records wire frames/end before application persistence barriers. Match attempt + dispatch ID; do not treat accounting duration as pure provider time.
- [Driver observation](../../backend/src/persistence/database-observation.ts), [telemetry](../../backend/src/operations/telemetry.ts), [repository observation](../../backend/src/operations/observe-persistence.ts): command/collection/phase counts, ownership timing, pool wait, bounded details, busy/overlap and event-loop delay. Production command observation filters target-DB CRUD/cursor commands; it is not all server control traffic. Native fixture command measurement separately counts total and target commands. Report coverage/drops explicitly.
- [Offline fixture](../../backend/test/performance/latency-runtime-fixture.ts), [dependency probe](../../backend/test/performance/dependency-probe.ts), [durable suite](../../backend/test/performance/durable-latency.spec.ts), [voice suite](../../backend/test/performance/voice-critical-path.spec.ts): deterministic fake database and provider wires; no live clients. Logical repository calls exclude some ownership/checkpoint commands. Never add logical calls to driver commands as a total. Report document operations/bytes separately from bulk command count.
- [Voice delivery](../../backend/src/voice/agent/voice-delivery.ts), [voice usage](../../backend/src/voice/usage/voice-usage.service.ts), [voice measurements](../../backend/src/benchmark/voice-measurements.ts), [WebRTC benchmark](../../backend/src/benchmark/webrtc-voice.ts): existing EOT/model/TTS/playback milestones; decoded audio is not audible onset. [Report summarizer](../../backend/src/benchmark/report.ts) supplies percentile calculations; coarse telemetry buckets cannot produce precise p50/p95.
- [Frontend submission](../../frontend/src/features/chat/state/use-chat.ts), [reducer](../../frontend/src/features/chat/state/chat-reducer.ts), [LiveKit client](../../frontend/src/api/livekit-voice-client.ts): POST-then-stream handoff, optimistic input, fresh invocation UUID, and actual production audio path. Browser paint/device evidence is separate from backend callbacks.

## Boundaries and required samples

Use monotonic spans on one clock; correlate sanitized IDs across clocks without subtracting unrelated `performance.now()` values. Report server and browser spans separately unless offset uncertainty is measured.

| Metric | Boundary |
| --- | --- |
| Admission / dispatch | Server ingress → acceptance; separately ingress → actual model fetch. Include POST/stream attachment in browser measurements. |
| First text | Fetch → first provider nonempty text; browser submit → first nonempty rendered text. Preserve application forwarding/paint spans separately. |
| Voice setup | User activation → input listening; permission, room, STT/TTS and storage components separately. |
| Voice response | Known speech end → STT EOT; EOT → fetch, first Speak, first backend PCM and first decoded browser audio, each separately. Actual audible onset requires device/loopback evidence. |
| Readiness | Model wire end → actual successful immediate follow-up dispatch; separately audible end/stop → eligible voice follow-up dispatch. Enabled controls alone are insufficient. |
| Interruption | Local barge-in and server StartOfTurn → output silence; identify clock/device boundary. |
| Save | Final memory version → confirmed durable watermark; queue age/depth/bytes, retries, failures and unknown outcomes through writer settlement. |

For each scenario report sample count, warmups, p50/p95, failure/timeout/cancelled/unsaved counts and missing metrics. Keep errors visible; do not sum stage percentiles. Prespecify sample count and workload before comparison; small-sample p95 is exploratory. No latency SLA is chosen before representative baseline and topology facts exist.

| Matrix group | Required cases |
| --- | --- |
| Lifecycle/history | Process startup separate; first new session; existing cold hydration; warm follow-ups; clean eviction/TTL miss; dirty retention; short/medium/near-bound history; mixed text/voice/Calendar content. |
| Modalities | Text; dictation partial/final/composer unlock and explicit Send; live setup, first utterance and same-call follow-ups; quiet wake; generation/playback barge-in; unknown hearing. |
| Tools/load | Calendar disabled; connected ordinary turn; external read; create and clarification; ambiguous mutation readback. One session, cross-tab contention, bounded independent sessions, slow writer while voice active. |
| Failure/recovery | Blocked/outage writer; partial save and commit-then-timeout; stale callbacks; payload mismatch; lost acceptance response/reconnect; provider rejection; cancellation/disconnect; queue pressure; shutdown timeout; restart losing volatile results; archive/redaction fencing. |

Later deterministic regression requirements: gate all persistence, prove new/warm dispatch, first output and eligible immediate follow-up still proceed; verify previous unsaved context exactly once and heard uncertainty; assert lower **complete** command and document-mutation totals after background drain, not merely fewer foreground calls. Test bounded admission with no dirty eviction, stale writes and partial-publication visibility. Preserve Calendar pre-effect durable ordering and no duplicate effect; save retry must issue zero inference/TTS calls. Existing old durable assertions must be revised only where the new contract explicitly changes them.

## Exact collection procedure after operator authorization

1. Record revision/dirty files, installed versions, host resources/regions, process count, fixed config/model/input/output bounds and diagnostic mode for each source. Compare baseline and candidate on equivalent topology/workloads. Do not modify this worktree to obtain another revision.
2. Rerun the offline command above and retain full output securely; classify existing failures. For isolated real native storage with deterministic providers, use the existing guarded fixture below, after the operator supplies credentials privately and confirms a disposable dedicated replica set. No `.env` inspection is needed.

```powershell
# From backend; only AFTER separate service-test authorization and private operator setup
npm run test:e2e -- test/performance/native-latency.e2e-spec.ts
```

Required existing guard settings: `AURVIN_NATIVE_PERF_ENABLE=authorized`, `AURVIN_NATIVE_PERF_DEDICATED_REPLICA_SET=attested`, `AURVIN_NATIVE_PERF_CREATE_DROP=approved`, `AURVIN_NATIVE_PERF_SAMPLE_LOAD=approved-max-18-databases-81-turns`, `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, operator `AURVIN_NATIVE_PERF_REPLICA_SET`, full source SHA in `AURVIN_NATIVE_PERF_REVISION`, `AURVIN_NATIVE_PERF_LABEL=baseline` or `current`, `AURVIN_NATIVE_PERF_SAMPLES` in `1..3`, and private `AURVIN_TEST_MONGODB_URI`. See [safety validator](../../backend/test/performance/native-safety.ts). Never echo the URI. Skipped discovery is not evidence. This fixture's 1–3 samples and native topology do not establish tail percentiles or Cosmos compatibility.

3. Collect full scenario matrix on the admitted deployment with explicitly bounded provider/tool authorization and safe test calendar. Existing compiled CLI entry is `npm run benchmark -- <operator-approved-config.json> --live` from backend; it may perform paid calls/mutations and is **not authorized by Task 1**. Its current coverage is incomplete for this matrix. Browser/device and missing save/readiness metrics require later harness extension; no runnable current command alone proves all new requirements.
4. Retain bounded sanitized raw samples and summarize per scenario with existing nearest-rank helpers. Separate repository, actual command, document mutation, payload and (where available) RU/retry/throttle counts, pool wait and busy-time union. Sum all detached work through settlement; busy-time union is not proof of causal blocking. Document absent scope or dropped observations.
5. Profile CPU/allocation/GC, event-loop delay/utilization and log bytes/time under full diagnostics, counters-only and no-op modes with identical long-output/voice fixtures. Existing sinks can support controlled harness comparisons; merely muting stdout retains pre-sink hashing/JSON construction. Include context token estimation, cloning/BSON encoding, validation, render/Markdown and audio queue cost. These modes/profiles have not been run.

Operator prerequisites remain unresolved: Cosmos API/product/version/tier/regions, enabled limits/index/partition/transaction/checkpointer capabilities; backend hosting/region, single-process/rollover enforcement, memory budget, retained storage/restart and grace period; service-test permission and exposure limits. Until provided, baseline collection and deployment admission remain pending. Definition completion must not be reported as measurement completion.
