/**
 * ============================================================================
 * FILE: archive.native.e2e-spec.ts
 * LOCATION: backend/test/persistence/archive.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Exercise real archive restart, isolation, pagination, and CAS behavior.
 *
 * ROLE IN PROJECT:
 *    Verifies session/message/memory/metadata adapters against an isolated
 *    native MongoDB replica set without claiming Azure compatibility.
 *
 * KEY COMPONENTS:
 *    - Store tests: Idempotent inserts and scoped reads after restart.
 *    - Archive tests: Accepted session lists, transcript pages, manifests.
 * ============================================================================
 */

import { DEFAULT_BUDGETS, messageRecordSchema } from '../../src/contracts/index.js';
import { setupIndexes } from '../../src/persistence/indexes.js';
import { MongoMemory } from '../../src/persistence/memory.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { key } from '../../src/persistence/records.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { RecordStore } from '../../src/persistence/store.js';
import { accounting, attempt, manifest, message, session } from './fixtures.js';
import { nativeDatabase } from './native.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('native record store', () => {
  it('renames, pins across pages, and soft deletes only idle owned sessions', async () => {
    const harness = await nativeDatabase();
    try {
      const sessions = new MongoSessions(new RecordStore(harness.db, 15_000), DEFAULT_BUDGETS);
      for (const id of ['a', 'b', 'c']) await sessions.createIfAbsent({ ...session('u1', id), latestTurnId: 't1' });
      await sessions.update('u1', 'a', { title: '  Renamed  ', pinned: true });
      const restarted = new MongoSessions(new RecordStore(harness.db, 15_000), DEFAULT_BUDGETS);
      expect(await restarted.get('u1', 'a')).toMatchObject({ title: 'Renamed', pinned: true });
      const first = await restarted.list('u1', { limit: 1, cursor: null });
      expect(first.items.map(s => s.sessionId)).toEqual(['a']);
      const second = await restarted.list('u1', { limit: 1, cursor: first.nextCursor });
      expect(second.items.map(s => s.sessionId)).toEqual(['c']);
      const third = await restarted.list('u1', { limit: 1, cursor: second.nextCursor });
      expect(third.items.map(s => s.sessionId)).toEqual(['b']);
      await expect(sessions.update('u2', 'a', { title: 'Wrong owner' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(sessions.delete('u2', 'a')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await sessions.createIfAbsent({ ...session('u1', 'busy'), latestTurnId: 't1',
        execution: { ...session().execution, ownerId: 'executor', activeAttemptId: 'a1' } });
      await expect(sessions.delete('u1', 'busy')).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
      await sessions.delete('u1', 'a');
      await sessions.delete('u1', 'a');
      expect((await sessions.list('u1', { limit: 10, cursor: null })).items.some(s => s.sessionId === 'a')).toBe(false);
      expect(await sessions.get('u1', 'a')).toMatchObject({ lifecycle: 'archived' });
      await expect(sessions.update('u1', 'a', { pinned: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally { await harness.close(); }
  }, 30_000);

  it('deduplicates writes and scopes reads, including a new store after restart', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      const id = key('message', 'u1', 's1', 'm0');
      await store.insert('messages', messageRecordSchema, message(), id, 65_536);
      await store.insert('messages', messageRecordSchema, message(), id, 65_536);
      expect(
        await harness.db.collection('messages').countDocuments({ userId: 'u1', sessionId: 's1' }),
      ).toBe(1);
      const restarted = new RecordStore(harness.db, 15_000);
      expect(
        (await restarted.read('messages', messageRecordSchema, {
          _id: id,
          userId: 'u1',
          sessionId: 's1',
        }))?.messageId,
      ).toBe('m0');
      expect(
        await restarted.read('messages', messageRecordSchema, {
          _id: id,
          userId: 'u2',
          sessionId: 's1',
        }),
      ).toBeNull();
      await expect(
        store.insert(
          'messages',
          messageRecordSchema,
          { ...message(), content: 'changed' },
          id,
          65_536,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('lists accepted sessions and stable transcript pages without leaking private fields', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      const sessions = new MongoSessions(store, DEFAULT_BUDGETS);
      const messages = new MongoMessages(store, DEFAULT_BUDGETS);
      await setupIndexes(harness.db);
      await sessions.createIfAbsent({ ...session(), latestTurnId: 't1' });
      await sessions.createIfAbsent(session('u1', 'empty'));
      await sessions.createIfAbsent({ ...session('u2', 's1'), latestTurnId: 't1' });
      for (const sequence of [3, 0, 2, 1]) {
        await messages.append(message(sequence));
      }
      expect(
        (await sessions.list('u1', { cursor: null, limit: 2 })).items.map(
          (item) => item.sessionId,
        ),
      ).toEqual(['s1']);
      const newest = await messages.list('u1', 's1', { cursor: null, limit: 2 });
      expect(newest.items.map((item) => item.sequence)).toEqual([2, 3]);
      expect(newest.items[0]).not.toHaveProperty('userId');
      expect(newest.items[0]).not.toHaveProperty('attemptId');
      const older = await messages.list('u1', 's1', {
        cursor: newest.nextCursor,
        limit: 2,
      });
      expect(older.items.map((item) => item.sequence)).toEqual([0, 1]);
      expect(older.olderAvailable).toBe(false);
      expect((await messages.list('u2', 's1', { cursor: null, limit: 2 })).items).toEqual(
        [],
      );
      await expect(
        messages.append({ ...message(2), content: 'overwrite' }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
      expect(
        (await harness.db.collection('messages').indexes()).some(
          (index) => index.name === 'scope_sequence_message' && index.unique !== true,
        ),
      ).toBe(true);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('activates only monotonic reference manifests and deduplicates attempt accounting', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      const memory = new MongoMemory(store, DEFAULT_BUDGETS);
      const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
      await memory.put(manifest());
      await memory.put(manifest());
      await expect(memory.put({ ...manifest(), contextVersion: 0 })).rejects.toMatchObject({
        code: 'CONFLICT_ACTIVE_TURN',
      });
      await expect(
        memory.put({
          ...manifest(),
          sourceRanges: [
            { ...manifest().sourceRanges[0], fromSequence: 2, toSequence: 1 },
          ],
        }),
      ).rejects.toThrow();
      await metadata.putAttempt(attempt());
      await metadata.putAttempt(attempt());
      expect(
        (await metadata.getAttemptByIdempotency('u1', 's1', 'request-0001'))?.attemptId,
      ).toBe('a1');
      await expect(
        metadata.putAttempt({ ...attempt(), payloadHash: 'b'.repeat(64) }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
      await metadata.putAccounting(accounting());
      const known = {
        ...accounting(),
        generationId: 'gen1',
        promptTokens: 10,
        completionTokens: 5,
        cost: 0.001,
        accountingStatus: 'known' as const,
        outcome: 'completed' as const,
      };
      await metadata.putAccounting(known);
      await metadata.putAccounting(known);
      await expect(metadata.putAccounting(accounting())).rejects.toMatchObject({
        code: 'CONFLICT_ACTIVE_TURN',
      });
      expect(await harness.db.collection('metadata').countDocuments({ kind: 'accounting' })).toBe(
        1,
      );
      await metadata.putAttempt({
        ...attempt(),
        attemptId: 'a2',
        idempotencyKey: 'request-0002',
        sequence: 2,
        causal: { userMessageId: 'm0', previousAttemptId: 'a1' },
      });
      await expect(metadata.putAccounting({ ...known, attemptId: 'a2' })).rejects.toMatchObject({
        code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      });
      expect(await memory.get('u2', 's1')).toBeNull();
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('paginates tied session activity with stable identity order', async () => {
    const harness = await nativeDatabase();
    try {
      const sessions = new MongoSessions(new RecordStore(harness.db, 15_000), DEFAULT_BUDGETS);
      for (const sessionId of ['s1', 's2', 's3']) {
        await sessions.createIfAbsent({ ...session('u1', sessionId), latestTurnId: 't1' });
      }
      const first = await sessions.list('u1', { cursor: null, limit: 2 });
      const second = await sessions.list('u1', { cursor: first.nextCursor, limit: 2 });
      expect([...first.items, ...second.items].map((item) => item.sessionId)).toEqual([
        's3',
        's2',
        's1',
      ]);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('replays terminal attempt CAS but rejects regression and duplicate attempt identity', async () => {
    const harness = await nativeDatabase();
    try {
      const metadata = new MongoMetadata(new RecordStore(harness.db, 15_000), DEFAULT_BUDGETS);
      await metadata.putAttempt(attempt());
      await expect(
        metadata.putAttempt({ ...attempt(), idempotencyKey: 'different-key' }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
      const generating = { ...attempt(), status: 'generating' as const };
      expect(await metadata.compareAttempt(generating, 'accepted')).toBe(true);
      const interrupted = {
        ...generating,
        status: 'interrupted' as const,
        errorCode: 'INTERRUPTED' as const,
      };
      expect(await metadata.compareAttempt(interrupted, 'generating')).toBe(true);
      expect(await metadata.compareAttempt(interrupted, 'generating')).toBe(true);
      await expect(metadata.compareAttempt(generating, 'interrupted')).rejects.toThrow();
    } finally {
      await harness.close();
    }
  }, 30_000);
});
