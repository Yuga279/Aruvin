/**
 * ============================================================================
 * FILE: calendar-feedback.spec.ts
 * LOCATION: backend/test/runtime/calendar-feedback.spec.ts
 * PURPOSE: Verify bounded schema feedback corrects Aurvin's own tool mistakes.
 * ROLE IN PROJECT: Exercises model, runtime, real MCP and publication together.
 * KEY COMPONENTS: Rejected cursor repair, duplicate suppression, repair ceiling.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { calendarFixture, createWire, loadWire, nativeWire, processDiagnosticCapture, skillWire, textWire }
  from './calendar-runtime.fixture.js';
import { event } from './calendar-multi-fixture.js';

function listWire(args: string) {
  return skillWire('call_tool',
    `{"plugin":"google-calendar","tool":"calendar_list_calendars","arguments":${args}}`, 'call_1');
}

it('feeds a rejected cursor and native tool definitions to the model so it retrieves calendars', async () => {
  const trace = processDiagnosticCapture();
  const h = calendarFixture(trace.diagnostics);
  try {
    const ids = await h.submit('Aurvin can you tell me what are the calendars that I own');
    h.modelWires.push(loadWire('calendar_list_calendars'),
      listWire('{"pageToken":"first"}'), listWire('{}'), textWire('You own Personal.'));
    await h.execute(ids);
    expect(h.modelBodies).toHaveLength(4);
    const repaired = h.modelBodies[2].messages as { role: string; content: string }[];
    expect(repaired.at(-1)).toMatchObject({ role: 'system' });
    expect(repaired.at(-1)?.content).toContain('pageToken');
    expect(repaired.at(-1)?.content).not.toContain('"inputSchema"');
    expect((h.modelBodies[2].tools as Array<{ function: { parameters: { additionalProperties: boolean } } }>)
      .every(tool => tool.function.parameters.additionalProperties === false)).toBe(true);
    const result = (h.modelBodies[3].messages as { role: string; name?: string; content: string }[])
      .filter(m => m.role === 'tool' && m.name === 'call_tool')
      .map(m => JSON.parse(m.content))
      .find(value => Array.isArray(value.calendars));
    expect(result?.calendars).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Personal', accessRole: 'owner' }),
    ]));
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.filter(m => m.role === 'assistant').at(-1)?.content).toBe('You own Personal.');
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 1, modelDispatches: 4 });
    const attempt = trace.records().filter(record => record.attemptId === trace.hash(ids.attemptId));
    expect(attempt).toContainEqual(expect.objectContaining({ stage: 'correction',
      correctionAttempt: 0, correctionLimit: 2 }));
    expect(attempt).toContainEqual(expect.objectContaining({ stage: 'task-outcome',
      task: 'success', writeCertainty: 'not-applicable' }));
    expect(attempt).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
  } finally { await h.dispose(); }
});

it('blocks a redundant read and resends native tools while preserving its earlier successful result', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'),
      nativeWire('{"eventId":"abcde"}'), nativeWire('{"eventId":"abcde"}'), textWire('Found it.'));
    await h.execute(ids);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(1);
    const repaired = h.modelBodies[3].messages as { role: string; content: string }[];
    expect(repaired.filter(m => m.role === 'tool' && (m as { name?: string }).name === 'call_tool'))
      .toHaveLength(1);
    expect(repaired.at(-1)?.content).toContain('redundant-call');
    expect(repaired.at(-1)?.content).not.toContain('"inputSchema"');
    expect((h.modelBodies[3].tools as Array<{ function: { parameters: { additionalProperties: boolean } } }>)
      .every(tool => tool.function.parameters.additionalProperties === false)).toBe(true);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 1, logicalTools: 1 });
  } finally { await h.dispose(); }
});

it('stops after two corrections without telling the user to fix internal tool arguments', async () => {
  const trace = processDiagnosticCapture();
  const h = calendarFixture(trace.diagnostics);
  try {
    const ids = await h.submit('What calendars do I own?');
    h.modelWires.push(loadWire('calendar_list_calendars'),
      listWire('{"pageToken":"first"}'), listWire('{"pageToken":"first"}'),
      listWire('{"pageToken":"first"}'));
    await h.execute(ids);
    expect(h.modelBodies).toHaveLength(4);
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    const answer = messages.items.filter(m => m.role === 'assistant').at(-1)!.content;
    expect(answer).not.toContain('corrected inputs');
    expect(answer).toContain('my tool calls');
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 2, creates: 0 });
    const attempt = trace.records().filter(record => record.attemptId === trace.hash(ids.attemptId));
    expect(attempt).toContainEqual(expect.objectContaining({ stage: 'correction',
      reason: 'budget-exhausted', correctionAttempt: 2, correctionLimit: 2 }));
    expect(attempt).toContainEqual(expect.objectContaining({ stage: 'task-outcome',
      task: 'fallback', writeCertainty: 'not-applicable' }));
    expect(attempt).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
    expect(attempt.some(record => record.task === 'success')).toBe(false);
  } finally { await h.dispose(); }
});

it('finishes from the confirmed receipt without asking the model for a second create', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    h.modelWires.push(loadWire('calendar_create_event'),
      createWire(event(), 'create-first'), createWire(event(), 'create-again'), textWire('Created once.'));
    await h.execute(ids);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(2);
    expect(h.modelWires).toHaveLength(2);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 0, logicalTools: 1, creates: 1 });
  } finally { await h.dispose(); }
});

it('seals a successful create after an earlier read without a post-create model dispatch', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    h.modelWires.push(loadWire('calendar_get_event'), loadWire('calendar_create_event'),
      nativeWire('{"eventId":"abcde"}'), createWire(event()),
      nativeWire('{"eventId":"abcde"}'), textWire('Created and checked.'));
    await h.execute(ids);
    expect(h.effects.filter(effect => effect.kind === 'get')).toHaveLength(1);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(4);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 0, logicalTools: 2, creates: 1 });
  } finally { await h.dispose(); }
});

it('executes distinct event reads independently', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read two events');
    h.modelWires.push(loadWire('calendar_get_event'), nativeWire('{"eventId":"abcde"}'),
      nativeWire('{"eventId":"fghij"}'), textWire('Read both.'));
    await h.execute(ids);
    expect(h.effects.filter(effect => effect.kind === 'get')).toHaveLength(2);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 0, logicalTools: 2 });
  } finally { await h.dispose(); }
});

it('suppresses the same read when JSON property order differs', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'),
      nativeWire('{"calendarId":"personal@example.test","eventId":"abcde"}'),
      nativeWire('{"eventId":"abcde","calendarId":"personal@example.test"}'), textWire('Found once.'));
    await h.execute(ids);
    expect(h.effects.filter(effect => effect.kind === 'get')).toHaveLength(1);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 1, logicalTools: 1 });
    const repaired = h.modelBodies[3]!.messages as Array<{ role: string; name?: string; content: string }>;
    expect(repaired.filter(message => message.role === 'tool' && message.name === 'call_tool'))
      .toHaveLength(1);
    expect(repaired.at(-1)?.content).toContain('redundant-call');
  } finally { await h.dispose(); }
});

it('seals bounded malformed-argument exhaustion like a cursor failure without blaming user input', async () => {
  const trace = processDiagnosticCapture();
  const h = calendarFixture(trace.diagnostics);
  try {
    const ids = await h.submit('What calendars do I own?');
    h.modelWires.push(loadWire('calendar_list_calendars'),
      listWire('{'), listWire('{'), listWire('{'));
    await h.execute(ids);
    expect(h.modelBodies).toHaveLength(4);
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.filter(message => message.role === 'assistant').at(-1)?.content).toContain('my tool calls');
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 2, creates: 0, logicalTools: 0 });
    expect(trace.records()).toContainEqual(expect.objectContaining({ stage: 'correction',
      reason: 'budget-exhausted', correctionAttempt: 2, correctionLimit: 2 }));
    expect(trace.records()).toContainEqual(expect.objectContaining({ stage: 'task-outcome', task: 'fallback' }));
  } finally { await h.dispose(); }
});
