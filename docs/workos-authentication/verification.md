# WorkOS Authentication Integrated Verification Evidence

## Scope and authorization

- **Objective:** Integrated verification and operations handoff for WorkOS authentication across Aurvin (AC1–AC8).
- **Authorization:** Written goal approved on 10 November 2026 (`6145249`); Worker 6 dispatched per `docs/workos-authentication/state.md`.
- **Boundaries:** Verification suites, browser integration fixtures, and operations runbook finalization. Strictly confined to Plan 6 owned files (`backend/test/auth/integration/**`, `frontend/src/features/auth/integration-tests/**`, `docs/workos-authentication/verification.md`, `docs/workos-authentication/operations.md`). No modifications to P1–P5 production source code.
- **Unified code review:** **SKIPPED** by explicit user instruction (recorded disposition, never marked as passed).

## Commit set and dirty-tree status

- **Baseline commit at Worker 6 start:** `43aac0d` (`docs(workos-authentication): record Worker 5 completion and dispatch Worker 6`)
- **Upstream verified worker commits:**
  - P1 (Foundation & contracts): `ef9dc46` (`fix(auth): resolve foundation verification defects`)
  - P2 (Administration backend): `b908a9d` (`feat(administration): bound credential ingress and browser mutations`)
  - P3 (Application isolation & assembly): `4055882` (`test(auth): attach session cookies to private HTTP harnesses`)
  - P4 (Custom auth UI & settings): `0dc2935` (`fix(auth): satisfy TypeScript App props, children, and administration fixtures`)
  - P5 (Bootstrap & legacy adoption): `9013508` (`docs(auth-bootstrap): record offline verification and operations handoff`)
- **Worker 6 commit ledger:**
  - Task 0: `4cd119e` (`test(auth): baseline test environment and verification counts`)
  - Task 1: `187a64e` (`test(auth): add integration suites for account lifecycle and session fences`)
  - Task 2: `d23c5ff` (`test(auth): verify multi-owner runtime isolation and shared global config`)
  - Task 3: `106c3d2` (`test(auth): run assembled transport isolation and cleanup suites`)
  - Task 4: `1cb767a` (`test(auth): verify isolated bootstrap preflight, refusals, and adoption`)
  - Tasks 5 & 6: `bb729a4` (`test(auth): add closed real-App browser integration fixture`)
  - Tasks 8 & 9: `bf0408e` (`docs(workos-authentication): finalize verification and operations handoff`)
- **Working tree status:** Clean working tree. No untracked files or uncommitted production modifications.

## Environment and resolved versions

- **Operating System:** Windows (win32 10.0.26100)
- **Node.js:** `v24.18.0`
- **npm:** `12.0.1`
- **Package lockfile hashes (SHA-256):**
  - `backend/package-lock.json`: `B070B10BF6B44ECBE32C10BED46808574EF9FACB6D0AAEB1C8E26C755612C77C`
  - `frontend/package-lock.json`: `281D8C3499CB0302E7DE808097F7FF782F31818C2651DAB6F32C68C39997F935`
- **Resolved key package versions:**
  - `backend`:
    - `@workos-inc/node`: `12.2.0`
    - `@nestjs/core` / `@nestjs/common`: `12.1.2`
    - `mongodb`: `6.21.0`
    - `vitest`: `4.1.11`
    - `typescript`: `6.0.3`
    - `@langchain/core`: `1.2.16`
    - `supertest`: `7.3.1`
  - `frontend`:
    - `react` / `react-dom`: `19.3.0`
    - `vite`: `8.3.3`
    - `vitest`: `4.1.11`
    - `typescript`: `6.0.3`

## Baseline package commands and counts (Task 0)

| Package | Command | Exit Code | Result Summary |
| --- | --- | --- | --- |
| `backend` | `npm run build` | 0 | Nest build completed successfully |
| `backend` | `npm run lint` | 0 | 0 errors, 658 warnings (pre-existing unbound method / unused imports in fixtures) |
| `backend` | `npm test` | 1 | 343 passed, 5 failed, 2 skipped files (351 total); 3089 passed, 23 failed, 10 skipped tests (3124 total). Pre-existing P3 baseline timing/benchmark/redaction failures. |
| `backend` | `npm run test:e2e` | 1 | 3 passed, 1 failed, 44 skipped files (48 total); 35 passed, 8 failed, 140 skipped tests (183 total). 8 pre-existing voice-bootstrap assembly failures; 140 native tests skipped due to absent `AURVIN_TEST_MONGODB_URI`. |
| `frontend` | `npm run build` | 0 | Production build completed (`dist/` generated with chunks) |
| `frontend` | `npm run lint` | 0 | 0 errors, 87 warnings (pre-existing React compiler / hook warnings in tests) |
| `frontend` | `npm test` | 0 | 91 passed files; 713 passed tests (0 failed, 0 skipped) |

