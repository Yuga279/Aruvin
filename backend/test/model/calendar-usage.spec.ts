import { emptyCalendarObservation, mergeCalendarObservation } from '../../src/model/calendar-usage.js';
import { moneyEvidenceSchema } from '../../src/contracts/usage-evidence.js';

describe('Calendar dispatch observations', () => {
  it('retains cost evidence for every native dispatch outcome', () => {
    const empty = emptyCalendarObservation();
    const raw = { id: 'gen_fixture', model: 'fixture/model', provider: 'Fixture',
      usage: { prompt_tokens: 12, completion_tokens: 8, cost: 0.00002,
        prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
        completion_tokens_details: { reasoning_tokens: 3 } },
      choices: [{ delta: { reasoning: 'PRIVATE_REASONING_CANARY', reasoning_details: [{ text: 'SECRET' }] } }] };
    const first = mergeCalendarObservation(empty, raw);
    expect(first).toMatchObject({ generationId: 'gen_fixture', promptTokens: 12, completionTokens: 8,
      cachedPromptTokens: 4, cacheWriteTokens: 2, reasoningOutputTokens: 3,
      money: { reportedAmount: '0.00002', costStatus: 'known', source: 'provider-response' } });
    expect(mergeCalendarObservation(first, raw)).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/PRIVATE_REASONING_CANARY|SECRET|reasoning_details/);
    expect(empty.money.reportedAmount).toBeNull();
  });

  it('treats explicit zero cost as known and leaves absent or invalid cost pending', () => {
    const empty = emptyCalendarObservation();
    expect(mergeCalendarObservation(empty, { usage: { cost: 0 } }).money).toMatchObject({
      reportedAmount: '0', costStatus: 'known', source: 'provider-response', pricing: null,
    });
    for (const cost of [undefined, -1, Number.NaN, Infinity, 'nope']) {
      const merged = mergeCalendarObservation(empty, { usage: { cost } });
      expect(merged.money.reportedAmount).toBeNull();
      expect(merged.money.costStatus).toBe('pending');
      expect(merged.money.source).toBe('unavailable');
    }
    const fromString = mergeCalendarObservation(empty, { usage: { cost: '0.00002' } });
    expect(fromString.money.reportedAmount).toBe('0.00002');
    expect(moneyEvidenceSchema.parse(fromString.money).costStatus).toBe('known');
  });

  it('merges absolute counts, preserves prior evidence, and rejects conflicts', () => {
    const empty = emptyCalendarObservation();
    const partial = mergeCalendarObservation(empty, { usage: { prompt_tokens: 4 } });
    expect(partial).toMatchObject({ promptTokens: 4, completionTokens: null });
    const filled = mergeCalendarObservation(partial, { id: 'gen_fixture', usage: { completion_tokens: 2, cost: 0.1 } });
    expect(filled).toMatchObject({ generationId: 'gen_fixture', promptTokens: 4, completionTokens: 2,
      money: { reportedAmount: '0.1' } });
    expect(mergeCalendarObservation(filled, { usage: { prompt_tokens: 4 } }).promptTokens).toBe(4);
    expect(() => mergeCalendarObservation(filled, { id: 'gen_other' })).toThrow();
    expect(() => mergeCalendarObservation(filled, { usage: { cost: 0.2 } })).toThrow();
    expect(mergeCalendarObservation(empty, { usage: { prompt_tokens: -1, completion_tokens: 1.5 } }))
      .toMatchObject({ promptTokens: null, completionTokens: null });
  });

  it('captures identifiers without copying provider payloads', () => {
    const merged = mergeCalendarObservation(emptyCalendarObservation(), {
      id: 'gen_fixture', model: 'fixture/model', provider: 'Fixture',
      error: { metadata: { dump: 'SECRET' } },
      usage: { prompt_tokens: 1 },
    });
    expect(merged).toMatchObject({ generationId: 'gen_fixture', reportedModel: 'fixture/model', reportedProvider: 'Fixture' });
    expect(JSON.stringify(merged)).not.toContain('SECRET');
    expect(merged.providerRequestId).toBeNull();
    expect(mergeCalendarObservation(merged, { id: 'gen_fixture' }).generationId).toBe('gen_fixture');
  });
});
