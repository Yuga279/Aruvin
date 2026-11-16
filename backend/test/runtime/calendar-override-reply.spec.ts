/**
 * ============================================================================
 * FILE: calendar-override-reply.spec.ts
 * LOCATION: backend/test/runtime/calendar-override-reply.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prevent explicit "no, just create it" replies from losing proposal authority.
 *
 * ROLE IN PROJECT:
 *    Exercises the shared reply parser and real scheduling runtime using local
 *    Calendar/model fixtures, without authorizing live provider requests.
 *
 * KEY COMPONENTS:
 *    - Screenshot regression: Details confirmation, incomplete coverage, override.
 *    - Consent boundaries: Negation, selection, expiry and fresh-condition checks.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { readCalendarReply } from '../../src/chat-runtime/calendar-intent.js';
import { busy, disclose, event } from './calendar-multi-fixture.js';
import { calendarFixture, createWire, loadWire, textWire } from './calendar-runtime.fixture.js';

const REQUEST = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.';
const INCOMPLETE = { calendarErrors: { 'read@example.test': 'notFound' } };

it.each(['no just create it', 'yes'])('creates after details confirmation despite incomplete coverage for "%s"', async content => {
  const h = calendarFixture();
  try {
    h.setAvailability(INCOMPLETE);
    const action = event({ summary: 'Ball', start: '2026-10-31T16:00:00+05:30',
      end: '2026-10-31T19:00:00+05:30', timeZone: 'Asia/Kolkata' });
    const first = await disclose(h, 'create the event', action);
    expect(first.proposal.purpose).toBe('details');

    const confirm = await h.submit(content, first.ids.sessionId);
    await h.execute(confirm);
    expect(await h.operationFor(confirm)).toMatchObject({ state: 'succeeded', action,
      intentId: first.proposal.intentId,
      authorization: { basis: 'proposal-confirmation', proposalId: first.proposal.proposalId,
        acceptedUserMessageId: confirm.userMessageId } });
    expect(await h.currentProposal(first.ids.sessionId)).toBeNull();
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(2);
    await h.execute(confirm);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('accepts bounded explicit overrides without accepting negations or choosing a calendar', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability(INCOMPLETE);
    const { proposal } = await disclose(h, REQUEST, event());
    for (const purpose of ['details', 'conflict'] as const) {
      for (const content of ['no just create it', 'No, just create it!', 'just create it',
        'Just create the event.', 'no, just create the event anyway']) {
        expect(readCalendarReply(content, { ...proposal, purpose }), content)
          .toEqual({ decision: 'accept', choiceCalendarId: null });
        expect(readCalendarReply(content, { ...proposal, purpose: 'selection' }).decision, content)
          .not.toBe('accept');
      }
    }
    for (const content of ['no', 'cancel', 'stop', "don't create it", 'do not create it']) {
      expect(readCalendarReply(content, proposal), content)
        .toEqual({ decision: 'cancel', choiceCalendarId: null });
    }
    for (const content of ["no just don't create it", 'no, do not create it',
      'just create it?', 'no just create it?', 'no just create it if free',
      'no just create it, actually cancel', 'He said "no just create it"',
      'no just create it at 12 instead']) {
      expect(readCalendarReply(content, proposal).decision, content).not.toBe('accept');
    }
  } finally { await h.dispose(); }
});

it('asks the model when a confirmed slot becomes busy instead of a second confirmation card', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability(INCOMPLETE);
    const { ids, proposal } = await disclose(h, REQUEST, event());
    h.setAvailability({ ...INCOMPLETE,
      busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
    h.modelWires.push(textWire('That time is busy. Would you like a different time?'));
    const reply = await h.submit('no just create it', ids.sessionId);
    await h.execute(reply);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
    expect(await h.currentProposal(ids.sessionId)).toBeNull();
    expect(proposal.purpose).toBe('conflict');
    const history = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(history.items.filter(message => message.role === 'assistant').at(-1)?.content)
      .toContain('different time');
    expect(history.items.filter(message => message.role === 'assistant').at(-1)?.content)
      .not.toContain('create the event anyway');
    expect(h.modelBodies.length).toBeGreaterThan(1);
  } finally { await h.dispose(); }
});

it('does not revive an expired proposal with an explicit override', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability(INCOMPLETE);
    const { ids, proposal } = await disclose(h, REQUEST, event());
    h.advance(600001);
    const reply = await h.submit('no just create it', ids.sessionId);
    await h.execute(reply);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
    expect(await h.proposalAuthority(proposal)).toMatchObject({ state: 'tombstone' });
    const history = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(history.items.filter(message => message.role === 'assistant').at(-1)?.content).toContain('expired');
    expect(h.modelBodies).toHaveLength(2);
  } finally { await h.dispose(); }
});

it('does not infer an event or consent from an override without a pending proposal', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('no just create it');
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
    await h.execute(ids);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
    expect(await h.operationFor(ids)).toBeNull();
    expect(await h.currentProposal(ids.sessionId)).toBeNull();
  } finally { await h.dispose(); }
});
