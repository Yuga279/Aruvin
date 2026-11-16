# User Administration Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Super-Admin-only account listing, User provisioning, deactivation/reactivation and mailbox password recovery without exposing credentials or another user's private data.

**Architecture:** Compose an independently testable Administration module around the existing `UsersRepository`, P1 access helpers and narrow `AuthProvider` port. The service reloads the administrator's current local account, delegates keyset paging to `MongoUsers`, confirms local lifecycle writes with CAS, and sends only an internal user ID to P3's deactivation hook. P3 supplies request-scoped principals and the already-owned persistence/provider instances; P2 does not install global authentication or construct infrastructure.

**Tech Stack:** Existing NestJS 12, TypeScript/NodeNext ESM, Zod 3, MongoUsers/RecordStore, WorkOS adapter, Vitest and Supertest; no new dependency.

---

## 0. Inputs, ownership and execution rules

- Read [goal.md](goal.md), [research.md](research.md) and the P2/dependency sections of [state.md](state.md). P1 worker is complete at `d72f75f..ef9dc46`; implementation requires this committed plan plus that foundation, not merely a P1 plan.
- This document is a plan, not implementation or verification evidence. All checkboxes below start unchecked. Unified review remains **skipped**; do not dispatch a reviewer. Self-checking the plan and running regression tests are not a unified review.
- The actual P1 paths are `backend/src/auth/access.ts` and `backend/src/auth/provider.ts`, **not** `auth/helpers/account-access.ts` or `auth/provider/workos-provider-adapter.ts`. Actual provider methods are `createUser`, `sendRecovery`, `revoke`, `listSessions`; do not invent `createPasswordReset`/`revokeSession` methods on the Aurvin port.
- Read, but do not edit, `backend/src/contracts/{auth,administration}.ts`, `backend/src/persistence/users.ts`, `backend/src/auth/**`. Never edit root `backend/src/{app.module,app.service,main}.ts`, package manifests/lockfiles, frontend source, state or another plan. Request upstream changes through the orchestrator rather than expanding ownership.
- Preserve these eight baseline modifications completely, including staging: `backend/src/chat-runtime/durable-chat-runtime.ts`, `backend/src/persistence/sessions.ts`, `backend/test/persistence/voice-messages.native.e2e-spec.ts`, `backend/test/persistence/voice-messages.spec.ts`, `backend/test/runtime/voice-acceptance.native.e2e-spec.ts`, `frontend/src/features/chat/state/chat-reducer.ts`, `frontend/src/features/chat/state/memory-save-state.test.ts`, `frontend/src/features/chat/state/voice-draft-lock.test.ts`. Preserve `.env`, `.openchamber/`, other agents' files and intervening user changes.
- Run `git status --short` and `git diff --cached --name-only` before starting and before committing. Coordinate the shared-index commit slot with the orchestrator. If unrelated files are staged, wait; do not unstage them or include them in your commit. Every staging command below names only the task's files.
- Use the available `executing-plans` and `test-driven-development` skills. This assigned P2 worker can execute its own plan directly; it must not create another orchestration layer or dispatch agents without coordination. The header's `superpowers:` wording names the writing-plans template, not an installed skill namespace.
- Every new `.ts` file must have the full file header shown in its creation block. For later additions to that file retain its header; append test blocks after imports/tests, and insert implementation blocks at the stated class location. All local imports end in `.js`.
- Commands beginning `npm` below run in **`backend/`**. Git commands run at repository root. A RED run must discover the named test and fail on the missing behavior/import, not on missing dependencies. If dependencies are unavailable, report the blocker; do not install or replace lockfiles during planning.
- Each numbered step is a separate approximately 2–5 minute action. Long task test blocks are several small independent cases: add/run one case at a time, then add the next; do not write production behavior before observing its corresponding RED assertion. Commit only at the task's final step.

## File map (only these production/test files)

| Path | Responsibility |
| --- | --- |
| `backend/src/administration/errors.ts` | Closed safe account faults and normalization of P1/schema/storage faults. |
| `backend/src/administration/administration.service.ts` | Current-admin authorization, safe projections, bounded list, provisioning and lifecycle/recovery orchestration. |
| `backend/src/administration/administration.controller.ts` | Five HTTP routes, request-principal callback and safe exception filter. |
| `backend/src/administration/administration.module.ts` | Register the existing service and a request-scoped principal reader; no connection/runtime owner. |
| `backend/src/administration/configure-administration-http.ts` | Route-local origin/transport/cache/4-KiB parser protections before global parsers. |
| `backend/test/administration/fixtures.ts` | Reuse P1 account/provider/RecordStore fixtures, real MongoUsers, deterministic IDs/time. |
| `backend/test/administration/errors.spec.ts` | Closed fault statuses, retry policy and redaction. |
| `backend/test/administration/list.spec.ts` | Permissions, current-account reload, safe paging/cursor behavior. |
| `backend/test/administration/create.spec.ts` | Valid normalized User-only provisioning and strict request boundaries. |
| `backend/test/administration/create-failures.spec.ts` | Duplicates, mismatched provider identity and partial/unknown outcomes. |
| `backend/test/administration/lifecycle.spec.ts` | User-only confirmed lifecycle CAS, stale-cookie invalidation and no resurrection. |
| `backend/test/administration/deactivation.spec.ts` | Internal hook and bounded best-effort provider cleanup. |
| `backend/test/administration/recovery.spec.ts` | Recorded-mailbox reset, recovery throttling and secret-free failures. |
| `backend/test/administration/http-fixture.ts` | Administration-only Nest app with deterministic principal reader. |
| `backend/test/administration/http.spec.ts` | Real routes/statuses, validation, denial and safe response/error serialization. |
| `backend/test/administration/ingress.spec.ts` | Exact-origin/TLS/cache/body-size/body-deadline regression fixtures. |

No barrel, event bus, DTO class hierarchy, permission framework, new repository or provisioning saga is needed.

## Frozen interfaces and decisions for P3/P4

```ts
// Defined in Tasks 2, 6 and 8; this is the final integration surface.
type AdministrationProvider = Pick<AuthProvider,
  'createUser' | 'sendRecovery' | 'revoke' | 'listSessions'>;
type AdministrationServiceOptions = {
  users: UsersRepository;
  provider: AdministrationProvider | null;
  now?: () => Date;
  newUserId?: () => string; // Default randomUUID; deterministic fixture seam only.
  onUserDeactivated?: (userId: string) => void | Promise<void>;
};
// All methods receive a trusted server principal, never a body/header owner ID.
// list(principal, query): Promise<AdministrationPage>
// create(principal, body): Promise<AdministrationUserResponse>
// deactivate/reactivate(principal, userId, body): Promise<AdministrationUserResponse>
// passwordReset(principal, userId, body): Promise<void>
type AdministrationModuleOptions = {
  service: AdministrationService;
  principal: () => AuthPrincipal | null; // Read P3's request context on each call.
};
// AdministrationModule.register(options)
// configureAdministrationHttp(app, {
//   bootstrap, trustedHttpsIngress: (request: Request) => boolean,
// })
```

| Method/path (global `/api` prefix supplied by caller) | Request | Success |
| --- | --- | --- |
| `GET /admin/users` | `limit` default 20, integer 1–50; optional opaque `cursor` ≤512 chars, no other keys | 200 `{ items, nextCursor }` |
| `POST /admin/users` | Exact `{ email, temporaryPassword, role: 'user' }` | 201 `{ user }` |
| `POST /admin/users/:userId/deactivate` | JSON `{}`, no query | 200 `{ user }` |
| `POST /admin/users/:userId/reactivate` | JSON `{}`, no query | 200 `{ user }` |
| `POST /admin/users/:userId/password-reset` | JSON `{}`, no query | 204, no body |

- Every route: anonymous 401, current fully authenticated ordinary User 403, onboarding principal 403 `PASSWORD_CHANGE_REQUIRED`. Reload the actor row and use `admitAccount` plus `requireSuperAdmin`; neither a stale principal snapshot nor browser role/identity can authorize a call.
- Project exactly `{ userId, email, role, status, passwordChangeRequired, createdAt }`. No provider subject, SID, revision, epoch, credentials, private activity or provider payload reaches the wire.
- `MongoUsers.list` already sorts by `(createdAt DESC, userId DESC)`, queries `limit + 1`, validates canonical base64url tuple cursors and bounds query time. Pass its cursor through unchanged; do not add offsets, a second encoding or a signing key. Opaque is not encrypted or an authorization credential. Administrators can already see the cursor's ordering keys.
- Create once: normalize email with P1 schema; reject local duplicate before WorkOS; generate internal ID on server; call `createUser({ email, password: temporaryPassword, externalId: userId })`. P1 sets `emailVerified: true`. Confirm returned subject/email/externalId before insertion. Insert only an active `user` with `passwordChangeRequired: true`, null SID, epoch zero. No automatic adoption, `getUser` by email, credential replacement, compensation-delete or automatic retry.
- Creation timeout/provider-unavailable/unknown response, mismatched returned mapping or any unconfirmed local insertion: 503 `ACCOUNT_PROVISIONING_INCOMPLETE`, **retryable false**. The UI can say operator reconciliation is required; do not encourage automatic retry. Known duplicate: 409 `ACCOUNT_CONFLICT`. Known provider invalid-request/rate-limit rejection retains P1's safe fault. A browser retry may receive conflict; it never adopts or overwrites that identity.
- Lifecycle targets are `role: 'user'` only, never the caller or a Super Admin, including password-reset. Missing target: 404 `ACCOUNT_NOT_FOUND`. CAS conflict: 409 `ACCOUNT_CONFLICT`; uncertain/thrown mutation: 503 `ACCOUNT_WRITE_UNCERTAIN`, retryable false. Never announce success, invoke hooks or call provider lifecycle work before confirmed local mutation.
- Deactivation first durably sets inactive, clears SID and increments epoch with `invalidateAccount`. After confirmation notify P3 and best-effort revoke provider sessions. Cleanup failure does **not** roll back a confirmed inactive row or turn that row into an unconfirmed result. P3's hook uses existing cancellation/socket-close mechanisms for that user; P2 never reads chats/plugins or imports AppService. Work may finish or incur charges; do not promise instant external-token revocation.
- Repeating deactivate on an already inactive/null-SID account does not bump epoch, but retries the bounded cleanup hook/revocation (covers a process failure after local commit). Reactivate changes inactive to active with SID still null; preserves epoch and onboarding flag; old cookies and old work are not revived. Repeating reactivate on an already active User is a no-op, not a forced logout.
- Cleanup: one shared 10-second waiting/dequeue budget; at most three provider pages of 100 IDs plus the known SID, no unbounded auto-pagination. Stop on repeated cursor, cap, deadline or failure. Invoke hook independently of provider success; pass only internal user ID. Errors are discarded without logging raw objects. These are local single-process bounds, not a durable event-delivery guarantee; repeat deactivation/operator intervention is acceptable.
- Reset **send** only calls `sendRecovery(recordedEmail)`; does not change SID/epoch/status/password gate. Credential completion/invalidation belongs to P1. Same 3/60s per-email recovery and 60/60s global operation limiter mechanisms as P1; separate Administration instance, no claim of a shared cross-route distributed quota. WorkOS adapter already bounds each call to 10s/four outstanding operations/no SDK retries. No real email is sent in routine tests.
- P3 imports the real module and installs `configureAdministrationHttp` before global JSON parsing, after any ingress trust setup. P3 authenticates the request once and exposes its principal via request context. A plain application-wide mutable `principal` variable is forbidden (the test helper uses one only inside an isolated, sequential fixture).

