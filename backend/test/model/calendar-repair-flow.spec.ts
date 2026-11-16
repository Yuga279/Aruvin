/**
 * ============================================================================
 * FILE: calendar-repair-flow.spec.ts
 * LOCATION: backend/test/model/calendar-repair-flow.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    End-to-end unit tests for calendar model multi-turn structural repairs and policy fences.
 *
 * ROLE IN PROJECT:
 *    Simulates OpenRouter stream responses across repairs, verifying correction turns,
 *    two-correction budget exhaustion, rejection recording, and denial non-repairability.
 *
 * KEY COMPONENTS:
 *    - runFixtureTurn: Multi-turn harness running streamed completions through repair cycles.
 * ============================================================================
 */

import { createCalendarModelPortV2 } from '../../src/model/calendar-adapter.js';
import { rebuildCalendarMessages, repairInstruction } from '../../src/model/calendar-repair.js';
import type { CalendarRepairDiagnostics, CompleteCalendarToolGroup, SkillDecisionChunk } from '../../src/contracts/calendar-model.js';
import { config, response } from './helpers.js';
import { calendarBinding, calendarLimits, skillRequest as calendarRequest, nativeFrame } from './calendar-fixtures.js';

const acceptedInput = { role: 'user' as const, content: 'Read event abcde' };
const prefix = [{ role: 'system' as const, content: 'Rules' }];

function wireFor(args: string, callId = 'call_1', generationId = 'gen_fixture') {
  return 'data: ' + JSON.stringify({
    id: generationId, model: 'fixture/model', provider: 'Fixture',
    usage: { prompt_tokens: 12, completion_tokens: 8, cost: 0.00002 },
    choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: callId, type: 'function',
      function: { name: 'call_tool', arguments: args } }] }, finish_reason: null }],
  }) + '\n\n' + 'data: ' + JSON.stringify({
    id: generationId, model: 'fixture/model', provider: 'Fixture',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  }) + '\n\n' + 'data: [DONE]\n\n';
}

async function runFixtureTurn(argumentsByDispatch: readonly string[], options: {
  groups?: readonly CompleteCalendarToolGroup[];
  wires?: readonly string[];
  cancelAfterPosts?: number;
  startRepairs?: number;
  startDispatches?: number;
  executePrior?: () => void;
} = {}) {
  const execute = vi.fn();
  const bodies: Array<Record<string, unknown> & { user: string; messages: Array<{ role: string; content?: string }> }> = [];
  const observedDispatchIds = new Set<string>();
  const rejected: unknown[] = [];
  const failures: unknown[] = [];
  let repairsUsed = options.startRepairs ?? 0;
  let lastRetry: string | null = null;
  let lastRejectedId: string | null = null;
  let lastDiagnostics: CalendarRepairDiagnostics | null = null;
  const groups = [...(options.groups ?? [])];
  const boundary = { prefix, acceptedInput, groups };
  const startIndex = options.startDispatches ?? 0;
  let posts = 0;
  const controller = new AbortController();

  for (let i = 0; i < argumentsByDispatch.length && i < 3; i++) {
    if (options.cancelAfterPosts !== undefined && posts >= options.cancelAfterPosts) {
      controller.abort();
      break;
    }
    if (i > 0) {
      if (lastRetry !== 'schema-repair') break;
      if (repairsUsed >= 2) break;
      repairsUsed += 1;
    }
    if (startIndex + i + 1 > 8) break;
    const dispatchIndex = startIndex + i + 1;
    const reason = repairsUsed > 0 ? 'schema-repair' as const : 'initial' as const;
    if (reason === 'schema-repair' && lastRejectedId === null) {
      lastRejectedId = 'decision_0';
      lastDiagnostics = [{ path: '$', code: 'malformed-json', expected: 'complete-json' }];
    }
    const binding = calendarBinding(reason);
    binding.dispatch.dispatchIndex = dispatchIndex;
    binding.dispatch.dispatchId = `dispatch_${dispatchIndex}`;
    binding.dispatch.decisionId = `decision_${dispatchIndex}`;
    binding.dispatch.reason = reason;
    binding.dispatch.repairedDecisionId = reason === 'schema-repair' ? lastRejectedId : null;
    binding.budget.modelDispatches = dispatchIndex;
    binding.budget.repairs = repairsUsed;
    binding.budget.revision = dispatchIndex;
    const repair = reason === 'schema-repair' && lastRejectedId && lastDiagnostics
      ? { rejectedDecisionId: lastRejectedId, diagnostics: lastDiagnostics } : null;
    const request = {
      ...calendarRequest(controller.signal),
      dispatchId: binding.dispatch.dispatchId,
      decisionId: binding.dispatch.decisionId,
      messages: rebuildCalendarMessages(boundary, repair),
      repair,
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as typeof bodies[number]);
      const wire = options.wires?.[i] ?? wireFor(argumentsByDispatch[i]!);
      return response(wire);
    });
    binding.hooks.onObservation = vi.fn(async () => { observedDispatchIds.add(binding.dispatch.dispatchId); });
    const port = createCalendarModelPortV2(config(), calendarLimits, binding, fetcher);
    const chunks: SkillDecisionChunk[] = [];
    for await (const chunk of port.stream(request)) {
      chunks.push(chunk);
      if (chunk.type === 'rejected') rejected.push(chunk.evidence);
      if (chunk.type === 'failure') {
        failures.push(chunk.failure);
        lastRetry = chunk.failure.retry;
      }
      if (chunk.type === 'decision' && chunk.decision.kind === 'call_tool') execute(chunk.decision);
    }
    posts += 1;
    if (chunks.some(c => c.type === 'rejected')) lastRejectedId = binding.dispatch.decisionId;
    const rejectedChunk = chunks.find(c => c.type === 'rejected');
    if (rejectedChunk && rejectedChunk.type === 'rejected') lastDiagnostics = rejectedChunk.evidence.diagnostics;
    if (chunks.some(c => c.type === 'decision' && c.decision.kind === 'call_tool')) break;
    if (lastRetry !== 'schema-repair') break;
  }

  return { posts, execute, repairsUsed, bodies, observedDispatchIds, rejected, failures };
}

