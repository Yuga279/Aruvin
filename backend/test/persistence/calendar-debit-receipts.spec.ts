/**
 * ============================================================================
 * FILE: calendar-debit-receipts.spec.ts
 * LOCATION: backend/test/persistence/calendar-debit-receipts.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Prove revision-scoped Calendar debit receipt reuse and strict recovery.
 * ROLE IN PROJECT:
 *    Uses real accounting repositories on the fault-injectable offline BSON fake.
 * KEY COMPONENTS:
 *    - CAS evidence: Claims, stale/foreign receipts and concurrent debit identity.
 *    - Recovery: Duplicate repair and uncertain budget/debit acknowledgments.
 *    - Aggregate barrier: Old receipts cannot prove the current dispatch-ID set.
 * ============================================================================
 */
import { Decimal128 } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { modelAggregateSchema, modelDispatchV2Schema } from '../../src/contracts/calendar-accounting.js';
import type { ConfirmedBudget } from '../../src/contracts/calendar-accounting.js';
import { unavailableMoney } from '../../src/contracts/usage-evidence.js';
import { MongoCalendarAccounting } from '../../src/persistence/calendar-accounting.js';
import { calendarMemory } from './calendar-multi-memory.js';
import { budget, dispatch, turnWindowNow } from './calendar-fixtures.js';

const clock = () => Date.parse(turnWindowNow);
const request = { userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'tool-one',
  kindOfDebit: 'logical-tool' as const, decisionId: 'dec1', clock };

async function setup() {
  const f = calendarMemory();
  const store = new MongoCalendarAccounting(f.store, DEFAULT_BUDGETS, undefined, clock);
  const receipt = await store.v2.createBudgetConfirmed!(budget());
  return { f, store, receipt };
}

it('uses an acknowledged budget envelope for debit CAS and returns its next receipt with private claims intact', async () => {
  const { f, store, receipt } = await setup();
  const reserved = await store.v2.reserveDispatchConfirmed!(modelDispatchV2Schema.parse({
    ...dispatch(), schemaVersion: 2, schemaRevision: 'google-calendar.v2',
  }), receipt);
  const rawBefore = [...f.rows('metadata').values()].find(row => row.kind === 'calendar-turn-budget')!;
  f.calls.length = 0;
  const result = await store.v2.debit({ ...request, expectedBudget: reserved.budget });
  expect(f.calls.map(call => call.method)).toEqual(['replaceOne', 'updateOne']);
  if (result.outcome === 'conflict') throw new Error('Expected debit confirmation');
  expect(result.budgetReceipt).toBeDefined();
  expect(result.budgetReceipt!.record).toEqual(result.budget);
  const rawAfter = [...f.rows('metadata').values()].find(row => row.kind === 'calendar-turn-budget')!;
  expect(rawAfter._calendarClaims).toEqual(rawBefore._calendarClaims);
  expect(rawAfter.reservedUsd).toBeInstanceOf(Decimal128);
  expect(rawAfter.reservedUsd.toString()).toBe('0.25');
  f.calls.length = 0;
  const bumped = await store.v2.compareBudgetConfirmed!(result.budgetReceipt!, {
    ...result.budget, revision: result.budget.revision + 1, calendarRequests: 1,
  });
  expect(bumped.outcome).toBe('confirmed');
  expect(f.calls.map(call => call.method)).toEqual(['replaceOne']);
});

it('uses a strict budget read when no receipt was supplied', async () => {
  const { f, store } = await setup();
  f.calls.length = 0;
  const result = await store.v2.debit(request);
  expect(result.outcome).toBe('confirmed');
  expect(f.calls.map(call => call.method)).toEqual(['findOne', 'replaceOne', 'updateOne']);
});

it.each(['forged', 'foreign-store', 'wrong-scope'] as const)('rejects %s budget evidence before mutation', async kind => {
  const { f, store, receipt } = await setup();
  const other = await setup();
  const expectedBudget = kind === 'forged' ? { record: receipt.record } as ConfirmedBudget
    : kind === 'foreign-store' ? other.receipt : receipt;
  f.calls.length = 0;
  await expect(store.v2.debit({ ...request, sessionId: kind === 'wrong-scope' ? 'other' : 's1', expectedBudget }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.calls).toHaveLength(0);
});

it('falls back after stale CAS without losing a concurrent counter or charging twice', async () => {
  const { f, store, receipt } = await setup();
  await store.v2.compareBudgetConfirmed!(receipt, { ...receipt.record, revision: 2, calendarRequests: 1 });
  f.calls.length = 0;
  const result = await store.v2.debit({ ...request, expectedBudget: receipt });
  expect(result.outcome).toBe('confirmed');
  expect(f.calls.some(call => call.method === 'findOne')).toBe(true);
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 1, calendarRequests: 1, revision: 3 });
});

it('rereads duplicate budget evidence and repairs a missing debit row using the current counters', async () => {
  const { f, store } = await setup();
  await store.v2.debit(request);
  const old = (await store.v2.getBudgetConfirmed!('u1', 's1', 't1'))!;
  await store.v2.compareBudgetConfirmed!(old, { ...old.record, revision: old.record.revision + 1, calendarRequests: 1 });
  const row = [...f.rows('metadata').values()].find(item => item.kind === 'calendar-budget-debit')!;
  f.rows('metadata').delete(String(row._id));
  f.calls.length = 0;
  const result = await store.v2.debit({ ...request, expectedBudget: old });
  expect(result.outcome).toBe('duplicate');
  if (result.outcome === 'conflict') throw new Error('Expected duplicate');
  expect(result.budget).toMatchObject({ logicalTools: 1, calendarRequests: 1, revision: 3 });
  expect(f.calls.map(call => call.method)).toEqual(['findOne', 'updateOne']);
  expect([...f.rows('metadata').values()].filter(item => item.kind === 'calendar-budget-debit')).toHaveLength(1);
});

