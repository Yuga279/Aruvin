# Calendar confirmation latency — partial improvement

## Scope

3 November 2026. The user explicitly deferred the canvas replacement. No renderer, canvas layout, background, URL navigation, or browser embedding was changed for this latency task. Work stayed in this session with no delegation, provider calls, application-data writes, or commits.

## Observed delay

A read-only query of the latest successful persisted operation showed approximately 37.9 seconds from the attempt's recorded creation to completion:

- 20,776 ms before the operation's recorded creation time.
- 11,197 ms from operation creation to durable success.
- 5,899 ms after success until attempt completion.
- Zero model dispatches and three Calendar requests.

These are coarse persisted lifecycle intervals, not a browser click measurement or a per-query profile. They show that removing LLM narration did not remove the persistence/control-flow delay.

## Changes

1. Clarification frames now optionally carry the actual saved `proposalRevision`. The Confirm submission forwards that proposal ID/revision through the already-supported backend `calendarReplyTo` contract. It no longer needs the backend's growing per-attempt disclosure reconstruction. The reference is still untrusted: the existing server-side current-proposal, revision, authorization, expiry, ownership, and idempotency checks remain in force. Typed replies and legacy frames without a revision keep the existing safe fallback; no revision is guessed. The bounded reference is stored with the existing accepted attempt rather than in a separately written binding record. Null identifies a new request without a reference; undefined preserves legacy lookup behavior. Retry inherits the persisted reference, and idempotent resubmission compares it, including after a restart.
2. A successful operation's receipt is streamed before retention/result bookkeeping, rather than after it. Both the operation and its matching success event must already be acknowledged. The existing durable-state projection still checks that evidence and privacy expiry. Transcript/checkpoint finalization and terminal completion still wait for all required work. Success of the Calendar effect does not falsely imply completion of the whole chat turn.

No additional LLM call or Calendar create was added.

## Measured improvement and limits

The existing full-runtime offline fixture emulates each read at 67 ms and each write at 449 ms. These are synthetic times, not measured live speedups. Measurements include acceptance and execution.

Before the optimizations, with zero earlier turns, the first receipt was at 22,341 ms and turn completion at 30,456 ms. In the final candidate, the first receipt is at 20,773 ms and completion at 30,188 ms. Thus visible success is 1,568 ms earlier and completion is 268 ms earlier in this short-chat profile. Reads change from 158 to 154, and the 45 writes are unchanged.

After eight earlier turns, first receipt improves from 22,877 ms to 20,773 ms (2,104 ms earlier); completion improves from 30,992 ms to 30,188 ms (804 ms earlier). Explicit references remove the growing lookup cost: reads change from 166 to 154, while the 45 writes remain unchanged. The earlier-receipt change alone moves the first receipt forward by 1,300 modelled ms without changing total commands or completion time. An intermediate implementation added a binding write and regressed short-chat completion by 315 ms; it was replaced by the accepted-attempt field before final verification.

This is **not a complete fix for the long confirmation wait**. The dominant pre-write storage/checkpoint/authorization path remains. No claim is made that the observed 38-second live interaction is now fast. Further work must reduce or overlap proven redundant storage work without removing the pre-effect durable cursor, authorization checks, operation evidence, single-executor fencing, or finalization durability. The existing broader latency backlog remains open.

## Verification

- New frontend tests first failed on rejected/missing proposal references, then passed.
- A new backend test first failed with retention bookkeeping deliberately held; it now observes a durable success receipt while terminal completion remains withheld.
- Proposal-revision parsing tests cover modern and legacy frames and reject invalid revisions/unknown fields. Existing stale-reference and authorization tests remain passing.
- A new acceptance test proves there is no separate reference-binding write and checks persisted-reference idempotency after restart, changed-revision rejection, and omitted-reference rejection.
- Backend confirmation/publication/recovery/authority/concurrency selection: 46 passed before the final replay assertion; the full final run below includes that assertion.
- Frontend full suite: **599 passed** across 75 files.
- Backend broad suite excluding the previously reproduced performance/authority failures and built-import race: **2,457 passed, 10 skipped** across 277 passing and two skipped files. Exclusions are not passing evidence.
- Both builds and both lint commands passed (existing warnings remain).
- Offline benchmark: `npm test -- test/performance/calendar-critical-path.spec.ts -t "measures Confirm" --disableConsoleIntercept --reporter=verbose`.
- No new live Calendar event, model request, backend restart, or interactive browser timing was performed. Unified review remains skipped, not passed.
