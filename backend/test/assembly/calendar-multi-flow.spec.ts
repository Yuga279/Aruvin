/**
 * ============================================================================
 * FILE: calendar-multi-flow.spec.ts
 * LOCATION: backend/test/assembly/calendar-multi-flow.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify current multi-calendar behavior through the central application composition.
 *
 * ROLE IN PROJECT:
 *    Uses deterministic model/Google responses with the real runtime and embedded MCP.
 *    Checks wiring without claiming native persistence or live Google acceptance.
 *
 * KEY COMPONENTS:
 *    - run: Execute an accepted turn on AppService's single runtime.
 *    - Flow checks: Precedence, preflight, durable receipts, reset, and degradation.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import type { CalendarCompatibleEnvelope } from '../../src/chat-runtime/ports.js';
import { AppService } from '../../src/app.service.js';
import { CalendarApiTools } from '../../src/plugins/google-calendar/tools.js';
import { createWire, textWire } from '../runtime/calendar-runtime.fixture.js';
import { event } from '../runtime/calendar-multi-fixture.js';
import { loadWire } from './skill-fixture.js';
import { assembledCalendarApp } from './calendar-fixture.js';

type Assembly = Awaited<ReturnType<typeof assembledCalendarApp>>;
const USER = 'aurvin-dev-user';
const requestText = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.';
let sequence = 0;

async function run(h: Assembly, content: string, wires: string[], sessionId: string | null = null) {
  await h.service.calendarFor(USER).connections.statusV2();
  h.cal.modelWires.push(...wires);
  const ids = await h.service.operations.runtime.submitTurn({
    identity: { userId: USER, openRouterUser: USER, source: 'authenticated-session' },
    sessionId, content, idempotencyKey: `assembly-multi-${++sequence}`,
  });
  const frames: CalendarCompatibleEnvelope[] = [];
  await h.service.operations.runtime.executeTurn({
    userId: USER, sessionId: ids.sessionId, turnId: ids.turnId, attemptId: ids.attemptId,
    signal: new AbortController().signal,
    emit: async () => undefined,
    emitCalendar: async frame => { frames.push(frame); },
  });
  return { ids, frames };
}

function creates(h: Assembly) {
  return h.fetcher.mock.calls.filter(([url, init]) =>
    String(url).includes('/calendar/v3/calendars/') && init?.method === 'POST');
}

it.each([
  { saved: null, suffix: '', expected: 'owned' },
  { saved: 'team@example.test', suffix: '', expected: 'team@example.test' },
  { saved: 'owned', suffix: ' in my Work calendar.', expected: 'team@example.test' },
] as const)('assembles target precedence for $expected with saved $saved', async row => {
  const h = await assembledCalendarApp();
  const invoke = vi.spyOn(CalendarApiTools.prototype, 'invoke');
  try {
    if (row.saved !== null) await h.cal.setDefault(row.saved);
    const content = row.suffix
      ? 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.'
      : requestText;
    const { ids, frames } = await run(h, content,
      [loadWire(['calendar_create_event'], 'precedence-load'), createWire(event()), textWire('Created.')]);
    const operation = await h.cal.p.calendarOperationsV2.getByTurn(USER, ids.sessionId, ids.turnId);
    expect(operation).toMatchObject({ schemaVersion: 2, calendarId: row.expected,
      state: 'succeeded', receipt: { calendarId: row.expected } });
    expect(creates(h)).toHaveLength(1);
    expect(h.cal.order.indexOf('google-freebusy')).toBeGreaterThanOrEqual(0);
    expect(h.cal.order.indexOf('google-freebusy')).toBeLessThan(h.cal.order.indexOf('google-create'));
    expect(invoke.mock.calls.some(([input]) => input.call.name === 'calendar_check_availability')).toBe(true);
    expect(invoke.mock.calls.some(([input]) => input.call.name === 'calendar_create_event')).toBe(true);
    expect(frames.some(frame => frame.event.type === 'calendar-operation'
      && 'schemaVersion' in frame.event.operation
      && frame.event.operation.schemaVersion === 2
      && frame.event.operation.state === 'succeeded'
      && frame.event.operation.receipt?.calendarLabel !== null)).toBe(true);
    expect(h.cal.modelBodies.every(body => body.user === USER)).toBe(true);
    const deliveries = h.fetcher.mock.calls.filter(([url]) =>
      String(url).startsWith('https://www.googleapis.com/calendar/v3/'));
    const budget = await h.cal.p.calendarAccountingV2.getBudget(USER, ids.sessionId, ids.turnId);
    expect(budget?.calendarRequests, 'Every actual in-turn Google delivery must be counted')
      .toBe(deliveries.length);
  } finally { invoke.mockRestore(); await h.dispose(); }
});

it('requires durable acceptance for incomplete coverage before the assembled create', async () => {
  const h = await assembledCalendarApp();
  try {
    h.cal.setAvailability({ calendarErrors: { 'read@example.test': 'notFound' } });
    const first = await run(h, requestText,
      [loadWire(['calendar_create_event'], 'coverage-load'), createWire(event())]);
    expect(creates(h)).toHaveLength(0);
    const proposal = await h.cal.p.calendarProposals.getCurrent(USER, first.ids.sessionId);
    expect(proposal).toMatchObject({ purpose: 'conflict',
      disclosedLimitations: expect.arrayContaining(['calendar-error']) });
    if (!proposal) throw new Error('Missing durable coverage proposal.');
    const reply = await run(h, 'Yes, go ahead', [textWire('Created.')], first.ids.sessionId);
    const operation = await h.cal.p.calendarOperationsV2.getByIntent(
      USER, reply.ids.sessionId, proposal.intentId);
    expect(operation).toMatchObject({ state: 'succeeded', calendarId: 'owned',
      authorization: { basis: 'conflict-acceptance', proposalId: proposal.proposalId } });
    expect(creates(h)).toHaveLength(1);
    expect(h.cal.order.filter(value => value === 'google-freebusy').length).toBeGreaterThanOrEqual(2);
  } finally { await h.dispose(); }
});

it('does not create on a discovered reader calendar even with a model create call', async () => {
  const h = await assembledCalendarApp();
  try {
    await h.cal.setRole('team@example.test', 'reader');
    const { ids } = await run(h, 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.',
      [loadWire(['calendar_create_event'], 'reader-load'), createWire(event())]);
    expect(creates(h)).toHaveLength(0);
    expect(await h.cal.p.calendarOperationsV2.getByTurn(USER, ids.sessionId, ids.turnId)).toBeNull();
  } finally { await h.dispose(); }
});

it('persists default reset across a clean reopen without retargeting a saved receipt', async () => {
  const h = await assembledCalendarApp();
  let reopened: AppService | null = null;
  try {
    await h.cal.setDefault('team@example.test');
    const { ids } = await run(h, requestText,
      [loadWire(['calendar_create_event'], 'reopen-load'), createWire(event()), textWire('Created.')]);
    const before = await h.cal.p.calendarConnectionsV2.get(USER);
    if (!before || before.schemaVersion !== 2) throw new Error('Missing fixture account.');
    await h.service.calendarFor(USER).connections.settings({ defaultSetting: {
      calendarId: null, expectedRevision: before.defaultSetting.defaultSettingRevision,
      expectedConnectionRevision: before.connectionRevision,
    } }, new AbortController().signal);
    const after = await h.cal.p.calendarConnectionsV2.get(USER);
    expect(after).toMatchObject({ connectionRevision: before.connectionRevision,
      defaultSetting: { defaultCalendarId: null,
        defaultSettingRevision: before.defaultSetting.defaultSettingRevision + 1 } });
    const operation = await h.cal.p.calendarOperationsV2.getByTurn(USER, ids.sessionId, ids.turnId);
    expect(operation).toMatchObject({ calendarId: 'team@example.test',
      receipt: { calendarId: 'team@example.test', calendarLabel: 'Work' } });
    await expect(h.service.operations.shutdown()).resolves.toEqual({ safe: true });
    reopened = await AppService.create(h.bootstrap, h.f.ports);
    expect((await reopened.calendarFor(USER).connections.statusV2()).defaultSetting)
      .toMatchObject({ defaultCalendarId: null });
    expect(h.f.ports.open).toHaveBeenCalledTimes(2);
    expect(creates(h)).toHaveLength(1);
  } finally {
    await reopened?.operations.shutdown();
    await h.dispose();
  }
});

it('keeps ordinary text healthy when Calendar refresh fails and health never retries it', async () => {
  const h = await assembledCalendarApp();
  const baseFetch = h.fetcher.getMockImplementation();
  if (!baseFetch) throw new Error('Missing scripted fetch implementation.');
  h.fetcher.mockImplementation(async (url, init) => {
    if (String(url).startsWith('https://www.googleapis.com/')) {
      throw new Error('Offline Calendar fixture.');
    }
    return baseFetch(url, init);
  });
  try {
    const current = await h.service.calendarFor(USER).connections.currentAccount();
    await expect(h.service.calendarFor(USER).connections.refreshCalendars(
      { expectedConnectionRevision: current.connectionRevision }, new AbortController().signal))
      .rejects.toBeDefined();
    h.fetcher.mockClear();
    const health = await h.service.operations.readiness.read();
    expect(health).toMatchObject({ live: true, acceptReady: true });
    expect(h.fetcher).not.toHaveBeenCalled();
    const { ids } = await run(h, 'Explain why the sky is blue.', [textWire('Sunlight scatters.')]);
    expect(await h.service.operations.runtime.getTurnStatus(USER, ids.sessionId, ids.turnId))
      .toMatchObject({ status: 'completed' });
    expect(creates(h)).toHaveLength(0);
    expect(h.fetcher.mock.calls.every(([url]) => String(url).includes('/chat/completions'))).toBe(true);
  } finally { await h.dispose(); }
});