it('does not acknowledge a concurrently landed same debit ID with different payload after stale CAS', async () => {
  const { store, receipt } = await setup();
  await store.v2.debit({ ...request, decisionId: 'other-decision' });
  expect(await store.v2.debit({ ...request, expectedBudget: receipt })).toEqual({ outcome: 'conflict' });
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 1 });
});

it.each(['replaceOne', 'updateOne'])('confirms ambiguous %s only from exact readback before issuing the next receipt', async method => {
  const { f, store, receipt } = await setup();
  f.failNext('after-write', { collection: 'metadata', method });
  const result = await store.v2.debit({ ...request, expectedBudget: receipt });
  expect(result.outcome).toBe('confirmed');
  if (result.outcome === 'conflict') throw new Error('Expected confirmation');
  expect(result.budgetReceipt).toBeDefined();
  expect(result.budgetReceipt!.record).toEqual(await store.getBudget('u1', 's1', 't1'));
  expect(result.budget.logicalTools).toBe(1);
});

it('removes two reads, not either durable write, from debit followed by the next request counter', async () => {
  const strict = await setup();
  const acknowledged = await setup();
  strict.f.wireCalls.length = acknowledged.f.wireCalls.length = 0;
  // The previous caller protocol omitted the CAS expectation and discarded the
  // returned budget envelope; both operations still use the same repository.
  const old = await strict.store.v2.debit(request);
  const reloaded = (await strict.store.v2.getBudgetConfirmed!('u1', 's1', 't1'))!;
  await strict.store.v2.compareBudgetConfirmed!(reloaded, {
    ...reloaded.record, revision: reloaded.record.revision + 1, calendarRequests: 1,
  });
  const next = await acknowledged.store.v2.debit({ ...request, expectedBudget: acknowledged.receipt });
  if (next.outcome === 'conflict' || old.outcome === 'conflict') throw new Error('Expected confirmations');
  expect(next.budgetReceipt).toBeDefined();
  await acknowledged.store.v2.compareBudgetConfirmed!(next.budgetReceipt!, {
    ...next.budget, revision: next.budget.revision + 1, calendarRequests: 1,
  });
  const commands = (f: typeof strict.f) => ({
    reads: f.wireCalls.filter(call => call.kind === 'read').length,
    writes: f.wireCalls.filter(call => call.kind === 'write').length,
    failures: f.wireCalls.filter(call => call.failed).length,
  });
  expect(commands(strict.f)).toEqual({ reads: 2, writes: 3, failures: 0 });
  expect(commands(acknowledged.f)).toEqual({ reads: 0, writes: 3, failures: 0 });
  expect(await strict.store.getBudget('u1', 's1', 't1')).toEqual(
    await acknowledged.store.getBudget('u1', 's1', 't1'));
});

it.each(['uncertain-budget', 'missing-debit'] as const)('repairs %s on restart without receipt trust or a second charge', async failure => {
  const { f, store, receipt } = await setup();
  const read = failure === 'uncertain-budget' ? vi.spyOn(f.store, 'raw').mockRejectedValue(new Error('Read unavailable')) : null;
  f.failNext(failure === 'uncertain-budget' ? 'after-write' : 'before-write', {
    collection: 'metadata', method: failure === 'uncertain-budget' ? 'replaceOne' : 'updateOne',
  });
  try {
    await expect(store.v2.debit({ ...request, expectedBudget: receipt })).rejects.toBeDefined();
  } finally { read?.mockRestore(); }
  const reopened = new MongoCalendarAccounting(f.store, DEFAULT_BUDGETS, undefined, clock);
  const result = await reopened.v2.debit(request);
  expect(result.outcome).toBe('duplicate');
  expect(await reopened.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 1, revision: 2 });
  expect([...f.rows('metadata').values()].filter(row => row.kind === 'calendar-budget-debit')).toHaveLength(1);
});

it('retains strict aggregate discovery because an old acknowledged dispatch set omits a later reservation', async () => {
  const { f, store, receipt } = await setup();
  const first = modelDispatchV2Schema.parse({ ...dispatch(), schemaVersion: 2, schemaRevision: 'google-calendar.v2' });
  const saved = await store.v2.reserveDispatchConfirmed!(first, receipt);
  await store.v2.reserveDispatchConfirmed!({ ...first, dispatchId: 'd2', decisionId: 'dec2', dispatchIndex: 2 }, saved.budget);
  const staleAggregate = modelAggregateSchema.parse({ schemaVersion: 1, kind: 'calendar-model-aggregate',
    userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1', dispatchIds: [saved.dispatch.record.dispatchId],
    reportedUsd: null, heldReservationUsd: '0.25', costStatus: 'unknown', promptTokens: null, completionTokens: null,
    calendarRequests: 0, refreshRequests: 0, connectorMoney: unavailableMoney(), updatedAt: turnWindowNow });
  f.calls.length = 0;
  await expect(store.v2.putAggregate(staleAggregate)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.calls.map(call => call.method)).toEqual(['find']);
  expect([...f.rows('metadata').values()].some(row => row.kind === 'calendar-model-aggregate')).toBe(false);
});
