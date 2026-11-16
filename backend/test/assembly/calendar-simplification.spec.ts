/**
 * ============================================================================
 * FILE: calendar-simplification.spec.ts
 * LOCATION: backend/test/assembly/calendar-simplification.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify native Calendar contracts and diagnostics through AppService assembly.
 *
 * ROLE IN PROJECT:
 *    Captures actual serialized model requests from the production runtime,
 *    adapter, scanner, serializer and fixture-backed Calendar execution path.
 *
 * KEY COMPONENTS:
 *    - toolWire: Builds deterministic native model tool-call streams.
 *    - execute: Runs a durable turn through the assembled offline application.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { effectiveCalendarCapabilities } from '../../src/contracts/calendar-discovery.js';
import { SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';
import { textWire } from '../runtime/calendar-runtime.fixture.js';
import { assembledCalendarApp } from './calendar-fixture.js';
import { callWire, loadWire } from './skill-fixture.js';

type Assembly = Awaited<ReturnType<typeof assembledCalendarApp>>;
function toolWire(name: string, raw = '{}', id = 'call-contract'): string {
  return callWire(name, JSON.parse(raw), id);
}
async function execute(h: Assembly, question = 'What calendars do I own?') {
  const runtime = h.service.operations.runtime;
  const ids = await runtime.submitTurn({ identity: { userId: 'aurvin-dev-user',
    openRouterUser: 'aurvin-dev-user', source: 'authenticated-session' }, sessionId: null,
    content: question, idempotencyKey: 'calendar-contract-0001' });
  const frames: unknown[] = [];
  await runtime.executeTurn({ userId: 'aurvin-dev-user', ...ids, signal: new AbortController().signal,
    emit: async frame => { frames.push(frame); }, emitCalendar: async frame => { frames.push(frame); } });
  return { ids, frames };
}

it('serializes identical truthful native contracts on initial correction and continuation requests', async () => {
  const lines: string[] = [];
  const h = await assembledCalendarApp({ writeLog: line => { lines.push(line); } });
  try {
    h.cal.modelWires.push(loadWire(['calendar_list_calendars'], 'contract-load'),
      toolWire('calendar_list_calendars', '{"pageToken":null}', 'contract-invalid'),
      toolWire('calendar_list_calendars', '{}', 'contract-corrected'), textWire('Fixture-qualified answer.'));
    await execute(h);
    expect(h.cal.modelBodies).toHaveLength(4);
    const expected = SKILL_NATIVE_TOOLS.map(tool => ({ type: 'function', function: {
      name: tool.name, description: tool.description, parameters: tool.inputSchema,
    } }));
    for (const body of h.cal.modelBodies) {
      expect(body.tools).toEqual(expected);
      expect(body.user).toBe('aurvin-dev-user');
      expect(body).toMatchObject({ provider: { data_collection: 'deny', require_parameters: true } });
      expect(JSON.stringify(body.tools)).not.toContain('accessToken');
    }
    const records = lines.map(line => JSON.parse(line));
    expect(records.filter(record => record.stage === 'model-dispatch').map(record => record.dispatchKind))
      .toEqual(['initial', 'continuation', 'schema-repair', 'continuation']);
    expect(records).toContainEqual(expect.objectContaining({ stage: 'model-decision', decisionKind: 'tool' }));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'tool-execution', state: 'ok',
      tool: 'calendar_list_calendars' }));
    const repaired = h.cal.modelBodies[2]!.messages as Array<{ role: string; content?: string }>;
    expect(repaired.some(message => message.role === 'tool'
      && message.content?.includes('ARGUMENTS_INVALID'))).toBe(true);
    expect(repaired.at(-1)?.content).toContain('Validation errors');
    expect(repaired.at(-1)?.content).not.toContain('"inputSchema"');
    const continuation = h.cal.modelBodies[3]!.messages as Array<{ role: string; content?: string }>;
    expect(continuation.filter(message => message.role === 'tool')).toHaveLength(3);
    expect(continuation.some(message => message.content?.includes('skill-disclosure'))).toBe(true);
    expect(continuation.some(message => message.content?.includes('ARGUMENTS_INVALID'))).toBe(true);
    expect(continuation.some(message => message.content?.includes('"calendars"'))).toBe(true);
    expect(continuation.filter(message => message.role === 'user')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('accepts {} and a returned Aurvin continuation through production assembly with qualified roles', async () => {
  const h = await assembledCalendarApp({ realAssets: true });
  const original = h.fetcher.getMockImplementation()!;
  const pages: Array<{ calendars: Array<{ calendarId: string; accessRole: string; primary: boolean }>;
    nextPageToken: string | null }> = [];
  let dispatch = 0;
  try {
    const current = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
    if (!current || current.schemaVersion !== 2 || !current.discovery) throw new Error('Missing fixture discovery');
    const base = current.discovery.entries[0]!;
    const entries = Array.from({ length: 21 }, (_, index) => {
      const role = index === 2 ? 'writer' as const : index === 3 ? 'reader' as const : 'owner' as const;
      return { ...base, calendarId: index === 0 ? 'owned' : index === 1 ? 'managed-secondary' : `cal-${index}`,
        label: index === 0 ? 'Primary' : index === 1 ? 'Managed secondary' : `Calendar ${index}`,
        primary: index === 0, accessRole: role, privateAccess: role !== 'reader',
        capabilities: effectiveCalendarCapabilities(role, current.grantedScopes, true) };
    });
    const saved = await h.cal.p.calendarConnectionsV2.compareAndSwap({ userId: current.userId,
      expectedRevision: current.revision, expectedConnectionRevision: current.connectionRevision,
      expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
      next: { ...current, revision: current.revision + 1, discovery: {
        ...current.discovery, discoveryRevision: current.discovery.discoveryRevision + 1, entries } } });
    expect(saved.outcome).toBe('confirmed');
    h.fetcher.mockImplementation(async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.origin !== 'https://openrouter.ai' || parsed.pathname !== '/api/v1/chat/completions') {
        return original(url, init);
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      h.cal.modelBodies.push(body);
      const messages = body.messages as Array<{ role: string; content: string }>;
      const result = messages.filter(message => message.role === 'tool').at(-1);
      if (result) {
        const value = JSON.parse(result.content);
        if (Array.isArray(value.calendars)) pages.push(value);
      }
      dispatch += 1;
      let wire: string;
      if (dispatch === 1) wire = loadWire(['calendar_list_calendars'], 'pagination-load');
      else if (dispatch === 2) wire = toolWire('calendar_list_calendars', '{}', 'page-one');
      else if (dispatch === 3) {
        expect(pages[0]!.nextPageToken).toEqual(expect.any(String));
        wire = toolWire('calendar_list_calendars', JSON.stringify({ pageToken: pages[0]!.nextPageToken }), 'page-two');
      } else if (dispatch === 4) wire = textWire('Primary is your primary calendar. Managed secondary grants manager access; I cannot establish its data ownership. This covers the visible retained list only.');
      else throw new Error('Unbounded fixture dispatch');
      return new Response(wire.replaceAll('gen_fixture', `gen_pagination_${dispatch}`), {
        headers: { 'content-type': 'text/event-stream' } });
    });
    const { ids } = await execute(h);
    expect(dispatch).toBe(4);
    expect(pages.map(page => page.calendars.length)).toEqual([20, 1]);
    expect(pages[1]!.nextPageToken).toBeNull();
    const calendars = pages.flatMap(page => page.calendars);
    expect(new Set(calendars.map(calendar => calendar.calendarId)).size).toBe(21);
    expect(calendars).toContainEqual(expect.objectContaining({ calendarId: 'managed-secondary', accessRole: 'owner', primary: false }));
    expect(calendars).toContainEqual(expect.objectContaining({ calendarId: 'owned', primary: true }));
    const system = (h.cal.modelBodies[0]!.messages as Array<{ role: string; content: string }>)
      .filter(message => message.role === 'system').map(message => message.content).join('\n');
    expect(system).toContain('manager access');
    expect(system).toContain('not proof of data ownership');
    expect(h.fetcher.mock.calls.filter(([url]) => new URL(String(url)).origin === 'https://www.googleapis.com')).toHaveLength(0);
    expect(await h.cal.p.metadata.getAttempt('aurvin-dev-user', ids.sessionId, ids.attemptId)).toMatchObject({ status: 'completed' });
    expect(await h.cal.p.calendarAccountingV2.getBudget('aurvin-dev-user', ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 0, logicalTools: 2 });
  } finally { await h.dispose(); }
});
