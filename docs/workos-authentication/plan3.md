# Existing Backend Authentication Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate Aurvin's existing backend, restrict shared configuration to Super Admins, and preserve each account's private text, voice, artifact and Calendar work.

**Architecture:** Keep one AppService, DurableChatRuntime, persistence connection/close owner, global configuration pointer and process-wide admission budget. An AsyncLocalStorage store supplies an admitted principal at request boundaries; accepted work captures immutable owner/session information instead of looking up request context later. Reuse the existing owner-bound Calendar lifecycle and memory-first implementation inside explicitly keyed owner compartments, not additional application runtimes.

**Tech Stack:** Node 22+/24+, TypeScript NodeNext/ESM, NestJS 12/Express, node:async_hooks, existing WorkOS adapter and HttpOnly cookies, ws/LiveKit, Vitest/Supertest and deterministic provider/storage fixtures. No new dependency.

---

## 1. Scope, prerequisites and inspection findings

Read [goal.md](goal.md), [research.md](research.md), the P3 ownership/dependency sections of [state.md](state.md), and repository `AGENTS.md`. This is **P3 planning only**. Implementation waits for committed P1 **and P2 workers**; a P2 plan alone is insufficient. Review remains **skipped**. P4 owns browser UI/client teardown, P5 owns operator bootstrap/adoption, and P6 owns integrated acceptance evidence. Do not provision WorkOS, send email, run bootstrap, inspect real credentials, deploy, or run paid inference.

### Actual upstream interfaces (inspected after P1)

- `backend/src/auth/auth.module.ts`: `AuthModule.registerAsync({ imports, inject, useFactory })`, options `{ service: AuthService; secureCookie: boolean }`.
- `backend/src/auth/auth.service.ts`: `new AuthService({ users, provider, now? })`; `authenticate(cookie)` returns `{ principal, sealedSession? }`; `logout(principal)` invalidates local binding before provider revocation.
- `backend/src/auth/auth-boundary.ts`: `authenticateCookie(service, header)` and `authBoundary(service, run, secureCookie)` exist. **P1 did not implement ALS or install global middleware.** Reuse its cookie helper and safe faults; no cookie-parser.
- `AuthPrincipal` is `{ account, sessionId, identity }`; `admitAccount`, `requireFullAccount`, `requireSuperAdmin` are exported by `backend/src/auth/access.ts`. Role/status live on the local account, not `ResolvedIdentity` or WorkOS organization claims.
- `createWorkosProvider(bootstrap.workos)` creates the one bounded provider adapter; use `null` when WorkOS is absent. `UsersRepository` has `get`, `bySubject`, `byEmail`, `insert`, `compareAndSwap`, `list({ limit?, cursor? })`.
- **Compatibility bridge:** current `contracts/identity.ts` still admits `'server-configured'` in addition to the two new sources. `contracts/config-runtime.ts` has `SessionAdminConfigActor`; the old admin wire and `platform/config/manageable-config.ts` still project the legacy assumption. P3 must not mistake this temporary type compatibility for authorization. Runtime/browser admission must reject the legacy source. Ask P1 to remove the obsolete contract branch/update its mirror and contract tests after consumers migrate; do not edit P1-owned contracts or frontend protocol files concurrently.
- **P2 interface:** the concurrently prepared `plan2.md` freezes `AdministrationServiceOptions = { users, provider: Pick<AuthProvider,'createUser'|'sendRecovery'|'revoke'|'listSessions'> | null, now?, newUserId?, onUserDeactivated?: (userId:string) => void | Promise<void> }`; `AdministrationModuleOptions = { service: AdministrationService; principal: () => AuthPrincipal | null }`, configurable `register`/`registerAsync`, and `configureAdministrationHttp(app,{bootstrap,trustedHttpsIngress})`. Its controller receives the admitted principal callback and the service reloads current local authority. Import from `backend/src/administration/administration.module.ts`, `administration.service.ts`, and `configure-administration-http.ts`, respectively. **Task 12 still waits for P2's implementation commit** and verifies these exports; do not compile against only a plan.

### Necessary corrections to the research baseline

1. `DurableChatRuntime.identity`, execute/status/reconciliation/live methods and `ExecutionReservations` reject everyone except `config.identity.userId`. Merely swapping the HTTP resolver would break all new users.
2. `MemoryText`/`MemoryFirstFoundation` are owner-bound and several runtime caches are keyed by **sessionId only**. Preserve the memory-first save/retry behavior; do not disable it to make authentication compile.
3. Calendar's connection class, OAuth pending flow, refresh flights, lifecycle fences and discovery service are already a coherent **single-owner** implementation. Reuse that implementation with immutable explicit owners; never make a shared `userId` getter read ALS during refresh/cleanup.
4. `AppService.calendarStatus`, `projectedCurrent` and lifecycle invalidation are process-wide. A disconnected User must not disable another User's Calendar or change the other's tool/context projection.
5. `SameSite=Strict` auth cookies are absent on Google's cross-site callback navigation. An OAuth callback cannot simply require that cookie on its first GET. Task 9 provides a same-origin completion bridge while retaining Strict auth cookies and the existing OAuth browser binding.
6. `VoiceSessionService.end`, `claimLive`, `assertPaidWork` currently resolve ambient identity in timer/media/drain paths. Split external owner checks from internal bound-entry cleanup; do not remove authorization from HTTP DELETE.
7. Express middleware does not authenticate WS upgrades. Authenticate **before 101**, not just after `handleConnection`.
8. Local recovery currently scans only the configured legacy owner. Scan all mapped accounts, including inactive ones, while retaining unmapped legacy data as an explicit pre-adoption/operator gate.

### Documentation consulted

Nest's current [ALS recipe](https://docs.nestjs.com/recipes/async-local-storage) and [dynamic modules](https://docs.nestjs.com/fundamentals/dynamic-modules) confirm `als.run(store, next)` and `registerAsync`/`imports`/`inject`/`useFactory`. Installed `backend/node_modules/@nestjs/platform-ws/adapters/ws-adapter.js` forwards server options to `ws.Server`; its upgrade listener bypasses Express. Use the existing `ws` `verifyClient` callback option, covered by a real loopback upgrade test. These are documentation/source checks, not implementation or live-service passes.

## 2. File responsibility map

New files are justified boundaries, not permission for unrelated restructuring:

| File(s) | Responsibility |
| --- | --- |
| `backend/src/platform/identity/request-identity-store.ts` | ALS principal, full-account resolver and session admin actor; no fallback. |
| `backend/src/platform/identity/server-identity-resolver.ts`, `backend/src/platform/platform.module.ts` | Existing resolver delegates to the shared store; export that exact instance. |
| `backend/src/http/configure-private-http.ts` | Cookie admission, existing-origin mutation policy, safe auth errors before private parsers/controllers. |
| `backend/src/admin-config/admin-config.controller.ts`, `backend/src/admin-config/admin-config.service.ts`, `backend/src/admin-config/configure-admin-http.ts` | Authorize config reads/writes; preserve existing transport, validation, CAS and credential handling. |
| `backend/src/chat-runtime/durable-chat-runtime.ts` | Multi-owner dispatch/captured identities and keyed caches; carefully separated from dirty title hunk. |
| `backend/src/chat-runtime/execution-reservations.ts`, `backend/src/chat-runtime/work.ts`, `backend/src/chat-runtime/ports.ts` | Owner-keyed reservations, targeted work interruption, P3-local lifecycle ports. |
| `backend/src/chat-runtime/memory-text.ts`, `backend/src/chat-runtime/memory-first-foundation.ts` | Owner-bound memory compartments, shared process capacity/saver limits and captured attribution. |
| `backend/src/plugins/google-calendar/owner-registry.ts` | Explicit-owner connection/OAuth/runtime compartments sharing the admitted repositories. |
| `backend/src/plugins/google-calendar/connection.ts`, `backend/src/plugins/google-calendar/oauth.ts` | Remove ambient constructor identity; bind immutable owner; cancel only that owner's pending setup. |
| `backend/src/plugins/google-calendar/module.ts`, `backend/src/plugins/google-calendar/controller.ts`, `backend/src/plugins/google-calendar/controller-http.ts`, `backend/src/plugins/google-calendar/oauth-callback-page.ts` | Resolve the owner's compartment once per call; cookie-safe OAuth completion. |
| `backend/src/http/chat-http.service.ts`, `backend/src/http/chat-stream.transport.ts` | Capture request owner and auth session; preserve owner-scoped HTTP/archive/stream behavior and targeted closure. |
| `backend/src/voice/session/voice-session.service.ts`, `backend/src/voice/session/voice-session.options.ts`, `backend/src/voice/session/voice-session.controller.ts`, `backend/src/voice/transport/voice.gateway.ts`, `backend/src/voice/transport/authenticated-ws-adapter.ts` | Authenticated token/session issuance and upgrade; explicit bound-entry lifecycle/cleanup. |
| `backend/src/app.service.ts`, `backend/src/app.module.ts`, `backend/src/main.ts` | Single-owner assembly, lazy users delegate, P1/P2 wiring, exact-origin credential CORS, middleware order and cleanup hook. |
| `backend/test/assembly/auth-principal-fixture.ts` | Small shared fixture for P3 tests; no runtime bypass. |
| Focused tests named in each task | Real assertions using existing test infrastructure; no new auth integration directory owned by P6. |

Adjacent-file handoffs need explicit orchestration acknowledgement before editing: `backend/src/operations/local-recovery.ts`/its tests (multi-owner maintenance), `backend/src/platform/config/manageable-config.ts` (session role projection), and `backend/src/operations/options.ts`/`readiness.ts` (one optional auth-ready delegate). `backend/src/operations/calendar-assembly.ts` needs only the owner-argument substitution when `ConnectionDependencies` changes. Also request the **one existing caller migration** in `backend/src/scripts/import-config.ts` and its current spec: replace ambient resolver attribution with explicit bootstrap-operator attribution, without adding any bootstrap/adoption behavior. Leaving that compile caller for P5 would create a dependency cycle (P5 waits for a buildable P3). Existing P3-affected fixture changes are listed alongside each task and in Task 15. P1 owns contract/manifest corrections; P5 still owns all new Super Admin bootstrap/adoption behavior. If a handoff is refused, stop that dependent task and report the gate instead of silently expanding scope.

### Header/import rule for every code block below

Before writing a **new** `.ts` file, prepend this header, substituting the exact filename/path and the responsibility from this map. Preserve an existing header; update it if its role changes. Add a header to an unheaded existing file if the edit exceeds 30%. Code fences below show executable bodies/imports, not permission to omit headers.

```ts
/**
 * ============================================================================
 * FILE: request-identity-store.ts
 * LOCATION: backend/src/platform/identity/request-identity-store.ts
 * ============================================================================
 * PURPOSE: Hold an admitted principal for one request without identity fallback.
 * ROLE IN PROJECT: Supplies identity to existing singleton services at request
 * boundaries; accepted and background work retain their own immutable owners.
 * KEY COMPONENTS: RequestIdentityStore.run, principal, resolve, adminActor.
 * ============================================================================
 */
```

Every local TypeScript import uses `.js`. Use existing Vitest globals or explicit imports consistently with the touched test. All commands below run in `backend/` unless labelled **repository root**. Commit commands run at the repository root.

Each checkbox is one action. Larger implementation steps contain several independent edits: apply and test one named method/call-site group at a time (roughly 2–5 minutes), not a single speculative rewrite. Tasks 5–6 deliberately share one commit because owner compartment isolation without shared ceilings is an unsafe intermediate feature. The template's `superpowers:` names correspond here to the available `subagent-driven-development`/`executing-plans` skills; an assigned worker must not create another orchestration layer without coordination.

## 3. Task 0 — Freeze preservation evidence and obtain handoffs

**Files:** Read only the eight files below; no changes to them during planning. Worker saves evidence under `C:/Users/Peter/AppData/Local/Temp/opencode`, not the repository.

- `backend/src/chat-runtime/durable-chat-runtime.ts`
- `backend/src/persistence/sessions.ts`
- `backend/test/persistence/voice-messages.native.e2e-spec.ts`
- `backend/test/persistence/voice-messages.spec.ts`
- `backend/test/runtime/voice-acceptance.native.e2e-spec.ts`
- `frontend/src/features/chat/state/chat-reducer.ts`
- `frontend/src/features/chat/state/memory-save-state.test.ts`
- `frontend/src/features/chat/state/voice-draft-lock.test.ts`

- [ ] **Step 1: Confirm worker prerequisites and serialize the commit slot.** Read current status and P1/P2 commit summaries. Request the three adjacent-file handoffs above and P1's eventual compatibility-bridge removal. Do not dispatch another agent from this planner role.

```powershell
git status --short
git diff --cached --name-only
git log -5 --oneline
git diff -- backend/src/chat-runtime/durable-chat-runtime.ts
```

Expected at planning time: exactly the eight modified files, empty index; runtime dirty diff changes only `title: live ? 'Voice Conversation' : titleFor(...)` to `title: titleFor(...)` near `acceptNewTurn`. **Refresh, do not assume this is unchanged when implementing.** Any new overlapping hunk needs inspection and coordination.

- [ ] **Step 2: Capture byte-for-byte baselines before overlapping edits.** Repository root:

```powershell
$paths = @(
  'backend/src/chat-runtime/durable-chat-runtime.ts',
  'backend/src/persistence/sessions.ts',
  'backend/test/persistence/voice-messages.native.e2e-spec.ts',
  'backend/test/persistence/voice-messages.spec.ts',
  'backend/test/runtime/voice-acceptance.native.e2e-spec.ts',
  'frontend/src/features/chat/state/chat-reducer.ts',
  'frontend/src/features/chat/state/memory-save-state.test.ts',
  'frontend/src/features/chat/state/voice-draft-lock.test.ts'
)
$dir = Join-Path 'C:/Users/Peter/AppData/Local/Temp/opencode' ('aurvin-p3-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
$paths | ForEach-Object {
  $target = Join-Path $dir ($_.Replace('/', '__'))
  Copy-Item -LiteralPath $_ -Destination $target
  [pscustomobject]@{ path = $_; backup = $target; hash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash }
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dir 'baseline.json')
git diff --binary --output="$dir/preexisting.patch" -- $paths
```

Expected: eight backups and patch outside Git; no repository changes. Never read/copy `.env`, `.openchamber/`, or secrets into evidence. Leave the seven non-runtime dirty files completely unchanged. No worktree/stash/reset/checkout is authorized.

