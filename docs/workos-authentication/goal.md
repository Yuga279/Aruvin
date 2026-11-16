# Goal: Simple WorkOS authentication and user administration

## Approval and workflow boundary

On 10 November 2026 the user selected WorkOS, custom sign-in inside Aurvin, two roles, private per-user data, global configuration, and a Super Admin user-management tab. Subsequent choices confirmed mandatory replacement of admin-set temporary passwords; create/list, deactivate/reactivate and email password reset; adoption of existing development data by the initial Super Admin; and **no MFA for V1**.

The user explicitly requested a simple, secure-enough implementation following the repository's Ponytail principle, without excessive validation, verification, authorization machinery or unrelated refactoring. After the lean design was summarized, the user said **“proceed”**, authorizing preparation of this goal and the complete MAW state/dependency graph.

**The written specification still requires user approval.** This preparation does not authorize research/planner/worker dispatch, implementation, provider account provisioning, application-data migration, live service calls, paid features or deployment. Record approval of these written artifacts before resuming execution. Code review is **skipped**; research, planning, meaningful tests, defect correction and final verification are not skipped.

## Objective and simplicity rule

Add practical email/password authentication for approximately 10–15 users using WorkOS for credentials and Aurvin for a small local account/role record. Extend existing chat/settings/plugin surfaces rather than building a new identity platform.

- Use the official supported WorkOS Node SDK and its session facilities where applicable. Do not implement password hashing, token cryptography or an identity provider.
- Store one explicit role value, initially `super-admin` or `user`. A small role check is sufficient; no generic permission engine, role editor, WorkOS organization model or role synchronization.
- Reuse existing persistence, request bounds, safe errors, runtime, configuration activation and UI patterns. Add only what this feature actually needs.
- Basic authentication, role checks, private-data ownership and secret handling are requirements, not optional hardening. Extra security products, enterprise identity features and unrelated cleanup are out of scope.

## Account and ownership model

- WorkOS owns password credentials. Aurvin stores a bounded account record linking a stable internal `userId` to a unique WorkOS user ID, normalized email, role, active/inactive status, initial-password-change requirement and necessary version/timestamps.
- Use a single `users` collection through the existing admitted persistence lifecycle. Reuse existing record/index conventions. Do not store passwords, password hashes, recovery tokens or growing audit/session arrays in user records.
- WorkOS user IDs and internal user IDs are unique. New accounts receive server-generated internal IDs; neither an HTTP client nor an administrator can select another person's internal owner ID.
- Aurvin's local role/status is authoritative for application access. WorkOS authentication alone does not admit an unknown or inactive account. Email addresses are contact/login fields, not durable ownership keys.
- Both roles own only their personal chats, messages, artifacts, voice sessions and plugin connections. Super Admin grants administrative capabilities, **not** access to another user's personal data or connected-account credentials.
- There is no impersonation, read-all-users-data API, transfer of other users' ownership, or admin password-reveal feature. Admins cannot change an activated user's email/password to take over that account.

## Role behavior and navigation

| Capability | Super Admin | User |
| --- | --- | --- |
| Start chats; view/manage own history | Yes | Yes |
| Use admitted voice features and own artifacts | Yes | Yes |
| Connect/manage own plugins and calendars | Yes | Yes |
| Open/change global Config | Yes | No |
| Open Analytics | Yes | No |
| Open Administration and manage accounts | Yes | No |
| Access another user's personal data | No | No |

- Preserve the existing Manage Aurvin dashboard. Super Admin sees **Config**, **Plugins**, **Analytics**, and a new **Administration** tab. User can open the same settings surface for **Plugins**, without requesting restricted config/admin data.
- Profile UI reflects the signed-in account and role. Sign out becomes functional. Both roles can access applicable password/account controls.
- Default to chat after successful authentication/onboarding. Preserve the existing one-ChatProvider/one-voice-owner design while navigating within a signed-in account.
- Sign out, session expiry or account switching clears private client state and closes that browser's streams/media so the next account cannot see the previous account's history, drafts, plugin state or artifacts. Do not clear unrelated users' work.
- Analytics remains the existing empty/placeholder surface. This workflow protects access; it does not implement analytics, private transcript reporting or a new dashboard.
- Represent roles explicitly and keep checks readable so later roles can be added. Do not implement future roles or a dynamic permission editor now. Administration creates `user` accounts only; Super Admin bootstrap is an operator action.

## Login, temporary passwords and recovery

