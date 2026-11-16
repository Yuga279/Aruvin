import { it, expect } from 'vitest';
import { textConfigFixture } from './text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { sessionIdFor } from '../../src/chat-runtime/identity.js';
import { calendarFixture, loadWire, nativeWire } from './calendar-runtime.fixture.js';

it('keeps ordinary text working when Calendar dependencies are absent', async () => {
  const h = textConfigFixture(textSnapshot(1), dependencies => dependencies);
  try {
    const ids = await h.submit('Hello');
    await h.execute(ids);
    expect((await h.runtime.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status)
      .toBe('completed');
    expect(await h.runtime.getCalendarTurnState(h.identity.userId, ids.sessionId, ids.turnId))
      .toBeNull();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  } finally { await h.dispose(); }
});

it('cancels during correction without executing the rejected call', async () => {
  const h = calendarFixture();
  const controller = new AbortController();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'), nativeWire('{"eventId":'));
    h.onPhase = phase => { if (phase === 'repairing') controller.abort(); };
    await expect(h.execute(ids, controller.signal)).rejects.toBeDefined();
    expect(h.effects).toHaveLength(0);
    expect(h.modelBodies).toHaveLength(2);
    expect((await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId))?.repairs)
      .toBe(0);
  } finally { await h.dispose(); }
});

it('does not capture a Calendar budget for live-voice acceptance', async () => {
  const h = calendarFixture();
  try {
    const snapshot = h.currentConfig.current();
    if (!snapshot) throw new Error('expected snapshot');
    const held = await h.runtime.reservations.acquire({ identity: h.identity,
      conversationId: null, owner: { kind: 'live', voiceSessionId: 'calendar-live' } });
    const sessionId = sessionIdFor(h.identity.userId, null, 'live-cal-key');
    const reservation = await h.runtime.reservations.bindConversation({ identity: h.identity,
      reservationId: held.reservationId, conversationId: sessionId });
    const ids = await h.runtime.submitLiveTurn({ identity: h.identity, sessionId, content: 'Read event abcde',
      idempotencyKey: 'live-cal-key', reservation, configSnapshot: snapshot });
    expect(await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId)).toBeNull();
    expect(h.runtime.d.calendar).toBeDefined();
  } finally { await h.dispose(); }
});
