/**
 * ============================================================================
 * FILE: auth.ts
 * LOCATION: backend/src/contracts/auth.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define closed-admission account, session, and auth wire contracts.
 *
 * ROLE IN PROJECT:
 *    Separates local access state from WorkOS credentials and supplies the
 *    stable P1 interfaces consumed by backend integration and browser clients.
 *
 * KEY COMPONENTS:
 *    - UserAccount / UsersRepository: Bounded account persistence boundary.
 *    - AuthPrincipal / auth wire: Server admission and safe client payloads.
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';

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

export const normalizedEmailSchema = z.string().trim().toLowerCase().min(3).max(254).email();
const password = z.string().min(1).max(1024);
const newPassword = z.string().min(10).max(1024);
export const loginRequestSchema = z.object({ email: normalizedEmailSchema, password }).strict();
export const passwordRequestSchema = z.object({ currentPassword: password, newPassword }).strict()
  .refine(v => v.currentPassword !== v.newPassword);
export const forgotPasswordRequestSchema = z.object({ email: normalizedEmailSchema }).strict();
export const resetPasswordRequestSchema = z.object({ token: z.string().min(1).max(2048), newPassword }).strict();
export const userAccountSchema = z.object({
  schemaVersion: z.literal(1), userId: idSchema, workosUserId: idSchema,
  emailNormalized: z.string().min(3).max(254).email().refine(v => v === v.trim().toLowerCase()),
  role: z.enum(USER_ROLES), status: z.enum(USER_STATUSES), passwordChangeRequired: z.boolean(),
  currentWorkosSessionId: idSchema.nullable(), sessionEpoch: z.number().int().nonnegative().safe(),
  createdAt: isoDateSchema, updatedAt: isoDateSchema,
}).strict();
export type UserAccount = z.infer<typeof userAccountSchema>;
export type AccountRead = { account: UserAccount; revision: number };
export type UserCasResult = { outcome: 'confirmed'; value: AccountRead }
  | { outcome: 'conflict' } | { outcome: 'uncertain' };
export type UsersPage = { items: AccountRead[]; nextCursor: string | null };
export interface UsersRepository {
  get(userId: string): Promise<AccountRead | null>;
  bySubject(workosUserId: string): Promise<AccountRead | null>;
  byEmail(emailNormalized: string): Promise<AccountRead | null>;
  insert(account: UserAccount): Promise<AccountRead>;
  compareAndSwap(expected: AccountRead, next: UserAccount): Promise<UserCasResult>;
  list(options?: { limit?: number; cursor?: string }): Promise<UsersPage>;
}
export type AuthPrincipal = Readonly<{
  account: Readonly<UserAccount>; sessionId: string;
  identity: Readonly<{ userId: string; openRouterUser: string; source: 'authenticated-session' }>;
}>;
