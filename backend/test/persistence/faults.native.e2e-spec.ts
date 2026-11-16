/**
 * ============================================================================
 * FILE: faults.native.e2e-spec.ts
 * LOCATION: backend/test/persistence/faults.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Inject lost acknowledgments after durable writes and verify reread repair.
 *
 * ROLE IN PROJECT:
 *    Proves P2's ambiguous-write primitives and the exportable persistence
 *    bundle without claiming P5 crash-finalization evidence.
 *
 * KEY COMPONENTS:
 *    - Insert/replace rereads: Committed writes survive lost acknowledgments.
 *    - Race/retry tests: One CAS winner and pre-write failure retry.
 * ============================================================================
 */

import { DEFAULT_BUDGETS, messageRecordSchema } from '../../src/contracts/index.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { key } from '../../src/persistence/records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { message } from './fixtures.js';
import { nativeDatabase } from './native.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('ambiguous persistence writes', () => {
  it('rereads an upsert committed before the acknowledgment failed', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      const collection = harness.db.collection('messages');
      const original = collection.updateOne.bind(collection);
      const spy = vi.spyOn(collection, 'updateOne').mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('lost acknowledgment');
      });
      const dbSpy = vi.spyOn(harness.db, 'collection').mockReturnValue(collection);
      try {
        const id = key('message', 'u1', 's1', 'm0');
        await store.insert('messages', messageRecordSchema, message(), id, 65_536);
        expect(
          await collection.countDocuments({ userId: 'u1', sessionId: 's1' }),
        ).toBe(1);
      } finally {
        dbSpy.mockRestore();
        spy.mockRestore();
      }
      const bundle = await createPersistenceBundle(
        harness.client,
        harness.name,
        DEFAULT_BUDGETS,
        'process-fixture',
      );
      expect(await bundle.ping()).toBe(true);
      expect((await bundle.messages.get('u1', 's1', 'm0'))?.content).toBe('Hello');
      await bundle.owner.releaseExecutor();
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('verifies a replacement committed before acknowledgment failed and rejects stale revisions', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      const id = key('message', 'u1', 's1', 'm0');
      await store.insert('messages', messageRecordSchema, message(), id, 65_536);
      const collection = harness.db.collection('messages');
      const original = collection.replaceOne.bind(collection);
      const spy = vi.spyOn(collection, 'replaceOne').mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('lost acknowledgment');
      });
      const dbSpy = vi.spyOn(harness.db, 'collection').mockReturnValue(collection);
      try {
        const next = { ...message(), completionStatus: 'interrupted' as const };
        expect(
          await store.replace('messages', messageRecordSchema, next, id, 0, 65_536),
        ).toBe(true);
        expect(
          await store.replace(
            'messages',
            messageRecordSchema,
            { ...next, completionStatus: 'cancelled' },
            id,
            0,
            65_536,
          ),
        ).toBe(false);
      } finally {
        dbSpy.mockRestore();
        spy.mockRestore();
      }
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('allows retry after a confirmed pre-write failure without duplicate records', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      const collection = harness.db.collection('messages');
      const spy = vi.spyOn(collection, 'updateOne').mockRejectedValueOnce(new Error('before write'));
      const dbSpy = vi.spyOn(harness.db, 'collection').mockReturnValue(collection);
      const id = key('message', 'u1', 's1', 'm0');
      try {
        await expect(
          store.insert('messages', messageRecordSchema, message(), id, 65_536),
        ).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
      } finally {
        dbSpy.mockRestore();
        spy.mockRestore();
      }
      await store.insert('messages', messageRecordSchema, message(), id, 65_536);
      expect(
        await harness.db.collection('messages').countDocuments({ userId: 'u1', sessionId: 's1' }),
      ).toBe(1);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('chooses one winner when two conditional replacements race', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      const id = key('message', 'u1', 's1', 'm0');
      await store.insert('messages', messageRecordSchema, message(), id, 65_536);
      const first = { ...message(), completionStatus: 'interrupted' as const };
      const second = { ...message(), completionStatus: 'cancelled' as const };
      const results = await Promise.all([
        store.replace('messages', messageRecordSchema, first, id, 0, 65_536),
        store.replace('messages', messageRecordSchema, second, id, 0, 65_536),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const saved = await store.read('messages', messageRecordSchema, {
        _id: id,
        userId: 'u1',
        sessionId: 's1',
      });
      expect(saved?.completionStatus).toBe(results[0] ? 'interrupted' : 'cancelled');
    } finally {
      await harness.close();
    }
  }, 30_000);
});