## Task 1: Closed Administration faults (smallest prerequisite)

**Files:** Create `backend/src/administration/errors.ts`; create `backend/test/administration/errors.spec.ts`.

- [ ] **Step 1 — Write this failing test file.**

```ts
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
```

- [ ] **Step 2 — RED:** `npm test -- test/administration/errors.spec.ts`. Expected: discovered suite fails because `administration/errors.js` does not exist.
- [ ] **Step 3 — Create the minimal implementation.**

```ts
/**
 * ============================================================================
 * FILE: errors.ts
 * LOCATION: backend/src/administration/errors.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Map Administration errors to closed, secret-free HTTP responses.
 *
 * ROLE IN PROJECT:
 *    Shares P1 auth faults without reflecting provider exceptions.
 *    Gives services and HTTP filters one bounded failure vocabulary.
 *
 * KEY COMPONENTS:
 *    - AdministrationFault and safeAdministrationFault.
 * ============================================================================
 */
import { ZodError } from 'zod';
import type { AdministrationErrorCode, AdministrationErrorResponse } from '../contracts/administration.js';
import type { AuthErrorCode } from '../contracts/auth.js';
import { AuthFault } from '../auth/errors.js';
import { AppError } from '../platform/errors/app-error.js';

type AccountFaultCode = Exclude<AdministrationErrorCode, AuthErrorCode>;
const statuses: Record<AccountFaultCode, number> = {
  ACCOUNT_CONFLICT: 409, ACCOUNT_NOT_FOUND: 404,
  ACCOUNT_WRITE_UNCERTAIN: 503, ACCOUNT_PROVISIONING_INCOMPLETE: 503,
};
export class AdministrationFault extends Error {
  constructor(readonly code: AccountFaultCode) { super(code); }
  get status() { return statuses[this.code]; }
  body(): AdministrationErrorResponse { return { error: { code: this.code, retryable: false } }; }
}
export function safeAdministrationFault(error: unknown): AdministrationFault | AuthFault {
  if (error instanceof AdministrationFault || error instanceof AuthFault) return error;
  if (error instanceof ZodError || (error instanceof AppError && error.code === 'INVALID_REQUEST'))
    return new AuthFault('INVALID_REQUEST');
  return new AuthFault('NOT_READY');
}
```

- [ ] **Step 4 — GREEN:** `npm test -- test/administration/errors.spec.ts`; expect 5 passing cases, no skipped tests.
- [ ] **Step 5 — Commit at the shared commit slot.**

```bash
git add backend/src/administration/errors.ts backend/test/administration/errors.spec.ts
git commit -m "feat(administration): add closed account faults"
```

## Task 2: Current-admin authorization, safe rows and existing keyset paging

**Files:** Create `backend/src/administration/administration.service.ts`, `backend/test/administration/fixtures.ts`, `backend/test/administration/list.spec.ts`.

- [ ] **Step 1 — Create the shared deterministic fixture.** Reuse P1's real MongoUsers fixture rather than writing another users store.

```ts
/**
 * ============================================================================
 * FILE: fixtures.ts
 * LOCATION: backend/test/administration/fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compose deterministic Administration tests around real MongoUsers.
 *
 * ROLE IN PROJECT:
 *    Reuses P1 account/provider/RecordStore fixtures without network calls.
 *    Supplies isolated account state and deterministic service seams.
 *
 * KEY COMPONENTS:
 *    - administrationFixture with admin and ordinary User principals.
 * ============================================================================
 */
import { admitAccount } from '../../src/auth/access.js';
import { AdministrationService, type AdministrationServiceOptions } from '../../src/administration/administration.service.js';
import { MongoUsers } from '../../src/persistence/users.js';
import { account, at, providerFixture } from '../auth/fixtures.js';
import { usersStore } from '../persistence/auth-users-fixture.js';

export async function administrationFixture(overrides: Partial<AdministrationServiceOptions> = {}) {
  const storage = usersStore();
  const users = new MongoUsers(storage.store, storage.owner, 8192);
  const adminAccount = account({ userId: 'admin', workosUserId: 'user_admin',
    emailNormalized: 'admin@example.com', role: 'super-admin',
    passwordChangeRequired: false, currentWorkosSessionId: 'sid_admin' });
  const target = account({ passwordChangeRequired: false, currentWorkosSessionId: 'sid_1' });
  await users.insert(adminAccount); await users.insert(target);
  const provider = providerFixture();
  const options: AdministrationServiceOptions = { users, provider,
    now: () => new Date(at), newUserId: () => 'u_created', ...overrides };
  return { ...storage, users, provider, options, service: new AdministrationService(options),
    admin: admitAccount(adminAccount, 'sid_admin'), regular: admitAccount(target, 'sid_1') };
}
```

- [ ] **Step 2 — Write the failing list tests.**

```ts
/**
 * ============================================================================
 * FILE: list.spec.ts
 * LOCATION: backend/test/administration/list.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify current-role admission, safe rows and bounded keyset pages.
 *
 * ROLE IN PROJECT:
 *    Exercises service authorization against real fixture CAS.
 *    Checks that repository paging remains the sole ordering mechanism.
 *
 * KEY COMPONENTS:
 *    - Denials, projection, limit and cursor regression cases.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { isAdministrationPage } from '../../src/contracts/administration.js';
import { account } from '../auth/fixtures.js';
import { administrationFixture } from './fixtures.js';

it('denies anonymous, ordinary User and onboarding access before listing', async () => {
  const f = await administrationFixture();
  await expect(f.service.list(null, {})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(f.service.list(f.regular, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const current = (await f.users.get('admin'))!;
  await f.users.compareAndSwap(current, { ...current.account, passwordChangeRequired: true });
  await expect(f.service.list(f.admin, {})).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  expect(f.collection.find).not.toHaveBeenCalled();
});
it('reloads current local admission instead of trusting a stale admin snapshot', async () => {
  const f = await administrationFixture(); const current = (await f.users.get('admin'))!;
  await f.users.compareAndSwap(current, { ...current.account, status: 'inactive', currentWorkosSessionId: null });
  await expect(f.service.list(f.admin, {})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(f.collection.find).not.toHaveBeenCalled();
});
it('returns exactly six public fields and preserves stable opaque keyset ordering', async () => {
  const f = await administrationFixture();
  for (const n of [2, 3]) await f.users.insert(account({ userId: `u${n}`, workosUserId: `user_${n}`,
    emailNormalized: `u${n}@example.com` }));
  const first = await f.service.list(f.admin, { limit: '2' });
  expect(isAdministrationPage(first)).toBe(true);
  expect(first.items.map(x => x.userId)).toEqual(['u3', 'u2']);
  expect(Object.keys(first.items[0]!).sort()).toEqual(
    ['createdAt', 'email', 'passwordChangeRequired', 'role', 'status', 'userId']);
  const last = await f.service.list(f.admin, { limit: '2', cursor: first.nextCursor });
  expect(last.items.map(x => x.userId)).toEqual(['u1', 'admin']);
  expect(last.nextCursor).toBeNull();
  for (const forbidden of ['workosUserId', 'currentWorkosSessionId', 'sessionEpoch', 'revision'])
    expect(JSON.stringify(first)).not.toContain(forbidden);
});
it('uses default 20, maximum 50, and rejects malformed queries and cursors', async () => {
  const f = await administrationFixture();
  for (let n = 2; n <= 52; n++) await f.users.insert(account({ userId: `u${n}`,
    workosUserId: `user_${n}`, emailNormalized: `u${n}@example.com` }));
  expect((await f.service.list(f.admin, {})).items).toHaveLength(20);
  expect((await f.service.list(f.admin, { limit: '50' })).items).toHaveLength(50);
  for (const query of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { limit: 'NaN' },
    { limit: ['1', '2'] }, { cursor: '' }, { cursor: 'x'.repeat(513) }, { cursor: 'not-json' },
    { cursor: Buffer.from(JSON.stringify(['bad-date', 'u1'])).toString('base64url') }, { userId: 'victim' }])
    await expect(f.service.list(f.admin, query)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});
```

- [ ] **Step 3 — RED:** `npm test -- test/administration/list.spec.ts`; expect missing service import failure. After the class exists, run each newly added case with `-t` and observe any unsatisfied behavior before changing it.
- [ ] **Step 4 — Create the service foundation.** `requireAdmin` is shared by every later operation, so later direct service callers cannot bypass authorization.

```ts
/**
 * ============================================================================
 * FILE: administration.service.ts
 * LOCATION: backend/src/administration/administration.service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Implement Super-Admin-only account administration without credential storage.
 *
 * ROLE IN PROJECT:
 *    Reuses admitted persistence and P1 auth/provider boundaries.
 *    Exposes a narrow deactivation callback for P3's existing runtime owner.
 *
 * KEY COMPONENTS:
 *    - Current-admin checks, safe rows and bounded lifecycle methods.
 * ============================================================================
 */
import { randomUUID } from 'node:crypto';
import { administrationPageQuerySchema, type AdministrationPage,
  type AdministrationUser } from '../contracts/administration.js';
import type { AuthPrincipal, UserAccount, UsersRepository } from '../contracts/auth.js';
import { admitAccount, publicUser, requireSuperAdmin } from '../auth/access.js';
import { AttemptLimiter } from '../auth/attempt-limiter.js';
import { AuthFault } from '../auth/errors.js';
import type { AuthProvider } from '../auth/provider.js';
import { safeAdministrationFault } from './errors.js';

export type AdministrationProvider = Pick<AuthProvider, 'createUser' | 'sendRecovery' | 'revoke' | 'listSessions'>;
export type AdministrationServiceOptions = {
  users: UsersRepository; provider: AdministrationProvider | null;
  now?: () => Date; newUserId?: () => string;
};
function row(account: Readonly<UserAccount>): AdministrationUser {
  return { ...publicUser(account), status: account.status, createdAt: account.createdAt };
}
export class AdministrationService {
  private readonly limiter: AttemptLimiter;
  constructor(private readonly o: AdministrationServiceOptions) {
    this.limiter = new AttemptLimiter(() => this.now().getTime());
  }
  private now(): Date { return (this.o.now ?? (() => new Date()))(); }
  private newUserId(): string { return (this.o.newUserId ?? randomUUID)(); }
  private provider(): AdministrationProvider {
    if (!this.o.provider) throw new AuthFault('NOT_READY'); return this.o.provider;
  }
  private async requireAdmin(principal: AuthPrincipal | null): Promise<AuthPrincipal> {
    if (!principal) throw new AuthFault('UNAUTHENTICATED');
    const current = await this.o.users.get(principal.account.userId);
    const admitted = requireSuperAdmin(admitAccount(current?.account ?? null, principal.sessionId));
    this.limiter.takeGlobal(); return admitted;
  }
  async list(principal: AuthPrincipal | null, query: unknown): Promise<AdministrationPage> {
    await this.requireAdmin(principal);
    const request = administrationPageQuerySchema.safeParse(query);
    if (!request.success) throw new AuthFault('INVALID_REQUEST');
    try {
      const page = await this.o.users.list({ ...request.data, limit: request.data.limit ?? 20 });
      return { items: page.items.map(value => row(value.account)), nextCursor: page.nextCursor };
    } catch (error) { throw safeAdministrationFault(error); }
  }
}
```

