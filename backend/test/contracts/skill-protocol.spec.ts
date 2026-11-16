/**
 * ============================================================================
 * FILE: skill-protocol.spec.ts
 * LOCATION: backend/test/contracts/skill-protocol.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the compact skill catalog, stable native tool definitions, and their contracts.
 *
 * ROLE IN PROJECT:
 *    Contract coverage for progressive plugin discovery: catalog projection, frozen
 *    native definitions, bounded envelopes, local results, and durable history records.
 *
 * KEY COMPONENTS:
 *    - compactSkillCatalog / SKILL_NATIVE_TOOLS: catalog and stable definitions.
 *    - activateSkillEnvelopeSchema / callToolEnvelopeSchema: bounded wrappers.
 *    - skillLocalResultSchema / skillError: local disclosure and error results.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import {
  CALENDAR_TOOLS, SKILL_NATIVE_TOOLS, compactSkillCatalog,
} from '../../src/contracts/calendar-tools.js';
import { activateSkillEnvelopeSchema, callToolEnvelopeSchema, selectSkillTools,
  skillLocalResultSchema, serializeSkillLocalResult, skillError }
  from '../../src/contracts/calendar-tools.js';
import { skillDecisionSchema, resumableSkillDecisionSchema, completeToolGroupV2Schema }
  from '../../src/contracts/calendar-model.js';
import { localSkillResultRecordSchema } from '../../src/contracts/calendar-sources.js';
import { compatibleSkillDecisionRecordSchema, compatibleSkillResultRecordSchema,
  skillCheckpointRefsSchema } from '../../src/contracts/calendar-compatibility.js';

describe('compact skill catalog and stable native definitions', () => {
  it('projects deterministic canonical metadata without parameter schemas', () => {
    const catalog = compactSkillCatalog();
    expect(catalog).toMatchObject({ plugin: 'google-calendar', label: 'Calendar',
      description: 'Scheduling and availability' });
    expect(catalog.tools.map(t => t.name)).toEqual(CALENDAR_TOOLS.map(t => t.name).sort());
    expect(catalog.tools.every(t => Object.keys(t).sort().join(',') === 'description,name')).toBe(true);
    expect(JSON.stringify(catalog)).not.toMatch(/inputSchema|properties|required|additionalProperties/);
    expect(compactSkillCatalog([...CALENDAR_TOOLS].reverse())).toEqual(catalog);
    expect(catalog.tools.every(t => t.description.length > 0 && t.description.length <= 240)).toBe(true);
  });

  it('exports exactly two deeply frozen definitions independent of activation', () => {
    expect(SKILL_NATIVE_TOOLS.map(t => t.name)).toEqual(['activate_skill', 'call_tool']);
    const assertFrozen = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).forEach(assertFrozen);
    };
    assertFrozen(SKILL_NATIVE_TOOLS);
    expect(JSON.stringify(SKILL_NATIVE_TOOLS)).not.toContain('calendar_get_event');
    expect(SKILL_NATIVE_TOOLS[1].inputSchema).toMatchObject({ type: 'object',
      additionalProperties: false, required: ['plugin', 'tool', 'arguments'],
      properties: { arguments: { type: 'object', additionalProperties: true } } });
    expect(JSON.stringify(SKILL_NATIVE_TOOLS)).not.toContain('"strict":true');
  });
});

describe('bounded skill envelopes and local results', () => {
  it('accepts one/many/all but rejects empty, duplicate, oversized, or extra selections', () => {
    for (const tools of [['calendar_get_event'], ['calendar_get_event', 'calendar_list_events'], 'all']) {
      expect(activateSkillEnvelopeSchema.safeParse({ plugin: 'google-calendar', tools }).success).toBe(true);
    }
    for (const tools of [[], ['calendar_get_event', 'calendar_get_event'],
      Array.from({ length: 65 }, (_, i) => `tool_${i}`), '*', null]) {
      expect(activateSkillEnvelopeSchema.safeParse({ plugin: 'google-calendar', tools }).success).toBe(false);
    }
    expect(activateSkillEnvelopeSchema.safeParse({ plugin: 'google-calendar', tools: 'all', userId: 'u' }).success).toBe(false);
    // A safe wrapper is not proof of a valid Calendar argument or a known plugin/tool.
    expect(callToolEnvelopeSchema.parse({ plugin: 'unknown-plugin', tool: 'unknown_tool',
      arguments: { eventId: 7 } }).arguments).toEqual({ eventId: 7 });
    for (const arguments_ of [null, [], 'text']) {
      expect(callToolEnvelopeSchema.safeParse({ plugin: 'google-calendar', tool: 'calendar_get_event',
        arguments: arguments_ }).success).toBe(false);
    }
    expect(callToolEnvelopeSchema.safeParse({ plugin: 'google-calendar', tool: 'calendar_get_event',
      arguments: { description: 'é'.repeat(8192) } }).success).toBe(false);
  });

  it('resolves only enabled metadata atomically and uses the authoritative schema objects', () => {
    const result = selectSkillTools({ plugin: 'google-calendar', tools: ['calendar_get_event'] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected selection');
    expect(result.tools[0]).toBe(CALENDAR_TOOLS.find(t => t.name === 'calendar_get_event'));
    expect(selectSkillTools({ plugin: 'google-calendar', tools: 'all' })).toMatchObject({ ok: true,
      tools: expect.arrayContaining(CALENDAR_TOOLS) });
    expect(selectSkillTools({ plugin: 'google-calendar', tools: ['calendar_list_events', 'calendar_get_event'] }))
      .toEqual(selectSkillTools({ plugin: 'google-calendar', tools: ['calendar_get_event', 'calendar_list_events'] }));
    expect(selectSkillTools({ plugin: 'other', tools: 'all' })).toEqual({ ok: false, code: 'UNKNOWN_PLUGIN' });
    expect(selectSkillTools({ plugin: 'google-calendar', tools: ['calendar_get_event', 'calendar_nope'] }))
      .toEqual({ ok: false, code: 'UNKNOWN_TOOL' });
    expect(selectSkillTools({ plugin: 'google-calendar', tools: [] })).toEqual({ ok: false, code: 'INVALID_SELECTION' });
    expect(selectSkillTools({ plugin: 'google-calendar', tools: 'all' }, []))
      .toEqual({ ok: false, code: 'UNKNOWN_PLUGIN' });
  });

  it('bounds complete disclosure batches and permits compact references without replacing originals', () => {
    const tool = CALENDAR_TOOLS.find(t => t.name === 'calendar_get_event')!;
    const result = { kind: 'skill-disclosure', protocolVersion: 'plugin-skills.v1', plugin: 'google-calendar',
      disclosures: [{ tool: tool.name, revision: tool.revision,
        inputSchema: tool.inputSchema, instructions: tool.description }], alreadyLoaded: [] };
    expect(skillLocalResultSchema.parse(result)).toEqual(result);
    const ack = { ...result, disclosures: [], alreadyLoaded: [{ tool: tool.name,
      revision: tool.revision, disclosureCallId: 'original_call' }] };
    expect(serializeSkillLocalResult(ack)).not.toContain('inputSchema');
    expect(skillLocalResultSchema.safeParse({ ...ack, alreadyLoaded: [] }).success).toBe(false);
    expect(skillLocalResultSchema.safeParse({ ...result, alreadyLoaded: ack.alreadyLoaded }).success).toBe(false);
    expect(() => serializeSkillLocalResult(result, 10)).toThrow(RangeError);
    const oversized = { ...result, disclosures: Array.from({ length: 64 }, (_, i) => ({
      ...result.disclosures[0], tool: `tool_${i}`, instructions: 'é'.repeat(1000) })) };
    expect(skillLocalResultSchema.safeParse(oversized).success).toBe(false);
    expect(JSON.stringify(result)).toContain('inputSchema'); // no silently truncated success
  });

  it('distinguishes missing/stale/argument failures from non-repairable metadata errors', () => {
    for (const code of ['SCHEMA_NOT_LOADED', 'SCHEMA_STALE'] as const) {
      const result = skillError(code, 'google-calendar', 'calendar_get_event');
      expect(result.retry).toBe('activate-skill');
      expect(result.instruction).toContain('activate_skill');
      expect(result.instruction).toContain('call_tool');
      expect(serializeSkillLocalResult(result).length).toBeLessThan(2048);
    }
    const argumentError = skillError('ARGUMENTS_INVALID', 'google-calendar', 'calendar_get_event',
      [{ path: 'eventId', code: 'wrong-type', expected: 'string' }]);
    expect(argumentError.retry).toBe('correct-arguments');
    for (const code of ['UNKNOWN_PLUGIN', 'UNKNOWN_TOOL', 'INVALID_SELECTION', 'DISCLOSURE_BUDGET_EXCEEDED'] as const) {
      expect(skillError(code, 'google-calendar', null).retry).toBe('none');
    }
    expect(skillLocalResultSchema.safeParse({ ...argumentError, instruction: 'arbitrary instructions' }).success).toBe(false);
  });
});

const rawDispatch = '{ "tool":"calendar_get_event", "plugin":"google-calendar", "arguments": {"eventId":7} }';
const nativeDispatch = { id: 'call_raw', type: 'function' as const,
  function: { name: 'call_tool' as const, arguments: rawDispatch } };
const stableDecision = { kind: 'call_tool', decisionId: 'd', nativeCall: nativeDispatch,
  assistantContent: 'I will look that up.', envelope: JSON.parse(rawDispatch), terminal: 'tool_calls' };
const localContent = JSON.stringify(skillError('SCHEMA_NOT_LOADED', 'google-calendar', 'calendar_get_event'));
const localRecord = { schemaVersion: 3, kind: 'calendar-tool-result', protocolVersion: 'plugin-skills.v1',
  userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', eventId: 'e',
  sequence: 1, toolCallId: 'call_raw', createdAt: '2026-11-04T10:00:00.000Z',
  resultRef: { storage: 'local', toolCallId: 'call_raw', content: localContent } };

describe('stable decision and durable local history contracts', () => {
  it('keeps raw identity and accepts safely parsed but invalid domain arguments', () => {
    const decision = skillDecisionSchema.parse(stableDecision);
    expect(decision).toEqual(stableDecision);
    expect(decision.kind).toBe('call_tool');
    expect(skillDecisionSchema.safeParse({ ...stableDecision,
      nativeCall: { ...nativeDispatch, function: { ...nativeDispatch.function, name: 'activate_skill' } } }).success).toBe(false);
    expect(skillDecisionSchema.safeParse({ ...stableDecision,
      envelope: { ...stableDecision.envelope, tool: 'calendar_create_event' } }).success).toBe(false);
    expect(skillDecisionSchema.safeParse({ ...stableDecision, call: { name: 'calendar_get_event' } }).success).toBe(false);
  });

  it('records local outcomes without fake Google sources and keeps exact result text', () => {
    expect(localSkillResultRecordSchema.parse(localRecord)).toEqual(localRecord);
    expect(compatibleSkillResultRecordSchema.parse(localRecord)).toEqual(localRecord);
    expect(localSkillResultRecordSchema.safeParse({ ...localRecord, source: {} }).success).toBe(false);
    expect(localSkillResultRecordSchema.safeParse({ ...localRecord,
      resultRef: { ...localRecord.resultRef, toolCallId: 'different' } }).success).toBe(false);
    expect(localSkillResultRecordSchema.safeParse({ ...localRecord,
      resultRef: { ...localRecord.resultRef, content: '{' } }).success).toBe(false);
    expect(completeToolGroupV2Schema.parse({ assistant: { role: 'assistant',
      content: stableDecision.assistantContent, tool_calls: [nativeDispatch] },
      result: { role: 'tool', name: 'call_tool', tool_call_id: 'call_raw', content: localContent }, sources: [] }))
      .toMatchObject({ sources: [], assistant: { content: 'I will look that up.' } });
  });

  it('reads old decisions without changing their operation revision', () => {
    const base = { kind: 'calendar-model-decision', userId: 'u', sessionId: 's', turnId: 't',
      attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch', configRevision: 1,
      connectionId: 'c', connectionRevision: 1, rejectedDecisionId: null, sources: [],
      operationId: null, createdAt: '2026-11-04T10:00:00.000Z' };
    const v1 = { ...base, schemaVersion: 1, schemaRevision: 'google-calendar.v1', decision: {
      kind: 'tool', decisionId: 'd', toolCallId: 'old_call',
      call: { name: 'calendar_get_event', arguments: { eventId: 'abcde' } }, terminal: 'tool_calls' } };
    const v2 = { ...base, schemaVersion: 2, schemaRevision: 'google-calendar.v2',
      decision: v1.decision, intentId: null, proposalId: null };
    const v3 = { ...v2, schemaVersion: 3, protocolVersion: 'plugin-skills.v1', decision: stableDecision };
    for (const record of [v1, v2, v3]) expect(compatibleSkillDecisionRecordSchema.parse(record)).toEqual(record);
    expect(resumableSkillDecisionSchema.parse(v3).schemaRevision).toBe('google-calendar.v2');
    const refs = { version: 3, protocolVersion: 'plugin-skills.v1', userId: 'u', sessionId: 's',
      turnId: 't', decisionIds: Array.from({ length: 8 }, (_, i) => `d_${i}`),
      toolCallIds: Array.from({ length: 8 }, (_, i) => `call_${i}`), operationId: null,
      intentId: null, proposalId: null, connectionId: 'c', connectionRevision: 1,
      schemaRevision: 'google-calendar.v2' };
    expect(skillCheckpointRefsSchema.parse(refs)).toEqual(refs);
    expect(skillCheckpointRefsSchema.safeParse({ ...refs, toolCallIds: [...refs.toolCallIds, 'ninth'] }).success).toBe(false);
  });
});