## Assembled authorization, transport, isolation, and cleanup checks (Tasks 1–3)

### Task 1: Account lifecycle and local session fences (`test/auth/integration/lifecycle.spec.ts`)
- `keeps three simultaneous accounts distinct across auth and administration` (passed)
- `blocks stale cookies after deactivate and reactivate even when provider revoke fails` (passed)
- `keeps onboarding locked after an unknown password-change outcome` (passed)
- `reset fences the old cookie and recovery does not enumerate accounts` (passed)
- `bounds normalized-email login and recovery attempts before provider work` (passed)
- Full suite verification: `npm test -- test/auth/integration/lifecycle.spec.ts test/auth/ test/administration/`: 22 test files passed, 189 tests passed, 0 failures.

### Task 2: Runtime multi-owner privacy and global snapshots (`test/auth/integration/owner-config.spec.ts`)
- `isolates three transcripts and attributes accepted work after another owner runs` (passed): 3 distinct owners (`admin`, `a`, `b`) run through 1 runtime; OpenRouter `user` attributions verified `['b', 'a', 'admin']`; message records strictly segregated; foreign session reads return null.
- `shares published settings for new work while every accepted owner retains its snapshot` (passed): in-flight work retains snapshot (max tokens 2048, model `fixture/old`), new work receives published snapshot (max tokens 512, model `fixture/new`), per-user attribution preserved.
- Limitation noted: runtime publishing verifies runtime snapshot binding directly; HTTP config authorization and persistence activation are verified via admin controller and authorization suites below.
- Related suite verification: `npm test -- test/auth/integration/owner-config.spec.ts test/runtime/auth-owner.spec.ts test/runtime/text-config.spec.ts test/performance/auth-memory-owners.spec.ts`: 4 test files passed, 31 tests passed.

### Task 3 Step 1: HTTP ingress, private boundary, admin authorization
Command: `npm test -- test/auth/http.spec.ts test/http/private-boundary.spec.ts test/assembly/auth-wiring.spec.ts test/admin-config/authorization.spec.ts test/assembly/admin-http.spec.ts test/administration/`
Result: 14 test files passed, 90 tests passed (0 failures).
Key assertions verified:
- Closed admission by default: unauthenticated calls to private boundaries return 401/403 with AuthFault envelope.
- `denies User GET/PUT/credential POST without leaking secrets and allows a session Super Admin` in `test/admin-config/authorization.spec.ts`.
- Exact origin checking, HttpOnly / Strict cookie issuance, 408 on slow body collection, rate limiting on auth endpoints.

### Task 3 Step 2: Multi-owner runtime isolation and transport
Command: `npm test -- test/runtime/auth-owner.spec.ts test/http/ test/performance/auth-memory-owners.spec.ts test/runtime/text-config.spec.ts test/assembly/auth-calendar.spec.ts`
Result: 14 test files passed, 77 tests passed (0 failures).
Key assertions verified:
- `runs two owners through one runtime with captured provider attribution and no cross-owner status` in `test/runtime/auth-owner.spec.ts`.
- `does not let a Super Admin cancel or retry a different owner turn` in `test/runtime/auth-owner.spec.ts`.
- Host/Origin/form/fetch metadata rejection in `test/http/calendar-boundary.spec.ts`.
- Memory-first compartment isolation across owners in `test/performance/auth-memory-owners.spec.ts`.

### Task 3 Step 3: Voice, calendar, and OAuth ownership isolation
Command: `npm test -- test/voice/session/auth-owners.spec.ts test/voice/transport/gateway.integration.spec.ts test/assembly/auth-calendar.spec.ts test/plugins/google-calendar/owner-registry.spec.ts test/plugins/google-calendar/oauth.spec.ts test/plugins/google-calendar/connection-multi.spec.ts test/plugins/google-calendar/connection-refresh.spec.ts test/plugins/google-calendar/discovery.spec.ts`
Result: 8 test files passed, 41 tests passed (0 failures).
Key assertions verified:
- Voice session ticket/token ownership isolation in `test/voice/session/auth-owners.spec.ts`.
- Calendar owner registry strictly isolates connections per `userId` in `test/plugins/google-calendar/owner-registry.spec.ts`.
- Multi-owner connection isolation, credential refresh, and discovery caches partitioned by user ID in `test/plugins/google-calendar/connection-multi.spec.ts`.
- OAuth state and session binding verification in `test/plugins/google-calendar/oauth.spec.ts`.

