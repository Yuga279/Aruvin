/**
 * ============================================================================
 * FILE: password.spec.ts
 * LOCATION: backend/test/auth/password.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify confirmed private password replacement and onboarding un-gating.
 *
 * ROLE IN PROJECT:
 *    Proves the current password is authenticated for the same WorkOS subject
 *    before a credential mutation, and that failed writes keep the gate.
 *
 * KEY COMPONENTS:
 *    - password(): Proof, fence, replace, fresh session, confirmed un-gate.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { account, authFixture } from './fixtures.js';
import { AuthFault } from '../../src/auth/errors.js';
it('confirms current password, replaces provider credential, and only then unlocks a fresh sid', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  const p = (await f.service.authenticate('sealed_1')).principal;
  f.provider.login.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_verify', sealedSession: 'verify' })
    .mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_private', sealedSession: 'private' });
  const r = await f.service.password(p, { currentPassword: 'temporary', newPassword: 'private-password' });
  expect(f.provider.replacePassword).toHaveBeenCalledWith('user_fixture_1', 'private-password');
  expect(f.provider.revoke).toHaveBeenCalledWith('sid_verify');
  expect(r).toEqual({ user: { userId: 'u1', email: 'a@example.com', role: 'user', passwordChangeRequired: false }, sealedSession: 'private' });
  const saved = (await f.users.get('u1'))!.account;
  expect(saved.currentWorkosSessionId).toBe('sid_private'); expect(saved.sessionEpoch).toBe(1);
});
it('never lifts the gate for equal passwords or unknown provider replacement', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  const p = (await f.service.authenticate('sealed_1')).principal;
  await expect(f.service.password(p, { currentPassword: 'temporary', newPassword: 'temporary' })).rejects.toThrow('INVALID_REQUEST');
  expect(f.provider.replacePassword).not.toHaveBeenCalled();
  f.provider.replacePassword.mockRejectedValueOnce(new AuthFault('AUTH_TIMEOUT'));
  await expect(f.service.password(p, { currentPassword: 'temporary', newPassword: 'private-password' })).rejects.toThrow('AUTH_TIMEOUT');
  expect((await f.users.get('u1'))!.account.passwordChangeRequired).toBe(true);
});
it('restores session when provider replacement rejects invalid request', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  const p = (await f.service.authenticate('sealed_1')).principal;
  f.provider.replacePassword.mockRejectedValueOnce(new AuthFault('INVALID_REQUEST'));
  await expect(f.service.password(p, { currentPassword: 'temporary', newPassword: 'private-password' })).rejects.toThrow('INVALID_REQUEST');
  expect((await f.users.get('u1'))!.account.currentWorkosSessionId).toBe('sid_1');
  expect((await f.users.get('u1'))!.account.passwordChangeRequired).toBe(true);
});
it.each(['UNAUTHENTICATED', 'AUTH_TIMEOUT', 'AUTH_PROVIDER_UNAVAILABLE'] as const)
  ('keeps onboarding gated on failed current-password proof: %s', async code => {
    const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
    const p = (await f.service.authenticate('sealed_1')).principal;
    f.provider.login.mockRejectedValueOnce(new AuthFault(code));
    await expect(f.service.password(p, { currentPassword: 'temporary', newPassword: 'private-password' })).rejects.toThrow(code);
    expect(f.provider.replacePassword).not.toHaveBeenCalled();
    expect((await f.users.get('u1'))!.account.passwordChangeRequired).toBe(true);
  });
it.each(['conflict', 'uncertain'] as const)('never unlocks an unconfirmed final password write: %s', async outcome => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  const p = (await f.service.authenticate('sealed_1')).principal;
  const realCas = f.users.compareAndSwap.bind(f.users); let writes = 0;
  vi.spyOn(f.users, 'compareAndSwap').mockImplementation(async (expected, next) =>
    ++writes === 1 ? realCas(expected, next) : { outcome });
  f.provider.login.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_proof', sealedSession: 'proof' })
    .mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_new', sealedSession: 'new' });
  await expect(f.service.password(p, { currentPassword: 'temporary', newPassword: 'private-password' })).rejects.toThrow('NOT_READY');
  expect((await f.users.get('u1'))!.account.passwordChangeRequired).toBe(true);
  expect((await f.users.get('u1'))!.account.currentWorkosSessionId).toBeNull();
  expect(f.provider.revoke).toHaveBeenCalledWith('sid_new');
});
it('rejects a proof for another subject and a verification revocation failure', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1', passwordChangeRequired: false }));
  const p = (await f.service.authenticate('sealed_1')).principal;
  f.provider.login.mockResolvedValueOnce({ workosUserId: 'user_other', sessionId: 'sid_proof', sealedSession: 'proof' });
  await expect(f.service.password(p, { currentPassword: 'private-old', newPassword: 'private-new' })).rejects.toThrow('UNAUTHENTICATED');
  f.provider.revoke.mockRejectedValueOnce(new AuthFault('AUTH_PROVIDER_UNAVAILABLE'));
  await expect(f.service.password(p, { currentPassword: 'private-old', newPassword: 'private-new' })).rejects.toThrow('AUTH_PROVIDER_UNAVAILABLE');
  expect(f.provider.replacePassword).not.toHaveBeenCalled();
});
