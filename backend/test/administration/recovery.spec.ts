/**
 * ============================================================================
 * FILE: recovery.spec.ts
 * LOCATION: backend/test/administration/recovery.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify mailbox-only admin recovery without credential disclosure.
 *
 * ROLE IN PROJECT:
 *    Separates sending mail from P1 password-reset completion.
 *    Prevents administrative reset requests from replacing credentials.
 *
 * KEY COMPONENTS:
 *    - Recorded email, role restrictions, rate bounds and safe faults.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { AuthFault } from '../../src/auth/errors.js';
import { administrationFixture } from './fixtures.js';

it('sends to the recorded mailbox, returns nothing and does not unlock/invalidate the account', async () => {
  const f = await administrationFixture(); const before = await f.users.get('u1');
  f.provider.sendRecovery.mockResolvedValueOnce({ passwordResetToken: 'token-sentinel', passwordResetUrl: 'url-sentinel' } as never);
  expect(await f.service.passwordReset(f.admin, 'u1', {})).toBeUndefined();
  expect(f.provider.sendRecovery).toHaveBeenCalledExactlyOnceWith('a@example.com');
  expect(await f.users.get('u1')).toEqual(before);
  expect(f.provider.replacePassword).not.toHaveBeenCalled(); expect(f.provider.reset).not.toHaveBeenCalled();
  expect(f.provider.revoke).not.toHaveBeenCalled();
});
it('permits recovery for an inactive User without reactivating them', async () => {
  const f = await administrationFixture(); await f.service.deactivate(f.admin, 'u1', {});
  const before = await f.users.get('u1'); await f.service.passwordReset(f.admin, 'u1', {});
  expect(await f.users.get('u1')).toEqual(before);
  expect(f.provider.sendRecovery).toHaveBeenCalledWith('a@example.com');
});
it('denies unknown, Super Admin, client email/password replacement and unauthorized requests', async () => {
  const f = await administrationFixture();
  await expect(f.service.passwordReset(f.admin, 'missing', {})).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  await expect(f.service.passwordReset(f.admin, 'admin', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.service.passwordReset(f.regular, 'u1', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.service.passwordReset(null, 'u1', {})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  for (const body of [{ email: 'attacker@example.com' }, { password: 'admin-chosen' }, { token: 'raw' }])
    await expect(f.service.passwordReset(f.admin, 'u1', body)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.provider.sendRecovery).not.toHaveBeenCalled();
});
it('applies a three-per-minute per-email send limit and a finite global operation limit', async () => {
  const f = await administrationFixture();
  for (let n = 0; n < 3; n++) await f.service.passwordReset(f.admin, 'u1', {});
  await expect(f.service.passwordReset(f.admin, 'u1', {})).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  expect(f.provider.sendRecovery).toHaveBeenCalledTimes(3);
  const g = await administrationFixture();
  for (let n = 0; n < 60; n++) await g.service.list(g.admin, {});
  await expect(g.service.list(g.admin, {})).rejects.toMatchObject({ code: 'RATE_LIMITED' });
});
it('propagates safe timeout but never provider payloads and never changes account state on send failure', async () => {
  const f = await administrationFixture(); const before = await f.users.get('u1');
  f.provider.sendRecovery.mockRejectedValueOnce(new AuthFault('AUTH_TIMEOUT'));
  await expect(f.service.passwordReset(f.admin, 'u1', {})).rejects.toMatchObject({ code: 'AUTH_TIMEOUT' });
  f.provider.sendRecovery.mockRejectedValueOnce(new Error('password=secret&token=secret&url=secret'));
  await expect(f.service.passwordReset(f.admin, 'u1', {})).rejects.toMatchObject({ code: 'NOT_READY' });
  expect(await f.users.get('u1')).toEqual(before);
});