- [ ] **Step 5 — GREEN:** `npm test -- test/administration/list.spec.ts`; expect four passing tests. `npm run build` checks NodeNext/types; unused private `newUserId`/`provider` are consumed in Task 3 before the package lint gate.
- [ ] **Step 6 — Commit.**

```bash
git add backend/src/administration/administration.service.ts backend/test/administration/fixtures.ts backend/test/administration/list.spec.ts
git commit -m "feat(administration): authorize and page safe account rows"
```

## Task 3: Strict User-only provisioning happy path

**Files:** Modify `backend/src/administration/administration.service.ts`; create `backend/test/administration/create.spec.ts`.

- [ ] **Step 1 — Write the failing tests.**

```ts
/**
 * ============================================================================
 * FILE: create.spec.ts
 * LOCATION: backend/test/administration/create.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify strict User-only provisioning and transient passwords.
 *
 * ROLE IN PROJECT:
 *    Proves provider-confirmed creation precedes safe local state.
 *    Keeps credential fields outside persisted records and response rows.
 *
 * KEY COMPONENTS:
 *    - Normalization, external ID, onboarding flag and input denials.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { isAdministrationUserResponse } from '../../src/contracts/administration.js';
import { administrationFixture } from './fixtures.js';

it('creates one server-owned User with a temporary password only at the provider boundary', async () => {
  const f = await administrationFixture();
  const result = await f.service.create(f.admin,
    { email: ' New@Example.com ', temporaryPassword: 'temporary-secret', role: 'user' });
  expect(f.provider.createUser).toHaveBeenCalledExactlyOnceWith(
    { email: 'new@example.com', password: 'temporary-secret', externalId: 'u_created' });
  expect(isAdministrationUserResponse(result)).toBe(true);
  expect(result.user).toEqual({ userId: 'u_created', email: 'new@example.com', role: 'user',
    status: 'active', passwordChangeRequired: true, createdAt: '2026-11-10T00:00:00.000Z' });
  expect((await f.users.get('u_created'))?.account).toMatchObject({ workosUserId: 'user_created',
    passwordChangeRequired: true, currentWorkosSessionId: null, sessionEpoch: 0 });
  const visible = JSON.stringify([result, [...f.documents.values()]]);
  expect(visible).not.toContain('temporary-secret');
  expect(visible).not.toContain('temporaryPassword');
  expect(f.provider.replacePassword).not.toHaveBeenCalled();
  expect(f.provider.getUser).not.toHaveBeenCalled();
});
it.each([
  { email: 'new@example.com', temporaryPassword: 'long-enough', role: 'super-admin' },
  { email: 'new@example.com', temporaryPassword: 'long-enough' },
  { email: 'not-an-email', temporaryPassword: 'long-enough', role: 'user' },
  { email: 'new@example.com', temporaryPassword: 'short', role: 'user' },
  { email: 'new@example.com', temporaryPassword: 'x'.repeat(1025), role: 'user' },
  { email: 'new@example.com', temporaryPassword: 'long-enough', role: 'user', userId: 'victim' },
  { email: 'new@example.com', temporaryPassword: 'long-enough', role: 'user', status: 'inactive' },
])('rejects a create body outside the frozen contract %j', async body => {
  const f = await administrationFixture();
  await expect(f.service.create(f.admin, body)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.provider.createUser).not.toHaveBeenCalled();
  expect(f.documents.size).toBe(2);
});
it('requires current Super Admin authorization for create as well as list', async () => {
  const f = await administrationFixture(); const body = { email: 'new@example.com', temporaryPassword: 'long-enough', role: 'user' };
  await expect(f.service.create(null, body)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(f.service.create(f.regular, body)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.provider.createUser).not.toHaveBeenCalled();
});
```

- [ ] **Step 2 — RED:** `npm test -- test/administration/create.spec.ts`; expected `service.create is not a function`.
- [ ] **Step 3 — Add these imports to the service (merge into existing imports).**

```ts
import { createUserRequestSchema, type AdministrationUserResponse } from '../contracts/administration.js';
import { normalizedEmailSchema, userAccountSchema } from '../contracts/auth.js';
import { idSchema } from '../contracts/identifiers.js';
import { AdministrationFault } from './errors.js';
```

- [ ] **Step 4 — Add this method inside `AdministrationService`.** Validate the response even on the happy path; Task 4 gives partial failures a dedicated safe outcome.

```ts
  async create(principal: AuthPrincipal | null, body: unknown): Promise<AdministrationUserResponse> {
    await this.requireAdmin(principal);
    const request = createUserRequestSchema.safeParse(body);
    if (!request.success) throw new AuthFault('INVALID_REQUEST');
    const provider = this.provider();
    if (await this.o.users.byEmail(request.data.email)) throw new AdministrationFault('ACCOUNT_CONFLICT');
    const userId = idSchema.parse(this.newUserId());
    const created = await provider.createUser({ email: request.data.email,
      password: request.data.temporaryPassword, externalId: userId });
    if (!idSchema.safeParse(created.id).success || created.externalId !== userId ||
        normalizedEmailSchema.safeParse(created.email).data !== request.data.email)
      throw new AdministrationFault('ACCOUNT_PROVISIONING_INCOMPLETE');
    const at = this.now().toISOString();
    const saved = await this.o.users.insert(userAccountSchema.parse({ schemaVersion: 1,
      userId, workosUserId: created.id, emailNormalized: request.data.email, role: 'user',
      status: 'active', passwordChangeRequired: true, currentWorkosSessionId: null,
      sessionEpoch: 0, createdAt: at, updatedAt: at }));
    return { user: row(saved.account) };
  }
```

- [ ] **Step 5 — GREEN:** `npm test -- test/administration/create.spec.ts`; expect nine cases passing; `npm test -- test/administration/` retains Task 1–2 passes.
- [ ] **Step 6 — Commit.**

```bash
git add backend/src/administration/administration.service.ts backend/test/administration/create.spec.ts
git commit -m "feat(administration): provision User accounts with private onboarding"
```

## Task 4: Duplicate and partial provisioning outcomes, never adopt/overwrite

**Files:** Modify `backend/src/administration/administration.service.ts`; create `backend/test/administration/create-failures.spec.ts`.

- [ ] **Step 1 — Write the failure matrix.** The first new provider-conflict and timeout assertions must go RED before changing `create`.

```ts
/**
 * ============================================================================
 * FILE: create-failures.spec.ts
 * LOCATION: backend/test/administration/create-failures.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify safe duplicate and cross-service partial provisioning outcomes.
 *
 * ROLE IN PROJECT:
 *    Prevents retries from adopting or overwriting WorkOS identities.
 *    Distinguishes confirmed failure from unknown distributed outcomes.
 *
 * KEY COMPONENTS:
 *    - Conflict, unknown result, mapping mismatch and insert failures.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { AuthFault } from '../../src/auth/errors.js';
import { ProviderAccountConflict } from '../../src/auth/provider.js';
import { administrationFixture } from './fixtures.js';
const input = { email: 'new@example.com', temporaryPassword: 'password-sentinel', role: 'user' };

it('rejects local duplicates before dispatching any credential call', async () => {
  const f = await administrationFixture();
  await expect(f.service.create(f.admin, { ...input, email: ' A@EXAMPLE.COM ' }))
    .rejects.toMatchObject({ code: 'ACCOUNT_CONFLICT' });
  expect(f.provider.createUser).not.toHaveBeenCalled();
});
it('maps a pre-existing provider email to conflict without lookup, adoption or password overwrite', async () => {
  const f = await administrationFixture();
  f.provider.createUser.mockRejectedValueOnce(new ProviderAccountConflict());
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_CONFLICT', status: 409 });
  expect(f.documents.size).toBe(2);
  expect(f.provider.getUser).not.toHaveBeenCalled(); expect(f.provider.replacePassword).not.toHaveBeenCalled();
  expect(f.provider.createUser).toHaveBeenCalledTimes(1);
});
it.each([new AuthFault('AUTH_TIMEOUT'), new AuthFault('AUTH_PROVIDER_UNAVAILABLE'),
  new Error('password-sentinel provider reset-token-sentinel')])('does not retry an unknown provider creation outcome', async error => {
  const f = await administrationFixture(); f.provider.createUser.mockRejectedValueOnce(error);
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_PROVISIONING_INCOMPLETE', status: 503 });
  expect(f.provider.createUser).toHaveBeenCalledTimes(1); expect(f.documents.size).toBe(2);
});
it.each(['INVALID_REQUEST', 'RATE_LIMITED'] as const)('preserves the known safe provider rejection %s', async code => {
  const f = await administrationFixture(); f.provider.createUser.mockRejectedValueOnce(new AuthFault(code));
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code });
  expect(f.documents.size).toBe(2);
});
it.each([
  { id: '', email: 'new@example.com', externalId: 'u_created' },
  { id: 'user_new', email: 'other@example.com', externalId: 'u_created' },
  { id: 'user_new', email: 'new@example.com', externalId: 'victim' },
])('does not insert an unconfirmed provider/local mapping %j', async result => {
  const f = await administrationFixture(); f.provider.createUser.mockResolvedValueOnce(result);
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_PROVISIONING_INCOMPLETE' });
  expect(f.documents.size).toBe(2);
});
it('reports incomplete after an insert acknowledgement is lost, even if the row landed', async () => {
  const f = await administrationFixture(); const insert = f.users.insert.bind(f.users);
  vi.spyOn(f.users, 'insert').mockImplementationOnce(async a => { await insert(a); throw new Error('unknown-write'); });
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_PROVISIONING_INCOMPLETE' });
  expect(f.provider.createUser).toHaveBeenCalledTimes(1);
  expect((await f.users.get('u_created'))?.account.currentWorkosSessionId).toBeNull();
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_CONFLICT' });
  expect(f.provider.createUser).toHaveBeenCalledTimes(1);
});
it('does not show success or rerun provider creation when a local insert never lands', async () => {
  const f = await administrationFixture(); vi.spyOn(f.users, 'insert').mockRejectedValueOnce(new Error('password-sentinel'));
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'ACCOUNT_PROVISIONING_INCOMPLETE' });
  expect(await f.users.get('u_created')).toBeNull();
  expect(f.provider.createUser).toHaveBeenCalledTimes(1);
});
it('fails closed without a provider and keeps generation of internal IDs server-side', async () => {
  const f = await administrationFixture({ provider: null });
  await expect(f.service.create(f.admin, input)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect(f.documents.size).toBe(2);
});
```

