/**
 * ============================================================================
 * FILE: list.spec.ts
 * LOCATION: backend/test/administration/list.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify current-role admission, safe rows and bounded keyset pages.
 *
 * ROLE IN PROJECT:
 *    Exercises service authorization against real fixture CAS.
 *    Checks that repository paging remains the sole ordering mechanism.
 *
 * KEY COMPONENTS:
 *    - Denials, projection, limit and cursor regression cases.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { isAdministrationPage } from '../../src/contracts/administration.js';
import { account } from '../auth/fixtures.js';
import { administrationFixture } from './fixtures.js';

it('denies anonymous, ordinary User and onboarding access before listing', async () => {
  const f = await administrationFixture();
  await expect(f.service.list(null, {})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(f.service.list(f.regular, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const current = (await f.users.get('admin'))!;
  await f.users.compareAndSwap(current, { ...current.account, passwordChangeRequired: true });
  await expect(f.service.list(f.admin, {})).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  expect(f.collection.find).not.toHaveBeenCalled();
});
it('reloads current local admission instead of trusting a stale admin snapshot', async () => {
  const f = await administrationFixture(); const current = (await f.users.get('admin'))!;
  await f.users.compareAndSwap(current, { ...current.account, status: 'inactive', currentWorkosSessionId: null });
  await expect(f.service.list(f.admin, {})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(f.collection.find).not.toHaveBeenCalled();
});
it('returns exactly six public fields and preserves stable opaque keyset ordering', async () => {
  const f = await administrationFixture();
  for (const n of [2, 3]) await f.users.insert(account({ userId: `u${n}`, workosUserId: `user_${n}`,
    emailNormalized: `u${n}@example.com` }));
  const first = await f.service.list(f.admin, { limit: '2' });
  expect(isAdministrationPage(first)).toBe(true);
  expect(first.items.map(x => x.userId)).toEqual(['u3', 'u2']);
  expect(Object.keys(first.items[0]!).sort()).toEqual(
    ['createdAt', 'email', 'passwordChangeRequired', 'role', 'status', 'userId']);
  const last = await f.service.list(f.admin, { limit: '2', cursor: first.nextCursor });
  expect(last.items.map(x => x.userId)).toEqual(['u1', 'admin']);
  expect(last.nextCursor).toBeNull();
  for (const forbidden of ['workosUserId', 'currentWorkosSessionId', 'sessionEpoch', 'revision'])
    expect(JSON.stringify(first)).not.toContain(forbidden);
});
it('uses default 20, maximum 50, and rejects malformed queries and cursors', async () => {
  const f = await administrationFixture();
  for (let n = 2; n <= 52; n++) await f.users.insert(account({ userId: `u${n}`,
    workosUserId: `user_${n}`, emailNormalized: `u${n}@example.com` }));
  expect((await f.service.list(f.admin, {})).items).toHaveLength(20);
  expect((await f.service.list(f.admin, { limit: '50' })).items).toHaveLength(50);
  for (const query of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { limit: 'NaN' },
    { limit: ['1', '2'] }, { cursor: '' }, { cursor: 'x'.repeat(513) }, { cursor: 'not-json' },
    { cursor: Buffer.from(JSON.stringify(['bad-date', 'u1'])).toString('base64url') }, { userId: 'victim' }])
    await expect(f.service.list(f.admin, query)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});
