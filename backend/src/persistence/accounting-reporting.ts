/**
 * ============================================================================
 * FILE: accounting-reporting.ts
 * LOCATION: backend/src/persistence/accounting-reporting.ts
 * PURPOSE: Aggregate bounded accounting evidence with native Decimal128 sums.
 * ROLE IN PROJECT: Includes unmigrated ISO dates/costs, never joins payload collections.
 * KEY COMPONENTS: Frozen read-only pipeline capability, scoped cursors, decoded totals.
 * ============================================================================
 */
import { z } from 'zod';
import { Decimal128, type Document, type Filter } from 'mongodb';
import { accountingQuerySchema, MAX_ACCOUNTING_REPORT_RECORDS, type AccountingQuery, type AccountingTotals } from '../contracts/accounting-reporting.js';
import { canonicalDecimal } from '../contracts/usage-evidence.js';
import { idSchema } from '../contracts/identifiers.js';
import { AppError } from '../platform/errors/app-error.js';
import type { StoredDocument } from './records.js';
import type { RecordStore } from './store.js';

const admitted = new WeakSet<object>();
function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
// The local driver admits only immutable pipelines created here, not arbitrary aggregation.
export const isAccountingReadPipeline = (value: unknown): boolean => typeof value === 'object' && value !== null && admitted.has(value);
const badQuery = () => new AppError('INVALID_REQUEST', 'Invalid accounting reporting query.');
export function checkedAccountingQuery(raw: AccountingQuery, maxPageSize: number): AccountingQuery {
  const parsed = accountingQuerySchema.safeParse(raw);
  if (!parsed.success || parsed.data.limit > maxPageSize) throw badQuery();
  return parsed.data;
}
const cursorSchema = z.object({ kind: z.enum(['accounting-records', 'accounting-totals']), start: z.string(), end: z.string(),
  userId: idSchema.nullable(), byUser: z.boolean(), value: z.string().min(1).max(128), id: z.string().min(1).max(128) }).strict();
