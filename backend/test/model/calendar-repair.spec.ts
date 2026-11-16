/**
 * ============================================================================
 * FILE: calendar-repair.spec.ts
 * LOCATION: backend/test/model/calendar-repair.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for calendar model repair prompt generation and native history assembly.
 *
 * ROLE IN PROJECT:
 *    Validates that model repair instructions contain exact diagnostics, rejects malicious
 *    injections, and verifies assistant/tool groups (both v1 and v2) in history boundaries.
 *
 * KEY COMPONENTS:
 *    - repairInstruction: Tests generated instruction strings and safety checks.
 *    - rebuildCalendarMessages: Tests prefix, accepted input, tool group, and repair reconstruction.
 * ============================================================================
 */

import { assertNativeHistory, rebuildCalendarMessages, repairInstruction, type CalendarHistoryBoundary, type CompleteCalendarToolGroupV2 } from '../../src/model/calendar-repair.js';
import type { CompleteCalendarToolGroup } from '../../src/contracts/calendar-model.js';
import { repairDiagnosticsSchema } from '../../src/contracts/calendar-model.js';
import { skillError } from '../../src/contracts/calendar-tools.js';

const diagnostics = [{ path: 'eventId' as const, code: 'missing' as const, expected: 'string' as const }];
const instruction = repairInstruction(diagnostics);

