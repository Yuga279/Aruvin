import { describe, expect, it } from 'vitest';
import type { AssembledContext } from '../../src/contracts/context.js';
import {
  completeToolGroupSchema,
  completeToolGroupV2Schema,
  type CalendarDecisionRequest,
  type CompleteCalendarToolGroup,
} from '../../src/contracts/calendar-model.js';
import type { CalendarAccountBinding } from '../../src/contracts/calendar-discovery.js';
import { sourceReferenceV2Schema, type CalendarSourceReference } from '../../src/contracts/calendar-sources.js';
import { SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { repairInstruction } from '../../src/model/calendar-repair.js';
import { calendarContext } from '../../src/context/calendar-context.js';

const now = Date.parse('2026-10-21T09:00:00.000Z');
const binding: CalendarAccountBinding = { userId: 'u', connectionId: 'c',
  connectionRevision: 1, googleSubjectId: 'sub' };
const source: CalendarSourceReference = { schemaVersion: 1, sourceId: 'source-one',
  plugin: 'google-calendar', connectionId: 'c', connectionRevision: 1,
  operationIds: ['call-one'], fetchedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60000).toISOString(), redactedAt: null,
  permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' } };
const group = completeToolGroupSchema.parse({
  assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call-one', type: 'function',
    function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde"}' } }] },
  result: { role: 'tool', tool_call_id: 'call-one', name: 'calendar_get_event',
    content: JSON.stringify({ tool: 'calendar_get_event', event: {
      eventId: 'abcde', summary: 'Planning', start: '2026-10-22T10:00:00Z',
      end: '2026-10-22T11:00:00Z', timeZone: 'Etc/UTC', status: 'confirmed', htmlLink: null,
    } }) }, sources: [source],
});
const context: AssembledContext = { contextVersion: 0, instructionVersion: 'fixture-v1',
  knowledgeContentHash: 'a'.repeat(64), graphSchemaVersion: 'fixture-v1', messages: [
    { role: 'system', content: 'Fixture rules' },
    { role: 'user', content: 'Check my event' },
  ] };

const v2Source = sourceReferenceV2Schema.parse({
  schemaVersion: 2, sourceId: 'source-two', plugin: 'google-calendar', connectionId: 'c',
  connectionRevision: 1, operationIds: ['call-two'], toolCallIds: ['call-two'],
  fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString(), redactedAt: null,
  permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
  discoveryRevision: 1, availabilityRevision: null, calendarSetHash: null,
  targets: [{ calendarId: 'owned@example.test', calendarLabel: 'Owned' }],
});
const v2Result = { schemaVersion: 2, tool: 'calendar_get_event',
  target: { calendarId: 'owned@example.test', calendarLabel: 'Owned', discoveryRevision: 1, privateAccess: false },
  event: { eventId: 'abcde', summary: 'Planning', start: '2026-10-22T10:00:00Z', end: '2026-10-22T11:00:00Z',
    timeZone: 'Etc/UTC', status: 'confirmed', htmlLink: null } };
const v2Group = completeToolGroupV2Schema.parse({
  assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call-two', type: 'function',
    function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde"}' } }] },
  result: { role: 'tool', tool_call_id: 'call-two', name: 'calendar_get_event',
    content: JSON.stringify(v2Result) },
  sources: [v2Source],
});

function groupWith(id: string, extras: Partial<CompleteCalendarToolGroup> = {}): CompleteCalendarToolGroup {
  return completeToolGroupSchema.parse({
    assistant: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function',
      function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde"}' } }] },
    result: { role: 'tool', tool_call_id: id, name: 'calendar_get_event',
      content: group.result.content },
    sources: [{ ...source, sourceId: `source-${id}`, operationIds: [id] }],
    ...extras,
  });
}

describe('calendarContext', () => {
  // v1 groups are accepted only in explicit historical compatibility; a current
  // execution assembles v2 groups whose provenance matches the account authority.
  it('rebuilds complete groups with the accepted input exactly once', () => {
    const repair = { rejectedDecisionId: 'bad-decision', diagnostics: [
      { path: 'summary', code: 'missing', expected: 'string' },
    ] } satisfies NonNullable<CalendarDecisionRequest['repair']>;
    const result = calendarContext({ context, acceptedInput: 'Check my event',
      groups: [group], repair, tools: SKILL_NATIVE_TOOLS, budgets: DEFAULT_BUDGETS,
      limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' });
    expect(result.messages.filter(m => m.role === 'user' && m.content === 'Check my event'))
      .toHaveLength(1);
    expect(result.messages.slice(-3)).toEqual([
      group.assistant, group.result, { role: 'system', content: repairInstruction(repair.diagnostics) },
    ]);
    expect(JSON.stringify(result.messages)).not.toContain('bad-json-secret');
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [{ ...group, result: { ...group.result, tool_call_id: 'other-call' } }],
      repair: null, tools: SKILL_NATIVE_TOOLS, budgets: DEFAULT_BUDGETS,
      limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' })).toThrow();
  });

  it('rejects duplicate call IDs', () => {
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [group, group], repair: null, tools: SKILL_NATIVE_TOOLS, budgets: DEFAULT_BUDGETS,
      limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' })).toThrow();
  });

  it('rejects a mismatched tool name', () => {
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [{ ...group, result: { ...group.result, name: 'calendar_list_events' } }],
      repair: null, tools: SKILL_NATIVE_TOOLS, budgets: DEFAULT_BUDGETS,
      limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' })).toThrow();
  });

  it('rejects nine complete groups as a whole', () => {
    const groups = Array.from({ length: 9 }, (_, i) => groupWith(`call-${i + 1}`));
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups, repair: null, tools: SKILL_NATIVE_TOOLS, budgets: DEFAULT_BUDGETS,
      limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' })).toThrow();
  });

  it('rejects expired retained sources in current-turn groups', () => {
    const expired: CalendarSourceReference = {
      ...source, expiresAt: new Date(now - 1).toISOString(),
    };
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [{ ...group, sources: [expired] }], repair: null, tools: SKILL_NATIVE_TOOLS,
      budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' })).toThrow();
  });

  it('rejects redacted retained sources in current-turn groups', () => {
    const redacted: CalendarSourceReference = {
      ...source, redactedAt: new Date(now).toISOString(),
    };
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [{ ...group, sources: [redacted] }], repair: null, tools: SKILL_NATIVE_TOOLS,
      budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' })).toThrow();
  });

  it('allows a volatile source only when listed in the live turn set', () => {
    const volatile: CalendarSourceReference = {
      ...source, permission: { ...source.permission, content: 'volatile' },
      expiresAt: new Date(now).toISOString(),
    };
    const live = completeToolGroupSchema.parse({ ...group, sources: [volatile] });
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [live], repair: null, tools: SKILL_NATIVE_TOOLS, budgets: DEFAULT_BUDGETS,
      limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' })).toThrow();
    const result = calendarContext({ context, acceptedInput: 'Check my event',
      groups: [live], repair: null, tools: SKILL_NATIVE_TOOLS, budgets: DEFAULT_BUDGETS,
      limits: CALENDAR_LIMITS, binding, now, volatileSourceIds: new Set(['source-one']), compatibility: 'historical' });
    expect(result.messages).toContainEqual(live.result);
  });

  it('does not treat an expired retained source as a live volatile result', () => {
    const expired: CalendarSourceReference = {
      ...source, expiresAt: new Date(now - 1).toISOString(),
    };
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [{ ...group, sources: [expired] }], repair: null, tools: SKILL_NATIVE_TOOLS,
      budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS, binding, now,
      volatileSourceIds: new Set(['source-one']), compatibility: 'historical' })).toThrow();
  });

  it('accepts a 16 KiB result and rejects one extra byte', () => {
    const exact = 'x'.repeat(16384);
    const over = 'x'.repeat(16385);
    const exactGroup = completeToolGroupSchema.parse({
      ...group, result: { ...group.result, content: exact },
    });
    const roomy = { ...DEFAULT_BUDGETS, maxContextTokens: 100_000 };
    const accepted = calendarContext({ context, acceptedInput: 'Check my event',
      groups: [exactGroup], repair: null, tools: SKILL_NATIVE_TOOLS, budgets: roomy,
      limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' });
    expect(accepted.messages).toContainEqual(exactGroup.result);
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [{ ...group, result: { ...group.result, content: over } }],
      repair: null, tools: SKILL_NATIVE_TOOLS, budgets: roomy,
      limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' })).toThrow();
  });

  it('rejects a result one byte over a smaller configured limit', () => {
    const content = 'x'.repeat(11);
    const small = completeToolGroupSchema.parse({
      ...group, result: { ...group.result, content },
    });
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [small], repair: null, tools: SKILL_NATIVE_TOOLS, budgets: DEFAULT_BUDGETS,
      limits: { ...CALENDAR_LIMITS, resultBytes: 10 }, binding, now, compatibility: 'historical' })).toThrow();
  });

  it('rejects schema, repair, and result headroom overflow without dropping history', () => {
    const tight = { ...DEFAULT_BUDGETS, maxContextTokens: 200, maxOutputTokens: 100, modelMarginTokens: 90 };
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [group], repair: null, tools: SKILL_NATIVE_TOOLS, budgets: tight,
      limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' })).toThrow();
  });

  it('rejects message-count overflow without slicing groups', () => {
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [group], repair: null, tools: SKILL_NATIVE_TOOLS,
      budgets: { ...DEFAULT_BUDGETS, maxMessagesInContext: 2 },
      limits: CALENDAR_LIMITS, binding, now, compatibility: 'historical' })).toThrow();
  });
});

