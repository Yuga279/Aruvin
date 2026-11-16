# Drastic admission simplification — results

Review: **skipped**, not passed. No commits. Parent serializes named files.

## Source files

Modified:

- `backend/src/chat-runtime/durable-chat-runtime.ts`
- `backend/src/agent/turn-graph.ts`
- `backend/src/persistence/ownership.ts`
- `backend/src/http/chat-http.service.ts`
- `backend/src/chat-runtime/ports.ts`
- `backend/src/operations/observed-runtime.ts`
- `backend/test/http/service.spec.ts`
- `backend/test/performance/shared-admission-critical-path.spec.ts` (`acceptance-stage` maxOperations 4→8)
- `backend/test/performance/conversation-latency.spec.ts` (allow one admission `getReferences`)

Created:

- `backend/test/performance/admission-preflight-simplification.spec.ts`
- `docs/chat-followup-latency/drastic-simplification-notes.md`
- `docs/chat-followup-latency/drastic-simplification-results.md`

Not modified: frozen `durable-latency.spec.ts` / `latency-runtime-fixture.ts`, `goal.md` / `state.md` / `verification.md` / `final_report.md`, frontend, packages.

## Necessary vs removed

Kept (app fails without them): identity/bounds; idempotency read; one session existence read on follow-up; `acquire` CAS; admission `getState` (LangGraph `next`/boundary — skipping it would resume a stuck graph as a new turn); persist input+attempt then acceptance marker; sequence allocation; `detachAccepted` generation; execute `attachAccepted` CAS; privacy-row refresh; assemble once; prepare `memory.get` vs captured manifest; possible-billing write; generation identity before delta; terminal `finishAttempt`.

Removed from healthy traffic:

| Removed | Remaining equivalent |
| --- | --- |
| Extra `sessions.get` + `createIfAbsent` on follow-up | First get + acquire’s returned session |
| Explicit `assertExecutor` before acquire | Acquire/attach/detach already assert |
| Full `acceptedHistory` (archive + attempts + acceptances) at admit | Manifest + `getReferences`; `checkBoundary` on miss |
| Execute `latestAttempt` + `messages.get` when receipt matches | Attach CAS + receipt records |
| Execute reuse `getState` + `getConfirmed` | Attach generation + prepare `memory.get`; receipt may carry `manifestReceipt` |
| Prepare `fence` after this execute’s attach | Lease is ours; recover path still fences |
| Second `acceptance-publish` phase | Confirm inside `acceptance-stage` (bind-before-confirm preserved) |
| Text graph checkpoint between prepare and generate | Generate runs inside prepare when there is no calendar cursor/seal |
| HTTP stream `session()` on a **public text hot receipt** | Local receipt check: `responseMode === 'text'` and input is not internal/live. `sessions.delete` cannot archive while `activeAttemptId` is set, so a live public receipt already implies an active session. |

Cold/recovery unchanged: synthetic/missing/wrong-scope receipt, no attach, orphan input, empty manifest, rebase/reconcile/cancel (still drop receipts). Native saver facade, write concern, async/exit durability unchanged.

Admission **still** `getState`s on healthy follow-up. That is the remaining 4-wave `getTuple` duplication (gated facade). Not enabled.

### Public stream visibility (follow-up)

`getStreamAttempt` is no longer a silent `getTurnStatus`. Public hot text receipt → status, no storage. Live/internal hot receipt → `NOT_FOUND` locally (voice stays on `getLiveTurnStatus`). Miss → `null`; HTTP `streamStatus` then `session()` (active lifecycle) before `getTurnStatus`. Observed-runtime no longer substitutes `getTurnStatus` when the raw runtime has no helper.

Execute already matches: public path `NOT_FOUND` on `visibility === 'internal'`; live path requires internal+live; `attachAccepted` requires `lifecycle: 'active'`; archive/`delete` is idle-only (`ownerId` and `activeAttemptId` null), so a detached accepted slot cannot be archived under a hot receipt. Terminal reconnect `sessions.get` is the existing recovery path, not the public stream gate.

## Red / green