describe('Calendar repair history', () => {
  it('uses native tools rather than copying a second schema catalogue into repair prose', () => {
    const instruction = repairInstruction([{ path: 'pageToken', code: 'invalid-value', expected: 'bounded-value' }]);
    expect(instruction).toContain('pageToken');
    expect(instruction).toContain('nextPageToken');
    expect(instruction).not.toContain('Allowed tool schemas:');
    expect(instruction).not.toContain('"inputSchema"');
  });

  it('tells the model to emit exactly one tool call after a cardinality rejection', () => {
    const instruction = repairInstruction([{ path: 'tool_calls', code: 'cardinality', expected: 'one-call' }]);
    expect(instruction).toContain(JSON.stringify([{ path: 'tool_calls', code: 'cardinality', expected: 'one-call' }]));
    expect(instruction).toContain('exactly one');
    expect(instruction).toContain('one calendar per decision');
    expect(instruction).not.toContain('Allowed tool schemas:');
    expect(instruction).not.toContain('"inputSchema"');
  });

  it('reconstructs repair history without rejected or fabricated messages', () => {
    const acceptedInput = { role: 'user' as const, content: 'Read event abcde' };
    const group: CompleteCalendarToolGroup = {
      assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call_old', type: 'function',
        function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde"}' } }] },
      result: { role: 'tool', tool_call_id: 'call_old', name: 'calendar_get_event', content: '{"ok":true}' },
      sources: [],
    };
    const boundary = { prefix: [{ role: 'system' as const, content: 'Rules' }], acceptedInput, groups: [group] };
    const before = JSON.stringify(boundary);
    for (const rejectedDecisionId of ['rejected_1', 'rejected_2']) {
      const diagnostics = [{ path: 'eventId' as const, code: 'missing' as const, expected: 'string' as const }];
      const messages = rebuildCalendarMessages(boundary, { rejectedDecisionId, diagnostics });
      expect(messages).toEqual([...boundary.prefix, acceptedInput, group.assistant, group.result,
        { role: 'system', content: repairInstruction(diagnostics) }]);
      expect(messages.filter(m => m.role === 'user')).toHaveLength(1);
      expect(messages.filter(m => m.role === 'tool')).toHaveLength(1);
      expect(JSON.stringify(messages)).not.toContain(rejectedDecisionId);
    }
    expect(JSON.stringify(boundary)).toBe(before);
    expect(() => rebuildCalendarMessages({ ...boundary,
      groups: [{ ...group, result: { ...group.result, tool_call_id: 'unmatched' } }] }, null)).toThrow();
  });

  it('keeps normalized diagnostics and rejects malicious diagnostics', () => {
    expect(instruction).toContain(JSON.stringify(diagnostics));
    expect(instruction).toContain('native tool-call format');
    expect(instruction).toContain('This rejected decision performed no calendar write.');
    expect(instruction).not.toContain('Allowed tool schemas:');
    expect(instruction).not.toContain('"inputSchema"');
    expect(repairInstruction(repairDiagnosticsSchema.parse(diagnostics))).toBe(instruction);
    expect(() => repairInstruction([{ path: 'accessToken' as 'eventId', code: 'missing', expected: 'string' }])).toThrow();
    expect(() => repairInstruction([{ path: 'eventId', code: 'missing', expected: 'string', injected: 'SECRET' } as typeof diagnostics[number]])).toThrow();
    expect(repairInstruction(diagnostics)).not.toContain('SECRET');
    expect(repairInstruction(diagnostics)).not.toContain('accessToken');
  });

  it('fails unmatched, reversed, duplicate and extra result groups before dispatch', () => {
    const acceptedInput = { role: 'user' as const, content: 'Read event abcde' };
    const group: CompleteCalendarToolGroup = {
      assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call_old', type: 'function',
        function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde"}' } }] },
      result: { role: 'tool', tool_call_id: 'call_old', name: 'calendar_get_event', content: '{"ok":true}' },
      sources: [],
    };
    const boundary: CalendarHistoryBoundary = { prefix: [{ role: 'system', content: 'Rules' }], acceptedInput, groups: [group] };
    expect(() => rebuildCalendarMessages({ ...boundary, groups: [{ ...group, result: { ...group.result, tool_call_id: 'unmatched' } }] }, null)).toThrow();
    expect(() => rebuildCalendarMessages({ ...boundary, prefix: [...boundary.prefix, group.result as never] }, null)).toThrow();
    const duplicate = { ...group, assistant: { ...group.assistant, tool_calls: [{ ...group.assistant.tool_calls[0]!, id: 'call_old' }] } };
    expect(() => rebuildCalendarMessages({ ...boundary, groups: [group, duplicate] }, null)).toThrow();
    const extra: CompleteCalendarToolGroup = {
      assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call_new', type: 'function',
        function: { name: 'calendar_get_event', arguments: '{"eventId":"fghij"}' } }] },
      result: { role: 'tool', tool_call_id: 'call_new', name: 'calendar_get_event', content: '{"ok":true}' },
      sources: [],
    };
    expect(() => rebuildCalendarMessages({
      ...boundary,
      prefix: [...boundary.prefix, extra.result as never],
    }, null)).toThrow();
  });

  it('preserves a completed group after a later structural failure without re-execution', () => {
    const execute = vi.fn();
    const acceptedInput = { role: 'user' as const, content: 'Create then narrate' };
    const group: CompleteCalendarToolGroup = {
      assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call_create', type: 'function',
        function: { name: 'calendar_create_event', arguments: '{"summary":"Meet","start":"2026-10-20T10:00:00Z","end":"2026-10-20T11:00:00Z","timeZone":"UTC"}' } }] },
      result: { role: 'tool', tool_call_id: 'call_create', name: 'calendar_create_event', content: '{"ok":true}' },
      sources: [],
    };
    execute(group);
    const prefix = [
      { role: 'system' as const, content: 'Rules' },
      { role: 'user' as const, content: 'Earlier question' },
      { role: 'assistant' as const, content: 'Earlier answer' },
      { role: 'system' as const, content: 'Response mode: text.' },
    ];
    const boundary: CalendarHistoryBoundary = { prefix, acceptedInput, groups: [group] };
    const messages = rebuildCalendarMessages(boundary, { rejectedDecisionId: 'rejected_later', diagnostics });
    expect(messages).toEqual([...prefix, acceptedInput, group.assistant, group.result,
      { role: 'system', content: instruction }]);
    expect(execute).toHaveBeenCalledTimes(1);
    const assistants = messages.filter(m => m.role === 'assistant' && 'tool_calls' in m);
    const tools = messages.filter(m => m.role === 'tool');
    expect(assistants).toHaveLength(1);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ tool_call_id: 'call_create', name: 'calendar_create_event' });
    const rebuilt = rebuildCalendarMessages(boundary, { rejectedDecisionId: 'rejected_other', diagnostics });
    expect(rebuilt.filter(m => m.role === 'system' && m.content === instruction)).toHaveLength(1);
    expect(rebuilt).toEqual(messages);
  });

  it('preserves repeated older user text and does not append onto a failed request', () => {
    const acceptedInput = { role: 'user' as const, content: 'Read event abcde' };
    const prefix = [
      { role: 'system' as const, content: 'Rules' },
      { role: 'user' as const, content: 'Read event abcde' },
      { role: 'assistant' as const, content: 'Earlier answer' },
      { role: 'system' as const, content: 'Response mode: text.' },
    ];
    const boundary: CalendarHistoryBoundary = { prefix, acceptedInput, groups: [] };
    const first = rebuildCalendarMessages(boundary, { rejectedDecisionId: 'rejected_1', diagnostics });
    const second = rebuildCalendarMessages(boundary, { rejectedDecisionId: 'rejected_1', diagnostics });
    expect(first.filter(m => m.role === 'user' && m.content === 'Read event abcde')).toHaveLength(2);
    expect(first.filter(m => m.role === 'system' && m.content === instruction)).toHaveLength(1);
    expect(second).toEqual(first);
    expect(first.some(m => m.role === 'tool')).toBe(false);
  });

  it('reconstructs repair history with v2 tool group and v2 provenance', () => {
    const acceptedInput = { role: 'user' as const, content: 'Read event abcde' };
    const groupV2: CompleteCalendarToolGroupV2 = {
      assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call_v2', type: 'function',
        function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde","calendarId":"shared"}' } }] },
      result: { role: 'tool', tool_call_id: 'call_v2', name: 'calendar_get_event', content: '{"ok":true}' },
      sources: [],
    };
    const boundary = { prefix: [{ role: 'system' as const, content: 'Rules' }], acceptedInput, groups: [groupV2] };
    const messages = rebuildCalendarMessages(boundary, null);
    expect(messages).toEqual([...boundary.prefix, acceptedInput, groupV2.assistant, groupV2.result]);
  });

  it('appends a hidden model note after tool groups without treating it as transcript history', () => {
    const acceptedInput = { role: 'user' as const, content: 'yes' };
    const boundary = { prefix: [{ role: 'system' as const, content: 'Rules' }], acceptedInput, groups: [] };
    const note = 'No Calendar event was created. The requested time is not free.';
    const messages = rebuildCalendarMessages(boundary, null, note);
    expect(messages.at(-1)).toEqual({ role: 'system', content: note });
  });
});