describe('calendarContext current execution', () => {
  it('accepts a v2 group whose sources match the account authority', () => {
    const result = calendarContext({ context, acceptedInput: 'Check my event', groups: [v2Group],
      repair: null, tools: SKILL_NATIVE_TOOLS, budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS, binding, now });
    expect(result.messages).toContainEqual(v2Group.result);
    expect(result.messages.filter(m => m.role === 'user' && m.content === 'Check my event')).toHaveLength(1);
  });

  it('rejects a v2 source from another account revision', () => {
    const drifted = sourceReferenceV2Schema.parse({ ...v2Source, connectionRevision: 2 });
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [{ ...v2Group, sources: [drifted] }], repair: null, tools: SKILL_NATIVE_TOOLS,
      budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS, binding, now })).toThrow();
  });

  it('rejects a v2 source that does not cover the tool call', () => {
    const drifted = sourceReferenceV2Schema.parse({ ...v2Source, toolCallIds: ['other-call'] });
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [{ ...v2Group, sources: [drifted] }], repair: null, tools: SKILL_NATIVE_TOOLS,
      budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS, binding, now })).toThrow();
  });

  it('rejects a v2 result whose target is not covered by the source targets', () => {
    const drifted = completeToolGroupV2Schema.parse({ ...v2Group,
      result: { ...v2Group.result, content: JSON.stringify({ ...v2Result,
        target: { ...v2Result.target, calendarLabel: 'Renamed' } }) } });
    expect(() => calendarContext({ context, acceptedInput: 'Check my event',
      groups: [drifted], repair: null, tools: SKILL_NATIVE_TOOLS,
      budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS, binding, now })).toThrow();
  });

  it('keeps v1 groups out of a current execution', () => {
    expect(() => calendarContext({ context, acceptedInput: 'Check my event', groups: [group],
      repair: null, tools: SKILL_NATIVE_TOOLS, budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS, binding, now })).toThrow();
  });
});
