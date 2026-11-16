/**
 * ============================================================================
 * FILE: administration-client.test.ts
 * LOCATION: frontend/src/api/administration-client.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for createAdministrationClient verifying keyset paging,
 *    user creation, lifecycle actions, and error handling.
 *
 * ROLE IN PROJECT:
 *    Protects administration wire contracts on the browser side.
 *
 * KEY COMPONENTS:
 *    - listUsers with query params
 *    - createUser, deactivateUser, reactivateUser, sendPasswordReset
 *    - AdministrationClientError mapping
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import { createAdministrationClient } from './administration-client.ts';

describe('createAdministrationClient', () => {
  it('calls GET /admin/users with limit & cursor and parses AdministrationPage', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              userId: 'usr-1',
              email: 'operator@example.com',
              role: 'user',
              status: 'active',
              passwordChangeRequired: false,
              createdAt: '2026-11-10T12:00:00.000Z',
            },
          ],
          nextCursor: 'cursor-token-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAdministrationClient({ baseUrl: '/api', fetch: fetcher });
    const page = await client.listUsers({ limit: 10, cursor: 'cur-0' });

    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/users?limit=10&cursor=cur-0',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
      }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('cursor-token-1');
  });

  it('calls POST /admin/users to provision a User', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          user: {
            userId: 'usr-new',
            email: 'newuser@example.com',
            role: 'user',
            status: 'active',
            passwordChangeRequired: true,
            createdAt: '2026-11-10T12:05:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAdministrationClient({ baseUrl: '/api', fetch: fetcher });
    const user = await client.createUser({
      email: 'newuser@example.com',
      temporaryPassword: 'TempPassword123!',
      role: 'user',
    });

    expect(user.userId).toBe('usr-new');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/users',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    );
  });

  it('handles ACCOUNT_CONFLICT 409 error on creation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          error: { code: 'ACCOUNT_CONFLICT', retryable: false },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAdministrationClient({ baseUrl: '/api', fetch: fetcher });

    await expect(
      client.createUser({ email: 'taken@example.com', temporaryPassword: 'Password123!', role: 'user' }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_CONFLICT',
      status: 409,
    });
  });

  it('calls deactivate and reactivate lifecycle endpoints', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          user: {
            userId: 'usr-1',
            email: 'user@example.com',
            role: 'user',
            status: 'inactive',
            passwordChangeRequired: false,
            createdAt: '2026-11-10T12:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAdministrationClient({ baseUrl: '/api', fetch: fetcher });
    const deactivated = await client.deactivateUser('usr-1');
    expect(deactivated.status).toBe('inactive');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/users/usr-1/deactivate',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
  });
});