- Provide simple, Aurvin-styled email/password sign-in, mandatory first-password-change, forgotten-password and reset-password screens. No hosted-login redirect is required for routine sign-in.
- Disable public self-registration. No invitation-based public sign-up, automatic email-domain admission, social login, enterprise SSO, passwordless login or MFA in V1.
- Only a fully authenticated, active, provisioned account may reach chat/plugins/admin APIs. An account requiring its initial password replacement gets only the limited password-change/logout flow until replacement succeeds.
- Super Admin supplies an initial email and temporary password. After password authentication, the new user must choose a different private password before using Aurvin. Only confirmed provider password replacement and the corresponding local state change may remove that gate. An unknown/failed result must not unlock the account.
- Do not add a separate email-verification workflow. Do not confuse an admin-entered address with proof of mailbox ownership; recovery is delivered to the recorded user email.
- Forgotten-password requests have a generic response to avoid account enumeration. Send a WorkOS-supported recovery link to the user's mailbox, not to the admin. Never return raw reset links/tokens through Administration or log them.
- Reset links are bounded, single-use provider tokens. Reset completion changes the WorkOS credential and invalidates old sessions using supported session facilities and the smallest necessary local account version check. The user signs in again; successful recovery also satisfies the initial-password-change requirement where applicable.
- Retain the temporary password only transiently in the creation form and provider request. Clear it on success/cancel/exit; never include it in user-table rows, normal responses, browser storage, logs or persisted Aurvin records.
- If WorkOS requires an additional prerequisite for a selected custom flow, research must report it. Do not silently add email verification/MFA or weaken onboarding; return to the user only if the approved behavior cannot be implemented simply.

## Sessions and essential request protection

- NestJS handles WorkOS calls and issues a session through an HttpOnly cookie using supported SDK facilities. Keep WorkOS keys and session secrets server-side; frontend configuration remains `VITE_API_BASE=/api`.
- Use same-origin UI/API deployment, an appropriate SameSite policy and Secure cookies outside explicit loopback HTTP development. Retain the existing exact-origin/browser mutation protections and extend them to cookie-authenticated requests; do not invent a second CSRF framework where the existing origin check suffices.
- Use ordinary bounded request validation and provider timeouts, safe login errors, and a small login/recovery attempt limiter by reusing existing mechanisms where possible. Do not add CAPTCHA, risk scoring, device fingerprinting, security analytics or a new rate-limit service.
- Validate sessions server-side using the SDK; never trust user IDs, roles, unsigned claims or ownership supplied by the browser. Invalid/expired sessions are unauthenticated; signed-in Users calling admin endpoints are forbidden.
- Check the current local account status and necessary session/version state, not just a potentially stale role/status cookie. Deactivation must block existing cookies from authorizing new requests immediately after the confirmed local update.
- Authenticate text streams, dictation WebSocket upgrades, voice-session/token routes, live voice control and plugin/OAuth paths as well as ordinary REST routes. Bind any issued voice/media capabilities to the authenticated owner. Existing bounded capability lifetimes remain; do not promise instant revocation of already-issued external tokens.
- Capture identity for accepted/background work. Do not put the last caller's user ID into a singleton, rely on request context after its lifetime, or repeat fallback resolution to the shared development identity.
- Safe public liveness remains available. Missing WorkOS setup must never reactivate shared super-admin access. Diagnostic startup may remain available, but private data, account administration and generation stay unavailable without authentication.
- Logout invalidates the current session using supported facilities and clears its cookie. It does not erase history or imply cancellation can prevent provider billing.

## Administration tab

- Show a bounded user table with **Email**, **Role**, **Status** (including pending initial-password change), **Created**, and applicable actions. Never display passwords, credential envelopes, reset tokens or private activity.
- **Create user:** email, masked temporary-password field, and role selector offering **User** only in V1. Persist/list the account only with clear provider/local outcome; a successful row represents a usable provisioned account or an explicitly pending onboarding state, not an assumed success.
- WorkOS creation and local persistence are not a distributed transaction. Reuse straightforward uniqueness and safe failure handling: do not activate an orphan/unknown mapping, silently adopt a pre-existing identity by email, overwrite a credential on retry, or show success after an unconfirmed write. Surface a safe actionable failure; operator reconciliation is acceptable for rare partial failures. Do not build a general provisioning saga.
- **Deactivate/reactivate:** update the target User's account status without deleting their data. On deactivation, block new access and use existing cancellation/connection-close mechanisms for active work where available. Preserve durable terminal outcomes; in-flight provider execution may finish or incur charges. Reactivation restores access but does not resurrect old work or invalid sessions.
- **Send password reset:** send recovery to the target user's recorded email. No admin-chosen replacement password for activated accounts, token reveal, email editing or impersonation.
- Do not offer hard deletion, bulk operations, arbitrary role management, Super Admin promotion/demotion, or self-deactivation in V1. The bootstrap Super Admin is not a target for the User lifecycle controls.
- Use the existing accessible forms, status/error patterns, light/dark tokens and mobile layout. No new UI framework or dependency for the user table.

## Shared configuration and personal plugins

- Keep the existing singleton `config` document and application-wide activation path. Super Admin changes apply to all users; Users have no per-user provider/model/config overrides and cannot fetch the restricted config API.
- Existing activation semantics remain: newly admitted work uses the new consistent snapshot; active attempts/voice sessions retain their earlier snapshot. Edits do not reset usage or bypass existing provider/storage/topology bounds.
- Expose only the safe capabilities needed by Users through existing public-to-authenticated-user capability APIs. Plugin navigation must work without first loading Config.
- Personal plugin OAuth callbacks, connection stores, caches, refresh coalescing and pending operations must remain bound to the initiating owner. A second user must not replace/disconnect the first user's grant or receive their cached discovery results.
- Retain existing Google Calendar consent, policy, encryption and deployment restrictions. Authentication is not new consent or permission to expose previously gated integrations.

