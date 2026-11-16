# WorkOS bootstrap and legacy-owner operations

## Authorization and evidence boundary

This procedure selects an already provisioned WorkOS identity and creates the first local Aurvin Super Admin. It does not create a WorkOS account, change a password/email/externalId, send email, migrate transcripts or authorize deployment. The CLI is never called from startup or login. WorkOS credentials alone do not admit an unknown local account.

Implementation/fixture evidence is separate from an operator run. Real application-data adoption: **UNRUN**. Live WorkOS validation: **UNRUN**. Backup/restore drill: **UNRUN**. Review: **SKIPPED**. P6 records actual source commits/checks; do not infer a completed migration from source, this runbook or test passes.

Obtain separate explicit authorization for the target database, exact WorkOS environment/subject, legacy owner, maintenance window, backup/restore, live read calls and the one mapping insertion. No infrastructure provisioning, paid service/add-on, live inference, real mailbox test, private-data browsing or public deployment is authorized by the implementation plan.

## Prerequisites and stop boundary

1. Use the approved release after P1–P5 worker gates; record the exact Git SHA and Node/package versions. Backend requires Node `^22.22.3 || ^24.15.0 || >=26.0.0`; use its own lockfile. Build from `backend/` with `npm run build` before these examples.
2. Verify native MongoDB, an explicit replica-set URI naming the intended set, writable primary, admitted `single-process` topology, bounded safety settings and the exact database. Azure/Cosmos/standalone/mongos profiles are not admitted by this command. Never print the URI.
3. An authorized operator must separately provision/select the exact intended WorkOS password account. Confirm the environment and subject from the provider dashboard; do not choose a subject by email search inside Aurvin. Public sign-up off, email/password on, MFA off. WorkOS's existing account must meet P1's password-auth prerequisites; the CLI does not bypass provider email-verification/MFA restrictions. `externalId` must be null or the selected legacy owner, never another internal ID. A null value stays null; Aurvin's unique local subject mapping is authoritative.
4. Configure `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD` (at least 32 characters), persistence settings and the **original** `AURVIN_USER_ID` privately on the server. Existing `AURVIN_CONFIG_ENCRYPTION_KEY` and Calendar infrastructure must be preserved. Do not put secrets in command arguments, evidence, source, chat or `VITE_*`. Do not change `AURVIN_USER_ID` to a WorkOS subject or new UUID.
5. Freeze all writers: stop admissions, drain/reconcile accepted text/voice/accounting work, shut down/close the app and disable watch-mode/supervisor restarts. Also stop other backend copies, maintenance tools and external writers. Prove the exact process is stopped using the existing host procedures. Keep the freeze through backup, preflight, adoption and verification. A CLI flag is an attestation, not proof. The default executor can take over a sentinel; it does not make overlapping processes safe.
6. Reconcile unfinished work under the existing [Phase 1 operations procedures](../aurvin-phase-1/operations.md) and P3 recovery gate **before adoption**. Unmapped legacy work is not permission to run a live backend with a shared development identity. Never clear owner IDs, delete sentinels because leases expired, or replay inference to make bootstrap pass. Local-crash-recovery mode requires its existing clean stopped-owner handoff; never toggle it off to bypass retained local control. Pending/busy/malformed/future state is a stop condition.

## Backup and rollback

Before any mutation, make and verify a complete quiescent backup of the exact database, **including** `users`, `config`, `integration_connections`, `sessions`, `messages`, `agent-memory`, `metadata`, `checkpoints`, `checkpoint_writes` and all other extant collections/index/control records. Old six-collection examples are not sufficient for today's application. Preserve encrypted records and the master key using separate approved secret custody; a database dump without the right key cannot restore Calendar/global credentials.

Use the approved native Database Tools and access-restricted tool config files (not URI/password command arguments). The following PowerShell variables must already be set privately by the operator: `$BackupToolConfig`, `$RestoreToolConfig`, `$SourceDb`, `$RestoreDb`, `$ArchivePath`. `$RestoreDb` is a **new isolated empty database**, never source/application/production. Tools must support `--config`. Keep tool stderr private; it may contain connection details.

```powershell
mongodump --config "$BackupToolConfig" --db "$SourceDb" --archive="$ArchivePath" --gzip
Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256
mongorestore --config "$RestoreToolConfig" --archive="$ArchivePath" --gzip --nsFrom="$SourceDb.*" --nsTo="$RestoreDb.*"
```

A gzip archive is not encrypted: use the approved encrypted, access-restricted backup store. Record release/schema/saver/tool versions, freeze time, collection counts/index definitions, archive hash and restore-test outcome without URI, passwords, tokens or message bodies. Validate the restored database privately against the frozen boundary before checking `--backup-confirmed`. Do not use `--drop` or overwrite a database. Restored executor/control records do not authorize two executors.

