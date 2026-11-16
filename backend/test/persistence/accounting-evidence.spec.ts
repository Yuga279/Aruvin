/**
 * ============================================================================
 * FILE: accounting-evidence.spec.ts
 * LOCATION: backend/test/persistence/accounting-evidence.spec.ts
 * PURPOSE: Verify BSON/domain accounting codecs and immutable absolute saves.
 * ROLE IN PROJECT: Exercises real RecordStore/MongoMetadata with offline driver IO.
 * KEY COMPONENTS: Decimal128 bounds, legacy reads, CAS conflicts, known-cost saves.
 * ============================================================================
 */
import { BSON, Decimal128, type Db } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { accountingRecordSchema } from '../../src/contracts/metadata.js';
import { voiceAccountingRecordSchema } from '../../src/contracts/voice-accounting.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { RecordStore } from '../../src/persistence/store.js';
import { bounded, decode, type StoredDocument } from '../../src/persistence/records.js';
import { accounting, attempt } from './fixtures.js';
const money = (amount = '0.1') => ({ currency: 'USD' as const, reportedAmount: amount,
  estimatedAmount: null, costStatus: 'known' as const, source: 'provider-response' as const,
  observedAt: '2026-10-14T00:00:00.000Z', pricing: null });

export function evidenceDriver() {
  const rows = new Map<string, StoredDocument>();
  let conflict = false;
  const matches = (d: StoredDocument, f: Record<string, unknown>) => Object.entries(f).every(([k, v]) => d[k] === v);
  const db = { collection() { return {
    async findOne(filter: Record<string, unknown>) { return [...rows.values()].find(d => matches(d, filter)) ?? null; },
    async updateOne(filter: Record<string, unknown>, update: { $setOnInsert: StoredDocument }) {
      if (!rows.has(filter._id as string)) rows.set(filter._id as string, BSON.deserialize(BSON.serialize(update.$setOnInsert)) as StoredDocument);
      return { acknowledged: true, matchedCount: 1 };
    },
    async replaceOne(filter: Record<string, unknown>, doc: StoredDocument) {
      const old = rows.get(filter._id as string);
      if (conflict) { conflict = false; if (old) rows.set(old._id, { ...old, _revision: old._revision + 1 }); return { matchedCount: 0 }; }
      if (!old || !matches(old, filter)) return { matchedCount: 0 };
      rows.set(doc._id, BSON.deserialize(BSON.serialize(doc)) as StoredDocument); return { matchedCount: 1 };
    },
  }; } } as unknown as Db;
  return { rows, store: new RecordStore(db, 1000), race: () => { conflict = true; } };
}
it('stores canonical amounts as Decimal128 while preserving domain strings and fractional cents', () => {
  const record = { ...accounting(), cost: 0.000000123456789, money: money('0.000000123456789') };
  const result = bounded(accountingRecordSchema, record, 'id', DEFAULT_BUDGETS.maxDocumentBytes);
  expect(result.doc.money.reportedAmount).toBeInstanceOf(Decimal128);
  expect(result.doc.money.reportedAmount.toString()).toBe(Decimal128.fromString('0.000000123456789').toString());
  expect(decode(accountingRecordSchema, BSON.deserialize(BSON.serialize(result.doc)))).toEqual(record);
  expect(decode(accountingRecordSchema, bounded(accountingRecordSchema, accounting(), 'legacy', 10000).doc)).toEqual(accounting());
});
it('stores precise voice estimate and snapshotted monetary rate as BSON without inventing actual charges', () => {
  const record = { schemaVersion: 1, kind: 'voice-accounting', provider: 'deepgram', userId: 'u', sessionId: 'v',
    voiceSessionId: 'v', conversationId: null, usageId: 'speech', providerSocketId: 'socket',
    userTag: `aurvin-user-${'a'.repeat(64)}`, model: 'flux-haley-en', turnId: 't', responseId: 'r', speechId: null,
    providerRequestId: null, modelVersion: null, status: 'completed', observedAudioMs: null, audioMs: 100,
    billableCharacters: 12, estimatedCostUsd: 0.00018, actualCostUsd: null, startedAt: '2026-10-14T00:00:00.000Z',
    endedAt: '2026-10-14T00:00:01.000Z', money: { currency: 'USD', reportedAmount: null, estimatedAmount: '0.00018',
      source: 'provider-estimate', costStatus: 'unknown', observedAt: '2026-10-14T00:00:01.000Z',
      pricing: { version: 'v1', source: 'operator-configured', unit: 'characters', units: 12, unitSize: 1000, rateUsd: '0.015' } } };
  const result = bounded(voiceAccountingRecordSchema, record, 'voice', DEFAULT_BUDGETS.maxDocumentBytes);
  expect(result.doc.money.estimatedAmount).toBeInstanceOf(Decimal128);
  expect(result.doc.money.pricing.rateUsd).toBeInstanceOf(Decimal128);
  expect(decode(voiceAccountingRecordSchema, BSON.deserialize(BSON.serialize(result.doc)))).toEqual(record);
});
it('saves one absolute charge twice with independent cost completeness and rejects replacement', async () => {
  const f = evidenceDriver(); const metadata = new MongoMetadata(f.store, DEFAULT_BUDGETS);
  await metadata.putAttempt(attempt());
  const record = { ...accounting(), cost: 0.1, money: money() };
  await metadata.putAccounting(record); await metadata.putAccounting(record);
  expect([...f.rows.values()].filter(d => d.kind === 'accounting')).toHaveLength(1);
  expect(await metadata.getAccounting('u1', 's1', 'a1')).toEqual(record);
  expect(await metadata.getAccounting('u2', 's1', 'a1')).toBeNull();
  await expect(metadata.putAccounting({ ...record, cost: 0.2, money: money('0.2') })).rejects.toThrow();
  await expect(metadata.putAccounting({ ...record, money: undefined })).rejects.toThrow();
  expect((await metadata.getAccounting('u1', 's1', 'a1'))?.accountingStatus).toBe('unknown');
});
it('supports completion-only timing enrichment without changing money and refuses regression', async () => {
  const f = evidenceDriver(); const metadata = new MongoMetadata(f.store, DEFAULT_BUDGETS);
  await metadata.putAttempt(attempt());
  const record = { ...accounting(), cost: 0.1, money: money() };
  await metadata.putAccounting(record);
  const enriched = { ...record, timing: { dispatchedAt: null, firstOutputAt: null, providerEndedAt: null,
    durableCompletedAt: '2026-10-14T00:00:00.000Z', providerDurationMs: null, firstOutputLatencyMs: null, dispatchCount: null } };
  await metadata.putAccounting(enriched); await metadata.putAccounting(enriched);
  await expect(metadata.putAccounting(record)).rejects.toThrow();
  expect((await metadata.getAccounting('u1', 's1', 'a1'))?.timing?.providerDurationMs).toBeNull();
});
