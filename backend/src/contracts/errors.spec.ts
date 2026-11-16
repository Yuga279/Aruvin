/**
 * ============================================================================
 * FILE: errors.spec.ts
 * LOCATION: backend/src/contracts/errors.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify shared identifier constraints and application error classification.
 *
 * ROLE IN PROJECT:
 *    Defines regression coverage for bounded identities, HTTP response mapping,
 *    and safe retry decisions used by platform and runtime code.
 *
 * KEY COMPONENTS:
 *    - Identifier tests: Enforce bounded non-empty identifiers.
 *    - Error taxonomy tests: Verify statuses and retry classifications.
 * ============================================================================
 */

import {
  APP_ERROR_CODES,
  ERROR_HTTP_STATUS,
  NEVER_RETRY_CODES,
  RETRYABLE_CODES,
  appErrorCodeSchema,
  isNeverRetry,
  isRetryable,
} from './errors.js';
import { idSchema } from './identifiers.js';

describe('identifiers', () => {
  it('accepts bounded non-empty ids', () => {
    expect(idSchema.parse('aurvin-dev-user')).toBe('aurvin-dev-user');
    expect(idSchema.parse('sess_01')).toBe('sess_01');
  });

  it('rejects empty or oversized ids', () => {
    expect(() => idSchema.parse('')).toThrow();
    expect(() => idSchema.parse('x'.repeat(129))).toThrow();
  });
});

describe('error taxonomy', () => {
  it('classifies identity and model overrides as non-retryable 400s', () => {
    expect(ERROR_HTTP_STATUS.IDENTITY_OVERRIDE_REJECTED).toBe(400);
    expect(ERROR_HTTP_STATUS.MODEL_OVERRIDE_REJECTED).toBe(400);
    expect(isNeverRetry('IDENTITY_OVERRIDE_REJECTED')).toBe(true);
    expect(isRetryable('IDENTITY_OVERRIDE_REJECTED')).toBe(false);
  });

  it('does not blindly retry invalid input, credits, or configuration', () => {
    for (const code of [
      'INVALID_REQUEST',
      'UNKNOWN_FIELD',
      'INPUT_TOO_LARGE',
      'CONTEXT_BUDGET_EXCEEDED',
      'PROVIDER_AUTH',
      'PROVIDER_CREDITS',
      'CONFIGURATION_ERROR',
    ] as const) {
      expect(NEVER_RETRY_CODES.has(code)).toBe(true);
      expect(isRetryable(code)).toBe(false);
    }
  });

  it('marks provider timeouts as retryable and conflict as not', () => {
    expect(RETRYABLE_CODES.has('TIMEOUT')).toBe(true);
    expect(isRetryable('CONFLICT_ACTIVE_TURN')).toBe(false);
    expect(ERROR_HTTP_STATUS.CONFLICT_ACTIVE_TURN).toBe(409);
    expect(ERROR_HTTP_STATUS.IDEMPOTENCY_PAYLOAD_MISMATCH).toBe(409);
  });

  it('lists every code in the HTTP map', () => {
    for (const code of APP_ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toEqual(expect.any(Number));
      expect(appErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
