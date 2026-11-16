/**
 * ============================================================================
 * FILE: report.ts
 * LOCATION: backend/src/benchmark/report.ts
 * PURPOSE: Define prompt coverage and summarize correlated latency evidence.
 * ROLE IN PROJECT: Pure benchmark calculations shared by runner and offline tests.
 * KEY COMPONENTS: scenarios, analyzeTurn, coveredMs, summarize.
 * ============================================================================
 */
import { CALENDAR_TOOLS } from '../contracts/calendar-tools.js';

export type Scenario = { id: string; mode: 'text' | 'voice'; prompt: string;
  expectedTool: string | null; mutation: boolean; blocked?: string };
export type ScenarioInput = { start: string; end: string; timeZone: string; eventId?: string; calendarId?: string };
export function scenarios(input: ScenarioInput): Scenario[] {
  const target = input.calendarId ? ` on calendar ${JSON.stringify(input.calendarId)}` : '';
  const range = `from ${input.start} to ${input.end} (${input.timeZone})`;
  const prompts: Record<string, string> = {
    calendar_list_events: `Show my upcoming timed events ${range}${target}.`,
    calendar_get_event: `Get the details of event with Google event ID ${JSON.stringify(input.eventId ?? 'MISSING_EVENT_ID')}${target}.`,
    calendar_create_event: `Create an event titled Aurvin latency benchmark ${range}${target}. No guests or invitations.`,
    calendar_list_calendars: 'List the calendars I can access.',
    calendar_check_availability: `Check my calendar availability ${range}${target}.`,
  };
  const baseline = 'In two short sentences, explain why the sky looks blue.';
  return [{ id: 'text-baseline', mode: 'text', prompt: baseline, expectedTool: null, mutation: false },
    ...CALENDAR_TOOLS.map(t => {
      if (!prompts[t.name]) throw new Error(`BENCHMARK_SCENARIO_MISSING: ${t.name}`);
      return { id: t.name, mode: 'text' as const, expectedTool: t.name,
        prompt: prompts[t.name], mutation: t.name === 'calendar_create_event',
        ...(t.name === 'calendar_get_event' && !input.eventId ? { blocked: 'known-test-event-required' } : {}),
      };
    }), { id: 'voice-baseline', mode: 'voice', prompt: baseline, expectedTool: null, mutation: false }];
}

export type Evidence = Record<string, unknown>;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export function coveredMs(spans: { start: number; end: number }[]): number {
  let end = -Infinity, total = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    total += Math.max(0, span.end - Math.max(span.start, end));
    end = Math.max(end, span.end);
  }
  return total;
}
export function analyzeTurn(expectedTool: string | null, events: Evidence[], durationMs: number) {
  const tools = events.filter(e => e.stage === 'tool-execution' && (e.state === 'ok' || e.state === 'error'));
  const observedTools = tools.map(e => String(e.tool));
  const completed = events.some(e => e.stage === 'terminal' && e.chat === 'completed');
  const failed = events.some(e => e.stage === 'runtime-error'
    || e.stage === 'terminal' && e.chat !== 'completed'
    || !completed && e.stage === 'tool-execution' && e.state === 'error');
  const success = expectedTool === null
    ? events.some(e => e.stage === 'terminal' && e.chat === 'completed') && observedTools.length === 0
    : observedTools.includes(expectedTool) && events.some(e => e.stage === 'task-outcome' && e.task === 'success');
  const outcome = failed ? 'failed' : success ? 'success' : observedTools.length ? 'wrong-tool' : 'unverified';
  const models = events.filter(e => e.stage === 'model-stream-end').map(end => {
    const match = (stage: string) => events.find(e => e.stage === stage && e.dispatchId === end.dispatchId && e.attemptId === end.attemptId);
    const first = match('model-first-output'), text = match('model-first-text'), event = match('model-first-event');
    const total = finite(end.durationMs) ? end.durationMs : null;
    const firstOutputMs = finite(first?.durationMs) ? first.durationMs : null;
    const count = finite(end.completionTokens) ? end.completionTokens : null;
    return { dispatchId: end.dispatchId ?? null, state: end.state,
      firstEventMs: finite(event?.durationMs) ? event.durationMs : null,
      firstOutputMs, firstTextMs: finite(text?.durationMs) ? text.durationMs : null,
      durationMs: total, completionTokens: count,
      requestTokensPerSecond: end.state === 'ok' && count !== null && total !== null && total > 0 ? count * 1000 / total : null,
      outputTokensPerSecond: end.state === 'ok' && count !== null && total !== null && firstOutputMs !== null && total > firstOutputMs
        ? count * 1000 / (total - firstOutputMs) : null };
  });
  const voiceDurations = events.filter(e => e.kind === 'voice-pipeline' && finite(e.elapsedMs)
    && ['response-prepared', 'tts-first-submit', 'tts-first-audio', 'playback-first-ack', 'stt-connected', 'tts-connected'].includes(String(e.stage)))
    .map((e): Evidence => ({ ...e, durationMs: e.elapsedMs }));
  const stages = [...events.filter(e => finite(e.durationMs) &&
    (['model-stream-end', 'provider-response'].includes(String(e.stage))
      || ['context', 'tool-execution', 'persistence', 'finalization'].includes(String(e.stage)) && e.state !== 'start')), ...voiceDurations];
  const timed = stages.filter(e => finite(e.clockMs) && finite(e.clockOriginMs));
  const origins = new Set(timed.map(e => e.clockOriginMs));
  const coveredStageMs = timed.length && origins.size === 1 ? coveredMs(timed.map(e =>
    ({ start: (e.clockMs as number) - (e.durationMs as number), end: e.clockMs as number }))) : null;
  return { outcome, observedTools, models, stages: stages.map(e => ({ stage: typeof e.stage === 'string' ? e.stage : 'unknown',
    tool: typeof e.tool === 'string' ? e.tool : undefined,
    requestKind: typeof e.requestKind === 'string' ? e.requestKind : undefined,
    state: typeof e.state === 'string' ? e.state : undefined, durationMs: e.durationMs as number })),
    coveredStageMs, unattributedMs: coveredStageMs === null ? null : Math.max(0, durationMs - coveredStageMs) };
}

export type Sample = { scenario: string; warmup: boolean; durationMs: number; outcome: string };
export function summarize(samples: Sample[]) {
  return [...new Set(samples.map(s => s.scenario))].map(scenario => {
    const rows = samples.filter(s => s.scenario === scenario && !s.warmup);
    const sorted = rows.filter(r => r.outcome === 'success').map(r => r.durationMs).sort((a, b) => a - b);
    const percentile = (p: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
    return { scenario, samples: rows.length, succeeded: sorted.length, failed: rows.length - sorted.length,
      p50Ms: percentile(.5), p95Ms: percentile(.95) };
  }).sort((a, b) => (b.p50Ms ?? -1) - (a.p50Ms ?? -1));
}
