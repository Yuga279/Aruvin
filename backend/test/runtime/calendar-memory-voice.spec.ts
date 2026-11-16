/**
 * ============================================================================
 * FILE: calendar-memory-voice.spec.ts
 * LOCATION: backend/test/runtime/calendar-memory-voice.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove memory-first voice Calendar frames, narration order, and archive.
 *
 * ROLE IN PROJECT:
 *    Exercises the real memory runtime fixture: presentation frames stay out of
 *    the speech path, local narration finishes once, and the saved view matches.
 *
 * KEY COMPONENTS:
 *    - Agenda frame plus archived view: Internal voice identity is preserved.
 *    - Local proposal: Speaks before finish and never waits for visuals.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { calendarLiveFixture } from './calendar-live.fixture.js';
import { loadWire, skillWire, textWire, createWire } from './calendar-runtime.fixture.js';
import { event } from './calendar-multi-fixture.js';

it('memory voice publishes an agenda frame and archives the same view with internal voice identity', async () => {
  const f = await calendarLiveFixture('memory');
  try {
    f.h.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
      plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
        timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20 } }, 'live-read'),
      textWire('No events in that range.'));
    const ids = await f.submit('List my calendar for November 3.');
    await f.execute(ids);
    const frame = f.frames.find(frame => frame.event.type === 'calendar-view');
    expect(frame?.event).toMatchObject({ type: 'calendar-view', view: { kind: 'agenda', entries: [] } });
    const messages = await f.h.p.messages.listForContext(f.h.identity.userId, ids.sessionId, { cursor: null, limit: 20 });
    const assistant = messages.items.find(m => m.role === 'assistant' && m.turnId === ids.turnId);
    expect(assistant).toMatchObject({ visibility: 'internal', mode: 'live', voiceSessionId: 'calendar-voice-unit',
      calendarView: frame?.event.type === 'calendar-view' ? frame.event.view : undefined });
    expect(f.spoken.join('')).toBe('No events in that range.');
    expect(f.finish).toHaveBeenCalledTimes(1);
    expect(f.h.modelBodies).toHaveLength(3);
  } finally { await f.dispose(); }
});

it('memory voice speaks a local proposal before finish and never waits for visual promises', async () => {
  const f = await calendarLiveFixture('memory');
  const order: string[] = [];
  try {
    f.h.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
    f.finish.mockImplementation(async () => { order.push('finish');
      expect(f.spoken.join('')).toContain('Please confirm'); });
    const ids = await f.submit('create the event');
    await f.execute(ids, vi.fn(() => new Promise<void>(() => {})));
    expect(order).toEqual(['finish']);
    expect(f.h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    expect(await f.h.currentProposal(ids.sessionId)).toMatchObject({ state: 'pending' });
  } finally { await f.dispose(); }
}, 1000);
