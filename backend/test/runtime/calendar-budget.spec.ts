import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { unavailableMoney } from '../../src/contracts/usage-evidence.js';
import { CalendarTurnLedger } from '../../src/chat-runtime/calendar-budget.js';
import { asCalendarAccountingPort } from '../../src/chat-runtime/calendar-ports.js';
import { fixturePricing } from '../model/calendar-fixtures.js';
import { calendarFixture, textWire, type CalendarRuntimeFixture } from './calendar-runtime.fixture.js';
import type { SubmitTurnResponse } from '../../src/contracts/api.js';
import type { CalendarLimits } from '../../src/contracts/calendar-policy.js';

const estimate = { estimatedInputTokens: 100 };

async function openLedger(
  h: CalendarRuntimeFixture,
  ids: SubmitTurnResponse,
  overrides: Partial<{ limits: CalendarLimits; deadlineAt: string; clock: () => number }> = {},
) {
  const attempt = await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId);
  if (!attempt) throw new Error('missing attempt');
  const createdAt = attempt.createdAt;
  const deadlineAt = overrides.deadlineAt
    ?? new Date(Date.parse(createdAt) + DEFAULT_BUDGETS.totalRunTimeoutMs).toISOString();
  const binding = await h.runtime.d.calendar!.connection.currentBinding();
  return new CalendarTurnLedger({
    accounting: asCalendarAccountingPort(h.p),
    identity: {
      userId: h.identity.userId, sessionId: ids.sessionId, turnId: ids.turnId,
      attemptId: ids.attemptId, openRouterUser: h.identity.userId, createdAt, deadlineAt,
    },
    limits: overrides.limits ?? CALENDAR_LIMITS,
    write: action => action(),
    clock: overrides.clock ?? Date.now,
    modelId: 'fixture/model',
    pricing: fixturePricing,
    configRevision: 1,
    connection: binding,
    maxOutputTokens: DEFAULT_BUDGETS.maxOutputTokens,
    processingPolicyId: 'fixture-policy',
    job: { check() {}, wait: async <T>(p: Promise<T>) => p, signal: new AbortController().signal },
    fence: async () => true,
    requireCurrent: async () => {},
  });
}

