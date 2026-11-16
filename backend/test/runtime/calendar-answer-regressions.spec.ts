/**
 * ============================================================================
 * FILE: calendar-answer-regressions.spec.ts
 * LOCATION: backend/test/runtime/calendar-answer-regressions.spec.ts
 * PURPOSE: Verify Calendar answers are visible, nonempty and durably truthful.
 * ROLE IN PROJECT: Exercises the real model, tool, graph and publication path.
 * KEY COMPONENTS: Tool-result continuation, fallback delivery, truncation, replay.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { nativeFrame } from '../model/calendar-fixtures.js';
import { calendarFixture, createWire, loadWire, nativeWire, processDiagnosticCapture, skillWire, textWire }
  from './calendar-runtime.fixture.js';
import { busy, event } from './calendar-multi-fixture.js';
import { calendarMultiStreamEnvelopeSchema } from '../../src/contracts/calendar-wire.js';
import { redactCalendarMessage } from '../../src/persistence/calendar-records.js';
import { CALENDAR_TOMBSTONE } from '../../src/contracts/calendar-sources.js';

function visibleText(h: ReturnType<typeof calendarFixture>) {
  return h.frames.reduce((text, frame) => frame.event.type === 'delta'
    ? (frame.event.reset ? '' : text) + frame.event.text : text, '');
}

function toolWire(name: string, args = '{}', content?: string) {
  return skillWire('call_tool', { plugin: 'google-calendar', tool: name, arguments: JSON.parse(args) },
    'call-one', content ?? null);
}

function parallelListEventsWire() {
  const args = { timeMin: '2026-11-02T00:00:00Z', timeMax: '2026-11-09T00:00:00Z', maxResults: 20 };
  const envelope = JSON.stringify({ plugin: 'google-calendar', tool: 'calendar_list_events', arguments: args });
  return nativeFrame({ role: 'assistant', tool_calls: [
    { index: 0, id: 'call_1', type: 'function', function: { name: 'call_tool', arguments: envelope } },
    { index: 1, id: 'call_2', type: 'function', function: { name: 'call_tool', arguments: envelope } },
  ] }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}

it('delivers server-generated calendar failures as visible text before completion', async () => {
  const trace = processDiagnosticCapture();
  const h = calendarFixture(trace.diagnostics);
  try {
    await h.setRole('personal@example.test', 'freeBusyReader');
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'), nativeWire('{"eventId":"abcde"}'));
    await h.execute(ids);
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    const answer = messages.items.find(m => m.role === 'assistant')!;
    expect(answer.content).not.toBe('');
    expect(visibleText(h)).toBe(answer.content);
    expect(h.frames.at(-1)?.event.type).toBe('completed');
    const attempt = trace.records().filter(record => record.attemptId === trace.hash(ids.attemptId));
    expect(attempt).toContainEqual(expect.objectContaining({ stage: 'authority', state: 'rejected',
      reason: 'access-denied' }));
    expect(attempt).toContainEqual(expect.objectContaining({ stage: 'task-outcome', task: 'denied' }));
    expect(attempt).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
  } finally { await h.dispose(); }
});

it.each(['', '   \n'])('does not publish a blank model continuation (%j) as success', async content => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'), nativeWire('{"eventId":"abcde"}'), textWire(content));
    await expect(h.execute(ids)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    const attempt = await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId);
    expect(attempt?.status).not.toBe('completed');
    expect(h.frames.some(f => f.event.type === 'completed')).toBe(false);
    expect(h.modelBodies).toHaveLength(3);
  } finally { await h.dispose(); }
});

it('preserves a length-limited calendar answer in the seal, archive and terminal state', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'), nativeWire('{"eventId":"abcde"}'),
      nativeFrame({ content: 'Found part of the event' }, 'length') + 'data: [DONE]\n\n');
    await h.execute(ids);
    expect(await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))
      .toMatchObject({ status: 'truncated', truncated: true });
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.find(m => m.role === 'assistant'))
      .toMatchObject({ completionStatus: 'truncated', truncated: true });
    expect(h.frames.at(-1)?.event).toMatchObject({ type: 'completed', outcome: 'truncated' });
  } finally { await h.dispose(); }
});

it('returns calendar names and ownership roles to the model as a matched tool result', async () => {
  const trace = processDiagnosticCapture();
  const h = calendarFixture(trace.diagnostics);
  try {
    const ids = await h.submit('What calendars do I own?');
    h.modelWires.push(loadWire('calendar_list_calendars'),
      toolWire('calendar_list_calendars'), textWire('You own Personal. Work is shared.'));
    await h.execute(ids);
    const messages = h.modelBodies[2].messages as { role: string; name?: string; content: string }[];
    const tool = messages.find(m => m.role === 'tool' && m.name === 'call_tool')!;
    expect(tool.name).toBe('call_tool');
    expect(JSON.parse(tool.content).tool).toBe('calendar_list_calendars');
    expect(JSON.parse(tool.content).calendars).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Personal', accessRole: 'owner' }),
      expect.objectContaining({ label: 'Work', accessRole: 'writer' }),
    ]));
    const messagesInStore = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    const listed = messagesInStore.items.find(m => m.role === 'assistant')!;
    const answer = (await h.p.messages.get(h.identity.userId, ids.sessionId, listed.messageId))!;
    expect(answer.sourceProvenance).toHaveLength(1);
    expect(redactCalendarMessage(answer, h.clock() + 86400001).content).toBe(answer.content);
    const accounting = await h.p.calendarAccounting.listAttemptAccounting(
      h.identity.userId, ids.sessionId, ids.turnId, ids.attemptId);
    expect(accounting.aggregate?.dispatchIds).toHaveLength(3);
    expect(accounting.aggregate?.promptTokens).toBeNull(); // These fixtures report no usage.
    expect(trace.records().filter(record => record.attemptId === trace.hash(ids.attemptId)))
      .toContainEqual(expect.objectContaining({ stage: 'task-outcome', task: 'success',
        writeCertainty: 'not-applicable' }));
  } finally { await h.dispose(); }
});

it('keeps a cardinality-exhaustion fallback instead of a calendar tombstone', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('What upcoming events do I have?');
    h.modelWires.push(
      loadWire('calendar_list_calendars'),
      toolWire('calendar_list_calendars'),
      parallelListEventsWire(),
      parallelListEventsWire(),
      parallelListEventsWire(),
    );
    await h.execute(ids);
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    const answer = messages.items.find(m => m.role === 'assistant')!;
    expect(answer.content).toContain('could not complete the calendar request');
    expect(answer.content).not.toBe(CALENDAR_TOMBSTONE);
    expect(answer.sourceProvenance ?? []).toHaveLength(0);
    expect(visibleText(h)).toBe(answer.content);
  } finally { await h.dispose(); }
});

it('replaces tool-call preambles with the exact saved final answer', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('What calendars do I own?');
    h.modelWires.push(loadWire('calendar_list_calendars'),
      toolWire('calendar_list_calendars', '{}', 'Let me check your calendars.'),
      textWire('You own Personal.'));
    await h.execute(ids);
    expect(visibleText(h)).toBe('You own Personal.');
  } finally { await h.dispose(); }
});

it('delivers large model text in bounded protocol-3 frames', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Tell me about my calendars');
    const text = '界'.repeat(6000);
    h.modelWires.push(textWire(text));
    await h.execute(ids);
    expect(visibleText(h)).toBe(text);
    expect(h.frames.every(f => calendarMultiStreamEnvelopeSchema.safeParse(f).success)).toBe(true);
  } finally { await h.dispose(); }
});

it('accepts the primary availability alias through the complete MCP path', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Is my primary calendar free?');
    h.modelWires.push(loadWire('calendar_check_availability'),
      toolWire('calendar_check_availability', JSON.stringify({
        calendarIds: ['primary'], timeMin: '2026-11-03T10:00:00Z',
        timeMax: '2026-11-03T11:00:00Z', timeZone: 'Etc/UTC',
      })), textWire('Your primary calendar is free.'));
    await h.execute(ids);
    expect(h.modelBodies, visibleText(h)).toHaveLength(3);
    expect(visibleText(h)).toBe('Your primary calendar is free.');
  } finally { await h.dispose(); }
});

it('replays the saved answer text when reattaching to a completed calendar turn', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'),
      nativeWire('{"eventId":"abcde"}'), textWire('Found the saved event.'));
    await h.execute(ids);
    let text = '';
    await h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async frame => {
        if (frame.event.type === 'delta') text = (frame.event.reset ? '' : text) + frame.event.text;
      },
    });
    expect(text).toBe('Found the saved event.');
    expect(h.modelBodies).toHaveLength(3);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('shows volatile calendar results live and retains the derived answer', async () => {
  const h = calendarFixture();
  const fetcher = h.fetcher.getMockImplementation()!;
  h.fetcher.mockImplementation(async (url, init) => {
    const response = await fetcher(url, init);
    const address = url instanceof Request ? url.url : url.toString();
    if (address.includes('/calendar/v3/')) response.headers.set('cache-control', 'no-store');
    return response;
  });
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'),
      nativeWire('{"eventId":"abcde"}'), textWire('The private event is Planning.'));
    await h.execute(ids);
    expect(visibleText(h)).toBe('The private event is Planning.');
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.find(m => m.role === 'assistant')?.content).toBe('The private event is Planning.');
    const dispatches = await h.p.calendarAccountingV2.listDispatches(h.identity.userId, ids.turnId);
    const final = dispatches.at(-1)!;
    const decision = await h.p.skillDecisions.get(h.identity.userId, final.decisionId);
    expect(decision?.decision).toBeNull();
  } finally { await h.dispose(); }
});

it('applies source expiry to server-generated conflict disclosures as well as model answers', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
    const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
    await h.execute(ids);
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    const listed = messages.items.find(m => m.role === 'assistant')!;
    const answer = (await h.p.messages.get(h.identity.userId, ids.sessionId, listed.messageId))!;
    expect(answer.content).toContain('Personal');
    expect(answer.sourceProvenance).toHaveLength(1);
    expect(redactCalendarMessage(answer, h.clock() + 86400001).content).toBe(answer.content);
  } finally { await h.dispose(); }
});

it('does not let an expired scheduling proposal swallow an unrelated question', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
    const first = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
    await h.execute(first);
    h.advance(360001);
    const question = await h.submit('What is two plus two?', first.sessionId);
    h.modelWires.push(textWire('Four.'));
    h.frames.length = 0;
    await h.execute(question);
    expect(visibleText(h)).toBe('Four.');
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
  } finally { await h.dispose(); }
});

it.each(['archive-save', 'manifest-save', 'terminal-cas'] as const)
  ('recovers a sealed calendar answer after %s without repeating inference or tools', async point => {
    const trace = processDiagnosticCapture();
    const h = calendarFixture(trace.diagnostics);
    try {
      const ids = await h.submit('Read event abcde');
      h.modelWires.push(loadWire('calendar_get_event'),
      nativeWire('{"eventId":"abcde"}'), textWire('Found the saved event.'));
      if (point === 'terminal-cas') h.onPhase = () => h.failOnce(point);
      else h.failOnce(point);
      await expect(h.execute(ids)).rejects.toBeDefined();
      await h.restart();
      await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
      expect(await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))
        .toMatchObject({ status: 'completed' });
      const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
      expect(messages.items.filter(m => m.role === 'assistant'))
        .toEqual([expect.objectContaining({ content: 'Found the saved event.', completionStatus: 'completed' })]);
      expect(h.modelBodies).toHaveLength(3);
      expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(1);
      const attempt = trace.records().filter(record => record.attemptId === trace.hash(ids.attemptId));
      expect(attempt).toContainEqual(expect.objectContaining({ stage: 'finalization', state: 'ok' }));
      expect(attempt).toContainEqual(expect.objectContaining({ stage: 'task-outcome',
        task: 'unknown', writeCertainty: 'unknown' }));
      expect(attempt).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
    } finally { await h.dispose(); }
  });
