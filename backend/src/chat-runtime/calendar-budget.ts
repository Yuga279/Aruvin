/**
 * ============================================================================
 * FILE: calendar-budget.ts
 * LOCATION: backend/src/chat-runtime/calendar-budget.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Manages turn-level calendar budget consumption, model dispatch reservations,
 *    and request accounting across v1 and v2 workflows.
 *
 * ROLE IN PROJECT:
 *    Enforces finite model dispatch/repair/tool limits, spend caps, and exact
 *    Decimal128 reservations using atomic compare-and-swap on metadata records.
 *
 * KEY COMPONENTS:
 *    - CalendarTurnLedger: Serialized turn-level ledger for budgets and dispatches.
 *    - reserveDispatch: Reserves a v2 model dispatch with held USD reservation.
 *    - consume / consumeDebitNow: Counts counters, or applies one durable debit identity.
 *    - chargeCalendarRequest / chargeRefreshRequest: Increments counted requests.
 *    - aggregate: Finalizes model token and cost accounting at turn completion.
 * ============================================================================
 */

import {
  CALENDAR_DEBIT_EFFECT,
  modelAggregateSchema,
  modelDispatchV2Schema,
  reserveUsd,
  sumUsd,
  turnBudgetRecordSchema,
  withinSpendCap,
  type CalendarDebitKind,
  type CalendarModelAggregate,
  type CalendarModelDispatchV2,
  type CalendarTokenPricing,
  type CalendarTurnBudget,
  type ConfirmedBudget,
  type ConfirmedDispatch,
} from '../contracts/calendar-accounting.js';
import { isDeepStrictEqual } from 'node:util';
import type { CalendarDecisionRequest, CalendarDispatchObservation } from '../contracts/calendar-model.js';
import {
  CALENDAR_TOOL_REVISION,
  type CalendarFailure,
  type CalendarLimits,
} from '../contracts/calendar-policy.js';
import type { CalendarRequestKindV2 } from '../contracts/calendar-operations.js';
import { unavailableMoney } from '../contracts/usage-evidence.js';
import type { CalendarDispatchBindingV2, CalendarDispatchHooks } from '../model/calendar-policy.js';
import { createObservationWriter, type ObservationWriter } from '../model/observation-writer.js';
import { key } from '../persistence/records.js';
import { AppError } from '../platform/errors/app-error.js';
import type { CalendarAccountingPort } from './calendar-ports.js';

export type CalendarLedgerIdentity = {
  userId: string;
  sessionId: string;
  turnId: string;
  attemptId: string;
  openRouterUser: string;
  createdAt: string;
  deadlineAt: string;
};

/**
 * Durable debit identity for one logical tool or one create.
 * `debitId` must be stable across retries and restarts: the accepted turn scope
 * plus the model decision id (logical tool) or the intent id (create).
 */
export type CalendarDebitIdentity = {
  debitId: string;
  kindOfDebit: CalendarDebitKind;
  decisionId?: string | null;
  intentId?: string | null;
};

export function calendarDebitId(
  userId: string, sessionId: string, turnId: string,
  kindOfDebit: CalendarDebitKind, identityId: string,
): string {
  return key('calendar-budget-debit', userId, sessionId, turnId, kindOfDebit, identityId);
}

export type CalendarLedgerJob = {
  check(): void;
  wait<T>(promise: Promise<T>, ms?: number): Promise<T>;
  signal: AbortSignal;
  track?<R>(promise: Promise<R>): Promise<R>;
  abort?(code: 'INTERRUPTED'): void;
};

export type CalendarTurnLedgerOptions = {
  accounting: CalendarAccountingPort;
  identity: CalendarLedgerIdentity;
  limits: CalendarLimits;
  write: <T>(action: () => Promise<T>) => Promise<T>;
  clock: () => number;
  modelId: string;
  pricing: CalendarTokenPricing;
  configRevision: number;
  connection: { connectionId: string; connectionRevision: number };
  maxOutputTokens: number;
  processingPolicyId: string;
  job: CalendarLedgerJob;
  fence: () => Promise<boolean>;
  requireCurrent: () => Promise<void>;
};

function canUseBudgetReceipts(store: CalendarAccountingPort): boolean {
  return typeof store.getBudgetConfirmed === 'function'
    && typeof store.createBudgetConfirmed === 'function'
    && typeof store.compareBudgetConfirmed === 'function'
    && (!Object.prototype.hasOwnProperty.call(store, 'compareAndSwapBudget')
      || Object.prototype.hasOwnProperty.call(store, 'compareBudgetConfirmed'))
    && (!Object.prototype.hasOwnProperty.call(store, 'createBudget')
      || Object.prototype.hasOwnProperty.call(store, 'createBudgetConfirmed'));
}

