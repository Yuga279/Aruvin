# Publication storage amplification Implementation Plan

> **For this worker:** implement in this same session. Unified review is **skipped**, not passed. No separate planner, no commits.

**Goal:** Remove demonstrated persistence/finalization amplification on live text publication while keeping existing durability, recovery, and uncertain-write confirmation.

**Architecture:** Reuse `MongoOwnership.runPhase` / `owner.run` / confirmed-record APIs. Wrap consecutive storage-only publication (assistant+accounting stage, manifest put, graph boundary write/readback, completion, optional activity, terminal attempt) in **one** existing `publication-stage` phase instead of a stage fence plus repeated two-read fences. Skip the early `touchActivity` only when the combined `finishAttempt` path is guaranteed from existing live evidence + owner/metadata APIs. Use optional `LivePublicationEvidence.baseManifestReceipt` with existing `putConfirmed(target, receipt)` when W1 supplies a store-bound receipt; omitted evidence keeps the strict reread path.

**Tech Stack:** Nest/TypeScript backend, Vitest fixtures, `calendarMemory` fake driver, existing `MongoOwnership` / `MongoMemory` / `MongoMessages` / `MongoMetadata`.

---

## Files

- Create: `backend/test/performance/finalization-publication-amplification.spec.ts` (operation-count + receipt + skip-activity)
- Create: `backend/test/runtime/finalization-publication-safety.spec.ts` (recovery/fallback/uncertain-write/phase bounds)
- Modify: `backend/src/chat-runtime/finalization.ts` only for production behavior
- Create: `docs/chat-followup-latency/worker2-results.md` after green
- Do **not** edit: runtime/admission/context, frontend, package files, checkpoints default facade, frozen latency specs, `goal.md`/`state.md`
- Do **not** change `backend/src/model/*` (no independently proven first-token duplication that can be removed without weakening ID/accounting-before-output)
- Do **not** activate the bounded checkpoint read facade or change LangGraph `sync` durability

## Out of scope / non-changes

- Uncertain-write confirmation, majority acknowledgments, saved-result recovery, provider identity/accounting barriers, default checkpoint bounds
- Nested phases, phases stretched across model/tool/network/`c.emit`
- New ownership abstractions, custom saver, durability mode switch
- Extra `activityUpdatedByFinish` flag: **required** for skipping early `touchActivity`. Callback presence is not a finish commitment. W1 sets `true` only for `!c.live && finishAttempt && attemptReceipt && compareAttemptConfirmed`.

## Integration (W1)

- Optional `LivePublicationEvidence.baseManifestReceipt?: ConfirmedRecord<AgentMemoryManifest>`
- W1 supplies the actual store-bound receipt from admission/attachment
- W2 uses `p.memory.putConfirmed(r.target, receipt)` only after `receipt.record` matches `evidence.baseManifest` and existing base/target boundary checks
- Omitted receipt → existing `memory.put` reread path

---

### Task 1: Failing publication-amplification checks

**Files:**
- Create: `backend/test/performance/finalization-publication-amplification.spec.ts`
- Modify: `backend/src/chat-runtime/finalization.ts`

- [x] **Step 1: Write failing tests** for one storage-only phase, receipt reuse, and combined-finish activity skip
- [x] **Step 2: Run tests and confirm they fail for the missing behavior**
- [x] **Step 3: Implement minimal `publishResult` changes**
- [x] **Step 4: Re-run until green**

### Task 2: Fault / recovery / fallback safety

**Files:**
- Create: `backend/test/runtime/finalization-publication-safety.spec.ts`

- [x] **Step 1: Write failing/characterizing tests** for omitted evidence, missing `finishAttempt`, mismatched receipt, uncertain manifest write, memory failure before terminal CAS, phase `maxOperations`/deadline
- [x] **Step 2: Confirm omitted-evidence/fallback still touch activity and reread; new mismatch/bound cases fail until implemented**
- [x] **Step 3: Keep fallback sequential `owner.run` path byte-equivalent aside from `putConfirmed` when a valid receipt is present**
- [x] **Step 4: Re-run focused tests**

### Task 3: Results

- [x] Write `docs/chat-followup-latency/worker2-results.md` with exact files, red/green commands, measured fence/command savings, limitations, W1 integration needs
- [x] No staging/commits; parent serializes
