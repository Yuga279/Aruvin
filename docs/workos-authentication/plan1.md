# Minimal Authentication Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supply P1's closed-admission WorkOS password/session foundation, bounded local users repository, and frozen auth/Administration wire contracts without wiring the existing application or implementing Administration.

**Architecture:** One injected WorkOS adapter owns credentials and SDK sealed sessions; one repository on the existing admitted Mongo connection owns Aurvin identity, role, status, and current session binding. Independently registered Nest endpoints use an auth service and a request-bound principal, never a development identity fallback. P3 supplies request-context integration and root middleware/module wiring; P2 supplies Administration business logic; P4 consumes browser-safe protocol mirrors.

**Tech Stack:** Node 22.22.3+/24.15.0+/26+, TypeScript NodeNext ESM, NestJS 12, Express, Zod 3, MongoDB 6 driver, `@workos-inc/node` `^12.2.0`, existing Vitest/Supertest. No additional frontend dependency.

---

## 0. Authority, scope, and execution safety

Inputs: [goal.md](goal.md), [research.md](research.md) (`550af4e`), [state.md](state.md), especially P1 ownership and current approval/milestone fields. Dated approval/current gate supersede stale preparation paragraphs saying approval is pending. This document is a plan, not implementation or service evidence. Unified review remains **skipped**.

Only this document is created by the planner. The steps below are for the subsequently authorized P1 worker. Do not provision WorkOS, send email, run bootstrap, mutate application data, edit a real `.env`, or use paid inference.

### Preserve the dirty baseline

Run from the repository root before execution and before every commit:

```bash
git status --short
git diff --cached --name-only
```

The following are user work; **never edit, stage, reset, or include them**:

- `backend/src/chat-runtime/durable-chat-runtime.ts`
- `backend/src/persistence/sessions.ts`
- `backend/test/persistence/voice-messages.native.e2e-spec.ts`
- `backend/test/persistence/voice-messages.spec.ts`
- `backend/test/runtime/voice-acceptance.native.e2e-spec.ts`
- `frontend/src/features/chat/state/chat-reducer.ts`
- `frontend/src/features/chat/state/memory-save-state.test.ts`
- `frontend/src/features/chat/state/voice-draft-lock.test.ts`

Preserve `.openchamber/`, untracked files, and private configuration. Obtain the shared commit slot before staging. Every task below specifies an exact commit subject; stage only that task's named files, inspect `git diff --cached --stat` and `git diff --cached --check`, then commit. If unrelated files are already staged, stop and coordinate; do not unstage someone else's work. Never use `git add .`.

### P1/P3 compatibility decision

Research §7.3 proposes ALS, but the reconciled ownership matrix assigns `platform/identity/**` exclusively to **P3**. P1 must not edit those files. P1 exposes `authenticate(cookie)` and `authBoundary(service, run)`; P3 supplies `run` backed by its request store. No P1 API reads a singleton caller, and no P1 service falls back to `AURVIN_USER_ID`.

Existing P3-owned callers and their tests still construct `source: 'server-configured'` and the disabled-development admin assumption. Removing those types in P1 would make the required intermediate build impossible without crossing ownership. Therefore add the two new identity sources and the session assumption **additively**, with explicitly deprecated legacy branches. New auth code and its checks accept only the new authenticated principal. P1 does not change existing admin authorization behavior. The worker must report this bridge to the orchestrator: P3 owns its removal and the old admin-wire/frontend mirror cutover before integrated authentication can be declared complete. This is compile compatibility, never a runtime fallback in the new auth path.

## 1. File map before implementation

Create:

- `backend/src/contracts/auth.ts`: account schema, auth wire shapes/guards, repository port and CAS result, principal.
- `backend/src/contracts/administration.ts`: Administration routes, safe rows, bounded page/create/action contracts only.
- `frontend/src/api/auth-protocol.ts`, `frontend/src/api/administration-protocol.ts`: exact browser-safe wire blocks from the backend contracts, without Zod, provider SDK, repository ports, or secrets.
- `backend/src/persistence/users.ts`: users repository using `RecordStore`, confirmed receipts, executor checks, and bounded keyset paging.
- `backend/src/auth/errors.ts`: closed safe auth errors and status mapping.
- `backend/src/auth/access.ts`: current-account admission, public projection, simple role/onboarding helpers and invalidation projection.
- `backend/src/auth/cookies.ts`: exact single-cookie parse/issue/clear.
- `backend/src/auth/attempt-limiter.ts`: finite process-local login/recovery admission.
- `backend/src/auth/provider.ts`: narrow WorkOS-facing port and SDK adapter, including provider primitives needed by P2/P5 (no account administration policy).
- `backend/src/auth/auth.service.ts`: login, authenticate/refresh, logout, current account, password replacement and recovery.
- `backend/src/auth/auth-boundary.ts`: injectable HTTP/upgrade identity boundary, no ALS implementation.
- `backend/src/auth/configure-auth-http.ts`: auth-route transport/origin/body/cache boundaries only.
- `backend/src/auth/auth.controller.ts`, `backend/src/auth/auth.module.ts`, `backend/src/auth/index.ts`: independently testable Nest adapter and exports.
- `backend/test/auth/contracts.spec.ts`, `compatibility.spec.ts`, `provider.spec.ts`, `access.spec.ts`, `cookies.spec.ts`, `attempt-limiter.spec.ts`, `session.spec.ts`, `password.spec.ts`, `recovery.spec.ts`, `http.spec.ts`, `boundary.spec.ts`, `fixtures.ts`.
- `backend/test/persistence/auth-users.spec.ts`, `auth-users-fixture.ts`, `auth-users.native.e2e-spec.ts`.

Modify only these existing P1-owned seams:

- `backend/src/contracts/{identity.ts,config-runtime.ts,admin-config-wire.ts,collections.ts,index.ts}` and their relevant contract tests.
- `backend/src/persistence/{index.ts,indexes.ts,persistence.ts,mutation-journal.ts}`. The journal change is **only** adding `users` to its collection allowlist; it is a narrowly necessary registration seam, expressly identified in research.
- `backend/src/platform/config/bootstrap-config.ts`, `bootstrap-config.spec.ts` (and `load-config.spec.ts` only if an existing bootstrap loader assertion needs updating; do not convert the legacy import adapter into live auth configuration).
- `backend/.env.example`, `backend/package.json`, `backend/package-lock.json`.

Do not edit `main.ts`, `app.module.ts`, `app.service.ts`, `platform/identity/**`, `admin-config/**`, existing frontend protocol files, frontend clients/UI, scripts, or operations docs. Do not create Administration implementation under `auth/`.

### Mandatory new-code headers

Every newly created `.ts` file, including fixtures/tests and both frontend mirrors, starts with the repository header. For example, prepend this exact header to `backend/src/contracts/auth.ts`:

```typescript
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
```

For every other new file, set FILE/LOCATION to that exact file and describe its responsibility from the file map. The code blocks below show implementation bodies beneath those mandatory headers. Existing files changed by more than 30% also receive a valid header; no comments in package JSON/lockfiles.

## 2. Frozen P1 interfaces and finite choices

- Paths in protocol constants omit `/api`, as existing clients prepend their API base. Nest uses global prefix `api` in isolated tests; production registration is P3.
- Safe current user: `{ userId, email, role, passwordChangeRequired }`; login and `me` both return `{ user }`. `me` is permitted for a limited onboarding session to rediscover its gate after reload; it exposes no application data. Password/logout are its only mutation capabilities. All other private capabilities call `requireFullAccount`.
- Password replacement returns `{ user }` plus a **new** sealed cookie; it verifies `currentPassword`, changes provider credential, confirms a fresh provider session, and only then clears the local gate. Recovery returns `{ ok: true }`, clears the cookie, and requires login.
- All auth request objects are strict; no client `userId`, role, provider ID, token-storage preference, or model override. Password values are never trimmed or normalized.
- `users._id = userId`, payload has no `_revision`. Repository reads return `{ account, revision }`; CAS returns confirmed/conflict/uncertain, never an optimistic boolean success.
- One live `currentWorkosSessionId` per account. A subsequent confirmed login invalidates the previous local session. Put `// ponytail: one live WorkOS session per account; use a bounded session store if concurrent devices become required.` on the login binding.
- WorkOS request timeout 10,000 ms; SDK `maxRetries: 0` (avoid automatic duplicate credential/email writes). At most four adapter operations in flight, fail fast rather than queue. Wrap SDK/JWKS/session waits with existing `boundedResult`; do not claim that this race cancels remote work.
- Auth JSON 4,096 bytes, total body collection deadline 5,000 ms, no compression, only JSON/UTF-8, no auth query strings. Request passwords 1–1,024 code units for login/current password, new password 8–1,024 (WorkOS remains authority for its password policy), email at most 254 characters, reset token 1–2,048 characters. Combined UTF-8 bytes must fit the body ceiling.
- Cookie `aurvin_wos_session`; HttpOnly, SameSite=Strict, Path=/api, Max-Age=28,800 seconds, no Domain. Secure except explicit development loopback HTTP. Cookie header ceiling 16 KiB; individual cookie ceiling 12 KiB. Do not put a raw access/refresh token in a response. Operator must configure a bounded WorkOS absolute session lifetime of at most eight hours; browser Max-Age alone is not server-side absolute expiry. Record that unrun dashboard prerequisite in the worker handoff, not as fixture evidence.
- Login 10/60s/normalized email; forgot-password 3/60s/normalized email, regardless of whether a local account exists; process-wide auth mutation ceiling 60/60s before account lookup. Keep at most 1,024 limiter keys; prune expired entries, refuse new keys when full (never evict a live blocked key). Reset/password share the global ceiling. Rate errors set `Retry-After: 60`.
- Administration page size default 20, max 50; cursor max 512 characters, opaque base64url of `[createdAt,userId]`, order `(createdAt desc,userId desc)`; no count-all query or skip pagination. Row includes userId, email, role, status, passwordChangeRequired, createdAt; no provider session IDs/epochs.
- Local status is checked on **every** admission. Inactive/unknown/sid mismatch all return generic `UNAUTHENTICATED` (401), resolving contradictory research-summary wording in favor of research §4.5 and the goal's safe-login errors. `FORBIDDEN` (403) means a fully authenticated User requested an admin capability. `PASSWORD_CHANGE_REQUIRED` (403) means an otherwise valid limited session requested private capabilities.

## Task 1: Freeze safe auth wire and bounded account/repository contracts

**Files:** create `backend/src/contracts/auth.ts`, `frontend/src/api/auth-protocol.ts`, `backend/test/auth/contracts.spec.ts`; modify `backend/src/contracts/index.ts`, `backend/src/contracts/collections.ts`.

- [ ] **1. Write this failing test** in `backend/test/auth/contracts.spec.ts` (prepend its header):

```typescript
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { AUTH_ROUTES, userAccountSchema, loginRequestSchema,
  isAuthUserResponse } from '../../src/contracts/auth.js';
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
```

The parity-test URL `../../../frontend/...` is relative to `backend/test/auth/` and reaches the frontend package without importing backend runtime code into the browser.

- [ ] **2. RED:** from `backend`, run `npm test -- test/auth/contracts.spec.ts`. Expected: missing `contracts/auth.js` import / missing users export, not a network call.
- [ ] **3. Add this browser-safe block** to `backend/src/contracts/auth.ts` and copy it unchanged between the same markers in `frontend/src/api/auth-protocol.ts`:

```typescript
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
```

The mirror's identifier bounds match the actual `idSchema` (`z.string().min(1).max(128)`); do not add a new alphabet restriction.

Append backend-only definitions to `backend/src/contracts/auth.ts`:

```typescript
import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';

export const normalizedEmailSchema = z.string().trim().toLowerCase().min(3).max(254).email();
const password = z.string().min(1).max(1024);
const newPassword = z.string().min(8).max(1024);
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
```

Stored email deliberately has a non-transforming schema: malformed stored casing fails instead of silently changing on read. Reuse `isoDateSchema` from `identifiers.ts`; do not add a new date policy.

Add `users: 'users'` to `COLLECTIONS`; export `./auth.js` from contracts index. Test complete valid account fixtures in Task 5, not just the deliberately invalid account above.

- [ ] **4. GREEN:** `npm test -- test/auth/contracts.spec.ts`; expected two executed passing tests.
- [ ] **5. Commit:** stage exactly the five files listed for this task; `git commit -m "feat(auth): define safe account and auth wire contracts"`.

## Task 2: Freeze Administration wire without implementing Administration

**Files:** create `backend/src/contracts/administration.ts`, `frontend/src/api/administration-protocol.ts`; update `backend/src/contracts/index.ts`, `backend/test/auth/contracts.spec.ts`.

- [ ] **1. Append the failing tests** (imports at top):

```typescript
import { createUserRequestSchema, ADMINISTRATION_ROUTES, isAdministrationPage } from '../../src/contracts/administration.js';

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
```

- [ ] **2. RED:** `npm test -- test/auth/contracts.spec.ts`; expected missing Administration module.
- [ ] **3. Add this wire block** identically to both files; backend imports from `./auth.js`, frontend from `./auth-protocol` (imports sit outside markers):

```typescript
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
```

Imports for this block: `AuthUser`, `AuthErrorCode` as types and `isAuthUser`, `AUTH_ERROR_CODES` as values. Append backend-only request schemas:

```typescript
import { z } from 'zod';
import { normalizedEmailSchema } from './auth.js';
export const createUserRequestSchema = z.object({ email: normalizedEmailSchema,
  temporaryPassword: z.string().min(8).max(1024), role: z.literal('user') }).strict();
export const administrationPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(512).optional(),
}).strict();
export const administrationActionRequestSchema = z.object({}).strict();
```

Freeze successful creation as HTTP 201 `{ user: AdministrationUser }`; lifecycle actions HTTP 200 `{ user: AdministrationUser }`; email reset HTTP 204, no body. None of these types expose provider identities. Export the backend contract from `index.ts`.

- [ ] **4. GREEN:** `npm test -- test/auth/contracts.spec.ts`; `npm run build` from frontend. Expected four contract tests and frontend build pass.
- [ ] **5. Commit:** stage this task's four files; `git commit -m "feat(auth): freeze Administration and browser protocol shapes"`.

## Task 3: Add authenticated identity/admin contract branches without crossing P3 ownership

**Files:** modify `backend/src/contracts/{identity.ts,config-runtime.ts,admin-config-wire.ts}`; create `backend/test/auth/compatibility.spec.ts`.

- [ ] **1. Write failing test:**

