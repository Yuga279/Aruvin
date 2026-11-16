/**
 * ============================================================================
 * FILE: session-actions.spec.ts
 * LOCATION: backend/test/persistence/session-actions.spec.ts
 * ============================================================================
 * PURPOSE: Check atomic session mutation filters and ambiguous-write handling.
 * ROLE IN PROJECT: Deterministic Mongo adapter checks complement native integration.
 * KEY COMPONENTS: Ownership scope, idle-only deletion, validation, acknowledgment loss.
 * ============================================================================
 */
import type { Db } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { RecordStore } from '../../src/persistence/store.js';
import { session } from './fixtures.js';

function fixture() {
  const store = new RecordStore({} as Db, 1000);
  const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
  vi.spyOn(store, 'collection').mockReturnValue({ updateOne } as unknown as ReturnType<RecordStore['collection']>);
  const raw = vi.spyOn(store, 'raw').mockResolvedValue(null);
  const get = vi.spyOn(store, 'read').mockResolvedValue(session());
  return { repository: new MongoSessions(store, DEFAULT_BUDGETS), updateOne, raw, get };
}

describe('Mongo session actions', () => {
  it('updates only the scoped active session and trims the title', async () => {
    const f = fixture();
    await f.repository.update('u1', 's1', { title: '  New  ', pinned: true });
    expect(f.updateOne).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', sessionId: 's1', lifecycle: 'active' }),
      expect.objectContaining({ $set: expect.objectContaining({ title: 'New', pinned: true }), $inc: { _revision: 1 } }),
      { maxTimeMS: 1000 });
  });
  it('atomically archives only idle sessions, refusing active work', async () => {
    const f = fixture();
    f.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(f.repository.delete('u1', 's1')).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
    expect(f.updateOne.mock.calls[0]).toEqual([expect.objectContaining({ userId: 'u1', sessionId: 's1',
      'execution.ownerId': null, 'execution.activeAttemptId': null }),
      expect.objectContaining({ $set: expect.objectContaining({ lifecycle: 'archived' }) }), { maxTimeMS: 1000 }]);
    f.get.mockResolvedValue({ ...session(), lifecycle: 'archived' });
    await expect(f.repository.delete('u1', 's1')).resolves.toBeUndefined();
  });
  it('confirms an acknowledged-lost update by rereading, otherwise fails closed', async () => {
    const f = fixture();
    f.updateOne.mockRejectedValue(new Error('ack lost'));
    f.raw.mockResolvedValue({ ...session(), title: 'New', _id: 'record', _revision: 1 });
    await expect(f.repository.update('u1', 's1', { title: 'New' })).resolves.toBeUndefined();
    f.raw.mockResolvedValue(null);
    await expect(f.repository.update('u1', 's1', { title: 'New' })).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  });
  it('does not write invalid titles or an empty update', async () => {
    const f = fixture();
    for (const changes of [{}, { title: ' ' }, { title: 'x'.repeat(81) }]) {
      await expect(f.repository.update('u1', 's1', changes)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(f.updateOne).not.toHaveBeenCalled();
  });
});
