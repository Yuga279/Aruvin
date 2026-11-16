/**
 * ============================================================================
 * FILE: usage-evidence.spec.ts
 * LOCATION: backend/test/model/usage-evidence.spec.ts
 * PURPOSE: Verify optional decimal, provenance, token, and timing evidence.
 * ROLE IN PROJECT: Guards legacy JSON/checkpoint equality and provider snapshots.
 * KEY COMPONENTS: Contract validation and absolute provider usage regression tests.
 * ============================================================================
 */
import { accountingRecordSchema } from '../../src/contracts/metadata.js';
import { voiceAccountingRecordSchema } from '../../src/contracts/voice-accounting.js';
import { mergeUsage, fromGeneration } from '../../src/model/accounting.js';
import { seed } from './helpers.js';

const at = '2026-10-14T00:00:00.000Z';
export const money = (amount: string | null = '0.1') => ({ currency: 'USD' as const,
  reportedAmount: amount, estimatedAmount: null, costStatus: amount === null ? 'unknown' as const : 'known' as const,
  source: amount === null ? 'unavailable' as const : 'provider-response' as const, observedAt: amount === null ? null : at,
  pricing: null });

it('adds bounded canonical money without changing legacy parsed equality', () => {
  expect(accountingRecordSchema.parse(seed())).toEqual(seed());
  expect(accountingRecordSchema.safeParse({ ...seed(), cost: 0.1, money: money() }).success).toBe(true);
  expect(accountingRecordSchema.safeParse({ ...seed(), cost: 0, money: money('0') }).success).toBe(true);
  expect(accountingRecordSchema.safeParse({ ...seed(), money: money(null) }).success).toBe(true);
});
it('requires bounded normalized UTC timestamps for new observations, without tightening legacy timestamps', () => {
  expect(accountingRecordSchema.safeParse({ ...seed(), money: { ...money(), observedAt: '2026-10-14' }, cost: 0.1 }).success).toBe(false);
  expect(accountingRecordSchema.safeParse({ ...seed(), money: { ...money(), observedAt: '2026-10-14T01:00:00+01:00' }, cost: 0.1 }).success).toBe(false);
  expect(accountingRecordSchema.safeParse({ ...seed(), startedAt: '2026-10-06' }).success).toBe(true);
});
it('preserves documented native generation cache/reasoning counts without fabricating cache writes', () => {
  const record = fromGeneration({ ...seed(), generationId: 'gen_fixture' }, { data: { id: 'gen_fixture',
    total_cost: 0.1, native_tokens_prompt: 12, native_tokens_completion: 8, native_tokens_cached: 4, native_tokens_reasoning: 3 } });
  expect(record).toMatchObject({ cachedPromptTokens: 4, reasoningOutputTokens: 3, promptTokens: 12, completionTokens: 8 });
  expect(record.cacheWriteTokens).toBeUndefined();
});
it('rejects malformed pricing with a validation result rather than throwing from an optional metric', () => {
  expect(() => accountingRecordSchema.safeParse({ ...seed(), money: { ...money(null), source: 'provider-estimate', observedAt: at, estimatedAmount: '0.1',
    pricing: { units: -1, unitSize: 1000, rateUsd: '-1', unit: 'characters', version: 'v1', source: 'fixture' } } })).not.toThrow();
});
it.each(['-1', 'NaN', 'Infinity', '1e-3', '00.1', '0.10', '', '1'.repeat(35)])('rejects noncanonical money %s', value => {
  expect(accountingRecordSchema.safeParse({ ...seed(), money: money(value) }).success).toBe(false);
});
it.each([-1, NaN, Infinity])('rejects invalid compatibility money %s', cost => {
  expect(accountingRecordSchema.safeParse({ ...seed(), cost }).success).toBe(false);
});
it('rejects conflicting costs and false completeness/provenance', () => {
  expect(accountingRecordSchema.safeParse({ ...seed(), cost: 0.2, money: money() }).success).toBe(false);
  expect(accountingRecordSchema.safeParse({ ...seed(), money: { ...money(null), costStatus: 'known' } }).success).toBe(false);
  expect(accountingRecordSchema.safeParse({ ...seed(), money: { ...money(), observedAt: null } }).success).toBe(false);
});
it('accepts optional safe token breakdowns and nullable timing without defaults', () => {
  const timing = { dispatchedAt: at, firstOutputAt: null, providerEndedAt: null,
    durableCompletedAt: null, providerDurationMs: null, firstOutputLatencyMs: null, dispatchCount: 1 };
  expect(accountingRecordSchema.safeParse({ ...seed(), cachedPromptTokens: 0,
    cacheWriteTokens: null, reasoningOutputTokens: 3, timing }).success).toBe(true);
  for (const count of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(accountingRecordSchema.safeParse({ ...seed(), reasoningOutputTokens: count }).success).toBe(false);
  }
});
it('normalizes known cost independently of missing tokens and retains breakdowns once', () => {
  const usage = { cost: 0.000000123456789, prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
    completion_tokens_details: { reasoning_tokens: 3 } };
  const first = mergeUsage(seed(), usage);
  expect(first).toMatchObject({ cost: usage.cost, promptTokens: null, completionTokens: null,
    cachedPromptTokens: 4, cacheWriteTokens: 2, reasoningOutputTokens: 3,
    money: { reportedAmount: '0.000000123456789', costStatus: 'known', source: 'provider-response' } });
  expect(mergeUsage(first, usage)).toEqual(first);
  expect(mergeUsage(first, { prompt_tokens_details: { cached_tokens: -1 } })).toEqual(first);
});
it('keeps legacy voice equality and never accepts invented reported charges', () => {
  const legacy = { schemaVersion: 1, kind: 'voice-accounting', provider: 'deepgram', userId: 'u', sessionId: 'v',
    voiceSessionId: 'v', conversationId: null, usageId: 'socket', providerSocketId: 'socket',
    userTag: `aurvin-user-${'a'.repeat(64)}`, model: 'nova-3', turnId: null, responseId: null, speechId: null,
    providerRequestId: null, modelVersion: null, status: 'pending', observedAudioMs: null, audioMs: null,
    billableCharacters: null, estimatedCostUsd: null, actualCostUsd: null, startedAt: at, endedAt: null };
  expect(voiceAccountingRecordSchema.parse(legacy)).toEqual(legacy);
  expect(voiceAccountingRecordSchema.safeParse({ ...legacy, money: money(null) }).success).toBe(true);
  expect(voiceAccountingRecordSchema.safeParse({ ...legacy, money: money() }).success).toBe(false);
});