### Task 3 Step 4: Deactivation hook, teardown, and local recovery
Command: `npm test -- test/assembly/auth-deactivation.spec.ts test/runtime/work.spec.ts test/http/stream-transport.spec.ts test/voice/session/auth-owners.spec.ts test/operations/auth-multi-owner-recovery.spec.ts test/operations/local-recovery.spec.ts test/runtime/local-reconciliation.spec.ts`
Result: 7 test files passed, 29 tests passed (0 failures).
Key assertions verified:
- Deactivation hook cleanly invokes P3 cleanup to tear down active streams/connections in `test/assembly/auth-deactivation.spec.ts`.
- Multi-owner local recovery iterates across distinct user accounts without crosstalk in `test/operations/auth-multi-owner-recovery.spec.ts`.
- Strict replica-set validation before sentinel takeover in `test/operations/local-recovery.spec.ts`.

## Isolated bootstrap and data preservation evidence (Task 4)

Command: `npm test -- test/auth/bootstrap-auth.spec.ts` in `backend`
Result: 1 test file passed, 69 tests passed (0 failures).

Key assertions verified:
- **Argument enforcement and safety gates:**
  - `requires explicit preflight selection and normalizes only email` (passed)
  - `requires all adoption acknowledgements and exact owner confirmation` (passed)
  - Refuses missing, duplicate, unsupported, or malformed flags/arguments (`--force`, raw passwords, mismatched owners)
- **Non-mutating preflight:**
  - `preflights empty or exact-owner data without mutating its inputs` (passed)
  - Inspects via bounded projection (excluding credentials, ciphertext, message texts, checkpoint bytes)
  - Closes read-only MongoDB client cleanly; no indexes or persistence instantiated
- **Refusal and conflict checks:**
  - Refuses existing Super Admin (`ALREADY_BOOTSTRAPPED`), mapped owner, mapped subject, mapped email (`ACCOUNT_CONFLICT`)
  - Refuses ambiguous/missing owners, orphan checkpoints, orphan pending writes (`AMBIGUOUS_OWNER`)
  - Refuses active unreconciled turns or retained local control (`RECOVERY_REQUIRED`)
  - Refuses mismatched WorkOS candidate or legacy owner mismatching `AURVIN_USER_ID` (`TARGET_MISMATCH`)
- **Adoption preservation:**
  - Confirms insertion of exactly one `users` document mapping the legacy owner ID (`aurvin-dev-user`) with role `super-admin`, active status, and `passwordChangeRequired: true`
  - Verifies zero rewriting of existing sessions, messages, checkpoints, agent memory manifests, accounting metadata, or Calendar encrypted connections
  - Subsequent execution returns `ALREADY_BOOTSTRAPPED` refusal without overwriting
- **Operational limitations:**
  - Real database adoption and live WorkOS bootstrap execution remain **UNRUN** (fixture-isolated only). Operator runbook documented in `docs/workos-authentication/operations.md`.

## Closed real-App browser integration fixture evidence (Tasks 5 & 6)

- **Fixture harness files:**
  - `frontend/src/features/auth/integration-tests/fixture-api.ts` (deterministic client double mimicking backend auth, administration, config, and session state)
  - `frontend/src/features/auth/integration-tests/fixture-api.test.ts` (unit tests verifying fixture double behavior; 7/7 passed)
  - `frontend/src/features/auth/integration-tests/auth-browser.html` (entry point hosting full production `App` with `FixtureApiClient`)
  - `frontend/src/features/auth/integration-tests/auth-browser.tsx` (11 end-to-end DOM scenario checks)
- **Browser subagent execution:**
  - Delegated to subagent `dd1cd09f-d2fc-44d9-b695-a9c8ba111425`
  - **Host facts confirmed (`BROWSER_HOST_FACTS`):**
    - Visited origins: `http://127.0.0.1:5173`
    - Blocked origins: 0
    - Latest screenshot: `final_step_22.png`
  - **Sanitized screenshot location:** `C:\Users\Peter\AppData\Local\Temp\opencode\auth-browser-results.png`
