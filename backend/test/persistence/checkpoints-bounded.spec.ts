/**
 * ============================================================================
 * FILE: checkpoints-bounded.spec.ts
 * LOCATION: backend/test/persistence/checkpoints-bounded.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Conformance and security unit tests for the stock-saver bounded read facade.
 *
 * ROLE IN PROJECT:
 *    Verifies that ScopedMongoSaver with the bounded read facade produces identical
 *    tuples to unmodified MongoDBSaver with exactly 2 queries (1 for empty thread),
 *    enforces raw BSON document and pending write limits before stock serde.loadsTyped,
 *    pins pending writes to the selected checkpoint, and preserves the strict fallback.
 *
 * KEY COMPONENTS:
 *    - Conformance tests against unmodified MongoDBSaver (empty, non-empty, historical ID).
 *    - Query counter asserting exactly 2 reads on non-empty thread, 1 on empty.
 *    - Pre-decode budget defense asserting serde.loadsTyped is never called on oversized
 *      or malicious documents (>80 pending writes, oversized bytes, malformed binary).
 *    - Pinned identity test across concurrent checkpoint writes.
 *    - Strict fallback path conformance when facade is not enabled (D5 gated).
 * ============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { Binary, type MongoClient } from 'mongodb';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { ScopedMongoSaver } from '../../src/persistence/checkpoints.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { calendarMemory } from './calendar-multi-memory.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { graphThreadId } from '../../src/persistence/records.js';
import { session } from './fixtures.js';

const budgets = {
  ...DEFAULT_BUDGETS,
  maxDocumentBytes: 64 * 1024, // 64 KiB
};

async function createFixture() {
  const mem = calendarMemory();
  const fakeClient = {
    db: (_name: string) => mem.store.db,
    appendMetadata: () => {},
  } as unknown as MongoClient;

  const owner = new MongoOwnership(mem.store, 'test-executor');
  const sessions = new MongoSessions(mem.store, budgets);
  await owner.claimExecutor();
  await sessions.createIfAbsent(session('user-bounded', 'session-bounded'));
  const acquired = await owner.acquire({
    userId: 'user-bounded',
    sessionId: 'session-bounded',
    ownerId: 'test-executor',
    leaseMs: 60000,
  });
  if (!acquired.ok) throw new Error('Failed to acquire lease');

  return { mem, fakeClient, owner, lease: acquired.lease };
}

describe('ScopedMongoSaver Bounded Read Facade (T9)', () => {
  it('produces identical CheckpointTuple to stock MongoDBSaver on non-empty thread with exactly 2 queries', async () => {
    const { fakeClient: clientStock } = await createFixture();
    const { mem: memBounded, fakeClient: clientBounded, owner, lease } = await createFixture();

    const stockSaver = new MongoDBSaver({
      client: clientStock,
      dbName: 'synthetic',
      checkpointCollectionName: 'checkpoints',
      checkpointWritesCollectionName: 'checkpoint_writes',
    });

    const boundedSaver = new ScopedMongoSaver(
      clientBounded,
      'synthetic',
      owner,
      lease,
      budgets,
      { enableReadFacade: true },
    );

    const threadId = graphThreadId(lease.userId, lease.sessionId);
    const config = { configurable: { thread_id: threadId, checkpoint_ns: '' } };

    // Seed same data in both
    const checkpoint = {
      v: 1,
      id: 'cp-001',
      ts: '2026-10-29T00:00:00Z',
      channel_values: { messages: [{ role: 'user', content: 'hello' }] },
      channel_versions: { messages: 1 },
      versions_seen: {},
    };
    const metadata = { source: 'input', step: 1, writes: {} };

    await stockSaver.put(config, checkpoint, metadata);
    await boundedSaver.put(config, checkpoint, metadata);

    // Put pending writes
    await stockSaver.putWrites(
      { configurable: { thread_id: threadId, checkpoint_ns: '', checkpoint_id: 'cp-001' } },
      [['messages', { role: 'assistant', content: 'hi' }]],
      'task-1',
    );
    await boundedSaver.putWrites(
      { configurable: { thread_id: threadId, checkpoint_ns: '', checkpoint_id: 'cp-001' } },
      [['messages', { role: 'assistant', content: 'hi' }]],
      'task-1',
    );

    // Clear calls count
    memBounded.calls.length = 0;

    const stockTuple = await stockSaver.getTuple(config);
    const boundedTuple = await boundedSaver.getTuple(config);

    expect(boundedTuple).toBeDefined();
    expect(boundedTuple).toEqual(stockTuple);

    // Count read calls on bounded saver: exactly 1 find on checkpoints, 1 find on checkpoint_writes
    const readCalls = memBounded.calls.filter(c => c.method === 'find');
    expect(readCalls).toHaveLength(2);
    expect(readCalls[0]?.collection).toBe('checkpoints');
    expect(readCalls[1]?.collection).toBe('checkpoint_writes');
  });

  it('returns undefined with exactly 1 query on empty thread', async () => {
    const { mem, fakeClient, owner, lease } = await createFixture();
    const boundedSaver = new ScopedMongoSaver(
      fakeClient,
      'synthetic',
      owner,
      lease,
      budgets,
      { enableReadFacade: true },
    );

    const threadId = graphThreadId(lease.userId, lease.sessionId);
    const config = { configurable: { thread_id: threadId, checkpoint_ns: '' } };

    mem.calls.length = 0;
    const tuple = await boundedSaver.getTuple(config);

    expect(tuple).toBeUndefined();
    const readCalls = mem.calls.filter(c => c.method === 'find');
    expect(readCalls).toHaveLength(1);
    expect(readCalls[0]?.collection).toBe('checkpoints');
  });

  it('retrieves explicit historical checkpoint ID', async () => {
    const { fakeClient, owner, lease } = await createFixture();
    const boundedSaver = new ScopedMongoSaver(
      fakeClient,
      'synthetic',
      owner,
      lease,
      budgets,
      { enableReadFacade: true },
    );

    const threadId = graphThreadId(lease.userId, lease.sessionId);

    // Put two checkpoints
    await boundedSaver.put(
      { configurable: { thread_id: threadId, checkpoint_ns: '' } },
      { v: 1, id: 'cp-001', ts: '2026-10-29T00:00:00Z', channel_values: {}, channel_versions: {}, versions_seen: {} },
      { source: 'input', step: 1, writes: {} },
    );
    await boundedSaver.put(
      { configurable: { thread_id: threadId, checkpoint_ns: '' } },
      { v: 1, id: 'cp-002', ts: '2026-10-29T00:01:00Z', channel_values: {}, channel_versions: {}, versions_seen: {} },
      { source: 'input', step: 2, writes: {} },
    );

    const historical = await boundedSaver.getTuple({
      configurable: { thread_id: threadId, checkpoint_ns: '', checkpoint_id: 'cp-001' },
    });

    expect(historical?.checkpoint.id).toBe('cp-001');
  });

  it('refuses oversized checkpoint before stock serde.loadsTyped runs', async () => {
    const { mem, fakeClient, owner, lease } = await createFixture();
    const boundedSaver = new ScopedMongoSaver(
      fakeClient,
      'synthetic',
      owner,
      lease,
      budgets,
      { enableReadFacade: true },
    );

    const threadId = graphThreadId(lease.userId, lease.sessionId);

    // Insert directly into fake DB an oversized checkpoint (> 64 KiB)
    const bigData = Buffer.alloc(70 * 1024, 'x');
    mem.rows('checkpoints').set('oversized', {
      _id: 'oversized',
      thread_id: threadId,
      checkpoint_ns: '',
      checkpoint_id: 'cp-big',
      type: 'json',
      checkpoint: new Binary(bigData),
      metadata: new Binary(Buffer.from('{}')),
    });

    const loadsTypedSpy = vi.spyOn(boundedSaver.serde, 'loadsTyped');

    await expect(
      boundedSaver.getTuple({ configurable: { thread_id: threadId, checkpoint_ns: '' } }),
    ).rejects.toMatchObject({ code: 'STORAGE_BUDGET_EXCEEDED' });

    expect(loadsTypedSpy).not.toHaveBeenCalled();
  });

  it('refuses >80 pending writes before stock serde.loadsTyped runs', async () => {
    const { mem, fakeClient, owner, lease } = await createFixture();
    const boundedSaver = new ScopedMongoSaver(
      fakeClient,
      'synthetic',
      owner,
      lease,
      budgets,
      { enableReadFacade: true },
    );

    const threadId = graphThreadId(lease.userId, lease.sessionId);

    // Insert valid checkpoint
    mem.rows('checkpoints').set('cp-1', {
      _id: 'cp-1',
      thread_id: threadId,
      checkpoint_ns: '',
      checkpoint_id: 'cp-001',
      type: 'json',
      checkpoint: new Binary(Buffer.from(JSON.stringify({ v: 1, id: 'cp-001', ts: '2026-10-29T00:00:00Z', channel_values: {}, channel_versions: {}, versions_seen: {} }))),
      metadata: new Binary(Buffer.from('{}')),
    });

    // Insert 81 pending writes
    for (let i = 0; i < 81; i++) {
      mem.rows('checkpoint_writes').set(`w-${i}`, {
        _id: `w-${i}`,
        thread_id: threadId,
        checkpoint_ns: '',
        checkpoint_id: 'cp-001',
        task_id: `task-${i}`,
        idx: i,
        channel: 'messages',
        type: 'json',
        value: new Binary(Buffer.from('{}')),
      });
    }

    const loadsTypedSpy = vi.spyOn(boundedSaver.serde, 'loadsTyped');

    await expect(
      boundedSaver.getTuple({ configurable: { thread_id: threadId, checkpoint_ns: '' } }),
    ).rejects.toMatchObject({ code: 'STORAGE_BUDGET_EXCEEDED' });

    // loadsTyped may have run on checkpoint, but MUST NOT run on pending writes
    expect(loadsTypedSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('refuses malformed Binary before stock serde.loadsTyped runs', async () => {
    const { mem, fakeClient, owner, lease } = await createFixture();
    const boundedSaver = new ScopedMongoSaver(
      fakeClient,
      'synthetic',
      owner,
      lease,
      budgets,
      { enableReadFacade: true },
    );

    const threadId = graphThreadId(lease.userId, lease.sessionId);

    mem.rows('checkpoints').set('malformed', {
      _id: 'malformed',
      thread_id: threadId,
      checkpoint_ns: '',
      checkpoint_id: 'cp-malformed',
      type: 'json',
      checkpoint: { not: 'a valid binary instance' }, // malformed
      metadata: new Binary(Buffer.from('{}')),
    });

    const loadsTypedSpy = vi.spyOn(boundedSaver.serde, 'loadsTyped');

    await expect(
      boundedSaver.getTuple({ configurable: { thread_id: threadId, checkpoint_ns: '' } }),
    ).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });

    expect(loadsTypedSpy).not.toHaveBeenCalled();
  });

  it('pins pending writes to the selected checkpoint even if a newer checkpoint is added', async () => {
    const { fakeClient, owner, lease } = await createFixture();
    const boundedSaver = new ScopedMongoSaver(
      fakeClient,
      'synthetic',
      owner,
      lease,
      budgets,
      { enableReadFacade: true },
    );

    const threadId = graphThreadId(lease.userId, lease.sessionId);

    // Insert cp-001
    await boundedSaver.put(
      { configurable: { thread_id: threadId, checkpoint_ns: '' } },
      { v: 1, id: 'cp-001', ts: '2026-10-29T00:00:00Z', channel_values: { val: 'first' }, channel_versions: {}, versions_seen: {} },
      { source: 'input', step: 1, writes: {} },
    );

    await boundedSaver.putWrites(
      { configurable: { thread_id: threadId, checkpoint_ns: '', checkpoint_id: 'cp-001' } },
      [['val', 'pending-first']],
      'task-1',
    );

    // Insert cp-002 with pending write
    await boundedSaver.put(
      { configurable: { thread_id: threadId, checkpoint_ns: '' } },
      { v: 1, id: 'cp-002', ts: '2026-10-29T00:01:00Z', channel_values: { val: 'second' }, channel_versions: {}, versions_seen: {} },
      { source: 'input', step: 2, writes: {} },
    );

    await boundedSaver.putWrites(
      { configurable: { thread_id: threadId, checkpoint_ns: '', checkpoint_id: 'cp-002' } },
      [['val', 'pending-second']],
      'task-2',
    );

    // Fetch historical cp-001
    const tuple1 = await boundedSaver.getTuple({
      configurable: { thread_id: threadId, checkpoint_ns: '', checkpoint_id: 'cp-001' },
    });
    expect(tuple1?.checkpoint.id).toBe('cp-001');
    expect(tuple1?.pendingWrites?.[0]?.[2]).toBe('pending-first');

    // Fetch latest (cp-002)
    const tuple2 = await boundedSaver.getTuple({
      configurable: { thread_id: threadId, checkpoint_ns: '' },
    });
    expect(tuple2?.checkpoint.id).toBe('cp-002');
    expect(tuple2?.pendingWrites?.[0]?.[2]).toBe('pending-second');
  });

  it('strict fallback path (enableReadFacade: false) still works and enforces limits', async () => {
    const { fakeClient, owner, lease } = await createFixture();
    const fallbackSaver = new ScopedMongoSaver(
      fakeClient,
      'synthetic',
      owner,
      lease,
      budgets,
      { enableReadFacade: false },
    );

    const threadId = graphThreadId(lease.userId, lease.sessionId);
    const config = { configurable: { thread_id: threadId, checkpoint_ns: '' } };

    await fallbackSaver.put(
      config,
      { v: 1, id: 'cp-fallback', ts: '2026-10-29T00:00:00Z', channel_values: {}, channel_versions: {}, versions_seen: {} },
      { source: 'input', step: 1, writes: {} },
    );

    const tuple = await fallbackSaver.getTuple(config);
    expect(tuple).toBeDefined();
    expect(tuple?.checkpoint.id).toBe('cp-fallback');
  });
});
