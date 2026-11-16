# Final Report: live-voice-webrtc

## Executive summary

Live voice now uses LiveKit/WebRTC for browser microphone input and assistant audio playback, with a thin in-process media bridge feeding Aurvin's existing LangGraph voice runtime. The migration preserves accepted-turn durability, history, cancellation, interruption, idempotency, quotas, accounting, server-resolved identity, and the existing text/dictation paths. Dictation remains on its WebSocket transport.

All eight implementation work packages and the P1b contract follow-up are complete and committed. Two defects found by P8 were routed back to their owners and fixed: the P4 denied-permission resume regression (`121ae72`) and the missing P6 WebRTC benchmark tooling (`b528445`..`deb09f5`). P8's deterministic rerun (`4b565ad`, `6366944`) passes the migration gate: both package builds, lints, the benchmark suite, the frontend full suite, and the assembled e2e suite pass; backend voice/integration evidence passes with only explicit native-prerequisite skips.

**The goal is not fully verified.** Real LiveKit/SFU media, browser microphone/playback, native MongoDB persistence, network impairment, deployment/rollback, and a paid WebRTC benchmark were not authorized or available. The comparison verdict is **INCONCLUSIVE**: no WebRTC sample exists and no latency improvement is claimed. Review was **skipped** by user instruction, never passed.

## Workflow configuration

- Workflow: `maw`; objective `live-voice-webrtc`.
- Skipped phase: unified code review (`--skip review`). No reviewer or review-triggered fixer was dispatched; `review.md` was not created.
- Goal: [goal.md](goal.md); execution basis: [state.md](state.md).
- Execution authorization: user resume selection on 5 November 2026, continued on 6 November and 7 November 2026.
- Delegation: harness-default roles; no model override was requested or claimed.
- Constraint applied throughout: Ponytail — minimal working WebRTC integration, reuse of existing runtime/helpers, no second conversation engine, no duplicate authorization or per-frame checks.

## Plan breakdown and execution record

| Plan | Scope | Implementation commits | Status |
| :--- | :--- | :--- | :--- |
| P1 | Transport contracts, LiveKit configuration, dependency pins | `6a55473`, `02efee0`, `bd685bf`, `2bca375`, `0b6d4a8` | Complete |
| P1b | Playback watermark, control-packet bounds, contract fixtures | `2dd748a` | Complete |
| P2 | Session admission and scoped LiveKit access | `40f1c97`, `c961708` | Complete |
| P3 | Backend bidirectional media bridge and live lifecycle | `af62c58`, `503e6b3` | Complete |
| P4 | Browser LiveKit transport, playback, interruption, reconnect | `2740cbb`, `121ae72` | Complete |
| P5 | Application assembly and live-only cutover | `3d84aa0`, `2ca1457` | Complete |
| P6 | Comparable benchmark tooling and offline checks | `24a3382`, `b528445`, `57eba7d`, `2e540b3`, `ae654ac`, `18c56bd`, `d7d3d51`, `deb09f5` | Complete (offline tooling; no live run) |
| P7 | Operations, security procedures, and rollback | `82f4785` | Complete (drills unrun) |
| P8 | Integrated regressions and before/after evidence | `4b565ad`, `6366944` (plus partial `b180e78`) | Deterministic rerun complete; external evidence blocked |

Planning artifacts: `plan1.md` through `plan8.md` and `plan1b.md` are committed in the workflow record. Research is committed as `research.md` (`7de77e3`).

## Verification and quality assurance

### Source identity

- Tested source base: `4a564e024ac33616348921d188fb96e8d4533465`, including P4 `121ae72` and P6 `b528445`..`deb09f5`.
- P8 report commits: `4b565ad` (reports) and `6366944` (report identity line). These are documentation-only relative to the tested source.
- This final report is also documentation-only. No source or test file changed after the P8 run.
- P8 test-source fingerprint: `d25fedb6c674e92ec3475281d43a5299db16a70ac11002fc7863112cf98e6113`, over all fourteen files in the P8-owned backend and frontend voice integration directories.
- Environment: Windows 11 Home build `10.0.26300` x64; Node `v24.19.0`; npm `11.17.0`; Vitest `4.1.11`; backend `@livekit/rtc-node` `1.2.1` and `livekit-server-sdk` `2.19.2`; frontend `livekit-client` `2.23.0`.

### Deterministic checks

| Directory | Command | Actual outcome |
| :--- | :--- | :--- |
| `backend/` | `npm run build` | **PASS**, exit 0 |
| `backend/` | `npm run lint` | **PASS**, exit 0; 647 warnings, 0 errors |
| `backend/` | `npm test -- test/voice/integration/` | **PASS**, 38 passed / 8 skipped (native prerequisites) |
| `backend/` | Broader voice set (session, providers, usage, HTTP exclusion, assembly context, bridge, pipeline) | **PASS**, 203/203 |
| `backend/` | `npm run test:benchmark` | **PASS**, 147/147 across 11 files |
| `backend/` | `npm run test:e2e` | **PASS**, 43 passed / 139 skipped |
| `backend/` | `npm test` | **FAIL**, 35 failed / 2,726 passed / 10 skipped across 309 files |
| `frontend/` | `npm run build` | **PASS**, exit 0 |
| `frontend/` | `npm run lint` | **PASS**, exit 0; 80 warnings, 0 errors |
| `frontend/` | `npm test -- src/features/voice/integration-tests/` | **PASS**, 34/34 |
| `frontend/` | `npm test` | **PASS**, 670/670 across 80 files |
| Repository | `git diff --check` | **PASS**, no whitespace errors |

The full backend routine suite is not a full pass. Its failures are reconciled as:

- **25 documented pre-existing failures** in five Calendar/performance files: `test/performance/durable-latency.spec.ts` (19 standalone), `test/performance/confirmed-state-cache.spec.ts` (3), `test/runtime/calendar-recovery-unavailable.spec.ts` (1), `test/integration/plugins/multi-calendar/authority.spec.ts` (1), and `test/assembly/calendar-simplification.built.spec.ts` (1). The full-suite `durable-latency` count rises to 21–23 under wall-clock load, which accounts for the 27–29 non-policy totals.
- **Six host-policy failures** in `test/operations/local-guard.spec.ts` (3) and `test/persistence/local-open.spec.ts` (3). The machine blocks unsigned `.ps1` execution; the suites pass 6/6 when the test process is permitted to run scripts. This is an environment limitation, not a source regression.
- No voice, LiveKit, contract, P4, or P6 test failed in any run.

### Deterministic P8 gate

- G1 migration gate: **PASS**. The prior P4 permission-denial regression passes 1/1 without weakening the P8 assertion; backend voice integration passes 38/38 with 8 named native skips; frontend integration passes 34/34.
- G2 full regression: **PARTIAL**. All package builds/lints, benchmark, e2e, and the full frontend suite pass; the backend routine suite remains failed on the documented baseline plus the host-policy condition.
- G3–G8 external gates: **BLOCKED / NOT RUN**. Native database, real LiveKit/SFU media, browser microphone/playback, impairment, deployment, and rollback exercises were not performed.
- G9 artifacts/truth: **PARTIAL**. Reports, source identity, commands, counts, skips, and failure routing are recorded; external evidence remains missing.
- Review: **SKIPPED** by user instruction.

## Latency comparison

The retained WebSocket baseline remains the only measured evidence:

- Speech-end → first PCM receipt: p50 **7,800.788 ms**, exploratory p95 **17,696.421 ms** (seven measured samples; p95 equals the maximum).
- Startup: p50 **1,479.505 ms**, exploratory p95 **2,216.661 ms**.
- Audible onset and interruption-to-stop were not measured in the baseline.

No WebRTC sample was collected. The P6 driver now exists and is verified offline, but it was not run against LiveKit or any provider. It deliberately fails closed without supported playback proof: an onset-only run would be reported as `unverified` / `BENCHMARK_UNPROVEN_PLAYBACK`, not as a successful lifecycle sample. The historical PCM receipt boundary and the intended WebRTC decoded-nonzero boundary are not comparable, and neither is audible onset.

**Verdict: INCONCLUSIVE.** No absolute or percentage delta is computed. Migration success is not presented as a latency improvement. See [comparison.md](comparison.md).

## Key artifacts

- Goal: [goal.md](goal.md)
- State and dependency record: [state.md](state.md)
- Plans: [plan1.md](plan1.md) – [plan8.md](plan8.md), [plan1b.md](plan1b.md)
- Verification: [verification.md](verification.md)
- Comparison: [comparison.md](comparison.md)
- Operations and rollback: [operations.md](operations.md)
- P6 methodology: [webrtc-methodology.md](../voice-latency-benchmark/webrtc-methodology.md)
- Retained WebSocket baseline: [websocket-live-baseline-2026-11-05.md](../voice-latency-benchmark/websocket-live-baseline-2026-11-05.md)
- Review: **SKIPPED**; no `review.md` exists.

## Remaining gates and limitations

To complete goal verification, the following require separate explicit authorization and evidence:

1. **LiveKit target and real media:** a local `livekit-server --dev` instance or user-supplied LiveKit Cloud project, with room join, bidirectional audio, ICE/TURN path, reconnect, and teardown observed.
2. **Browser/device evidence:** microphone permission, autoplay, audible onset, interruption-to-playback-stop, stale-tail stopping, and cleanup on a real browser and audio output device. Node Vitest and SDK doubles are not device evidence.
3. **Native MongoDB evidence:** an isolated replica-set URI/prefix and native authorization; currently eight P8 integration cases plus three Canvas native e2e cases skip by explicit gate.
4. **Bounded WebRTC benchmark:** fresh finite spend/submission/time approval. The prior eight-submission WebSocket approval is exhausted. The tested guard ceilings are 16 model dispatches, 60,000 context and 6,000 output tokens per dispatch, 60,000 ms aggregate STT PCM, 4,000 aggregate TTS bytes, 32 speech sockets, 900,000 ms paid-active lifetime, one warm-up plus seven measured cases, concurrency one, and a conservative `$0.99847` reservation (not an invoice guarantee). A headless run may legitimately remain onset-only and unverified.
5. **Network impairment and operations:** matched fixed-profile jitter/loss runs on both transports, deployment/rollback, shutdown/drain, and restoration evidence. P7's drills remain **UNRUN**.
6. **Raw baseline retention:** the committed WebSocket baseline report is retained; the ignored `backend/benchmark-results/` raw tree is not present in this checkout, so its immutable-input re-check could not be executed.

Additional limitations:

- The host's script-execution policy causes six backend test failures under the default environment; they are separated from source regressions and were not worked around in repository code.
- The P6 driver cannot prove audible playback, and an onset-only result must not be reported as eight successful samples.
- No public deployment, production readiness, Azure certification, cost guarantee, or guaranteed cancellation savings is claimed.

## Conclusion

The WebRTC/LiveKit implementation and its deterministic verification are complete. The workflow's external evidence gates remain blocked, so the goal is **not fully verified** and the workflow is **not marked complete**. No latency improvement is claimed; the measured comparison is inconclusive. Execution should resume only when a LiveKit target, native database access, browser/network setup, and fresh bounded paid-run approval are supplied.
