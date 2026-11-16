/**
 * ============================================================================
 * FILE: workflows.spec.ts
 * LOCATION: backend/test/benchmark/workflows.spec.ts
 * PURPOSE: Exercise timing on every real Calendar tool with deterministic HTTP.
 * ROLE IN PROJECT: Component-path evidence, NOT real provider or durable E2E speed.
 * KEY COMPONENTS: Production model adapter -> tool executor -> model narration.
 * ============================================================================
 */
import { afterAll, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { multiToolsFixture } from '../plugins/google-calendar/tools-multi-fixtures.js';
import { CREATE_ACTION, googleEvent, googleJson, type FakeStep } from '../plugins/google-calendar/tools-fixtures.js';
import { calendarBinding, calendarLimits, skillRequest, nativeFrame } from '../model/calendar-fixtures.js';
import { config } from '../model/helpers.js';
import { createCalendarModelPortV2 } from '../../src/model/calendar-adapter.js';
import { CALENDAR_TOOLS, type CalendarCall } from '../../src/contracts/calendar-tools.js';
import { Telemetry } from '../../src/operations/telemetry.js';
import { analyzeTurn } from '../../src/benchmark/report.js';

const results: unknown[] = [];
const timeMin = '2026-10-21T09:00:00Z', timeMax = '2026-10-21T12:00:00Z';
for (const schema of CALENDAR_TOOLS) {
  it(`records model and tool stages for ${schema.name} using synthetic transports`, async () => {
    const logs: Record<string, unknown>[] = [];
    const telemetry = new Telemetry(line => logs.push(JSON.parse(line) as Record<string, unknown>));
    const diagnostic = (fields: Readonly<Record<string, unknown>>) => telemetry.event('process', fields);
    let call: CalendarCall;
    let steps: FakeStep[] | undefined;
    switch (schema.name) {
      case 'calendar_list_events':
        call = { name: schema.name, arguments: { timeMin, timeMax, maxResults: 10, calendarId: 'shared' } };
        steps = [{ method: 'GET', path: '/calendar/v3/calendars/shared/events', response: () => googleJson({ timeZone: 'Etc/UTC', items: [googleEvent()] }) }];
        break;
      case 'calendar_get_event':
        call = { name: schema.name, arguments: { eventId: 'abcde01234', calendarId: 'shared' } };
        steps = [{ method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234', response: () => googleJson(googleEvent()) }];
        break;
      case 'calendar_create_event': call = { name: schema.name, arguments: { ...CREATE_ACTION, calendarId: 'shared' } }; break;
      case 'calendar_list_calendars': call = { name: schema.name, arguments: {} }; steps = []; break;
      case 'calendar_check_availability':
        call = { name: schema.name, arguments: { timeMin, timeMax, timeZone: 'Etc/UTC', calendarIds: ['shared'] } };
        steps = [{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
          timeMin, timeMax, calendars: { shared: { busy: [] } } }) }];
        break;
    }
    const fixture = multiToolsFixture({ call, steps, diagnostic });
    const start = performance.now();
    const wire = nativeFrame({ tool_calls: [{ index: 0, id: 'call_1', type: 'function',
      function: { name: 'call_tool', arguments: JSON.stringify({
        plugin: 'google-calendar', tool: call.name, arguments: call.arguments }) } }] })
      + nativeFrame({}, 'tool_calls') + 'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20}}\n\n' + 'data: [DONE]\n\n';
    const binding = calendarBinding();
    const adapter = createCalendarModelPortV2(config(), calendarLimits, binding,
      async () => new Response(wire, { headers: { 'content-type': 'text/event-stream' } }), diagnostic);
    let observedCall: CalendarCall | undefined;
    for await (const chunk of adapter.stream(skillRequest())) {
      if (chunk.type === 'decision' && chunk.decision.kind === 'call_tool') {
        observedCall = { name: chunk.decision.envelope.tool,
          arguments: chunk.decision.envelope.arguments } as CalendarCall;
      }
      expect(chunk.type).not.toBe('failure');
    }
    expect(observedCall).toEqual(call);
    const outcome = await fixture.tools.invoke({ ...fixture.input, call: observedCall! });
    expect(outcome.outcome).toBe('success');
    expect(logs.some(e => e.stage === 'tool-execution' && e.state === 'ok' && e.tool === call.name)).toBe(true);
    const narrationBinding = calendarBinding('continuation');
    const narration = createCalendarModelPortV2(config(), calendarLimits, narrationBinding,
      async () => new Response(nativeFrame({ content: 'Synthetic task completed.' }) + nativeFrame({}, 'stop') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } }), diagnostic);
    const followup = { ...skillRequest(), dispatchId: 'dispatch_2', decisionId: 'decision_2' };
    for await (const chunk of narration.stream(followup)) expect(chunk.type).not.toBe('failure');
    diagnostic({ stage: 'task-outcome', task: 'success' });
    diagnostic({ stage: 'terminal', chat: 'completed' });
    const durationMs = performance.now() - start;
    const analysis = analyzeTurn(call.name, logs, durationMs);
    expect(analysis.outcome).toBe('success');
    expect(analysis.models).toHaveLength(2);
    expect(analysis.models[0].completionTokens).toBe(20);
    expect(analysis.models[1].completionTokens).toBeNull();
    results.push({ scenario: call.name, evidenceKind: 'synthetic-component-path-not-end-to-end', durationMs, analysis, timeline: logs });
    await fixture.tools.close();
  });
}

afterAll(async () => {
  // Export only when explicitly requested; ordinary unit tests leave no files.
  const directory = process.env.AURVIN_BENCHMARK_FIXTURE_OUTPUT;
  if (!directory) return;
  await mkdir(resolve(directory), { recursive: true });
  await writeFile(join(resolve(directory), 'fixture-results.json'), JSON.stringify({
    evidenceKind: 'synthetic-component-path-not-end-to-end', measuredAt: new Date().toISOString(),
    limitations: ['No real LLM, Google or Deepgram calls.', 'No database, HTTP application transport or browser/device playback.',
      'Synthetic transport throughput is not model/provider performance.', 'Durable runtime/authorization/confirmation integration is covered by separate native suites.'], results,
  }, null, 2));
});
