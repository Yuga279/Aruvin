/**
 * ============================================================================
 * FILE: skill-workflow.spec.ts
 * LOCATION: backend/test/assembly/skill-workflow.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify assembled Calendar skill workflows over the real runtime and executor.
 *
 * ROLE IN PROJECT:
 *    Exercises ordinary chat, cold discovery, batch disclosure, warm follow-ups,
 *    and newly needed later tools through AppService with deterministic provider
 *    responses, asserting request counts and zero external discovery work.
 *
 * KEY COMPONENTS:
 *    - Ordinary eligible question with exactly two native tools.
 *    - Cold batch, warm, and later-tool model-request accounting.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { CALENDAR_TOOLS, compactSkillCatalog } from '../../src/contracts/calendar-tools.js';
import { skillAssembly, textWire, callWire, loadWire, USER } from './skill-fixture.js';
import { taskEvidence } from './skill-evidence.js';

it('runs an eligible ordinary question with two tools and no plugin work', async () => {
  const h = await skillAssembly();
  try {
    const beforeTask = h.snapshot();
    const turn = await h.turn('What is 2 + 2?', [textWire('4.')]);
    const afterTask = h.snapshot();
    const calls = Object.fromEntries(Object.keys(beforeTask).map(key => {
      const k = key as keyof typeof beforeTask;
      return [k, afterTask[k] - beforeTask[k]];
    }));
    expect(turn.status).toBe('completed');
    expect(turn.bodies).toHaveLength(1);
    expect(turn.bodies[0]!.tools?.map(t => t.function.name))
      .toEqual(['activate_skill', 'call_tool']);
    const initial = turn.bodies[0]!.messages;
    const prefix = initial.slice(0, initial.findIndex(m => m.role === 'user'))
      .map(m => m.content ?? '').join('\n');
    const catalog = compactSkillCatalog();
    expect(prefix).toContain(catalog.plugin);
    for (const tool of catalog.tools) {
      expect(prefix).toContain(tool.name);
      expect(prefix).toContain(tool.description);
    }
    expect(prefix).not.toContain('"inputSchema"');
    for (const tool of CALENDAR_TOOLS) expect(prefix).not.toContain(JSON.stringify(tool.inputSchema));
    expect(h.snapshot()).toEqual(h.boundaries[0]);
    expect(h.snapshot().external).toBe(0);
    console.log('SKILL_TASK', JSON.stringify({ ...taskEvidence('ordinary', turn.bodies, turn.fixtureTaskMs),
      calls, success: turn.status === 'completed',
      boundaryBeforeDiscovery: h.boundaries[0], boundaryAfterDiscovery: h.boundaries[1],
      finalBoundary: h.snapshot() }));
  } finally { await h.dispose(); }
});

it.each([
  { name: 'one operation', tools: ['calendar_list_calendars'], mode: 'one', requests: 3 },
  { name: 'multiple tools in one batch', tools: ['calendar_list_calendars', 'calendar_get_event'], mode: 'batch', requests: 4 },
  { name: 'all tools in one disclosure', tools: 'all', mode: 'all', requests: 3 },
] as const)('completes $name without discovery preflights', async row => {
  const h = await skillAssembly();
  try {
    const selection = row.tools === 'all' ? 'all' : [...row.tools];
    const wires = [loadWire(selection, 'cold-load'), callWire('calendar_list_calendars', {}, 'cold-list')];
    if (row.mode === 'batch') wires.push(callWire('calendar_get_event',
      { calendarId: 'owned', eventId: 'abcde' }, 'cold-get'));
    wires.push(textWire('Done.'));
    const beforeTask = h.snapshot();
    const turn = await h.turn(row.mode === 'batch'
      ? 'List my calendars and read event abcde on my primary calendar.' : 'List my calendars.', wires);
    const afterTask = h.snapshot();
    const calls = Object.fromEntries(Object.keys(beforeTask).map(key => {
      const k = key as keyof typeof beforeTask;
      return [k, afterTask[k] - beforeTask[k]];
    }));
    expect(turn.status).toBe('completed');
    expect(turn.bodies).toHaveLength(row.requests);
    expect(h.boundaries[1]).toEqual(h.boundaries[0]);
    const message = turn.bodies[1]!.messages.find(m => m.tool_call_id === 'cold-load');
    expect(message).toBeDefined();
    const disclosed = JSON.parse(message!.content!);
    const expectedNames = selection === 'all' ? CALENDAR_TOOLS.map(t => t.name) : selection;
    expect(disclosed.disclosures.map((t: { tool: string }) => t.tool).sort())
      .toEqual([...expectedNames].sort());
    expect(disclosed.alreadyLoaded).toEqual([]);
    expect(h.spies.invoke.mock.calls.map(([input]) => input.call.name)).toEqual(
      row.mode === 'batch' ? ['calendar_list_calendars', 'calendar_get_event'] : ['calendar_list_calendars']);
    expect(h.spies.oauth).not.toHaveBeenCalled();
    const budget = await h.cal.p.calendarAccountingV2.getBudget(USER, turn.ids.sessionId, turn.ids.turnId);
    expect(budget).toMatchObject({ modelDispatches: row.requests, repairs: 0,
      logicalTools: row.mode === 'batch' ? 2 : 1, creates: 0 });
    for (const body of turn.bodies) {
      expect(body.user).toBe(USER);
      expect(JSON.stringify(body.tools)).toBe(JSON.stringify(turn.bodies[0]!.tools));
    }
    console.log('SKILL_TASK', JSON.stringify({ ...taskEvidence(row.name, turn.bodies, turn.fixtureTaskMs), calls,
      success: turn.status === 'completed', repairs: budget?.repairs,
      boundaryBeforeDiscovery: h.boundaries[0], boundaryAfterDiscovery: h.boundaries[1],
      finalBoundary: h.snapshot() }));
  } finally { await h.dispose(); }
});

it('reuses schemas for two follow-ups and loads only a newly needed later tool', async () => {
  const h = await skillAssembly();
  try {
    const first = await h.turn('List my calendars.', [loadWire(['calendar_list_calendars'], 'first-load'),
      callWire('calendar_list_calendars', {}, 'first-list'), textWire('Listed.')]);
    for (const [index, prompt] of ['List them again.', 'Repeat that list.'].entries()) {
      const start = h.boundaries.length;
      const beforeTask = h.snapshot();
      const warm = await h.turn(prompt, [callWire('calendar_list_calendars', {}, `warm-list-${index}`),
        textWire('Listed again.')], first.ids.sessionId);
      const afterTask = h.snapshot();
      const calls = Object.fromEntries(Object.keys(beforeTask).map(key => {
        const k = key as keyof typeof beforeTask;
        return [k, afterTask[k] - beforeTask[k]];
      }));
      expect(warm.status).toBe('completed');
      expect(warm.bodies).toHaveLength(2);
      const budget = await h.cal.p.calendarAccountingV2.getBudget(USER, warm.ids.sessionId, warm.ids.turnId);
      expect(budget).toMatchObject({ repairs: 0, modelDispatches: 2, logicalTools: 1 });
      expect(h.boundaries[start + 1]!.invoke - h.boundaries[start]!.invoke).toBe(1);
      console.log('SKILL_TASK', JSON.stringify({
        ...taskEvidence('warm-follow-up', warm.bodies, warm.fixtureTaskMs), calls,
        success: warm.status === 'completed', repairs: budget?.repairs,
        boundaryBeforeDiscovery: h.boundaries[start], boundaryAfterDiscovery: h.boundaries[start + 1],
        finalBoundary: afterTask }));
    }
    const start = h.boundaries.length;
    const beforeTask = h.snapshot();
    const later = await h.turn('Now read event abcde on my primary calendar.', [
      loadWire(['calendar_get_event'], 'later-load'),
      callWire('calendar_get_event', { calendarId: 'owned', eventId: 'abcde' }, 'later-get'),
      textWire('Read.')], first.ids.sessionId);
    const afterTask = h.snapshot();
    const calls = Object.fromEntries(Object.keys(beforeTask).map(key => {
      const k = key as keyof typeof beforeTask;
      return [k, afterTask[k] - beforeTask[k]];
    }));
    expect(later.status).toBe('completed');
    expect(later.bodies).toHaveLength(3);
    expect(h.boundaries[start + 1]).toEqual(h.boundaries[start]);
    const last = later.bodies.at(-1)!;
    const loads = last.messages.filter(m => m.role === 'assistant'
      && m.tool_calls?.[0]?.function.name === 'activate_skill');
    expect(loads.map(m => m.tool_calls![0]!.id)).toEqual(['first-load', 'later-load']);
    expect(h.spies.invoke.mock.calls.map(([input]) => input.call.name)).toEqual([
      'calendar_list_calendars', 'calendar_list_calendars', 'calendar_list_calendars', 'calendar_get_event']);
    console.log('SKILL_TASK', JSON.stringify({
      ...taskEvidence('later-new-tool', later.bodies, later.fixtureTaskMs), calls,
      success: later.status === 'completed',
      boundaryBeforeDiscovery: h.boundaries[start], boundaryAfterDiscovery: h.boundaries[start + 1],
      finalBoundary: afterTask }));
  } finally { await h.dispose(); }
});