There is no automatic undo or `--force`. If write/close outcome is uncertain, keep the app stopped and inspect the exact `users` mapping using authorized read-only access; do not retry, delete the row or change the target. If wrong ownership was selected, keep access closed and treat it as an incident, not an email/ID edit.

Before new application writes, rollback is an explicitly authorized full consistent restore into a **new isolated target**, validation of history/checkpoint/accounting/config/plugin bindings and a separately approved endpoint switch. Never run incompatible pre-auth code against the adopted database or reopen the old shared development identity. After new writes, restoring an earlier backup loses those writes and does not undo WorkOS sessions/external side effects/provider costs; decide retention/reconciliation separately. No partial collection restore, destructive users-row deletion or automatic prompt replay is supplied here. Do not delete/recreate the selected WorkOS account as compensation.

## Preflight

Run only in the separately authorized window; routine fixture checks do not run these examples. All examples run in `backend/`, loading its `.env` server-side. The sample legacy owner is the historic default and the sample subject/email are illustrative, not a target selection recommendation:

```powershell
npm run auth:bootstrap -- preflight --workos-user user_operator --email admin@example.com --legacy-owner aurvin-dev-user
```

This makes an exact-ID, bounded **read-only** WorkOS lookup and read-only native MongoDB inspection. It does not instantiate admitted persistence, set indexes, take over executor state, insert users, decrypt credentials or mutate application data. Read-only client cleanup must finish before success. Server-side connection/read logs may still be generated. No provider response/error bodies are printed.

Expected success: exit 0, one `BOOTSTRAP_PREFLIGHT_OK` report with selected owner/subject/email, `source: bootstrap-operator`, bounded per-collection counts and Calendar assessment. Verify these three identity fields privately against the explicit intended mapping. Reports contain sensitive account metadata, not credentials; restrict their storage.

The owner flag must exactly equal configured `AURVIN_USER_ID`; omission does not silently adopt the default. Empty personal data is allowed for a fresh installation, with explicit selection still mandatory. A preflight report is not a signed migration authorization, process-death proof, backup verification, real plugin check, admission certification or future concurrency lock. Adoption repeats the checks under ownership.

## Explicit adoption

After confirming backup/restore, explicit authorization, exact mapping and stopped writers, run:

```powershell
npm run auth:bootstrap -- adopt --workos-user user_operator --email admin@example.com --legacy-owner aurvin-dev-user --confirm-owner aurvin-dev-user --app-stopped --backup-confirmed --authorized
```

Expected success: exit 0, one `BOOTSTRAP_ADOPTED` report **after** confirmed insertion and persistence close. Exactly one new local `users` account maps the unchanged `aurvin-dev-user` to the exact subject/email, role `super-admin`, active status, `passwordChangeRequired: true`, null current session and epoch zero. The administrator must sign in and replace the bootstrap password before chat/config/admin/plugin access. There is no session or password in the command output.

No historical application document is rewritten: transcript order/IDs, provenance, graph thread IDs, checkpoint bytes/pending writes, accounting attribution and global config remain as stored. Normal admitted opening/closing may create indexes or change executor/journal control metadata; this is why adoption is mutating and preflight is separate. Those control changes are not transcript/accounting migration.

The original Calendar owner, grant, consent, connection IDs, credential versions and encryption key/AAD remain unchanged. `preserved-unverified` means exactly that: bootstrap never decrypts, refreshes or claims live validity. Keep existing connected state only when existing runtime checks and consent/deployment policy permit it. Missing/wrong keys, revoked grants or failed binding checks require **reconnection through the existing plugin UI**; never reseal credentials under another owner or invent consent. A pre-existing reconnect-required connection remains so.

## Refusal and uncertain outcomes

- Exit 2 / `BOOTSTRAP_REFUSED`: malformed/missing/duplicate options or acknowledgements; missing config; mismatched owner/subject/email/externalId; any existing Super Admin; mapped owner/subject/email; ambiguous/mixed/missing owners; orphan checkpoints; unsupported topology; inspection ceiling; unreconciled work/local control. No force/adopt-by-email/update/promote path exists. Fix the identified prerequisite through separately authorized procedures, not credential/owner retargeting.
- At most 5,000 projected records per inspected collection, batches of 50 and ten-second connect/query/WorkOS bounds. Row 5,001 refuses with `INSPECTION_LIMIT`; timeouts fail closed. Larger datasets require a separately planned bounded inspection, not raising constants blindly or skipping collections.
- Exit 1 / `BOOTSTRAP_FAILED`: unavailable service, cancellation, unknown error, `WRITE_UNCONFIRMED` or `CLOSE_UNCONFIRMED`. Never assume no write occurred; keep the application stopped and reconcile the exact mapping plus executor/control state. No automatic retry, rollback, compensation or provider overwrite occurs.
- Any repeat after a confirmed adoption refuses with `ALREADY_BOOTSTRAPPED`; it does not silently succeed or overwrite the account. Repeated refusal is not evidence that the previous close/backup was safe.

