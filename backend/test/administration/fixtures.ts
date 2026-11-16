/**
 * ============================================================================
 * FILE: fixtures.ts
 * LOCATION: backend/test/administration/fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compose deterministic Administration tests around real MongoUsers.
 *
 * ROLE IN PROJECT:
 *    Reuses P1 account/provider/RecordStore fixtures without network calls.
 *    Supplies isolated account state and deterministic service seams.
 *
 * KEY COMPONENTS:
 *    - administrationFixture with admin and ordinary User principals.
 * ============================================================================
 */
import { admitAccount } from '../../src/auth/access.js';
import { AdministrationService, type AdministrationServiceOptions } from '../../src/administration/administration.service.js';
import { MongoUsers } from '../../src/persistence/users.js';
import { account, at, providerFixture } from '../auth/fixtures.js';
import { usersStore } from '../persistence/auth-users-fixture.js';

export async function administrationFixture(overrides: Partial<AdministrationServiceOptions> = {}) {
  const storage = usersStore();
  const users = new MongoUsers(storage.store, storage.owner, 8192);
  const adminAccount = account({ userId: 'admin', workosUserId: 'user_admin',
    emailNormalized: 'admin@example.com', role: 'super-admin',
    passwordChangeRequired: false, currentWorkosSessionId: 'sid_admin' });
  const target = account({ passwordChangeRequired: false, currentWorkosSessionId: 'sid_1' });
  await users.insert(adminAccount); await users.insert(target);
  const provider = providerFixture();
  const options: AdministrationServiceOptions = { users, provider,
    now: () => new Date(at), newUserId: () => 'u_created', ...overrides };
  return { ...storage, users, provider, options, service: new AdministrationService(options),
    admin: admitAccount(adminAccount, 'sid_admin'), regular: admitAccount(target, 'sid_1') };
}
