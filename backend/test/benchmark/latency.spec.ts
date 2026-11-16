/**
 * ============================================================================
 * FILE: latency.spec.ts
 * LOCATION: backend/test/benchmark/latency.spec.ts
 * PURPOSE: Verify benchmark attribution, coverage, privacy, and missing evidence.
 * ROLE IN PROJECT: Offline checks; no paid providers or application data required.
 * KEY COMPONENTS: StreamTiming, analyzeTurn, scenarios, summarize.
 * ============================================================================
 */
import { describe, expect, it } from 'vitest';
import { StreamTiming } from '../../src/benchmark/stream-timing.js';
import { analyzeTurn, scenarios, summarize, coveredMs } from '../../src/benchmark/report.js';
import { CALENDAR_TOOLS } from '../../src/contracts/calendar-tools.js';

describe('latency benchmark', () => {
  it('distinguishes empty stream events, tool output and text; counts tokens, not chunks', () => {
    let now = 0;
    const events: Record<string, unknown>[] = [];
    const timing = new StreamTiming(e => events.push(e), {}, () => now);
    now = 10; timing.frame({ choices: [{ delta: { role: 'assistant' } }] });
    now = 20; timing.frame({ choices: [{ delta: { tool_calls: [{ function: { name: 'calendar_list_events' } }] } }] });
    now = 30; timing.frame({ choices: [{ delta: { content: 'hello private content' } }] });
    now = 40; timing.frame({ usage: { completion_tokens: 12, prompt_tokens: 100 }, choices: [] });
    now = 50; timing.end(true); timing.end(false);
    expect(events.map(e => e.stage)).toEqual(['model-first-event', 'model-first-output', 'model-first-text', 'model-stream-end']);
    expect(events.at(-1)).toMatchObject({ durationMs: 50, completionTokens: 12, promptTokens: 100, state: 'ok' });
    expect(JSON.stringify(events)).not.toContain('private content');
  });

  it('covers every registered tool without claiming voice supports Calendar', () => {
    const cases = scenarios({ start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z', timeZone: 'Etc/UTC', eventId: 'abcde', calendarId: 'test' });
    expect(cases.flatMap(c => c.expectedTool ? [c.expectedTool] : []).sort()).toEqual(CALENDAR_TOOLS.map(t => t.name).sort());
    expect(cases.filter(c => c.mode === 'voice').every(c => c.expectedTool === null)).toBe(true);
  });

  it('does not add overlapping tool and network time or invent missing measurements', () => {
    expect(coveredMs([{ start: 0, end: 100 }, { start: 20, end: 80 }, { start: 90, end: 120 }])).toBe(120);
    const result = analyzeTurn('calendar_list_events', [
      { stage: 'tool-execution', state: 'ok', tool: 'calendar_list_events', durationMs: 100, clockMs: 200, clockOriginMs: 1 },
      { stage: 'provider-response', state: 'ok', durationMs: 60, clockMs: 180, clockOriginMs: 1 },
      { stage: 'task-outcome', task: 'success', clockMs: 220, clockOriginMs: 1 },
    ], 250);
    expect(result.outcome).toBe('success');
    expect(result.coveredStageMs).toBe(100);
    expect(result.models).toEqual([]);
    expect(result.unattributedMs).toBe(150);
    expect(analyzeTurn('calendar_get_event', [], 100).outcome).toBe('unverified');
  });

  it('does not count a wrong tool or failure as a successful benchmark', () => {
    expect(analyzeTurn('calendar_get_event', [{ stage: 'tool-execution', tool: 'calendar_list_events', state: 'ok' }, { stage: 'task-outcome', task: 'success' }], 100).outcome).toBe('wrong-tool');
    expect(analyzeTurn('calendar_get_event', [{ stage: 'tool-execution', tool: 'calendar_get_event', state: 'error' }], 100).outcome).toBe('failed');
  });

  it('reports per-round TTFT and explicitly denominated throughput, never cross-process spans', () => {
    const result = analyzeTurn(null, [
      { stage: 'model-first-output', dispatchId: 'd', durationMs: 100 },
      { stage: 'model-stream-end', dispatchId: 'd', durationMs: 1100, completionTokens: 20, state: 'ok' },
      { stage: 'context', state: 'ok', clockMs: 20, clockOriginMs: 1, durationMs: 20 },
      { stage: 'finalization', state: 'ok', clockMs: 20, clockOriginMs: 2, durationMs: 20 },
      { stage: 'terminal', chat: 'completed' },
    ], 1500);
    expect(result.models[0]).toMatchObject({ firstOutputMs: 100, outputTokensPerSecond: 20 });
    expect(result.models[0].requestTokensPerSecond).toBeCloseTo(20 / 1.1);
    expect(result.coveredStageMs).toBeNull();
    expect(result.unattributedMs).toBeNull();
  });

  it('keeps failure counts and excludes warmups and failed cases from success percentiles', () => {
    expect(summarize([
      { scenario: 'a', warmup: true, durationMs: 999, outcome: 'success' },
      { scenario: 'a', warmup: false, durationMs: 10, outcome: 'success' },
      { scenario: 'a', warmup: false, durationMs: 20, outcome: 'success' },
      { scenario: 'a', warmup: false, durationMs: 500, outcome: 'timeout' },
    ])).toEqual([{ scenario: 'a', samples: 3, succeeded: 2, failed: 1, p50Ms: 10, p95Ms: 20 }]);
  });
});