- [ ] **Step 2 — RED:** `npm test -- test/administration/create-failures.spec.ts`. Expected new conflict/unknown-write cases fail on raw exceptions or the wrong public code; existing happy-path coverage stays green.
- [ ] **Step 3 — Add the runtime `ProviderAccountConflict` import and `ProviderUser` type.** Keep the existing `AuthProvider` type import; do not edit P1.

```ts
import { ProviderAccountConflict, type ProviderUser } from '../auth/provider.js';
```

- [ ] **Step 4 — Replace the complete `create` method with this final implementation.**

```ts
  async create(principal: AuthPrincipal | null, body: unknown): Promise<AdministrationUserResponse> {
    await this.requireAdmin(principal);
    const request = createUserRequestSchema.safeParse(body);
    if (!request.success) throw new AuthFault('INVALID_REQUEST');
    const provider = this.provider();
    if (await this.o.users.byEmail(request.data.email)) throw new AdministrationFault('ACCOUNT_CONFLICT');
    const userId = idSchema.parse(this.newUserId());
    let created: ProviderUser;
    try {
      created = await provider.createUser({ email: request.data.email,
        password: request.data.temporaryPassword, externalId: userId });
    } catch (error) {
      if (error instanceof ProviderAccountConflict) throw new AdministrationFault('ACCOUNT_CONFLICT');
      if (error instanceof AuthFault && ['INVALID_REQUEST', 'RATE_LIMITED'].includes(error.code)) throw error;
      // Unknown provider outcome may already have created credentials. Never retry or adopt by email.
      throw new AdministrationFault('ACCOUNT_PROVISIONING_INCOMPLETE');
    }
    if (!idSchema.safeParse(created.id).success || created.externalId !== userId ||
        normalizedEmailSchema.safeParse(created.email).data !== request.data.email)
      throw new AdministrationFault('ACCOUNT_PROVISIONING_INCOMPLETE');
    const at = this.now().toISOString();
    try {
      const saved = await this.o.users.insert(userAccountSchema.parse({ schemaVersion: 1,
        userId, workosUserId: created.id, emailNormalized: request.data.email, role: 'user',
        status: 'active', passwordChangeRequired: true, currentWorkosSessionId: null,
        sessionEpoch: 0, createdAt: at, updatedAt: at }));
      return { user: row(saved.account) };
    } catch { throw new AdministrationFault('ACCOUNT_PROVISIONING_INCOMPLETE'); }
  }
```

- [ ] **Step 5 — GREEN:** `npm test -- test/administration/create.spec.ts test/administration/create-failures.spec.ts`; every discovered case passes. `npm run build` verifies P1 port signatures remain unchanged.
- [ ] **Step 6 — Commit.**

```bash
git add backend/src/administration/administration.service.ts backend/test/administration/create-failures.spec.ts
git commit -m "fix(administration): fail safely on partial user provisioning"
```

## Task 5: Confirmed User lifecycle CAS and stale-session rejection

**Files:** Modify `backend/src/administration/administration.service.ts`; create `backend/test/administration/lifecycle.spec.ts`.

- [ ] **Step 1 — Write the lifecycle regression file.** Add and run the deactivation case first; then add the remaining independent cases in order.

```ts
/**
 * ============================================================================
 * FILE: lifecycle.spec.ts
 * LOCATION: backend/test/administration/lifecycle.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify User-only lifecycle writes and non-resurrecting sessions.
 *
 * ROLE IN PROJECT:
 *    Exercises real MongoUsers CAS plus P1 cookie admission.
 *    Protects local lifecycle fencing against stale requests and races.
 *
 * KEY COMPONENTS:
 *    - Deactivate/reactivate, refusals, uncertainty and login races.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { AuthService } from '../../src/auth/auth.service.js';
import { administrationFixture } from './fixtures.js';

it('deactivates durably, rejects stale cookies and reactivates without restoring their SID', async () => {
  const f = await administrationFixture();
  const auth = new AuthService({ users: f.users, provider: f.provider });
  expect((await auth.authenticate('sealed_1')).principal.account.userId).toBe('u1');
  const disabled = await f.service.deactivate(f.admin, 'u1', {});
  expect(disabled.user.status).toBe('inactive');
  expect((await f.users.get('u1'))?.account).toMatchObject({ status: 'inactive',
    currentWorkosSessionId: null, sessionEpoch: 1, passwordChangeRequired: false });
  await expect(auth.authenticate('sealed_1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  const enabled = await f.service.reactivate(f.admin, 'u1', {});
  expect(enabled.user.status).toBe('active');
  expect((await f.users.get('u1'))?.account).toMatchObject({ currentWorkosSessionId: null, sessionEpoch: 1 });
  await expect(auth.authenticate('sealed_1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  f.provider.login.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_fresh', sealedSession: 'sealed_fresh' });
  await auth.login({ email: 'a@example.com', password: 'private-password' });
  f.provider.read.mockResolvedValueOnce({ workosUserId: 'user_fixture_1', sessionId: 'sid_fresh' });
  expect((await auth.authenticate('sealed_fresh')).principal.account.userId).toBe('u1');
});
it.each(['deactivate', 'reactivate'] as const)('refuses unknown, Super Admin, malformed and unauthorized %s targets', async action => {
  const f = await administrationFixture();
  await expect(f.service[action](f.admin, 'missing', {})).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  await expect(f.service[action](f.admin, 'admin', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.service[action](f.admin, '', {})).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.service[action](f.admin, 'u1', { userId: 'admin' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.service[action](f.regular, 'u1', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.service[action](null, 'u1', {})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
});
it('preserves onboarding and makes repeated lifecycle commands local no-ops', async () => {
  const f = await administrationFixture(); const before = (await f.users.get('u1'))!;
  await f.users.compareAndSwap(before, { ...before.account, passwordChangeRequired: true });
  await f.service.deactivate(f.admin, 'u1', {});
  const disabled = (await f.users.get('u1'))!;
  await f.service.deactivate(f.admin, 'u1', {});
  expect(await f.users.get('u1')).toEqual(disabled);
  await f.service.reactivate(f.admin, 'u1', {});
  const active = (await f.users.get('u1'))!;
  expect(active.account.passwordChangeRequired).toBe(true);
  await f.service.reactivate(f.admin, 'u1', {});
  expect(await f.users.get('u1')).toEqual(active);
});
it.each(['conflict', 'uncertain'] as const)('never reports successful deactivation on CAS %s', async outcome => {
  const f = await administrationFixture();
  vi.spyOn(f.users, 'compareAndSwap').mockResolvedValueOnce({ outcome });
  await expect(f.service.deactivate(f.admin, 'u1', {})).rejects.toMatchObject({
    code: outcome === 'conflict' ? 'ACCOUNT_CONFLICT' : 'ACCOUNT_WRITE_UNCERTAIN',
  });
  expect((await f.users.get('u1'))?.account.status).toBe('active');
  expect(f.provider.listSessions).not.toHaveBeenCalled();
});
it('treats a thrown mutation as uncertain rather than retrying or claiming success', async () => {
  const f = await administrationFixture();
  vi.spyOn(f.users, 'compareAndSwap').mockRejectedValueOnce(new Error('unknown-write'));
  await expect(f.service.deactivate(f.admin, 'u1', {})).rejects.toMatchObject({ code: 'ACCOUNT_WRITE_UNCERTAIN' });
});
it('lets deactivation win against a login that captured the earlier account revision', async () => {
  const f = await administrationFixture();
  let entered!: () => void; let finish!: () => void;
  const began = new Promise<void>(resolve => { entered = resolve; });
  const release = new Promise<void>(resolve => { finish = resolve; });
  f.provider.login.mockImplementationOnce(async () => {
    entered(); await release;
    return { workosUserId: 'user_fixture_1', sessionId: 'sid_racing', sealedSession: 'sealed_racing' };
  });
  const auth = new AuthService({ users: f.users, provider: f.provider });
  const login = auth.login({ email: 'a@example.com', password: 'private-password' });
  const denied = expect(login).rejects.toMatchObject({ code: 'NOT_READY' });
  await began; await f.service.deactivate(f.admin, 'u1', {}); finish(); await denied;
  expect((await f.users.get('u1'))?.account).toMatchObject({ status: 'inactive', currentWorkosSessionId: null });
  expect(f.provider.revoke).toHaveBeenCalledWith('sid_racing');
});
```

- [ ] **Step 2 — RED:** `npm test -- test/administration/lifecycle.spec.ts`; expected missing `deactivate`/`reactivate` behavior. Do not change P1 login to make the race pass: its revision CAS already provides this fence.
- [ ] **Step 3 — Add these imports to the service.**

```ts
import { administrationActionRequestSchema } from '../contracts/administration.js';
import type { AccountRead } from '../contracts/auth.js';
import { invalidateAccount } from '../auth/access.js';
```

- [ ] **Step 4 — Add these helpers/methods inside `AdministrationService`.** No retry loop around a lifecycle CAS; a concurrent change requires refreshing the target state.

```ts
  private async target(principal: AuthPrincipal | null, userId: string, body: unknown): Promise<AccountRead> {
    const actor = await this.requireAdmin(principal);
    if (!idSchema.safeParse(userId).success || !administrationActionRequestSchema.safeParse(body).success)
      throw new AuthFault('INVALID_REQUEST');
    const current = await this.o.users.get(userId);
    if (!current) throw new AdministrationFault('ACCOUNT_NOT_FOUND');
    if (current.account.role !== 'user' || current.account.userId === actor.account.userId)
      throw new AuthFault('FORBIDDEN');
    return current;
  }
  private async save(expected: AccountRead, next: UserAccount): Promise<AccountRead> {
    let result;
    try { result = await this.o.users.compareAndSwap(expected, next); }
    catch { throw new AdministrationFault('ACCOUNT_WRITE_UNCERTAIN'); }
    if (result.outcome === 'conflict') throw new AdministrationFault('ACCOUNT_CONFLICT');
    if (result.outcome === 'uncertain') throw new AdministrationFault('ACCOUNT_WRITE_UNCERTAIN');
    return result.value;
  }
  async deactivate(principal: AuthPrincipal | null, userId: string, body: unknown): Promise<AdministrationUserResponse> {
    const current = await this.target(principal, userId, body);
    const saved = current.account.status === 'inactive' && current.account.currentWorkosSessionId === null
      ? current : await this.save(current, { ...invalidateAccount(current.account, this.now().toISOString()), status: 'inactive' });
    return { user: row(saved.account) };
  }
  async reactivate(principal: AuthPrincipal | null, userId: string, body: unknown): Promise<AdministrationUserResponse> {
    const current = await this.target(principal, userId, body);
    const saved = current.account.status === 'active' ? current : await this.save(current,
      { ...current.account, status: 'active', currentWorkosSessionId: null, updatedAt: this.now().toISOString() });
    return { user: row(saved.account) };
  }
```

