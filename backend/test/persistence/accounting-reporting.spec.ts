/**
 * ============================================================================
 * FILE: accounting-reporting.spec.ts
 * LOCATION: backend/test/persistence/accounting-reporting.spec.ts
 * PURPOSE: Verify bounded accounting reporting and historical range inclusion.
 * ROLE IN PROJECT: Offline aggregation fixture complements separately gated native tests.
 * KEY COMPONENTS: Decimal sums, request deduplication, units, UTC ranges and caps.
 * ============================================================================
 */
import { BSON, type Db, type Document } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { RecordStore } from '../../src/persistence/store.js';
import { bounded } from '../../src/persistence/records.js';
import { accountingRecordSchema } from '../../src/contracts/metadata.js';
import { accounting } from './fixtures.js';
import { evaluate, match } from './accounting-reporting-fixture.js';

function fixture(rows: Document[]) {
  const pipelines: Document[][] = [];
  const db = { collection() { return { find(filter: Document) {
    let selected = rows.filter(r => match(r, filter));
    const cursor = { sort(order: Document) { selected = evaluate(selected, [{ $sort: order }]); return cursor; },
      limit(n: number) { selected = selected.slice(0, n); return cursor; }, toArray: async () => selected };
    return cursor;
  }, aggregate(pipeline: Document[], options: Document) {
    pipelines.push(pipeline); expect(options.allowDiskUse).toBe(false); expect(options.maxTimeMS).toBeGreaterThan(0);
    return { toArray: async () => evaluate(rows.map(r => BSON.deserialize(BSON.serialize(r))), pipeline) };
  } }; } } as unknown as Db;
  return { metadata: new MongoMetadata(new RecordStore(db, 1000), DEFAULT_BUDGETS), pipelines };
}
const range = { start: '2026-10-06T00:00:00.000Z', end: '2026-10-07T00:00:00.000Z', limit: 50 };
it('reports legacy failed and cancelled attempts as one request with exact 0.1 + 0.2 spend and incomplete tokens', async () => {
  const f = fixture([{ ...accounting(), _id: 'a', cost: 0.1, outcome: 'failed' },
    { ...accounting(), _id: 'b', cost: 0.2, attemptId: 'a2', outcome: 'cancelled' },
    { ...accounting(), _id: 'other', userId: 'u2', cost: 1 },
    { kind: 'executor', cost: 200, startedAt: range.start, userId: 'u1' }]);
  const report = await f.metadata.accountingTotals({ ...range, userId: 'u1' });
  expect(report.items).toHaveLength(1);
  expect(report.items[0]).toMatchObject({ currency: 'USD', unit: 'text-tokens', reportedTotal: '0.3', estimatedTotal: null,
    requestCount: 1, executionAttemptCount: 2, operationCount: 2, knownCostCount: 2, tokenIncompleteCount: 2 });
  expect(report.items[0].failedCount).toBe(1); expect(report.items[0].cancelledCount).toBe(1);
});
it('aggregates BSON canonical fractional cents without adding cache/reasoning breakdowns to parent totals', async () => {
  const rows = ['0.0000001', '0.0000002'].map((amount, i) => bounded(accountingRecordSchema, {
    ...accounting(), sessionId: `s${i}`, cost: Number(amount), promptTokens: 10, completionTokens: 8,
    cachedPromptTokens: 4, reasoningOutputTokens: 3, cacheWriteTokens: null, accountingStatus: 'known',
    money: { currency: 'USD', reportedAmount: amount, estimatedAmount: null, costStatus: 'known',
      source: 'provider-response', observedAt: range.start, pricing: null },
  }, String(i), DEFAULT_BUDGETS.maxDocumentBytes).doc);
  const f = fixture(rows);
  expect((await f.metadata.accountingTotals(range)).items[0]).toMatchObject({ reportedTotal: '0.0000003',
    promptTokens: 20, completionTokens: 16, cachedPromptTokens: 8, reasoningOutputTokens: 6,
    requestCount: 2, operationCount: 2, tokenCompleteCount: 2 });
});
it('does not claim rejected HTTP dispatches are known free when the final generation cost is known', async () => {
  const f = fixture([{ ...accounting(), _id: 'a', cost: 0.1, timing: { dispatchCount: 2 } }]);
  expect((await f.metadata.accountingTotals(range)).items[0]).toMatchObject({ reportedTotal: '0.1', knownCostCount: 1,
    dispatchCount: 2, unobservedDispatchBillingCount: 1, spendComplete: false });
});
it('pages one user across sessions with no loss at same-time boundaries and legacy equality', async () => {
  const records = ['s1', 's2', 's3'].map((sessionId, i) => ({ ...accounting(), sessionId, _id: String(i), _revision: 0 }));
  const f = fixture([...records, { ...accounting(), _id: 'foreign', userId: 'u2', _revision: 0 }]);
  const first = await f.metadata.listAccounting({ ...range, userId: 'u1', limit: 2 });
  expect(first.items).toHaveLength(2);
  const next = await f.metadata.listAccounting({ ...range, userId: 'u1', limit: 2, cursor: first.nextCursor });
  expect(next.items).toHaveLength(1); expect(next.nextCursor).toBeNull();
  expect([...first.items, ...next.items].map(r => r.sessionId)).toEqual(['s1', 's2', 's3']);
  expect(first.items[0]).toEqual(accounting());
  await expect(f.metadata.listAccounting({ ...range, userId: 'u2', cursor: first.nextCursor })).rejects.toThrow();
});
it('uses half-open UTC boundaries, includes unknowns without claiming zero and bounds all-user output', async () => {
  const f = fixture([{ ...accounting(), _id: 'a', cost: 0 },
    { ...accounting(), _id: 'b', userId: 'u2', startedAt: range.end, cost: 999 },
    { ...accounting(), _id: 'c', userId: 'u3', turnId: 't3', outcome: 'interrupted' }]);
  const all = await f.metadata.accountingTotals(range);
  expect(all.items[0]).toMatchObject({ reportedTotal: '0', knownCostCount: 1, unknownCostCount: 1,
    spendComplete: false, requestCount: 2, interruptedCount: 1 });
  const users = await f.metadata.accountingTotals({ ...range, byUser: true, limit: 1 });
  expect(users.items[0].userId).toBe('u1'); expect(users.nextCursor).not.toBeNull();
  const next = await f.metadata.accountingTotals({ ...range, byUser: true, limit: 1, cursor: users.nextCursor });
  expect(next.items[0].userId).toBe('u3');
  for (const bad of [{ ...range, start: range.end }, { ...range, end: '2027-01-01T00:00:00.000Z' },
    { ...range, start: '2026-10-06' }, { ...range, limit: 51 }]) await expect(f.metadata.accountingTotals(bad)).rejects.toThrow();
});
it('separates voice response estimates from STT observed units and never charges TTS sockets twice', async () => {
  const base = { kind: 'voice-accounting', startedAt: range.start, userId: 'u1', sessionId: 'v',
    providerSocketId: 'socket', status: 'interrupted', actualCostUsd: null };
  const f = fixture([{ ...base, _id: 'socket', usageId: 'socket', responseId: null, model: 'flux-haley-en', estimatedCostUsd: null },
    { ...base, _id: 'speech', usageId: 'speech', responseId: 'r1', turnId: 't1', model: 'flux-haley-en', billableCharacters: 12, estimatedCostUsd: 0.00018 },
    { ...base, _id: 'stt', usageId: 'stt', responseId: null, model: 'nova-3', observedAudioMs: 80, estimatedCostUsd: null }]);
  const report = await f.metadata.accountingTotals({ ...range, userId: 'u1' });
  expect(report.items).toHaveLength(2);
  expect(report.items.find(r => r.unit === 'voice-characters')).toMatchObject({ reportedTotal: null,
    estimatedTotal: '0.00018', requestCount: 0, executionAttemptCount: 0, operationCount: 1, billableCharacters: 12 });
  expect(report.items.find(r => r.unit === 'voice-audio')).toMatchObject({ reportedTotal: null, estimatedTotal: null,
    observedAudioMs: 80, operationCount: 1, spendComplete: false });
});
it('rejects record-cap overflow instead of returning partial totals', async () => {
  const f = fixture(Array.from({ length: 10001 }, (_, i) => ({ ...accounting(), _id: String(i), turnId: String(i) })));
  await expect(f.metadata.accountingTotals(range)).rejects.toThrow();
});
