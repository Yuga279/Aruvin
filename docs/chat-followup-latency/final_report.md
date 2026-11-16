# Follow-up latency: implementation and results

## Latest: drastic admission simplification

The user-requested single-agent follow-up is implemented as **`301c33b`** and independently verified. It replaces repeated healthy-path archive/status/ownership work with carried admission evidence, combines acceptance publication, and removes the empty text prepare checkpoint before dispatch. Cold/recovery, public versus internal stream visibility, active-session checks, manifest-before-inference validation and durability remain enforced. The stock saver facade stays disabled.

| Follow-up metric | Previous increment | Latest | Original clean baseline |
| --- | --- | --- | --- |
| Complete emulated DB commands | 151 | **128** | 169 |
| Pre-dispatch dependency waves | 68 | **47** | 69 |
| First-text dependency waves | 77 | **56** | 78 |
| Post-seal dependency waves | 30 | **30** | 44 |

That is **31% fewer pre-dispatch waves** than the previous increment, not a measured 31% wall-clock improvement. Halving 68 was not achieved, and the remaining 47 waves are not established as an irreducible minimum. New-chat post-seal work increases slightly, 30→31 waves; the follow-up tail is unchanged.

Main checks on stable source: build/lint pass (warnings remain); backend **2398 passed / 8 performance-target failures / 10 skipped**; e2e **22 passed / 135 skipped**; separate performance selection **149 passed / 8 target failures**. All 599 backend source/test hashes match before/after. Frontend is unchanged from the previously verified 536-pass source. No new correctness failure remains in executed checks; the suite is not fully green.

Frozen goals now pass **7/15 commands**, **8/13 pre-dispatch**, **12/12 post-seal**, and **7/15 combined acceptance**. Remaining combined misses concern Calendar, cancellation and recovery. Details: [drastic-simplification-results.md](drastic-simplification-results.md) and [verification.md](verification.md).

**Sub-100 ms is still unverified.** No native/provider/browser latency run, app-data access, merge, application restart or deployment occurred. Review remains skipped. The sections below preserve the first increment's historical evidence, not the latest result.

## Outcome

Three task workers implemented the approved focused simplification on **`codex/chat-followup-latency`**. No separate planner/researcher sessions or unified reviewer were used. Review is **skipped**, not passed.

**The product changes are implemented and offline-verified, but the sub-100 ms goal is not achieved or established by this evidence.** The admission path still has substantial sequential work, and all 15 pre-existing combined performance acceptance cases remain failing. Nothing was merged into the user's active main checkout, restarted or deployed.

## What changed

- **Drafting:** the composer stays editable while text generates/finalizes. Send remains serialized until durable completion; voice ownership remains exclusive. Old request callbacks/cleanup cannot clobber a new draft or stream.
- **Context:** valid same-process attachment reuses verified admission history rather than repeating the full archive/attempt walk and whole prepare assembly. Actual checkpoint/manifest/settings evidence, fresh sensitive projections and strict fallbacks remain. A real pre-inference manifest change is still refused before provider dispatch.
- **Publication:** consecutive storage-only finalization shares one bounded ownership phase. Matched confirmed manifest evidence removes a reread. Early activity publication is removed only with an explicit non-live combined-finish commitment and the required receipt/CAS capabilities. Voice, recovery and fallback paths retain activity ownership.
- **Sidebar:** known-session reconciliation waits 250 ms of idle time and is cancelled/deferred by a follow-up. Authoritative row updates preserve pinning and loaded pages. New rows still obtain server metadata; timestamps/titles are not invented.
- No new dependencies/services, model switch, silent history trimming, weaker sync/majority durability, premature terminal event, or default checkpoint-facade activation.

## Measured offline improvement

Follow-up after 1 or 20 completed turns, against the independently captured clean branch baseline:

| Metric | Before | After | Change |
| --- | --- | --- | --- |
| Complete emulated database commands | 169 | 151 | 10.7% fewer |
| Pre-dispatch storage dependency waves | 69 | 68 | 1.4% fewer |
| Post-seal storage dependency waves | 44 | 30 | 31.8% fewer |

**These are fixture counts, not native RTT, real milliseconds, browser responsiveness or provider TTFT.** They show a meaningful finalization reduction but only a small start-path improvement. All 15 final scenarios have no command/wave regression versus the clean branch baseline; the initial new-chat/Calendar regression was corrected before closeout. Full scenario data is in [verification.md](verification.md).

Against unchanged older frozen targets: command goals **3/15**, pre-dispatch goals **0/13**, post-seal goals **12/12**. Overall performance acceptance remains **not met**.

## Verification

- Backend/frontend builds and lints: **pass**, with warnings remaining.
- Backend unit: **2379 passed / 15 performance-target failures / 10 skipped**. Untouched baseline: 2347 passed / the same 15 failures / 10 skipped. No additional correctness failure remains in the executed checks; the full suite is not green.
- Frontend unit: **536 passed**, 73 files.
- Backend e2e: **22 passed / 135 skipped**. No real native database certification follows from those skips.
- Independent corrected performance run: **134 passed / 15 target failures**; profiles/histograms reconciled against full-unit output.
- Stable verification manifests: 598 backend source/test files and 171 frontend source files.
- No paid/provider/Calendar calls, application-data access, native load, restart, migration or deployment. Node frontend tests are not browser/device proof.

## Commit record

| Owner | Implementation commits |
| --- | --- |
| W1 context/admission | `8ba5db5`, correction `aa1eac6` |
| W2 persistence/publication | `e28399b` |
| W3 composer/sidebar | `2486483`, test compilation correction `a802e4a` |
| Three worker-owned brief plans | `e887f4e` |

Verified application source is **`aa1eac647f6b68b74266f59e7f1e44f4d0152b1e`**. Subsequent closeout commits contain documentation only. [State](state.md) records execution and [goal](goal.md) preserves the requirements. Original concurrent main-checkout context/admin work remains separate and needs an explicit compatibility merge, not an overwrite.

## Remaining work

1. Obtain explicitly authorized, representative native/browser stage timings with topology, history size and crash-journal mode recorded. Keep provider TTFT separate. Until then, **sub-100 ms is unverified**.
2. Use those measurements to prioritize further admission/ownership/checkpoint simplification. There are still 68 pre-dispatch dependency waves in the fixture; this task does not justify calling that path fast or irreducible.
3. Native saver conformance/activation, real provider/cache behavior and deployment remain separately gated. No implicit permission follows from this report.
