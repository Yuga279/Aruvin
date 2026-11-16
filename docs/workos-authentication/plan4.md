# Plan 4: Custom Auth UI, Role-Aware Settings, and Administration UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build client-side custom authentication screens, credentials-safe HTTP clients, role-aware dashboard tabs, and the Super Admin User Administration table in React/Vite/TypeScript without third-party UI libraries or bearer token storage.

**Architecture:** Wrap the application shell in an `AuthProvider` that validates the server session via HttpOnly cookies (`credentials: 'same-origin'`). Unauthenticated sessions render custom Aurvin-styled sign-in, onboarding, and recovery screens; authenticated sessions mount the existing `ChatProvider` keyed by `userId` to ensure private state teardown on account change. The settings dashboard becomes role-aware: standard Users access Plugins directly without fetching restricted server configuration, while Super Admins gain access to a keyset-paged Administration table with account lifecycle controls.

**Tech Stack:** React 19, TypeScript (ESNext/bundler), Vite, Vitest (Node environment), pure CSS (Aurvin design tokens). Zero external UI or client auth libraries.

---

### Scope and Safeguards

1. **Strict File Isolation:**
   Preserve all 8 pre-existing modified files recorded in `git status`:
   - `backend/src/chat-runtime/durable-chat-runtime.ts`
   - `backend/src/persistence/sessions.ts`
   - `backend/test/persistence/voice-messages.native.e2e-spec.ts`
   - `backend/test/persistence/voice-messages.spec.ts`
   - `backend/test/runtime/voice-acceptance.native.e2e-spec.ts`
   - `frontend/src/features/chat/state/chat-reducer.ts`
   - `frontend/src/features/chat/state/memory-save-state.test.ts`
   - `frontend/src/features/chat/state/voice-draft-lock.test.ts`
   NEVER stage, edit, or reset these files.

2. **Zero Bearer Tokens & Zero Credentials in Storage:**
   All communication uses HttpOnly cookies with `credentials: 'same-origin'`. Never store passwords, tokens, or credentials in `localStorage` or `sessionStorage`. On sign out, clear submission recovery data in `sessionStorage` and unmount `ChatProvider` completely.

3. **Mandatory File Headers:**
   Every new `.ts` and `.tsx` file and any file modified over 30% must include the mandatory repository comment header.

---

### File Structure Map

```
frontend/
├── src/
│   ├── api/
│   │   ├── auth-protocol.ts               (Existing Plan 1 foundation)
│   │   ├── administration-protocol.ts     (Existing Plan 1 foundation)
│   │   ├── client.ts                      (Modify: Add credentials: 'same-origin' & clearSubmissionRecovery)
│   │   ├── client-auth.test.ts            (New: Unit test for client same-origin & recovery clearing)
│   │   ├── auth-client.ts                 (New: Bounded fetch client for /auth/* endpoints)
│   │   ├── auth-client.test.ts            (New: Unit tests for auth client)
│   │   ├── administration-client.ts       (New: Bounded fetch client for /admin/users/* endpoints)
│   │   └── administration-client.test.ts  (New: Unit tests for administration client)
│   ├── features/
│   │   ├── auth/
│   │   │   ├── auth.css                   (New: Aurvin-styled auth form styling)
│   │   │   ├── auth-context.tsx           (New: AuthProvider and useAuth hook)
│   │   │   ├── auth-context.test.ts       (New: Unit tests for auth provider and session flow)
│   │   │   ├── LoginForm.tsx              (New: Email & password login form)
│   │   │   ├── MandatoryPasswordChangeForm.tsx (New: Initial temporary password replacement form)
│   │   │   ├── ForgotPasswordForm.tsx     (New: Mailbox recovery request form)
│   │   │   ├── ResetPasswordForm.tsx      (New: Token password reset form)
│   │   │   ├── auth-forms.test.ts         (New: SSR/markup test for all auth forms)
│   │   │   └── index.ts                   (New: Public auth barrel)
│   │   ├── admin-config/
│   │   │   ├── config-edit-state.ts       (Modify: Add 'administration' to AdminTab)
│   │   │   ├── AdminDashboard.tsx         (Modify: Role-aware tabs, load plugins without config for users)
│   │   │   ├── role-aware-dashboard.test.ts (New: Unit tests for user vs super-admin tab behavior)
│   │   │   ├── ProfileMenu.tsx            (Modify: Display signed-in email & role; functional Sign out)
│   │   │   ├── profile-menu.test.ts       (New: Tests for ProfileMenu user display and logout)
│   │   │   ├── AdministrationPanel.tsx    (New: Super Admin users table with keyset paging and actions)
│   │   │   ├── CreateUserDialog.tsx       (New: Dialog to provision new User with temporary password)
│   │   │   ├── administration-panel.test.ts (New: SSR and interaction tests for Administration UI)
│   │   │   └── admin-config.css           (Modify: Styling for administration table, badges, dialog)
│   │   └── chat/
│   │       └── ChatView.tsx               (Modify: Forward user & onSignOut to Sidebar)
│   ├── components/
│   │   └── Sidebar.tsx                    (Modify: Forward user & onSignOut to ProfileMenu)
│   ├── App.tsx                            (Modify: AuthProvider shell, route switching, private state teardown)
│   ├── App.css                            (Modify: Auth shell styling)
│   └── App.auth.test.ts                   (New: Assembly test verifying unauth vs auth rendering and teardown)
```

---

### Task 1: Chat `ApiClient` Same-Origin Credentials & Storage Clearing

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * ============================================================================
 * FILE: client-auth.test.ts
 * LOCATION: frontend/src/api/client-auth.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify ApiClient sends credentials: 'same-origin' and clears recovery storage.
 *
 * ROLE IN PROJECT:
 *    Ensures chat and streaming requests attach HttpOnly session cookies
 *    and allow explicit private state purge on account logout.
 *
 * KEY COMPONENTS:
 *    - Credentials verification on GET/POST/stream
 *    - clearSubmissionRecovery verification
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import { ApiClient, clearAllSubmissionRecovery } from './client.ts';

describe('ApiClient auth & cookie credentials', () => {
  it('passes credentials: "same-origin" on standard JSON requests', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ sessions: [], hasMore: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new ApiClient({ fetch: fetcher });
    await client.listSessions();

    expect(fetcher).toHaveBeenCalledOnce();
    const init = fetcher.mock.calls[0][1];
    expect(init?.credentials).toBe('same-origin');
  });

  it('passes credentials: "same-origin" on SSE streamTurn requests', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const client = new ApiClient({ fetch: fetcher });
    await client.streamTurn('sess-1', 'turn-1', {});

    expect(fetcher).toHaveBeenCalledOnce();
    const init = fetcher.mock.calls[0][1];
    expect(init?.credentials).toBe('same-origin');
  });

  it('clears submission recovery key from storage on request', () => {
    const removeItem = vi.fn();
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem,
    };
    clearAllSubmissionRecovery(storage);
    expect(removeItem).toHaveBeenCalledWith(expect.stringContaining('aurvin:submission:v1:'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/client-auth.test.ts`
Expected: FAIL with `init?.credentials` being `undefined` and `clearAllSubmissionRecovery` not exported.

- [ ] **Step 3: Write minimal implementation in `frontend/src/api/client.ts`**

In `frontend/src/api/client.ts`:
1. In `ApiClient.request`: Add `credentials: 'same-origin'` to `init: RequestInit`:
```typescript
      const init: RequestInit = {
        method,
        cache: 'no-store',
        credentials: 'same-origin',
        headers,
        signal,
      };
```
2. In `ApiClient.streamTurn`: Add `credentials: 'same-origin'` to the `this.fetcher(fullUrl, ...)` options:
```typescript
      response = await this.fetcher(fullUrl, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          Accept: 'text/event-stream',
        },
        signal: streamSignal,
      });
```
3. Add `clearSubmissionRecovery()` method to `ApiClient` and export `clearAllSubmissionRecovery`:
```typescript
  clearSubmissionRecovery(): void {
    try {
      this.recoveryStorage?.removeItem(this.recoveryKey);
    } catch {
      // Storage unavailable.
    }
  }
```
And at the bottom of `frontend/src/api/client.ts`:
```typescript
export function clearAllSubmissionRecovery(
  storage: Pick<Storage, 'removeItem'> | null = typeof window !== 'undefined' ? window.sessionStorage : null,
): void {
  try {
    if (!storage) return;
    const base = readViteApiBase() ?? '/api';
    const key = `aurvin:submission:v1:${base.replace(/\/+$/, '')}`;
    storage.removeItem(key);
  } catch {
    // Storage unavailable.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api/client-auth.test.ts`
Expected: PASS (3 tests passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client-auth.test.ts
git commit -m "feat(auth): add same-origin credentials to chat client and submission recovery purge"
```

---

### Task 2: Auth HTTP Client (`auth-client.ts`)

**Files:**
- Create: `frontend/src/api/auth-client.ts`
- Create: `frontend/src/api/auth-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * ============================================================================
 * FILE: auth-client.test.ts
 * LOCATION: frontend/src/api/auth-client.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for createAuthClient verifying closed routes, status handling,
 *    and credentials: 'same-origin'.
 *
 * ROLE IN PROJECT:
 *    Validates all browser-side authentication HTTP interactions against
 *    frozen protocol shapes without backend secrets.
 *
 * KEY COMPONENTS:
 *    - me / login / logout / changePassword / forgotPassword / resetPassword calls
 *    - AuthClientError mapping
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import { AuthClientError, createAuthClient } from './auth-client.ts';

describe('createAuthClient', () => {
  it('calls GET /auth/me with credentials: "same-origin" and returns AuthUser', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          user: {
            userId: 'usr-1',
            email: 'admin@example.com',
            role: 'super-admin',
            passwordChangeRequired: false,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });
    const user = await client.me();

    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
      }),
    );
    expect(user.email).toBe('admin@example.com');
    expect(user.role).toBe('super-admin');
  });

  it('maps 401 UNAUTHENTICATED to AuthClientError', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          error: { code: 'UNAUTHENTICATED', retryable: false },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });

    await expect(client.me()).rejects.toThrowError(AuthClientError);
    await expect(client.me()).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
      retryable: false,
    });
  });

  it('posts login request and returns user', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          user: {
            userId: 'usr-2',
            email: 'user@example.com',
            role: 'user',
            passwordChangeRequired: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });
    const user = await client.login({ email: 'user@example.com', password: 'TempPassword123!' });

    expect(user.passwordChangeRequired).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ email: 'user@example.com', password: 'TempPassword123!' }),
      }),
    );
  });

  it('posts logout request and handles 204 No Content', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });
    await expect(client.logout()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
  });

  it('posts forgot-password request and returns ok: true', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });
    const res = await client.forgotPassword({ email: 'someone@example.com' });
    expect(res).toEqual({ ok: true });
  });

  it('posts reset-password request and returns ok: true', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createAuthClient({ baseUrl: '/api', fetch: fetcher });
    const res = await client.resetPassword({ token: 'rst-token-123', newPassword: 'NewSecurePassword123!' });
    expect(res).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/auth-client.test.ts`
Expected: FAIL with module `./auth-client.ts` not found.

- [ ] **Step 3: Write minimal implementation in `frontend/src/api/auth-client.ts`**

```typescript
/**
 * ============================================================================
 * FILE: auth-client.ts
 * LOCATION: frontend/src/api/auth-client.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bounded, credentials: 'same-origin' HTTP client for /auth/* endpoints.
 *
 * ROLE IN PROJECT:
 *    Communicates with backend authentication controllers using HttpOnly
 *    cookies without storing bearer tokens in browser memory or storage.
 *
 * KEY COMPONENTS:
 *    - createAuthClient: Factory creating me/login/logout/password/recovery methods.
 *    - AuthClientError: Safe error wrapper without raw credential leakage.
 * ============================================================================
 */

import {
  AUTH_ROUTES,
  isAuthErrorResponse,
  isAuthOkResponse,
  isAuthUserResponse,
  type AuthErrorCode,
  type AuthOkResponse,
  type AuthUser,
  type ForgotPasswordRequest,
  type LoginRequest,
  type PasswordRequest,
  type ResetPasswordRequest,
} from './auth-protocol.ts';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 65_536;
const SAFE_AUTH_MESSAGE = 'Authentication operation failed.';

export type AuthClientErrorCode =
  | AuthErrorCode
  | 'NETWORK_ERROR'
  | 'ABORTED'
  | 'AUTH_REQUEST_TIMEOUT'
  | 'INVALID_AUTH_RESPONSE'
  | 'INVALID_AUTH_REQUEST';

export class AuthClientError extends Error {
  readonly code: AuthClientErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(options: {
    code: AuthClientErrorCode;
    status?: number;
    retryable?: boolean;
    message?: string;
  }) {
    super(options.message ?? SAFE_AUTH_MESSAGE);
    this.name = 'AuthClientError';
    this.code = options.code;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
  }
}

export type AuthClient = {
  me(signal?: AbortSignal): Promise<AuthUser>;
  login(body: LoginRequest, signal?: AbortSignal): Promise<AuthUser>;
  logout(signal?: AbortSignal): Promise<void>;
  changePassword(body: PasswordRequest, signal?: AbortSignal): Promise<AuthUser>;
  forgotPassword(body: ForgotPasswordRequest, signal?: AbortSignal): Promise<AuthOkResponse>;
  resetPassword(body: ResetPasswordRequest, signal?: AbortSignal): Promise<AuthOkResponse>;
};

function readViteApiBase(): string | undefined {
  try {
    const env = import.meta.env as { VITE_API_BASE?: string } | undefined;
    return env?.VITE_API_BASE;
  } catch {
    return undefined;
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const reader = response.body?.getReader();
  if (!reader) throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE', status: response.status });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE', status: response.status });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE', status: response.status });
  }
}

