/**
 * ============================================================================
 * FILE: skill-activation.spec.ts
 * LOCATION: backend/test/runtime/skill-activation.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify local skill activation derives loaded revisions only from assembled
 *    original disclosures and never performs plugin side effects.
 *
 * ROLE IN PROJECT:
 *    Guards P2 discovery semantics: batch atomicity, acknowledgement handling,
 *    unknown-tool rejection, and disclosure byte budgets.
 *
 * KEY COMPONENTS:
 *    - loadedSkillRevisions: assembled-history derivation.
 *    - activateLocalSkill / requireLoadedSkill: pure local resolution.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { CALENDAR_TOOLS } from '../../src/contracts/calendar-tools.js';
import { activateLocalSkill, loadedSkillRevisions, requireLoadedSkill }
  from '../../src/chat-runtime/calendar-skills.js';
import type { NativeCalendarModelMessage } from '../../src/contracts/calendar-model.js';
import { calendarFixture, skillWire, textWire } from './calendar-runtime.fixture.js';

it('loads a batch atomically and acknowledges only assembled original disclosures', () => {
  const names = ['calendar_get_event', 'calendar_list_events'];
  const first = activateLocalSkill({ plugin: 'google-calendar', tools: names }, new Map(), 16384);
  expect(first).toMatchObject({ kind: 'skill-disclosure', alreadyLoaded: [] });
  if (first.kind !== 'skill-disclosure') throw new Error('Expected disclosure');
  expect(first.disclosures.map(d => d.tool)).toEqual(names);
  const messages: NativeCalendarModelMessage[] = [
    { role: 'assistant', content: null, tool_calls: [{ id: 'load', type: 'function', function: {
      name: 'activate_skill', arguments: JSON.stringify({ plugin: 'google-calendar', tools: names }) } }] },
    { role: 'tool', name: 'activate_skill', tool_call_id: 'load', content: JSON.stringify(first) },
  ];
  const loaded = loadedSkillRevisions(messages);
  expect(loaded.get('google-calendar:calendar_get_event')).toMatchObject({ disclosureCallId: 'load' });
  const again = activateLocalSkill({ plugin: 'google-calendar', tools: names }, loaded, 16384);
  expect(again).toMatchObject({ disclosures: [], alreadyLoaded: [
    { tool: names[0], disclosureCallId: 'load' }, { tool: names[1], disclosureCallId: 'load' }] });
  expect(JSON.stringify(again)).not.toContain('inputSchema');
  // An acknowledgement is not an original disclosure.
  expect(loadedSkillRevisions([{ role: 'assistant', content: null, tool_calls: [{ id: 'ack', type: 'function',
    function: { name: 'activate_skill', arguments: JSON.stringify({ plugin: 'google-calendar', tools: names }) } }] },
    { role: 'tool', name: 'activate_skill', tool_call_id: 'ack', content: JSON.stringify(again) }]).size).toBe(0);
  expect(activateLocalSkill({ plugin: 'google-calendar', tools: [...names, 'calendar_nope'] }, loaded, 16384))
    .toMatchObject({ code: 'UNKNOWN_TOOL' });
  expect(activateLocalSkill({ plugin: 'google-calendar', tools: 'all' }, new Map(), 100))
    .toMatchObject({ code: 'DISCLOSURE_BUDGET_EXCEEDED' });
  expect(requireLoadedSkill({ plugin: 'google-calendar', tool: names[0]!, arguments: {} }, new Map()))
    .toMatchObject({ code: 'SCHEMA_NOT_LOADED' });
  loaded.set('google-calendar:calendar_get_event', { revision: 'retired.v0', disclosureCallId: 'load' });
  expect(requireLoadedSkill({ plugin: 'google-calendar', tool: names[0]!, arguments: {} }, loaded))
    .toMatchObject({ code: 'SCHEMA_STALE' });
  expect(CALENDAR_TOOLS).toHaveLength(5);
});

it('advertises exactly two tools and preserves ordinary text with zero plugin effects', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('What is a leap year?');
    h.modelWires.push(textWire('A year with an extra day.'));
    await h.execute(ids);
    expect(h.modelBodies).toHaveLength(1);
    expect((h.modelBodies[0]!.tools as { function: { name: string } }[]).map(t => t.function.name))
      .toEqual(['activate_skill', 'call_tool']);
    expect(h.effects).toEqual([]);
    expect(h.requestKinds).toEqual([]);
    expect((await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status).toBe('completed');
  } finally { await h.dispose(); }
});

it.each([{ tools: ['calendar_get_event'] }, { tools: ['calendar_get_event', 'calendar_list_events'] }, { tools: 'all' }])(
  'resolves selection $tools locally in one durable result with no plugin preflight', async ({ tools }) => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Load the Calendar schemas.');
      h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools }, 'load-batch'), textWire('Ready.'));
      await h.execute(ids);
      expect(h.modelBodies).toHaveLength(2);
      expect(h.effects).toEqual([]);
      expect(h.requestKinds).toEqual([]);
      const messages = h.modelBodies[1]!.messages as NativeCalendarModelMessage[];
      const results = messages.filter(m => m.role === 'tool');
      expect(results).toHaveLength(1);
      const result = results[0]!;
      if (result.role !== 'tool') throw new Error('Expected tool result');
      expect(JSON.parse(result.content)).toMatchObject({ kind: 'skill-disclosure' });
      const saved = await h.p.skillResults.get(h.identity.userId, ids.sessionId, result.tool_call_id);
      expect(saved).toMatchObject({ schemaVersion: 3, resultRef: { storage: 'local', content: result.content } });
      expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
        .toMatchObject({ modelDispatches: 2, repairs: 0, logicalTools: 0, creates: 0, calendarRequests: 0, refreshRequests: 0 });
      expect(h.modelBodies[1]!.tools).toEqual(h.modelBodies[0]!.tools);
    } finally { await h.dispose(); }
  });

it('rejects an unknown batch atomically without disclosing its valid subset', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Load a batch');
    h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar',
      tools: ['calendar_get_event', 'calendar_nope'] }, 'bad-batch'));
    await h.execute(ids);
    expect(h.effects).toEqual([]);
    expect(h.requestKinds).toEqual([]);
    expect(h.modelBodies).toHaveLength(1);
    const dispatches = await h.p.calendarAccountingV2.listDispatches(h.identity.userId, ids.turnId);
    const saved = await h.p.skillDecisions.get(h.identity.userId, dispatches[0]!.decisionId);
    if (!saved?.decision || saved.decision.kind !== 'activate_skill') throw new Error('Expected stable decision');
    const record = await h.p.skillResults.get(h.identity.userId, ids.sessionId, saved.decision.nativeCall.id);
    expect(record).toMatchObject({ resultRef: { storage: 'local' } });
    if (!record || record.schemaVersion !== 3) throw new Error('Expected local result');
    expect(JSON.parse(record.resultRef.content)).toMatchObject({ code: 'UNKNOWN_TOOL', retry: 'none' });
    expect(record.resultRef.content).not.toContain('inputSchema');
  } finally { await h.dispose(); }
});

it('adds one cold discovery request then executes once with the original dispatcher identity', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    const raw = '{ "tool":"calendar_get_event", "plugin":"google-calendar", "arguments":{"eventId":"abcde"} }';
    h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'load'),
      skillWire('call_tool', raw, 'dispatch-original', 'I will read it.'), textWire('Found it.'));
    await h.execute(ids);
    expect(h.modelBodies).toHaveLength(3);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(1);
    const messages = h.modelBodies[2]!.messages as NativeCalendarModelMessage[];
    const native = messages.find(m => 'tool_calls' in m && m.tool_calls[0].function.name === 'call_tool');
    expect(native).toMatchObject({ content: 'I will read it.', tool_calls: [{ function: { name: 'call_tool', arguments: raw } }] });
    const result = messages.find(m => m.role === 'tool' && m.name === 'call_tool');
    expect(result).toBeDefined();
    if (!native || !('tool_calls' in native) || !result || result.role !== 'tool') throw new Error('Expected matched pair');
    expect(result.tool_call_id).toBe(native.tool_calls[0].id);
    expect(JSON.parse(result.content)).toMatchObject({ tool: 'calendar_get_event' });
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ logicalTools: 1, creates: 0, repairs: 0 });
  } finally { await h.dispose(); }
});
