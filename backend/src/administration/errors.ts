/**
 * ============================================================================
 * FILE: errors.ts
 * LOCATION: backend/src/administration/errors.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Map Administration errors to closed, secret-free HTTP responses.
 *
 * ROLE IN PROJECT:
 *    Shares P1 auth faults without reflecting provider exceptions.
 *    Gives services and HTTP filters one bounded failure vocabulary.
 *
 * KEY COMPONENTS:
 *    - AdministrationFault and safeAdministrationFault.
 * ============================================================================
 */
import { ZodError } from 'zod';
import type { AdministrationErrorCode, AdministrationErrorResponse } from '../contracts/administration.js';
import type { AuthErrorCode } from '../contracts/auth.js';
import { AuthFault } from '../auth/errors.js';
import { AppError } from '../platform/errors/app-error.js';

type AccountFaultCode = Exclude<AdministrationErrorCode, AuthErrorCode>;
const statuses: Record<AccountFaultCode, number> = {
  ACCOUNT_CONFLICT: 409, ACCOUNT_NOT_FOUND: 404,
  ACCOUNT_WRITE_UNCERTAIN: 503, ACCOUNT_PROVISIONING_INCOMPLETE: 503,
};
export class AdministrationFault extends Error {
  constructor(readonly code: AccountFaultCode) { super(code); }
  get status() { return statuses[this.code]; }
  body(): AdministrationErrorResponse { return { error: { code: this.code, retryable: false } }; }
}
export function safeAdministrationFault(error: unknown): AdministrationFault | AuthFault {
  if (error instanceof AdministrationFault || error instanceof AuthFault) return error;
  if (error instanceof ZodError || (error instanceof AppError && error.code === 'INVALID_REQUEST'))
    return new AuthFault('INVALID_REQUEST');
  return new AuthFault('NOT_READY');
}