- [ ] **Step 3: Baseline offline checks.** Run `npm run build`, `npm run lint`, `npm test`; record existing failures separately. Do not install dependencies or rewrite lockfiles as documentation preparation. No native/live checks without their stated prerequisites.

- [ ] **Step 4: Use index-only isolation for EVERY later runtime commit.** Never `git add backend/src/chat-runtime/durable-chat-runtime.ts`. After editing the working file, produce the current combined diff to a temporary patch, remove exactly the untouched pre-existing title hunk in that **patch**, and apply only the P3 patch to the index:

```powershell
git diff --binary --output="$dir/runtime-combined.patch" -- backend/src/chat-runtime/durable-chat-runtime.ts
```

Use the patch tool to create `$dir/runtime-p3.patch` from that diff, omitting the complete original title-only hunk (not reverting it in the working file). Inspect the patch. Then:

```powershell
git apply --cached --check "$dir/runtime-p3.patch"
git apply --cached "$dir/runtime-p3.patch"
git diff --cached -- backend/src/chat-runtime/durable-chat-runtime.ts
git diff -- backend/src/chat-runtime/durable-chat-runtime.ts
```

Expected staged diff: P3 changes only. Expected unstaged runtime diff: the **same original title change**, with shifted line numbers allowed. If P3 must edit the same title lines, or the retained diff contains another person's new work, stop for user/orchestrator direction; do not stage a combined hunk. Use `git show :backend/src/chat-runtime/durable-chat-runtime.ts` to inspect the staged version. After each commit the user hunk must remain unstaged. Confirm the other seven SHA256 values still match before reporting. This is clean patch separation, not authorization to commit the original change.

**Task 0 commit:** none; preservation evidence is local and excluded from commits.

## 4. Task 1 — Request-bound identity, with no fallback

**Files:** Create `backend/src/platform/identity/request-identity-store.ts`, `backend/test/assembly/auth-principal-fixture.ts`, `backend/src/platform/identity/request-identity-store.spec.ts`; modify `backend/src/platform/identity/server-identity-resolver.ts`, `backend/src/platform/identity/server-identity-resolver.spec.ts`, `backend/src/platform/platform.module.ts`, `backend/src/platform/platform.module.spec.ts`; after the explicit narrow handoff, modify `backend/src/scripts/import-config.ts`/`backend/src/scripts/import-config.spec.ts` only for the existing attribution caller.

- [ ] **Step 1: Write the fixture and failing ALS test.** Fixture body:

```ts
import { admitAccount } from '../../src/auth/access.js';
import type { AuthPrincipal, UserRole } from '../../src/contracts/auth.js';

export function principal(userId = 'u1', role: UserRole = 'user', pending = false): AuthPrincipal {
  return admitAccount({ schemaVersion: 1, userId, workosUserId: `workos_${userId}`,
    emailNormalized: `${userId}@example.com`, role, status: 'active',
    passwordChangeRequired: pending, currentWorkosSessionId: `sid_${userId}`,
    sessionEpoch: 0, createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z' }, `sid_${userId}`);
}
```

Test body:

```ts
import { expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { RequestIdentityStore } from './request-identity-store.js';
import { ServerIdentityResolver } from './server-identity-resolver.js';
import { principal } from '../../../test/assembly/auth-principal-fixture.js';

it('isolates overlapping requests and never resolves a default outside admission', async () => {
  const store = new RequestIdentityStore(), resolver = new ServerIdentityResolver(store);
  expect(() => resolver.resolve()).toThrow('UNAUTHENTICATED');
  const values = await Promise.all(['u1', 'u2', 'admin'].map(u =>
    store.run(principal(u, u === 'admin' ? 'super-admin' : 'user'), async () => {
      await setImmediate();
      return resolver.resolve();
    })));
  expect(values.map(v => [v.userId, v.openRouterUser, v.source])).toEqual([
    ['u1', 'u1', 'authenticated-session'], ['u2', 'u2', 'authenticated-session'],
    ['admin', 'admin', 'authenticated-session'],
  ]);
  expect(() => resolver.resolve()).toThrow('UNAUTHENTICATED');
  expect(() => store.run(principal('u1', 'user', true), () => resolver.resolve()))
    .toThrow('PASSWORD_CHANGE_REQUIRED');
  expect(() => store.run(principal(), () => resolver.assertNoClientOverrides({ userId: 'u2' })))
    .toThrow();
  expect(() => store.run(principal(), () => store.adminActor())).toThrow('FORBIDDEN');
});
```

- [ ] **Step 2: Red.** `npm test -- src/platform/identity/request-identity-store.spec.ts` → FAIL missing store/export or constructor signature. Do not call a missing fixture a meaningful behavioral red after the helper is in place.
- [ ] **Step 3: Minimum implementation.** New store body:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../../contracts/auth.js';
import type { SessionAdminConfigActor } from '../../contracts/config-runtime.js';
import { requireFullAccount, requireSuperAdmin } from '../../auth/access.js';
import { AuthFault } from '../../auth/errors.js';

@Injectable()
export class RequestIdentityStore {
  private readonly context = new AsyncLocalStorage<AuthPrincipal>();
  run<T>(principal: AuthPrincipal, next: () => T): T { return this.context.run(principal, next); }
  principal(): AuthPrincipal {
    const value = this.context.getStore();
    if (!value) throw new AuthFault('UNAUTHENTICATED');
    return value;
  }
  resolve() { return requireFullAccount(this.principal()).identity; }
  adminActor(): SessionAdminConfigActor {
    const p = requireSuperAdmin(this.principal());
    return { identity: p.identity,
      assumption: { role: 'super-admin', authentication: 'session', source: 'local-account' } };
  }
}
```

Replace resolver constructor/resolve only, keeping `assertNoClientOverrides` unchanged:

```ts
constructor(@Inject(RequestIdentityStore) private readonly store: RequestIdentityStore) {}
resolve(): ResolvedIdentity { return this.store.resolve(); }
```

Import the store using `.js`, remove `AURVIN_CONFIG` injection/unused config slice, add/export `RequestIdentityStore` in PlatformModule. AppService later receives this same resolver/store through its assembly factory; it must not `new` another store. Replace old resolver tests with admitted-store calls; platform module test asserts unbound resolution throws, not that a default owner exists.

The existing stopped-app `import-config` command uses identity only for `updatedBy`, not browser admission. Replace its `new ServerIdentityResolver(bootstrap).resolve()` with this exact body, and replace its resolver import with `resolvedIdentitySchema`:

```ts
const identity = resolvedIdentitySchema.parse({ userId: bootstrap.identity.userId,
  openRouterUser: bootstrap.identity.userId, source: 'bootstrap-operator' });
```

In `backend/src/scripts/import-config.spec.ts`, in `imports one encrypted document and refuses a populated store`, immediately after `const saved = f.stored()!;` add `expect(saved.updatedBy).toBe(f.bootstrap.identity.userId);`; run its existing no-network fixture. Do not create a synthetic AuthPrincipal or change this command's gates/provider checks. This is caller compatibility, not permission to run the command.
- [ ] **Step 4: Green.** `npm test -- src/platform/identity src/platform/platform.module.spec.ts src/scripts/import-config.spec.ts` → PASS real assertions. `npm run build` may expose remaining P3 consumers; record them until their task, never restore a fallback to silence them.
- [ ] **Step 5: Commit.** Stage only the named task files explicitly. Message: `feat(auth): bind existing identity resolution to admitted requests`.

## 5. Task 2 — Protect private HTTP before parsing or controller work

**Files:** Create `backend/src/http/configure-private-http.ts`, `backend/test/http/private-boundary.spec.ts`. Wire it in `backend/src/main.ts` in Task 12, not twice.

**Route rule:** Public liveness is exact `GET /api/operations/live`; exact six auth routes remain owned/validated by P1; OPTIONS is preflight, not authentication. The exact Calendar GET callback is a **static completion bridge only** (Task 9). Every other `/api` route, including ready/details, chat streams, artifacts, voice config/token/control and plugin paths, requires a full current account. This closed default protects new private routes without a permission registry. Auth routes cannot be excused by a prefix such as `/api/auth-evil`.

- [ ] **Step 1: Write failing middleware test.** This uses actual Express requests without creating application data:

```ts
import express from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configurePrivateHttp } from '../../src/http/configure-private-http.js';
import { RequestIdentityStore } from '../../src/platform/identity/request-identity-store.js';
import { AuthFault } from '../../src/auth/errors.js';
import { principal } from '../assembly/auth-principal-fixture.js';

it('closes admission before private handlers and preserves public liveness and exact origin', async () => {
  const app = express(), store = new RequestIdentityStore();
  const authenticate = vi.fn(async (cookie: string | null) => {
    if (!cookie) throw new AuthFault('UNAUTHENTICATED');
    return { principal: principal(cookie, cookie === 'admin' ? 'super-admin' : 'user', cookie === 'pending') };
  });
  configurePrivateHttp({ use: app.use.bind(app) } as NestExpressApplication, {
    auth: { authenticate }, identities: store, frontendOrigin: 'http://127.0.0.1:5173', secureCookie: false,
  });
  const privateHandler = vi.fn((_req: ExpressRequest, res: ExpressResponse) => res.json(store.resolve()));
  app.get('/api/sessions', privateHandler);
  app.post('/api/sessions', privateHandler);
  app.get('/api/operations/live', (_req, res) => res.json({ live: true }));
  await request(app).get('/api/operations/live').expect(200);
  expect(authenticate).not.toHaveBeenCalled();
  await request(app).get('/api/sessions').expect(401);
  expect(privateHandler).not.toHaveBeenCalled();
  await request(app).get('/api/sessions').set('Cookie', 'aurvin_wos_session=pending').expect(403);
  await request(app).post('/api/sessions').set('Cookie', 'aurvin_wos_session=u1')
    .set('Origin', 'https://evil.example').expect(403);
  await request(app).post('/api/sessions').set('Cookie', 'aurvin_wos_session=u1').expect(403);
  const ok = await request(app).get('/api/sessions').set('Cookie', 'aurvin_wos_session=u2').expect(200);
  expect(ok.body.userId).toBe('u2');
  expect(ok.headers['cache-control']).toBe('no-store');
});
```

- [ ] **Step 2: Red.** `npm test -- test/http/private-boundary.spec.ts` → FAIL missing export.
- [ ] **Step 3: Minimum implementation.** Use structural AuthService pick so fixtures remain typed:

```ts
import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthService } from '../auth/auth.service.js';
import { readSessionCookie, clearSessionCookie, sessionCookie } from '../auth/cookies.js';
import { requireFullAccount, requireSuperAdmin } from '../auth/access.js';
import { AuthFault } from '../auth/errors.js';
import type { RequestIdentityStore } from '../platform/identity/request-identity-store.js';

export type PrivateHttpOptions = { auth: Pick<AuthService, 'authenticate'>;
  identities: RequestIdentityStore; frontendOrigin: string; secureCookie: boolean };
const authRoutes = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/me',
  '/api/auth/password', '/api/auth/forgot-password', '/api/auth/reset-password']);
export function configurePrivateHttp(app: Pick<NestExpressApplication, 'use'>, o: PrivateHttpOptions): void {
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const path = req.path.replace(/\/+$/, '').toLowerCase();
    if (path !== '/api' && !path.startsWith('/api/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS' || authRoutes.has(path) ||
      (req.method === 'GET' && path === '/api/operations/live') ||
      (req.method === 'GET' && path === '/api/plugins/google-calendar/oauth/callback')) {
      next(); return;
    }
    try {
      const origin = req.headers.origin;
      const mutation = !['GET', 'HEAD'].includes(req.method);
      if (req.headers['sec-fetch-site'] === 'cross-site' ||
        (origin !== undefined && origin !== o.frontendOrigin) || (mutation && origin !== o.frontendOrigin))
        throw new AuthFault('FORBIDDEN');
      const admitted = await o.auth.authenticate(readSessionCookie(req.headers.cookie));
      const p = requireFullAccount(admitted.principal);
      if (path === '/api/admin' || path.startsWith('/api/admin/')) requireSuperAdmin(p);
      if (admitted.sealedSession) res.append('Set-Cookie', sessionCookie(admitted.sealedSession, o.secureCookie));
      o.identities.run(p, () => next());
    } catch (error) {
      const fault = error instanceof AuthFault ? error : new AuthFault('NOT_READY');
      if (fault.code === 'UNAUTHENTICATED') res.append('Set-Cookie', clearSessionCookie(o.secureCookie));
      res.status(fault.status).json(fault.body());
    }
  });
}
```

No raw exception/provider body is logged. Preserve cookies on retryable refresh errors. Existing auth/admin/Calendar transport/body checks still run. Use `res.append`, not replacement, for session cookies; later controllers issuing voice/OAuth cookies must also append (Tasks 9–10). OPTIONS completes before P1's auth middleware, which otherwise rejects it. Add parameterized tests for expired/unknown/inactive/stale cookies via the P1 auth fixture, malformed/duplicate cookies, `/api/auth-evil`, `/api/admin/config`, HEAD, wrong/null/comma origins, refresh+voice cookie coexistence, and provider timeout with no cookie clearing.
- [ ] **Step 4: Green.** `npm test -- test/http/private-boundary.spec.ts test/auth/boundary.spec.ts test/auth/cookies.spec.ts` → PASS, with no real provider calls.
- [ ] **Step 5: Commit.** `feat(auth): enforce cookie admission across private HTTP surfaces`; stage only the two files.

## 6. Task 3 — Session-only Config reads AND writes

**Files:** Modify `backend/src/admin-config/admin-config.controller.ts`, `backend/src/admin-config/admin-config.service.ts`, `backend/src/platform/config/manageable-config.ts` after its handoff, `backend/test/admin-config/fixtures.ts`, affected calls in `backend/src/admin-config/admin-config.service.spec.ts`, `backend/test/assembly/admin-config.spec.ts`, `backend/test/assembly/admin-http.spec.ts`; create `backend/test/admin-config/authorization.spec.ts`. Do not edit shared contracts here.

- [ ] **Step 1: Failing test.**

```ts
import { expect, it } from 'vitest';
import { serviceFixture, actor } from './fixtures.js';

