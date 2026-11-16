/**
 * ============================================================================
 * FILE: memory-calendar-state.spec.ts
 * LOCATION: backend/test/performance/memory-calendar-state.spec.ts
 * ============================================================================
 * PURPOSE: Verify volatile native accounting, bounded pairs and archive visibility.
 * ROLE IN PROJECT: Deterministic foundation checks independent of runtime routing.
 * KEY COMPONENTS: Real provider adapter, shared memory, partial publication reader.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { MemoryCalendarLedger } from '../../src/chat-runtime/memory-calendar-ledger.js';
import { MemoryCalendarStage, memoryCalendarStateSchema, memoryCalendarRecordSchema }
  from '../../src/chat-runtime/memory-calendar-state.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';
import { createCalendarModelPortV2 } from '../../src/model/calendar-adapter.js';
import { fixturePricing, calendarLimits, skillRequest } from '../model/calendar-fixtures.js';
import { config } from '../model/helpers.js';
import { textWire } from '../runtime/calendar-runtime.fixture.js';
import { localSkillResultRecordSchema } from '../../src/contracts/calendar-sources.js';
import { resumableSkillDecisionSchema } from '../../src/contracts/calendar-model.js';
import { MemoryFirstFoundation } from '../../src/chat-runtime/memory-first-foundation.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from '../../src/chat-runtime/memory-text.js';
import { assets, ports, environment } from '../context/fixtures.js';
import { readMemoryCalendarStates } from '../../src/persistence/memory-calendar-reader.js';
import type { PersistenceBundle } from '../../src/persistence/persistence.js';
import type { SessionRecord } from '../../src/contracts/session.js';
import { activateLocalSkill } from '../../src/chat-runtime/calendar-skills.js';
import { estimateCalendarInput } from '../../src/model/calendar-policy.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MemoryTextArchive } from '../../src/persistence/memory-text-archive.js';
import type { MongoClient } from 'mongodb';
import { messageRecordSchema } from '../../src/contracts/message.js';
import { emptyCalendarObservation, mergeCalendarObservation } from '../../src/model/calendar-usage.js';
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { calendarContext } from '../../src/context/calendar-context.js';
import { key } from '../../src/persistence/records.js';
import { calendarHistory } from '../../src/chat-runtime/calendar-history.js';

function ledger(overrides: Partial<ConstructorParameters<typeof MemoryCalendarLedger>[0]> = {}) {
  const c = config(), now = Date.now();
  return new MemoryCalendarLedger({ identity: { userId: c.identity.userId, sessionId: 'session-native',
    turnId: 'turn-native', attemptId: 'attempt-native', openRouterUser: c.identity.userId,
    createdAt: new Date(now).toISOString(), deadlineAt: new Date(now + 30000).toISOString() },
    clock: () => now, limits: CALENDAR_LIMITS, modelId: 'fixture/model', pricing: fixturePricing,
    configRevision: 1, maxOutputTokens: 256, processingPolicyId: 'fixture-policy',
    job: { check() {}, signal: new AbortController().signal, wait: promise => promise }, ...overrides });
}

async function localState(l = ledger()) {
  const dispatch = await l.reserveDispatch('initial', { estimatedInputTokens: 100 }, null);
  const stage = new MemoryCalendarStage(32768, 8);
  const envelope = { plugin: 'google-calendar', tools: ['calendar_list_calendars'] };
  const decision = resumableSkillDecisionSchema.parse({ schemaVersion: 3, kind: 'calendar-model-decision',
    protocolVersion: 'plugin-skills.v1', userId: dispatch.userId, sessionId: dispatch.sessionId,
    turnId: dispatch.turnId, attemptId: dispatch.attemptId, decisionId: dispatch.decisionId,
    dispatchId: dispatch.dispatchId, configRevision: 1, connectionId: 'memory-unbound', connectionRevision: 1,
    schemaRevision: 'google-calendar.v2', rejectedDecisionId: null, sources: [], operationId: null,
    intentId: null, proposalId: null, createdAt: dispatch.startedAt,
    decision: { kind: 'activate_skill', decisionId: dispatch.decisionId, assistantContent: null,
      nativeCall: { id: 'native-call', type: 'function', function: { name: 'activate_skill', arguments: JSON.stringify(envelope) } },
      envelope, terminal: 'tool_calls' } });
  stage.putDecision(decision);
  const result = localSkillResultRecordSchema.parse({ schemaVersion: 3, kind: 'calendar-tool-result',
    protocolVersion: 'plugin-skills.v1', userId: dispatch.userId, sessionId: dispatch.sessionId,
    turnId: dispatch.turnId, attemptId: dispatch.attemptId, decisionId: dispatch.decisionId,
    eventId: 'native-result-event', sequence: 0, toolCallId: 'native-call', createdAt: dispatch.startedAt,
    resultRef: { storage: 'local', toolCallId: 'native-call', content: JSON.stringify(activateLocalSkill(
      { plugin: 'google-calendar', tools: ['calendar_list_calendars'] }, new Map(), 16384)) } });
  stage.putResult(result);
  await l.finishDispatch(dispatch.dispatchId, null); await l.aggregate();
  return { state: memoryCalendarStateSchema.parse({ ...l.freeze(), ...stage.records() }), stage, decision, result };
}

it('dispatches the actual native adapter with volatile accounting and no persistence port', async () => {
  const l = ledger(), request = skillRequest(), dispatch = await l.reserveDispatch('initial', {
    estimatedInputTokens: estimateCalendarInput(request.messages, SKILL_NATIVE_TOOLS) }, null);
  const binding = await l.bindingFor(dispatch);
  const fetcher = vi.fn<typeof fetch>(async () => new Response(textWire('Native ordinary answer'), {
    headers: { 'content-type': 'text/event-stream' },
  }));
  const adapter = createCalendarModelPortV2(config(), calendarLimits, binding, fetcher);
  const chunks = [];
  for await (const chunk of adapter.stream({ ...request, dispatchId: dispatch.dispatchId,
    decisionId: dispatch.decisionId, deadlineAt: l.deadlineAt(), tools: SKILL_NATIVE_TOOLS })) chunks.push(chunk);
  expect(chunks, JSON.stringify(chunks)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text-delta' })]));
  expect(chunks.find(chunk => chunk.type === 'decision')).toMatchObject({ decision: { kind: 'text', content: 'Native ordinary answer' } });
  const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
  expect(body.tools).toEqual(SKILL_NATIVE_TOOLS.map(tool => ({ type: 'function', function: {
    name: tool.name, description: tool.description, parameters: tool.inputSchema,
  } })));
  expect(body.user).toBe(config().identity.userId);
  await l.finishDispatch(dispatch.dispatchId, null);
  const aggregate = await l.aggregate();
  expect(aggregate.costStatus).not.toBe('known');
  expect(l.freeze()).toMatchObject({ storage: 'volatile', dispatches: [{ status: 'terminal' }] });
  await expect(binding.hooks.beforeDispatch()).rejects.toThrow(/frozen/);
});

it('reserves finite paid dispatch budgets, attribution and stable IDs before work', async () => {
  const l = ledger({ limits: { ...CALENDAR_LIMITS, modelDispatches: 1 } });
  const d = await l.reserveDispatch('initial', { estimatedInputTokens: 100 }, null);
  const binding = await l.bindingFor(d);
  await binding.hooks.beforeDispatch();
  await expect(binding.hooks.beforeDispatch()).rejects.toThrow(/already/);
  await expect(l.reserveDispatch('continuation', { estimatedInputTokens: 100 }, null)).rejects.toThrow(/exhausted/);
  expect(l.snapshot().dispatches).toHaveLength(1);
  expect(l.snapshot().budget.modelDispatches).toBe(1);
  expect(d.openRouterUser).toBe(config().identity.userId);
  const original = ledger();
  const same = await original.reserveDispatch('initial', { estimatedInputTokens: 100 }, null);
  expect(same.dispatchId).toBe(d.dispatchId);
  const identity = { userId: config().identity.userId, sessionId: 'session-native', turnId: 'turn-native',
    attemptId: 'attempt-retry', openRouterUser: config().identity.userId,
    createdAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 30000).toISOString() };
  const retry = await ledger({ identity }).reserveDispatch('initial', { estimatedInputTokens: 100 }, null);
  expect(retry.dispatchId).not.toBe(d.dispatchId);
  expect(retry.decisionId).not.toBe(d.decisionId);
});

it('seeds retry budgets without forgetting earlier attempts money or dispatch indexes', async () => {
  const original = ledger();
  const first = await original.reserveDispatch('initial', { estimatedInputTokens: 100 }, null);
  await original.observe(first.dispatchId, mergeCalendarObservation(emptyCalendarObservation(), {
    id: 'prior-generation', usage: { prompt_tokens: 100, completion_tokens: 20, cost: '0.001' } }));
  await original.finishDispatch(first.dispatchId, null);
  const seed = original.snapshot().budget;
  const retry = ledger({ initialBudget: seed });
  const second = await retry.reserveDispatch('initial', { estimatedInputTokens: 100 }, null);
  expect(second.dispatchIndex).toBe(2);
  await retry.observe(second.dispatchId, mergeCalendarObservation(emptyCalendarObservation(), {
    id: 'next-generation', usage: { prompt_tokens: 100, completion_tokens: 20, cost: '0.002' } }));
  expect(retry.snapshot().budget).toMatchObject({ modelDispatches: 2, settledUsd: '0.003', reservedUsd: '0',
    deadlineAt: seed.deadlineAt });
  await retry.finishDispatch(second.dispatchId, null); await retry.aggregate();
  expect(memoryCalendarStateSchema.safeParse({ ...retry.freeze(), decisions: [], rejected: [], results: [] }).success).toBe(true);
  const exhausted = ledger({ initialBudget: { ...seed, modelDispatches: CALENDAR_LIMITS.modelDispatches } });
  await expect(exhausted.reserveDispatch('initial', { estimatedInputTokens: 100 }, null)).rejects.toThrow(/exhausted/);
});

it('rebinds a retained decision ledger to the resumed execution job', async () => {
  const old = vi.fn(), current = vi.fn();
  const l = ledger({ job: { check: old, signal: new AbortController().signal, wait: promise => promise } });
  await l.reserveDispatch('initial', { estimatedInputTokens: 100 }, null);
  l.rebindJob({ check: current, signal: new AbortController().signal, wait: promise => promise });
  old.mockClear();
  await l.ensureBudget();
  expect(current).toHaveBeenCalledOnce();
  expect(old).not.toHaveBeenCalled();
});

it('preserves absolute usage and known cost through missing observations and refuses contradictory evidence', async () => {
  const l = ledger(), dispatch = await l.reserveDispatch('initial', { estimatedInputTokens: 100 }, null);
  const known = mergeCalendarObservation(emptyCalendarObservation(), { id: 'generation-native',
    usage: { prompt_tokens: 100, completion_tokens: 20, cost: '0.001', prompt_tokens_details: { cached_tokens: 5 } } });
  await l.observe(dispatch.dispatchId, known);
  const retained = await l.observe(dispatch.dispatchId, emptyCalendarObservation());
  expect(retained).toMatchObject({ generationId: 'generation-native', promptTokens: 100, completionTokens: 20,
    cachedPromptTokens: 5, money: { costStatus: 'known', reportedAmount: '0.001' }, reservationStatus: 'settled' });
  await expect(l.observe(dispatch.dispatchId, { ...known, generationId: 'changed' })).rejects.toThrow(/identity/);
  await expect(l.observe(dispatch.dispatchId, { ...known, cachedPromptTokens: 4 })).rejects.toThrow(/disagreed/);
  await expect(l.observe(dispatch.dispatchId, { ...known, money: { ...known.money, reportedAmount: '0.002' } }))
    .rejects.toThrow(/disagreed/);
  expect(await l.aggregate()).toMatchObject({ reportedUsd: '0.001', costStatus: 'known', heldReservationUsd: '0',
    promptTokens: 100, completionTokens: 20 });
  const frozen = l.freeze();
  await expect(l.observe(dispatch.dispatchId, known)).rejects.toThrow(/frozen/);
  await expect(l.reserveDispatch('continuation', { estimatedInputTokens: 100 }, null)).rejects.toThrow(/frozen/);
  expect(l.snapshot()).toEqual(frozen);
});

it('retains complete native groups, rejects mismatched scope and bounds stage bytes', async () => {
  const { state, stage, decision, result } = await localState();
  expect(memoryCalendarStateSchema.safeParse({ ...state, results: [{ ...result, toolCallId: 'wrong',
    resultRef: { ...result.resultRef, toolCallId: 'wrong' } }] }).success).toBe(false);
  expect(memoryCalendarStateSchema.safeParse({ ...state, dispatches: [...state.dispatches, state.dispatches[0]] }).success).toBe(false);
  stage.putDecision(decision); expect(stage.records().decisions).toHaveLength(1);
  expect(() => stage.putDecision({ ...decision, configRevision: 2 })).toThrow(/identity/);
  expect(() => new MemoryCalendarStage(1, 8).putDecision(decision)).toThrow(/budget/);
  stage.records().decisions[0]!.configRevision = 99;
  expect(stage.getDecision(decision.decisionId)?.configRevision).toBe(1);
});

it('uses complete original local native pairs exactly once in shared memory and reserves their bytes', async () => {
  const memory = new MemoryFirstFoundation({ userId: config().identity.userId, epoch: 'native-epoch',
    policy: PROPOSED_MEMORY_TEXT_POLICY, save: async () => ({ kind: 'unknown', retryable: false }) });
  const accepted = memory.accept({ sessionId: 'session-native', requestKey: 'native-request', mode: 'text',
    content: 'First', voice: null, calendarReplyTo: null, config: { revision: '1', modelId: 'fixture/model',
      instructionVersion: assets.instructionVersion, knowledgeContentHash: assets.knowledgeContentHash,
      graphSchemaVersion: assets.graphSchemaVersion } });
  const l = ledger({ identity: { userId: accepted.userId, sessionId: accepted.sessionId,
    turnId: accepted.turnId, attemptId: accepted.attemptId, openRouterUser: accepted.userId,
    createdAt: accepted.createdAt, deadlineAt: new Date(Date.parse(accepted.createdAt) + 30000).toISOString() } });
  const { state } = await localState(l);
  memory.complete(accepted, { content: 'Answer', status: 'completed', calendar: state });
  expect(memory.nativeGroups(accepted.sessionId).get(accepted.turnId)).toHaveLength(1);
  const pairs = memory.nativeGroups(accepted.sessionId).get(accepted.turnId)!;
  expect(pairs[0]!.assistant.tool_calls[0].id).toBe(pairs[0]!.result.tool_call_id);
  expect(memory.result(accepted)?.calendar).toEqual(state);
  expect(memory.session(accepted.sessionId).durableVersion).toBe(0);
  const second = memory.accept({ requestKey: 'native-followup', content: 'Second',
    sessionId: accepted.sessionId, config: accepted.config, mode: 'text', voice: null, calendarReplyTo: null });
  const request = { userId: second.userId, sessionId: second.sessionId, turnId: second.turnId,
    newUserInput: second.content, responseMode: 'text' as const, environment };
  const assembled = await new ReferencedContextAssembler(ports([])).assemble(request, memory.context(second));
  expect(assembled.ok).toBe(true);
  if (!assembled.ok) throw new Error('Fixture context overflow');
  const context = calendarContext({ context: assembled.context, acceptedInput: second.content,
    groups: [], historicalGroups: memory.nativeGroups(second.sessionId), repair: null,
    tools: SKILL_NATIVE_TOOLS, budgets: DEFAULT_BUDGETS, limits: CALENDAR_LIMITS,
    binding: { userId: second.userId, connectionId: 'memory-unbound', connectionRevision: 1, googleSubjectId: 'memory-unbound' },
    compatibility: 'historical', now: Date.now() });
  expect(context.messages.filter(message => message.role === 'user').map(message => message.content)).toEqual(['First', 'Second']);
  expect(context.messages.filter(message => 'tool_calls' in message)).toHaveLength(1);
  expect(context.messages.filter(message => message.role === 'tool')).toHaveLength(1);
  expect(context.loadedSkills.has('google-calendar:calendar_list_calendars')).toBe(true);
  memory.complete(second, { content: 'Next answer', status: 'completed' });
  memory.stopAdmission(); await memory.drain(20);
});

it('hides partial native publications and refuses fenced or mismatched cold evidence', async () => {
  const { state } = await localState();
  const native = memoryCalendarRecordSchema.parse({ schemaVersion: 1, kind: 'memory-calendar-native',
    userId: state.budget.userId, sessionId: state.budget.sessionId, turnId: state.budget.turnId,
    attemptId: 'attempt-native', epoch: 'native-epoch', version: 1, fence: 0, state });
  const session: SessionRecord = { schemaVersion: 1, userId: native.userId, sessionId: native.sessionId,
    title: 'Native', createdAt: state.budget.createdAt, updatedAt: state.budget.createdAt,
    lastActivityAt: state.budget.createdAt, graphThreadId: 'native-thread', latestTurnId: native.turnId,
    lifecycle: 'active', execution: { ownerId: null, activeAttemptId: null, leaseExpiresAt: null, generation: 0 },
    memoryPublication: { version: 0, sequence: 2, epoch: 'native-epoch', fence: 0 } };
  const read = vi.fn(async () => native);
  const p = { owner: { store: { read } } } as unknown as PersistenceBundle;
  const messages = [messageRecordSchema.parse({ schemaVersion: 1, userId: native.userId, sessionId: native.sessionId,
    turnId: native.turnId, attemptId: native.attemptId, sequence: 1, messageId: 'native-message', eventId: 'native-event',
    role: 'assistant', content: 'Answer', createdAt: state.budget.createdAt, completionStatus: 'completed', truncated: false })];
  expect(await readMemoryCalendarStates(p, session, messages, 128)).toEqual([]);
  session.memoryPublication!.version = 1;
  expect(await readMemoryCalendarStates(p, session, messages, 128)).toEqual([state]);
  session.memoryPublication!.fence = 1;
  await expect(readMemoryCalendarStates(p, session, messages, 128)).rejects.toThrow(/reconciliation/);
  session.lifecycle = 'archived'; read.mockClear();
  expect(await readMemoryCalendarStates(p, session, messages, 128)).toEqual([]);
  expect(read).not.toHaveBeenCalled();
});

it('publishes one consolidated native record before visibility and cold-hydrates the exact original pairs', async () => {
  const db = calendarMemory();
  const client = Object.assign(db.commandSource, { db: () => db.store.db, appendMetadata: () => undefined }) as unknown as MongoClient;
  const p = await createPersistenceBundle(client, 'offline-native-memory', DEFAULT_BUDGETS, 'offline-native-executor');
  const adapter = new MemoryTextArchive(p, assets);
  const memory = new MemoryFirstFoundation({ userId: config().identity.userId, epoch: 'native-epoch',
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxAttempts: 1 }, save: adapter.save });
  const accepted = memory.accept({ sessionId: 'session-native', requestKey: 'native-request', mode: 'text',
    content: 'First', voice: null, calendarReplyTo: null, config: { revision: '1', modelId: 'fixture/model',
      instructionVersion: assets.instructionVersion, knowledgeContentHash: assets.knowledgeContentHash,
      graphSchemaVersion: assets.graphSchemaVersion } });
  const l = ledger({ identity: { userId: accepted.userId, sessionId: accepted.sessionId,
    turnId: accepted.turnId, attemptId: accepted.attemptId, openRouterUser: accepted.userId,
    createdAt: accepted.createdAt, deadlineAt: new Date(Date.parse(accepted.createdAt) + 30000).toISOString() } });
  const { state } = await localState(l);
  vi.spyOn(p.memory, 'put').mockRejectedValueOnce(new Error('Partial native publication'));
  const envelope = memory.complete(accepted, { content: 'Answer', status: 'completed', calendar: state });
  await vi.waitFor(() => expect(memory.saveState(accepted)).toBe('unknown'));
  expect(memory.session(accepted.sessionId).durableVersion).toBe(0);
  expect([...db.rows('metadata')!.values()].filter(record => record.kind === 'memory-calendar-native')).toHaveLength(1);
  const partial = (await p.sessions.get(accepted.userId, accepted.sessionId))!;
  expect(await readMemoryCalendarStates(p, partial, [envelope.input, envelope.output], 128)).toEqual([]);
  expect((await adapter.save(envelope, { maxOperations: 32, maxBytes: 524288 })).kind).toBe('saved');
  expect([...db.rows('metadata')!.values()].filter(record => record.kind === 'memory-calendar-native')).toHaveLength(1);
  const session = (await p.sessions.get(accepted.userId, accepted.sessionId))!;
  const manifest = (await p.memory.get(accepted.userId, accepted.sessionId))!;
  const records = await p.messages.getReferences(accepted.userId, accepted.sessionId, manifest.messageRefs);
  const attempts = (await p.metadata.listAttempts(accepted.userId, accepted.sessionId, { cursor: null, limit: 50 })).items;
  expect(attempts[0]).toMatchObject({ nativePublication: { epoch: accepted.epoch, version: 1, fence: 0 } });
  const native = await readMemoryCalendarStates(p, session, records, 128, attempts);
  const groups = await calendarHistory(p, accepted.userId, accepted.sessionId, records);
  expect(groups.get(accepted.turnId)?.[0]?.assistant.tool_calls[0].id).toBe('native-call');
  const nativeRead = p.owner.store!.read.bind(p.owner.store!);
  const read = vi.spyOn(p.owner.store!, 'read').mockImplementation(async (collection, schema, query) =>
    query._id === key('memory-calendar-native', accepted.userId, accepted.sessionId, accepted.attemptId)
      ? null : nativeRead(collection, schema, query));
  await expect(readMemoryCalendarStates(p, session, records, 128, attempts)).rejects.toMatchObject({ code: 'NOT_READY' });
  read.mockRestore();
  const changed = vi.spyOn(p.owner.store!, 'read').mockImplementation(async (collection, schema, query) => {
    const record = await nativeRead(collection, schema, query);
    if (record?.kind === 'memory-calendar-native') {
      const copy = structuredClone(record) as ReturnType<typeof memoryCalendarRecordSchema.parse>;
      copy.state.dispatches[0]!.providerRequestId = 'changed-published-evidence';
      return copy as typeof record;
    }
    return record;
  });
  await expect(readMemoryCalendarStates(p, session, records, 128, attempts)).rejects.toMatchObject({ code: 'NOT_READY' });
  changed.mockRestore();
  const cold = new MemoryFirstFoundation({ userId: accepted.userId, epoch: 'cold-epoch',
    policy: PROPOSED_MEMORY_TEXT_POLICY, save: adapter.save });
  cold.hydrate({ manifest, records }, [], accepted.sequence + 3, records, native);
  expect(cold.nativeGroups(accepted.sessionId)).toEqual(memory.nativeGroups(accepted.sessionId));
  // An adapter acknowledgement is not a receipt owned by the original foundation.
  expect(memory.session(accepted.sessionId).durableVersion).toBe(0);
  await p.sessions.delete(accepted.userId, accepted.sessionId);
  expect((await adapter.save(envelope, { maxOperations: 32, maxBytes: 524288 })).kind).toBe('failed');
  memory.stopAdmission(); cold.stopAdmission(); await memory.drain(20); await cold.drain(20);
});