export function createAuthClient(options?: {
  baseUrl?: string;
  fetch?: typeof fetch;
}): AuthClient {
  const baseUrl = (options?.baseUrl ?? readViteApiBase() ?? '/api').replace(/\/+$/, '');
  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

    try {
      const init: RequestInit = {
        method,
        cache: 'no-store',
        redirect: 'error',
        credentials: 'same-origin',
        headers: body !== undefined
          ? { 'Content-Type': 'application/json', Accept: 'application/json' }
          : { Accept: 'application/json' },
        signal: combined,
      };
      if (body !== undefined) init.body = JSON.stringify(body);

      const response = await fetcher(`${baseUrl}${path}`, init);
      const payload = await readBoundedJson(response);

      if (!response.ok) {
        if (isAuthErrorResponse(payload)) {
          throw new AuthClientError({
            code: payload.error.code,
            status: response.status,
            retryable: payload.error.retryable,
          });
        }
        throw new AuthClientError({
          code: response.status === 401 ? 'UNAUTHENTICATED' : 'INVALID_AUTH_RESPONSE',
          status: response.status,
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof AuthClientError) throw error;
      const aborted = combined.aborted;
      throw new AuthClientError({
        code: aborted ? (timeout.signal.aborted ? 'AUTH_REQUEST_TIMEOUT' : 'ABORTED') : 'NETWORK_ERROR',
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async me(signal) {
      const res = await request('GET', AUTH_ROUTES.me, undefined, signal);
      if (!isAuthUserResponse(res)) {
        throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE' });
      }
      return res.user;
    },
    async login(body, signal) {
      const res = await request('POST', AUTH_ROUTES.login, body, signal);
      if (!isAuthUserResponse(res)) {
        throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE' });
      }
      return res.user;
    },
    async logout(signal) {
      await request('POST', AUTH_ROUTES.logout, {}, signal);
    },
    async changePassword(body, signal) {
      const res = await request('POST', AUTH_ROUTES.password, body, signal);
      if (!isAuthUserResponse(res)) {
        throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE' });
      }
      return res.user;
    },
    async forgotPassword(body, signal) {
      const res = await request('POST', AUTH_ROUTES.forgotPassword, body, signal);
      if (!isAuthOkResponse(res)) {
        throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE' });
      }
      return res;
    },
    async resetPassword(body, signal) {
      const res = await request('POST', AUTH_ROUTES.resetPassword, body, signal);
      if (!isAuthOkResponse(res)) {
        throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE' });
      }
      return res;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api/auth-client.test.ts`
Expected: PASS (6 tests passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/auth-client.ts frontend/src/api/auth-client.test.ts
git commit -m "feat(auth): create credentials-safe auth HTTP client"
```

---

### Task 3: Administration HTTP Client (`administration-client.ts`)

**Files:**
- Create: `frontend/src/api/administration-client.ts`
- Create: `frontend/src/api/administration-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * ============================================================================
 * FILE: administration-client.test.ts
 * LOCATION: frontend/src/api/administration-client.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for createAdministrationClient verifying keyset paging,
 *    user creation, lifecycle actions, and error handling.
 *
 * ROLE IN PROJECT:
 *    Protects administration wire contracts on the browser side.
 *
 * KEY COMPONENTS:
 *    - listUsers with query params
 *    - createUser, deactivateUser, reactivateUser, sendPasswordReset
 *    - AdministrationClientError mapping
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AdministrationClientError,
  createAdministrationClient,
} from './administration-client.ts';

describe('createAdministrationClient', () => {
  it('calls GET /admin/users with limit & cursor and parses AdministrationPage', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              userId: 'usr-1',
              email: 'operator@example.com',
              role: 'user',
              status: 'active',
              passwordChangeRequired: false,
              createdAt: '2026-11-10T12:00:00.000Z',
            },
          ],
          nextCursor: 'cursor-token-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAdministrationClient({ baseUrl: '/api', fetch: fetcher });
    const page = await client.listUsers({ limit: 10, cursor: 'cur-0' });

    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/users?limit=10&cursor=cur-0',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
      }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('cursor-token-1');
  });

  it('calls POST /admin/users to provision a User', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          user: {
            userId: 'usr-new',
            email: 'newuser@example.com',
            role: 'user',
            status: 'active',
            passwordChangeRequired: true,
            createdAt: '2026-11-10T12:05:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAdministrationClient({ baseUrl: '/api', fetch: fetcher });
    const user = await client.createUser({
      email: 'newuser@example.com',
      temporaryPassword: 'TempPassword123!',
      role: 'user',
    });

    expect(user.userId).toBe('usr-new');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/users',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    );
  });

  it('handles ACCOUNT_CONFLICT 409 error on creation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          error: { code: 'ACCOUNT_CONFLICT', retryable: false },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAdministrationClient({ baseUrl: '/api', fetch: fetcher });

    await expect(
      client.createUser({ email: 'taken@example.com', temporaryPassword: 'Password123!', role: 'user' }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_CONFLICT',
      status: 409,
    });
  });

  it('calls deactivate and reactivate lifecycle endpoints', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          user: {
            userId: 'usr-1',
            email: 'user@example.com',
            role: 'user',
            status: 'inactive',
            passwordChangeRequired: false,
            createdAt: '2026-11-10T12:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createAdministrationClient({ baseUrl: '/api', fetch: fetcher });
    const deactivated = await client.deactivateUser('usr-1');
    expect(deactivated.status).toBe('inactive');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/users/usr-1/deactivate',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/administration-client.test.ts`
Expected: FAIL with module `./administration-client.ts` not found.

- [ ] **Step 3: Write minimal implementation in `frontend/src/api/administration-client.ts`**

```typescript
/**
 * ============================================================================
 * FILE: administration-client.ts
 * LOCATION: frontend/src/api/administration-client.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bounded, credentials: 'same-origin' HTTP client for /admin/users/* endpoints.
 *
 * ROLE IN PROJECT:
 *    Enables the Super Admin user management panel to query keyset pages,
 *    provision new User accounts, and run lifecycle actions without secrets.
 *
 * KEY COMPONENTS:
 *    - createAdministrationClient: Factory for user table & lifecycle actions.
 *    - AdministrationClientError: Closed error mapping with safe presentations.
 * ============================================================================
 */

import {
  ADMINISTRATION_ROUTES,
  isAdministrationErrorResponse,
  isAdministrationPage,
  isAdministrationUserResponse,
  type AdministrationErrorCode,
  type AdministrationPage,
  type AdministrationUser,
  type CreateUserRequest,
} from './administration-protocol.ts';
import { isAuthOkResponse, type AuthOkResponse } from './auth-protocol.ts';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 65_536;
const SAFE_ADMIN_MESSAGE = 'Administration request could not be completed.';

export type AdministrationClientErrorCode =
  | AdministrationErrorCode
  | 'NETWORK_ERROR'
  | 'ABORTED'
  | 'ADMIN_REQUEST_TIMEOUT'
  | 'INVALID_ADMIN_RESPONSE'
  | 'INVALID_ADMIN_REQUEST';

export class AdministrationClientError extends Error {
  readonly code: AdministrationClientErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(options: {
    code: AdministrationClientErrorCode;
    status?: number;
    retryable?: boolean;
    message?: string;
  }) {
    super(options.message ?? SAFE_ADMIN_MESSAGE);
    this.name = 'AdministrationClientError';
    this.code = options.code;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
  }
}

export type AdministrationClient = {
  listUsers(query?: { limit?: number; cursor?: string }, signal?: AbortSignal): Promise<AdministrationPage>;
  createUser(body: CreateUserRequest, signal?: AbortSignal): Promise<AdministrationUser>;
  deactivateUser(userId: string, signal?: AbortSignal): Promise<AdministrationUser>;
  reactivateUser(userId: string, signal?: AbortSignal): Promise<AdministrationUser>;
  sendPasswordReset(userId: string, signal?: AbortSignal): Promise<AuthOkResponse>;
};

function readViteApiBase(): string | undefined {
  try {
    const env = import.meta.env as { VITE_API_BASE?: string } | undefined;
    return env?.VITE_API_BASE;
  } catch {
    return undefined;
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE', status: response.status });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE', status: response.status });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE', status: response.status });
  }
}

export function createAdministrationClient(options?: {
  baseUrl?: string;
  fetch?: typeof fetch;
}): AdministrationClient {
  const baseUrl = (options?.baseUrl ?? readViteApiBase() ?? '/api').replace(/\/+$/, '');
  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

    try {
      const init: RequestInit = {
        method,
        cache: 'no-store',
        redirect: 'error',
        credentials: 'same-origin',
        headers: body !== undefined
          ? { 'Content-Type': 'application/json', Accept: 'application/json' }
          : { Accept: 'application/json' },
        signal: combined,
      };
      if (body !== undefined) init.body = JSON.stringify(body);

      const response = await fetcher(`${baseUrl}${path}`, init);
      const payload = await readBoundedJson(response);

      if (!response.ok) {
        if (isAdministrationErrorResponse(payload)) {
          throw new AdministrationClientError({
            code: payload.error.code,
            status: response.status,
            retryable: payload.error.retryable,
          });
        }
        throw new AdministrationClientError({
          code: 'INVALID_ADMIN_RESPONSE',
          status: response.status,
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof AdministrationClientError) throw error;
      const aborted = combined.aborted;
      throw new AdministrationClientError({
        code: aborted ? (timeout.signal.aborted ? 'ADMIN_REQUEST_TIMEOUT' : 'ABORTED') : 'NETWORK_ERROR',
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async listUsers(query, signal) {
      const params = new URLSearchParams();
      if (query?.limit !== undefined) params.set('limit', String(query.limit));
      if (query?.cursor) params.set('cursor', query.cursor);
      const qs = params.toString();
      const path = qs ? `${ADMINISTRATION_ROUTES.users}?${qs}` : ADMINISTRATION_ROUTES.users;
      const res = await request('GET', path, undefined, signal);
      if (!isAdministrationPage(res)) {
        throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE' });
      }
      return res;
    },
    async createUser(body, signal) {
      const res = await request('POST', ADMINISTRATION_ROUTES.users, body, signal);
      if (!isAdministrationUserResponse(res)) {
        throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE' });
      }
      return res.user;
    },
    async deactivateUser(userId, signal) {
      const res = await request('POST', ADMINISTRATION_ROUTES.deactivate(userId), {}, signal);
      if (!isAdministrationUserResponse(res)) {
        throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE' });
      }
      return res.user;
    },
    async reactivateUser(userId, signal) {
      const res = await request('POST', ADMINISTRATION_ROUTES.reactivate(userId), {}, signal);
      if (!isAdministrationUserResponse(res)) {
        throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE' });
      }
      return res.user;
    },
    async sendPasswordReset(userId, signal) {
      const res = await request('POST', ADMINISTRATION_ROUTES.passwordReset(userId), {}, signal);
      if (!isAuthOkResponse(res)) {
        throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE' });
      }
      return res;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api/administration-client.test.ts`
Expected: PASS (4 tests passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/administration-client.ts frontend/src/api/administration-client.test.ts
git commit -m "feat(auth): create credentials-safe administration HTTP client"
```

---

### Task 4: Auth State Management & Provider (`useAuth` / `AuthProvider`)

**Files:**
- Create: `frontend/src/features/auth/auth-context.tsx`
- Create: `frontend/src/features/auth/auth-context.test.ts`
- Create: `frontend/src/features/auth/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * ============================================================================
 * FILE: auth-context.test.ts
 * LOCATION: frontend/src/features/auth/auth-context.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for AuthProvider state transitions and useAuth hook.
 *
 * ROLE IN PROJECT:
 *    Verifies bootstrap session checks, unauthenticated states, password-change
 *    gates, and clean logout flows.
 *
 * KEY COMPONENTS:
 *    - Initial /auth/me bootstrap
 *    - Login with passwordChangeRequired gating
 *    - Logout clearing user state
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthClient } from '../../api/auth-client.ts';
import { AuthProvider, useAuth } from './auth-context.tsx';

function ConsumerComponent() {
  const { user, status } = useAuth();
  return createElement(
    'div',
    { 'data-testid': 'auth-state' },
    `${status}:${user?.email ?? 'none'}:${user?.role ?? 'none'}`,
  );
}

describe('AuthProvider & useAuth', () => {
  it('renders unauthenticated state when initialStatus is unauthenticated', () => {
    const fakeClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        { client: fakeClient, initialStatus: 'unauthenticated' },
        createElement(ConsumerComponent),
      ),
    );

    expect(html).toContain('unauthenticated:none:none');
  });

  it('renders authenticated state when initial user is provided', () => {
    const fakeClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        {
          client: fakeClient,
          initialUser: {
            userId: 'usr-1',
            email: 'admin@example.com',
            role: 'super-admin',
            passwordChangeRequired: false,
          },
          initialStatus: 'authenticated',
        },
        createElement(ConsumerComponent),
      ),
    );

    expect(html).toContain('authenticated:admin@example.com:super-admin');
  });

  it('renders password-change-required state when initial user requires change', () => {
    const fakeClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        {
          client: fakeClient,
          initialUser: {
            userId: 'usr-2',
            email: 'newbie@example.com',
            role: 'user',
            passwordChangeRequired: true,
          },
          initialStatus: 'password-change-required',
        },
        createElement(ConsumerComponent),
      ),
    );

    expect(html).toContain('password-change-required:newbie@example.com:user');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/auth/auth-context.test.ts`
Expected: FAIL with module `./auth-context.tsx` not found.

- [ ] **Step 3: Write minimal implementation in `frontend/src/features/auth/auth-context.tsx` and barrel in `frontend/src/features/auth/index.ts`**

In `frontend/src/features/auth/auth-context.tsx`:
```typescript
/**
 * ============================================================================
 * FILE: auth-context.tsx
 * LOCATION: frontend/src/features/auth/auth-context.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    React context provider managing authentication state and login/logout flows.
 *
 * ROLE IN PROJECT:
 *    Binds the entire UI to server HttpOnly session state and gates private
 *    chat and admin surfaces without client-side credential storage.
 *
 * KEY COMPONENTS:
 *    - AuthProvider: Mounts auth client, manages session lifecycle.
 *    - useAuth: Hook for consuming auth status, user record, and actions.
 * ============================================================================
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  createAuthClient,
  type AuthClient,
  type AuthClientError,
} from '../../api/auth-client.ts';
import type {
  AuthUser,
  LoginRequest,
  PasswordRequest,
} from '../../api/auth-protocol.ts';

export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'authenticated'
  | 'password-change-required';

export type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
  login: (credentials: LoginRequest) => Promise<boolean>;
  logout: () => Promise<void>;
  changePassword: (request: PasswordRequest) => Promise<boolean>;
  refreshUser: () => Promise<AuthUser | null>;
  clearError: () => void;
  client: AuthClient;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export type AuthProviderProps = {
  children: ReactNode;
  client?: AuthClient;
  initialUser?: AuthUser | null;
  initialStatus?: AuthStatus;
};

export function AuthProvider({
  children,
  client: propClient,
  initialUser = null,
  initialStatus,
}: AuthProviderProps) {
  const [client] = useState(() => propClient ?? createAuthClient());
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [status, setStatus] = useState<AuthStatus>(() => {
    if (initialStatus) return initialStatus;
    if (initialUser) {
      return initialUser.passwordChangeRequired ? 'password-change-required' : 'authenticated';
    }
    return 'loading';
  });
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const activeUser = await client.me();
      setUser(activeUser);
      setStatus(activeUser.passwordChangeRequired ? 'password-change-required' : 'authenticated');
      setError(null);
      return activeUser;
    } catch (err) {
      setUser(null);
      setStatus('unauthenticated');
      return null;
    }
  }, [client]);

  useEffect(() => {
    if (initialStatus !== undefined || initialUser !== null) return;
    void refreshUser();
  }, [initialStatus, initialUser, refreshUser]);

  const login = useCallback(
    async (credentials: LoginRequest): Promise<boolean> => {
      setError(null);
      try {
        const loggedIn = await client.login(credentials);
        setUser(loggedIn);
        setStatus(loggedIn.passwordChangeRequired ? 'password-change-required' : 'authenticated');
        return true;
      } catch (err: unknown) {
        const authErr = err as AuthClientError;
        if (authErr?.code === 'RATE_LIMITED') {
          setError('Too many login attempts. Please wait 60 seconds before trying again.');
        } else {
          setError('Invalid email or password.');
        }
        return false;
      }
    },
    [client],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await client.logout();
    } catch {
      // Best-effort server revocation.
    } finally {
      setUser(null);
      setStatus('unauthenticated');
      setError(null);
    }
  }, [client]);

  const changePassword = useCallback(
    async (request: PasswordRequest): Promise<boolean> => {
      setError(null);
      try {
        const updated = await client.changePassword(request);
        setUser(updated);
        setStatus('authenticated');
        return true;
      } catch (err: unknown) {
        const authErr = err as AuthClientError;
        if (authErr?.code === 'RATE_LIMITED') {
          setError('Too many attempts. Please wait before retrying.');
        } else {
          setError('Could not update password. Ensure current password is correct.');
        }
        return false;
      }
    },
    [client],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      error,
      login,
      logout,
      changePassword,
      refreshUser,
      clearError,
      client,
    }),
    [user, status, error, login, logout, changePassword, refreshUser, clearError, client],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

In `frontend/src/features/auth/index.ts`:
```typescript
/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: frontend/src/features/auth/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Public exports for the auth feature module.
 *
 * ROLE IN PROJECT:
 *    Exposes AuthProvider, useAuth hook, and custom authentication screens.
 *
 * KEY COMPONENTS:
 *    - AuthProvider & useAuth
 * ============================================================================
 */

export { AuthProvider, useAuth } from './auth-context.tsx';
export type { AuthProviderProps, AuthStatus, AuthContextValue } from './auth-context.tsx';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/auth/auth-context.test.ts`
Expected: PASS (3 tests passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/auth/auth-context.tsx frontend/src/features/auth/auth-context.test.ts frontend/src/features/auth/index.ts
git commit -m "feat(auth): create AuthProvider and useAuth session hook"
```

---

### Task 5: Custom Auth Forms (`LoginForm`, `MandatoryPasswordChangeForm`, `ForgotPasswordForm`, `ResetPasswordForm`, `auth.css`)

**Files:**
- Create: `frontend/src/features/auth/auth.css`
- Create: `frontend/src/features/auth/LoginForm.tsx`
- Create: `frontend/src/features/auth/MandatoryPasswordChangeForm.tsx`
- Create: `frontend/src/features/auth/ForgotPasswordForm.tsx`
- Create: `frontend/src/features/auth/ResetPasswordForm.tsx`
- Create: `frontend/src/features/auth/auth-forms.test.ts`
- Modify: `frontend/src/features/auth/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * ============================================================================
 * FILE: auth-forms.test.ts
 * LOCATION: frontend/src/features/auth/auth-forms.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    SSR markup tests for custom authentication screens verifying accessibility,
 *    input labeling, masking, and error/help roles.
 *
 * ROLE IN PROJECT:
 *    Ensures all auth forms follow Aurvin visual standards and WCAG form labeling.
 *
 * KEY COMPONENTS:
 *    - LoginForm markup and password masking
 *    - MandatoryPasswordChangeForm validation rules
 *    - ForgotPasswordForm and ResetPasswordForm controls
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ForgotPasswordForm } from './ForgotPasswordForm.tsx';
import { LoginForm } from './LoginForm.tsx';
import { MandatoryPasswordChangeForm } from './MandatoryPasswordChangeForm.tsx';
import { ResetPasswordForm } from './ResetPasswordForm.tsx';

describe('Custom Auth Forms SSR', () => {
  it('renders LoginForm with email, masked password, submit, and forgot password toggle', () => {
    const html = renderToStaticMarkup(
      createElement(LoginForm, {
        onSubmit: vi.fn(),
        onForgotPassword: vi.fn(),
      }),
    );

    expect(html).toContain('Sign in to Aurvin');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('Forgot password?');
    expect(html).toContain('Sign in</button>');
  });

  it('renders MandatoryPasswordChangeForm with explanation and password inputs', () => {
    const html = renderToStaticMarkup(
      createElement(MandatoryPasswordChangeForm, {
        onSubmit: vi.fn(),
        onSignOut: vi.fn(),
      }),
    );

    expect(html).toContain('Set a new private password');
    expect(html).toContain('Current temporary password');
    expect(html).toContain('New password');
    expect(html).toContain('Confirm new password');
    expect(html).toContain('Sign out</button>');
  });

  it('renders ForgotPasswordForm with email input and generic mailbox notice', () => {
    const html = renderToStaticMarkup(
      createElement(ForgotPasswordForm, {
        onSubmit: vi.fn(),
        onBackToLogin: vi.fn(),
      }),
    );

    expect(html).toContain('Reset your password');
    expect(html).toContain('Send recovery email</button>');
    expect(html).toContain('Back to sign in</button>');
  });

  it('renders ResetPasswordForm with token requirement and new password inputs', () => {
    const html = renderToStaticMarkup(
      createElement(ResetPasswordForm, {
        token: 'test-token-123',
        onSubmit: vi.fn(),
      }),
    );

    expect(html).toContain('Choose a new password');
    expect(html).toContain('New password');
    expect(html).toContain('Confirm new password');
    expect(html).toContain('Update password</button>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/auth/auth-forms.test.ts`
Expected: FAIL with missing form component modules.

- [ ] **Step 3: Write minimal implementation**

1. Create `frontend/src/features/auth/auth.css`:
```css
/**
 * ============================================================================
 * FILE: auth.css
 * LOCATION: frontend/src/features/auth/auth.css
 * ============================================================================
 *
 * PURPOSE:
 *    Styling for custom Aurvin authentication and onboarding screens.
 * ============================================================================
 */

.aurvin-auth-shell {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100svh;
  width: 100%;
  padding: 24px;
  background-color: var(--aurvin-bg);
  box-sizing: border-box;
}

.aurvin-auth-card {
  width: 100%;
  max-width: 400px;
  background: var(--aurvin-surface-elevated);
  border: 1px solid var(--aurvin-border);
  border-radius: 16px;
  padding: 32px 28px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  box-sizing: border-box;
}

.aurvin-auth-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
  font-weight: 600;
  font-size: 18px;
  color: var(--aurvin-text-primary);
}

.aurvin-auth-title {
  margin: 0 0 8px 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--aurvin-text-primary);
}

.aurvin-auth-desc {
  margin: 0 0 24px 0;
  font-size: 14px;
  color: var(--aurvin-text-secondary);
  line-height: 1.5;
}

.aurvin-auth-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.aurvin-auth-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.aurvin-auth-field label {
  font-size: 13px;
  font-weight: 500;
  color: var(--aurvin-text-secondary);
}

.aurvin-auth-field input {
  height: 42px;
  padding: 0 12px;
  background: var(--aurvin-bg);
  border: 1px solid var(--aurvin-border);
  border-radius: 8px;
  font-family: inherit;
  font-size: 14px;
  color: var(--aurvin-text-primary);
  box-sizing: border-box;
}

.aurvin-auth-field input:focus {
  outline: none;
  border-color: var(--aurvin-primary);
}

.aurvin-auth-error {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.15);
  border: 1px solid var(--aurvin-danger);
  color: var(--aurvin-danger);
  font-size: 13px;
  line-height: 1.4;
}

.aurvin-auth-notice {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--aurvin-selected);
  border: 1px solid var(--aurvin-border);
  color: var(--aurvin-text-primary);
  font-size: 13px;
  line-height: 1.4;
}

.aurvin-auth-submit {
  height: 42px;
  border-radius: 8px;
  border: none;
  background: var(--aurvin-primary);
  color: var(--aurvin-on-primary);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.aurvin-auth-submit:hover:not(:disabled) {
  opacity: 0.9;
}

.aurvin-auth-submit:disabled {
  background: var(--aurvin-disabled-bg);
  color: var(--aurvin-disabled-fg);
  cursor: not-allowed;
}

.aurvin-auth-secondary {
  background: none;
  border: none;
  color: var(--aurvin-text-secondary);
  font-size: 13px;
  cursor: pointer;
  padding: 4px;
  text-decoration: underline;
  text-align: center;
}

.aurvin-auth-secondary:hover {
  color: var(--aurvin-text-primary);
}

.aurvin-auth-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}
```

2. Create `frontend/src/features/auth/LoginForm.tsx`:
```typescript
/**
 * ============================================================================
 * FILE: LoginForm.tsx
 * LOCATION: frontend/src/features/auth/LoginForm.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Email and password authentication screen for Aurvin users.
 *
 * ROLE IN PROJECT:
 *    Renders the unauthenticated login form with client validation, rate limit
 *    notices, and navigation to the password recovery screen.
 *
 * KEY COMPONENTS:
 *    - LoginForm: Accessible inputs for email and password.
 * ============================================================================
 */

import { useState, type FormEvent } from 'react';
import type { LoginRequest } from '../../api/auth-protocol.ts';
import './auth.css';

export type LoginFormProps = {
  onSubmit: (credentials: LoginRequest) => Promise<boolean | void>;
  onForgotPassword: () => void;
  error?: string | null;
  busy?: boolean;
};

export function LoginForm({ onSubmit, onForgotPassword, error, busy = false }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localBusy, setLocalBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || localBusy || !email.trim() || !password) return;
    setLocalBusy(true);
    try {
      await onSubmit({ email: email.trim().toLowerCase(), password });
    } finally {
      setLocalBusy(false);
    }
  };

  const isSubmitting = busy || localBusy;

  return (
    <div className="aurvin-auth-shell">
      <div className="aurvin-auth-card">
        <div className="aurvin-auth-brand">
          <img src="/aurvin-logo.png" alt="" width={24} height={24} />
          <span>Aurvin</span>
        </div>
        <h1 className="aurvin-auth-title">Sign in to Aurvin</h1>
        <p className="aurvin-auth-desc">Enter your credentials to access your personal assistant.</p>

        {error ? (
          <div className="aurvin-auth-error" role="alert">
            {error}
          </div>
        ) : null}

        <form className="aurvin-auth-form" onSubmit={handleSubmit}>
          <div className="aurvin-auth-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              disabled={isSubmitting}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="aurvin-auth-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              disabled={isSubmitting}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="aurvin-auth-actions">
            <button
              type="submit"
              className="aurvin-auth-submit"
              disabled={isSubmitting || !email.trim() || !password}
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="aurvin-auth-secondary"
              disabled={isSubmitting}
              onClick={onForgotPassword}
            >
              Forgot password?
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

3. Create `frontend/src/features/auth/MandatoryPasswordChangeForm.tsx`:
```typescript
/**
 * ============================================================================
 * FILE: MandatoryPasswordChangeForm.tsx
 * LOCATION: frontend/src/features/auth/MandatoryPasswordChangeForm.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    First-login onboarding screen requiring private password replacement.
 *
 * ROLE IN PROJECT:
 *    Gates new User accounts provisioned with admin temporary passwords until
 *    a distinct 8+ character password is confirmed.
 *
 * KEY COMPONENTS:
 *    - MandatoryPasswordChangeForm: Current vs new password validation.
 * ============================================================================
 */

import { useState, type FormEvent } from 'react';
import type { PasswordRequest } from '../../api/auth-protocol.ts';
import './auth.css';

export type MandatoryPasswordChangeFormProps = {
  onSubmit: (request: PasswordRequest) => Promise<boolean | void>;
  onSignOut: () => void;
  error?: string | null;
  busy?: boolean;
};

export function MandatoryPasswordChangeForm({
  onSubmit,
  onSignOut,
  error,
  busy = false,
}: MandatoryPasswordChangeFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (newPassword.length < 8) {
      setLocalError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword === currentPassword) {
      setLocalError('New password must be different from your temporary password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError('New passwords do not match.');
      return;
    }

    setLocalBusy(true);
    try {
      await onSubmit({ currentPassword, newPassword });
    } finally {
      setLocalBusy(false);
    }
  };

  const isSubmitting = busy || localBusy;
  const activeError = localError || error;

  return (
    <div className="aurvin-auth-shell">
      <div className="aurvin-auth-card">
        <div className="aurvin-auth-brand">
          <img src="/aurvin-logo.png" alt="" width={24} height={24} />
          <span>Aurvin</span>
        </div>
        <h1 className="aurvin-auth-title">Set a new private password</h1>
        <p className="aurvin-auth-desc">
          Your account was provisioned with a temporary password. Choose a private password before accessing Aurvin.
        </p>

        {activeError ? (
          <div className="aurvin-auth-error" role="alert">
            {activeError}
          </div>
        ) : null}

        <form className="aurvin-auth-form" onSubmit={handleSubmit}>
          <div className="aurvin-auth-field">
            <label htmlFor="temp-password">Current temporary password</label>
            <input
              id="temp-password"
              type="password"
              required
              autoFocus
              value={currentPassword}
              disabled={isSubmitting}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>

          <div className="aurvin-auth-field">
            <label htmlFor="new-password">New password (minimum 8 characters)</label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              value={newPassword}
              disabled={isSubmitting}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <div className="aurvin-auth-field">
            <label htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              disabled={isSubmitting}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <div className="aurvin-auth-actions">
            <button
              type="submit"
              className="aurvin-auth-submit"
              disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword}
            >
              {isSubmitting ? 'Updating…' : 'Set new password & continue'}
            </button>
            <button
              type="button"
              className="aurvin-auth-secondary"
              disabled={isSubmitting}
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

4. Create `frontend/src/features/auth/ForgotPasswordForm.tsx`:
```typescript
/**
 * ============================================================================
 * FILE: ForgotPasswordForm.tsx
 * LOCATION: frontend/src/features/auth/ForgotPasswordForm.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    User-facing mailbox password recovery request screen.
 *
 * ROLE IN PROJECT:
 *    Allows accounts to request a WorkOS password reset email with generic
 *    enumeration-safe feedback.
 *
 * KEY COMPONENTS:
 *    - ForgotPasswordForm: Email input and confirmation notice.
 * ============================================================================
 */

import { useState, type FormEvent } from 'react';
import type { ForgotPasswordRequest } from '../../api/auth-protocol.ts';
import './auth.css';

export type ForgotPasswordFormProps = {
  onSubmit: (request: ForgotPasswordRequest) => Promise<boolean | void>;
  onBackToLogin: () => void;
  error?: string | null;
  busy?: boolean;
};

export function ForgotPasswordForm({
  onSubmit,
  onBackToLogin,
  error,
  busy = false,
}: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || localBusy || !email.trim()) return;
    setLocalBusy(true);
    try {
      await onSubmit({ email: email.trim().toLowerCase() });
      setSubmitted(true);
    } finally {
      setLocalBusy(false);
    }
  };

  const isSubmitting = busy || localBusy;

  return (
    <div className="aurvin-auth-shell">
      <div className="aurvin-auth-card">
        <div className="aurvin-auth-brand">
          <img src="/aurvin-logo.png" alt="" width={24} height={24} />
          <span>Aurvin</span>
        </div>
        <h1 className="aurvin-auth-title">Reset your password</h1>
        <p className="aurvin-auth-desc">
          Enter your account email. If the address is registered, instructions will be delivered to your inbox.
        </p>

        {submitted ? (
          <div className="aurvin-auth-notice" role="status">
            If an account exists for {email}, a recovery link has been sent. Check your inbox.
          </div>
        ) : null}

        {error ? (
          <div className="aurvin-auth-error" role="alert">
            {error}
          </div>
        ) : null}

        {!submitted ? (
          <form className="aurvin-auth-form" onSubmit={handleSubmit}>
            <div className="aurvin-auth-field">
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                disabled={isSubmitting}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="aurvin-auth-actions">
              <button
                type="submit"
                className="aurvin-auth-submit"
                disabled={isSubmitting || !email.trim()}
              >
                {isSubmitting ? 'Sending…' : 'Send recovery email'}
              </button>
              <button
                type="button"
                className="aurvin-auth-secondary"
                disabled={isSubmitting}
                onClick={onBackToLogin}
              >
                Back to sign in
              </button>
            </div>
          </form>
        ) : (
          <div className="aurvin-auth-actions">
            <button
              type="button"
              className="aurvin-auth-submit"
              onClick={onBackToLogin}
            >
              Return to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

5. Create `frontend/src/features/auth/ResetPasswordForm.tsx`:
```typescript
/**
 * ============================================================================
 * FILE: ResetPasswordForm.tsx
 * LOCATION: frontend/src/features/auth/ResetPasswordForm.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Password reset confirmation screen consuming single-use recovery token.
 *
 * ROLE IN PROJECT:
 *    Completes the mailbox recovery flow, invalidates older sessions on the
 *    provider, and guides the user to standard sign-in.
 *
 * KEY COMPONENTS:
 *    - ResetPasswordForm: Token binding and new password validation.
 * ============================================================================
 */

import { useState, type FormEvent } from 'react';
import type { ResetPasswordRequest } from '../../api/auth-protocol.ts';
import './auth.css';

export type ResetPasswordFormProps = {
  token: string;
  onSubmit: (request: ResetPasswordRequest) => Promise<boolean | void>;
  onSuccess?: () => void;
  error?: string | null;
  busy?: boolean;
};

export function ResetPasswordForm({
  token,
  onSubmit,
  onSuccess,
  error,
  busy = false,
}: ResetPasswordFormProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [completed, setCompleted] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (newPassword.length < 8) {
      setLocalError('Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }

    setLocalBusy(true);
    try {
      await onSubmit({ token, newPassword });
      setCompleted(true);
      onSuccess?.();
    } finally {
      setLocalBusy(false);
    }
  };

  const isSubmitting = busy || localBusy;
  const activeError = localError || error;

  return (
    <div className="aurvin-auth-shell">
      <div className="aurvin-auth-card">
        <div className="aurvin-auth-brand">
          <img src="/aurvin-logo.png" alt="" width={24} height={24} />
          <span>Aurvin</span>
        </div>
        <h1 className="aurvin-auth-title">Choose a new password</h1>
        <p className="aurvin-auth-desc">Create a secure private password for your account.</p>

        {completed ? (
          <div className="aurvin-auth-notice" role="status">
            Password has been reset successfully. You can now sign in with your new credentials.
          </div>
        ) : null}

        {activeError ? (
          <div className="aurvin-auth-error" role="alert">
            {activeError}
          </div>
        ) : null}

        {!completed ? (
          <form className="aurvin-auth-form" onSubmit={handleSubmit}>
            <div className="aurvin-auth-field">
              <label htmlFor="reset-new-password">New password</label>
              <input
                id="reset-new-password"
                type="password"
                required
                minLength={8}
                autoFocus
                value={newPassword}
                disabled={isSubmitting}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="aurvin-auth-field">
              <label htmlFor="reset-confirm-password">Confirm new password</label>
              <input
                id="reset-confirm-password"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                disabled={isSubmitting}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <div className="aurvin-auth-actions">
              <button
                type="submit"
                className="aurvin-auth-submit"
                disabled={isSubmitting || !newPassword || !confirmPassword}
              >
                {isSubmitting ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
```

6. In `frontend/src/features/auth/index.ts`, re-export form components:
```typescript
export { LoginForm } from './LoginForm.tsx';
export { MandatoryPasswordChangeForm } from './MandatoryPasswordChangeForm.tsx';
export { ForgotPasswordForm } from './ForgotPasswordForm.tsx';
export { ResetPasswordForm } from './ResetPasswordForm.tsx';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/auth/auth-forms.test.ts`
Expected: PASS (4 tests passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/auth/auth.css frontend/src/features/auth/LoginForm.tsx frontend/src/features/auth/MandatoryPasswordChangeForm.tsx frontend/src/features/auth/ForgotPasswordForm.tsx frontend/src/features/auth/ResetPasswordForm.tsx frontend/src/features/auth/auth-forms.test.ts frontend/src/features/auth/index.ts
git commit -m "feat(auth): create custom login, password change, and recovery forms"
```

---

### Task 6: ProfileMenu and Sidebar Functional Sign Out & Role Display

**Files:**
- Modify: `frontend/src/features/admin-config/ProfileMenu.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/features/chat/ChatView.tsx`
- Create: `frontend/src/features/admin-config/profile-menu.test.ts`
- Modify: `frontend/src/features/admin-config/navigation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * ============================================================================
 * FILE: profile-menu.test.ts
 * LOCATION: frontend/src/features/admin-config/profile-menu.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for ProfileMenu verifying dynamic user role/email rendering
 *    and functional Sign out triggers.
 *
 * ROLE IN PROJECT:
 *    Verifies that the pinned footer displays logged-in identity and provides
 *    an operable logout control without authentication disabled placeholders.
 *
 * KEY COMPONENTS:
 *    - Super Admin vs standard User email and role label
 *    - Sign out button execution
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProfileMenu } from './ProfileMenu.tsx';

describe('ProfileMenu role-aware and functional logout', () => {
  it('displays user email and role for standard User with enabled Sign out', () => {
    const onSignOut = vi.fn();
    const onManage = vi.fn();

    const html = renderToStaticMarkup(
      createElement(ProfileMenu, {
        user: {
          userId: 'usr-123',
          email: 'peter@example.com',
          role: 'user',
          passwordChangeRequired: false,
        },
        onManageAurvin: onManage,
        onSignOut,
      }),
    );

    expect(html).toContain('peter@example.com');
    expect(html).toContain('User');
    expect(html).not.toContain('Authentication not enabled');
    expect(html).toMatch(/<button[^>]*>Sign out<\/button>/);
    expect(html).not.toContain('disabled=""');
  });

  it('displays Super admin role for super-admin user', () => {
    const html = renderToStaticMarkup(
      createElement(ProfileMenu, {
        user: {
          userId: 'usr-admin',
          email: 'admin@example.com',
          role: 'super-admin',
          passwordChangeRequired: false,
        },
        onManageAurvin: vi.fn(),
        onSignOut: vi.fn(),
      }),
    );

    expect(html).toContain('admin@example.com');
    expect(html).toContain('Super admin');
  });

  it('falls back safely when user is not provided', () => {
    const html = renderToStaticMarkup(
      createElement(ProfileMenu, {
        onManageAurvin: vi.fn(),
      }),
    );

    expect(html).toContain('Super admin');
    expect(html).toContain('Authentication not enabled.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/admin-config/profile-menu.test.ts`
Expected: FAIL because `user` and `onSignOut` props are not supported on `ProfileMenu`.

- [ ] **Step 3: Update `ProfileMenu.tsx`, `Sidebar.tsx`, and `ChatView.tsx`**

1. In `frontend/src/features/admin-config/ProfileMenu.tsx`:
```typescript
/**
 * ============================================================================
 * FILE: ProfileMenu.tsx
 * LOCATION: frontend/src/features/admin-config/ProfileMenu.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Native bottom-profile disclosure for user account and role management.
 *
 * ROLE IN PROJECT:
 *    Pins Manage Aurvin and working Sign out under chat history reflecting
 *    the active authenticated account's email and role.
 *
 * KEY COMPONENTS:
 *    - Role badge & email summary
 *    - Manage Aurvin and functional Sign out buttons
 * ============================================================================
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { AuthUser } from '../../api/auth-protocol.ts';
import './admin-config.css';

export type ProfileMenuProps = {
  user?: AuthUser | null;
  onManageAurvin: () => void;
  onSignOut?: () => void;
};

export function ProfileMenu({ user, onManageAurvin, onSignOut }: ProfileMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const manageRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const helpId = useId();

  useEffect(() => {
    if (!open) return undefined;
    manageRef.current?.focus();
    const onPointer = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (!details?.contains(event.target as Node)) {
        if (details) details.open = false;
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const roleLabel = user?.role === 'user' ? 'User' : 'Super admin';
  const displayLabel = user?.email ?? 'Super admin';

  return (
    <details
      ref={detailsRef}
      className="aurvin-profile"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.currentTarget.open = false;
        setOpen(false);
        event.currentTarget.querySelector('summary')?.focus();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          event.currentTarget.open = false;
          setOpen(false);
        }
      }}
    >
      <summary className="aurvin-profile-trigger" aria-label={displayLabel}>
        <span className="aurvin-profile-mark" aria-hidden="true">
          <img src="/aurvin-logo.png" alt="" width={20} height={20} />
        </span>
        <div className="aurvin-profile-labels">
          <span className="aurvin-profile-name">{displayLabel}</span>
          {user ? <span className="aurvin-profile-role">{roleLabel}</span> : null}
        </div>
      </summary>
      <div className="aurvin-profile-menu">
        <button
          ref={manageRef}
          type="button"
          onClick={() => {
            if (detailsRef.current) detailsRef.current.open = false;
            setOpen(false);
            onManageAurvin();
          }}
        >
          Manage Aurvin
        </button>
        {onSignOut ? (
          <button
            type="button"
            onClick={() => {
              if (detailsRef.current) detailsRef.current.open = false;
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        ) : (
          <>
            <button type="button" disabled aria-describedby={helpId}>
              Sign out
            </button>
            <p id={helpId} className="aurvin-admin-help">
              Authentication not enabled.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
```

2. In `frontend/src/components/Sidebar.tsx`:
Add `user?: AuthUser | null; onSignOut?: () => void;` to `SidebarProps` and pass them down:
```typescript
import type { AuthUser } from '../api/auth-protocol.ts';

export type SidebarProps = {
  onCollapse?: () => void;
  onNewChat?: () => void;
  onManageAurvin?: () => void;
  user?: AuthUser | null;
  onSignOut?: () => void;
};
```
In `Sidebar`:
```typescript
export function Sidebar({ onCollapse, onNewChat, onManageAurvin, user, onSignOut }: SidebarProps) {
  ...
  return <SidebarContent onCollapse={onCollapse} onNewChat={onNewChat} onManageAurvin={onManageAurvin}
    user={user} onSignOut={onSignOut}
    ...
```
In `SidebarContent`:
```typescript
      {onManageAurvin ? (
        <div className="aurvin-profile-footer">
          <ProfileMenu user={user} onManageAurvin={onManageAurvin} onSignOut={onSignOut} />
        </div>
      ) : null}
```

3. In `frontend/src/features/chat/ChatView.tsx`:
Add `user?: AuthUser | null; onSignOut?: () => void;` to props of `ChatView`:
```typescript
import type { AuthUser } from '../../api/auth-protocol.ts';

export function ChatView(props: {
  visible?: boolean;
  onManageAurvin?: () => void;
  onOpenCalendarSetup?: () => void;
  user?: AuthUser | null;
  onSignOut?: () => void;
  liveVoice?: LiveVoiceSurface;
}) {
```
Pass to `<Sidebar ... user={props.user} onSignOut={props.onSignOut} />`.

4. Update `frontend/src/features/admin-config/navigation.test.ts` to reflect the new markup.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/admin-config/profile-menu.test.ts src/features/admin-config/navigation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/admin-config/ProfileMenu.tsx frontend/src/components/Sidebar.tsx frontend/src/features/chat/ChatView.tsx frontend/src/features/admin-config/profile-menu.test.ts frontend/src/features/admin-config/navigation.test.ts
git commit -m "feat(auth): add role and email display to ProfileMenu with functional sign out"
```

---

### Task 7: Role-Aware AdminDashboard Navigation & Plugin Independence

**Files:**
- Modify: `frontend/src/features/admin-config/config-edit-state.ts`
- Modify: `frontend/src/features/admin-config/AdminDashboard.tsx`
- Create: `frontend/src/features/admin-config/role-aware-dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * ============================================================================
 * FILE: role-aware-dashboard.test.ts
 * LOCATION: frontend/src/features/admin-config/role-aware-dashboard.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AdminDashboard presents role-gated tabs and avoids restricted
 *    configuration reads when rendered for standard Users.
 *
 * ROLE IN PROJECT:
 *    Ensures standard Users can access Plugins without calling the 403-restricted
 *    GET /admin/config endpoint, while Super Admins see all 4 tabs.
 *
 * KEY COMPONENTS:
 *    - Role check: User sees Plugins only; Super Admin sees Config, Plugins, Analytics, Administration
 *    - Client read call suppression for standard Users
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminConfigClient } from '../../api/admin-config-client.ts';
import { AdminDashboard } from './AdminDashboard.tsx';
import { publicConfig } from './testing/fixtures.ts';

describe('AdminDashboard role-aware navigation', () => {
  it('renders only Plugins tab for standard User and does not call client.read', () => {
    const read = vi.fn(async () => publicConfig());
    const client: AdminConfigClient = {
      read,
      saveSettings: vi.fn(),
      updateCredential: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(AdminDashboard, {
        client,
        user: {
          userId: 'usr-user',
          email: 'user@example.com',
          role: 'user',
          passwordChangeRequired: false,
        },
        onBackToChat: () => undefined,
        refreshCapabilities: async () => true,
      }),
    );

    expect(html).toContain('Manage Aurvin');
    expect(html).toContain('Plugins');
    expect(html).not.toContain('>Config<');
    expect(html).not.toContain('>Analytics<');
    expect(html).not.toContain('>Administration<');
    expect(read).not.toHaveBeenCalled();
  });

  it('renders all 4 tabs for Super Admin and invokes client.read', () => {
    const read = vi.fn(async () => publicConfig());
    const client: AdminConfigClient = {
      read,
      saveSettings: vi.fn(),
      updateCredential: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(AdminDashboard, {
        client,
        user: {
          userId: 'usr-admin',
          email: 'admin@example.com',
          role: 'super-admin',
          passwordChangeRequired: false,
        },
        onBackToChat: () => undefined,
        refreshCapabilities: async () => true,
      }),
    );

    expect(html).toContain('Config');
    expect(html).toContain('Plugins');
    expect(html).toContain('Analytics');
    expect(html).toContain('Administration');
    expect(read).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/admin-config/role-aware-dashboard.test.ts`
Expected: FAIL because `user` prop and Administration tab are not in `AdminDashboard`.

- [ ] **Step 3: Update `config-edit-state.ts` and `AdminDashboard.tsx`**

1. In `frontend/src/features/admin-config/config-edit-state.ts`:
Update `AdminTab` type:
```typescript
export type AdminTab = 'config' | 'plugins' | 'analytics' | 'administration';
```

2. In `frontend/src/features/admin-config/AdminDashboard.tsx`:
Add `user?: AuthUser | null;` and `adminClient?: AdministrationClient;` to `AdminDashboardProps`:
```typescript
import type { AuthUser } from '../../api/auth-protocol.ts';
import type { AdministrationClient } from '../../api/administration-client.ts';

export type AdminDashboardProps = {
  client: AdminConfigClient;
  calendarClient?: CalendarClient;
  adminClient?: AdministrationClient;
  user?: AuthUser | null;
  onBackToChat: () => void;
  refreshCapabilities: () => Promise<boolean>;
  chatActive?: boolean;
  initialSection?: DashboardSection;
  initialCalendarStatus?: CalendarPublicStatus | null;
  oauthOutcome?: CalendarOAuthCallbackOutcome | null;
  onDismissOAuthOutcome?: () => void;
};
```
Define dynamic tabs based on `user?.role`:
```typescript
const SUPER_ADMIN_TABS: { id: AdminTab; label: string }[] = [
  { id: 'config', label: 'Config' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'administration', label: 'Administration' },
];

const USER_TABS: { id: AdminTab; label: string }[] = [
  { id: 'plugins', label: 'Plugins' },
];
```
In `AdminDashboard`:
```typescript
  const isStandardUser = user?.role === 'user';
  const tabs = isStandardUser ? USER_TABS : SUPER_ADMIN_TABS;
  const [tab, setTab] = useState<AdminTab>(() => {
    if (isStandardUser) return 'plugins';
    return initialSection && isPluginSection(initialSection) ? 'plugins' : 'config';
  });
```
Gate `client.read` so it only fires when `!isStandardUser`:
```typescript
  useEffect(() => {
    if (isStandardUser) {
      setPhase('ready');
      return;
    }
    const epoch = ++epochRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase('loading');
    void client.read(abort.signal).then((config) => {
      if (epoch !== epochRef.current) return;
      dispatch({ type: 'loaded', config });
      setPhase('ready');
    }).catch(() => {
      if (epoch !== epochRef.current) return;
      setPhase('unavailable');
    });
    return () => {
      abort.abort();
      epochRef.current += 1;
      refreshEpoch.current += 1;
    };
  }, [client, isStandardUser]);
```
In tab navigation key handler and panel container, map over `tabs` dynamically.
Add panel for administration:
```typescript
          <div
            id={`${ids}-administration-panel`}
            role="tabpanel"
            aria-labelledby={`${ids}-administration-tab`}
            hidden={tab !== 'administration'}
          >
            {tab === 'administration' && !isStandardUser ? (
              <div className="aurvin-admin-panel-placeholder" role="region" aria-label="User Administration">
                {/* Rendered by Task 8 */}
              </div>
            ) : null}
          </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/admin-config/role-aware-dashboard.test.ts src/features/admin-config/admin-dashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/admin-config/config-edit-state.ts frontend/src/features/admin-config/AdminDashboard.tsx frontend/src/features/admin-config/role-aware-dashboard.test.ts
git commit -m "feat(auth): make AdminDashboard role-aware with isolated Plugins access for Users"
```

---

### Task 8: Administration UI Tab (`AdministrationPanel.tsx`, `CreateUserDialog.tsx`)

**Files:**
- Create: `frontend/src/features/admin-config/CreateUserDialog.tsx`
- Create: `frontend/src/features/admin-config/AdministrationPanel.tsx`
- Create: `frontend/src/features/admin-config/administration-panel.test.ts`
- Modify: `frontend/src/features/admin-config/AdminDashboard.tsx`
- Modify: `frontend/src/features/admin-config/admin-config.css`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * ============================================================================
 * FILE: administration-panel.test.ts
 * LOCATION: frontend/src/features/admin-config/administration-panel.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for AdministrationPanel and CreateUserDialog verifying
 *    table columns, status badges, keyset pagination, and lifecycle action wiring.
 *
 * ROLE IN PROJECT:
 *    Verifies that Super Admin user management operates with clean credentials,
 *    safe error feedback, and single-role creation.
 *
 * KEY COMPONENTS:
 *    - Users table column verification (Email, Role, Status, Created, Actions)
 *    - Status badges (Active, Pending password change, Inactive)
 *    - CreateUserDialog input masking & transient clear
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdministrationClient } from '../../api/administration-client.ts';
import { AdministrationPanel } from './AdministrationPanel.tsx';
import { CreateUserDialog } from './CreateUserDialog.tsx';

describe('AdministrationPanel & CreateUserDialog', () => {
  it('renders users table with email, role, status badges, and action controls', () => {
    const client: AdministrationClient = {
      listUsers: vi.fn(async () => ({
        items: [
          {
            userId: 'usr-1',
            email: 'admin@example.com',
            role: 'super-admin',
            status: 'active',
            passwordChangeRequired: false,
            createdAt: '2026-11-10T10:00:00.000Z',
          },
          {
            userId: 'usr-2',
            email: 'newbie@example.com',
            role: 'user',
            status: 'active',
            passwordChangeRequired: true,
            createdAt: '2026-11-10T11:00:00.000Z',
          },
          {
            userId: 'usr-3',
            email: 'disabled@example.com',
            role: 'user',
            status: 'inactive',
            passwordChangeRequired: false,
            createdAt: '2026-11-10T09:00:00.000Z',
          },
        ],
        nextCursor: null,
      })),
      createUser: vi.fn(),
      deactivateUser: vi.fn(),
      reactivateUser: vi.fn(),
      sendPasswordReset: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(AdministrationPanel, {
        client,
        initialUsers: [
          {
            userId: 'usr-1',
            email: 'admin@example.com',
            role: 'super-admin',
            status: 'active',
            passwordChangeRequired: false,
            createdAt: '2026-11-10T10:00:00.000Z',
          },
          {
            userId: 'usr-2',
            email: 'newbie@example.com',
            role: 'user',
            status: 'active',
            passwordChangeRequired: true,
            createdAt: '2026-11-10T11:00:00.000Z',
          },
          {
            userId: 'usr-3',
            email: 'disabled@example.com',
            role: 'user',
            status: 'inactive',
            passwordChangeRequired: false,
            createdAt: '2026-11-10T09:00:00.000Z',
          },
        ],
      }),
    );

    expect(html).toContain('User administration');
    expect(html).toContain('Create user');
    expect(html).toContain('admin@example.com');
    expect(html).toContain('newbie@example.com');
    expect(html).toContain('disabled@example.com');

    // Status badges
    expect(html).toContain('Active');
    expect(html).toContain('Pending password change');
    expect(html).toContain('Inactive');

    // Actions
    expect(html).toContain('Deactivate');
    expect(html).toContain('Reactivate');
    expect(html).toContain('Send reset');
  });

  it('renders CreateUserDialog with email, masked temporary password, and User-only role', () => {
    const html = renderToStaticMarkup(
      createElement(CreateUserDialog, {
        open: true,
        onClose: vi.fn(),
        onCreate: vi.fn(),
      }),
    );

    expect(html).toContain('Create new user');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('Temporary password');
    expect(html).toContain('Role');
    expect(html).toContain('value="user"');
    expect(html).not.toContain('value="super-admin"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/admin-config/administration-panel.test.ts`
Expected: FAIL with missing component modules.

- [ ] **Step 3: Write minimal implementation**

1. Create `frontend/src/features/admin-config/CreateUserDialog.tsx`:
```typescript
/**
 * ============================================================================
 * FILE: CreateUserDialog.tsx
 * LOCATION: frontend/src/features/admin-config/CreateUserDialog.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Accessible modal dialog for Super Admins to provision new User accounts.
 *
 * ROLE IN PROJECT:
 *    Captures email and masked temporary password, restricts the role choice
 *    to 'user' only, and clears the temporary password on submission or exit.
 *
 * KEY COMPONENTS:
 *    - CreateUserDialog: Transient input clearing and creation submission.
 * ============================================================================
 */

import { useState, type FormEvent } from 'react';
import type { CreateUserRequest } from '../../api/administration-protocol.ts';

export type CreateUserDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (request: CreateUserRequest) => Promise<boolean | void>;
  error?: string | null;
  busy?: boolean;
};

export function CreateUserDialog({
  open,
  onClose,
  onCreate,
  error,
  busy = false,
}: CreateUserDialogProps) {
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!open) return null;

  const handleClose = () => {
    setEmail('');
    setTemporaryPassword('');
    setLocalError(null);
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!email.trim() || !temporaryPassword) return;

    if (temporaryPassword.length < 8) {
      setLocalError('Temporary password must be at least 8 characters long.');
      return;
    }

    setLocalBusy(true);
    try {
      const ok = await onCreate({
        email: email.trim().toLowerCase(),
        temporaryPassword,
        role: 'user',
      });
      if (ok !== false) {
        handleClose();
      }
    } finally {
      setLocalBusy(false);
    }
  };

  const isSubmitting = busy || localBusy;
  const activeError = localError || error;

  return (
    <div className="aurvin-dialog-backdrop" onClick={handleClose}>
      <div
        className="aurvin-dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-user-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="create-user-dialog-title" className="aurvin-dialog-title">
          Create new user
        </h2>
        <p className="aurvin-admin-help">
          The user will be required to replace their temporary password on first sign-in.
        </p>

        {activeError ? (
          <div className="aurvin-admin-summary" role="alert">
            <p>{activeError}</p>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="aurvin-dialog-form">
          <div className="aurvin-admin-field">
            <label htmlFor="create-user-email">Email</label>
            <input
              id="create-user-email"
              type="email"
              required
              autoFocus
              value={email}
              disabled={isSubmitting}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="aurvin-admin-field">
            <label htmlFor="create-user-password">Temporary password</label>
            <input
              id="create-user-password"
              type="password"
              required
              minLength={8}
              value={temporaryPassword}
              disabled={isSubmitting}
              onChange={(e) => setTemporaryPassword(e.target.value)}
            />
          </div>

          <div className="aurvin-admin-field">
            <label htmlFor="create-user-role">Role</label>
            <select id="create-user-role" disabled value="user">
              <option value="user">User</option>
            </select>
          </div>

          <div className="aurvin-dialog-buttons">
            <button
              type="button"
              className="aurvin-dialog-cancel"
              disabled={isSubmitting}
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="aurvin-admin-save"
              disabled={isSubmitting || !email.trim() || !temporaryPassword}
            >
              {isSubmitting ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

2. Create `frontend/src/features/admin-config/AdministrationPanel.tsx`:
```typescript
/**
 * ============================================================================
 * FILE: AdministrationPanel.tsx
 * LOCATION: frontend/src/features/admin-config/AdministrationPanel.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    User management view for Super Admins with keyset paging and lifecycle actions.
 *
 * ROLE IN PROJECT:
 *    Renders the accounts table, provides deactivation/reactivation toggles,
 *    triggers mailbox password resets, and opens the creation modal.
 *
 * KEY COMPONENTS:
 *    - AdministrationPanel: Table rendering, pagination, and action dispatch.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import type {
  AdministrationClient,
  AdministrationClientError,
} from '../../api/administration-client.ts';
import type {
  AdministrationUser,
  CreateUserRequest,
} from '../../api/administration-protocol.ts';
import type { AuthUser } from '../../api/auth-protocol.ts';
import { CreateUserDialog } from './CreateUserDialog.tsx';

export type AdministrationPanelProps = {
  client: AdministrationClient;
  currentUser?: AuthUser | null;
  initialUsers?: AdministrationUser[];
  initialCursor?: string | null;
};

export function AdministrationPanel({
  client,
  currentUser,
  initialUsers,
  initialCursor = null,
}: AdministrationPanelProps) {
  const [users, setUsers] = useState<AdministrationUser[]>(() => initialUsers ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (initialUsers) return;
    setLoading(true);
    void client
      .listUsers({ limit: 20 })
      .then((page) => {
        setUsers(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        const errorMsg = (err as AdministrationClientError)?.message ?? 'Could not load users.';
        setError(errorMsg);
      })
      .finally(() => setLoading(false));
  }, [client, initialUsers]);

  const loadMore = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const page = await client.listUsers({ cursor: nextCursor, limit: 20 });
      setUsers((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError('Could not load next page of users.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (req: CreateUserRequest): Promise<boolean> => {
    setDialogError(null);
    try {
      const newUser = await client.createUser(req);
      setUsers((prev) => [newUser, ...prev]);
      setNotice(`User ${newUser.email} created.`);
      return true;
    } catch (err: unknown) {
      const adminErr = err as AdministrationClientError;
      if (adminErr?.code === 'ACCOUNT_CONFLICT') {
        setDialogError('An account with this email address already exists.');
      } else {
        setDialogError('User creation failed. Verify credentials and connectivity.');
      }
      return false;
    }
  };

  const handleDeactivate = async (target: AdministrationUser) => {
    if (!window.confirm(`Deactivate ${target.email}? Active sessions will be terminated.`)) return;
    setActionBusyId(target.userId);
    setError(null);
    try {
      const updated = await client.deactivateUser(target.userId);
      setUsers((prev) => prev.map((u) => (u.userId === updated.userId ? updated : u)));
      setNotice(`User ${target.email} deactivated.`);
    } catch {
      setError(`Could not deactivate user ${target.email}.`);
    } finally {
      setActionBusyId(null);
    }
  };

  const handleReactivate = async (target: AdministrationUser) => {
    setActionBusyId(target.userId);
    setError(null);
    try {
      const updated = await client.reactivateUser(target.userId);
      setUsers((prev) => prev.map((u) => (u.userId === updated.userId ? updated : u)));
      setNotice(`User ${target.email} reactivated.`);
    } catch {
      setError(`Could not reactivate user ${target.email}.`);
    } finally {
      setActionBusyId(null);
    }
  };

  const handlePasswordReset = async (target: AdministrationUser) => {
    setActionBusyId(target.userId);
    setError(null);
    try {
      await client.sendPasswordReset(target.userId);
      setNotice(`Password reset recovery link dispatched to ${target.email}.`);
    } catch {
      setError(`Could not send password reset to ${target.email}.`);
    } finally {
      setActionBusyId(null);
    }
  };

  return (
    <div className="aurvin-admin-panel">
      <div className="aurvin-admin-panel-header">
        <div>
          <h2 className="aurvin-admin-section-title">User administration</h2>
          <p className="aurvin-admin-help">Manage registered accounts and provisional credentials.</p>
        </div>
        <button
          type="button"
          className="aurvin-admin-save"
          onClick={() => {
            setDialogError(null);
            setDialogOpen(true);
          }}
        >
          Create user
        </button>
      </div>

      {notice ? (
        <div className="aurvin-admin-notice" role="status">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="aurvin-admin-summary" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      <div className="aurvin-table-wrap">
        <table className="aurvin-admin-table" aria-label="Users">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((item) => {
              const isCurrentUser = currentUser?.userId === item.userId;
              const isSuperAdmin = item.role === 'super-admin';
              const isBusy = actionBusyId === item.userId;

              let statusBadge = (
                <span className="aurvin-admin-badge aurvin-admin-badge-active">Active</span>
              );
              if (item.status === 'inactive') {
                statusBadge = (
                  <span className="aurvin-admin-badge aurvin-admin-badge-inactive">Inactive</span>
                );
              } else if (item.passwordChangeRequired) {
                statusBadge = (
                  <span className="aurvin-admin-badge aurvin-admin-badge-pending">
                    Pending password change
                  </span>
                );
              }

              return (
                <tr key={item.userId}>
                  <td className="aurvin-table-email">{item.email}</td>
                  <td>{item.role === 'super-admin' ? 'Super Admin' : 'User'}</td>
                  <td>{statusBadge}</td>
                  <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                  <td className="aurvin-table-actions">
                    {isSuperAdmin ? (
                      <span className="aurvin-admin-help">Protected</span>
                    ) : (
                      <>
                        {item.status === 'active' ? (
                          <button
                            type="button"
                            className="aurvin-btn-small aurvin-admin-btn-danger"
                            disabled={isBusy || isCurrentUser}
                            onClick={() => handleDeactivate(item)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="aurvin-btn-small"
                            disabled={isBusy}
                            onClick={() => handleReactivate(item)}
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          type="button"
                          className="aurvin-btn-small"
                          disabled={isBusy}
                          onClick={() => handlePasswordReset(item)}
                        >
                          Send reset
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {nextCursor ? (
        <div className="aurvin-admin-more">
          <button
            type="button"
            className="aurvin-admin-back"
            disabled={loading}
            onClick={loadMore}
          >
            {loading ? 'Loading…' : 'Load more users'}
          </button>
        </div>
      ) : null}

      <CreateUserDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleCreate}
        error={dialogError}
      />
    </div>
  );
}
```

3. In `frontend/src/features/admin-config/AdminDashboard.tsx`:
Mount `AdministrationPanel` inside `${ids}-administration-panel`:
```typescript
import { createAdministrationClient } from '../../api/administration-client.ts';
import { AdministrationPanel } from './AdministrationPanel.tsx';
...
  const [defaultAdministrationClient] = useState(() => createAdministrationClient());
...
          <div
            id={`${ids}-administration-panel`}
            role="tabpanel"
            aria-labelledby={`${ids}-administration-tab`}
            hidden={tab !== 'administration'}
          >
            {tab === 'administration' && !isStandardUser ? (
              <AdministrationPanel
                client={adminClient ?? defaultAdministrationClient}
                currentUser={user}
              />
            ) : null}
          </div>
```

4. In `frontend/src/features/admin-config/admin-config.css`:
Append styling for tables, badges, and modals:
```css
/* User Administration Table & Dialogs */
.aurvin-admin-panel {
  padding: 24px;
}

.aurvin-admin-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.aurvin-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--aurvin-border);
  border-radius: 8px;
  background: var(--aurvin-bg);
}

.aurvin-admin-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 14px;
}

.aurvin-admin-table th,
.aurvin-admin-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--aurvin-border);
}

.aurvin-admin-table th {
  background: var(--aurvin-surface-elevated);
  color: var(--aurvin-text-secondary);
  font-weight: 500;
}

.aurvin-table-email {
  font-weight: 500;
  color: var(--aurvin-text-primary);
}

.aurvin-table-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.aurvin-btn-small {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
  background: var(--aurvin-surface-elevated);
  border: 1px solid var(--aurvin-border);
  color: var(--aurvin-text-primary);
  cursor: pointer;
}

.aurvin-btn-small:hover:not(:disabled) {
  background: var(--aurvin-hover);
}

.aurvin-admin-btn-danger {
  color: var(--aurvin-danger);
  border-color: rgba(248, 113, 113, 0.3);
}

.aurvin-admin-badge {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.aurvin-admin-badge-active {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.aurvin-admin-badge-pending {
  background: rgba(251, 191, 36, 0.15);
  color: var(--aurvin-warning);
}

.aurvin-admin-badge-inactive {
  background: rgba(248, 113, 113, 0.15);
  color: var(--aurvin-danger);
}

.aurvin-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}

.aurvin-dialog-card {
  width: 100%;
  max-width: 440px;
  background: var(--aurvin-surface-elevated);
  border: 1px solid var(--aurvin-border);
  border-radius: 12px;
  padding: 24px;
}

.aurvin-dialog-title {
  margin: 0 0 8px 0;
  font-size: 18px;
  color: var(--aurvin-text-primary);
}

.aurvin-dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}

.aurvin-dialog-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
}

.aurvin-dialog-cancel {
  background: none;
  border: 1px solid var(--aurvin-border);
  color: var(--aurvin-text-primary);
  padding: 8px 16px;
  border-radius: 999px;
  cursor: pointer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/admin-config/administration-panel.test.ts`
Expected: PASS (2 tests passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/admin-config/CreateUserDialog.tsx frontend/src/features/admin-config/AdministrationPanel.tsx frontend/src/features/admin-config/administration-panel.test.ts frontend/src/features/admin-config/AdminDashboard.tsx frontend/src/features/admin-config/admin-config.css
git commit -m "feat(auth): implement Administration table, keyset paging, and user provisioning dialog"
```

---

### Task 9: App Top-Level Auth Shell & Private State Teardown

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`
- Create: `frontend/src/App.auth.test.ts`
- Modify: `frontend/src/App.assembly.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * ============================================================================
 * FILE: App.auth.test.ts
 * LOCATION: frontend/src/App.auth.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Assembly tests verifying the top-level App authentication shell:
 *    switching between login, onboarding, and authenticated chat, with private
 *    state teardown when user changes.
 *
 * ROLE IN PROJECT:
 *    Ensures unauthenticated users never reach ChatProvider, and logging out
 *    unmounts and resets all conversation memory and live voice state.
 *
 * KEY COMPONENTS:
 *    - Unauthenticated state renders LoginForm
 *    - Password-change-required renders MandatoryPasswordChangeForm
 *    - Authenticated state renders ChatProvider keyed by userId
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthClient } from './api/auth-client.ts';
import App from './App.tsx';

vi.mock('./features/voice/dictation/useDictation.ts', () => ({
  useDictation: () => ({
    config: null,
    locked: false,
    phase: 'idle',
    status: '',
    notice: null,
    start: () => undefined,
    stop: () => undefined,
    cancel: () => undefined,
  }),
}));

vi.mock('./features/voice/state/useLiveVoice.ts', () => ({
  useLiveVoice: () => ({
    view: { phase: 'idle', connection: 'disconnected' },
    start: () => undefined,
    toggleMute: () => undefined,
    interrupt: () => undefined,
    exit: () => undefined,
    resume: () => undefined,
  }),
}));

describe('App top-level auth shell', () => {
  it('renders LoginForm when user is unauthenticated', () => {
    const fakeAuthClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(App, {
        authClient: fakeAuthClient,
        initialAuthStatus: 'unauthenticated',
      }),
    );

    expect(html).toContain('Sign in to Aurvin');
    expect(html).not.toContain('Message composer');
  });

  it('renders MandatoryPasswordChangeForm when password change is required', () => {
    const fakeAuthClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(App, {
        authClient: fakeAuthClient,
        initialAuthStatus: 'password-change-required',
        initialAuthUser: {
          userId: 'usr-new',
          email: 'new@example.com',
          role: 'user',
          passwordChangeRequired: true,
        },
      }),
    );

    expect(html).toContain('Set a new private password');
    expect(html).not.toContain('Message composer');
  });

  it('renders chat shell when authenticated', () => {
    const fakeAuthClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(App, {
        authClient: fakeAuthClient,
        initialAuthStatus: 'authenticated',
        initialAuthUser: {
          userId: 'usr-peter',
          email: 'peter@example.com',
          role: 'super-admin',
          passwordChangeRequired: false,
        },
      }),
    );

    expect(html).toContain('Message composer');
    expect(html).toContain('peter@example.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/App.auth.test.ts`
Expected: FAIL because `authClient` and auth props are not wired into `App.tsx`.

- [ ] **Step 3: Update `frontend/src/App.tsx` and `frontend/src/App.css`**

In `frontend/src/App.tsx`:
Replace `App` implementation with top-level auth shell:
1. Wrap shell in `AuthProvider` (accepting `authClient`, `initialAuthUser`, `initialAuthStatus`).
2. Add `AppShell` component:
   - Reads `useAuth()`.
   - Checks query string for `token` or pathname for `/reset-password`.
   - If `token`: renders `ResetPasswordForm`.
   - If `status === 'unauthenticated'`: renders `LoginForm` with toggle to `ForgotPasswordForm`.
   - If `status === 'password-change-required'`: renders `MandatoryPasswordChangeForm`.
   - If `status === 'authenticated'`:
     - Renders `ChatProvider` with `key={user.userId}`!
     - Mounts `VoiceChatShell` with `user`, `adminClient`, `calendarClient`, `administrationClient`, and `onSignOut`.
     - In `onSignOut`: calls `clearAllSubmissionRecovery()`, exits any active live voice, then invokes `auth.logout()`. The key change immediately unmounts the old `ChatProvider`, completely tearing down old sessions, messages, drafts, and voice buffers from memory!

```typescript
/**
 * ============================================================================
 * FILE: App.tsx
 * LOCATION: frontend/src/App.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Mount top-level authentication provider, authenticated ChatProvider shell,
 *    and role-aware navigation.
 *
 * ROLE IN PROJECT:
 *    Switches between unauthenticated auth screens and the authenticated
 *    ChatView shell. Ensures private client state teardown on account change.
 *
 * KEY COMPONENTS:
 *    - App: AuthProvider wrapper.
 *    - AppShell: Route and auth status router.
 *    - VoiceChatShell: Live voice and chat connection.
 * ============================================================================
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { createAdminConfigClient, type AdminConfigClient } from './api/admin-config-client.ts'
import { createAdministrationClient, type AdministrationClient } from './api/administration-client.ts'
import { createAuthClient, type AuthClient } from './api/auth-client.ts'
import type { AuthStatus, AuthUser } from './api/auth-protocol.ts'
import { createCalendarClient, type CalendarClient } from './api/calendar-client.ts'
import {
  extractAndScrubCalendarOAuthCallback,
  type CalendarOAuthCallbackOutcome,
} from './api/calendar-protocol.ts'
import { clearAllSubmissionRecovery } from './api/client.ts'
import { AdminDashboard, type DashboardSection } from './features/admin-config/AdminDashboard.tsx'
import {
  AuthProvider,
  ForgotPasswordForm,
  LoginForm,
  MandatoryPasswordChangeForm,
  ResetPasswordForm,
  useAuth,
} from './features/auth/index.ts'
import { ChatProvider, ChatView, type ApiClient } from './features/chat/index.ts'
import { useChat } from './features/chat/state/chat-context.tsx'
import type { VoiceSaveSnapshot } from './api/voice-protocol.ts'
import { refreshVoiceCapabilities } from './features/voice/index.ts'
import { useLiveVoice } from './features/voice/state/useLiveVoice.ts'
import './App.css'

export function bindLiveConversation(
  actions: {
    bindVoiceConversation?: (
      token: string,
      conversationId: string,
      meta?: { turnId: string; save: VoiceSaveSnapshot },
    ) => boolean
  } | Record<string, unknown>,
  token: string,
  conversationId: string,
  meta?: { turnId: string; save: VoiceSaveSnapshot },
) {
  const fn = (actions as {
    bindVoiceConversation?: (
      token: string,
      conversationId: string,
      meta?: { turnId: string; save: VoiceSaveSnapshot },
    ) => boolean
  }).bindVoiceConversation
  return (meta ? fn?.(token, conversationId, meta) : fn?.(token, conversationId)) ?? false
}

export function registerVoiceStart(ref: { current: (() => void) | null }, start: () => void) {
  ref.current = start
  return () => { if (ref.current === start) ref.current = null }
}

function readInitialOAuthCallback(): CalendarOAuthCallbackOutcome | null {
  if (typeof window === 'undefined') return null
  const result = extractAndScrubCalendarOAuthCallback(window.location.href)
  if (result.hadSensitiveParams && typeof window.history?.replaceState === 'function') {
    window.history.replaceState(null, '', result.scrubbedPathAndSearch)
  }
  return result.outcome
}

function readInitialResetToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('token')
  } catch {
    return null
  }
}

function VoiceChatShell({
  user,
  onSignOut,
  startRef,
  adminClient,
  calendarClient,
  administrationClient,
  refreshCapabilities,
}: {
  user: AuthUser
  onSignOut: () => void
  startRef: MutableRefObject<(() => void) | null>
  adminClient: AdminConfigClient
  calendarClient: CalendarClient
  administrationClient: AdministrationClient
  refreshCapabilities: () => Promise<boolean>
}) {
  const { state, actions, dispatch } = useChat()
  const [oauthOutcome, setOauthOutcome] = useState<CalendarOAuthCallbackOutcome | null>(() =>
    readInitialOAuthCallback(),
  )
  const [page, setPage] = useState<'chat' | 'admin'>(() =>
    oauthOutcome !== null ? 'admin' : 'chat',
  )
  const [adminSection, setAdminSection] = useState<DashboardSection>(() =>
    oauthOutcome !== null ? 'calendar' : (user.role === 'user' ? 'calendar' : 'openrouter'),
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const result = extractAndScrubCalendarOAuthCallback(window.location.href)
    if (result.hadSensitiveParams && typeof window.history?.replaceState === 'function') {
      window.history.replaceState(null, '', result.scrubbedPathAndSearch)
    }
    if (result.outcome !== null) {
      setOauthOutcome(result.outcome)
      setAdminSection('calendar')
      setPage('admin')
    }
  }, [])

  const voice = useLiveVoice({
    conversationId: state.activeSessionId,
    draft: state.draftInput,
    bindings: {
      claimVoiceInput: (mode, onClose) => actions.claimVoiceInput(mode, onClose),
      writeVoiceDraft: (token, text) => actions.writeVoiceDraft(token, text),
      releaseVoiceInput: (token) => actions.releaseVoiceInput(token),
      bindVoiceConversation: (token, id, meta) =>
        meta ? bindLiveConversation(actions, token, id, meta) : bindLiveConversation(actions, token, id),
      refreshSessions: (
        conversationId?: string,
        voiceSession?: { voiceSessionId: string; durationSeconds: number; startedAt: string },
      ) => {
        void actions.loadSessions()
        const target = conversationId || state.activeSessionId
        if (target && voiceSession) {
          actions.commitVoiceSession({
            sessionId: target,
            voiceSessionId: voiceSession.voiceSessionId,
            durationSeconds: voiceSession.durationSeconds,
            createdAt: voiceSession.startedAt,
          })
        }
        if (target) {
          void actions.reloadMessages(target)
        }
      },
      openCanvasArtifact: (artifactId) =>
        dispatch({ type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId } }),
    },
  })
  useLayoutEffect(() => registerVoiceStart(startRef, voice.start), [startRef, voice.start])
  const chatActive = state.isStreaming || state.isSubmitting || state.voiceInput !== null
  return (
    <>
      <div className="aurvin-chat-surface" hidden={page !== 'chat'} inert={page !== 'chat'}>
        <ChatView
          liveVoice={voice}
          visible={page === 'chat'}
          user={user}
          onSignOut={onSignOut}
          onManageAurvin={() => {
            dispatch({ type: 'CLOSE_SIDEBAR' })
            setAdminSection(user.role === 'user' ? 'calendar' : 'openrouter')
            setPage('admin')
          }}
          onOpenCalendarSetup={() => {
            dispatch({ type: 'CLOSE_SIDEBAR' })
            setAdminSection('calendar')
            setPage('admin')
          }}
        />
      </div>
      {page === 'admin' ? (
        <AdminDashboard
          client={adminClient}
          calendarClient={calendarClient}
          adminClient={administrationClient}
          user={user}
          initialSection={adminSection}
          oauthOutcome={oauthOutcome}
          onDismissOAuthOutcome={() => setOauthOutcome(null)}
          refreshCapabilities={refreshCapabilities}
          chatActive={chatActive}
          onBackToChat={() => setPage('chat')}
        />
      ) : null}
    </>
  )
}

function AppShell({
  client,
  adminClient,
  calendarClient,
  administrationClient,
  refreshCapabilities,
}: {
  client?: ApiClient
  adminClient?: AdminConfigClient
  calendarClient?: CalendarClient
  administrationClient?: AdministrationClient
  refreshCapabilities?: () => Promise<boolean>
}) {
  const auth = useAuth()
  const [resetToken, setResetToken] = useState<string | null>(() => readInitialResetToken())
  const [showForgot, setShowForgot] = useState(false)
  const startRef = useRef<(() => void) | null>(null)
  const startVoiceConversation = useCallback(() => { startRef.current?.() }, [])
  const [defaultAdminClient] = useState(() => createAdminConfigClient())
  const [defaultCalendarClient] = useState(() => createCalendarClient())
  const [defaultAdministrationClient] = useState(() => createAdministrationClient())

  const handleSignOut = useCallback(() => {
    clearAllSubmissionRecovery()
    void auth.logout()
  }, [auth])

  if (resetToken) {
    return (
      <ResetPasswordForm
        token={resetToken}
        onSubmit={async (req) => {
          await auth.client.resetPassword(req)
          setResetToken(null)
          if (typeof window !== 'undefined' && typeof window.history?.replaceState === 'function') {
            window.history.replaceState(null, '', window.location.pathname)
          }
        }}
        error={auth.error}
      />
    )
  }

  if (auth.status === 'loading') {
    return <div className="aurvin-auth-loading">Loading Aurvin…</div>
  }

  if (auth.status === 'unauthenticated') {
    if (showForgot) {
      return (
        <ForgotPasswordForm
          onSubmit={async (req) => {
            await auth.client.forgotPassword(req)
          }}
          onBackToLogin={() => setShowForgot(false)}
          error={auth.error}
        />
      )
    }
    return (
      <LoginForm
        onSubmit={async (credentials) => {
          await auth.login(credentials)
        }}
        onForgotPassword={() => setShowForgot(true)}
        error={auth.error}
      />
    )
  }

  if (auth.status === 'password-change-required' || auth.user?.passwordChangeRequired) {
    return (
      <MandatoryPasswordChangeForm
        onSubmit={async (req) => {
          await auth.changePassword(req)
        }}
        onSignOut={handleSignOut}
        error={auth.error}
      />
    )
  }

  if (!auth.user) {
    return <div className="aurvin-auth-loading">Loading Aurvin…</div>
  }

  return (
    <ChatProvider
      key={auth.user.userId}
      client={client}
      startVoiceConversation={startVoiceConversation}
    >
      <VoiceChatShell
        user={auth.user}
        onSignOut={handleSignOut}
        startRef={startRef}
        adminClient={adminClient ?? defaultAdminClient}
        calendarClient={calendarClient ?? defaultCalendarClient}
        administrationClient={administrationClient ?? defaultAdministrationClient}
        refreshCapabilities={refreshCapabilities ?? refreshVoiceCapabilities}
      />
    </ChatProvider>
  )
}

function App({
  client,
  adminClient,
  calendarClient,
  administrationClient,
  authClient,
  initialAuthUser,
  initialAuthStatus,
  refreshCapabilities,
}: {
  client?: ApiClient
  adminClient?: AdminConfigClient
  calendarClient?: CalendarClient
  administrationClient?: AdministrationClient
  authClient?: AuthClient
  initialAuthUser?: AuthUser | null
  initialAuthStatus?: AuthStatus
  refreshCapabilities?: () => Promise<boolean>
} = {}) {
  return (
    <AuthProvider
      client={authClient}
      initialUser={initialAuthUser}
      initialStatus={initialAuthStatus}
    >
      <AppShell
        client={client}
        adminClient={adminClient}
        calendarClient={calendarClient}
        administrationClient={administrationClient}
        refreshCapabilities={refreshCapabilities}
      />
    </AuthProvider>
  )
}

export default App
```

In `frontend/src/App.css`:
Add:
```css
.aurvin-auth-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100svh;
  font-size: 15px;
  color: var(--aurvin-text-secondary);
}
```

In `frontend/src/App.assembly.test.ts`:
Update test to pass `initialAuthStatus: 'authenticated'` and an `initialAuthUser` when rendering `App` for the composer check.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/App.auth.test.ts src/App.assembly.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.css frontend/src/App.auth.test.ts frontend/src/App.assembly.test.ts
git commit -m "feat(auth): mount top-level AuthProvider with private state teardown and route gating"
```

---

### Task 10: Full Frontend Verification & Export Alignment

**Files:**
- Output plan: `docs/workos-authentication/plan4.md`

- [ ] **Step 1: Run frontend production build**

Run: `cd frontend && npm run build`
Expected: `tsc -b && vite build` completes with 0 errors.

- [ ] **Step 2: Run frontend linter**

Run: `cd frontend && npm run lint`
Expected: `oxlint` passes with 0 errors.

- [ ] **Step 3: Run full frontend test suite**

Run: `cd frontend && npm test`
Expected: All tests pass, zero regressions against existing tests.

- [ ] **Step 4: Verify git status is clean of unintended files**

Run: `git status --short`
Verify that NONE of the 8 preserved dirty files were touched:
- `backend/src/chat-runtime/durable-chat-runtime.ts`
- `backend/src/persistence/sessions.ts`
- `backend/test/persistence/voice-messages.native.e2e-spec.ts`
- `backend/test/persistence/voice-messages.spec.ts`
- `backend/test/runtime/voice-acceptance.native.e2e-spec.ts`
- `frontend/src/features/chat/state/chat-reducer.ts`
- `frontend/src/features/chat/state/memory-save-state.test.ts`
- `frontend/src/features/chat/state/voice-draft-lock.test.ts`

- [ ] **Step 5: Commit implementation plan**

```bash
git add docs/workos-authentication/plan4.md
git commit -m "docs(workos-authentication): plan 4 - custom auth UI and role-aware settings"
```

---

### Self-Review Checklist

1. **Spec Coverage:**
   - [x] Custom login, mandatory temporary password change, forgot password, reset password.
   - [x] `credentials: 'same-origin'` with zero bearer tokens in browser memory/storage.
   - [x] Private state teardown: `clearAllSubmissionRecovery()` and `ChatProvider` unmount on logout / user switch.
   - [x] Role-aware settings: standard Users see Plugins only and do not fetch `/admin/config`; Super Admins see all 4 tabs.
   - [x] Administration tab: Users table with keyset paging, status badges, create user modal, deactivate/reactivate and password reset actions.
   - [x] ProfileMenu: email and role display with operable Sign out button.

2. **No Placeholders:**
   - All steps contain exact, complete TypeScript/TSX code and runnable test commands. No "TBD" or "TODO".

3. **Dirty File Preservation:**
   - The 8 dirty files remain untouched and unstaged.
