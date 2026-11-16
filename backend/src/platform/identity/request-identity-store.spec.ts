/**
 * ============================================================================
 * FILE: request-identity-store.spec.ts
 * LOCATION: backend/src/platform/identity/request-identity-store.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify request-bound identity isolation with no default owner fallback.
 *
 * ROLE IN PROJECT:
 *    Proves overlapping requests keep distinct principals and that unbound
 *    resolution never invents a server-configured identity.
 *
 * KEY COMPONENTS:
 *    - Isolation test: Concurrent ALS runs and unbound/onboarding denials.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { RequestIdentityStore } from './request-identity-store.js';
import { ServerIdentityResolver } from './server-identity-resolver.js';
import { principal } from '../../../test/assembly/auth-principal-fixture.js';

it('isolates overlapping requests and never resolves a default outside admission', async () => {
  const store = new RequestIdentityStore(), resolver = new ServerIdentityResolver(store);
  expect(() => resolver.resolve()).toThrow('UNAUTHENTICATED');
  const values = await Promise.all(['u1', 'u2', 'admin'].map(u =>
    store.run(principal(u, u === 'admin' ? 'super-admin' : 'user'), async () => {
      await setImmediate();
      return resolver.resolve();
    })));
  expect(values.map(v => [v.userId, v.openRouterUser, v.source])).toEqual([
    ['u1', 'u1', 'authenticated-session'], ['u2', 'u2', 'authenticated-session'],
    ['admin', 'admin', 'authenticated-session'],
  ]);
  expect(() => resolver.resolve()).toThrow('UNAUTHENTICATED');
  expect(() => store.run(principal('u1', 'user', true), () => resolver.resolve()))
    .toThrow('PASSWORD_CHANGE_REQUIRED');
  expect(() => store.run(principal(), () => resolver.assertNoClientOverrides({ userId: 'u2' })))
    .toThrow();
  expect(() => store.run(principal(), () => store.adminActor())).toThrow('FORBIDDEN');
});
