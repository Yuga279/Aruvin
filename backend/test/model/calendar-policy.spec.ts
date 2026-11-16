/**
 * ============================================================================
 * FILE: calendar-policy.spec.ts
 * LOCATION: backend/test/model/calendar-policy.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for model calendar request admission, body construction, and policy bounds.
 *
 * ROLE IN PROJECT:
 *    Verifies that requests to OpenRouter strictly enforce v2 charged dispatches,
 *    token estimations, exact tool catalogues, and pricing consistency.
 *
 * KEY COMPONENTS:
 *    - buildCalendarBody: Tests serialization, schema verification, and admission checks.
 *    - estimateCalendarInput: Tests token reservation estimation.
 * ============================================================================
 */

import { buildCalendarBody, estimateCalendarInput } from '../../src/model/calendar-policy.js';
import { CALENDAR_TOOLS, SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { repairInstruction } from '../../src/model/calendar-repair.js';
import { config } from './helpers.js';
import { skillRequest as calendarRequest, calendarBinding, calendarLimits, fixturePricing } from './calendar-fixtures.js';
import type { CompleteCalendarToolGroup } from '../../src/contracts/calendar-model.js';

const group: CompleteCalendarToolGroup = {
  assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call_old', type: 'function',
    function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde"}' } }] },
  result: { role: 'tool', tool_call_id: 'call_old', name: 'calendar_get_event', content: '{"ok":true}' },
  sources: [],
};

function bodyOf(request: Parameters<typeof buildCalendarBody>[2] = calendarRequest(),
  binding = calendarBinding(), limits = calendarLimits) {
  return JSON.parse(JSON.stringify(buildCalendarBody(config(), limits, request, binding)));
}

describe('Calendar request admission', () => {
  it('serializes only admitted native Calendar requests', () => {
    const request = calendarRequest();
    const body = buildCalendarBody(config(), calendarLimits, request, calendarBinding());
    expect(body).toMatchObject({ user: config().identity.userId, model: 'fixture/model',
      max_tokens: 256, transforms: [], provider: { data_collection: 'deny', require_parameters: true } });
    expect(body.messages).toEqual(request.messages);
    expect(body.tools).toEqual(SKILL_NATIVE_TOOLS.map(t => ({ type: 'function', function: {
      name: t.name, description: t.description, parameters: t.inputSchema,
    } })));
    expect(() => buildCalendarBody(config(), calendarLimits, { ...request, user: 'other' }, calendarBinding())).toThrow();
    expect(() => buildCalendarBody(config(), calendarLimits, { ...request, remainingContextTokens: 1 }, calendarBinding())).toThrow();
  });

  it('forwards native assistant/tool groups unchanged and omits private fields', () => {
    const request = { ...calendarRequest(), messages: [
      { role: 'system' as const, content: 'Rules' },
      { role: 'user' as const, content: 'Read event abcde' },
      group.assistant,
      group.result,
    ] };
    const body = bodyOf(request);
    expect(body.messages).toEqual(request.messages);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.plugins).toContainEqual({ id: 'context-compression', enabled: false });
    for (const field of ['session_id', 'sessionId', 'reasoning', 'tool_choice', 'connectionId',
      'processingPolicyId', 'accessToken', 'userId', 'trace', 'apiKey']) {
      expect(body[field]).toBeUndefined();
    }
    expect(JSON.stringify(body)).not.toContain('fixture-policy');
    expect(JSON.stringify(body)).not.toContain('conn_fixture');
    expect(body.tools.every((t: { function: { revision?: unknown } }) => t.function.revision === undefined)).toBe(true);
  });

  it('does not force tool_choice for eligible general questions, but refuses an empty tool array', () => {
    const body = bodyOf();
    expect(body.tool_choice).toBeUndefined();
    expect(body.user).toBe(config().identity.userId);
    expect(body.tools).toHaveLength(2);
    expect(() => bodyOf({ ...calendarRequest(), tools: [] })).toThrow();
  });

  it('emits parallel_tool_calls false only when catalogue evidence reports the parameter', () => {
    const limits = { ...calendarLimits, calendar: { ...calendarLimits.calendar!, parallelToolCallsParameter: true } };
    const body = buildCalendarBody(config(), limits, calendarRequest(), calendarBinding());
    expect(body.parallel_tool_calls).toBe(false);
    expect(bodyOf().parallel_tool_calls).toBeUndefined();
  });

  it('requires a matching repair instruction as the final message', () => {
    const diagnostics = [{ path: 'eventId' as const, code: 'missing' as const, expected: 'string' as const }];
    const binding = calendarBinding('schema-repair');
    const request = {
      ...calendarRequest(),
      dispatchId: binding.dispatch.dispatchId,
      decisionId: binding.dispatch.decisionId,
      repair: { rejectedDecisionId: 'decision_1', diagnostics },
      messages: [
        { role: 'system' as const, content: 'Rules' },
        { role: 'user' as const, content: 'Read event abcde' },
        { role: 'system' as const, content: repairInstruction(diagnostics) },
      ],
    };
    expect(bodyOf(request, binding).messages.at(-1)).toEqual({ role: 'system', content: repairInstruction(diagnostics) });
    expect(() => bodyOf({ ...request, messages: request.messages.slice(0, -1) }, binding)).toThrow();
    expect(() => bodyOf({ ...request, messages: [...request.messages.slice(0, -1), { role: 'system', content: 'tampered' }] }, binding)).toThrow();
  });

  it.each([
    ['identity mismatch', (r: ReturnType<typeof calendarRequest>) => ({ ...r, user: 'browser-user' })],
    ['model mismatch', (r: ReturnType<typeof calendarRequest>) => ({ ...r, modelId: 'other/model' })],
    ['dispatch mismatch', (r: ReturnType<typeof calendarRequest>) => ({ ...r, dispatchId: 'dispatch_x' })],
    ['decision mismatch', (r: ReturnType<typeof calendarRequest>) => ({ ...r, decisionId: 'decision_x' })],
    ['policy mismatch', (r: ReturnType<typeof calendarRequest>) => ({ ...r, processingPolicyId: 'other-policy' })],
    ['data collection', (r: ReturnType<typeof calendarRequest>) => ({ ...r, dataCollection: 'deny' as const, user: config().identity.userId })],
  ])('rejects %s before Fetch', (name, change) => {
    const request = change(calendarRequest());
    if (name === 'data collection') {
      expect(() => buildCalendarBody({ ...config(), openRouter: { ...config().openRouter, dataCollection: 'allow' } },
        calendarLimits, request, calendarBinding())).toThrow();
      return;
    }
    expect(() => bodyOf(request)).toThrow();
  });

  it('rejects absent calendar evidence, pricing mismatch, unsupported and forged tools', () => {
    const request = calendarRequest();
    const binding = calendarBinding();
    expect(() => buildCalendarBody(config(), { ...calendarLimits, calendar: undefined }, request, binding)).toThrow();
    expect(() => buildCalendarBody(config(), {
      ...calendarLimits,
      calendar: { ...calendarLimits.calendar!, pricing: { ...fixturePricing, promptUsdPerToken: '0.9' } },
    }, request, binding)).toThrow();
    expect(() => bodyOf({ ...request, tools: [{ ...SKILL_NATIVE_TOOLS[0], name: 'calendar_delete_event' }] as never })).toThrow();
    expect(() => bodyOf({ ...request, tools: [{ ...SKILL_NATIVE_TOOLS[0], inputSchema: { ...SKILL_NATIVE_TOOLS[0].inputSchema, additionalProperties: true as const } }] })).toThrow();
    expect(() => bodyOf({ ...request, tools: [...SKILL_NATIVE_TOOLS, SKILL_NATIVE_TOOLS[0]] })).toThrow();
    expect(() => bodyOf({ ...request, tools: [SKILL_NATIVE_TOOLS[0], SKILL_NATIVE_TOOLS[0]] })).toThrow();
  });

  it('rejects unheld reservations, expired deadlines, 8th-cap overflow and spend breaches', () => {
    const binding = calendarBinding();
    expect(() => bodyOf(calendarRequest(), { ...binding, dispatch: { ...binding.dispatch, reservationStatus: 'settled', money: { ...binding.dispatch.money, costStatus: 'known', reportedAmount: '0.1', source: 'provider-response', observedAt: '2026-10-20T00:00:00.000Z' } } })).toThrow();
    expect(() => bodyOf(calendarRequest(), { ...binding, dispatch: { ...binding.dispatch, reservationStatus: 'released-not-dispatched', status: 'not-dispatched' } })).toThrow();
    expect(() => bodyOf({ ...calendarRequest(), deadlineAt: '2020-01-01T00:00:00.000Z' }, { ...binding, budget: { ...binding.budget, deadlineAt: '2020-01-01T00:00:00.000Z' } })).toThrow();
    expect(() => bodyOf(calendarRequest(), { ...binding, dispatch: { ...binding.dispatch, dispatchIndex: 8 }, budget: { ...binding.budget, modelDispatches: 8 }, limits: { ...CALENDAR_LIMITS, modelDispatches: 7 } })).toThrow();
    expect(() => bodyOf(calendarRequest(), { ...binding, budget: { ...binding.budget, repairs: 2 }, limits: { ...CALENDAR_LIMITS, repairs: 1 } })).toThrow();
    expect(() => bodyOf(calendarRequest(), { ...binding, dispatch: { ...binding.dispatch, reservationUsd: '0.0000001' } })).toThrow();
    expect(() => bodyOf(calendarRequest(), { ...binding, limits: { ...CALENDAR_LIMITS, modelSpendUsd: '0.0000001' } })).toThrow();
  });

  it('rejects unmatched groups and reduced input/output/byte allowances', () => {
    const unmatched = { ...calendarRequest(), messages: [
      { role: 'system' as const, content: 'Rules' },
      { role: 'user' as const, content: 'Read event abcde' },
      group.assistant,
    ] };
    expect(() => bodyOf(unmatched)).toThrow();
    expect(() => bodyOf({ ...calendarRequest(), maxOutputTokens: 4097 })).toThrow();
    expect(() => bodyOf({ ...calendarRequest(), remainingContextTokens: 0 })).toThrow();
    const tiny = { ...calendarBinding(), limits: { ...CALENDAR_LIMITS, argumentBytes: 8 } };
    const withGroup = { ...calendarRequest(), messages: [
      { role: 'system' as const, content: 'Rules' },
      { role: 'user' as const, content: 'Read event abcde' },
      group.assistant,
      group.result,
    ] };
    expect(() => bodyOf(withGroup, tiny)).toThrow();
  });

  it('rejects schema-repair without charged provenance and accepts an already charged second correction', () => {
    const diagnostics = [{ path: 'eventId' as const, code: 'missing' as const, expected: 'string' as const }];
    const repairMessage = { role: 'system' as const, content: repairInstruction(diagnostics) };
    const initial = calendarBinding();
    expect(() => bodyOf({
      ...calendarRequest(),
      repair: { rejectedDecisionId: 'decision_1', diagnostics },
      messages: [...calendarRequest().messages, repairMessage],
    }, initial)).toThrow();
    const second = calendarBinding('schema-repair');
    second.budget.repairs = 2;
    second.budget.modelDispatches = 2;
    second.dispatch.dispatchIndex = 2;
    const request = {
      ...calendarRequest(),
      dispatchId: second.dispatch.dispatchId,
      decisionId: second.dispatch.decisionId,
      repair: { rejectedDecisionId: 'decision_1', diagnostics },
      messages: [...calendarRequest().messages, repairMessage],
    };
    expect(bodyOf(request, second).user).toBe(config().identity.userId);
  });

  it('exports a conservative input estimate used for reservations', () => {
    const estimate = estimateCalendarInput(calendarRequest().messages, SKILL_NATIVE_TOOLS);
    expect(estimate).toBeGreaterThan(64);
    expect(Number.isInteger(estimate)).toBe(true);
    const needed = estimate + 256 + config().budgets.modelMarginTokens;
    expect(needed).toBeLessThanOrEqual(Math.min(config().budgets.maxContextTokens, calendarLimits.contextTokens));
  });

  it('requires the exact ordered stable pair and preserves it across appended results', () => {
    const first = calendarRequest();
    const tools = SKILL_NATIVE_TOOLS.map(t => ({ type: 'function', function: {
      name: t.name, description: t.description, parameters: t.inputSchema } }));
    expect(bodyOf({ ...first, tools: SKILL_NATIVE_TOOLS }).tools).toEqual(tools);
    const continued = { ...first, tools: SKILL_NATIVE_TOOLS, messages: [...first.messages,
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 'load_1', type: 'function' as const,
        function: { name: 'activate_skill' as const, arguments: '{"plugin":"google-calendar","tools":"all"}' } }] },
      { role: 'tool' as const, tool_call_id: 'load_1', name: 'activate_skill' as const,
        content: '{"kind":"fixture-disclosure"}' }] };
    expect(JSON.stringify(bodyOf(continued).tools)).toBe(JSON.stringify(tools));
    expect(bodyOf(continued).messages.slice(0, first.messages.length)).toEqual(first.messages);
    for (const invalid of [[], [SKILL_NATIVE_TOOLS[0]], [...SKILL_NATIVE_TOOLS].reverse(),
      [...SKILL_NATIVE_TOOLS, SKILL_NATIVE_TOOLS[0]], CALENDAR_TOOLS]) {
      expect(() => bodyOf({ ...first, tools: invalid as never })).toThrow();
    }
    const mutated = structuredClone(SKILL_NATIVE_TOOLS);
    (mutated[0] as { description: string }).description = 'changed';
    expect(() => bodyOf({ ...first, tools: mutated })).toThrow();
  });

  it('requires a v2 charged dispatch for the five-tool catalogue', () => {
    const request = calendarRequest();
    const binding = calendarBinding();
    const body = buildCalendarBody(config(), calendarLimits, request, binding);
    expect((body.tools as Array<{ function: { name: string; parameters: unknown } }>).map(t => t.function.name))
      .toEqual(['activate_skill', 'call_tool']);
    expect(body.user).toBe(config().identity.userId);
    const before = structuredClone(binding.budget);
    expect(() => buildCalendarBody(config(), calendarLimits, request, { ...binding,
      dispatch: { ...binding.dispatch, schemaVersion: 1, schemaRevision: 'google-calendar.v1' } as never }))
      .toThrow();
    expect(binding.budget).toEqual(before);
  });
});
