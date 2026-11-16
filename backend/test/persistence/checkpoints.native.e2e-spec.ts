/**
 * ============================================================================
 * FILE: checkpoints.native.e2e-spec.ts
 * LOCATION: backend/test/persistence/checkpoints.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Exercise the guarded standard MongoDB saver against a native replica set.
 *
 * ROLE IN PROJECT:
 *    Confirms stock setup, pending-write replay, restart, scope, and bounds
 *    without replacing saver serialization or adding TTL uniqueness.
 *
 * KEY COMPONENTS:
 *    - Setup/put/putWrites: Both collections, idempotent writes, pending replay.
 *    - Guardrails: Wrong scope, oversized envelopes, and lost leases fail closed.
 * ============================================================================
 */

import { emptyCheckpoint } from '@langchain/langgraph-checkpoint';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/index.js';
import { MongoCheckpointFactory } from '../../src/persistence/checkpoints.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { graphThreadId } from '../../src/persistence/records.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { RecordStore } from '../../src/persistence/store.js';
import { session } from './fixtures.js';
import { nativeDatabase } from './native.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('standard MongoDB saver', () => {
  it('sets up both collections, replays pending writes and restores after a new factory', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      await new MongoSessions(store, DEFAULT_BUDGETS).createIfAbsent(session());
      const owner = new MongoOwnership(store, 'process-a');
      await owner.claimExecutor();
      const result = await owner.acquire({
        userId: 'u1',
        sessionId: 's1',
        ownerId: 'process-a',
        leaseMs: 60_000,
      });
      if (!result.ok) {
        throw new Error('lease expected');
      }
      const factory = new MongoCheckpointFactory(
        harness.client,
        harness.name,
        owner,
        DEFAULT_BUDGETS,
      );
      const handle = await factory.create();
      await handle.setup();
      await handle.setup();
      const saver = handle.bind(result.lease);
      const checkpoint = emptyCheckpoint();
      checkpoint.channel_values = { result: { attemptId: 'a1', text: 'saved result' } };
      const config = {
        configurable: { thread_id: graphThreadId('u1', 's1'), checkpoint_ns: '' },
      };
      const saved = await saver.put(config, checkpoint, {
        source: 'update',
        step: 1,
        parents: {},
      });
      await saver.put(config, checkpoint, { source: 'update', step: 1, parents: {} });
      expect(
        await harness.db
          .collection('checkpoints')
          .countDocuments({ thread_id: graphThreadId('u1', 's1') }),
      ).toBe(1);
      await saver.putWrites(saved, [['result', 'pending']], 'task-a');
      await saver.putWrites(saved, [['result', 'pending']], 'task-a');
      await saver.putWrites(saved, [], 'task-empty');
      const secondClient = await harness.reconnect();
      try {
        const restarted = (
          await new MongoCheckpointFactory(
            secondClient,
            harness.name,
            owner,
            DEFAULT_BUDGETS,
          ).create()
        ).bind(result.lease);
        expect(
          (await restarted.getTuple(saved))?.checkpoint.channel_values.result,
        ).toEqual({ attemptId: 'a1', text: 'saved result' });
        expect((await restarted.getTuple(saved))?.pendingWrites).toHaveLength(1);
      } finally {
        await secondClient.close();
      }
      expect(
        await harness.db
          .collection('checkpoint_writes')
          .countDocuments({ thread_id: graphThreadId('u1', 's1') }),
      ).toBe(1);
      for (const name of ['checkpoints', 'checkpoint_writes']) {
        const indexes = await harness.db.collection(name).indexes();
        expect(indexes.some((index) => index.name?.startsWith('thread_ns_checkpoint'))).toBe(
          true,
        );
        expect(
          indexes
            .filter((index) => index.name !== '_id_')
            .every((index) => !index.unique && index.expireAfterSeconds === undefined),
        ).toBe(true);
      }
      await expect(
        saver.getTuple({
          configurable: { thread_id: graphThreadId('u2', 's1'), checkpoint_ns: '' },
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      const oversized = emptyCheckpoint();
      oversized.channel_values = { text: 'x'.repeat(1_800_000) };
      await expect(
        saver.put(config, oversized, { source: 'update', step: 2, parents: {} }),
      ).rejects.toMatchObject({ code: 'STORAGE_BUDGET_EXCEEDED' });
      await owner.release(result.lease);
      await expect(
        saver.put(config, checkpoint, { source: 'update', step: 3, parents: {} }),
      ).rejects.toMatchObject({ code: 'INTERRUPTED' });
      const spy = vi
        .spyOn(MongoDBSaver.prototype, 'setup')
        .mockResolvedValueOnce([new Error('index failure')]);
      try {
        await expect(handle.setup()).rejects.toMatchObject({ code: 'NOT_READY' });
      } finally {
        spy.mockRestore();
      }
    } finally {
      await harness.close();
    }
  }, 30_000);
});
