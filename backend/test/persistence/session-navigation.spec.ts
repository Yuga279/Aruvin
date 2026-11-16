/**
 * ============================================================================
 * FILE: session-navigation.spec.ts
 * LOCATION: backend/test/persistence/session-navigation.spec.ts
 * ============================================================================
 * PURPOSE: Verify bounded navigation queries and legacy-aware keyset ordering.
 * ROLE IN PROJECT: Deterministic repository regressions; not query-planner evidence.
 * KEY COMPONENTS: Pin partitions, cursor boundaries, transitions, and user isolation.
 * ============================================================================
 */
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { APP_INDEXES } from '../../src/persistence/indexes.js';
import { cursor } from '../../src/persistence/pagination.js';
import { key } from '../../src/persistence/records.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { calendarMemory } from './calendar-multi-memory.js';
import { at, session } from './fixtures.js';

function fixture() {
  const mem = calendarMemory();
  const repository = new MongoSessions(mem.store, DEFAULT_BUDGETS);
  const add = (id: string, pinned?: boolean | null, overrides = {}) => {
    const record = { ...session('u1', id), latestTurnId: 't1', ...overrides,
      ...(pinned !== undefined ? { pinned } : {}), _id: key('session', 'u1', id), _revision: 0 };
    mem.rows('sessions').set(record._id, record);
  };
  return { ...mem, repository, add };
}

describe('session navigation', () => {
  it('uses bounded sorted equality reads with an additive navigation index', async () => {
    const f = fixture();
    const collection = f.store.collection('sessions');
    const originalFind = collection.find.bind(collection);
    const cursors: { sort: ReturnType<typeof vi.spyOn>; limit: ReturnType<typeof vi.spyOn> }[] = [];
    const find = vi.spyOn(collection, 'find').mockImplementation((...args) => {
      const result = originalFind(...args);
      cursors.push({ sort: vi.spyOn(result, 'sort'), limit: vi.spyOn(result, 'limit') });
      return result;
    });
    const aggregate = vi.spyOn(collection, 'aggregate');
    vi.spyOn(f.store, 'collection').mockReturnValue(collection);
    await f.repository.list('u1', { limit: 2, cursor: null });
    expect(aggregate).not.toHaveBeenCalled();
    expect(find.mock.calls.map(([filter]) => filter)).toEqual([true, false, null].map(pinned => ({
      userId: 'u1', lifecycle: 'active', latestTurnId: { $ne: null }, pinned,
    })));
    expect(find.mock.calls.every(([, options]) => options?.maxTimeMS === 1000)).toBe(true);
    expect(cursors).toHaveLength(3);
    for (const read of cursors) {
      expect(read.sort).toHaveBeenCalledWith({ lastActivityAt: -1, sessionId: -1 });
      expect(read.limit).toHaveBeenCalledWith(3);
    }
    expect(APP_INDEXES).toContainEqual({ collection: 'sessions',
      keys: { userId: 1, lifecycle: 1, pinned: 1, lastActivityAt: -1, sessionId: -1 },
      options: { name: 'user_lifecycle_pin_activity_session' } });
    expect(APP_INDEXES).toContainEqual({ collection: 'sessions',
      keys: { userId: 1, lastActivityAt: -1, sessionId: -1 },
      options: { name: 'user_activity_session' } });
  });

  it('paginates tied activity across true, false, missing and null without changing stored flags', async () => {
    const f = fixture();
    for (const [id, pin] of [['z', true], ['y', true], ['d', false], ['c', null], ['b', undefined], ['a', false]] as const)
      f.add(id, pin);
    f.add('newest', null, { lastActivityAt: '2026-10-07T00:00:00.000Z' });
    f.add('oldest', undefined, { lastActivityAt: '2026-10-05T00:00:00.000Z' });
    const before = [...f.rows('sessions').values()].map(row => ({ ...row }));
    for (const limit of [1, 2, 3, 5, 10]) {
      const ids: string[] = [];
      let next: string | null = null;
      do {
        const result = await f.repository.list('u1', { limit, cursor: next });
        ids.push(...result.items.map(item => item.sessionId));
        expect(result.items.every(item => typeof item.pinned === 'boolean')).toBe(true);
        next = result.nextCursor;
        expect(ids.length).toBeLessThanOrEqual(8);
      } while (next);
      expect(ids).toEqual(['z', 'y', 'newest', 'd', 'c', 'b', 'a', 'oldest']);
    }
    expect([...f.rows('sessions').values()]).toEqual(before);
    expect(f.calls.every(call => call.method === 'find')).toBe(true);
  });

  it('retains legacy cursor semantics and filters ownership, lifecycle and acceptance in every partition', async () => {
    const f = fixture();
    for (const pin of [true, false, null, undefined]) {
      const suffix = String(pin);
      f.add(`other-${suffix}`, pin, { userId: 'u2' });
      f.add(`archived-${suffix}`, pin, { lifecycle: 'archived' });
      f.add(`empty-${suffix}`, pin, { latestTurnId: null });
      f.add(`missing-turn-${suffix}`, pin);
      delete f.rows('sessions').get(key('session', 'u1', `missing-turn-${suffix}`))!.latestTurnId;
    }
    f.add('z', true);
    f.add('c', false);
    f.add('b', null);
    f.add('a');
    const legacy = cursor({ kind: 'sessions', userId: 'u1', sessionId: '', value: at, id: 'c' });
    const result = await f.repository.list('u1', { limit: 10, cursor: legacy });
    expect(result.items.map(item => item.sessionId)).toEqual(['b', 'a']);
    expect(result.nextCursor).toBeNull();
    expect((await f.repository.list('u1', { limit: 10, cursor: null })).items.map(item => item.sessionId))
      .toEqual(['z', 'c', 'b', 'a']);
    await expect(f.repository.list('u2', { limit: 10, cursor: legacy })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('uses the cursor pin snapshot when pins change between pages and fresh lists reflect transitions', async () => {
    const f = fixture();
    f.add('a', true);
    f.add('c', false);
    f.add('b', null);
    const first = await f.repository.list('u1', { limit: 1, cursor: null });
    expect(first.items.map(item => item.sessionId)).toEqual(['a']);
    await f.repository.update('u1', 'a', { pinned: false });
    await f.repository.update('u1', 'b', { pinned: true });
    const second = await f.repository.list('u1', { limit: 1, cursor: first.nextCursor });
    expect(second.items.map(item => item.sessionId)).toEqual(['c']);
    await f.repository.update('u1', 'a', { pinned: true });
    const third = await f.repository.list('u1', { limit: 1, cursor: second.nextCursor });
    expect(third.items).toEqual([]);
    expect(third.nextCursor).toBeNull();
    expect((await f.repository.list('u1', { limit: 10, cursor: null })).items.map(item => item.sessionId))
      .toEqual(['b', 'a', 'c']);
  });

  it('merges legacy and explicit flags in Mongo binary rather than locale or UTF-16 order', async () => {
    const f = fixture();
    f.add('\uE000', false);
    f.add('\u{10000}', null);
    const first = await f.repository.list('u1', { limit: 1, cursor: null });
    expect(first.items.map(item => item.sessionId)).toEqual(['\u{10000}']);
    expect((await f.repository.list('u1', { limit: 2, cursor: null })).items.map(item => item.sessionId))
      .toEqual(['\u{10000}', '\uE000']);
  });
});