it('denies User config reads before repository access and accepts a session Super Admin', async () => {
  const f = serviceFixture();
  const user = { ...actor, assumption: { role: 'user' as const,
    authentication: 'session' as const, source: 'local-account' as const } };
  await expect(f.service.read(user)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.repository.read).not.toHaveBeenCalled();
  expect((await f.service.read(actor)).roleAssumption).toEqual({
    role: 'super-admin', authentication: 'session', source: 'local-account',
  });
});
```

- [ ] **Step 2: Red.** `npm test -- test/admin-config/authorization.spec.ts` → FAIL: current `read()` ignores actor, legacy fixture projects disabled authentication.
- [ ] **Step 3: Minimum implementation.** Replace fixture `actor` with an authenticated-session identity and session/local-account assumption. Change `read(actor: AdminConfigActor)` to call `assertActor(actor)` before `readStored`; controller GET passes `this.actor()`. `assertActor` must be:

```ts
private assertActor(actor: AdminConfigActor): void {
  if (actor.identity.source !== 'authenticated-session' ||
      actor.assumption.role !== 'super-admin' ||
      actor.assumption.authentication !== 'session' || actor.assumption.source !== 'local-account')
    throw new AuthFault('FORBIDDEN');
}
```

Import `AuthFault`; AdminConfigFilter handles it before AdminConfigFault:

```ts
if (error instanceof AuthFault) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(error.status).json(error.body()); return;
}
```

Change `ROLE_ASSUMPTION` in `manageable-config.ts` to `authentication: 'session', source: 'local-account'`. Use P1's session-actor type for fixture User test if the legacy `AdminConfigActor` union narrows poorly; no unsafe cast or forged WorkOS role. The HTTP boundary and controller actor factory establish local-current authority; service fields are internal assertions, not an alternate browser identity source. Preserve the one config document, CAS, validation, credential flags and all activation/drain semantics. Convert existing service read tests to pass the session actor. No User-facing config-lite endpoint: existing voice config and Calendar status supply safe capabilities without Config.
- [ ] **Step 4: Green.** `npm test -- test/admin-config src/admin-config test/assembly/admin-http.spec.ts test/assembly/admin-config.spec.ts` → PASS. Add direct GET/PUT/credential POST API tests for anonymous=401, User=403, onboarding=403, Super Admin success and no sensitive body on denial. P4 handles the existing empty Analytics tab; do not implement an analytics API.
- [ ] **Step 5: Commit.** `fix(auth): restrict shared configuration reads and mutations to Super Admin`; stage each named changed file only.

## 7. Task 4 — Remove the runtime's configured-owner admission assumption

**Files:** Modify `backend/src/chat-runtime/durable-chat-runtime.ts` with Task 0 staging, `backend/src/chat-runtime/execution-reservations.ts`, `backend/test/runtime/execution-reservations.spec.ts`, `backend/test/runtime/text-config-fixture.ts`; create `backend/test/runtime/auth-owner.spec.ts`. The fixture identity source becomes `'authenticated-session'`; it is not runtime authentication.

- [ ] **Step 1: Failing test against real durable runtime/provider fixtures.**

```ts
import { expect, it } from 'vitest';
import { textConfigFixture } from './text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { principal } from '../assembly/auth-principal-fixture.js';

it('runs two owners through one runtime with captured provider attribution and no cross-owner status', async () => {
  const f = textConfigFixture(textSnapshot(1));
  try {
    const owners = [principal('u1').identity, principal('u2').identity, principal('admin', 'super-admin').identity];
    const accepted = await Promise.all(owners.map(identity => f.runtime.submitTurn({ identity,
      sessionId: null, content: `private ${identity.userId}`, idempotencyKey: 'same-key-0001' })));
    expect(new Set(accepted.map(a => a.sessionId)).size).toBe(3);
    for (let i = 0; i < owners.length; i++) await f.runtime.executeTurn({ userId: owners[i]!.userId,
      ...accepted[i]!, signal: new AbortController().signal, emit: async () => {} });
    expect(f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)).user)).toEqual(['u1', 'u2', 'admin']);
    await expect(f.runtime.getTurnStatus('u2', accepted[0]!.sessionId, accepted[0]!.turnId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.runtime.getTurnStatus('admin', accepted[0]!.sessionId, accepted[0]!.turnId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const text = JSON.stringify(f.fetcher.mock.calls[1]![1]?.body);
    expect(text).not.toContain('private u1');
  } finally { await f.dispose(); }
});
```

- [ ] **Step 2: Red.** `npm test -- test/runtime/auth-owner.spec.ts` → FAIL `IDENTITY_OVERRIDE_REJECTED` for `u1`, not a provider/network failure.
- [ ] **Step 3: Minimum implementation, durable path first.** `identity(value)` validates the schema and server-only source plus matching attribution, not the configured legacy owner:

```ts
identity(value: SubmitTurnCommand['identity']) {
  const id = resolvedIdentitySchema.parse(value);
  if (id.source !== 'authenticated-session' || id.openRouterUser !== id.userId)
    throw new AppError('IDENTITY_OVERRIDE_REJECTED', 'Identity is resolved by the server.');
  return Object.freeze({ ...id });
}
```

HTTP middleware authenticates; this internal method is not public authentication. Remove configured-owner equality guards from `attemptStreamBudgets`, `executeOwnedTurn`, `reconcileSession`, status/live/delivery/state readers, `activeSessionTurn`, `reserveStream`, `rebaseSession`. Retain repository `(userId, sessionId, ...)` lookups, record/boundary equality checks, visibility/live-mode restrictions, leases, latest-attempt checks and reservation checks. Never replace owner-qualified queries with ID-only queries.

`ExecutionReservations` constructor becomes `constructor(private readonly busy: (u: string, s: string) => Promise<boolean>) {}`. Its `identity` accepts only authenticated source and matching `openRouterUser`; `assertText` validates `idSchema.parse(u)` then checks tuple slot; `hasSession` checks tuple slot. Foreign release fails by **reservation owner comparison**, even though another legitimate owner is now admitted. Update its focused tests accordingly (foreign release expects conflict, not configured-owner rejection). Keep global 1024 entry cap.

Bind identity beside the existing attempt settings using a single `Map<string, Readonly<ResolvedIdentity>>` keyed by `attemptKey(u,s,a)` and bounded at the existing 1024 settings ceiling. Set it during both accept and retry **before awaited work** from the already validated command; delete it wherever settings are deleted, and clear only on fully drained shutdown. New live reservation checks use that captured identity; restored terminal/recovery paths may use `{ userId: attempt.userId, openRouterUser: attempt.openRouterUser, source: 'authenticated-session' }` only after reading owner-qualified durable evidence. They never infer a logged-in principal or lift admission. No auth cookies, WorkOS sid or passwords go in persisted attempts/checkpoints.

Replace durable `attemptConfig.identity: this.d.config.identity` with:

```ts
identity: { userId: a.userId },
```

`AttemptRecord.openRouterUser` must equal `a.userId` before inference; reject inconsistent stored attribution. Use this same binding for normal attempts, explicit retries and Calendar model creation. Do not replace source literals globally in arbitrary files. Keep the original dirty title line intact.
- [ ] **Step 4: Green.** `npm test -- test/runtime/auth-owner.spec.ts test/runtime/execution-reservations.spec.ts test/runtime/text-config.spec.ts` → PASS. Keep global generation concurrency assertions; do not create per-user runtimes or multiply process budgets. Onboarding denial belongs to the boundary, not an invented role field in runtime identity. The direct wrong-owner/forged-input regression bodies are in Task 15's supplement.
- [ ] **Step 5: Commit.** `feat(auth): admit captured account identities in the existing durable runtime`. Stage clean files normally and the runtime by Task 0's index-only patch. Verify the original unstaged title hunk remains.

## 8. Task 5 — Owner-key runtime caches and keep memory-first behavior

**Files:** Modify `backend/src/chat-runtime/durable-chat-runtime.ts` (isolated staging), `backend/src/chat-runtime/memory-text.ts`, `backend/src/chat-runtime/memory-first-foundation.ts`, `backend/src/chat-runtime/ports.ts`; create `backend/test/performance/auth-memory-owners.spec.ts`. Retain all eight dirty baseline files except separately staged P3 runtime hunks.

**Why this is necessary, not a core algorithm rewrite:** the existing MemoryText is an efficient single-owner component. Give the single runtime a bounded `Map<userId, MemoryText>`, explicit owner argument and **one shared epoch/capacity budget**. Its save/graph/context logic stays unchanged. Do not set `memoryFirst: null` as the authentication solution.

- [ ] **Step 1: Failing memory-path test.**

```ts
import { expect, it } from 'vitest';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { principal } from '../assembly/auth-principal-fixture.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from '../../src/chat-runtime/memory-text.js';
import type { TerminalEnvelope, SaveOutcome } from '../../src/chat-runtime/memory-first-foundation.js';

it('keeps memory replies, saves and owner-qualified lookups separate without request context', async () => {
  const saved: TerminalEnvelope[] = [];
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d, memoryFirst: {
    policy: PROPOSED_MEMORY_TEXT_POLICY, save: async (e): Promise<SaveOutcome> => {
      saved.push(e); return { kind: 'saved', epoch: e.epoch, sessionId: e.sessionId, version: e.version, fence: e.fence };
    },
  } }));
  try {
    const owners = ['u1', 'u2'].map(u => principal(u).identity);
    const rows = await Promise.all(owners.map(identity => f.runtime.submitTurn({ identity,
      sessionId: null, content: `only ${identity.userId}`, idempotencyKey: 'memory-owner-0001' })));
    for (let i = 0; i < rows.length; i++) await f.runtime.executeTurn({ userId: owners[i]!.userId,
      ...rows[i]!, signal: new AbortController().signal, emit: async () => {} });
    expect(f.runtime.memorySession('u2', rows[0]!.sessionId)).toBeNull();
    expect(f.runtime.memoryMessages('u1', rows[0]!.sessionId, { cursor: null, limit: 20 })!.items[0]!.content)
      .toBe('only u1');
    expect(f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)).user)).toEqual(['u1', 'u2']);
    expect(await f.runtime.drain(1000)).toMatchObject({ drained: true });
    expect(saved.map(e => e.userId).sort()).toEqual(['u1', 'u2']);
    expect(new Set(saved.map(e => e.epoch)).size).toBe(1);
  } finally { await f.dispose(); }
});
```

- [ ] **Step 2: Red.** `npm test -- test/performance/auth-memory-owners.spec.ts` → FAIL fixed MemoryFirstFoundation owner or wrong-owner lookup.
- [ ] **Step 3: Minimum owner compartment implementation.** Give `MemoryText` constructor `(runtime, d, ownerId: string, epoch: string)`; keep those readonly. Replace its six `d.config.identity.userId` references with `ownerId`, foundation construction uses `{ userId: ownerId, epoch }`; model config uses `{ identity: { userId: e.turn.userId }, ... }`. Capture `identity` on `Entry` at submission, and use that entry identity in live reservation checks instead of recreating `'server-configured'`. Reject `c.identity.userId !== ownerId` before touching maps in submit/retry/cancel. Do not change save envelopes, transcript visibility or the user's title behavior.

Runtime compartment lookup:

```ts
private readonly memoryOwners = new Map<string, MemoryText>();
private readonly epoch = randomUUID();
memoryFor(userId: string, create = false): MemoryText | null {
  if (!this.d.memoryFirst) return null;
  const found = this.memoryOwners.get(userId);
  if (found || !create) return found ?? null;
  // ponytail: at most 32 admitted owner compartments/process; restart or add
  // quiescent eviction if a larger installation needs more resident owners.
  if (this.memoryOwners.size >= 32) throw new AppError('CONCURRENCY_LIMIT', 'Chat capacity is unavailable.');
  const memory = new MemoryText(this, this.dependenciesFor(userId), userId, this.epoch,
    { otherCapacity: () => this.otherMemoryCapacity(userId),
      onSaveSettled: () => {
        for (const [owner, peer] of this.memoryOwners) if (owner !== userId) peer.foundation.pumpSaves();
      } });
  this.memoryOwners.set(userId, memory);
  return memory;
}
```

`memoryFor` is an internal/test composition method, not a browser API. `dependenciesFor(userId)` preserves the exact same persistence/assembler and supplies the owner-bound Calendar/config ports defined in Task 8; before that task add `private dependenciesFor(_userId: string): RuntimeDependencies { return this.d; }`. No second DurableChatRuntime or persistence connection. During acceptance only use `memoryFor(identity.userId, true)`; ordinary reads use `memoryFor(u)` and return null/fall back to the owner-qualified durable reader, never allocate on guessed IDs.

Replace **all** existing `this.memoryText` usages by explicit local selection, using this exhaustive selection guide:

| Method group | Memory owner |
| --- | --- |
| submit/retry/live submit/live handoff | validated `c.identity.userId` (create only at admission) |
| execute and executeOwnedTurn | `c.userId` |
| cancel and cancelLiveTurn | validated `c.identity.userId` |
| attempt budgets, status, live status, delivery, state, reconciliation, rebase, session/messages overlays, retrySave | method `userId` / `u` |
| voice accounting | `record.userId` |
| Calendar invalidation | `account.userId` |
| reservation busy callback | callback `u` |
| stopAccepting/snapshot/drain | every existing compartment, no ambient owner |

`processEpoch()` still returns **one runtime epoch** when memory is enabled. `memoryAdmissionReady()` reflects configured memory + process admission, not one default user's compartment. Aggregate snapshot numerical fields (`sessions`, `pending`, bytes, active, unresolved writes); preserve existing `snapshot().memory` shape used by operations tests. Drain all compartments against **one remaining deadline**, retain unknown saves and uncertainty, then drain the one persistence owner. Stop-admission affects all owners only on process shutdown, never User deactivation.

Cache repair uses tuples, not globally unique sessionId assumptions:

```ts
private sessionKey(userId: string, sessionId: string) { return JSON.stringify([userId, sessionId]); }
```

Apply it to `sessionCalendarMessages`, `sessionGraphEpoch`, `freshLiveSubmissions`; add owner argument to `trackCalendarMessage`, `trackCleanSession`, `isCalendarOrUncertain`, `isCalendarMessage` and every caller. Eviction parses the stored tuple to call `confirmedState.delete(owner, session)`. Review `accepting`, attempt settings/Calendar, receipts, confirmed state and reservations: keep their existing owner tuple, repair any delimiter-only collision (`AdmissionReceiptStore.makeKey` should use `JSON.stringify([userId,sessionId,attemptId])` if IDs permit `:`). No global cache clear for a user's disconnect.
- [ ] **Step 4: Green.** `npm test -- test/performance/auth-memory-owners.spec.ts test/performance/memory-first-text.spec.ts test/performance/memory-first-voice.spec.ts test/performance/memory-voice-observations.spec.ts test/performance/calendar-memory-first.spec.ts` → PASS. In `backend/test/performance/{calendar-memory-first,memory-first-text,memory-text-archive,memory-first-voice,voice-critical-path}.spec.ts`, replace `.memoryText!` with `.memoryFor(theFixtureIdentity.userId)!`; use `create=true` only in tests deliberately inspecting an empty newly admitted owner's compartment. Tests must name the owner explicitly, not restore a legacy default getter. Verify two owners with colliding session IDs, blocked save, retrySave, voice accounting, Calendar invalidation and cancellation cannot see/change each other's memory.
- [ ] **Step 5: Commit after Task 6 capacity assertions also pass.** `feat(auth): isolate memory-first state and runtime caches by owner`. This task and Task 6 are one atomic implementation unit; do not commit an intermediate version that multiplies process resource limits.

## 9. Task 6 — Preserve shared memory and saver ceilings across owners

**Files:** Modify `backend/src/chat-runtime/memory-first-foundation.ts`, `backend/src/chat-runtime/memory-text.ts`, `backend/src/chat-runtime/durable-chat-runtime.ts` (isolated staging); append `backend/test/performance/auth-memory-owners.spec.ts`.

- [ ] **Step 1: Failing shared-budget test.**

```ts
it('does not multiply session and byte budgets when another owner signs in', async () => {
  const policy = { ...PROPOSED_MEMORY_TEXT_POLICY, maxSessions: 1,
    maxMemoryBytes: PROPOSED_MEMORY_TEXT_POLICY.maxSessionBytes };
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d, memoryFirst: { policy,
    save: async e => ({ kind: 'saved', epoch: e.epoch, sessionId: e.sessionId, version: e.version, fence: e.fence }),
  } }));
  try {
    await f.runtime.submitTurn({ identity: principal('u1').identity, sessionId: null,
      content: 'one', idempotencyKey: 'budget-owner-0001' });
    await expect(f.runtime.submitTurn({ identity: principal('u2').identity, sessionId: null,
      content: 'two', idempotencyKey: 'budget-owner-0002' })).rejects.toMatchObject({ code: 'NOT_READY' });
  } finally { await f.dispose(); }
});
```

- [ ] **Step 2: Red.** Same focused command as Task 5 → FAIL second owner accepted under an incorrectly duplicated budget.
- [ ] **Step 3: Minimal shared capacity seam, not a second scheduler.** Extend foundation's internal options with `otherCapacity?: () => MemoryCapacity`, `onSaveSettled?: () => void`; export the local type:

```ts
export type MemoryCapacity = { sessions: number; reservedMemoryBytes: number;
  pending: number; reservedBacklogBytes: number; unresolvedWrites: number };
