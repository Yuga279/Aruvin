import { expect, it } from 'vitest';
import type { NativeCalendarModelMessage } from '../../../src/contracts/calendar-model.js';
import { calendarFixture, createWire, loadWire, nativeWire, textWire } from '../../runtime/calendar-runtime.fixture.js';
import { APPROVED_CREATE, VISIT, forbiddenCreateWire, malformedCreateWire, unknownToolWire } from './wires.js';

const REPAIR_SENTENCE = 'Correct the previous invalid tool decision';

type ModelBody = { user?: string; messages: NativeCalendarModelMessage[];
  tools?: Array<{ function: { parameters: { additionalProperties?: boolean } } }> };

function bodies(h: ReturnType<typeof calendarFixture>): ModelBody[] {
  return h.modelBodies as ModelBody[];
}

async function budget(h: ReturnType<typeof calendarFixture>, ids: { sessionId: string; turnId: string }) {
  return h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
}

it('repairs one malformed create and executes the valid call once', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(malformedCreateWire(), loadWire('calendar_create_event'),
      createWire(VISIT, 'create-one'), textWire('Created.'));
    await h.execute(ids);
    const turn = await budget(h, ids);
    expect(turn).toMatchObject({ modelDispatches: 3, repairs: 1, creates: 1 });
    expect(h.effects.filter((effect) => effect.kind === 'create')).toHaveLength(1);
    expect(bodies(h).every((body) => body.user === h.identity.openRouterUser)).toBe(true);
    const repair = bodies(h)[1].messages;
    expect(repair.filter((message) => message.role === 'user' && message.content === APPROVED_CREATE)).toHaveLength(1);
    expect(repair.some((message) => message.role === 'tool' || 'tool_calls' in message)).toBe(false);
    expect(repair.at(-1)?.content).toContain(REPAIR_SENTENCE);
    expect(repair.at(-1)?.content).not.toContain('"inputSchema"');
    expect(repair.at(-1)?.content).not.toContain('{"summary":');
    const nativeTools = bodies(h)[1]!.tools!;
    expect(nativeTools).toHaveLength(2);
    expect(nativeTools.every((tool) => tool.function.parameters.additionalProperties === false)).toBe(true);
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.filter((item) => item.role === 'user')).toHaveLength(1);
  } finally {
    await h.dispose();
  }
});

it('exhausts two structural repairs and executes zero rejected creates', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(malformedCreateWire(), malformedCreateWire(), malformedCreateWire(), createWire(VISIT, 'unused'));
    await h.execute(ids);
    const turn = await budget(h, ids);
    expect(turn).toMatchObject({ repairs: 2, creates: 0 });
    expect(turn?.modelDispatches).toBe(3);
    expect(h.effects).toEqual([]);
    expect(h.modelWires).toHaveLength(1);
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.filter(item => item.role === 'assistant').at(-1)?.content).toContain('my tool calls');
  } finally {
    await h.dispose();
  }
});

it('does not repair an attendees override', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(loadWire('calendar_create_event'), forbiddenCreateWire(), textWire('No.'));
    await h.execute(ids).catch(() => undefined);
    expect(h.effects.filter((effect) => effect.kind === 'create')).toEqual([]);
    const turn = await budget(h, ids);
    expect(turn?.repairs ?? 0).toBe(0);
    expect(turn?.creates ?? 0).toBe(0);
    expect(JSON.stringify(bodies(h))).not.toContain(REPAIR_SENTENCE);
  } finally {
    await h.dispose();
  }
});

it('does not repair an unknown tool into a create', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(unknownToolWire(), textWire('No.'));
    await h.execute(ids).catch(() => undefined);
    expect(h.effects).toEqual([]);
    const turn = await budget(h, ids);
    expect(turn?.repairs ?? 0).toBe(0);
    expect(turn?.creates ?? 0).toBe(0);
    expect(JSON.stringify(bodies(h))).not.toContain(REPAIR_SENTENCE);
  } finally {
    await h.dispose();
  }
});

it('does not create when the accepted input is not a canonical event', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Please add something to my calendar tomorrow');
    h.modelWires.push(loadWire('calendar_create_event'),
      createWire(VISIT, 'not-authorized'), textWire('What date, start, end, and timezone should I use?'));
    await h.execute(ids).catch(() => undefined);
    expect(h.effects.filter((effect) => effect.kind === 'create')).toEqual([]);
    const turn = await budget(h, ids);
    expect(turn?.repairs ?? 0).toBe(0);
    expect(turn?.creates ?? 0).toBe(0);
  } finally {
    await h.dispose();
  }
});

it('cancels during correction and executes the rejected call zero times', async () => {
  const h = calendarFixture();
  const controller = new AbortController();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'), nativeWire('{"eventId":'));
    h.onPhase = (phase) => {
      if (phase === 'repairing') controller.abort();
    };
    await expect(h.execute(ids, controller.signal)).rejects.toBeDefined();
    expect(h.effects).toEqual([]);
    expect(h.modelBodies).toHaveLength(2);
    expect((await budget(h, ids))?.repairs).toBe(0);
  } finally {
    await h.dispose();
  }
});

it('keeps one user input after a read repair and checkpoint restart', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'),
      nativeWire('{"eventId":'), nativeWire('{"eventId":"abcde"}'), textWire('Found it.'));
    await h.execute(ids);
    expect(h.effects.filter((effect) => effect.kind === 'get')).toHaveLength(1);
    await h.restart();
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.filter((item) => item.role === 'user')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(4);
  } finally {
    await h.dispose();
  }
});
