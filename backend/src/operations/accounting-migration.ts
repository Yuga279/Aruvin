/**
 * ============================================================================
 * FILE: accounting-migration.ts
 * LOCATION: backend/src/operations/accounting-migration.ts
 * PURPOSE: Enrich only legacy accounting evidence in dry-run-first bounded pages.
 * ROLE IN PROJECT: Maintenance uses the admitted executor/store and revision CAS.
 * KEY COMPONENTS: Legacy number provenance, quiescence gate, conditional writes.
 * ============================================================================
 */
import type { BudgetConfig } from '../contracts/budgets.js';
import { accountingRecordSchema } from '../contracts/metadata.js';
import { voiceAccountingRecordSchema } from '../contracts/voice-accounting.js';
import { decimalFromNumber, unavailableMoney } from '../contracts/usage-evidence.js';
import { AppError } from '../platform/errors/app-error.js';
import type { MongoOwnership } from '../persistence/ownership.js';
import type { RecordStore } from '../persistence/store.js';
import { bounded, decode, key } from '../persistence/records.js';

export type AccountingMigrationQuery = { limit: number; cursor?: string | null; apply?: boolean;
  maintenanceConfirmed?: boolean; owner?: MongoOwnership; signal?: AbortSignal };
export async function migrateAccountingPage(store: RecordStore, budgets: BudgetConfig, q: AccountingMigrationQuery) {
  if (!Number.isSafeInteger(q.limit) || q.limit < 1 || q.limit > budgets.maxPageSize
    || (q.cursor !== undefined && q.cursor !== null && !/^[a-f0-9]{64}$/.test(q.cursor)))
    throw new AppError('INVALID_REQUEST', 'Invalid accounting migration page.');
  const check = async () => {
    if (q.signal?.aborted) throw new AppError('CANCELLED', 'Accounting migration was stopped.');
    if (!q.apply) return;
    if (!q.maintenanceConfirmed || !q.owner || q.owner.store !== store)
      throw new AppError('UNSUPPORTED_TOPOLOGY', 'Admitted maintenance ownership is required.');
    await q.owner.assertExecutor();
    const observed = await q.owner.observedExecutor();
    if (observed.record.local && (observed.record.local.pending || observed.record.local.mutation.state !== 'idle'))
      throw new AppError('NOT_READY', 'Executor recovery must finish before accounting maintenance.');
    if (await store.collection('sessions').findOne({ $or: [
      { 'execution.ownerId': { $ne: null } }, { 'execution.activeAttemptId': { $ne: null } },
    ] }, store.options())) throw new AppError('NOT_READY', 'Chat work must be quiescent before accounting maintenance.');
  };
  await check();
  const docs = await store.collection('metadata').find({ kind: { $in: ['accounting', 'voice-accounting'] },
    ...(q.cursor ? { _id: { $gt: q.cursor } } : {}) }, store.options()).sort({ _id: 1 }).limit(q.limit + 1).toArray();
  const result = { scanned: 0, eligible: 0, converted: 0, unchanged: 0, invalid: 0, conflicts: 0,
    nextCursor: docs.length > q.limit ? docs[q.limit - 1]._id : null as string | null };
  for (const doc of docs.slice(0, q.limit)) {
    result.scanned++;
    let next;
    try {
      if (!Number.isSafeInteger(doc._revision) || doc._revision < 0) throw new Error('Invalid revision');
      const old = (doc.kind === 'accounting' ? decode(accountingRecordSchema, doc) : decode(voiceAccountingRecordSchema, doc))!;
      const identity = old.kind === 'accounting' ? old.attemptId : old.usageId;
      if (doc._id !== key(old.kind, old.userId, old.sessionId, identity)) throw new Error('Invalid identity');
      if (old.money) { result.unchanged++; continue; }
      const reported = old.kind === 'accounting' && old.cost !== null ? decimalFromNumber(old.cost) : null;
      const estimated = old.kind === 'voice-accounting' && old.estimatedCostUsd !== null ? decimalFromNumber(old.estimatedCostUsd) : null;
      const money = reported !== null || estimated !== null ? { ...unavailableMoney(), reportedAmount: reported,
        estimatedAmount: estimated, costStatus: reported === null ? 'unknown' as const : 'known' as const,
        source: 'legacy-number' as const, observedAt: new Date().toISOString() }
        : unavailableMoney(old.kind === 'accounting' ? old.accountingStatus === 'pending' : old.status === 'pending');
      next = old.kind === 'accounting' ? bounded(accountingRecordSchema, { ...old, money }, doc._id, budgets.maxDocumentBytes).record
        : bounded(voiceAccountingRecordSchema, { ...old, money }, doc._id, budgets.maxDocumentBytes).record;
    } catch { result.invalid++; continue; }
    result.eligible++;
    if (!q.apply) continue;
    await check();
    const saved = next.kind === 'accounting'
      ? await store.replace('metadata', accountingRecordSchema, next, doc._id, doc._revision, budgets.maxDocumentBytes)
      : await store.replace('metadata', voiceAccountingRecordSchema, next, doc._id, doc._revision, budgets.maxDocumentBytes);
    if (saved) result.converted++; else result.conflicts++;
  }
  return result;
}
