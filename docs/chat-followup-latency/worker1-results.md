# Worker 1 results — admission/context healthy path

Review: **skipped** (not passed). No commit. No native DB, provider, install, or package-wide build/lint/e2e.

## Files

Modified:

- `backend/src/chat-runtime/admission-receipt.ts`
- `backend/src/chat-runtime/durable-chat-runtime.ts`
- `backend/test/runtime/text-config.spec.ts` (authorized: ordinal `memory.get` spy → genuine pre-inference mutation)
- `docs/chat-followup-latency/plan1.md`
- `docs/chat-followup-latency/worker1-results.md`

Created:

- `backend/test/performance/admission-context-reuse.spec.ts`
- `backend/test/chat-runtime/admission-receipt-reuse.spec.ts`
- `backend/test/chat-runtime/publication-activity-commitment.spec.ts`

Not modified: `finalization.ts`, `persistence/*`, `model/*`, frontend, contracts/context, package files, frozen `durable-latency.spec.ts` / `latency-runtime-fixture.ts`.

## What changed

Admission still runs full `checkBoundary` (submit/retry/live accept). Receipts are stored only when LangGraph `checkpoint_id` is pinned (not `${sessionId}-0`). `configRevision` is the accepted snapshot revision.

Empty-boundary `updateState` return config supplies the pinned checkpoint id. There is **no** extra `getState` after that acknowledged write. `storeAdmissionReceipt` does **not** call `memory.getConfirmed`; execute reuse still reads a fresh confirmed manifest.

Same-process `attachAccepted` execute:

1. Compact proof: scope, executor, response mode, revision, assets, input hash, pinned checkpoint, `getState` id/boundary, current manifest (`getConfirmed`/`get`), merge plain rows + refreshed privacy refs.
2. Assemble **once** with that source (time/voice/mode/tombstones).
3. Skip graph-prepare re-assembly only when that proof succeeded.
4. Any doubt → existing `checkBoundary`. Missing receipt → existing recover path.

Receipts are dropped on cancel, reconcile, rebase, quiesce, drain, and successful execute. `graphEpoch` is still `0` and is not authorization.

Publication evidence uses W2-declared `LivePublicationEvidence`:

- `baseManifestReceipt` when execute-time `getConfirmed` matches the manifest.
- `activityUpdatedByFinish: true` only for `!c.live` **and** `finishAttempt` **and** `attemptReceipt` **and** `compareAttemptConfirmed`, with existing `onAttemptConfirmed`. Voice/live and receipt-less recovery omit the flag.

## Red / green

Env: `AURVIN_TEST_MONGODB_URI=''`, `AURVIN_TEST_DB_PREFIX=''`, `AURVIN_NATIVE_PERF_ENABLE='disabled'`. From `backend/`.

### Extra-read regressions (TDD)

```powershell
npm test -- test/performance/admission-context-reuse.spec.ts test/runtime/text-config.spec.ts -t "does not reread|refuses an execution-local source snapshot|pins a real checkpoint" --maxWorkers=1 --reporter=verbose
```

| Stage | Result |
| --- | --- |
| Red | Extra `getTuple` after empty-boundary `put`; `getConfirmed` after `detachAccepted`; text-config ordinal 3rd `memory.get` let execute resolve. |
| Green | **4 passed**. Checkpoint id still pinned from `updateState` config. No `getConfirmed` after detach. |

### Manifest-before-inference (text-config.spec.ts)

Root cause: not a missing prepare guard. Execute no longer does the extra `memory.get` after `checkBoundary` (`contextSources.manifest` is reused), so the 3rd-read spy never fired. Guard `isDeepStrictEqual(memory.get(...), contextSources.manifest)` in graph prepare is unchanged.

Test now mutates the **persisted** manifest on the first `owner.fence` of execute (prepare, before generate). Execute rejects `NOT_READY`; fetcher is never called. Full `text-config.spec.ts`: **21 passed**.

### Focused W1 + text-config

```powershell
npm test -- test/performance/admission-context-reuse.spec.ts test/chat-runtime/admission-receipt-reuse.spec.ts test/chat-runtime/publication-activity-commitment.spec.ts test/runtime/text-config.spec.ts --maxWorkers=1 --reporter=verbose
```

**37 passed / 0 failed.**

### Frozen `test/performance`

```powershell
npm test -- test/performance --maxWorkers=1 --silent=false --disableConsoleIntercept --reporter=verbose
```

**134 passed / 15 failed / 11 files**, exit 1. All **15** failures are unchanged frozen **acceptance-target** cases. All **fixed baseline regression caps passed**. Caps not rebased.

Raw log: `C:/Users/Peter/AppData/Local/Temp/opencode/followup-w1-performance-20261102.log`.

67/449ms wire counts vs clean-branch baseline (`followup-clean-branch-baseline-20261102.log`) vs prior candidate (`followup-final-performance.log`):

| Scenario | Clean baseline | Prior candidate | This W1 run |
| --- | --- | --- | --- |
| new-text | 129R/45W, 75/84/44 | 117R/44W, 79/88/30 | **112R/44W, 74/83/30** |
| follow-up-1 | 128R/41W, 69/78/44 | 112R/40W, 69/78/30 | **111R/40W, 68/77/30** |
| follow-up-20 | 128R/41W, 69/78/44 | 112R/40W, 69/78/30 | **111R/40W, 68/77/30** |
| calendar-text | 124R/43W, 92/95/32 | 125R/43W, 96/99/32 | **120R/43W, 91/94/32** |
| cancel-before | 66R/21W | 71R/21W | **66R/21W** |

Also this run: calendar-read 172R/60W 91/163/32; calendar-create 218R/68W 91/217/32; calendar-conflict 156R/51W 91/200/32; calendar-proposal-reply 192R/55W 173/176/32; rejection-retry 111R/39W 69/78/30; cancel-midstream 116R/35W 74 pre; reconnect 55R/12W.

New-text/calendar/cancel are **not** above clean baseline. Follow-up pre-dispatch is **68** vs clean **69**. Fake-driver counts, not native ms/p95.

## W2 integration

`LivePublicationEvidence.baseManifestReceipt` and `activityUpdatedByFinish?: true` are used as declared. No `finalization.ts` edit. Finish flag is explicit caller commitment, not inferred from `onAttemptConfirmed`.

## Callers

| Path | Behavior |
| --- | --- |
| submit / submitLive / retry accept | Full `checkBoundary`; pin checkpoint from `getState` or `updateState` return |
| execute with proven receipt | Compact reuse |
| execute without/expired/unpinned/wrong-scope | Strict reconstruction or recover |
| cancel / reconcile / rebase / quiesce / drain | Invalidate receipts |
| Live execute | Same reuse; `responseMode: 'voice'` must match; no `activityUpdatedByFinish` |
| Prepare | Compact `memory.get` vs captured source; refuses mutated durable manifest before generate |

## Unresolved

- Absolute sub-100 ms native/browser/provider targets unverified.
- Frozen 15 acceptance-target failures remain (honest; caps unchanged).
- `graphEpoch` unused for proof.
- No full live/voice mixed-history fixture on the latency harness.
- Parent reruns full backend build/lint/unit/e2e on this snapshot.
