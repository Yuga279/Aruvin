/**
 * ============================================================================
 * FILE: calendar-observability.spec.ts
 * LOCATION: backend/test/assembly/calendar-observability.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify safe process traces through the offline production assembly.
 *
 * ROLE IN PROJECT:
 *    Exercises AppService, durable runtime, real model serialization
 *    and the current Calendar executor without live providers or application data.
 *
 * KEY COMPONENTS:
 *    - run: Capture one scripted turn and its unchanged durable outcome.
 *    - Diagnostic assertions: Reject locally, execute fixtures and separate fallback.
 * ============================================================================
 */
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { AppService } from '../../src/app.service.js';
import { assembledCalendarApp } from './calendar-fixture.js';
import { assemblyFixture } from './admin-config-fixture.js';
import { textWire } from '../runtime/calendar-runtime.fixture.js';
import { callWire, loadWire } from './skill-fixture.js';

function tool(name: string, raw = '{}', id = 'call-contract') {
  return callWire(name, JSON.parse(raw), id);
}
const hash = (v: string) => `h:${createHash('sha256').update(v).digest('hex').slice(0, 24)}`;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

type Assembly = Awaited<ReturnType<typeof assembledCalendarApp>>;
async function run(wires: string[], throwing = false,
  prepare: (h: Assembly) => void | Promise<void> = () => undefined, question = 'PRIVATE_QUESTION') {
  const lines: string[] = [];
  const h = await assembledCalendarApp({ writeLog: line => {
    if (throwing) throw new Error('PRIVATE_SINK_FAILURE');
    lines.push(line);
  } });
  try {
    await prepare(h);
    h.cal.modelWires.push(...wires);
    const runtime = h.service.operations.runtime;
    const ids = await runtime.submitTurn({ identity: { userId: 'aurvin-dev-user',
      openRouterUser: 'aurvin-dev-user', source: 'authenticated-session' }, sessionId: null,
      content: question, idempotencyKey: 'visibility-0001' });
    const frames: unknown[] = [];
    await runtime.executeTurn({ userId: 'aurvin-dev-user', ...ids, signal: new AbortController().signal,
      emit: async f => { frames.push(f); }, emitCalendar: async f => { frames.push(f); } });
    const attempt = await h.cal.p.metadata.getAttempt('aurvin-dev-user', ids.sessionId, ids.attemptId);
    const googleCalls = h.fetcher.mock.calls.filter(([url]) => new URL(String(url)).origin === 'https://www.googleapis.com').length;
    const eventCalls = h.fetcher.mock.calls.filter(([url]) => {
      const parsed = new URL(String(url));
      return parsed.origin === 'https://www.googleapis.com' && parsed.pathname.includes('/events/');
    }).length;
    return { records: lines.map(line => JSON.parse(line) as Record<string, unknown>), lines,
      attempt, ids, frames, googleCalls, eventCalls, modelCalls: h.cal.modelBodies.length };
  } finally { await h.dispose(); }
}

it('traces local cursor rejection correction cache execution and durable completion', async () => {
  const r = await run([loadWire(['calendar_list_calendars'], 'cursor-load'),
    tool('calendar_list_calendars', '{"pageToken":"first"}', 'cursor-bad'),
    tool('calendar_list_calendars', '{}', 'cursor-corrected'), textWire('Fixture answer.')]);
  const records = r.records.filter(f => f.kind === 'process');
  expect(records).toContainEqual(expect.objectContaining({ stage: 'cursor', state: 'rejected',
    reason: 'cursor-format', origin: 'local', delivery: 'not-sent', field: 'pageToken',
    code: 'CALENDAR_INPUT_REJECTED' }));
  expect(records).toContainEqual(expect.objectContaining({ stage: 'correction', correctionAttempt: 0, correctionLimit: 2 }));
  expect(records).toContainEqual(expect.objectContaining({ stage: 'cache', origin: 'cache', delivery: 'not-sent' }));
  expect(records).toContainEqual(expect.objectContaining({ stage: 'task-outcome', task: 'success' }));
  expect(records).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
  expect(r.attempt?.status).toBe('completed');
  expect(r.googleCalls).toBe(0);
  expect(r.modelCalls).toBe(4);
  const correlated = records.filter(f => ['model-dispatch', 'model-decision', 'cursor', 'correction', 'task-outcome', 'terminal'].includes(String(f.stage)));
  expect(correlated.length).toBeGreaterThan(5);
  expect(correlated.every(f => f.attemptId === hash(r.ids.attemptId))).toBe(true);
  expect(records.filter(f => f.stage === 'model-dispatch')).toHaveLength(4);
  expect(records.some(f => f.stage === 'provider-request' && f.provider === 'google-calendar')).toBe(false);
  for (const line of r.lines) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(4096);
  expect(r.lines.join('\n')).not.toContain('PRIVATE_QUESTION');
});

