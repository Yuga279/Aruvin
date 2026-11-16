/**
 * ============================================================================
 * FILE: auth-protocol.ts
 * LOCATION: frontend/src/api/auth-protocol.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Mirror the closed auth wire for browser clients without backend secrets.
 *
 * ROLE IN PROJECT:
 *    Supplies P4 with exact routes, safe user/error shapes, and guards that
 *    stay byte-for-byte aligned with the backend auth contract.
 *
 * KEY COMPONENTS:
 *    - AUTH_ROUTES / AUTH_ERROR_CODES: Closed client paths and error catalog.
 *    - AuthUser / guards: Exact secret-free current-account payloads.
 * ============================================================================
 */

// BEGIN AUTH WIRE
export const AUTH_PROTOCOL_VERSION = 1 as const;
export const USER_ROLES = ['super-admin', 'user'] as const;
export const USER_STATUSES = ['active', 'inactive'] as const;
export type UserRole = typeof USER_ROLES[number];
export type UserStatus = typeof USER_STATUSES[number];
export const AUTH_ROUTES = {
  login: '/auth/login', logout: '/auth/logout', me: '/auth/me',
  password: '/auth/password', forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
} as const;
export const AUTH_ERROR_CODES = ['INVALID_REQUEST', 'UNAUTHENTICATED', 'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED', 'RATE_LIMITED', 'NOT_READY',
  'AUTH_PROVIDER_UNAVAILABLE', 'AUTH_TIMEOUT'] as const;
export type AuthErrorCode = typeof AUTH_ERROR_CODES[number];
export type AuthUser = { userId: string; email: string; role: UserRole; passwordChangeRequired: boolean };
export type AuthUserResponse = { user: AuthUser };
export type AuthOkResponse = { ok: true };
export type AuthErrorResponse = { error: { code: AuthErrorCode; retryable: boolean } };
export type LoginRequest = { email: string; password: string };
export type PasswordRequest = { currentPassword: string; newPassword: string };
export type ForgotPasswordRequest = { email: string };
export type ResetPasswordRequest = { token: string; newPassword: string };
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 128;
export const isAuthUser = (v: unknown): v is AuthUser =>
  exact(v, ['userId', 'email', 'role', 'passwordChangeRequired']) && id(v.userId) &&
  typeof v.email === 'string' && v.email.length >= 3 && v.email.length <= 254 &&
  v.email === v.email.trim().toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) &&
  (v.role === 'super-admin' || v.role === 'user') && typeof v.passwordChangeRequired === 'boolean';
export const isAuthUserResponse = (v: unknown): v is AuthUserResponse => exact(v, ['user']) && isAuthUser(v.user);
export const isAuthOkResponse = (v: unknown): v is AuthOkResponse => exact(v, ['ok']) && v.ok === true;
export const isAuthErrorResponse = (v: unknown): v is AuthErrorResponse => exact(v, ['error']) &&
  exact(v.error, ['code', 'retryable']) && typeof v.error.code === 'string' &&
  (AUTH_ERROR_CODES as readonly string[]).includes(v.error.code) && typeof v.error.retryable === 'boolean';
// END AUTH WIRE
