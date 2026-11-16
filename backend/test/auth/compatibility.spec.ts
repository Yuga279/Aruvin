/**
 * ============================================================================
 * FILE: compatibility.spec.ts
 * LOCATION: backend/test/auth/compatibility.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove additive session identity sources without breaking P3 compile types.
 *
 * ROLE IN PROJECT:
 *    Records the P1/P3 identity bridge: new authenticated sources coexist with
 *    the deprecated development assumption until P3 removes the fallback.
 *
 * KEY COMPONENTS:
 *    - resolvedIdentitySchema: authenticated-session and bootstrap-operator.
 *    - SessionAdminConfigActor: Local-account role assumption contract.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { resolvedIdentitySchema } from '../../src/contracts/identity.js';
import type { AdminConfigActor, SessionAdminConfigActor } from '../../src/contracts/config-runtime.js';
import { isSessionAdminAssumption } from '../../src/contracts/admin-config-wire.js';
it('adds explicit session/operator attribution without assigning browser roles', () => {
  for (const source of ['authenticated-session', 'bootstrap-operator']) {
    expect(resolvedIdentitySchema.parse({ userId: 'u1', openRouterUser: 'u1', source }).source).toBe(source);
  }
  expect(isSessionAdminAssumption({ role: 'user', authentication: 'session', source: 'local-account' })).toBe(true);
  expect(isSessionAdminAssumption({ role: 'super-admin', authentication: 'disabled', source: 'server-configured-development' })).toBe(false);
  const actor: SessionAdminConfigActor = { identity: { userId: 'u1', openRouterUser: 'u1', source: 'authenticated-session' },
    assumption: { role: 'super-admin', authentication: 'session', source: 'local-account' } };
  const compatible: AdminConfigActor = actor;
  expect(compatible.identity.userId).toBe('u1');
});
