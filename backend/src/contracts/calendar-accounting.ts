import { z } from 'zod';
import { canonicalDecimal, decimalSchema, moneyEvidenceSchema, usageCountSchema, unavailableMoney } from './usage-evidence.js';
import { idSchema, isoDateSchema } from './identifiers.js';
import { calendarFailureSchema } from './calendar-policy.js';
import type { CasConfirmation, ConfirmedRecord } from '../persistence/confirmed-record.js';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const scaleOf = (v: string) => v.split('.')[1]?.length ?? 0;
const scaled = (v: string, scale: number) => BigInt(v.replace('.', '')) * 10n ** BigInt(scale - scaleOf(v));
export function sumUsd(values: readonly string[]): string {
  values.forEach(v => decimalSchema.parse(v));
  const scale = Math.max(0, ...values.map(scaleOf));
  return canonicalDecimal(`${values.reduce((sum, v) => sum + scaled(v, scale), 0n)}e-${scale}`);
}
function timesUsd(value: string, units: number): string {
  decimalSchema.parse(value); count.parse(units);
  return canonicalDecimal(`${BigInt(value.replace('.', '')) * BigInt(units)}e-${scaleOf(value)}`);
}
export function withinSpendCap(settled: string, held: string, next: string, cap: string): boolean {
  const total = sumUsd([settled, held, next]); decimalSchema.parse(cap);
  const scale = Math.max(scaleOf(total), scaleOf(cap));
  return scaled(total, scale) <= scaled(cap, scale);
}
export const tokenPricingSchema = z.object({ version: idSchema, source: z.string().min(1).max(200),
  observedAt: isoDateSchema, modelId: z.string().min(1).max(200), providerRoute: z.string().min(1).max(200),
  promptUsdPerToken: decimalSchema, completionUsdPerToken: decimalSchema, requestUsd: decimalSchema,
}).strict();
export type CalendarTokenPricing = z.infer<typeof tokenPricingSchema>;
export function reserveUsd(pricing: CalendarTokenPricing, input: number, output: number): string {
  const p = tokenPricingSchema.parse(pricing);
  return sumUsd([timesUsd(p.promptUsdPerToken, input), timesUsd(p.completionUsdPerToken, output), p.requestUsd]);
}
export type CalendarDebitKind = 'logical-tool' | 'create';
export const CALENDAR_DEBIT_EFFECT: Readonly<Record<CalendarDebitKind,
  { logicalTools: number; creates: number }>> = Object.freeze({
  'logical-tool': { logicalTools: 1, creates: 0 },
  create: { logicalTools: 1, creates: 1 },
});
const calendarBudgetDebitFields = {
  debitId: idSchema, kindOfDebit: z.enum(['logical-tool', 'create']),
  decisionId: idSchema.nullable(), intentId: idSchema.nullable(),
  logicalTools: z.number().int().min(0).max(6), creates: z.number().int().min(0).max(1),
  calendarRequests: z.number().int().min(0).max(20), refreshRequests: z.number().int().min(0).max(2),
  budgetRevision: z.number().int().positive(), createdAt: isoDateSchema,
};
type CalendarBudgetDebitShape = {
  kindOfDebit: CalendarDebitKind; decisionId: string | null; intentId: string | null;
  logicalTools: number; creates: number; calendarRequests: number; refreshRequests: number;
};
function refineCalendarBudgetDebit(value: CalendarBudgetDebitShape, ctx: z.RefinementCtx): void {
  if (value.kindOfDebit === 'logical-tool') {
    if (value.decisionId === null || value.intentId !== null) {
      ctx.addIssue({ code: 'custom', message: 'A logical tool debit carries one decision id.' });
    }
    if (value.creates !== 0) ctx.addIssue({ code: 'custom', message: 'A logical tool debit cannot create.' });
  } else {
    if (value.intentId === null || value.decisionId !== null) {
      ctx.addIssue({ code: 'custom', message: 'A create debit carries one intent id.' });
    }
    if (value.creates < 1 || value.logicalTools < value.creates) {
      ctx.addIssue({ code: 'custom', message: 'A create debit counts its own logical action.' });
    }
  }
  if (value.logicalTools + value.creates + value.calendarRequests + value.refreshRequests < 1) {
    ctx.addIssue({ code: 'custom', message: 'A debit changes a counter.' });
  }
}
export const calendarBudgetDebitEntrySchema = z.object(calendarBudgetDebitFields).strict()
  .superRefine(refineCalendarBudgetDebit);
