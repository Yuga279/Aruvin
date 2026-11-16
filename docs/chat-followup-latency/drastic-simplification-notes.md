# Drastic admission/preflight simplification

Review: **skipped**. No commits. This is the in-worker decision map, written before application edits.

## What 68 pre-dispatch waves actually are

Follow-up fixture counts (corrected candidate): **111R/40W, 68/77/30**. Admission phase **34** commands, attachment **7**, context **8**, then model-observation starts before fetch. Waves are serial storage rounds, not elapsed ms.

`getTuple` without the gated read facade is four serial finds for a non-empty checkpoint (app size/scope finds, then stock `super.getTuple` repeats them). Facade default activation stays **off**. Application code must stop *calling* duplicate `getState` rather than enabling the facade.

HTTP `GET` stream (`session()` + `getTurnStatus`) is **not** in the 68: the whole-runtime harness calls `submitTurn` then `executeTurn`. `getStreamAttempt` is declared and unused.

## Healthy-path protocol (keep only these)

One ownership/evidence decision at admission, carried through execute.

| Step | Why the app fails without it |
| --- | --- |
| Server identity, input/resource bounds | Trust boundary |
| Idempotency lookup | Duplicate POST must not create a second attempt |
| Session exists + active (one read) | `NOT_FOUND` vs busy |
| `acquire` CAS (returns session) | One executor, no overlapping owner |
| Manifest + referenced messages | Context selection; missing refs → recovery reconstruct |
| Persist user input + attempt, then acceptance marker | Durable acceptance before inference |
| Sequence allocation | Unique ordered archive ids |
| `detachAccepted` generation | Client may never attach; lease must not span HTTP |
| `attachAccepted` CAS on execute | One active attempt; generation is the “nothing else ran” proof |
| Privacy/voice/live row refresh | Retention/revocation must not reuse stale sensitive rows |
| Assemble once | Exactly-once new input, bounds |
| Manifest equality at prepare | Refuse execution-local snapshot if durable manifest moved |
| Possible-billing accounting write | Required before fetch |
| Generation identity before first delta | Existing contract |
| Honest terminal + `finishAttempt` | Release-before-next-send |

## Removed from ordinary healthy traffic

| Check | Why it is not essential | Remaining equivalent |
| --- | --- | --- |
| Extra `sessions.get` after existence + `createIfAbsent` get on follow-up | Acquire already reads/CAS the same document | First get + acquire result `session` |
| Explicit `assertExecutor` before `acquire` | `acquire`/`attach`/`detach` already assert | Those entry CAS operations |
| Full `acceptedHistory` (list archive + attempts + acceptances) at every admit | Manifest **is** context selection; reconstruction is a consistency audit | `getConfirmed`/`get` + `getReferences`; full walk only on miss/mismatch |
| Admission `graph.getState` on follow-up | **Kept.** Skipping it would let invoke resume a non-empty LangGraph `next` as a new turn. | Size/scope `getTuple` duplication stays gated on the saver facade |
| `latestAttempt` + `messages.get` at execute when receipt matches | Attach CAS (`activeAttemptId` + `expectedGeneration`) is the current-attempt proof | Receipt attempt/input; strict path if no receipt |
| Execute reuse `getState` + `getConfirmed` | Duplicate of admission evidence + attach generation | Prepare `memory.get` vs captured manifest; receipt may carry `manifestReceipt` |
| Prepare `owner.fence` after this execute’s `attachAccepted` | Lease generation is ours; single-process; heartbeat renews | Keep fence on recover/no-receipt path; keep `memory.get` mutation guard |
| Second `runPhase` (`acceptance-publish`) | Confirm is consecutive storage-only work with staging | One `acceptance-stage` including `confirmAcceptance` (and reply bind when present) |
| Text graph checkpoint between prepare and generate | Prepare is a no-op routing node on text; the generate checkpoint is what prevents re-inference after the model returns | Call `generate` inside `prepare` when there is no calendar cursor/seal; calendar routing unchanged |
| HTTP `session()` + `getTurnStatus` when an in-process receipt exists | Optional `getStreamAttempt` was already the API for this | Receipt status; fallback to existing status reads |

Cold/recovery **kept**: missing/expired/wrong-scope/synthetic-checkpoint receipt, no `attachAccepted`, orphan input, empty manifest, checkpoint/manifest mismatch, rebase/reconcile/cancel (still drop receipts).

## Callers

- `submitTurn` / `submitLiveTurn` / `retryTurn`: shared admission; retry still full-proofs original input + new attempt, then same combined stage.
- `executeTurn` text/voice: receipt+attach compact path; live still no `activityUpdatedByFinish`.
- Calendar execute: same admission; calendar graph still prepare→decide (cursor must be durable before tools). Ordinary calendar-text will gain admission cuts only.
- Cancel / reconnect / reconcile: unchanged strict path.
- Native saver facade, write concern, async/exit durability: **unchanged**.

## Conflicts not taken

- Enabling default read facade, or skipping size/scope checks on stock `getTuple`.
- Skipping possible-billing or acceptance durability.
- Merging calendar prepare with decide (cursor must survive crash before tools).
- Deleting the prepare `memory.get` guard (manifest-before-inference).

## Stretch

Halving 68 pre-dispatch waves is the target if the serial cuts above land. Command count should drop with the archive walk and duplicate reads even if some remaining waves are LangGraph `getTuple` (gated duplication).
