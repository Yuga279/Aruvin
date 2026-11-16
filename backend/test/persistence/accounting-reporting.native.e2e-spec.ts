/**
 * ============================================================================
 * FILE: accounting-reporting.native.e2e-spec.ts
 * LOCATION: backend/test/persistence/accounting-reporting.native.e2e-spec.ts
 * PURPOSE: Verify Decimal128 reporting, mixed legacy migration and native query plans.
 * ROLE IN PROJECT: Operator-supplied isolated generated databases only; never application data.
 * KEY COMPONENTS: Real aggregation/storage, conditional maintenance, index explain evidence.
 * ============================================================================
 */
import { BSON, Decimal128, type Document } from 'mongodb';
import { nativeDatabase } from './native.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { accountingRecordSchema } from '../../src/contracts/metadata.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { RecordStore } from '../../src/persistence/store.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { setupIndexes } from '../../src/persistence/indexes.js';
import { accountingRangeFilter } from '../../src/persistence/accounting-reporting.js';
import { key } from '../../src/persistence/records.js';
import { accounting } from './fixtures.js';
const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;
const range = { start: '2026-10-06T00:00:00.000Z', end: '2026-10-07T00:00:00.000Z', limit: 50 };

nativeIt('round trips and sums precise canonical charges across retries alongside unmigrated records', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15000); const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
    await setupIndexes(h.db);
    const first = { ...accounting(), outcome: 'failed' as const, cost: 0.1, money: { currency: 'USD' as const,
      reportedAmount: '0.1', estimatedAmount: null, costStatus: 'known' as const, source: 'provider-response' as const,
      observedAt: range.start, pricing: null } };
    await store.insert('metadata', accountingRecordSchema, first, key('accounting', 'u1', 's1', 'a1'), DEFAULT_BUDGETS.maxDocumentBytes);
    await store.insert('metadata', accountingRecordSchema, { ...accounting(), cost: 0.2, attemptId: 'a2', outcome: 'cancelled' },
      key('accounting', 'u1', 's1', 'a2'), DEFAULT_BUDGETS.maxDocumentBytes);
    expect((await metadata.getAccounting('u1', 's1', 'a1'))).toEqual(first);
    expect((await store.raw('metadata', { _id: key('accounting', 'u1', 's1', 'a1') }))!.money.reportedAmount).toBeInstanceOf(Decimal128);
    expect((await metadata.accountingTotals({ ...range, userId: 'u1' })).items[0]).toMatchObject({ reportedTotal: '0.3',
      requestCount: 1, executionAttemptCount: 2, knownCostCount: 2, tokenIncompleteCount: 2 });
  } finally { await h.close(); }
}, 60000);
nativeIt('dry-runs and applies idempotent enrichment without rewriting control or saved checkpoint bytes', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15000); const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
    const owner = new MongoOwnership(store); await owner.claimExecutor();
    await store.insert('metadata', accountingRecordSchema, { ...accounting(), cost: 0.000000123456789 },
      key('accounting', 'u1', 's1', 'a1'), DEFAULT_BUDGETS.maxDocumentBytes);
    await h.db.collection('checkpoints').insertOne({ thread_id: 'fixture', type: 'json', checkpoint: Buffer.from('legacy-fixture'), checkpoint_id: 'fixture' });
    const checkpoint = BSON.serialize((await h.db.collection('checkpoints').findOne({}))!);
    const sentinel = BSON.serialize((await store.raw('metadata', { _id: key('executor') }))!);
    expect((await metadata.migrateAccountingPage({ limit: 50 })).converted).toBe(0);
    expect((await metadata.migrateAccountingPage({ limit: 50, apply: true, maintenanceConfirmed: true, owner })).converted).toBe(1);
    expect((await metadata.migrateAccountingPage({ limit: 50, apply: true, maintenanceConfirmed: true, owner })).unchanged).toBe(1);
    expect((await metadata.getAccounting('u1', 's1', 'a1'))?.money?.reportedAmount).toBe('0.000000123456789');
    expect(BSON.serialize((await h.db.collection('checkpoints').findOne({}))!)).toEqual(checkpoint);
    expect(BSON.serialize((await store.raw('metadata', { _id: key('executor') }))!)).toEqual(sentinel);
    await owner.releaseExecutor();
  } finally { await h.close(); }
}, 60000);
nativeIt('records observed native user/all-user range query plans without claiming production performance', async () => {
  const h = await nativeDatabase();
  try {
    await setupIndexes(h.db); const store = new RecordStore(h.db, 15000);
    for (let i = 0; i < 120; i++) {
      const record = { ...accounting(), userId: `fixture-user-${i % 12}`, sessionId: `s${i}`, attemptId: `a${i}` };
      await store.insert('metadata', accountingRecordSchema, record, key('accounting', record.userId, record.sessionId, record.attemptId), DEFAULT_BUDGETS.maxDocumentBytes);
    }
    function indexes(value: unknown): string[] {
      if (!value || typeof value !== 'object') return [];
      const doc = value as Document;
      return [...(typeof doc.indexName === 'string' ? [doc.indexName] : []), ...Object.values(doc).flatMap(indexes)];
    }
    for (const userId of ['fixture-user-1', undefined]) {
      const result = await store.collection('metadata').find(accountingRangeFilter({ ...range, ...(userId ? { userId } : {}) })).explain('executionStats');
      console.info(JSON.stringify({ fixture: 'accounting-query-plan', shape: userId ? 'user' : 'all-users',
        indexNames: [...new Set(indexes(result.queryPlanner.winningPlan))], docsExamined: result.executionStats.totalDocsExamined,
        keysExamined: result.executionStats.totalKeysExamined, returned: result.executionStats.nReturned }));
      expect(result.executionStats.nReturned).toBe(userId ? 10 : 120);
    }
  } finally { await h.close(); }
}, 60000);