```

Each foundation already exposes a side-effect-free `snapshot()`. In the single runtime, sum snapshots of all **other** compartments for the callback; never call aggregate snapshot recursively. In foundation use `own + other` at the existing admission checks in `accept`, `hydrate`, `observeVoice`/`reclaimCleanObservations`, and pump's concurrent-write check. Reserve the same maximum session/envelope/observation bytes it already reserves, before mutating maps. Keep local per-session/record limits unchanged. The exact prospective global rejection predicate is:

```ts
if (total.sessions + addSessions > policy.maxSessions ||
    total.reservedMemoryBytes + addMemoryBytes > policy.maxMemoryBytes ||
    total.pending + addEnvelopes > policy.maxEnvelopes ||
    total.reservedBacklogBytes + addBacklogBytes > policy.maxBacklogBytes)
  throw new Error('Memory-first capacity exceeded; save backlog must drain.');
```

Use `addSessions=1, addMemoryBytes=policy.maxSessionBytes` only for a new owner/session; `addEnvelopes=1, addBacklogBytes=policy.maxEnvelopeBytes` for a new accepted turn. Voice observations use existing `observationBytes()` and existing new/replacement distinction. Hydration reserves a new session before insertion. Duplicate submissions do not reserve twice. Eviction removes only clean local entries, which immediately lowers aggregate snapshots; never evict another owner's dirty evidence. Both terminal and observation saver pumps check aggregate unresolvedWrites before dispatch, with no await between checking and adding the raw promise. Add `pumpSaves(): void { this.pump(); }`; when an actual raw promise settles, notify peers to pump, after removing it from rawWrites. A response timeout does **not** free the slot. Iterate a stable snapshot of peers, and ensure callback notification does not recurse synchronously into settlement.

Runtime callback body:

```ts
private otherMemoryCapacity(userId: string): MemoryCapacity {
  const total: MemoryCapacity = { sessions: 0, reservedMemoryBytes: 0,
    pending: 0, reservedBacklogBytes: 0, unresolvedWrites: 0 };
  for (const [owner, memory] of this.memoryOwners) if (owner !== userId) {
    const s = memory.foundation.snapshot();
    for (const key of Object.keys(total) as (keyof MemoryCapacity)[]) total[key] += s[key];
  }
  return total;
}
```

Final MemoryText constructor parameters are `(runtime: DurableChatRuntime, d: RuntimeDependencies, ownerId: string, epoch: string, shared: { otherCapacity: () => MemoryCapacity; onSaveSettled: () => void })`; forward `...shared` to the foundation options. Its `totalCapacity()` helper adds `snapshot()` to `options.otherCapacity?.()` (all-zero default) without mutating the snapshots. Existing standalone foundation tests omit the optional callbacks and retain their exact behavior. Do not create new memory policy values, per-user credentials/config copies, quota resets or generic semaphore dependencies.
- [ ] **Step 4: Green.** Same focused suites as Task 5 plus `test/performance/memory-first-foundation.spec.ts`. Add a deferred-saver test with three owners and `maxConcurrentSaves: 2`: third save does not dispatch until one actual promise settles; advancing timeout alone cannot dispatch it. Assert sum of reserved memory/backlog/session counts never exceeds the original policy and failed admission leaves counts unchanged.
- [ ] **Step 5: Commit together with Task 5.** Named files only; original runtime title diff must still be unstaged.

## 10. Task 7 — Bind Calendar lifecycle state to immutable explicit owners

**Files:** Create `backend/src/plugins/google-calendar/owner-registry.ts`, `backend/test/plugins/google-calendar/owner-registry.spec.ts`; modify `backend/src/plugins/google-calendar/connection.ts`, `backend/src/plugins/google-calendar/oauth.ts`; after the handoff, only the constructor argument in `backend/src/operations/calendar-assembly.ts`. Update `backend/test/plugins/google-calendar/connection-fixtures.ts`, `backend/test/plugins/google-calendar/connection-multi-fixtures.ts` to pass `userId` directly.

- [ ] **Step 1: Failing owner-registry test.**

```ts
import { expect, it, vi } from 'vitest';
import { CalendarOwnerRegistry } from '../../../src/plugins/google-calendar/owner-registry.js';

it('reuses only the same owner compartment and never resolves an ambient identity at construction', () => {
  const create = vi.fn((userId: string) => ({ userId }));
  const owners = new CalendarOwnerRegistry(create);
  expect(create).not.toHaveBeenCalled();
  const a = owners.forUser('u1'), b = owners.forUser('u2');
  expect(a).not.toBe(b);
  expect(owners.forUser('u1')).toBe(a);
  expect(create.mock.calls.map(c => c[0])).toEqual(['u1', 'u2']);
  expect(owners.values()).toEqual([a, b]);
});
```

- [ ] **Step 2: Red.** `npm test -- test/plugins/google-calendar/owner-registry.spec.ts` → missing export.
- [ ] **Step 3: Minimal registry and immutable owner.** Registry body:

```ts
import { idSchema } from '../../contracts/identifiers.js';
import { AppError } from '../../platform/errors/app-error.js';

export class CalendarOwnerRegistry<T> {
  private readonly owners = new Map<string, T>();
  constructor(private readonly create: (userId: string) => T) {}
  forUser(userId: string): T {
    idSchema.parse(userId);
    const found = this.owners.get(userId);
    if (found !== undefined) return found;
    // ponytail: 32 resident owners/process; add quiescent eviction only if
    // installation size grows. Never evict OAuth/refresh/operation evidence.
    if (this.owners.size >= 32) throw new AppError('CONCURRENCY_LIMIT', 'Plugin capacity is unavailable.');
    const created = this.create(userId); this.owners.set(userId, created); return created;
  }
  get(userId: string): T | undefined { return this.owners.get(userId); }
  values(): T[] { return [...this.owners.values()]; }
}
```

Change `ConnectionDependencies.identity: IdentityResolver` to `userId: string`; constructor assigns `this.userId = idSchema.parse(dependencies.userId)`. Remove IdentityResolver import. `createCalendarAssembly` takes explicit `userId` instead of identity and forwards it; no algorithm/tool/model change. Each instance's pendingEnabled/hardFenced/executionFenced/lifecycleEpoch/mutating, refreshFlight/v2 and discoveryService now belong only to that immutable owner. `OAuthDependencies.connections` remains the matching bound instance: pending and flowHash can stay single entries **inside that owner's service**, not a process-global map on a shared service.

Add OAuth cancellation that invalidates only its own flow and in-flight completion fence:

```ts
cancelPending(authSessionId?: string): void {
  if (authSessionId !== undefined && this.pending?.authSessionId !== authSessionId) return;
  this.pending = null; this.flowHash = null;
  this.connections.invalidateLifecycle();
}
```

Add `authSessionId: string` to process-local PendingSetup; `start(signal, authSessionId: string)` captures it, `callback(input, signal, authSessionId: string)` requires equality before consuming state. Controller passes the admitted principal's sid, never a browser field. Update existing OAuth fixtures to supply the literal `sid_fixture` on both calls. No sid enters durable OAuth state or public output. On Connections add `cancelPendingWork(): void { this.invalidateLifecycle(); this.refreshFlightV2?.controller.abort(); }`; reuse refresh/lifecycle stale-result fences without disconnecting the stored grant or permanently closing the service. Do not remove server-owned setup snapshot, browser cookie, one-use durable state, PKCE, subject/nonce verification, encryption AAD or reconnect gates. Requests cannot select `userId` in body/query. Runtime credential calls route by `account.userId`/`binding.userId`; each bound instance still verifies all account/connection/revision fields. Discovery caches, refresh coalescing and pending operations cannot migrate between compartments.
- [ ] **Step 4: Green.** `npm test -- test/plugins/google-calendar/owner-registry.spec.ts test/plugins/google-calendar/connection-multi.spec.ts test/plugins/google-calendar/connection-refresh.spec.ts test/plugins/google-calendar/discovery.spec.ts test/plugins/google-calendar/oauth.spec.ts`. Add a 33rd-owner rejection assertion, existing-owner lookup at capacity, same-owner refresh coalescing and **different-owner refresh independence** using the multi-record `calendarMemory` fixture, not `MemoryCalendarStore.record` (which intentionally holds only one record).
- [ ] **Step 5: Commit.** `fix(auth): isolate Calendar OAuth and credential lifecycles by owner`.

## 11. Task 8 — Route Calendar/runtime/config projections by captured owner

**Files:** Modify `backend/src/app.service.ts`, `backend/src/plugins/google-calendar/module.ts`, `backend/src/plugins/google-calendar/controller.ts`, `backend/src/chat-runtime/ports.ts`, `backend/src/chat-runtime/durable-chat-runtime.ts` (isolated staging), `backend/src/chat-runtime/memory-text.ts`; create `backend/test/assembly/auth-calendar.spec.ts`; update existing `backend/test/assembly/calendar-fixture.ts` and its callers to select explicit fixture owners.

- [ ] **Step 1: Failing test for per-user Calendar projection.** Extend the existing assembled fixture with explicit `service.calendarFor(userId)`; its seeded legacy fixture owner is deliberately adopted only in this test, not automatically admitted in production:

```ts
import { expect, it } from 'vitest';
import { assembledCalendarApp } from './calendar-fixture.js';

