/**
 * ============================================================================
 * FILE: errors.spec.ts
 * LOCATION: backend/test/administration/errors.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify closed Administration fault bodies and redaction.
 *
 * ROLE IN PROJECT:
 *    Keeps provider/storage detail out of the account API.
 *    Tests the reusable fault boundary before service composition.
 *
 * KEY COMPONENTS:
 *    - Fault status, retry policy and normalization assertions.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { z } from 'zod';
import { AuthFault } from '../../src/auth/errors.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { AdministrationFault, safeAdministrationFault } from '../../src/administration/errors.js';

it.each([
  ['ACCOUNT_CONFLICT', 409], ['ACCOUNT_NOT_FOUND', 404],
  ['ACCOUNT_WRITE_UNCERTAIN', 503], ['ACCOUNT_PROVISIONING_INCOMPLETE', 503],
] as const)('maps %s without suggesting unsafe automatic retries', (code, status) => {
  const fault = new AdministrationFault(code);
  expect(fault.status).toBe(status);
  expect(fault.body()).toEqual({ error: { code, retryable: false } });
});
it('preserves safe P1 faults but never exposes arbitrary exception details', () => {
  const auth = new AuthFault('FORBIDDEN');
  expect(safeAdministrationFault(auth)).toBe(auth);
  expect(safeAdministrationFault(new Error('password=secret&resetToken=raw')).body())
    .toEqual({ error: { code: 'NOT_READY', retryable: true } });
  expect(safeAdministrationFault(new AppError('INVALID_REQUEST', 'raw cursor')).code).toBe('INVALID_REQUEST');
  const parsed = z.tuple([z.string()]).safeParse([4]);
  if (parsed.success) throw new Error('fixture must be invalid');
  expect(safeAdministrationFault(parsed.error).code).toBe('INVALID_REQUEST');
});