Env: `AURVIN_NATIVE_PERF_ENABLE=disabled`, empty `AURVIN_TEST_MONGODB_URI` / `AURVIN_TEST_DB_PREFIX`. From `backend/`.

Red (before app edits): 5/6 simplification tests failed as intended (archive walk, second phase, execute rereads, unused `getStreamAttempt`; checkpoint assertion after fixing seed-fetch contamination). Manifest-after-attach refusal already held.

Green focused: `admission-preflight-simplification.spec.ts` **8 passed** (including live-receipt `NOT_FOUND` and missing-receipt `null`); HTTP `service.spec.ts` + `stream-transport.spec.ts` **19 passed** (public hot: no `sessions.get`; archived/missing cold: `NOT_FOUND` before `getTurnStatus`; live receipt: `NOT_FOUND` without a session read).

## Full checks

| Check | Result |
| --- | --- |
| `npm run build` | Pass, exit 0 |
| `npm run lint` | Pass, exit 0, existing warnings; not warning-clean |
| `npm test -- --maxWorkers=1` | **2392 passed / 8 failed / 10 skipped**, 279 files, exit 1 |
| `npm run test:e2e -- --maxWorkers=1` | **22 passed / 135 skipped**, 45 files, exit 0 |
| `npm test -- test/performance --maxWorkers=1` | **146 passed / 9 failed** then conversation-latency assertion fixed; matrix below |

The 8 full-suite failures are frozen **acceptance-target** cases only (calendar + cancel-before + cancel-midstream + reconnect). No extra correctness failure. Previous corrected suite: 2379 pass / 15 target fail / 10 skip. Seven text/retry target cases now pass.

## Before → after (corrected candidate → this worker)

Counts are emulated commands; waves are pre-dispatch / first-answer / post-seal. Not native ms.

| Scenario | Before (corrected) | After |
| --- | --- | --- |
| New text | 112R/44W, 74/83/30 | **98R/42W, 56/65/31** |
| Follow-up 1 | 111R/40W, 68/77/30 | **90R/38W, 47/56/30** |
| Follow-up 20 | 111R/40W, 68/77/30 | **90R/38W, 47/56/30** |
| Follow-up 38/39/50 | 112R/40W, 68/77/30 | **90R/38W, 47/56/30** |
| Calendar text | 120R/43W, 91/94/32 | **112R/43W, 82/85/32** |
| Calendar read | 172R/60W, 91/163/32 | **164R/60W, 82/154/32** |
| Calendar create | 218R/68W, 91/217/32 | **210R/68W, 82/208/32** |
| Calendar conflict | 156R/51W, 91/200/32 | **148R/51W, 82/191/32** |
| Calendar proposal | 192R/55W, 173/176/32 | **176R/55W, 160/163/32** |
| Explicit retry | 111R/39W, 69/78/30 | **93R/37W, 53/62/30** |
| Cancel before | 66R/21W | **65R/21W** |
| Cancel midstream | 116R/35W, 74 pre | **101R/33W, 56 pre** |
| Reconnect | 55R/12W | **55R/12W** |

Follow-up-1 vs corrected: commands **151→128** (−15%), pre-dispatch waves **68→47** (−31%), post-seal **30** unchanged. vs clean baseline 169/69/44: commands −24%, pre −32%, post −32%.

New-text post-seal **30→31** (+1 wave). Still far under the frozen post cap. No other scenario regresses vs the corrected candidate on commands or pre-dispatch.

Against unchanged frozen goals: command **7/15** (was 3/15), pre-dispatch **8/13** (was 0/13), post-seal **12/12**. Combined acceptance **7/15** (was 0/15). Remaining misses: calendar (cursor must stay durable before tools), cancel-before/midstream command caps, reconnect off by 1 command.

Halving 68 was the stretch; 47 is a major cut, not half. Remaining serial cost is mostly admission `getTuple` (facade gated) and Calendar prepare→decide.

## Limitations

- Fixture BSON commands, not native RTT / p95 / provider TTFT.
- `getTuple` still double-reads on non-empty checkpoints; default facade stays off.
- Calendar ordinary-text still uses the calendar graph, so it does not get the text prepare/generate merge.
- Absolute sub-100 ms remains unverified.
