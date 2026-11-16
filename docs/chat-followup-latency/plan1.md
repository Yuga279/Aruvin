# Healthy Admission Context Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Unified review is skipped. Do not commit; parent serializes named files.

**Goal:** On a proven same-process healthy attachment, skip the second full archive/attempt walk and the extra whole-context assembly, without trusting synthetic checkpoint IDs or the unmaintained graph epoch.

**Architecture:** Keep `checkBoundary` as the strict reconstruction path (submit, retry, live admission, recovery, rebase, and any failed proof). Pin a real LangGraph `checkpoint_id` plus accepted settings on the existing `AdmissionReceipt`. Execute attachment then runs compact ownership/version/boundary checks, refreshes privacy-sensitive refs, assembles once with reused immutable records, and skips the graph prepare re-assembly only when that proof succeeded. Missing, expired, oversized, stale, wrong-scope, or unpinned evidence falls back to `checkBoundary` or refuses.

**Tech Stack:** NestJS/TypeScript runtime, existing `AdmissionReceiptStore` / `ConfirmedRecord`, Vitest fixture persistence (no native DB, no provider network).

---

## Files

- Modify: `backend/src/chat-runtime/admission-receipt.ts` — pinned-checkpoint helper, source-record merge, optional store-bound manifest receipt.
- Modify: `backend/src/chat-runtime/durable-chat-runtime.ts` — capture real checkpoint evidence at admission; compact reuse on execute; invalidate receipts on cancel/reconcile/rebase/quiesce/drain; optional `baseManifestReceipt` on live publication evidence without editing `finalization.ts`.
- Create: `backend/test/performance/admission-context-reuse.spec.ts` — runtime red/green: no archive/attempt rescan on proven attach; assemble-once; fallback.
- Create: `backend/test/chat-runtime/admission-receipt-reuse.spec.ts` — helper/fallback unit checks.
- Create: `docs/chat-followup-latency/plan1.md` (this file) and later `docs/chat-followup-latency/worker1-results.md`.
- Do not modify: `finalization.ts`, `persistence/*`, `model/*`, frontend, root goal/state, package files, `durable-latency.spec.ts`, `latency-runtime-fixture.ts`.

## Caller map (do not skip)

| Caller | Healthy reuse? | Why |
| --- | --- | --- |
| `submitTurn` / `acceptNewTurn` | No — full `checkBoundary` | First proof; must persist acceptance against reconstructed boundary. |
| `submitLiveTurn` | Same as submit | Voice/text classification only changes `responseMode`. |
| `retryTurn` / `acceptRetry` | No — full `checkBoundary` | New attempt, same input; still needs a current boundary proof. |
| `executeTurn` with in-process receipt + `attachAccepted` | Yes, if pinned checkpoint + compact proof | This is the duplicate archive/assemble path. |
| `executeTurn` without receipt / attach failure | No — existing recover + `checkBoundary` | Restart, expiry, missing detach. |
| Graph `prepare` on proven attach | Compact fence + manifest equality only | Fresh projections already done at execute. |
| Graph `prepare` on fallback/recovery | Unchanged assemble | Reconstruction stays strict. |
| `reconcileSession` / `rebaseSession` / `cancelTurn` | No reuse; delete session receipts | History/ownership changed or attempt ended. |
| `quiesceStreams` / `drain` | Clear store | Retention/redaction quiesces first; in-memory sources must not survive. |
| Calendar execute | Reuse only the pre-graph context proof | Calendar prepare/generate hooks stay as they are. |

Do **not** authorize reuse from `checkpointId === `${sessionId}-0`` or from `graphEpoch` (map is never advanced). Capture `snap.config.configurable.checkpoint_id` after any admission `updateState`. If it is missing or synthetic, do not put a reusable receipt.

## Compact proof (execute)

All must hold, else `checkBoundary`:

