/**
 * ============================================================================
 * FILE: session.spec.ts
 * LOCATION: backend/test/auth/session.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify closed login, local admission, refresh sid checks, and logout.
 *
 * ROLE IN PROJECT:
 *    Proves a WorkOS session is bound only after confirmed local persistence
 *    and that old sids cannot revive after deactivation or a second login.
 *
 * KEY COMPONENTS:
 *    - login/authenticate: Closed admission without development fallback.
 *    - logout: Local invalidation even when provider revocation fails.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { AuthService } from '../../src/auth/auth.service.js';
import { AuthFault } from '../../src/auth/errors.js';
import { account, authFixture } from './fixtures.js';

it('binds a provisioned account only after confirmed login persistence', async () => {
  const f = await authFixture();
  const result = await f.service.login({ email: ' A@EXAMPLE.COM ', password: 'temporary' });
  expect(result.user.passwordChangeRequired).toBe(true); expect(result.sealedSession).toBe('sealed_1');
  expect((await f.service.authenticate('sealed_1')).principal.identity.userId).toBe('u1');
  f.provider.read.mockResolvedValueOnce({ workosUserId: 'user_unmapped', sessionId: 'sid_1' });
  await expect(f.service.authenticate('other')).rejects.toThrow('UNAUTHENTICATED');
});
it('does not revive an old sid after deactivation/reactivation or a second login', async () => {
  const f = await authFixture(account({ passwordChangeRequired: false }));
  await f.service.login({ email: 'a@example.com', password: 'private' });
  const old = (await f.users.get('u1'))!;
  await f.users.compareAndSwap(old, { ...old.account, status: 'inactive', currentWorkosSessionId: null, sessionEpoch: 1 });
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
  const inactive = (await f.users.get('u1'))!;
  await f.users.compareAndSwap(inactive, { ...inactive.account, status: 'active' });
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
});
it('invalidates locally and clears current logout even when provider revocation fails', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  const p = (await f.service.authenticate('sealed_1')).principal;
  f.provider.revoke.mockRejectedValueOnce(new AuthFault('AUTH_PROVIDER_UNAVAILABLE'));
  await expect(f.service.logout(p)).rejects.toThrow('AUTH_PROVIDER_UNAVAILABLE');
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
});
it.each([
  { status: 'inactive' as const }, { workosUserId: 'user_other' },
])('rejects provider-valid credentials without matching active local admission %j', async patch => {
  const f = await authFixture(account(patch));
  await expect(f.service.login({ email: 'a@example.com', password: 'temporary' })).rejects.toThrow('UNAUTHENTICATED');
  expect(f.provider.revoke).toHaveBeenCalledWith('sid_1');
});
it('lets a concurrent deactivation defeat paused login CAS', async () => {
  const f = await authFixture();
  let release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  f.provider.login.mockImplementationOnce(async () => { await pause;
    return { workosUserId: 'user_fixture_1', sessionId: 'sid_1', sealedSession: 'sealed_1' }; });
  const loggingIn = f.service.login({ email: 'a@example.com', password: 'temporary' });
  await vi.waitFor(() => expect(f.provider.login).toHaveBeenCalledOnce());
  const before = (await f.users.get('u1'))!;
  await f.users.compareAndSwap(before, { ...before.account, status: 'inactive', sessionEpoch: 1 });
  release(); await expect(loggingIn).rejects.toThrow('NOT_READY');
  expect((await f.users.get('u1'))!.account.currentWorkosSessionId).toBeNull();
});
it('never issues a cookie on uncertain local binding', async () => {
  const f = await authFixture();
  vi.spyOn(f.users, 'compareAndSwap').mockResolvedValueOnce({ outcome: 'uncertain' });
  await expect(f.service.login({ email: 'a@example.com', password: 'temporary' })).rejects.toThrow('NOT_READY');
  expect(f.provider.revoke).toHaveBeenCalledWith('sid_1');
});
it('second login rejects old cookies and stale logout cannot erase the new sid', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1', passwordChangeRequired: false }));
  const old = (await f.service.authenticate('sealed_1')).principal;
  f.provider.login.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_2', sealedSession: 'sealed_2' });
  await f.service.login({ email: 'a@example.com', password: 'private-password' });
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
  await f.service.logout(old);
  expect((await f.users.get('u1'))!.account.currentWorkosSessionId).toBe('sid_2');
});
it('checks refreshed sid locally and never falls back when setup is absent', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  f.provider.read.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_other', sealedSession: 'rotated' });
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
  await expect(new AuthService({ users: f.users, provider: null }).authenticate('sealed_1')).rejects.toThrow('NOT_READY');
});