function canUseDispatchReceipts(store: CalendarAccountingPort): boolean {
  return typeof store.getDispatchConfirmed === 'function'
    && typeof store.reserveDispatchConfirmed === 'function'
    && typeof store.updateDispatchConfirmed === 'function'
    && (!Object.prototype.hasOwnProperty.call(store, 'putDispatch')
      || Object.prototype.hasOwnProperty.call(store, 'updateDispatchConfirmed'));
}

async function consumeCounter(
  store: CalendarAccountingPort,
  current: CalendarTurnBudget,
  change: Partial<Pick<CalendarTurnBudget, 'logicalTools' | 'creates' | 'calendarRequests' | 'refreshRequests'>>,
): Promise<CalendarTurnBudget> {
  const next = turnBudgetRecordSchema.parse({ ...current, ...change, revision: current.revision + 1 });
  const outcome = await store.compareAndSwapBudget(current.revision, next);
  if (outcome !== 'confirmed') throw new AppError('PERSISTENCE_ERROR', 'Calendar progress could not be saved.', false);
  return next;
}

function mergeCalendarObservations(
  prev: CalendarDispatchObservation,
  next: CalendarDispatchObservation,
): CalendarDispatchObservation {
  if (prev.generationId && next.generationId && prev.generationId !== next.generationId) {
    throw new AppError('PROVIDER_ERROR', 'The response identity changed.', false);
  }
  if (prev.money?.costStatus === 'known' && next.money?.costStatus === 'known'
    && prev.money.reportedAmount !== null && next.money.reportedAmount !== null
    && prev.money.reportedAmount !== next.money.reportedAmount) {
    throw new AppError('PROVIDER_ERROR', 'Provider accounting evidence disagreed.', false);
  }
  if (prev.promptTokens !== null && next.promptTokens !== null && next.promptTokens < prev.promptTokens) {
    throw new AppError('PROVIDER_ERROR', 'Provider accounting evidence disagreed.', false);
  }
  if (prev.completionTokens !== null && next.completionTokens !== null && next.completionTokens < prev.completionTokens) {
    throw new AppError('PROVIDER_ERROR', 'Provider accounting evidence disagreed.', false);
  }
  const keepKnown = prev.money?.costStatus === 'known' && next.money?.costStatus !== 'known';
  const money = keepKnown ? prev.money : (next.money ?? prev.money);
  return {
    ...prev,
    ...next,
    reportedModel: next.reportedModel ?? prev.reportedModel,
    reportedProvider: next.reportedProvider ?? prev.reportedProvider,
    generationId: next.generationId ?? prev.generationId,
    providerRequestId: next.providerRequestId ?? prev.providerRequestId,
    promptTokens: next.promptTokens ?? prev.promptTokens,
    completionTokens: next.completionTokens ?? prev.completionTokens,
    cachedPromptTokens: next.cachedPromptTokens ?? prev.cachedPromptTokens,
    cacheWriteTokens: next.cacheWriteTokens ?? prev.cacheWriteTokens,
    reasoningOutputTokens: next.reasoningOutputTokens ?? prev.reasoningOutputTokens,
    money,
    firstOutputAt: next.firstOutputAt ?? prev.firstOutputAt,
    endedAt: next.endedAt ?? prev.endedAt,
  };
}

export class CalendarTurnLedger {
  private consumeQueue = Promise.resolve();
  private confirmedBudget: CalendarTurnBudget | null = null;
  private confirmedBudgetReceipt: ConfirmedBudget | null = null;
  private confirmedDispatches: CalendarModelDispatchV2[] | null = null;
  private confirmedDispatchReceipts = new Map<string, ConfirmedDispatch>();
  private activeWriters = new Map<string, ObservationWriter<CalendarDispatchObservation>>();
  constructor(private readonly o: CalendarTurnLedgerOptions) {}

