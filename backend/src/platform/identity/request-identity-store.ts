/**
 * ============================================================================
 * FILE: request-identity-store.ts
 * LOCATION: backend/src/platform/identity/request-identity-store.ts
 * ============================================================================
 * PURPOSE: Hold an admitted principal for one request without identity fallback.
 * ROLE IN PROJECT: Supplies identity to existing singleton services at request
 * boundaries; accepted and background work retain their own immutable owners.
 * KEY COMPONENTS: RequestIdentityStore.run, principal, resolve, adminActor.
 * ============================================================================
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../../contracts/auth.js';
import type { SessionAdminConfigActor } from '../../contracts/config-runtime.js';
import { requireFullAccount, requireSuperAdmin } from '../../auth/access.js';
import { AuthFault } from '../../auth/errors.js';

@Injectable()
export class RequestIdentityStore {
  private readonly context = new AsyncLocalStorage<AuthPrincipal>();
  private readonly bound = new WeakMap<object, AuthPrincipal>();
  run<T>(principal: AuthPrincipal, next: () => T): T { return this.context.run(principal, next); }
  attach(req: object, principal: AuthPrincipal): void {
    this.bound.set(req, principal);
    this.context.enterWith(principal);
  }
  restore(req: object): void {
    const principal = this.bound.get(req);
    if (principal) this.context.enterWith(principal);
  }
  principal(): AuthPrincipal {
    const value = this.context.getStore();
    if (!value) throw new AuthFault('UNAUTHENTICATED');
    return value;
  }
  resolve() { return requireFullAccount(this.principal()).identity; }
  adminActor(): SessionAdminConfigActor {
    const p = requireSuperAdmin(this.principal());
    return { identity: p.identity,
      assumption: { role: 'super-admin', authentication: 'session', source: 'local-account' } };
  }
}
