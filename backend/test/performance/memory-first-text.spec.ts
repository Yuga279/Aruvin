/**
 * ============================================================================
 * FILE: memory-first-text.spec.ts
 * LOCATION: backend/test/performance/memory-first-text.spec.ts
 * ============================================================================
 * PURPOSE: Verify text dispatch, terminal readiness and safe durable-mode handoff.
 * ROLE IN PROJECT: Exercise the actual runtime/model wires with deterministic fixtures.
 * KEY COMPONENTS: Blocked save, trusted context, idempotency, cancellation and drain.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from '../../src/chat-runtime/memory-text.js';
import { MemoryFirstFoundation, type SaveOutcome, type TerminalEnvelope } from '../../src/chat-runtime/memory-first-foundation.js';
import type { StreamEnvelope } from '../../src/contracts/stream.js';
import { createLatencyFixture } from './latency-runtime-fixture.js';
import { DependencyProbe } from './dependency-probe.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
import { Readiness } from '../../src/operations/readiness.js';
import { options } from '../operations/fixtures.js';
import { calendarFixture, textWire } from '../runtime/calendar-runtime.fixture.js';
import { assets } from '../context/fixtures.js';

it('does not corrupt admission on exhausted hydrated sequence capacity or repeatedly charge replaced cold sources', () => {
  const policy = { ...PROPOSED_MEMORY_TEXT_POLICY, maxSessionBytes: 64000, maxMemoryBytes: 192000,
    maxSessions: 3, maxEnvelopeBytes: 16000, maxBacklogBytes: 128000,
    maxInputBytes: 2000, maxOutputBytes: 4000, maxEvidenceBytes: 4000 };
  const memory = new MemoryFirstFoundation({ userId: 'u1', epoch: 'e1', policy, save: async () => ({ kind: 'unknown', retryable: false }) });
  const config = { revision: '1', modelId: 'fixture/model', instructionVersion: assets.instructionVersion,
    knowledgeContentHash: assets.knowledgeContentHash, graphSchemaVersion: assets.graphSchemaVersion };
  const source = { manifest: { schemaVersion: 1 as const, userId: 'u1', sessionId: 's1',
    contextVersion: 0, messageRefs: [], sourceRanges: [], activeSummaryRef: null,
    instructionVersion: assets.instructionVersion, knowledgeContentHash: assets.knowledgeContentHash,
    graphSchemaVersion: assets.graphSchemaVersion }, records: [] };
  memory.hydrate(source, [], Number.MAX_SAFE_INTEGER - 1);
  expect(() => memory.accept({ sessionId: 's1', requestKey: 'sequence-one', content: 'Hi', config, mode: 'text', voice: null, calendarReplyTo: null })).toThrow();
  expect(memory.snapshot()).toMatchObject({ pending: 0, active: 0 });
  expect(() => memory.hydrate(source, [], 0)).toThrow(/stale/i);
  const clean = new MemoryFirstFoundation({ userId: 'u1', epoch: 'e1', policy, save: async () => ({ kind: 'unknown', retryable: false }) });
  for (let n = 0; n < 300; n++) clean.hydrate(source, [], 0);
  expect(() => clean.accept({ sessionId: 's1', requestKey: 'sequence-two', content: 'Hi', config, mode: 'text', voice: null, calendarReplyTo: null })).not.toThrow();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const saved = (e: TerminalEnvelope): SaveOutcome => ({ kind: 'saved', epoch: e.epoch,
  sessionId: e.sessionId, version: e.version, fence: e.fence });
function fixture(save: (e: TerminalEnvelope) => Promise<SaveOutcome>) {
  return textConfigFixture(textSnapshot(1), d => ({ ...d, memoryFirst: {
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, shutdownDrainMs: 30 }, save,
  } }));
}

it('dispatches, streams, completes and follows up before blocked saving with zero repository calls', async () => {
  const gate = deferred<void>();
  const sink = vi.fn(async (e: TerminalEnvelope) => { await gate.promise; return saved(e); });
  const f = fixture(sink);
  const reads = vi.spyOn(f.p.sessions, 'get');
  const writes = vi.spyOn(f.p.messages, 'append');
  const observations = vi.spyOn(f.p.metadata, 'putAccounting');
  const checkpoints = vi.spyOn(f.p.checkpoints, 'create');
  const frames: StreamEnvelope[] = [];
  const first = await f.submit('First');
  await f.runtime.executeTurn({ userId: f.identity.userId, ...first,
    signal: new AbortController().signal, emit: async frame => { frames.push(frame); } });
  expect(frames.some(frame => frame.event.type === 'delta')).toBe(true);
  expect(frames.at(-1)?.event.type).toBe('completed');
  expect(await f.runtime.getTurnStatus(f.identity.userId, first.sessionId, first.turnId))
    .toMatchObject({ status: 'completed', save: { state: 'saving', durableVersion: 0 } });
  const second = await f.submit('Second', first.sessionId);
  await f.execute(second);
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  const body = JSON.parse(f.fetcher.mock.calls[1][1]?.body as string);
  expect(body.user).toBe(f.identity.userId);
  expect(body.messages.filter((m: {role: string}) => m.role !== 'system'))
    .toEqual([{ role: 'user', content: 'First' }, { role: 'assistant', content: 'Hello 🌍' }, { role: 'user', content: 'Second' }]);
  expect(reads).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
  expect(observations).not.toHaveBeenCalled();
  expect(checkpoints).not.toHaveBeenCalled();
  expect(sink).toHaveBeenCalledTimes(1);
  gate.resolve();
  await f.dispose();
});

it('retains same-key outcomes, rejects changed payload and excludes tabs while allowing other sessions', async () => {
  const f = fixture(async e => saved(e));
  const command = { identity: f.identity, sessionId: null, content: 'First', idempotencyKey: 'same-key-1' };
  const a = await f.runtime.submitTurn(command);
  expect(await f.runtime.submitTurn(command)).toEqual(a);
  await expect(f.runtime.submitTurn({ ...command, content: 'changed' })).rejects.toThrow(/different|mismatch/i);
  await expect(f.submit('other tab', a.sessionId)).rejects.toThrow(/active/i);
  const b = await f.submit('independent');
  await f.execute(b);
  await f.execute(a);
  expect(await f.runtime.submitTurn(command)).toEqual(a);
  await f.execute(a);
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  await f.dispose();
});

it('rejects voice binding to dirty text until the background save is confirmed', async () => {
  const gate = deferred<void>();
  const f = fixture(async e => { await gate.promise; return saved(e); });
  const a = await f.submit(); await f.execute(a);
  await expect(f.runtime.reservations.acquire({ identity: f.identity, conversationId: a.sessionId,
    owner: { kind: 'live', voiceSessionId: 'voice-test' } })).rejects.toThrow(/active|sav/i);
  gate.resolve(); await f.dispose();
});

it('keeps save failure separate and never repeats inference during save retry or status reads', async () => {
  const f = fixture(async () => ({ kind: 'unknown', retryable: false }));
  const a = await f.submit(); await f.execute(a);
  await vi.waitFor(async () => expect(await f.runtime.getTurnStatus(f.identity.userId, a.sessionId, a.turnId))
    .toMatchObject({ status: 'completed', save: { state: 'unknown', durableVersion: 0 } }));
  await f.execute(a);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(await f.runtime.drain(30)).toMatchObject({ drained: false });
});

it('keeps unsaved history available and rejects an old process epoch before dispatch', async () => {
  const f = fixture(async () => ({ kind: 'unknown', retryable: false }));
  const a = await f.submit('First'); await f.execute(a);
  expect(f.runtime.memoryMessages(f.identity.userId, a.sessionId, { cursor: null, limit: 20 })?.items.map(m => m.content))
    .toEqual(['First', 'Hello 🌍']);
  await expect(f.runtime.submitTurn({ identity: f.identity, sessionId: a.sessionId,
    content: 'Second', idempotencyKey: 'epoch-check', expectedEpoch: 'another-process' })).rejects.toThrow();
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  f.runtime.stopAccepting();
});

it('retries one accepted input with a new attempt, deduplicates retry delivery and caps retries', async () => {
  const f = fixture(async e => saved(e));
  const a = await f.submit('First');
  await f.runtime.cancelTurn({ identity: f.identity, ...a });
  const retry = { identity: f.identity, sessionId: a.sessionId, turnId: a.turnId, idempotencyKey: 'retry-key-one' };
  const b = await f.runtime.retryTurn(retry); await f.execute(b);
  expect(b.turnId).toBe(a.turnId); expect(b.userMessageId).toBe(a.userMessageId); expect(b.attemptId).not.toBe(a.attemptId);
  expect(await f.runtime.retryTurn(retry)).toEqual(b);
  expect(f.runtime.memoryMessages(f.identity.userId, a.sessionId, { cursor: null, limit: 20 })?.items.filter(m => m.role === 'user')).toHaveLength(1);
  await f.dispose();
});

it('deduplicates a request during actual fetch and cancels the running generation honestly', async () => {
  const f = fixture(async e => saved(e));
  const wire = f.fetcher.getMockImplementation()!, gate = deferred<void>();
  f.fetcher.mockImplementation(async (...args) => { await gate.promise; return wire(...args); });
  const command = { identity: f.identity, sessionId: null, content: 'First', idempotencyKey: 'running-request' };
  const a = await f.runtime.submitTurn(command), executing = f.execute(a);
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));
  expect(await f.runtime.submitTurn(command)).toEqual(a);
  await expect(f.execute(a)).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  await f.runtime.cancelTurn({ identity: f.identity, ...a });
  gate.resolve(); await executing;
  expect(await f.runtime.getTurnStatus(f.identity.userId, a.sessionId, a.turnId)).toMatchObject({ status: 'cancelled' });
  expect(f.fetcher).toHaveBeenCalledTimes(1); await f.dispose();
});

it('retains interrupted partial text after disconnect and permits follow-up without a save receipt', async () => {
  const gate = deferred<void>();
  const f = fixture(async e => { await gate.promise; return saved(e); });
  const a = await f.submit('First'), controller = new AbortController();
  await f.runtime.executeTurn({ userId: f.identity.userId, ...a, signal: controller.signal,
    emit: async frame => { if (frame.event.type === 'delta') controller.abort(); } });
  expect(await f.runtime.getTurnStatus(f.identity.userId, a.sessionId, a.turnId))
    .toMatchObject({ status: 'interrupted', save: { durableVersion: 0 } });
  expect(f.runtime.memoryMessages(f.identity.userId, a.sessionId, { cursor: null, limit: 20 })?.items.at(-1))
    .toMatchObject({ role: 'assistant', content: 'Hello 🌍', completionStatus: 'interrupted' });
  const b = await f.submit('Second', a.sessionId); await f.execute(b);
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  gate.resolve(); await f.dispose();
});

it('rejects new paid work at the shared backlog ceiling and preserves accepted history', async () => {
  const gate = deferred<void>();
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d, memoryFirst: {
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxEnvelopes: 1 },
    save: async e => { await gate.promise; return saved(e); },
  } }));
  const a = await f.submit('First'); await f.execute(a);
  await expect(f.submit('Second', a.sessionId)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect(f.fetcher).toHaveBeenCalledOnce();
  expect(f.runtime.memoryMessages(f.identity.userId, a.sessionId, { cursor: null, limit: 20 })?.items).toHaveLength(2);
  gate.resolve(); await f.dispose();
});

it('caps explicit generation retry at three linked attempts without duplicating the input', async () => {
  const f = fixture(async e => saved(e));
  const a = await f.submit('First'); await f.runtime.cancelTurn({ identity: f.identity, ...a });
  const b = await f.runtime.retryTurn({ identity: f.identity, ...a, idempotencyKey: 'three-attempt-second' });
  await f.runtime.cancelTurn({ identity: f.identity, ...b });
  const c = await f.runtime.retryTurn({ identity: f.identity, ...a, idempotencyKey: 'three-attempt-third' });
  await f.runtime.cancelTurn({ identity: f.identity, ...c });
  await expect(f.runtime.retryTurn({ identity: f.identity, ...a, idempotencyKey: 'three-attempt-fourth' }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.runtime.memoryFor(f.identity.userId)!.foundation.result(f.runtime.memoryFor(f.identity.userId)!.foundation.byTurn(c.sessionId, c.turnId)!)?.request.retryOf?.previousAttemptId)
    .toBe(b.attemptId);
  expect(f.runtime.memoryMessages(f.identity.userId, a.sessionId, { cursor: null, limit: 20 })?.items.filter(m => m.role === 'user')).toHaveLength(1);
  expect(f.fetcher).not.toHaveBeenCalled(); await f.dispose();
});

it.each([['errorAfter', 'failed'], ['length', 'truncated']] as const)('keeps provider %s distinct from saving', async (wire, status) => {
  const f = fixture(async () => ({ kind: 'unknown', retryable: false }));
  f.fetcher.mockResolvedValueOnce(new Response(FRAMES[wire], { headers: { 'content-type': 'text/event-stream' } }));
  const a = await f.submit(); await f.execute(a);
  expect(await f.runtime.getTurnStatus(f.identity.userId, a.sessionId, a.turnId)).toMatchObject({ status });
  expect(f.runtime.memoryMessages(f.identity.userId, a.sessionId, { cursor: null, limit: 20 })?.items.at(-1)?.content).toBe('Partial');
  f.runtime.stopAccepting();
});

it('does not replace plain admission with a periodic database gate and retains provider/config gates', async () => {
  const { o, runtime } = options(); runtime.memoryAdmissionReady = () => true;
  vi.mocked(o.ping).mockReturnValue(new Promise(() => {}));
  const readiness = new Readiness(o);
  expect(await readiness.readForText()).toMatchObject({ acceptReady: true, readReady: false });
  expect(o.ping).not.toHaveBeenCalled(); expect(o.assertExecutor).not.toHaveBeenCalled();
  readiness.providerFailure('PROVIDER_CREDITS');
  expect(await readiness.readForText()).toMatchObject({ acceptReady: false, provider: 'blocked' });
  o.assetsReady = () => false;
  expect((await readiness.readForText()).issues).toContain('fixed_assets');
});

it('admits Calendar-enabled ordinary text in memory without intent guessing', async () => {
  const h = calendarFixture(undefined, undefined, { policy: { ...PROPOSED_MEMORY_TEXT_POLICY }, save: async e => saved(e) });
  await h.ready;
  h.modelWires.push(textWire('A normal answer'));
  const ids = await h.submit('Hello'); await h.execute(ids);
  expect(h.runtime.memoryFor(h.identity.userId)!.foundation.snapshot().sessions).toBe(1);
  expect(h.runtime.memoryFor(h.identity.userId)!.status(h.identity.userId, ids.sessionId, ids.turnId)).toMatchObject({ status: 'completed' });
  expect(await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId)).toBeNull();
  expect(h.modelBodies).toHaveLength(1);
  expect(h.modelBodies[0]!.user).toBe(h.identity.userId);
  expect(h.effects).toEqual([]);
  await h.dispose();
});

it('pins accepted stream/model budgets and replays a completed key without retaining old credentials', async () => {
  const f = fixture(async e => saved(e));
  const command = { identity: f.identity, sessionId: null, content: 'Pinned', idempotencyKey: 'pinned-key-one' };
  const a = await f.runtime.submitTurn(command), original = textSnapshot(1);
  const newer = textSnapshot(2);
  f.publish({ ...newer, budgets: { ...newer.budgets, idleStreamTimeoutMs: 1000 } });
  expect(f.runtime.attemptStreamBudgets(f.identity.userId, a.sessionId, a.attemptId).idleStreamTimeoutMs)
    .toBe(original.budgets.idleStreamTimeoutMs);
  await f.execute(a);
  expect(JSON.parse(f.fetcher.mock.calls[0][1]?.body as string).model).toBe(original.openRouter.modelId);
  f.publish(null);
  expect(await f.runtime.submitTurn(command)).toEqual(a);
  await f.execute(a);
  expect(f.fetcher).toHaveBeenCalledTimes(1); await f.dispose();
});

it('cancels accepted memory work without dispatch and reports undrained raw saves honestly', async () => {
  const gate = deferred<void>();
  const f = fixture(async e => { await gate.promise; return saved(e); });
  const a = await f.submit();
  await f.runtime.cancelTurn({ identity: f.identity, ...a });
  expect(await f.runtime.getTurnStatus(f.identity.userId, a.sessionId, a.turnId)).toMatchObject({ status: 'cancelled' });
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(await f.runtime.drain(30)).toMatchObject({ drained: false });
  gate.resolve(); await f.dispose();
});

it('publishes real terminal projections and hydrates a cold session once without replaying inference', async () => {
  const f = await createLatencyFixture({ path: 'text', probe: new DependencyProbe(), readMs: 0, writeMs: 0, memoryFirst: true });
  const a = await f.submit('First'); await f.execute(a);
  const settle = async (runtime: DurableChatRuntime, ids: typeof a) => f.run(async () => {
    for (let n = 0; n < 200; n++) {
      if ((await runtime.getTurnStatus(f.identity.userId, ids.sessionId, ids.turnId)).save?.state === 'saved') return;
      await setImmediate();
    }
    throw new Error('Terminal projection did not publish');
  });
  await settle(f.rawRuntime, a);
  expect(await f.rawRuntime.drain(5000)).toMatchObject({ drained: true });
  expect(await f.run(() => f.persistence.sessions.get(f.identity.userId, a.sessionId)))
    .toMatchObject({ memoryPublication: { version: 1 }, latestTurnId: a.turnId });
  const cold = new DurableChatRuntime(f.rawRuntime.d);
  const command = { identity: f.identity, sessionId: a.sessionId, content: 'Second', idempotencyKey: 'cold-followup' };
  const second = await f.run(() => cold.submitTurn(command));
  await cold.executeTurn({ userId: f.identity.userId, ...second, signal: new AbortController().signal, emit: async () => {} });
  const calls = f.modelCalls;
  expect((calls[1].messages as { role: string; content: string }[]).filter(m => m.role !== 'system'))
    .toEqual([{ role: 'user', content: 'First' }, { role: 'assistant', content: 'Hello 🌍' }, { role: 'user', content: 'Second' }]);
  await settle(cold, second);
  expect(await cold.drain(5000)).toMatchObject({ drained: true });
  expect(await f.run(() => f.persistence.sessions.get(f.identity.userId, a.sessionId)))
    .toMatchObject({ memoryPublication: { version: 2 } });
  await f.close();
});

it('enforces expectedEpoch on retryTurn and evicts clean idle memory sessions after retention floor', async () => {
  let clock = Date.parse('2026-10-06T12:00:00.000Z');
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d, now: () => clock, memoryFirst: {
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxSessions: 2, requestRetentionMs: 500, shutdownDrainMs: 30 },
    save: async e => saved(e),
  } }));
  const first = await f.submit('First session');
  await f.runtime.cancelTurn({ identity: f.identity, ...first });
  await expect(f.runtime.retryTurn({
    identity: f.identity, sessionId: first.sessionId, turnId: first.turnId,
    idempotencyKey: 'retry-wrong-epoch', expectedEpoch: 'stale-epoch-1',
  })).rejects.toMatchObject({ code: 'INTERRUPTED' });
  expect(f.fetcher).not.toHaveBeenCalled();

  const retried = await f.runtime.retryTurn({
    identity: f.identity, sessionId: first.sessionId, turnId: first.turnId,
    idempotencyKey: 'retry-right-epoch', expectedEpoch: first.processEpoch,
  });
  expect(retried.processEpoch).toBe(first.processEpoch);
  expect(await f.runtime.retryTurn({
    identity: f.identity, sessionId: first.sessionId, turnId: first.turnId,
    idempotencyKey: 'retry-right-epoch', expectedEpoch: first.processEpoch,
  })).toEqual(retried);
  await f.execute(retried);

  const second = await f.submit('Second session');
  await f.execute(second);
  await vi.waitFor(() => expect(f.runtime.memoryFor(f.identity.userId)!.foundation.snapshot().pending).toBe(0));
  await expect(f.submit('Blocked before retention floor')).rejects.toMatchObject({ code: 'NOT_READY' });

  clock += 600;
  const third = await f.submit('Third session after clean eviction');
  await f.execute(third);
  expect(f.runtime.memoryFor(f.identity.userId)!.foundation.snapshot().sessions).toBeLessThanOrEqual(2);
  await f.dispose();
});
