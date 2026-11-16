/**
 * ============================================================================
 * FILE: calendar-logical-tools.spec.ts
 * LOCATION: backend/test/runtime/calendar-logical-tools.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Proves the v2 Calendar runtime counts the model-requested logical tools,
 *    the provider requests and the mutating create row separately.
 *
 * ROLE IN PROJECT:
 *    Runtime regression coverage for the Calendar budget accounting: one
 *    model-requested logical tool call per decision, one calendar request per
 *    provider tool call, and one create row per accepted intent.
 *
 * KEY COMPONENTS:
 *    - create accounting: one logical tool, one create, two calendar requests.
 *    - read accounting: six logical reads, one calendar request each.
 *    - failed receipt save: the create stays charged once and is not replayed.
 *    - repeated approval: the same operation is not created twice.
 *    - invented page token: schema feedback, no provider outage.
 *    - unrelated message: ordinary text, no effect, proposal still pending.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import type { SubmitTurnResponse } from '../../src/contracts/api.js';
import type { CalendarCreateInput } from '../../src/contracts/calendar-tools.js';
import {
  calendarFixture, createWire, loadWire, nativeWire, skillWire, textWire, type CalendarRuntimeFixture,
} from './calendar-runtime.fixture.js';
import { busy, disclose, event } from './calendar-multi-fixture.js';

const REQUEST = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.';
const ACTION: CalendarCreateInput = event();

it('charges schema correction for an invented calendar page token without blaming the user', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('List my calendars');
    h.modelWires.push(loadWire('calendar_list_calendars'),
      skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_list_calendars',
        arguments: { pageToken: 'first' } }, 'list-one'),
      skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_list_calendars',
        arguments: {} }, 'list-corrected'), textWire('You own Personal.'));
    await h.execute(ids);
    expect(h.modelBodies).toHaveLength(4);
    expect(await turnBudget(h, ids)).toMatchObject({ repairs: 1, logicalTools: 2, calendarRequests: 0 });
    expect(h.effects).toHaveLength(0);
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    const assistant = messages.items.filter(message => message.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toBe('You own Personal.');
    expect(assistant[0].content).not.toMatch(/provider|outage|operationId|credential/iu);
  } finally { await h.dispose(); }
});

async function turnBudget(h: CalendarRuntimeFixture, ids: SubmitTurnResponse) {
  return h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
}

it('charges one logical tool call for one create', async () => {
  const h = calendarFixture();
  try {
    h.clearAvailability();
    const ids = await h.submit(REQUEST);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(ACTION, 'create-one'), textWire('Created.'));
    await h.execute(ids);
    const budget = await turnBudget(h, ids);
    expect(budget).toMatchObject({
      modelDispatches: 2, repairs: 0, logicalTools: 1, creates: 1, calendarRequests: 2,
    });
    // The preflight and the create are the only provider calls of the turn.
    expect(h.requestKinds).toEqual(['preflight', 'create']);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('allows the sixth logical tool call and rejects the seventh', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'));
    for (let index = 0; index < 7; index += 1) h.modelWires.push(nativeWire(JSON.stringify({ eventId: `abcde${index}` })));
    await expect(h.execute(ids)).rejects.toMatchObject({ code: 'STORAGE_BUDGET_EXCEEDED' });
    const budget = await turnBudget(h, ids);
    expect(budget?.logicalTools).toBe(6);
    expect(budget?.creates).toBe(0);
    // One calendar request per provider read, and the rejected seventh call
    // never reaches the provider.
    expect(budget?.calendarRequests).toBe(6);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(6);
  } finally { await h.dispose(); }
});

it('keeps one logical tool call and one create when the receipt save fails', async () => {
  const h = calendarFixture();
  try {
    h.clearAvailability();
    const ids = await h.submit(REQUEST);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(ACTION, 'create-one'), textWire('Created.'));
    h.failOnce('receipt-save');
    await expect(h.execute(ids)).rejects.toBeDefined();
    const budget = await turnBudget(h, ids);
    expect(budget).toMatchObject({ logicalTools: 1, creates: 1 });
    // Google created the event exactly once and the failed turn is never
    // replayed into a second model dispatch or a second create.
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(2);
  } finally { await h.dispose(); }
});

it('keeps one logical tool call and one create when the same operation is delivered again', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
    const first = await disclose(h, REQUEST, ACTION);
    const reply = await h.reply(first.proposal, 'Go ahead', first.ids.sessionId);
    h.modelWires.push(textWire('Created despite the disclosed conflict.'));
    await h.execute(reply);
    const budget = await turnBudget(h, reply);
    expect(budget).toMatchObject({ logicalTools: 1, creates: 1 });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    expect(await h.proposalAuthority(first.proposal)).toMatchObject({ state: 'consumed' });

    // The same approval again is answered as ordinary text: the proposal is
    // already consumed, so no second create and no second charge.
    const again = await h.reply(first.proposal, 'Go ahead', first.ids.sessionId);
    h.modelWires.push(textWire('That event is already scheduled.'));
    await h.execute(again);
    const againBudget = await turnBudget(h, again);
    expect(againBudget?.creates).toBe(0);
    expect(againBudget?.logicalTools).toBe(0);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('answers an unrelated message with ordinary text and keeps the proposal pending', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
    const first = await disclose(h, REQUEST, ACTION);
    const unrelated = await h.reply(first.proposal, 'What is the weather like today?', first.ids.sessionId);
    h.modelWires.push(textWire('I cannot check the weather from here.'));
    await h.execute(unrelated);
    const messages = await h.p.messages.list(h.identity.userId, unrelated.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.filter(message => message.role === 'assistant').at(-1)?.content)
      .toBe('I cannot check the weather from here.');
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    const budget = await turnBudget(h, unrelated);
    expect(budget?.creates).toBe(0);
    // The unrelated message never consumed the disclosure.
    expect(await h.proposalAuthority(first.proposal)).toMatchObject({ state: 'pending' });
  } finally { await h.dispose(); }
});
