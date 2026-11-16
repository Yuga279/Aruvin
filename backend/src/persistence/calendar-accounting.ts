/**
 * ============================================================================
 * FILE: calendar-accounting.ts
 * LOCATION: backend/src/persistence/calendar-accounting.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Persistence adapter for calendar turn budgets, model dispatches, and aggregates.
 *
 * ROLE IN PROJECT:
 *    Enforces finite model dispatch and repair limits, spend caps, and exact Decimal128
 *    reservations across v1 and v2 multi-calendar operations.
 *
 * KEY COMPONENTS:
 *    - MongoCalendarAccounting: Stores budgets, dispatches, and aggregates with .v2 facade.
 *    - debit / getDebit: Durable idempotent logical-tool and create debits.
 *    - debit limit check: Runs before the persisted parse, so an over-budget debit
 *      raises the budget error instead of a schema error.
 *    - ensureClaim / recomputeBudgetMoney: Atomically manages dispatch claims and budget money.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import type { BudgetConfig } from '../contracts/budgets.js';
import {
  CALENDAR_DEBIT_EFFECT,
  calendarBudgetDebitEntrySchema,
  calendarBudgetDebitRequestSchema,
  calendarBudgetDebitSchema,
  modelAggregateSchema,
  modelDispatchSchema,
  modelDispatchV2Schema,
  preferredAttemptAccounting,
  sumUsd,
  turnBudgetRecordSchema,
  withinSpendCap,
  type CalendarAccountingStore,
  type CalendarAccountingStoreV2,
  type CalendarBudgetDebit,
  type CalendarBudgetDebitEntry,
  type CalendarBudgetDebitOutcome,
  type CalendarBudgetDebitRequest,
  type CalendarDispatchSave,
  type CalendarModelAggregate,
  type CalendarModelDispatch,
  type CalendarModelDispatchV2,
  type CalendarTurnBudget,
  type ConfirmedBudget,
  type ConfirmedDispatch,
} from '../contracts/calendar-accounting.js';
import { compatibleCalendarDispatchSchema } from '../contracts/calendar-compatibility.js';
import { accountingRecordSchema } from '../contracts/metadata.js';
import { CALENDAR_LIMITS, calendarLimitsSchema, type CalendarLimits } from '../contracts/calendar-policy.js';
import { AppError } from '../platform/errors/app-error.js';
import {
  inspectConfirmedRecord,
  issueConfirmedRecord,
  type CasConfirmation,
} from './confirmed-record.js';
import {
  aggregateKey,
  budgetKey,
  calendarClaimsSchema,
  confirmCalendarRecord,
  decodeCalendar,
  dispatchKey,
  encodeCalendar,
} from './calendar-records.js';
import { decodeAccountingMoney } from './accounting-codec.js';
import { key, type StoredDocument } from './records.js';
import { RecordStore } from './store.js';

type AnyCalendarModelDispatch = CalendarModelDispatch | CalendarModelDispatchV2;

const debitKey = (userId: string, sessionId: string, turnId: string, debitId: string): string =>
  key('calendar-budget-debit', userId, sessionId, turnId, debitId);

type DebitScope = { userId: string; sessionId: string; turnId: string };
type DebitEffect = {
  logicalTools: number; creates: number; calendarRequests: number; refreshRequests: number;
};
type NormalizedDebit = {
  scope: DebitScope; debitId: string; kindOfDebit: 'logical-tool' | 'create';
  decisionId: string | null; intentId: string | null; effect: DebitEffect; clock: () => number;
};

function sameDebitPayload(entry: CalendarBudgetDebitEntry, request: NormalizedDebit): boolean {
  return entry.kindOfDebit === request.kindOfDebit
    && entry.decisionId === request.decisionId && entry.intentId === request.intentId
    && entry.logicalTools === request.effect.logicalTools && entry.creates === request.effect.creates
    && entry.calendarRequests === request.effect.calendarRequests
    && entry.refreshRequests === request.effect.refreshRequests;
}

function dispatchFingerprint(record: AnyCalendarModelDispatch): string {
  return key(
    'calendar-dispatch-claim',
    record.userId, record.sessionId, record.turnId, record.attemptId, record.dispatchId,
    record.dispatchIndex, record.reason, record.repairedDecisionId ?? '',
    record.requestedModel, record.openRouterUser, record.connectionId,
    record.connectionRevision, record.configRevision, record.schemaRevision,
    record.startedAt, record.pricing.version, record.pricing.modelId, record.pricing.providerRoute,
    record.pricing.promptUsdPerToken, record.pricing.completionUsdPerToken, record.pricing.requestUsd,
    record.reservationUsd,
  );
}

function immutableDispatch(record: AnyCalendarModelDispatch) {
  return {
    schemaVersion: record.schemaVersion,
    userId: record.userId, sessionId: record.sessionId, turnId: record.turnId, attemptId: record.attemptId,
    dispatchId: record.dispatchId, decisionId: record.decisionId, dispatchIndex: record.dispatchIndex,
    reason: record.reason, repairedDecisionId: record.repairedDecisionId, requestedModel: record.requestedModel,
    openRouterUser: record.openRouterUser, configRevision: record.configRevision, connectionId: record.connectionId,
    connectionRevision: record.connectionRevision, schemaRevision: record.schemaRevision,
    startedAt: record.startedAt, pricing: record.pricing, reservationUsd: record.reservationUsd,
  };
}

export class MongoCalendarAccounting implements CalendarAccountingStore {
  readonly limits: CalendarLimits;
  readonly v2: CalendarAccountingStoreV2;

  constructor(
    readonly store: RecordStore,
    readonly budgets: BudgetConfig,
    limits: CalendarLimits = CALENDAR_LIMITS,
    readonly clock: () => number = Date.now,
  ) {
    this.limits = calendarLimitsSchema.parse(limits);
    this.v2 = {
      getBudget: (userId, sessionId, turnId) => this.getBudget(userId, sessionId, turnId),
      createBudget: (record) => this.createBudget(record),
      compareAndSwapBudget: (expectedRevision, next) => this.compareAndSwapBudget(expectedRevision, next),
      putDispatch: async (record) => {
        const value = modelDispatchV2Schema.parse(record);
        await this.putDispatchVersioned(value);
      },
      getDispatch: (userId, dispatchId) => this.getDispatchCompatible(userId, dispatchId),
      listDispatches: (userId, turnId) => this.listDispatchesCompatible(userId, turnId),
      putAggregate: (record) => this.putAggregate(record),
      debit: (request) => this.debit(request),
      getDebit: (userId, sessionId, turnId, debitId) => this.getDebit(userId, sessionId, turnId, debitId),
      getBudgetConfirmed: (userId, sessionId, turnId) => this.getBudgetConfirmed(userId, sessionId, turnId),
      createBudgetConfirmed: (record) => this.createBudgetConfirmed(record),
      getDispatchConfirmed: (userId, dispatchId) => this.getDispatchConfirmed(userId, dispatchId),
      reserveDispatchConfirmed: (record, budget) => this.reserveDispatchConfirmed(record, budget),
      updateDispatchConfirmed: (expectedDispatch, next, expectedBudget) =>
        this.updateDispatchConfirmed(expectedDispatch, next, expectedBudget),
      compareBudgetConfirmed: (expectedBudget, next) =>
        this.compareBudgetConfirmed(expectedBudget, next),
    };
  }

  private issueBudgetReceipt(raw: StoredDocument, record: CalendarTurnBudget): ConfirmedBudget {
    return issueConfirmedRecord({
      store: this.store,
      collection: 'metadata',
      id: raw._id,
      revision: raw._revision,
      record,
      encoded: raw,
    });
  }

  private inspectBudgetReceipt(
    receipt: ConfirmedBudget,
    userId: string,
    sessionId: string,
    turnId: string,
  ): NonNullable<Awaited<ReturnType<MongoCalendarAccounting['readBudget']>>> {
    const id = budgetKey(userId, sessionId, turnId);
    const env = inspectConfirmedRecord<CalendarTurnBudget>(receipt, {
      store: this.store,
      collection: 'metadata',
      id,
    });
    const decoded = decodeAccountingMoney(env.encoded);
    return {
      raw: env.encoded,
      record: env.canonical as CalendarTurnBudget,
      claims: calendarClaimsSchema.parse(decoded._calendarClaims ?? []),
    };
  }

  async getBudgetConfirmed(
    userId: string,
    sessionId: string,
    turnId: string,
  ): Promise<ConfirmedBudget | null> {
    const env = await this.readBudget(userId, sessionId, turnId);
    if (!env) return null;
    return this.issueBudgetReceipt(env.raw, env.record);
  }

  async getBudget(userId: string, sessionId: string, turnId: string): Promise<CalendarTurnBudget | null> {
    const raw = await this.store.raw('metadata', {
      _id: budgetKey(userId, sessionId, turnId), userId, sessionId, turnId, kind: 'calendar-turn-budget',
    });
    return decodeCalendar(turnBudgetRecordSchema, raw);
  }

  async createBudgetConfirmed(record: CalendarTurnBudget): Promise<ConfirmedBudget> {
    const value = turnBudgetRecordSchema.parse(record);
    if (value.modelDispatches !== 0 || value.repairs !== 0 || value.logicalTools !== 0
      || value.creates !== 0 || value.calendarRequests !== 0 || value.refreshRequests !== 0
      || value.settledUsd !== '0' || value.reservedUsd !== '0' || value.revision !== 1) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const id = budgetKey(value.userId, value.sessionId, value.turnId);
    const { record: encoded, doc } = encodeCalendar(
      turnBudgetRecordSchema, value, id, this.budgets.maxDocumentBytes, { _calendarClaims: [] },
    );
    try {
      const result = await this.store.collection('metadata').updateOne(
        { _id: id, userId: value.userId, sessionId: value.sessionId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
      if (result.acknowledged && result.upsertedCount === 1) {
        return this.issueBudgetReceipt(doc, encoded);
      }
    } catch { /* confirm */ }
    const saved = await this.getBudgetConfirmed(value.userId, value.sessionId, value.turnId);
    if (saved) return saved;
    throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.');
  }

  async createBudget(record: CalendarTurnBudget): Promise<CalendarTurnBudget> {
    return (await this.createBudgetConfirmed(record)).record as CalendarTurnBudget;
  }

  async compareBudgetConfirmed(
    expectedBudget: ConfirmedBudget,
    next: CalendarTurnBudget,
  ): Promise<CasConfirmation<CalendarTurnBudget>> {
    const value = turnBudgetRecordSchema.parse(next);
    const envelope = this.inspectBudgetReceipt(
      expectedBudget,
      value.userId,
      value.sessionId,
      value.turnId,
    );
    return this.casBudgetEnvelopeConfirmed(envelope.record.revision, value, envelope);
  }

  async compareAndSwapBudget(
    expectedRevision: number, next: CalendarTurnBudget,
  ): Promise<'confirmed' | 'conflict' | 'uncertain'> {
    const value = turnBudgetRecordSchema.parse(next);
    const envelope = await this.readBudget(value.userId, value.sessionId, value.turnId);
    return this.casBudgetEnvelope(expectedRevision, value, envelope);
  }

  private async casBudgetEnvelopeConfirmed(
    expectedRevision: number,
    value: CalendarTurnBudget,
    envelope: Awaited<ReturnType<MongoCalendarAccounting['readBudget']>>,
  ): Promise<CasConfirmation<CalendarTurnBudget>> {
    if (!envelope) return { outcome: 'uncertain' };
    if (isDeepStrictEqual(envelope.record, value)) {
      return { outcome: 'confirmed', receipt: this.issueBudgetReceipt(envelope.raw, envelope.record) };
    }
    if (envelope.record.revision !== expectedRevision) return { outcome: 'conflict' };
    if (value.revision !== expectedRevision + 1
      || value.modelDispatches !== envelope.record.modelDispatches
      || value.repairs !== envelope.record.repairs
      || value.settledUsd !== envelope.record.settledUsd
      || value.reservedUsd !== envelope.record.reservedUsd
      || value.createdAt !== envelope.record.createdAt
      || value.deadlineAt !== envelope.record.deadlineAt
      || value.userId !== envelope.record.userId
      || value.sessionId !== envelope.record.sessionId
      || value.turnId !== envelope.record.turnId
      || value.logicalTools < envelope.record.logicalTools
      || value.creates < envelope.record.creates
      || value.calendarRequests < envelope.record.calendarRequests
      || value.refreshRequests < envelope.record.refreshRequests
      || value.logicalTools > this.limits.logicalTools
      || value.creates > this.limits.creates
      || value.calendarRequests > this.limits.calendarRequests
      || value.refreshRequests > this.limits.refreshRequests) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const { record, doc } = encodeCalendar(
      turnBudgetRecordSchema, value, envelope.raw._id, this.budgets.maxDocumentBytes,
      { _calendarClaims: envelope.claims },
    );
    doc._revision = envelope.raw._revision + 1;
    let failed = false;
    try {
      const result = await this.store.collection('metadata').replaceOne(
        {
          _id: envelope.raw._id, userId: value.userId, sessionId: value.sessionId, turnId: value.turnId,
          kind: 'calendar-turn-budget', revision: expectedRevision, _revision: envelope.raw._revision,
        },
        doc,
        this.store.options(),
      );
      if (result.acknowledged === true && result.matchedCount === 1) {
        return { outcome: 'confirmed', receipt: this.issueBudgetReceipt(doc, record) };
      }
    } catch {
      failed = true;
    }
    let reread: Awaited<ReturnType<MongoCalendarAccounting['readBudget']>> = null;
    try {
      reread = await this.readBudget(value.userId, value.sessionId, value.turnId);
    } catch {
      return { outcome: 'uncertain' };
    }
    if (!reread) return { outcome: failed ? 'uncertain' : 'conflict' };
    if (reread.raw._revision === doc._revision && isDeepStrictEqual(reread.record, record)) {
      return { outcome: 'confirmed', receipt: this.issueBudgetReceipt(reread.raw, reread.record) };
    }
    const confirmed = await confirmCalendarRecord(
      async () => reread.record, record, (row) => row.revision,
    );
    return { outcome: confirmed.outcome === 'confirmed' ? 'conflict' : confirmed.outcome };
  }

  private async casBudgetEnvelope(
    expectedRevision: number,
    value: CalendarTurnBudget,
    envelope: Awaited<ReturnType<MongoCalendarAccounting['readBudget']>>,
  ): Promise<'confirmed' | 'conflict' | 'uncertain'> {
    const res = await this.casBudgetEnvelopeConfirmed(expectedRevision, value, envelope);
    return res.outcome;
  }

  async debit(request: CalendarBudgetDebitRequest): Promise<CalendarBudgetDebitOutcome> {
    const debit = this.normalizeDebit(request);
    // A receipt is only a CAS expectation, never a current-state assertion.
    // Duplicates still read current counters and repair their separate record.
    const expected = request.expectedBudget ? this.inspectBudgetReceipt(request.expectedBudget,
      debit.scope.userId, debit.scope.sessionId, debit.scope.turnId) : null;
    // ponytail: three CAS rounds; the turn budget only moves under one executor, so a
    // fourth attempt would mean concurrent writers rather than a transient conflict.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const envelope = attempt === 0 && expected
        && !(expected.record.debits ?? []).some(entry => entry.debitId === debit.debitId)
        ? expected : await this.readBudget(debit.scope.userId, debit.scope.sessionId, debit.scope.turnId);
      const current = envelope?.record ?? null;
      if (!current || !envelope) throw new AppError('NOT_READY', 'Calendar budget is unavailable.');
      const applied = (current.debits ?? []).find(entry => entry.debitId === debit.debitId);
      if (applied) {
        if (!sameDebitPayload(applied, debit)) return { outcome: 'conflict' };
        return { outcome: 'duplicate', debit: await this.writeDebitRecord(debit.scope, applied), budget: current,
          budgetReceipt: this.issueBudgetReceipt(envelope.raw, current) };
      }
      const budgetRevision = current.revision + 1;
      const entry = this.buildDebitEntry(debit, budgetRevision);
      // The limit check runs before the persisted parse: the record schema caps the
      // counters, so an over-budget debit would otherwise fail with a schema error
      // instead of the budget error the ledger raises for the same limit.
      const counters = {
        logicalTools: current.logicalTools + debit.effect.logicalTools,
        creates: current.creates + debit.effect.creates,
        calendarRequests: current.calendarRequests + debit.effect.calendarRequests,
        refreshRequests: current.refreshRequests + debit.effect.refreshRequests,
      };
      if (counters.logicalTools > this.limits.logicalTools || counters.creates > this.limits.creates
        || counters.calendarRequests > this.limits.calendarRequests
        || counters.refreshRequests > this.limits.refreshRequests) {
        throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The Calendar request budget is exhausted.');
      }
      const next = turnBudgetRecordSchema.parse({
        ...current,
        ...counters,
        revision: budgetRevision,
        debits: [...(current.debits ?? []), entry],
      });
      const outcome = await this.casBudgetEnvelopeConfirmed(current.revision, next, envelope);
      if (outcome.outcome === 'confirmed') {
        return { outcome: 'confirmed', debit: await this.writeDebitRecord(debit.scope, entry),
          budget: outcome.receipt.record, budgetReceipt: outcome.receipt };
      }
      const receipt = await this.getBudgetConfirmed(debit.scope.userId, debit.scope.sessionId, debit.scope.turnId);
      const reread = receipt?.record;
      const landed = (reread?.debits ?? []).find(item => item.debitId === debit.debitId);
      if (landed && reread && receipt) {
        if (!sameDebitPayload(landed, debit)) return { outcome: 'conflict' };
        return { outcome: 'confirmed', debit: await this.writeDebitRecord(debit.scope, landed), budget: reread,
          budgetReceipt: receipt };
      }
    }
    throw new AppError('PERSISTENCE_ERROR', 'Calendar accounting could not be confirmed.', false);
  }

  async getDebit(
    userId: string, sessionId: string, turnId: string, debitId: string,
  ): Promise<CalendarBudgetDebit | null> {
    const current = await this.getBudget(userId, sessionId, turnId);
    const applied = (current?.debits ?? []).find(entry => entry.debitId === debitId);
    if (applied) return this.writeDebitRecord({ userId, sessionId, turnId }, applied);
    return decodeCalendar(calendarBudgetDebitSchema, await this.store.raw('metadata', {
      _id: debitKey(userId, sessionId, turnId, debitId), userId, sessionId, turnId,
      kind: 'calendar-budget-debit',
    }));
  }

  private normalizeDebit(request: CalendarBudgetDebitRequest): NormalizedDebit {
    const kind = request.kindOfDebit === 'create' ? 'create'
      : request.kindOfDebit === 'logical-tool' ? 'logical-tool' : null;
    if (!kind) throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    const parsed = calendarBudgetDebitRequestSchema.safeParse({
      userId: request.userId, sessionId: request.sessionId, turnId: request.turnId,
      debitId: request.debitId, kindOfDebit: kind,
      decisionId: request.decisionId ?? null, intentId: request.intentId ?? null,
      change: request.change ?? CALENDAR_DEBIT_EFFECT[kind],
    });
    if (!parsed.success) throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    const value = parsed.data;
    return {
      scope: { userId: value.userId, sessionId: value.sessionId, turnId: value.turnId },
      debitId: value.debitId, kindOfDebit: value.kindOfDebit,
      decisionId: value.decisionId, intentId: value.intentId,
      effect: {
        logicalTools: value.change.logicalTools, creates: value.change.creates,
        calendarRequests: value.change.calendarRequests, refreshRequests: value.change.refreshRequests,
      },
      clock: request.clock ?? this.clock,
    };
  }

  private buildDebitEntry(debit: NormalizedDebit, budgetRevision: number): CalendarBudgetDebitEntry {
    const entry = calendarBudgetDebitEntrySchema.safeParse({
      debitId: debit.debitId, kindOfDebit: debit.kindOfDebit,
      decisionId: debit.decisionId, intentId: debit.intentId, ...debit.effect,
      budgetRevision, createdAt: new Date(debit.clock()).toISOString(),
    });
    if (!entry.success) throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    return entry.data;
  }

  private async writeDebitRecord(scope: DebitScope, entry: CalendarBudgetDebitEntry): Promise<CalendarBudgetDebit> {
    const parsed = calendarBudgetDebitSchema.safeParse({
      schemaVersion: 2, kind: 'calendar-budget-debit', ...scope, ...entry,
    });
    if (!parsed.success) throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    const record = parsed.data;
    const id = debitKey(scope.userId, scope.sessionId, scope.turnId, entry.debitId);
    const { record: encoded, doc } = encodeCalendar(calendarBudgetDebitSchema, record, id, this.budgets.maxDocumentBytes);
    try {
      const result = await this.store.collection('metadata').updateOne(
        { _id: id, userId: scope.userId, sessionId: scope.sessionId, turnId: scope.turnId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
      if (result.acknowledged && result.upsertedCount === 1) return encoded;
    } catch { /* confirm */ }
    const saved = decodeCalendar(calendarBudgetDebitSchema, await this.store.raw('metadata', {
      _id: id, userId: scope.userId, sessionId: scope.sessionId, turnId: scope.turnId,
    }));
    if (!saved) throw new AppError('PERSISTENCE_ERROR', 'The save could not be confirmed.');
    if (!isDeepStrictEqual(saved, record)) {
      throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
    }
    return saved;
  }

  async putDispatch(record: CalendarModelDispatch): Promise<void> {
    const value = modelDispatchSchema.parse(record);
    await this.putDispatchVersioned(value);
  }

  private async putDispatchVersioned(value: AnyCalendarModelDispatch): Promise<void> {
    const writeSchema = value.schemaVersion === 2 ? modelDispatchV2Schema : modelDispatchSchema;
    const id = dispatchKey(value.userId, value.turnId, value.dispatchIndex);
    const existingRaw = await this.store.raw('metadata', { _id: id, userId: value.userId });
    const existing = decodeCalendar(compatibleCalendarDispatchSchema, existingRaw);
    if (!existing) {
      if (value.status !== 'reserved' || value.reservationStatus !== 'held') {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
      await this.reserveDispatch(value, id);
      return;
    }
    if (isDeepStrictEqual(existing, value)) return;
    this.assertDispatchEvolution(existing, value);
    const { record: next, doc } = encodeCalendar(
      writeSchema, value, id, this.budgets.maxDocumentBytes,
    );
    doc._revision = (existingRaw?._revision ?? 0) + 1;
    const replaced = await this.store.collection('metadata').replaceOne(
      { _id: id, userId: value.userId, dispatchId: existing.dispatchId, _revision: existingRaw?._revision },
      doc,
      this.store.options(),
    );
    if (replaced.matchedCount !== 1 && !isDeepStrictEqual(await this.getDispatchCompatible(value.userId, value.dispatchId), next)) {
      throw new AppError('PERSISTENCE_ERROR', 'The save could not be confirmed.');
    }
    if (existing.reservationStatus !== next.reservationStatus
      || existing.money.reportedAmount !== next.money.reportedAmount) {
      await this.recomputeBudgetMoney(value.userId, value.sessionId, value.turnId, next);
    }
  }

  async getDispatchConfirmed(userId: string, dispatchId: string): Promise<ConfirmedDispatch | null> {
    const raw = await this.store.collection('metadata').findOne({
      kind: 'calendar-model-dispatch', userId, dispatchId,
    }, this.store.options());
    const decoded = decodeCalendar(compatibleCalendarDispatchSchema, raw);
    if (!raw || !decoded || decoded.schemaVersion !== 2) return null;
    return issueConfirmedRecord({
      store: this.store,
      collection: 'metadata',
      id: raw._id,
      revision: raw._revision,
      record: decoded,
      encoded: raw,
    });
  }

  async getDispatch(userId: string, dispatchId: string): Promise<CalendarModelDispatch | null> {
    const item = await this.getDispatchCompatible(userId, dispatchId);
    if (!item || item.schemaVersion !== 1) return null;
    return item;
  }

  private async getDispatchCompatible(userId: string, dispatchId: string): Promise<AnyCalendarModelDispatch | null> {
    const raw = await this.store.collection('metadata').findOne({
      kind: 'calendar-model-dispatch', userId, dispatchId,
    }, this.store.options());
    return decodeCalendar(compatibleCalendarDispatchSchema, raw);
  }

  async listDispatches(userId: string, turnId: string): Promise<CalendarModelDispatch[]> {
    const items = await this.listDispatchesCompatible(userId, turnId);
    return items.filter((item): item is CalendarModelDispatch => item.schemaVersion === 1);
  }

  private async listDispatchesCompatible(userId: string, turnId: string): Promise<AnyCalendarModelDispatch[]> {
    const docs = await this.store.collection('metadata').find({
      kind: 'calendar-model-dispatch', userId, turnId,
    }, this.store.options()).sort({ dispatchIndex: 1 }).limit(9).toArray();
    if (docs.length > 8) throw new AppError('PERSISTENCE_ERROR', 'Saved chat data is unavailable.');
    const items = docs.map((doc) => decodeCalendar(compatibleCalendarDispatchSchema, doc)!);
    if (new Set(items.map((item) => item.sessionId)).size > 1
      || new Set(items.map((item) => item.dispatchId)).size !== items.length) {
      throw new AppError('PERSISTENCE_ERROR', 'Saved chat data is unavailable.');
    }
    return items;
  }

  async listAttemptAccounting(userId: string, sessionId: string, turnId: string, attemptId: string) {
    const dispatches = (await this.listDispatchesCompatible(userId, turnId))
      .filter((item) => item.attemptId === attemptId);
    const aggregate = decodeCalendar(modelAggregateSchema, await this.store.raw('metadata', {
      _id: aggregateKey(userId, sessionId, turnId, attemptId),
      kind: 'calendar-model-aggregate', userId, sessionId, turnId, attemptId,
    }));
    const legacy = await this.store.read('metadata', accountingRecordSchema, {
      kind: 'accounting', userId, sessionId, turnId, attemptId,
    });
    return {
      dispatches, aggregate, legacy,
      preferred: preferredAttemptAccounting(legacy, aggregate),
    };
  }

  async putAggregate(record: CalendarModelAggregate): Promise<void> {
    const value = modelAggregateSchema.parse(record);
    const dispatches = (await this.listDispatchesCompatible(value.userId, value.turnId))
      .filter((item) => item.attemptId === value.attemptId);
    if (!isDeepStrictEqual(dispatches.map((item) => item.dispatchId), value.dispatchIds)) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    await this.store.insert(
      'metadata', modelAggregateSchema, value,
      aggregateKey(value.userId, value.sessionId, value.turnId, value.attemptId),
      this.budgets.maxDocumentBytes,
    );
  }

  async reconcileReservations(userId: string, sessionId: string, turnId: string): Promise<void> {
    // ponytail: eight persisted claims per accepted turn; expanding the dispatch ceiling requires a versioned accounting protocol.
    const envelope = await this.readBudget(userId, sessionId, turnId);
    if (!envelope) return;
    const drafts = await this.listDispatchesCompatible(userId, turnId);
    if (drafts.length > 8 || envelope.claims.length > 8) {
      throw new AppError('PERSISTENCE_ERROR', 'Saved chat data is unavailable.');
    }
    for (const draft of drafts) {
      const claimed = envelope.claims.find((claim) => claim.dispatchId === draft.dispatchId);
      if (!claimed && draft.status === 'reserved') {
        await this.claimDraft(envelope, draft);
      }
    }
  }

  async reserveDispatchConfirmed(
    record: CalendarModelDispatchV2,
    expectedBudget: ConfirmedBudget,
  ): Promise<CalendarDispatchSave> {
    const value = modelDispatchV2Schema.parse(record);
    if (value.status !== 'reserved' || value.reservationStatus !== 'held') {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const budgetEnv = this.inspectBudgetReceipt(
      expectedBudget,
      value.userId,
      value.sessionId,
      value.turnId,
    );
    const id = dispatchKey(value.userId, value.turnId, value.dispatchIndex);
    const { record: encoded, doc } = encodeCalendar(
      modelDispatchV2Schema, value, id, this.budgets.maxDocumentBytes,
    );
    let dispatchReceipt: ConfirmedDispatch | null = null;
    let failed = false;
    try {
      const result = await this.store.collection('metadata').updateOne(
        { _id: id, userId: value.userId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
      if (result.acknowledged && result.upsertedCount === 1) {
        dispatchReceipt = issueConfirmedRecord({
          store: this.store,
          collection: 'metadata',
          id,
          revision: 0,
          record: encoded,
          encoded: doc,
        });
      }
    } catch {
      failed = true;
    }
    if (!dispatchReceipt) {
      const savedRaw = await this.store.raw('metadata', { _id: id, userId: value.userId });
      const saved = decodeCalendar(compatibleCalendarDispatchSchema, savedRaw);
      if (!saved || !savedRaw) {
        throw new AppError('PERSISTENCE_ERROR', failed ? 'The save could not be confirmed.' : 'The save could not be confirmed.');
      }
      if (
        saved.schemaVersion !== 2 ||
        (failed ? !isDeepStrictEqual(saved, encoded) : !isDeepStrictEqual(immutableDispatch(saved), immutableDispatch(encoded)))
      ) {
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
      }
      dispatchReceipt = issueConfirmedRecord({
        store: this.store,
        collection: 'metadata',
        id: savedRaw._id,
        revision: savedRaw._revision,
        record: saved,
        encoded: savedRaw,
      });
    }
    const budgetReceipt = await this.ensureClaimConfirmed(value, budgetEnv, expectedBudget);
    return { dispatch: dispatchReceipt, budget: budgetReceipt };
  }

  async updateDispatchConfirmed(
    expectedDispatch: ConfirmedDispatch,
    next: CalendarModelDispatchV2,
    expectedBudget: ConfirmedBudget,
  ): Promise<CalendarDispatchSave> {
    const value = modelDispatchV2Schema.parse(next);
    const id = dispatchKey(value.userId, value.turnId, value.dispatchIndex);
    const dispEnv = inspectConfirmedRecord<CalendarModelDispatchV2>(expectedDispatch, {
      store: this.store,
      collection: 'metadata',
      id,
    });
    const budgetEnv = this.inspectBudgetReceipt(
      expectedBudget,
      value.userId,
      value.sessionId,
      value.turnId,
    );
    const existing = dispEnv.canonical;
    if (isDeepStrictEqual(existing, value)) {
      return { dispatch: expectedDispatch, budget: expectedBudget };
    }
    this.assertDispatchEvolution(existing, value);
    const { record: encodedNext, doc } = encodeCalendar(
      modelDispatchV2Schema, value, id, this.budgets.maxDocumentBytes,
    );
    const nextRevision = dispEnv.revision + 1;
    doc._revision = nextRevision;
    let dispatchReceipt: ConfirmedDispatch | null = null;
    try {
      const replaced = await this.store.collection('metadata').replaceOne(
        { _id: id, userId: value.userId, dispatchId: existing.dispatchId, _revision: dispEnv.revision },
        doc,
        this.store.options(),
      );
      if (replaced.acknowledged === true && replaced.matchedCount === 1) {
        dispatchReceipt = issueConfirmedRecord({
          store: this.store,
          collection: 'metadata',
          id,
          revision: nextRevision,
          record: encodedNext,
          encoded: doc,
        });
      }
    } catch { /* reread */ }
    if (!dispatchReceipt) {
      const savedRaw = await this.store.raw('metadata', { _id: id, userId: value.userId });
      const saved = decodeCalendar(compatibleCalendarDispatchSchema, savedRaw);
      if (
        !savedRaw ||
        !saved ||
        saved.schemaVersion !== 2 ||
        savedRaw._revision !== nextRevision ||
        !isDeepStrictEqual(saved, encodedNext)
      ) {
        throw new AppError('PERSISTENCE_ERROR', 'The save could not be confirmed.');
      }
      dispatchReceipt = issueConfirmedRecord({
        store: this.store,
        collection: 'metadata',
        id: savedRaw._id,
        revision: savedRaw._revision,
        record: saved,
        encoded: savedRaw,
      });
    }
    if (
      existing.reservationStatus !== encodedNext.reservationStatus ||
      existing.money.reportedAmount !== encodedNext.money.reportedAmount
    ) {
      const budgetReceipt = await this.recomputeBudgetMoneyConfirmed(
        value.userId,
        value.sessionId,
        value.turnId,
        encodedNext,
        budgetEnv,
        expectedBudget,
      );
      return { dispatch: dispatchReceipt, budget: budgetReceipt };
    }
    return { dispatch: dispatchReceipt, budget: expectedBudget };
  }

  private async reserveDispatch(value: AnyCalendarModelDispatch, id: string): Promise<void> {
    const writeSchema = value.schemaVersion === 2 ? modelDispatchV2Schema : modelDispatchSchema;
    const { record, doc } = encodeCalendar(writeSchema, value, id, this.budgets.maxDocumentBytes);
    let inserted = false;
    try {
      const result = await this.store.collection('metadata').updateOne(
        { _id: id, userId: value.userId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
      inserted = Boolean(result.acknowledged && result.upsertedCount === 1);
    } catch {
      const saved = decodeCalendar(compatibleCalendarDispatchSchema, await this.store.raw('metadata', { _id: id, userId: value.userId }));
      if (saved && isDeepStrictEqual(saved, record)) {
        await this.ensureClaim(value);
        return;
      }
      if (saved) throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
      throw new AppError('PERSISTENCE_ERROR', 'The save could not be confirmed.');
    }
    if (!inserted) {
      const saved = decodeCalendar(compatibleCalendarDispatchSchema, await this.store.raw('metadata', { _id: id, userId: value.userId }));
      if (!saved) throw new AppError('PERSISTENCE_ERROR', 'The save could not be confirmed.');
      if (!isDeepStrictEqual(immutableDispatch(saved), immutableDispatch(record))) {
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
      }
    }
    await this.ensureClaim(value);
  }

  private async ensureClaim(value: AnyCalendarModelDispatch): Promise<void> {
    const envelope = await this.readBudget(value.userId, value.sessionId, value.turnId);
    if (!envelope) throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    await this.ensureClaimConfirmed(value, envelope);
  }

  private async ensureClaimConfirmed(
    value: AnyCalendarModelDispatch,
    envelope: NonNullable<Awaited<ReturnType<MongoCalendarAccounting['readBudget']>>>,
    priorReceipt?: ConfirmedBudget,
  ): Promise<ConfirmedBudget> {
    const fingerprint = dispatchFingerprint(value);
    const existing = envelope.claims.find((claim) => claim.dispatchId === value.dispatchId);
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.dispatchIndex !== value.dispatchIndex
        || existing.reservationUsd !== value.reservationUsd) {
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
      }
      return priorReceipt ?? this.issueBudgetReceipt(envelope.raw, envelope.record);
    }
    if (Date.parse(envelope.record.deadlineAt) <= this.clock()) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (value.dispatchIndex !== envelope.record.modelDispatches + 1) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const repairs = value.reason === 'schema-repair' ? envelope.record.repairs + 1 : envelope.record.repairs;
    if (envelope.record.modelDispatches + 1 > this.limits.modelDispatches || repairs > this.limits.repairs) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (!withinSpendCap(envelope.record.settledUsd, envelope.record.reservedUsd, value.reservationUsd, this.limits.modelSpendUsd)) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    // ponytail: eight persisted claims per accepted turn; expanding the dispatch ceiling requires a versioned accounting protocol.
    if (envelope.claims.length >= 8) throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    const nextBudget = turnBudgetRecordSchema.parse({
      ...envelope.record,
      revision: envelope.record.revision + 1,
      modelDispatches: envelope.record.modelDispatches + 1,
      repairs,
      reservedUsd: sumUsd([envelope.record.reservedUsd, value.reservationUsd]),
    });
    const claims = calendarClaimsSchema.parse([
      ...envelope.claims,
      { dispatchId: value.dispatchId, dispatchIndex: value.dispatchIndex, fingerprint, reservationUsd: value.reservationUsd },
    ]);
    const { record: encodedNext, doc } = encodeCalendar(
      turnBudgetRecordSchema, nextBudget, envelope.raw._id, this.budgets.maxDocumentBytes, { _calendarClaims: claims },
    );
    doc._revision = envelope.raw._revision + 1;
    try {
      const result = await this.store.collection('metadata').replaceOne(
        {
          _id: envelope.raw._id, userId: value.userId, sessionId: value.sessionId, turnId: value.turnId,
          kind: 'calendar-turn-budget', revision: envelope.record.revision, _revision: envelope.raw._revision,
        },
        doc,
        this.store.options(),
      );
      if (result.acknowledged === true && result.matchedCount === 1) {
        return this.issueBudgetReceipt(doc, encodedNext);
      }
    } catch { /* reread */ }
    const reread = await this.readBudget(value.userId, value.sessionId, value.turnId);
    const claimed = reread?.claims.find((claim) => claim.dispatchId === value.dispatchId);
    if (claimed && claimed.fingerprint === fingerprint && reread) {
      return this.issueBudgetReceipt(reread.raw, reread.record);
    }
    throw new AppError('CONFLICT_ACTIVE_TURN', 'Calendar accounting changed while saving.');
  }

  private async claimDraft(
    envelope: Awaited<ReturnType<MongoCalendarAccounting['readBudget']>> & object,
    draft: AnyCalendarModelDispatch,
  ): Promise<void> {
    if (!envelope) return;
    await this.ensureClaim(draft);
  }

  private assertDispatchEvolution(current: AnyCalendarModelDispatch, next: AnyCalendarModelDispatch): void {
    if (!isDeepStrictEqual(immutableDispatch(current), immutableDispatch(next))) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const allowed =
      (current.status === 'reserved' && (next.status === 'dispatched' || next.status === 'not-dispatched' || next.status === 'reserved'))
      || (current.status === 'dispatched' && (next.status === 'terminal' || next.status === 'dispatched'))
      || (current.status === 'terminal' && next.status === 'terminal')
      || (current.status === 'not-dispatched' && next.status === 'not-dispatched');
    if (!allowed || (current.status !== 'reserved' && next.status === 'not-dispatched')) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (current.status === 'dispatched' || current.status === 'terminal') {
      if (next.status === 'not-dispatched') throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (next.status === 'not-dispatched' && next.reservationStatus !== 'released-not-dispatched') {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    for (const field of ['generationId', 'providerRequestId', 'reportedModel', 'reportedProvider', 'firstOutputAt', 'endedAt'] as const) {
      if (current[field] !== null && next[field] !== current[field]) {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
    }
    for (const tokenField of ['promptTokens', 'completionTokens', 'cachedPromptTokens', 'cacheWriteTokens', 'reasoningOutputTokens'] as const) {
      if (current[tokenField] !== null && (next[tokenField] === null || next[tokenField]! < current[tokenField]!)) {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
    }
    if (current.money.costStatus === 'known' && next.money.costStatus !== 'known') {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (current.money.reportedAmount !== null && next.money.reportedAmount !== current.money.reportedAmount) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
  }

  private async recomputeBudgetMoney(
    userId: string,
    sessionId: string,
    turnId: string,
    updatedDispatch?: AnyCalendarModelDispatch,
  ): Promise<void> {
    const envelope = await this.readBudget(userId, sessionId, turnId);
    if (!envelope) return;
    await this.recomputeBudgetMoneyConfirmed(userId, sessionId, turnId, updatedDispatch, envelope);
  }

  private async recomputeBudgetMoneyConfirmed(
    userId: string,
    sessionId: string,
    turnId: string,
    updatedDispatch: AnyCalendarModelDispatch | undefined,
    envelope: NonNullable<Awaited<ReturnType<MongoCalendarAccounting['readBudget']>>>,
    priorReceipt?: ConfirmedBudget,
  ): Promise<ConfirmedBudget> {
    const dispatches = await this.listDispatchesCompatible(userId, turnId);
    for (const claim of envelope.claims) {
      const matching = dispatches.filter(item => item.dispatchId === claim.dispatchId);
      if (matching.length !== 1 || matching[0].sessionId !== sessionId
        || matching[0].dispatchIndex !== claim.dispatchIndex
        || dispatchFingerprint(matching[0]) !== claim.fingerprint) {
        throw new AppError('PERSISTENCE_ERROR', 'Calendar accounting could not be confirmed.');
      }
    }
    if (updatedDispatch && !dispatches.some(item => isDeepStrictEqual(item, updatedDispatch))) {
      throw new AppError('PERSISTENCE_ERROR', 'Calendar accounting could not be confirmed.');
    }
    let reserved = '0';
    let settled = '0';
    for (const item of dispatches) {
      const claimed = envelope.claims.find((claim) => claim.dispatchId === item.dispatchId);
      if (!claimed) continue;
      if (item.reservationStatus === 'settled' && item.money.reportedAmount) {
        settled = sumUsd([settled, item.money.reportedAmount]);
      } else if (item.reservationStatus === 'held') {
        reserved = sumUsd([reserved, claimed.reservationUsd]);
      }
    }
    if (envelope.record.reservedUsd === reserved && envelope.record.settledUsd === settled) {
      return priorReceipt ?? this.issueBudgetReceipt(envelope.raw, envelope.record);
    }
    const next = turnBudgetRecordSchema.parse({
      ...envelope.record, revision: envelope.record.revision + 1, reservedUsd: reserved, settledUsd: settled,
    });
    const { record: encodedNext, doc } = encodeCalendar(
      turnBudgetRecordSchema, next, envelope.raw._id, this.budgets.maxDocumentBytes, { _calendarClaims: envelope.claims },
    );
    doc._revision = envelope.raw._revision + 1;
    try {
      const result = await this.store.collection('metadata').replaceOne(
        {
          _id: envelope.raw._id, userId, sessionId, turnId,
          kind: 'calendar-turn-budget', revision: envelope.record.revision, _revision: envelope.raw._revision,
        },
        doc,
        this.store.options(),
      );
      if (result.acknowledged === true && result.matchedCount === 1) {
        return this.issueBudgetReceipt(doc, encodedNext);
      }
    } catch { /* reread */ }
    const reread = await this.readBudget(userId, sessionId, turnId);
    if (reread && reread.raw._revision === doc._revision && isDeepStrictEqual(reread.record, encodedNext)) {
      return this.issueBudgetReceipt(reread.raw, reread.record);
    }
    throw new AppError('CONFLICT_ACTIVE_TURN', 'Calendar accounting changed while saving.');
  }

  private async readBudget(userId: string, sessionId: string, turnId: string) {
    const raw = await this.store.raw('metadata', {
      _id: budgetKey(userId, sessionId, turnId), userId, sessionId, turnId, kind: 'calendar-turn-budget',
    });
    if (!raw) return null;
    const decoded = decodeAccountingMoney(raw);
    return {
      raw: raw as StoredDocument,
      record: decodeCalendar(turnBudgetRecordSchema, raw)!,
      claims: calendarClaimsSchema.parse(decoded._calendarClaims ?? []),
    };
  }
}
