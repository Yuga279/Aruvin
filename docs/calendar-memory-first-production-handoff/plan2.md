# Calendar production integration implementation plan

> For agentic workers: execute task-by-task using executing-plans, systematic-debugging and test-driven-development. User forbids staging and commits; leave all changes in the working tree.

**Goal:** Complete Calendar v2 memory admission, owned effect-boundary promotion, durable publication/import and lifecycle invalidation.

**Architecture:** Preserve one CalendarLoop and CalendarOperationWriter dispatcher. MemoryText owns volatile turns until the existing validated-tool/proposal hook persists the active prefix and cursor; the loop continues with a real CalendarTurnLedger under an ExecutionLease, then publishes through publishCalendarTurn and imports the durable seal.

**Tech Stack:** Existing TypeScript ESM/NodeNext, Nest composition, LangGraph, fixture Mongo repositories and Vitest.

## Ownership and dependencies

Own backend/src/chat-runtime/memory-text.ts, calendar-loop.ts, durable-chat-runtime.ts, backend/src/app.service.ts and minimal additional production integration files only if needed after informing parent. P1 owns foundation/volatile ledger/state/history and focused support tests; P3 may own calendar-memory-first.spec.ts exclusively. You are not alone: do not revert dirty work or edit another worker's files without coordination.

Planner prerequisite: approved user handoff and local research complete. Worker may investigate, prepare failing targeted checks and implement routing immediately. Promotion/import implementation depends on P1 contract: flushSession(sessionId), commitPromoted(turn,{input,output,manifest,delivery?}), foundation.invalidateCalendarAccount(account), optional initialBudget on MemoryCalendarLedger options. Confirm exact signatures with P1. No external services, new dependencies or reviewer.

## Tasks

- [ ] Coordinate with test owner to remove all eligibility overrides and run the focused suite to reproduce real admission failure (parent already observed 1 failing, 6 passing baseline). For any further defect, first establish a deterministic failing test.
- [ ] Implement production eligibility and routing:

```ts
eligible(): boolean {
  return !this.d.currentConfig?.current()?.calendar?.enabled ||
    Boolean(this.d.calendar && isCalendarV2(this.d.calendar));
}
```

Remove calendarReplyTo and Calendar-enabled exclusions from submitTurn/submitLiveTurn/findLiveSubmission memory paths where eligible. Ordinary new/warm text/voice must never touch Mongo/account services; preserve tools, budgets and server user attribution. Feed CalendarLoop through the same voice prose/artifact path rather than plain model fallback; coordinate voice fixture assertions with test owner.
- [ ] Cold hydrate durable Calendar groups via calendarHistory, pending slot via calendarProposals.getCurrentSlot, and current connection binding via calendarConnectionsV2.get. Remove DurableHistoryRequired throws for proposals/sourceProvenance while retaining every manifest, owner, settled graph, attempt and bounded history check. Cache durable groups, verified account binding and pending proposal separately from immutable local capsules; avoid duplicated local groups.
- [ ] Change CalendarLoop assemble clock to Date.parse(ctx.now()). In decide promote when memory.pendingProposal OR attempt.calendarReplyTo, so approvals/cancellations resolve before inference. Unrelated text can still infer. Pass cursor plus refs if needed to promotion; preserve original pendingDecisionId/native call ID and graph execute cursor.
- [ ] Implement MemoryText.promoteTurn. Before account calls, ensure active handle clean/not fenced/current Calendar enabled, await foundation.flushSession and require durableVersion===contextVersion. A failed/unsettled save throws PERSISTENCE_ERROR with zero account/Google access. Resolve fresh currentAccount; check config/current binding again after asynchronous boundaries. Ensure session exists using createIfAbsent for new sessions, acquire lease, reserve attempt, appendConfirmed input, putAttemptConfirmed accepted, confirmAcceptance and compareAttemptConfirmed generating. Bind calendarReplyTo where present. Store-bound receipts must come from exact repository instance, never casts or volatile receipt fabrication.
- [ ] Materialize volatile budget/dispatch/decision/rejection/local result state through existing calendarAccountingV2/skillDecisions/skillResults repositories. Retain identity, dispatch indexes and original native call IDs. Construct durable CalendarTurnLedger using real persistence write/fence/current account callbacks; ensure a real ConfirmedBudget is read/created before external dispatch. Persist resumable bound graph state containing input, base boundary, refs, cursor next execute and pendingDecisionId, without re-running inference. Track original graph instance/state needed for seal/recovery.
- [ ] Continue existing loop dispatcher and checkpoint the final seal. Publish via publishCalendarTurn with commitBoundary and beforeTerminal/finishAttempt. Synchronize sessions.memoryPublication and sequence counter while leased before release, because later MemoryTextArchive saves require previousVersion marker agreement. Import durable input and assistant (including sourceProvenance), manifest and voice delivery using foundation.commitPromoted; cache loop groups/current account/pending proposal for immediate follow-up.
- [ ] Preserve promotion continuation across prefix write failure: retries attempt persistence only with the saved decision/cursor and no repeated model dispatch. After promotion errors, call interruptOwned and latch degraded on ambiguous writes; retain durable operation authority for reconcileSession so post-create save failures never duplicate Google creates. Do not mark an ambiguous seal saved/completed in memory.
- [ ] Seed retry MemoryCalendarLedger with prior turn counters and money, retaining original deadline. Coordinate state schema changes with P1; zero-dispatch proposal approvals must not require a model aggregate record.
- [ ] Expose DurableChatRuntime.invalidateCalendarAccount(account,reason) and forward to MemoryText/foundation. In AppService.redactInvalidatedRevision invoke rawRuntime hook promptly alongside durable sweeps. Clear matching cached proposals/bindings, tombstone historical sources/groups and active cached evidence, and gate a racing promotion after each await. Existing account disconnect/revoke/refresh/config lifecycle call sites must reach this hook; include proposal expiry/consumption refresh and dynamic source expiry.
- [ ] Run focused integration/related tests. Report exact files, checkpoints/receipt handling, call identity preservation, red/green evidence and any remaining gate. No staging/commits.

## Verification

From backend PowerShell with `$env:AURVIN_TEST_MONGODB_URI=''`:

```powershell
npm.cmd test -- --maxWorkers=1 test/performance/calendar-memory-first.spec.ts
npm.cmd test -- --maxWorkers=1 test/performance/memory-first-text.spec.ts test/performance/memory-first-voice.spec.ts
```

Expected: all nine user scenarios are covered using real production eligibility with deterministic fixtures, not overridden admission or fabricated receipts. Parent runs build then lint sequentially, built assembly only after build, then full routine suite. Review stays skipped. Proposed future operator commit title only: feat(calendar): promote memory turns at owned external boundary.