it('does not equate delivered correction exhaustion with a successful calendar task', async () => {
  const wires = [loadWire(['calendar_list_calendars'], 'exhaust-load'),
    ...Array.from({ length: 3 }, (_, index) =>
      tool('calendar_list_calendars', '{"pageToken":"first"}', `exhaust-${index}`))];
  const r = await run(wires);
  expect(r.attempt?.status).toBe('completed');
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'correction', reason: 'budget-exhausted',
    code: 'REPAIR_EXHAUSTED', correctionAttempt: 2, correctionLimit: 2 }));
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'task-outcome', task: 'fallback' }));
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
  expect(r.records.some(f => f.task === 'success')).toBe(false);
  expect(r.googleCalls).toBe(0);
  expect(r.modelCalls).toBe(4);
});

it('keeps interleaved concurrent production-assembly attempts on their own diagnostic scopes', async () => {
  const lines: string[] = [];
  const h = await assembledCalendarApp({ writeLog: line => { lines.push(line); } });
  const startedA = deferred();
  const startedB = deferred();
  const releaseA = deferred();
  const releaseB = deferred();
  let executeA: Promise<void> | undefined;
  let executeB: Promise<void> | undefined;
  const original = h.fetcher.getMockImplementation()!;
  h.fetcher.mockImplementation(async (url, init) => {
    const parsed = new URL(String(url));
    if (parsed.origin === 'https://openrouter.ai' && parsed.pathname === '/api/v1/chat/completions') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        messages?: { role?: string; content?: unknown }[];
      };
      const prompt = body.messages?.filter(message => message.role === 'user').at(-1)?.content;
      const isA = typeof prompt === 'string' && prompt.includes('PRIVATE_INTERLEAVE_A');
      const isB = typeof prompt === 'string' && prompt.includes('PRIVATE_INTERLEAVE_B');
      if (!isA && !isB) {
        startedA.resolve();
        startedB.resolve();
        throw new Error('Unexpected interleaved fixture request.');
      }
      h.cal.modelBodies.push(body as Record<string, unknown>);
      const started = isA ? startedA : startedB;
      const release = isA ? releaseA : releaseB;
      started.resolve();
      await release.promise;
      const generation = isA ? 'gen_interleave_a' : 'gen_interleave_b';
      return new Response(textWire(isA ? 'Answer A.' : 'Answer B.').replaceAll('gen_fixture', generation), {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      });
    }
    return original(url, init);
  });
  try {
    const runtime = h.service.operations.runtime;
    const identity = { userId: 'aurvin-dev-user', openRouterUser: 'aurvin-dev-user', source: 'authenticated-session' as const };
    const idsA = await runtime.submitTurn({ identity, sessionId: null, content: 'PRIVATE_INTERLEAVE_A', idempotencyKey: 'interleave-a' });
    const idsB = await runtime.submitTurn({ identity, sessionId: null, content: 'PRIVATE_INTERLEAVE_B', idempotencyKey: 'interleave-b' });
    const framesA: unknown[] = [];
    const framesB: unknown[] = [];
    const execute = (ids: typeof idsA, frames: unknown[]) => runtime.executeTurn({ userId: identity.userId, ...ids,
      signal: new AbortController().signal, emit: async frame => { frames.push(frame); },
      emitCalendar: async frame => { frames.push(frame); } });
    executeA = execute(idsA, framesA);
    executeB = execute(idsB, framesB);
    await Promise.all([startedA.promise, startedB.promise]);
    releaseB.resolve();
    await executeB;
    releaseA.resolve();
    await executeA;

    const records = lines.map(line => JSON.parse(line) as Record<string, unknown>);
    const attemptA = records.filter(record => record.attemptId === hash(idsA.attemptId));
    const attemptB = records.filter(record => record.attemptId === hash(idsB.attemptId));
    expect(attemptA).toContainEqual(expect.objectContaining({ stage: 'model-dispatch', provider: 'openrouter' }));
    expect(attemptB).toContainEqual(expect.objectContaining({ stage: 'model-dispatch', provider: 'openrouter' }));
    expect(attemptA).toContainEqual(expect.objectContaining({ stage: 'model-response', generationId: hash('gen_interleave_a') }));
    expect(attemptB).toContainEqual(expect.objectContaining({ stage: 'model-response', generationId: hash('gen_interleave_b') }));
    expect(attemptA).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
    expect(attemptB).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
    expect(attemptA.some(record => record.generationId === hash('gen_interleave_b'))).toBe(false);
    expect(attemptB.some(record => record.generationId === hash('gen_interleave_a'))).toBe(false);
    expect(lines.join('\n')).not.toContain('PRIVATE_INTERLEAVE_');
    expect(framesA).not.toEqual([]);
    expect(framesB).not.toEqual([]);
  } finally {
    releaseA.resolve();
    releaseB.resolve();
    await Promise.allSettled([executeA, executeB].filter((run): run is Promise<void> => Boolean(run)));
    await h.dispose();
  }
});

