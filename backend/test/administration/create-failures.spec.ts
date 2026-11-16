/**
 * ============================================================================
 * FILE: create-failures.spec.ts
 * LOCATION: backend/test/administration/create-failures.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify safe duplicate and cross-service partial provisioning outcomes.
 *
 * ROLE IN PROJECT:
 *    Prevents retries from adopting or overwriting WorkOS identities.
 *    Distinguishes confirmed failure from unknown distributed outcomes.
 *
 * KEY COMPONENTS:
 *    - Conflict, unknown result, mapping mismatch and insert failures.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { AuthFault } from '../../src/auth/errors.js';
import { ProviderAccountConflict } from '../../src/auth/provider.js';
import { administrationFixture } from './fixtures.js';
const input = { email: 'new@example.com', temporaryPassword: 'password-sentinel', role: 'user' };

it('rejects local duplicates before dispatching any credential call', async () => {
  const f = await administrationFixture();
  await expect(f.service.create(f.admin, { ...input, email: ' A@EXAMPLE.COM ' }))
    .rejects.toMatchObject({ code: 'ACCOUNT_CONFLICT' });
  expect(f.provider.createUser).not.toHaveBeenCalled();
});
it('maps a pre-existing provider email to conflict without lookup, adoption or password overwrite', async () => {
  const f = await administrationFixture();
  f.provider.createUser.mockRejectedValueOnce(new ProviderAccountConflict());
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_CONFLICT', status: 409 });
  expect(f.documents.size).toBe(2);
  expect(f.provider.getUser).not.toHaveBeenCalled(); expect(f.provider.replacePassword).not.toHaveBeenCalled();
  expect(f.provider.createUser).toHaveBeenCalledTimes(1);
});
it.each([new AuthFault('AUTH_TIMEOUT'), new AuthFault('AUTH_PROVIDER_UNAVAILABLE'),
  new Error('password-sentinel provider reset-token-sentinel')])('does not retry an unknown provider creation outcome', async error => {
  const f = await administrationFixture(); f.provider.createUser.mockRejectedValueOnce(error);
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_PROVISIONING_INCOMPLETE', status: 503 });
  expect(f.provider.createUser).toHaveBeenCalledTimes(1); expect(f.documents.size).toBe(2);
});
it.each(['INVALID_REQUEST', 'RATE_LIMITED'] as const)('preserves the known safe provider rejection %s', async code => {
  const f = await administrationFixture(); f.provider.createUser.mockRejectedValueOnce(new AuthFault(code));
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code });
  expect(f.documents.size).toBe(2);
});
it.each([
  { id: '', email: 'new@example.com', externalId: 'u_created' },
  { id: 'user_new', email: 'other@example.com', externalId: 'u_created' },
  { id: 'user_new', email: 'new@example.com', externalId: 'victim' },
])('does not insert an unconfirmed provider/local mapping %j', async result => {
  const f = await administrationFixture(); f.provider.createUser.mockResolvedValueOnce(result);
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_PROVISIONING_INCOMPLETE' });
  expect(f.documents.size).toBe(2);
});
it('reports incomplete after an insert acknowledgement is lost, even if the row landed', async () => {
  const f = await administrationFixture(); const insert = f.users.insert.bind(f.users);
  vi.spyOn(f.users, 'insert').mockImplementationOnce(async a => { await insert(a); throw new Error('unknown-write'); });
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_PROVISIONING_INCOMPLETE' });
  expect(f.provider.createUser).toHaveBeenCalledTimes(1);
  expect((await f.users.get('u_created'))?.account.currentWorkosSessionId).toBeNull();
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_CONFLICT' });
  expect(f.provider.createUser).toHaveBeenCalledTimes(1);
});
it('does not show success or rerun provider creation when a local insert never lands', async () => {
  const f = await administrationFixture(); vi.spyOn(f.users, 'insert').mockRejectedValueOnce(new Error('password-sentinel'));
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_PROVISIONING_INCOMPLETE' });
  expect(await f.users.get('u_created')).toBeNull();
  expect(f.provider.createUser).toHaveBeenCalledTimes(1);
});
it('fails closed without a provider and keeps generation of internal IDs server-side', async () => {
  const f = await administrationFixture({ provider: null });
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect(f.documents.size).toBe(2);
});
