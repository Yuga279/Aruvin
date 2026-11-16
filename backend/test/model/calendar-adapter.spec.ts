/**
 * ============================================================================
 * FILE: calendar-adapter.spec.ts
 * LOCATION: backend/test/model/calendar-adapter.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for OpenRouter calendar adapter transport, hooks, and streaming decisions.
 *
 * ROLE IN PROJECT:
 *    Verifies that calendar adapter handles observation events, pre-dispatch barriers,
 *    cancellation, 429 provider errors, v2 schema-repair evidence, and text emissions.
 *
 * KEY COMPONENTS:
 *    - OpenRouterCalendarAdapter: Tests stream execution and error handling.
 *    - createCalendarModelPortV2: Verifies v2 port construction and dispatch rejection.
 * ============================================================================
 */

import { OpenRouterCalendarAdapter, createCalendarModelPort, createCalendarModelPortV2 } from '../../src/model/calendar-adapter.js';
import type { SkillDecisionChunk, SkillModelPort } from '../../src/contracts/calendar-model.js';
import type { CalendarDispatchObservation } from '../../src/contracts/calendar-model.js';
import { config } from './helpers.js';
import { skillRequest as calendarRequest, calendarBinding, calendarLimits, calendarHarness,
  skillNativeWire as nativeWire, skillWire, nativeFrame } from './calendar-fixtures.js';
import { collect } from './helpers.js';

async function chunks(adapter: SkillModelPort, request = calendarRequest()) {
  return collect(adapter.stream(request));
}