```typescript
import { expect, it } from 'vitest';
import { resolvedIdentitySchema } from '../../src/contracts/identity.js';
import type { AdminConfigActor, SessionAdminConfigActor } from '../../src/contracts/config-runtime.js';
import { isSessionAdminAssumption } from '../../src/contracts/admin-config-wire.js';
it('adds explicit session/operator attribution without assigning browser roles', () => {
  for (const source of ['authenticated-session', 'bootstrap-operator']) {
    expect(resolvedIdentitySchema.parse({ userId: 'u1', openRouterUser: 'u1', source }).source).toBe(source);
  }
  expect(isSessionAdminAssumption({ role: 'user', authentication: 'session', source: 'local-account' })).toBe(true);
  expect(isSessionAdminAssumption({ role: 'super-admin', authentication: 'disabled', source: 'server-configured-development' })).toBe(false);
  const actor: SessionAdminConfigActor = { identity: { userId: 'u1', openRouterUser: 'u1', source: 'authenticated-session' },
    assumption: { role: 'super-admin', authentication: 'session', source: 'local-account' } };
  const compatible: AdminConfigActor = actor;
  expect(compatible.identity.userId).toBe('u1');
});
```

- [ ] **2. RED:** `npm test -- test/auth/compatibility.spec.ts`; expected missing helper/type/new source.
- [ ] **3. Change the identity source** to `z.enum(['server-configured', 'authenticated-session', 'bootstrap-operator'])`, marking the first branch deprecated/P3-cutover-only. Define these admin types and helper:

```typescript
export type SessionAdminRoleAssumption = {
  role: 'super-admin' | 'user'; authentication: 'session'; source: 'local-account';
};
/** @deprecated P3 removes this compile bridge at application auth cutover. */
export type LegacyAdminRoleAssumption = {
  role: 'super-admin'; authentication: 'disabled'; source: 'server-configured-development';
};
export type AdminRoleAssumption = SessionAdminRoleAssumption | LegacyAdminRoleAssumption;
export function isSessionAdminAssumption(value: unknown): value is SessionAdminRoleAssumption {
  return exact(value, { role: x => x === 'super-admin' || x === 'user',
    authentication: x => x === 'session', source: x => x === 'local-account' });
}
```

`isPublicAdminConfig` accepts the new session branch **or** the existing exact legacy branch during this intermediate commit. Do not edit existing admin service/actor behavior. In `config-runtime.ts`, export `SessionAdminConfigActor = { identity: ResolvedIdentity & { source: 'authenticated-session' }; assumption: SessionAdminRoleAssumption }`; keep existing `AdminConfigActor` as the compatibility union. `SessionAdminConfigActor` is a contract for P3, not an authorization result. Only `requireSuperAdmin` in Task 8 grants the capability based on a freshly admitted local account.

- [ ] **4. GREEN:** `npm test -- test/auth/compatibility.spec.ts src/contracts`; `npm run build`. Expected no P3-owned edits needed. Existing frontend admin protocol remains a P3/P4 handoff concern, not a changed P1 file.
- [ ] **5. Commit:** stage the four files; `git commit -m "feat(auth): add session identity and local role contract seams"`.

## Task 4: Validate backend-only WorkOS bootstrap and install only the official SDK

**Files:** modify `backend/src/platform/config/bootstrap-config.ts`, `bootstrap-config.spec.ts`, `backend/.env.example`, `backend/package.json`, `backend/package-lock.json`.

- [ ] **1. Append failing tests** to `bootstrap-config.spec.ts`:

```typescript
it('keeps blank WorkOS diagnostic-only and validates complete private setup', () => {
  expect(loadBootstrapConfig({}).workos).toBeNull();
  expect(loadBootstrapConfig({ WORKOS_API_KEY: '', WORKOS_CLIENT_ID: '', WORKOS_COOKIE_PASSWORD: '' }).workos).toBeNull();
  expect(() => loadBootstrapConfig({ WORKOS_API_KEY: 'sk_fixture' })).toThrow('Invalid application configuration.');
  expect(() => loadBootstrapConfig({ WORKOS_API_KEY: 'sk_fixture', WORKOS_CLIENT_ID: 'client_fixture', WORKOS_COOKIE_PASSWORD: 'short' })).toThrow();
  const env = { WORKOS_API_KEY: 'sk_fixture', WORKOS_CLIENT_ID: 'client_fixture', WORKOS_COOKIE_PASSWORD: 'f'.repeat(32) };
  expect(loadBootstrapConfig(env).workos).toEqual({ apiKey: env.WORKOS_API_KEY,
    clientId: env.WORKOS_CLIENT_ID, cookiePassword: env.WORKOS_COOKIE_PASSWORD });
  expect(legacyConfigWarning(env)).toBeNull();
  for (const name of Object.keys(env)) expect(BOOTSTRAP_ENV_NAMES).toContain(name);
  expect(() => loadBootstrapConfig({ ...env, WORKOS_API_KEY: 'sk_fixture\n' })).toThrow();
});
```

- [ ] **2. RED:** `npm test -- src/platform/config/bootstrap-config.spec.ts`; expected missing workos projection.
- [ ] **3. Add this type/parser** in `bootstrap-config.ts`, append the three names to `BOOTSTRAP_ENV_NAMES`, add `workos?: WorkosBootstrap | null` to `BootstrapConfig`, and set `workos: loadWorkosBootstrap(env)` in the return object. Optional property preserves existing typed P3/P5 bootstrap literals; the actual loader always returns the property.

```typescript
export type WorkosBootstrap = { apiKey: string; clientId: string; cookiePassword: string };
function loadWorkosBootstrap(env: Record<string, string | undefined>): WorkosBootstrap | null {
  const values = [env.WORKOS_API_KEY ?? '', env.WORKOS_CLIENT_ID ?? '', env.WORKOS_COOKIE_PASSWORD ?? ''];
  if (values.every(v => v === '')) return null;
  if (values.some(v => v === '' || v !== v.trim() || /[\u0000-\u001f\u007f]/.test(v) || v.length > 4096)) configurationError();
  const [apiKey, clientId, cookiePassword] = values as [string, string, string];
  if (cookiePassword.length < 32) configurationError();
  return { apiKey, clientId, cookiePassword };
}
```

Do not make this manageable Config, add SDK checks to readiness that call WorkOS, or change `AurvinConfig`/legacy `loadConfig` behavior. P3 integrates WorkOS availability into actual readiness. Add only blank example settings and explanatory comments:

```dotenv
# Legacy owner selector for explicit operator adoption only; not browser login.
AURVIN_USER_ID=aurvin-dev-user
# Backend-only WorkOS custom password sessions. All blank: diagnostic-only.
# Set all three privately; cookie password needs at least 32 characters.
# Rotation signs everyone out. Never copy these into VITE_* settings.
WORKOS_API_KEY=
WORKOS_CLIENT_ID=
WORKOS_COOKIE_PASSWORD=
```

Replace the old development-identity comment, not its value. Run from backend:

```bash
npm install @workos-inc/node@^12.2.0 --save
```

This is an execution step, not permission for the planner to install. Inspect lock diff for only the SDK/transitive additions and compatibility. No frontend SDK, Passport, cookie-parser, token-crypto library, or framework.

- [ ] **4. GREEN:** `npm test -- src/platform/config/bootstrap-config.spec.ts`; `npm run build`; `npm ls @workos-inc/node`. Expected parser tests pass and SDK resolves in the requested supported range. Never print the actual environment.
- [ ] **5. Commit:** stage the five exact task files; `git commit -m "feat(auth): add private WorkOS bootstrap configuration"`.

## Task 5: Add users storage with confirmed reads/CAS and immutable identity

**Files:** create `backend/src/persistence/users.ts`, `backend/test/persistence/auth-users-fixture.ts`, `backend/test/persistence/auth-users.spec.ts`; create `backend/test/auth/fixtures.ts` account factory.

- [ ] **1. Add account fixture** to `backend/test/auth/fixtures.ts` and failing tests to `auth-users.spec.ts`:

```typescript
// fixtures.ts body
import type { UserAccount } from '../../src/contracts/auth.js';
export const at = '2026-11-10T00:00:00.000Z';
export function account(patch: Partial<UserAccount> = {}): UserAccount {
  return { schemaVersion: 1, userId: 'u1', workosUserId: 'user_fixture_1', emailNormalized: 'a@example.com',
    role: 'user', status: 'active', passwordChangeRequired: true, currentWorkosSessionId: null,
    sessionEpoch: 0, createdAt: at, updatedAt: at, ...patch };
}
```

```typescript
import { expect, it } from 'vitest';
import { MongoUsers } from '../../src/persistence/users.js';
import { account } from '../auth/fixtures.js';
import { usersStore } from './auth-users-fixture.js';
it('stores only a bounded account and rejects stale or retargeted CAS', async () => {
  const f = usersStore();
  const users = new MongoUsers(f.store, f.owner, 8192);
  const saved = await users.insert(account());
  expect(saved.revision).toBe(0);
  expect((await users.bySubject('user_fixture_1'))?.account.userId).toBe('u1');
  expect((await users.byEmail('a@example.com'))?.account).toEqual(account());
  const result = await users.compareAndSwap(saved, { ...saved.account, currentWorkosSessionId: 'sid_1' });
  expect(result.outcome).toBe('confirmed');
  expect((await users.compareAndSwap(saved, { ...saved.account, status: 'inactive' })).outcome).toBe('conflict');
  const current = (await users.get('u1'))!;
  await expect(users.compareAndSwap(current, { ...current.account, workosUserId: 'user_other' })).rejects.toThrow();
  await expect(users.insert({ ...account({ userId: 'u2' }), password: 'never-persist' } as never)).rejects.toThrow();
  expect(JSON.stringify([...f.documents.values()])).not.toContain('never-persist');
  expect(f.owner.assertExecutor).toHaveBeenCalled();
});
```

Define the isolated store fixture completely, using real `RecordStore`/confirmed receipts rather than fabricating branded receipts:

```typescript
// auth-users-fixture.ts body
import { isDeepStrictEqual } from 'node:util';
import type { Db } from 'mongodb';
import { vi } from 'vitest';
import { RecordStore } from '../../src/persistence/store.js';
import type { StoredDocument } from '../../src/persistence/records.js';
export function usersStore() {
  const documents = new Map<string, StoredDocument>();
  const matches = (d: StoredDocument, q: Record<string, unknown>) => Object.entries(q)
    .every(([k, v]) => isDeepStrictEqual(d[k], v));
  const collection = {
    findOne: vi.fn(async (filter: Record<string, unknown>) =>
      structuredClone([...documents.values()].find(d => matches(d, filter)) ?? null)),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $setOnInsert: StoredDocument }) => {
      const existing = documents.get(String(filter._id));
      if (existing) return { acknowledged: true, matchedCount: 1, upsertedCount: 0 };
      const d = update.$setOnInsert;
      if ([...documents.values()].some(x => x.workosUserId === d.workosUserId || x.emailNormalized === d.emailNormalized))
        throw new Error('duplicate-key');
      documents.set(d._id, structuredClone(d));
      return { acknowledged: true, matchedCount: 0, upsertedCount: 1 };
    }),
    replaceOne: vi.fn(async (filter: Record<string, unknown>, next: StoredDocument) => {
      const old = documents.get(String(filter._id));
      if (!old || !matches(old, filter)) return { acknowledged: true, matchedCount: 0 };
      documents.set(next._id, structuredClone(next));
      return { acknowledged: true, matchedCount: 1 };
    }),
  };
  const db = { collection: () => collection } as unknown as Db;
  return { documents, collection, store: new RecordStore(db, 1000), owner: { assertExecutor: vi.fn(async () => undefined) } };
}
```

- [ ] **2. RED:** `npm test -- test/persistence/auth-users.spec.ts`; expected missing repository.
- [ ] **3. Implement repository primitives** using these bodies, importing the named contracts, `RecordStore`, `decode`, `bounded`, `assertBytes`, `AppError`, and `MongoOwnership` types:

```typescript
export class MongoUsers implements UsersRepository {
  constructor(private readonly store: RecordStore,
    private readonly owner: Pick<MongoOwnership, 'assertExecutor'>,
    private readonly byteLimit: number) {}
  private async lookup(filter: Record<string, string>): Promise<AccountRead | null> {
    const raw = await this.store.raw('users', filter);
    if (!raw) return null;
    assertBytes(raw, this.byteLimit);
    const value = decode(userAccountSchema, raw)!;
    if (raw._id !== value.userId || !Number.isSafeInteger(raw._revision) || raw._revision < 0)
      throw new AppError('PERSISTENCE_ERROR', 'Account data is unavailable.');
    return { account: value, revision: raw._revision };
  }
  get(userId: string) { return this.lookup({ _id: idSchema.parse(userId) }); }
  bySubject(workosUserId: string) { return this.lookup({ workosUserId: idSchema.parse(workosUserId) }); }
  byEmail(emailNormalized: string) { return this.lookup({ emailNormalized }); }
  async insert(value: UserAccount): Promise<AccountRead> {
    bounded(userAccountSchema, value, value.userId, this.byteLimit);
    await this.owner.assertExecutor();
    const receipt = await this.store.insertConfirmed('users', userAccountSchema, value, value.userId, this.byteLimit);
    await this.owner.assertExecutor();
    const envelope = inspectConfirmedRecord<UserAccount>(receipt, { store: this.store, collection: 'users', id: value.userId });
    return { account: receipt.record as UserAccount, revision: envelope.revision };
  }
  async compareAndSwap(expected: AccountRead, next: UserAccount): Promise<UserCasResult> {
    const previous = expected.account;
    if (next.userId !== previous.userId || next.workosUserId !== previous.workosUserId ||
        next.emailNormalized !== previous.emailNormalized || next.role !== previous.role || next.createdAt !== previous.createdAt)
      throw new AppError('INVALID_REQUEST', 'Account identity cannot be changed.');
    bounded(userAccountSchema, next, previous.userId, this.byteLimit);
    await this.owner.assertExecutor();
    const receipt = await this.store.readConfirmed('users', userAccountSchema, { _id: previous.userId });
    if (!receipt) return { outcome: 'conflict' };
    const inspected = inspectConfirmedRecord<UserAccount>(receipt, { store: this.store, collection: 'users', id: previous.userId });
    if (inspected.revision !== expected.revision || !isDeepStrictEqual(inspected.canonical, previous)) return { outcome: 'conflict' };
    if (next.sessionEpoch < previous.sessionEpoch) throw new AppError('INVALID_REQUEST', 'Invalid account version.');
    const result = await this.store.replaceConfirmed(receipt, userAccountSchema, next, this.byteLimit);
    if (result.outcome !== 'confirmed') return result;
    try { await this.owner.assertExecutor(); } catch { return { outcome: 'uncertain' }; }
    return { outcome: 'confirmed', value: { account: result.receipt.record as UserAccount, revision: expected.revision + 1 } };
  }
}
```

