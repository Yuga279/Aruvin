/**
 * ============================================================================
 * FILE: fixtures.ts
 * LOCATION: backend/test/auth/fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide bounded account and provider fixtures for isolated auth tests.
 *
 * ROLE IN PROJECT:
 *    Shares one valid UserAccount factory and later auth-service/provider
 *    stubs so P1 tests do not invent a second in-memory account store.
 *
 * KEY COMPONENTS:
 *    - account() / admittedAccount(): Local account records for repository tests.
 *    - SESSION_COOKIE: Sealed cookie matching providerFixture().read.
 * ============================================================================
 */

import { vi } from 'vitest';
import { AuthService } from '../../src/auth/auth.service.js';
import type { AuthProvider } from '../../src/auth/provider.js';
import type { UserAccount } from '../../src/contracts/auth.js';
import { MongoUsers } from '../../src/persistence/users.js';
import { usersStore } from '../persistence/auth-users-fixture.js';

export const at = '2026-11-10T00:00:00.000Z';
export const SESSION_COOKIE = 'aurvin_wos_session=sealed_1';
export function account(patch: Partial<UserAccount> = {}): UserAccount {
  return { schemaVersion: 1, userId: 'u1', workosUserId: 'user_fixture_1', emailNormalized: 'a@example.com',
    role: 'user', status: 'active', passwordChangeRequired: true, currentWorkosSessionId: null,
    sessionEpoch: 0, createdAt: at, updatedAt: at, ...patch };
}
export function admittedAccount(patch: Partial<UserAccount> = {}): UserAccount {
  return account({ passwordChangeRequired: false, currentWorkosSessionId: 'sid_1', ...patch });
}
export function providerFixture() {
  return {
    login: vi.fn<AuthProvider['login']>(async () => ({ workosUserId: 'user_fixture_1', sessionId: 'sid_1', sealedSession: 'sealed_1' })),
    read: vi.fn<AuthProvider['read']>(async () => ({ workosUserId: 'user_fixture_1', sessionId: 'sid_1' })),
    revoke: vi.fn<AuthProvider['revoke']>(async () => undefined),
    replacePassword: vi.fn<AuthProvider['replacePassword']>(async () => undefined),
    sendRecovery: vi.fn<AuthProvider['sendRecovery']>(async () => undefined),
    reset: vi.fn<AuthProvider['reset']>(async () => ({ workosUserId: 'user_fixture_1' })),
    createUser: vi.fn<AuthProvider['createUser']>(async i => ({ id: 'user_created', email: i.email, externalId: i.externalId })),
    getUser: vi.fn<AuthProvider['getUser']>(async () => ({ id: 'user_fixture_1', email: 'a@example.com', externalId: 'u1' })),
    listSessions: vi.fn<AuthProvider['listSessions']>(async () => ({ ids: ['sid_1'], nextCursor: null })),
  };
}
export async function authFixture(initial = account()) {
  const storage = usersStore(); const users = new MongoUsers(storage.store, storage.owner, 8192);
  await users.insert(initial); const provider = providerFixture();
  const service = new AuthService({ users, provider, now: () => new Date(at) });
  return { ...storage, users, provider, service };
}
