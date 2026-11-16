/**
 * ============================================================================
 * FILE: errors.ts
 * LOCATION: backend/src/auth/errors.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Map closed auth faults to safe HTTP status and retryable JSON bodies.
 *
 * ROLE IN PROJECT:
 *    Gives auth services and HTTP adapters one secret-free error type without
 *    leaking provider messages or request payloads.
 *
 * KEY COMPONENTS:
 *    - AuthFault: Closed AuthErrorCode with status and body().
 * ============================================================================
 */

import type { AuthErrorCode, AuthErrorResponse } from '../contracts/auth.js';
const statuses: Record<AuthErrorCode, number> = { INVALID_REQUEST: 400, UNAUTHENTICATED: 401,
  FORBIDDEN: 403, PASSWORD_CHANGE_REQUIRED: 403, RATE_LIMITED: 429, NOT_READY: 503,
  AUTH_PROVIDER_UNAVAILABLE: 503, AUTH_TIMEOUT: 504 };
export class AuthFault extends Error {
  constructor(readonly code: AuthErrorCode) { super(code); }
  get status() { return statuses[this.code]; }
  body(): AuthErrorResponse { return { error: { code: this.code,
    retryable: ['RATE_LIMITED', 'NOT_READY', 'AUTH_PROVIDER_UNAVAILABLE', 'AUTH_TIMEOUT'].includes(this.code) } }; }
}
