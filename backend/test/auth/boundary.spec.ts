/**
 * ============================================================================
 * FILE: boundary.spec.ts
 * LOCATION: backend/test/auth/boundary.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the request-bound cookie admission seam for HTTP and upgrades.
 *
 * ROLE IN PROJECT:
 *    Proves authenticateCookie and authBoundary share one immutable principal
 *    without ALS or a shared mutable last-user field.
 *
 * KEY COMPONENTS:
 *    - authenticateCookie: Cookie header to principal.
 *    - authBoundary: Request-scoped middleware seam for P3.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { account, authFixture } from './fixtures.js';
import { authenticateCookie, authBoundary } from '../../src/auth/auth-boundary.js';
it('provides the same immutable principal to HTTP and cookie-bearing upgrade callers', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1', passwordChangeRequired: false }));
  const result = await authenticateCookie(f.service, 'aurvin_wos_session=sealed_1');
  expect(result.principal.identity.userId).toBe('u1');
  let owner = '';
  const middleware = authBoundary(f.service, (p, next) => { owner = p.identity.userId; next(); });
  const req = { headers: { cookie: 'aurvin_wos_session=sealed_1' } };
  const headers = new Map<string, unknown>();
  const res = { setHeader: (k: string, v: unknown) => headers.set(k, v) };
  let called = false;
  await middleware(req as never, res as never, error => { if (error) throw error; called = true; });
  expect(called).toBe(true); expect(owner).toBe('u1');
});
it('resolves concurrent cookies to distinct identities without a shared last-user field', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1', passwordChangeRequired: false }));
  await f.users.insert(account({
    userId: 'u2', workosUserId: 'user_fixture_2', emailNormalized: 'b@example.com',
    currentWorkosSessionId: 'sid_2', passwordChangeRequired: false,
  }));
  f.provider.read.mockImplementation(async cookie => cookie === 'sealed_2'
    ? { workosUserId: 'user_fixture_2', sessionId: 'sid_2' }
    : { workosUserId: 'user_fixture_1', sessionId: 'sid_1' });
  const [a, b] = await Promise.all([
    authenticateCookie(f.service, 'aurvin_wos_session=sealed_1'),
    authenticateCookie(f.service, 'aurvin_wos_session=sealed_2'),
  ]);
  expect(a.principal.identity.userId).toBe('u1');
  expect(b.principal.identity.userId).toBe('u2');
  expect(a.principal.identity).not.toBe(b.principal.identity);
  expect(a.principal).not.toBe(b.principal);
  expect(Object.isFrozen(a.principal.identity)).toBe(true);
  expect(Object.isFrozen(b.principal.identity)).toBe(true);
  expect(Object.hasOwn(f.service, 'lastUser')).toBe(false);
  const seen: string[] = [];
  const middleware = authBoundary(f.service, (p, next) => { seen.push(p.identity.userId); next(); });
  await Promise.all([
    middleware(
      { headers: { cookie: 'aurvin_wos_session=sealed_1' } } as never,
      { setHeader: () => undefined } as never,
      error => { if (error) throw error; },
    ),
    middleware(
      { headers: { cookie: 'aurvin_wos_session=sealed_2' } } as never,
      { setHeader: () => undefined } as never,
      error => { if (error) throw error; },
    ),
  ]);
  expect(seen.sort()).toEqual(['u1', 'u2']);
});
