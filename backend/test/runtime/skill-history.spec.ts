/**
 * ============================================================================
 * FILE: skill-history.spec.ts
 * LOCATION: backend/test/runtime/skill-history.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify raw native group construction and durable Calendar history joins
 *    preserve exact dispatcher identity and complete ordered groups.
 *
 * ROLE IN PROJECT:
 *    Guards P2 history reconstruction: original native call IDs, raw arguments,
 *    assistant content, stored local bytes, and scoped metadata ownership.
 *
 * KEY COMPONENTS:
 *    - skillGroup: exact raw native pair construction.
 *    - calendarHistory: dispatch/decision/result join and rejection cases.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { resumableSkillDecisionSchema, skillDecisionSchema,
  type NativeCalendarModelMessage } from '../../src/contracts/calendar-model.js';
import { skillError } from '../../src/contracts/calendar-tools.js';
import { localSkillResultRecordSchema } from '../../src/contracts/calendar-sources.js';
import { skillGroup } from '../../src/chat-runtime/calendar-skills.js';
import { calendarHistory } from '../../src/chat-runtime/calendar-history.js';
import { calendarBinding } from '../model/calendar-fixtures.js';
import { accepted } from './calendar-multi-fixture.js';
import { calendarFixture, skillWire, textWire } from './calendar-runtime.fixture.js';
import type { PersistenceBundle } from '../../src/persistence/persistence.js';

it('preserves raw arguments, native call ID, assistant content, and stored local bytes', () => {
  const raw = '{ "plugin":"google-calendar", "tool":"calendar_get_event", "arguments":{"eventId":7} }';
  const decision = skillDecisionSchema.parse({ kind: 'call_tool', decisionId: 'd', assistantContent: 'Checking.',
    nativeCall: { id: 'native-original', type: 'function', function: { name: 'call_tool', arguments: raw } },
    envelope: JSON.parse(raw), terminal: 'tool_calls' });
  if (decision.kind === 'text') throw new Error('Expected native decision');
  const content = JSON.stringify(skillError('SCHEMA_NOT_LOADED', 'google-calendar', 'calendar_get_event'), null, 1);
  const group = skillGroup(decision, content);
  expect(group.assistant.tool_calls[0].function.arguments).toBe(raw);
  expect(group.assistant.content).toBe('Checking.');
  expect(group.result).toEqual({ role: 'tool', name: 'call_tool', tool_call_id: 'native-original', content });
  expect(group.sources).toEqual([]);
});

it('joins complete evidence by scoped identities and rejects mismatched result ownership', async () => {
  const dispatch = calendarBinding().dispatch;
  const raw = JSON.stringify({ plugin: 'google-calendar', tools: ['calendar_get_event'] });
  const saved = resumableSkillDecisionSchema.parse({ schemaVersion: 3,
    protocolVersion: 'plugin-skills.v1', kind: 'calendar-model-decision',
    userId: dispatch.userId, sessionId: dispatch.sessionId, turnId: dispatch.turnId,
    attemptId: dispatch.attemptId, dispatchId: dispatch.dispatchId, decisionId: dispatch.decisionId,
    configRevision: 1, connectionId: dispatch.connectionId, connectionRevision: 1,
    schemaRevision: 'google-calendar.v2', rejectedDecisionId: null, sources: [],
    operationId: null, intentId: null, proposalId: null, createdAt: dispatch.startedAt,
    decision: { kind: 'activate_skill', decisionId: dispatch.decisionId, assistantContent: null,
      nativeCall: { id: 'load', type: 'function', function: { name: 'activate_skill', arguments: raw } },
      envelope: JSON.parse(raw), terminal: 'tool_calls' } });
  const result = localSkillResultRecordSchema.parse({ schemaVersion: 3,
    protocolVersion: 'plugin-skills.v1', kind: 'calendar-tool-result',
    userId: dispatch.userId, sessionId: dispatch.sessionId, turnId: dispatch.turnId,
    attemptId: dispatch.attemptId, decisionId: dispatch.decisionId, eventId: 'e', sequence: 0,
    toolCallId: 'load', createdAt: dispatch.startedAt, resultRef: { storage: 'local', toolCallId: 'load',
      content: JSON.stringify(skillError('UNKNOWN_TOOL', 'google-calendar', null)) } });
  const get = vi.fn().mockResolvedValue(result);
  const p = { calendarAccountingV2: { listDispatches: vi.fn().mockResolvedValue([dispatch]) },
    skillDecisions: { get: vi.fn().mockResolvedValue(saved) }, skillResults: { get } } as unknown as PersistenceBundle;
  const records = [accepted('Load', { userId: dispatch.userId, sessionId: dispatch.sessionId,
    turnId: dispatch.turnId }).message];
  const groups = await calendarHistory(p, dispatch.userId, dispatch.sessionId, records);
  expect(groups.get(dispatch.turnId)?.map(g => g.result.tool_call_id)).toEqual(['load']);
  get.mockResolvedValueOnce({ ...result, turnId: 'other-turn' });
  await expect(calendarHistory(p, dispatch.userId, dispatch.sessionId, records)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  get.mockResolvedValueOnce(null);
  expect((await calendarHistory(p, dispatch.userId, dispatch.sessionId, records)).get(dispatch.turnId)).toEqual([]);
});

it.each([false, true])('restores disclosures in the original turn with restart=%s and zero warm discovery', async restart => {
  const h = calendarFixture();
  try {
    const first = await h.submit('Read event abcde');
    h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'load'),
      skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'get-first'),
      textWire('First answer.'));
    await h.execute(first);
    if (restart) await h.restart();
    const second = await h.submit('Read event abcde', first.sessionId);
    const before = h.modelBodies.length;
    h.modelWires.push(skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'get-second'),
      textWire('Second answer.'));
    await h.execute(second);
    expect(h.modelBodies.length - before).toBe(2);
    const messages = h.modelBodies[before]!.messages as NativeCalendarModelMessage[];
    const firstUser = messages.findIndex(m => m.role === 'user' && m.content === 'Read event abcde');
    const load = messages.findIndex(m => 'tool_calls' in m && m.tool_calls[0].function.name === 'activate_skill');
    const firstAnswer = messages.findIndex(m => m.role === 'assistant' && m.content === 'First answer.');
    const nextUser = messages.findLastIndex(m => m.role === 'user' && m.content === 'Read event abcde');
    expect(firstUser).toBeLessThan(load);
    expect(load).toBeLessThan(firstAnswer);
    expect(firstAnswer).toBeLessThan(nextUser);
    expect(messages.filter(m => m.role === 'tool' && m.name === 'activate_skill')).toHaveLength(1);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(2);
    const other = await h.submit('Read event abcde');
    h.modelWires.push(skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'unloaded'),
      textWire('Load it first.'));
    const otherBefore = h.modelBodies.length;
    await h.execute(other);
    const correction = h.modelBodies[otherBefore + 1]!.messages as NativeCalendarModelMessage[];
    expect(correction.some(m => m.role === 'tool' && m.content.includes('SCHEMA_NOT_LOADED'))).toBe(true);
    expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(2);
  } finally { await h.dispose(); }
});

it('does not execute or infer loaded knowledge after an unconfirmed local result save', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.failOnce('result-save');
    h.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'load'),
      skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } }, 'never'));
    await expect(h.execute(ids)).rejects.toBeDefined();
    expect(h.modelBodies).toHaveLength(1);
    expect(h.effects).toEqual([]);
    expect((await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status).not.toBe('completed');
    const graph = await h.calendarGraphState(ids.sessionId);
    expect(JSON.stringify(graph.values)).not.toContain('inputSchema');
  } finally { await h.dispose(); }
});

it('saves local terminal narration before the seal so publication never needs inference', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Load an unknown plugin');
    h.modelWires.push(skillWire('activate_skill', { plugin: 'not-enabled', tools: 'all' }, 'unknown'));
    await h.execute(ids);
    const snapshot = await h.calendarGraphState(ids.sessionId);
    const seal = snapshot.values.calendarSeal;
    expect(seal.narrationRef.kind).toBe('text-decision');
    const record = await h.p.skillDecisions.get(h.identity.userId, seal.narrationRef.decisionId);
    expect(record?.decision).toMatchObject({ kind: 'text', truncated: false });
    if (record?.decision?.kind !== 'text') throw new Error('Expected saved local narration');
    const archived = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(record.decision.content).toBe(archived.items.find(m => m.role === 'assistant')?.content);
    const before = h.modelBodies.length;
    await h.restart();
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    expect(h.modelBodies).toHaveLength(before);
    expect(h.effects).toEqual([]);
  } finally { await h.dispose(); }
});

it('acknowledges a retained original disclosure without copying its schema on follow-up', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('Load one schema');
    const load = { plugin: 'google-calendar', tools: ['calendar_get_event'] };
    h.modelWires.push(skillWire('activate_skill', load, 'original'), textWire('Ready.'));
    await h.execute(first);
    const second = await h.submit('Load that schema again', first.sessionId);
    h.modelWires.push(skillWire('activate_skill', load, 'repeat'), textWire('Still ready.'));
    await h.execute(second);
    const results = (h.modelBodies.at(-1)!.messages as NativeCalendarModelMessage[])
      .filter(m => m.role === 'tool' && m.name === 'activate_skill');
    expect(results).toHaveLength(2);
    expect(results[0]!.content).toContain('inputSchema');
    expect(results[1]!.content).not.toContain('inputSchema');
    expect(JSON.parse(results[1]!.content)).toMatchObject({ disclosures: [],
      alreadyLoaded: [{ tool: 'calendar_get_event', disclosureCallId: results[0]!.tool_call_id }] });
  } finally { await h.dispose(); }
});
