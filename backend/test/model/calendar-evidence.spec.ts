// Verifies frozen Calendar price pins and catalogue admission: a frozen price
// is admitted only when the live catalogue agrees, a price change disables
// that pin instead of mis-costing it, and models without a pin still admit
// from live catalogue tools/prices.

import { loadModelLimits } from '../../src/model/catalogue.js';
import {
  CALENDAR_DEFAULT_PROVIDER_ROUTE,
  CALENDAR_EVIDENCE_VERSION,
  CALENDAR_NATIVE_STRICT,
  CALENDAR_PARALLEL_TOOL_CALLS_PARAMETER,
  CALENDAR_PRICE_TABLE,
  calendarEvidenceFor,
} from '../../src/model/calendar-evidence.js';
import { tokenPricingSchema } from '../../src/contracts/calendar-accounting.js';
import { decimalSchema } from '../../src/contracts/usage-evidence.js';
import { loadConfig } from '../../src/platform/config/load-config.js';

const MODEL_ID = 'openai/gpt-6-luna';
const FROZEN = CALENDAR_PRICE_TABLE[MODEL_ID];

const modelConfig = () => loadConfig({ OPENROUTER_API_KEY: 'fixture-key', OPENROUTER_MODEL: MODEL_ID });
const evidence = () => calendarEvidenceFor(MODEL_ID) ?? undefined;

/** Mirrors the live catalogue entry observed on 2026-10-22, including the fields Aurvin ignores. */
const catalogueEntry = (overrides: Record<string, unknown> = {}) => ({
  id: MODEL_ID,
  context_length: 1050000,
  top_provider: { context_length: 1050000, max_completion_tokens: 128000, is_moderated: true },
  supported_parameters: ['include_reasoning', 'max_completion_tokens', 'max_tokens', 'reasoning',
    'reasoning_effort', 'response_format', 'seed', 'structured_outputs', 'tool_choice', 'tools', 'verbosity'],
  pricing: {
    prompt: FROZEN.promptUsdPerToken,
    completion: FROZEN.completionUsdPerToken,
    web_search: '0.01',
    input_cache_read: '0.00000001',
    input_cache_write: '0.000000125',
    overrides: [{ min_prompt_tokens: 272000, prompt: '0.0000002', completion: '0.00000075',
      input_cache_read: '0.00000002', input_cache_write: '0.00000025' }],
  },
  ...overrides,
});

const catalogueFetch = (entry: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [entry] })));

it('returns the frozen evidence for a known model', () => {
  const found = calendarEvidenceFor(MODEL_ID);
  expect(found).not.toBeNull();
  expect(found?.pricing).toEqual({
    version: CALENDAR_EVIDENCE_VERSION,
    source: 'OpenRouter GET /api/v1/models catalogue entry openai/gpt-6-luna, observed 2026-10-22',
    observedAt: '2026-10-22T00:00:00.000Z',
    modelId: MODEL_ID,
    providerRoute: CALENDAR_DEFAULT_PROVIDER_ROUTE,
    promptUsdPerToken: '0.0000001',
    completionUsdPerToken: '0.0000005',
    requestUsd: '0',
  });
  expect(found?.nativeStrict).toBe(CALENDAR_NATIVE_STRICT);
  expect(found?.parallelToolCallsParameter).toBe(CALENDAR_PARALLEL_TOOL_CALLS_PARAMETER);
  expect(found?.pricing).toBe(FROZEN);
});

it('returns no evidence for an unknown model', () => {
  expect(calendarEvidenceFor('openai/gpt-6-luna-typo')).toBeNull();
  expect(calendarEvidenceFor('')).toBeNull();
  expect(calendarEvidenceFor('constructor')).toBeNull();
  expect(calendarEvidenceFor('toString')).toBeNull();
  expect(calendarEvidenceFor('__proto__')).toBeNull();
});

it('admits the model for Calendar when the catalogue lists tools and matching prices', async () => {
  const fetcher = catalogueFetch(catalogueEntry());
  const limits = await loadModelLimits(modelConfig(), new AbortController().signal, fetcher, evidence());
  expect(limits.calendar).toBeDefined();
  expect(limits.calendar?.tools).toBe(true);
  expect(limits.calendar?.pricing).toEqual(FROZEN);
  expect(limits.calendar?.nativeStrict).toBe(false);
  expect(limits.calendar?.parallelToolCallsParameter).toBe(false);
  expect(fetcher.mock.calls[0]?.[1]?.method).not.toBe('POST');
});

