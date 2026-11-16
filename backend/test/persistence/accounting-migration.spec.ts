/**
 * ============================================================================
 * FILE: accounting-migration.spec.ts
 * LOCATION: backend/test/persistence/accounting-migration.spec.ts
 * PURPOSE: Verify dry-run-first, revision-safe legacy accounting enrichment.
 * ROLE IN PROJECT: Uses real bounded codecs/repository with isolated in-memory IO.
 * KEY COMPONENTS: Zero-mutation dry run, idempotence, conflicts and control isolation.
 * ============================================================================
 */
import { BSON, Decimal128, type Db } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { accountingRecordSchema } from '../../src/contracts/metadata.js';
import { voiceAccountingRecordSchema } from '../../src/contracts/voice-accounting.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { RecordStore } from '../../src/persistence/store.js';
import { bounded, key, type StoredDocument } from '../../src/persistence/records.js';
import type { MongoOwnership } from '../../src/persistence/ownership.js';
import { accounting } from './fixtures.js';

function legacyVoice() {
  return voiceAccountingRecordSchema.parse({ schemaVersion: 1, kind: 'voice-accounting', provider: 'deepgram',
    userId: 'u1', sessionId: 'v1', voiceSessionId: 'v1', conversationId: null, usageId: 'speech', providerSocketId: 'socket',
    userTag: `aurvin-user-${'a'.repeat(64)}`, model: 'flux-haley-en', turnId: 't1', responseId: 'r1', speechId: 'speech-1',
    providerRequestId: null, modelVersion: null, status: 'completed', observedAudioMs: null, audioMs: 100,
    billableCharacters: 12, estimatedCostUsd: 0.00018, actualCostUsd: null,
    startedAt: '2026-10-14T00:00:00.000Z', endedAt: '2026-10-14T00:00:01.000Z' });
}