## System configuration and transport checklist

1. **Topology and proxy:**
   - Client and API must share same origin (`/api` routed through frontend proxy or reverse proxy).
   - Backend loopback binding: default `127.0.0.1:3000`.
   - Browser configuration: `VITE_API_BASE=/api`. Never place credentials or secrets in `VITE_*` environment variables.
2. **Server-side credentials:**
   - `WORKOS_API_KEY`: Server-side API key (starts with `sk_`).
   - `WORKOS_CLIENT_ID`: WorkOS client ID (starts with `client_`).
   - `WORKOS_COOKIE_PASSWORD`: High-entropy encryption secret, minimum 32 characters.
   - Credentials must remain strictly on the backend.
3. **Cookie security:**
   - Cookie name: `aurvin_wos_session`.
   - Attributes: `HttpOnly`, `SameSite=Strict`, `Path=/api`.
   - `Secure` flag: enforced automatically on non-loopback hosts. HTTP permitted only on `127.0.0.1` and `localhost` for local development. Remote environments require HTTPS.
4. **CORS and CSRF policy:**
   - CORS `credentials: true` restricted to exact configured frontend origin.
   - Non-GET mutating requests enforce origin and header validation.
5. **Diagnostic liveness and degradation:**
   - Missing WorkOS environment boots into diagnostic liveness only (`/api/operations/live` returns 200, `/api/operations/ready` returns 503).
   - Zero runtime fallback to legacy development identity (`AURVIN_USER_ID`) for private endpoints.

## Operator prerequisites and WorkOS setup