it('admits a model that does not list parallel_tool_calls because Aurvin omits it', async () => {
  const entry = catalogueEntry();
  expect(entry.supported_parameters).not.toContain('parallel_tool_calls');
  const limits = await loadModelLimits(modelConfig(), new AbortController().signal,
    catalogueFetch(entry), evidence());
  expect(limits.calendar?.tools).toBe(true);
  expect(limits.calendar?.parallelToolCallsParameter).toBe(false);
});

const rejectionCases: [string, Record<string, unknown>][] = [
  ['the catalogue drops tools support', { supported_parameters: ['max_tokens', 'structured_outputs'] }],
  ['the catalogue raises the prompt price', { pricing: { prompt: '0.0000002', completion: '0.0000005' } }],
  ['the catalogue raises the completion price', { pricing: { prompt: '0.0000001', completion: '0.000001' } }],
  ['the catalogue adds a request fee Aurvin cannot cite', { pricing: { prompt: '0.0000001', completion: '0.0000005', request: '0.0001' } }],
];

it.each(rejectionCases)('disables the plugin when %s', async (_case, overrides) => {
  const limits = await loadModelLimits(modelConfig(), new AbortController().signal,
    catalogueFetch(catalogueEntry(overrides)), evidence());
  expect(limits.calendar).toBeUndefined();
  expect(limits.modelId).toBe(MODEL_ID);
  expect(limits.contextTokens).toBe(1050000);
  expect(limits.outputTokens).toBe(128000);
  expect(limits.supportsMaxTokens).toBe(true);
});

it('keeps the ordinary text path when the catalogue does not advertise tools', async () => {
  const limits = await loadModelLimits(modelConfig(), new AbortController().signal,
    catalogueFetch(catalogueEntry({ supported_parameters: ['max_tokens'] })));
  expect(limits.calendar).toBeUndefined();
  expect(limits.modelId).toBe(MODEL_ID);
  expect(limits.source).toBe('catalogue');
});

it('keeps the price table a frozen, well-formed, non-negative constant', () => {
  expect(Object.isFrozen(CALENDAR_PRICE_TABLE)).toBe(true);
  const entries = Object.entries(CALENDAR_PRICE_TABLE);
  expect(entries.length).toBeGreaterThan(0);
  for (const [modelId, pricing] of entries) {
    expect(Object.isFrozen(pricing)).toBe(true);
    expect(tokenPricingSchema.safeParse(pricing).success).toBe(true);
    expect(pricing.modelId).toBe(modelId);
    expect(pricing.version).toBe(CALENDAR_EVIDENCE_VERSION);
    expect(pricing.source).toContain('OpenRouter');
    expect(pricing.source).toContain('2026-10-22');
    expect(Number.isNaN(Date.parse(pricing.observedAt))).toBe(false);
    expect(decimalSchema.safeParse(pricing.promptUsdPerToken).success).toBe(true);
    expect(decimalSchema.safeParse(pricing.completionUsdPerToken).success).toBe(true);
    expect(decimalSchema.safeParse(pricing.requestUsd).success).toBe(true);
    expect(pricing.requestUsd).toBeDefined();
    expect(BigInt(pricing.promptUsdPerToken.replace('.', ''))).toBeGreaterThanOrEqual(0n);
    expect(BigInt(pricing.completionUsdPerToken.replace('.', ''))).toBeGreaterThanOrEqual(0n);
    expect(BigInt(pricing.requestUsd.replace('.', ''))).toBeGreaterThanOrEqual(0n);
  }
});

it('refuses a runtime change to a frozen rate', () => {
  const entry = CALENDAR_PRICE_TABLE[MODEL_ID];
  expect(() => { entry.promptUsdPerToken = '0.0000002'; }).toThrow(TypeError);
  expect(CALENDAR_PRICE_TABLE[MODEL_ID].promptUsdPerToken).toBe('0.0000001');
});
