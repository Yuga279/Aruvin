/**
 * ============================================================================
 * FILE: skill-history.spec.ts
 * LOCATION: backend/test/assembly/skill-history.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the assembled Calendar history preserves prefix bytes and ordered pairs.
 *
 * ROLE IN PROJECT:
 *    Compares real serialized request prefixes across cold, continuation, warm,
 *    and reopened turns, and proves complete native call/result adjacency without
 *    rewriting earlier messages.
 *
 * KEY COMPONENTS:
 *    - assertPairs: No duplicate or orphan native call/result groups.
 *    - Prefix-byte and disclosure-in-position assertions.
 *    - Clean AppService reconstruction over the same saved stores.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { AppService } from '../../src/app.service.js';
import { skillLocalResultSchema } from '../../src/contracts/calendar-tools.js';
import { skillAssembly, loadWire, callWire, skillWire, textWire, USER,
  type NativeMessage } from './skill-fixture.js';

function assertPairs(messages: NativeMessage[]) {
  const ids: string[] = [];
  for (const [index, message] of messages.entries()) {
    for (const call of message.tool_calls ?? []) {
      expect(ids).not.toContain(call.id);
      ids.push(call.id);
      expect(messages[index + 1]).toMatchObject({ role: 'tool', tool_call_id: call.id });
      expect(messages.filter(m => m.role === 'tool' && m.tool_call_id === call.id)).toHaveLength(1);
    }
    if (message.role === 'tool') expect(messages[index - 1]?.tool_calls?.[0]?.id).toBe(message.tool_call_id);
  }
}

it('appends disclosures in position without rewriting any assembled prefix bytes', async () => {
  let h: Awaited<ReturnType<typeof skillAssembly>> | undefined;
  let date: { mockRestore(): void } | undefined;
  try {
    h = await skillAssembly({ realAssets: true });
    date = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const raw = { plugin: 'google-calendar', tools: ['calendar_list_calendars'] };
    const cold = await h.turn('List my calendars.', [skillWire('activate_skill', raw, 'prefix-load', 'Loading schemas.'),
      callWire('calendar_list_calendars', {}, 'prefix-call'), textWire('Listed.')]);
    expect(cold.status).toBe('completed');
    const [initial, activated, executed] = cold.bodies;
    expect(initial!.tools!.map(t => t.function.name)).toEqual(['activate_skill', 'call_tool']);
    expect(JSON.stringify(activated!.messages.slice(0, initial!.messages.length)))
      .toBe(JSON.stringify(initial!.messages));
    expect(JSON.stringify(executed!.messages.slice(0, activated!.messages.length)))
      .toBe(JSON.stringify(activated!.messages));
    const call = activated!.messages.find(m => m.tool_calls?.[0]?.id === 'prefix-load')!;
    expect(call.content).toBe('Loading schemas.');
    expect(call.tool_calls![0]!.function).toEqual({ name: 'activate_skill', arguments: JSON.stringify(raw) });
    const result = activated!.messages.find(m => m.tool_call_id === 'prefix-load')!;
    expect(skillLocalResultSchema.parse(JSON.parse(result.content!))).toMatchObject({ kind: 'skill-disclosure' });
    const follow = await h.turn('List them again.', [callWire('calendar_list_calendars', {}, 'prefix-warm'),
      textWire('Listed again.')], cold.ids.sessionId);
    expect(follow.status).toBe('completed');
    expect(JSON.stringify(follow.bodies[0]!.messages.slice(0, executed!.messages.length)))
      .toBe(JSON.stringify(executed!.messages));
    expect(follow.bodies[0]!.messages.slice(executed!.messages.length))
      .toEqual([{ role: 'assistant', content: 'Listed.' }, { role: 'user', content: 'List them again.' }]);
    for (const body of [...cold.bodies, ...follow.bodies]) {
      expect(JSON.stringify(body.tools)).toBe(JSON.stringify(initial!.tools));
      assertPairs(body.messages);
    }
    expect(follow.bodies[0]!.messages.filter(m => m.content === 'List my calendars.')).toHaveLength(1);
    const beforeReopen = JSON.stringify(follow.bodies.at(-1)!.messages);
    await expect(h.service.operations.shutdown()).resolves.toEqual({ safe: true });
    const reopened = await AppService.create(h.bootstrap, h.f.ports);
    await reopened.calendarFor(USER).connections.statusV2();
    try {
      h.cal.modelWires.push(callWire('calendar_list_calendars', {}, 'reopened-call'), textWire('Reopened.'));
      const ids = await reopened.operations.runtime.submitTurn({ identity: { userId: USER,
        openRouterUser: USER, source: 'authenticated-session' }, sessionId: cold.ids.sessionId,
        content: 'List after reopening.', idempotencyKey: 'skill-reopen-0001' });
      const offset = h.bodies.length;
      await reopened.operations.runtime.executeTurn({ userId: USER, ...ids,
        signal: new AbortController().signal, emit: async () => {}, emitCalendar: async () => {} });
      const after = h.bodies.slice(offset);
      expect(after).toHaveLength(2);
      expect(JSON.stringify(after[0]!.messages.slice(0, follow.bodies.at(-1)!.messages.length)))
        .toBe(beforeReopen);
      assertPairs(after.at(-1)!.messages);
      expect(await h.cal.p.metadata.getAttempt(USER, ids.sessionId, ids.attemptId))
        .toMatchObject({ status: 'completed' });
    } finally { await reopened.operations.shutdown(); }
  } finally { try { await h?.dispose(); } finally { date?.mockRestore(); } }
});

it('acknowledges a retained disclosure and rejects execution in a fresh chat', async () => {
  const h = await skillAssembly();
  try {
    const a = await h.turn('Load calendar reading.', [loadWire(['calendar_list_calendars'], 'original-disclosure'),
      textWire('Ready.')]);
    const b = await h.turn('Load it again.', [loadWire(['calendar_list_calendars'], 'repeat-disclosure'),
      textWire('Still ready.')], a.ids.sessionId);
    const repeated = b.bodies.at(-1)!.messages.find(m => m.tool_call_id === 'repeat-disclosure')!;
    expect(JSON.parse(repeated.content!)).toMatchObject({ disclosures: [], alreadyLoaded: [
      { tool: 'calendar_list_calendars', disclosureCallId: 'original-disclosure' }] });
    expect(b.bodies.at(-1)!.messages.filter(m => m.tool_call_id === 'original-disclosure')).toHaveLength(1);
    const invokes = h.snapshot().invoke;
    const c = await h.turn('List calendars in a different chat.', [callWire('calendar_list_calendars', {}, 'fresh-rejected'),
      textWire('Schema is not loaded in this chat.')]);
    expect(c.bodies).toHaveLength(2);
    expect(h.snapshot().invoke).toBe(invokes);
    const rejected = c.bodies[1]!.messages.find(m => m.tool_call_id === 'fresh-rejected')!;
    expect(JSON.parse(rejected.content!)).toMatchObject({ code: 'SCHEMA_NOT_LOADED' });
    expect(JSON.stringify(c.bodies)).not.toContain('original-disclosure');
    expect(JSON.stringify(c.bodies)).not.toContain('repeat-disclosure');
    assertPairs(c.bodies[1]!.messages);
  } finally { await h.dispose(); }
});

it('repairs missing schema then executes once without an external discovery call', async () => {
  const h = await skillAssembly();
  try {
    const turn = await h.turn('List calendars.', [callWire('calendar_list_calendars', {}, 'missing-call'),
      loadWire(['calendar_list_calendars'], 'repair-load'),
      callWire('calendar_list_calendars', {}, 'repaired-call'), textWire('Listed.')]);
    expect(turn.status).toBe('completed');
    expect(turn.bodies).toHaveLength(4);
    expect(h.boundaries[1]).toEqual(h.boundaries[0]);
    expect(h.boundaries[2]).toEqual(h.boundaries[1]);
    const missing = turn.bodies[1]!.messages.find(m => m.tool_call_id === 'missing-call')!;
    expect(JSON.parse(missing.content!)).toMatchObject({ kind: 'skill-error',
      code: 'SCHEMA_NOT_LOADED', retry: 'activate-skill' });
    expect(h.spies.invoke.mock.calls.map(([input]) => input.call.name)).toEqual(['calendar_list_calendars']);
    expect(await h.cal.p.calendarAccountingV2.getBudget(USER, turn.ids.sessionId, turn.ids.turnId))
      .toMatchObject({ repairs: 1, modelDispatches: 4, logicalTools: 1, creates: 0 });
    assertPairs(turn.bodies.at(-1)!.messages);
  } finally { await h.dispose(); }
});

it('does not reset the two-repair budget after a successful disclosure', async () => {
  const h = await skillAssembly();
  try {
    const turn = await h.turn('List calendars.', [callWire('calendar_list_calendars', {}, 'budget-missing'),
      loadWire(['calendar_list_calendars'], 'budget-load'),
      callWire('calendar_list_calendars', { pageToken: null }, 'budget-invalid-one'),
      callWire('calendar_list_calendars', { pageToken: null }, 'budget-invalid-two')]);
    // The approved P2 correction loop terminates exhaustion through the existing
    // answerAndSeal narration path. That is a bounded terminal outcome, not a
    // stream error; record the exact integrated behavior rather than assuming one.
    expect(turn.status).toBe('completed');
    expect(turn.bodies).toHaveLength(4);
    expect(h.snapshot().external).toBe(0);
    expect(h.spies.oauth).not.toHaveBeenCalled();
    const budget = await h.cal.p.calendarAccountingV2.getBudget(USER, turn.ids.sessionId, turn.ids.turnId);
    expect(budget).toMatchObject({ repairs: 2, modelDispatches: 4, creates: 0 });
    expect(turn.frames.some(f => f.event.type === 'error')).toBe(false);
    expect(turn.frames.filter(f => f.event.type === 'delta')
      .map(f => (f.event as { text?: string }).text ?? '').join(''))
      .toContain('could not complete');
    expect(turn.frames.some(f => f.event.type === 'completed')).toBe(true);
    const last = turn.bodies.at(-1)!.messages;
    expect(last.some(m => m.role === 'tool' && m.content?.includes('ARGUMENTS_INVALID'))).toBe(true);
    assertPairs(last);
  } finally { await h.dispose(); }
});
