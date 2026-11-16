/**
 * ============================================================================
 * FILE: memory-text-archive.spec.ts
 * LOCATION: backend/test/performance/memory-text-archive.spec.ts
 * ============================================================================
 * PURPOSE: Verify terminal publication, ambiguity, bounded saves and legacy handoff.
 * ROLE IN PROJECT: Real repositories and stock saver over the existing fake driver.
 * KEY COMPONENTS: Blocked native writes, partial visibility, retry IDs and tombstones.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import type { MongoClient } from 'mongodb';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from '../../src/chat-runtime/memory-text.js';
import { MemoryTextArchive } from '../../src/persistence/memory-text-archive.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { key } from '../../src/persistence/records.js';
import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { RequestIdentityStore } from '../../src/platform/identity/request-identity-store.js';
import { principal } from '../assembly/auth-principal-fixture.js';
import { OperationsService } from '../../src/operations/operations.service.js';
import { AppService } from '../../src/app.service.js';
import { assemblyFixture } from '../assembly/admin-config-fixture.js';
import { document, at, secret } from '../admin-config/fixtures.js';

async function fixture(policy: Partial<typeof PROPOSED_MEMORY_TEXT_POLICY> = {}) {
  const memory = calendarMemory();
  const client = Object.assign(memory.commandSource, { db: () => memory.store.db, appendMetadata: () => undefined }) as unknown as MongoClient;
  const p = await createPersistenceBundle(client, 'offline-memory-text', DEFAULT_BUDGETS, 'offline-executor');
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d, memoryFirst: {
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxAttempts: 1, shutdownDrainMs: 30, ...policy },
  } }), p);
  const http = new ChatHttpService({ runtime: f.runtime, sessions: p.sessions, messages: p.messages,
    budgets: f.runtime.d.config.budgets,
    identity: { resolve: () => principal(f.identity.userId).identity,
      assertNoClientOverrides: new ServerIdentityResolver(new RequestIdentityStore()).assertNoClientOverrides },
    principal: () => principal(f.identity.userId) });
  const state = (s: string, t: string) => f.runtime.getTurnStatus(f.identity.userId, s, t);
  const settle = async (s: string, t: string, expected = 'saved') => vi.waitFor(async () =>
    expect((await state(s, t)).save?.state).toBe(expected));
  const envelope = (s: string, t: string) => {
    const turn = f.runtime.memoryFor(f.identity.userId)!.foundation.byTurn(s, t)!;
    return f.runtime.memoryFor(f.identity.userId)!.foundation.result(turn)!;
  };
  return { ...f, memory, http, settle, state, envelope };
}

it('streams and dispatches a warm follow-up while the actual storage write is paused', async () => {
  const f = await fixture();
  const paused = f.memory.pauseNextUpdate();
  const a = await f.submit('First'); await f.execute(a); await paused.started;
  const count = f.memory.calls.length;
  expect((await f.http.messages(a.sessionId, {})).items.map(m => m.content)).toEqual(['First', 'Hello 🌍']);
  expect(await f.http.status(a.sessionId, a.turnId)).toMatchObject({ status: 'completed', save: { durableVersion: 0 } });
  const b = await f.submit('Second', a.sessionId); await f.execute(b);
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  expect(f.memory.calls).toHaveLength(count);
  expect(await f.runtime.drain(30)).toMatchObject({ drained: false });
  paused.resume(); await f.settle(b.sessionId, b.turnId);
  expect(await f.runtime.drain(30)).toMatchObject({ drained: true });
});

it('publishes dependencies before the watermark and hides partial completion from cold readers', async () => {
  const f = await fixture();
  vi.spyOn(f.p.memory, 'put').mockRejectedValueOnce(new Error('offline partial publication'));
  const a = await f.submit(); await f.execute(a); await f.settle(a.sessionId, a.turnId, 'unknown');
  expect(f.memory.rows('messages')?.size).toBe(2);
  expect(await f.p.sessions.get(f.identity.userId, a.sessionId)).toMatchObject({ latestTurnId: null, memoryPublication: { version: 0 } });
  const cold = new DurableChatRuntime(f.runtime.d);
  const http = new ChatHttpService({ ...f.http.o, runtime: cold });
  expect((await http.messages(a.sessionId, {})).items).toEqual([]);
  await expect(http.status(a.sessionId, a.turnId)).rejects.toMatchObject({ code: 'NOT_READY' });
  await expect(cold.submitTurn({ identity: f.identity, sessionId: a.sessionId, content: 'Next', idempotencyKey: 'cold-no-replay' }))
    .rejects.toMatchObject({ code: 'NOT_READY' });
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  const adapter = new MemoryTextArchive(f.p, f.runtime.d.assets);
  const result = await adapter.save(f.envelope(a.sessionId, a.turnId), { maxOperations: 32, maxBytes: 524288 });
  expect(result.kind).toBe('saved');
  // The adapter acknowledgement alone does not advance a different owner's ledger.
  expect(await f.state(a.sessionId, a.turnId)).toMatchObject({ status: 'completed', save: { state: 'unknown', durableVersion: 0 } });
  expect(await f.runtime.drain(30)).toMatchObject({ drained: false });
});

it('reconciles commit-then-error immutable writes and never creates duplicate terminal records', async () => {
  const f = await fixture();
  f.memory.failNext('after-write', { collection: 'messages', method: 'updateOne' });
  const a = await f.submit(); await f.execute(a); await f.settle(a.sessionId, a.turnId);
  const adapter = new MemoryTextArchive(f.p, f.runtime.d.assets), e = f.envelope(a.sessionId, a.turnId);
  expect((await adapter.save(e, { maxOperations: 32, maxBytes: 524288 })).kind).toBe('saved');
  expect(f.memory.rows('messages')?.size).toBe(2);
  expect([...f.memory.rows('metadata')!.values()].filter(r => r.kind === 'attempt')).toHaveLength(1);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  await f.dispose();
});

it('preserves rename/pin, rejects stale projection and never resurrects an archived session', async () => {
  const f = await fixture();
  const a = await f.submit(); await f.execute(a); await f.settle(a.sessionId, a.turnId);
  const e = f.envelope(a.sessionId, a.turnId), adapter = new MemoryTextArchive(f.p, f.runtime.d.assets);
  await f.p.sessions.update(f.identity.userId, a.sessionId, { title: 'Renamed', pinned: true });
  expect((await adapter.save(e, { maxOperations: 32, maxBytes: 524288 })).kind).toBe('saved');
  expect(await f.p.sessions.get(f.identity.userId, a.sessionId)).toMatchObject({ title: 'Renamed', pinned: true });
  const b = await f.submit('Second', a.sessionId); await f.execute(b); await f.settle(b.sessionId, b.turnId);
  expect((await adapter.save(e, { maxOperations: 32, maxBytes: 524288 })).kind).toBe('failed');
  expect(await f.p.sessions.get(f.identity.userId, a.sessionId)).toMatchObject({ memoryPublication: { version: 2 }, latestTurnId: b.turnId });
  await f.http.deleteSession(a.sessionId);
  expect((await adapter.save(f.envelope(b.sessionId, b.turnId), { maxOperations: 32, maxBytes: 524288 })).kind).toBe('failed');
  expect(await f.p.sessions.get(f.identity.userId, a.sessionId)).toMatchObject({ lifecycle: 'archived' });
  await f.dispose();
});

it('refuses dirty rename/delete without discarding the authoritative result', async () => {
  const f = await fixture(); const paused = f.memory.pauseNextUpdate();
  const a = await f.submit(); await f.execute(a); await paused.started;
  await expect(f.http.deleteSession(a.sessionId)).rejects.toMatchObject({ code: 'NOT_READY' });
  await expect(f.http.updateSession(a.sessionId, { title: 'New' })).rejects.toMatchObject({ code: 'NOT_READY' });
  expect((await f.http.messages(a.sessionId, {})).items).toHaveLength(2);
  paused.resume(); await f.settle(a.sessionId, a.turnId); await f.dispose();
});

it('hands saved plain history to the legacy graph and refreshes memory after durable execution', async () => {
  const f = await fixture();
  const a = await f.submit('First'); await f.execute(a); await f.settle(a.sessionId, a.turnId);
  const reservation = await f.runtime.reservations.acquire({ identity: f.identity, conversationId: a.sessionId,
    owner: { kind: 'live', voiceSessionId: 'voice-handoff' } });
  await expect(f.submit('blocked', a.sessionId)).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  await f.runtime.reservations.release({ identity: f.identity, reservationId: reservation.reservationId });
  // Exercise the unchanged durable text graph as a stand-in for its shared
  // publication boundary; dedicated voice/Calendar fixtures run separately.
  const legacy = new DurableChatRuntime({ ...f.runtime.d, memoryFirst: undefined });
  const b = await legacy.submitTurn({ identity: f.identity, sessionId: a.sessionId, content: 'Durable', idempotencyKey: 'durable-handoff' });
  await legacy.executeTurn({ userId: f.identity.userId, ...b, signal: new AbortController().signal, emit: async () => {} });
  expect(await f.p.sessions.get(f.identity.userId, a.sessionId)).not.toHaveProperty('memoryPublication');
  const c = await f.submit('Third', a.sessionId); await f.execute(c); await f.settle(c.sessionId, c.turnId);
  const body = JSON.parse(f.fetcher.mock.calls.at(-1)![1]?.body as string);
  expect(body.messages.filter((m: {role: string}) => m.role !== 'system').map((m: {content: string}) => m.content))
    .toEqual(['First', 'Hello 🌍', 'Durable', 'Hello 🌍', 'Third']);
  await f.dispose();
});

it('enforces projection limits and payload identity before publishing success', async () => {
  const f = await fixture();
  const a = await f.submit(); await f.execute(a); await f.settle(a.sessionId, a.turnId);
  const e = f.envelope(a.sessionId, a.turnId), adapter = new MemoryTextArchive(f.p, f.runtime.d.assets);
  expect((await adapter.save(e, { maxOperations: 1, maxBytes: 524288 })).kind).toBe('failed');
  expect((await adapter.save(e, { maxOperations: 32, maxBytes: 1 })).kind).toBe('failed');
  expect((await adapter.save({ ...e, output: { ...e.output, content: 'tampered' } }, { maxOperations: 32, maxBytes: 524288 })).kind).toBe('failed');
  expect(f.memory.rows('messages')?.get(key('message', f.identity.userId, a.sessionId, e.output.messageId))?.content).toBe('Hello 🌍');
  await f.dispose();
});

it('retries saving through HTTP without resetting the attempt budget or invoking the model', async () => {
  const f = await fixture({ maxAttempts: 1 });
  vi.spyOn(f.p.memory, 'put').mockRejectedValueOnce(new Error('offline'));
  const a = await f.submit(); await f.execute(a); await f.settle(a.sessionId, a.turnId, 'unknown');
  const status = await f.state(a.sessionId, a.turnId), save = status.save!;
  await expect(f.http.retrySave(a.sessionId, a.turnId, { epoch: save.epoch, version: save.version }))
    .rejects.toMatchObject({ code: 'NOT_READY' });
  await expect(f.http.retrySave(a.sessionId, a.turnId, { epoch: 'old-process', version: save.version }))
    .rejects.toMatchObject({ code: 'INTERRUPTED' });
  await expect(f.http.retrySave(a.sessionId, a.turnId, { epoch: save.epoch, version: save.version, content: 'untrusted' }))
    .rejects.toMatchObject({ code: 'UNKNOWN_FIELD' });
  expect(await f.state(a.sessionId, a.turnId)).toMatchObject({ status: 'completed', save: { state: 'unknown' } });
  expect(f.fetcher).toHaveBeenCalledOnce();
});

it('reduces complete database command and write totals after background publication', async () => {
  const f = await fixture();
  const start = f.memory.wireCalls.length;
  const a = await f.submit('Plain'); await f.execute(a); await f.settle(a.sessionId, a.turnId);
  const plain = f.memory.wireCalls.slice(start);
  await f.runtime.drain(30);
  const durable = new DurableChatRuntime({ ...f.runtime.d, memoryFirst: undefined });
  const legacyStart = f.memory.wireCalls.length;
  const b = await durable.submitTurn({ identity: f.identity, sessionId: null, content: 'Plain', idempotencyKey: 'legacy-baseline' });
  await durable.executeTurn({ userId: f.identity.userId, ...b, signal: new AbortController().signal, emit: async () => {} });
  const legacy = f.memory.wireCalls.slice(legacyStart);
  const counts = { plainCommands: plain.length, plainWrites: plain.filter(c => c.kind === 'write').length,
    durableCommands: legacy.length, durableWrites: legacy.filter(c => c.kind === 'write').length };
  console.info('Offline complete command comparison', counts);
  expect(counts.plainCommands).toBeLessThan(counts.durableCommands);
  expect(counts.plainWrites).toBeLessThan(counts.durableWrites);
  await durable.drain(30);
});

it('reconciles an uncertain ownership release on save-only retry without repeating the model', async () => {
  const f = await fixture({ maxAttempts: 2, retryBackoffMs: 1 });
  const release = vi.spyOn(f.p.owner, 'release').mockRejectedValueOnce(new Error('release acknowledgement lost'));
  const a = await f.submit(); await f.execute(a); await f.settle(a.sessionId, a.turnId);
  expect(release.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.memory.rows('messages').size).toBe(2);
  expect((await f.p.sessions.get(f.identity.userId, a.sessionId))?.execution.ownerId).toBeNull();
  await f.dispose();
});

it('prevents application persistence close while an app-owned raw save remains unresolved', async () => {
  const f = await fixture(), paused = f.memory.pauseNextUpdate();
  const a = await f.submit(); await f.execute(a); await paused.started;
  const closePersistence = vi.fn(async () => {});
  const operations = new OperationsService({ config: f.runtime.d.config, currentConfig: f.currentConfig,
    runtime: () => f.runtime, assetsReady: () => true, modelLimitsReady: () => true,
    ping: async () => true, assertExecutor: async () => {}, closePersistence,
    transportSnapshot: () => ({ active: 0, backpressured: 0 }), writeLog: () => {} });
  expect(await operations.shutdown()).toEqual({ safe: false });
  expect(closePersistence).not.toHaveBeenCalled();
  paused.resume(); await f.settle(a.sessionId, a.turnId);
  expect(await f.runtime.drain(30)).toMatchObject({ drained: true });
});

it('counts retained and hydrated retry identities once and links a third attempt to the latest durable attempt', async () => {
  const f = await fixture();
  const a = await f.submit('First'); await f.runtime.cancelTurn({ identity: f.identity, ...a }); await f.settle(a.sessionId, a.turnId);
  f.runtime.memoryFor(f.identity.userId)!.handoff(a.sessionId);
  const legacy = new DurableChatRuntime({ ...f.runtime.d, memoryFirst: undefined });
  const b = await legacy.retryTurn({ identity: f.identity, sessionId: a.sessionId, turnId: a.turnId, idempotencyKey: 'legacy-retry-second' });
  await legacy.cancelTurn({ identity: f.identity, ...b });
  const c = await f.runtime.retryTurn({ identity: f.identity, sessionId: a.sessionId, turnId: a.turnId, idempotencyKey: 'memory-retry-third' });
  expect(c.userMessageId).toBe(a.userMessageId);
  await f.execute(c); await f.settle(c.sessionId, c.turnId);
  expect(f.envelope(c.sessionId, c.turnId).request.retryOf?.previousAttemptId).toBe(b.attemptId);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  await f.dispose();
});

it('composes exactly one default memory writer in AppService and closes its native bundle once after drain', async () => {
  const native = await fixture(); await native.runtime.drain(30);
  const seed = document(1); seed.settings.openRouter.modelId = 'fixture/model';
  const config = assemblyFixture(seed);
  await config.repository.compareAndSwap(1, { ...seed, revision: 2, credentials: {
    openrouter: { envelope: config.credentials.seal('openrouter', secret), validatedAt: at }, deepgram: null,
  } });
  const close = vi.fn(async () => {}), runtime = vi.fn((d: import('../../src/chat-runtime/ports.js').RuntimeDependencies) => new DurableChatRuntime(d));
  config.ports.open = vi.fn(async () => ({ ...native.p, close })) as never;
  config.ports.runtime = runtime;
  config.ports.fetcher = native.fetcher;
  const service = await AppService.create(config.bootstrap, config.ports);
  const a = await service.operations.runtime.submitTurn({ identity: native.identity, sessionId: null,
    content: 'Default plain path', idempotencyKey: 'app-composition-text' });
  await service.operations.runtime.executeTurn({ userId: native.identity.userId, ...a,
    signal: new AbortController().signal, emit: async () => {} });
  await vi.waitFor(async () => expect(await service.operations.runtime.getTurnStatus(native.identity.userId, a.sessionId, a.turnId))
    .toMatchObject({ status: 'completed', save: { state: 'saved' } }));
  expect(runtime).toHaveBeenCalledOnce();
  expect(runtime.mock.results[0].value.memoryFor(native.identity.userId)!.foundation.snapshot().sessions).toBe(1);
  expect(native.fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(native.fetcher.mock.calls[0][1]?.body as string).tools).toBeUndefined();
  expect(await service.operations.shutdown()).toEqual({ safe: true });
  expect(await service.operations.shutdown()).toEqual({ safe: true });
  expect(close).toHaveBeenCalledOnce();
});