function after(q: AccountingQuery, kind: z.infer<typeof cursorSchema>['kind']) {
  if (!q.cursor) return null;
  try {
    const c = cursorSchema.parse(JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8')));
    if (c.kind !== kind || c.start !== q.start || c.end !== q.end || c.userId !== (q.userId ?? null)
      || c.byUser !== Boolean(q.byUser)) throw badQuery();
    return c;
  } catch { throw badQuery(); }
}
export function accountingCursor(q: AccountingQuery, kind: z.infer<typeof cursorSchema>['kind'], value: string, id: string) {
  return Buffer.from(JSON.stringify({ kind, start: q.start, end: q.end, userId: q.userId ?? null,
    byUser: Boolean(q.byUser), value, id })).toString('base64url');
}
export function accountingRangeFilter(q: AccountingQuery): Filter<StoredDocument> {
  return { kind: { $in: ['accounting', 'voice-accounting'] }, ...(q.userId ? { userId: q.userId } : {}),
    startedAt: { $gte: q.start, $lt: q.end } };
}
export function accountingRecordFilter(q: AccountingQuery): Filter<StoredDocument> {
  if (!q.userId || q.byUser) throw badQuery();
  const c = after(q, 'accounting-records');
  return { ...accountingRangeFilter(q), ...(c ? { $or: [{ startedAt: { $gt: c.value } },
    { startedAt: c.value, _id: { $gt: c.id } }] } : {}) };
}
const text = { $in: ['$kind', ['accounting', 'calendar-model-dispatch']] };
const dispatchKind = { $eq: ['$kind', 'calendar-model-dispatch'] };
const accountingKind = { $eq: ['$kind', 'accounting'] };
const present = (field: string) => ({ $ne: [{ $ifNull: [field, null] }, null] });
const flag = (condition: unknown) => ({ $cond: [condition, 1, 0] });
const decimal = (field: string) => ({ $convert: { input: { $toString: field }, to: 'decimal' } });
const counts = ['requestCount', 'executionAttemptCount', 'operationCount', 'billableOperationCount', 'knownCostCount',
  'pendingCostCount', 'unknownCostCount', 'estimatedCostCount', 'tokenCompleteCount', 'tokenIncompleteCount', 'promptTokens',
  'completionTokens', 'cachedPromptTokens', 'cacheWriteTokens', 'reasoningOutputTokens', 'breakdownIncompleteCount',
  'observedAudioMs', 'billableCharacters', 'voiceUnitsIncompleteCount', 'dispatchCount', 'dispatchIncompleteCount',
  'unobservedDispatchBillingCount',
  'failedCount', 'cancelledCount', 'interruptedCount', 'truncatedCount'] as const;

export function accountingTotalsPipeline(q: AccountingQuery): Document[] {
  q = checkedAccountingQuery(q, 50);
  const c = after(q, 'accounting-totals');
  if (c && !q.byUser) throw badQuery();
  const reported = { $cond: [present('$money'), '$money.reportedAmount', { $cond: [text, decimal('$cost'), null] }] };
  const estimated = { $cond: [present('$money'), '$money.estimatedAmount',
    { $cond: [text, null, decimal('$estimatedCostUsd')] }] };
  const completeTokens = { $and: [present('$promptTokens'), present('$completionTokens')] };
  const projection: Document = { userId: 1, sessionId: 1,
    currency: { $ifNull: ['$money.currency', 'USD'] },
    unit: { $cond: [text, 'text-tokens', { $cond: [present('$responseId'), 'voice-characters', 'voice-audio'] }] },
    requestId: { $cond: [text, '$turnId', '$usageId'] },
    attemptKey: { $cond: [text, '$attemptId', '$usageId'] },
    isDispatch: flag(dispatchKind),
    reported, estimated,
    requestCount: flag(text), executionAttemptCount: flag(text),
    operationCount: { $literal: 1 },
    // Billable operation is an attempted provider unit, NOT proof of a positive charge.
    billableOperationCount: flag({ $or: [{ $ne: ['$kind', 'accounting'] }, present('$generationId'), present('$cost'),
      { $gt: [{ $ifNull: ['$timing.dispatchCount', 0] }, 0] }] }),
    knownCostCount: flag(presentReported(reported)),
    pendingCostCount: flag({ $and: [{ $eq: [reported, null] }, { $or: [
      { $eq: ['$money.costStatus', 'pending'] }, { $and: [{ $eq: [{ $ifNull: ['$money', null] }, null] },
        { $or: [{ $eq: ['$accountingStatus', 'pending'] }, { $eq: ['$status', 'pending'] }] }] }] }] }),
    estimatedCostCount: flag(presentReported(estimated)),
    tokenCompleteCount: flag({ $and: [text, completeTokens] }),
    tokenIncompleteCount: flag({ $and: [text, { $eq: [completeTokens, false] }] }),
    breakdownIncompleteCount: flag({ $and: [text, { $or: ['$cachedPromptTokens', '$cacheWriteTokens', '$reasoningOutputTokens']
      .map(f => ({ $eq: [{ $ifNull: [f, null] }, null] })) }] }),
    observedAudioMs: { $cond: [text, 0, { $cond: [present('$responseId'), 0, { $ifNull: ['$observedAudioMs', 0] }] }] },
    billableCharacters: { $cond: [text, 0, { $cond: [present('$responseId'), { $ifNull: ['$billableCharacters', 0] }, 0] }] },
    voiceUnitsIncompleteCount: flag({ $and: [{ $ne: ['$kind', 'accounting'] }, { $cond: [present('$responseId'),
      { $eq: [{ $ifNull: ['$billableCharacters', null] }, null] }, { $literal: true }] }] }),
    dispatchCount: { $cond: [dispatchKind, 1, { $ifNull: ['$timing.dispatchCount', 0] }] },
    dispatchIncompleteCount: flag({ $and: [accountingKind, { $eq: [{ $ifNull: ['$timing.dispatchCount', null] }, null] }] }),
    unobservedDispatchBillingCount: { $cond: [{ $and: [accountingKind, { $gt: [{ $ifNull: ['$timing.dispatchCount', 0] }, 0] }] },
      { $subtract: ['$timing.dispatchCount', flag(presentReported(reported))] }, 0] },
  };
  for (const field of ['promptTokens', 'completionTokens', 'cachedPromptTokens', 'cacheWriteTokens', 'reasoningOutputTokens'])
    projection[field] = { $cond: [text, { $ifNull: [`$${field}`, 0] }, 0] };
  for (const outcome of ['failed', 'cancelled', 'interrupted', 'truncated'])
    projection[`${outcome}Count`] = flag({ $eq: [{ $ifNull: ['$outcome', '$status'] }, outcome] });
  const attemptGroup: Document = {
    _id: { userId: '$userId', sessionId: '$sessionId', requestId: '$requestId', attemptKey: '$attemptKey', unit: '$unit', currency: '$currency' },
    hasDispatch: { $max: '$isDispatch' },
    dispatchReported: { $sum: { $cond: [{ $eq: ['$isDispatch', 1] }, '$reported', null] } },
    otherReported: { $sum: { $cond: [{ $eq: ['$isDispatch', 1] }, null, '$reported'] } },
    dispatchEstimated: { $sum: { $cond: [{ $eq: ['$isDispatch', 1] }, '$estimated', null] } },
    otherEstimated: { $sum: { $cond: [{ $eq: ['$isDispatch', 1] }, null, '$estimated'] } },
    dispatchRows: { $sum: '$isDispatch' },
    dispatchKnown: { $sum: { $cond: [{ $eq: ['$isDispatch', 1] }, '$knownCostCount', 0] } },
    otherKnown: { $sum: { $cond: [{ $eq: ['$isDispatch', 1] }, 0, '$knownCostCount'] } },
    dispatchPending: { $sum: { $cond: [{ $eq: ['$isDispatch', 1] }, '$pendingCostCount', 0] } },
    otherPending: { $sum: { $cond: [{ $eq: ['$isDispatch', 1] }, 0, '$pendingCostCount'] } },
  };
  const attemptPick: Document = {
    userId: '$_id.userId', sessionId: '$_id.sessionId', requestId: '$_id.requestId',
    unit: '$_id.unit', currency: '$_id.currency',
    reported: { $cond: [{ $gt: ['$hasDispatch', 0] }, '$dispatchReported', '$otherReported'] },
    estimated: { $cond: [{ $gt: ['$hasDispatch', 0] }, '$dispatchEstimated', '$otherEstimated'] },
  };
  for (const field of counts) {
    if (field === 'unknownCostCount') continue;
    attemptGroup[field] = { [field === 'requestCount' || field === 'executionAttemptCount' ? '$max' : '$sum']: `$${field}` };
    attemptPick[field] = `$${field}`;
  }
  attemptPick.dispatchCount = { $cond: [{ $gt: ['$hasDispatch', 0] }, '$dispatchRows', '$dispatchCount'] };
  attemptPick.operationCount = { $cond: [{ $gt: ['$hasDispatch', 0] }, '$dispatchRows', '$operationCount'] };
  attemptPick.billableOperationCount = { $cond: [{ $gt: ['$hasDispatch', 0] }, '$dispatchRows', '$billableOperationCount'] };
  attemptPick.knownCostCount = { $cond: [{ $gt: ['$hasDispatch', 0] }, '$dispatchKnown', '$otherKnown'] };
  attemptPick.pendingCostCount = { $cond: [{ $gt: ['$hasDispatch', 0] }, '$dispatchPending', '$otherPending'] };
  attemptPick.dispatchIncompleteCount = { $cond: [{ $gt: ['$hasDispatch', 0] }, 0, '$dispatchIncompleteCount'] };
  attemptPick.unobservedDispatchBillingCount = { $cond: [{ $gt: ['$hasDispatch', 0] }, 0, '$unobservedDispatchBillingCount'] };
  const requestGroup: Document = { _id: { userId: '$userId', sessionId: '$sessionId', requestId: '$requestId', unit: '$unit', currency: '$currency' },
    reported: { $sum: '$reported' }, estimated: { $sum: '$estimated' } };
  const totalsGroup: Document = { _id: { userId: q.byUser ? '$_id.userId' : { $literal: q.userId ?? null },
    currency: '$_id.currency', unit: '$_id.unit' }, reported: { $sum: '$reported' }, estimated: { $sum: '$estimated' } };
  for (const field of counts) {
    if (field === 'unknownCostCount') continue;
    requestGroup[field] = { [field === 'requestCount' ? '$max' : '$sum']: `$${field}` };
    totalsGroup[field] = { $sum: `$${field}` };
  }
  const rows: Document[] = [{ $project: projection }, { $group: attemptGroup }, { $project: attemptPick },
    { $group: requestGroup }, { $group: totalsGroup }];
  if (c) rows.push({ $match: { $or: [{ '_id.userId': { $gt: c.value } }, { '_id.userId': c.value, '_id.unit': { $gt: c.id } }] } });
  rows.push({ $sort: { '_id.userId': 1, '_id.unit': 1 } }, { $limit: q.limit + 1 });
  // ponytail: legacy socket classification covers the three admitted TTS models; new models need an explicit versioned unit discriminator first.
  const pipeline = [{ $match: { ...(q.userId ? { userId: q.userId } : {}),
    startedAt: { $gte: q.start, $lt: q.end },
    $or: [{ kind: 'accounting' },
    { kind: 'voice-accounting', $or: [{ responseId: { $ne: null } },
      { model: { $nin: ['flux-haley-en', 'flux-alexis-en', 'flux-priya-en'] } }] },
    { kind: 'calendar-model-dispatch', status: { $in: ['dispatched', 'terminal'] } }] } },
    { $limit: MAX_ACCOUNTING_REPORT_RECORDS + 1 }, { $facet: { input: [{ $count: 'count' }], rows } }];
  freeze(pipeline); admitted.add(pipeline); return pipeline;
}
function presentReported(value: unknown) { return { $ne: [value, null] }; }
export async function readAccountingTotals(store: RecordStore, q: AccountingQuery) {
  const pipeline = accountingTotalsPipeline(q);
  let result: Document[];
  try { result = await store.collection('metadata').aggregate(pipeline, { ...store.options(), allowDiskUse: false }).toArray(); }
  catch { throw new AppError('PERSISTENCE_ERROR', 'Accounting report could not be read.'); }
  const data = result[0];
  if (!data || !Array.isArray(data.input) || !Array.isArray(data.rows) || data.rows.length > q.limit + 1)
    throw new AppError('PERSISTENCE_ERROR', 'Accounting report is invalid.');
  if ((data.input[0]?.count ?? 0) > MAX_ACCOUNTING_REPORT_RECORDS)
    throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Narrow the accounting reporting range.');
  if (!q.byUser && data.rows.length > q.limit)
    throw new AppError('INVALID_REQUEST', 'Increase the accounting totals page size.');
  const items: AccountingTotals[] = data.rows.slice(0, q.limit).map((row: Document) => {
    const countValues = Object.fromEntries(counts.filter(k => k !== 'unknownCostCount').map(k => {
      const v: unknown = row[k]; if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
        throw new AppError('PERSISTENCE_ERROR', 'Accounting report counts exceeded their bounds.'); return [k, v];
    })) as Omit<AccountingTotals, 'userId' | 'unit' | 'currency' | 'reportedTotal' | 'estimatedTotal' | 'spendComplete' | 'unknownCostCount'>;
    const amount = (value: unknown, observed: number) => {
      if (!observed) return null;
      if (!(value instanceof Decimal128)) throw new AppError('PERSISTENCE_ERROR', 'Accounting monetary report is invalid.');
      return canonicalDecimal(value.toString());
    };
    return { ...countValues, userId: row._id.userId as string | null, currency: row._id.currency as 'USD',
      unit: row._id.unit as AccountingTotals['unit'],
      reportedTotal: amount(row.reported, row.knownCostCount), estimatedTotal: amount(row.estimated, row.estimatedCostCount),
      unknownCostCount: row.operationCount - row.knownCostCount - row.pendingCostCount,
      spendComplete: row.knownCostCount === row.operationCount && row.dispatchIncompleteCount === 0
        && row.unobservedDispatchBillingCount === 0 };
  });
  const last = items.at(-1);
  return { items, nextCursor: data.rows.length > q.limit && last && q.byUser
    ? accountingCursor(q, 'accounting-totals', last.userId!, last.unit) : null };
}
