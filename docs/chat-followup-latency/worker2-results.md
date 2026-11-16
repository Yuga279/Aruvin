# Worker 2 results: finalization persistence amplification

Review: **skipped**, not passed. No commits. No native DB, provider, Calendar, package-wide suite, or p95 claim.

## Files

| Path | Change |
| --- | --- |
| `backend/src/chat-runtime/finalization.ts` | Production: one `publication-stage` for consecutive storage-only publication; optional `baseManifestReceipt`; skip early `touchActivity` only when `activityUpdatedByFinish === true` **and** finishAttempt/attemptReceipt/compareAttemptConfirmed/(terminal or onAttemptConfirmed); `putConfirmed(target, receipt)` with conflict-equals-target fallback |
| `backend/test/performance/finalization-publication-amplification.spec.ts` | Created: one-phase fence/receipt/activity check with `activityUpdatedByFinish: true` |
| `backend/test/runtime/finalization-publication-safety.spec.ts` | Created: recovery, omitted flag, true flag, missing capability, voice/no flag, receipt validation, uncertain write, republish |
| `docs/chat-followup-latency/plan2.md` | Brief W2 plan |
| `docs/chat-followup-latency/worker2-results.md` | This report |

Not present (stale inventory removed): `backend/test/performance/finalization-publication.spec.ts`.

Not modified: `ownership.ts`, `memory.ts`, `checkpoints.ts`, `metadata.ts`, `store.ts`, `backend/src/model/*`, runtime/admission/context, frontend, package files, frozen `durable-latency.spec.ts` / `latency-runtime-fixture.ts`, `goal.md` / `state.md`. Existing `runPhase` / `putConfirmed(expected)` / confirmed-record APIs were reused.

## Red then green

Env for every command: `AURVIN_TEST_MONGODB_URI=''`, `AURVIN_TEST_DB_PREFIX=''`, `AURVIN_NATIVE_PERF_ENABLE='disabled'`. From `backend/`.

**RED** (amplification test against unchanged `publishResult`):

```
npm test -- test/performance/finalization-publication-amplification.spec.ts --maxWorkers=1 --reporter=verbose
```

- First fixture miss: `INTERRUPTED` until `reserveAttempt` before `confirmAcceptance` (test setup, not product).
- Then: `expected "fenceSession" to be called 1 times, but got 5 times`.

**RED** (explicit finish commitment):

```
npm test -- test/runtime/finalization-publication-safety.spec.ts -t "activityUpdatedByFinish is omitted" --maxWorkers=1 --reporter=verbose
```

- `expected "touchActivity" to be called 1 times, but got 0 times` while callback/receipt/finish/CAS were present without the flag.

**GREEN** after requiring `activityUpdatedByFinish === true` in addition to capability checks:

```
npm test -- test/performance/finalization-publication-amplification.spec.ts test/runtime/finalization-publication-safety.spec.ts test/runtime/finalization-repair.spec.ts --maxWorkers=1 --reporter=verbose
```

30 passed / 0 failed (1 amplification + 15 safety + 14 repair).

Related focused (not package-wide, earlier this worker): `accounting-completion.spec.ts`, `owned-phases.spec.ts`, `latency-storage.spec.ts` — 17 passed.

## Measured command/dependency savings (fixture-stable)

Live text `publishResult` with `activityUpdatedByFinish: true`, store-bound `baseManifestReceipt`, `attemptReceipt`, `onAttemptConfirmed`, and `finishAttempt` (BSON `calendarMemory`, not native RTT):

| Check | Before | After |
| --- | --- | --- |
| `fenceSession` during publish | 5 | 1 |
| Ownership fence reads (executor + session per fence) | 10 | 2 |
| `agent-memory` preliminary `findOne` / `getConfirmed` | 1 | 0 |
| Early `sessions.touchActivity` | 1 write | 0 |

Stable on repeated focused runs. **8 ownership fence reads and 1 activity write** removed on that flagged path; plus **1 manifest reread** when W1 supplies the receipt.

Omitted `baseManifestReceipt` still uses `memory.put` (reread). Omitted live evidence, omitted `activityUpdatedByFinish`, voice/no flag, and missing `finishAttempt` / `attemptReceipt` still call `touchActivity`.

These are synthetic command counts, not native latency or p95.

## Behavior kept

- Uncertain writes: `failNext('after-write')` on agent-memory `replaceOne` still confirms; `before-write` does not complete (attempt stays `finalizing`, manifest stays v0).
- Forged / wrong-store receipts: `INVALID_REQUEST` before replace.
- Receipt record ≠ `baseManifest`: `NOT_READY` before mutating context.
- Saved-result recovery without evidence still publishes without a provider call; already-written target + live receipt succeeds via conflict-equals-target.
- `publication-stage` `maxOperations: 8`, deadline `<= leaseExpiresAt - 1000`, no nested `runPhase`.
- Checkpoint default facade not activated. Durability stays `sync`. No model/first-token change.

## Integration need (W1)

Keep `baseManifestReceipt` as implemented. Additional required field:

```ts
activityUpdatedByFinish?: true
```

W1 sets `activityUpdatedByFinish: true` **only** when `!c.live && owner.finishAttempt && attemptReceipt && metadata.compareAttemptConfirmed`. Do not infer that commitment from `onAttemptConfirmed` alone. Voice (`c.live`), recovery (omitted evidence), and fallback omit the flag so publication keeps the early touch.

W2 does not edit runtime. W1 already attaches a matched store-bound `baseManifestReceipt` and `onAttemptConfirmed` in this worktree; it still needs to set the flag on the non-voice combined-finish path.

## Limitations

- Fixture BSON command counts only. Absolute sub-100 ms native/browser/provider targets remain unverified.
- Frozen acceptance-target failures stay visible; not rebased or suppressed.
- Whole-runtime follow-up 128R/41W vs 129R/45W comparison is for parent integration after W1 sets the flag.
- No package-wide `npm test` / build / lint while W1 edits.
- Model first-token persistence was not changed: dispatch accounting and generation identity before output stay intentional barriers.

## Review

Skipped, not passed.
