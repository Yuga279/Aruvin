/**
 * ============================================================================
 * FILE: cookies.ts
 * LOCATION: backend/src/auth/cookies.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Parse, issue, and clear the single sealed WorkOS session cookie.
 *
 * ROLE IN PROJECT:
 *    Owns the exact aurvin_wos_session cookie syntax so controllers never
 *    emit raw tokens or accept duplicate/injected cookie headers.
 *
 * KEY COMPONENTS:
 *    - readSessionCookie: Exactly one bounded sealed value.
 *    - sessionCookie / clearSessionCookie: HttpOnly SameSite=Strict writers.
 * ============================================================================
 */

import { AuthFault } from './errors.js';
const name = 'aurvin_wos_session';
export function readSessionCookie(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string' || Buffer.byteLength(header) > 16384 || /[,\r\n\u0000]/.test(header)) return null;
  const values = header.split(';').map(s => s.trim()).filter(s => s.split('=', 1)[0] === name);
  if (values.length !== 1) return null;
  const value = values[0]!.slice(name.length + 1);
  return value.length > 0 && value.length <= 12288 && /^[\x21-\x7e]+$/.test(value) ? value : null;
}
function write(value: string, secure: boolean, maxAge: number): string {
  if (value.length > 12288 || /[\s;,\u0000-\u001f\u007f]/.test(value)) throw new AuthFault('AUTH_PROVIDER_UNAVAILABLE');
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export const sessionCookie = (value: string, secure: boolean) => write(value, secure, 28800);
export const clearSessionCookie = (secure: boolean) => write('', secure, 0);