Import `inspectConfirmedRecord` from `./confirmed-record.js` and `isDeepStrictEqual` from `node:util`. The public inspection API exposes `revision` and `canonical`; use that **one receipt**, never a caller-forged receipt or an extra racing read. In Task 5 declare `implements Pick<UsersRepository, 'get' | 'bySubject' | 'byEmail' | 'insert' | 'compareAndSwap'>`; change to `implements UsersRepository` when Task 6 adds `list`.

Before GREEN, append these regression cases in the same test file:

```typescript
it.each([
  { emailNormalized: 'A@EXAMPLE.COM' }, { _revision: -1 }, { _id: 'wrong-id' },
])('rejects malformed stored account %j', async patch => {
  const f = usersStore(); const users = new MongoUsers(f.store, f.owner, 8192);
  await users.insert(account());
  f.documents.set('u1', { ...f.documents.get('u1')!, ...patch });
  await expect(users.bySubject('user_fixture_1')).rejects.toThrow();
});
it('rejects duplicate identities, byte overflow, epoch rollback and uncertain acknowledgement', async () => {
  const f = usersStore(); const users = new MongoUsers(f.store, f.owner, 8192);
  const saved = await users.insert(account({ sessionEpoch: 1 }));
  await expect(users.insert(account({ userId: 'u2' }))).rejects.toThrow();
  await expect(users.insert(account({ userId: 'u2', workosUserId: 'user_2' }))).rejects.toThrow();
  await expect(users.insert(account({ emailNormalized: 'other@example.com' }))).rejects.toThrow();
  await expect(new MongoUsers(f.store, f.owner, 100).insert(account({ userId: 'u3' }))).rejects.toThrow();
  await expect(users.compareAndSwap(saved, { ...saved.account, sessionEpoch: 0 })).rejects.toThrow();
  f.collection.replaceOne.mockImplementationOnce(async () => { throw new Error('unknown'); });
  expect((await users.compareAndSwap(saved, { ...saved.account, status: 'inactive' })).outcome).toBe('uncertain');
});
it('never confirms a write after executor ownership is lost', async () => {
  const f = usersStore(); const users = new MongoUsers(f.store, f.owner, 8192);
  const saved = await users.insert(account());
  f.owner.assertExecutor.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lost'));
  expect((await users.compareAndSwap(saved, { ...saved.account, status: 'inactive' })).outcome).toBe('uncertain');
});
```

- [ ] **4. GREEN:** `npm test -- test/persistence/auth-users.spec.ts`; expected actual read/CAS regression assertions execute, no Mongo prerequisite.
- [ ] **5. Commit:** stage these four files; `git commit -m "feat(auth): add bounded confirmed users repository"`.

## Task 6: Add deterministic bounded users paging and persistence registration

**Files:** modify `backend/src/persistence/{users.ts,indexes.ts,index.ts,persistence.ts,mutation-journal.ts}`, `backend/test/persistence/{auth-users.spec.ts,auth-users-fixture.ts}`.

- [ ] **1. Add failing index and paging tests:**

```typescript
import { APP_INDEXES } from '../../src/persistence/indexes.js';
it('registers unique subjects and email plus stable bounded paging', async () => {
  expect(APP_INDEXES).toContainEqual({ collection: 'users', keys: { workosUserId: 1 }, options: { name: 'users_workos_subject', unique: true } });
  expect(APP_INDEXES).toContainEqual({ collection: 'users', keys: { emailNormalized: 1 }, options: { name: 'users_email', unique: true } });
  const f = usersStore(); const users = new MongoUsers(f.store, f.owner, 8192);
  for (const n of [1, 2, 3]) await users.insert(account({ userId: `u${n}`, workosUserId: `user_${n}`, emailNormalized: `u${n}@example.com` }));
  const first = await users.list({ limit: 2 });
  expect(first.items.map(x => x.account.userId)).toEqual(['u3', 'u2']);
  const last = await users.list({ limit: 2, cursor: first.nextCursor! });
  expect(last.items.map(x => x.account.userId)).toEqual(['u1']);
  expect(last.nextCursor).toBeNull();
  await expect(users.list({ limit: 51 })).rejects.toThrow();
  await expect(users.list({ cursor: 'not-json' })).rejects.toThrow();
});
```

- [ ] **2. RED:** `npm test -- test/persistence/auth-users.spec.ts`; expected missing list/index definitions.
- [ ] **3. Add list** with strict query validation, canonical cursor decoding and one bounded query:

```typescript
async list(options: { limit?: number; cursor?: string } = {}): Promise<UsersPage> {
  const parsed = administrationPageQuerySchema.parse(options);
  const limit = parsed.limit ?? 20;
  let filter: Record<string, unknown> = {};
  if (parsed.cursor) {
    let tuple: unknown;
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(parsed.cursor)) throw new Error('cursor');
      const bytes = Buffer.from(parsed.cursor, 'base64url');
      if (bytes.toString('base64url') !== parsed.cursor) throw new Error('cursor');
      tuple = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch { throw new AppError('INVALID_REQUEST', 'Invalid account page.'); }
    const [createdAt, userId] = z.tuple([isoDateSchema, idSchema]).parse(tuple);
    filter = { $or: [{ createdAt: { $lt: createdAt } }, { createdAt, userId: { $lt: userId } }] };
  }
  const rows = await this.store.collection('users').find(filter, this.store.options())
    .sort({ createdAt: -1, userId: -1 }).limit(limit + 1).toArray();
  const visible = rows.slice(0, limit);
  const items = visible.map(raw => {
    assertBytes(raw, this.byteLimit);
    const value = decode(userAccountSchema, raw)!;
    if (raw._id !== value.userId || !Number.isSafeInteger(raw._revision) || raw._revision < 0)
      throw new AppError('PERSISTENCE_ERROR', 'Account data is unavailable.');
    return { account: value, revision: raw._revision };
  });
  const last = items.at(-1)?.account;
  return { items, nextCursor: rows.length > limit && last
    ? Buffer.from(JSON.stringify([last.createdAt, last.userId])).toString('base64url') : null };
}
```

Extend the fixture's collection with this `find` member. It handles only this repository's exact query; production paging stays in MongoDB:

```typescript
find: vi.fn((filter: { $or?: [{ createdAt: { $lt: string } }, { createdAt: string; userId: { $lt: string } }] }) => {
  const branches = filter.$or;
  let rows = [...documents.values()].filter(d => !branches ||
    String(d.createdAt) < branches[0].createdAt.$lt ||
    (d.createdAt === branches[1].createdAt && String(d.userId) < branches[1].userId.$lt));
  const cursor = {
    sort: vi.fn(() => {
      rows.sort((a, b) => {
        const left = [String(a.createdAt), String(a.userId)];
        const right = [String(b.createdAt), String(b.userId)];
        return left[0]! > right[0]! ? -1 : left[0]! < right[0]! ? 1 : left[1]! > right[1]! ? -1 : left[1]! < right[1]! ? 1 : 0;
      });
      return cursor;
    }),
    limit: vi.fn((limit: number) => { rows = rows.slice(0, limit); return cursor; }),
    toArray: vi.fn(async () => structuredClone(rows)),
  };
  return cursor;
}),
```

After the first page assertion, add `expect(f.collection.find).toHaveBeenCalledWith({}, { maxTimeMS: 1000 })` and inspect `f.collection.find.mock.results[0]!.value.limit` for `toHaveBeenCalledWith(3)`. This leaves a runnable query-bound check rather than inferring boundedness from the source.

Add three indexes to `APP_INDEXES`: unique subject, unique email, non-unique `{ createdAt: -1, userId: -1 }` named `users_created_identity`. The last index intentionally refines research's role-first suggestion to match actual unfiltered table/recovery enumeration. Do not add a redundant role index. Export `MongoUsers` from persistence index, import it in `persistence.ts`, and add `users: new MongoUsers(store, owner, budgets.maxDocumentBytes)` to the returned bundle. Add `'users'` to the journal allowlist only. Do not change executor/checkpointer/close ownership or session persistence.

- [ ] **4. GREEN:** `npm test -- test/persistence/auth-users.spec.ts`; `npm run build`; `npm run lint`. Expected bounded paging/index tests pass; no new Mongo client. Add a source/registration assertion to this test reading `persistence.ts`/`mutation-journal.ts` if full assembly fixture would require crossing P3 ownership; native Task 15 verifies the real path.
- [ ] **5. Commit:** stage only the seven task paths; `git commit -m "feat(auth): register users lifecycle indexes and bounded paging"`.

## Task 7: Define safe errors, cookie lifecycle, and finite attempt admission

**Files:** create `backend/src/auth/{errors.ts,cookies.ts,attempt-limiter.ts}` and `backend/test/auth/{cookies.spec.ts,attempt-limiter.spec.ts}`.

- [ ] **1. Write failing tests:**

```typescript
// cookies.spec.ts body
import { expect, it } from 'vitest';
import { readSessionCookie, sessionCookie, clearSessionCookie } from '../../src/auth/cookies.js';
it('accepts exactly one sealed cookie and never exposes raw tokens', () => {
  expect(readSessionCookie('other=x; aurvin_wos_session=sealed')).toBe('sealed');
  for (const v of [undefined, ['aurvin_wos_session=x'], 'aurvin_wos_session=a; aurvin_wos_session=b',
    'aurvin_wos_session=x, aurvin_wos_session=y', 'aurvin_wos_session=', 'x'.repeat(16385)])
    expect(readSessionCookie(v)).toBeNull();
  expect(sessionCookie('sealed', true)).toBe('aurvin_wos_session=sealed; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800; Secure');
  expect(clearSessionCookie(false)).toBe('aurvin_wos_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
  expect(() => sessionCookie('x\r\nInjected: yes', false)).toThrow();
});
```

```typescript
// attempt-limiter.spec.ts body
import { expect, it } from 'vitest';
import { AttemptLimiter } from '../../src/auth/attempt-limiter.js';
it('limits normalized email and prunes only expired keys', () => {
  let now = 0; const limiter = new AttemptLimiter(() => now);
  for (let n = 0; n < 10; n++) limiter.take('login', 'a@example.com');
  expect(() => limiter.take('login', 'a@example.com')).toThrow('RATE_LIMITED');
  for (let n = 0; n < 3; n++) limiter.take('recovery', 'b@example.com');
  expect(() => limiter.take('recovery', 'b@example.com')).toThrow('RATE_LIMITED');
  now = 60000; expect(() => limiter.take('login', 'a@example.com')).not.toThrow();
});
```

- [ ] **2. RED:** `npm test -- test/auth/cookies.spec.ts test/auth/attempt-limiter.spec.ts`.
- [ ] **3. Implement the small primitives:**

```typescript
// errors.ts body
import type { AuthErrorCode, AuthErrorResponse } from '../contracts/auth.js';
const statuses: Record<AuthErrorCode, number> = { INVALID_REQUEST: 400, UNAUTHENTICATED: 401,
  FORBIDDEN: 403, PASSWORD_CHANGE_REQUIRED: 403, RATE_LIMITED: 429, NOT_READY: 503,
  AUTH_PROVIDER_UNAVAILABLE: 503, AUTH_TIMEOUT: 504 };
export class AuthFault extends Error {
  constructor(readonly code: AuthErrorCode) { super(code); }
  get status() { return statuses[this.code]; }
  body(): AuthErrorResponse { return { error: { code: this.code,
    retryable: ['RATE_LIMITED', 'NOT_READY', 'AUTH_PROVIDER_UNAVAILABLE', 'AUTH_TIMEOUT'].includes(this.code) } }; }
}
```

```typescript
// cookies.ts body
import { AuthFault } from './errors.js';
const name = 'aurvin_wos_session';
export function readSessionCookie(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string' || Buffer.byteLength(header) > 16384 || /[,\r\n\u0000]/.test(header)) return null;
  const values = header.split(';').map(s => s.trim()).filter(s => s.split('=', 1)[0] === name);
  if (values.length !== 1) return null;
  const value = values[0]!.slice(name.length + 1);
  return value.length > 0 && value.length <= 12288 && /^[\x21-\x7e]+$/.test(value) ? value : null;
}
function write(value: string, secure: boolean, maxAge: number): string {
  if (value.length > 12288 || /[\s;,\u0000-\u001f\u007f]/.test(value)) throw new AuthFault('AUTH_PROVIDER_UNAVAILABLE');
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export const sessionCookie = (value: string, secure: boolean) => write(value, secure, 28800);
export const clearSessionCookie = (secure: boolean) => write('', secure, 0);
```

```typescript
// attempt-limiter.ts body
import { AuthFault } from './errors.js';
export class AttemptLimiter {
  private readonly keys = new Map<string, number[]>();
  private readonly global: number[] = [];
  constructor(private readonly now: () => number = Date.now) {}
  takeGlobal(): void {
    const now = this.now(); while (this.global.length && now - this.global[0]! >= 60000) this.global.shift();
    if (this.global.length >= 60) throw new AuthFault('RATE_LIMITED'); this.global.push(now);
  }
  take(kind: 'login' | 'recovery', email: string): void {
    const now = this.now();
    for (const [key, hits] of this.keys) {
      while (hits.length && now - hits[0]! >= 60000) hits.shift();
      if (!hits.length) this.keys.delete(key);
    }
    const key = `${kind}:${email.trim().toLowerCase()}`;
    if (!this.keys.has(key) && this.keys.size >= 1024) throw new AuthFault('RATE_LIMITED');
    const hits = this.keys.get(key) ?? [];
    if (hits.length >= (kind === 'login' ? 10 : 3)) throw new AuthFault('RATE_LIMITED');
    hits.push(now); this.keys.set(key, hits);
  }
}
```

Append these ceiling checks; provider/user outcomes never affect limiter consumption:

```typescript
it('bounds global traffic and live key cardinality without eviction', () => {
  let now = 0; const limiter = new AttemptLimiter(() => now);
  for (let n = 0; n < 60; n++) limiter.takeGlobal();
  expect(() => limiter.takeGlobal()).toThrow('RATE_LIMITED');
  for (let n = 0; n < 1024; n++) limiter.take('login', `u${n}@example.com`);
  expect(() => limiter.take('login', 'new@example.com')).toThrow('RATE_LIMITED');
  now += 60000;
  expect(() => limiter.takeGlobal()).not.toThrow();
  expect(() => limiter.take('login', 'new@example.com')).not.toThrow();
});
```

