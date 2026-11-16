import { expect, it } from 'vitest';
import type { NativeCalendarModelMessage } from '../../src/contracts/calendar-model.js';
import { createWire, loadWire, nativeWire, skillWire, textWire } from './calendar-runtime.fixture.js';
import { calendarFixture } from './calendar-runtime.fixture.js';
import { busy, disclose, event } from './calendar-multi-fixture.js';

it('repairs a rejected decision from the last valid boundary and executes the repair once', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'),
      nativeWire('{"eventId":'), nativeWire('{"eventId":"abcde"}'), textWire('Found it.'));
    await h.execute(ids);
    const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(budget).toMatchObject({ modelDispatches: 4, repairs: 1, logicalTools: 1, creates: 0 });
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(1);
    const repaired = h.modelBodies[2].messages as NativeCalendarModelMessage[];
    expect(repaired.filter(m => m.role === 'user' && m.content === 'Read event abcde')).toHaveLength(1);
    // Only the successful disclosure pair is present; the malformed call left no group.
    expect(repaired.filter(m => 'tool_calls' in m).flatMap(m => m.tool_calls)
      .map(call => call.function.name)).toEqual(['activate_skill']);
    expect(repaired.filter(m => m.role === 'tool')).toHaveLength(1);
    expect(repaired.at(-1)?.content).toContain('This rejected decision performed no calendar write.');
  } finally { await h.dispose(); }
});

it('uses the stored event on yes and creates without a second model turn', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
    const first = await disclose(
      h,
      'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
      event(),
    );
    const priorDispatches = h.modelBodies.length;
    const reply = await h.reply(first.proposal, 'Go ahead', first.ids.sessionId);
    await h.execute(reply);
    expect(h.modelBodies).toHaveLength(priorDispatches);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    const messages = await h.p.messages.list(h.identity.userId, reply.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.find(m => m.role === 'assistant' && m.turnId === reply.turnId)?.content)
      .toContain('Created "Planning"');
  } finally { await h.dispose(); }
});

it('seals the clarification from the saved proposal with the target, the event and the coverage', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
    const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'));
    await h.execute(ids);
    // The clarification is persisted before the assistant message is sealed.
    expect(await h.currentProposal(ids.sessionId)).toMatchObject({ purpose: 'conflict' });
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    const assistant = messages.items.filter(message => message.role === 'assistant');
    expect(assistant).toHaveLength(1);
    const text = assistant[0].content;
    // The target, the event, the busy interval and the two accepted answers.
    expect(text).toContain('Personal');
    expect(text).toContain('Planning');
    expect(text).toContain('2026-11-03T10:00:00+00:00');
    expect(text).toContain('2026-11-03T11:00:00+00:00');
    expect(text).toContain('Etc/UTC');
    expect(text).toContain('2026-11-03T10:15:00');
    expect(text).toContain('create the event anyway');
    expect(text).toContain('different time');
    // No operation identity, credential or internal revision leaks out.
    expect(text).not.toMatch(/operationId|revision|credential|https?:/iu);
  } finally { await h.dispose(); }
});

it('adds one matched result group for the model-requested read', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'), nativeWire('{"eventId":"abcde"}'), textWire('Found it.'));
    await h.execute(ids);
    const messages = h.modelBodies.at(-1)!.messages as NativeCalendarModelMessage[];
    // Two complete groups: the original disclosure plus the executed read.
    const pairs = messages.flatMap((message, index) => {
      if (!('tool_calls' in message)) return [];
      const result = messages[index + 1];
      return result?.role === 'tool' ? [{ call: message.tool_calls[0], result }] : [];
    });
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) expect(pair.result.tool_call_id).toBe(pair.call.id);
    expect(pairs.map(pair => pair.result.name)).toEqual(['activate_skill', 'call_tool']);
    expect(JSON.parse(pairs[1]!.result.content)).toMatchObject({ tool: 'calendar_get_event' });
  } finally { await h.dispose(); }
});

it('answers an unknown read target with a bounded clarification instead of a provider error', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'),
      nativeWire('{"eventId":"abcde","calendarId":"missing@example.test"}'));
    await h.execute(ids);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(0);
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    const assistant = messages.items.filter(message => message.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toContain('Which calendar should I use?');
  } finally { await h.dispose(); }
});

it('keeps an unrelated message as ordinary chat and leaves the proposal pending', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
    const first = await disclose(
      h,
      'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
      event(),
    );
    const unrelated = await h.reply(first.proposal, 'the quarterly report is done', first.ids.sessionId);
    h.modelWires.push(textWire('Noted.'));
    await h.execute(unrelated);
    // The message is not an answer: it neither consumes nor tombstones the
    // proposal, and it never becomes authority for an effect.
    expect(await h.proposalAuthority(first.proposal)).toMatchObject({ state: 'pending' });
    expect(await h.operationFor(unrelated)).toBeNull();
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    const answered = await h.p.messages.list(h.identity.userId, unrelated.sessionId, { cursor: null, limit: 50 });
    expect(answered.items.filter(m => m.role === 'assistant').at(-1)?.content).toBe('Noted.');
  } finally { await h.dispose(); }
});

it('asks again for an ambiguous reply and never consumes the proposal', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
    const first = await disclose(
      h,
      'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
      event(),
    );
    const unsure = await h.reply(first.proposal, 'maybe?', first.ids.sessionId);
    await h.execute(unsure);
    expect(await h.proposalAuthority(first.proposal)).toMatchObject({ state: 'pending' });
    expect(await h.operationFor(unsure)).toBeNull();
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    const asked = await h.p.messages.list(h.identity.userId, unsure.sessionId, { cursor: null, limit: 50 });
    expect(asked.items.filter(m => m.role === 'assistant').at(-1)?.content)
      .toContain('Should I create the event anyway');
  } finally { await h.dispose(); }
});

it('answers an inverted list window with a bounded clarification', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('What is on my calendar today?');
    h.modelWires.push(loadWire('calendar_list_events'),
      skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_list_events',
        arguments: { timeMin: '2026-11-03T11:00:00Z', timeMax: '2026-11-03T10:00:00Z', maxResults: 10 } },
      'list-one'),
      skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_list_events',
        arguments: { timeMin: '2026-11-03T10:00:00Z', timeMax: '2026-11-03T11:00:00Z', maxResults: 10 } },
      'list-corrected'), textWire('No events in that time range.'));
    await h.execute(ids);
    expect(h.effects.filter(e => e.kind === 'list')).toHaveLength(0);
    expect(h.modelBodies).toHaveLength(2);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 0, logicalTools: 0 });
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    const assistant = messages.items.filter(message => message.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toContain('unambiguous date');
  } finally { await h.dispose(); }
});

it('answers a date-only create with a bounded clarification instead of interrupting the stream', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Schedule Planning on 2026-11-03.');
    h.modelWires.push(loadWire('calendar_create_event'), createWire({ ...event(), start: '2026-11-03' }));
    await h.execute(ids);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    const assistant = messages.items.filter(message => message.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toMatch(/unambiguous|timed/);
  } finally { await h.dispose(); }
});