it('does not let an unconnected owner borrow another owner Calendar capability or status', async () => {
  const f = await assembledCalendarApp();
  try {
    const a = f.service.calendarFor('aurvin-dev-user');
    const b = f.service.calendarFor('u2');
    const aStatus = await a.connections.statusV2();
    const bStatus = await b.connections.statusV2();
    expect(aStatus.connectionRevision).not.toBeNull();
    expect(aStatus.state).toBe('degraded'); // This fixture intentionally uses evidence='fixture'.
    expect(bStatus.accountEmail).toBeNull();
    expect(bStatus.discovery).toBeNull();
    expect(f.service.configFor('aurvin-dev-user')!.calendar!.enabled).toBe(true);
    expect(f.service.configFor('u2')!.calendar!.enabled).toBe(false);
    expect(f.service.configFor('u2')!.revision).toBe(f.service.configFor('aurvin-dev-user')!.revision);
    expect(a.connections.userId).not.toBe(b.connections.userId);
  } finally { await f.dispose(); }
});
```

- [ ] **Step 2: Red.** `npm test -- test/assembly/auth-calendar.spec.ts` → FAIL missing explicit-owner methods or leaked global projection.
- [ ] **Step 3: Minimum routing.** AppService lazily creates each Calendar assembly through `CalendarOwnerRegistry`, passing `{ userId, store, storeV2, ...existing dependencies }`. Same Mongo/calendar stores, keys/cipher policy, fetcher, retention permission/deadlines, telemetry and activation ownership. `calendarFor(userId)` is an **internal composition port**, not an HTTP API that accepts a browser owner. Keep current status/projection cache per owner (`Map<string, CalendarStatusV2Response>` and cached base/eligibility projection); never resolve identity during startup, status refresh finally, provider refresh or shutdown. `refreshCalendarStatus(userId)` reads only that compartment. `wrapCalendarLifecycle(ownerAssembly,userId)` captures userId in every wrapper/finally. `onCalendarInvalidated(account, reason)` updates only `account.userId` projection and owner-scoped runtime caches. Existing durable retention query remains bound to account.

`currentConfig.current()` remains the one global immutable config snapshot for operations/config activation. Add `configFor(userId)` which returns the same revision/settings/budgets/credentials with a cached Calendar eligibility projection for that owner; disconnected owners get `calendar.enabled=false`, not another owner's account/status. Wrap each owner's `statusV2()` to update its cached status before returning, and capture it during full-account admission or Calendar mutation, not by resolving a startup identity. An unknown owner projection starts disabled until its own bounded status read. This is capability projection, **not** a per-user editable configuration document. `httpOptions.currentConfig` may return the request's `configFor(resolver.resolve().userId)` only at HTTP entry; accepted/background runtime paths must use explicit owner ports instead. A private-before-next hook in `configurePrivateHttp` may run `await service.prepareOwner(principal)` to refresh that owner's status, with a finite existing persistence timeout, then enter ALS; background work uses only the captured owner. Add that hook as an optional `(p:AuthPrincipal)=>Promise<void>` option, with a no-op default for isolated middleware tests.

P3-local dependency additions:

```ts
calendarFor?: (userId: string) => CalendarRuntimeDependencies;
configFor?: (userId: string) => RuntimeConfigSnapshot | null;
```

Runtime helpers:

```ts
private calendarFor(userId: string) { return this.d.calendarFor?.(userId) ?? this.d.calendar; }
private configFor(userId: string) { return this.d.configFor?.(userId) ?? this.d.currentConfig?.current() ?? null; }
private dependenciesFor(userId: string): RuntimeDependencies {
  return { ...this.d, calendar: this.calendarFor(userId),
    currentConfig: { current: () => this.configFor(userId) } };
}
```

Use explicit owner in `captureTextSettings(userId)`, `environmentContext(userId)`, Calendar preflight/run/state/recovery, and model setup. `proposalStore()` only tests whether a Calendar runtime factory exists; it must not resolve an ambient default owner. Both `currentAccount()` invocations in durable Calendar preflight/run use `calendarFor(attempt.userId)`. Reconciliation routes by its `u`, MemoryText receives bound dependencies for its fixed owner, and Calendar background tools stay bound to captured account objects. Existing `d.calendar` remains a typed fixture/legacy dependency, not an `AURVIN_USER_ID` fallback in assembled production.

GoogleCalendarModule options become lazy factories `{ connections: () => GoogleCalendarConnections; oauth: () => GoogleCalendarOAuthService; principal: () => AuthPrincipal; frontendOrigin: string }`, using the shared request store at the **controller entry** only. Capture one service/principal into local variables before any await in status/settings/calendars/refresh/start/disconnect. `start` passes `principal.sessionId`; callback completion passes the same admitted sid to its owner-bound OAuth callback. The static GET bridge needs no private factory. Do not return raw registry contents or provider credentials. Config, voice capability and plugin status routes are independent; Users never call Config first.

Shutdown stops/drains **all instantiated owner assemblies**, sums activeExecutions and retains uncertainty. Existing global concurrency/tool request/provider/storage admission must remain shared; an owner assembly is not an extra runtime or a new per-owner OpenRouter concurrency quota. Keep policy/TLS/ingress restrictions unchanged.
- [ ] **Step 4: Green.** `npm test -- test/assembly/auth-calendar.spec.ts test/assembly/calendar-capability.spec.ts test/assembly/calendar-invalidation.spec.ts test/assembly/calendar-multi-flow.spec.ts test/performance/calendar-memory-first.spec.ts`. Add two connected owners with different account/discovery labels and a delayed refresh, invalidate/disconnect one, assert the other's status/default/cache/credentials/active attempt stay unchanged. Test credential/config revision edits: A accepted under revision 1 keeps it, new A and B work uses revision 2, and usage is not reset.
- [ ] **Step 5: Commit.** `feat(auth): route plugin capabilities and background Calendar work by owner`; isolate runtime staging.

## 12. Task 9 — Complete Calendar OAuth safely with Strict auth cookies

**Files:** Create `backend/src/plugins/google-calendar/oauth-callback-page.ts`, `backend/test/plugins/google-calendar/auth-oauth-callback.spec.ts`; modify `backend/src/plugins/google-calendar/controller.ts`, `backend/src/plugins/google-calendar/controller-http.ts`, `backend/src/plugins/google-calendar/oauth.ts`.

**Contract:** `GET /api/plugins/google-calendar/oauth/callback` returns a static same-origin HTML landing document, never exchanges a code, reads private state, chooses an account or installs a grant. Its script POSTs `{ rawQuery }` to `/api/plugins/google-calendar/oauth/complete` after the browser is on Aurvin's origin. That POST must authenticate the Strict session cookie, pass exact origin/Calendar CSRF/body checks, and complete only the **current account's** pending state. The OAuth browser cookie path becomes `/api/plugins/google-calendar/oauth` so complete can read it; HttpOnly/Lax/600s remain, Secure on HTTPS. No requirement to relax the auth cookie to Lax or trust state alone.

- [ ] **Step 1: Failing regression code.**

```ts
import { expect, it } from 'vitest';
import { oauthCallbackPage } from '../../../src/plugins/google-calendar/oauth-callback-page.js';
import { oauthCookie, clearOAuthCookie } from '../../../src/plugins/google-calendar/oauth.js';

it('uses a static same-origin completion page without reflecting provider query or installing a grant', () => {
  const page = oauthCallbackPage();
  expect(page).toContain("credentials: 'same-origin'");
  expect(page).toContain('/api/plugins/google-calendar/oauth/complete');
  expect(page).toContain('location.search.slice(1)');
  expect(page).toContain('history.replaceState');
  expect(page).not.toContain('document.cookie');
  expect(oauthCookie('a'.repeat(43))).toContain('Path=/api/plugins/google-calendar/oauth;');
  expect(clearOAuthCookie()).toContain('Path=/api/plugins/google-calendar/oauth;');
});
```

- [ ] **Step 2: Red.** `npm test -- test/plugins/google-calendar/auth-oauth-callback.spec.ts` → FAIL missing page or old cookie path.
- [ ] **Step 3: Minimum static page.**

```ts
import { createHash } from 'node:crypto';

const completionScript = `(async () => {
  const rawQuery = location.search.slice(1);
  history.replaceState(null, '', location.pathname);
  try {
    const r = await fetch('/api/plugins/google-calendar/oauth/complete', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Aurvin-Calendar-CSRF': '1' },
      body: JSON.stringify({ rawQuery })
    });
    if (!r.ok) throw new Error('Calendar setup failed');
    const result = await r.json();
    if (!['connected', 'fixture', 'cancelled', 'failed'].includes(result.outcome)) throw new Error('Calendar setup failed');
    location.replace('/?plugin=google-calendar&oauth=' + encodeURIComponent(result.outcome));
  } catch { document.getElementById('status').textContent = 'Sign in to Aurvin and start the Calendar connection again.'; }
})();`;
export function oauthCallbackCsp(): string {
  const hash = createHash('sha256').update(completionScript).digest('base64');
  return `default-src 'none'; script-src 'sha256-${hash}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`;
}
export function oauthCallbackPage(): string {
  return `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>Completing Calendar connection</title><p id="status">Completing Calendar connection…</p>
<script>${completionScript}</script>`;
}
```

Return with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `Content-Security-Policy: oauthCallbackCsp()`. The document contains **only static strings**. Never interpolate code/state/error/query into HTML or log them. The page accepts no external completion/redirect URL; successful navigation stays same-origin. Failed completion does not consume another owner's state or silently reassign it.

Controller POST uses strict `z.object({rawQuery:z.string().max(8192)}).strict()`, captures admitted `oauth` and principal, calls existing `callback({ rawQuery, cookieHeader }, abortOf(req), principal.sessionId)`, appends the scoped OAuth clear cookie and returns `{ outcome }`. Cookie append preserves refreshed auth cookie. GET replaces previous grant-exchanging behavior. Delete process-global `callbackInFlight` in controller-http (owner OAuth state already serializes/rejects replay); keep bounded general rate/body checks. Recognize `/oauth/complete` as an ordinary POST with origin + existing CSRF header. First GET is the only unauthenticated Calendar exception and must never access a private service.

**Separate-origin local deployment:** this workflow admits same-origin browser UI/API through Vite/nginx. The callback page's completion Origin must match configured frontend origin. Verify proxy Host/Origin handling with the existing Calendar boundary; if a configured callback bypasses Vite onto backend:3000 while UI is frontend:5173, fail closed and require the documented same-origin proxy callback URL/allowlisted host configuration. Do not broaden origin acceptance or add a second login origin to make a split-origin callback work.
- [ ] **Step 4: Green.** Run focused callback, OAuth, controller HTTP and assembly Calendar tests. Add behavioral POST tests using real P1 auth fixture: anonymous completion=401 without exchange; B with A's query/browser cookie rejected before `consumeState`/exchange for A; expired/replayed state denied; deactivation during exchange makes `isCurrentFlow` false and prevents installation; successful A and B starts/finishes do not replace each other. P6 must test actual browser Strict-cookie navigation using deterministic origins; a static string test is not browser evidence.
- [ ] **Step 5: Commit.** `fix(auth): bind Calendar OAuth completion to the initiating signed-in owner`.

## 13. Task 10 — Separate voice HTTP ownership from bound background lifecycle

**Files:** Modify `backend/src/voice/session/voice-session.service.ts`, `backend/src/voice/session/voice-session.options.ts`, `backend/src/voice/session/voice-session.controller.ts`, `backend/src/app.service.ts`; create `backend/test/voice/session/auth-owners.spec.ts`; adapt `backend/test/voice/session/fixtures.ts` to an admitted-store resolver (or a narrow explicit identity stub), not a config-default resolver.

- [ ] **Step 1: Failing voice lifecycle test.**

```ts
import { expect, it, vi } from 'vitest';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { options, origin, request } from './fixtures.js';
import { principal } from '../../assembly/auth-principal-fixture.js';
import { RequestIdentityStore } from '../../../src/platform/identity/request-identity-store.js';

