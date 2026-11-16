/**
 * ============================================================================
 * FILE: access.spec.ts
 * LOCATION: backend/test/auth/access.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify local account admission, onboarding, and Super Admin checks.
 *
 * ROLE IN PROJECT:
 *    Proves status/session mismatch is unauthenticated, password-change is a
 *    limited gate, and administrative capability is a fresh local-role check.
 *
 * KEY COMPONENTS:
 *    - admitAccount / requireFullAccount / requireSuperAdmin.
 *    - invalidateAccount: Non-reviving session epoch bump.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { account } from './fixtures.js';
import { admitAccount, requireFullAccount, requireSuperAdmin, invalidateAccount, publicUser } from '../../src/auth/access.js';
it('separates active ownership from onboarding and administrative capability', () => {
  const a = account({ currentWorkosSessionId: 'sid_1' });
  const p = admitAccount(a, 'sid_1');
  expect(p.identity).toEqual({ userId: 'u1', openRouterUser: 'u1', source: 'authenticated-session' });
  expect(() => requireFullAccount(p)).toThrow('PASSWORD_CHANGE_REQUIRED');
  expect(() => requireSuperAdmin(admitAccount({ ...a, passwordChangeRequired: false }, 'sid_1'))).toThrow('FORBIDDEN');
  expect(() => requireSuperAdmin(admitAccount({ ...a, role: 'super-admin', passwordChangeRequired: false }, 'sid_1'))).not.toThrow();
  expect(() => admitAccount({ ...a, status: 'inactive' }, 'sid_1')).toThrow('UNAUTHENTICATED');
  expect(() => admitAccount(a, 'sid_other')).toThrow('UNAUTHENTICATED');
  expect(() => admitAccount(null, 'sid_1')).toThrow('UNAUTHENTICATED');
  expect(publicUser(a)).toEqual({ userId: 'u1', email: 'a@example.com', role: 'user', passwordChangeRequired: true });
  const invalid = invalidateAccount(a, '2026-11-10T01:00:00.000Z');
  expect(invalid.currentWorkosSessionId).toBeNull(); expect(invalid.sessionEpoch).toBe(1);
  expect(() => admitAccount({ ...invalid, status: 'active' }, 'sid_1')).toThrow('UNAUTHENTICATED');
});