- **DOM checks executed and outcomes:**
  1. `Check 1: Custom login & session validation`: Invalid credentials renders generic error message (`Invalid email or password.`); valid login transitions cleanly into authenticated `App`. (PASSED)
  2. `Check 2: Mandatory password change onboarding gate`: Prompts for temporary password and new password; enforces matching confirmation and length validation; updates password and transitions to main application. (PASSED)
  3. `Check 3: Role navigation gating (Super Admin)`: Super Admin sees "Manage Aurvin" navigation entry in sidebar and opens Administration and Config tabs. (PASSED)
  4. `Check 4: User administration - create user`: Super Admin navigates to Administration panel, fills creation form with role assignment, creates user, verifies listing in user table, and confirms rejection of duplicate emails. (PASSED)
  5. `Check 5: User administration - lifecycle & reset`: Super Admin deactivates user (status badges update to Inactive), reactivates user, and dispatches a password reset link. (PASSED)
  6. `Check 6: Role navigation gating (User)`: User account logs in; verified absence of "Manage Aurvin" navigation; settings shows only personal preferences; direct attempt to open Admin Config or Administration routes is denied. (PASSED)
  7. `Check 7: Personal-data isolation (Super Admin, User A, User B)`: Confirms complete data segregation across three accounts. User A sees session "User A Chat"; User B sees session "User B Chat"; Super Admin sees "Admin Setup"; switching accounts wipes composer drafts; no cross-user sessions appear in sidebar. (PASSED)
  8. `Check 8: Session timeout / invalid cookie redirect`: When session becomes invalid (401), application transitions cleanly back to `/login` with an informational notice. (PASSED)
  9. `Check 9: Logout flow`: Clicking sign out from profile menu terminates session, clears cookie, and returns to login form. (PASSED)
  10. `Check 10: Forgot password flow`: Clicking "Forgot password" displays request form, submits email, confirms receipt without enumerating account existence, and accepts valid reset token. (PASSED)
  11. `Check 11: Mobile viewport responsiveness`: Resized viewport to 375x667; verified mobile drawer, login form, and navigation controls render without overflow or layout breakage. (PASSED)
- **Result:** `data-fixture-passed="true"`, `11/11 passed`, `unexpected=0`.
- **Browser limitations:** Strict-cookie OAuth cross-site browser navigation requires a dual-origin testing harness and live Google/WorkOS credentials; marked as blocked for browser-only headless fixtures and verified via backend HTTP assembly suites in P3.

## Native database verification (Task 7)

- **Environment check:** `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX` were inspected in the process environment.
- **Outcome:** **SKIPPED (isolated prerequisites absent)**. Neither environment variable was set (`False`).
- Per project rules, native database tests are strictly opt-in and skip gracefully when isolated credentials are not provided to prevent running tests against shared or unverified databases.

## Final package verification commands and counts (Task 8)

| Package | Command | Exit Code | Final Result Summary | Delta vs Baseline |
| --- | --- | --- | --- | --- |
| `backend` | `npm run build` | 0 | Nest build completed successfully | Clean build maintained |
| `backend` | `npm run lint` | 0 | 0 errors, 660 warnings | +2 warnings in P6 test files (unbound method vi mock references) |
| `backend` | `npm test` | 1 | 345 passed, 5 failed, 2 skipped files (353 total); 3096 passed, 23 failed, 10 skipped tests (3131 total). | +2 files passed, +7 tests passed (`lifecycle.spec.ts`, `owner-config.spec.ts`). 5 failed files and 23 failed tests are identical pre-existing baseline failures. |
| `backend` | `npm run test:e2e` | 1 | 3 passed, 1 failed, 44 skipped files (48 total); 35 passed, 8 failed, 140 skipped tests (183 total). | Identical to baseline; 8 pre-existing voice-bootstrap failures; 140 native tests skipped due to absent test URI. |
| `frontend` | `npm run build` | 0 | Production build completed (`dist/` generated with chunks) | Clean build maintained |
| `frontend` | `npm run lint` | 0 | 0 errors, 88 warnings | Clean lint maintained (0 errors) |
| `frontend` | `npm test` | 0 | 92 passed files, 720 passed tests (0 failed, 0 skipped) | +1 file passed, +7 tests passed (`fixture-api.test.ts`) |

