/**
 * ============================================================================
 * FILE: cookies.spec.ts
 * LOCATION: backend/test/auth/cookies.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify exact single-cookie parse, issue, and clear behavior.
 *
 * ROLE IN PROJECT:
 *    Proves the sealed session cookie is HttpOnly, path-scoped, and never
 *    accepts duplicate or injected values.
 *
 * KEY COMPONENTS:
 *    - readSessionCookie: Exactly one aurvin_wos_session value.
 *    - sessionCookie / clearSessionCookie: Bounded Set-Cookie writers.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { readSessionCookie, sessionCookie, clearSessionCookie } from '../../src/auth/cookies.js';
it('accepts exactly one sealed cookie and never exposes raw tokens', () => {
  expect(readSessionCookie('other=x; aurvin_wos_session=sealed')).toBe('sealed');
  for (const v of [undefined, ['aurvin_wos_session=x'], 'aurvin_wos_session=a; aurvin_wos_session=b',
    'aurvin_wos_session=x, aurvin_wos_session=y', 'aurvin_wos_session=', 'x'.repeat(16385)])
    expect(readSessionCookie(v)).toBeNull();
  expect(sessionCookie('sealed', true)).toBe('aurvin_wos_session=sealed; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800; Secure');
  expect(clearSessionCookie(false)).toBe('aurvin_wos_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
  expect(() => sessionCookie('x\r\nInjected: yes', false)).toThrow();
});