## Initial Super Admin and existing data

- Supply an explicit operator-run bootstrap/adoption command and instructions. It provisions or selects the exact intended WorkOS identity, creates the first local `super-admin` mapping and binds the operator's existing development data only to that account.
- Prefer **preserving the legacy stable internal owner ID** and linking it to the selected WorkOS subject rather than rewriting messages, checkpoints, accounting and encrypted plugin records. This is a one-time explicit ownership adoption, not a browser-controlled alias or login fallback.
- Require an explicit target identity and legacy owner selection/confirmation. No first-login-wins, default-email match, automatic startup migration or automatic Super Admin assignment. Uniqueness checks prevent adopting another mapped user's records.
- Follow the admitted single-process persistence/mutation boundaries. Operator execution occurs only after backup and explicit authorization, with the application stopped as required. Document a non-mutating preflight and safe repeat/refusal behavior.
- Preserve original transcript ordering, IDs, provenance, historical usage attribution and configured global settings. Keep valid plugin bindings only when the preserved owner/consent/encryption rules permit it; otherwise require reconnection instead of modifying or inventing consent.
- Do not execute bootstrap, mutate application data, create WorkOS accounts or read private credentials during documentation or routine fixture verification.

## Scope exclusions and release limits

No MFA, separate email-verification feature, public registration, hosted login, social/enterprise SSO, WorkOS organizations, role synchronization, generic permission framework, custom-role editor, admin impersonation, user-data browsing, analytics implementation, hard account deletion, multi-instance execution, automatic data migration, or unrelated voice/chat refactor.

Target ordinary free AuthKit email/password use for 10–15 users. Research must verify current custom-flow/session/email API availability, free-tier applicability, required production billing details and email-delivery prerequisites. Do not enable paid SSO, custom WorkOS login domains or other add-ons. WorkOS pricing can change; no perpetual-free guarantee is made.

This work does not certify Azure compatibility, remove existing staging/access/network gates, authorize public deployment, or complete the older Phase 1/voice workflows. Preserve existing in-progress source edits.

## Acceptance and verification

| ID | Acceptance | Required evidence |
| --- | --- | --- |
| AC1 | Custom login and closed admission | Fixture success/failure/timeout/expiry/logout tests; no public registration, unknown-account admission, development identity fallback or browser bearer-token storage. |
| AC2 | Mandatory initial password change and recovery | Temporary account cannot reach private/admin routes; failed replacement stays gated; recovery goes only to the user mailbox; reset replay/old-session rejection and no secret-bearing responses/logs. |
| AC3 | Exactly two simple roles | Super Admin reaches Config/Analytics/Administration; User is denied through direct API calls and UI navigation while Plugins remains usable. No organization/permission-engine requirement. |
| AC4 | Administration lifecycle | Create/list, duplicate and partial-failure handling, inactive-account rejection with existing cookies, reactivation requiring valid login, safe email reset, password absent from stored records/table. |
| AC5 | Personal-data isolation for both roles | Two Users plus Super Admin fixtures exercise history/messages, stream/cancel/retry, artifacts, voice, Calendar OAuth/status/settings/disconnect/discovery and relevant caches/background paths. Guessing IDs and concurrent requests never cross owners. |
| AC6 | Global settings remain shared | Super Admin edit is used by new work from multiple Users; active work keeps prior snapshots; restricted config read denied and safe capability/plugin access retained. |
| AC7 | Explicit bootstrap/data adoption | Non-mutating preflight, exact subject/owner mapping, one-time uniqueness/refusal and preserved records/provenance/plugin binding tests on isolated fixtures; no application-data mutation during routine checks. |
| AC8 | Minimal, reliable integration | Both package build/lint/test suites, backend e2e, focused native suites when authorized prerequisites exist, and browser checks of both roles/onboarding/logout/table. Record pre-existing failures, executed passes, skips and limitations separately. |

Use existing Vitest/provider fixtures and package conventions. Native database tests require operator-supplied `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, creating/dropping only generated isolated test databases. Live WorkOS/email/browser-network/provider checks require explicit authorization; fixture passes are not live-service evidence. There is no permission to run paid inference for auth verification.

The final verification report records the actual commit set/environment, checks and results, UI evidence, unrun service/data-migration/deployment gates, and review as **skipped**, never passed. Each non-trivial change must leave the smallest meaningful runnable regression check using established infrastructure.

## Design self-check and companion artifact

The design distinguishes authentication from local role/status, administrative privilege from personal ownership, shared configuration from private plugins, temporary passwords from permanent credentials, user-mailbox recovery from admin takeover, and explicit legacy ownership adoption from automatic migration. It deliberately omits MFA, a separate verification flow and generalized authorization/provisioning machinery. Rare cross-service partial failures may require operator intervention rather than a new recovery framework.

The complete pre-research ownership graph, planning/execution prerequisites, acceptance mapping and resume gate are in [state.md](state.md). Research may refine technical interfaces; material product/security/scope changes require user confirmation, not silent expansion.
