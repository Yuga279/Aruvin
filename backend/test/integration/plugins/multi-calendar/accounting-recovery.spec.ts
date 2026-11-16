/**
 * ============================================================================
 * FILE: accounting-recovery.spec.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/accounting-recovery.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Compare real assembled deliveries with durable budgets and pinned effects.
 * ROLE IN PROJECT:
 *    Measures the production ledger and real connection/MCP paths over fixtures.
 *    Distinguishes unknown effects from permission to repeat inference or writes.
 * KEY COMPONENTS:
 *    - Accounting: Independent fetch counts, dispatch attribution and grouping.
 *    - Recovery: Original calendar/event identity after preference changes.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { CalendarApiTools } from '../../../../src/plugins/google-calendar/tools.js';
import { createWire, skillWire, textWire } from '../../../runtime/calendar-runtime.fixture.js';
import { event } from '../../../runtime/calendar-multi-fixture.js';
import { loadWire } from '../../../assembly/skill-fixture.js';
import { openApp } from './assembled.js';

const content = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.';
type App = Awaited<ReturnType<typeof openApp>>;
const calendarCalls = (h: App) => h.fetcher.mock.calls.filter(([url]) =>
  new URL(String(url)).origin === 'https://www.googleapis.com'
    && new URL(String(url)).pathname.startsWith('/calendar/v3/'));
function malformedCreateWire(id: string): string {
  return skillWire('call_tool',
    '{"plugin":"google-calendar","tool":"calendar_create_event","arguments":{"summary":', id);
}

it('counts every actual discovery capability preflight and create delivery exactly once', async () => {
  const h = await openApp();
  const invoke = vi.spyOn(CalendarApiTools.prototype, 'invoke');
  try {
    h.fetcher.mockClear();
    h.cal.modelWires.push(malformedCreateWire('recovery-malformed'),
      loadWire(['calendar_create_event'], 'recovery-load'), createWire(event()), textWire('Created.'));
    const ids = await h.submit(content);
    await h.stream(ids);
    const budget = await h.cal.p.calendarAccountingV2.getBudget('aurvin-dev-user', ids.sessionId, ids.turnId);
    expect(budget).toMatchObject({ modelDispatches: 3, repairs: 1, logicalTools: 1, creates: 1 });
    expect(calendarCalls(h).length).toBeGreaterThan(1);
    expect(budget?.calendarRequests).toBe(calendarCalls(h).length);
    expect(budget!.calendarRequests).toBeLessThanOrEqual(20);
    expect(budget!.refreshRequests).toBeLessThanOrEqual(2);
    const dispatches = await h.cal.p.calendarAccountingV2.listDispatches('aurvin-dev-user', ids.turnId);
    expect(dispatches).toHaveLength(3);
    expect(new Set(dispatches.map(row => row.dispatchId)).size).toBe(3);
    expect(dispatches.every(row => row.openRouterUser === 'aurvin-dev-user'
      && row.schemaRevision === 'google-calendar.v2' && row.pricing.modelId.length > 0)).toBe(true);
    expect(h.cal.modelBodies.every(body => body.user === 'aurvin-dev-user')).toBe(true);
    expect(invoke).toHaveBeenCalled();
    const messages = h.cal.modelBodies.at(-1)!.messages as Array<{
      role: string; content?: string; tool_call_id?: string; tool_calls?: Array<{ id: string }>;
    }>;
    expect(messages.filter(message => message.role === 'user' && message.content === content)).toHaveLength(1);
    const calls = messages.flatMap(message => message.tool_calls ?? []).map(call => call.id);
    const results = messages.filter(message => message.role === 'tool').map(message => message.tool_call_id);
    // Successful creates seal locally: no continuation request carries the
    // completed create group. Only the earlier activation group is retained.
    expect(calls).toEqual(['recovery-load']);
    expect(results).toEqual(calls);
    const saved = await h.cal.calendarGraphState(ids.sessionId);
    expect(saved.values.calendarRefs.toolCallIds).toHaveLength(2);
    expect(saved.values.calendarSeal.operationId).toBeTruthy();
    expect(JSON.stringify(h.cal.modelBodies)).not.toMatch(/fixture-access-token|refresh_token|client_secret|private_reasoning/iu);
  } finally { invoke.mockRestore(); await h.dispose(); }
}, 20000);

it('does not exceed two structural repairs or perform an effect on exhausted repair', async () => {
  const h = await openApp();
  try {
    h.cal.modelWires.push(malformedCreateWire('repair-one'), malformedCreateWire('repair-two'),
      malformedCreateWire('repair-three'));
    const ids = await h.submit(content);
    await h.stream(ids);
    const budget = await h.cal.p.calendarAccountingV2.getBudget('aurvin-dev-user', ids.sessionId, ids.turnId);
    expect(budget).toMatchObject({ modelDispatches: 3, repairs: 2, creates: 0 });
    expect(h.cal.modelBodies).toHaveLength(3);
    expect(calendarCalls(h).filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(await h.cal.operationFor(ids)).toBeNull();
  } finally { await h.dispose(); }
}, 20000);

it('pins the target when the saved default changes during provider dispatch', async () => {
  const h = await openApp();
  const original = h.fetcher.getMockImplementation()!;
  let changed = false;
  h.fetcher.mockImplementation(async (url, init) => {
    if (!changed && String(url).includes('/events') && init?.method === 'POST') {
      changed = true;
      await h.cal.setDefault('owned');
    }
    return original(url, init);
  });
  try {
    h.cal.modelWires.push(loadWire(['calendar_create_event'], 'pinned-load'),
      createWire(event()), textWire('Created.'));
    const ids = await h.submit(content);
    await h.stream(ids);
    expect(changed).toBe(true);
    expect(await h.cal.operationFor(ids)).toMatchObject({ state: 'succeeded', calendarId: 'team@example.test',
      action: { calendarId: 'team@example.test' }, receipt: { calendarId: 'team@example.test' } });
    expect(calendarCalls(h).filter(([, init]) => init?.method === 'POST'
      && String(init?.body).includes('aurvinOperationId'))).toHaveLength(1);
  } finally { await h.dispose(); }
}, 20000);

it('readbacks only the original effect after receipt failure and a default switch', async () => {
  const h = await openApp();
  try {
    h.cal.failOnce('receipt-save');
    h.cal.modelWires.push(loadWire(['calendar_create_event'], 'readback-load'), createWire(event()));
    const ids = await h.submit(content);
    await h.stream(ids);
    const old = await h.cal.operationFor(ids);
    expect(['dispatching', 'unknown']).toContain(old?.state);
    await h.cal.setDefault('owned');
    const before = h.fetcher.mock.calls.length;
    await h.service.operations.runtime.reconcileSession('aurvin-dev-user', ids.sessionId);
    const next = await h.cal.operationFor(ids);
    expect(next).toMatchObject({ state: 'succeeded', operationId: old!.operationId,
      calendarId: 'team@example.test', googleEventId: old!.googleEventId });
    const after = h.fetcher.mock.calls.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every(([url, init]) => (init?.method ?? 'GET') === 'GET'
      && !String(url).includes('/chat/completions') && !String(url).includes('/freeBusy'))).toBe(true);
    const reads = after.filter(([url]) => String(url).includes('/events/'));
    expect(reads).toHaveLength(1);
    expect(decodeURIComponent(new URL(String(reads[0][0])).pathname))
      .toBe(`/calendar/v3/calendars/team@example.test/events/${old!.googleEventId}`);
    expect(h.cal.modelBodies).toHaveLength(2);
  } finally { await h.dispose(); }
}, 20000);
