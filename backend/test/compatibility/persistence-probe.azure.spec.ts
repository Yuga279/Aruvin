/**
 * ============================================================================
 * FILE: persistence-probe.azure.spec.ts
 * LOCATION: backend/test/compatibility/persistence-probe.azure.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Exercise bounded Azure storage primitives without claiming certification.
 * ROLE IN PROJECT:
 *    Uses one generated isolated database and real stock storage/checkpointer.
 *    Leaves deployment-facts admission and application recovery separate.
 * KEY COMPONENTS:
 *    - Authorization gate and generated-only cleanup verification.
 *    - CAS, acceptance, saver, handoff, fencing, release and durable reopen.
 * ============================================================================
 */
import { emptyCheckpoint } from '@langchain/langgraph-checkpoint';
import { BSON } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/index.js';
import { APP_INDEXES } from '../../src/persistence/indexes.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { graphThreadId, key } from '../../src/persistence/records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { hashPayload } from '../../src/platform/crypto/hash-payload.js';
import { accounting, attempt, manifest, message, session } from '../persistence/fixtures.js';
import { nativeDatabase } from '../persistence/native.js';

it('probes generated Azure primitives only — not deployment certification', async () => {
  if (process.env.AURVIN_AZURE_TEST_AUTHORIZED !== 'yes' ||
      process.env.AURVIN_TEST_DB_PREFIX !== 'aurvin_p2_test_' ||
      !process.env.AURVIN_TEST_MONGODB_URI) {
    throw new Error('Authorized generated capability target is required.');
  }
  const h = await nativeDatabase();
  let stage = 'empty target';
  let failure: Error | undefined;
  try {
    expect(await h.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0);
    stage = 'bundle setup';
    const first = await createPersistenceBundle(h.client, h.name, DEFAULT_BUDGETS, 'probe-a');
    const store = new RecordStore(h.db, DEFAULT_BUDGETS.persistenceTimeoutMs);
    await first.sessions.createIfAbsent(session());
    // Separate owner objects bypass the in-object queue: exercise database CAS.
    stage = 'atomic session ownership';
    const peer = new MongoOwnership(store, 'probe-a');
    const input = { userId: 'u1', sessionId: 's1', ownerId: 'probe-a', leaseMs: 180_000 };
    const races = await Promise.all([first.owner.acquire(input), peer.acquire(input)]);
    expect(races.filter(row => row.ok)).toHaveLength(1);
    const won = races.find(row => row.ok);
    if (!won?.ok) throw new Error('Expected one lease.');
    const lease = won.lease;
    stage = 'acceptance and idempotency';
    const reservation = await first.owner.allocateSequences(lease, 'probe-order', 3);
    expect(await first.owner.allocateSequences(lease, 'probe-order', 3)).toEqual(reservation);
    await first.owner.reserveAttempt(lease, 'a1');
    await expect(first.owner.confirmAcceptance(lease, 'a1')).rejects.toMatchObject({ code: 'NOT_READY' });
    const accepted = { ...attempt(), payloadHash: hashPayload(message().content) };
    await first.owner.run(lease, async () => {
      await first.messages.append(message());
      await first.messages.append(message());
      await expect(first.messages.append({ ...message(), content: 'different' }))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
      await first.metadata.putAttempt(accepted);
      await first.memory.put(manifest());
      await first.metadata.putAccounting(accounting());
    });
    await first.owner.confirmAcceptance(lease, 'a1');
    await first.owner.confirmAcceptance(lease, 'a1');
    expect((await first.metadata.getAcceptance('u1', 's1', 'a1'))?.userMessageId).toBe('m0');
    expect(await h.db.collection('messages').countDocuments({ userId: 'u1', sessionId: 's1' })).toBe(1);
    stage = 'stock saver';
    const handle = await first.checkpoints.create();
    await handle.setup();
    const saver = handle.bind(lease);
    const checkpoint = emptyCheckpoint();
    checkpoint.channel_values = { result: { text: 'synthetic', attemptId: 'a1' } };
    const config = { configurable: { thread_id: graphThreadId('u1', 's1'), checkpoint_ns: '' } };
    const saved = await saver.put(config, checkpoint, { source: 'update', step: 1, parents: {} });
    await saver.putWrites(saved, [['result', 'pending']], 'probe-task');
    await saver.putWrites(saved, [['result', 'pending']], 'probe-task');
    expect((await saver.getTuple(saved))?.checkpoint.channel_values).toEqual(checkpoint.channel_values);
    expect((await saver.getTuple(saved))?.pendingWrites).toHaveLength(1);
    const listed = [];
    for await (const row of saver.list(config, { limit: 2 })) listed.push(row);
    expect(listed).toHaveLength(1);
    stage = 'indexes and record headroom';
    const expected = [...APP_INDEXES,
      { collection: 'checkpoints', keys: { thread_id: 1, checkpoint_ns: 1, checkpoint_id: -1 }, options: { name: 'thread_ns_checkpoint_idx' } },
      { collection: 'checkpoint_writes', keys: { thread_id: 1, checkpoint_ns: 1, checkpoint_id: 1, task_id: 1, idx: 1 }, options: { name: 'thread_ns_checkpoint_task_idx' } },
    ];
    for (const index of expected) {
      const indexes = await h.db.collection(index.collection).indexes();
      expect(indexes.find(row => row.name === index.options.name)?.key).toEqual(index.keys);
    }
    const names = ['sessions', 'messages', 'agent-memory', 'metadata', 'checkpoints', 'checkpoint_writes'];
    expect((await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort())
      .toEqual([...names].sort());
    for (const name of names) {
      const docs = await h.db.collection(name).find({}).limit(101).toArray();
      expect(docs.length).toBeGreaterThan(0);
      expect(docs.length).toBeLessThanOrEqual(100);
      for (const doc of docs) expect(BSON.calculateObjectSize(doc) + 256).toBeLessThanOrEqual(1_800_000);
      for (const index of await h.db.collection(name).indexes()) {
        if (index.name !== '_id_') {
          expect(index.unique).not.toBe(true);
          expect(index.expireAfterSeconds).toBeUndefined();
        }
      }
    }
    stage = 'conditional handoff and fencing';
    await expect(rival.handoffStoppedExecutor('wrong-owner')).rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
    await first.owner.drain();
    await peer.drain();
    await rival.handoffStoppedExecutor('probe-a');
    await expect(first.owner.run(lease, async () => undefined))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
    const second = await createPersistenceBundle(h.client, h.name, DEFAULT_BUDGETS, 'probe-b');
    const recovered = await second.owner.recoverStoppedSession('u1', 's1', 'probe-a', 180_000);
    expect(recovered.generation).toBeGreaterThan(lease.generation);
    expect((await (await second.checkpoints.create()).bind(recovered).getTuple(saved))?.pendingWrites).toHaveLength(1);
    stage = 'quiescent release';
    await expect(second.owner.releaseExecutor()).rejects.toMatchObject({ code: 'NOT_READY' });
    await second.owner.run(recovered, async () => {
      expect(await second.metadata.compareAttempt({ ...accepted, status: 'interrupted', errorCode: 'INTERRUPTED' }, 'accepted')).toBe(true);
    });
    await second.owner.clearAttempt(recovered, 'a1');
    await second.owner.release(recovered);
    await second.owner.drain();
    await second.owner.releaseExecutor();
    expect(await h.db.collection('metadata').findOne({ _id: key('executor') })).toBeNull();
    stage = 'durable reopen';
    const reopened = await h.reconnect();
    try {
      const third = await createPersistenceBundle(reopened, h.name, DEFAULT_BUDGETS, 'probe-c');
      expect((await third.messages.list('u1', 's1', { cursor: null, limit: 2 })).items).toHaveLength(1);
      expect((await third.metadata.getAttempt('u1', 's1', 'a1'))?.status).toBe('interrupted');
      expect(await reopened.db(h.name).collection('metadata').countDocuments({ kind: 'accounting' })).toBe(1);
      const acquired = await third.owner.acquire({ ...input, ownerId: 'probe-c' });
      if (!acquired.ok) throw new Error('Expected reopened lease.');
      const readSaver = (await third.checkpoints.create()).bind(acquired.lease);
      expect((await readSaver.getTuple(saved))?.checkpoint.channel_values).toEqual(checkpoint.channel_values);
      expect((await readSaver.getTuple(saved))?.pendingWrites).toHaveLength(1);
      await third.owner.release(acquired.lease);
      await third.owner.drain();
      await third.owner.releaseExecutor();
    } finally {
      await reopened.close();
    }
  } catch {
    // Static stage only: raw driver errors must never enter Vitest output.
    failure = new Error(`Generated capability probe failed at ${stage}; recovery remains blocked.`);
  } finally {
    try {
      await h.close();
      const verifier = await h.reconnect();
      try {
        // Exact generated namespace only; no prefix-wide enumeration or deletion.
        const remaining = await verifier.db('admin').admin().listDatabases({
          nameOnly: true, filter: { name: h.name }, maxTimeMS: 10_000,
        });
        expect(remaining.databases).toHaveLength(0);
      } finally {
        await verifier.close();
      }
    } catch {
      failure = new Error('Generated test cleanup was not confirmed; stop and inspect privately.');
    }
  }
  if (failure) throw failure;
}, 180_000);
