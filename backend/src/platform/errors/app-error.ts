/**
 * ============================================================================
 * FILE: app-error.ts
 * LOCATION: backend/src/platform/errors/app-error.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Represent an application failure with safe HTTP and retry metadata.
 *
 * ROLE IN PROJECT:
 *    Gives platform code a consistent error type without exposing internal
 *    exception details in the public client response.
 *
 * KEY COMPONENTS:
 *    - AppError: Typed error with status, retry policy, and client body.
 * ============================================================================
 */

import {
  type AppErrorCode,
  type ClientErrorBody,
  ERROR_HTTP_STATUS,
  isRetryable,
} from '../../contracts/errors.js';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number;

  constructor(
    code: AppErrorCode,
    message: string,
    retryable = isRetryable(code),
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = ERROR_HTTP_STATUS[code];
  }

  toClientBody(): ClientErrorBody {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}
