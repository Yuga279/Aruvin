/**
 * ============================================================================
 * FILE: skill-context.spec.ts
 * LOCATION: backend/test/context/skill-context.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify historical local skill groups are inserted at their originating turn
 *    without rewriting the existing stable prefix.
 *
 * ROLE IN PROJECT:
 *    Guards P2 context assembly: position metadata, local-result classification,
 *    disclosure authority, and context limits.
 *
 * KEY COMPONENTS:
 *    - PositionedContext fixture with an old user turn.
 *    - calendarContext insertion and loaded-skill derivation assertions.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { CALENDAR_TOOLS, SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { calendarContext } from '../../src/context/calendar-context.js';
import type { PositionedContext } from '../../src/context/referenced-context-assembler.js';
import { activateLocalSkill } from '../../src/chat-runtime/calendar-skills.js';
import { completeToolGroupV2Schema } from '../../src/contracts/calendar-model.js';
import { CALENDAR_TOMBSTONE } from '../../src/contracts/calendar-sources.js';

it('inserts local groups in the original turn without rewriting the existing prefix', () => {
  const envelope = { plugin: 'google-calendar', tools: ['calendar_get_event'] };
  const result = activateLocalSkill(envelope, new Map(), 16384);
  const group = completeToolGroupV2Schema.parse({ assistant: { role: 'assistant', content: 'Looking up the schema.',
    tool_calls: [{ id: 'load-old', type: 'function', function: { name: 'activate_skill',
      arguments: JSON.stringify(envelope) } }] }, result: { role: 'tool', name: 'activate_skill',
    tool_call_id: 'load-old', content: JSON.stringify(result) }, sources: [] });
  const context: PositionedContext = { contextVersion: 1, instructionVersion: 'i', knowledgeContentHash: 'k',
    graphSchemaVersion: 'g', messages: [{ role: 'system', content: 'unchanged' },
      { role: 'user', content: 'Read it' }, { role: 'assistant', content: 'Done' },
      { role: 'user', content: 'Read it' }], historyPositions: [
      { messageId: 'u1', turnId: 't1', role: 'user', index: 1 },
      { messageId: 'a1', turnId: 't1', role: 'assistant', index: 2 }] };
  const assembled = calendarContext({ context, acceptedInput: 'Read it', groups: [], repair: null,
    tools: SKILL_NATIVE_TOOLS, historicalGroups: new Map([['t1', [group]]]),
    budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS, binding: {
      userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' }, now: Date.now() });
  const withoutCatalog = assembled.messages.filter(message => !message.content?.startsWith('Enabled plugin catalog (trusted application metadata):'));
  expect(withoutCatalog).toEqual([context.messages[0], context.messages[1],
    group.assistant, group.result, context.messages[2], context.messages[3]]);
  expect(assembled.loadedSkills.get('google-calendar:calendar_get_event')).toMatchObject({ disclosureCallId: 'load-old' });
  expect(CALENDAR_TOOLS.find(t => t.name === 'calendar_get_event')!.inputSchema).toEqual(
    result.kind === 'skill-disclosure' ? result.disclosures[0]!.inputSchema : null);
  expect(() => calendarContext({ context, acceptedInput: 'Read it', groups: [], repair: null,
    tools: SKILL_NATIVE_TOOLS, historicalGroups: new Map([['t1', [group]]]),
    budgets: { ...DEFAULT_BUDGETS, maxMessagesInContext: 4 }, limits: CALENDAR_LIMITS,
    binding: { userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' }, now: Date.now() }))
    .toThrow(/context limit/);
});

it('does not present withheld calendar history as a failed lookup the user never saw', () => {
  const listing = 'You have one event today: ND3.0 Progress Updates, 10:30 to 11:00 UTC';
  const unavailable = JSON.stringify({
    kind: 'calendar-history-unavailable', message: CALENDAR_TOMBSTONE,
  });
  const group = completeToolGroupV2Schema.parse({
    assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'list-old', type: 'function',
      function: { name: 'call_tool', arguments: JSON.stringify({
        plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {},
      }) } }] },
    result: { role: 'tool', name: 'call_tool', tool_call_id: 'list-old', content: unavailable },
    sources: [],
  });
  const context: PositionedContext = {
    contextVersion: 1, instructionVersion: 'i', knowledgeContentHash: 'k', graphSchemaVersion: 'g',
    messages: [
      { role: 'system', content: 'unchanged' },
      { role: 'user', content: 'What is on my calendar today?' },
      { role: 'assistant', content: listing },
      { role: 'user', content: 'nice' },
    ],
    historyPositions: [
      { messageId: 'u1', turnId: 't1', role: 'user', index: 1 },
      { messageId: 'a1', turnId: 't1', role: 'assistant', index: 2 },
    ],
  };
  const assembled = calendarContext({
    context, acceptedInput: 'nice', groups: [], repair: null, tools: SKILL_NATIVE_TOOLS,
    historicalGroups: new Map([['t1', [group]]]), budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS,
    binding: { userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' },
    now: Date.now(), compatibility: 'historical',
  });
  const prompt = JSON.stringify(assembled.messages);
  expect(assembled.messages).toContainEqual({ role: 'assistant', content: listing });
  expect(assembled.messages).toContainEqual({ role: 'user', content: 'nice' });
  expect(assembled.messages).not.toContainEqual(group.assistant);
  expect(assembled.messages).not.toContainEqual(group.result);
  expect(prompt).not.toContain(CALENDAR_TOMBSTONE);
  expect(prompt).toMatch(/do not recant/i);
});