1. **WorkOS Dashboard configuration ([WorkOS Documentation](https://workos.com/docs)):**
   - **Authentication:** Enable email and password authentication.
   - **User sign-up:** Disabled (closed admission; new accounts provisioned only by Super Admin via Aurvin Administration).
   - **MFA:** Disabled for approved V1 scope.
   - **Password recovery:** WorkOS built-in password reset emails enabled; redirect URL configured to `https://<aurvin-host>/reset-password`.
   - **No custom mailer:** Relies on WorkOS transactional recovery delivery.
2. **Provisioning flag vs mailbox verification:**
   - When Super Admin provisions a User via Administration API, `emailVerified: true` is set on WorkOS to permit password authentication without a separate verification step. This is an API flag, **not** verification of mailbox control.
   - Mailbox control is confirmed upon initial password recovery or operator-monitored invitation.
3. **Pricing and plan boundaries:**
   - WorkOS AuthKit email/password is free for up to 1,000,000 monthly active users (as of November 2026). 10–15 Aurvin users incur $0 expected cost.
   - Moving from staging to production on WorkOS requires adding billing details at $0 usage.
   - Paid add-ons (Enterprise SSO, custom login domains at $99/mo, Radar fraud detection) are **NOT authorized** and must remain disabled.

## Verified operational limits and ceilings

1. **Authentication rate limits:**
   - Sign-in: 10 attempts per 60 seconds per normalized email address.
   - Password recovery: 3 attempts per 60 seconds per normalized email address.
   - Mutation actions: 60 requests per minute per process.
2. **Ingress and timeout budgets:**
   - Auth request body: maximum 4 KiB; non-JSON or chunked bodies exceeding limit fail with 413.
   - Body collection timeout: 5 seconds (returns 408 on slow transmission).
   - WorkOS provider calls: 10-second timeout.
3. **Session admission and invalidation:**
   - Exactly one live WorkOS session (`currentWorkosSessionId`) per local account.
   - Logging in on a new device/browser updates the session ID, invalidating previous cookies.
   - Account deactivation immediately clears `currentWorkosSessionId` and triggers asynchronous P3 background work cleanup (streams, WebSockets, LiveKit sessions).
   - Reactivating an account does **not** restore the old session ID; a fresh login is required.
   - Password reset via token invalidates prior sessions and lifts `passwordChangeRequired`.
4. **Capability revocation:**
   - Local session invalidation is instantaneous at the `/api` boundary.
   - External capabilities (LiveKit room tokens, Google Calendar access tokens) expire within their bounded provider lifetimes (typically $\le$ 1 hour) and cannot be renewed once local auth is fenced.

## Failure and reconciliation guidance

1. **Partial account provisioning:**
   - If WorkOS user creation succeeds but local database write fails (e.g. `ACCOUNT_WRITE_UNCERTAIN`), the account is not admitted locally.
   - Operator must inspect the WorkOS dashboard and local database. Do not attempt blind retries or email-based adoptions.
2. **Bootstrap uncertain outcomes:**
   - In case of `WRITE_UNCONFIRMED` or `CLOSE_UNCONFIRMED`, keep the backend stopped and inspect the `users` collection using authorized read-only tools.
   - Never use `--force` or delete the row manually.
3. **Configuration management:**
   - Global configuration is a singleton document.
   - Updates made by Super Admin activate immediately for new turns; in-flight turns retain their captured snapshot.
   - Standard users never read configuration directly; they access capabilities through safe, dedicated routes.
4. **Calendar and plugin access:**
   - Authentication changes do not invalidate stored OAuth refresh tokens, but do not grant new consent.
   - If a user's plugin access shows `reconnect-required`, the user must re-authenticate with Google via the plugin interface.

## Verification

Routine implementation checks use deterministic fixtures only, from `backend/`:

```powershell
npm test -- test/auth/bootstrap-auth.spec.ts
npm test -- test/persistence/auth-users.spec.ts
npm run build
npm run lint
npm test
npm run test:e2e
```

The inspected P1 repository spec is `test/persistence/auth-users.spec.ts`; its separate native spec is `test/persistence/auth-users.native.e2e-spec.ts`. Native tests can skip without `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; they create/drop generated isolated databases only. Do not point them at application data, print a URI, or count skips/empty discovery as passes. P6 owns cross-feature/native preservation evidence; fixtures do not certify a real MongoDB/WorkOS/Google migration.

In an authorized real maintenance window, verify privately: exactly one intended Super Admin mapping, old internal ID unchanged; all non-control historical records/counts/IDs/order/provenance/accounting/config/encrypted bytes unchanged; no unintended mapping; expected executor close state. After authorized restart verify required first-password change, sign-in/out, own history and existing plugin status; use no paid inference. Live login/email/Google calls require their separate authorization. P6 verifies normal accounts cannot see adopted personal data and Super Admin has no read-all ownership override. Never use a second application process as a migration probe.

## Evidence ledger

| Evidence | Initial disposition | Final P6 disposition |
| --- | --- | --- |
| CLI/unit fixture checks | Passed on `810bd25` (Node v24.18.0): `test/auth/bootstrap-auth.spec.ts` 69 passed; `test/persistence/auth-users.spec.ts` 7 passed. | Confirmed passed: `test/auth/bootstrap-auth.spec.ts` 69 passed, 0 failures. |
| Account lifecycle & session fences | Planned in P6 | Passed: `test/auth/integration/lifecycle.spec.ts` 5 passed, 0 failures. |
| Three-owner runtime privacy & config snapshots | Planned in P6 | Passed: `test/auth/integration/owner-config.spec.ts` 2 passed, 0 failures. |
| Assembled auth HTTP & boundary suites | P3 committed | Confirmed passed: 14 test files, 90 tests passed. |
| Multi-owner isolation & Calendar/Voice suites | P3 committed | Confirmed passed: 29 test files, 147 tests passed. |
| Real-app browser DOM verification | Planned in P6 | Passed: 11/11 DOM checks passed, unexpected=0. Verified via browser subagent with screenshot evidence. |
| Package build/lint/test | Passed on `810bd25` | Confirmed: backend build/lint pass; frontend build/lint/tests (91 files, 720 tests) pass. |
| Isolated native preservation | UNRUN; P6 owns authorized fixture evidence | SKIPPED (isolated prerequisites `AURVIN_TEST_MONGODB_URI` absent). |
| Live WorkOS exact-subject/login/email | UNRUN; separate authorization/configuration required | UNRUN (not authorized; deterministic doubles used). |
| Backup/restore/rollback drill | UNRUN; operator-owned separately authorized maintenance | UNRUN (operator-owned maintenance window). |
| Real application-data adoption | UNRUN; never inferred from fixture checks | UNRUN (never inferred from fixture checks). |
| Google grant/decryption/reconnection | UNRUN against real data/services | UNRUN (fixture-tested; real services require operator authorization). |
| Deployment/Azure certification | NOT AUTHORIZED / NOT ESTABLISHED | NOT AUTHORIZED / NOT ESTABLISHED. |
| Unified review | SKIPPED, not passed | SKIPPED by user instruction. |
