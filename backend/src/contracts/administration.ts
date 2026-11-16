/**
 * ============================================================================
 * FILE: administration.ts
 * LOCATION: backend/src/contracts/administration.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Freeze Administration routes, safe rows, and bounded page/create contracts.
 *
 * ROLE IN PROJECT:
 *    Supplies P2 with closed account-management wire shapes without implementing
 *    Administration business logic or exposing credentials.
 *
 * KEY COMPONENTS:
 *    - ADMINISTRATION_ROUTES / page types: Bounded table and lifecycle paths.
 *    - createUserRequestSchema: User-only creation without Super Admin role.
 * ============================================================================
 */

import { z } from 'zod';
import {
  AUTH_ERROR_CODES,
  isAuthUser,
  normalizedEmailSchema,
  type AuthErrorCode,
  type AuthUser,
} from './auth.js';

// BEGIN ADMINISTRATION WIRE
export const ADMINISTRATION_PROTOCOL_VERSION = 1 as const;
export const ADMINISTRATION_MAX_PAGE_SIZE = 50;
export const ADMINISTRATION_ROUTES = {
  users: '/admin/users',
  deactivate: (userId: string) => `/admin/users/${encodeURIComponent(userId)}/deactivate`,
  reactivate: (userId: string) => `/admin/users/${encodeURIComponent(userId)}/reactivate`,
  passwordReset: (userId: string) => `/admin/users/${encodeURIComponent(userId)}/password-reset`,
} as const;
export type AdministrationUser = AuthUser & { status: 'active' | 'inactive'; createdAt: string };
export type AdministrationPage = { items: AdministrationUser[]; nextCursor: string | null };
export type AdministrationUserResponse = { user: AdministrationUser };
export type CreateUserRequest = { email: string; temporaryPassword: string; role: 'user' };
export type AdministrationErrorCode = AuthErrorCode | 'ACCOUNT_CONFLICT' | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_WRITE_UNCERTAIN' | 'ACCOUNT_PROVISIONING_INCOMPLETE';
export type AdministrationErrorResponse = { error: { code: AdministrationErrorCode; retryable: boolean } };
const adminObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export function isAdministrationUser(v: unknown): v is AdministrationUser {
  if (!adminObject(v) || Object.keys(v).length !== 6 ||
      !['userId', 'email', 'role', 'status', 'passwordChangeRequired', 'createdAt'].every(k => Object.hasOwn(v, k))) return false;
  const { status, createdAt, ...user } = v;
  return isAuthUser(user) && (status === 'active' || status === 'inactive') &&
    typeof createdAt === 'string' && createdAt.length <= 40 && Number.isFinite(Date.parse(createdAt));
}
export const isAdministrationPage = (v: unknown): v is AdministrationPage =>
  adminObject(v) && Object.keys(v).length === 2 && Array.isArray(v.items) &&
  v.items.length <= 50 && v.items.every(isAdministrationUser) &&
  (v.nextCursor === null || (typeof v.nextCursor === 'string' && v.nextCursor.length > 0 && v.nextCursor.length <= 512));
export const isAdministrationUserResponse = (v: unknown): v is AdministrationUserResponse =>
  adminObject(v) && Object.keys(v).length === 1 && Object.hasOwn(v, 'user') && isAdministrationUser(v.user);
export const isAdministrationErrorResponse = (v: unknown): v is AdministrationErrorResponse => {
  if (!adminObject(v) || Object.keys(v).length !== 1 || !adminObject(v.error) || Object.keys(v.error).length !== 2) return false;
  return typeof v.error.retryable === 'boolean' && typeof v.error.code === 'string' &&
    [...AUTH_ERROR_CODES, 'ACCOUNT_CONFLICT', 'ACCOUNT_NOT_FOUND', 'ACCOUNT_WRITE_UNCERTAIN',
      'ACCOUNT_PROVISIONING_INCOMPLETE'].includes(v.error.code);
};
// END ADMINISTRATION WIRE

export const createUserRequestSchema = z.object({ email: normalizedEmailSchema,
  temporaryPassword: z.string().min(8).max(1024), role: z.literal('user') }).strict();
export const administrationPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(512).optional(),
}).strict();
export const administrationActionRequestSchema = z.object({}).strict();