- [ ] **4. GREEN:** rerun the two focused files; expected all assertions pass without timers or network.
- [ ] **5. Commit:** stage exactly the five files; `git commit -m "feat(auth): bound session cookies and authentication attempts"`.

## Task 8: Add simple current-account/status/role helpers

**Files:** create `backend/src/auth/access.ts`, `backend/test/auth/access.spec.ts`.

- [ ] **1. Write failing test:**

```typescript
import { expect, it } from 'vitest';
import { account } from './fixtures.js';
import { admitAccount, requireFullAccount, requireSuperAdmin, invalidateAccount, publicUser } from '../../src/auth/access.js';
it('separates active ownership from onboarding and administrative capability', () => {
  const a = account({ currentWorkosSessionId: 'sid_1' });
  const p = admitAccount(a, 'sid_1');
  expect(p.identity).toEqual({ userId: 'u1', openRouterUser: 'u1', source: 'authenticated-session' });
  expect(() => requireFullAccount(p)).toThrow('PASSWORD_CHANGE_REQUIRED');
  expect(() => requireSuperAdmin(admitAccount({ ...a, passwordChangeRequired: false }, 'sid_1'))).toThrow('FORBIDDEN');
  expect(() => requireSuperAdmin(admitAccount({ ...a, role: 'super-admin', passwordChangeRequired: false }, 'sid_1'))).not.toThrow();
  expect(() => admitAccount({ ...a, status: 'inactive' }, 'sid_1')).toThrow('UNAUTHENTICATED');
  expect(() => admitAccount(a, 'sid_other')).toThrow('UNAUTHENTICATED');
  expect(() => admitAccount(null, 'sid_1')).toThrow('UNAUTHENTICATED');
  expect(publicUser(a)).toEqual({ userId: 'u1', email: 'a@example.com', role: 'user', passwordChangeRequired: true });
  const invalid = invalidateAccount(a, '2026-11-10T01:00:00.000Z');
  expect(invalid.currentWorkosSessionId).toBeNull(); expect(invalid.sessionEpoch).toBe(1);
  expect(() => admitAccount({ ...invalid, status: 'active' }, 'sid_1')).toThrow('UNAUTHENTICATED');
});
```

- [ ] **2. RED:** `npm test -- test/auth/access.spec.ts`.
- [ ] **3. Implement:**

```typescript
import type { AuthPrincipal, AuthUser, UserAccount } from '../contracts/auth.js';
import { AuthFault } from './errors.js';
export function publicUser(a: Readonly<UserAccount>): AuthUser {
  return { userId: a.userId, email: a.emailNormalized, role: a.role, passwordChangeRequired: a.passwordChangeRequired };
}
export function admitAccount(a: UserAccount | null, sessionId: string): AuthPrincipal {
  if (!a || a.status !== 'active' || a.currentWorkosSessionId !== sessionId) throw new AuthFault('UNAUTHENTICATED');
  return Object.freeze({ account: Object.freeze(structuredClone(a)), sessionId,
    identity: Object.freeze({ userId: a.userId, openRouterUser: a.userId, source: 'authenticated-session' as const }) });
}
export function requireFullAccount(p: AuthPrincipal): AuthPrincipal {
  if (p.account.passwordChangeRequired) throw new AuthFault('PASSWORD_CHANGE_REQUIRED'); return p;
}
export function requireSuperAdmin(p: AuthPrincipal): AuthPrincipal {
  requireFullAccount(p); if (p.account.role !== 'super-admin') throw new AuthFault('FORBIDDEN'); return p;
}
export function invalidateAccount(a: Readonly<UserAccount>, updatedAt: string): UserAccount {
  if (!Number.isSafeInteger(a.sessionEpoch + 1)) throw new AuthFault('NOT_READY');
  return { ...a, currentWorkosSessionId: null, sessionEpoch: a.sessionEpoch + 1, updatedAt };
}
```

These helpers have no admin target rules, no status mutation endpoint, and no provider role claims. P2 composes `invalidateAccount` with repository CAS; P3 captures `principal.identity` on accepted work. They do not make a stale stored principal authoritative for future requests: reauthenticate at each boundary.

- [ ] **4. GREEN:** `npm test -- test/auth/access.spec.ts`.
- [ ] **5. Commit:** stage both files; `git commit -m "feat(auth): add explicit local account admission helpers"`.

## Task 9: Add the bounded SDK adapter and fixture provider

**Files:** create `backend/src/auth/provider.ts`, `backend/test/auth/provider.spec.ts`; update `backend/test/auth/fixtures.ts`.

- [ ] **1. Define the port** in the new source (this is the failing import seam):

```typescript
export type ProviderSession = { workosUserId: string; sessionId: string; sealedSession?: string };
export type ProviderUser = { id: string; email: string; externalId: string | null };
export interface AuthProvider {
  login(email: string, password: string): Promise<ProviderSession & { sealedSession: string }>;
  read(sealedSession: string): Promise<ProviderSession>;
  revoke(sessionId: string): Promise<void>;
  replacePassword(workosUserId: string, password: string): Promise<void>;
  sendRecovery(email: string): Promise<void>;
  reset(token: string, newPassword: string): Promise<{ workosUserId: string }>;
  createUser(input: { email: string; password: string; externalId: string }): Promise<ProviderUser>;
  getUser(workosUserId: string): Promise<ProviderUser>;
  listSessions(workosUserId: string, after?: string): Promise<{ ids: string[]; nextCursor: string | null }>;
}
```

Add this failing test using an injected real-SDK-shaped stub rather than HTTP/network:

```typescript
import { expect, it, vi } from 'vitest';
import { WorkosProvider } from '../../src/auth/provider.js';
it('uses SDK sealing/issuer validation and never returns raw SDK tokens', async () => {
  const authenticate = vi.fn(async () => ({ authenticated: true, user: { id: 'user_fixture_1' }, sessionId: 'sid_1' }));
  const um = { authenticateWithPassword: vi.fn(async () => ({ user: { id: 'user_fixture_1' },
    sealedSession: 'sealed', accessToken: 'raw-access', refreshToken: 'raw-refresh' })),
    loadSealedSession: vi.fn(() => ({ authenticate, refresh: vi.fn() })) };
  const p = new WorkosProvider({ clientId: 'client_fixture', cookiePassword: 'f'.repeat(32) }, um as never);
  expect(await p.login('a@example.com', 'password')).toEqual({ workosUserId: 'user_fixture_1', sessionId: 'sid_1', sealedSession: 'sealed' });
  expect(um.authenticateWithPassword).toHaveBeenCalledWith({ clientId: 'client_fixture', email: 'a@example.com', password: 'password',
    session: { sealSession: true, cookiePassword: 'f'.repeat(32) } });
  expect(JSON.stringify(await p.read('sealed'))).not.toContain('raw-');
});
```

- [ ] **2. RED:** `npm test -- test/auth/provider.spec.ts`; expected missing adapter constructor.
- [ ] **3. Implement factory/adapter** with one SDK instance per composition, importing `WorkOS`, `boundedResult`, `AuthFault`, `idSchema`, and `WorkosBootstrap`:

```typescript
export function createWorkosProvider(config: WorkosBootstrap): WorkosProvider {
  const sdk = new WorkOS(config.apiKey, { clientId: config.clientId,
    issuer: `https://api.workos.com/user_management/${config.clientId}`, timeout: 10000, maxRetries: 0 });
  return new WorkosProvider(config, sdk.userManagement);
}
export class WorkosProvider implements AuthProvider {
  private active = 0;
  constructor(private readonly config: Pick<WorkosBootstrap, 'clientId' | 'cookiePassword'>,
    private readonly um: WorkOS['userManagement']) {}
  private async bounded<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= 4) throw new AuthFault('RATE_LIMITED');
    this.active++;
    const pending = Promise.resolve().then(job).then(value => ({ value }), error => ({ error }));
    // Keep the slot until actual settlement, including after a response timeout.
    void pending.finally(() => { this.active--; });
    const result = await boundedResult(pending, 10000);
    if (!result.ok) throw new AuthFault('AUTH_TIMEOUT');
    if ('error' in result.value) throw result.value.error instanceof ProviderAccountConflict
      ? result.value.error : safeProviderFault(result.value.error);
    return result.value.value;
  }
  async login(email: string, password: string): Promise<ProviderSession & { sealedSession: string }> {
    return this.bounded(async () => {
      const r = await this.um.authenticateWithPassword({ clientId: this.config.clientId, email, password,
        session: { sealSession: true, cookiePassword: this.config.cookiePassword } });
      if (!r.sealedSession) throw new AuthFault('AUTH_PROVIDER_UNAVAILABLE');
      const auth = await this.um.loadSealedSession({ sessionData: r.sealedSession, cookiePassword: this.config.cookiePassword }).authenticate();
      if (!auth.authenticated || auth.user.id !== r.user.id) throw new AuthFault('UNAUTHENTICATED');
      return { workosUserId: idSchema.parse(auth.user.id), sessionId: idSchema.parse(auth.sessionId), sealedSession: r.sealedSession };
    });
  }
  read(sealedSession: string): Promise<ProviderSession> {
    return this.bounded(async () => {
      const session = this.um.loadSealedSession({ sessionData: sealedSession, cookiePassword: this.config.cookiePassword });
      const result = await session.authenticate();
      if (result.authenticated) return { workosUserId: idSchema.parse(result.user.id), sessionId: idSchema.parse(result.sessionId) };
      if (result.reason !== 'invalid_jwt') throw new AuthFault('UNAUTHENTICATED');
      const refreshed = await session.refresh();
      if (!refreshed.authenticated) throw new AuthFault(refreshed.retryable ? 'AUTH_PROVIDER_UNAVAILABLE' : 'UNAUTHENTICATED');
      const verified = await this.um.loadSealedSession({ sessionData: refreshed.sealedSession, cookiePassword: this.config.cookiePassword }).authenticate();
      if (!verified.authenticated) throw new AuthFault('UNAUTHENTICATED');
      return { workosUserId: idSchema.parse(verified.user.id), sessionId: idSchema.parse(verified.sessionId), sealedSession: refreshed.sealedSession };
    });
  }
  revoke(sessionId: string) { return this.bounded(() => this.um.revokeSession({ sessionId })); }
  replacePassword(userId: string, password: string) {
    return this.bounded(async () => { const user = await this.um.updateUser({ userId, password });
      if (user.id !== userId) throw new AuthFault('AUTH_PROVIDER_UNAVAILABLE'); });
  }
  sendRecovery(email: string) {
    return this.bounded(async () => { await this.um.createPasswordReset({ email }); });
  }
  reset(token: string, newPassword: string) {
    return this.bounded(async () => { const { user } = await this.um.resetPassword({ token, newPassword });
      return { workosUserId: idSchema.parse(user.id) }; });
  }
  createUser(input: { email: string; password: string; externalId: string }) {
    return this.bounded(async () => {
      try {
        const u = await this.um.createUser({ ...input, emailVerified: true });
        return { id: u.id, email: u.email, externalId: u.externalId ?? null };
      } catch (error) {
        const e = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {};
        if (e.status === 409 || ['email_exists', 'external_id_already_exists', 'user_already_exists'].includes(String(e.code)))
          throw new ProviderAccountConflict();
        throw error;
      }
    });
  }
  getUser(userId: string) {
    return this.bounded(async () => { const u = await this.um.getUser(userId);
      return { id: u.id, email: u.email, externalId: u.externalId ?? null }; });
  }
  listSessions(userId: string, after?: string) {
    return this.bounded(async () => { const page = await this.um.listSessions(userId, { limit: 100, ...(after ? { after } : {}) });
      return { ids: page.data.map(s => idSchema.parse(s.id)), nextCursor: page.listMetadata.after ?? null }; });
  }
}
```

Define `safeProviderFault` in the same file; inspect actual exported v12 exception fields, but do not return their message, body, email, pending token, or cause:

```typescript
function safeProviderFault(error: unknown): AuthFault {
  if (error instanceof AuthFault) return error;
  const e = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof e.code === 'string' ? e.code : typeof e.error === 'string' ? e.error : '';
  if (e.status === 429 || e.statusCode === 429) return new AuthFault('RATE_LIMITED');
  if (e.status === 408 || e.statusCode === 408) return new AuthFault('AUTH_TIMEOUT');
  if (['invalid_credentials', 'invalid_grant', 'email_verification_required', 'mfa_challenge',
    'password_reset_token_expired', 'password_reset_token_invalid'].includes(code)) return new AuthFault('UNAUTHENTICATED');
  if (e.status === 400 || e.status === 409 || e.status === 422 || e.statusCode === 409) return new AuthFault('INVALID_REQUEST');
  return new AuthFault('AUTH_PROVIDER_UNAVAILABLE');
}
```

P2 needs duplicate creation distinguished from a malformed request. Add this internal error class used by the adapter above:

```typescript
export class ProviderAccountConflict extends Error { constructor() { super('ACCOUNT_CONFLICT'); } }
```

P2 consumes this exception and decides the safe Administration response. Do not map a provider conflict to success or adopt by email. Treat unclassified 422 creation errors as safe rejection, never duplicate-success. For replace/reset only, catch provider 400/422 and throw `AuthFault('INVALID_REQUEST')` (password-policy/invalid-reset input) without copying provider messages; map MFA/email-verification/challenge errors to generic 401. Add exception-shape tests with actual exported SDK exception constructors so tests cannot validate an invented status field. No `.rawData`, `.message`, `.pendingAuthenticationToken`, or `.cause` crosses the adapter boundary.

The API returns `resetPassword(...): { user }`, not a token/identity string. `getPasswordReset` takes a reset-object ID, **not the link token**; do not misuse it to infer an owner. `authenticate()` failures have `reason: invalid_jwt`, not a separate `expired` reason; only this reason attempts SDK refresh. Successful refresh must be validated again and its cookie rewritten **only after local admission**. JWKS/provider outage produces retryable error and preserves the browser cookie. Terminal invalid refresh produces 401 and clears it. Do not hand-decode JWTs or implement token verification/cryptography.

Append these exact adapter regressions. SDK returns are deliberately confined to the adapter; no provider response object is returned directly:

```typescript
function sdkFixture() {
  const authenticate = vi.fn(); const refresh = vi.fn();
  const session = { authenticate, refresh };
  const um = { authenticateWithPassword: vi.fn(), loadSealedSession: vi.fn(() => session),
    createPasswordReset: vi.fn(), resetPassword: vi.fn(), revokeSession: vi.fn(), updateUser: vi.fn() };
  return { um, authenticate, refresh, provider: new WorkosProvider(
    { clientId: 'client_fixture', cookiePassword: 'f'.repeat(32) }, um as never) };
}
it('bounds hung SDK operations and retains in-flight slots until settlement', async () => {
  vi.useFakeTimers();
  try {
    const f = sdkFixture(); f.um.createPasswordReset.mockImplementation(() => new Promise(() => undefined));
    const jobs = Array.from({ length: 4 }, () => f.provider.sendRecovery('a@example.com'));
    const outcomes = Promise.allSettled(jobs);
    await expect(f.provider.sendRecovery('a@example.com')).rejects.toThrow('RATE_LIMITED');
    await vi.advanceTimersByTimeAsync(10000);
    expect((await outcomes).every(r => r.status === 'rejected' && r.reason.message === 'AUTH_TIMEOUT')).toBe(true);
    await expect(f.provider.sendRecovery('a@example.com')).rejects.toThrow('RATE_LIMITED');
  } finally { vi.useRealTimers(); }
});
it('discards generated recovery tokens and maps SDK reset user correctly', async () => {
  const f = sdkFixture();
  f.um.createPasswordReset.mockResolvedValue({ passwordResetToken: 'raw-reset-token', passwordResetUrl: 'https://secret.example/reset' });
  expect(await f.provider.sendRecovery('a@example.com')).toBeUndefined();
  f.um.resetPassword.mockResolvedValue({ user: { id: 'user_fixture_1' } });
  expect(await f.provider.reset('token', 'private-password')).toEqual({ workosUserId: 'user_fixture_1' });
});
it.each([true, false])('handles refresh retryable=%s without invented expiry reasons', async retryable => {
  const f = sdkFixture();
  f.authenticate.mockResolvedValue({ authenticated: false, reason: 'invalid_jwt' });
  f.refresh.mockResolvedValue({ authenticated: false, retryable });
  await expect(f.provider.read('sealed')).rejects.toThrow(retryable ? 'AUTH_PROVIDER_UNAVAILABLE' : 'UNAUTHENTICATED');
});
it('revalidates a rotated sealed session and does not refresh malformed cookies', async () => {
  const f = sdkFixture();
  f.authenticate.mockResolvedValueOnce({ authenticated: false, reason: 'invalid_jwt' })
    .mockResolvedValueOnce({ authenticated: true, sessionId: 'sid_rotated', user: { id: 'user_fixture_1' } });
  f.refresh.mockResolvedValueOnce({ authenticated: true, sealedSession: 'rotated' });
  expect(await f.provider.read('sealed')).toEqual({ workosUserId: 'user_fixture_1', sessionId: 'sid_rotated', sealedSession: 'rotated' });
  f.authenticate.mockResolvedValueOnce({ authenticated: false, reason: 'invalid_session_cookie' });
  await expect(f.provider.read('bad')).rejects.toThrow('UNAUTHENTICATED');
  expect(f.refresh).toHaveBeenCalledTimes(1);
});
```

Use the inspected v12 `AuthenticationException` constructor in an additional `it.each(['email_verification_required','mfa_challenge'])` fixture: `new AuthenticationException(400, { code, pending_authentication_token: 'raw-pending' }, 'fixture-request')`; SDK login rejects with it, adapter rejects with static `UNAUTHENTICATED` and never exposes the pending token. Instantiate the factory with a mocked WorkOS constructor to assert `issuer`, `timeout: 10000`, and `maxRetries: 0` without contacting JWKS.

Append the fixture provider in `backend/test/auth/fixtures.ts`:

```typescript
import { vi } from 'vitest';
import type { AuthProvider } from '../../src/auth/provider.js';
export function providerFixture() {
  return {
    login: vi.fn<AuthProvider['login']>(async () => ({ workosUserId: 'user_fixture_1', sessionId: 'sid_1', sealedSession: 'sealed_1' })),
    read: vi.fn<AuthProvider['read']>(async () => ({ workosUserId: 'user_fixture_1', sessionId: 'sid_1' })),
    revoke: vi.fn<AuthProvider['revoke']>(async () => undefined),
    replacePassword: vi.fn<AuthProvider['replacePassword']>(async () => undefined),
    sendRecovery: vi.fn<AuthProvider['sendRecovery']>(async () => undefined),
    reset: vi.fn<AuthProvider['reset']>(async () => ({ workosUserId: 'user_fixture_1' })),
    createUser: vi.fn<AuthProvider['createUser']>(async i => ({ id: 'user_created', email: i.email, externalId: i.externalId })),
    getUser: vi.fn<AuthProvider['getUser']>(async () => ({ id: 'user_fixture_1', email: 'a@example.com', externalId: 'u1' })),
    listSessions: vi.fn<AuthProvider['listSessions']>(async () => ({ ids: ['sid_1'], nextCursor: null })),
  };
}
```

- [ ] **4. GREEN:** `npm test -- test/auth/provider.spec.ts`; `npm run build`; expected SDK v12 types agree, all tests use stubs. If docs and installed types differ, correct the adapter/test together within P1 and report the precise difference; never weaken verification.
- [ ] **5. Commit:** stage these three files; `git commit -m "feat(auth): wrap supported WorkOS password and session APIs"`.

## Task 10: Implement closed login, current admission, refresh, and logout

**Files:** create `backend/src/auth/auth.service.ts`, `backend/test/auth/session.spec.ts`; update `backend/test/auth/fixtures.ts`.

- [ ] **1. Add service fixture** using the actual new repository on the isolated fake (no bespoke second in-memory account implementation):

```typescript
import { MongoUsers } from '../../src/persistence/users.js';
import { usersStore } from '../persistence/auth-users-fixture.js';
import { AuthService } from '../../src/auth/auth.service.js';
export async function authFixture(initial = account()) {
  const storage = usersStore(); const users = new MongoUsers(storage.store, storage.owner, 8192);
  await users.insert(initial); const provider = providerFixture();
  const service = new AuthService({ users, provider, now: () => new Date(at) });
  return { ...storage, users, provider, service };
}
```

Write failing `session.spec.ts`:

```typescript
import { expect, it } from 'vitest';
import { account, authFixture } from './fixtures.js';
import { AuthFault } from '../../src/auth/errors.js';
it('binds a provisioned account only after confirmed login persistence', async () => {
  const f = await authFixture();
  const result = await f.service.login({ email: ' A@EXAMPLE.COM ', password: 'temporary' });
  expect(result.user.passwordChangeRequired).toBe(true); expect(result.sealedSession).toBe('sealed_1');
  expect((await f.service.authenticate('sealed_1')).principal.identity.userId).toBe('u1');
  f.provider.read.mockResolvedValueOnce({ workosUserId: 'user_unmapped', sessionId: 'sid_1' });
  await expect(f.service.authenticate('other')).rejects.toThrow('UNAUTHENTICATED');
});
it('does not revive an old sid after deactivation/reactivation or a second login', async () => {
  const f = await authFixture(account({ passwordChangeRequired: false }));
  await f.service.login({ email: 'a@example.com', password: 'private' });
  const old = (await f.users.get('u1'))!;
  await f.users.compareAndSwap(old, { ...old.account, status: 'inactive', currentWorkosSessionId: null, sessionEpoch: 1 });
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
  const inactive = (await f.users.get('u1'))!;
  await f.users.compareAndSwap(inactive, { ...inactive.account, status: 'active' });
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
});
it('invalidates locally and clears current logout even when provider revocation fails', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  const p = (await f.service.authenticate('sealed_1')).principal;
  f.provider.revoke.mockRejectedValueOnce(new AuthFault('AUTH_PROVIDER_UNAVAILABLE'));
  await expect(f.service.logout(p)).rejects.toThrow('AUTH_PROVIDER_UNAVAILABLE');
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
});
```

- [ ] **2. RED:** `npm test -- test/auth/session.spec.ts`.
- [ ] **3. Implement service core** (imports all named contracts/helpers/errors/provider/limiter):

```typescript
export type AuthServiceOptions = { users: UsersRepository; provider: AuthProvider | null; now?: () => Date };
export class AuthService {
  private readonly limiter = new AttemptLimiter();
  constructor(private readonly o: AuthServiceOptions) {}
  private now() { return (this.o.now ?? (() => new Date()))().toISOString(); }
  private provider(): AuthProvider { if (!this.o.provider) throw new AuthFault('NOT_READY'); return this.o.provider; }
  private async confirmed(expected: AccountRead, next: UserAccount): Promise<AccountRead> {
    const r = await this.o.users.compareAndSwap(expected, next);
    if (r.outcome !== 'confirmed') throw new AuthFault('NOT_READY'); return r.value;
  }
  async login(body: unknown): Promise<{ user: AuthUser; sealedSession: string }> {
    this.limiter.takeGlobal();
    const request = parse(loginRequestSchema, body); this.limiter.take('login', request.email);
    const provider = this.provider();
    // Snapshot before inference-like external work; a concurrent deactivate/reset must win the CAS.
    const local = await this.o.users.byEmail(request.email);
    const session = await provider.login(request.email, request.password);
    if (!local || local.account.status !== 'active' || local.account.workosUserId !== session.workosUserId) {
      await provider.revoke(session.sessionId).catch(() => undefined); throw new AuthFault('UNAUTHENTICATED');
    }
    // ponytail: one live WorkOS session per account; use a bounded session store if concurrent devices become required.
    let saved: AccountRead;
    try { saved = await this.confirmed(local, { ...local.account, currentWorkosSessionId: session.sessionId, updatedAt: this.now() }); }
    catch (error) { await provider.revoke(session.sessionId).catch(() => undefined); throw error; }
    return { user: publicUser(saved.account), sealedSession: session.sealedSession };
  }
  async authenticate(cookie: string | null): Promise<{ principal: AuthPrincipal; sealedSession?: string }> {
    const provider = this.provider(); if (!cookie) throw new AuthFault('UNAUTHENTICATED');
    const session = await provider.read(cookie);
    const local = await this.o.users.bySubject(session.workosUserId);
    const principal = admitAccount(local?.account ?? null, session.sessionId);
    return { principal, ...(session.sealedSession ? { sealedSession: session.sealedSession } : {}) };
  }
  async logout(principal: AuthPrincipal): Promise<void> {
    const provider = this.provider(); const current = await this.o.users.get(principal.account.userId);
    if (current && current.account.currentWorkosSessionId === principal.sessionId)
      await this.confirmed(current, invalidateAccount(current.account, this.now()));
    await provider.revoke(principal.sessionId);
  }
  me(principal: AuthPrincipal): AuthUserResponse { return { user: publicUser(principal.account) }; }
}
```

Define this helper in the same file, importing the two Zod types; never serialize Zod issues containing input:

```typescript
function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new AuthFault('INVALID_REQUEST');
  return result.data;
}
```

Provider login failures/unknown/inactive all stay generic; fixture-test any actual SDK error mapping not covered in Task 9.

Append these regressions before GREEN (add `vi` to the Vitest import and import `AuthService`):

```typescript
it.each([
  { status: 'inactive' as const }, { workosUserId: 'user_other' },
])('rejects provider-valid credentials without matching active local admission %j', async patch => {
  const f = await authFixture(account(patch));
  await expect(f.service.login({ email: 'a@example.com', password: 'temporary' })).rejects.toThrow('UNAUTHENTICATED');
  expect(f.provider.revoke).toHaveBeenCalledWith('sid_1');
});
it('lets a concurrent deactivation defeat paused login CAS', async () => {
  const f = await authFixture();
  let release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  f.provider.login.mockImplementationOnce(async () => { await pause;
    return { workosUserId: 'user_fixture_1', sessionId: 'sid_1', sealedSession: 'sealed_1' }; });
  const loggingIn = f.service.login({ email: 'a@example.com', password: 'temporary' });
  await vi.waitFor(() => expect(f.provider.login).toHaveBeenCalledOnce());
  const before = (await f.users.get('u1'))!;
  await f.users.compareAndSwap(before, { ...before.account, status: 'inactive', sessionEpoch: 1 });
  release(); await expect(loggingIn).rejects.toThrow('NOT_READY');
  expect((await f.users.get('u1'))!.account.currentWorkosSessionId).toBeNull();
});
it('never issues a cookie on uncertain local binding', async () => {
  const f = await authFixture();
  vi.spyOn(f.users, 'compareAndSwap').mockResolvedValueOnce({ outcome: 'uncertain' });
  await expect(f.service.login({ email: 'a@example.com', password: 'temporary' })).rejects.toThrow('NOT_READY');
  expect(f.provider.revoke).toHaveBeenCalledWith('sid_1');
});
it('second login rejects old cookies and stale logout cannot erase the new sid', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1', passwordChangeRequired: false }));
  const old = (await f.service.authenticate('sealed_1')).principal;
  f.provider.login.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_2', sealedSession: 'sealed_2' });
  await f.service.login({ email: 'a@example.com', password: 'private-password' });
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
  await f.service.logout(old);
  expect((await f.users.get('u1'))!.account.currentWorkosSessionId).toBe('sid_2');
});
it('checks refreshed sid locally and never falls back when setup is absent', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  f.provider.read.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_other', sealedSession: 'rotated' });
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
  await expect(new AuthService({ users: f.users, provider: null }).authenticate('sealed_1')).rejects.toThrow('NOT_READY');
});
```

Session secrets remain internal service output only; the controller whitelists response JSON. HTTP refresh-error cookie behavior is verified in Task 14.

- [ ] **4. GREEN:** `npm test -- test/auth/session.spec.ts`; `npm run build`.
- [ ] **5. Commit:** stage the three files; `git commit -m "feat(auth): enforce closed session admission and durable logout"`.

## Task 11: Require verified different private password before un-gating

**Files:** modify `backend/src/auth/auth.service.ts`; create `backend/test/auth/password.spec.ts`.

- [ ] **1. Write failing tests:**

```typescript
import { expect, it } from 'vitest';
import { account, authFixture } from './fixtures.js';
import { AuthFault } from '../../src/auth/errors.js';
it('confirms current password, replaces provider credential, and only then unlocks a fresh sid', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  const p = (await f.service.authenticate('sealed_1')).principal;
  f.provider.login.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_verify', sealedSession: 'verify' })
    .mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_private', sealedSession: 'private' });
  const r = await f.service.password(p, { currentPassword: 'temporary', newPassword: 'private-password' });
  expect(f.provider.replacePassword).toHaveBeenCalledWith('user_fixture_1', 'private-password');
  expect(f.provider.revoke).toHaveBeenCalledWith('sid_verify');
  expect(r).toEqual({ user: { userId: 'u1', email: 'a@example.com', role: 'user', passwordChangeRequired: false }, sealedSession: 'private' });
  const saved = (await f.users.get('u1'))!.account;
  expect(saved.currentWorkosSessionId).toBe('sid_private'); expect(saved.sessionEpoch).toBe(1);
});
it('never lifts the gate for equal passwords or unknown provider replacement', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  const p = (await f.service.authenticate('sealed_1')).principal;
  await expect(f.service.password(p, { currentPassword: 'temporary', newPassword: 'temporary' })).rejects.toThrow('INVALID_REQUEST');
  expect(f.provider.replacePassword).not.toHaveBeenCalled();
  f.provider.replacePassword.mockRejectedValueOnce(new AuthFault('AUTH_TIMEOUT'));
  await expect(f.service.password(p, { currentPassword: 'temporary', newPassword: 'private-password' })).rejects.toThrow('AUTH_TIMEOUT');
  expect((await f.users.get('u1'))!.account.passwordChangeRequired).toBe(true);
});
```

- [ ] **2. RED:** `npm test -- test/auth/password.spec.ts`.
- [ ] **3. Add this service method:**

```typescript
async password(principal: AuthPrincipal, body: unknown): Promise<{ user: AuthUser; sealedSession: string }> {
  this.limiter.takeGlobal(); const request = parse(passwordRequestSchema, body); const provider = this.provider();
  const current = await this.o.users.get(principal.account.userId);
  if (!current) throw new AuthFault('UNAUTHENTICATED'); admitAccount(current.account, principal.sessionId);
  this.limiter.take('login', current.account.emailNormalized);
  const proof = await provider.login(current.account.emailNormalized, request.currentPassword);
  try {
    if (proof.workosUserId !== current.account.workosUserId) throw new AuthFault('UNAUTHENTICATED');
  } finally { await provider.revoke(proof.sessionId); }
  // Remove old application access before dispatching a credential mutation. A timeout cannot unlock it.
  const fenced = await this.confirmed(current, invalidateAccount(current.account, this.now()));
  await provider.replacePassword(current.account.workosUserId, request.newPassword);
  const fresh = await provider.login(current.account.emailNormalized, request.newPassword);
  if (fresh.workosUserId !== current.account.workosUserId) {
    await provider.revoke(fresh.sessionId).catch(() => undefined); throw new AuthFault('UNAUTHENTICATED');
  }
  let saved: AccountRead;
  try { saved = await this.confirmed(fenced, { ...fenced.account, passwordChangeRequired: false,
    currentWorkosSessionId: fresh.sessionId, updatedAt: this.now() }); }
  catch (error) { await provider.revoke(fresh.sessionId).catch(() => undefined); throw error; }
  await provider.revoke(principal.sessionId).catch(() => undefined);
  return { user: publicUser(saved.account), sealedSession: fresh.sealedSession };
}
```

This is stronger than checking that the caller supplied two unequal strings: the current password is actually authenticated for the same WorkOS subject. The verification session is never locally bound and is explicitly revoked. Failure/unknown result preserves `passwordChangeRequired` and leaves old local access invalidated. Fresh login after a successful provider mutation but uncertain local update remains gated until a confirmed change or recovery; report partial outcomes honestly, never retry credential mutation automatically. No temporary-password hash/storage.

Append these failure-stage tests (import `vi`); ordinary fully onboarded accounts use the same method, not a new takeover API:

```typescript
it.each(['UNAUTHENTICATED', 'AUTH_TIMEOUT', 'AUTH_PROVIDER_UNAVAILABLE'] as const)
  ('keeps onboarding gated on failed current-password proof: %s', async code => {
    const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
    const p = (await f.service.authenticate('sealed_1')).principal;
    f.provider.login.mockRejectedValueOnce(new AuthFault(code));
    await expect(f.service.password(p, { currentPassword: 'temporary', newPassword: 'private-password' })).rejects.toThrow(code);
    expect(f.provider.replacePassword).not.toHaveBeenCalled();
    expect((await f.users.get('u1'))!.account.passwordChangeRequired).toBe(true);
  });