it('keeps a rejected-domain stable pair and its raw call before historical narration', () => {
  const raw = '{ "plugin":"google-calendar", "tool":"calendar_get_event", "arguments":{"eventId":7} }';
  const assistant = { role: 'assistant' as const, content: 'Looking.', tool_calls: [{
    id: 'stable_old', type: 'function' as const, function: { name: 'call_tool' as const, arguments: raw } }] };
  const result = { role: 'tool' as const, name: 'call_tool' as const, tool_call_id: 'stable_old',
    content: JSON.stringify(skillError('ARGUMENTS_INVALID', 'google-calendar', 'calendar_get_event',
      [{ path: 'eventId', code: 'wrong-type', expected: 'string' }])) };
  const prefix = [{ role: 'system' as const, content: 'Rules' },
    { role: 'user' as const, content: 'Previous input' }, assistant, result,
    { role: 'assistant' as const, content: 'Previous narration' }];
  const boundary = { prefix, acceptedInput: { role: 'user' as const, content: 'Next input' }, groups: [] };
  const messages = rebuildCalendarMessages(boundary, null);
  expect(messages).toEqual([...prefix, boundary.acceptedInput]);
  expect(messages[2]).toEqual(assistant);
  expect(messages[3]).toEqual(result);
  expect(() => assertNativeHistory(messages)).not.toThrow();
  expect(() => assertNativeHistory([...messages, assistant, result])).toThrow('Duplicate');
  expect(() => assertNativeHistory([result, assistant])).toThrow();
  expect(() => assertNativeHistory([assistant, { ...result, name: 'activate_skill' }])).toThrow();
  expect(() => assertNativeHistory([{ ...assistant, tool_calls: [{ ...assistant.tool_calls[0],
    function: { name: 'call_tool', arguments: '{"plugin":"a","plugin":"b","tool":"x","arguments":{}}' } }] }, result])).toThrow();
});

it('gives specific bounded load-and-retry guidance without resetting any repair budget', () => {
  for (const code of ['schema-not-loaded', 'schema-stale'] as const) {
    const instruction = repairInstruction([{ path: 'tool', code, expected: 'bounded-value' }]);
    expect(instruction).toContain('activate_skill');
    expect(instruction).toContain('call_tool');
    expect(instruction).not.toContain('inputSchema');
  }
});