1. Receipt scope: user/session/turn/attempt, `executorId`, `responseMode`, bound `snapshot.revision === configRevision`.
2. Assets still match receipt manifest instruction/knowledge/graph versions.
3. `isPinnedCheckpointId(sessionId, checkpointId)`.
4. Input receipt matches attempt `userMessageId` / payload hash.
5. Compact reads only: `memory.getConfirmed`/`get`, `graph.getState`, `getReferences(refreshRefs)` (or per-id `get` if needed).
6. Manifest deep-equal; snapshot `checkpoint_id` and `boundary` match; `next` empty.
7. Merge `sourceRecords` + refreshed refs; every manifest ref present and scoped.
8. Assemble **once** with that source (time/voice/mode/tombstones).
9. Attempt context versions still match assembled context.

Ordinary immutable records are reused; privacy-sensitive/live/provenance rows are always refreshed.

## W2 integration

`LivePublicationEvidence` on this branch has no `baseManifestReceipt` yet. Obtain `p.memory.getConfirmed` when present, keep it matched to `baseManifest`, and pass it as an extra property on the evidence **variable** (structural typing; no `finalization.ts` edit). If W2 has not landed the field, it is ignored at compile time of that file and unused at runtime until W2 reads it.

---

### Task 1: Failing reuse regression

**Files:**
- Create: `backend/test/performance/admission-context-reuse.spec.ts`
- Create: `backend/test/chat-runtime/admission-receipt-reuse.spec.ts`

- [x] **Step 1: Write the failing tests** (no production edits)

Runtime: after submit, spy `listForContext` / `listAttempts`, execute, expect **not** called; `assemble` called once during execute. Synthetic `${sessionId}-0` receipt must call `listForContext` again. Stale manifest must refuse. Helper tests: pinned-id false for synthetic; merge prefers refreshed records and returns null on missing refs.

- [x] **Step 2: Run tests to verify they fail on current behavior**

Run (from `backend/`, env cleared, no native URI):

```powershell
$env:AURVIN_TEST_MONGODB_URI=''; $env:AURVIN_TEST_DB_PREFIX=''; $env:AURVIN_NATIVE_PERF_ENABLE='disabled'
npm test -- test/performance/admission-context-reuse.spec.ts test/chat-runtime/admission-receipt-reuse.spec.ts --maxWorkers=1
```

Expected: reuse test fails because execute still runs `checkBoundary` → archive/attempt scans and a second assemble.

### Task 2: Receipt helpers

**Files:**
- Modify: `backend/src/chat-runtime/admission-receipt.ts`

- [x] **Step 3: Add pinned-id, scope, and merge helpers; optional `manifestReceipt`; keep store bounds/TTL**

```typescript
export function isPinnedCheckpointId(sessionId: string, checkpointId: string): boolean {
  return checkpointId.length > 0 && checkpointId.length <= 128 && checkpointId !== `${sessionId}-0`;
}
```

- [x] **Step 4: Re-run helper tests; they pass. Runtime tests still fail.**

### Task 3: Runtime reuse

**Files:**
- Modify: `backend/src/chat-runtime/durable-chat-runtime.ts`

- [x] **Step 5: `checkBoundary` returns `{ context, source, checkpointId }` captured after any `updateState`. Put receipts only with pinned checkpoint + `snapshot.revision`. Execute: `reuseAdmittedContext` or fallback `checkBoundary`. Skip prepare re-assemble only on successful reuse. Delete/clear receipts on cancel, reconcile, rebase, quiesce, drain. Pass matched `baseManifestReceipt` on evidence when `getConfirmed` exists.**

- [x] **Step 6: Re-run focused tests; all pass.**

- [x] **Step 7: No commit** (parent serializes). Write `worker1-results.md`.

## Safety invariants (unchanged)

Durable acceptance before inference; one active attempt; generation identity before output; saved-result recovery without replay; no silent truncation; no new cache framework/service/dependency; native saver facade stays inactive.
