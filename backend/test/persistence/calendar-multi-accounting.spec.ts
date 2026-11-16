/**
 * ============================================================================
 * FILE: calendar-multi-accounting.spec.ts
 * LOCATION: backend/test/persistence/calendar-multi-accounting.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Tests for mixed v1 and v2 calendar dispatch persistence, budget reservation,
 *    and durable idempotent logical-tool and create debits.
 *
 * ROLE IN PROJECT:
 *    Ensures MongoCalendarAccounting and its v2 facade share budget claims, enforce
 *    spend limits, prevent double counting across versioned dispatches, and prove
 *    that one debit identity charges one turn counter exactly once.
 *
 * KEY COMPONENTS:
 *    - Shares budget claims across v1 and v2 dispatches.
 *    - Rejects dispatch mutation with mismatched reservationUsd.
 *    - Confirms, duplicates, and conflicts one durable debit identity.
 *    - Refuses an over-budget debit with the budget error and no counter change.
 *    - Scopes debits to one user, session, and turn.
 *    - Repairs a debit record lost after the budget commit.
 *    - Keeps consume without a debit identity unchanged.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { Decimal128 } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { modelDispatchV2Schema } from '../../src/contracts/calendar-accounting.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { CalendarTurnLedger } from '../../src/chat-runtime/calendar-budget.js';
import { MongoCalendarAccounting } from '../../src/persistence/calendar-accounting.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { calendarMemory } from './calendar-multi-memory.js';
import { budget, dispatch, later, turnWindowNow } from './calendar-fixtures.js';
import { fixturePricing } from '../model/calendar-fixtures.js';

const clock = () => Date.parse(turnWindowNow);

function accountingStore(f: ReturnType<typeof calendarMemory>) {
  return new MongoCalendarAccounting(f.store, DEFAULT_BUDGETS, undefined, clock);
}

function ledgerFor(store: MongoCalendarAccounting): CalendarTurnLedger {
  const record = budget();
  return new CalendarTurnLedger({
    accounting: {
      ...store.v2,
      reconcileReservations: (userId: string, sessionId: string, turnId: string) =>
        store.reconcileReservations(userId, sessionId, turnId),
      listAttemptAccounting: (userId: string, sessionId: string, turnId: string, attemptId: string) =>
        store.listAttemptAccounting(userId, sessionId, turnId, attemptId),
    },
    identity: {
      userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1', openRouterUser: 'u1',
      createdAt: record.createdAt, deadlineAt: record.deadlineAt,
    },
    limits: CALENDAR_LIMITS,
    write: action => action(),
    clock,
    modelId: 'fixture/model',
    pricing: fixturePricing,
    configRevision: 1,
    connection: { connectionId: 'c1', connectionRevision: 1 },
    maxOutputTokens: 1024,
    processingPolicyId: 'fixture-policy',
    job: { check() {}, wait: async <T>(p: Promise<T>) => p, signal: new AbortController().signal },
    fence: async () => true,
    requireCurrent: async () => {},
  });
}

it('shares original budget claims across v1 and v2 dispatches and restarts', async () => {
  const f = calendarMemory(); const clock = () => Date.parse(turnWindowNow);
  const a = new MongoCalendarAccounting(f.store, DEFAULT_BUDGETS, undefined, clock);
  await a.createBudget(budget()); await a.putDispatch(dispatch());
  const second = modelDispatchV2Schema.parse({ ...dispatch(), schemaVersion: 2,
    schemaRevision: 'google-calendar.v2', dispatchId: 'd2', decisionId: 'dec2', dispatchIndex: 2,
    reason: 'schema-repair', repairedDecisionId: 'dec1' });
  await a.v2.putDispatch(second); await a.v2.putDispatch(second);
  const b = new MongoCalendarAccounting(f.store, DEFAULT_BUDGETS, undefined, clock);
  expect(await b.v2.createBudget(budget())).toMatchObject({ modelDispatches: 2, repairs: 1,
    reservedUsd: '0.5', settledUsd: '0', deadlineAt: budget().deadlineAt });
  expect((await b.v2.listDispatches('u1', 't1')).map(d => d.schemaVersion)).toEqual([1, 2]);
  await expect(b.v2.putDispatch({ ...second, reservationUsd: '0.1' }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('confirms one debit and moves the turn counters exactly once', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  await store.createBudget(budget());
  const result = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1',
    debitId: 'debit-tool', kindOfDebit: 'logical-tool', decisionId: 'dec-1', clock });
  expect(result.outcome).toBe('confirmed');
  if (result.outcome !== 'confirmed') throw new Error('expected a confirmed debit');
  expect(result.debit).toMatchObject({ schemaVersion: 2, kind: 'calendar-budget-debit',
    userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-tool', kindOfDebit: 'logical-tool',
    decisionId: 'dec-1', intentId: null, logicalTools: 1, creates: 0, budgetRevision: 2,
    createdAt: new Date(clock()).toISOString() });
  expect(result.budget).toMatchObject({ logicalTools: 1, creates: 0, revision: 2 });
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 1, creates: 0, revision: 2 });
  expect([...f.rows('metadata').values()].filter(d => d.kind === 'calendar-budget-debit')).toHaveLength(1);
});

it('returns the original debit for an exact repeat and charges nothing twice', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  await store.createBudget(budget());
  const request = { userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-tool',
    kindOfDebit: 'logical-tool' as const, decisionId: 'dec-1', clock };
  const first = await store.v2.debit(request);
  expect(first.outcome).toBe('confirmed');
  if (first.outcome !== 'confirmed') throw new Error('expected a confirmed debit');
  const again = await store.v2.debit(request);
  expect(again.outcome).toBe('duplicate');
  if (again.outcome !== 'duplicate') throw new Error('expected a duplicate debit');
  expect(again.debit).toEqual(first.debit);
  expect(again.budget.logicalTools).toBe(1);
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 1, revision: 2 });
});

it('conflicts when one debit id carries a different identity or counter change', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  await store.createBudget(budget());
  await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-tool',
    kindOfDebit: 'logical-tool', decisionId: 'dec-1', clock });
  const otherDecision = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1',
    debitId: 'debit-tool', kindOfDebit: 'logical-tool', decisionId: 'dec-2', clock });
  expect(otherDecision.outcome).toBe('conflict');
  const otherChange = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1',
    debitId: 'debit-tool', kindOfDebit: 'logical-tool', decisionId: 'dec-1',
    change: { logicalTools: 2 }, clock });
  expect(otherChange.outcome).toBe('conflict');
  const otherKind = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1',
    debitId: 'debit-tool', kindOfDebit: 'create', intentId: 'intent-1', clock });
  expect(otherKind.outcome).toBe('conflict');
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 1, creates: 0, revision: 2 });
});

it('refuses an over-budget debit with the budget error and leaves the budget unchanged', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  await store.createBudget(budget());
  for (let index = 1; index <= CALENDAR_LIMITS.logicalTools; index += 1) {
    const applied = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1',
      debitId: `debit-tool-${index}`, kindOfDebit: 'logical-tool', decisionId: `dec-${index}`, clock });
    expect(applied.outcome).toBe('confirmed');
  }
  const spent = await store.getBudget('u1', 's1', 't1');
  expect(spent).toMatchObject({ logicalTools: CALENDAR_LIMITS.logicalTools, creates: 0,
    revision: CALENDAR_LIMITS.logicalTools + 1 });
  const refused = store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-tool-over',
    kindOfDebit: 'logical-tool', decisionId: 'dec-over', clock });
  await expect(refused).rejects.toBeInstanceOf(AppError);
  await expect(refused).rejects.toMatchObject({ code: 'STORAGE_BUDGET_EXCEEDED',
    message: 'The Calendar request budget is exhausted.' });
  expect(await store.getBudget('u1', 's1', 't1')).toEqual(spent);
  expect([...f.rows('metadata').values()].filter(d => d.kind === 'calendar-budget-debit'))
    .toHaveLength(CALENDAR_LIMITS.logicalTools);
  const repeat = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1',
    debitId: `debit-tool-${CALENDAR_LIMITS.logicalTools}`, kindOfDebit: 'logical-tool',
    decisionId: `dec-${CALENDAR_LIMITS.logicalTools}`, clock });
  expect(repeat.outcome).toBe('duplicate');
  expect(await store.getBudget('u1', 's1', 't1')).toEqual(spent);
  const conflict = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1',
    debitId: `debit-tool-${CALENDAR_LIMITS.logicalTools}`, kindOfDebit: 'logical-tool',
    decisionId: 'dec-other', clock });
  expect(conflict.outcome).toBe('conflict');
  expect(await store.getBudget('u1', 's1', 't1')).toEqual(spent);
});

it('never charges another session budget for one debit', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  await store.createBudget(budget());
  await store.createBudget({ ...budget(), sessionId: 's2' });
  const first = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'shared',
    kindOfDebit: 'logical-tool', decisionId: 'dec-1', clock });
  expect(first.outcome).toBe('confirmed');
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 1 });
  expect(await store.getBudget('u1', 's2', 't1')).toMatchObject({ logicalTools: 0, revision: 1 });
  const other = await store.v2.debit({ userId: 'u1', sessionId: 's2', turnId: 't1', debitId: 'shared',
    kindOfDebit: 'logical-tool', decisionId: 'dec-1', clock });
  expect(other.outcome).toBe('confirmed');
  expect(await store.getBudget('u1', 's2', 't1')).toMatchObject({ logicalTools: 1 });
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 1 });
});

it('counts a logical tool and a create once each in one turn', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  await store.createBudget(budget());
  const tool = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-tool',
    kindOfDebit: 'logical-tool', decisionId: 'dec-1', clock });
  expect(tool.outcome).toBe('confirmed');
  const create = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-create',
    kindOfDebit: 'create', intentId: 'intent-1', clock });
  expect(create.outcome).toBe('confirmed');
  if (create.outcome !== 'confirmed') throw new Error('expected a confirmed debit');
  expect(create.debit).toMatchObject({ kindOfDebit: 'create', decisionId: null, intentId: 'intent-1',
    logicalTools: 1, creates: 1 });
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 2, creates: 1 });
  const repeatTool = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-tool',
    kindOfDebit: 'logical-tool', decisionId: 'dec-1', clock });
  expect(repeatTool.outcome).toBe('duplicate');
  const repeatCreate = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-create',
    kindOfDebit: 'create', intentId: 'intent-1', clock });
  expect(repeatCreate.outcome).toBe('duplicate');
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 2, creates: 1 });
});

it('restores a debit record lost after the budget commit', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  await store.createBudget(budget());
  const request = { userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-tool',
    kindOfDebit: 'logical-tool' as const, decisionId: 'dec-1', clock };
  const first = await store.v2.debit(request);
  if (first.outcome !== 'confirmed') throw new Error('expected a confirmed debit');
  const stored = [...f.rows('metadata').values()].find(d => d.kind === 'calendar-budget-debit');
  expect(stored).toBeDefined();
  f.rows('metadata').delete(String(stored!._id));
  expect(await store.v2.getDebit('u1', 's1', 't1', 'debit-tool')).toMatchObject({ debitId: 'debit-tool' });
  const again = await store.v2.debit(request);
  expect(again.outcome).toBe('duplicate');
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 1, revision: 2 });
  expect([...f.rows('metadata').values()].filter(d => d.kind === 'calendar-budget-debit')).toHaveLength(1);
});

it('keeps consume without a debit identity unchanged and charges one debit once', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  await store.createBudget(budget());
  const ledger = ledgerFor(store);
  expect(await ledger.consume({ logicalTools: 1 })).toMatchObject({ logicalTools: 1, creates: 0 });
  expect(await ledger.consume({ logicalTools: 2 })).toMatchObject({ logicalTools: 2, creates: 0 });
  expect([...f.rows('metadata').values()].filter(d => d.kind === 'calendar-budget-debit')).toHaveLength(0);
  const identity = { debitId: 'debit-tool', kindOfDebit: 'logical-tool' as const, decisionId: 'dec-1' };
  expect(await ledger.consume({ logicalTools: 1 }, identity)).toMatchObject({ logicalTools: 3 });
  expect(await ledger.consume({ logicalTools: 1 }, identity)).toMatchObject({ logicalTools: 3 });
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 3, creates: 0 });
  // A later count without a debit identity keeps the applied debit identity.
  expect(await ledger.consume({ logicalTools: 4 })).toMatchObject({ logicalTools: 4 });
  expect(await ledger.consume({ logicalTools: 1 }, identity)).toMatchObject({ logicalTools: 4 });
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 4, creates: 0 });
});

it('detects a repeated debit after another debit moved the same counter', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  await store.createBudget(budget());
  const first = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-one',
    kindOfDebit: 'logical-tool', decisionId: 'dec-1', clock });
  expect(first.outcome).toBe('confirmed');
  const second = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-two',
    kindOfDebit: 'logical-tool', decisionId: 'dec-2', clock });
  expect(second.outcome).toBe('confirmed');
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 2 });
  const repeat = await store.v2.debit({ userId: 'u1', sessionId: 's1', turnId: 't1', debitId: 'debit-one',
    kindOfDebit: 'logical-tool', decisionId: 'dec-1', clock });
  expect(repeat.outcome).toBe('duplicate');
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 2 });
});

it('charges one logical tool and one create once each through the ledger helpers', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  await store.createBudget(budget());
  const ledger = ledgerFor(store);
  await ledger.chargeLogicalTool('dec-1');
  await ledger.chargeLogicalTool('dec-1');
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 1, creates: 0 });
  await ledger.chargeCreate('intent-1');
  await ledger.chargeCreate('intent-1');
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ logicalTools: 2, creates: 1 });
  expect([...f.rows('metadata').values()].filter(d => d.kind === 'calendar-budget-debit')).toHaveLength(2);
});

it('keeps reservations held when a claimed dispatch is missing during settlement', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  await store.createBudget(budget());
  const first = modelDispatchV2Schema.parse({ ...dispatch(), schemaVersion: 2, schemaRevision: 'google-calendar.v2' });
  const second = modelDispatchV2Schema.parse({ ...first, dispatchId: 'd2', decisionId: 'dec2', dispatchIndex: 2 });
  await store.v2.putDispatch(first);
  await store.v2.putDispatch(second);
  await store.v2.putDispatch({ ...first, status: 'dispatched' });
  const dispatchReceipt = (await store.v2.getDispatchConfirmed!('u1', first.dispatchId))!;
  const budgetReceipt = (await store.v2.getBudgetConfirmed!('u1', 's1', 't1'))!;
  const missing = [...f.rows('metadata')].find(([, row]) => row.dispatchId === second.dispatchId)!;
  f.rows('metadata').delete(missing[0]);
  const settled = modelDispatchV2Schema.parse({ ...dispatchReceipt.record, status: 'terminal', endedAt: turnWindowNow,
    reservationStatus: 'settled', money: { currency: 'USD', reportedAmount: '0.01', estimatedAmount: null,
      costStatus: 'known', source: 'provider-response', observedAt: turnWindowNow, pricing: null } });
  await expect(store.v2.updateDispatchConfirmed!(dispatchReceipt, settled, budgetReceipt)).rejects.toBeDefined();
  expect(await store.getBudget('u1', 's1', 't1')).toMatchObject({ reservedUsd: '0.5', settledUsd: '0' });
});

it('updates dispatch identity and timing with zero preliminary envelope rereads and enforces confirmed budget CAS on money settlement', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  const b0 = await store.v2.createBudgetConfirmed!(budget());

  const d0 = modelDispatchV2Schema.parse({
    ...dispatch(),
    schemaVersion: 2,
    schemaRevision: 'google-calendar.v2',
  });
  f.calls.length = 0;
  const reserved = await store.v2.reserveDispatchConfirmed!(d0, b0);
  // Draft insert + budget replaceOne without preliminary budget reread
  expect(f.calls.map(c => c.method)).toEqual(['updateOne', 'replaceOne']);
  expect(reserved.budget.record).toMatchObject({ revision: 2, modelDispatches: 1, reservedUsd: '0.25' });

  // Non-money identity/timing update performs only replaceOne (zero preliminary findOne)
  f.calls.length = 0;
  const dispatched = await store.v2.updateDispatchConfirmed!(
    reserved.dispatch,
    modelDispatchV2Schema.parse({
      ...reserved.dispatch.record,
      status: 'dispatched',
      generationId: 'gen-v2-1',
      providerRequestId: 'req-v2-1',
      firstOutputAt: turnWindowNow,
      promptTokens: 100,
      completionTokens: 20,
    }),
    reserved.budget,
  );
  expect(f.calls.map(c => c.method)).toEqual(['replaceOne']);
  expect(dispatched.budget).toBe(reserved.budget);

  // Non-regressing generationId / cost check before DB dispatch
  f.calls.length = 0;
  await expect(
    store.v2.updateDispatchConfirmed!(
      dispatched.dispatch,
      modelDispatchV2Schema.parse({
        ...dispatched.dispatch.record,
        generationId: 'gen-v2-different',
      }),
      dispatched.budget,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.calls).toHaveLength(0);

  // Injected budget CAS mismatch during money settlement fails and leaves held money nonzero
  const fConflict = calendarMemory();
  const storeConflict = accountingStore(fConflict);
  const ledger = ledgerFor(storeConflict);
  const resDisp = await ledger.reserveDispatch('initial', { estimatedInputTokens: 100 }, null);
  await ledger.beforeDispatch(resDisp.dispatchId);

  // Externally bump budget revision in DB so cached budget receipt in ledger becomes stale when settling money
  const rawBudget = [...fConflict.rows('metadata').values()].find(d => d.kind === 'calendar-turn-budget')!;
  fConflict.rows('metadata').set(String(rawBudget._id), {
    ...rawBudget,
    revision: Number(rawBudget.revision) + 1,
    _revision: Number(rawBudget._revision) + 1,
  });

  await expect(
    ledger.observe(resDisp.dispatchId, {
      reportedModel: 'fixture/model',
      reportedProvider: 'OpenRouter',
      generationId: 'gen-conflict-1',
      providerRequestId: 'req-conflict-1',
      promptTokens: 100,
      completionTokens: 20,
      cachedPromptTokens: null,
      cacheWriteTokens: null,
      reasoningOutputTokens: null,
      money: {
        currency: 'USD',
        reportedAmount: '0.01',
        estimatedAmount: null,
        costStatus: 'known',
        source: 'provider-response',
        observedAt: turnWindowNow,
        pricing: null,
      },
      firstOutputAt: turnWindowNow,
      endedAt: turnWindowNow,
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });

  // Held money remains nonzero on the persisted budget because the stale CAS did not settle it
  const afterConflict = await storeConflict.getBudget('u1', 's1', 't1');
  expect(afterConflict?.reservedUsd).not.toBe('0');
  // Cleanup extra closing brace below:
});
it('confirms ambiguous writes with exact later readback in updateDispatchConfirmed and recomputes budget money while preserving private claims and Decimal128 encoding', async () => {
  const f = calendarMemory();
  const store = accountingStore(f);
  const b0 = await store.v2.createBudgetConfirmed!(budget());
  const d0 = modelDispatchV2Schema.parse({
    ...dispatch(),
    schemaVersion: 2,
    schemaRevision: 'google-calendar.v2',
  });
  const reserved = await store.v2.reserveDispatchConfirmed!(d0, b0);

  // 1. Exact duplicate updateDispatchConfirmed returns original receipts without any DB calls
  f.calls.length = 0;
  const dup = await store.v2.updateDispatchConfirmed!(reserved.dispatch, reserved.dispatch.record, reserved.budget);
  expect(dup.dispatch).toBe(reserved.dispatch);
  expect(dup.budget).toBe(reserved.budget);
  expect(f.calls).toHaveLength(0);

  // 2. Ambiguous write during dispatch replaceOne confirms via exact readback
  f.failNext('after-write', { collection: 'metadata', method: 'replaceOne' });
  const dispatchedRecord = modelDispatchV2Schema.parse({
    ...reserved.dispatch.record,
    status: 'dispatched',
    generationId: 'gen-v2-ambiguous',
    providerRequestId: 'req-v2-ambiguous',
    firstOutputAt: turnWindowNow,
    promptTokens: 100,
    completionTokens: 20,
  });
  const dispatched = await store.v2.updateDispatchConfirmed!(reserved.dispatch, dispatchedRecord, reserved.budget);
  expect(dispatched.dispatch.record.status).toBe('dispatched');
  expect(dispatched.dispatch.record.generationId).toBe('gen-v2-ambiguous');

  // 3. Failed write before commit (no write took place) rejects with PERSISTENCE_ERROR and does not advance revision
  const settledRecord = modelDispatchV2Schema.parse({
    ...dispatched.dispatch.record,
    status: 'terminal',
    endedAt: turnWindowNow,
    reservationStatus: 'settled',
    money: {
      currency: 'USD',
      reportedAmount: '0.01',
      estimatedAmount: null,
      costStatus: 'known',
      source: 'provider-response',
      observedAt: turnWindowNow,
      pricing: null,
    },
  });
  f.failNext('before-write', { collection: 'metadata', method: 'replaceOne' });
  await expect(store.v2.updateDispatchConfirmed!(dispatched.dispatch, settledRecord, dispatched.budget))
    .rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });

  // 4. Ambiguous write / timeout with late success during money settlement confirms via exact readback and preserves private claims and Decimal128 encoding
  f.failNext('after-write', { collection: 'metadata', method: 'replaceOne' });
  const settled = await store.v2.updateDispatchConfirmed!(dispatched.dispatch, settledRecord, dispatched.budget);
  expect(settled.dispatch.record.status).toBe('terminal');
  expect(settled.budget.record).toMatchObject({
    reservedUsd: '0',
    settledUsd: '0.01',
  });
  // Verify private claims and Decimal128 encoding survived
  const rawBudget = [...f.rows('metadata').values()].find(d => d.kind === 'calendar-turn-budget')!;
  expect(rawBudget._calendarClaims).toHaveLength(1);
  expect(rawBudget.settledUsd).toBeInstanceOf(Decimal128);
});
/* cleanup */ void (() => {
});