it('keeps logging failure out of response durability and provider execution', async () => {
  const wires = [loadWire(['calendar_list_calendars'], 'logging-load'),
    tool('calendar_list_calendars', '{}', 'logging-list'), textWire('Fixture answer.')];
  const baseline = await run(wires);
  const throwing = await run(wires, true);
  expect(throwing.attempt?.status).toBe(baseline.attempt?.status);
  expect(throwing.modelCalls).toBe(baseline.modelCalls);
  expect(throwing.googleCalls).toBe(baseline.googleCalls);
  expect(throwing.frames).toEqual(baseline.frames);
});

it('distinguishes a received Google 400 from an unsent local argument rejection', async () => {
  const r = await run([loadWire(['calendar_get_event'], 'provider-load'),
    tool('calendar_get_event', '{"eventId":"abcde"}', 'provider-get'), textWire('Unable to read.')], false, h => {
    const original = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.origin === 'https://www.googleapis.com' && parsed.pathname.includes('/events/')) {
        return new Response(JSON.stringify({ error: { message: 'PRIVATE_PROVIDER_BODY' } }),
          { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return original(url, init);
    });
  });
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'provider-request',
    provider: 'google-calendar', delivery: 'attempted' }));
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'provider-response',
    provider: 'google-calendar', origin: 'provider', delivery: 'response-received',
    reason: 'provider-4xx', code: 'CALENDAR_INPUT_REJECTED' }));
  expect(r.records.some(f => f.stage === 'cursor')).toBe(false);
  expect(r.eventCalls).toBe(1);
  expect(r.lines.join('\n')).not.toContain('PRIVATE_PROVIDER_BODY');
});

