/**
 * ============================================================================
 * FILE: app-error.spec.ts
 * LOCATION: backend/src/platform/errors/app-error.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify that AppError exposes only the intended client-safe error body.
 *
 * ROLE IN PROJECT:
 *    Protects the platform boundary from leaking database details or stacks,
 *    while keeping HTTP and retry metadata consistent with shared contracts.
 *
 * KEY COMPONENTS:
 *    - Client body tests: Validate safe error response fields.
 *    - Classification tests: Confirm identity errors are non-retryable 400s.
 * ============================================================================
 */

import { AppError } from './app-error.js';

describe('AppError', () => {
  it('exposes a client body without implementation details', () => {
    const error = new AppError(
      'PERSISTENCE_ERROR',
      'The chat could not be saved. Try again.',
    );
    expect(error.httpStatus).toBe(503);
    expect(error.retryable).toBe(true);
    expect(error.toClientBody()).toEqual({
      code: 'PERSISTENCE_ERROR',
      message: 'The chat could not be saved. Try again.',
      retryable: true,
    });
    expect(JSON.stringify(error.toClientBody())).not.toMatch(/Mongo|Cosmos|stack/i);
  });

  it('keeps identity overrides non-retryable', () => {
    const error = new AppError(
      'IDENTITY_OVERRIDE_REJECTED',
      'Identity cannot be supplied by the client.',
    );
    expect(error.httpStatus).toBe(400);
    expect(error.retryable).toBe(false);
  });
});