it('keeps DELETE owner-checked while internal cleanup works outside request identity', async () => {
  const o = options(), a = principal('u1'), b = principal('u2');
  const identities = new RequestIdentityStore(), resolve = vi.spyOn(identities, 'resolve');
  const service = new VoiceSessionService(o);
  const first = await identities.run(a, () => service.create(request, origin, a));
  try {
    await expect(service.endOwned(first.response.sessionId, b)).rejects.toMatchObject({ code: 'VOICE_BINDING_MISMATCH' });
    expect(service.snapshot().active).toBe(1);
    await service.end(first.response.sessionId);
    expect(service.snapshot().active).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
  } finally { await service.drain(); }
});
```

- [ ] **Step 2: Red.** `npm test -- test/voice/session/auth-owners.spec.ts` → FAIL missing owner method or ambient `end()` lookup.
- [ ] **Step 3: Minimum implementation.** `create(body,origin,principal: AuthPrincipal)` stores frozen `principal.identity` and a private auth-session binding (`authSessionId: string`, `sessionEpoch: number`) on VoiceBinding; require full account at entry. `createOnce` takes that principal too and derives its local `identity` from it. Remove the now-unused `identity` option from VoiceSessionOptions/AppService voice options; do not leave an unused ambient identity dependency. Keep owner+idempotency key/pending map. Never put auth sid/cookie in the public response, LiveKit claims, speech logs or durable transcript. Add required `assertAccountCurrent(principal: AuthPrincipal): Promise<void>` option supplied by AppService: read the lazy users repository, call `admitAccount(current?.account ?? null, principal.sessionId)` and `requireFullAccount`; compare sessionEpoch as the race fence. In the isolated voice fixture replace its old identity option with `assertAccountCurrent: vi.fn(async () => undefined)` and use explicit test principals; production always supplies the real repository check. Recheck after awaited admission/reservation and **before returning/issuing capability**; if invalidated while creating, stop/end the bound entry and release reservation/admission without issuing usable new response. Existing token lifetime/room teardown limits remain.

Keep `end(id)` internal and entry-bound (remove `resolve` comparison). Add external check:

```ts
async endOwned(id: string, principal: AuthPrincipal): Promise<void> {
  requireFullAccount(principal);
  const entry = this.entries.get(id);
  if (entry && (entry.identity.userId !== principal.identity.userId || entry.authSessionId !== principal.sessionId))
    fault('VOICE_BINDING_MISMATCH');
  await this.end(id);
}
```

HTTP controller injects the shared RequestIdentityStore; config/create/DELETE full-session identity comes from it, and DELETE calls endOwned. Change controller Set-Cookie to append. `claim(cookie,origin,principal,expectedMode)` requires cookie-authenticated matching user **and authSessionId**, plus existing ticket/mode/expiry/epoch checks; it never resolves the process identity. `claimLive` requires actual participantIdentity **and roomName**, verifies their full existing signed/server-issued binding against entry; remove optional identity-free shortcut and ambient lookup. It is internal LiveKit capability admission, not arbitrary HTTP identity. Internal `assertPaidWork`, timer/sweep/stop/end/drain use entry owner and admission state only. Remove all ambient resolver calls except actual request entry (which now has principal explicitly).

Add `stopUser(userId, sessionId?: string)` that selects entries by stored owner and optional auth sid, invalidates tickets synchronously, then invokes existing terminal/cleanup/teardown/release for those entries. It must not call global `stopAccepting`, clear usage, or stop another account. Use existing terminal reasons (shutdown/interrupted semantics) without extending shared wire enums; do not label cancelled inference as successfully completed. `AppService.openLiveBridge` continues to pass validated server participantIdentity/roomName and uses `end` internally.
- [ ] **Step 4: Green.** `npm test -- test/voice/session test/voice/agent test/voice/usage test/voice/integration/webrtc-lifecycle.spec.ts` → PASS. Include owner-bound token room claims, shared voice quotas, foreign conversation IDs, reconnect after expired/deactivated cookie, delayed admission invalidation, internal LiveKit end outside ALS and one-owner stop with the other still active. No actual speech/LiveKit/provider network.
- [ ] **Step 5: Commit.** `fix(auth): bind voice capabilities and cleanup to their authenticated owner`.

## 14. Task 11 — Authenticate dictation WS upgrades before 101

**Files:** Create `backend/src/voice/transport/authenticated-ws-adapter.ts`, `backend/test/voice/transport/auth-upgrade.spec.ts`; modify `backend/src/voice/transport/voice.gateway.ts`, `backend/src/main.ts` and `backend/test/voice/transport/gateway.integration.spec.ts`/`gateway.spec.ts` fixture wiring.

- [ ] **Step 1: Write an actual loopback handshake regression, not just a gateway mock.**

```ts
import { once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { expect, it, vi } from 'vitest';
import { AuthenticatedWsAdapter, VoiceUpgradeAdmission } from '../../../src/voice/transport/authenticated-ws-adapter.js';
import { AuthFault } from '../../../src/auth/errors.js';

it('rejects unauthenticated upgrades before 101 and before voice ticket consumption', async () => {
  const server = createServer();
  const auth = { authenticate: vi.fn(async () => { throw new AuthFault('UNAUTHENTICATED'); }) };
  const admission = new VoiceUpgradeAdmission(auth, {
    frontendOrigin: 'http://127.0.0.1:5173', secureCookie: false,
    developmentLoopback: true, trustedHttpsIngress: () => false,
  });
  const adapter = new AuthenticatedWsAdapter(server, admission);
  const ws = adapter.create(0, { path: '/api/voice', maxPayload: 131072, perMessageDeflate: false });
  const connected = vi.fn(); ws.on('connection', connected);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No loopback port');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/api/voice`, {
    headers: { Origin: 'http://127.0.0.1:5173' },
  });
  try {
    const response = new Promise<number>((resolve, reject) => {
      client.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode!); });
      client.once('open', () => reject(new Error('Unauthenticated upgrade succeeded')));
      client.once('error', () => {});
    });
    expect(await response).toBe(401);
    expect(connected).not.toHaveBeenCalled();
  } finally {
    client.terminate(); await adapter.close(ws); await adapter.dispose();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
```

- [ ] **Step 2: Red.** `npm test -- test/voice/transport/auth-upgrade.spec.ts` → FAIL missing adapter/unauthenticated 101.
- [ ] **Step 3: Minimal adapter.** Keep one upgrade-admission object shared by the adapter and gateway. This avoids constructing a Nest adapter before its HTTP server exists, and is not a second auth service. File body:

```ts
import type { IncomingMessage } from 'node:http';
import { WsAdapter } from '@nestjs/platform-ws';
import type { WebSocketServer } from 'ws';
import type { AuthPrincipal } from '../../contracts/auth.js';
import type { AuthService } from '../../auth/auth.service.js';
import { readSessionCookie, sessionCookie } from '../../auth/cookies.js';
import { requireFullAccount } from '../../auth/access.js';
import { AuthFault } from '../../auth/errors.js';

type UpgradeOptions = { frontendOrigin: string; secureCookie: boolean;
  developmentLoopback: boolean; trustedHttpsIngress: (req: IncomingMessage) => boolean };
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const loopbackPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function countHeader(req: IncomingMessage, name: string): number {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]!.toLowerCase() === name) count++;
  return count;
}
export class VoiceUpgradeAdmission {
  private readonly admitted = new WeakMap<IncomingMessage, { principal: AuthPrincipal; sealedSession?: string }>();
  constructor(private readonly auth: Pick<AuthService, 'authenticate'>, private readonly o: UpgradeOptions) {}
  async verify(req: IncomingMessage): Promise<void> {
    const origin = new URL(this.o.frontendOrigin);
    let host = '';
    try { host = new URL(`http://${req.headers.host ?? ''}`).hostname; } catch { /* denied below */ }
    const local = this.o.developmentLoopback && origin.protocol === 'http:' &&
      loopbackHosts.has(origin.hostname) && loopbackHosts.has(host) &&
      loopbackPeers.has(req.socket.remoteAddress ?? '');
    if (req.url !== '/api/voice' || countHeader(req, 'origin') !== 1 || countHeader(req, 'host') !== 1 ||
        req.headers.origin !== this.o.frontendOrigin || req.headers['sec-fetch-site'] === 'cross-site' ||
        (!local && !(origin.protocol === 'https:' && this.o.trustedHttpsIngress(req))))
      throw new AuthFault('FORBIDDEN');
    const result = await this.auth.authenticate(readSessionCookie(req.headers.cookie));
    requireFullAccount(result.principal); this.admitted.set(req, result);
  }
  appendHeaders(headers: string[], req: IncomingMessage): void {
    const sealed = this.admitted.get(req)?.sealedSession;
    if (sealed) headers.push(`Set-Cookie: ${sessionCookie(sealed, this.o.secureCookie)}`);
  }
  takePrincipal(req: IncomingMessage): AuthPrincipal {
    const result = this.admitted.get(req); this.admitted.delete(req);
    if (!result) throw new AuthFault('UNAUTHENTICATED');
    return result.principal;
  }
}
export class AuthenticatedWsAdapter extends WsAdapter {
  constructor(serverOrApp: object, private readonly admission: VoiceUpgradeAdmission) { super(serverOrApp); }
  override create(port: number, options: Record<string, unknown> = {}): WebSocketServer {
    const server = super.create(port, { ...options,
      verifyClient: (info: { req: IncomingMessage }, done: (ok: boolean, code?: number) => void) => {
        void this.admission.verify(info.req).then(() => done(true), error =>
          done(false, error instanceof AuthFault ? error.status : 503));
      },
    }) as WebSocketServer;
    server.on('headers', (headers, req) => this.admission.appendHeaders(headers, req));
    return server;
  }
}
```

Every rejected request remains absent from the WeakMap. Successful headers precede gateway take. Existing bounded provider slots/timeout cap outstanding upgrade authentication; a disconnected pending handshake must not consume a voice ticket. Create `service.voiceUpgrades = new VoiceUpgradeAdmission(service.auth, options)` once after auth creation, expose it through a Nest provider token `VoiceUpgradeAdmission`, and use `new AuthenticatedWsAdapter(app, service.voiceUpgrades)` in configureApplication. Gateway injects that shared admission object and calls `takePrincipal(request)` then `sessions.claim(cookie,origin,principal,'dictation')`. Subsequent frame/close handlers use the bound VoiceBinding; do not hold ALS open as the socket's identity mechanism. No separate WS auth protocol/browser bearer token. Reuse trusted HTTPS ingress/development policy; widen its argument to IncomingMessage where required rather than duplicating a permissive transport check.
- [ ] **Step 4: Green.** `npm test -- test/voice/transport/auth-upgrade.spec.ts test/voice/transport/gateway.spec.ts test/voice/transport/gateway.integration.spec.ts`. Add success with both cookies, foreign owner's valid auth cookie plus stolen ticket denied before STT, missing/expired/onboarding/inactive/stale session, wrong Origin, refreshed Set-Cookie retained, live ticket not consumed by dictation gateway and ticket replay denied. Existing tests expecting 1008 for invalid tickets still do; invalid **authentication** now fails handshake with 401/403.
- [ ] **Step 5: Commit.** `feat(auth): authenticate dictation WebSocket upgrades before capability claim`.

## 15. Task 12 — Assemble P1/P2 once and preserve exact-origin credential handling

**Files:** Modify `backend/src/app.service.ts`, `backend/src/app.module.ts`, `backend/src/main.ts`, `backend/src/http/chat-http.service.ts`, `backend/src/http/options.ts`; create `backend/test/assembly/auth-wiring.spec.ts`; adapt `backend/test/assembly/admin-config-fixture.ts`, `backend/src/app.controller.spec.ts`, existing main/bootstrap assembly tests. P1/P2 internals remain owned upstream.

- [ ] **Step 1: Failing single-owner wiring test using the offline assembly fixture.**

```ts
import { expect, it } from 'vitest';
import { AppService } from '../../src/app.service.js';
import { RequestIdentityStore } from '../../src/platform/identity/request-identity-store.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { assemblyFixture } from './admin-config-fixture.js';
import { authFixture } from '../auth/fixtures.js';
import { principal } from './auth-principal-fixture.js';

