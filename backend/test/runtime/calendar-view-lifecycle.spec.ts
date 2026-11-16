/**
 * ============================================================================
 * FILE: calendar-view-lifecycle.spec.ts
 * LOCATION: backend/test/runtime/calendar-view-lifecycle.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove that real Calendar loop lifecycle evidence produces bounded views.
 *
 * ROLE IN PROJECT:
 *    Exercises the actual runtime fixture for executing-phase timing, canonical
 *    proposal facts, failure distinction, and durable outcome correlation.
 *
 * KEY COMPONENTS:
 *    - Executing phase: Starts only at validated Calendar work.
 *    - Completion agenda: Read results ride the existing completion frame.
 *    - Terminal notices: Cancel/expiry/unavailable never become success.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { calendarFixture, loadWire, skillWire, createWire, textWire } from './calendar-runtime.fixture.js';
import { event } from './calendar-multi-fixture.js';

it('does not announce executing for schema activation and puts an agenda on completion', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('List my events on 2026-11-03.');
    h.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
      plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
        timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20 } }, 'read-1'),
      textWire('There are no events.'));
    await h.execute(ids);
    expect(h.frames.filter(f => f.event.type === 'calendar-progress' && f.event.phase === 'executing')).toHaveLength(1);
    const completion = h.frames.find(f => f.event.type === 'completed');
    expect(completion?.event).toMatchObject({ type: 'completed', calendarView: {
      kind: 'agenda', entries: [], truncated: false, entriesOmitted: 0 } });
    expect(h.frames.some(f => f.event.type === 'calendar-view')).toBe(false); // text completion, not another drain
    expect(h.modelBodies).toHaveLength(3);
    expect(h.effects.filter(e => e.kind === 'list')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('publishes structured canonical proposal facts and correlates the terminal receipt', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('create the event');
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
    await h.execute(first);
    const proposal = (await h.currentProposal(first.sessionId))!;
    expect(h.frames.find(f => f.event.type === 'calendar-clarification')?.event).toMatchObject({
      type: 'calendar-clarification', view: { kind: 'proposal', proposalId: proposal.proposalId,
        intentId: proposal.intentId, revision: proposal.revision, action: proposal.action,
        target: { calendarId: proposal.target!.calendarId } } });
    const reply = await h.reply(proposal, 'yes', first.sessionId);
    await h.execute(reply);
    const operation = h.frames.find(f => f.turnId === reply.turnId && f.event.type === 'calendar-operation');
    expect(operation?.event).toMatchObject({ type: 'calendar-operation', operation: {
      proposalId: proposal.proposalId, intentId: proposal.intentId, state: 'succeeded', receipt: { durable: true } } });
    expect(h.frames.find(f => f.turnId === reply.turnId && f.event.type === 'completed')?.event)
      .toMatchObject({ calendarView: { kind: 'outcome', proposalId: proposal.proposalId,
        intentId: proposal.intentId, state: 'succeeded' } });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it.each(['cancel', 'expired'] as const)('seals a %s proposal as a notice, not success or an empty agenda', async answer => {
  const h = calendarFixture();
  try {
    const first = await h.submit('create the event');
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
    await h.execute(first);
    const proposal = (await h.currentProposal(first.sessionId))!;
    if (answer === 'expired') h.advance(600001);
    const reply = await h.reply(proposal, answer === 'cancel' ? 'cancel' : 'yes', first.sessionId);
    await h.execute(reply);
    expect(h.frames.find(f => f.turnId === reply.turnId && f.event.type === 'completed')?.event)
      .toMatchObject({ calendarView: { kind: 'notice', state: answer === 'cancel' ? 'cancelled' : 'expired',
        proposalId: proposal.proposalId, intentId: proposal.intentId } });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
  } finally { await h.dispose(); }
});

it('does not turn unavailable calendars into a successful empty lookup', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'), skillWire('call_tool', {
      plugin: 'google-calendar', tool: 'calendar_get_event', arguments: {
        eventId: 'abcde', calendarId: 'missing@example.test' } }, 'read-missing'));
    await h.execute(ids);
    expect(h.frames.find(f => f.event.type === 'completed')?.event)
      .toMatchObject({ calendarView: { kind: 'notice', state: 'clarification', tool: 'calendar_get_event' } });
    expect(h.effects).toHaveLength(0);
  } finally { await h.dispose(); }
});
