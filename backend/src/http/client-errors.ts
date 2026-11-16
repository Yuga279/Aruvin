/**
 * ============================================================================
 * FILE: client-errors.ts
 * LOCATION: backend/src/http/client-errors.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Map internal failures to fixed public error bodies and HTTP statuses.
 *
 * ROLE IN PROJECT:
 *    Keeps chat HTTP responses on the P1 error vocabulary so exception text,
 *    causes, Zod issues, keys, and private state never reach the client.
 *
 * KEY COMPONENTS:
 *    - errorBody: Allowlisted code, message, and retryable flag.
 *    - publicError: Canonical status mapping for AppError, Zod, and HTTP faults.
 * ============================================================================
 */

import { ZodError } from 'zod';
import { HttpException } from '@nestjs/common';
import { AppError } from '../platform/errors/app-error.js';
import { ERROR_HTTP_STATUS, isRetryable, isNeverRetry, type AppErrorCode, type ClientErrorBody } from '../contracts/errors.js';
const messages: Record<AppErrorCode, string> = {
  INVALID_REQUEST: 'The request is invalid.', UNKNOWN_FIELD: 'The request contains an unsupported field.',
  IDENTITY_OVERRIDE_REJECTED: 'Identity is resolved by the server.',
  MODEL_OVERRIDE_REJECTED: 'Model settings are controlled by the server.',
  NOT_FOUND: 'Chat or turn not found.', CONFLICT_ACTIVE_TURN: 'Another request is active or this attempt is no longer current.',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'This request identity was already used for different input.',
  CONTEXT_BUDGET_EXCEEDED: 'This chat is too long. Start a new chat.',
  INPUT_TOO_LARGE: 'The message is too large.', STORAGE_BUDGET_EXCEEDED: 'This chat has reached its storage limit. Start a new chat.',
  RATE_LIMITED: 'Too many requests. Try again shortly.', CONCURRENCY_LIMIT: 'Too many chat requests are active.',
  TIMEOUT: 'The response could not be confirmed in time. Check its status.',
  PROVIDER_ERROR: 'The model service could not answer.', PROVIDER_AUTH: 'The model service is unavailable.',
  PROVIDER_CREDITS: 'The model service is unavailable.', CANCELLED: 'Generation was cancelled.',
  INTERRUPTED: 'Generation was interrupted. Check its status before retrying.',
  PERSISTENCE_ERROR: 'The chat save could not be confirmed. Check its status.',
  CONFIGURATION_ERROR: 'Chat is unavailable.', NOT_READY: 'Chat is not ready. Try again shortly.',
  UNSUPPORTED_TOPOLOGY: 'Chat is unavailable.',
};
export function errorBody(code: AppErrorCode, retryable = isRetryable(code)): ClientErrorBody {
  return { code, message: messages[code], retryable: !isNeverRetry(code) && retryable };
}
export function publicError(error: unknown): { status: number; body: ClientErrorBody } {
  let code: AppErrorCode = 'PERSISTENCE_ERROR'; let retryable: boolean | undefined;
  if (error instanceof AppError) { code = error.code; retryable = error.retryable; }
  else if (error instanceof ZodError) code = 'INVALID_REQUEST';
  else if (error instanceof HttpException) {
    const status = error.getStatus();
    code = status === 413 ? 'INPUT_TOO_LARGE' : status === 429 ? 'RATE_LIMITED' :
      status === 404 ? 'NOT_FOUND' : status < 500 ? 'INVALID_REQUEST' : 'PERSISTENCE_ERROR';
  }
  return { status: ERROR_HTTP_STATUS[code], body: errorBody(code, retryable) };
}