it('shares one persistence/runtime and never manufactures a diagnostic Super Admin', async () => {
  const f = assemblyFixture(), auth = await authFixture();
  Object.assign(f.bundle, { users: auth.users });
  const identities = new RequestIdentityStore();
  const identity = new ServerIdentityResolver(identities);
  const service = await AppService.create(f.bootstrap, { ...f.ports, identities, identity, authProvider: () => null });
  try {
    expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.runtime).toHaveBeenCalledTimes(1);
    expect(() => service.adminActor()).toThrow('UNAUTHENTICATED');
    const actor = identities.run(principal('admin', 'super-admin'), () => service.adminActor());
    expect(actor.assumption.authentication).toBe('session');
    await expect(service.auth.authenticate(null)).rejects.toMatchObject({ code: 'NOT_READY' });
  } finally { await service.operations.shutdown(); }
  expect(f.close).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Red.** `npm test -- test/assembly/auth-wiring.spec.ts` → FAIL missing assembly auth/identity ports or old default actor.
- [ ] **Step 3: Minimum composition.** Add these optional ports to AssemblyPorts (test-only injection as existing ports, never browser/environment bypasses):

```ts
identities?: RequestIdentityStore;
identity?: ServerIdentityResolver;
authProvider?: (config: BootstrapConfig['workos']) => AuthProvider | null;
```

Default AppService static factory creates a paired store/resolver only for non-Nest test construction; production AssemblyModule injects `[AURVIN_CONFIG, RequestIdentityStore, ServerIdentityResolver]` and passes those same objects. Constructor never calls resolve. Lazy `users` delegate forwards all six repository methods through `store().users`; reads/writes are unavailable without admitted storage. Track dispatched auth/account writes through existing config job/lifecycle owner so shutdown cannot close Mongo while a login/session CAS is pending. Do not open Mongo again.

Create one provider from `bootstrap.workos` (else null), one AuthService with lazy users, and one `AdministrationService` using **the same users/provider** and post-confirmed deactivation hook. AuthModule receives `service.auth`, HTTPS Secure cookie flag. AdministrationModule receives `{ service: service.administration, principal: () => service.identities.principal() }`; it receives an admitted principal reader, **not** an invented `auth` module option. Export required providers across AssemblyModule imports as in existing registerAsync modules. Exact P2 wiring:

```ts
// Declare `readonly administration: AdministrationService` on AppService.
// In its constructor, after auth/provider initialization:
this.administration = new AdministrationService({ users: this.users,
  provider: this.authProvider, onUserDeactivated: userId => this.onUserDeactivated(userId) });
// Within AppModule imports; construction above occurs after provider initialization.
AdministrationModule.registerAsync({ imports: [AssemblyModule], inject: [AppService],
  useFactory: (service: AppService) => ({ service: service.administration,
    principal: () => service.identities.principal() }) }),
```

Do not initialize the service field before the shared provider/users delegates exist.

`adminActor()` becomes `return this.identities.adminActor()`. `httpOptions(identity)` uses that shared resolver. Add `principal: () => AuthPrincipal` to the P3-local ChatHttpOptions and return `principal: () => this.identities.principal()` from assembly. The HTTP fixture supplies `principal: () => principal('server-user')` explicitly; this is not an optional production fallback. Every ChatHttpService method captures `const identity = this.o.identity.resolve()` once at entry; repeated lookups after awaits become `identity.userId`. Submission/retry/cancel pass its frozen identity to the runtime; stream captures both principal/userId before its async status branch. Existing DTO override rejection stays.

`configureApplication` order is deliberately fixed:

1. Get the one AppService, attach stream transport, set `api` prefix and the authenticated WsAdapter.
2. `enableCors({ origin: exactConfiguredOrigin, credentials: true, ...existing explicit methods/headers, preflightContinue: true })`; add `DELETE` for existing voice DELETE, keep PATCH/Calendar header where admitted, no wildcard/null/multiple origins.
3. Complete valid OPTIONS preflight (reject unexpected Origin, no auth/provider call).
4. `configureAuthHttp` with existing trusted ingress check, then `configurePrivateHttp` before **all private parsers, operational generation admission and controller work**. An anonymous private request must receive 401, not an operations NOT_READY response based on a missing model.
5. Install existing operations middleware (safe live stays public), Calendar HTTP/chat boundary, AdminConfig HTTP, and P2's bounded Administration HTTP boundary with unchanged ingress restrictions. Private paths run inside admitted ALS. P2 boundary parses credential JSON before the generic parser; auth routes retain their P1 parser.
6. `configureChatHttp` last, then Nest route initialization/listen.

Do not remove Basic auth, loopback bind, Calendar deployment/policy restriction or diagnostic liveness. After its explicit handoff, add only `authenticationReady?: () => boolean` to `OperationsOptions`; in both `Readiness.read` branches append static issue `'authentication'` when that delegate exists and returns false, and make `readReady` false in that case. AppService supplies `() => this.authProvider !== null && this.persistence !== null`. Existing standalone operation fixtures omit it and keep their behavior; no paid health calls or account data. Invalid private auth errors are safe 401/403/503, never an implicit configured user. Authentication still gates private readiness HTTP; the injected readiness assertion tests missing-provider diagnostic state internally, not a fabricated public account bypass.
- [ ] **Step 4: Green.** `npm test -- test/assembly/auth-wiring.spec.ts src/app.controller.spec.ts test/assembly/admin-http.spec.ts test/assembly/calendar-http.spec.ts test/voice/transport/gateway.integration.spec.ts`. Add real assembled REST tests with P1 fixture cookies (Super Admin + two Users), exact-origin Access-Control-Allow-Credentials, denied evil-origin mutation despite a valid cookie, refresh+OAuth/voice multiple Set-Cookie, liveness without WorkOS and private routes/readiness unavailable. This is P3 assembly evidence, not P6's final integrated acceptance report.
- [ ] **Step 5: Commit.** `feat(auth): compose authentication and administration into the existing backend`.

## 16. Task 13 — Target deactivation/logout cleanup, not process shutdown

**Files:** Modify `backend/src/app.service.ts`, `backend/src/http/chat-stream.transport.ts`, `backend/src/chat-runtime/work.ts`, `backend/src/chat-runtime/ports.ts`, `backend/src/chat-runtime/durable-chat-runtime.ts` (isolated staging), `backend/src/chat-runtime/memory-text.ts`, `backend/src/voice/session/voice-session.service.ts`; create `backend/test/assembly/auth-deactivation.spec.ts`; append `backend/test/runtime/work.spec.ts`.

- [ ] **Step 1: Failing targeted work test.**

```ts
import { expect, it } from 'vitest';
import { WorkRegistry } from '../../src/chat-runtime/work.js';

it('interrupts one owner without fencing another owner or closing admission', async () => {
  const work = new WorkRegistry(4);
  const a = work.open('u1', 'same-session', new AbortController().signal, 1000);
  const b = work.open('u2', 'same-session', new AbortController().signal, 1000);
  try {
    work.interruptUser('u1');
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(work.accepting).toBe(true);
    expect(work.fenced).toBe(false);
  } finally { a.close(); b.close(); }
});
```

- [ ] **Step 2: Red.** `npm test -- test/runtime/work.spec.ts -t "interrupts one owner"` → FAIL missing method.
- [ ] **Step 3: Minimum lifecycle integration.** WorkRegistry method:

```ts
interruptUser(userId: string): void {
  for (const [key, job] of this.jobs) {
    const [owner] = JSON.parse(key) as [string, string];
    if (owner === userId) job.abort('INTERRUPTED');
  }
}
```

SSE transport attachments store `{ userId, authSessionId, abort, response, writer }`, not only writer/null. Capture current admitted principal once when opening; never re-resolve inside emit/close callbacks. `closeUser(userId, sessionId?)` aborts and closes only matching responses, including pending writers. Keep reservation held until runtime persistence cleanup settles; do not remove job/lease as proof of successful cancellation. Use existing interrupted terminal path, no fake completed frame.

P3-local runtime lifecycle method `interruptUser(userId): Promise<void>` aborts matching jobs, finalizes only that owner's not-running accepted memory entries through `finish(...,'interrupted',...)`, and cancels pending durable accepted attempts through existing `cancelOwnedTurn`/reconciliation rather than simply deleting receipt/settings entries. For durable accepted attempts, iterate bounded owner-qualified pending bindings already captured at acceptance (keyed owner/session/attempt with turnId), not an unbounded sessions scan; keep failed writes/unknown finalizing state for reconciliation. Do not erase unsaved memory, start inference, delete leases, or call process-wide stopAccepting/drain/quiesce. Keep the owner compartment reusable after a **new valid login**; `MemoryText.stopPending()` stops admission irreversibly and therefore is only for process drain. Add `interruptPending()` that finishes waiting entries without stopping the foundation; share its loop with stopPending.

AppService `onUserDeactivated(userId)` first invalidates that user's pending OAuth flow/creation epoch synchronously, then attempts **all** existing cleanup mechanisms via Promise.allSettled: raw-runtime interruptUser, stream closeUser, voice stopUser, and `calendarRegistry.get(userId)?.connections.cancelPendingWork()`. Call the owner's `oauth.cancelPending()`; do not instantiate a compartment just to close it. Do not call irreversible `connections.close()`, disconnect/delete the saved Calendar grant or perform privacy redaction merely because an account becomes inactive. Runtime/tool abort signals stop active Calendar operations where supported; in-flight mutations retain honest durable/unknown outcomes and no-retry-after-unknown rules. Reactivation is P2's status change and never revives old tickets, cookie sid, sockets or provider execution.

P2 calls the hook only after confirmed local invalidation. Cleanup errors cannot undo deactivation or cause a success lie about durable completion; report a safe telemetry allowlisted cleanup-failed code and retain uncertainty. Use the same hook option rather than importing AppService into AdministrationService. Newly arriving requests re-read local account through AuthService and reject inactive status immediately, regardless of cleanup success.

Logout stays owned by P1. In AppService wrap its bound `auth.logout(principal)` once: preserve its local invalidation/provider revoke and always close matching `userId + sessionId` streams/voice/OAuth flows in a finally block. Do not use an unscoped global drain, clear another account's client/server state, or make another session's work look successful. One WorkOS sid/account is P1's deliberate ceiling; even so match sid for transport cleanup. Captured text attempts retain owner attribution after disconnect; existing cancellation mechanisms may finish/charge. P4 closes browser-owned streams/media on logout/session expiry; backend has no claim that provider capabilities revoke instantly on cookie clearing.
- [ ] **Step 4: Green.** `npm test -- test/runtime/work.spec.ts test/assembly/auth-deactivation.spec.ts test/http/stream-transport.spec.ts test/voice/session/auth-owners.spec.ts`. Add actual fixture assertions: confirmed deactivate blocks stale cookie even if cleanup throws; A text/SSE/dictation/live/OAuth are stopped, B continues, completed/unknown writes retained, reactivation alone cannot reclaim old work, valid new login can start fresh; deactivation during delayed voice creation/OAuth exchange cannot publish a capability/grant; logout affects matching sid only. Auth/service mutation ownership remains P1/P2—route defects back rather than changing their modules silently.
- [ ] **Step 5: Commit.** `fix(auth): stop deactivated account work without disrupting other owners`.

## 17. Task 14 — Recover all mapped owners through one maintenance lifecycle

**Files:** After explicit handoff modify `backend/src/operations/local-recovery.ts`, `backend/test/operations/local-recovery.spec.ts`, `backend/src/app.service.ts`; add `backend/test/operations/auth-multi-owner-recovery.spec.ts`. Do not touch dirty `backend/src/persistence/sessions.ts` or change repository recovery queries.

- [ ] **Step 1: Failing no-inference maintenance test.**

```ts
import { expect, it, vi } from 'vitest';
import { finishLocalMaintenanceForUsers } from '../../src/operations/local-recovery.js';
import { options } from './fixtures.js';
import type { MongoOwnership } from '../../src/persistence/ownership.js';
import type { UsersRepository } from '../../src/contracts/auth.js';
import { account } from '../auth/fixtures.js';

it('finishes recovery only after both active and inactive account owners are scanned', async () => {
  const maintenance = options().runtime, fresh = options().runtime;
  vi.spyOn(maintenance, 'snapshot').mockReturnValue({ accepting: false, active: 0, unresolvedWrites: 0, degraded: false });
  vi.spyOn(maintenance, 'drain').mockResolvedValue({ drained: true, active: 0, unresolvedWrites: 0 });
  const listForRecovery = vi.fn(async (_userId: string, _page: unknown) => ({ items: [], nextCursor: null }));
  const finish = vi.fn(async () => undefined);
  const create = vi.fn().mockReturnValueOnce(maintenance).mockReturnValueOnce(fresh);
  const owner = { finishLocalRecovery: finish } as unknown as MongoOwnership;
  const users: Pick<UsersRepository, 'list'> = { list: vi.fn(async () => ({ items: [
    { account: account({ userId: 'u1', status: 'active' }), revision: 1 },
    { account: account({ userId: 'u2', status: 'inactive' }), revision: 2 },
  ], nextCursor: null })) };
  expect(await finishLocalMaintenanceForUsers(owner, { listForRecovery }, users, ['old'], 1000, create)).toBe(fresh);
  expect(listForRecovery.mock.calls.map(c => c[0])).toEqual(['u1', 'u2']);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(2);
  expect(maintenance.executeTurn).not.toHaveBeenCalled();
});
```

The helper's users parameter is `Pick<UsersRepository,'list'>`; the fixture uses complete AccountRead records and no application data.
- [ ] **Step 2: Red.** `npm test -- test/operations/auth-multi-owner-recovery.spec.ts` → missing multi-owner function.
- [ ] **Step 3: Minimum maintenance wrapper.** Export `finishLocalMaintenanceForUsers(owner,sessions,users,ancestors,drainMs,createRuntime)`. Construct **one maintenance runtime**, authorize stopped ancestors once, stop admission, page users at 50 with finite 1000-page/non-advancing cursor guards and scan each owner's `sessions.listForRecovery` through existing `reconcilePage`; include inactive accounts because durability is independent of login. Use one startup deadline, and keep existing per-owner 50,000-row scan ceiling plus a finite total-row/page bound. Drain maintenance once after all scans; call `owner.finishLocalRecovery()` only after drained; then create the one fresh admission runtime, never one per owner. Failures retain pending ancestry and never dispatch model inference.

Keep existing single-owner helper for explicitly scoped operations/tests if still called; factor only the bounded scan loop so the maintenance wrapper does not finish a sentinel per user. AppService passes lazy `users`, not a single configured-owner recovery argument. For the legacy pre-adoption case, AppService may perform a **read-only existence probe** `sessions.listForRecovery(bootstrap.identity.userId,{cursor:null,limit:1})` only if `users.get(bootstrap.identity.userId)` is null. If that probe finds legacy recovery rows, refuse completion with static operator pre-adoption guidance; never reconcile/mutate those rows as an automatically admitted identity. This uses the legacy ID as an operator diagnostic selector, not a login/work fallback. P5 owns the stopped-application/preflight/adoption sequence. Do not mutate legacy records or invent ownership during P3 checks.
- [ ] **Step 4: Green.** `npm test -- test/operations/auth-multi-owner-recovery.spec.ts test/operations/local-recovery.spec.ts test/runtime/local-reconciliation.spec.ts`. Test second-user failure prevents finish/fresh runtime, non-advancing account and session cursors, total deadline exhaustion, inactive user inclusion, empty/unmapped pre-adoption refusal and exactly one persistence close on failure. Native recovery remains separate, operator-prerequisite evidence.
- [ ] **Step 5: Commit.** `fix(auth): reconcile stopped work across mapped account owners`.

## 18. Task 15 — Close the caller inventory and verify P3, without claiming final acceptance

**Files:** Focused fixture/test changes in owned subsystems only. No application manifests, shared contract edits, frontend changes, state ownership changes or new P6 final-report artifacts.

- [ ] **Step 1: Run the caller inventory.** Repository root:

```powershell
rg -n 'identity\.resolve\(|new ServerIdentityResolver|config\.identity|bootstrap\.identity|server-configured|calendarStatus|refreshFlight|flowHash|currentAccount\(' backend/src
rg -n 'new DurableChatRuntime|new AppService|openPersistence|closePersistence' backend/src/app.service.ts backend/src/app.module.ts backend/src/main.ts
```

Expected runtime result: no browser fallback, no singleton last-caller identity, no background ambient resolution. Remaining bootstrap.identity references are configuration compatibility/operator selection only, never work admission/attribution/recovery. Runtime/Calendar constructors use explicit immutable owner inputs; one admitted Durable runtime, one persistence lifecycle. P1 compatibility literals are removed by its owner handoff; P5's operator script update remains an explicit upstream/downstream item, not a reason to leave browser bypasses.

- [ ] **Step 2: Complete direct isolation checks at the real boundaries.** Existing fixture suites plus the new P3 specs must exercise User A, User B and Super Admin without an ownership override. Exact assertions: owner-scoped list/message pagination and cursor rejection; get/rename/delete/status/retry/cancel/stream foreign IDs denied; voice tokens/rooms/tickets/DELETE/reconnect bound to owner; artifacts/delivery bound to attempts; Calendar OAuth/status/settings/disconnect/defaults/discovery/refresh/in-turn credential caches bound to owner; pending work continues with the original OpenRouter `user` after another request; empty account setup cannot generate. Do not replace behavioral assertions with grep-only tests. P6 will broaden these into cross-feature acceptance evidence.

- [ ] **Step 3: Required backend verification.**

```bash
npm run build
npm run lint
npm test
npm run test:e2e
```

Expected: build/lint/routine assertions pass; e2e fixture tests execute, native prerequisite skips reported explicitly. Fix P3 defects before exit. Report pre-existing unrelated failures with baseline evidence; route P1/P2/P4 defects to owners. Do not run `npm ci`, live WorkOS, live Calendar, paid model calls, or application-data bootstrap to make a fixture pass. Run frontend checks only as final P6 assembly evidence unless a P1 contract-owner change has affected its package; P3 does not edit frontend dirty files.

Authorized isolated native verification, **only when** operator supplied both required variables and prefix is exactly `aurvin_p2_test_`:

```bash
npm run test:e2e -- test/runtime/isolation.native.e2e-spec.ts test/runtime/lifecycle.native.e2e-spec.ts test/runtime/voice-recovery.native.e2e-spec.ts test/http/runtime.native.e2e-spec.ts
```

Never print MongoDB URI; suites may create/drop only their generated test databases. No-tests or all-skipped is not a pass. Existing user-edited native voice tests are runnable but not editable/stageable by P3.

- [ ] **Step 4: Validate staging/preservation and report commits.**

```powershell
git diff --check
git status --short
git diff --cached --name-only
git diff -- backend/src/chat-runtime/durable-chat-runtime.ts
```

Expected original title diff still unstaged; seven other original SHA256 values unchanged; no secret/config/dependency/generated files staged. Confirm the committed runtime index version excludes the title change. Never commit a preservation backup. Every commit stages named task files, inspects cached diff, holds/releases the serialized commit slot and reports its hash.

- [ ] **Step 5: Last focused test/fixture corrections commit if needed.** `test(auth): verify backend owner isolation and shared configuration integration`. Do not create an empty commit or bundle unrelated fixes.

## 19. Additional exact regression bodies (run with their owning task)

These bodies supplement the first RED case in each task. Append imports only once to the stated file. Run each new case red before its corresponding production edit; do not postpone all security assertions until the final suite.

### Task 2: Account freshness, safe refresh errors and forbidden direct config access

Append to `backend/test/http/private-boundary.spec.ts` (imports `authFixture`/`account` from `../auth/fixtures.js`).

```ts
it.each(['unknown', 'inactive', 'stale', 'pending'] as const)('rejects %s cookie admission before handler work', async mode => {
  const f = await authFixture(account({ passwordChangeRequired: mode === 'pending',
    status: mode === 'inactive' ? 'inactive' : 'active',
    currentWorkosSessionId: mode === 'stale' ? null : 'sid_1' }));
  if (mode === 'unknown') f.provider.read.mockResolvedValue({ workosUserId: 'unknown_subject', sessionId: 'sid_1' });
  const app = express(), identities = new RequestIdentityStore(), hit = vi.fn();
  configurePrivateHttp({ use: app.use.bind(app) }, { auth: f.service, identities,
    frontendOrigin: 'http://127.0.0.1:5173', secureCookie: false });
  app.get('/api/sessions', (_req, res) => { hit(); res.json({}); });
  await request(app).get('/api/sessions').set('Cookie', 'aurvin_wos_session=sealed_1')
    .expect(mode === 'pending' ? 403 : 401);
  expect(hit).not.toHaveBeenCalled();
});

it('preserves sealed cookies on retryable refresh failures and denies User config reads', async () => {
  const f = await authFixture(account({ passwordChangeRequired: false, currentWorkosSessionId: 'sid_1' }));
  const app = express(), identities = new RequestIdentityStore();
  configurePrivateHttp({ use: app.use.bind(app) }, { auth: f.service, identities,
    frontendOrigin: 'http://127.0.0.1:5173', secureCookie: false });
  app.get('/api/admin/config', (_req, res) => res.json({ secret: 'must-not-be-read' }));
  app.get('/api/sessions', (_req, res) => res.json({}));
  const denied = await request(app).get('/api/admin/config').set('Cookie', 'aurvin_wos_session=sealed_1').expect(403);
  expect(JSON.stringify(denied.body)).not.toContain('must-not-be-read');
  f.provider.read.mockRejectedValueOnce(new AuthFault('AUTH_PROVIDER_UNAVAILABLE'));
  const retry = await request(app).get('/api/sessions').set('Cookie', 'aurvin_wos_session=sealed_1').expect(503);
  expect(retry.headers['set-cookie']).toBeUndefined();
});
```

### Task 4: Legitimate owners coexist; the client cannot forge provenance

Append to `backend/test/runtime/auth-owner.spec.ts` and import `ExecutionReservations` from `../../src/chat-runtime/execution-reservations.js`.

```ts
it('does not let a Super Admin cancel or retry a different owner turn', async () => {
  const f = textConfigFixture(textSnapshot(1));
  try {
    const identity = principal('u1').identity, admin = principal('admin', 'super-admin').identity;
    const ids = await f.runtime.submitTurn({ identity, sessionId: null, content: 'private', idempotencyKey: 'owner-private-01' });
    await expect(f.runtime.cancelTurn({ identity: admin, sessionId: ids.sessionId,
      turnId: ids.turnId, attemptId: ids.attemptId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.runtime.retryTurn({ identity: admin, sessionId: ids.sessionId,
      turnId: ids.turnId, idempotencyKey: 'owner-retry-0001' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.runtime.submitTurn({ identity: { ...identity, openRouterUser: 'u2' },
      sessionId: null, content: 'forged', idempotencyKey: 'forged-owner-01' }))
      .rejects.toMatchObject({ code: 'IDENTITY_OVERRIDE_REJECTED' });
    expect(f.fetcher).not.toHaveBeenCalled();
  } finally { await f.dispose(); }
});

it('scopes the same session id in reservations by owner and rejects a foreign release', async () => {
  const r = new ExecutionReservations(async () => false);
  const a = principal('u1').identity, b = principal('u2').identity;
  const one = await r.acquire({ identity: a, conversationId: 'same-session', owner: { kind: 'live', voiceSessionId: 'voice-a' } });
  const two = await r.acquire({ identity: b, conversationId: 'same-session', owner: { kind: 'live', voiceSessionId: 'voice-b' } });
  r.assertLive(one, a, 'same-session'); r.assertLive(two, b, 'same-session');
  await expect(r.release({ identity: b, reservationId: one.reservationId })).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  await r.release({ identity: a, reservationId: one.reservationId });
  expect(() => r.assertText('u2', 'same-session')).toThrow();
  await r.release({ identity: b, reservationId: two.reservationId });
});
```

### Task 6: A timed-out save does not free another owner's saver slot

Append to `backend/test/performance/auth-memory-owners.spec.ts`; add `vi` to its Vitest import.

```ts
it('holds one process saver ceiling across owners until actual promise settlement', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d, memoryFirst: {
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxConcurrentSaves: 1, writeTimeoutMs: 20 },
    save: async e => {
      calls.push(e.userId); await gate;
      return { kind: 'saved', epoch: e.epoch, sessionId: e.sessionId, version: e.version, fence: e.fence };
    },
  } }));
  let first: Awaited<ReturnType<typeof f.runtime.submitTurn>> | undefined;
  try {
    for (const owner of ['u1', 'u2']) {
      const ids = await f.runtime.submitTurn({ identity: principal(owner).identity,
        sessionId: null, content: owner, idempotencyKey: `save-owner-${owner}` });
      if (owner === 'u1') first = ids;
      await f.runtime.executeTurn({ userId: owner, ...ids, signal: new AbortController().signal, emit: async () => {} });
    }
    await vi.waitFor(() => expect(f.runtime.memoryFor('u1')!.foundation.snapshot().unresolvedWrites).toBe(1));
    expect(calls).toEqual(['u1']);
    if (!first) throw new Error('Missing accepted fixture');
    const accepted = first;
    await vi.waitFor(async () => expect((await f.runtime.getTurnStatus('u1', accepted.sessionId, accepted.turnId)).save?.state)
      .toBe('unknown'), { timeout: 1000 });
    expect(calls).toEqual(['u1']);
    release();
    await vi.waitFor(() => expect(calls).toEqual(['u1', 'u2']));
    expect(await f.runtime.drain(1000)).toMatchObject({ drained: true });
  } finally { release(); await f.dispose(); }
});
```

This observes an actual timed-out save, not elapsed time or an already-true pending count. The test releases the real deferred promise in finally so failed assertions cannot leave a saver running.

### Task 8: Shared global edits apply to both owners' new attempts

Append to `backend/test/runtime/auth-owner.spec.ts`:

```ts
it('shares new config revisions while accepted work keeps its earlier snapshot', async () => {
  const f = textConfigFixture(textSnapshot(1, {}, 'fixture/old', 'fixture-key-old'));
  const a = principal('u1').identity, b = principal('u2').identity;
  try {
    const old = await f.runtime.submitTurn({ identity: a, sessionId: null, content: 'before', idempotencyKey: 'config-before-01' });
    f.publish(textSnapshot(2, {}, 'fixture/new', 'fixture-key-new'));
    const next = await Promise.all([a, b].map(identity => f.runtime.submitTurn({ identity,
      sessionId: null, content: 'after', idempotencyKey: 'config-after-001' })));
    for (const [userId, ids] of [[a.userId, old], [a.userId, next[0]!], [b.userId, next[1]!]] as const)
      await f.runtime.executeTurn({ userId, ...ids, signal: new AbortController().signal, emit: async () => {} });
    expect(f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)).model))
      .toEqual(['fixture/old', 'fixture/new', 'fixture/new']);
    expect(f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)).user)).toEqual(['u1', 'u1', 'u2']);
  } finally { await f.dispose(); }
});
```

### Task 9: Changed authentication session cannot finish an earlier OAuth flow

Append to `backend/test/plugins/google-calendar/auth-oauth-callback.spec.ts`; import `oauthFixture` from `./oauth-fixtures.js`. The existing OAuth fixture is updated to explicit fixed owner/sid in Task 7; direct calls below override the sid intentionally.

```ts
it('rejects a different signed-in session before code exchange and preserves the initiating flow', async () => {
  const f = oauthFixture(), signal = new AbortController().signal;
  const started = await f.oauth.start(signal, 'sid_original');
  const state = new URL(started.authorizationUrl).searchParams.get('state')!;
  const input = { rawQuery: new URLSearchParams({ state, code: 'fixture-code' }).toString(),
    cookieHeader: `aurvin_gcal_oauth=${started.browserCookie}` };
  await expect(f.oauth.callback(input, signal, 'sid_different')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).not.toHaveBeenCalled();
  f.oauth.cancelPending('sid_different');
  expect((await f.readState())[0]!.consumedAt).toBeNull();
  f.oauth.cancelPending('sid_original');
  await expect(f.oauth.callback(input, signal, 'sid_original')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).not.toHaveBeenCalled();
});
```

### Task 13: Real P2 deactivation remains effective if active cleanup fails

Create `backend/test/assembly/auth-deactivation.spec.ts` with this body and its mandatory header. It executes P2's actual lifecycle service against fixture users, never a live WorkOS account.

```ts
import { expect, it, vi } from 'vitest';
import { AppService } from '../../src/app.service.js';
import { RequestIdentityStore } from '../../src/platform/identity/request-identity-store.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { assemblyFixture } from './admin-config-fixture.js';
import { account, authFixture } from '../auth/fixtures.js';
import { principal } from './auth-principal-fixture.js';

it('keeps confirmed deactivation authoritative despite cleanup failure and leaves other owners alone', async () => {
  const f = assemblyFixture();
  const auth = await authFixture(account({ passwordChangeRequired: false, currentWorkosSessionId: 'sid_1' }));
  const admin = principal('admin', 'super-admin');
  await auth.users.insert({ ...admin.account });
  Object.assign(f.bundle, { users: auth.users });
  const interrupted = vi.fn(async (_userId: string) => { throw new Error('fixture cleanup uncertainty'); });
  Object.assign(f.raw, { interruptUser: interrupted });
  const identities = new RequestIdentityStore(), identity = new ServerIdentityResolver(identities);
  const service = await AppService.create(f.bootstrap, { ...f.ports, identities, identity,
    authProvider: () => auth.provider });
  const voice = vi.spyOn(service.voiceSessions, 'stopUser');
  try {
    await service.administration.deactivate(admin, 'u1', {});
    expect((await auth.users.get('u1'))!.account).toMatchObject({ status: 'inactive', currentWorkosSessionId: null });
    await expect(service.auth.authenticate('sealed_1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(interrupted.mock.calls.map(c => c[0])).toEqual(['u1']);
    expect(voice).toHaveBeenCalledWith('u1');
    expect(f.raw.stopAccepting).not.toHaveBeenCalled();
    expect(JSON.stringify(f.logs)).not.toContain('fixture cleanup uncertainty');
  } finally { await service.operations.shutdown(); }
});
```

### Task 15: Exact clean fixture/caller migration inventory

Run the source/caller inventories in Task 15 first; migrate only authentication assumptions in these clean existing fixture/test files. They are P3-focused affected checks, not ownership of unrelated algorithms:

- `backend/test/http/{fixtures.ts,validation.spec.ts,runtime.native.e2e-spec.ts,pagination.native.e2e-spec.ts}`
- `backend/test/voice/session/fixtures.ts`, `backend/test/voice/usage/fixtures.ts`
- `backend/test/voice/agent/{livekit-pipeline-fixture.ts,livekit-pipeline.spec.ts,bridge.native.e2e-spec.ts}`
- `backend/test/voice/transport/livekit-media.spec.ts`
- `backend/test/voice/integration/{integrated-fixture.ts,canvas-multimodal-fixture.ts}`
- `backend/test/runtime/{native-harness.ts,text-config-fixture.ts,execution-reservations.spec.ts,calendar-runtime-regressions.spec.ts}`
- `backend/test/operations/runtime.spec.ts`
- `backend/test/performance/{latency-runtime-fixture.ts,memory-first-text.spec.ts,memory-first-voice.spec.ts,memory-text-archive.spec.ts,calendar-memory-first.spec.ts,voice-critical-path.spec.ts}`
- `backend/test/assembly/{admin-config.spec.ts,calendar-capability.spec.ts,calendar-simplification.built.spec.ts,calendar-simplification.spec.ts,calendar-multi-flow.spec.ts,calendar-policy.spec.ts,calendar-observability.spec.ts,skill-fixture.ts,skill-history.spec.ts,voice-bootstrap.e2e-spec.ts}`
- `backend/test/admin-config/{fixtures.ts,admin-config-api.spec.ts}` and the modified resolver/platform specs in Task 1.

In `backend/test/http/fixtures.ts` the exact identity/principal replacement is:

```ts
identity: { resolve: () => principal('server-user').identity,
  assertNoClientOverrides: new ServerIdentityResolver(new RequestIdentityStore()).assertNoClientOverrides },
principal: () => principal('server-user'),
```

Import `principal` from `../assembly/auth-principal-fixture.js` and RequestIdentityStore from `../../src/platform/identity/request-identity-store.js`. Other trusted **runtime fixture** literals keep their existing userId/openRouterUser and replace only `source: 'server-configured'` with `source: 'authenticated-session'`; assertions deliberately testing legacy rejection keep the old source and expect denial. Resolver-specific tests use the real admitted `store.run` pattern from Task 1. Voice direct-create tests supply explicit principal as the third argument and remove obsolete identity options; gateway/controller fixtures provide real request admission or an explicit test-only principal callback. Source-string contract assertions remain P1-owned and follow its handoff. The eight original dirty files are still excluded from editing/staging.

## 20. Handoff interfaces and exit evidence

**P2 → P3:** implemented AdministrationModule/service/options, `principal: () => AuthPrincipal | null`, hook `onUserDeactivated(userId)` after confirmed local invalidation; failure does not reverse deactivation. The module options do not include AuthService; P3 supplies its authenticated ALS principal and P2 reloads current local authority. Reconfirm the frozen exports before Task 12.

**P3 → P4:** existing cookie-authenticated REST/streams with exact origin and credentials; Users receive 403 for Config/Admin but use `/voice/config` and existing Calendar status/settings independently. Authentication faults use P1's safe auth catalog. Calendar callback bridge requires no frontend bearer tokens or new auth screens. P4 still owns clearing browser state/media on logout/expiry/account switch, plus explicit same-origin fetch credentials.

**P3 → P5:** runtime resolver no longer resolves outside a request. Bootstrap/adoption uses explicit `bootstrap-operator` owner selection and the admitted persistence lifecycle, not `AuthPrincipal` forgery or AppService.adminActor. Preserve legacy stable owner IDs and data; unmapped legacy recovery is a visible stopped-app/preflight gate. P3's narrow existing import-config attribution caller migration leaves P5 a buildable explicit-operator seam; it does not implement or run adoption.

**P3 → P6:** return source commits, exact backend commands/counts/failures/skips, P3 test routes/files, original dirty-hunk preservation evidence and outstanding browser/live/native gates. Required browser evidence includes same-origin Google callback completion with a Strict auth cookie, both roles, old-cookie rejection, logout cleanup and account switching. Do not claim UI, live WorkOS/email, Azure, deployment or adoption acceptance from P3 fixtures.

### Coverage self-check

- AC1/AC2: Tasks 1–2, 11–12 close private admission, onboarding, expiry and missing-provider fallback without replacing P1 credential flows.
- AC3: Task 3 and middleware deny **reads and writes**; task 8 retains User plugin capabilities independently.
- AC4: Tasks 10–13 connect confirmed P2 deactivation to targeted existing cleanup, no resurrection/charge-prevention promises.
- AC5: Tasks 4–11 isolate HTTP/archive/streams/runtime/memory/voice/Calendar/OAuth/caches/background attribution for both roles.
- AC6: Tasks 3, 6, 8 and 12 retain one global settings revision, shared process budgets and captured active snapshots.
- AC7: Task 14 and P5 handoff remove the single-default-owner recovery assumption without migrating application data.
- AC8: Task 15 records real meaningful tests and skips; final integrated verification remains P6/V. Review is **skipped**, not passed.

**Planner evidence boundary:** This document specifies implementation and tests; those code/test tasks have not been executed by the planner. Only documentation consistency, links, named paths, placeholder/type-interface checks, git staging and preservation are verified while committing this plan.
