/**
 * ============================================================================
 * FILE: calendar-durable-voice.spec.ts
 * LOCATION: backend/test/runtime/calendar-durable-voice.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove durable live turns execute Calendar work with complete narration.
 *
 * ROLE IN PROJECT:
 *    Exercises the real durable fallback voice admission: response selector,
 *    single narration/finish, public stream isolation, and visual independence.
 *
 * KEY COMPONENTS:
 *    - Lookup voice: One tool call, one spoken answer, no public stream.
 *    - Throwing/unsettled sink: Confirmation and speech stay independent.
 *    - Post-write failure: The authoritative outcome snapshot survives.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { calendarLiveFixture } from './calendar-live.fixture.js';
import { loadWire, skillWire, createWire, textWire } from './calendar-runtime.fixture.js';
import { event } from './calendar-multi-fixture.js';

it('durable voice executes a calendar lookup, speaks once, and stays inaccessible to public text streams', async () => {
  const f = await calendarLiveFixture('durable');
  try {
    f.h.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
      plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
        timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20 } }, 'durable-read'),
      textWire('No events in that range.'));
    const ids = await f.submit('List my calendar for November 3.');
    await f.execute(ids);
    expect(f.h.effects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(f.frames.some(frame => frame.event.type === 'calendar-view')).toBe(true);
    expect(f.spoken.join('')).toBe('No events in that range.'); // publisher reset must not repeat it
    expect(f.finish).toHaveBeenCalledTimes(1);
    for (const body of f.h.modelBodies) {
      expect(body.user).toBe(f.h.identity.userId);
      expect((body.messages as { content: string }[]).some(m => m.content === 'Response mode: voice.')).toBe(true);
    }
    await expect(f.h.runtime.getTurnStatus(f.h.identity.userId, ids.sessionId, ids.turnId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.h.runtime.getStreamAttempt(f.h.identity.userId, ids.sessionId, ids.turnId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const messages = await f.h.p.messages.listForContext(f.h.identity.userId, ids.sessionId, { cursor: null, limit: 20 });
    expect(messages.items.find(m => m.role === 'assistant')).toMatchObject({ mode: 'live',
      visibility: 'internal', voiceSessionId: 'calendar-voice-unit', calendarView: { kind: 'agenda' } });
  } finally { await f.dispose(); }
});

it.each(['throws', 'never-settles'] as const)('durable voice does not let a visual sink that %s gate confirmation or speech', async behavior => {
  const f = await calendarLiveFixture('durable');
  try {
    const visual = () => {
      if (behavior === 'throws') throw new Error('display failed');
      return new Promise<void>(() => {});
    };
    f.h.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
    const first = await f.submit('create the event');
    await f.execute(first, visual);
    const proposal = (await f.h.currentProposal(first.sessionId))!;
    expect(f.spoken.join('')).toContain('Please confirm');
    const before = f.spoken.length;
    const reply = await f.submit('yes', { proposalId: proposal.proposalId, revision: proposal.revision });
    await f.execute(reply, visual);
    expect(f.spoken.slice(before).join('')).toContain('Created "Planning"');
    expect(f.finish).toHaveBeenCalledTimes(2);
    expect(await f.h.operationFor(reply)).toMatchObject({ state: 'succeeded' });
    expect(f.h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    expect(f.h.modelBodies).toHaveLength(2); // no display/narration model calls
  } finally { await f.dispose(); }
}, 1000);

it('retains the authoritative action snapshot when post-write result bookkeeping fails', async () => {
  const f = await calendarLiveFixture('durable');
  try {
    f.h.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
    f.h.failOnce('result-save-v2');
    const ids = await f.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    await expect(f.execute(ids)).rejects.toBeDefined();
    expect(await f.h.operationFor(ids)).toMatchObject({ state: 'succeeded' });
    const records = await f.h.p.messages.listForContext(f.h.identity.userId, ids.sessionId, { cursor: null, limit: 20 });
    expect(records.items.find(m => m.role === 'assistant')).toMatchObject({ mode: 'live', visibility: 'internal',
      calendarView: { kind: 'outcome', state: 'succeeded', receipt: { durable: true } } });
    expect(f.h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await f.dispose(); }
});
