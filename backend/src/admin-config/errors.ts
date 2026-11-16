/**
 * ============================================================================
 * FILE: errors.ts
 * LOCATION: backend/src/admin-config/errors.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Map admin configuration failures to a closed, redacted error body.
 *
 * ROLE IN PROJECT:
 *    Keeps HTTP, service, and persistence faults from leaking exception text,
 *    provider payloads, or stack traces into the public admin protocol.
 *
 * KEY COMPONENTS:
 *    - AdminConfigFault: Safe code, status, retry, and allowlisted field errors.
 *    - STATUS / retry table: Exact HTTP mapping without raw exception serialization.
 * ============================================================================
 */

import {
  ADMIN_CONFIG_FIELD_PATHS,
  type AdminConfigError,
  type AdminConfigErrorCode,
} from '../contracts/admin-config-wire.js';

const STATUS: Record<AdminConfigErrorCode, number> = {
  INVALID_CONFIG_REQUEST: 400,
  CONFIG_VALIDATION_FAILED: 422,
  CONFIG_CONFLICT: 409,
  CONFIG_STORAGE_UNAVAILABLE: 503,
  CONFIG_WRITE_UNCERTAIN: 503,
  CONFIG_STORED_INVALID: 503,
  CONFIG_ENCRYPTION_UNAVAILABLE: 503,
  CONFIG_ACTIVATION_UNAVAILABLE: 503,
  CREDENTIAL_REJECTED: 422,
  CREDENTIAL_VALIDATION_TIMEOUT: 504,
  CREDENTIAL_PROVIDER_RATE_LIMITED: 429,
  CREDENTIAL_PROVIDER_UNAVAILABLE: 502,
  CREDENTIAL_PROVIDER_RESPONSE_INVALID: 502,
  ADMIN_RATE_LIMITED: 429,
  INVALID_ADMIN_ORIGIN: 403,
  ADMIN_TRANSPORT_REQUIRED: 403,
};

const RETRYABLE: ReadonlySet<AdminConfigErrorCode> = new Set([
  'CONFIG_STORAGE_UNAVAILABLE',
  'CREDENTIAL_VALIDATION_TIMEOUT',
  'CREDENTIAL_PROVIDER_RATE_LIMITED',
  'CREDENTIAL_PROVIDER_UNAVAILABLE',
  'ADMIN_RATE_LIMITED',
]);

const FIELD_PATHS = new Set<string>(ADMIN_CONFIG_FIELD_PATHS);
const FIELD_CODES = new Set<AdminConfigError['error']['fieldErrors'][number]['code']>([
  'required',
  'invalid',
  'out_of_range',
  'cross_field',
  'immutable',
  'unsupported',
]);

type FieldError = AdminConfigError['error']['fieldErrors'][number];

function sanitizeFieldErrors(raw: AdminConfigError['error']['fieldErrors']): FieldError[] {
  const out: FieldError[] = [];
  for (const item of raw) {
    if (out.length >= 20) break;
    if (!FIELD_PATHS.has(item.path) || !FIELD_CODES.has(item.code)) continue;
    out.push({ path: item.path, code: item.code });
  }
  return out;
}

export class AdminConfigFault extends Error {
  readonly code: AdminConfigErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly currentRevision: number | null;
  readonly fieldErrors: FieldError[];

  constructor(
    code: AdminConfigErrorCode,
    currentRevision: number | null = null,
    fieldErrors: AdminConfigError['error']['fieldErrors'] = [],
  ) {
    super(code);
    this.name = 'AdminConfigFault';
    this.code = code;
    this.status = STATUS[code];
    this.retryable = RETRYABLE.has(code);
    this.currentRevision = currentRevision;
    this.fieldErrors = sanitizeFieldErrors(fieldErrors);
  }

  body(): AdminConfigError {
    return {
      protocolVersion: 1,
      error: {
        code: this.code,
        retryable: this.retryable,
        currentRevision: this.currentRevision,
        fieldErrors: this.fieldErrors.map((item) => ({ path: item.path, code: item.code })),
      },
    };
  }
}

export function adminConfigFaultFromUnknown(): AdminConfigFault {
  return new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
}