## Comprehensive AC1–AC8 acceptance matrix

| Acceptance Criteria | Scope / Description | Status | Verification Evidence / Tests | Commit Hash | Limitations / Notes |
| --- | --- | --- | --- | --- | --- |
| **AC1** | Custom login, session validation, cookie security, closed admission | `passed (fixture)` & `passed (browser fixture)` | **Backend:** `test/auth/integration/lifecycle.spec.ts` (`bounds normalized-email login and recovery attempts before provider work`), `test/auth/http.spec.ts`, `test/http/private-boundary.spec.ts`<br>**Frontend:** `auth-browser.html` Check 1 (`Custom login & session validation`) | `187a64e`, `bb729a4` | Closed admission enforced; unauthenticated private endpoints return 401 AuthFault. HttpOnly / SameSite=Strict cookies enforced. OAuth cross-site redirects with Strict cookies verified via backend assembly suites. |
| **AC2** | Mandatory initial password change and recovery | `passed (fixture)` & `passed (browser fixture)` | **Backend:** `test/auth/integration/lifecycle.spec.ts` (`keeps onboarding locked after an unknown password-change outcome`, `reset fences the old cookie and recovery does not enumerate accounts`), `test/auth/recovery.spec.ts`<br>**Frontend:** `auth-browser.html` Check 2 (`Mandatory password change onboarding gate`) & Check 10 (`Forgot password flow`) | `187a64e`, `bb729a4` | Single-use reset tokens enforced; timeout recovery verified. Real email delivery unrun (verified with deterministic mock recorder). |
| **AC3** | Exactly two simple roles (Super Admin vs User permissions & API gating) | `passed (fixture)` & `passed (browser fixture)` | **Backend:** `test/admin-config/authorization.spec.ts` (`denies User GET/PUT/credential POST without leaking secrets and allows a session Super Admin`), `test/auth/integration/lifecycle.spec.ts`<br>**Frontend:** `auth-browser.html` Check 3 (`Role navigation gating - Super Admin`) & Check 6 (`Role navigation gating - User`) | `d23c5ff`, `106c3d2`, `bb729a4` | Exactly two roles (`super-admin` vs `user`). Super Admin granted access to "Manage Aurvin" (Administration & Config). User granted access to personal Chat & Settings only. Super Admin cannot access or override other users' personal data. |
| **AC4** | User administration lifecycle (create, deactivate, reactivate, send reset) | `passed (fixture)` & `passed (browser fixture)` | **Backend:** `test/administration/` (14 test files, 90 tests), `test/assembly/auth-deactivation.spec.ts`, `test/auth/integration/lifecycle.spec.ts` (`blocks stale cookies after deactivate and reactivate`)<br>**Frontend:** `auth-browser.html` Check 4 (`Create user`) & Check 5 (`Deactivate/reactivate & send reset`) | `187a64e`, `106c3d2`, `bb729a4` | Super Admin creates users with initial role; duplicate emails rejected; deactivation terminates active streams, fences existing cookies, and prevents new logins; reactivated users require new authentication. |
| **AC5** | Personal-data isolation for both roles (3 accounts: Super Admin + 2 Users; no cross-user leaks) | `passed (fixture)` & `passed (browser fixture)` | **Backend:** `test/auth/integration/owner-config.spec.ts` (`isolates three transcripts and attributes accepted work after another owner runs` across `admin`, `a`, `b`; OpenRouter `user` attributions `['b', 'a', 'admin']`), `test/runtime/auth-owner.spec.ts`, `test/voice/session/auth-owners.spec.ts`, `test/plugins/google-calendar/owner-registry.spec.ts`, `test/plugins/google-calendar/connection-multi.spec.ts`<br>**Frontend:** `auth-browser.html` Check 7 (`Personal-data isolation across Super Admin, User A, and User B`) | `d23c5ff`, `106c3d2`, `bb729a4` | Full segregation across 3 accounts: chats, sessions, messages, checkpoints, voice tickets, and calendar credentials strictly partitioned by `userId`. Composer drafts wiped on account switch. Foreign session reads return null. |
| **AC6** | Global settings remain shared across users | `passed (fixture)` & `passed (browser fixture)` | **Backend:** `test/auth/integration/owner-config.spec.ts` (`shares published settings for new work while every accepted owner retains its snapshot`), `test/admin-config/authorization.spec.ts`<br>**Frontend:** `auth-browser.html` Check 2 & Check 6 (direct plugin access without loading admin config) | `d23c5ff`, `106c3d2`, `bb729a4` | Global settings changes affect only new turns; in-flight turns retain accepted configuration snapshot. Users configure personal plugins directly without access to global admin configuration. |
| **AC7** | Explicit bootstrap and data adoption preflight/refusal checks | `passed (fixture)` (backend), `unrun (not authorized)` (production adoption) | **Backend:** `test/auth/bootstrap-auth.spec.ts` (69 tests passed; non-mutating preflight, argument validation, refusal on existing Super Admin, orphan checkpoints, orphan pending writes, active unreconciled turns, legacy owner preservation) | `1cb767a` | Exactly one `users` document mapping legacy owner to `super-admin`. Zero historical transcript/checkpoint rewriting. Production adoption unrun; comprehensive operations runbook provided in `operations.md`. |
| **AC8** | Minimal, reliable integration (package suites, build, lint) | `passed (fixture)` | **Backend:** `npm run build` (0), `npm run lint` (0), `npm test` (345 passed files), `npm run test:e2e` (3 passed files, 44 skipped)<br>**Frontend:** `npm run build` (0), `npm run lint` (0), `npm test` (92 passed files, 720 tests), `auth-browser.html` (11/11 passed) | `4cd119e`, `bb729a4` | All new Plan 6 integration suites pass with zero regressions to P1–P5 code. Pre-existing P3 baseline failures documented and isolated. |