- [ ] **Step 5 — GREEN:** `npm test -- test/administration/lifecycle.spec.ts`; expect eight passing cases. Run `npm test -- test/auth/session.spec.ts test/administration/` and `npm run build` to preserve P1 admission compatibility.
- [ ] **Step 6 — Commit.**

```bash
git add backend/src/administration/administration.service.ts backend/test/administration/lifecycle.spec.ts
git commit -m "feat(administration): fence User deactivation and reactivation"
```

## Task 6: Small P3 notification and bounded provider-session cleanup

**Files:** Modify `backend/src/administration/administration.service.ts`; create `backend/test/administration/deactivation.spec.ts`.

- [ ] **Step 1 — Write the failing deactivation cleanup tests.**

```ts
/**
 * ============================================================================
 * FILE: deactivation.spec.ts
 * LOCATION: backend/test/administration/deactivation.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify post-confirmation cleanup without a second runtime owner.
 *
 * ROLE IN PROJECT:
 *    Defines the P3 hook and finite best-effort WorkOS revocation.
 *    Keeps cleanup failures separate from confirmed local access state.
 *
 * KEY COMPONENTS:
 *    - Ordering, failures, pagination and deadline assertions.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { administrationFixture } from './fixtures.js';

it('notifies P3 with only the internal ID after inactive state is durable', async () => {
  const hook = vi.fn<(id: string) => Promise<void>>();
  const f = await administrationFixture({ onUserDeactivated: hook });
  const observations: unknown[] = [];
  hook.mockImplementation(async id => {
    observations.push((await f.users.get(id))?.account);
  });
  f.provider.listSessions.mockResolvedValueOnce({ ids: ['sid_1', 'sid_2'], nextCursor: 'page_2' })
    .mockResolvedValueOnce({ ids: ['sid_3'], nextCursor: null });
  await f.service.deactivate(f.admin, 'u1', {});
  expect(hook).toHaveBeenCalledExactlyOnceWith('u1');
  expect(observations[0]).toMatchObject({ status: 'inactive', currentWorkosSessionId: null });
  expect(f.provider.listSessions.mock.calls).toEqual([['user_fixture_1', undefined], ['user_fixture_1', 'page_2']]);
  expect(f.provider.revoke.mock.calls.map(c => c[0])).toEqual(['sid_1', 'sid_2', 'sid_3']);
  await f.service.deactivate(f.admin, 'u1', {});
  expect(hook).toHaveBeenCalledTimes(2); // Reattempt missed cleanup, no new local mutation.
  await f.service.reactivate(f.admin, 'u1', {});
  expect(hook).toHaveBeenCalledTimes(2); // Reactivation never resurrects work.
});
it('does not invoke cleanup for an uncertain local write', async () => {
  const hook = vi.fn(); const f = await administrationFixture({ onUserDeactivated: hook });
  vi.spyOn(f.users, 'compareAndSwap').mockResolvedValueOnce({ outcome: 'uncertain' });
  await expect(f.service.deactivate(f.admin, 'u1', {})).rejects.toMatchObject({ code: 'ACCOUNT_WRITE_UNCERTAIN' });
  expect(hook).not.toHaveBeenCalled(); expect(f.provider.revoke).not.toHaveBeenCalled();
  expect(f.provider.listSessions).not.toHaveBeenCalled();
});
it('keeps confirmed local deactivation effective when provider cleanup or hook fails', async () => {
  const hook = vi.fn(async () => { throw new Error('private-hook-error'); });
  const f = await administrationFixture({ onUserDeactivated: hook });
  f.provider.revoke.mockRejectedValue(new Error('private-provider-error'));
  f.provider.listSessions.mockRejectedValueOnce(new Error('provider-down'));
  expect((await f.service.deactivate(f.admin, 'u1', {})).user.status).toBe('inactive');
  expect(hook).toHaveBeenCalledExactlyOnceWith('u1');
  expect((await f.users.get('u1'))?.account.currentWorkosSessionId).toBeNull();
});
it('caps cleanup pages and stops repeated cursors', async () => {
  const f = await administrationFixture();
  f.provider.listSessions.mockResolvedValue({ ids: [], nextCursor: 'same' });
  await f.service.deactivate(f.admin, 'u1', {});
  expect(f.provider.listSessions).toHaveBeenCalledTimes(2);
  const g = await administrationFixture(); let n = 0;
  g.provider.listSessions.mockImplementation(async () => ({ ids: [], nextCursor: `page_${++n}` }));
  await g.service.deactivate(g.admin, 'u1', {});
  expect(g.provider.listSessions).toHaveBeenCalledTimes(3);
});
it('bounds waiting to ten seconds and dispatches no further provider work after the deadline', async () => {
  vi.useFakeTimers(); let settle!: () => void;
  try {
    const f = await administrationFixture();
    f.provider.revoke.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
    const pending = f.service.deactivate(f.admin, 'u1', {});
    await vi.advanceTimersByTimeAsync(10001);
    expect((await pending).user.status).toBe('inactive');
    settle(); await vi.advanceTimersByTimeAsync(1);
    expect(f.provider.listSessions).not.toHaveBeenCalled();
  } finally { settle?.(); vi.useRealTimers(); }
});
```

- [ ] **Step 2 — RED:** `npm test -- test/administration/deactivation.spec.ts`; expect the missing callback/cleanup assertions to fail, not a timer hang.
- [ ] **Step 3 — Extend options with the hook and import the existing deadline helper.**

```ts
import { boundedResult } from '../operations/bounded.js';

// Replace the options declaration (keep the other types unchanged).
export type AdministrationServiceOptions = {
  users: UsersRepository; provider: AdministrationProvider | null;
  now?: () => Date; newUserId?: () => string;
  onUserDeactivated?: (userId: string) => void | Promise<void>;
};
```

- [ ] **Step 4 — Add this private helper and replace `deactivate`.** The callback promise and provider cleanup settle independently. Never log caught provider/hook objects, which could carry secrets or private payloads.

```ts
  private async cleanupDeactivated(account: Readonly<UserAccount>): Promise<void> {
    const deadline = Date.now() + 10000;
    const revoke = async () => {
      const provider = this.o.provider;
      if (!provider) return;
      const revoked = new Set<string>();
      const revokeOne = async (sid: string) => {
        if (Date.now() >= deadline || revoked.has(sid)) return;
        revoked.add(sid);
        try { await provider.revoke(sid); } catch { /* Local SID/status fence is authoritative. */ }
      };
      if (account.currentWorkosSessionId) await revokeOne(account.currentWorkosSessionId);
      let cursor: string | undefined;
      const cursors = new Set<string>();
      // ponytail: at most 300 listed sessions per deactivation; repeat command/operator cleanup if this ceiling is reached.
      for (let page = 0; page < 3 && Date.now() < deadline; page++) {
        const result = await provider.listSessions(account.workosUserId, cursor);
        for (const sid of result.ids.slice(0, 100)) await revokeOne(sid);
        if (!result.nextCursor || cursors.has(result.nextCursor)) return;
        cursor = result.nextCursor; cursors.add(cursor);
      }
    };
    await boundedResult(Promise.allSettled([
      Promise.resolve().then(() => this.o.onUserDeactivated?.(account.userId)),
      Promise.resolve().then(revoke),
    ]), 10000);
  }
  async deactivate(principal: AuthPrincipal | null, userId: string, body: unknown): Promise<AdministrationUserResponse> {
    const current = await this.target(principal, userId, body);
    const saved = current.account.status === 'inactive' && current.account.currentWorkosSessionId === null
      ? current : await this.save(current, { ...invalidateAccount(current.account, this.now().toISOString()), status: 'inactive' });
    // A crash between commit and callback is repaired by repeating deactivate, not a new event-delivery subsystem.
    await this.cleanupDeactivated(current.account);
    return { user: row(saved.account) };
  }
```

- [ ] **Step 5 — GREEN:** `npm test -- test/administration/deactivation.spec.ts test/administration/lifecycle.spec.ts`; all cases execute and pass. `npm run build` confirms callback options are usable by P3 without importing AppService.
- [ ] **Step 6 — Commit.**

```bash
git add backend/src/administration/administration.service.ts backend/test/administration/deactivation.spec.ts
git commit -m "feat(administration): notify deactivation and bound session cleanup"
```

## Task 7: Reset mail to recorded User email, never a replacement credential

**Files:** Modify `backend/src/administration/administration.service.ts`; create `backend/test/administration/recovery.spec.ts`.

- [ ] **Step 1 — Write failing recovery tests.**

```ts
/**
 * ============================================================================
 * FILE: recovery.spec.ts
 * LOCATION: backend/test/administration/recovery.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify mailbox-only admin recovery without credential disclosure.
 *
 * ROLE IN PROJECT:
 *    Separates sending mail from P1 password-reset completion.
 *    Prevents administrative reset requests from replacing credentials.
 *
 * KEY COMPONENTS:
 *    - Recorded email, role restrictions, rate bounds and safe faults.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { AuthFault } from '../../src/auth/errors.js';
import { administrationFixture } from './fixtures.js';

it('sends to the recorded mailbox, returns nothing and does not unlock/invalidate the account', async () => {
  const f = await administrationFixture(); const before = await f.users.get('u1');
  f.provider.sendRecovery.mockResolvedValueOnce({ passwordResetToken: 'token-sentinel', passwordResetUrl: 'url-sentinel' } as never);
  expect(await f.service.passwordReset(f.admin, 'u1', {})).toBeUndefined();
  expect(f.provider.sendRecovery).toHaveBeenCalledExactlyOnceWith('a@example.com');
  expect(await f.users.get('u1')).toEqual(before);
  expect(f.provider.replacePassword).not.toHaveBeenCalled(); expect(f.provider.reset).not.toHaveBeenCalled();
  expect(f.provider.revoke).not.toHaveBeenCalled();
});
it('permits recovery for an inactive User without reactivating them', async () => {
  const f = await administrationFixture(); await f.service.deactivate(f.admin, 'u1', {});
  const before = await f.users.get('u1'); await f.service.passwordReset(f.admin, 'u1', {});
  expect(await f.users.get('u1')).toEqual(before);
  expect(f.provider.sendRecovery).toHaveBeenCalledWith('a@example.com');
});
it('denies unknown, Super Admin, client email/password replacement and unauthorized requests', async () => {
  const f = await administrationFixture();
  await expect(f.service.passwordReset(f.admin, 'missing', {})).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  await expect(f.service.passwordReset(f.admin, 'admin', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.service.passwordReset(f.regular, 'u1', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.service.passwordReset(null, 'u1', {})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  for (const body of [{ email: 'attacker@example.com' }, { password: 'admin-chosen' }, { token: 'raw' }])
    await expect(f.service.passwordReset(f.admin, 'u1', body)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.provider.sendRecovery).not.toHaveBeenCalled();
});
it('applies a three-per-minute per-email send limit and a finite global operation limit', async () => {
  const f = await administrationFixture();
  for (let n = 0; n < 3; n++) await f.service.passwordReset(f.admin, 'u1', {});
  await expect(f.service.passwordReset(f.admin, 'u1', {})).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  expect(f.provider.sendRecovery).toHaveBeenCalledTimes(3);
  const g = await administrationFixture();
  for (let n = 0; n < 60; n++) await g.service.list(g.admin, {});
  await expect(g.service.list(g.admin, {})).rejects.toMatchObject({ code: 'RATE_LIMITED' });
});
it('propagates safe timeout but never provider payloads and never changes account state on send failure', async () => {
  const f = await administrationFixture(); const before = await f.users.get('u1');
  f.provider.sendRecovery.mockRejectedValueOnce(new AuthFault('AUTH_TIMEOUT'));
  await expect(f.service.passwordReset(f.admin, 'u1', {})).rejects.toMatchObject({ code: 'AUTH_TIMEOUT' });
  f.provider.sendRecovery.mockRejectedValueOnce(new Error('password=secret&token=secret&url=secret'));
  await expect(f.service.passwordReset(f.admin, 'u1', {})).rejects.toMatchObject({ code: 'NOT_READY' });
  expect(await f.users.get('u1')).toEqual(before);
});
```

