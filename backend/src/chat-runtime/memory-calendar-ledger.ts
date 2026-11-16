/**
 * ============================================================================
 * FILE: memory-calendar-ledger.ts
 * LOCATION: backend/src/chat-runtime/memory-calendar-ledger.ts
 * ============================================================================
 * PURPOSE: Reserve and aggregate native model decisions without durable receipts.
 * ROLE IN PROJECT: Volatile half of lazy Calendar promotion; never grants tool access.
 * KEY COMPONENTS: Finite dispatch reservations, absolute observations, frozen export.
 * ============================================================================
 */
import { isDeepStrictEqual } from 'node:util';
import {
  modelDispatchV2Schema, modelAggregateSchema, turnBudgetRecordSchema,
  reserveUsd, sumUsd, withinSpendCap, unavailableMoney,
  type CalendarModelDispatchV2, type CalendarModelAggregate, type CalendarTurnBudget,
} from '../contracts/calendar-accounting.js';
import type { CalendarDispatchObservation, SkillDecisionRequest } from '../contracts/calendar-model.js';
import type { CalendarFailure } from '../contracts/calendar-policy.js';
import type { CalendarDispatchBindingV2 } from '../model/calendar-policy.js';
import { key } from '../persistence/records.js';
import { AppError } from '../platform/errors/app-error.js';
import type { CalendarTurnLedgerOptions, CalendarLedgerJob } from './calendar-budget.js';

export type MemoryCalendarAccounting = Readonly<{
  storage: 'volatile'; budget: CalendarTurnBudget;
  dispatches: readonly CalendarModelDispatchV2[]; aggregate: CalendarModelAggregate | null;
}>;

