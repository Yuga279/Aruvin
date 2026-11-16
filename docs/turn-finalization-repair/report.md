# Stuck turn finalization investigation — 27 October 2026

## Outcome

Fixed two reproduced defects and added compatibility for affected stored messages. Changes are uncommitted on `codex/google-calendar-plugin`, based on `60b39a8`. Work was performed in this session; the user's latest instruction replaced the skills/multi-agent workflow. No reviewer was dispatched; unified review is skipped.

The existing stuck chat was inspected read-only, not reconciled or otherwise changed. The fixes make its previously invalid assistant record readable; they do not themselves run recovery or complete that existing turn.

## Incident evidence and causal chain

The affected attempt was last updated at 11:47:01.588 UTC with status `finalizing`. Its session retained `activeAttemptId` but had no executor owner or lease expiry. Later readiness was healthy and runtime metrics showed zero active jobs and no unresolved writes. New input was rejected with `CONFLICT_ACTIVE_TURN`.

A read-only examination of the actual saved state established:

- The graph is sealed with no next nodes or task errors, and carries a matching v2 Calendar seal (not a text `result`).
- An assistant archive record exists but remains `streaming`.
- Neither the application manifest nor graph boundary has reached the seal's target.
- The saved assistant record contains `voiceTranscripts: null`. The original message schema rejects that exact field with `invalid_type`; its repository decoder therefore throws `PERSISTENCE_ERROR`.

The matching source defect is in `redactCalendarMessageContent`: text-only redaction explicitly added `voiceTranscripts: undefined`. The default MongoDB driver serialization stores that property as BSON null. The durable write can succeed while the mandatory confirmation reread fails. Calendar publication cannot then finish the message, manifest, graph boundary, terminal status or slot cleanup. Error handling preserves the sealed result, marks the attempt `finalizing`, and releases the session owner while retaining the attempt marker. This is deliberate preservation of evidence, not a lock that may safely be deleted.

After restart, the new process's in-memory quarantine flag starts clear while the durable attempt marker remains. Ordinary text submission and stream attachment do not automatically reconcile it. That explains how a healthy process can still reject input for this session. The original failing request's complete log is unavailable, so the exact historical exception sequence is not asserted beyond the observed records and deterministic reproduction. In particular, the separate double-fault defect below is not established as part of this incident.

## Repairs

### 1. Redaction produced an invalid durable message

- Omit the optional transcript property when there is no transcript; preserve redaction of actual voice transcripts.
- Normalize legacy null transcripts to an empty array in the shared message schema, so all schema-based archive readers and finalization paths can consume existing affected records without weakening other validation.
- Correct generic persistence schema types to infer parsed output rather than nullable input for transforming schemas. No runtime persistence semantics change in those generic signatures.
- Verify BSON round-trip, terminal completion, legacy-record normalization, Calendar publication, and repeated saved-seal recovery without another model request.

### 2. A second failure during error recovery skipped quarantine

The execution error handler reads the checkpoint and attempts record-driven recovery before setting quarantine. If that checkpoint read or recovery itself throws, the old code skips the assignment and can return with `degraded=false` despite unfinished durable work.

- Guard that secondary recovery section, quarantine on failure, emit a payload-free persistence diagnostic and preserve the original outward error.
- A deterministic test injects publication failure followed by checkpoint-read failure and confirms `active=0`, `degraded=true`, the original error and the retained `finalizing` attempt.

## Other reasons finalization may remain incomplete

Finalization spans multiple durable records, deliberately without an assumed cross-collection transaction. A process exit, storage failure, ownership loss, failed confirmation, schema/evidence mismatch or exhausted persistence deadline at any required step can leave partial publication. A successful individual write does not establish full completion.

Recovery must verify saved graph/application evidence, finish publication idempotently and clear the attempt only after terminal durability. It must not restart inference to reconstruct a sealed answer, repeat a Calendar create, or infer a stopped executor from lease expiry alone. Missing/expired narration or contradictory evidence must fail closed or follow the existing interruption policy rather than invent success.

## Verification

All commands ran in `backend/` using deterministic provider fixtures, with no live model or Calendar requests:

- `npm run build`: passed.
- `npm run lint -- --format json`: passed, zero errors and 487 warnings; no warnings in the new regression file. Existing runtime warnings outside the edited recovery block remain.
- New `test/runtime/finalization-repair.spec.ts`: 11 passed. Includes before/after-commit archive, manifest and terminal-transition failures; repeated recovery; one model call only; no external effects; cleared session ownership and attempt marker.
- `npm test -- --no-file-parallelism`: 247 files passed, 2 skipped; 2,012 tests passed, 10 skipped.
- `npm run test:e2e`: 4 files passed, 40 skipped; 22 tests passed, 129 skipped. Prerequisite-dependent native integration results remain unverified; no application database was substituted for isolated fixtures.
- Default parallel `npm test`: 2,011 passed, 10 skipped, 1 failed on two runs. The failing built-assembly test could not import a `dist` module while `test/operations/bootstrap.spec.ts` rebuilds the same directory in `beforeAll`. It passes individually, and the entire suite passes serially. This existing shared-build race is not changed by this repair.
- `git diff --check`: passed.
- Read-only check with rebuilt `MongoMessages`: the actual legacy message now decodes successfully with empty transcripts. Raw BSON still contains null and stored completion remains `streaming`, confirming no recovery write was performed.

## Remaining actions and boundaries

- Explicitly authorize safe record-driven reconciliation of the existing chat if desired. Do not delete its active-attempt marker or re-run inference as a substitute.
- Address the shared `dist` rebuild/import test race separately.
- Native isolated-database verification remains prerequisite-dependent. Standalone MongoDB was observed locally; no replica-set or Azure certification is claimed.
- No frontend changes, dependencies, provisioning, deployment, credential changes, sentinel deletion or application database writes were performed. The backend was not intentionally restarted for this investigation.
