/**
 * ============================================================================
 * FILE: lifecycle.spec.ts
 * LOCATION: backend/test/auth/integration/lifecycle.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify cross-service account admission and lifecycle fences.
 * ROLE IN PROJECT:
 *    Exercises real auth, administration and users repository together.
 *    Complements assembled HTTP tests without asserting live WorkOS behavior.
 * KEY COMPONENTS:
 *    - Three-owner admission, onboarding, recovery and invalidation cases.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { AuthFault } from '../../../src/auth/errors.js';
import { accounts } from './accounts.js';

it('keeps three simultaneous accounts distinct across auth and administration', async () => {
  const f = await accounts();
  const cookies = await Promise.all(['admin', 'a', 'b'].map(f.login));
  const principals = await Promise.all(cookies.map(c => f.auth.authenticate(c.sealedSession)));
  expect(principals.map(p => p.principal.account.userId)).toEqual(['admin', 'a', 'b']);
  expect((await f.admin.list(principals[0]!.principal, {})).items).toHaveLength(3);
  for (const p of principals.slice(1)) {
    await expect(f.admin.list(p.principal, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  expect(JSON.stringify([...f.storage.documents.values()])).not.toContain('fixture-private');
});

it('blocks stale cookies after deactivate and reactivate even when provider revoke fails', async () => {
  const f = await accounts();
  const admin = (await f.auth.authenticate((await f.login('admin')).sealedSession)).principal;
  const a = await f.login('a'); const b = await f.login('b');
  f.provider.revoke.mockRejectedValue(new Error('fixture provider unavailable'));
  await f.admin.deactivate(admin, 'a', {});
  expect(f.cleanup).toHaveBeenCalledWith('a');
  await expect(f.auth.authenticate(a.sealedSession)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect((await f.auth.authenticate(b.sealedSession)).principal.account.userId).toBe('b');
  await f.admin.reactivate(admin, 'a', {});
  await expect(f.auth.authenticate(a.sealedSession)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect((await f.auth.authenticate((await f.login('a')).sealedSession)).principal.account.userId).toBe('a');
});

it('keeps onboarding locked after an unknown password-change outcome', async () => {
  const f = await accounts(); const current = (await f.users.get('a'))!;
  expect((await f.users.compareAndSwap(current, { ...current.account,
    passwordChangeRequired: true })).outcome).toBe('confirmed');
  const cookie = (await f.login('a')).sealedSession;
  const principal = (await f.auth.authenticate(cookie)).principal;
  f.provider.replacePassword.mockRejectedValueOnce(new AuthFault('AUTH_TIMEOUT'));
  await expect(f.auth.password(principal, { currentPassword: 'fixture-private',
    newPassword: 'fixture-new-private' })).rejects.toMatchObject({ code: 'AUTH_TIMEOUT' });
  expect((await f.users.get('a'))!.account.passwordChangeRequired).toBe(true);
  await expect(f.auth.authenticate(cookie)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  const again = (await f.auth.authenticate((await f.login('a')).sealedSession)).principal;
  const changed = await f.auth.password(again, { currentPassword: 'fixture-private',
    newPassword: 'fixture-new-private' });
  expect(changed.user.passwordChangeRequired).toBe(false);
});

it('reset fences the old cookie and recovery does not enumerate accounts', async () => {
  const f = await accounts(); const old = await f.login('a');
  const known = await f.auth.forgotPassword({ email: 'a@example.com' });
  const unknown = await f.auth.forgotPassword({ email: 'unknown@example.com' });
  expect(known).toEqual(unknown); expect(known).toEqual({ ok: true });
  expect(f.provider.sendRecovery).toHaveBeenCalledExactlyOnceWith('a@example.com');
  f.provider.reset.mockResolvedValueOnce({ workosUserId: 'user_a' });
  expect(await f.auth.resetPassword({ token: 'fixture-reset-secret',
    newPassword: 'fixture-new-private' })).toEqual({ ok: true });
  await expect(f.auth.authenticate(old.sealedSession)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  const row = (await f.users.get('a'))!.account;
  expect(row.currentWorkosSessionId).toBeNull(); expect(row.passwordChangeRequired).toBe(false);
  const stored = JSON.stringify([...f.storage.documents.values()]);
  expect(stored).not.toContain('fixture-reset-secret'); expect(stored).not.toContain('fixture-new-private');
});

it('bounds normalized-email login and recovery attempts before provider work', async () => {
  vi.useFakeTimers();
  try {
    const f = await accounts();
    for (let n = 0; n < 10; n++) await f.auth.login({ email: ' A@EXAMPLE.COM ', password: 'fixture-private' });
    const calls = f.provider.login.mock.calls.length;
    await expect(f.login('a')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(f.provider.login).toHaveBeenCalledTimes(calls);
    await f.login('b');
    for (let n = 0; n < 3; n++) await f.auth.forgotPassword({ email: 'a@example.com' });
    await expect(f.auth.forgotPassword({ email: ' A@EXAMPLE.COM ' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await vi.advanceTimersByTimeAsync(60_000);
    await f.login('a'); await f.auth.forgotPassword({ email: 'a@example.com' });
  } finally { vi.useRealTimers(); }
});
