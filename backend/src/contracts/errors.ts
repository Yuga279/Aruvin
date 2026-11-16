/**
 * ============================================================================
 * FILE: errors.ts
 * LOCATION: backend/src/contracts/errors.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define client-safe application error codes and shared HTTP/retry policy.
 *
 * ROLE IN PROJECT:
 *    Provides one error vocabulary for backend platform services, downstream
 *    runtime and HTTP adapters, and client-safe error responses.
 *
 * KEY COMPONENTS:
 *    - APP_ERROR_CODES: Versioned list of application error identifiers.
 *    - ERROR_HTTP_STATUS / retry sets: Common response and retry semantics.
 * ============================================================================
 */

import { z } from 'zod';

export const APP_ERROR_CODES = [
  'INVALID_REQUEST',
  'UNKNOWN_FIELD',
  'IDENTITY_OVERRIDE_REJECTED',
  'MODEL_OVERRIDE_REJECTED',
  'NOT_FOUND',
  'CONFLICT_ACTIVE_TURN',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',
  'CONTEXT_BUDGET_EXCEEDED',
  'INPUT_TOO_LARGE',
  'STORAGE_BUDGET_EXCEEDED',
  'RATE_LIMITED',
  'CONCURRENCY_LIMIT',
  'TIMEOUT',
  'PROVIDER_ERROR',
  'PROVIDER_AUTH',
  'PROVIDER_CREDITS',
  'CANCELLED',
  'INTERRUPTED',
  'PERSISTENCE_ERROR',
  'CONFIGURATION_ERROR',
  'NOT_READY',
  'UNSUPPORTED_TOPOLOGY',
] as const;

export const appErrorCodeSchema = z.enum(APP_ERROR_CODES);
export type AppErrorCode = z.infer<typeof appErrorCodeSchema>;

export const ERROR_HTTP_STATUS: Record<AppErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNKNOWN_FIELD: 400,
  IDENTITY_OVERRIDE_REJECTED: 400,
  MODEL_OVERRIDE_REJECTED: 400,
  NOT_FOUND: 404,
  CONFLICT_ACTIVE_TURN: 409,
  IDEMPOTENCY_PAYLOAD_MISMATCH: 409,
  CONTEXT_BUDGET_EXCEEDED: 413,
  INPUT_TOO_LARGE: 413,
  STORAGE_BUDGET_EXCEEDED: 413,
  RATE_LIMITED: 429,
  CONCURRENCY_LIMIT: 429,
  TIMEOUT: 504,
  PROVIDER_ERROR: 502,
  PROVIDER_AUTH: 502,
  PROVIDER_CREDITS: 402,
  CANCELLED: 409,
  INTERRUPTED: 409,
  PERSISTENCE_ERROR: 503,
  CONFIGURATION_ERROR: 500,
  NOT_READY: 503,
  UNSUPPORTED_TOPOLOGY: 500,
};

export const RETRYABLE_CODES: ReadonlySet<AppErrorCode> = new Set([
  'TIMEOUT',
  'PROVIDER_ERROR',
  'PERSISTENCE_ERROR',
  'RATE_LIMITED',
  'NOT_READY',
]);

export const NEVER_RETRY_CODES: ReadonlySet<AppErrorCode> = new Set([
  'INVALID_REQUEST',
  'UNKNOWN_FIELD',
  'IDENTITY_OVERRIDE_REJECTED',
  'MODEL_OVERRIDE_REJECTED',
  'INPUT_TOO_LARGE',
  'CONTEXT_BUDGET_EXCEEDED',
  'STORAGE_BUDGET_EXCEEDED',
  'PROVIDER_AUTH',
  'PROVIDER_CREDITS',
  'CONFIGURATION_ERROR',
  'UNSUPPORTED_TOPOLOGY',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',
]);

export function isRetryable(code: AppErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}

export function isNeverRetry(code: AppErrorCode): boolean {
  return NEVER_RETRY_CODES.has(code);
}

export const clientErrorBodySchema = z
  .object({
    code: appErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict();

export type ClientErrorBody = z.infer<typeof clientErrorBodySchema>;