- [ ] **Step 2 — RED:** `npm test -- test/administration/recovery.spec.ts`; expected missing `passwordReset` method.
- [ ] **Step 3 — Add the minimal method inside the service.**

```ts
  async passwordReset(principal: AuthPrincipal | null, userId: string, body: unknown): Promise<void> {
    const current = await this.target(principal, userId, body);
    this.limiter.take('recovery', current.account.emailNormalized);
    try { await this.provider().sendRecovery(current.account.emailNormalized); }
    catch (error) { throw safeAdministrationFault(error); }
  }
```

- [ ] **Step 4 — GREEN:** `npm test -- test/administration/recovery.spec.ts`; expect five passing tests. Run `npm test -- test/administration/` and `npm run build` before committing.
- [ ] **Step 5 — Commit.**

```bash
git add backend/src/administration/administration.service.ts backend/test/administration/recovery.spec.ts
git commit -m "feat(administration): send bounded mailbox-only password recovery"
```

## Task 8: Independently composable Nest controller/module and exact HTTP contract

**Files:** Create `backend/src/administration/administration.controller.ts`, `backend/src/administration/administration.module.ts`, `backend/test/administration/http-fixture.ts`, `backend/test/administration/http.spec.ts`.

- [ ] **Step 1 — Create the isolated app fixture.** This initial fixture uses Nest's normal body parser; Task 9 replaces it with the bounded route-local parser. Never import AppModule.

```ts
/**
 * ============================================================================
 * FILE: http-fixture.ts
 * LOCATION: backend/test/administration/http-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Boot Administration in isolation without infrastructure or auth bypasses.
 *
 * ROLE IN PROJECT:
 *    Supplies trusted test principals, never a production singleton.
 *    Reuses the same service instance through real Nest route registration.
 *
 * KEY COMPONENTS:
 *    - AdministrationModule fixture and sequential principal selector.
 * ============================================================================
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthPrincipal } from '../../src/contracts/auth.js';
import { AdministrationModule } from '../../src/administration/administration.module.js';
import { administrationFixture } from './fixtures.js';

export async function administrationHttpFixture() {
  const f = await administrationFixture(); let principal: AuthPrincipal | null = f.admin;
  const moduleRef = await Test.createTestingModule({ imports: [AdministrationModule.register({
    service: f.service, principal: () => principal,
  })] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.setGlobalPrefix('api'); await app.init();
  return { ...f, app, as: (next: AuthPrincipal | null) => { principal = next; } };
}
```

- [ ] **Step 2 — Write the HTTP contract tests.** Each fixture is closed in `finally`; assertions make actual requests through Nest routing and filters.

```ts
/**
 * ============================================================================
 * FILE: http.spec.ts
 * LOCATION: backend/test/administration/http.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify all five Administration routes against the frozen P1 wire.
 *
 * ROLE IN PROJECT:
 *    Exercises actual routing, role denial and secret-free filters.
 *    Checks isolated module behavior before P3 root integration.
 *
 * KEY COMPONENTS:
 *    - HTTP success, direct API denials and safe error serialization.
 * ============================================================================
 */
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { isAdministrationErrorResponse, isAdministrationPage,
  isAdministrationUserResponse } from '../../src/contracts/administration.js';
import { administrationHttpFixture } from './http-fixture.js';

it('exposes list/create/deactivate/reactivate/reset with the agreed response shapes', async () => {
  const f = await administrationHttpFixture();
  try {
    const server = f.app.getHttpServer();
    const list = await request(server).get('/api/admin/users?limit=1').expect(200);
    expect(isAdministrationPage(list.body)).toBe(true); expect(list.body.items).toHaveLength(1);
    const created = await request(server).post('/api/admin/users').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').send({ email: 'new@example.com', temporaryPassword: 'temporary-secret', role: 'user' }).expect(201);
    expect(isAdministrationUserResponse(created.body)).toBe(true);
    const disabled = await request(server).post('/api/admin/users/u1/deactivate').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').send({}).expect(200);
    expect(disabled.body.user.status).toBe('inactive');
    const enabled = await request(server).post('/api/admin/users/u1/reactivate').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').send({}).expect(200);
    expect(enabled.body.user.status).toBe('active');
    const reset = await request(server).post('/api/admin/users/u1/password-reset').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').send({}).expect(204);
    expect(reset.text).toBe(''); expect(f.provider.sendRecovery).toHaveBeenCalledExactlyOnceWith('a@example.com');
    expect(JSON.stringify([list.body, created.body, disabled.body, enabled.body])).not.toContain('temporary-secret');
  } finally { await f.app.close(); }
});
it('returns 401/403 through every direct API route, regardless of client role hints', async () => {
  const f = await administrationHttpFixture();
  try {
    for (const principal of [null, f.regular]) {
      f.as(principal); const status = principal ? 403 : 401; const server = f.app.getHttpServer();
      const list = await request(server).get('/api/admin/users').set('Host', 'localhost:3000').set('X-Role', 'super-admin').expect(status);
      expect(isAdministrationErrorResponse(list.body)).toBe(true);
      await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
        .send({ email: 'new@example.com', temporaryPassword: 'temporary-secret', role: 'user' }).expect(status);
      for (const action of ['deactivate', 'reactivate', 'password-reset'])
        await request(server).post(`/api/admin/users/u1/${action}`).set('Host', 'localhost:3000')
          .set('Origin', 'http://localhost:5173').send({}).expect(status);
    }
    expect(f.provider.createUser).not.toHaveBeenCalled(); expect(f.provider.sendRecovery).not.toHaveBeenCalled();
    expect((await f.users.get('u1'))?.account.status).toBe('active');
  } finally { await f.app.close(); }
});
it('rejects extra/duplicate queries, role escalation and Super Admin lifecycle targets', async () => {
  const f = await administrationHttpFixture();
  try {
    const server = f.app.getHttpServer();
    for (const query of ['limit=51', 'limit=1&limit=2', 'cursor=not-json', 'userId=victim'])
      await request(server).get(`/api/admin/users?${query}`).set('Host', 'localhost:3000').expect(400);
    await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
      .send({ email: 'new@example.com', temporaryPassword: 'temporary-secret', role: 'super-admin' }).expect(400);
    for (const action of ['deactivate', 'reactivate', 'password-reset']) {
      await request(server).post(`/api/admin/users/admin/${action}`).set('Host', 'localhost:3000')
        .set('Origin', 'http://localhost:5173').send({}).expect(403);
      const missing = await request(server).post(`/api/admin/users/missing/${action}`).set('Host', 'localhost:3000')
        .set('Origin', 'http://localhost:5173').send({}).expect(404);
      expect(missing.body.error.code).toBe('ACCOUNT_NOT_FOUND');
      await request(server).post(`/api/admin/users/u1/${action}?email=attacker@example.com`).set('Host', 'localhost:3000')
        .set('Origin', 'http://localhost:5173').send({}).expect(400);
    }
  } finally { await f.app.close(); }
});
it('never reflects or logs a password/provider-token exception on provisioning failure', async () => {
  const f = await administrationHttpFixture();
  const logs = (['log', 'info', 'warn', 'error'] as const).map(method => vi.spyOn(console, method).mockImplementation(() => undefined));
  try {
    f.provider.createUser.mockRejectedValueOnce(new Error('password-sentinel token-sentinel reset-url-sentinel'));
    const result = await request(f.app.getHttpServer()).post('/api/admin/users').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').send({ email: 'new@example.com', temporaryPassword: 'password-sentinel', role: 'user' }).expect(503);
    expect(result.body).toEqual({ error: { code: 'ACCOUNT_PROVISIONING_INCOMPLETE', retryable: false } });
    for (const word of ['password-sentinel', 'token-sentinel', 'reset-url-sentinel']) expect(result.text).not.toContain(word);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify([...f.documents.values()])).not.toContain('password-sentinel');
  } finally { for (const log of logs) log.mockRestore(); await f.app.close(); }
});
it('normalizes unexpected storage errors to a closed safe HTTP fault', async () => {
  const f = await administrationHttpFixture();
  try {
    vi.spyOn(f.users, 'list').mockRejectedValueOnce(new Error('private-storage-data'));
    const result = await request(f.app.getHttpServer()).get('/api/admin/users').set('Host', 'localhost:3000').expect(503);
    expect(result.body).toEqual({ error: { code: 'NOT_READY', retryable: true } });
    expect(result.text).not.toContain('private-storage-data');
  } finally { await f.app.close(); }
});
```

- [ ] **Step 3 — RED:** `npm test -- test/administration/http.spec.ts`; expected missing Administration module import.
- [ ] **Step 4 — Create the controller/filter.** P3 passes a server-side principal reader, not a captured account or client-derived callback. Origin/body/cache enforcement is added in Task 9, not mixed into business methods.