/** No persistence port, fence callback, or ConfirmedRecord is consumed here. */
export class MemoryCalendarLedger {
  private budget: CalendarTurnBudget;
  private readonly dispatches: CalendarModelDispatchV2[] = [];
  private result: CalendarModelAggregate | null = null;
  private sealed = false;
  private readonly initialBudget: CalendarTurnBudget | null;
  constructor(private readonly o: Pick<CalendarTurnLedgerOptions,
    'identity' | 'limits' | 'clock' | 'modelId' | 'pricing' | 'configRevision' |
    'maxOutputTokens' | 'processingPolicyId' | 'job'> & { initialBudget?: CalendarTurnBudget }) {
    this.o = { ...o, identity: Object.freeze({ ...o.identity }), limits: Object.freeze({ ...o.limits }),
      pricing: Object.freeze({ ...o.pricing }) };
    this.initialBudget = o.initialBudget ? turnBudgetRecordSchema.parse(o.initialBudget) : null;
    if (this.initialBudget && (this.initialBudget.userId !== o.identity.userId ||
        this.initialBudget.sessionId !== o.identity.sessionId || this.initialBudget.turnId !== o.identity.turnId))
      throw new AppError('INVALID_REQUEST', 'Calendar retry budget identity changed.');
    this.budget = this.initialBudget ?? turnBudgetRecordSchema.parse({ schemaVersion: 1, kind: 'calendar-turn-budget',
      userId: o.identity.userId, sessionId: o.identity.sessionId, turnId: o.identity.turnId,
      revision: 1, modelDispatches: 0, repairs: 0, logicalTools: 0, creates: 0,
      calendarRequests: 0, refreshRequests: 0, deadlineAt: o.identity.deadlineAt,
      createdAt: o.identity.createdAt, settledUsd: '0', reservedUsd: '0' });
  }
  deadlineAt() { return this.budget.deadlineAt; }
  rebindJob(job: CalendarLedgerJob): void {
    if (this.sealed) throw new AppError('NOT_READY', 'The memory decision has been frozen.');
    this.o.job = job;
  }
  private check() {
    this.o.job.check();
    if (this.sealed) throw new AppError('NOT_READY', 'The memory decision has been frozen.');
    if (this.o.clock() >= Date.parse(this.budget.deadlineAt))
      throw new AppError('TIMEOUT', 'The Calendar turn deadline has passed.', false);
  }
  async ensureBudget(): Promise<CalendarTurnBudget> { this.check(); return structuredClone(this.budget); }
  async reserveDispatch(reason: CalendarModelDispatchV2['reason'], context: { estimatedInputTokens: number },
    repair: SkillDecisionRequest['repair']): Promise<CalendarModelDispatchV2> {
    this.check();
    const dispatchIndex = this.budget.modelDispatches + 1;
    const repairs = this.budget.repairs + Number(reason === 'schema-repair');
    const reservationUsd = reserveUsd(this.o.pricing, context.estimatedInputTokens, this.o.maxOutputTokens);
    if (dispatchIndex > this.o.limits.modelDispatches || repairs > this.o.limits.repairs ||
      !withinSpendCap(this.budget.settledUsd, this.budget.reservedUsd, reservationUsd, this.o.limits.modelSpendUsd))
      throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The Calendar model budget is exhausted.', false);
    if ((reason === 'schema-repair' || reason === 'provider-retry') !== Boolean(repair))
      throw new AppError('INVALID_REQUEST', 'Calendar repair provenance is missing.');
    const scope = this.o.identity;
    const dispatch = modelDispatchV2Schema.parse({ schemaVersion: 2, kind: 'calendar-model-dispatch',
      userId: scope.userId, sessionId: scope.sessionId, turnId: scope.turnId, attemptId: scope.attemptId,
      dispatchId: key('memory-calendar-dispatch', scope.userId, scope.sessionId, scope.turnId, scope.attemptId, dispatchIndex),
      decisionId: key('memory-calendar-decision', scope.userId, scope.sessionId, scope.turnId, scope.attemptId, dispatchIndex),
      dispatchIndex, reason, repairedDecisionId: repair?.rejectedDecisionId ?? null,
      requestedModel: this.o.modelId, reportedModel: null, reportedProvider: null,
      openRouterUser: scope.openRouterUser, configRevision: this.o.configRevision,
      // Explicit absence of account authority. Promotion must bind a fresh account;
      // this value is never accepted by a connection gate or operation writer.
      connectionId: 'memory-unbound', connectionRevision: 1, schemaRevision: 'google-calendar.v2',
      generationId: null, providerRequestId: null, status: 'reserved', startedAt: new Date(this.o.clock()).toISOString(),
      endedAt: null, firstOutputAt: null, promptTokens: null, completionTokens: null,
      cachedPromptTokens: null, cacheWriteTokens: null, reasoningOutputTokens: null,
      money: unavailableMoney(true), pricing: this.o.pricing, reservationUsd, reservationStatus: 'held', failure: null });
    this.dispatches.push(dispatch);
    this.budget = turnBudgetRecordSchema.parse({ ...this.budget, revision: this.budget.revision + 1,
      modelDispatches: dispatchIndex, repairs, reservedUsd: sumUsd([this.budget.reservedUsd, reservationUsd]) });
    return structuredClone(dispatch);
  }
  private find(id: string) {
    const dispatch = this.dispatches.find(d => d.dispatchId === id);
    if (!dispatch) throw new AppError('INVALID_REQUEST', 'Unknown model dispatch.');
    return dispatch;
  }
  async bindingFor(dispatch: CalendarModelDispatchV2): Promise<CalendarDispatchBindingV2> {
    this.check();
    if (!isDeepStrictEqual(dispatch, this.find(dispatch.dispatchId)) || dispatch.dispatchIndex !== this.budget.modelDispatches)
      throw new AppError('INVALID_REQUEST', 'Model dispatch identity changed.');
    return { dispatch: structuredClone(dispatch), budget: structuredClone(this.budget), limits: this.o.limits,
      processingPolicyId: this.o.processingPolicyId, hooks: {
        beforeDispatch: async () => {
          this.check(); const current = this.find(dispatch.dispatchId);
          if (current.status !== 'reserved') throw new AppError('INVALID_REQUEST', 'Model dispatch was already used.');
          current.status = 'dispatched';
        },
        onObservation: async observation => { await this.observe(dispatch.dispatchId, observation); },
      } };
  }
  async observe(id: string, observation: CalendarDispatchObservation): Promise<CalendarModelDispatchV2> {
    // Cleanup accounting may arrive after cancellation/deadline. It records evidence
    // only, and must not re-admit dispatch or external access.
    if (this.sealed) throw new AppError('NOT_READY', 'The memory decision has been frozen.');
    const current = this.find(id);
    if (current.generationId && observation.generationId && current.generationId !== observation.generationId)
      throw new AppError('PROVIDER_ERROR', 'The response identity changed.', false);
    for (const field of ['promptTokens', 'completionTokens', 'cachedPromptTokens', 'cacheWriteTokens', 'reasoningOutputTokens'] as const)
      if (current[field] !== null && observation[field] !== null && observation[field] < current[field])
        throw new AppError('PROVIDER_ERROR', 'Provider accounting evidence disagreed.', false);
    if (current.money.costStatus === 'known' && observation.money.costStatus === 'known' &&
        current.money.reportedAmount !== observation.money.reportedAmount)
      throw new AppError('PROVIDER_ERROR', 'Provider accounting evidence disagreed.', false);
    const money = current.money.costStatus === 'known' && observation.money.costStatus !== 'known'
      ? current.money : observation.money;
    const next = modelDispatchV2Schema.parse({ ...current,
      ...Object.fromEntries(Object.entries(observation).filter(([, value]) => value !== null)),
      money, reservationStatus: money.costStatus === 'known' ? 'settled' : 'held' });
    Object.assign(current, next); this.recompute();
    return structuredClone(next);
  }
  private recompute() {
    this.budget = turnBudgetRecordSchema.parse({ ...this.budget, revision: this.budget.revision + 1,
      settledUsd: sumUsd([this.initialBudget?.settledUsd ?? '0', ...this.dispatches.filter(d => d.money.costStatus === 'known').map(d => d.money.reportedAmount!)]),
      reservedUsd: sumUsd([this.initialBudget?.reservedUsd ?? '0', ...this.dispatches.filter(d => d.reservationStatus === 'held').map(d => d.reservationUsd)]) });
  }
  async finishDispatch(id: string, failure: CalendarFailure | null): Promise<CalendarModelDispatchV2> {
    const current = this.find(id);
    if (this.sealed) throw new AppError('NOT_READY', 'The memory decision has been frozen.');
    Object.assign(current, modelDispatchV2Schema.parse({ ...current, status: 'terminal', failure,
      endedAt: current.endedAt ?? new Date(this.o.clock()).toISOString() }));
    return structuredClone(current);
  }
  async aggregate(): Promise<CalendarModelAggregate> {
    if (this.sealed) {
      if (!this.result) throw new AppError('NOT_READY', 'The memory decision has been frozen.');
      return structuredClone(this.result);
    }
    if (!this.dispatches.length) throw new AppError('NOT_READY', 'Calendar accounting is unavailable.');
    const known = this.dispatches.every(d => d.money.costStatus === 'known');
    const tokens = (field: 'promptTokens' | 'completionTokens') => this.dispatches.some(d => d[field] === null)
      ? null : this.dispatches.reduce((n, d) => n + d[field]!, 0);
    this.result = modelAggregateSchema.parse({ schemaVersion: 1, kind: 'calendar-model-aggregate',
      userId: this.o.identity.userId, sessionId: this.o.identity.sessionId, turnId: this.o.identity.turnId,
      attemptId: this.o.identity.attemptId, dispatchIds: this.dispatches.map(d => d.dispatchId),
      reportedUsd: known ? sumUsd(this.dispatches.map(d => d.money.reportedAmount!)) : null,
      heldReservationUsd: sumUsd(this.dispatches.filter(d => d.reservationStatus === 'held').map(d => d.reservationUsd)),
      costStatus: known ? 'known' : this.dispatches.some(d => d.money.costStatus === 'unknown') ? 'unknown' : 'pending',
      promptTokens: tokens('promptTokens'), completionTokens: tokens('completionTokens'),
      calendarRequests: 0, refreshRequests: 0, connectorMoney: unavailableMoney(false),
      updatedAt: new Date(this.o.clock()).toISOString() });
    return structuredClone(this.result);
  }
  snapshot(): MemoryCalendarAccounting {
    return structuredClone({ storage: 'volatile' as const, budget: this.budget,
      dispatches: this.dispatches, aggregate: this.result });
  }
  freeze(): MemoryCalendarAccounting { this.sealed = true; return this.snapshot(); }
}
