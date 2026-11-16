/**
 * ============================================================================
 * FILE: provider.spec.ts
 * LOCATION: backend/test/auth/provider.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the WorkOS adapter seals sessions and never returns raw tokens.
 *
 * ROLE IN PROJECT:
 *    Proves SDK password/session/recovery mapping with injected stubs, without
 *    network or JWKS, and bounds in-flight provider operations.
 *
 * KEY COMPONENTS:
 *    - login/read: Sealed session validation and refresh.
 *    - recovery/reset: Token discard and user-id mapping.
 * ============================================================================
 */

import { AuthenticationException } from '@workos-inc/node';
import { expect, it, vi } from 'vitest';
import { createWorkosProvider, WorkosProvider } from '../../src/auth/provider.js';

const WorkOS = vi.hoisted(() => vi.fn(function (this: { userManagement: object }) {
  this.userManagement = {};
  return this;
}));
vi.mock('@workos-inc/node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workos-inc/node')>();
  return { ...actual, WorkOS };
});
it('uses SDK sealing/issuer validation and never returns raw SDK tokens', async () => {
  const authenticate = vi.fn(async () => ({ authenticated: true, user: { id: 'user_fixture_1' }, sessionId: 'sid_1' }));
  const um = { authenticateWithPassword: vi.fn(async () => ({ user: { id: 'user_fixture_1' },
    sealedSession: 'sealed', accessToken: 'raw-access', refreshToken: 'raw-refresh' })),
    loadSealedSession: vi.fn(() => ({ authenticate, refresh: vi.fn() })) };
  const p = new WorkosProvider({ clientId: 'client_fixture', cookiePassword: 'f'.repeat(32) }, um as never);
  expect(await p.login('a@example.com', 'password')).toEqual({ workosUserId: 'user_fixture_1', sessionId: 'sid_1', sealedSession: 'sealed' });
  expect(um.authenticateWithPassword).toHaveBeenCalledWith({ clientId: 'client_fixture', email: 'a@example.com', password: 'password',
    session: { sealSession: true, cookiePassword: 'f'.repeat(32) } });
  expect(JSON.stringify(await p.read('sealed'))).not.toContain('raw-');
});
function sdkFixture() {
  const authenticate = vi.fn(); const refresh = vi.fn();
  const session = { authenticate, refresh };
  const um = { authenticateWithPassword: vi.fn(), loadSealedSession: vi.fn(() => session),
    createPasswordReset: vi.fn(), resetPassword: vi.fn(), revokeSession: vi.fn(), updateUser: vi.fn() };
  return { um, authenticate, refresh, provider: new WorkosProvider(
    { clientId: 'client_fixture', cookiePassword: 'f'.repeat(32) }, um as never) };
}
it('bounds hung SDK operations and retains in-flight slots until settlement', async () => {
  vi.useFakeTimers();
  try {
    const f = sdkFixture(); f.um.createPasswordReset.mockImplementation(() => new Promise(() => undefined));
    const jobs = Array.from({ length: 4 }, () => f.provider.sendRecovery('a@example.com'));
    const outcomes = Promise.allSettled(jobs);
    await expect(f.provider.sendRecovery('a@example.com')).rejects.toThrow('RATE_LIMITED');
    await vi.advanceTimersByTimeAsync(10000);
    expect((await outcomes).every(r => r.status === 'rejected' && r.reason.message === 'AUTH_TIMEOUT')).toBe(true);
    await expect(f.provider.sendRecovery('a@example.com')).rejects.toThrow('RATE_LIMITED');
  } finally { vi.useRealTimers(); }
});
it('discards generated recovery tokens and maps SDK reset user correctly', async () => {
  const f = sdkFixture();
  f.um.createPasswordReset.mockResolvedValue({ passwordResetToken: 'raw-reset-token', passwordResetUrl: 'https://secret.example/reset' });
  expect(await f.provider.sendRecovery('a@example.com')).toBeUndefined();
  f.um.resetPassword.mockResolvedValue({ user: { id: 'user_fixture_1' } });
  expect(await f.provider.reset('token', 'private-password')).toEqual({ workosUserId: 'user_fixture_1' });
});
it.each([true, false])('handles refresh retryable=%s without invented expiry reasons', async retryable => {
  const f = sdkFixture();
  f.authenticate.mockResolvedValue({ authenticated: false, reason: 'invalid_jwt' });
  f.refresh.mockResolvedValue({ authenticated: false, retryable });
  await expect(f.provider.read('sealed')).rejects.toThrow(retryable ? 'AUTH_PROVIDER_UNAVAILABLE' : 'UNAUTHENTICATED');
});
it('revalidates a rotated sealed session and does not refresh malformed cookies', async () => {
  const f = sdkFixture();
  f.authenticate.mockResolvedValueOnce({ authenticated: false, reason: 'invalid_jwt' })
    .mockResolvedValueOnce({ authenticated: true, sessionId: 'sid_rotated', user: { id: 'user_fixture_1' } });
  f.refresh.mockResolvedValueOnce({ authenticated: true, sealedSession: 'rotated' });
  expect(await f.provider.read('sealed')).toEqual({ workosUserId: 'user_fixture_1', sessionId: 'sid_rotated', sealedSession: 'rotated' });
  f.authenticate.mockResolvedValueOnce({ authenticated: false, reason: 'invalid_session_cookie' });
  await expect(f.provider.read('bad')).rejects.toThrow('UNAUTHENTICATED');
  expect(f.refresh).toHaveBeenCalledTimes(1);
});
it.each(['email_verification_required', 'mfa_challenge'] as const)(
  'maps SDK %s to UNAUTHENTICATED without exposing pending tokens',
  async code => {
    const f = sdkFixture();
    f.um.authenticateWithPassword.mockRejectedValueOnce(
      new AuthenticationException(400, { code, pending_authentication_token: 'raw-pending' }, 'fixture-request'),
    );
    await expect(f.provider.login('a@example.com', 'password')).rejects.toThrow('UNAUTHENTICATED');
    await expect(f.provider.login('a@example.com', 'password')).rejects.not.toThrow(/raw-pending/);
  },
);
it('configures the official SDK with issuer, timeout, and no retries', () => {
  expect(createWorkosProvider({
    apiKey: 'sk_fixture', clientId: 'client_fixture', cookiePassword: 'f'.repeat(32),
  })).toBeInstanceOf(WorkosProvider);
  expect(WorkOS).toHaveBeenCalledWith('sk_fixture', {
    clientId: 'client_fixture',
    issuer: 'https://api.workos.com/user_management/client_fixture',
    timeout: 10000,
    maxRetries: 0,
  });
});
