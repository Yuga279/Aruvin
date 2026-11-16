/**
 * ============================================================================
 * FILE: calendar-runtime-regressions.spec.ts
 * LOCATION: backend/test/runtime/calendar-runtime-regressions.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Reproduce Calendar HTTP accounting gaps and stale disclosure revisions.
 *
 * ROLE IN PROJECT:
 *    Exercises the source-owned runtime through the real application assembly
 *    with deterministic Google REST and model fixtures.
 *    Verifies persistent request budgets and the current discovery binding.
 *
 * KEY COMPONENTS:
 *    - Target-precedence deliveries: Each actual Google request is charged once.
 *    - Incomplete-coverage disclosure: Proposal revision matches current discovery.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { createWire, loadWire, textWire } from './calendar-runtime.fixture.js';
import { event } from './calendar-multi-fixture.js';
import { assembledCalendarApp } from '../assembly/calendar-fixture.js';

const USER = 'aurvin-dev-user';
let sequence = 0;

async function run(h: Awaited<ReturnType<typeof assembledCalendarApp>>, content: string,
  wires: string[], sessionId: string | null = null) {
  h.cal.modelWires.push(...wires);
  const ids = await h.service.operations.runtime.submitTurn({
    identity: { userId: USER, openRouterUser: USER, source: 'authenticated-session' },
    sessionId,
    content,
    idempotencyKey: `runtime-regression-${++sequence}`,
  });
  await h.service.operations.runtime.executeTurn({
    userId: USER,
    sessionId: ids.sessionId,
    turnId: ids.turnId,
    attemptId: ids.attemptId,
    signal: new AbortController().signal,
    emit: async () => undefined,
    emitCalendar: async () => undefined,
  });
  return ids;
}

const googleDeliveries = (h: Awaited<ReturnType<typeof assembledCalendarApp>>) =>
  h.fetcher.mock.calls.filter(([url]) =>
    String(url).startsWith('https://www.googleapis.com/calendar/v3/'));

it.each([
  { saved: null, suffix: '', expected: 'owned' },
  { saved: 'team@example.test', suffix: '', expected: 'team@example.test' },
  { saved: 'owned', suffix: ' in my Work calendar', expected: 'team@example.test' },
] as const)('charges every actual Calendar delivery once for target precedence $expected (saved $saved)', async row => {
  const h = await assembledCalendarApp();
  try {
    if (row.saved !== null) await h.cal.setDefault(row.saved);
    const content = `Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC${row.suffix}.`;
    const ids = await run(h, content,
      [loadWire('calendar_create_event'), createWire(event()), textWire('Created.')]);
    const operation = await h.cal.p.calendarOperationsV2.getByTurn(USER, ids.sessionId, ids.turnId);
    const deliveries = googleDeliveries(h);
    const budget = await h.cal.p.calendarAccountingV2.getBudget(USER, ids.sessionId, ids.turnId);

    expect(operation).toMatchObject({ state: 'succeeded', calendarId: row.expected });
    expect(deliveries.length).toBeGreaterThan(0);
    expect(budget?.calendarRequests, 'Every actual in-turn Google delivery must be charged once')
      .toBe(deliveries.length);
  } finally {
    await h.dispose();
  }
});

it('publishes incomplete coverage against the current discovery revision', async () => {
  const h = await assembledCalendarApp();
  const putCurrent = vi.spyOn(h.cal.p.calendarProposals, 'putCurrent');
  try {
    h.cal.setAvailability({ calendarErrors: { 'read@example.test': 'notFound' } });
    const ids = await run(h, 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
      [loadWire('calendar_create_event'), createWire(event())]);
    const write = putCurrent.mock.calls
      .map(([input]) => input.proposal)
      .find(proposal => proposal.purpose === 'conflict');
    const current = await h.cal.p.calendarConnectionsV2.get(USER);

    expect(write).toBeDefined();
    expect(current?.discovery).not.toBeNull();
    expect(write?.discoveryRevision).toBe(current?.discovery?.discoveryRevision);
    expect(await h.cal.p.calendarProposals.getCurrent(USER, ids.sessionId))
      .toMatchObject({ purpose: 'conflict', disclosedLimitations: expect.arrayContaining(['calendar-error']) });
  } finally {
    putCurrent.mockRestore();
    await h.dispose();
  }
});

it('admits turn calendar budget under strict ownership fencing and refreshes missing discovery on list_calendars', async () => {
  const h = await assembledCalendarApp();
  const origRun = h.cal.p.owner.run.bind(h.cal.p.owner);
  h.cal.p.owner.run = async (lease, action) => {
    if (!(await h.cal.p.owner.fence(lease))) {
      throw new Error('Execution ownership was lost.');
    }
    return origRun(lease, action);
  };
  try {
    const current = await h.cal.p.calendarConnectionsV2.get(USER);
    if (!current || current.schemaVersion !== 2) throw new Error('Missing connection');
    await h.cal.p.calendarConnectionsV2.compareAndSwap({
      userId: USER,
      expectedRevision: current.revision,
      expectedConnectionRevision: current.connectionRevision,
      expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
      next: { ...current, revision: current.revision + 1, discovery: null },
    });
    const listWire = [
      `data: ${JSON.stringify({
        id: 'gen_fixture',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'call_tool', arguments: JSON.stringify({
                plugin: 'google-calendar', tool: 'calendar_list_calendars', arguments: {},
              }) },
            }],
          },
          finish_reason: null,
        }],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: 'gen_fixture',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      })}\n\n`,
      'data: [DONE]\n\n',
    ].join('');
    const ids = await run(h, 'What calendars do I have?',
      [loadWire('calendar_list_calendars'), listWire, textWire('You have Owned, Work, and Reading.')]);
    const budget = await h.cal.p.calendarAccountingV2.getBudget(USER, ids.sessionId, ids.turnId);
    expect(budget?.logicalTools).toBe(1);
    expect(budget?.calendarRequests).toBe(1);
    const refreshed = await h.cal.p.calendarConnectionsV2.get(USER);
    expect(refreshed?.discovery).not.toBeNull();
  } finally {
    await h.dispose();
  }
});