it('observes the real discovery refresh before a local snapshot projection', async () => {
  const r = await run([loadWire(['calendar_list_calendars'], 'discovery-load'),
    tool('calendar_list_calendars', '{}', 'discovery-list'), textWire('Fixture answer.')], false, async h => {
    const current = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
    if (!current || current.schemaVersion !== 2 || !current.discovery) throw new Error('Missing fixture discovery');
    const result = await h.cal.p.calendarConnectionsV2.compareAndSwap({ userId: current.userId,
      expectedRevision: current.revision, expectedConnectionRevision: current.connectionRevision,
      expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
      next: { ...current, revision: current.revision + 1, discovery: null } });
    expect(result.outcome).toBe('confirmed');
  });
  expect(r.googleCalls).toBe(1);
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'provider-request',
    provider: 'google-calendar', requestKind: 'discovery', delivery: 'attempted' }));
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'provider-response',
    provider: 'google-calendar', requestKind: 'discovery', delivery: 'response-received' }));
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'tool-execution', tool: 'calendar_list_calendars', origin: 'cache' }));
});

it('hashes model provider IDs and never prints private event content', async () => {
  const r = await run([loadWire(['calendar_get_event'], 'private-load'),
    tool('calendar_get_event', '{"eventId":"abcde"}', 'private-get'), textWire('PRIVATE_ASSISTANT_TEXT')], false, h => {
    const original = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      const parsed = new URL(String(url));
      if (parsed.origin === 'https://openrouter.ai') response.headers.set('x-request-id', 'private-request-id');
      if (parsed.origin === 'https://www.googleapis.com' && parsed.pathname.includes('/events/')) {
        const event = await response.json() as Record<string, unknown>;
        return new Response(JSON.stringify({ ...event, summary: 'PRIVATE_EVENT_TITLE',
          description: 'PRIVATE_EVENT_DESCRIPTION', location: 'PRIVATE_EVENT_LOCATION' }),
          { status: response.status, headers: response.headers });
      }
      return response;
    });
  });
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'model-response',
    providerRequestId: hash('private-request-id') }));
  for (const value of ['private-request-id', 'PRIVATE_ASSISTANT_TEXT', 'PRIVATE_EVENT_TITLE',
    'PRIVATE_EVENT_DESCRIPTION', 'PRIVATE_EVENT_LOCATION', 'fixture-access-token', 'fixture-refresh-token']) {
    expect(r.lines.join('\n')).not.toContain(value);
  }
});

it('does not turn an uncertain create into success or repeat its POST', async () => {
  const create = tool('calendar_create_event', JSON.stringify({ summary: 'Planning',
    start: '2026-11-03T10:00:00Z', end: '2026-11-03T11:00:00Z', timeZone: 'Etc/UTC' }), 'uncertain-create');
  let posts = 0;
  const r = await run([loadWire(['calendar_create_event'], 'uncertain-load'), create], false, h => {
    const original = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.origin === 'https://www.googleapis.com' && parsed.pathname.includes('/events')) {
        if (init?.method === 'POST') posts += 1;
        throw new Error('PRIVATE_LOST_RESPONSE');
      }
      return original(url, init);
    });
  }, 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
  expect(posts).toBe(1);
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'task-outcome',
    task: 'uncertain', writeCertainty: 'unknown' }));
  expect(r.records.some(f => f.writeCertainty === 'confirmed')).toBe(false);
  expect(r.records.some(f => f.task === 'success')).toBe(false);
  expect(r.lines.join('\n')).not.toContain('PRIVATE_LOST_RESPONSE');
});

it.each([true, false])('keeps default stdout bounded when backpressured=%s', async blocked => {
  const f = assemblyFixture();
  const { writeLog: ignoredSink, ...ports } = f.ports;
  void ignoredSink;
  const pressure = vi.spyOn(process.stdout, 'writableNeedDrain', 'get').mockReturnValue(blocked);
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  let service: AppService | undefined;
  try {
    service = await AppService.create(f.bootstrap, ports);
    write.mockClear();
    service.telemetry.event('process', { stage: 'terminal', chat: 'unknown' });
    expect(write).toHaveBeenCalledTimes(blocked ? 0 : 1);
    if (!blocked) expect(Buffer.byteLength(String(write.mock.calls[0]![0]), 'utf8')).toBeLessThanOrEqual(4097);
  } finally {
    await service?.operations.shutdown();
    write.mockRestore();
    pressure.mockRestore();
  }
});
