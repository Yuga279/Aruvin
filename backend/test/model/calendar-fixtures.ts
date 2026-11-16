/**
 * ============================================================================
 * FILE: calendar-fixtures.ts
 * LOCATION: backend/test/model/calendar-fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Test harness and deterministic fixtures for calendar model policies and adapters.
 *
 * ROLE IN PROJECT:
 *    Provides mock pricing, model limits, sample requests, v2 model dispatches,
 *    and streaming harness for testing model transport, policy, and validation.
 *
 * KEY COMPONENTS:
 *    - calendarBinding: Constructs deterministic test CalendarDispatchBindingV2.
 *    - calendarHarness: Assembles OpenRouter mock fetcher and v2 calendar adapter.
 *    - calendarRequest: Generates valid test CalendarDecisionRequest payloads.
 * ============================================================================
 */

import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { CALENDAR_TOOLS, SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';
import { reserveUsd, tokenPricingSchema, type CalendarModelDispatchV2, type CalendarTurnBudget } from '../../src/contracts/calendar-accounting.js';
import { unavailableMoney } from '../../src/contracts/usage-evidence.js';
import type { CalendarDecisionRequest, SkillDecisionRequest } from '../../src/contracts/calendar-model.js';
import type { ModelLimits } from '../../src/model/policy.js';
import { createCalendarModelPortV2 } from '../../src/model/calendar-adapter.js';
import type { CalendarDispatchBindingV2 } from '../../src/model/calendar-policy.js';
import { config, response } from './helpers.js';

export const FIXTURE_CREATED_AT = '2026-10-20T00:00:00.000Z';
export const FIXTURE_DEADLINE_AT = '2099-01-01T00:00:00.000Z';

export const fixturePricing = tokenPricingSchema.parse({
  version: 'fixture-v1',
  source: 'fixture',
  observedAt: FIXTURE_CREATED_AT,
  modelId: 'fixture/model',
  providerRoute: 'fixture-route',
  promptUsdPerToken: '0.000001',
  completionUsdPerToken: '0.000002',
  requestUsd: '0',
});

export const calendarLimits: ModelLimits = {
  modelId: 'fixture/model',
  contextTokens: 32768,
  outputTokens: 4096,
  supportsMaxTokens: true,
  source: 'fixture',
  calendar: {
    tools: true,
    nativeStrict: false,
    parallelToolCallsParameter: false,
    pricing: fixturePricing,
  },
};

export function calendarRemainingContext(maxOutputTokens = 256): number {
  return config().budgets.maxContextTokens - maxOutputTokens - config().budgets.modelMarginTokens;
}

export function calendarRequest(signal = new AbortController().signal): CalendarDecisionRequest {
  return {
    dispatchId: 'dispatch_1',
    decisionId: 'decision_1',
    user: config().identity.userId,
    modelId: 'fixture/model',
    messages: [
      { role: 'system', content: 'Rules' },
      { role: 'user', content: 'Read event abcde' },
    ],
    tools: CALENDAR_TOOLS,
    maxOutputTokens: 256,
    remainingContextTokens: calendarRemainingContext(),
    deadlineAt: FIXTURE_DEADLINE_AT,
    signal,
    dataCollection: 'deny',
    processingPolicyId: 'fixture-policy',
    repair: null,
  };
}

export function calendarBinding(reason: CalendarModelDispatchV2['reason'] = 'initial'): CalendarDispatchBindingV2 {
  const userId = config().identity.userId;
  const schemaRepair = reason === 'schema-repair';
  const retry = reason === 'provider-retry' || reason === 'continuation' || schemaRepair;
  const dispatchIndex = retry ? 2 : 1;
  const repairs = schemaRepair ? 1 : 0;
  const dispatchId = schemaRepair ? 'dispatch_2' : retry && reason !== 'continuation' ? 'dispatch_2' : 'dispatch_1';
  const decisionId = schemaRepair ? 'decision_2' : 'decision_1';
  const reservationUsd = reserveUsd(fixturePricing, calendarRemainingContext(), 256);
  const dispatch: CalendarModelDispatchV2 = {
    schemaVersion: 2,
    kind: 'calendar-model-dispatch',
    userId,
    sessionId: 'sess_fixture',
    turnId: 'turn_fixture',
    attemptId: 'att_fixture',
    dispatchId: reason === 'continuation' ? 'dispatch_2' : dispatchId,
    decisionId: reason === 'continuation' ? 'decision_2' : decisionId,
    dispatchIndex,
    reason,
    repairedDecisionId: schemaRepair ? 'decision_1' : null,
    requestedModel: 'fixture/model',
    reportedModel: null,
    reportedProvider: null,
    openRouterUser: userId,
    configRevision: 1,
    connectionId: 'conn_fixture',
    connectionRevision: 1,
    schemaRevision: 'google-calendar.v2',
    generationId: null,
    providerRequestId: null,
    status: 'reserved',
    startedAt: FIXTURE_CREATED_AT,
    endedAt: null,
    firstOutputAt: null,
    promptTokens: null,
    completionTokens: null,
    cachedPromptTokens: null,
    cacheWriteTokens: null,
    reasoningOutputTokens: null,
    money: unavailableMoney(true),
    pricing: fixturePricing,
    reservationUsd,
    reservationStatus: 'held',
    failure: null,
  };
  const budget: CalendarTurnBudget = {
    schemaVersion: 1,
    kind: 'calendar-turn-budget',
    userId,
    sessionId: 'sess_fixture',
    turnId: 'turn_fixture',
    revision: dispatchIndex,
    modelDispatches: dispatchIndex,
    repairs,
    logicalTools: 0,
    creates: 0,
    calendarRequests: 0,
    refreshRequests: 0,
    deadlineAt: FIXTURE_DEADLINE_AT,
    createdAt: FIXTURE_CREATED_AT,
    settledUsd: '0',
    reservedUsd: reservationUsd,
  };
  return {
    dispatch,
    budget,
    limits: { ...CALENDAR_LIMITS },
    processingPolicyId: 'fixture-policy',
    hooks: {
      beforeDispatch: async () => undefined,
      onObservation: async () => undefined,
    },
  };
}

export function skillRequest(signal = new AbortController().signal): SkillDecisionRequest {
  return { ...calendarRequest(signal), tools: SKILL_NATIVE_TOOLS };
}

export const skillWire = (name: 'activate_skill' | 'call_tool', args: string, terminal = 'tool_calls') =>
  nativeFrame({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function',
    function: { name, arguments: args } }] })
  + nativeFrame({}, terminal) + 'data: [DONE]\n\n';
export const skillNativeWire = (args: string, terminal = 'tool_calls') => skillWire('call_tool',
  `{"plugin":"google-calendar","tool":"calendar_get_event","arguments":${args}}`, terminal);

export const nativeFrame = (delta: unknown, finish: string | null = null) =>
  'data: ' + JSON.stringify({ id: 'gen_fixture', model: 'fixture/model', provider: 'Fixture',
    choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n';
export const nativeWire = (args: string, terminal = 'tool_calls') =>
  nativeFrame({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function',
    function: { name: 'calendar_get_event', arguments: args } }] })
  + nativeFrame({}, terminal) + 'data: [DONE]\n\n';

export function calendarHarness(wire: string) {
  const binding = calendarBinding();
  binding.hooks.beforeDispatch = vi.fn().mockResolvedValue(undefined);
  binding.hooks.onObservation = vi.fn().mockResolvedValue(undefined);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(wire));
  const adapter = createCalendarModelPortV2(config(), calendarLimits, binding, fetcher);
  return { adapter, binding, fetcher };
}

