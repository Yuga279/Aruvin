/**
 * ============================================================================
 * FILE: provider-coverage.spec.ts
 * LOCATION: backend/test/plugins/integration/multi-calendar/provider-coverage.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify bounded Google free/busy projection through the actual MCP transport.
 * ROLE IN PROJECT:
 *    Runs real provider parsing on scripted payloads and validates SDK results.
 *    Records opaque-busy fixture semantics without asserting live Google behavior.
 * KEY COMPONENTS:
 *    - Coverage: Fifty-item batches, per-calendar errors and interval ceilings.
 *    - DST: Twenty-three and twenty-five elapsed-hour opaque all-day intervals.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { calendarExecutionEnvelopeV2Schema } from '../../../../src/contracts/calendar-operations.js';
import { multiToolsFixture } from '../../google-calendar/tools-multi-fixtures.js';
import { googleJson } from '../../google-calendar/tools-fixtures.js';

const range = { timeMin: '2026-11-03T10:00:00Z', timeMax: '2026-11-03T11:00:00Z', timeZone: 'Etc/UTC' };
it.each([false, true])('batches one hundred authorized IDs with honest HTTP-200 errors=%s', async hasError => {
  const ids = ['shared', ...Array.from({ length: 99 }, (_, i) => `cal-${i + 1}`)];
  const f = multiToolsFixture({ calendarCount: 100, operation: null,
    call: { name: 'calendar_check_availability', arguments: range },
    steps: [0, 50].map(offset => ({ method: 'POST', path: '/calendar/v3/freeBusy',
      response: () => googleJson({ timeMin: range.timeMin, timeMax: range.timeMax,
        calendars: Object.fromEntries(ids.slice(offset, offset + 50).map(id => [id,
          hasError && id === 'cal-99' ? { errors: [{ reason: 'notFound' }], busy: [] } : { busy: [] }])) }) })) });
  f.input.binding = { ...f.input.binding, target: null };
  try {
    const actual = await f.tools.invoke(f.input);
    const parsed = calendarExecutionEnvelopeV2Schema.parse(actual);
    expect(parsed.outcome).toBe('success');
    if (parsed.outcome !== 'success' || parsed.result.tool !== 'calendar_check_availability') {
      throw new Error('Expected availability through the SDK output schema.');
    }
    expect(parsed.result.coverage).toBe(hasError ? 'incomplete' : 'complete');
    expect(parsed.result.conflict).toBe(hasError ? 'unknown' : 'clear');
    expect(parsed.result.semantics).toBe('google-opaque-busy-only');
    if (hasError) expect(parsed.result.free).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(actual), 'utf8')).toBeLessThanOrEqual(16384);
    expect(f.requests).toHaveLength(2);
    const sent: string[] = [];
    for (const request of f.requests) {
      const body = await request.clone().json();
      expect(body.items).toHaveLength(50);
      expect(body).not.toHaveProperty('groups');
      expect(body).not.toHaveProperty('groupExpansionMax');
      sent.push(...body.items.map((item: { id: string }) => item.id));
    }
    expect(sent).toEqual(ids);
    expect(f.counts.kinds).toEqual(['availability', 'availability']);
  } finally { await f.tools.close(); }
});

it.each([
  ['2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00', 23],
  ['2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', 25],
] as const)('preserves opaque all-day elapsed time from %s', async (start, end, hours) => {
  const args = { timeMin: start, timeMax: end, timeZone: 'America/New_York' };
  const f = multiToolsFixture({ operation: null,
    call: { name: 'calendar_check_availability', arguments: args },
    steps: [{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: start, timeMax: end, calendars: { shared: { busy: [{ start, end }],
        summary: 'unrelated-private-title', attendees: ['private-person@example.invalid'] } },
    }) }] });
  try {
    const actual = await f.tools.invoke(f.input);
    const value = calendarExecutionEnvelopeV2Schema.parse(actual);
    if (value.outcome !== 'success' || value.result.tool !== 'calendar_check_availability') {
      throw new Error('Expected SDK availability success.');
    }
    expect(value.result).toMatchObject({ coverage: 'complete', conflict: 'conflict', free: [],
      semantics: 'google-opaque-busy-only' });
    expect(value.result.busy).toHaveLength(1);
    expect(Date.parse(value.result.busy[0].end) - Date.parse(value.result.busy[0].start)).toBe(hours * 3600000);
    expect(JSON.stringify(actual)).not.toMatch(/unrelated-private-title|private-person/iu);
  } finally { await f.tools.close(); }
});

it.each([2000, 2001])('processes at most two thousand busy intervals: supplied %s', async count => {
  const interval = { start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' };
  const f = multiToolsFixture({ operation: null,
    call: { name: 'calendar_check_availability', arguments: range },
    steps: [{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: range.timeMin, timeMax: range.timeMax,
      calendars: { shared: { busy: Array.from({ length: count }, () => interval) } },
    }) }] });
  try {
    const actual = await f.tools.invoke(f.input);
    const value = calendarExecutionEnvelopeV2Schema.parse(actual);
    if (value.outcome !== 'success' || value.result.tool !== 'calendar_check_availability') {
      throw new Error('Expected a bounded availability projection.');
    }
    expect(value.result.busy).toHaveLength(1);
    expect(value.result.coverage).toBe(count === 2000 ? 'complete' : 'incomplete');
    expect(value.result.truncated).toBe(count > 2000);
    expect(Buffer.byteLength(JSON.stringify(actual), 'utf8')).toBeLessThanOrEqual(16384);
    if (count > 2000) expect(value.result.free).toEqual([]);
  } finally { await f.tools.close(); }
});