const validDispatch = '{"plugin":"google-calendar","tool":"calendar_get_event","arguments":{"eventId":"abcde"}}';
const missingPlugin = '{"tool":"calendar_get_event","arguments":{}}';
const wrongPluginType = '{"plugin":7,"tool":"calendar_get_event","arguments":{}}';
const wrongArgumentsType = '{"plugin":"google-calendar","tool":"calendar_get_event","arguments":[]}';
const extraWrapperField = '{"plugin":"google-calendar","tool":"calendar_get_event","arguments":{},"extraLabel":"SECRET"}';
const forbiddenDispatch = '{"plugin":"google-calendar","tool":"calendar_get_event","arguments":{"accessToken":"SECRET"}}';

const cases = [
  ['malformed then valid', ['{', validDispatch], 2, 1],
  ['two-correction exhaustion', ['{', missingPlugin, wrongArgumentsType], 3, 0],
] as const;

describe('Calendar repair flow', () => {
  it.each(cases)('%s', async (_name, argumentsByDispatch, expectedPosts, expectedExecutions) => {
    const run = await runFixtureTurn(argumentsByDispatch);
    expect(run.posts).toBe(expectedPosts);
    expect(run.execute).toHaveBeenCalledTimes(expectedExecutions);
    expect(run.repairsUsed).toBe(expectedPosts - 1);
    expect(run.bodies.every(b => b.user === config().identity.userId)).toBe(true);
    expect(run.observedDispatchIds.size).toBe(expectedPosts);
    expect(run.bodies.every(b => b.messages.filter(m => m.role === 'user' && m.content === 'Read event abcde').length === 1)).toBe(true);
  });

  it('repairs missing, wrong and extra innocuous fields then executes once', async () => {
    for (const invalid of [missingPlugin, wrongPluginType, extraWrapperField]) {
      const run = await runFixtureTurn([invalid, validDispatch]);
      expect(run.execute).toHaveBeenCalledTimes(1);
      expect(run.posts).toBe(2);
      expect(JSON.stringify(run.rejected)).not.toContain('extraLabel');
      expect(JSON.stringify(run.rejected)).not.toContain('SECRET');
    }
  });

  it('executes an already charged second correction and refuses a replenished ninth dispatch', async () => {
    const charged = await runFixtureTurn([validDispatch], { startRepairs: 2, startDispatches: 2 });
    expect(charged.execute).toHaveBeenCalledTimes(1);
    const capped = await runFixtureTurn([validDispatch], { startRepairs: 2, startDispatches: 8 });
    expect(capped.posts).toBe(0);
    expect(capped.execute).toHaveBeenCalledTimes(0);
  });

  it('rejects multiple calls and forbidden extras without executing index 0', async () => {
    const many = nativeFrame({ tool_calls: [
      { index: 0, id: 'call_1', type: 'function', function: { name: 'call_tool', arguments: validDispatch } },
      { index: 1, id: 'call_2', type: 'function', function: { name: 'call_tool', arguments: validDispatch } },
    ] }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
    const manyRun = await runFixtureTurn(['ignored'], { wires: [many] });
    expect(manyRun.execute).toHaveBeenCalledTimes(0);
    expect(manyRun.failures).toEqual(expect.arrayContaining([expect.objectContaining({ retry: 'schema-repair' })]));
    const forbidden = nativeFrame({ tool_calls: [
      { index: 0, id: 'call_1', type: 'function', function: { name: 'call_tool', arguments: validDispatch } },
      { index: 1, id: 'call_2', type: 'function', function: { name: 'call_tool', arguments: forbiddenDispatch } },
    ] }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
    const denied = await runFixtureTurn(['ignored'], { wires: [forbidden] });
    expect(denied.execute).toHaveBeenCalledTimes(0);
    expect(denied.posts).toBe(1);
    expect(denied.failures).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FORBIDDEN_TOOL_FIELD' })]));
    expect(denied.repairsUsed).toBe(0);
  });

  it('preserves a completed group after later malformed narration without re-execution', async () => {
    const group: CompleteCalendarToolGroup = {
      assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call_old', type: 'function',
        function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde"}' } }] },
      result: { role: 'tool', tool_call_id: 'call_old', name: 'calendar_get_event', content: '{"ok":true}' },
      sources: [],
    };
    const prior = vi.fn();
    prior(group);
    const run = await runFixtureTurn(['{', validDispatch], { groups: [group] });
    expect(prior).toHaveBeenCalledTimes(1);
    expect(run.execute).toHaveBeenCalledTimes(1);
    expect(run.bodies[1]?.messages).toEqual(expect.arrayContaining([group.assistant, group.result]));
    expect(run.bodies[1]?.messages.filter(m => m.role === 'tool')).toHaveLength(1);
  });

  it('assigns a new call identity on the repaired decision', async () => {
    const run = await runFixtureTurn(['{', validDispatch], {
      wires: [wireFor('{', 'call_1', 'gen_fixture'), wireFor(validDispatch, 'call_2', 'gen_repair')],
    });
    expect(run.execute).toHaveBeenCalledWith(expect.objectContaining({ nativeCall: expect.objectContaining({ id: 'call_2' }) }));
    expect(run.bodies[0]?.messages.filter(m => m.role === 'user')).toHaveLength(1);
    expect(run.bodies[1]?.messages.filter(m => m.role === 'user')).toHaveLength(1);
  });

  it('cancels after rejection without a corrective POST', async () => {
    const run = await runFixtureTurn(['{', validDispatch], { cancelAfterPosts: 1 });
    expect(run.posts).toBe(1);
    expect(run.execute).toHaveBeenCalledTimes(0);
    expect(run.observedDispatchIds.size).toBe(1);
  });

  it('keeps plain text and injection-shaped values from becoming instructions', async () => {
    const text = nativeFrame({ role: 'assistant', content: 'I need the event id.', reasoning: 'PRIVATE_REASONING_CANARY' }, 'stop') + 'data: [DONE]\n\n';
    const textRun = await runFixtureTurn(['ignored'], { wires: [text] });
    expect(textRun.execute).toHaveBeenCalledTimes(0);
    expect(textRun.posts).toBe(1);
    expect(JSON.stringify(textRun.bodies)).not.toContain('PRIVATE_REASONING_CANARY');
    const injected = await runFixtureTurn([forbiddenDispatch, validDispatch]);
    expect(injected.execute).toHaveBeenCalledTimes(0);
    expect(injected.posts).toBe(1);
    expect(injected.repairsUsed).toBe(0);
  });

  it('inspects matched native groups independently of the history guard', async () => {
    const run = await runFixtureTurn(['{', validDispatch]);
    for (const body of run.bodies) {
      const messages = body.messages;
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i] as { role: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string };
        if (message.role === 'assistant' && message.tool_calls) {
          expect(messages[i + 1]).toMatchObject({ role: 'tool', tool_call_id: message.tool_calls[0]?.id });
        }
        if (message.role === 'tool') {
          expect(messages[i - 1]).toMatchObject({ role: 'assistant' });
        }
      }
      expect(messages.filter(m => m.role === 'user' && m.content === 'Read event abcde')).toHaveLength(1);
    }
    expect(run.bodies[1]?.messages.some(m => m.role === 'system' && typeof m.content === 'string'
      && m.content.includes('Correct the previous invalid tool decision'))).toBe(true);
    expect(run.bodies[1]?.messages.at(-1)).toEqual({
      role: 'system',
      content: repairInstruction((run.rejected[0] as { diagnostics: CalendarRepairDiagnostics }).diagnostics),
    });
  });

  it('repairs wrappers but delegates safe invalid plugin arguments to execution', async () => {
    const repaired = await runFixtureTurn([wrongArgumentsType, validDispatch]);
    expect(repaired.posts).toBe(2);
    expect(repaired.repairsUsed).toBe(1);
    const invalidDomain = '{"plugin":"google-calendar","tool":"calendar_get_event","arguments":{"eventId":7}}';
    const delegated = await runFixtureTurn([invalidDomain]);
    expect(delegated.posts).toBe(1);
    expect(delegated.repairsUsed).toBe(0);
    expect(delegated.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'call_tool',
      envelope: { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 7 } } }));
    for (const field of ['confirmed', 'conflictAccepted', 'accessToken', 'connectionId']) {
      const denied = await runFixtureTurn([JSON.stringify({ plugin: 'google-calendar', tool: 'calendar_get_event',
        arguments: { eventId: 'abcde', [field]: true } }), validDispatch]);
      expect(denied.posts).toBe(1);
      expect(denied.execute).not.toHaveBeenCalled();
      expect(denied.repairsUsed).toBe(0);
    }
  });
});