export type CalendarBudgetDebitEntry = z.infer<typeof calendarBudgetDebitEntrySchema>;
export const calendarBudgetDebitSchema = z.object({
  schemaVersion: z.literal(2), kind: z.literal('calendar-budget-debit'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, ...calendarBudgetDebitFields,
}).strict().superRefine(refineCalendarBudgetDebit);
export type CalendarBudgetDebit = z.infer<typeof calendarBudgetDebitSchema>;
export const turnBudgetRecordSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-turn-budget'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, revision: z.number().int().positive(),
  modelDispatches: z.number().int().min(0).max(8), repairs: z.number().int().min(0).max(2),
  logicalTools: z.number().int().min(0).max(6), creates: z.number().int().min(0).max(1),
  calendarRequests: z.number().int().min(0).max(20), refreshRequests: z.number().int().min(0).max(2),
  debits: z.array(calendarBudgetDebitEntrySchema).max(8).optional(),
  deadlineAt: isoDateSchema, createdAt: isoDateSchema, settledUsd: decimalSchema, reservedUsd: decimalSchema,
}).strict().refine(v => v.repairs <= v.modelDispatches && v.creates <= v.logicalTools
  && Date.parse(v.deadlineAt) > Date.parse(v.createdAt));
export type CalendarTurnBudget = z.infer<typeof turnBudgetRecordSchema>;
export const modelDispatchSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-model-dispatch'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema, dispatchId: idSchema,
  decisionId: idSchema, dispatchIndex: z.number().int().min(1).max(8),
  reason: z.enum(['initial', 'continuation', 'schema-repair', 'provider-retry']), repairedDecisionId: idSchema.nullable(),
  requestedModel: z.string().min(1).max(200), reportedModel: z.string().min(1).max(200).nullable(),
  reportedProvider: z.string().min(1).max(200).nullable(), openRouterUser: idSchema,
  configRevision: z.number().int().nonnegative(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v1'),
  generationId: z.string().min(1).max(200).nullable(), providerRequestId: z.string().min(1).max(200).nullable(),
  status: z.enum(['reserved', 'dispatched', 'terminal', 'not-dispatched']),
  startedAt: isoDateSchema, endedAt: isoDateSchema.nullable(), firstOutputAt: isoDateSchema.nullable(),
  promptTokens: usageCountSchema, completionTokens: usageCountSchema,
  cachedPromptTokens: usageCountSchema, cacheWriteTokens: usageCountSchema, reasoningOutputTokens: usageCountSchema,
  money: moneyEvidenceSchema, pricing: tokenPricingSchema, reservationUsd: decimalSchema,
  reservationStatus: z.enum(['held', 'settled', 'released-not-dispatched']), failure: calendarFailureSchema.nullable(),
}).strict().superRefine((v, ctx) => {
  if ((v.reservationStatus === 'settled' && v.money.costStatus !== 'known')
    || (v.money.costStatus === 'known' && v.reservationStatus !== 'settled')
    || (v.reservationStatus === 'released-not-dispatched' && v.status !== 'not-dispatched')
    || (v.reason === 'schema-repair' && v.repairedDecisionId === null))
    ctx.addIssue({ code: 'custom', message: 'Dispatch reservation/provenance mismatch.' });
});
export type CalendarModelDispatch = z.infer<typeof modelDispatchSchema>;
export const modelAggregateSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-model-aggregate'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema,
  dispatchIds: z.array(idSchema).min(1).max(8).refine(ids => new Set(ids).size === ids.length),
  reportedUsd: decimalSchema.nullable(), heldReservationUsd: decimalSchema,
  costStatus: z.enum(['known', 'pending', 'unknown']), promptTokens: usageCountSchema,
  completionTokens: usageCountSchema, calendarRequests: count.max(20), refreshRequests: count.max(2),
  connectorMoney: moneyEvidenceSchema, updatedAt: isoDateSchema,
}).strict().refine(v => (v.costStatus !== 'known' || (v.reportedUsd !== null && v.heldReservationUsd === '0')));
export type CalendarModelAggregate = z.infer<typeof modelAggregateSchema>;
type AttemptAccountingKey = { userId: string; sessionId: string; turnId: string; attemptId: string };
export function preferredAttemptAccounting<T extends AttemptAccountingKey, U extends AttemptAccountingKey>(
  legacy: T | null, aggregate: U | null): T | U | null {
  if (legacy && aggregate && (legacy.userId !== aggregate.userId || legacy.sessionId !== aggregate.sessionId
    || legacy.turnId !== aggregate.turnId || legacy.attemptId !== aggregate.attemptId)) throw new Error('Mixed attempts.');
  return aggregate ?? legacy;
}
export interface CalendarAccountingStore {
  getBudget(userId: string, sessionId: string, turnId: string): Promise<CalendarTurnBudget | null>;
  createBudget(record: CalendarTurnBudget): Promise<CalendarTurnBudget>;
  compareAndSwapBudget(expectedRevision: number, next: CalendarTurnBudget): Promise<'confirmed' | 'conflict' | 'uncertain'>;
  putDispatch(record: CalendarModelDispatch): Promise<void>;
  getDispatch(userId: string, dispatchId: string): Promise<CalendarModelDispatch | null>;
  listDispatches(userId: string, turnId: string): Promise<CalendarModelDispatch[]>;
  putAggregate(record: CalendarModelAggregate): Promise<void>;
}

