/**
 * ============================================================================
 * FILE: auth-users.spec.ts
 * LOCATION: backend/test/persistence/auth-users.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify bounded users reads, CAS identity immutability, and uniqueness.
 *
 * ROLE IN PROJECT:
 *    Proves the P1 users repository stores only schema-valid accounts and
 *    rejects stale, retargeted, or secret-bearing writes without Mongo.
 *
 * KEY COMPONENTS:
 *    - insert/CAS tests: Confirmed receipts and immutable identity fields.
 *    - Malformed-storage tests: Casing, revision, and id envelope rejection.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { APP_INDEXES } from '../../src/persistence/indexes.js';
import { MongoUsers } from '../../src/persistence/users.js';
import { account } from '../auth/fixtures.js';
import { usersStore } from './auth-users-fixture.js';
it('stores only a bounded account and rejects stale or retargeted CAS', async () => {
  const f = usersStore();
  const users = new MongoUsers(f.store, f.owner, 8192);
  const saved = await users.insert(account());
  expect(saved.revision).toBe(0);
  expect((await users.bySubject('user_fixture_1'))?.account.userId).toBe('u1');
  expect((await users.byEmail('a@example.com'))?.account).toEqual(account());
  const result = await users.compareAndSwap(saved, { ...saved.account, currentWorkosSessionId: 'sid_1' });
  expect(result.outcome).toBe('confirmed');
  expect((await users.compareAndSwap(saved, { ...saved.account, status: 'inactive' })).outcome).toBe('conflict');
  const current = (await users.get('u1'))!;
  await expect(users.compareAndSwap(current, { ...current.account, workosUserId: 'user_other' })).rejects.toThrow();
  await expect(users.insert({ ...account({ userId: 'u2' }), password: 'never-persist' } as never)).rejects.toThrow();
  expect(JSON.stringify([...f.documents.values()])).not.toContain('never-persist');
  expect(f.owner.assertExecutor).toHaveBeenCalled();
});
it.each([
  { emailNormalized: 'A@EXAMPLE.COM' }, { _revision: -1 }, { _id: 'wrong-id' },
])('rejects malformed stored account %j', async patch => {
  const f = usersStore(); const users = new MongoUsers(f.store, f.owner, 8192);
  await users.insert(account());
  f.documents.set('u1', { ...f.documents.get('u1')!, ...patch });
  await expect(users.bySubject('user_fixture_1')).rejects.toThrow();
});
it('rejects duplicate identities, byte overflow, epoch rollback and uncertain acknowledgement', async () => {
  const f = usersStore(); const users = new MongoUsers(f.store, f.owner, 8192);
  const saved = await users.insert(account({ sessionEpoch: 1 }));
  await expect(users.insert(account({ userId: 'u2' }))).rejects.toThrow();
  await expect(users.insert(account({ userId: 'u2', workosUserId: 'user_2' }))).rejects.toThrow();
  await expect(users.insert(account({ emailNormalized: 'other@example.com' }))).rejects.toThrow();
  await expect(new MongoUsers(f.store, f.owner, 100).insert(account({ userId: 'u3' }))).rejects.toThrow();
  await expect(users.compareAndSwap(saved, { ...saved.account, sessionEpoch: 0 })).rejects.toThrow();
  f.collection.replaceOne.mockImplementationOnce(async () => { throw new Error('unknown'); });
  expect((await users.compareAndSwap(saved, { ...saved.account, status: 'inactive' })).outcome).toBe('uncertain');
});
it('never confirms a write after executor ownership is lost', async () => {
  const f = usersStore(); const users = new MongoUsers(f.store, f.owner, 8192);
  const saved = await users.insert(account());
  f.owner.assertExecutor.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lost'));
  expect((await users.compareAndSwap(saved, { ...saved.account, status: 'inactive' })).outcome).toBe('uncertain');
});
it('registers unique subjects and email plus stable bounded paging', async () => {
  expect(APP_INDEXES).toContainEqual({ collection: 'users', keys: { workosUserId: 1 }, options: { name: 'users_workos_subject', unique: true } });
  expect(APP_INDEXES).toContainEqual({ collection: 'users', keys: { emailNormalized: 1 }, options: { name: 'users_email', unique: true } });
  const f = usersStore(); const users = new MongoUsers(f.store, f.owner, 8192);
  for (const n of [1, 2, 3]) await users.insert(account({ userId: `u${n}`, workosUserId: `user_${n}`, emailNormalized: `u${n}@example.com` }));
  const first = await users.list({ limit: 2 });
  expect(first.items.map(x => x.account.userId)).toEqual(['u3', 'u2']);
  expect(f.collection.find).toHaveBeenCalledWith({}, { maxTimeMS: 1000 });
  expect(f.collection.find.mock.results[0]!.value.limit).toHaveBeenCalledWith(3);
  const last = await users.list({ limit: 2, cursor: first.nextCursor! });
  expect(last.items.map(x => x.account.userId)).toEqual(['u1']);
  expect(last.nextCursor).toBeNull();
  await expect(users.list({ limit: 51 })).rejects.toThrow();
  await expect(users.list({ cursor: 'not-json' })).rejects.toThrow();
  const persistence = readFileSync(new URL('../../src/persistence/persistence.ts', import.meta.url), 'utf8');
  const journal = readFileSync(new URL('../../src/persistence/mutation-journal.ts', import.meta.url), 'utf8');
  expect(persistence).toContain('users: new MongoUsers(store, owner, budgets.maxDocumentBytes)');
  expect(journal).toContain("'users'");
});
