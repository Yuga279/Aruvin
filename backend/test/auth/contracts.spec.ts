/**
 * ============================================================================
 * FILE: contracts.spec.ts
 * LOCATION: backend/test/auth/contracts.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Freeze closed auth request/response contracts and browser wire parity.
 *
 * ROLE IN PROJECT:
 *    Proves P1 auth and Administration wire shapes stay exact, secret-free,
 *    and byte-for-byte aligned with the frontend protocol mirrors.
 *
 * KEY COMPONENTS:
 *    - Auth wire tests: Closed requests and exact safe responses.
 *    - Administration wire tests: User-only creation and credential-free rows.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { AUTH_ROUTES, userAccountSchema, loginRequestSchema,
  isAuthUserResponse } from '../../src/contracts/auth.js';
import { createUserRequestSchema, ADMINISTRATION_ROUTES, isAdministrationPage } from '../../src/contracts/administration.js';
import { COLLECTIONS } from '../../src/contracts/collections.js';

it('freezes closed auth requests and safe exact responses', () => {
  expect(AUTH_ROUTES.me).toBe('/auth/me');
  expect(COLLECTIONS.users).toBe('users');
  expect(loginRequestSchema.parse({ email: ' A@EXAMPLE.COM ', password: ' x ' }))
    .toEqual({ email: 'a@example.com', password: ' x ' });
  expect(loginRequestSchema.safeParse({ email: 'a@example.com', password: 'x', userId: 'victim' }).success).toBe(false);
  const user = { userId: 'u1', email: 'a@example.com', role: 'user', passwordChangeRequired: true };
  expect(isAuthUserResponse({ user })).toBe(true);
  expect(isAuthUserResponse({ user: { ...user, accessToken: 'secret' } })).toBe(false);
  expect(isAuthUserResponse({ user: { ...user, role: 'admin' } })).toBe(false);
  expect(userAccountSchema.safeParse({ ...user, password: 'secret' }).success).toBe(false);
});

it('keeps the browser auth wire byte-for-byte aligned', () => {
  const block = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
    .split('// BEGIN AUTH WIRE')[1]!.split('// END AUTH WIRE')[0];
  expect(block('../../../frontend/src/api/auth-protocol.ts'))
    .toBe(block('../../src/contracts/auth.ts'));
});

it('permits only User creation and excludes credentials from table rows', () => {
  expect(createUserRequestSchema.safeParse({ email: 'a@example.com', temporaryPassword: 'Temp-password-1', role: 'super-admin' }).success).toBe(false);
  expect(createUserRequestSchema.parse({ email: ' A@EXAMPLE.COM ', temporaryPassword: 'Temp-password-1', role: 'user' }).email).toBe('a@example.com');
  const row = { userId: 'u1', email: 'a@example.com', role: 'user', status: 'active',
    passwordChangeRequired: true, createdAt: '2026-11-10T00:00:00.000Z' };
  expect(isAdministrationPage({ items: [row], nextCursor: null })).toBe(true);
  expect(isAdministrationPage({ items: [{ ...row, temporaryPassword: 'secret' }], nextCursor: null })).toBe(false);
  expect(isAdministrationPage({ items: Array(51).fill(row), nextCursor: null })).toBe(false);
  expect(ADMINISTRATION_ROUTES.deactivate('u1')).toBe('/admin/users/u1/deactivate');
});

it('keeps the browser Administration wire byte-for-byte aligned', () => {
  const block = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
    .split('// BEGIN ADMINISTRATION WIRE')[1]!.split('// END ADMINISTRATION WIRE')[0];
  expect(block('../../../frontend/src/api/administration-protocol.ts'))
    .toBe(block('../../src/contracts/administration.ts'));
});