it.each(['conflict', 'uncertain'] as const)('never unlocks an unconfirmed final password write: %s', async outcome => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  const p = (await f.service.authenticate('sealed_1')).principal;
  const realCas = f.users.compareAndSwap.bind(f.users); let writes = 0;
  vi.spyOn(f.users, 'compareAndSwap').mockImplementation(async (expected, next) =>
    ++writes === 1 ? realCas(expected, next) : { outcome });
  f.provider.login.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_proof', sealedSession: 'proof' })
    .mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_new', sealedSession: 'new' });
  await expect(f.service.password(p, { currentPassword: 'temporary', newPassword: 'private-password' })).rejects.toThrow('NOT_READY');
  expect((await f.users.get('u1'))!.account.passwordChangeRequired).toBe(true);
  expect((await f.users.get('u1'))!.account.currentWorkosSessionId).toBeNull();
  expect(f.provider.revoke).toHaveBeenCalledWith('sid_new');
});
it('rejects a proof for another subject and a verification revocation failure', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1', passwordChangeRequired: false }));
  const p = (await f.service.authenticate('sealed_1')).principal;
  f.provider.login.mockResolvedValueOnce({ workosUserId: 'user_other', sessionId: 'sid_proof', sealedSession: 'proof' });
  await expect(f.service.password(p, { currentPassword: 'private-old', newPassword: 'private-new' })).rejects.toThrow('UNAUTHENTICATED');
  f.provider.revoke.mockRejectedValueOnce(new AuthFault('AUTH_PROVIDER_UNAVAILABLE'));
  await expect(f.service.password(p, { currentPassword: 'private-old', newPassword: 'private-new' })).rejects.toThrow('AUTH_PROVIDER_UNAVAILABLE');
  expect(f.provider.replacePassword).not.toHaveBeenCalled();
});
```

- [ ] **4. GREEN:** `npm test -- test/auth/password.spec.ts test/auth/session.spec.ts`.
- [ ] **5. Commit:** stage the two paths; `git commit -m "feat(auth): require confirmed private password replacement"`.

## Task 12: Send generic mailbox recovery and fence confirmed reset completion

**Files:** modify `backend/src/auth/auth.service.ts`; create `backend/test/auth/recovery.spec.ts`.

- [ ] **1. Write failing tests:**

```typescript
import { expect, it } from 'vitest';
import { account, authFixture } from './fixtures.js';
import { AuthFault } from '../../src/auth/errors.js';
it('has one generic response and sends mail only to an active mapped address', async () => {
  const f = await authFixture();
  expect(await f.service.forgotPassword({ email: ' A@EXAMPLE.COM ' })).toEqual({ ok: true });
  expect(await f.service.forgotPassword({ email: 'unknown@example.com' })).toEqual({ ok: true });
  expect(f.provider.sendRecovery).toHaveBeenCalledTimes(1);
  expect(f.provider.sendRecovery).toHaveBeenCalledWith('a@example.com');
  f.provider.sendRecovery.mockRejectedValueOnce(new AuthFault('AUTH_TIMEOUT'));
  expect(await f.service.forgotPassword({ email: 'a@example.com' })).toEqual({ ok: true });
});
it('confirms reset locally, rejects replay through the provider, and invalidates old access', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1' }));
  expect(await f.service.resetPassword({ token: 'provider-single-use-token', newPassword: 'private-password' })).toEqual({ ok: true });
  const saved = (await f.users.get('u1'))!.account;
  expect(saved.passwordChangeRequired).toBe(false); expect(saved.currentWorkosSessionId).toBeNull(); expect(saved.sessionEpoch).toBe(1);
  await expect(f.service.authenticate('sealed_1')).rejects.toThrow('UNAUTHENTICATED');
  f.provider.reset.mockRejectedValueOnce(new AuthFault('UNAUTHENTICATED'));
  await expect(f.service.resetPassword({ token: 'provider-single-use-token', newPassword: 'other-private-password' })).rejects.toThrow('UNAUTHENTICATED');
  expect((await f.users.get('u1'))!.account.sessionEpoch).toBe(1);
});
```

- [ ] **2. RED:** `npm test -- test/auth/recovery.spec.ts`.
- [ ] **3. Add service methods:**

```typescript
async forgotPassword(body: unknown): Promise<AuthOkResponse> {
  this.limiter.takeGlobal(); const { email } = parse(forgotPasswordRequestSchema, body);
  this.limiter.take('recovery', email);
  // Uniform even if configured provider/storage is unavailable; no account-existence signal.
  try {
    const provider = this.provider(); const local = await this.o.users.byEmail(email);
    if (local?.account.status === 'active') await provider.sendRecovery(local.account.emailNormalized);
  } catch { /* No token/error payload is logged or reflected. Same response as unknown email. */ }
  return { ok: true };
}
async resetPassword(body: unknown): Promise<AuthOkResponse> {
  this.limiter.takeGlobal(); const { token, newPassword } = parse(resetPasswordRequestSchema, body);
  const result = await this.provider().reset(token, newPassword);
  // Provider identifies the subject. Do not infer an owner from email or a client id.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await this.o.users.bySubject(result.workosUserId);
    if (!current) throw new AuthFault('UNAUTHENTICATED');
    const next = { ...invalidateAccount(current.account, this.now()), passwordChangeRequired: false };
    const saved = await this.o.users.compareAndSwap(current, next);
    if (saved.outcome === 'confirmed') return { ok: true };
    if (saved.outcome === 'uncertain') throw new AuthFault('NOT_READY');
  }
  throw new AuthFault('NOT_READY');
}
```

Do not activate an inactive row on recovery. It may acquire a private credential while remaining inactive; future login still fails. Unknown WorkOS identities stay unmapped. The bounded CAS retry repeats **only the local invalidation**, never `resetPassword`. WorkOS owns token expiry/single-use; fixture replay denial demonstrates propagation, not live service certification.

Partial reset boundary: WorkOS mutation and Aurvin write are not a distributed transaction. A 200 response means both completed and old sids are rejected locally. Provider timeout or failed/unknown local finalization returns an error, never an invented success or un-gating. The code does not claim that an unknown provider-side reset was rolled back or that offline JWT revocation is instantaneous; a WorkOS-revoked access JWT can survive until its expiry if local invalidation was not confirmed. Record this rare operator-reconciliation limitation and the short-token dashboard prerequisite in the worker handoff. Do not introduce token persistence, a saga, a webhook service, or misuse `getPasswordReset(token)` to hide it.

Append these recovery regressions (import `vi`):

```typescript
it('does not mail an inactive account and rate limits unknown addresses too', async () => {
  const f = await authFixture(account({ status: 'inactive' }));
  expect(await f.service.forgotPassword({ email: 'a@example.com' })).toEqual({ ok: true });
  expect(f.provider.sendRecovery).not.toHaveBeenCalled();
  for (let n = 0; n < 3; n++) expect(await f.service.forgotPassword({ email: 'unknown@example.com' })).toEqual({ ok: true });
  await expect(f.service.forgotPassword({ email: 'unknown@example.com' })).rejects.toThrow('RATE_LIMITED');
});
it.each(['UNAUTHENTICATED', 'AUTH_TIMEOUT'] as const)('does not ungate failed/expired reset: %s', async code => {
  const f = await authFixture(); f.provider.reset.mockRejectedValueOnce(new AuthFault(code));
  await expect(f.service.resetPassword({ token: 'raw-reset-secret', newPassword: 'private-password' })).rejects.toThrow(code);
  expect((await f.users.get('u1'))!.account.passwordChangeRequired).toBe(true);
});
it('keeps inactive status and never adopts an unknown reset identity', async () => {
  const f = await authFixture(account({ status: 'inactive' }));
  await f.service.resetPassword({ token: 'token', newPassword: 'private-password' });
  expect((await f.users.get('u1'))!.account.status).toBe('inactive');
  f.provider.reset.mockResolvedValueOnce({ workosUserId: 'user_unknown' });
  await expect(f.service.resetPassword({ token: 'other-token', newPassword: 'private-password' })).rejects.toThrow('UNAUTHENTICATED');
  expect(await f.users.bySubject('user_unknown')).toBeNull();
});
it('never repeats a provider reset on local conflict or uncertain outcome', async () => {
  const f = await authFixture();
  const cas = vi.spyOn(f.users, 'compareAndSwap').mockResolvedValueOnce({ outcome: 'conflict' })
    .mockResolvedValueOnce({ outcome: 'uncertain' });
  await expect(f.service.resetPassword({ token: 'token', newPassword: 'private-password' })).rejects.toThrow('NOT_READY');
  expect(f.provider.reset).toHaveBeenCalledTimes(1); expect(cas).toHaveBeenCalledTimes(2);
  expect((await f.users.get('u1'))!.account.passwordChangeRequired).toBe(true);
});
```

No admin endpoint calls this public enumeration-suppressing method: P2 uses the provider primitive with explicit administrative error handling.

- [ ] **4. GREEN:** `npm test -- test/auth/recovery.spec.ts test/auth/password.spec.ts`.
- [ ] **5. Commit:** stage both files; `git commit -m "feat(auth): add mailbox recovery and confirmed reset invalidation"`.

## Task 13: Expose a request-bound authentication seam without implementing P3 ALS

**Files:** create `backend/src/auth/auth-boundary.ts`, `backend/test/auth/boundary.spec.ts`.

- [ ] **1. Write failing test:**

```typescript
import { expect, it } from 'vitest';
import { account, authFixture } from './fixtures.js';
import { authenticateCookie, authBoundary } from '../../src/auth/auth-boundary.js';
it('provides the same immutable principal to HTTP and cookie-bearing upgrade callers', async () => {
  const f = await authFixture(account({ currentWorkosSessionId: 'sid_1', passwordChangeRequired: false }));
  const result = await authenticateCookie(f.service, 'aurvin_wos_session=sealed_1');
  expect(result.principal.identity.userId).toBe('u1');
  let owner = '';
  const middleware = authBoundary(f.service, (p, next) => { owner = p.identity.userId; next(); });
  const req = { headers: { cookie: 'aurvin_wos_session=sealed_1' } };
  const headers = new Map<string, unknown>();
  const res = { setHeader: (k: string, v: unknown) => headers.set(k, v) };
  let called = false;
  await middleware(req as never, res as never, error => { if (error) throw error; called = true; });
  expect(called).toBe(true); expect(owner).toBe('u1');
});
```

- [ ] **2. RED:** `npm test -- test/auth/boundary.spec.ts`.
- [ ] **3. Implement the exported seam:**

```typescript
import type { NextFunction, Request, Response } from 'express';
import type { AuthPrincipal } from '../contracts/auth.js';
import { AuthService } from './auth.service.js';
import { readSessionCookie } from './cookies.js';
export const authenticateCookie = (service: AuthService, header: string | string[] | undefined) =>
  service.authenticate(readSessionCookie(header));
