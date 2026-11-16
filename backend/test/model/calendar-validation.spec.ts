/**
 * ============================================================================
 * FILE: calendar-validation.spec.ts
 * LOCATION: backend/test/model/calendar-validation.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for stable native wrapper validation and diagnostic emission.
 *
 * ROLE IN PROJECT:
 *    Verifies that streamed model tool calls are validated for wrapper structure and
 *    JSON safety while plugin argument validity stays with the executor boundary.
 *
 * KEY COMPONENTS:
 *    - validateCalendarCandidate: Tests raw identity, wrappers, JSON limits, error mapping.
 *    - normalizeDiagnostics: Tests diagnostic path boundaries and budget caps.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateCalendarCandidate, normalizeDiagnostics, type CandidateBatch }
  from '../../src/model/calendar-validation.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { SKILL_NATIVE_TOOLS, forbiddenCalendarKeys } from '../../src/contracts/calendar-tools.js';
import { repairDiagnosticsSchema } from '../../src/contracts/calendar-model.js';

const wrap = (args = '{}') => `{"plugin":"google-calendar","tool":"calendar_get_event","arguments":${args}}`;
function candidate(raw: string, name = 'call_tool'): CandidateBatch {
  return { calls: [{ index: 0, id: 'call_1', type: 'function', name,
    arguments: raw, envelopeInvalid: false }], terminal: 'tool_calls', envelopeInvalid: false };
}
const validate = (batch: CandidateBatch, limits = CALENDAR_LIMITS) =>
  validateCalendarCandidate(batch, SKILL_NATIVE_TOOLS, limits);

describe('stable native wrapper validation', () => {
  it('retains raw identity and delegates domain validity', () => {
    const raw = '{ "arguments": {"eventId":7}, "tool":"calendar_get_event", "plugin":"google-calendar" }';
    expect(validate(candidate(raw))).toEqual({ kind: 'valid',
      nativeCall: { id: 'call_1', type: 'function', function: { name: 'call_tool', arguments: raw } },
      envelope: { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 7 } } });
    expect(validate(candidate('{"plugin":"google-calendar","tools":["calendar_get_event"]}', 'activate_skill')))
      .toMatchObject({ kind: 'valid', envelope: { tools: ['calendar_get_event'] } });
    expect(validate(candidate('{"plugin":"unknown","tool":"unknown_tool","arguments":{}}'))).toMatchObject({ kind: 'valid' });
  });

  it.each([
    ['{}', 'plugin', 'missing'],
    ['{"plugin":7,"tool":"calendar_get_event","arguments":{}}', 'plugin', 'wrong-type'],
    ['{"plugin":"google-calendar","tool":"calendar_get_event"}', 'arguments', 'missing'],
    ['{"plugin":"google-calendar","tool":"calendar_get_event","arguments":[]}', 'arguments', 'wrong-type'],
    ['{"plugin":"google-calendar","tool":"calendar_get_event","arguments":{},"unknown":"SECRET"}', '$', 'unknown-field'],
  ])('returns bounded wrapper diagnostics for %s', (raw, path, code) => {
    const result = validate(candidate(raw));
    expect(result).toMatchObject({ kind: 'rejected', diagnostics: expect.arrayContaining([
      expect.objectContaining({ path, code }) ]) });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('"unknown"');
  });

  it.each(['[]', '["calendar_get_event","calendar_get_event"]', 'null'])('rejects selection %s', tools => {
    expect(validate(candidate(`{"plugin":"google-calendar","tools":${tools}}`, 'activate_skill')))
      .toMatchObject({ kind: 'rejected' });
  });

  it.each([...forbiddenCalendarKeys])('screens forbidden key %s even when escaped or nested', key => {
    const escaped = `\\u${key.charCodeAt(0).toString(16).padStart(4, '0')}${key.slice(1)}`;
    for (const raw of [wrap(`{"${key}":"SECRET"}`), wrap(`{"nested":{"${escaped}":1}}`)]) {
      expect(validate(candidate(raw))).toMatchObject({ kind: 'failure', failure: {
        category: 'policy', code: 'FORBIDDEN_TOOL_FIELD', retry: 'none' } });
    }
    expect(validate(candidate(wrap('{"description":"discuss attendees and accessToken"}')))).toMatchObject({ kind: 'valid' });
  });

  it.each([
    ['{', 'malformed-json'], [wrap('{"eventId":"a","eventId":"b"}'), 'duplicate-key'],
    [wrap('{"x":1e999}'), 'malformed-json'],
    [wrap('{"x":'.repeat(9) + '0' + '}'.repeat(9)), 'depth-limit'],
  ])('retains scanner rejection for %s', (raw, code) => {
    const batch = candidate(raw);
    const result = validate(batch);
    expect(result).toMatchObject({ kind: 'rejected', diagnostics: [expect.objectContaining({ code })] });
    expect(result).toHaveProperty('rawArgumentsSha256', createHash('sha256')
      .update(JSON.stringify(batch.calls.map(c => [c.index, c.arguments]))).digest('hex'));
  });

  it('charges bytes and depth for the entire wrapper, including multibyte content', () => {
    expect(validate(candidate(wrap('{"x":"' + 'é'.repeat(8192) + '"}')))).toMatchObject({
      kind: 'failure', failure: { code: 'ARGUMENT_BUDGET_EXCEEDED', retry: 'none' } });
    expect(validate(candidate(wrap('{"nested":{}}')), { ...CALENDAR_LIMITS, jsonDepth: 2 }))
      .toMatchObject({ kind: 'rejected', diagnostics: [expect.objectContaining({ code: 'depth-limit' })] });
    // The current Calendar flat/string-array inputs fit without increasing jsonDepth.
    expect(validate(candidate(wrap('{"calendarIds":["cal"]}')))).toMatchObject({ kind: 'valid' });
  });

  it('requires one complete native call with a valid ID and terminal', () => {
    const batch = candidate(wrap());
    for (const changed of [
      { ...batch, calls: [] },
      { ...batch, calls: [{ ...batch.calls[0]!, index: 1 }] },
      { ...batch, calls: [batch.calls[0]!, { ...batch.calls[0]!, index: 1, id: 'other' }] },
      { ...batch, calls: [{ ...batch.calls[0]!, id: null }] },
      { ...batch, calls: [{ ...batch.calls[0]!, type: null }] },
      { ...batch, calls: [{ ...batch.calls[0]!, name: '' }] },
      { ...batch, envelopeInvalid: true }, { ...batch, terminal: 'stop' }, { ...batch, terminal: 'length' },
    ]) expect(validate(changed)).toMatchObject({ kind: 'rejected' });
    expect(validate(candidate('{}', 'calendar_get_event'))).toMatchObject({ kind: 'failure',
      failure: { code: 'UNKNOWN_OR_DISABLED_TOOL' } });
    expect(validate({ ...candidate('{', 'activate_'), terminal: 'length' })).toMatchObject({ kind: 'rejected' });
  });

  it('retains denial priority, safe bounded observations, and diagnostic limits', () => {
    const base = candidate(wrap());
    expect(validate({ ...base, calls: [...base.calls, { ...base.calls[0]!, index: 1,
      arguments: wrap('{"accessToken":"SECRET"}') }] })).toMatchObject({ kind: 'failure', failure: { code: 'FORBIDDEN_TOOL_FIELD' } });
    const facts: Readonly<Record<string, unknown>>[] = [];
    const result = validateCalendarCandidate(candidate('{"plugin":7,"tool":8,"arguments":null}'),
      SKILL_NATIVE_TOOLS, { ...CALENDAR_LIMITS, diagnosticCount: 2 }, v => { facts.push(v); });
    expect(result).toMatchObject({ kind: 'rejected' });
    expect(facts.length).toBeLessThanOrEqual(2);
    expect(facts).toContainEqual(expect.objectContaining({ stage: 'validation', delivery: 'not-sent' }));
    expect(JSON.stringify(facts)).not.toMatch(/SECRET|rawArgumentsSha256/);
    const normalized = normalizeDiagnostics([
      { path: 'plugin', code: 'missing', expected: 'string' },
      { path: 'plugin', code: 'missing', expected: 'string' },
      { path: 'secret' as 'plugin', code: 'missing', expected: 'string' },
    ], CALENDAR_LIMITS);
    expect(normalized).toEqual([{ path: 'plugin', code: 'missing', expected: 'string' },
      { path: '$', code: 'missing', expected: 'string' }]);
    expect(repairDiagnosticsSchema.parse(normalized)).toEqual(normalized);
    expect(validate(candidate('{}'), { ...CALENDAR_LIMITS, diagnosticChars: 8 }))
      .toMatchObject({ kind: 'failure', failure: { code: 'DIAGNOSTIC_BUDGET_EXCEEDED' } });
  });
});
