/**
 * ============================================================================
 * FILE: access.ts
 * LOCATION: backend/src/auth/access.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Admit current accounts and project public user, role, and invalidation.
 *
 * ROLE IN PROJECT:
 *    Separates local status/session admission from WorkOS credentials so P2/P3
 *    can compose simple checks without a permission engine.
 *
 * KEY COMPONENTS:
 *    - admitAccount / requireFullAccount / requireSuperAdmin.
 *    - publicUser / invalidateAccount: Safe projection and session fencing.
 * ============================================================================
 */

import type { AuthPrincipal, AuthUser, UserAccount } from '../contracts/auth.js';
import { AuthFault } from './errors.js';
export function publicUser(a: Readonly<UserAccount>): AuthUser {
  return { userId: a.userId, email: a.emailNormalized, role: a.role, passwordChangeRequired: a.passwordChangeRequired };
}
export function admitAccount(a: UserAccount | null, sessionId: string): AuthPrincipal {
  if (!a || a.status !== 'active' || a.currentWorkosSessionId !== sessionId) throw new AuthFault('UNAUTHENTICATED');
  return Object.freeze({ account: Object.freeze(structuredClone(a)), sessionId,
    identity: Object.freeze({ userId: a.userId, openRouterUser: a.userId, source: 'authenticated-session' as const }) });
}
export function requireFullAccount(p: AuthPrincipal): AuthPrincipal {
  if (p.account.passwordChangeRequired) throw new AuthFault('PASSWORD_CHANGE_REQUIRED'); return p;
}
export function requireSuperAdmin(p: AuthPrincipal): AuthPrincipal {
  requireFullAccount(p); if (p.account.role !== 'super-admin') throw new AuthFault('FORBIDDEN'); return p;
}
export function invalidateAccount(a: Readonly<UserAccount>, updatedAt: string): UserAccount {
  if (!Number.isSafeInteger(a.sessionEpoch + 1)) throw new AuthFault('NOT_READY');
  return { ...a, currentWorkosSessionId: null, sessionEpoch: a.sessionEpoch + 1, updatedAt };
}