```ts
/**
 * ============================================================================
 * FILE: administration.controller.ts
 * LOCATION: backend/src/administration/administration.controller.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Expose the five safe User Administration HTTP routes.
 *
 * ROLE IN PROJECT:
 *    Keeps routing thin and reads P3's current request principal.
 *    Serializes only the closed account and auth failure contracts.
 *
 * KEY COMPONENTS:
 *    - AdministrationController, principal token and safe fault filter.
 * ============================================================================
 */
import { Body, Catch, Controller, Get, HttpCode, Inject, Param, Post, Query, UseFilters,
  type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { administrationActionRequestSchema } from '../contracts/administration.js';
import type { AuthPrincipal } from '../contracts/auth.js';
import { AuthFault } from '../auth/errors.js';
import { AdministrationService } from './administration.service.js';
import { safeAdministrationFault } from './errors.js';

export const ADMINISTRATION_PRINCIPAL = Symbol('ADMINISTRATION_PRINCIPAL');
@Catch()
class AdministrationFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent || res.writableEnded) return;
    const fault = safeAdministrationFault(error);
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (fault.code === 'RATE_LIMITED') res.setHeader('Retry-After', '60');
    res.status(fault.status).json(fault.body());
  }
}
function noQuery(query: unknown): void {
  if (!administrationActionRequestSchema.safeParse(query).success) throw new AuthFault('INVALID_REQUEST');
}
@Controller('admin/users')
@UseFilters(AdministrationFilter)
export class AdministrationController {
  constructor(@Inject(AdministrationService) private readonly service: AdministrationService,
    @Inject(ADMINISTRATION_PRINCIPAL) private readonly principal: () => AuthPrincipal | null) {}
  @Get()
  list(@Query() query: unknown) { return this.service.list(this.principal(), query); }
  @Post() @HttpCode(201)
  create(@Body() body: unknown, @Query() query: unknown) {
    noQuery(query); return this.service.create(this.principal(), body);
  }
  @Post(':userId/deactivate') @HttpCode(200)
  deactivate(@Param('userId') userId: string, @Body() body: unknown, @Query() query: unknown) {
    noQuery(query); return this.service.deactivate(this.principal(), userId, body);
  }
  @Post(':userId/reactivate') @HttpCode(200)
  reactivate(@Param('userId') userId: string, @Body() body: unknown, @Query() query: unknown) {
    noQuery(query); return this.service.reactivate(this.principal(), userId, body);
  }
  @Post(':userId/password-reset') @HttpCode(204)
  passwordReset(@Param('userId') userId: string, @Body() body: unknown, @Query() query: unknown) {
    noQuery(query); return this.service.passwordReset(this.principal(), userId, body);
  }
}
```

- [ ] **Step 5 — Create the registration-only module.** This follows existing AuthModule/AdminConfigModule `ConfigurableModuleBuilder` conventions.

```ts
/**
 * ============================================================================
 * FILE: administration.module.ts
 * LOCATION: backend/src/administration/administration.module.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Register Administration using existing service and principal reader.
 *
 * ROLE IN PROJECT:
 *    Lets P3 compose once without opening persistence or a runtime.
 *    Leaves request context and infrastructure lifecycle with their owners.
 *
 * KEY COMPONENTS:
 *    - AdministrationModule.register and its narrow options type.
 * ============================================================================
 */
import { ConfigurableModuleBuilder, Module } from '@nestjs/common';
import type { AuthPrincipal } from '../contracts/auth.js';
import { ADMINISTRATION_PRINCIPAL, AdministrationController } from './administration.controller.js';
import { AdministrationService } from './administration.service.js';

export type AdministrationModuleOptions = {
  service: AdministrationService; principal: () => AuthPrincipal | null;
};
const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } = new ConfigurableModuleBuilder<AdministrationModuleOptions>().build();
@Module({ controllers: [AdministrationController], providers: [
  { provide: AdministrationService, inject: [MODULE_OPTIONS_TOKEN],
    useFactory: (o: AdministrationModuleOptions) => o.service },
  { provide: ADMINISTRATION_PRINCIPAL, inject: [MODULE_OPTIONS_TOKEN],
    useFactory: (o: AdministrationModuleOptions) => o.principal },
], exports: [AdministrationService] })
export class AdministrationModule extends ConfigurableModuleClass {}
```

- [ ] **Step 6 — GREEN:** `npm test -- test/administration/http.spec.ts`; expect five passing HTTP tests. Run `npm run build` to verify Nest injection/decorator type compatibility.
- [ ] **Step 7 — Commit.**

```bash
git add backend/src/administration/administration.controller.ts backend/src/administration/administration.module.ts backend/test/administration/http-fixture.ts backend/test/administration/http.spec.ts
git commit -m "feat(administration): expose isolated Super Admin account routes"
```

## Task 9: Bound credential ingress and reuse established browser protections

**Files:** Create `backend/src/administration/configure-administration-http.ts`, `backend/test/administration/ingress.spec.ts`; modify `backend/test/administration/http-fixture.ts`.

**Why a local installer:** `configureAdminHttp` is hard-scoped to `/api/admin/config` and forbids all queries/empty action bodies. `configureAuthHttp` is hard-scoped to `/api/auth`. Neither can cover this route without changing another owner's source. Use their existing small Express/parser pattern locally; do not generalize/extract shared HTTP infrastructure in P2.

- [ ] **Step 1 — Write these failing ingress tests.** The first cross-origin case currently succeeds, so its RED assertion is meaningful even before the new installer exists.

```ts
/**
 * ============================================================================
 * FILE: ingress.spec.ts
 * LOCATION: backend/test/administration/ingress.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Administration credential ingress and no-cache boundaries.
 *
 * ROLE IN PROJECT:
 *    Exercises only loopback HTTP with deterministic provider stubs.
 *    Keeps browser trust and parsing tests outside business logic.
 *
 * KEY COMPONENTS:
 *    - Origin/transport, parser limits and body deadline assertions.
 * ============================================================================
 */
import http from 'node:http';
import request from 'supertest';
import { expect, it } from 'vitest';
import { administrationHttpFixture } from './http-fixture.js';
const input = { email: 'new@example.com', temporaryPassword: 'password-sentinel', role: 'user' };

it('rejects cross-origin, cross-site and absent/null mutation origins before credential calls', async () => {
  const f = await administrationHttpFixture();
  try {
    for (const origin of ['https://evil.example', '', 'null']) {
      let req = request(f.app.getHttpServer()).post('/api/admin/users').set('Host', 'localhost:3000');
      if (origin) req = req.set('Origin', origin);
      await req.send(input).expect(403);
    }
    await request(f.app.getHttpServer()).post('/api/admin/users').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').set('Sec-Fetch-Site', 'cross-site').send(input).expect(403);
    await request(f.app.getHttpServer()).get('/api/admin/users').set('Host', 'localhost:3000')
      .set('Origin', 'https://evil.example').expect(403);
    expect(f.provider.createUser).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it('rejects remote plaintext Host despite forged forwarding headers and supports only trusted HTTPS ingress', async () => {
  const f = await administrationHttpFixture();
  try {
    await request(f.app.getHttpServer()).post('/api/admin/users').set('Host', 'remote.example')
      .set('X-Forwarded-Proto', 'https').set('Origin', 'http://localhost:5173').send(input).expect(403);
    expect(f.provider.createUser).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
  const blocked = await administrationHttpFixture({ frontendOrigin: 'https://aurvin.example', trustedHttpsIngress: () => false });
  try {
    await request(blocked.app.getHttpServer()).get('/api/admin/users').set('Host', 'aurvin.example').expect(403);
  } finally { await blocked.app.close(); }
  const trusted = await administrationHttpFixture({ frontendOrigin: 'https://aurvin.example', trustedHttpsIngress: () => true });
  try {
    await request(trusted.app.getHttpServer()).post('/api/admin/users').set('Host', 'aurvin.example')
      .set('Origin', 'https://aurvin.example').send(input).expect(201);
  } finally { await trusted.app.close(); }
});
it('rejects oversized, compressed, non-JSON and malformed bodies with safe errors before provider work', async () => {
  const f = await administrationHttpFixture();
  try {
    const server = f.app.getHttpServer();
    await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
      .send({ ...input, temporaryPassword: 'x'.repeat(5000) }).expect(413);
    await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
      .set('Content-Encoding', 'gzip').send(input).expect(400);
    await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
      .set('Content-Type', 'text/plain').send('password=password-sentinel').expect(400);
    const malformed = await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
      .set('Content-Type', 'application/json').send('{"temporaryPassword":').expect(400);
    expect(malformed.body).toEqual({ error: { code: 'INVALID_REQUEST', retryable: false } });
    expect(f.provider.createUser).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it('sets no-store/nosniff and suppresses ETags on successful and failed pages', async () => {
  const f = await administrationHttpFixture();
  try {
    const server = f.app.getHttpServer();
    const page = await request(server).get('/api/admin/users').set('Host', 'localhost:3000').expect(200)
      .expect('Cache-Control', 'no-store').expect('X-Content-Type-Options', 'nosniff');
    expect(page.headers.etag).toBeUndefined();
    await request(server).get('/api/admin/users').set('Host', 'localhost:3000')
      .set('If-None-Match', '*').expect(200);
    f.as(f.regular);
    await request(server).get('/api/admin/users').set('Host', 'localhost:3000').expect(403)
      .expect('Cache-Control', 'no-store').expect('X-Content-Type-Options', 'nosniff');
  } finally { await f.app.close(); }
});
it('rejects chunked over-limit bodies and stops slow body collection at five seconds', async () => {
  const f = await administrationHttpFixture(); let upload: http.ClientRequest | undefined;
  try {
    await f.app.listen(0, '127.0.0.1'); const address = f.app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const send = (chunk: string, finish: boolean) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      upload = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/admin/users',
        headers: { Host: `localhost:${port}`, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', part => { body += part; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      upload.on('error', reject); upload.write(chunk); if (finish) upload.end();
    });
    const oversized = await send('x'.repeat(4097), true); expect(oversized.status).toBe(413);
    const slow = await send('{', false); expect(slow.status).toBe(408);
    expect(JSON.parse(slow.body)).toEqual({ error: { code: 'INVALID_REQUEST', retryable: false } });
    expect(f.provider.createUser).not.toHaveBeenCalled();
  } finally { upload?.destroy(); await f.app.close(); }
}, 8000);
```

- [ ] **Step 2 — RED:** `npm test -- test/administration/ingress.spec.ts -t "rejects cross-origin"`; expected 201 instead of 403. The HTTPS test's extra fixture argument is introduced in Step 4; do not misreport a TypeScript argument error as evidence of the origin defect.
- [ ] **Step 3 — Create the installer.** It recognizes only Administration's segment, allows GET paging, and accepts `{}` for actions. Its close-after-response behavior preserves the safe error rather than resetting an unread request before the response flushes.

