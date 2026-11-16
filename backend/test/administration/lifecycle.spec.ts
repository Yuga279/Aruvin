/**
 * ============================================================================
 * FILE: lifecycle.spec.ts
 * LOCATION: backend/test/administration/lifecycle.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify User-only lifecycle writes and non-resurrecting sessions.
 *
 * ROLE IN PROJECT:
 *    Exercises real MongoUsers CAS plus P1 cookie admission.
 *    Protects local lifecycle fencing against stale requests and races.
 *
 * KEY COMPONENTS:
 *    - Deactivate/reactivate, refusals, uncertainty and login races.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { AuthService } from '../../src/auth/auth.service.js';
import { administrationFixture } from './fixtures.js';

it('deactivates durably, rejects stale cookies and reactivates without restoring their SID', async () => {
  const f = await administrationFixture();
  const auth = new AuthService({ users: f.users, provider: f.provider });
  expect((await auth.authenticate('sealed_1')).principal.account.userId).toBe('u1');
  const disabled = await f.service.deactivate(f.admin, 'u1', {});
  expect(disabled.user.status).toBe('inactive');
  expect((await f.users.get('u1'))?.account).toMatchObject({ status: 'inactive',
    currentWorkosSessionId: null, sessionEpoch: 1, passwordChangeRequired: false });
  await expect(auth.authenticate('sealed_1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  const enabled = await f.service.reactivate(f.admin, 'u1', {});
  expect(enabled.user.status).toBe('active');
  expect((await f.users.get('u1'))?.account).toMatchObject({ currentWorkosSessionId: null, sessionEpoch: 1 });
  await expect(auth.authenticate('sealed_1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  f.provider.login.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_fresh', sealedSession: 'sealed_fresh' });
  await auth.login({ email: 'a@example.com', password: 'private-password' });
  f.provider.read.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_fresh' });
  expect((await auth.authenticate('sealed_fresh')).principal.account.userId).toBe('u1');
});
it.each(['deactivate', 'reactivate'] as const)('refuses unknown, Super Admin, malformed and unauthorized %s targets', async action => {
  const f = await administrationFixture();
  await expect(f.service[action](f.admin, 'missing', {})).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  await expect(f.service[action](f.admin, 'admin', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.service[action](f.admin, '', {})).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.service[action](f.admin, 'u1', { userId: 'admin' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.service[action](f.regular, 'u1', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.service[action](null, 'u1', {})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
});
it('preserves onboarding and makes repeated lifecycle commands local no-ops', async () => {
  const f = await administrationFixture(); const before = (await f.users.get('u1'))!;
  await f.users.compareAndSwap(before, { ...before.account, passwordChangeRequired: true });
  await f.service.deactivate(f.admin, 'u1', {});
  const disabled = (await f.users.get('u1'))!;
  await f.service.deactivate(f.admin, 'u1', {});
  expect(await f.users.get('u1')).toEqual(disabled);
  await f.service.reactivate(f.admin, 'u1', {});
  const active = (await f.users.get('u1'))!;
  expect(active.account.passwordChangeRequired).toBe(true);
  await f.service.reactivate(f.admin, 'u1', {});
  expect(await f.users.get('u1')).toEqual(active);
});
it.each(['conflict', 'uncertain'] as const)('never reports successful deactivation on CAS %s', async outcome => {
  const f = await administrationFixture();
  vi.spyOn(f.users, 'compareAndSwap').mockResolvedValueOnce({ outcome });
  await expect(f.service.deactivate(f.admin, 'u1', {})).rejects.toMatchObject({
    code: outcome === 'conflict' ? 'ACCOUNT_CONFLICT' : 'ACCOUNT_WRITE_UNCERTAIN',
  });
  expect((await f.users.get('u1'))?.account.status).toBe('active');
  expect(f.provider.listSessions).not.toHaveBeenCalled();
});
it('treats a thrown mutation as uncertain rather than retrying or claiming success', async () => {
  const f = await administrationFixture();
  vi.spyOn(f.users, 'compareAndSwap').mockRejectedValueOnce(new Error('unknown-write'));
  await expect(f.service.deactivate(f.admin, 'u1', {})).rejects.toMatchObject({ code: 'ACCOUNT_WRITE_UNCERTAIN' });
});
it('lets deactivation win against a login that captured the earlier account revision', async () => {
  const f = await administrationFixture();
  let entered!: () => void; let finish!: () => void;
  const began = new Promise<void>(resolve => { entered = resolve; });
  const release = new Promise<void>(resolve => { finish = resolve; });
  f.provider.login.mockImplementationOnce(async () => {
    entered(); await release;
    return { workosUserId: 'user_fixture_1', sessionId: 'sid_racing', sealedSession: 'sealed_racing' };
  });
  const auth = new AuthService({ users: f.users, provider: f.provider });
  const login = auth.login({ email: 'a@example.com', password: 'private-password' });
  const denied = expect(login).rejects.toMatchObject({ code: 'NOT_READY' });
  await began; await f.service.deactivate(f.admin, 'u1', {}); finish(); await denied;
  expect((await f.users.get('u1'))?.account).toMatchObject({ status: 'inactive', currentWorkosSessionId: null });
  expect(f.provider.revoke).toHaveBeenCalledWith('sid_racing');
});
