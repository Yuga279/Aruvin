/**
 * ============================================================================
 * FILE: auth-client.test.ts
 * LOCATION: frontend/src/api/auth-client.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for createAuthClient verifying closed routes, status handling,
 *    and credentials: 'same-origin'.
 *
 * ROLE IN PROJECT:
 *    Validates all browser-side authentication HTTP interactions against
 *    frozen protocol shapes without backend secrets.
 *
 * KEY COMPONENTS:
 *    - me / login / logout / changePassword / forgotPassword / resetPassword calls
 *    - AuthClientError mapping
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import { AuthClientError, createAuthClient } from './auth-client.ts';

describe('createAuthClient', () => {
  it('calls GET /auth/me with credentials: "same-origin" and returns AuthUser', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          user: {
            userId: 'usr-1',
            email: 'admin@example.com',
            role: 'super-admin',
            passwordChangeRequired: false,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });
    const user = await client.me();

    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
      }),
    );
    expect(user.email).toBe('admin@example.com');
    expect(user.role).toBe('super-admin');
  });

  it('maps 401 UNAUTHENTICATED to AuthClientError', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          error: { code: 'UNAUTHENTICATED', retryable: false },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });

    await expect(client.me()).rejects.toThrowError(AuthClientError);
    await expect(client.me()).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
      retryable: false,
    });
  });

  it('posts login request and returns user', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          user: {
            userId: 'usr-2',
            email: 'user@example.com',
            role: 'user',
            passwordChangeRequired: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });
    const user = await client.login({ email: 'user@example.com', password: 'TempPassword123!' });

    expect(user.passwordChangeRequired).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ email: 'user@example.com', password: 'TempPassword123!' }),
      }),
    );
  });

  it('posts logout request and handles 204 No Content', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });
    await expect(client.logout()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
  });

  it('posts forgot-password request and returns ok: true', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });
    const res = await client.forgotPassword({ email: 'someone@example.com' });
    expect(res).toEqual({ ok: true });
  });

  it('posts reset-password request and returns ok: true', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });
    const res = await client.resetPassword({ token: 'rst-token-123', newPassword: 'NewSecurePassword123!' });
    expect(res).toEqual({ ok: true });
  });
});