  invalidateCache() {
    this.confirmedBudget = null;
    this.confirmedBudgetReceipt = null;
    this.confirmedDispatches = null;
    this.confirmedDispatchReceipts.clear();
    for (const writer of this.activeWriters.values()) { try { void writer.close(); } catch {} }
    this.activeWriters.clear();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.consumeQueue.then(task);
    this.consumeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * The persisted turn deadline. A later job may never extend it, so the
   * restored cursor and the recovery readback both use this exact value.
   */
  deadlineAt() { return this.o.identity.deadlineAt; }

  private nowIso() {
    return new Date(this.o.clock()).toISOString();
  }

  private assertDeadline() {
    if (Date.parse(this.o.identity.deadlineAt) <= this.o.clock()) {
      throw new AppError('TIMEOUT', 'The Calendar turn deadline has passed.', false);
    }
  }

  private async budgetReceipt(): Promise<ConfirmedBudget | null> {
    if (!canUseBudgetReceipts(this.o.accounting)) return null;
    if (this.confirmedBudgetReceipt) return this.confirmedBudgetReceipt;
    const current = await this.o.accounting.getBudgetConfirmed!(
      this.o.identity.userId, this.o.identity.sessionId, this.o.identity.turnId,
    );
    if (!current) throw new AppError('NOT_READY', 'Calendar budget is unavailable.');
    this.confirmedBudgetReceipt = current;
    this.confirmedBudget = current.record;
    return current;
  }

  private async budget(): Promise<CalendarTurnBudget> {
    if (this.confirmedBudget) return this.confirmedBudget;
    if (canUseBudgetReceipts(this.o.accounting)) {
      const receipt = await this.budgetReceipt();
      if (receipt) return receipt.record;
    }
    const current = await this.o.accounting.getBudget(
      this.o.identity.userId, this.o.identity.sessionId, this.o.identity.turnId);
    if (!current) throw new AppError('NOT_READY', 'Calendar budget is unavailable.');
    this.confirmedBudget = current;
    return current;
  }

  async ensureBudget(): Promise<CalendarTurnBudget> {
    return this.enqueue(() => this.ensureBudgetNow());
  }

  private async ensureBudgetNow(): Promise<CalendarTurnBudget> {
    this.assertDeadline();
    if (this.confirmedBudget) return this.confirmedBudget;
    if (canUseBudgetReceipts(this.o.accounting)) {
      const existing = await this.o.accounting.getBudgetConfirmed!(
        this.o.identity.userId, this.o.identity.sessionId, this.o.identity.turnId,
      );
      if (existing) {
        this.confirmedBudgetReceipt = existing;
        this.confirmedBudget = existing.record;
        return existing.record;
      }
    } else {
      const existing = await this.o.accounting.getBudget(
        this.o.identity.userId, this.o.identity.sessionId, this.o.identity.turnId);
      if (existing) {
        this.confirmedBudget = existing;
        return existing;
      }
    }
    const dispatches = await this.o.accounting.listDispatches(this.o.identity.userId, this.o.identity.turnId);
    if (dispatches.length) {
      throw new AppError('PERSISTENCE_ERROR', 'Calendar accounting could not be confirmed.', false);
    }
    const record = turnBudgetRecordSchema.parse({
      schemaVersion: 1, kind: 'calendar-turn-budget',
      userId: this.o.identity.userId, sessionId: this.o.identity.sessionId, turnId: this.o.identity.turnId,
      revision: 1, modelDispatches: 0, repairs: 0, logicalTools: 0, creates: 0,
      calendarRequests: 0, refreshRequests: 0,
      deadlineAt: this.o.identity.deadlineAt, createdAt: this.o.identity.createdAt,
      settledUsd: '0', reservedUsd: '0',
    });
    if (canUseBudgetReceipts(this.o.accounting)) {
      const created = await this.o.write(() => this.o.accounting.createBudgetConfirmed!(record));
      this.confirmedBudgetReceipt = created;
      this.confirmedBudget = created.record;
      if (created.record.modelDispatches === 0) {
        this.confirmedDispatches = [];
        this.confirmedDispatchReceipts.clear();
      }
      return created.record;
    }
    const created = await this.o.write(() => this.o.accounting.createBudget(record));
    this.confirmedBudget = created;
    this.confirmedBudgetReceipt = null;
    if (created.modelDispatches === 0) this.confirmedDispatches = [];
    return created;
  }

  /**
   * Without `identity` the change holds absolute next counter values, exactly as before.
   * With `identity` the change holds increments that are applied exactly once for that
   * debit identity; an exact repeat returns the original debit and moves no counter.
   */
  async consume(
    change: Partial<Pick<CalendarTurnBudget, 'logicalTools' | 'creates' | 'calendarRequests' | 'refreshRequests'>>,
    identity?: CalendarDebitIdentity,
  ): Promise<CalendarTurnBudget> {
    return this.enqueue(() => (identity
      ? this.consumeDebitNow(change, identity)
      : this.consumeNow(change)));
  }

  private async consumeDebitNow(
    change: Partial<Pick<CalendarTurnBudget, 'logicalTools' | 'creates' | 'calendarRequests' | 'refreshRequests'>>,
    identity: CalendarDebitIdentity,
  ): Promise<CalendarTurnBudget> {
    this.assertDeadline();
    // The durable debit is the single source of truth for the over-budget
    // error, but the store is constructed with the absolute CALENDAR_LIMITS
    // ceiling. This turn's own configured ceiling may be lower, so it is
    // checked here before the debit moves a counter.
    //
    // The check applies only to a debit that will actually be applied. An
    // already applied debit identity is a duplicate that moves no counter, so
    // it must never be refused by the configured ceiling.
    const current = await this.ensureBudgetNow();
    const applied = (current.debits ?? []).some(entry => entry.debitId === identity.debitId);
    if (!applied) {
      const nextTools = current.logicalTools + (change.logicalTools ?? 0);
      const nextCreates = current.creates + (change.creates ?? 0);
      const nextCalendar = current.calendarRequests + (change.calendarRequests ?? 0);
      const nextRefresh = current.refreshRequests + (change.refreshRequests ?? 0);
      if (nextTools > this.o.limits.logicalTools || nextCreates > this.o.limits.creates
        || nextCalendar > this.o.limits.calendarRequests || nextRefresh > this.o.limits.refreshRequests) {
        throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The Calendar request budget is exhausted.', false);
      }
    }
    try {
      const outcome = await this.o.write(() => this.o.accounting.debit({
        userId: this.o.identity.userId, sessionId: this.o.identity.sessionId, turnId: this.o.identity.turnId,
        debitId: identity.debitId, kindOfDebit: identity.kindOfDebit,
        decisionId: identity.decisionId ?? null, intentId: identity.intentId ?? null,
        change, clock: () => this.o.clock(), expectedBudget: this.confirmedBudgetReceipt ?? undefined,
      }));
      if (outcome.outcome === 'conflict') {
        this.invalidateCache();
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.', false);
      }
      this.confirmedBudget = outcome.budget;
      this.confirmedBudgetReceipt = outcome.budgetReceipt ?? null;
      return outcome.budget;
    } catch (error) {
      this.invalidateCache();
      throw error;
    }
  }

  private async consumeNow(
    change: Partial<Pick<CalendarTurnBudget, 'logicalTools' | 'creates' | 'calendarRequests' | 'refreshRequests'>>,
    validatedCurrent?: CalendarTurnBudget,
  ): Promise<CalendarTurnBudget> {
    this.assertDeadline();
    const current = validatedCurrent ?? await this.ensureBudgetNow();
    const nextTools = change.logicalTools ?? current.logicalTools;
    const nextCreates = change.creates ?? current.creates;
    const nextCalendar = change.calendarRequests ?? current.calendarRequests;
    const nextRefresh = change.refreshRequests ?? current.refreshRequests;
    if (nextTools > this.o.limits.logicalTools || nextCreates > this.o.limits.creates
      || nextCalendar > this.o.limits.calendarRequests || nextRefresh > this.o.limits.refreshRequests
      || nextTools < current.logicalTools || nextCreates < current.creates
      || nextCalendar < current.calendarRequests || nextRefresh < current.refreshRequests) {
      throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The Calendar request budget is exhausted.', false);
    }
    try {
      if (canUseBudgetReceipts(this.o.accounting)) {
        const receipt = this.confirmedBudgetReceipt ?? await this.budgetReceipt();
        if (receipt) {
          const next = turnBudgetRecordSchema.parse({
            ...receipt.record,
            ...change,
            revision: receipt.record.revision + 1,
          });
          const outcome = await this.o.write(() => this.o.accounting.compareBudgetConfirmed!(receipt, next));
          if (outcome.outcome !== 'confirmed') {
            this.invalidateCache();
            throw new AppError('PERSISTENCE_ERROR', 'Calendar progress could not be saved.', false);
          }
          this.confirmedBudgetReceipt = outcome.receipt;
          this.confirmedBudget = outcome.receipt.record;
          return outcome.receipt.record;
        }
      }
      const updated = await this.o.write(() => consumeCounter(this.o.accounting, current, change));
      this.confirmedBudget = updated;
      this.confirmedBudgetReceipt = null;
      return updated;
    } catch (error) {
      this.invalidateCache();
      throw error;
    }
  }

  async chargeCalendarRequest(_kind: CalendarRequestKindV2): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.ensureBudgetNow();
      await this.consumeNow({ calendarRequests: current.calendarRequests + 1 }, current);
    });
  }

  async chargeRefreshRequest(): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.ensureBudgetNow();
      await this.consumeNow({ refreshRequests: current.refreshRequests + 1 }, current);
    });
  }

  async chargeLogicalTool(decisionId?: string, _hash?: string): Promise<void> {
    if (decisionId) {
      await this.consume(CALENDAR_DEBIT_EFFECT['logical-tool'], {
        debitId: calendarDebitId(this.o.identity.userId, this.o.identity.sessionId,
          this.o.identity.turnId, 'logical-tool', decisionId),
        kindOfDebit: 'logical-tool', decisionId,
      });
      return;
    }
    await this.enqueue(async () => {
      const current = await this.ensureBudgetNow();
      await this.consumeNow({ logicalTools: current.logicalTools + 1 }, current);
    });
  }

  async chargeCreate(intentId?: string, _hash?: string): Promise<void> {
    if (intentId) {
      await this.consume(CALENDAR_DEBIT_EFFECT.create, {
        debitId: calendarDebitId(this.o.identity.userId, this.o.identity.sessionId,
          this.o.identity.turnId, 'create', intentId),
        kindOfDebit: 'create', intentId,
      });
      return;
    }
    await this.enqueue(async () => {
      const current = await this.ensureBudgetNow();
      await this.consumeNow({ creates: current.creates + 1 }, current);
    });
  }

  async reserveDispatch(
    reason: CalendarModelDispatchV2['reason'],
    context: { estimatedInputTokens: number },
    repair: CalendarDecisionRequest['repair'],
  ): Promise<CalendarModelDispatchV2> {
    return this.enqueue(() => this.reserveDispatchNow(reason, context, repair));
  }

  private async reserveDispatchNow(
    reason: CalendarModelDispatchV2['reason'],
    context: { estimatedInputTokens: number },
    repair: CalendarDecisionRequest['repair'],
  ): Promise<CalendarModelDispatchV2> {
    this.assertDeadline();
    this.o.job.check();
    const current = await this.ensureBudgetNow();
    const listed = (this.confirmedDispatches !== null
      && this.confirmedDispatches.length === current.modelDispatches)
      ? this.confirmedDispatches
      : await this.o.accounting.listDispatches(this.o.identity.userId, this.o.identity.turnId);
    const last = listed.at(-1);
    if (last && last.status === 'reserved' && last.attemptId === this.o.identity.attemptId
      && last.reason === reason
      && last.repairedDecisionId === (repair?.rejectedDecisionId ?? null)) {
      if (last.schemaVersion !== 2) {
        throw new AppError('NOT_READY', 'Legacy calendar dispatch cannot be continued under v2.', false);
      }
      return last;
    }
    const dispatchIndex = current.modelDispatches + 1;
    const nextRepairs = reason === 'schema-repair' ? current.repairs + 1 : current.repairs;
    if (dispatchIndex > this.o.limits.modelDispatches || nextRepairs > this.o.limits.repairs) {
      throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The Calendar model budget is exhausted.', false);
    }
    if ((reason === 'schema-repair' || reason === 'provider-retry') && !repair) {
      throw new AppError('INVALID_REQUEST', 'Calendar repair provenance is missing.');
    }
    const reservationUsd = reserveUsd(this.o.pricing, context.estimatedInputTokens, this.o.maxOutputTokens);
    if (!withinSpendCap(current.settledUsd, current.reservedUsd, reservationUsd, this.o.limits.modelSpendUsd)) {
      throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The Calendar model budget is exhausted.', false);
    }
    const dispatchId = key('calendar-dispatch', this.o.identity.userId, this.o.identity.sessionId,
      this.o.identity.turnId, dispatchIndex);
    const decisionId = key('calendar-decision', this.o.identity.userId, this.o.identity.sessionId,
      this.o.identity.turnId, dispatchIndex);
    const reserved = modelDispatchV2Schema.parse({
      schemaVersion: 2, kind: 'calendar-model-dispatch',
      userId: this.o.identity.userId, sessionId: this.o.identity.sessionId,
      turnId: this.o.identity.turnId, attemptId: this.o.identity.attemptId,
      dispatchId, decisionId, dispatchIndex, reason,
      repairedDecisionId: repair?.rejectedDecisionId ?? null,
      requestedModel: this.o.modelId, reportedModel: null, reportedProvider: null,
      openRouterUser: this.o.identity.openRouterUser, configRevision: this.o.configRevision,
      connectionId: this.o.connection.connectionId, connectionRevision: this.o.connection.connectionRevision,
      schemaRevision: CALENDAR_TOOL_REVISION, generationId: null, providerRequestId: null,
      status: 'reserved', startedAt: this.nowIso(), endedAt: null, firstOutputAt: null,
      promptTokens: null, completionTokens: null, cachedPromptTokens: null, cacheWriteTokens: null,
      reasoningOutputTokens: null, money: unavailableMoney(true), pricing: this.o.pricing,
      reservationUsd, reservationStatus: 'held', failure: null,
    });
    try {
      if (canUseDispatchReceipts(this.o.accounting) && canUseBudgetReceipts(this.o.accounting)) {
        const budgetReceipt = this.confirmedBudgetReceipt ?? await this.budgetReceipt();
        if (budgetReceipt) {
          const saved = await this.o.write(() =>
            this.o.accounting.reserveDispatchConfirmed!(reserved, budgetReceipt),
          );
          this.confirmedBudgetReceipt = saved.budget;
          this.confirmedBudget = saved.budget.record;
          this.confirmedDispatchReceipts.set(saved.dispatch.record.dispatchId, saved.dispatch);
          if (listed.every((item): item is CalendarModelDispatchV2 => item.schemaVersion === 2)) {
            this.confirmedDispatches = [
              ...listed.filter(item => item.dispatchId !== saved.dispatch.record.dispatchId),
              saved.dispatch.record,
            ];
          } else {
            this.confirmedDispatches = null;
          }
          return saved.dispatch.record;
        }
      }
      await this.o.write(() => this.o.accounting.putDispatch(reserved));
      this.confirmedBudgetReceipt = null;
      const refreshed = await this.o.accounting.getBudget(
        this.o.identity.userId, this.o.identity.sessionId, this.o.identity.turnId,
      );
      if (!refreshed) {
        throw new AppError('PERSISTENCE_ERROR', 'Calendar accounting could not be confirmed.', false);
      }
      this.confirmedBudget = refreshed;
    } catch (error) {
      this.invalidateCache();
      throw error;
    }
    if (listed.every((item): item is CalendarModelDispatchV2 => item.schemaVersion === 2)) {
      this.confirmedDispatches = [
        ...listed.filter(item => item.dispatchId !== reserved.dispatchId),
        reserved,
      ];
    } else {
      this.confirmedDispatches = null;
    }
    return reserved;
  }

  async bindingFor(dispatch: CalendarModelDispatchV2): Promise<CalendarDispatchBindingV2> {
    const budget = await this.budget();
    if (budget.modelDispatches !== dispatch.dispatchIndex) {
      throw new AppError('PERSISTENCE_ERROR', 'Calendar accounting could not be confirmed.', false);
    }
    let writer: ObservationWriter<CalendarDispatchObservation> | undefined;
    if (typeof this.o.job.track === 'function' && typeof this.o.job.abort === 'function') {
      const track = this.o.job.track.bind(this.o.job);
      const abort = this.o.job.abort.bind(this.o.job);
      const initial: CalendarDispatchObservation = {
        reportedModel: dispatch.reportedModel,
        reportedProvider: dispatch.reportedProvider,
        generationId: dispatch.generationId,
        providerRequestId: dispatch.providerRequestId,
        promptTokens: dispatch.promptTokens,
        completionTokens: dispatch.completionTokens,
        cachedPromptTokens: dispatch.cachedPromptTokens,
        cacheWriteTokens: dispatch.cacheWriteTokens,
        reasoningOutputTokens: dispatch.reasoningOutputTokens,
        money: dispatch.money,
        firstOutputAt: dispatch.firstOutputAt,
        endedAt: dispatch.endedAt,
      };
      writer = createObservationWriter<CalendarDispatchObservation>({
        initial,
        merge: (prev, next) => mergeCalendarObservations(prev, next),
        persist: async snapshot => {
          await this.observe(dispatch.dispatchId, snapshot);
        },
        track,
        fail: _err => abort('INTERRUPTED'),
      });
      this.activeWriters.set(dispatch.dispatchId, writer);
    }
    const hooks: CalendarDispatchHooks = {
      beforeDispatch: () => this.beforeDispatch(dispatch.dispatchId),
      onObservation: async observation => {
        if (writer) {
          writer.enqueue(observation);
          await writer.flush();
        } else {
          await this.observe(dispatch.dispatchId, observation);
        }
      },
      enqueueObservation: writer ? observation => { writer!.enqueue(observation); } : undefined,
      flushObservations: writer ? () => writer!.flush() : undefined,
      checkObservations: writer ? () => writer!.check() : undefined,
    };
    return {
      dispatch, budget, limits: this.o.limits, processingPolicyId: this.o.processingPolicyId,
      hooks,
    };
  }

  private replaceConfirmedDispatch(updated: CalendarModelDispatchV2) {
    if (!this.confirmedDispatches) return;
    const index = this.confirmedDispatches.findIndex(item => item.dispatchId === updated.dispatchId);
    if (index >= 0) {
      this.confirmedDispatches[index] = updated;
    } else {
      this.confirmedDispatches = null;
    }
  }

  private async getDispatchReceipt(dispatchId: string): Promise<ConfirmedDispatch | null> {
    if (!canUseDispatchReceipts(this.o.accounting)) return null;
    const cached = this.confirmedDispatchReceipts.get(dispatchId);
    if (cached) return cached;
    const loaded = await this.o.accounting.getDispatchConfirmed!(this.o.identity.userId, dispatchId);
    if (loaded) {
      this.confirmedDispatchReceipts.set(dispatchId, loaded);
      this.replaceConfirmedDispatch(loaded.record);
    }
    return loaded;
  }

  private async loadDispatch(dispatchId: string): Promise<CalendarModelDispatchV2> {
    const cachedReceipt = this.confirmedDispatchReceipts.get(dispatchId);
    if (cachedReceipt) return cachedReceipt.record;
    const cached = this.confirmedDispatches?.find(item => item.dispatchId === dispatchId);
    if (cached && !canUseDispatchReceipts(this.o.accounting)) return cached;
    if (canUseDispatchReceipts(this.o.accounting)) {
      const receipt = await this.getDispatchReceipt(dispatchId);
      if (!receipt || receipt.record.schemaVersion !== 2) {
        throw new AppError('PERSISTENCE_ERROR', 'Calendar accounting could not be confirmed.', false);
      }
      return receipt.record;
    }
    const current = cached ?? await this.o.accounting.getDispatch(this.o.identity.userId, dispatchId);
    if (!current || current.schemaVersion !== 2) {
      throw new AppError('PERSISTENCE_ERROR', 'Calendar accounting could not be confirmed.', false);
    }
    return current;
  }

  private async persistDispatchUpdate(
    dispatchId: string,
    current: CalendarModelDispatchV2,
    next: CalendarModelDispatchV2,
  ): Promise<CalendarModelDispatchV2> {
    try {
      if (canUseDispatchReceipts(this.o.accounting) && canUseBudgetReceipts(this.o.accounting)) {
        const dispatchReceipt = await this.getDispatchReceipt(dispatchId);
        const budgetReceipt = this.confirmedBudgetReceipt ?? await this.budgetReceipt();
        if (dispatchReceipt && budgetReceipt) {
          const saved = await this.o.write(() =>
            this.o.accounting.updateDispatchConfirmed!(dispatchReceipt, next, budgetReceipt),
          );
          this.confirmedDispatchReceipts.set(dispatchId, saved.dispatch);
          this.confirmedBudgetReceipt = saved.budget;
          this.confirmedBudget = saved.budget.record;
          this.replaceConfirmedDispatch(saved.dispatch.record);
          return saved.dispatch.record;
        }
      }
      await this.o.write(() => this.o.accounting.putDispatch(next));
      this.confirmedDispatchReceipts.delete(dispatchId);
      this.replaceConfirmedDispatch(next);
      if (current.reservationStatus !== next.reservationStatus
        || current.money.reportedAmount !== next.money.reportedAmount) {
        this.confirmedBudgetReceipt = null;
        this.confirmedBudget = await this.o.accounting.getBudget(
          this.o.identity.userId, this.o.identity.sessionId, this.o.identity.turnId,
        );
      }
      return next;
    } catch (error) {
      this.invalidateCache();
      throw error;
    }
  }

  async beforeDispatch(dispatchId: string): Promise<void> {
    return this.enqueue(async () => {
      this.o.job.check();
      if (!(await this.o.fence())) throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
      await this.o.requireCurrent();
      this.assertDeadline();
      const current = await this.loadDispatch(dispatchId);
      if (current.status === 'dispatched' || current.status === 'terminal') return;
      const next = modelDispatchV2Schema.parse({ ...current, status: 'dispatched' });
      await this.persistDispatchUpdate(dispatchId, current, next);
      this.o.job.check();
      if (!(await this.o.fence())) throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
      this.assertDeadline();
    });
  }

  async observe(dispatchId: string, observation: CalendarDispatchObservation): Promise<CalendarModelDispatchV2> {
    return this.enqueue(async () => {
      const current = await this.loadDispatch(dispatchId);
      const keepKnown = current.money.costStatus === 'known' && observation.money.costStatus !== 'known';
      const money = keepKnown ? current.money : observation.money;
      const reservationStatus = money.costStatus === 'known' ? 'settled' as const : 'held' as const;
      const next = modelDispatchV2Schema.parse({
        ...current,
        reportedModel: observation.reportedModel ?? current.reportedModel,
        reportedProvider: observation.reportedProvider ?? current.reportedProvider,
        generationId: observation.generationId ?? current.generationId,
        providerRequestId: observation.providerRequestId ?? current.providerRequestId,
        promptTokens: observation.promptTokens ?? current.promptTokens,
        completionTokens: observation.completionTokens ?? current.completionTokens,
        cachedPromptTokens: observation.cachedPromptTokens ?? current.cachedPromptTokens,
        cacheWriteTokens: observation.cacheWriteTokens ?? current.cacheWriteTokens,
        reasoningOutputTokens: observation.reasoningOutputTokens ?? current.reasoningOutputTokens,
        money, reservationStatus,
        firstOutputAt: observation.firstOutputAt ?? current.firstOutputAt,
        endedAt: observation.endedAt ?? current.endedAt,
      });
      if (!isDeepStrictEqual(current, next)) {
        return this.persistDispatchUpdate(dispatchId, current, next);
      }
      return next;
    });
  }

  async finishDispatch(dispatchId: string, failure: CalendarFailure | null): Promise<CalendarModelDispatchV2> {
    const writer = this.activeWriters.get(dispatchId);
    if (writer) {
      await writer.flush();
      this.activeWriters.delete(dispatchId);
    }
    return this.enqueue(async () => {
      const current = await this.loadDispatch(dispatchId);
      const next = modelDispatchV2Schema.parse({
        ...current,
        status: 'terminal',
        endedAt: current.endedAt ?? this.nowIso(),
        failure,
      });
      return this.persistDispatchUpdate(dispatchId, current, next);
    });
  }

  async aggregate(): Promise<CalendarModelAggregate> {
    for (const [id, writer] of this.activeWriters.entries()) {
      await writer.flush();
      this.activeWriters.delete(id);
    }
    const all = (this.confirmedDispatches !== null
      && this.confirmedBudget !== null
      && this.confirmedDispatches.length === this.confirmedBudget.modelDispatches)
      ? this.confirmedDispatches
      : await this.o.accounting.listDispatches(this.o.identity.userId, this.o.identity.turnId);
    const dispatches: CalendarModelDispatchV2[] = [];
    for (const item of all) {
      if (item.attemptId !== this.o.identity.attemptId) continue;
      if (item.schemaVersion !== 2) {
        throw new AppError('NOT_READY', 'Legacy calendar dispatch cannot be aggregated under v2.', false);
      }
      dispatches.push(item);
    }
    dispatches.sort((a, b) => a.dispatchIndex - b.dispatchIndex);
    if (!dispatches.length) throw new AppError('NOT_READY', 'Calendar accounting is unavailable.');
    const known: string[] = [];
    let held = '0';
    let costStatus: CalendarModelAggregate['costStatus'] = 'known';
    let promptTokens: number | null = 0;
    let completionTokens: number | null = 0;
    for (const item of dispatches) {
      if (item.money.costStatus === 'known' && item.money.reportedAmount) known.push(item.money.reportedAmount);
      else if (item.reservationStatus === 'held') {
        held = sumUsd([held, item.reservationUsd]);
        costStatus = item.money.costStatus === 'pending' && costStatus === 'known' ? 'pending' : 'unknown';
      } else if (item.money.costStatus === 'pending' && costStatus === 'known') costStatus = 'pending';
      else if (item.money.costStatus !== 'known') costStatus = 'unknown';
      if (item.promptTokens === null) promptTokens = null;
      else if (promptTokens !== null) promptTokens += item.promptTokens;
      if (item.completionTokens === null) completionTokens = null;
      else if (completionTokens !== null) completionTokens += item.completionTokens;
    }
    if (held !== '0' && costStatus === 'known') costStatus = 'unknown';
    const budget = await this.budget();
    const record = modelAggregateSchema.parse({
      schemaVersion: 1, kind: 'calendar-model-aggregate',
      userId: this.o.identity.userId, sessionId: this.o.identity.sessionId,
      turnId: this.o.identity.turnId, attemptId: this.o.identity.attemptId,
      dispatchIds: dispatches.map(item => item.dispatchId),
      reportedUsd: costStatus === 'known' ? sumUsd(known.length ? known : ['0']) : (known.length ? sumUsd(known) : null),
      heldReservationUsd: held, costStatus, promptTokens, completionTokens,
      calendarRequests: budget.calendarRequests, refreshRequests: budget.refreshRequests,
      connectorMoney: unavailableMoney(), updatedAt: this.nowIso(),
    });
    try {
      await this.o.write(() => this.o.accounting.putAggregate(record));
    } catch (error) {
      const existing = (await this.o.accounting.listAttemptAccounting(
        this.o.identity.userId, this.o.identity.sessionId, this.o.identity.turnId, this.o.identity.attemptId)).aggregate;
      if (!existing) throw error;
      return existing;
    }
    return record;
  }
}
