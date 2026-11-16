import { describe, expect, it } from 'vitest';
import { reserveUsd, sumUsd, withinSpendCap, turnBudgetRecordSchema,
  modelDispatchSchema, preferredAttemptAccounting } from '../../src/contracts/calendar-accounting.js';
import { unavailableMoney } from '../../src/contracts/usage-evidence.js';
const at = '2026-10-20T10:00:00.000Z';
const price = { version: 'p1', source: 'verified-fixture', observedAt: at, modelId: 'test/model',
  providerRoute: 'fixture-provider', promptUsdPerToken: '0.0000025', completionUsdPerToken: '0.00001', requestUsd: '0' };
describe('Calendar dispatch accounting', () => {
  it('uses exact canonical decimals and never drops unknown reservations', () => {
    expect(sumUsd(['0.1', '0.2'])).toBe('0.3');
    expect(reserveUsd(price, 100, 100)).toBe('0.00125');
    expect(withinSpendCap('0.5', '0.4', '0.1', '1')).toBe(true);
    expect(withinSpendCap('0.5', '0.4', '0.10000000000000000000000000000001', '1')).toBe(false);
    const dispatch = { schemaVersion: 1, kind: 'calendar-model-dispatch', userId: 'u', sessionId: 's',
      turnId: 't', attemptId: 'a', dispatchId: 'd', decisionId: 'decision', dispatchIndex: 1,
      reason: 'initial', repairedDecisionId: null, requestedModel: 'test/model', reportedModel: null,
      reportedProvider: null, openRouterUser: 'u', generationId: null, providerRequestId: null,
      configRevision: 1, connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v1',
      status: 'terminal', startedAt: at, endedAt: at, firstOutputAt: null,
      promptTokens: null, completionTokens: null, cachedPromptTokens: null, cacheWriteTokens: null,
      reasoningOutputTokens: null, money: unavailableMoney(true), pricing: price,
      reservationUsd: '0.00125', reservationStatus: 'held', failure: null };
    expect(modelDispatchSchema.parse(dispatch).reservationStatus).toBe('held');
    expect(modelDispatchSchema.safeParse({ ...dispatch, reservationStatus: 'settled' }).success).toBe(false);
    expect(modelDispatchSchema.safeParse({ ...dispatch, reasoning: 'private' }).success).toBe(false);
    const legacy = { userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', kind: 'accounting' as const };
    const aggregate = { userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', kind: 'calendar-model-aggregate' as const };
    expect(preferredAttemptAccounting(legacy, aggregate)).toBe(aggregate);
    expect(preferredAttemptAccounting(legacy, null)).toBe(legacy);
  });
  it('persists global counters and rejects overflow after reload', () => {
    const budget = { schemaVersion: 1, kind: 'calendar-turn-budget', userId: 'u', sessionId: 's', turnId: 't',
      revision: 3, modelDispatches: 8, repairs: 2, logicalTools: 6, creates: 1,
      calendarRequests: 20, refreshRequests: 2, deadlineAt: '2026-10-20T10:03:00.000Z',
      createdAt: at, settledUsd: '0.5', reservedUsd: '0.5' };
    const restored = turnBudgetRecordSchema.parse(JSON.parse(JSON.stringify(budget)));
    expect(restored).toEqual(budget);
    for (const key of ['modelDispatches', 'repairs', 'logicalTools', 'creates', 'calendarRequests', 'refreshRequests'] as const) {
      expect(turnBudgetRecordSchema.safeParse({ ...budget, [key]: budget[key] + 1 }).success).toBe(false);
    }
  });
});