export { unavailableMoney };

export const modelDispatchV2Schema = z.object({ schemaVersion: z.literal(2), kind: z.literal('calendar-model-dispatch'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema, dispatchId: idSchema,
  decisionId: idSchema, dispatchIndex: z.number().int().min(1).max(8),
  reason: z.enum(['initial', 'continuation', 'schema-repair', 'provider-retry']), repairedDecisionId: idSchema.nullable(),
  requestedModel: z.string().min(1).max(200), reportedModel: z.string().min(1).max(200).nullable(),
  reportedProvider: z.string().min(1).max(200).nullable(), openRouterUser: idSchema,
  configRevision: z.number().int().nonnegative(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v2'),
  generationId: z.string().min(1).max(200).nullable(), providerRequestId: z.string().min(1).max(200).nullable(),
  status: z.enum(['reserved', 'dispatched', 'terminal', 'not-dispatched']),
  startedAt: isoDateSchema, endedAt: isoDateSchema.nullable(), firstOutputAt: isoDateSchema.nullable(),
  promptTokens: usageCountSchema, completionTokens: usageCountSchema, cachedPromptTokens: usageCountSchema,
  cacheWriteTokens: usageCountSchema, reasoningOutputTokens: usageCountSchema,
  money: moneyEvidenceSchema, pricing: tokenPricingSchema, reservationUsd: decimalSchema,
  reservationStatus: z.enum(['held', 'settled', 'released-not-dispatched']), failure: calendarFailureSchema.nullable(),
}).strict().refine(v => (v.reservationStatus !== 'settled' || v.money.costStatus === 'known')
  && (v.money.costStatus !== 'known' || v.reservationStatus === 'settled')
  && (v.reservationStatus !== 'released-not-dispatched' || v.status === 'not-dispatched')
  && (v.reason !== 'schema-repair' || v.repairedDecisionId !== null));
export type CalendarModelDispatchV2 = z.infer<typeof modelDispatchV2Schema>;
export const calendarBudgetDebitRequestSchema = z.object({
  userId: idSchema, sessionId: idSchema, turnId: idSchema, debitId: idSchema,
  kindOfDebit: z.enum(['logical-tool', 'create']),
  decisionId: idSchema.nullable().default(null), intentId: idSchema.nullable().default(null),
  change: z.object({
    logicalTools: z.number().int().min(0).max(6).default(0), creates: z.number().int().min(0).max(1).default(0),
    calendarRequests: z.number().int().min(0).max(20).default(0), refreshRequests: z.number().int().min(0).max(2).default(0),
  }).default({ logicalTools: 0, creates: 0, calendarRequests: 0, refreshRequests: 0 }),
}).strict();
export type CalendarBudgetDebitChange = z.input<typeof calendarBudgetDebitRequestSchema>['change'];
export type CalendarBudgetDebitRequest = z.input<typeof calendarBudgetDebitRequestSchema>
  & { clock?: () => number;
    /** Server-only CAS expectation; not part of the persisted/wire debit schema. */
    expectedBudget?: ConfirmedBudget };
export type CalendarBudgetDebitOutcome =
  | { outcome: 'confirmed'; debit: CalendarBudgetDebit; budget: CalendarTurnBudget; budgetReceipt?: ConfirmedBudget }
  | { outcome: 'duplicate'; debit: CalendarBudgetDebit; budget: CalendarTurnBudget; budgetReceipt?: ConfirmedBudget }
  | { outcome: 'conflict' };
export interface CalendarAccountingStoreV2 extends Omit<CalendarAccountingStore,
  'putDispatch' | 'getDispatch' | 'listDispatches'> {
  putDispatch(record: CalendarModelDispatchV2): Promise<void>;
  getDispatch(userId: string, dispatchId: string): Promise<CalendarModelDispatch | CalendarModelDispatchV2 | null>;
  listDispatches(userId: string, turnId: string): Promise<(CalendarModelDispatch | CalendarModelDispatchV2)[]>;
  debit(request: CalendarBudgetDebitRequest): Promise<CalendarBudgetDebitOutcome>;
  getDebit(userId: string, sessionId: string, turnId: string, debitId: string): Promise<CalendarBudgetDebit | null>;
  getBudgetConfirmed?(userId: string, sessionId: string, turnId: string): Promise<ConfirmedRecord<CalendarTurnBudget> | null>;
  createBudgetConfirmed?(record: CalendarTurnBudget): Promise<ConfirmedRecord<CalendarTurnBudget>>;
  getDispatchConfirmed?(userId: string, dispatchId: string): Promise<ConfirmedRecord<CalendarModelDispatchV2> | null>;
  reserveDispatchConfirmed?(
    record: CalendarModelDispatchV2,
    budget: ConfirmedRecord<CalendarTurnBudget>,
  ): Promise<{ dispatch: ConfirmedRecord<CalendarModelDispatchV2>; budget: ConfirmedRecord<CalendarTurnBudget> }>;
  updateDispatchConfirmed?(
    expectedDispatch: ConfirmedRecord<CalendarModelDispatchV2>,
    next: CalendarModelDispatchV2,
    expectedBudget: ConfirmedRecord<CalendarTurnBudget>,
  ): Promise<{ dispatch: ConfirmedRecord<CalendarModelDispatchV2>; budget: ConfirmedRecord<CalendarTurnBudget> }>;
  compareBudgetConfirmed?(
    expectedBudget: ConfirmedRecord<CalendarTurnBudget>,
    next: CalendarTurnBudget,
  ): Promise<CasConfirmation<CalendarTurnBudget>>;
}
export type ConfirmedBudget = ConfirmedRecord<CalendarTurnBudget>;
export type ConfirmedDispatch = ConfirmedRecord<CalendarModelDispatchV2>;
export type CalendarDispatchSave = {
  dispatch: ConfirmedDispatch;
  budget: ConfirmedBudget;
};
export interface CalendarAccountingStoreV2Tail {
}
