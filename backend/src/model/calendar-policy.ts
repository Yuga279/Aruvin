/**
 * ============================================================================
 * FILE: calendar-policy.ts
 * LOCATION: backend/src/model/calendar-policy.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Model request admission policy, input token estimation, and tool dispatch bounds.
 *
 * ROLE IN PROJECT:
 *    Validates calendar model requests against OpenRouter parameters, charged turn
 *    budgets, token limits, and ensures only admitted native requests enter dispatch.
 *
 * KEY COMPONENTS:
 *    - buildCalendarBody: Serializes and bounds OpenRouter chat completion requests.
 *    - estimateCalendarInput: Conservative byte/token input estimator for reservations.
 *    - CalendarDispatchBindingV2: Typed binding holding v2 dispatch, budget, and hooks.
 * ============================================================================
 */

import { AppError } from '../platform/errors/app-error.js';
import { calendarLimitsSchema, type CalendarLimits } from '../contracts/calendar-policy.js';
import { SKILL_NATIVE_TOOLS, type SkillNativeDefinition } from '../contracts/calendar-tools.js';
import { modelDispatchV2Schema, turnBudgetRecordSchema, reserveUsd, withinSpendCap,
  type CalendarModelDispatch, type CalendarModelDispatchV2, type CalendarTurnBudget } from '../contracts/calendar-accounting.js';
import { nativeModelMessageSchema, type CalendarDecisionRequest, type CalendarDispatchObservation,
  type NativeCalendarModelMessage, type SkillDecisionRequest } from '../contracts/calendar-model.js';
import { providerParameters, type ModelConfig, type ModelLimits } from './policy.js';
import { assertNativeHistory, repairInstruction } from './calendar-repair.js';

export type CalendarDispatchHooks = {
  beforeDispatch(): Promise<void>;
  onObservation(observation: CalendarDispatchObservation): Promise<void>;
  enqueueObservation?(observation: CalendarDispatchObservation): void;
  flushObservations?(): Promise<void>;
  checkObservations?(): void;
};
export type CalendarDispatchBindingV2 = {
  dispatch: CalendarModelDispatchV2; budget: CalendarTurnBudget; limits: CalendarLimits;
  processingPolicyId: string; hooks: CalendarDispatchHooks;
};
export type CalendarDispatchBinding = CalendarDispatchBindingV2 | {
  dispatch: CalendarModelDispatch; budget: CalendarTurnBudget; limits: CalendarLimits;
  processingPolicyId: string; hooks: CalendarDispatchHooks;
};

