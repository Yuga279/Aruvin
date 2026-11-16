---
objective: workos-authentication
workflow: maw
artifact: research-results
date: 2026-11-10
status: research-complete
goal: docs/workos-authentication/goal.md
---

# Research Results: WorkOS authentication

## 1. Result and evidence boundary

Custom email/password authentication with `@workos-inc/node` v12 session helpers is compatible with Aurvin's Node 22+/ESM/NestJS stack. WorkOS owns credentials and sealed sessions. Aurvin owns a bounded `users` collection, local role/status, and request identity. No additional auth framework, hosted AuthKit redirect, organization model, or frontend WorkOS SDK is required.

This file is baseline compatibility research from primary WorkOS documentation (10 November 2026) and repository source inspection. No WorkOS account was provisioned, no live AuthKit/email/session calls were made, no application data was mutated, and the eight pre-existing dirty files were not edited. Fixture passes later are not live-service evidence. WorkOS pricing and dashboard defaults can change.

Product requirements that need operator dashboard settings rather than Aurvin code are called out as **operator prerequisites**, not as silent product changes.

## 2. Confirmed technical direction

| Decision | Direction |
| --- | --- |
| SDK | Official `@workos-inc/node` ^12 (current published 12.2.0). Node 22.11+; Aurvin engines are `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`. ESM `import { WorkOS } from '@workos-inc/node'`. |
| Login | `userManagement.authenticateWithPassword` with `session: { sealSession: true, cookiePassword }`. Custom Aurvin screens. No hosted AuthKit redirect. |
| Session cookie | HttpOnly `aurvin_wos_session` from `sealedSession`. Validate with `loadSealedSession` + `authenticate()`; refresh with `session.refresh()` and rewrite the cookie. |
| Logout | `userManagement.revokeSession({ sessionId })` from the access-token `sid`, then clear the cookie. Do not redirect through WorkOS `getLogoutUrl` (hosted flow). |
| Users | `createUser({ email, password, emailVerified: true, externalId })`. Local `users` row is authoritative for admission. |
| First password change | Local `passwordChangeRequired` gate. Confirm with `updateUser({ userId, password })`. WorkOS has no must-change flag. |
| Recovery | `createPasswordReset({ email })` (WorkOS sends mail when dashboard email type is on) then `resetPassword({ token, newPassword })`. Never return or log the token/URL. |
| Local invalidation | Persist `currentWorkosSessionId` on the account. Every request requires local `status === 'active'` and JWT `sid === currentWorkosSessionId`. Deactivate/reset/logout nulls that field. Reactivation does not restore it. |
| Identity | Request-bound identity captured at the HTTP/WS boundary and copied onto accepted work. No last-caller singleton. No fallback to `AURVIN_USER_ID` at runtime. |
| Role | Local `super-admin` \| `user` only. Ignore WorkOS organization `role` claims. |
| CORS/cookies | Exact-origin CORS with `credentials: true`. Cookie `SameSite=Strict; Path=/api`. `Secure` outside loopback HTTP. |
| Free tier | AuthKit email/password is free to 1M MAU. Production still needs billing details in the WorkOS dashboard. No paid SSO/custom-domain add-on. |

## 3. WorkOS Node SDK compatibility

