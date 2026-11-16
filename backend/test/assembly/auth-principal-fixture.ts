/**
 * ============================================================================
 * FILE: auth-principal-fixture.ts
 * LOCATION: backend/test/assembly/auth-principal-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Build admitted AuthPrincipal fixtures for P3 identity and isolation tests.
 *
 * ROLE IN PROJECT:
 *    Shares one local-account principal factory across P3 tests so they do not
 *    invent a runtime identity bypass or a second admission path.
 *
 * KEY COMPONENTS:
 *    - principal: Admit a bounded active account for the requested role.
 * ============================================================================
 */

import { admitAccount } from '../../src/auth/access.js';
import type { AuthPrincipal, UserRole } from '../../src/contracts/auth.js';

export function principal(userId = 'u1', role: UserRole = 'user', pending = false): AuthPrincipal {
  return admitAccount({ schemaVersion: 1, userId, workosUserId: `workos_${userId}`,
    emailNormalized: `${userId}@example.com`, role, status: 'active',
    passwordChangeRequired: pending, currentWorkosSessionId: `sid_${userId}`,
    sessionEpoch: 0, createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z' }, `sid_${userId}`);
}
