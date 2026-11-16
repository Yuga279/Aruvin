/**
 * ============================================================================
 * FILE: recovery.spec.ts
 * LOCATION: backend/test/auth/recovery.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify generic mailbox recovery and confirmed reset invalidation.
 *
 * ROLE IN PROJECT:
 *    Proves forgot-password never enumerates accounts and that a confirmed
 *    reset fences old sessions without repeating provider mutation.
 *
 * KEY COMPONENTS:
 *    - forgotPassword: Uniform ok, mail only active mapped addresses.
 *    - resetPassword: Provider reset then local invalidation CAS.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { account, authFixture } from './fixtures.js';
import { AuthFault } from '../../src/auth/errors.js';
it('has one generic response and sends mail only to an active mapped address', async () => {
  const f = await authFixture();
  expect(await f.service.forgotPassword({ email: ' A@EXAMPLE.COM ' })).toEqual({ ok: true });
  expect(await f.service.forgotPassword({ email: 'unknown@example.com' })).toEqual({ ok: true });
  expect(f.provider.sendRecovery).toHaveBeenCalledTimes(1);
  expect(f.provider.sendRecovery).toHaveBeenCalledWith('a@example.com');
  f.provider.sendRecovery.mockRejectedValueOnce(new AuthFault('AUTH_TIMEOUT'));
  expect(await f.service.forgotPassword({ email: 'a@example.com' })).toEqual({ ok: true });
});
it('confirms reset locally, rejects replay through the provider, and invalidates old access', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  expect(await f.service.resetPassword({ token: 'provider-single-use-token', newPassword: 'private-password' })).toEqual({ ok: true });
  const saved = (await f.users.get('u1'))!.account;
  expect(saved.passwordChangeRequired).toBe(false); expect(saved.currentWorkosSessionId).toBeNull(); expect(saved.sessionEpoch).toBe(1);
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
  f.provider.reset.mockRejectedValueOnce(new AuthFault('UNAUTHENTICATED'));
  await expect(f.service.resetPassword({ token: 'provider-single-use-token', newPassword: 'other-private-password' })).rejects.toThrow('UNAUTHENTICATED');
  expect((await f.users.get('u1'))!.account.sessionEpoch).toBe(1);
});
it('does not mail an inactive account and rate limits unknown addresses too', async () => {
  const f = await authFixture(account({ status: 'inactive' }));
  expect(await f.service.forgotPassword({ email: 'a@example.com' })).toEqual({ ok: true });
  expect(f.provider.sendRecovery).not.toHaveBeenCalled();
  for (let n = 0; n < 3; n++) expect(await f.service.forgotPassword({ email: 'unknown@example.com' })).toEqual({ ok: true });
  await expect(f.service.forgotPassword({ email: 'unknown@example.com' })).rejects.toThrow('RATE_LIMITED');
});
it.each(['UNAUTHENTICATED', 'AUTH_TIMEOUT'] as const)('does not ungate failed/expired reset: %s', async code => {
  const f = await authFixture(); f.provider.reset.mockRejectedValueOnce(new AuthFault(code));
  await expect(f.service.resetPassword({ token: 'raw-reset-secret', newPassword: 'private-password' })).rejects.toThrow(code);
  expect((await f.users.get('u1'))!.account.passwordChangeRequired).toBe(true);
});
it('keeps inactive status and never adopts an unknown reset identity', async () => {
  const f = await authFixture(account({ status: 'inactive' }));
  await f.service.resetPassword({ token: 'token', newPassword: 'private-password' });
  expect((await f.users.get('u1'))!.account.status).toBe('inactive');
  f.provider.reset.mockResolvedValueOnce({ workosUserId: 'user_unknown' });
  await expect(f.service.resetPassword({ token: 'other-token', newPassword: 'private-password' })).rejects.toThrow('UNAUTHENTICATED');
  expect(await f.users.bySubject('user_unknown')).toBeNull();
});
it('never repeats a provider reset on local conflict or uncertain outcome', async () => {
  const f = await authFixture();
  const cas = vi.spyOn(f.users, 'compareAndSwap').mockResolvedValueOnce({ outcome: 'conflict' })
    .mockResolvedValueOnce({ outcome: 'uncertain' });
  await expect(f.service.resetPassword({ token: 'token', newPassword: 'private-password' })).rejects.toThrow('NOT_READY');
  expect(f.provider.reset).toHaveBeenCalledTimes(1); expect(cas).toHaveBeenCalledTimes(2);
  expect((await f.users.get('u1'))!.account.passwordChangeRequired).toBe(true);
});