Sources: [Node.js SDK](https://workos.com/docs/sdks/node), [GitHub workos-node](https://github.com/workos/workos-node), [v8 migration](https://github.com/workos/workos-node/blob/main/docs/V8_MIGRATION_GUIDE.md), [custom UI example](https://github.com/workos/workos-custom-ui-authkit-example).

### 3.1 Versions and module shape

- Current stable line is **v12** (12.2.0 published 4 November 2026). v12 requires **Node 22.11 or higher**. Aurvin already requires Node `^22.22.3 || ^24.15.0 || >=26.0.0`.
- Since v8 the package is ESM-first with dual CJS/ESM exports. `import { WorkOS } from '@workos-inc/node'` is the supported form for Aurvin's `"type": "module"` + TypeScript `NodeNext` (local imports keep `.js` specifiers; this package export does not).
- NestJS 12 ESM can hold one `WorkOS` client as a module provider. Do not construct per request.
- Do **not** add `@workos-inc/authkit-nextjs`, Passport, cookie-parser, iron-session, or a frontend WorkOS SDK. Sealing is inside the Node SDK. Aurvin already parses `Cookie` headers by hand for voice tickets and Calendar OAuth.

### 3.2 Client construction

```ts
const workos = new WorkOS(process.env.WORKOS_API_KEY, {
  clientId: process.env.WORKOS_CLIENT_ID,
  issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
});
```

- API key and client ID stay server-side. Never `VITE_*`.
- Pass `issuer` so session helpers validate the JWT `iss` claim. Default SDK behavior skips `iss` unless set.
- SDK retries transient 408/429/5xx with backoff (default 3). Auth calls should still use a **10s** application timeout via existing `boundedResult` / AbortSignal wrapping. Do not leave WorkOS's 60s default as the user-visible budget.
- `cookiePassword` must be ≥ 32 characters. Rotating it invalidates every sealed cookie.

### 3.3 Custom password authentication (no hosted UI)

`authenticateWithPassword` is a first-class User Management API, documented for custom UIs:

```ts
const { user, sealedSession, accessToken, refreshToken } =
  await workos.userManagement.authenticateWithPassword({
    clientId,
    email,
    password,
    session: { sealSession: true, cookiePassword },
    ipAddress,  // optional, useful if Radar is later enabled
    userAgent,
  });
```

Set the cookie from `sealedSession` (not the raw tokens):

```
aurvin_wos_session=<sealedSession>; HttpOnly; SameSite=Strict; Path=/api; Max-Age=<session-length-seconds>[; Secure]
```

`Secure` when `FRONTEND_ORIGIN` is `https:` or the peer is not loopback HTTP. Match voice's existing `secureCookie: new URL(frontendOrigin).protocol === 'https:'` rule.

Parse the cookie the same way as `aurvin_voice_ticket` / `aurvin_gcal_oauth` (split `Cookie`, require exactly one name match, reject comma-concatenated header arrays). No `cookie-parser` dependency.

### 3.4 Cookie and CORS integration with current `main.ts`

Today `configureApplication` sets `credentials: false` and an exact `frontendOrigin`. Cookie auth needs:

1. `credentials: true` on that same exact-origin CORS config (P3 owns `main.ts`).
2. Frontend fetch `credentials: 'same-origin'` (admin and Calendar clients already do; chat `ApiClient` relies on the fetch default and should set it explicitly).
3. Existing exact-origin / `Sec-Fetch-Site` mutation checks from `configure-admin-http.ts` and Calendar boundaries extended onto cookie-authenticated routes. SameSite=Strict plus exact origin is enough; do not add a second CSRF token.

Vite proxies `/api` to port 3000, so local UI and API are same-origin to the browser. Staging nginx already reverse-proxies `/api/` and `/api/voice` on the same host; Cookie / Set-Cookie flow without a `proxy_cookie_path` change. Staging `auth_basic` remains a network gate, not application identity.

### 3.5 What not to add

- Hosted AuthKit `getAuthorizationUrl({ provider: 'authkit' })` for routine sign-in.
- WorkOS organizations, directory sync, SSO connections, Radar (optional; first 1,000 checks free, do not integrate).
- MFA challenge handling (`mfa_challenge` pending token). V1 operators must leave MFA off in the WorkOS Authentication dashboard. If the API returns `mfa_challenge`, fail closed with the generic login error; do not build a TOTP UI.
- Public self-registration (`createUser` is admin/bootstrap only).

## 4. Session validation, refresh, logout, and invalidation

Sources: [Session helpers](https://workos.com/docs/reference/authkit/session-helpers), [Sessions](https://workos.com/docs/authkit/sessions), [Session resilience](https://workos.com/docs/authkit/session-resilience), [Session API](https://workos.com/docs/reference/authkit/session), [Password reset](https://workos.com/docs/reference/authkit/password-reset).

### 4.1 Validate

```ts
const session = workos.userManagement.loadSealedSession({
  sessionData: cookieValue,
  cookiePassword,
});
const auth = await session.authenticate();
if (!auth.authenticated) { /* unauthenticated; see refresh */ }
const workosUserId = auth.user.id;
const workosSessionId = auth.sessionId; // JWT sid
```

`authenticate()` verifies the sealed cookie and access-token signature against WorkOS JWKS. It does **not** consult Aurvin's `users` row. Local checks are mandatory after a successful SDK result.

### 4.2 Refresh

Access tokens are short-lived (dashboard Sessions tab; keep short). On `authenticated: false` because of expiry:

```ts
const result = await session.refresh();
if (result.authenticated) {
  // rewrite aurvin_wos_session = result.sealedSession
} else if (result.retryable) {
  // transient 429/5xx/timeout: keep cookie, do not sign out
} else {
  // terminal invalid_grant: clear cookie
}
```

Node SDK `refresh()` never clears the cookie for you. Persist the rotated sealed session. Do not treat a transient refresh failure as logout.

### 4.3 Logout (current session only)

1. Read `sid` from the authenticated session (`auth.sessionId`).
2. `await workos.userManagement.revokeSession({ sessionId })`.
3. Null `currentWorkosSessionId` on the local row (CAS).
4. Set-Cookie clear: `aurvin_wos_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`.
5. Close this browser's voice/streams via existing stop/drain hooks (P3).

Do **not** redirect to `session.getLogOutUrl()`; that is the hosted AuthKit logout with a Sign-out URI bounce.

### 4.4 Password-reset revocation

WorkOS: “When a user’s password is reset, all of their active sessions are revoked.” Refresh then fails with `invalid_grant`. **Already-issued access tokens remain valid until `exp`.** That window is why local state is required.

### 4.5 Local status/session binding (prevents revival)

WorkOS cannot store Aurvin's `inactive` flag or first-password gate. Recommended account fields (no growing session array):

| Field | Purpose |
| --- | --- |
| `status` | `active` \| `inactive`. Inactive rejects every request immediately, even with a valid WorkOS cookie. |
| `passwordChangeRequired` | Limits the cookie to `/api/auth/password` and `/api/auth/logout` until `updateUser` password succeeds. |
| `currentWorkosSessionId` | Single live WorkOS `sid` written at login. Request JWT `sid` must equal this value. |
| `sessionEpoch` | Integer bumped on deactivate, password reset, and confirmed password change. Not stored in the WorkOS cookie; used as a CAS fence and for tests. |

Admission algorithm after SDK success:

1. Load local user by unique `workosUserId`. Missing row → unauthenticated (closed admission; unknown WorkOS identities never JIT-provision).
2. `status !== 'active'` → unauthenticated (do not leak “disabled”).
3. `auth.sessionId !== currentWorkosSessionId` → unauthenticated (covers reactivation, logout, reset, and a second-device overwrite).
4. `passwordChangeRequired` → allow only password-change and logout routes; 403 `PASSWORD_CHANGE_REQUIRED` on chat/admin/plugins/voice.

Why this blocks revival:

- **Deactivate:** set `status: inactive`, `currentWorkosSessionId: null`, increment `sessionEpoch`, `listSessions` + `revokeSession` each. Existing cookies fail step 2 immediately. Access-token TTL is irrelevant.
- **Reactivate:** set `status: active` only. `currentWorkosSessionId` stays null until a new login. Old cookies fail step 3.
- **Password reset:** WorkOS revokes provider sessions; Aurvin nulls `currentWorkosSessionId`, clears `passwordChangeRequired`, increments `sessionEpoch`. User signs in again.
- **Logout:** revoke current sid, null `currentWorkosSessionId`. Other devices: V1 stores one sid, so a second login overwrites the first (ponytail: one live WorkOS session per account; a session set is the upgrade if concurrent devices are required).

Do not keep a session-id array on the user document.

### 4.6 Recommended finite budgets

| Budget | Value | Basis |
| --- | --- | --- |
| WorkOS API timeout | 10s | Existing credential-validation timeout; tighter than SDK 60s. |
| Login attempts | 10 / 60s / normalized email | Matches WorkOS authenticate limit; reuse in-memory sliding window like `Admission` / admin HTTP (60/min). |
| Forgot-password attempts | 3 / 60s / normalized email | Matches WorkOS password-reset send limit. |
| Auth JSON body | 4 KiB | Email+password; far below chat/admin parsers. |
| Session cookie Path | `/api` | Covers REST, SSE, dictation WS, Calendar, admin. |
| Access token duration | WorkOS dashboard, keep short (minutes) | Limits post-revoke JWT window; local sid check is still the gate. |
| Provider retries | 0 on invalid credentials; SDK default only for transport | Do not retry `invalid_credentials` / `email_verification_required` / `mfa_challenge`. |

Missing WorkOS env: diagnostic liveness (`/api/operations/live`) may boot; `/ready` stays 503; chat, admin, plugins, and generation stay unavailable. **Never** fall back to `AURVIN_USER_ID` as a signed-in Super Admin.

## 5. User creation, temporary password, recovery, email

Sources: [User API](https://workos.com/docs/reference/authkit/user), [Authentication](https://workos.com/docs/reference/authkit/authentication), [Authentication errors](https://workos.com/docs/reference/authkit/authentication-errors), [Email + Password](https://workos.com/docs/authkit/email-password), [Email verification](https://workos.com/docs/authkit/email-verification), [Custom emails](https://workos.com/docs/authkit/custom-emails), [Email delivery](https://workos.com/docs/email).

### 5.1 Create user with temporary password

```ts
const user = await workos.userManagement.createUser({
  email,
  password: temporaryPassword,
  emailVerified: true,
  externalId: aurvinUserId, // Aurvin's server-generated idSchema value
});
```

- WorkOS stores the password. Aurvin never persists it.
- `emailVerified: true` is the documented parameter for admin-provisioned / migrated users. **Required** so `authenticateWithPassword` does not return `email_verification_required`. This is not an Aurvin email-verification feature and does not prove mailbox ownership. Goal forbids a separate verification UI; this API flag is how that product choice is implemented.
- WorkOS normalizes email (trim + lowercase). Aurvin must store `emailNormalized` the same way and compare only that form.
- Duplicate email: WorkOS rejects. Do not auto-adopt the existing WorkOS user by email. Surface a safe conflict. Operator reconciliation is acceptable.
- `externalId` uniqueness is enforced by WorkOS; use the Aurvin `userId` so bootstrap/get-by-external-id is possible. Local `users` remains the admission source of truth.

After WorkOS success, insert the local row with `passwordChangeRequired: true`, `status: 'active'`, `role: 'user'`, `currentWorkosSessionId: null`. If the local insert fails, do not report success and do not retry `createUser` (that would try to recreate or overwrite). Show a safe partial-failure message.

### 5.2 First-time password change

WorkOS has no “must change password” flag. Aurvin enforces it locally.

1. User authenticates with the temporary password → sealed cookie issued, `currentWorkosSessionId` set, `passwordChangeRequired` still true.
2. Private/admin/plugin/voice routes return 403 `PASSWORD_CHANGE_REQUIRED`.
3. `POST /api/auth/password` with `{ currentPassword, newPassword }`. Reject when equal. Confirm replacement with `updateUser({ userId: workosUserId, password: newPassword })`. Only a confirmed SDK success plus local CAS clearing `passwordChangeRequired` lifts the gate.
4. Failed/unknown WorkOS result leaves the gate on.

`resetPassword` is the recovery-token API, not this path.

### 5.3 Recovery: creating a token vs sending mail

| Action | API | Sends mail? |
| --- | --- | --- |
| Create reset object | `userManagement.createPasswordReset({ email })` | **Yes, by default**, when *Emails → Configuration* has password-reset emails enabled. Response includes `passwordResetToken` and `passwordResetUrl`. |
| Deprecated send | `sendPasswordResetEmail` | Removed in SDK v8. Do not use. |
| Custom send | Dashboard disables default emails; app emails `passwordResetUrl` itself | Only if default emails are off. Out of V1 scope. |
| Complete reset | `userManagement.resetPassword({ token, newPassword })` | No. Also verifies email if it was unverified. Revokes all WorkOS sessions. |

**Aurvin must:**

- Call `createPasswordReset` for forgotten-password and admin “send reset”.
- **Never** put `passwordResetToken` / `passwordResetUrl` in Administration responses, logs, or browser storage.
- Return a generic success for forgotten-password whether or not the email exists (no enumeration). If a local active user exists, call WorkOS; always return the same client body.
- Complete reset on Aurvin's own screen via the `token` query parameter, then require a fresh login.
- Successful recovery clears `passwordChangeRequired`.

**Operator prerequisites (not code):**

1. Leave WorkOS password-reset emails **enabled** (default for new environments). If an operator disables them, `createPasswordReset` still returns a token and **no mail is sent**. Do not add a custom mailer. Document this as a release/config gate.
2. Set *Applications → Redirects → Password reset URL* to `{FRONTEND_ORIGIN}/reset-password` so `password_reset_url` in the WorkOS email hits Aurvin, not hosted AuthKit.
3. Staging/test users should use `@example.com` / `.test` addresses: WorkOS accepts the API call and **silently drops** mail ([testing with example domains](https://workos.com/docs/email#testing-with-example-domains)). Live mailbox tests need explicit authorization.

Default production sender is `access@workos-mail.com`. Custom email domain is a **$99/mo** add-on; do not enable it. Custom email provider is optional for deliverability and is not required for 10–15 users.

### 5.4 Email verification and MFA — do not implement; do not skip silently

- Password users with `email_verified: false` cannot complete `authenticateWithPassword`; the API returns `email_verification_required` and (if emails are on) sends a code. Creating users with `emailVerified: true` avoids that flow, as required by the goal.
- MFA is dashboard-configurable and **off unless enabled**. V1 does not handle `mfa_challenge`. Operators must leave MFA disabled. Enabling it is a product-scope change.
- Public sign-up stays disabled in the WorkOS dashboard and is not exposed by Aurvin.

If a selected custom flow cannot be implemented without adding verification/MFA UI, stop for user confirmation. Current APIs support the approved behavior with the `emailVerified: true` create flag and MFA left off.

## 6. Free allowance and production prerequisites

Sources: [Pricing](https://workos.com/pricing), [Staging vs production](https://workos.com/docs/authkit/environments), [Rate limits](https://workos.com/docs/reference/rate-limits). Observed 10 November 2026; not a perpetual guarantee.

| Item | Current published fact |
| --- | --- |
| AuthKit (email/password, social, MFA, magic auth APIs) | Free for first **1 million MAU**, then $2,500/mo per additional 1M. A MAU is a user who signs up, signs in, or updates a profile in the calendar month. |
| Staging environment | Free. No connection charges. |
| Production unlock | **Billing information required** in the dashboard even at $0 AuthKit usage. |
| SSO / Directory Sync | Paid per connection (from $125/mo). Not used. |
| Custom AuthKit/email domain | $99/mo. Not used. |
| Radar | First 1,000 checks free, then $100 / 50k. Not integrated. |
| OAuth social connections | Free. Not used in V1. |

For ~10–15 email/password users, expected WorkOS charge is **$0**, provided no SSO/custom-domain add-ons are enabled. Production still needs a payment method on file. This research does not authorize adding that payment method or creating a WorkOS production environment.

Staging vs production API keys, users, and redirect URIs do not copy. Redirect URIs: staging allows `http://` and localhost; production web apps need `https://` (loopback `http://127.0.0.1` remains allowed for native clients).

AuthKit rate limits (per environment): authenticate 10 / 60s / email; password-reset send 3 / 60s / email; user_management writes 500 / 10s. Mirror the authenticate/reset caps locally.

## 7. Identity caller inventory and the smallest request-identity seam

### 7.1 Current resolver

`ServerIdentityResolver.resolve()` returns `{ userId: bootstrap.identity.userId, source: 'server-configured', openRouterUser }` with **no request argument**. `AURVIN_USER_ID` defaults to `aurvin-dev-user`. `assertNoClientOverrides` already rejects client `userId` / `user` / `openRouterUser` / model / apiKey fields — keep it.

`AppService` constructs one resolver at boot and injects it into chat HTTP, voice, Calendar assembly, and `adminActor()`.

### 7.2 Callers that must become request-specific

| Surface | Current behavior | Required change (P3 unless noted) |
| --- | --- | --- |
| `ChatHttpService` / `ChatStreamTransport` | `this.o.identity.resolve()` on every list/get/submit/retry/cancel/stream | Resolve from request-bound identity. Capture `ResolvedIdentity` on `submitTurn` / retry (already passed into runtime as `identity`). |
| `ChatHttpModule` options | Singleton `ServerIdentityResolver` from `PlatformModule` | Options type stays `Pick<IdentityResolver, 'resolve' \| 'assertNoClientOverrides'>`; implementation reads request ALS. |
| `durable-chat-runtime.ts` | Rebuilds `{ userId, openRouterUser, source: 'server-configured' }` in several live/text paths | Use the captured attempt identity. **This file is in the dirty baseline** — coordinate before editing. |
| `memory-text.ts` | Same hardcoded source | Use captured identity. |
| `VoiceSessionService.create` | Resolves at create and stores `entry.identity` | Keep storing the request identity on the entry. |
| `VoiceSessionService.claim` / `end` / `assertPaidWork` | **Re-resolves** and compares to `entry.identity` | Compare against the bound entry; do not re-resolve. WS upgrade must authenticate the session cookie (Path `/api` covers `/api/voice`). |
| `claimLive` | Re-resolves process identity | Trust LiveKit `participantIdentity` (already encodes `userId`) plus the stored entry. LiveKit is not a browser cookie request. |
| `VoiceGateway` | `claim(cookie, origin, 'dictation')` | Cookie header already present; add session-cookie validation before claim. |
| `VoiceUsageService` | Maps keyed by `context.identity.userId` | Fine once context identity is per user. |
| `GoogleCalendarConnections` | **`this.userId = identity.resolve()` in the constructor** | Per-request `userId` on every store/OAuth/refresh path. Singleton constructor capture is the largest isolation bug. |
| `GoogleCalendarOAuthService.pending` | One in-memory pending setup for the process | Key pending setup by `userId` (still single-process). |
| `refreshFlight` / `refreshFlightV2` / `lifecycleEpoch` | One flight/epoch for the process user | Key by `userId`. Store remains `get(userId)` with unique `(userId, provider)`. |
| Calendar HTTP controller | No request identity; uses the singleton connections object | Pass authenticated owner into status/settings/oauth/disconnect. |
| `AdminConfigController` | `actor: () => service.adminActor()` always Super Admin, `authentication: 'disabled'` | Request actor from session; `assertActor` requires `role === 'super-admin'` and `authentication === 'session'`. Config **GET** is currently unauthenticated. |
| `import-config.ts` | Resolves bootstrap identity | Operator script; use bootstrap-operator source, not a browser session. |
| `finishLocalMaintenance(..., bootstrap.identity.userId, ...)` | Recovers **one** user | After auth, iterate `users` (or all distinct session `userId`s). `listForRecovery` is already per-`userId`. |
| Operations `/live` | Public | Stay public. |
| Operations admission | Process-wide generation/control windows | Keep; optionally add per-user login limiter in auth. Missing WorkOS must not reopen shared super-admin. |
| Canvas artifacts | Owned via chat/voice attempt identity | Follow the captured turn owner; no extra store. |
| Frontend `sessionStorage` submission recovery | Keyed by API base, not user | Clear on logout/account change (P4). |

### 7.3 Smallest identity seam (no last-caller singleton)

Do **not** mutate `ServerIdentityResolver` with the last userId. Do **not** read ALS after the request ends for background work.

1. **P1** keeps `IdentityResolver.resolve(): ResolvedIdentity` and widens `source` to `'authenticated-session' | 'bootstrap-operator'`. Adds `RequestIdentityStore` (AsyncLocalStorage) in `platform/identity/` as the read API `resolve()` uses. Isolated P1 tests inject a store. Runtime fallback to `AURVIN_USER_ID` is forbidden.
2. **P1** auth middleware (in `backend/src/auth/**`) validates the cookie, loads the local user, and `RequestIdentityStore.run(identity, next)` for the request. Onboarding-limited identities still have a `userId` so logout/password-change work.
3. **Accepted/background work** already receives `identity` on submit/retry/voice context. Copy that object onto the attempt/reservation; never call `resolve()` from a timer, drain, LiveKit callback, or Calendar refresh flight.
4. **Calendar/voice singletons** take `userId` as a method argument (from the request identity or the bound entry), matching how persistence is already keyed.

`MongoOwnership` already uses `AsyncLocalStorage` for execution phases; a second ALS for request identity is consistent and smaller than converting Nest HTTP/voice/Calendar graphs to request-scoped providers (which would duplicate `AppService`).

`AURVIN_USER_ID` remains the **legacy owner selector for P5 bootstrap only**, not a login fallback.

## 8. Persistence: `users` collection and legacy owner mapping

### 8.1 Integration path

Existing lifecycle: `COLLECTIONS` → `setupIndexes` → `createPersistenceBundle` → `RecordStore` / optional `MutationJournal` → one `openPersistence` close owner.

Add:

- `COLLECTIONS.users = 'users'`
- `MongoUsers` adapter using `RecordStore` + `bounded`/`assertBytes`/`CAS` like sessions/config
- Unique indexes in `APP_INDEXES` (not Calendar's partial-filter set)
- `'users'` in `mutation-journal.ts` `collections` allowlist (currently `sessions`, `messages`, `agent-memory`, `metadata`, `checkpoints`, `checkpoint_writes`, `integration_connections`). **`config` is already a separate collection via `MongoConfigRepository` and is not in that set;** do not route users through a second Mongo client.
- Export from `persistence/index.ts` and attach `users` on the bundle in `createPersistenceBundle`

Suggested indexes:

| Name | Keys | Options |
| --- | --- | --- |
| `users_workos_subject` | `{ workosUserId: 1 }` | unique |
| `users_email` | `{ emailNormalized: 1 }` | unique |
| `users_role_created` | `{ role: 1, createdAt: -1 }` | non-unique, admin list |

`_id` = internal `userId` (`idSchema`, server `randomUUID()` except bootstrap adoption).

Document is small (ids, enums, integers, timestamps). Use existing `maxDocumentBytes` / `assertBytes`. No password, hash, reset token, or session array.

CAS via `_revision` like config/sessions. Status changes are compare-and-swap on expected revision.

### 8.2 Legacy owner adoption (P5)

Prefer **linking** the WorkOS subject to the existing `AURVIN_USER_ID` (`aurvin-dev-user` by default) over rewriting sessions, messages, checkpoints, metadata, or encrypted Calendar records.

- Chat/voice/artifact rows already store `userId`.
- Calendar unique key is `(userId, provider)`; token AAD includes `userId`. Preserving the id keeps decryption and consent if the encryption master key is unchanged. If the sealed blob cannot be opened, require reconnect; do not rewrite tokens.
- Graph thread ids are `key('thread', userId, sessionId)`.
- Bootstrap: explicit WorkOS user id + explicit legacy owner id, uniqueness check (no other `users` row with that `userId` or `workosUserId`), application stopped, backup required, non-mutating preflight. Repeat execution refuses if already mapped.
- Do not run bootstrap during research or routine fixtures.

`listForRecovery(userId, …)` stays per owner; local crash recovery must loop mapped users after auth exists.

### 8.3 Dirty-file baseline

These eight files stay untouched by research and by P1:

- `backend/src/chat-runtime/durable-chat-runtime.ts` (P3, coordinate)
- `backend/src/persistence/sessions.ts` (recovery already per-user; avoid unless P3 needs a multi-user listing)
- `backend/test/persistence/voice-messages.native.e2e-spec.ts`
- `backend/test/persistence/voice-messages.spec.ts`
- `backend/test/runtime/voice-acceptance.native.e2e-spec.ts`
- `frontend/src/features/chat/state/chat-reducer.ts` (P4 teardown, coordinate)
- `frontend/src/features/chat/state/memory-save-state.test.ts`
- `frontend/src/features/chat/state/voice-draft-lock.test.ts`

No ownership conflict for new `backend/src/auth/**`, `persistence/users.ts`, or contract files.

## 9. Concrete contracts and ownership adjustments

### 9.1 Environment (P1 `.env.example` + bootstrap schema)

```
WORKOS_API_KEY=
WORKOS_CLIENT_ID=
WORKOS_COOKIE_PASSWORD=
```

- All required for admitted chat; blank → diagnostic-only, no identity fallback.
- `WORKOS_COOKIE_PASSWORD` min 32 chars.
- Keep `AURVIN_USER_ID` as legacy owner id for bootstrap; stop using it as runtime identity once users exist.
- Never `VITE_WORKOS_*`.

### 9.2 Account record (`contracts/auth.ts`, P1)

```ts
export const AUTH_PROTOCOL_VERSION = 1 as const;
export const USER_ROLES = ['super-admin', 'user'] as const;
export const USER_STATUSES = ['active', 'inactive'] as const;

export const userAccountSchema = z.object({
  schemaVersion: z.literal(1),
  userId: idSchema,
  workosUserId: idSchema,          // WorkOS user_…
  emailNormalized: z.string().min(3).max(254),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  passwordChangeRequired: z.boolean(),
  currentWorkosSessionId: idSchema.nullable(),
  sessionEpoch: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();
```

`ResolvedIdentity` stays attribution-only:

```ts
source: z.enum(['authenticated-session', 'bootstrap-operator'])
```

Role/status live on the account row, not in the OpenRouter identity object.

### 9.3 Auth HTTP (`AUTH_ROUTES`)

| Method | Path | Auth | Body / result |
| --- | --- | --- | --- |
| POST | `/auth/login` | public | `{ email, password }` → `{ user }` + Set-Cookie. Generic failure. |
| POST | `/auth/logout` | session (including onboarding) | 204 + clear cookie |
| GET | `/auth/me` | session | `{ userId, email, role, passwordChangeRequired }` |
| POST | `/auth/password` | session | `{ currentPassword, newPassword }` |
| POST | `/auth/forgot-password` | public | `{ email }` → generic `{ ok: true }` |
| POST | `/auth/reset-password` | public | `{ token, newPassword }` → `{ ok: true }`; then login |

Public error codes (closed catalog): `INVALID_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `RATE_LIMITED`, `NOT_READY`, `AUTH_PROVIDER_UNAVAILABLE`, `AUTH_TIMEOUT`. Login failures use `UNAUTHENTICATED` without distinguishing unknown user / bad password / disabled.

User JSON never includes passwords, WorkOS tokens, `currentWorkosSessionId`, or `sessionEpoch`.

### 9.4 Administration HTTP (`ADMINISTRATION_ROUTES`, contract in P1, implementation P2)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/users` | Bounded page `{ items, nextCursor }`. Columns: email, role, status, passwordChangeRequired, createdAt. |
| POST | `/admin/users` | `{ email, temporaryPassword, role: 'user' }` only. |
| POST | `/admin/users/:userId/deactivate` | Not the bootstrap Super Admin. |
| POST | `/admin/users/:userId/reactivate` | Does not restore `currentWorkosSessionId`. |
| POST | `/admin/users/:userId/password-reset` | Triggers WorkOS mail; empty success body. |

Super-admin only. User/anonymous → `FORBIDDEN` / `UNAUTHENTICATED`. P2 exposes a `onUserDeactivated(userId)` hook for P3 cancellation; P2 does not import `AppService`.

### 9.5 Admin config wire (P1 contract, P3 behavior)

```ts
export type AdminRoleAssumption = {
  role: 'super-admin' | 'user';
  authentication: 'session';
  source: 'local-account';
};
```

Remove `authentication: 'disabled'` and `source: 'server-configured-development'` from the live wire. `assertActor` requires Super Admin + session. Config GET becomes Super-admin-only. Users reach Plugins through existing Calendar routes plus a small authenticated capability payload if still required (P3); they must not call `/admin/config`.

### 9.6 Frontend protocol (P1)

Mirror in `frontend/src/api/auth-protocol.ts` and `administration-protocol.ts` the same way `admin-config-protocol.ts` mirrors the backend wire (types, routes, guards; no secrets). P4 owns `auth-client.ts` / `administration-client.ts` and UI.

`AdminTab` gains `'administration'` (P4; `config-edit-state.ts`). `ProfileMenu` uses `/auth/me` and a working Sign out. `App.tsx` gates ChatProvider on a full session, mounts login/onboarding/reset screens, and destroys chat/voice/calendar client state on logout.

SPA reset URL: read `token` from the query on the existing shell. Do not add `react-router` unless a planner proves the shell cannot do it.

### 9.7 Ownership / path adjustments for `state.md`

The initial graph remains valid. Reconcile:

| Topic | Owner |
| --- | --- |
| `@workos-inc/node` in `backend/package.json` + lockfile | P1 |
| `WORKOS_*` bootstrap / `.env.example` | P1 (do not edit real `.env`) |
| `users` collection, indexes, journal allowlist, bundle field | P1 |
| Auth/admin **wire** contracts and identity `source` union | P1 |
| Auth Nest module, cookie issue/validate/refresh/logout | P1 |
| Administration module | P2 |
| `main.ts` CORS `credentials: true`; middleware order | P3 |
| `ServerIdentityResolver` → request ALS; `adminActor()` | P3 |
| Calendar constructor `userId`, OAuth pending map, refresh flights | P3 |
| Voice claim/end/LiveKit identity | P3 |
| Local recovery loop over users | P3 |
| `durable-chat-runtime.ts` source literals | P3 after dirty-file coordination |
| Chat `ApiClient` `credentials: 'same-origin'` | P4 |
| Auth UI, Administration tab, ProfileMenu, App teardown | P4 |
| Bootstrap script + `AURVIN_USER_ID` adoption | P5 after P1 package handoff |
| `deployment/staging/nginx.conf` | No change expected; P3 only if cookie Path breaks |
| Review | Skipped |

P3 planner may use P1's Administration hook shape; P3 worker waits for P2 so `AppModule` imports a real module.

## 10. Open operator gates (not implementation blockers)

- Create a WorkOS staging environment and copy API key / client id into local `.env` (authorized separately).
- Dashboard: email+password on; MFA off; public sign-up off; password-reset emails on; password-reset redirect URI = Aurvin `/reset-password`.
- Production billing method before any production AuthKit environment.
- Explicit authorization for live email, live login, and real-data bootstrap.
- Azure Cosmos compatibility remains an older R1 gate; this work does not certify it.

## 11. Verification implications

- P1 tests mock the WorkOS client: login success/failure/timeout, unknown/inactive account, onboarding gate, password replace, reset replay, sid mismatch after deactivate/reactivate, redaction of tokens/passwords, unique indexes.
- Native user-repository tests use `AURVIN_TEST_MONGODB_URI` + `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` only when supplied; skip otherwise.
- Do not call real WorkOS or send mail in routine CI.
- P6 records live AuthKit/email/bootstrap as unrun without authorization.
- Browser checks (P6) cover both roles, onboarding, logout teardown, and Administration; Node tests are not DOM evidence.