describe('CalendarTurnLedger', () => {
  it('writes v2 dispatch evidence and retains the accepted turn deadline', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Hello Aurvin');
      h.modelWires.push(textWire('Hello.'));
      await h.execute(ids);
      const first = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      const rows = await h.p.calendarAccountingV2.listDispatches(h.identity.userId, ids.turnId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ schemaVersion: 2, schemaRevision: 'google-calendar.v2',
        openRouterUser: h.identity.userId });
      expect(rows[0].startedAt >= first!.createdAt).toBe(true);
      expect(h.modelBodies[0].user).toBe(h.identity.userId);
      await h.restart();
      expect((await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))?.deadlineAt)
        .toBe(first!.deadlineAt);
    } finally { await h.dispose(); }
  });
  it('creates an all-zero budget and keeps it across restart', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids);
      const created = await ledger.ensureBudget();
      expect(created).toMatchObject({
        revision: 1, modelDispatches: 0, repairs: 0, logicalTools: 0, creates: 0,
        calendarRequests: 0, refreshRequests: 0, settledUsd: '0', reservedUsd: '0',
      });
      const again = await ledger.ensureBudget();
      expect(again.createdAt).toBe(created.createdAt);
      expect(again.deadlineAt).toBe(created.deadlineAt);
      await h.restart();
      const after = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(after).toEqual(created);
    } finally { await h.dispose(); }
  });

  it('consumes logical tools at the exact cap and rejects one over', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids);
      await ledger.ensureBudget();
      await ledger.consume({ logicalTools: 6 });
      const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(budget?.logicalTools).toBe(6);
      await expect(ledger.consume({ logicalTools: 7 })).rejects.toBeDefined();
    } finally { await h.dispose(); }
  });

  it.each([
    ['creates', { logicalTools: 1, creates: 1 }, { logicalTools: 1, creates: 2 }],
    ['calendarRequests', { calendarRequests: 20 }, { calendarRequests: 21 }],
    ['refreshRequests', { refreshRequests: 2 }, { refreshRequests: 3 }],
  ] as const)('consumes %s at the exact cap and rejects one over', async (_field, cap, over) => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids);
      await ledger.ensureBudget();
      await ledger.consume(cap);
      await expect(ledger.consume(over)).rejects.toBeDefined();
    } finally { await h.dispose(); }
  });

  it('claims one dispatch and ignores a duplicate put of the same reservation', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids);
      await ledger.ensureBudget();
      const first = await ledger.reserveDispatch('initial', estimate, null);
      const duplicate = await ledger.reserveDispatch('initial', estimate, null);
      expect(duplicate.dispatchId).toBe(first.dispatchId);
      const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(budget?.modelDispatches).toBe(1);
      expect(budget?.reservedUsd).not.toBe('0');
    } finally { await h.dispose(); }
  });

  it('a correction consumes one additional dispatch and one repair', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids);
      await ledger.ensureBudget();
      const initial = await ledger.reserveDispatch('initial', estimate, null);
      const repair = { rejectedDecisionId: initial.decisionId, diagnostics: [
        { path: 'eventId', code: 'malformed-json', expected: 'complete-json' },
      ] } as const;
      await ledger.reserveDispatch('schema-repair', estimate, repair);
      const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(budget).toMatchObject({ modelDispatches: 2, repairs: 1 });
    } finally { await h.dispose(); }
  });

  it('a provider retry consumes a dispatch but not another repair', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids);
      await ledger.ensureBudget();
      const initial = await ledger.reserveDispatch('initial', estimate, null);
      const repair = { rejectedDecisionId: initial.decisionId, diagnostics: [
        { path: 'eventId', code: 'malformed-json', expected: 'complete-json' },
      ] } as const;
      const corrected = await ledger.reserveDispatch('schema-repair', estimate, repair);
      const retried = await ledger.reserveDispatch('provider-retry', estimate, repair);
      expect(retried.repairedDecisionId).toBe(initial.decisionId);
      expect(retried.reason).toBe('provider-retry');
      expect(retried.dispatchId).not.toBe(corrected.dispatchId);
      const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(budget).toMatchObject({ modelDispatches: 3, repairs: 1 });
    } finally { await h.dispose(); }
  });

  it('retains unknown dispatched spend and original deadline across restart', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids);
      await ledger.ensureBudget();
      const dispatch = await ledger.reserveDispatch('initial', estimate, null);
      await ledger.beforeDispatch(dispatch.dispatchId);
      const before = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      await h.restart();
      const after = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(after).toEqual(before);
      expect(after?.modelDispatches).toBe(1);
      expect(after?.reservedUsd).not.toBe('0');
      expect((await h.p.calendarAccountingV2.listDispatches(h.identity.userId, ids.turnId))[0])
        .toMatchObject({ reservationStatus: 'held', status: 'dispatched' });
    } finally { await h.dispose(); }
  });

  it('does not mark dispatched when the dispatched save fails', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const original = h.p.calendarAccountingV2.updateDispatchConfirmed!.bind(h.p.calendarAccountingV2);
      h.p.calendarAccountingV2.updateDispatchConfirmed = async (receipt, record, budget) => {
        if (record.status === 'dispatched') {
          throw new Error('save failed');
        }
        return original(receipt, record, budget);
      };
      const ledger = await openLedger(h, ids);
      await ledger.ensureBudget();
      const dispatch = await ledger.reserveDispatch('initial', estimate, null);
      await expect(ledger.beforeDispatch(dispatch.dispatchId)).rejects.toBeDefined();
      expect(await h.p.calendarAccountingV2.getDispatch(h.identity.userId, dispatch.dispatchId))
        .toMatchObject({ status: 'reserved' });
    } finally { await h.dispose(); }
  });

  it('keeps a hold for unknown money and settles known money once', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids);
      await ledger.ensureBudget();
      const dispatch = await ledger.reserveDispatch('initial', estimate, null);
      await ledger.beforeDispatch(dispatch.dispatchId);
      await ledger.observe(dispatch.dispatchId, {
        reportedModel: 'fixture/model', reportedProvider: 'Fixture', generationId: 'gen_1',
        providerRequestId: 'req_1', promptTokens: 10, completionTokens: 4,
        cachedPromptTokens: null, cacheWriteTokens: null, reasoningOutputTokens: null,
        money: unavailableMoney(true), firstOutputAt: '2026-10-21T09:00:00.000Z',
        endedAt: '2026-10-21T09:00:01.000Z',
      });
      expect(await h.p.calendarAccountingV2.getDispatch(h.identity.userId, dispatch.dispatchId))
        .toMatchObject({ reservationStatus: 'held' });
      const observedAt = '2026-10-21T09:00:01.000Z';
      await ledger.observe(dispatch.dispatchId, {
        reportedModel: 'fixture/model', reportedProvider: 'Fixture', generationId: 'gen_1',
        providerRequestId: 'req_1', promptTokens: 10, completionTokens: 4,
        cachedPromptTokens: null, cacheWriteTokens: null, reasoningOutputTokens: null,
        money: {
          currency: 'USD', reportedAmount: '0.01', estimatedAmount: null, costStatus: 'known',
          source: 'provider-response', observedAt, pricing: null,
        },
        firstOutputAt: '2026-10-21T09:00:00.000Z', endedAt: '2026-10-21T09:00:01.000Z',
      });
      expect(await h.p.calendarAccountingV2.getDispatch(h.identity.userId, dispatch.dispatchId))
        .toMatchObject({ reservationStatus: 'settled' });
      await ledger.observe(dispatch.dispatchId, {
        reportedModel: 'fixture/model', reportedProvider: 'Fixture', generationId: 'gen_1',
        providerRequestId: 'req_1', promptTokens: 10, completionTokens: 4,
        cachedPromptTokens: null, cacheWriteTokens: null, reasoningOutputTokens: null,
        money: unavailableMoney(), firstOutputAt: '2026-10-21T09:00:00.000Z',
        endedAt: '2026-10-21T09:00:01.000Z',
      });
      expect(await h.p.calendarAccountingV2.getDispatch(h.identity.userId, dispatch.dispatchId))
        .toMatchObject({ reservationStatus: 'settled', money: { costStatus: 'known', reportedAmount: '0.01' } });
    } finally { await h.dispose(); }
  });

  it('publishes a terminal aggregate once and prefers it over legacy', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids);
      await ledger.ensureBudget();
      const dispatch = await ledger.reserveDispatch('initial', estimate, null);
      await ledger.beforeDispatch(dispatch.dispatchId);
      const observedAt = '2026-10-21T09:00:01.000Z';
      await ledger.observe(dispatch.dispatchId, {
        reportedModel: 'fixture/model', reportedProvider: 'Fixture', generationId: 'gen_1',
        providerRequestId: 'req_1', promptTokens: 10, completionTokens: 4,
        cachedPromptTokens: 0, cacheWriteTokens: 0, reasoningOutputTokens: 0,
        money: {
          currency: 'USD', reportedAmount: '0.01', estimatedAmount: null, costStatus: 'known',
          source: 'provider-response', observedAt, pricing: null,
        },
        firstOutputAt: observedAt, endedAt: observedAt,
      });
      await ledger.finishDispatch(dispatch.dispatchId, null);
      const first = await ledger.aggregate();
      const second = await ledger.aggregate();
      expect(second).toEqual(first);
      expect(first.costStatus).toBe('known');
      expect(first.heldReservationUsd).toBe('0');
      expect(first.reportedUsd).toBe('0.01');
      const report = await h.p.calendarAccounting.listAttemptAccounting(
        h.identity.userId, ids.sessionId, ids.turnId, ids.attemptId);
      expect(report.preferred).toEqual(first);
    } finally { await h.dispose(); }
  });

  it.each([
    ['dispatches', 8, 9],
  ] as const)('rejects the %s cap plus one', async (_name, cap, over) => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids);
      await ledger.ensureBudget();
      for (let i = 0; i < cap; i += 1) {
        const dispatch = await ledger.reserveDispatch(i === 0 ? 'initial' : 'continuation', estimate, null);
        await ledger.beforeDispatch(dispatch.dispatchId);
      }
      await expect(ledger.reserveDispatch('continuation', estimate, null)).rejects.toBeDefined();
      expect((await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId))?.modelDispatches)
        .toBe(cap);
      expect(over).toBe(9);
    } finally { await h.dispose(); }
  });

  it('rejects spend one increment over the configured cap using decimal strings', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids, { limits: { ...CALENDAR_LIMITS, modelSpendUsd: '0.0001' } });
      await ledger.ensureBudget();
      await expect(ledger.reserveDispatch('initial', estimate, null)).rejects.toMatchObject({
        code: 'STORAGE_BUDGET_EXCEEDED',
      });
    } finally { await h.dispose(); }
  });

  it('fails closed when the original deadline is past', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids, { deadlineAt: '2020-01-01T00:00:00.000Z' });
      await expect(ledger.ensureBudget()).rejects.toBeDefined();
    } finally { await h.dispose(); }
  });

  it('lets a lower configured dispatch limit win over the hard cap', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids, { limits: { ...CALENDAR_LIMITS, modelDispatches: 2 } });
      await ledger.ensureBudget();
      for (let i = 0; i < 2; i += 1) {
        const dispatch = await ledger.reserveDispatch(i === 0 ? 'initial' : 'continuation', estimate, null);
        await ledger.beforeDispatch(dispatch.dispatchId);
      }
      await expect(ledger.reserveDispatch('continuation', estimate, null)).rejects.toBeDefined();
      expect((await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId))?.modelDispatches)
        .toBe(2);
    } finally { await h.dispose(); }
  });

  it('lets a lower configured request limit win over the hard cap', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids, {
        limits: { ...CALENDAR_LIMITS, calendarRequests: 3, refreshRequests: 1, logicalTools: 2 },
      });
      await ledger.ensureBudget();
      await ledger.consume({ calendarRequests: 3 });
      await expect(ledger.consume({ calendarRequests: 4 })).rejects.toBeDefined();
      await ledger.consume({ refreshRequests: 1 });
      await expect(ledger.consume({ refreshRequests: 2 })).rejects.toBeDefined();
      await ledger.consume({ logicalTools: 2 });
      await expect(ledger.consume({ logicalTools: 3 })).rejects.toBeDefined();
    } finally { await h.dispose(); }
  });

  it('keeps an exact repeat of a create debit a duplicate that moves no counter', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids, { limits: { ...CALENDAR_LIMITS, creates: 1 } });
      await ledger.ensureBudget();
      await ledger.chargeLogicalTool('decision-one');
      await ledger.chargeCreate('intent-one');
      // The create increment would cross the configured ceiling, but the debit
      // identity is already applied: it is a duplicate and moves no counter.
      await ledger.chargeCreate('intent-one');
      const budget = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(budget).toMatchObject({ logicalTools: 2, creates: 1 });
      // A different intent is a new debit and the configured ceiling still wins.
      await expect(ledger.chargeCreate('intent-two')).rejects.toMatchObject({
        code: 'STORAGE_BUDGET_EXCEEDED',
      });
      const after = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(after).toMatchObject({ logicalTools: 2, creates: 1 });
    } finally { await h.dispose(); }
  });

  it('keeps the accepted turn deadline at the default total run timeout', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId)).toBeNull();
      const ledger = await openLedger(h, ids);
      const budget = await ledger.ensureBudget();
      expect(DEFAULT_BUDGETS.totalRunTimeoutMs).toBe(180_000);
      expect(budget.deadlineAt).toBe(
        new Date(Date.parse(budget.createdAt) + DEFAULT_BUDGETS.totalRunTimeoutMs).toISOString());
    } finally { await h.dispose(); }
  });

  it('uses confirmed receipts to avoid redundant envelope reads and stops continuation on budget CAS conflict', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Check event abcde');
      const ledger = await openLedger(h, ids, { limits: { ...CALENDAR_LIMITS, modelSpendUsd: '0.008' } });
      await ledger.ensureBudget();
      const dispatch = await ledger.reserveDispatch('initial', estimate, null);
      const memory = h.calendarMemory!;
      const findBefore = memory.calls.filter(e => e.collection === 'metadata' && e.method === 'findOne').length;
      await ledger.beforeDispatch(dispatch.dispatchId);
      await ledger.observe(dispatch.dispatchId, {
        reportedModel: 'fixture/model', reportedProvider: 'Fixture', generationId: 'gen_1',
        providerRequestId: 'req_1', promptTokens: 10, completionTokens: 4,
        cachedPromptTokens: 0, cacheWriteTokens: 0, reasoningOutputTokens: 0,
        money: unavailableMoney(true), firstOutputAt: '2026-10-21T09:00:00.000Z',
        endedAt: null,
      });
      const findAfter = memory.calls.filter(e => e.collection === 'metadata' && e.method === 'findOne').length;
      expect(findAfter - findBefore).toBe(0);

      // Change the durable budget revision, making the ledger's receipt stale.
      const raw = [...memory.rows('metadata').values()].find(d => d.kind === 'calendar-turn-budget')!;
      memory.rows('metadata').set(String(raw._id), {
        ...raw, revision: Number(raw.revision) + 1, _revision: Number(raw._revision) + 1,
      });
      await expect(ledger.observe(dispatch.dispatchId, {
        reportedModel: 'fixture/model', reportedProvider: 'Fixture', generationId: 'gen_1',
        providerRequestId: 'req_1', promptTokens: 10, completionTokens: 4,
        cachedPromptTokens: 0, cacheWriteTokens: 0, reasoningOutputTokens: 0,
        money: {
          currency: 'USD', reportedAmount: '0.001', estimatedAmount: null, costStatus: 'known',
          source: 'provider-response', observedAt: '2026-10-21T09:00:01.000Z', pricing: null,
        },
        firstOutputAt: '2026-10-21T09:00:00.000Z', endedAt: '2026-10-21T09:00:01.000Z',
      })).rejects.toThrow();

      // Held money remains nonzero on the budget, preventing a continuation that would exceed the cap if held is retained.
      const budgetAfterConflict = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(budgetAfterConflict?.reservedUsd).not.toBe('0');
      await expect(ledger.reserveDispatch('continuation', estimate, null)).rejects.toMatchObject({
        code: 'STORAGE_BUDGET_EXCEEDED',
      });
    } finally { await h.dispose(); }
  });
});