describe('Calendar adapter transport', () => {
  it('reports clear rejection promptly instead of sleeping without an admitted retry', async () => {
    const h = calendarHarness(nativeWire('{"eventId":"abcde"}'));
    h.fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: { code: 429 } }), {
      status: 429, headers: { 'content-type': 'application/json', 'retry-after': '3' },
    }));
    const cfg = config(); cfg.budgets.retryMaxDelayMs = 10000;
    const result = await chunks(new OpenRouterCalendarAdapter(cfg, calendarLimits, h.binding, h.fetcher));
    expect(result).toContainEqual(expect.objectContaining({ type: 'failure',
      failure: expect.objectContaining({ code: 'RATE_LIMITED', retry: 'provider-rejection' }) }));
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  }, 1500);
  it('performs one admitted POST and awaits observations before terminal decisions', async () => {
    const h = calendarHarness(nativeWire('{"eventId":"abcde"}'));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.binding.hooks.onObservation = vi.fn(async (observation: CalendarDispatchObservation) => { if (observation.endedAt) await gate; });
    const adapter = new OpenRouterCalendarAdapter(config(), calendarLimits, h.binding, h.fetcher);
    const out: SkillDecisionChunk[] = [];
    const pending = (async () => { for await (const chunk of adapter.stream(calendarRequest())) out.push(chunk); })();
    await vi.waitFor(() => expect(h.binding.hooks.onObservation).toHaveBeenCalledWith(
      expect.objectContaining({ endedAt: expect.any(String) })));
    expect(out.some(c => c.type === 'decision')).toBe(false);
    release(); await pending;
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(out).toContainEqual(expect.objectContaining({ type: 'decision',
      decision: expect.objectContaining({ kind: 'call_tool' }) }));
    expect(JSON.parse(String(h.fetcher.mock.calls[0][1]?.body)).user).toBe(config().identity.userId);
  });

  it('does not Fetch until beforeDispatch resolves and sanitizes hook failures', async () => {
    const h = calendarHarness(nativeWire('{"eventId":"abcde"}'));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.binding.hooks.beforeDispatch = vi.fn(async () => gate);
    const adapter = new OpenRouterCalendarAdapter(config(), calendarLimits, h.binding, h.fetcher);
    const out: SkillDecisionChunk[] = [];
    const pending = (async () => { for await (const chunk of adapter.stream(calendarRequest())) out.push(chunk); })();
    await vi.waitFor(() => expect(h.binding.hooks.beforeDispatch).toHaveBeenCalled());
    expect(h.fetcher).not.toHaveBeenCalled();
    release(); await pending;
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    const failed = calendarHarness(nativeWire('{"eventId":"abcde"}'));
    failed.binding.hooks.beforeDispatch = vi.fn(async () => { throw new Error('private hook'); });
    const failure = await chunks(new OpenRouterCalendarAdapter(config(), calendarLimits, failed.binding, failed.fetcher));
    expect(failed.fetcher).not.toHaveBeenCalled();
    expect(failure).toContainEqual(expect.objectContaining({ type: 'failure', failure: { category: 'persistence', code: 'PERSISTENCE_ERROR', retry: 'none' } }));
    expect(JSON.stringify(failure)).not.toContain('private hook');
  });

  it('rejects reuse, pre-cancel and expired budgets without Fetch', async () => {
    const h = calendarHarness(nativeWire('{"eventId":"abcde"}'));
    await chunks(h.adapter);
    const reused = await chunks(h.adapter);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(reused).toContainEqual(expect.objectContaining({ type: 'failure' }));
    const cancelled = calendarHarness(nativeWire('{"eventId":"abcde"}'));
    const signal = new AbortController();
    signal.abort();
    const pre = await chunks(new OpenRouterCalendarAdapter(config(), calendarLimits, cancelled.binding, cancelled.fetcher), calendarRequest(signal.signal));
    expect(cancelled.fetcher).not.toHaveBeenCalled();
    expect(pre).toContainEqual(expect.objectContaining({ type: 'failure', failure: expect.objectContaining({ category: 'cancelled', retry: 'none' }) }));
    const expired = calendarBinding();
    expired.budget.deadlineAt = '2020-01-01T00:00:00.000Z';
    const expReq = { ...calendarRequest(), deadlineAt: '2020-01-01T00:00:00.000Z' };
    const expFetcher = vi.fn<typeof fetch>();
    const expOut = await chunks(new OpenRouterCalendarAdapter(config(), calendarLimits, expired, expFetcher), expReq);
    expect(expFetcher).not.toHaveBeenCalled();
    expect(expOut.some(c => c.type === 'failure')).toBe(true);
  });

  it('emits schema-repair for structural rejection and exhaustion after the charged second correction', async () => {
    const malformed = calendarHarness(nativeWire('{"eventId":'));
    const first = await chunks(malformed.adapter);
    expect(first).toContainEqual(expect.objectContaining({ type: 'rejected' }));
    expect(first).toContainEqual(expect.objectContaining({
      type: 'failure', failure: { category: 'structural', code: 'STRUCTURAL_VALIDATION_FAILED', retry: 'schema-repair' },
    }));
    expect(JSON.stringify(first)).not.toContain('{"eventId":');
    const second = calendarBinding('schema-repair');
    second.budget.repairs = 2;
    second.dispatch.dispatchIndex = 2;
    const diagnostics = [{ path: '$' as const, code: 'malformed-json' as const, expected: 'complete-json' as const }];
    const { repairInstruction } = await import('../../src/model/calendar-repair.js');
    const req = {
      ...calendarRequest(),
      dispatchId: second.dispatch.dispatchId,
      decisionId: second.dispatch.decisionId,
      repair: { rejectedDecisionId: 'decision_1', diagnostics },
      messages: [...calendarRequest().messages, { role: 'system' as const, content: repairInstruction(diagnostics) }],
    };
    const exhausted = calendarHarness(nativeWire('{'));
    const out = await chunks(new OpenRouterCalendarAdapter(config(), calendarLimits, second, exhausted.fetcher), req);
    expect(out).toContainEqual(expect.objectContaining({
      type: 'failure', failure: { category: 'budget', code: 'REPAIR_EXHAUSTED', retry: 'none' },
    }));
    expect(exhausted.fetcher).toHaveBeenCalledTimes(1);
  });

  it('classifies eligible 429 as provider-rejection without a second POST', async () => {
    const h = calendarHarness(nativeWire('{"eventId":"abcde"}'));
    h.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 429 } }), { status: 429 }));
    const out = await chunks(new OpenRouterCalendarAdapter(config(), calendarLimits, h.binding, h.fetcher));
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(out).toContainEqual(expect.objectContaining({
      type: 'failure', failure: expect.objectContaining({ category: 'provider', retry: 'provider-rejection' }),
    }));
    h.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 }));
    const auth = calendarHarness(nativeWire('{"eventId":"abcde"}'));
    auth.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 }));
    const denied = await chunks(new OpenRouterCalendarAdapter(config(), calendarLimits, auth.binding, auth.fetcher));
    expect(auth.fetcher).toHaveBeenCalledTimes(1);
    expect(denied).toContainEqual(expect.objectContaining({ type: 'failure', failure: expect.objectContaining({ retry: 'none' }) }));
  });

  it('returns ordinary text decisions and never yields reasoning or raw calls', async () => {
    const wire = nativeFrame({ role: 'assistant', content: 'Hello', reasoning: 'PRIVATE' }, 'stop') + 'data: [DONE]\n\n';
    const h = calendarHarness(wire);
    const out = await chunks(h.adapter);
    expect(out).toContainEqual({ type: 'text-delta', text: 'Hello' });
    expect(out).toContainEqual(expect.objectContaining({ type: 'decision', decision: { kind: 'text', content: 'Hello', truncated: false, decisionId: 'decision_1' } }));
    expect(JSON.stringify(out)).not.toContain('PRIVATE');
    expect(out.some(c => 'call' in c)).toBe(false);
  });

  it('emits raw discovery/dispatch decisions only after durable observations', async () => {
    for (const name of ['activate_skill', 'call_tool'] as const) {
      const raw = name === 'activate_skill'
        ? '{ "plugin":"google-calendar", "tools":["calendar_get_event"] }'
        : '{ "arguments":{"eventId":7}, "tool":"calendar_get_event", "plugin":"google-calendar" }';
      const h = calendarHarness(skillWire(name, raw));
      const out = await collect(h.adapter.stream(calendarRequest()));
      expect(out).toContainEqual({ type: 'decision', decision: {
        kind: name, decisionId: 'decision_1', assistantContent: null,
        nativeCall: { id: 'call_1', type: 'function', function: { name, arguments: raw } },
        envelope: JSON.parse(raw), terminal: 'tool_calls' } });
      expect(h.fetcher).toHaveBeenCalledTimes(1);
      expect(h.binding.hooks.onObservation).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String) }));
      const body = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
      expect(body.tools.map((t: { function: { name: string } }) => t.function.name))
        .toEqual(['activate_skill', 'call_tool']);
      expect(body.user).toBe(config().identity.userId);
    }
  });

  it('refuses legacy advertised tools and unfinished SSE without producing a tool decision', async () => {
    const { CALENDAR_TOOLS } = await import('../../src/contracts/calendar-tools.js');
    const h = calendarHarness(nativeWire('{"eventId":"abcde"}'));
    const rejected = await collect(h.adapter.stream({ ...calendarRequest(), tools: CALENDAR_TOOLS }));
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(rejected.some(c => c.type === 'decision')).toBe(false);
    expect(rejected).toContainEqual(expect.objectContaining({ type: 'failure' }));
    const incomplete = calendarHarness(skillWire('activate_skill', '{"plugin":"google-calendar","tools":"all"}')
      .replace('data: [DONE]\n\n', ''));
    const out = await collect(incomplete.adapter.stream(calendarRequest()));
    expect(out.some(c => c.type === 'decision')).toBe(false);
    expect(out).toContainEqual(expect.objectContaining({ type: 'failure' }));
  });

  it('rejects legacy factory with v2 dispatch or v2 factory with legacy dispatch without Fetch', () => {
    const v2Binding = calendarBinding();
    const legacyFetcher = vi.fn<typeof fetch>();
    expect(() => createCalendarModelPort(config(), calendarLimits, v2Binding, legacyFetcher)).toThrow();
    expect(legacyFetcher).not.toHaveBeenCalled();
    const v1Dispatch = { ...v2Binding.dispatch, schemaVersion: 1, schemaRevision: 'google-calendar.v1' } as never;
    expect(() => createCalendarModelPortV2(config(), calendarLimits, { ...v2Binding, dispatch: v1Dispatch }, legacyFetcher)).toThrow();
    expect(legacyFetcher).not.toHaveBeenCalled();
  });
});
