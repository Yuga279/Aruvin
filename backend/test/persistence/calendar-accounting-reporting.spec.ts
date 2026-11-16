/**
 * ============================================================================
 * FILE: calendar-accounting-reporting.spec.ts
 * LOCATION: backend/test/persistence/calendar-accounting-reporting.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify accounting aggregation pipelines and reporting across calendar dispatches.
 *
 * ROLE IN PROJECT:
 *    Ensures MongoMetadata aggregation correctly summarizes v1 and mixed v1/v2 calendar
 *    model dispatches, replacing legacy attempt totals without double counting.
 *
 * KEY COMPONENTS:
 *    - Dispatch evidence replaces legacy attempt totals once.
 *    - Aggregates mixed v1 and v2 dispatches replacing legacy attempt totals.
 * ============================================================================
 */

import { BSON, type Db, type Document } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { RecordStore } from '../../src/persistence/store.js';
import { encodeAccountingMoney } from '../../src/persistence/accounting-codec.js';
import { accounting } from './fixtures.js';
import { dispatch, later, now } from './calendar-fixtures.js';
import { evaluate } from './accounting-reporting-fixture.js';
import { emptyTiming } from '../../src/contracts/usage-evidence.js';

function fixture(rows: Document[]) {
  const pipelines: Document[][] = [];
  const db = { collection() { return { find() { return { sort() { return this; }, limit() { return this; }, toArray: async () => [] }; },
    aggregate(pipeline: Document[], options: Document) {
      pipelines.push(pipeline); expect(options.allowDiskUse).toBe(false);
      return { toArray: async () => evaluate(rows.map(r => BSON.deserialize(BSON.serialize(r))), pipeline) };
    } }; } } as unknown as Db;
  return { metadata: new MongoMetadata(new RecordStore(db, 1000), DEFAULT_BUDGETS), pipelines };
}

const range = { start: '2026-10-20T00:00:00.000Z', end: '2026-10-21T00:00:00.000Z', limit: 50 };

function knownMoney(amount: string) {
  return {
    currency: 'USD' as const, reportedAmount: amount, estimatedAmount: null, costStatus: 'known' as const,
    source: 'provider-response' as const, observedAt: now, pricing: null,
  };
}

function pluginDispatch(amount: string, dispatchId: string, dispatchIndex: number) {
  return encodeAccountingMoney({
    ...dispatch(), dispatchId, decisionId: `dec${dispatchIndex}`, dispatchIndex,
    status: 'terminal', endedAt: later, reservationStatus: 'settled', money: knownMoney(amount),
    startedAt: now, _id: dispatchId, _revision: 0,
  });
}

it('dispatch evidence replaces legacy attempt totals once', async () => {
  const f = fixture([
    { ...accounting(), _id: 'legacy-a1', cost: 0.9, startedAt: now, money: knownMoney('0.9') },
    pluginDispatch('0.1', 'd1', 1),
    pluginDispatch('0.2', 'd2', 2),
    {
      schemaVersion: 1, kind: 'calendar-model-aggregate', userId: 'u1', sessionId: 's1', turnId: 't1',
      attemptId: 'a1', dispatchIds: ['d1', 'd2'], reportedUsd: '0.3', heldReservationUsd: '0',
      costStatus: 'known', promptTokens: null, completionTokens: null, calendarRequests: 0, refreshRequests: 0,
      connectorMoney: knownMoney('0'), updatedAt: now, startedAt: now, _id: 'agg', _revision: 0,
    },
    { ...accounting(), _id: 'legacy-a2', attemptId: 'a2', cost: 0.4, startedAt: now, money: knownMoney('0.4'),
      timing: { ...emptyTiming(), dispatchCount: 1 } },
    {
      schemaVersion: 1, kind: 'voice-accounting', userId: 'u1', sessionId: 'voice-1', voiceSessionId: 'voice-1',
      conversationId: null, usageId: 'socket-1', providerSocketId: 'socket-1',
      userTag: `aurvin-user-${'a'.repeat(64)}`, provider: 'deepgram', model: 'nova-3',
      turnId: null, responseId: null, speechId: null, providerRequestId: null, modelVersion: null,
      status: 'pending', observedAudioMs: 80, audioMs: null, billableCharacters: null,
      estimatedCostUsd: null, actualCostUsd: null, startedAt: now, endedAt: null, _id: 'voice', _revision: 0,
    },
  ]);
  const report = await f.metadata.accountingTotals({ ...range, userId: 'u1' });
  const textTotals = report.items.find((row) => row.unit === 'text-tokens');
  expect(textTotals?.reportedTotal).toBe('0.7');
  expect(textTotals?.requestCount).toBe(1);
  expect(textTotals?.executionAttemptCount).toBe(2);
  expect(textTotals?.dispatchCount).toBe(3);
  expect(textTotals?.spendComplete).toBe(true);
});

it('aggregates mixed v1 and v2 dispatches replacing legacy attempt totals', async () => {
  const f = fixture([
    { ...accounting(), _id: 'legacy-a1', cost: 0.9, startedAt: now, money: knownMoney('0.9') },
    pluginDispatch('0.1', 'd1', 1),
    encodeAccountingMoney({
      ...dispatch(),
      schemaVersion: 2,
      schemaRevision: 'google-calendar.v2',
      dispatchId: 'd2',
      decisionId: 'dec2',
      dispatchIndex: 2,
      status: 'terminal',
      endedAt: later,
      reservationStatus: 'settled',
      money: knownMoney('0.2'),
      startedAt: now,
      _id: 'd2',
      _revision: 0,
    }),
    {
      schemaVersion: 1, kind: 'calendar-model-aggregate', userId: 'u1', sessionId: 's1', turnId: 't1',
      attemptId: 'a1', dispatchIds: ['d1', 'd2'], reportedUsd: '0.3', heldReservationUsd: '0',
      costStatus: 'known', promptTokens: null, completionTokens: null, calendarRequests: 0, refreshRequests: 0,
      connectorMoney: knownMoney('0'), updatedAt: now, startedAt: now, _id: 'agg', _revision: 0,
    },
  ]);
  const report = await f.metadata.accountingTotals({ ...range, userId: 'u1' });
  const textTotals = report.items.find((row) => row.unit === 'text-tokens');
  expect(textTotals?.reportedTotal).toBe('0.3');
  expect(textTotals?.dispatchCount).toBe(2);
});

