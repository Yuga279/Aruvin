/**
 * ============================================================================
 * FILE: prompt-caching.spec.ts
 * LOCATION: backend/test/model/prompt-caching.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify OpenRouter prompt caching serialization for configured Anthropic models.
 *
 * ROLE IN PROJECT:
 *    Ensures that top-level cache_control ephemeral breakpoints are serialized for
 *    supported Anthropic models across both text and calendar completion paths,
 *    while leaving non-Anthropic models completely unaffected and preserving all
 *    security, privacy, attribution, budget, and tool constraints.
 *
 * KEY COMPONENTS:
 *    - isAnthropicModel: Model identifier classifier for prompt caching eligibility.
 *    - buildBody prompt caching: Verifies text path serialization with and without cache_control.
 *    - buildCalendarBody prompt caching: Verifies calendar path serialization with and without cache_control.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { buildBody, isAnthropicModel, type ModelLimits, type ModelConfig } from '../../src/model/policy.js';
import { buildCalendarBody, type CalendarDispatchBindingV2 } from '../../src/model/calendar-policy.js';
import { SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { reserveUsd, tokenPricingSchema, type CalendarModelDispatchV2, type CalendarTurnBudget } from '../../src/contracts/calendar-accounting.js';
import { unavailableMoney } from '../../src/contracts/usage-evidence.js';
import type { ModelInvokeRequest } from '../../src/contracts/runtime.js';
import type { SkillDecisionRequest } from '../../src/contracts/calendar-model.js';

describe('Prompt caching model classification (isAnthropicModel)', () => {
  it.each([
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3.5-haiku',
    'anthropic/claude-3-opus',
    'anthropic/claude-3.7-sonnet',
    'anthropic/claude-3.5-sonnet:beta',
    'anthropic/claude-3-5-haiku-20241022',
    'Anthropic/claude-3.5-sonnet',
  ])('identifies Anthropic model: %s', (modelId) => {
    expect(isAnthropicModel(modelId)).toBe(true);
  });

  it.each([
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'openai/gpt-6-luna',
    'google/gemini-2.5-flash',
    'deepseek/deepseek-chat',
    'deepseek/deepseek-r1',
    'fixture/model',
    'not-anthropic/claude',
    'my-anthropic/model',
    '',
  ])('rejects non-Anthropic model: %s', (modelId) => {
    expect(isAnthropicModel(modelId)).toBe(false);
  });
});

describe('Text path prompt caching serialization (buildBody)', () => {
  const anthropicModelId = 'anthropic/claude-3.5-sonnet';
  const anthropicConfig: ModelConfig = loadConfig({
    OPENROUTER_API_KEY: 'fixture-key',
    OPENROUTER_MODEL: anthropicModelId,
  });
  const anthropicLimits: ModelLimits = {
    modelId: anthropicModelId,
    contextTokens: 32768,
    outputTokens: 4096,
    supportsMaxTokens: true,
    source: 'fixture',
  };
  const textRequest = (modelId: string = anthropicModelId): ModelInvokeRequest => ({
    modelId,
    user: anthropicConfig.identity.userId,
    messages: [
      { role: 'system', content: 'You are Aurvin.' },
      { role: 'user', content: 'Hello there.' },
    ],
    maxOutputTokens: 2048,
    abortSignal: new AbortController().signal,
    transforms: [],
    dataCollection: 'deny',
  });

  it('serializes top-level cache_control: { type: "ephemeral" } for Anthropic models', () => {
    const raw = buildBody(anthropicConfig, anthropicLimits, textRequest(anthropicModelId));
    const serialized = JSON.parse(JSON.stringify(raw));

    expect(serialized.cache_control).toEqual({ type: 'ephemeral' });
    expect(serialized.model).toBe(anthropicModelId);
    expect(serialized.user).toBe('aurvin-dev-user');
    expect(serialized.max_tokens).toBe(2048);
    expect(serialized.stream).toBe(true);
    expect(serialized.stream_options).toEqual({ include_usage: true });
    expect(serialized.transforms).toEqual([]);
    expect(serialized.provider).toEqual({ data_collection: 'deny', require_parameters: true });
    expect(serialized.plugins).toContainEqual({ id: 'context-compression', enabled: false });
    expect(serialized.messages).toEqual(textRequest().messages);

    // Private fields remain absent
    for (const field of ['models', 'route', 'tools', 'tool_choice', 'apiKey', 'reasoning', 'sessionId', 'trace']) {
      expect(serialized[field]).toBeUndefined();
    }
  });

  it('omits cache_control for non-Anthropic models on text path', () => {
    const nonAnthropicModelId = 'openai/gpt-4o-mini';
    const nonAnthropicConfig: ModelConfig = loadConfig({
      OPENROUTER_API_KEY: 'fixture-key',
      OPENROUTER_MODEL: nonAnthropicModelId,
    });
    const nonAnthropicLimits: ModelLimits = {
      modelId: nonAnthropicModelId,
      contextTokens: 32768,
      outputTokens: 4096,
      supportsMaxTokens: true,
      source: 'fixture',
    };

    const raw = buildBody(nonAnthropicConfig, nonAnthropicLimits, textRequest(nonAnthropicModelId));
    const serialized = JSON.parse(JSON.stringify(raw));

    expect(serialized.cache_control).toBeUndefined();
    expect(serialized.model).toBe(nonAnthropicModelId);
    expect(serialized.user).toBe('aurvin-dev-user');
    expect(serialized.transforms).toEqual([]);
    expect(serialized.provider).toEqual({ data_collection: 'deny', require_parameters: true });
  });

  it('omits cache_control for fixture/model on text path', () => {
    const fixtureConfig: ModelConfig = loadConfig({
      OPENROUTER_API_KEY: 'fixture-key',
      OPENROUTER_MODEL: 'fixture/model',
    });
    const fixtureLimits: ModelLimits = {
      modelId: 'fixture/model',
      contextTokens: 32768,
      outputTokens: 4096,
      supportsMaxTokens: true,
      source: 'fixture',
    };

    const raw = buildBody(fixtureConfig, fixtureLimits, textRequest('fixture/model'));
    const serialized = JSON.parse(JSON.stringify(raw));

    expect(serialized.cache_control).toBeUndefined();
    expect(serialized.model).toBe('fixture/model');
  });
});

describe('Calendar path prompt caching serialization (buildCalendarBody)', () => {
  const anthropicModelId = 'anthropic/claude-3.5-sonnet';
  const anthropicConfig: ModelConfig = loadConfig({
    OPENROUTER_API_KEY: 'fixture-key',
    OPENROUTER_MODEL: anthropicModelId,
  });

  const pricingFor = (modelId: string) => tokenPricingSchema.parse({
    version: 'fixture-v1',
    source: 'fixture',
    observedAt: '2026-10-20T00:00:00.000Z',
    modelId,
    providerRoute: 'fixture-route',
    promptUsdPerToken: '0.000001',
    completionUsdPerToken: '0.000002',
    requestUsd: '0',
  });

  const calendarLimitsFor = (modelId: string): ModelLimits => ({
    modelId,
    contextTokens: 32768,
    outputTokens: 4096,
    supportsMaxTokens: true,
    source: 'fixture',
    calendar: {
      tools: true,
      nativeStrict: false,
      parallelToolCallsParameter: false,
      pricing: pricingFor(modelId),
    },
  });

  const calendarBindingFor = (modelId: string): CalendarDispatchBindingV2 => {
    const userId = anthropicConfig.identity.userId;
    const pricing = pricingFor(modelId);
    const reservationUsd = reserveUsd(pricing, 20000, 256);
    const dispatch: CalendarModelDispatchV2 = {
      schemaVersion: 2,
      kind: 'calendar-model-dispatch',
      userId,
      sessionId: 'sess_fixture',
      turnId: 'turn_fixture',
      attemptId: 'att_fixture',
      dispatchId: 'dispatch_1',
      decisionId: 'decision_1',
      dispatchIndex: 1,
      reason: 'initial',
      repairedDecisionId: null,
      requestedModel: modelId,
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
      startedAt: '2026-10-20T00:00:00.000Z',
      endedAt: null,
      firstOutputAt: null,
      promptTokens: null,
      completionTokens: null,
      cachedPromptTokens: null,
      cacheWriteTokens: null,
      reasoningOutputTokens: null,
      money: unavailableMoney(true),
      pricing,
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
      revision: 1,
      modelDispatches: 1,
      repairs: 0,
      logicalTools: 0,
      creates: 0,
      calendarRequests: 0,
      refreshRequests: 0,
      deadlineAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-10-20T00:00:00.000Z',
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
  };

  const calendarRequestFor = (modelId: string): SkillDecisionRequest => ({
    dispatchId: 'dispatch_1',
    decisionId: 'decision_1',
    user: anthropicConfig.identity.userId,
    modelId,
    messages: [
      { role: 'system', content: 'Rules' },
      { role: 'user', content: 'Read event abcde' },
    ],
    tools: SKILL_NATIVE_TOOLS,
    maxOutputTokens: 256,
    remainingContextTokens: 20000,
    deadlineAt: '2099-01-01T00:00:00.000Z',
    signal: new AbortController().signal,
    dataCollection: 'deny',
    processingPolicyId: 'fixture-policy',
    repair: null,
  });

  it('serializes top-level cache_control: { type: "ephemeral" } for Anthropic calendar dispatch', () => {
    const limits = calendarLimitsFor(anthropicModelId);
    const req = calendarRequestFor(anthropicModelId);
    const binding = calendarBindingFor(anthropicModelId);

    const raw = buildCalendarBody(anthropicConfig, limits, req, binding);
    const serialized = JSON.parse(JSON.stringify(raw));

    expect(serialized.cache_control).toEqual({ type: 'ephemeral' });
    expect(serialized.model).toBe(anthropicModelId);
    expect(serialized.user).toBe(anthropicConfig.identity.userId);
    expect(serialized.stream).toBe(true);
    expect(serialized.stream_options).toEqual({ include_usage: true });
    expect(serialized.tools).toEqual(SKILL_NATIVE_TOOLS.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    })));
    expect(serialized.messages).toEqual(req.messages);

    // Private fields remain absent
    for (const field of ['session_id', 'sessionId', 'reasoning', 'tool_choice', 'connectionId',
      'processingPolicyId', 'accessToken', 'userId', 'trace', 'apiKey']) {
      expect(serialized[field]).toBeUndefined();
    }
  });

  it('omits cache_control for non-Anthropic model on calendar path', () => {
    const nonAnthropicModelId = 'openai/gpt-6-luna';
    const nonAnthropicConfig: ModelConfig = loadConfig({
      OPENROUTER_API_KEY: 'fixture-key',
      OPENROUTER_MODEL: nonAnthropicModelId,
    });
    const limits = calendarLimitsFor(nonAnthropicModelId);
    const req = calendarRequestFor(nonAnthropicModelId);
    const binding = calendarBindingFor(nonAnthropicModelId);

    const raw = buildCalendarBody(nonAnthropicConfig, limits, req, binding);
    const serialized = JSON.parse(JSON.stringify(raw));

    expect(serialized.cache_control).toBeUndefined();
    expect(serialized.model).toBe(nonAnthropicModelId);
    expect(serialized.user).toBe(nonAnthropicConfig.identity.userId);
    expect(serialized.tools).toBeDefined();
  });
});
