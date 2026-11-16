import { CalendarStreamAssembly } from '../../src/model/calendar-stream.js';
import { parseSse } from '../../src/model/sse.js';
import { SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { response } from './helpers.js';
import { nativeFrame, skillNativeWire as nativeWire } from './calendar-fixtures.js';

const execute = vi.fn();
const repair = vi.fn();
const dispatchArgs = (args: string) =>
  `{"plugin":"google-calendar","tool":"calendar_get_event","arguments":${args}}`;

async function assemble(wire: string, width = 1) {
  const assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
  let done = false;
  const deltas: string[] = [];
  for await (const frame of parseSse(response(wire, width).body!)) {
    if (frame.type === 'comment') continue;
    if (frame.data === '[DONE]') { done = true; break; }
    const provisional = assembly.push(JSON.parse(frame.data));
    if (provisional.text) deltas.push(provisional.text);
    expect('call' in provisional).toBe(false);
  }
  return { assembly, done, deltas };
}

function finishOf(assembly: CalendarStreamAssembly) {
  const result = assembly.finish();
  if ('kind' in result && result.kind === 'valid') execute(result);
  if ('kind' in result && result.kind === 'rejected') repair(result);
  return result;
}

beforeEach(() => { execute.mockClear(); repair.mockClear(); });

describe('Calendar stream assembly', () => {
  it('assembles fragmented calls only after native terminal framing', async () => {
    const assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
    const wire = nativeFrame({ tool_calls: [{ index: 0, id: 'call_1', type: 'function',
      function: { name: 'call_', arguments: dispatchArgs('{"eventId":"abcde"}').slice(0, 40) } }] })
      + nativeFrame({ tool_calls: [{ index: 0, function: { name: 'tool', arguments: dispatchArgs('{"eventId":"abcde"}').slice(40) } }] })
      + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
    let done = false;
    for await (const frame of parseSse(response(wire, 1).body!)) {
      if (frame.type === 'comment') continue;
      if (frame.data === '[DONE]') { done = true; break; }
      const provisional = assembly.push(JSON.parse(frame.data));
      expect(provisional.text).toBeNull();
      expect('call' in provisional).toBe(false);
    }
    expect(done).toBe(true);
    expect(assembly.finish()).toMatchObject({ kind: 'valid', nativeCall: { id: 'call_1',
      function: { name: 'call_tool', arguments: dispatchArgs('{"eventId":"abcde"}') } },
      envelope: { plugin: 'google-calendar', tool: 'calendar_get_event', arguments: { eventId: 'abcde' } } });
  });

  it.each([1, 2, 7, 65536])('reassembles escaped arguments across %s-byte packets', async (width) => {
    const args = '{"eventId":"a\\"b"}';
    const { assembly, done } = await assemble(nativeWire(args), width);
    expect(done).toBe(true);
    expect(finishOf(assembly)).toMatchObject({ kind: 'valid', envelope: { arguments: { eventId: 'a"b' } } });
  });

  it('does not emit a call before terminal plus DONE', async () => {
    const assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
    const provisional = assembly.push(JSON.parse(nativeFrame({
      tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'call_tool', arguments: dispatchArgs('{"eventId":"abcde"}') } }],
    }).slice(6)));
    expect(provisional.text).toBeNull();
    expect(() => assembly.finish()).toThrow();
    expect(execute).toHaveBeenCalledTimes(0);
  });

  it('returns text for stop and truncated text for length', async () => {
    const stop = nativeFrame({ role: 'assistant', content: 'Hello' }, 'stop') + 'data: [DONE]\n\n';
    const length = nativeFrame({ role: 'assistant', content: 'Hello' }, 'length') + 'data: [DONE]\n\n';
    expect(finishOf((await assemble(stop)).assembly)).toEqual({ kind: 'text', content: 'Hello', truncated: false });
    expect(finishOf((await assemble(length)).assembly)).toEqual({ kind: 'text', content: 'Hello', truncated: true });
    expect(execute).toHaveBeenCalledTimes(0);
    expect(repair).toHaveBeenCalledTimes(0);
  });

  it('rejects a truncated call and a call finished with stop', async () => {
    const truncated = nativeWire('{"eventId":"abcde"}', 'length');
    const stopped = nativeWire('{"eventId":"abcde"}', 'stop');
    expect(finishOf((await assemble(truncated)).assembly)).toMatchObject({ kind: 'rejected' });
    expect(finishOf((await assemble(stopped)).assembly)).toMatchObject({ kind: 'rejected' });
    expect(execute).toHaveBeenCalledTimes(0);
    expect(repair).toHaveBeenCalledTimes(2);
  });

  it('keeps two interleaved calls as one rejected batch', async () => {
    const wire = nativeFrame({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'call_tool', arguments: dispatchArgs('{"eventId":"abcde"}') } }] })
      + nativeFrame({ tool_calls: [{ index: 1, id: 'call_2', type: 'function', function: { name: 'call_tool', arguments: dispatchArgs('{"eventId":"fghij"}') } }] })
      + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
    const result = finishOf((await assemble(wire)).assembly);
    expect(result).toMatchObject({ kind: 'rejected', diagnostics: [expect.objectContaining({ code: 'cardinality' })] });
    expect(execute).toHaveBeenCalledTimes(0);
  });

  it('screens a forbidden extra call before cardinality repair', async () => {
    const wire = nativeFrame({ tool_calls: [
      { index: 0, id: 'call_1', type: 'function', function: { name: 'call_tool', arguments: dispatchArgs('{"eventId":"abcde"}') } },
      { index: 1, id: 'call_2', type: 'function', function: { name: 'call_tool', arguments: dispatchArgs('{"eventId":"abcde","attendees":[]}') } },
    ] }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
    expect(finishOf((await assemble(wire)).assembly)).toMatchObject({
      kind: 'failure', failure: { code: 'FORBIDDEN_TOOL_FIELD' },
    });
    expect(repair).toHaveBeenCalledTimes(0);
    expect(execute).toHaveBeenCalledTimes(0);
  });

  it('accepts usage-only frames and repeated content-free terminals', async () => {
    const assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
    assembly.push({ id: 'gen_fixture', usage: { prompt_tokens: 1 }, choices: [] });
    assembly.push(JSON.parse(nativeFrame({ role: 'assistant', content: 'Hi' }).slice(6)));
    assembly.push(JSON.parse(nativeFrame({}, 'stop').slice(6)));
    assembly.push({ id: 'gen_fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1 } });
    expect(assembly.finish()).toEqual({ kind: 'text', content: 'Hi', truncated: false });
  });

  it('treats JSON/fence prose as text rather than a tool call', async () => {
    const wire = nativeFrame({ role: 'assistant', content: '```json\n{"eventId":"abcde"}\n```' }, 'stop') + 'data: [DONE]\n\n';
    expect(finishOf((await assemble(wire)).assembly)).toEqual({
      kind: 'text', content: '```json\n{"eventId":"abcde"}\n```', truncated: false,
    });
    expect(execute).toHaveBeenCalledTimes(0);
  });

  it('flags incomplete envelopes and legacy function_call as structural', async () => {
    const incomplete = nativeFrame({ tool_calls: [{ index: 0, function: { name: 'call_tool', arguments: dispatchArgs('{"eventId":"abcde"}') } }] })
      + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
    expect(finishOf((await assemble(incomplete)).assembly)).toMatchObject({ kind: 'rejected' });
    const legacy = nativeFrame({ function_call: { name: 'call_tool', arguments: dispatchArgs('{"eventId":"abcde"}') } }, 'tool_calls')
      + 'data: [DONE]\n\n';
    expect(finishOf((await assemble(legacy)).assembly)).toMatchObject({ kind: 'rejected' });
    expect(execute).toHaveBeenCalledTimes(0);
  });

  it('fails provider streams that disagree after a terminal', async () => {
    const assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
    assembly.push(JSON.parse(nativeFrame({ content: 'Hi' }, 'stop').slice(6)));
    expect(() => assembly.push(JSON.parse(nativeFrame({ content: ' more' }).slice(6)))).toThrow();
    const clash = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
    clash.push(JSON.parse(nativeFrame({ content: 'Hi' }, 'stop').slice(6)));
    expect(() => clash.push(JSON.parse(nativeFrame({}, 'length').slice(6)))).toThrow();
    expect(() => new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS).push({ choices: [{}, {}] })).toThrow();
    expect(() => new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS).push({ choices: [{ index: 1, delta: {} }] })).toThrow();
    expect(() => new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS).push({ choices: [{ delta: { role: 'user', content: 'x' } }] })).toThrow();
  });

  it('stops immediately when argument bytes overflow', () => {
    const assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
    expect(() => assembly.push(JSON.parse(nativeFrame({
      tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'call_tool', arguments: dispatchArgs('{"x":"' + 'a'.repeat(16384) + '"}') } }],
    }).slice(6)))).toThrow();
    expect(execute).toHaveBeenCalledTimes(0);
    expect(repair).toHaveBeenCalledTimes(0);
  });

  it('does not require a generation id for a framed calendar decision', async () => {
    const wire = 'data: ' + JSON.stringify({
      model: 'fixture/model',
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function',
        function: { name: 'call_tool', arguments: dispatchArgs('{"eventId":"abcde"}') } }] }, finish_reason: null }],
    }) + '\n\n' + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
    expect(finishOf((await assemble(wire)).assembly)).toMatchObject({ kind: 'valid', nativeCall: { id: 'call_1' } });
  });

  it('records meaningful output only for visible text or call fragments', () => {
    const assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
    expect(assembly.push({ choices: [], usage: { prompt_tokens: 1 } }).meaningfulOutput).toBe(false);
    expect(assembly.push(JSON.parse(nativeFrame({ reasoning: 'PRIVATE' }).slice(6))).meaningfulOutput).toBe(false);
    expect(assembly.push(JSON.parse(nativeFrame({ content: 'Hi' }).slice(6))).meaningfulOutput).toBe(true);
  });

  it('retains fragmented stable identity, raw arguments and assistant content', () => {
    const assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
    const raw = '{ "plugin":"google-calendar", "tools":["calendar_get_event"] }';
    assembly.push({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Loading.', tool_calls: [{
      index: 0, id: 'load_1', type: 'function', function: { name: 'activate_', arguments: raw.slice(0, 12) },
    }] }, finish_reason: null }] });
    expect(() => assembly.finish()).toThrow();
    assembly.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0,
      function: { name: 'skill', arguments: raw.slice(12) } }] }, finish_reason: 'tool_calls' }] });
    expect(assembly.finish()).toEqual({ kind: 'valid', assistantContent: 'Loading.',
      nativeCall: { id: 'load_1', type: 'function', function: { name: 'activate_skill', arguments: raw } },
      envelope: { plugin: 'google-calendar', tools: ['calendar_get_event'] } });
  });

  it.each([undefined, ''])('preserves absent versus empty assistant content: %s', content => {
    const assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, CALENDAR_LIMITS);
    assembly.push({ choices: [{ index: 0, delta: { role: 'assistant', content,
      reasoning: 'PRIVATE', tool_calls: [{ index: 0, id: 'empty_1', type: 'function',
        function: { name: 'activate_skill', arguments: '{"plugin":"google-calendar","tools":"all"}' } }] },
      finish_reason: 'tool_calls' }] });
    expect(assembly.finish()).toMatchObject({ kind: 'valid', assistantContent: content === undefined ? null : '' });
    expect(JSON.stringify(assembly.finish())).not.toContain('PRIVATE');
  });
});