export type RunAuthenticated = (principal: AuthPrincipal, next: () => void) => void;
export function authBoundary(service: AuthService, run: RunAuthenticated, secureCookie = false) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authenticateCookie(service, req.headers.cookie);
      if (result.sealedSession) res.setHeader('Set-Cookie', sessionCookie(result.sealedSession, secureCookie));
      run(result.principal, () => next());
    } catch (error) { next(error); }
  };
}
```

Import `sessionCookie` as well. P3 calls this boundary **only for its protected route policy**, after origin/transport validation and before private handlers. P1 must not install a global middleware that accidentally guards liveness or public reset/login. Upgrades use `authenticateCookie` before handoff; a WS upgrade has no ordinary `Set-Cookie` response, so P3 refresh handling must use an HTTP session check before reconnect or explicitly handle upgrade headers. Do not claim upgrades are integrated by this isolated helper test. No `Request` object is captured in a timer/background service.

- [ ] **4. GREEN:** `npm test -- test/auth/boundary.spec.ts`; add a two-user concurrent call test with independently resolved cookies and assert distinct `identity` objects/no shared mutable last-user field.
- [ ] **5. Commit:** stage both files; `git commit -m "feat(auth): expose request-bound cookie admission seam"`.

## Task 14: Register isolated Nest endpoints and ordinary auth HTTP protections

**Files:** create `backend/src/auth/{configure-auth-http.ts,auth.controller.ts,auth.module.ts,index.ts}`, `backend/test/auth/http.spec.ts`.

- [ ] **1. Write the failing isolated application test**; it reuses Task 10 fixture and the existing Nest/Supertest approach, never `AppModule`:

```typescript
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { AuthModule } from '../../src/auth/auth.module.js';
import { configureAuthHttp } from '../../src/auth/configure-auth-http.js';
import { authFixture } from './fixtures.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
async function testApp() {
  const f = await authFixture();
  const moduleRef = await Test.createTestingModule({ imports: [AuthModule.register({ service: f.service, secureCookie: false })] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api');
  configureAuthHttp(app, { bootstrap: loadBootstrapConfig({}), trustedHttpsIngress: () => false });
  await app.init(); return { ...f, app };
}
it('exposes only safe auth JSON and an HttpOnly session cookie', async () => {
  const f = await testApp();
  try {
    const login = await request(f.app.getHttpServer()).post('/api/auth/login')
      .set('Origin', 'http://localhost:5173').set('Host', 'localhost:3000')
      .send({ email: 'a@example.com', password: 'temporary' }).expect(200).expect('Cache-Control', 'no-store');
    expect(login.body).toEqual({ user: { userId: 'u1', email: 'a@example.com', role: 'user', passwordChangeRequired: true } });
    expect(JSON.stringify(login.body)).not.toContain('sealed_1');
    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(cookies[0]).toContain('HttpOnly; SameSite=Strict; Path=/api');
    await request(f.app.getHttpServer()).get('/api/auth/me').set('Host', 'localhost:3000')
      .set('Cookie', cookies[0]!.split(';')[0]!).expect(200);
    await request(f.app.getHttpServer()).post('/api/auth/logout').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').set('Cookie', cookies[0]!.split(';')[0]!).send({}).expect(204);
  } finally { await f.app.close(); }
});
it('rejects cross-origin and oversize credential bodies before provider calls', async () => {
  const f = await testApp();
  try {
    await request(f.app.getHttpServer()).post('/api/auth/login').set('Host', 'localhost:3000')
      .set('Origin', 'https://evil.example').send({ email: 'a@example.com', password: 'temporary' }).expect(403);
    await request(f.app.getHttpServer()).post('/api/auth/login').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').send({ email: 'a@example.com', password: 'x'.repeat(5000) }).expect(413);
    expect(f.provider.login).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
```

- [ ] **2. RED:** `npm test -- test/auth/http.spec.ts`.
- [ ] **3. Implement the Nest module** using the exact pattern of `AdminConfigModule.register`, without importing it or editing it:

```typescript
// auth.module.ts body
import { ConfigurableModuleBuilder, Module } from '@nestjs/common';
import { AUTH_HTTP_OPTIONS, AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
export type AuthModuleOptions = { service: AuthService; secureCookie: boolean };
const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } = new ConfigurableModuleBuilder<AuthModuleOptions>().build();
@Module({ controllers: [AuthController], providers: [
  { provide: AuthService, inject: [MODULE_OPTIONS_TOKEN], useFactory: (o: AuthModuleOptions) => o.service },
  { provide: AUTH_HTTP_OPTIONS, inject: [MODULE_OPTIONS_TOKEN], useFactory: (o: AuthModuleOptions) => ({ secureCookie: o.secureCookie }) },
], exports: [AuthService] })
export class AuthModule extends ConfigurableModuleClass {}
```

The module imports its token from `auth.controller.ts`; the controller never imports the module. It is one token, not a new tokens-only file.

Controller bodies (with `@Controller('auth')`, `@UseFilters(AuthFilter)`, `@Inject(AuthService)`, `@Inject(AUTH_HTTP_OPTIONS)`):

```typescript
@Post('login') @HttpCode(200)
async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
  const r = await this.service.login(body); res.setHeader('Set-Cookie', sessionCookie(r.sealedSession, this.options.secureCookie));
  return { user: r.user };
}
@Get('me')
async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
  return this.service.me(await this.principal(req, res));
}
@Post('password') @HttpCode(200)
async password(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
  const r = await this.service.password(await this.principal(req, res), body);
  res.setHeader('Set-Cookie', sessionCookie(r.sealedSession, this.options.secureCookie)); return { user: r.user };
}
@Post('forgot-password') @HttpCode(200)
forgotPassword(@Body() body: unknown) { return this.service.forgotPassword(body); }
@Post('reset-password') @HttpCode(200)
async resetPassword(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
  const result = await this.service.resetPassword(body); res.setHeader('Set-Cookie', clearSessionCookie(this.options.secureCookie)); return result;
}
@Post('logout') @HttpCode(204)
async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
  try { await this.service.logout(await this.principal(req, res)); }
  finally { res.setHeader('Set-Cookie', clearSessionCookie(this.options.secureCookie)); }
}
private async principal(req: Request, res: Response): Promise<AuthPrincipal> {
  try {
    const r = await authenticateCookie(this.service, req.headers.cookie);
    if (r.sealedSession) res.setHeader('Set-Cookie', sessionCookie(r.sealedSession, this.options.secureCookie));
    return r.principal;
  } catch (error) {
    if (error instanceof AuthFault && error.code === 'UNAUTHENTICATED')
      res.setHeader('Set-Cookie', clearSessionCookie(this.options.secureCookie));
    throw error;
  }
}
```

Add `AuthFilter` as an injectable/catch-all class in the controller file using the existing controller filter style: known `AuthFault` uses `status/body()`, unknown errors use `new AuthFault('NOT_READY')`. Always no-store/nosniff, `Retry-After: 60` for rate limits, no exception message/cause serialization, no logs of requests/SDK values. Do not turn retryable refresh failures into cookie clears. Logout clears cookie in `finally` even on error, but returns 204 **only if** local invalidation and provider revocation were confirmed. Invalid/missing-cookie logout returns 401 with a cleared cookie; client can still clear its state. Body must be exactly `{}` for logout; reject unknown fields instead of accepting owner/role overrides.

Implement `configureAuthHttp(app, { bootstrap, trustedHttpsIngress })` before any global parser. Match auth path using exact `/api/auth` segment boundaries, with casing/trailing-slash handling aligned to Express. Reject unknown auth methods/routes/query strings with safe `INVALID_REQUEST`; no registration endpoint. Use the existing exact-origin rules: GET permits absent Origin only when `Sec-Fetch-Site !== 'cross-site'`; mutations require exactly `bootstrap.frontendOrigin` and must reject `Sec-Fetch-Site: cross-site` even with a matching Origin. Missing/array/comma/null origins are forbidden. HTTPS requires `trustedHttpsIngress(req)`; never trust arbitrary `X-Forwarded-Proto`. Loopback exception requires development mode, HTTP loopback frontend, loopback backend Host and loopback socket peer; remote plaintext is forbidden. These are the same semantics as `configure-admin-http.ts`, implemented locally without widening its ownership or exporting its private helpers.

Use already-installed `express.json({ limit: 4096, inflate: false, strict: true, type: 'application/json', verify: (_req, _res, bytes) => { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } })` on auth mutations only, plus a 5,000 ms **total** timer, not only socket idle timeout. Reject other content types/charsets/encodings, malformed/array JSON, ambiguous Content-Length, oversized declared bodies before collection. Clear timer/listeners on response finish/close/request abort; on deadline emit safe 408/INVALID_REQUEST and drain/close as established before destroying the socket. Parser error handler maps `entity.too.large` to 413, other parse/encoding errors to 400; do not echo Express errors/body. Verify header-only rejection and chunked oversized bodies as well as `.send()` cases. The module must not require root global CORS or create a second persistence owner. Export only implemented public types/classes/helpers through `auth/index.ts`.

- [ ] **3a. Add the exact route-local ingress implementation** in `configure-auth-http.ts`:

```typescript
import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { BootstrapConfig } from '../platform/config/bootstrap-config.js';
import { AuthFault } from './errors.js';
export type AuthHttpOptions = { bootstrap: BootstrapConfig; trustedHttpsIngress: (req: Request) => boolean };
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const loopbackPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const posts = new Set(['login', 'logout', 'password', 'forgot-password', 'reset-password']);
function fail(res: Response, code: 'INVALID_REQUEST' | 'FORBIDDEN', status?: number) {
  if (res.headersSent || res.writableEnded) return;
  const fault = new AuthFault(code); res.status(status ?? fault.status).json(fault.body());
}
function closeAfterReply(req: Request, res: Response) {
  res.setHeader('Connection', 'close');
  res.once('finish', () => {
    if (req.readableEnded) { req.socket.end(); return; }
    const timer = setTimeout(() => req.destroy(), 1000); timer.unref();
    req.once('end', () => { clearTimeout(timer); req.socket.end(); });
    req.once('close', () => clearTimeout(timer)); req.resume();
  });
}
function originAllowed(req: Request, bootstrap: BootstrapConfig) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return req.method === 'GET';
  return typeof origin === 'string' && origin !== 'null' && !origin.includes(',') && origin === bootstrap.frontendOrigin;
}
function transportAllowed(req: Request, o: AuthHttpOptions) {
  const origin = new URL(o.bootstrap.frontendOrigin);
  if (origin.protocol === 'https:') return o.trustedHttpsIngress(req) === true;
  const host = req.headers.host;
  if (typeof host !== 'string' || host.includes(',')) return false;
  try {
    return o.bootstrap.nodeEnv === 'development' && origin.protocol === 'http:' && loopbackHosts.has(origin.hostname) &&
      loopbackHosts.has(new URL(`http://${host}`).hostname) && loopbackPeers.has(req.socket.remoteAddress ?? '');
  } catch { return false; }
}
export function configureAuthHttp(app: NestExpressApplication, o: AuthHttpOptions): void {
  const parser = json({ limit: 4096, inflate: false, strict: true, type: 'application/json',
    verify: (_req, _res, bytes) => { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path.replace(/\/+$/, '').toLowerCase();
    if (path !== '/api/auth' && !path.startsWith('/api/auth/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const originalSet = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: number | string | readonly string[]) =>
      name.toLowerCase() === 'etag' ? res : originalSet(name, value)) as typeof res.setHeader;
    res.removeHeader('ETag');
    if (!originAllowed(req, o.bootstrap) || !transportAllowed(req, o)) { fail(res, 'FORBIDDEN'); return; }
    const suffix = path.slice('/api/auth/'.length);
    if ((req.url ?? '').includes('?') || !((req.method === 'GET' && suffix === 'me') ||
        (req.method === 'POST' && posts.has(suffix)))) { fail(res, 'INVALID_REQUEST'); return; }
    if (req.method === 'GET') { next(); return; }
    const contentType = req.headers['content-type'];
    const encoding = req.headers['content-encoding'];
    const length = req.headers['content-length'];
    const validType = typeof contentType === 'string' && /^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(contentType);
    const validEncoding = encoding === undefined || encoding === 'identity';
    const validLength = length === undefined || (typeof length === 'string' && /^\d+$/.test(length) &&
      Number.isSafeInteger(Number(length)) && Number(length) > 0);
    if (!validType || !validEncoding || !validLength) {
      closeAfterReply(req, res); fail(res, 'INVALID_REQUEST'); return;
    }
    if (length !== undefined && Number(length) > 4096) {
      closeAfterReply(req, res); fail(res, 'INVALID_REQUEST', 413); return;
    }
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return; finished = true; closeAfterReply(req, res); fail(res, 'INVALID_REQUEST', 408);
    }, 5000);
    const cleanup = () => { clearTimeout(timer); req.off('aborted', cleanup); res.off('finish', cleanup); res.off('close', cleanup); };
    req.once('aborted', cleanup); res.once('finish', cleanup); res.once('close', cleanup);
    parser(req, res, (error?: unknown) => {
      cleanup(); if (finished || req.aborted || res.writableEnded) return; finished = true;
      if (error) {
        const type = error !== null && typeof error === 'object' && 'type' in error ? String(error.type) : '';
        closeAfterReply(req, res); fail(res, 'INVALID_REQUEST', type === 'entity.too.large' ? 413 : 400); return;
      }
      const body: unknown = req.body;
      if (body === null || typeof body !== 'object' || Array.isArray(body) ||
          (suffix === 'logout' && Object.keys(body).length !== 0)) { fail(res, 'INVALID_REQUEST'); return; }
      next();
    });
  });
}
```

The total timer covers body collection only; provider work has its separate ten-second budget. Unknown routes are rejected. P3 lets exact-origin CORS handle OPTIONS before this middleware; this middleware never grants a cross-origin preflight. No duplicate global CORS or persistence owner is required.

- [ ] **3b. Finish controller imports/class/filter and barrel exports.** Put `AUTH_HTTP_OPTIONS` in the controller file and import it in `auth.module.ts` instead of declaring it there. Wrap the six route bodies and private principal method already specified above in this class:

```typescript
import { Body, Catch, Controller, Get, HttpCode, Inject, Post, Req, Res, UseFilters,
  type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthPrincipal } from '../contracts/auth.js';
import { AuthService } from './auth.service.js';
import { AuthFault } from './errors.js';
import { authenticateCookie } from './auth-boundary.js';
import { clearSessionCookie, sessionCookie } from './cookies.js';
export const AUTH_HTTP_OPTIONS = Symbol('AUTH_HTTP_OPTIONS');
@Catch()
class AuthFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent || res.writableEnded) return;
    const fault = error instanceof AuthFault ? error : new AuthFault('NOT_READY');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (fault.code === 'RATE_LIMITED') res.setHeader('Retry-After', '60');
    res.status(fault.status).json(fault.body());
  }
}
@Controller('auth')
@UseFilters(AuthFilter)
export class AuthController {
  constructor(@Inject(AuthService) private readonly service: AuthService,
    @Inject(AUTH_HTTP_OPTIONS) private readonly options: { secureCookie: boolean }) {}
}
```

In `auth/index.ts`, add literal exports for `./auth.module.js`, `./auth.service.js`, `./auth-boundary.js`, `./configure-auth-http.js`, `./access.js`, `./provider.js`, `./errors.js`, and `./cookies.js`. This barrel has no side effects.

- [ ] **4. GREEN:** `npm test -- test/auth/http.spec.ts test/auth/boundary.spec.ts`; `npm run build`; `npm run lint`.

Append these HTTP regressions (import `AuthFault`). They remain inside `test/auth/`, not P6's integration subtree:

```typescript
it.each([
  { path: '/api/auth/register', origin: 'http://localhost:5173', fetchSite: 'same-origin', status: 400 },
  { path: '/api/auth/login?userId=victim', origin: 'http://localhost:5173', fetchSite: 'same-origin', status: 400 },
  { path: '/api/auth/login', origin: '', fetchSite: 'same-origin', status: 403 },
  { path: '/api/auth/login', origin: 'null', fetchSite: 'same-origin', status: 403 },
  { path: '/api/auth/login', origin: 'http://localhost:5173', fetchSite: 'cross-site', status: 403 },
])('rejects unsupported or untrusted auth ingress %j', async c => {
  const f = await testApp();
  try {
    let req = request(f.app.getHttpServer()).post(c.path).set('Host', 'localhost:3000').set('Sec-Fetch-Site', c.fetchSite);
    if (c.origin) req = req.set('Origin', c.origin);
    const res = await req.send({ email: 'a@example.com', password: 'raw-password-sentinel' }).expect(c.status);
    expect(JSON.stringify(res.body)).not.toContain('raw-password-sentinel');
    expect(f.provider.login).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it('rejects malformed JSON and remote Host despite forged forwarding headers', async () => {
  const f = await testApp();
  try {
    await request(f.app.getHttpServer()).post('/api/auth/login').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').set('Content-Type', 'application/json').send('{"password":').expect(400);
    await request(f.app.getHttpServer()).post('/api/auth/login').set('Origin', 'http://localhost:5173')
      .set('Host', 'remote.example').set('X-Forwarded-Proto', 'https').send({}).expect(403);
    expect(f.provider.login).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it('clears terminal invalid cookies but preserves retryable refresh cookies', async () => {
  const f = await testApp();
  try {
    f.provider.read.mockRejectedValueOnce(new AuthFault('UNAUTHENTICATED'));
    const invalid = await request(f.app.getHttpServer()).get('/api/auth/me').set('Host', 'localhost:3000')
      .set('Cookie', 'aurvin_wos_session=bad').expect(401);
    expect(String(invalid.headers['set-cookie'])).toContain('Max-Age=0');
    f.provider.read.mockRejectedValueOnce(new AuthFault('AUTH_PROVIDER_UNAVAILABLE'));
    const retryable = await request(f.app.getHttpServer()).get('/api/auth/me').set('Host', 'localhost:3000')
      .set('Cookie', 'aurvin_wos_session=retryable').expect(503);
    expect(retryable.headers['set-cookie']).toBeUndefined();
  } finally { await f.app.close(); }
});
it('keeps forgotten/reset/password results credential-free across the six-route flow', async () => {
  const f = await testApp();
  try {
    const server = f.app.getHttpServer();
    const login = await request(server).post('/api/auth/login').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').send({ email: 'a@example.com', password: 'temporary' }).expect(200);
    const cookie = String((login.headers['set-cookie'] as unknown as string[])[0]).split(';')[0]!;
    const changed = await request(server).post('/api/auth/password').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').set('Cookie', cookie)
      .send({ currentPassword: 'temporary', newPassword: 'private-password' }).expect(200);
    expect(changed.body.user.passwordChangeRequired).toBe(false);
    const forgot = await request(server).post('/api/auth/forgot-password').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').send({ email: 'a@example.com' }).expect(200);
    const reset = await request(server).post('/api/auth/reset-password').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').send({ token: 'raw-reset-token', newPassword: 'private-password' }).expect(200);
    expect(forgot.body).toEqual({ ok: true }); expect(reset.body).toEqual({ ok: true });
    const visible = JSON.stringify([login.body, changed.body, forgot.body, reset.body]);
    for (const secret of ['temporary', 'private-password', 'raw-reset-token', 'sealed_1', 'sid_1', 'sessionEpoch']) expect(visible).not.toContain(secret);
  } finally { await f.app.close(); }
});
```

The middleware also needs a body-deadline regression. Use `node:http.request` to the isolated app's dynamically bound loopback port, send JSON headers plus an incomplete chunk, do not call `end()` until its response arrives, and assert 408 within the configured 5,000 ms deadline. Use a real bounded test timeout of 8,000 ms and always close client/app in `finally`; do not hang suite teardown. This is a fixture socket, not an external service. Chunked over-limit uses the same socket test, sending 4,097 body bytes without Content-Length and expecting 413. Compressed and non-JSON bodies must return 400 without provider admission; all unsafe raw fields remain absent from responses/log calls.

- [ ] **5. Commit:** stage these five files; `git commit -m "feat(auth): expose isolated protected authentication endpoints"`.

## Task 15: Verify actual admitted users durability and uniqueness when native prerequisites exist

**Files:** create `backend/test/persistence/auth-users.native.e2e-spec.ts`; update only P1 fixture/repository files if these checks expose a P1 defect.

- [ ] **1. Write the failing native test** with this self-contained disposable setup (no application database):

```typescript
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { account } from '../auth/fixtures.js';
const uri = process.env.AURVIN_TEST_MONGODB_URI;
const prefix = process.env.AURVIN_TEST_DB_PREFIX;
it.skipIf(!uri || prefix !== 'aurvin_p2_test_')('persists users with unique mappings through the admitted bundle', async () => {
  const dbName = `${prefix}${randomUUID().replaceAll('-', '')}`;
  const client = new MongoClient(uri!, { retryWrites: false });
  let bundle: Awaited<ReturnType<typeof createPersistenceBundle>> | undefined;
  let connected = false;
  try {
    await client.connect();
    connected = true;
    bundle = await createPersistenceBundle(client, dbName, DEFAULT_BUDGETS);
    const first = await bundle.users.insert(account());
    await expect(bundle.users.insert(account({ userId: 'u2', workosUserId: 'user_2' }))).rejects.toThrow();
    await expect(bundle.users.insert(account({ userId: 'u3', emailNormalized: 'c@example.com' }))).rejects.toThrow();
    const changed = await bundle.users.compareAndSwap(first, { ...first.account, currentWorkosSessionId: 'sid_native' });
    expect(changed.outcome).toBe('confirmed');
    expect((await bundle.users.get('u1'))!.account.currentWorkosSessionId).toBe('sid_native');
    const independentRead = await client.db(dbName).collection('users').findOne({ userId: 'u1' });
    expect(independentRead?._revision).toBe(1);
    expect(Object.keys(independentRead!).sort()).toEqual(['_id', '_revision', 'schemaVersion', 'userId', 'workosUserId',
      'emailNormalized', 'role', 'status', 'passwordChangeRequired', 'currentWorkosSessionId', 'sessionEpoch', 'createdAt', 'updatedAt'].sort());
  } finally {
    await bundle?.owner.drain(); await bundle?.owner.releaseExecutor();
    if (connected) await client.db(dbName).dropDatabase();
    await client.close();
  }
});
```

Never log caught SDK/driver connection options or URIs. These are generated test databases only. Report failures safely without embedding the URI in a custom diagnostic. Add a second read using a newly constructed `RecordStore`/`MongoUsers` over the same admitted client to prove serialization is not a cache assertion. Do not overlap live application executors.

- [ ] **2. RED:** with authorized operator-supplied prerequisites only, from backend run `npm run test:e2e -- test/persistence/auth-users.native.e2e-spec.ts`. A pre-implementation missing `bundle.users` failure is valid RED; absence of prerequisites is **SKIP**, not RED or PASS. Never obtain a URI from a real `.env` to make this run.
- [ ] **3. Minimal production correction if needed:** only fix P1 registration/codec/index defects established by this test. Add a deterministic regression in `auth-users.spec.ts` before correcting any defect. Do not change topology admission or bypass the mutation journal.
- [ ] **4. GREEN:** rerun the native command when configured. Otherwise record `not run/skipped — operator-supplied isolated MongoDB prerequisite absent`. The deterministic repository suites are still required and cannot be replaced by the skip.
- [ ] **5. Commit:** stage the native file and only named P1 corrections, if any; `git commit -m "test(auth): verify admitted users durability and uniqueness"`.

## Task 16: P1 verification and downstream interface handoff

No new implementation scope. If any required check fails, use systematic debugging, correct the owning P1 cause with a failing regression, and rerun. Failures owned by P3 or dirty user work must be reported, not edited away. Do not dispatch a reviewer.

- [ ] **1. Run backend focused checks** from `backend`:

```bash
npm test -- test/auth test/persistence/auth-users.spec.ts src/platform/config/bootstrap-config.spec.ts
```

- [ ] **2. Run actual package checks** (separate invocations, correct package directory): backend `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`; frontend `npm run build`, `npm run lint`, `npm test`. Capture baseline failures separately from P1 regressions and report executed counts/skips. Do not call WorkOS or paid providers to satisfy a fixture check.
- [ ] **3. Check protocol/header/secret consistency:** rerun contract mirror checks; verify every new TypeScript file has its exact FILE/LOCATION header; `git diff --check`; `git status --short`; `git diff --cached --name-only`. No dirty-baseline file may appear in a P1 commit. No credentials, fixture SDK raw token/URL, real `.env`, node_modules, build output, or unrelated files are staged. No auth middleware logs request bodies, headers, reset query strings, SDK errors, or tokens.
- [ ] **4. Report to the orchestrator** the actual P1 commits, commands/counts/results, native skips, and these frozen interfaces:
  - P2: `UsersRepository`, bounded list cursor, immutable identity CAS, `invalidateAccount`, `requireSuperAdmin`, provider `createUser/sendRecovery/revoke/listSessions`, internal `ProviderAccountConflict`, all Administration wire responses. P2 implements User-only target rules and partial provisioning policy, not P1.
  - P3: `AuthModule.register({ service, secureCookie })`, one `AuthService({ users: existingBundle.users, provider, now? })`, `configureAuthHttp`, `authenticateCookie`, `authBoundary(service, run, secureCookie)`, immutable `AuthPrincipal`, `requireFullAccount/requireSuperAdmin`, and missing-setup NOT_READY behavior. P3 owns root order/CORS/ALS/readiness, private transports/config checks, background capture, active-work cleanup and compatibility-bridge removal. No root auth cutover is claimed by P1.
  - P4: `AUTH_ROUTES`, user/ok/error guards, new-cookie password success, limited `me` shape, generic forgot response, 401/403/503 behavior, all Administration routes/page/row/create/action/error types. Browser uses only same-origin cookies, never bearer tokens. No client is implemented here.
  - P5: SDK package/lockfile ownership is released **after** P1 commits; users insert preserves explicitly selected internal owner IDs, operator identity uses the new source. P1 does not run/bootstrap any identity.
  - Release/operator gates: WorkOS setup, password-reset emails enabled and `/reset-password` redirect, no MFA/public registration, bounded WorkOS session/access-token lifetimes, real email/login/service tests and production billing remain unrun/unapproved. Rare unknown provider/local credential-write outcomes require reconciliation; fixture passes do not eliminate this cross-service boundary.
- [ ] **5. Commit any final P1 defect correction** with `git commit -m "fix(auth): resolve foundation verification defects"` only if changes exist, staging named owned files. Do not create an empty victory commit or edit orchestrator-owned `state.md`/P6 evidence docs. Return an honest blocked status if a required P1 check still fails.

## Acceptance trace and planner self-check

- AC1: Tasks 1, 4, 7–10, 13–14 cover closed login, SDK sessions, expiry/refresh/logout, bounds and redaction. P3 integrates existing routes; P4 supplies screens.
- AC2: Tasks 8, 11–12, 14 cover limited onboarding, verified different password, generic mailbox send, confirmed reset and stale-session denial. Provider replay is fixture-propagated; live token/email guarantees are not fabricated.
- AC3: Tasks 1–3 and 8 define exactly two roles and ordinary denial helpers. P2/P3/P4 own actual admin/config/UI protection.
- AC4: Tasks 2, 5–6, 8–10, 12 provide unique mappings, safe rows and non-reviving status/session operations. P2 owns lifecycle implementation and target policy.
- AC5/AC6: P1 supplies immutable internal owner identity and per-request admission, never an administrative owner override. End-to-end ownership/caches/global-config activation remain P3/P6, not implied by isolated tests.
- AC7: Existing admitted users persistence supports an explicit preserved owner ID without account auto-adoption. P5 owns operator preflight and adoption; no migration runs here.
- AC8: Task 16 requires existing package checks, actual discovered assertions and separate native/service skips. Unified review remains **skipped**.

Before committing this plan, verify: every source path is within P1 ownership; new source/test code receives headers; all service/test helper names are defined above; no implementation step requires reading private credentials or modifying a dirty file; no Administration logic, root wiring, UI, ALS implementation, bootstrap command, or new framework is smuggled into P1. This document's task RED/GREEN outcomes are expectations for the worker, not checks already executed by the planner.