```ts
/**
 * ============================================================================
 * FILE: configure-administration-http.ts
 * LOCATION: backend/src/administration/configure-administration-http.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bound Administration credential ingress with existing HTTP policy.
 *
 * ROLE IN PROJECT:
 *    Installed by P3 before global parsers without installing global auth.
 *    Matches the existing same-origin credential handling policy.
 *
 * KEY COMPONENTS:
 *    - Exact origin/TLS, 4-KiB/5s JSON collector and no-store replies.
 * ============================================================================
 */
import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { BootstrapConfig } from '../platform/config/bootstrap-config.js';
import { AuthFault } from '../auth/errors.js';

export type AdministrationHttpOptions = {
  bootstrap: BootstrapConfig; trustedHttpsIngress: (req: Request) => boolean;
};
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const loopbackPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function fail(res: Response, code: 'INVALID_REQUEST' | 'FORBIDDEN', status?: number): void {
  if (res.headersSent || res.writableEnded) return;
  const fault = new AuthFault(code); res.status(status ?? fault.status).json(fault.body());
}
function closeAfterReply(req: Request, res: Response): void {
  res.setHeader('Connection', 'close');
  res.once('finish', () => {
    if (req.readableEnded) { req.socket.end(); return; }
    const timer = setTimeout(() => req.destroy(), 1000); timer.unref();
    req.once('end', () => { clearTimeout(timer); req.socket.end(); });
    req.once('close', () => clearTimeout(timer)); req.resume();
  });
}
function originAllowed(req: Request, bootstrap: BootstrapConfig): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return req.method === 'GET';
  return typeof origin === 'string' && origin !== 'null' && !origin.includes(',') && origin === bootstrap.frontendOrigin;
}
function transportAllowed(req: Request, options: AdministrationHttpOptions): boolean {
  const origin = new URL(options.bootstrap.frontendOrigin);
  if (origin.protocol === 'https:') return options.trustedHttpsIngress(req) === true;
  const host = req.headers.host;
  if (typeof host !== 'string' || host.includes(',')) return false;
  try {
    return options.bootstrap.nodeEnv === 'development' && origin.protocol === 'http:' && loopbackHosts.has(origin.hostname) &&
      loopbackHosts.has(new URL(`http://${host}`).hostname) && loopbackPeers.has(req.socket.remoteAddress ?? '');
  } catch { return false; }
}
export function configureAdministrationHttp(app: NestExpressApplication, options: AdministrationHttpOptions): void {
  const parser = json({ limit: 4096, inflate: false, strict: true, type: 'application/json',
    verify: (_req, _res, bytes) => { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path.replace(/\/+$/, '').toLowerCase();
    if (path !== '/api/admin/users' && !path.startsWith('/api/admin/users/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const setHeader = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: number | string | readonly string[]) =>
      name.toLowerCase() === 'etag' ? res : setHeader(name, value)) as typeof res.setHeader;
    res.removeHeader('ETag');
    if (!originAllowed(req, options.bootstrap) || !transportAllowed(req, options)) { fail(res, 'FORBIDDEN'); return; }
    const collection = path === '/api/admin/users';
    const action = /^\/api\/admin\/users\/[^/]+\/(deactivate|reactivate|password-reset)$/.test(path);
    if (!((req.method === 'GET' && collection) || (req.method === 'POST' && (collection || action))) ||
        (req.method !== 'GET' && (req.url ?? '').includes('?'))) { fail(res, 'INVALID_REQUEST'); return; }
    if (req.method === 'GET') { next(); return; }
    const contentType = req.headers['content-type']; const encoding = req.headers['content-encoding'];
    const length = req.headers['content-length'];
    const validType = typeof contentType === 'string' && /^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(contentType);
    const validLength = length === undefined || (typeof length === 'string' && /^\d+$/.test(length) &&
      Number.isSafeInteger(Number(length)) && Number(length) > 0);
    if (!validType || (encoding !== undefined && encoding !== 'identity') || !validLength) {
      closeAfterReply(req, res); fail(res, 'INVALID_REQUEST'); return;
    }
    if (length !== undefined && Number(length) > 4096) { closeAfterReply(req, res); fail(res, 'INVALID_REQUEST', 413); return; }
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
      if (body === null || typeof body !== 'object' || Array.isArray(body)) { fail(res, 'INVALID_REQUEST'); return; }
      next();
    });
  });
}
```

- [ ] **Step 4 — Add the following imports/types to `http-fixture.ts` and replace its function.** Preserve the header and existing imports; no root bootstrap edit.

```ts
import type { Request } from 'express';
import { configureAdministrationHttp } from '../../src/administration/configure-administration-http.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
type HttpFixtureOptions = { frontendOrigin?: string; trustedHttpsIngress?: (req: Request) => boolean };

export async function administrationHttpFixture(options: HttpFixtureOptions = {}) {
  const f = await administrationFixture(); let principal: AuthPrincipal | null = f.admin;
  const moduleRef = await Test.createTestingModule({ imports: [AdministrationModule.register({
    service: f.service, principal: () => principal,
  })] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api');
  configureAdministrationHttp(app, {
    bootstrap: loadBootstrapConfig({ FRONTEND_ORIGIN: options.frontendOrigin ?? 'http://localhost:5173' }),
    trustedHttpsIngress: options.trustedHttpsIngress ?? (() => false),
  });
  await app.init();
  return { ...f, app, as: (next: AuthPrincipal | null) => { principal = next; } };
}
```

- [ ] **Step 5 — GREEN:** `npm test -- test/administration/ingress.spec.ts test/administration/http.spec.ts`; expect ten passing HTTP/ingress tests including the discovered five-second deadline case. Run `npm run build` and `npm run lint`; fix only P2-owned code. Existing or parallel changes' failures are recorded separately and routed to their owners.
- [ ] **Step 6 — Commit.**

```bash
git add backend/src/administration/configure-administration-http.ts backend/test/administration/http-fixture.ts backend/test/administration/ingress.spec.ts
git commit -m "feat(administration): bound credential ingress and browser mutations"
```

## Task 10: Final P2 regression verification and downstream handoff (no source expansion)

**Files:** No new application files. Do not edit state/evidence files owned by the orchestrator/P6; report evidence in the worker's final response. Any defect correction stays in the exact P2 files above, begins with a failing assertion and receives its own named-file commit.

- [ ] **Step 1 — Confirm scope and preserved work:** `git status --short`, `git diff --name-only`, `git log --oneline -10`. Inspect each P2 commit's named paths; none may include the eight baseline changes, `auth/**`, root wiring, dependency files or another plan.
- [ ] **Step 2 — Run the complete focused suite:** `npm test -- test/administration/`. Expected: all nine `*.spec.ts` files discover tests, all assertions pass, none are skipped. Check actual totals instead of treating an exit code or source presence as evidence.
- [ ] **Step 3 — Run upstream compatibility checks:** `npm test -- test/auth/ test/persistence/auth-users.spec.ts`. Expected: previously passing P1 fixture suites remain passing. This reads P1 source, never edits it.
- [ ] **Step 4 — Run backend package gates separately:** `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`. Record command, environment, commit set, discovered tests/pass/fail/skip counts. Do not call an empty or prerequisite-skipped native suite a pass. P2's isolated module does not prove P3 root integration or browser behavior.
- [ ] **Step 5 — Inspect final API privacy:** Confirm stored account schema and every successful/error response contain no passwords, raw reset URLs/tokens, session envelope or provider response object; only provider fixture call arguments transiently contain the create password. Confirm all lifecycle routes go through `target`, every service entry authorizes through `requireAdmin`, and `create` makes at most one provider attempt per invocation.
- [ ] **Step 6 — Report P2 commits and handoff:** Export the precise `AdministrationServiceOptions`, module registration, ingress-install ordering and hook signature listed above. P3 supplies the existing repository/provider, reads the request principal from its context and wires `onUserDeactivated(userId)` to existing per-owner cancellation/connection cleanup; P4 uses the unchanged P1 wire. No P2 root-wiring change, bootstrap execution, external provisioning, live WorkOS/email calls, paid inference or deployment is authorized.

If a final regression needs correction, use a focused commit such as:

```bash
git add backend/src/administration/administration.service.ts backend/test/administration/lifecycle.spec.ts
git commit -m "fix(administration): preserve confirmed lifecycle outcomes"
```

Do not make an empty verification commit. Report exact actual hashes; the orchestrator updates `state.md` and releases P3 worker only after P2 is complete and committed.

## Acceptance mapping and limits

| P2 requirement | Task/check |
| --- | --- |
| AC3: Super Admin only; User 403; anonymous 401; onboarding denied | Tasks 2–3, 5, 7–8, current-account reload and direct API tests |
| AC4: Safe bounded table, default 20/max 50, stable opaque keyset cursor | Task 2 plus Task 8 duplicate-query/invalid-cursor HTTP assertions |
| AC2/AC4: Create User with temporary password, externalId and mandatory onboarding | Tasks 3–4; zero password persistence/response assertions |
| AC4: Duplicates, unknown provider outcome, mismatched mapping and uncertain local insert | Task 4; at-most-one creation call, no lookup/adoption/credential overwrite |
| AC4: Deactivate/reactivate, stale-cookie rejection, no SID/work resurrection, protected Super Admin | Tasks 5–6 including concurrent login fence and post-confirmation hook |
| AC2/AC4: Recorded-mailbox reset, no admin takeover, no token-bearing results | Task 7 plus 204 HTTP/reset assertions in Task 8 |
| AC8: Finite ingress, safe faults, no sensitive logs, meaningful regression checks | Tasks 1, 6, 8–10 |

**Explicit downstream/unrun gates:** P3 owns middleware/ALS/root assembly and real active-work cleanup; P4 owns form state/password clearing and Administration UI; P5 owns bootstrap/adoption; P6 owns integrated two-User/Super-Admin privacy/browser/operations evidence. WorkOS email delivery requires enabled dashboard reset emails and Aurvin's reset redirect; fixtures do not certify delivery. Missing auth setup never grants an administrator; P3 admission must return no principal. Native database verification needs the operator-supplied isolated URI/prefix; do not run fixtures against application data. Existing Azure, staging/access-control, live-service, real-data bootstrap and deployment restrictions remain unchanged. Review is **skipped**, not passed.

## Planning self-check (documentation evidence only)

- Plan is confined to new `administration/**` production/tests and this artifact; no upstream/shared/root/frontend edits are prescribed.
- Reconciled actual P1 helper/provider paths and method signatures; schemas/response guards stay P1-owned.
- File map precedes tasks. Creation blocks contain valid TypeScript headers, `.js` local imports, runnable failing assertions, exact RED/GREEN commands and explicit named-file commits.
- Covers User/anonymous denials, current-account admission, onboarding, forbidden Super Admin targets, duplicate/partial provisioning, bounded cursor paging, stale-session/lifecycle races, mailbox-only recovery, hook ordering/bounds and password/token redaction.
- The sixteen final planned TypeScript files were assembled in memory from this document and checked with the installed TypeScript compiler against P1 imports: zero planned-file type diagnostics. No implementation files were created and no application test suites were run. Verification commands/results above remain requirements for the P2 worker, not claimed passes. Review remains skipped.

**Documentation references consulted:** Existing P1 source and package/test configuration, plus the current Nest [dynamic module documentation](https://docs.nestjs.com/fundamentals/dynamic-modules) retrieved with Context7 on 10 November 2026. WorkOS SDK calls remain behind the already-implemented P1 adapter; no new provider API is introduced.
