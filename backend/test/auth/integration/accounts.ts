/**
 * ============================================================================
 * FILE: accounts.ts
 * LOCATION: backend/test/auth/integration/accounts.ts
 * ============================================================================
 * PURPOSE:
 *    Compose three isolated accounts across real auth and admin services.
 * ROLE IN PROJECT:
 *    Reuses MongoUsers and P1 storage fixtures without network access.
 *    Only the external WorkOS provider is replaced with deterministic results.
 * KEY COMPONENTS:
 *    - accounts: owner-specific provider sessions and shared account services.
 * ============================================================================
 */
import { vi } from 'vitest';
import { AuthService } from '../../../src/auth/auth.service.js';
import { AuthFault } from '../../../src/auth/errors.js';
import { AdministrationService } from '../../../src/administration/administration.service.js';
import { MongoUsers } from '../../../src/persistence/users.js';
import { account, providerFixture } from '../fixtures.js';
import { usersStore } from '../../persistence/auth-users-fixture.js';

export async function accounts() {
  const storage = usersStore();
  const users = new MongoUsers(storage.store, storage.owner, 8192);
  const rows = ['admin', 'a', 'b'].map(userId => account({ userId,
    workosUserId: `user_${userId}`, emailNormalized: `${userId}@example.com`,
    role: userId === 'admin' ? 'super-admin' : 'user', passwordChangeRequired: false }));
  for (const row of rows) await users.insert(row);
  const provider = providerFixture();
  const sessions = new Map<string, { workosUserId: string; sessionId: string }>();
  let sequence = 0;
  provider.login.mockImplementation(async email => {
    const row = await users.byEmail(email);
    if (!row) throw new AuthFault('UNAUTHENTICATED');
    const sessionId = `sid_${++sequence}`;
    const sealedSession = `fixture_sealed_${sequence}`;
    const session = { workosUserId: row.account.workosUserId, sessionId };
    sessions.set(sealedSession, session);
    return { ...session, sealedSession };
  });
  provider.read.mockImplementation(async cookie => {
    const session = sessions.get(cookie);
    if (!session) throw new AuthFault('UNAUTHENTICATED');
    return { ...session };
  });
  provider.revoke.mockImplementation(async sid => {
    for (const [cookie, session] of sessions) if (session.sessionId === sid) sessions.delete(cookie);
  });
  provider.listSessions.mockImplementation(async subject => ({
    ids: [...sessions.values()].filter(s => s.workosUserId === subject).map(s => s.sessionId),
    nextCursor: null,
  }));
  const auth = new AuthService({ users, provider });
  const cleanup = vi.fn<(userId: string) => Promise<void>>(async () => undefined);
  const admin = new AdministrationService({ users, provider, onUserDeactivated: cleanup,
    newUserId: () => 'created' });
  const login = (userId: string) => auth.login({ email: `${userId}@example.com`, password: 'fixture-private' });
  return { storage, users, provider, sessions, auth, admin, cleanup, login };
}
