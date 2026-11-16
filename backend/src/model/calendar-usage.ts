import type { CalendarDispatchObservation } from '../contracts/calendar-model.js';
import { canonicalDecimal, decimalFromNumber, moneyEvidenceSchema, unavailableMoney, type MoneyEvidence } from '../contracts/usage-evidence.js';
import { AppError } from '../platform/errors/app-error.js';
import { identifier, number } from './accounting.js';
import { object } from './faults.js';

export function emptyCalendarObservation(): CalendarDispatchObservation {
  return { reportedModel: null, reportedProvider: null, generationId: null, providerRequestId: null,
    promptTokens: null, completionTokens: null, cachedPromptTokens: null, cacheWriteTokens: null,
    reasoningOutputTokens: null, money: unavailableMoney(true), firstOutputAt: null, endedAt: null };
}

function moneyFromCost(cost: unknown, previous: MoneyEvidence): MoneyEvidence {
  let amount: string | null = null;
  if (typeof cost === 'number') {
    if (Number.isFinite(cost) && cost >= 0) amount = decimalFromNumber(cost);
  } else if (typeof cost === 'string') {
    try { amount = canonicalDecimal(cost); } catch { amount = null; }
  }
  if (amount === null) return previous;
  if (previous.reportedAmount !== null && previous.reportedAmount !== amount) {
    throw new AppError('PROVIDER_ERROR', 'Provider accounting evidence disagreed.', false);
  }
  if (previous.reportedAmount === amount) return previous;
  return moneyEvidenceSchema.parse({
    currency: 'USD', reportedAmount: amount, estimatedAmount: null, costStatus: 'known',
    source: 'provider-response', observedAt: new Date().toISOString(), pricing: null,
  });
}

export function mergeCalendarObservation(previous: CalendarDispatchObservation, raw: unknown): CalendarDispatchObservation {
  const frame = object(raw);
  const usage = object(frame.usage);
  const prompt = object(usage.prompt_tokens_details);
  const completion = object(usage.completion_tokens_details);
  const generationId = identifier(frame.id);
  if (generationId && previous.generationId && generationId !== previous.generationId) {
    throw new AppError('PROVIDER_ERROR', 'The response identity changed.', false);
  }
  const requestId = identifier(frame.provider_request_id);
  return {
    reportedModel: identifier(frame.model) ?? previous.reportedModel,
    reportedProvider: identifier(frame.provider) ?? previous.reportedProvider,
    generationId: generationId ?? previous.generationId,
    providerRequestId: requestId ?? previous.providerRequestId,
    promptTokens: number(usage.prompt_tokens, true) ?? previous.promptTokens,
    completionTokens: number(usage.completion_tokens, true) ?? previous.completionTokens,
    cachedPromptTokens: number(prompt.cached_tokens, true) ?? previous.cachedPromptTokens,
    cacheWriteTokens: number(prompt.cache_write_tokens, true) ?? previous.cacheWriteTokens,
    reasoningOutputTokens: number(completion.reasoning_tokens, true) ?? previous.reasoningOutputTokens,
    money: usage.cost === undefined ? previous.money : moneyFromCost(usage.cost, previous.money),
    firstOutputAt: previous.firstOutputAt,
    endedAt: previous.endedAt,
  };
}
