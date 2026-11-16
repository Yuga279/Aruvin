# Shared memory promotion support implementation plan

> For agentic workers: execute task-by-task using executing-plans and test-driven-development. User forbids staging and commits; leave changes in the working tree.

**Goal:** Supply ordered session flush, direct durable-result import, dynamic redaction, retry budget seeding and durable-history capsule fallback.

**Architecture:** Extend the existing bounded foundation and existing volatile ledger. Reuse Calendar message redaction and native capsule validation; keep all external effects in the current Calendar dispatcher.

**Tech Stack:** TypeScript ESM/NodeNext, existing Vitest fixtures, Mongo-compatible fixture repositories.

## Ownership and contract

Own backend/src/chat-runtime/memory-first-foundation.ts, memory-calendar-ledger.ts, memory-calendar-state.ts, calendar-history.ts and their focused tests (memory-first-foundation.spec.ts, memory-calendar-state.spec.ts, memory-text-archive.spec.ts if required). Do not edit memory-text.ts, calendar-loop.ts, durable-chat-runtime.ts, app.service.ts or calendar-memory-first.spec.ts. You are not alone; accommodate other changes and preserve dirty work.

Agreed interfaces to report promptly to integration worker:

```ts
flushSession(sessionId: string): Promise<void>
commitPromoted(turn: MemoryTurn, value: {
  input: MessageRecord; output: MessageRecord; manifest: AgentMemoryManifest;
  delivery?: VoiceDeliveryRecord;
}): TerminalEnvelope
invalidateCalendarAccount(account: CalendarAccountBinding): void
```

commitPromoted validates owned active handle, clean prior durableVersion equal turn.contextVersion, target version exactly +1, exact input/output identities and envelope/storage bounds. It imports output sourceProvenance and live delivery, advances version and durableVersion together, updates base/records consistently, releases exactly one reserved envelope, and queues no save. Preserve request replay and next sequence. It may accept an optional completed calendar accounting parameter if necessary; communicate any signature adjustment before integration depends on it.

## Tasks

- [ ] Add a failing ordered flush test using existing setup/deferred helpers: complete two turns, keep first sink pending, start flush, assert sink count remains one, resolve first saved receipt, assert second dispatch occurs once and flush resolves only after its receipt. Add timeout/failure/fence variants asserting retained dirty/pinned state and no concurrent duplicate saves.

```ts
const pending = deferred<SaveOutcome>();
const f = setup({}, vi.fn(() => pending.promise));
const turn = f.accept();
const envelope = f.memory.complete(turn, { content: 'Hi', status: 'completed' });
const flushed = f.memory.flushSession('s1');
expect(f.sink).toHaveBeenCalledTimes(1);
pending.resolve(saved(envelope));
await flushed;
expect(f.memory.session('s1').durableVersion).toBe(1);
```

- [ ] Run focused test before implementation. Implement minimal raw session-write tracking so flush awaits actual ownership release/settlement, respects write timeout and finite attempt/backoff rules, serializes only session jobs and throws PERSISTENCE_ERROR on failed/unknown/timed out/fenced saves. Do not await unrelated sessions or voice accounting.
- [ ] Add a failing direct-import test: accept one turn, create valid input/output/manifest using existing context fixtures, call commitPromoted, assert version=durableVersion=1, active=null, zero sink calls, and next context includes input/output once. Include forged/stale manifest and sourceProvenance expiry assertions. Implement the method and reuse existing terminal validation without introducing a duplicate archive queue.
- [ ] Add failing records/history expiry and account invalidation tests with retained Calendar provenance. Use redactCalendarMessage on reads; invalidate matching account provenance in retained base/results/archive using redactCalendarMessageForAccount. Frozen evidence and already-dispatched immutable save payloads must not be mutated in place.
- [ ] Add failing ledger retry seed checks: seed nonzero modelDispatches/repairs/reservedUsd/settledUsd, reserve a new dispatch, assert continued index, finite exhausted budget, and seed money survives observations. Accept optional initialBudget: CalendarTurnBudget in MemoryCalendarLedger constructor options. Validate identity, retain original turn deadline; update memory-calendar-state schema to validate a contiguous per-attempt dispatch suffix ending at budget.modelDispatches rather than equating lifetime totals to this attempt's dispatch count. Preserve aggregate per-attempt versus budget whole-turn meanings.
- [ ] Add failing capsule history test using existing archive fixture: a saved local activate_skill turn has no durable dispatch rows but calendarHistory reconstructs its exact original call/result pair. Load session/attempts as needed and reuse readMemoryCalendarStates publication validation; do not admit unpublished metadata or duplicate durable groups.
- [ ] Run focused checks and report interfaces/files/results to parent. No staging or commits.

## Commands and exit gate

From backend, use PowerShell with `$env:AURVIN_TEST_MONGODB_URI=''`:

```powershell
npm.cmd test -- --maxWorkers=1 test/performance/memory-first-foundation.spec.ts test/performance/memory-text-archive.spec.ts test/performance/memory-calendar-state.spec.ts
```

Expected: all discovered focused tests pass with explicit red/green evidence. Integration worker can investigate/test while this work proceeds; production integration depends on these method signatures and passing support tests. Proposed commit message for future operator use only: feat(calendar): support ordered memory promotion and retry budgets.
