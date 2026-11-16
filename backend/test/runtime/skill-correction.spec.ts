/**
 * ============================================================================
 * FILE: skill-correction.spec.ts
 * LOCATION: backend/test/runtime/skill-correction.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify stable call_tool requests are gated on assembled disclosures and
 *    share the existing bounded correction loop before any Calendar action.
 *
 * ROLE IN PROJECT:
 *    Guards P2 execution admission: missing schema, invalid arguments, shared
 *    repair accounting, and sealing after the correction budget is exhausted.
 *
 * KEY COMPONENTS:
 *    - Missing-load and argument correction cycles.
 *    - Repair exhaustion without executing the rejected call.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { CALENDAR_TOOLS } from '../../src/contracts/calendar-tools.js';
import { localSkillResultRecordSchema } from '../../src/contracts/calendar-sources.js';
import type { NativeCalendarModelMessage } from '../../src/contracts/calendar-model.js';
import { calendarFixture, skillWire, textWire } from './calendar-runtime.fixture.js';

it('shares two repairs across missing schema and invalid arguments before one real read', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    const envelope = { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } };
    h.modelWires.push(skillWire('call_tool', envelope, 'missing'),
      skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'load'),
      skillWire('call_tool', { ...envelope, arguments: { eventId: 7 } }, 'bad'),
      skillWire('call_tool', envelope, 'good'), textWire('Found it.'));
    await h.execute(ids);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(5);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 2, logicalTools: 1, creates: 0, modelDispatches: 5 });
    const local = (h.modelBodies.at(-1)!.messages as NativeCalendarModelMessage[])
      .filter(m => m.role === 'tool').map(m => JSON.parse(m.content) as { code?: string });
    expect(local.map(r => r.code).filter(Boolean)).toEqual(['SCHEMA_NOT_LOADED', 'ARGUMENTS_INVALID']);
    for (const body of h.modelBodies) expect(body.user).toBe(h.identity.openRouterUser);
  } finally { await h.dispose(); }
});

it('rejects an unsupported retained revision before action then appends the current disclosure', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('Load the event schema');
    h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'old-load'), textWire('Ready.'));
    await h.execute(first);
    const originalGet = h.p.skillResults.get.bind(h.p.skillResults);
    const spy = vi.spyOn(h.p.skillResults, 'get').mockImplementation(async (...args) => {
      const result = await originalGet(...args);
      if (!result || result.schemaVersion !== 3) return result;
      const value = JSON.parse(result.resultRef.content);
      if (value.kind !== 'skill-disclosure' || value.disclosures.length === 0) return result;
      return localSkillResultRecordSchema.parse({ ...result, resultRef: { ...result.resultRef,
        content: JSON.stringify({ ...value, disclosures: value.disclosures.map((d: Record<string, unknown>) => ({ ...d, revision: 'retired.v0' })) }) } });
    });
    const second = await h.submit('Read event abcde', first.sessionId);
    h.modelWires.push(skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'stale'),
      skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'refresh'),
      skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'fresh'), textWire('Found it.'));
    await h.execute(second);
    spy.mockRestore();
    const messages = h.modelBodies.at(-1)!.messages as NativeCalendarModelMessage[];
    expect(messages.some(m => m.role === 'tool' && m.content.includes('SCHEMA_STALE'))).toBe(true);
    const disclosures = messages.filter(m => m.role === 'tool' && m.name === 'activate_skill').map(m => JSON.parse(m.content));
    expect(disclosures.map(d => d.disclosures[0]?.revision)).toEqual(['retired.v0', CALENDAR_TOOLS[0]!.revision]);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(1);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, second.sessionId, second.turnId)).toMatchObject({ repairs: 1 });
  } finally { vi.restoreAllMocks(); await h.dispose(); }
});

it('seals after two repair cycles and never executes the third rejected request', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    const envelope = { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } };
    h.modelWires.push(...['one', 'two', 'three'].map(id => skillWire('call_tool', envelope, id)));
    await h.execute(ids);
    expect(h.effects).toEqual([]);
    expect(h.modelBodies).toHaveLength(3);
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ repairs: 2, logicalTools: 0, creates: 0 });
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.find(m => m.role === 'assistant')?.content).toContain('correcting');
  } finally { await h.dispose(); }
});
