/**
 * ============================================================================
 * FILE: calendar-memory-first.spec.ts
 * LOCATION: backend/test/performance/calendar-memory-first.spec.ts
 * ============================================================================
 * PURPOSE: Verify Calendar-enabled conversation at the actual provider boundary.
 * ROLE IN PROJECT: Offline acceptance coverage with blocked durable repositories.
 * KEY COMPONENTS: Native definitions, independent completion and follow-up.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { calendarFixture, textWire, skillWire, createWire, brokenTextWire } from '../runtime/calendar-runtime.fixture.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from '../../src/chat-runtime/memory-text.js';
import { SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';
import type { StreamEnvelope } from '../../src/contracts/stream.js';
import { isCalendarV2 } from '../../src/chat-runtime/calendar-ports.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import type { MongoClient } from 'mongodb';
import { event } from '../runtime/calendar-multi-fixture.js';
import { CALENDAR_TOMBSTONE } from '../../src/contracts/calendar-sources.js';
import type { SubmitTurnResponse } from '../../src/contracts/api.js';
import { MemoryTextArchive } from '../../src/persistence/memory-text-archive.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import type { MemoryFirstPolicy, SaveTerminal } from '../../src/chat-runtime/memory-first-foundation.js';
import { AppService } from '../../src/app.service.js';
import { assemblyFixture } from '../assembly/admin-config-fixture.js';
import { document, at, secret } from '../admin-config/fixtures.js';
import { parseCalendarSetupOptions } from '../../src/plugins/google-calendar/options.js';
import { calendarLimits } from '../model/calendar-fixtures.js';
import type { RuntimeDependencies } from '../../src/chat-runtime/ports.js';
import { VoiceDelivery } from '../../src/voice/agent/voice-delivery.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { key } from '../../src/persistence/records.js';

async function nativeFixture(save?: SaveTerminal, maxAttempts = 1, policy: Partial<MemoryFirstPolicy> = {}) {
  const db = calendarMemory();
  const client = Object.assign(db.commandSource, { db: () => db.store.db, appendMetadata: () => undefined }) as unknown as MongoClient;
  const p = await createPersistenceBundle(client, 'offline-calendar-memory-promotion', DEFAULT_BUDGETS, 'offline-calendar-executor');
  const f = calendarFixture(undefined, p, { policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxAttempts, shutdownDrainMs: 50, ...policy }, voice: true,
    ...(save ? { save } : {}) });
  await f.ready;
  const status = (ids: SubmitTurnResponse) => f.runtime.memoryFor(f.identity.userId)!.status(f.identity.userId, ids.sessionId, ids.turnId);
  const saved = (ids: SubmitTurnResponse) => vi.waitFor(() => expect(status(ids)?.save?.state).toBe('saved'));
  return { ...f, db, status, saved };
}

function readWires(callId = 'memory-read') {
  return [skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_list_events'] }, `${callId}-load`),
    skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
      timeMin: '2026-11-03T10:00:00Z', timeMax: '2026-11-03T11:00:00Z', maxResults: 10,
    } }, callId), textWire('There are no events in that interval.')];
}

function toolIds(body: Record<string, unknown>) {
  return (body.messages as { tool_calls?: { id: string }[] }[]).flatMap(message => message.tool_calls ?? []).map(call => call.id);
}

it('integrated native memory loop retains activation pairs and the accepted input once with storage blocked', async () => {
  const f = calendarFixture(undefined, undefined, {
    policy: PROPOSED_MEMORY_TEXT_POLICY, save: async () => ({ kind: 'unknown', retryable: false }),
  });
  await f.ready;
  const blocked = () => { throw new Error('Database access blocked on ordinary conversation'); };
  const ports: ReturnType<typeof vi.spyOn>[] = [];
  for (const port of new Set(Object.values(f.p).filter(value => value && typeof value === 'object'))) {
    const names = new Set([...Object.keys(port), ...Object.getOwnPropertyNames(Object.getPrototypeOf(port))]);
    for (const name of names) if (name !== 'constructor' && typeof port[name] === 'function')
      ports.push(vi.spyOn(port, name).mockImplementation(blocked));
  }
  const cal = f.runtime.d.calendar!;
  if (!isCalendarV2(cal)) throw new Error('Fixture requires Calendar v2');
  const account = vi.spyOn(cal.connection, 'currentAccount').mockImplementation(blocked);
  const current = vi.spyOn(cal.connection, 'requireAccountCurrent').mockImplementation(blocked);
  f.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_list_calendars'] }),
    textWire('First answer'), textWire('Second answer'));
  try {
    const first = await f.submit('Original question');
    await f.execute(first);
    expect(f.runtime.memoryFor(f.identity.userId)!.status(f.identity.userId, first.sessionId, first.turnId)?.status).toBe('completed');
    const second = await f.submit('Follow up', first.sessionId);
    await f.execute(second);
    expect(f.modelBodies).toHaveLength(3);
    const bodies = f.modelBodies as { messages: { role: string; content: string; tool_calls?: { id: string }[]; tool_call_id?: string }[]; tools: unknown; user: string }[];
    for (const body of bodies) {
      expect(body.tools).toEqual(SKILL_NATIVE_TOOLS.map(tool => ({ type: 'function', function: {
        name: tool.name, description: tool.description, parameters: tool.inputSchema,
      } })));
      expect(body.user).toBe(f.identity.userId);
      expect(body.messages.filter(message => message.role === 'user' && message.content === 'Original question')).toHaveLength(1);
    }
    for (const body of bodies.slice(1)) {
      const calls = body.messages.flatMap(message => message.tool_calls ?? []);
      const results = body.messages.filter(message => message.role === 'tool');
      expect(calls).toHaveLength(1); expect(results).toHaveLength(1);
      expect(results[0]!.tool_call_id).toBe(calls[0]!.id);
    }
    const turn = f.runtime.memoryFor(f.identity.userId)!.find(first.sessionId, first.turnId)!.turn;
    const command = { identity: f.identity, sessionId: null, content: 'Original question', idempotencyKey: turn.requestKey };
    expect(await f.runtime.submitTurn(command)).toEqual(first);
    await expect(f.runtime.submitTurn({ ...command, content: 'Different question' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    await f.execute(first);
    expect(f.modelBodies).toHaveLength(3);
    for (const spy of [...ports, account, current]) expect(spy).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks(); f.runtime.stopAccepting();
  }
});

it('integrated native memory loop preserves schema-not-loaded repair and finite native evidence', async () => {
  const f = calendarFixture(undefined, undefined, {
    policy: PROPOSED_MEMORY_TEXT_POLICY, save: async () => ({ kind: 'unknown', retryable: false }),
  });
  await f.ready;
  f.modelWires.push(skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_list_calendars', arguments: {} }, 'unloaded-call'),
    skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_list_calendars'] }, 'activate-after-repair'),
    textWire('Ready to use the disclosed schema'));
  try {
    const ids = await f.submit('Question'); await f.execute(ids);
    const memory = f.runtime.memoryFor(f.identity.userId)!, turn = memory.find(ids.sessionId, ids.turnId)!.turn;
    expect(memory.status(f.identity.userId, ids.sessionId, ids.turnId)?.status).toBe('completed');
    const native = memory.foundation.result(turn)!.calendar!;
    expect(native.budget).toMatchObject({ modelDispatches: 3, repairs: 1, calendarRequests: 0 });
    expect(native.results).toHaveLength(2);
    expect(native.results[0]!.resultRef.content).toContain('SCHEMA_NOT_LOADED');
    expect(native.results[1]!.resultRef.content).toContain('skill-disclosure');
    expect(native.dispatches.map(dispatch => dispatch.reason)).toEqual(['initial', 'schema-repair', 'continuation']);
    expect(f.effects).toEqual([]);
  } finally { vi.restoreAllMocks(); f.runtime.stopAccepting(); }
});

it('integrated native memory loop cold-hydrates published local pairs through real archive repositories', async () => {
  const db = calendarMemory();
  const client = Object.assign(db.commandSource, { db: () => db.store.db, appendMetadata: () => undefined }) as unknown as MongoClient;
  const p = await createPersistenceBundle(client, 'offline-native-runtime', DEFAULT_BUDGETS, 'offline-native-executor');
  const f = calendarFixture(undefined, p, { policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxAttempts: 1 } });
  await f.ready;
  let cold: DurableChatRuntime | undefined;
  f.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_list_calendars'] }, 'cold-original-call'),
    textWire('Saved answer'), textWire('Cold follow up'));
  try {
    const first = await f.submit('Original question'); await f.execute(first);
    await vi.waitFor(() => expect(f.runtime.memoryFor(f.identity.userId)!.status(f.identity.userId, first.sessionId, first.turnId)?.save?.state).toBe('saved'));
    expect(await f.runtime.drain(100)).toMatchObject({ drained: true });
    cold = new DurableChatRuntime(f.runtime.d);
    const second = await cold.submitTurn({ identity: f.identity, sessionId: first.sessionId,
      content: 'Follow up', idempotencyKey: 'cold-native-follow-up' });
    await cold.executeTurn({ userId: f.identity.userId, ...second, signal: new AbortController().signal,
      emit: async () => {}, emitCalendar: async () => {} });
    expect(cold.memoryFor(f.identity.userId)!.status(f.identity.userId, second.sessionId, second.turnId)?.status).toBe('completed');
    expect(f.modelBodies).toHaveLength(3);
    const messages = f.modelBodies[2]!.messages as { role: string; content: string; tool_calls?: { id: string }[]; tool_call_id?: string }[];
    expect(messages.filter(message => message.role === 'user').map(message => message.content)).toEqual(['Original question', 'Follow up']);
    expect(messages.flatMap(message => message.tool_calls ?? []).map(call => call.id)).toEqual(['cold-original-call']);
    expect(messages.filter(message => message.role === 'tool').map(message => message.tool_call_id)).toEqual(['cold-original-call']);
    await vi.waitFor(() => expect(cold!.memoryFor(f.identity.userId)!.status(f.identity.userId, second.sessionId, second.turnId)?.save?.state).toBe('saved'));
    expect(await cold.drain(100)).toMatchObject({ drained: true });
  } finally { cold?.stopAccepting(); vi.restoreAllMocks(); f.runtime.stopAccepting(); }
});

it('failed prior background saving prevents account and external calls and retries the frozen decision without inference', async () => {
  let archive!: MemoryTextArchive;
  let available = false;
  const run = await nativeFixture((envelope, limits) => available ? archive.save(envelope, limits)
    : Promise.resolve({ kind: 'unknown', retryable: true }), 3);
  archive = new MemoryTextArchive(run.p, run.runtime.d.assets);
  const save = vi.spyOn(archive, 'save');
  const cal = run.runtime.d.calendar!;
  if (!isCalendarV2(cal)) throw new Error('Fixture requires Calendar v2');
  const account = vi.spyOn(cal.connection, 'currentAccount');
  run.modelWires.push(textWire('Dirty background answer'), ...readWires('frozen-external'));
  try {
    const first = await run.submit('Ordinary question'); await run.execute(first);
    await vi.waitFor(() => expect(run.runtime.memoryFor(run.identity.userId)!.status(run.identity.userId, first.sessionId, first.turnId)?.save?.state).toBe('unknown'));
    const second = await run.submit('List my events on 2026-11-03 from 10:00 to 11:00 Etc/UTC.', first.sessionId);
    await run.execute(second).catch(() => undefined);
    expect(run.runtime.memoryFor(run.identity.userId)!.status(run.identity.userId, second.sessionId, second.turnId)?.error?.code).toBe('PERSISTENCE_ERROR');
    expect(run.runtime.memoryFor(run.identity.userId)!.foundation.session(first.sessionId)).toMatchObject({ dirty: true, durableVersion: 0 });
    expect(account).not.toHaveBeenCalled(); expect(run.effects).toEqual([]); expect(run.modelBodies).toHaveLength(3);
    available = true;
    run.advance(PROPOSED_MEMORY_TEXT_POLICY.retryBackoffMs + 1);
    const saveStatus = run.status(first)!.save!;
    await run.runtime.retrySave(run.identity.userId, first.sessionId, first.turnId,
      { epoch: saveStatus.epoch, version: saveStatus.version });
    const retry = await run.runtime.retryTurn({ identity: run.identity, sessionId: second.sessionId,
      turnId: second.turnId, idempotencyKey: 'persist-frozen-external-only' });
    expect(retry.attemptId).toBe(second.attemptId);
    await run.execute(retry);
    expect(run.effects.filter(effect => effect.kind === 'list')).toHaveLength(1);
    expect(run.modelBodies).toHaveLength(4);
    expect(toolIds(run.modelBodies.at(-1)!)).toContain('frozen-external');
    expect(save).toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); run.runtime.stopAccepting(); }
});

it('integrated native memory loop retains cancellation accounting and reconnect never dispatches again', async () => {
  const f = calendarFixture(undefined, undefined, {
    policy: PROPOSED_MEMORY_TEXT_POLICY, save: async () => ({ kind: 'unknown', retryable: false }),
  });
  await f.ready;
  const controller = new AbortController();
  f.modelWires.push(textWire('A provisional answer'));
  try {
    const ids = await f.submit('Question');
    await f.runtime.executeTurn({ userId: f.identity.userId, ...ids, signal: controller.signal,
      emit: async frame => { if (frame.event.type === 'delta') controller.abort(); }, emitCalendar: async () => {} });
    expect(f.modelBodies).toHaveLength(1);
    const memory = f.runtime.memoryFor(f.identity.userId)!, entry = memory.find(ids.sessionId, ids.turnId)!;
    expect(memory.status(f.identity.userId, ids.sessionId, ids.turnId)?.status).toBe('interrupted');
    expect(memory.foundation.result(entry.turn)?.calendar?.dispatches[0])
      .toMatchObject({ status: 'terminal', failure: { category: 'cancelled' } });
    await f.execute(ids);
    expect(f.modelBodies).toHaveLength(1);
  } finally { vi.restoreAllMocks(); f.runtime.stopAccepting(); }
});

it('integrated native memory loop keeps a raw cancelled adapter pinned through bounded drain', async () => {
  const f = calendarFixture(undefined, undefined, {
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, shutdownDrainMs: 20 },
    save: async () => ({ kind: 'unknown', retryable: false }),
  });
  await f.ready;
  const calendar = f.runtime.d.calendar!;
  if (!isCalendarV2(calendar)) throw new Error('Fixture requires Calendar v2');
  const create = calendar.createModelPort;
  let release!: () => void, reached!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const unwinding = new Promise<void>(resolve => { reached = resolve; });
  calendar.createModelPort = (...args) => {
    const adapter = create(...args);
    return { async *stream(request) {
      try { yield* adapter.stream(request); }
      finally { reached(); await blocked; }
    } };
  };
  const controller = new AbortController();
  f.modelWires.push(textWire('Provisional'));
  let run: Promise<void> | undefined;
  try {
    const ids = await f.submit('Question');
    run = f.runtime.executeTurn({ userId: f.identity.userId, ...ids, signal: controller.signal,
      emit: async frame => { if (frame.event.type === 'delta') controller.abort(); }, emitCalendar: async () => {} });
    await unwinding;
    expect(f.runtime.memoryFor(f.identity.userId)!.foundation.session(ids.sessionId).activeAttemptId).toBe(ids.attemptId);
    expect(f.runtime.work.snapshot()).toMatchObject({ active: 1, unresolvedWrites: 1 });
    expect(await f.runtime.drain(10)).toMatchObject({ drained: false, active: 1, unresolvedWrites: 1 });
    release(); await run;
    expect(f.runtime.work.snapshot()).toMatchObject({ active: 0, unresolvedWrites: 0 });
    expect(f.modelBodies).toHaveLength(1);
  } finally {
    release(); await run; calendar.createModelPort = create; vi.restoreAllMocks(); f.runtime.stopAccepting();
  }
});

it('Calendar enabled new and warm text dispatch with unchanged native tools before any database work', async () => {
  const f = calendarFixture(undefined, undefined, {
    policy: PROPOSED_MEMORY_TEXT_POLICY,
    save: async () => ({ kind: 'unknown', retryable: false }),
  });
  await f.ready;
  const blocked = () => { throw new Error('Database access blocked on ordinary conversation'); };
  const ports: ReturnType<typeof vi.spyOn>[] = [];
  // Block every repository/ownership method, including inherited native methods;
  // a new hidden admission read cannot make this acceptance check pass.
  for (const port of new Set(Object.values(f.p).filter(value => value && typeof value === 'object'))) {
    const names = new Set([...Object.keys(port), ...Object.getOwnPropertyNames(Object.getPrototypeOf(port))]);
    for (const name of names) if (name !== 'constructor' && typeof port[name] === 'function')
      ports.push(vi.spyOn(port, name).mockImplementation(blocked));
  }
  const calendar = f.runtime.d.calendar!;
  if (!isCalendarV2(calendar)) throw new Error('Fixture requires Calendar v2');
  ports.push(vi.spyOn(calendar.connection, 'currentAccount').mockImplementation(blocked));
  ports.push(vi.spyOn(calendar.connection, 'requireAccountCurrent').mockImplementation(blocked));
  const frames: StreamEnvelope[] = [];
  try {
    for (const content of ['Hello', 'Follow up']) f.modelWires.push(textWire(content + ' answer'));
    const first = await f.submit('First');
    await f.runtime.executeTurn({ userId: f.identity.userId, ...first,
      signal: new AbortController().signal, emit: async frame => { frames.push(frame); },
      emitCalendar: async () => {} });
    expect(frames.some(frame => frame.event.type === 'delta')).toBe(true);
    expect(frames.at(-1)?.event.type).toBe('completed');
    const second = await f.submit('Second', first.sessionId);
    await f.execute(second);
    expect(f.modelBodies).toHaveLength(2);
    for (const body of f.modelBodies) {
      expect(body.tools).toEqual(SKILL_NATIVE_TOOLS.map(tool => ({ type: 'function', function: {
        name: tool.name, description: tool.description, parameters: tool.inputSchema,
      } })));
      expect(body.user).toBe(f.identity.userId);
    }
    expect(f.modelBodies[1]!.messages).toEqual(expect.arrayContaining([
      { role: 'user', content: 'First' }, { role: 'assistant', content: 'Hello answer' },
      { role: 'user', content: 'Second' },
    ]));
    for (const port of ports) expect(port).not.toHaveBeenCalled();
  } finally {
    for (const port of ports) port.mockRestore();
    f.runtime.stopAccepting();
  }
});

it('flushes dirty prior turns before promoting a read with real receipts and imports its original call into memory', async () => {
  const f = await nativeFixture();
  const pause = f.db.pauseNextUpdate();
  const cal = f.runtime.d.calendar!;
  if (!isCalendarV2(cal)) throw new Error('Fixture requires Calendar v2');
  const account = vi.spyOn(cal.connection, 'currentAccount');
  const invoke = cal.execution.invoke.bind(cal.execution);
  let inspectedPrefix = false;
  vi.spyOn(cal.execution, 'invoke').mockImplementation(async request => {
    const binding = request.binding;
    expect(binding.toolCallId).toBe('original-read-call');
    const active = await f.p.metadata.getAttempt(binding.userId, binding.sessionId, binding.attemptId);
    expect(active).toMatchObject({ status: 'generating', causal: { userMessageId: expect.any(String) } });
    expect(await f.p.metadata.getAcceptance(binding.userId, binding.sessionId, binding.attemptId))
      .toMatchObject({ attemptId: binding.attemptId, userMessageId: active!.causal.userMessageId });
    expect(await f.p.messages.get(binding.userId, binding.sessionId, active!.causal.userMessageId))
      .toMatchObject({ completionStatus: 'accepted', role: 'user' });
    const checkpoint = await f.calendarGraphState(binding.sessionId);
    expect(checkpoint.values.calendarCursor).toMatchObject({ next: 'execute', pendingDecisionId: binding.decisionId });
    expect(checkpoint.values.input.attempt).toMatchObject({ attemptId: binding.attemptId, status: 'generating' });
    const decision = await f.p.skillDecisions.get(binding.userId, binding.decisionId);
    expect(decision?.decision).toMatchObject({ kind: 'call_tool', nativeCall: { id: 'original-read-call' } });
    expect(await f.p.calendarAccountingV2.getBudgetConfirmed!(binding.userId, binding.sessionId, binding.turnId))
      .toMatchObject({ record: { modelDispatches: 2 } });
    inspectedPrefix = true;
    return invoke(request);
  });
  f.modelWires.push(textWire('Earlier answer'), ...readWires('original-read-call'), textWire('Follow-up answer'));
  let run: Promise<void> | undefined;
  try {
    const first = await f.submit('Earlier question'); await f.execute(first); await pause.started;
    const second = await f.submit('List events on 2026-11-03 from 10:00 to 11:00 Etc/UTC.', first.sessionId);
    run = f.execute(second);
    await vi.waitFor(() => expect(f.modelBodies).toHaveLength(3));
    expect(account).not.toHaveBeenCalled(); expect(f.effects).toEqual([]);
    pause.resume(); await run;
    expect(inspectedPrefix).toBe(true);
    expect(f.effects.filter(effect => effect.kind === 'list')).toHaveLength(1);
    expect(f.status(second)).toMatchObject({ status: 'completed', save: { state: 'saved', version: 2, durableVersion: 2 } });
    expect(await f.p.metadata.getAttempt(f.identity.userId, second.sessionId, second.attemptId)).toMatchObject({ status: 'completed' });
    expect(await f.p.calendarAccountingV2.getBudget(f.identity.userId, second.sessionId, second.turnId))
      .toMatchObject({ modelDispatches: 3, logicalTools: 1 });
    expect(await f.p.skillResults.get(f.identity.userId, second.sessionId, 'original-read-call'))
      .toMatchObject({ toolCallId: 'original-read-call', attemptId: second.attemptId });
    const third = await f.submit('Follow up', first.sessionId); await f.execute(third);
    expect(toolIds(f.modelBodies.at(-1)!).filter(id => id === 'original-read-call')).toHaveLength(1);
    expect((f.modelBodies.at(-1)!.messages as { role: string; tool_call_id?: string }[])
      .filter(message => message.role === 'tool' && message.tool_call_id === 'original-read-call')).toHaveLength(1);
    expect(f.runtime.memoryFor(f.identity.userId)!.foundation.history(first.sessionId).filter(message => message.role === 'user').map(message => message.content))
      .toEqual(['Earlier question', 'List events on 2026-11-03 from 10:00 to 11:00 Etc/UTC.', 'Follow up']);
    await f.saved(third);
    expect(await f.p.sessions.get(f.identity.userId, third.sessionId)).toMatchObject({ memoryPublication: { version: 3 } });
  } finally { pause.resume(); await run?.catch(() => undefined); vi.restoreAllMocks(); f.runtime.stopAccepting(); }
});

it('persists a partial active prefix before a read and resumes its exact pending decision without repeating inference', async () => {
  const f = await nativeFixture();
  const persist = vi.spyOn(f.p.metadata, 'putAttemptConfirmed').mockRejectedValueOnce(new AppError('PERSISTENCE_ERROR', 'Offline prefix'));
  const cal = f.runtime.d.calendar!;
  if (!isCalendarV2(cal)) throw new Error('Fixture requires Calendar v2');
  const account = vi.spyOn(cal.connection, 'currentAccount');
  f.modelWires.push(...readWires('partial-prefix-call'));
  try {
    const ids = await f.submit('List events on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    await f.execute(ids).catch(() => undefined);
    expect(f.status(ids)).toMatchObject({ error: { code: 'PERSISTENCE_ERROR' } });
    expect(account).not.toHaveBeenCalled();
    expect(f.effects).toEqual([]); expect(f.modelBodies).toHaveLength(2);
    const retry = await f.runtime.retryTurn({ identity: f.identity, sessionId: ids.sessionId,
      turnId: ids.turnId, idempotencyKey: 'retry-partial-prefix-only' });
    expect(retry.attemptId).toBe(ids.attemptId);
    await f.execute(retry);

    expect(f.status(ids)).toMatchObject({ status: 'completed', save: { state: 'saved' } });
    expect(f.effects.filter(effect => effect.kind === 'list')).toHaveLength(1);
    expect(f.modelBodies).toHaveLength(3);
    expect(toolIds(f.modelBodies.at(-1)!)).toContain('partial-prefix-call');
    expect((await f.p.messages.list(f.identity.userId, ids.sessionId, { cursor: null, limit: 50 })).items.filter(message => message.role === 'user'))
      .toHaveLength(1);
    expect(persist.mock.calls.length).toBeGreaterThanOrEqual(2);
  } finally { vi.restoreAllMocks(); f.runtime.stopAccepting(); }
});

it('times out a blocked prior write with no account calls and keeps its raw save pinned until same-decision resume', async () => {
  const f = await nativeFixture(undefined, 1, { writeTimeoutMs: 25 });
  const pause = f.db.pauseNextUpdate();
  const cal = f.runtime.d.calendar!;
  if (!isCalendarV2(cal)) throw new Error('Fixture requires Calendar v2');
  const account = vi.spyOn(cal.connection, 'currentAccount');
  f.modelWires.push(textWire('Answer with an unresolved save'), ...readWires('timeout-pending-call'));
  try {
    const first = await f.submit('Ordinary question'); await f.execute(first); await pause.started;
    const next = await f.submit('List events on 2026-11-03 from 10:00 to 11:00 Etc/UTC.', first.sessionId);
    await f.execute(next).catch(() => undefined);
    expect(f.status(next)?.error?.code).toBe('PERSISTENCE_ERROR');
    expect(account).not.toHaveBeenCalled(); expect(f.effects).toEqual([]); expect(f.modelBodies).toHaveLength(3);
    expect(f.runtime.memoryFor(f.identity.userId)!.foundation.snapshot()).toMatchObject({ unresolvedWrites: 1 });
    expect(f.runtime.memoryFor(f.identity.userId)!.foundation.session(first.sessionId)).toMatchObject({ durableVersion: 0, dirty: true });
    pause.resume(); await f.saved(first);
    const retry = await f.runtime.retryTurn({ identity: f.identity, sessionId: next.sessionId, turnId: next.turnId,
      idempotencyKey: 'resume-timeout-pending-call' });
    expect(retry.attemptId).toBe(next.attemptId); await f.execute(retry);
    expect(f.status(next)?.status).toBe('completed'); expect(f.modelBodies).toHaveLength(4);
    expect(f.effects.filter(effect => effect.kind === 'list')).toHaveLength(1);
    expect(toolIds(f.modelBodies.at(-1)!)).toContain('timeout-pending-call');
  } finally { pause.resume(); vi.restoreAllMocks(); f.runtime.stopAccepting(); }
});

it('promotes a create through the existing operation writer once and exposes its provenance to the next memory turn', async () => {
  const f = await nativeFixture();
  f.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] }, 'load-memory-create'),
    createWire(event(), 'original-memory-create'), textWire('I remember the scheduled event.'));
  try {
    const ids = await f.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    await f.execute(ids);
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(await f.operationFor(ids)).toMatchObject({ state: 'succeeded', originatingAttemptId: ids.attemptId,
      originatingTurnId: ids.turnId, originatingAcceptedMessageId: ids.userMessageId });
    expect(await f.p.skillResults.get(f.identity.userId, ids.sessionId, 'original-memory-create'))
      .toMatchObject({ attemptId: ids.attemptId, toolCallId: 'original-memory-create' });
    expect(f.status(ids)).toMatchObject({ status: 'completed', save: { state: 'saved', version: 1, durableVersion: 1 } });
    const messages = f.runtime.memoryFor(f.identity.userId)!.foundation.history(ids.sessionId);
    expect(messages.find(message => message.role === 'assistant')?.sourceProvenance?.length).toBeGreaterThan(0);
    const next = await f.submit('What did you schedule?', ids.sessionId); await f.execute(next);
    expect(f.modelBodies).toHaveLength(3);
    expect(toolIds(f.modelBodies.at(-1)!)).toContain('original-memory-create');
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    await f.saved(next);
  } finally { f.runtime.stopAccepting(); }
});

it.each([
  { answer: 'yes', reference: false, creates: 1 },
  { answer: 'yes', reference: true, creates: 1 },
  { answer: 'no', reference: false, creates: 0 },
])('answers a warm pending proposal with zero model calls ($answer, reference=$reference)', async ({ answer, reference, creates }) => {
  const f = await nativeFixture();
  f.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] }, 'load-proposal'),
    createWire(event(), 'proposal-original-call'));
  try {
    const first = await f.submit('create the event'); await f.execute(first);
    const proposal = await f.currentProposal(first.sessionId);
    expect(proposal).toMatchObject({ state: 'pending', purpose: 'details' });
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
    const reply = await f.runtime.submitTurn({ identity: f.identity, sessionId: first.sessionId, content: answer,
      idempotencyKey: `memory-proposal-${answer}-${reference}`, ...(reference ? {
        calendarReplyTo: { proposalId: proposal!.proposalId, revision: proposal!.revision },
      } : {}) });
    await f.execute(reply);
    expect(f.modelBodies).toHaveLength(2);
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(creates);
    expect(await f.currentProposal(first.sessionId)).toBeNull();
    expect(f.status(reply)).toMatchObject({ status: 'completed', save: { state: 'saved', version: 2, durableVersion: 2 } });
    const budget = await f.p.calendarAccountingV2.getBudget(f.identity.userId, reply.sessionId, reply.turnId);
    expect(budget?.modelDispatches ?? 0).toBe(0);
  } finally { f.runtime.stopAccepting(); }
});

it('cold-hydrates promoted Calendar history then tombstones source content when its clock expires', async () => {
  const f = await nativeFixture();
  f.modelWires.push(...readWires('cold-promoted-call'), textWire('Cold ordinary follow-up'), textWire('Expired ordinary follow-up'));
  let cold: DurableChatRuntime | undefined;
  try {
    const first = await f.submit('List events on 2026-11-03 from 10:00 to 11:00 Etc/UTC.'); await f.execute(first);
    expect(f.status(first)).toMatchObject({ status: 'completed', save: { state: 'saved' } });
    expect(await f.runtime.drain(100)).toMatchObject({ drained: true });
    cold = new DurableChatRuntime(f.runtime.d);
    const execute = (ids: SubmitTurnResponse) => cold!.executeTurn({ userId: f.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async () => {}, emitCalendar: async () => {} });
    const second = await cold.submitTurn({ identity: f.identity, sessionId: first.sessionId,
      content: 'Follow up', idempotencyKey: 'cold-promoted-follow-up' });
    await execute(second);
    expect(cold.memoryFor(f.identity.userId)!.status(f.identity.userId, second.sessionId, second.turnId)?.status).toBe('completed');
    expect(toolIds(f.modelBodies[3]!)).toContain('cold-promoted-call');
    await vi.waitFor(() => expect(cold!.memoryFor(f.identity.userId)!.status(f.identity.userId, second.sessionId, second.turnId)?.save?.state).toBe('saved'));
    const sources = cold.memoryFor(f.identity.userId)!.foundation.history(first.sessionId).flatMap(message => message.sourceProvenance ?? []);
    expect(sources.length).toBeGreaterThan(0);
    const firstAnswer = cold.memoryFor(f.identity.userId)!.foundation.history(first.sessionId)
      .find(message => message.turnId === first.turnId && message.role === 'assistant')?.content;
    expect(firstAnswer).toBeTruthy();
    expect(firstAnswer).not.toBe(CALENDAR_TOMBSTONE);
    f.advance(Math.max(...sources.map(source => Date.parse(source.expiresAt))) - f.clock() + 1);
    expect(cold.memoryFor(f.identity.userId)!.foundation.history(first.sessionId).find(message => message.turnId === first.turnId && message.role === 'assistant')?.content)
      .toBe(firstAnswer);
    const third = await cold.submitTurn({ identity: f.identity, sessionId: first.sessionId,
      content: 'What remains?', idempotencyKey: 'expired-promoted-follow-up' });
    await execute(third);
    const prompt = JSON.stringify(f.modelBodies.at(-1)!.messages);
    expect(prompt).toContain(firstAnswer);
    expect(prompt).toMatch(/do not recant/i);
    expect(prompt).not.toContain(CALENDAR_TOMBSTONE);
    expect(prompt).not.toContain('"tool_call_id":"cold-promoted-call"');
    expect(f.effects.filter(effect => effect.kind === 'list')).toHaveLength(1);
  } finally { cold?.stopAccepting(); f.runtime.stopAccepting(); }
});

it('cold-hydrates a pending proposal and accepts its referenced reply without inference', async () => {
  const f = await nativeFixture();
  f.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] }, 'load-cold-proposal'),
    createWire(event(), 'cold-proposal-call'));
  let cold: DurableChatRuntime | undefined;
  try {
    const first = await f.submit('create the event'); await f.execute(first);
    const proposal = await f.currentProposal(first.sessionId);
    expect(proposal).toMatchObject({ state: 'pending' });
    await f.runtime.drain(100); cold = new DurableChatRuntime(f.runtime.d);
    const reply = await cold.submitTurn({ identity: f.identity, sessionId: first.sessionId, content: 'yes',
      idempotencyKey: 'cold-pending-reply', calendarReplyTo: { proposalId: proposal!.proposalId, revision: proposal!.revision } });
    await cold.executeTurn({ userId: f.identity.userId, ...reply, signal: new AbortController().signal,
      emit: async () => {}, emitCalendar: async () => {} });
    expect(f.modelBodies).toHaveLength(2);
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(cold.memoryFor(f.identity.userId)!.status(f.identity.userId, reply.sessionId, reply.turnId)?.status).toBe('completed');
  } finally { cold?.stopAccepting(); f.runtime.stopAccepting(); }
});

it('reconciles the original event after provider create succeeds and receipt persistence fails', async () => {
  const f = await nativeFixture();
  f.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] }, 'load-crash-create'),
    createWire(event(), 'crash-create-call'), textWire('The original event is safely recovered.'));
  try {
    const ids = await f.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    f.failOnce('receipt-save'); await f.execute(ids).catch(() => undefined);
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    const before = await f.operationFor(ids);
    expect(['dispatching', 'unknown']).toContain(before?.state);
    await f.runtime.reconcileSession(f.identity.userId, ids.sessionId);
    expect(await f.operationFor(ids)).toMatchObject({ state: 'succeeded', googleEventId: before!.googleEventId });
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(f.effects.filter(effect => effect.kind === 'readback').map(effect => effect.eventId)).toEqual([before!.googleEventId]);
    expect(f.modelBodies).toHaveLength(2);
    const next = await f.submit('What happened to that event?', ids.sessionId); await f.execute(next);
    expect(f.status(next)?.status).toBe('completed'); expect(f.modelBodies).toHaveLength(3);
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(f.effects.filter(effect => effect.kind === 'readback')).toHaveLength(1);
  } finally { f.runtime.stopAccepting(); }
});

it('recovers a sealed promoted create after assistant publication fails without replaying the model or effect', async () => {
  const f = await nativeFixture();
  const append = f.p.messages.appendConfirmed.bind(f.p.messages);
  let rejectAssistant = true;
  vi.spyOn(f.p.messages, 'appendConfirmed').mockImplementation(async record => {
    if (record.role === 'assistant' && rejectAssistant) {
      rejectAssistant = false;
      throw new AppError('PERSISTENCE_ERROR', 'Offline assistant publication');
    }
    return append(record);
  });
  f.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] }, 'load-sealed-create'),
    createWire(event(), 'sealed-create-call'), textWire('The saved Calendar result is available.'));
  try {
    const ids = await f.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    await f.execute(ids).catch(() => undefined);
    expect(f.status(ids)?.status).not.toBe('completed');
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(f.modelBodies).toHaveLength(2);
    const original = await f.operationFor(ids);
    expect(original).toMatchObject({ state: 'succeeded' });
    await f.runtime.reconcileSession(f.identity.userId, ids.sessionId);
    expect(await f.operationFor(ids)).toMatchObject({ state: 'succeeded', googleEventId: original!.googleEventId });
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(1); expect(f.modelBodies).toHaveLength(2);
    const next = await f.submit('Continue after the recovered publication', ids.sessionId); await f.execute(next);
    expect(f.status(next)?.status).toBe('completed'); expect(f.modelBodies).toHaveLength(3);
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
  } finally { vi.restoreAllMocks(); f.runtime.stopAccepting(); }
});

it.each(['disconnect', 'disable'] as const)('refuses external execution when %s races the promotion flush', async reason => {
  const f = await nativeFixture();
  const pause = f.db.pauseNextUpdate();
  f.modelWires.push(textWire('Dirty answer'), ...readWires('invalidated-before-promotion'));
  let run: Promise<void> | undefined;
  try {
    const first = await f.submit('Ordinary question'); await f.execute(first); await pause.started;
    const next = await f.submit('List events on 2026-11-03 from 10:00 to 11:00 Etc/UTC.', first.sessionId);
    run = f.execute(next);
    await vi.waitFor(() => expect(f.modelBodies).toHaveLength(3));
    const connection = (await f.p.calendarConnectionsV2.get(f.identity.userId))!;
    const account = { userId: connection.userId, connectionId: connection.connectionId,
      connectionRevision: connection.connectionRevision, googleSubjectId: connection.googleSubjectId };
    if (reason === 'disable') {
      const snapshot = f.runtime.d.currentConfig!.current()!;
      f.publish({ ...snapshot, revision: snapshot.revision + 1, calendar: { ...snapshot.calendar!, enabled: false } });
    } else await f.p.calendarConnectionsV2.compareAndSwap({ userId: f.identity.userId, expectedRevision: connection.revision,
      expectedConnectionRevision: connection.connectionRevision, expectedDefaultSettingRevision: connection.defaultSetting.defaultSettingRevision,
      next: { ...connection, revision: connection.revision + 1, connectionRevision: connection.connectionRevision + 1,
        credentialVersion: connection.credentialVersion + 1,
        enabled: false, status: 'disconnected', credentials: null, tokenExpiresAt: null, discovery: null } });
    f.runtime.invalidateCalendarAccount(account, reason === 'disable' ? 'disabled' : 'disconnected');
    pause.resume(); await run.catch(() => undefined);
    expect(f.effects).toEqual([]); expect(f.modelBodies).toHaveLength(3);
    expect(f.status(next)?.status).not.toBe('completed');
  } finally { pause.resume(); await run?.catch(() => undefined); f.runtime.stopAccepting(); }
});

it('releases a persisted active prefix when account invalidation races its live binding and saves a later ordinary turn', async () => {
  const f = await nativeFixture();
  const cal = f.runtime.d.calendar!;
  if (!isCalendarV2(cal)) throw new Error('Fixture requires Calendar v2');
  const current = cal.connection.currentAccount.bind(cal.connection);
  const account = vi.spyOn(cal.connection, 'currentAccount').mockImplementationOnce(async () => {
    const binding = await current();
    f.runtime.invalidateCalendarAccount(binding, 'disconnect');
    return binding;
  });
  f.modelWires.push(...readWires('binding-invalidation-call').slice(0, 2), textWire('An ordinary answer after invalidation.'));
  try {
    const ids = await f.submit('List events on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    await f.execute(ids).catch(() => undefined);
    expect(account).toHaveBeenCalledOnce(); expect(f.effects).toEqual([]); expect(f.modelBodies).toHaveLength(2);
    expect(f.status(ids)?.status).not.toBe('completed');
    account.mockRestore();
    const next = await f.submit('Explain an unrelated topic', ids.sessionId); await f.execute(next);
    expect(f.status(next)?.status).toBe('completed'); expect(f.modelBodies).toHaveLength(3);
    await f.saved(next);
    expect(f.runtime.memoryFor(f.identity.userId)!.foundation.session(ids.sessionId)).toMatchObject({ dirty: false });
    expect(f.effects).toEqual([]);
  } finally { vi.restoreAllMocks(); f.runtime.stopAccepting(); }
});

it.each(['disconnect', 'revoke', 'disable'] as const)('real AppService composition admits new and warm chat with Mongo/account blocked and forwards %s invalidation', async lifecycle => {
  const native = await nativeFixture();
  const seed = document(1); seed.settings.openRouter.modelId = 'fixture/model';
  const config = assemblyFixture(seed);
  await config.repository.compareAndSwap(1, { ...seed, revision: 2, credentials: {
    ...seed.credentials, openrouter: { envelope: config.credentials.seal('openrouter', secret), validatedAt: at },
  } });
  config.ports.calendarConfig = {
    setup: parseCalendarSetupOptions({ initial: { enabled: true, processingPolicyId: 'fixture-policy' },
      oauth: { clientId: 'fixture-client-id', clientSecret: 'fixture-client-secret',
        redirectUri: 'http://localhost:3000/api/plugins/google-calendar/oauth/callback' },
      frontendOrigin: 'http://localhost:5173', backendOrigin: 'http://localhost:3000',
      evidence: 'fixture', realDataPolicyApproved: true }),
    permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
    policyDeadlines: [Date.parse('2099-01-01T00:00:00.000Z')], trustedTimeZone: 'Etc/UTC',
  };
  config.bootstrap.calendar = config.ports.calendarConfig;
  config.ports.open = vi.fn(async () => ({ ...native.p, ping: async () => true, close: async () => {} })) as never;
  const runtime = vi.fn((dependencies: RuntimeDependencies) => new DurableChatRuntime({ ...dependencies,
    now: native.clock, memoryFirst: { ...dependencies.memoryFirst!, policy: { ...dependencies.memoryFirst!.policy, shutdownDrainMs: 30 },
      save: async () => ({ kind: 'unknown', retryable: false }) } }));
  config.ports.runtime = runtime; config.ports.limits = vi.fn(async () => calendarLimits);
  config.ports.fetcher = native.fetcher;
  const service = await AppService.create(config.bootstrap, config.ports);
  const raw = runtime.mock.results[0]!.value;
  await service.calendarFor(native.identity.userId).connections.statusV2();
  const blocked = () => { throw new Error('Mongo/account access blocked in production conversation'); };
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  for (const port of new Set(Object.values(native.p).filter(value => value && typeof value === 'object'))) {
    const names = new Set([...Object.keys(port), ...Object.getOwnPropertyNames(Object.getPrototypeOf(port))]);
    for (const name of names) if (name !== 'constructor' && typeof port[name] === 'function')
      spies.push(vi.spyOn(port, name).mockImplementation(blocked));
  }
  const cal = raw.d.calendarFor!(native.identity.userId);
  if (!isCalendarV2(cal)) throw new Error('AppService must install Calendar v2');
  spies.push(vi.spyOn(cal.connection, 'currentAccount').mockImplementation(blocked));
  spies.push(vi.spyOn(cal.connection, 'requireAccountCurrent').mockImplementation(blocked));
  const frames: StreamEnvelope[] = [];
  native.modelWires.push(textWire('First assembled answer'), textWire('Second assembled answer'));
  try {
    expect(raw.memoryFor(native.identity.userId, true)!.eligible()).toBe(true);
    const first = await service.operations.runtime.submitTurn({ identity: native.identity, sessionId: null,
      content: 'First assembled question', idempotencyKey: 'app-calendar-first' });
    const execute = (ids: SubmitTurnResponse) => service.operations.runtime.executeTurn({ userId: native.identity.userId,
      ...ids, signal: new AbortController().signal, emit: async frame => { frames.push(frame); } });
    await execute(first);
    expect(frames.some(frame => frame.event.type === 'delta')).toBe(true);
    expect(frames.at(-1)?.event.type).toBe('completed');
    const second = await service.operations.runtime.submitTurn({ identity: native.identity, sessionId: first.sessionId,
      content: 'Second assembled question', idempotencyKey: 'app-calendar-second' });
    await execute(second);
    expect(runtime).toHaveBeenCalledOnce(); expect(native.modelBodies).toHaveLength(2);
    for (const body of native.modelBodies) {
      expect(body.user).toBe(native.identity.userId);
      expect(body.tools).toEqual(SKILL_NATIVE_TOOLS.map(tool => ({ type: 'function', function: {
        name: tool.name, description: tool.description, parameters: tool.inputSchema,
      } })));
    }
    expect(raw.memoryFor(native.identity.userId)!.foundation.snapshot().sessions).toBe(1);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
    const invalidate = vi.spyOn(raw, 'invalidateCalendarAccount');
    if (lifecycle === 'disable') await service.calendarFor(native.identity.userId).connections.settings({ enabled: false }, new AbortController().signal);
    else await service.calendarFor(native.identity.userId).connections.disconnect(lifecycle === 'revoke'
      ? { mode: 'revoke-google-grant', acknowledgeProjectWideRevocation: true } : { mode: 'local' }, new AbortController().signal);
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ userId: native.identity.userId,
      connectionId: 'conn-aurvin-dev', connectionRevision: 1 }), lifecycle === 'disable' ? 'disabled' : 'disconnect');
  } finally {
    vi.restoreAllMocks(); await service.operations.shutdown(); native.runtime.stopAccepting();
  }
});

it('immediately redacts warm source messages and historical groups after account invalidation', async () => {
  const f = await nativeFixture();
  f.modelWires.push(...readWires('redacted-warm-call'), textWire('Ordinary answer after disconnect'));
  try {
    const first = await f.submit('List events on 2026-11-03 from 10:00 to 11:00 Etc/UTC.'); await f.execute(first);
    const conn = (await f.p.calendarConnectionsV2.get(f.identity.userId))!;
    const account = { userId: conn.userId, connectionId: conn.connectionId,
      connectionRevision: conn.connectionRevision, googleSubjectId: conn.googleSubjectId };
    expect(f.runtime.memoryFor(f.identity.userId)!.foundation.history(first.sessionId).some(message => message.sourceProvenance?.length)).toBe(true);
    const firstAnswer = f.runtime.memoryFor(f.identity.userId)!.foundation.history(first.sessionId)
      .find(message => message.role === 'assistant')?.content;
    expect(firstAnswer).toBeTruthy();
    expect(firstAnswer).not.toBe(CALENDAR_TOMBSTONE);
    f.runtime.invalidateCalendarAccount(account, 'disconnect');
    expect(f.runtime.memoryFor(f.identity.userId)!.foundation.history(first.sessionId).find(message => message.role === 'assistant')?.content)
      .toBe(firstAnswer);
    const second = await f.submit('Explain something unrelated', first.sessionId); await f.execute(second);
    expect(f.status(second)?.status).toBe('completed');
    const prompt = JSON.stringify(f.modelBodies.at(-1)!.messages);
    expect(prompt).toContain(firstAnswer);
    expect(prompt).toMatch(/do not recant/i);
    expect(prompt).not.toContain(CALENDAR_TOMBSTONE);
    expect(f.effects.filter(effect => effect.kind === 'list')).toHaveLength(1);
  } finally { f.runtime.stopAccepting(); }
});

it('purges a cached pending proposal when its account is invalidated before a later reply', async () => {
  const f = await nativeFixture();
  f.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] }, 'load-invalidated-proposal'),
    createWire(event(), 'invalidated-proposal-call'), textWire('There is no active scheduling request.'));
  try {
    const first = await f.submit('create the event'); await f.execute(first);
    expect(await f.currentProposal(first.sessionId)).toMatchObject({ state: 'pending' });
    const conn = (await f.p.calendarConnectionsV2.get(f.identity.userId))!;
    const firstAnswer = f.runtime.memoryFor(f.identity.userId)!.foundation.history(first.sessionId)
      .find(message => message.role === 'assistant')?.content;
    expect(firstAnswer).toBeTruthy();
    expect(firstAnswer).not.toBe(CALENDAR_TOMBSTONE);
    f.runtime.invalidateCalendarAccount({ userId: conn.userId, connectionId: conn.connectionId,
      connectionRevision: conn.connectionRevision, googleSubjectId: conn.googleSubjectId }, 'disconnect');
    expect(f.runtime.memoryFor(f.identity.userId)!.foundation.history(first.sessionId).find(message => message.role === 'assistant')?.content)
      .toBe(firstAnswer);
    const cal = f.runtime.d.calendar!;
    if (!isCalendarV2(cal)) throw new Error('Fixture requires Calendar v2');
    const account = vi.spyOn(cal.connection, 'currentAccount');
    const reply = await f.submit('yes', first.sessionId); await f.execute(reply);
    expect(f.status(reply)?.status).toBe('completed'); expect(f.modelBodies).toHaveLength(3);
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
    expect(account).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); f.runtime.stopAccepting(); }
});

it('keeps an unrelated reply conversational and leaves a known pending proposal unchanged', async () => {
  const f = await nativeFixture();
  f.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] }, 'load-unrelated-proposal'),
    createWire(event(), 'unrelated-proposal-call'), textWire('An ordinary unrelated answer.'));
  try {
    const first = await f.submit('create the event'); await f.execute(first);
    const proposal = await f.currentProposal(first.sessionId);
    expect(proposal).not.toBeNull();
    const second = await f.submit('Explain why the sky is blue', first.sessionId); await f.execute(second);
    expect(f.status(second)?.status).toBe('completed'); expect(f.modelBodies).toHaveLength(3);
    expect(await f.currentProposal(first.sessionId)).toMatchObject({ proposalId: proposal!.proposalId, revision: proposal!.revision, state: 'pending' });
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
  } finally { f.runtime.stopAccepting(); }
});

it('expires a cached proposal before inference and never creates the event from an old approval', async () => {
  const f = await nativeFixture();
  f.modelWires.push(skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] }, 'load-expiring-proposal'),
    createWire(event(), 'expiring-proposal-call'));
  try {
    const first = await f.submit('create the event'); await f.execute(first);
    const proposal = await f.currentProposal(first.sessionId);
    expect(proposal).not.toBeNull();
    f.advance(Date.parse(proposal!.expiresAt) - f.clock() + 1);
    const reply = await f.submit('yes', first.sessionId); await f.execute(reply);
    expect(f.status(reply)?.status).toBe('completed'); expect(f.modelBodies).toHaveLength(2);
    expect(f.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
    expect(await f.currentProposal(first.sessionId)).toBeNull();
    expect(f.runtime.memoryFor(f.identity.userId)!.foundation.history(first.sessionId).filter(message => message.role === 'assistant').at(-1)?.content)
      .toContain('expired');
  } finally { f.runtime.stopAccepting(); }
});

it('shares turn-wide native model and repair budgets across an explicit generation retry', async () => {
  const f = calendarFixture(undefined, undefined, { policy: PROPOSED_MEMORY_TEXT_POLICY,
    save: async () => ({ kind: 'unknown', retryable: false }) });
  await f.ready;
  f.modelWires.push(skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_list_calendars', arguments: {} }, 'retry-unloaded'),
    skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_list_calendars'] }, 'retry-loaded'),
    brokenTextWire(), textWire('Retry completed.'));
  try {
    const first = await f.submit('Ordinary question'); await f.execute(first);
    const memory = f.runtime.memoryFor(f.identity.userId)!, before = memory.foundation.result(memory.find(first.sessionId, first.turnId)!.turn)!.calendar!;
    expect(memory.status(f.identity.userId, first.sessionId, first.turnId)?.status).toBe('failed');
    expect(before.budget).toMatchObject({ modelDispatches: 3, repairs: 1 });
    const retry = await f.runtime.retryTurn({ identity: f.identity, sessionId: first.sessionId, turnId: first.turnId,
      idempotencyKey: 'retry-shares-native-budget' });
    expect(retry.attemptId).not.toBe(first.attemptId); await f.execute(retry);
    expect(memory.find(retry.sessionId, retry.turnId)?.error).toBeNull();
    const after = memory.foundation.result(memory.find(retry.sessionId, retry.turnId)!.turn)!.calendar!;
    expect(after.budget).toMatchObject({ modelDispatches: 4, repairs: 1, deadlineAt: before.budget.deadlineAt });
    expect(after.dispatches[0]!.dispatchIndex).toBe(4);
    const body = f.modelBodies.at(-1)!;
    expect((body.messages as { role: string; content: string }[]).filter(message => message.role === 'user' && message.content === 'Ordinary question'))
      .toHaveLength(1);
    expect(f.effects).toEqual([]);
  } finally { f.runtime.stopAccepting(); }
});

it('preserves dirty text then voice hearing and Canvas projections through Calendar promotion in the same foundation', async () => {
  const f = await nativeFixture();
  const pause = f.db.pauseNextUpdate();
  const voiceOutput = 'Voice note.\n\n```mermaid title="Calendar flow"\nflowchart TD\nA --> B\n```';
  f.modelWires.push(textWire('Text answer'), textWire(voiceOutput), ...readWires('cross-mode-read'));
  let delivery!: VoiceDelivery, spoken = '', run: Promise<void> | undefined;
  try {
    const first = await f.submit('Text question'); await f.execute(first); await pause.started;
    const reservation = await f.runtime.reservations.acquire({ identity: f.identity, conversationId: first.sessionId,
      owner: { kind: 'live', voiceSessionId: 'calendar-memory-voice' } });
    const voice = await f.runtime.submitLiveTurn({ identity: f.identity, sessionId: first.sessionId,
      content: 'Voice question', idempotencyKey: 'calendar-cross-mode-voice', reservation,
      configSnapshot: f.runtime.d.currentConfig!.current()!,
      voice: { voiceSessionId: 'calendar-memory-voice', socketEpoch: 1, providerTurnId: 'calendar-provider-voice' } });
    await f.runtime.executeTurn({ userId: f.identity.userId, ...voice, signal: new AbortController().signal,
      emit: async () => {}, emitCalendar: async () => {}, live: { reservation,
        start: async (attempt, write) => {
          delivery = new VoiceDelivery({ ...deliveryFixture(), userId: attempt.userId, sessionId: first.sessionId,
            turnId: attempt.turnId, attemptId: attempt.attemptId, voiceSessionId: 'calendar-memory-voice',
            responseId: key('voice-response', attempt.userId, first.sessionId, attempt.attemptId),
            status: 'pending', textGenerated: '', textSpoken: null, textRemaining: null,
            audioDurationMs: null, audioPlayedMs: null, playedSamples: null }, 0, write,
          { speak: async chunk => { spoken += chunk.text; }, flush: async () => {} }, 20);
          await delivery.start();
        }, delta: text => delivery.delta(text), finish: () => delivery.finish(),
        artifact: artifact => delivery.artifact(artifact), settle: async text => {
          const record = delivery.current();
          await delivery.event({ type: 'speech-completed', turnId: record.turnId, responseId: record.responseId,
            speechId: 'calendar-voice-speech', audioDurationMs: 100, audioSamples: 2400,
            usage: { providerRequestId: null, model: 'fixture', modelVersion: null, audioMs: 100, billableCharacters: text.length } });
          await delivery.playback(2400); await delivery.settle(text);
        } } });
    expect(f.status(voice)?.status).toBe('completed');
    expect(spoken).toContain('Voice note.'); expect(spoken).not.toContain('flowchart');
    expect(await f.runtime.getLiveDelivery(f.identity.userId, first.sessionId, voice.attemptId, reservation))
      .toMatchObject({ textSpoken: 'Voice note.', canvasArtifacts: [expect.objectContaining({ kind: 'mermaid' })] });
    await f.runtime.reservations.release({ identity: f.identity, reservationId: reservation.reservationId });
    const calendar = await f.submit('List events on 2026-11-03 from 10:00 to 11:00 Etc/UTC.', first.sessionId);
    run = f.execute(calendar);
    await vi.waitFor(() => expect(f.modelBodies).toHaveLength(4));
    expect(f.effects).toEqual([]); pause.resume(); await run;
    expect(f.status(calendar)).toMatchObject({ status: 'completed', save: { state: 'saved', version: 3, durableVersion: 3 } });
    expect(f.runtime.memoryFor(f.identity.userId)!.foundation.history(first.sessionId).filter(message => message.role === 'user').map(message => message.content))
      .toEqual(['Text question', 'Voice question', 'List events on 2026-11-03 from 10:00 to 11:00 Etc/UTC.']);
    const savedDelivery = await f.p.metadata.getVoiceDelivery(f.identity.userId, first.sessionId, voice.attemptId);
    expect(savedDelivery).toMatchObject({ textSpoken: 'Voice note.', canvasArtifacts: [expect.objectContaining({ kind: 'mermaid' })] });
    expect(JSON.stringify(f.modelBodies.at(-1)!.messages)).toContain('Voice note.');
    expect(f.effects.filter(effect => effect.kind === 'list')).toHaveLength(1);
  } finally { pause.resume(); await run?.catch(() => undefined); f.runtime.stopAccepting(); }
});