function fixture() {
  const rows = new Map<string, StoredDocument>(); const touched: string[] = []; let race = false;
  const db = { collection(name: string) { return {
    find(filter: Record<string, any>) {
      let docs = [...rows.values()].filter(d => name === 'metadata' && filter.kind.$in.includes(d.kind)
        && (!filter._id || d._id > filter._id.$gt));
      const cursor = { sort() { docs.sort((a, b) => a._id.localeCompare(b._id)); return cursor; },
        limit(n: number) { docs = docs.slice(0, n); return cursor; }, toArray: async () => docs };
      return cursor;
    },
    async findOne(filter: Record<string, unknown>) {
      if (name === 'sessions') return null;
      return [...rows.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null;
    },
    async replaceOne(filter: Record<string, unknown>, doc: StoredDocument) {
      touched.push(doc.kind as string); const old = rows.get(doc._id)!;
      if (race) { race = false; rows.set(old._id, { ...old, _revision: old._revision + 1, outcome: 'interrupted' }); return { matchedCount: 0 }; }
      if (old._revision !== filter._revision) return { matchedCount: 0 };
      rows.set(doc._id, BSON.deserialize(BSON.serialize(doc)) as StoredDocument); return { matchedCount: 1 };
    },
  }; } } as unknown as Db;
  const store = new RecordStore(db, 1000); const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
  const owner = { store, assertExecutor: vi.fn(async () => {}), observedExecutor: vi.fn(async () => ({ record: {} })) } as unknown as MongoOwnership;
  const insert = (record = accounting()) => { const id = key('accounting', record.userId, record.sessionId, record.attemptId);
    rows.set(id, bounded(accountingRecordSchema, record, id, DEFAULT_BUDGETS.maxDocumentBytes).doc); return id; };
  return { rows, touched, metadata, owner, insert, race: () => { race = true; } };
}
it('dry run never mutates and apply retains numeric fields with legacy provenance, idempotently', async () => {
  const f = fixture(); const id = f.insert({ ...accounting(), cost: 0.1 });
  f.rows.set('executor', { _id: 'executor', _revision: 8, kind: 'executor', ownerId: 'original' });
  const original = BSON.serialize(f.rows.get(id)!);
  const dry = await f.metadata.migrateAccountingPage({ limit: 2 });
  expect(dry).toMatchObject({ scanned: 1, eligible: 1, converted: 0, conflicts: 0 });
  expect(f.touched).toEqual([]); expect(BSON.serialize(f.rows.get(id)!)).toEqual(original);
  const applied = await f.metadata.migrateAccountingPage({ limit: 2, apply: true, maintenanceConfirmed: true, owner: f.owner });
  expect(applied.converted).toBe(1);
  expect(f.rows.get(id)!.money.reportedAmount).toBeInstanceOf(Decimal128);
  expect(f.rows.get(id)!.cost).toBe(0.1); expect(f.rows.get(id)!._revision).toBe(1);
  expect(f.rows.get(id)!.money.source).toBe('legacy-number');
  expect((await f.metadata.migrateAccountingPage({ limit: 2, apply: true, maintenanceConfirmed: true, owner: f.owner })).unchanged).toBe(1);
  expect(f.touched).toEqual(['accounting']); expect(f.rows.get('executor')).toEqual({ _id: 'executor', _revision: 8, kind: 'executor', ownerId: 'original' });
});
it('reports concurrent revisions rather than overwriting financial or outcome evidence', async () => {
  const f = fixture(); const id = f.insert({ ...accounting(), cost: 0.2 }); f.race();
  const result = await f.metadata.migrateAccountingPage({ limit: 1, apply: true, maintenanceConfirmed: true, owner: f.owner });
  expect(result.conflicts).toBe(1); expect(result.converted).toBe(0);
  expect(f.rows.get(id)!.money).toBeUndefined(); expect(f.rows.get(id)!.outcome).toBe('interrupted');
});
it('preserves null evidence, rejects ungated apply, and continues bounded pages', async () => {
  const f = fixture(); f.insert(); f.insert({ ...accounting(), attemptId: 'a2' });
  const first = await f.metadata.migrateAccountingPage({ limit: 1 });
  expect(first.nextCursor).not.toBeNull();
  const second = await f.metadata.migrateAccountingPage({ limit: 1, cursor: first.nextCursor });
  expect(second.scanned).toBe(1); expect(second.nextCursor).toBeNull();
  await expect(f.metadata.migrateAccountingPage({ limit: 1, apply: true })).rejects.toThrow();
  await f.metadata.migrateAccountingPage({ limit: 2, apply: true, maintenanceConfirmed: true, owner: f.owner });
  for (const doc of f.rows.values()) expect(doc.money).toMatchObject({ reportedAmount: null, estimatedAmount: null, source: 'unavailable', costStatus: 'unknown' });
});
it('migrates legacy voice estimates without inventing historical rates or reported invoice charges', async () => {
  const f = fixture(); const voice = legacyVoice(); const id = key('voice-accounting', voice.userId, voice.sessionId, voice.usageId);
  f.rows.set(id, bounded(voiceAccountingRecordSchema, voice, id, DEFAULT_BUDGETS.maxDocumentBytes).doc);
  expect(await f.metadata.getVoiceAccounting('u1', 'v1', 'speech')).toEqual(voice);
  await f.metadata.migrateAccountingPage({ limit: 50, apply: true, maintenanceConfirmed: true, owner: f.owner });
  const saved = await f.metadata.getVoiceAccounting('u1', 'v1', 'speech');
  expect(saved?.money).toMatchObject({ reportedAmount: null, estimatedAmount: '0.00018',
    source: 'legacy-number', costStatus: 'unknown', pricing: null });
  expect(saved?.estimatedCostUsd).toBe(voice.estimatedCostUsd); expect(saved?.actualCostUsd).toBeNull();
});
it('old strict readers reject enriched fields; metadata rollback alone cannot certify new saved checkpoints', () => {
  const oldTextReader = accountingRecordSchema.innerType().omit({ money: true, timing: true, cachedPromptTokens: true,
    cacheWriteTokens: true, reasoningOutputTokens: true });
  expect(oldTextReader.safeParse(accounting()).success).toBe(true);
  expect(oldTextReader.safeParse({ ...accounting(), money: {} }).success).toBe(false);
  const oldVoiceReader = voiceAccountingRecordSchema.innerType().omit({ money: true, timing: true });
  expect(oldVoiceReader.safeParse(legacyVoice()).success).toBe(true);
  expect(oldVoiceReader.safeParse({ ...legacyVoice(), money: {} }).success).toBe(false);
});