type ModelToolDefinition = { name: string; description: string; inputSchema: unknown };
const nativeDefinitions = (tools: readonly ModelToolDefinition[]) => tools.map(t => ({
  type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));

export function estimateCalendarInput(messages: readonly NativeCalendarModelMessage[],
  tools: readonly ModelToolDefinition[]): number {
  const nativeTools = nativeDefinitions(tools);
  // ponytail: conservative byte-based reservation, not tokenizer certification;
  // retain the margin and replace with a verified tokenizer if needed.
  return 64 + Buffer.byteLength(JSON.stringify({ messages, tools: nativeTools }), 'utf8') + messages.length * 32;
}

function samePricing(left: CalendarModelDispatchV2['pricing'], right: CalendarModelDispatchV2['pricing']): boolean {
  return left.modelId === right.modelId && left.providerRoute === right.providerRoute && left.version === right.version
    && left.promptUsdPerToken === right.promptUsdPerToken && left.completionUsdPerToken === right.completionUsdPerToken
    && left.requestUsd === right.requestUsd;
}

function assertTools(tools: readonly ModelToolDefinition[]): asserts tools is readonly SkillNativeDefinition[] {
  if (JSON.stringify(tools) !== JSON.stringify(SKILL_NATIVE_TOOLS)) {
    throw new AppError('INVALID_REQUEST', 'The calendar request is invalid.', false);
  }
}

function assertGroupBytes(messages: readonly NativeCalendarModelMessage[], limits: CalendarLimits): void {
  for (const message of messages) {
    if ('tool_calls' in message) {
      const args = message.tool_calls[0]?.function.arguments ?? '';
      if (Buffer.byteLength(args, 'utf8') > limits.argumentBytes) {
        throw new AppError('INPUT_TOO_LARGE', 'A chat message is too large.', false);
      }
    }
    if (message.role === 'tool' && Buffer.byteLength(message.content, 'utf8') > limits.resultBytes) {
      throw new AppError('INPUT_TOO_LARGE', 'A chat message is too large.', false);
    }
  }
}

export function buildCalendarBody(config: ModelConfig, limits: ModelLimits,
  request: CalendarDecisionRequest | SkillDecisionRequest, binding: CalendarDispatchBinding): Record<string, unknown> {
  const configError = () => { throw new AppError('CONFIGURATION_ERROR', 'The model configuration is unavailable.', false); };
  const invalid = () => { throw new AppError('INVALID_REQUEST', 'The calendar request is invalid.', false); };
  if (!config.openRouter.apiKey || !config.openRouter.modelId || config.openRouter.modelId.length > 200
    || !config.openRouter.disableTransforms || limits.modelId !== config.openRouter.modelId
    || !Number.isSafeInteger(limits.contextTokens) || !Number.isSafeInteger(limits.outputTokens)
    || limits.contextTokens < config.budgets.maxContextTokens || limits.outputTokens < config.budgets.maxOutputTokens
    || !limits.supportsMaxTokens) configError();
  if (request.modelId !== config.openRouter.modelId || request.user !== config.identity.userId || !request.user
    || request.user.length > 128 || request.dataCollection !== 'deny'
    || request.dataCollection !== config.openRouter.dataCollection) configError();
  const d = binding.dispatch as { schemaRevision?: string; schemaVersion?: number };
  if (d.schemaRevision === 'google-calendar.v1' || d.schemaVersion === 1) {
    invalid();
  }
  const dispatch = modelDispatchV2Schema.parse(binding.dispatch);
  const budget = turnBudgetRecordSchema.parse(binding.budget);
  const effective = calendarLimitsSchema.parse(binding.limits);
  if (dispatch.userId !== budget.userId || dispatch.sessionId !== budget.sessionId || dispatch.turnId !== budget.turnId
    || dispatch.userId !== request.user || dispatch.openRouterUser !== request.user
    || dispatch.requestedModel !== request.modelId || dispatch.dispatchId !== request.dispatchId
    || dispatch.decisionId !== request.decisionId || request.deadlineAt !== budget.deadlineAt
    || request.processingPolicyId !== binding.processingPolicyId || !request.processingPolicyId
    || dispatch.dispatchIndex !== budget.modelDispatches || dispatch.dispatchIndex > effective.modelDispatches
    || budget.repairs > effective.repairs) invalid();
  if (dispatch.reservationStatus !== 'held' || (dispatch.status !== 'reserved' && dispatch.status !== 'dispatched')) invalid();
  if (!limits.calendar?.tools || !samePricing(limits.calendar.pricing, dispatch.pricing)
    || dispatch.pricing.modelId !== request.modelId) configError();
  const deadline = Date.parse(request.deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) invalid();
  if (request.repair) {
    if (dispatch.reason !== 'schema-repair' && dispatch.reason !== 'provider-retry') invalid();
    if (dispatch.repairedDecisionId !== request.repair.rejectedDecisionId || budget.repairs < 1) invalid();
    const last = request.messages.at(-1);
    if (!last || last.role !== 'system' || !('content' in last)
      || last.content !== repairInstruction(request.repair.diagnostics)) invalid();
  } else if (dispatch.reason === 'schema-repair' || dispatch.repairedDecisionId !== null) invalid();
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0
    || request.maxOutputTokens > config.budgets.maxOutputTokens
    || request.maxOutputTokens > limits.outputTokens) {
    throw new AppError('INVALID_REQUEST', 'The output limit is invalid.', false);
  }
  if (!request.messages.length || request.messages.length > config.budgets.maxMessagesInContext) {
    throw new AppError('CONTEXT_BUDGET_EXCEEDED', 'This chat is too long. Start a new chat.', false);
  }
  assertTools(request.tools);
  assertNativeHistory(request.messages);
  assertGroupBytes(request.messages, effective);
  for (const message of request.messages) {
    if (message.role !== 'tool' && !('tool_calls' in message)) {
      const bytes = Buffer.byteLength(message.content, 'utf8');
      if (bytes > config.budgets.maxMessageBytes) throw new AppError('INPUT_TOO_LARGE', 'A chat message is too large.', false);
    }
  }
  const lastUser = [...request.messages].reverse().find(message => message.role === 'user' && !('tool_calls' in message));
  if (!lastUser || lastUser.role !== 'user' || lastUser.content.length > config.budgets.maxInputChars
    || Buffer.byteLength(lastUser.content, 'utf8') > config.budgets.maxInputTokens) {
    throw new AppError('INPUT_TOO_LARGE', 'The chat input is too large.', false);
  }
  const estimate = estimateCalendarInput(request.messages, request.tools);
  if (estimate > request.remainingContextTokens) {
    throw new AppError('CONTEXT_BUDGET_EXCEEDED', 'This chat is too long. Start a new chat.', false);
  }
  const ceiling = Math.min(config.budgets.maxContextTokens, limits.contextTokens);
  if (estimate + request.maxOutputTokens + config.budgets.modelMarginTokens > ceiling) {
    throw new AppError('CONTEXT_BUDGET_EXCEEDED', 'This chat is too long. Start a new chat.', false);
  }
  const needed = reserveUsd(dispatch.pricing, estimate, request.maxOutputTokens);
  const admitted = withinSpendCap(budget.settledUsd, budget.reservedUsd, '0', effective.modelSpendUsd)
    && withinSpendCap('0', '0', needed, dispatch.reservationUsd)
    && withinSpendCap('0', '0', dispatch.reservationUsd, budget.reservedUsd);
  if (!admitted) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The model budget is exhausted.', false);
  const tools = nativeDefinitions(SKILL_NATIVE_TOOLS);
  return { ...providerParameters(config, request),
    messages: request.messages.map(m => nativeModelMessageSchema.parse(m)),
    tools,
    ...(limits.calendar?.parallelToolCallsParameter ? { parallel_tool_calls: false } : {}),
    stream: true, stream_options: { include_usage: true } };
}