## Defects and owner reruns

- **Defect 1 (Browser check credential error mismatch):**
  - *Symptom:* Browser check expected `'Invalid credentials'` while component renders `'Invalid email or password.'`.
  - *Resolution:* Updated assertion in `auth-browser.tsx` to match production text.
- **Defect 2 (Browser check onboarding title mismatch):**
  - *Symptom:* Check expected `'First-time sign in'` while `MandatoryPasswordChangeForm` renders `'Set a new private password'`.
  - *Resolution:* Updated title check to match `'Set a new private password'` and temporary password input ID to `#temp-password`.
- **Defect 3 (Browser check cascading null invocation):**
  - *Symptom:* Uncaught failure in Check 2 left DOM on onboarding form, causing subsequent checks to look for `#login-email` which returned `null`. Calling property descriptor setter on `null` threw `TypeError: Illegal invocation`.
  - *Resolution:* Added `ensureLoggedOut(root)` and `openAdminSection(root, targetTab)` helper routines to isolate each check and clean up state between tests.
- **Defect 4 (Browser check button label mismatch):**
  - *Symptom:* Button text mismatch (`'Create user'` vs `'Create User'`, `'Send reset'` vs `'Reset password'`).
  - *Resolution:* Updated selector targets to exact button text in `AdministrationPanel.tsx`. After fix, all 11 browser checks passed cleanly.

## External / unrun gates

- **Isolated native MongoDB tests:** **SKIPPED (isolated prerequisites absent)**. No isolated test database URI was provided; production databases are never targeted.
- **Live WorkOS provider communication:** **UNRUN (not authorized)**. Deterministic mocks and doubles used for all tests.
- **Real email delivery / reset token delivery:** **UNRUN (not authorized)**. Mocks verify provider dispatch without external mail transmission.
- **Real application data bootstrap / adoption:** **UNRUN (not authorized)**. Unit/fixture checks verify preflight, refusal, and non-mutating behavior.
- **Production deployment / Azure certification:** **NOT AUTHORIZED**.

## Operations handoff

- Complete operational runbook finalized in `docs/workos-authentication/operations.md`.
- Key operational ceilings verified:
  - Login attempt rate limit: 10 attempts per 60 seconds per normalized email.
  - Recovery attempt rate limit: 3 attempts per 60 seconds per normalized email.
  - Body payload limit: 4 KiB for JSON auth endpoints, 16 KiB for cookie header parsing.
  - Request timeout budget: 10 seconds.
  - Session concurrency: Single live session ID per user.
- Failure reconciliation guidance:
  - If bootstrap encounters `WRITE_UNCONFIRMED` or `CLOSE_UNCONFIRMED`, stop application, inspect `users` collection via read-only tools, and do not rerun bootstrap without manual audit.
  - If a user session is revoked or deactivated, subsequent requests fail closed with 401 immediately without leaking internal authentication state.

## Review

- Unified code review is **SKIPPED** by explicit user instruction (never recorded as passed).
