/**
 * ============================================================================
 * FILE: create.spec.ts
 * LOCATION: backend/test/administration/create.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify strict User-only provisioning and transient passwords.
 *
 * ROLE IN PROJECT:
 *    Proves provider-confirmed creation precedes safe local state.
 *    Keeps credential fields outside persisted records and response rows.
 *
 * KEY COMPONENTS:
 *    - Normalization, external ID, onboarding flag and input denials.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { isAdministrationUserResponse } from '../../src/contracts/administration.js';
import { administrationFixture } from './fixtures.js';

it('creates one server-owned User with a temporary password only at the provider boundary', async () => {
  const f = await administrationFixture();
  const result = await f.service.create(f.admin,
    { email: ' New@Example.com ', temporaryPassword: 'temporary-secret', role: 'user' });
  expect(f.provider.createUser).toHaveBeenCalledExactlyOnceWith(
    { email: 'new@example.com', password: 'temporary-secret', externalId: 'u_created' });
  expect(isAdministrationUserResponse(result)).toBe(true);
  expect(result.user).toEqual({ userId: 'u_created', email: 'new@example.com', role: 'user',
    status: 'active', passwordChangeRequired: true, createdAt: '2026-11-10T00:00:00.000Z' });
  expect((await f.users.get('u_created'))?.account).toMatchObject({ workosUserId: 'user_created',
    passwordChangeRequired: true, currentWorkosSessionId: null, sessionEpoch: 0 });
  const visible = JSON.stringify([result, [...f.documents.values()]]);
  expect(visible).not.toContain('temporary-secret');
  expect(visible).not.toContain('temporaryPassword');
  expect(f.provider.replacePassword).not.toHaveBeenCalled();
  expect(f.provider.getUser).not.toHaveBeenCalled();
});
it.each([
  { email: 'new@example.com', temporaryPassword: 'long-enough', role: 'super-admin' },
  { email: 'new@example.com', temporaryPassword: 'long-enough' },
  { email: 'not-an-email', temporaryPassword: 'long-enough', role: 'user' },
  { email: 'new@example.com', temporaryPassword: 'short', role: 'user' },
  { email: 'new@example.com', temporaryPassword: 'x'.repeat(1025), role: 'user' },
  { email: 'new@example.com', temporaryPassword: 'long-enough', role: 'user', userId: 'victim' },
  { email: 'new@example.com', temporaryPassword: 'long-enough', role: 'user', status: 'inactive' },
])('rejects a create body outside the frozen contract %j', async body => {
  const f = await administrationFixture();
  await expect(f.service.create(f.admin, body)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.provider.createUser).not.toHaveBeenCalled();
  expect(f.documents.size).toBe(2);
});
it('requires current Super Admin authorization for create as well as list', async () => {
  const f = await administrationFixture(); const body = { email: 'new@example.com', temporaryPassword: 'long-enough', role: 'user' };
  await expect(f.service.create(null, body)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(f.service.create(f.regular, body)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.provider.createUser).not.toHaveBeenCalled();
});
