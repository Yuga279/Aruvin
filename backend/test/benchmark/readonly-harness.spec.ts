/**
 * ============================================================================
 * FILE: readonly-harness.spec.ts
 * LOCATION: backend/test/benchmark/readonly-harness.spec.ts
 * PURPOSE: Verify selected synthetic pairing and fail-closed live rejection.
 * ROLE IN PROJECT: Offline I4 authorization/budget/provenance/timing checks.
 * KEY COMPONENTS: Synthetic SSE receipts; no network or credentials.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { runReadOnlyHarness, validateReadOnlyEnvelope } from '../../src/benchmark/readonly-harness.js';
import { hashId } from '../../src/benchmark/runner.js';

const snapshot = (revision: string) => ({ sourceRevision: revision.repeat(40), buildRevision: revision.repeat(40),
  sourceHash: revision.repeat(64), buildSourceHash: revision.repeat(64),
  harnessHash: 'a'.repeat(64), semanticsHash: 'b'.repeat(64), baseUrl: 'http://127.0.0.1:8001/api' });
const envelope = () => ({ scenario: 'calendar_list_events', maxTurns: 2,
  baseline: snapshot('1'), current: snapshot('2'),
  approval: { reference: 'offline-example', operator: 'synthetic-operator', paid: true, calendarData: true,
    databaseWrites: true, syntheticAccountOnly: true, expiresAt: '2030-01-01T00:00:00Z' },
  calendarId: 'owned', start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z', timeZone: 'Etc/UTC',
  perTurn: { contextTokens: 1000, outputTokens: 100, modelDispatches: 8, calendarRequests: 20,
    refreshRequests: 2, reservedMicrousd: 1000000 },
  budgets: { costMicrousd: 2000000, promptTokens: 16000, completionTokens: 1600, modelDispatches: 16,
    calendarRequests: 40, refreshRequests: 4, totalMs: 300000, turnTimeoutMs: 1000,
    responseBytes: 16384, maxResults: 20 } });
const ids = { sessionId: 's', turnId: 't', attemptId: 'a', userMessageId: 'u', streamPath: '/unused' };
const frame = (event: unknown, sequence = 0) => `data: ${JSON.stringify({ protocolVersion: 1,
  sessionId: ids.sessionId, turnId: ids.turnId, attemptId: ids.attemptId, sequence, event })}\n\n`;
function fixture() {
  const posts: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (init?.method === 'POST') {
      if (typeof init.body !== 'string') throw new Error('SYNTHETIC_STRING_BODY_REQUIRED');
      posts.push(init.body);
      return new Response(JSON.stringify(ids), { status: 202 });
    }
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    if (url.endsWith('/stream')) return new Response(frame({ type: 'delta', text: 'PRIVATE CONTENT' })
      + frame({ type: 'completed', assistantMessageId: 'm', outcome: 'completed' }, 1));
    return new Response('{"status":"completed"}');
  });
  const scope = { kind: 'process', turnId: hashId('t'), attemptId: hashId('a') };
  const receipt = (source: ReturnType<typeof snapshot>) => ({ ...source, durable: true, ready: true,
    accounting: 'known', billedMicrousd: 10, promptTokens: 100, completionTokens: 10,
    modelDispatches: 1, calendarRequests: 1, refreshRequests: 0,
    events: [
      { ...scope, stage: 'model-first-output', dispatchId: hashId('d'), durationMs: 10 },
      { ...scope, stage: 'model-stream-end', dispatchId: hashId('d'), state: 'ok', durationMs: 30,
        promptTokens: 100, completionTokens: 10, prompt: 'PRIVATE CONTENT' },
      { ...scope, stage: 'tool-execution', tool: 'calendar_list_events', state: 'ok', durationMs: 5 },
      { ...scope, stage: 'task-outcome', task: 'success' },
      { ...scope, stage: 'terminal', chat: 'completed' },
    ] });
  const settle = vi.fn(async (_wire: unknown, source: ReturnType<typeof snapshot>, _signal: AbortSignal) => receipt(source));
  const transport = vi.fn<(source: ReturnType<typeof snapshot>, guardedCalendar: typeof fetch, signal: AbortSignal) => typeof fetch>(() => fetcher);
  const calendarFetch = vi.fn<typeof fetch>(async () => new Response('{}'));
  const options = { mode: 'synthetic' as const, transport, calendarFetch, settle, wallNow: () => Date.parse('2026-10-30T00:00:00Z') };
  return { options, posts, settle, fetcher, transport, calendarFetch, receipt };
}

it('blocks live before inspecting inputs or calling injected transports, despite approval-shaped flags', async () => {
  const f = fixture();
  await expect(runReadOnlyHarness(envelope(), { ...f.options, mode: 'live' })).rejects.toThrow('LIVE_RUNTIME_INTEGRATION_REQUIRED');
  expect(f.transport).not.toHaveBeenCalled(); expect(f.calendarFetch).not.toHaveBeenCalled(); expect(f.settle).not.toHaveBeenCalled();
});

it.each([
  (e: ReturnType<typeof envelope>) => { e.maxTurns = 3; },
  (e: ReturnType<typeof envelope>) => { e.scenario = 'calendar_create_event'; },
  (e: ReturnType<typeof envelope>) => { e.approval.paid = false; },
  (e: ReturnType<typeof envelope>) => { e.approval.databaseWrites = false; },
  (e: ReturnType<typeof envelope>) => { e.approval.expiresAt = '2020-01-01T00:00:00Z'; },
  (e: ReturnType<typeof envelope>) => { e.current.buildRevision = '3'.repeat(40); },
  (e: ReturnType<typeof envelope>) => { e.current.buildSourceHash = '3'.repeat(64); },
  (e: ReturnType<typeof envelope>) => { e.current.harnessHash = 'c'.repeat(64); },
  (e: ReturnType<typeof envelope>) => { e.current.semanticsHash = 'c'.repeat(64); },
  (e: ReturnType<typeof envelope>) => { e.budgets.promptTokens = 15999; },
  (e: ReturnType<typeof envelope>) => { e.budgets.costMicrousd = 1999999; },
  (e: ReturnType<typeof envelope>) => { e.budgets.calendarRequests = 39; },
  (e: ReturnType<typeof envelope>) => { e.budgets.totalMs = Number.POSITIVE_INFINITY; },
  (e: ReturnType<typeof envelope>) => { e.current.baseUrl = 'https://example.com/api'; },
])('rejects invalid/expired/unbounded/mismatched envelopes %#', change => {
  const e = envelope(); change(e);
  expect(() => validateReadOnlyEnvelope(e, Date.parse('2026-10-30T00:00:00Z'))).toThrow('READONLY_ENVELOPE_DENIED');
});

it('runs only two selected synthetic turns, preserves numerical limits and redacts IDs/payloads', async () => {
  const f = fixture();
  const result = await runReadOnlyHarness(envelope(), f.options);
  expect(result.outcome).toBe('synthetic-complete');
  expect(result.actualBilling).toBe('unknown');
  expect(result.commandWaves).toBe('unavailable');
  expect(result.records).toHaveLength(2);
  expect(result.records[0].models[0]).toMatchObject({ firstOutputMs: 10, durationMs: 30, completionTokens: 10 });
  expect(result.records[0].firstTextMs).toBeGreaterThanOrEqual(0);
  expect(f.posts).toHaveLength(2);
  expect(f.posts.every(p => p.includes('Show my upcoming timed events') && !p.includes('Create an event'))).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE CONTENT|calendarId|"sessionId":"s"|"attemptId":"a"/);
});

it.each(['accounting', 'ready', 'durable', 'provenance', 'tool', 'tokens', 'overspend', 'missing-dispatch'])('stops all later turns for %s receipt failure', async defect => {
  const f = fixture();
  f.settle.mockImplementationOnce(async (_wire, source) => {
    const r = f.receipt(source);
    if (defect === 'accounting') r.accounting = 'unknown';
    if (defect === 'ready') r.ready = false;
    if (defect === 'durable') r.durable = false;
    if (defect === 'provenance') r.sourceRevision = 'f'.repeat(40);
    if (defect === 'tool') r.events.push({ ...r.events[2], tool: 'calendar_create_event' });
    if (defect === 'tokens') r.promptTokens = 16001;
    if (defect === 'overspend') r.billedMicrousd = 2000001;
    if (defect === 'missing-dispatch') r.events = r.events.filter(e => e.stage !== 'model-stream-end');
    return r;
  });
  const result = await runReadOnlyHarness(envelope(), f.options);
  expect(result.outcome).toBe('stopped');
  expect(f.posts).toHaveLength(1);
  expect(f.transport).toHaveBeenCalledTimes(1);
});

it('never retries a rejected submission or attaches a stream after it', async () => {
  const f = fixture();
  f.fetcher.mockImplementationOnce(async () => new Response('PRIVATE', { status: 503 }));
  const result = await runReadOnlyHarness(envelope(), f.options);
  expect(result.outcome).toBe('stopped');
  expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.settle).not.toHaveBeenCalled();
});

it('times out a stalled synthetic settlement and never launches the second source', async () => {
  const f = fixture(), e = envelope(); e.budgets.totalMs = 20;
  f.settle.mockImplementationOnce(async () => new Promise<ReturnType<typeof f.receipt>>(() => {}));
  const result = await runReadOnlyHarness(e, f.options);
  expect(result.outcome).toBe('stopped'); expect(f.transport).toHaveBeenCalledTimes(1);
});

it('passes a real deny boundary to the synthetic server transport, not a prompt-only flag', async () => {
  const f = fixture();
  f.options.transport.mockImplementation((_source, guardedCalendar) => {
    void guardedCalendar('https://www.googleapis.com/calendar/v3/calendars/owned/events', { method: 'POST' }).catch(() => {});
    return f.fetcher;
  });
  await runReadOnlyHarness(envelope(), f.options);
  expect(f.options.transport).toHaveBeenCalledTimes(1);
  expect(f.calendarFetch).not.toHaveBeenCalled();
});

it('revokes boundaries on completion even when a synthetic server retains the callback', async () => {
  const f = fixture();
  let retained: typeof fetch | undefined;
  f.options.transport.mockImplementation((_source, guardedCalendar) => { retained = guardedCalendar; return f.fetcher; });
  await runReadOnlyHarness(envelope(), f.options);
  const e = envelope(), query = new URLSearchParams({ timeMin: e.start, timeMax: e.end, maxResults: '20',
    singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime', timeZone: 'Etc/UTC',
    fields: 'timeZone,nextPageToken,items(id,summary,start,end,status,htmlLink,description,location,visibility)' });
  await expect(retained!(`https://www.googleapis.com/calendar/v3/calendars/owned/events?${query}`)).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(f.calendarFetch).not.toHaveBeenCalled();
});

it('stops when a per-turn ceiling is exceeded even below the pair total', async () => {
  const f = fixture();
  f.settle.mockImplementationOnce(async (_wire, source) => ({ ...f.receipt(source), calendarRequests: 21 }));
  const result = await runReadOnlyHarness(envelope(), f.options);
  expect(result.outcome).toBe('stopped'); expect(f.posts).toHaveLength(1);
});

it('caps synthetic client response bytes before consuming a large SSE response', async () => {
  const f = fixture();
  f.fetcher.mockImplementationOnce(async () => new Response('PRIVATE'.repeat(3000), { status: 202 }));
  const result = await runReadOnlyHarness(envelope(), f.options);
  expect(result.outcome).toBe('stopped'); expect(f.transport).toHaveBeenCalledTimes(1);
  expect(f.settle).not.toHaveBeenCalled();
});

it('aborts a stalled synthetic SSE body and admits no subsequent turn', async () => {
  const f = fixture(), e = envelope(); e.budgets.totalMs = 20;
  let cancelled = false;
  f.fetcher.mockImplementationOnce(async () => new Response(JSON.stringify(ids), { status: 202 }));
  f.fetcher.mockImplementationOnce(async () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } })));
  const result = await runReadOnlyHarness(e, f.options);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(result.outcome).toBe('stopped'); expect(f.transport).toHaveBeenCalledTimes(1);
  expect(cancelled).toBe(true);
});

it('rechecks approval expiry after settlement before admitting the current source', async () => {
  const f = fixture();
  let wall = Date.parse('2026-10-30T00:00:00Z');
  f.options.wallNow = () => wall;
  f.settle.mockImplementationOnce(async (_wire, source) => {
    wall = Date.parse('2031-01-01T00:00:00Z');
    return f.receipt(source);
  });
  const result = await runReadOnlyHarness(envelope(), f.options);
  expect(result.outcome).toBe('stopped'); expect(f.posts).toHaveLength(1);
});

it('rejects inconsistent per-dispatch timing instead of reporting fabricated throughput', async () => {
  const f = fixture();
  f.settle.mockImplementationOnce(async (_wire, source) => {
    const r = f.receipt(source);
    r.events[0] = { kind: 'process', turnId: hashId('t'), attemptId: hashId('a'),
      stage: 'model-first-output', dispatchId: hashId('d'), durationMs: 31 };
    return r;
  });
  const result = await runReadOnlyHarness(envelope(), f.options);
  expect(result.outcome).toBe('stopped'); expect(f.posts).toHaveLength(1);
});
