# Google Calendar multi-calendar operations

Local single-operator runbook. This document does not authorize OAuth/Google/model calls, consent changes, provisioning, application-data migration, paid checks, cleanup of real events, or deployment. Unified review is **skipped, not passed**.

## 1. Authority, release scope, and evidence

Use the [approved Phase 2 goal](goal.md) and [current state and commit evidence](state.md). The [Phase 1 Calendar runbook](../google-calendar-plugin/operations.md) and [base operations](../aurvin-phase-1/operations.md) remain historical inputs; their fixture or pending-live status is not Phase 2 certification. P9 owns the new verification, staging evidence, and final report, separately from this procedure.

There is one server-configured development user, one connected Google account, one native MongoDB replica-set database, and exactly one `single-process` executor. There is no application authentication, member RBAC, public OAuth deployment, public/remote MCP endpoint, multi-instance admission, or Azure certification. The existing protected staging proxy is not an admitted Calendar transport. Local Host/Origin/CSRF controls are not authentication against another local process or a shared browser user.

The plugin is default-off. It supports bounded discovery, event reads, availability, and one-off timed event creation on currently permitted owned/shared writable calendars. No calendar/ACL/subscription management, group expansion, arbitrary calendar enumeration, attendees/invitations, recurrence/all-day creation, event update/delete, bulk mutation, or live-voice tools are enabled. Dictated text is ordinary text only when submitted.

## 2. Existing prerequisites and release assets

Use an already configured operator-owned Google OAuth web client and enabled Calendar API. Verify exact redirect registration, permitted test users, consent mode/publishing status, processing policy, and separately named disposable test calendars before authorizing any live drill. This runbook creates none of those resources.

Node must satisfy `^22.22.3 || ^24.15.0 || >=26.0.0`. Backend and frontend are separate npm packages/lockfiles, not a root workspace. Use the installed MCP client/server 2.3.1 with wire `2026-07-28`, tool revision `google-calendar.v2`, proof revision `google-calendar.multi.v2`, and cursor version 2. No new Google SDK, connector service, or dependency is required.

Keep the full release checkout: `backend/src/instructions/system.md`, root `product_knowledge.md`, and `backend/src/operations/local-guard.ps1` must remain at those exact paths. Nest does not copy the Markdown assets into `dist`; `dist` alone is not a release. Fixed asset content hashes change when instructions change even though the validated envelope remains `Release: phase1.v1`. Quiesce active work and use the existing owner-approved session/checkpoint reconciliation or rebase procedure for changed hashes; do not delete history or bypass mismatch checks. If an old active session cannot be safely rebased, leave it read-only and start a new chat.

## 3. Backend-only configuration and origins

No target ID is required for a new connection. `AURVIN_GOOGLE_CALENDAR_TARGET_ID` is deprecated and ignored by central bootstrap: it cannot change a persisted default or a saved operation target. Do not copy an ID into `.env` for ordinary Connect/default selection, and do not restart to change the picker.

| Backend name | Meaning |
| --- | --- |
| `AURVIN_GOOGLE_CALENDAR_CLIENT_ID` | Existing OAuth web client ID |
| `AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET` | Private client secret; never returned to browser |
| `AURVIN_GOOGLE_CALENDAR_REDIRECT_URI` | Exact registered loopback callback URI |
| `AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID` | Identifier of the actually approved processing policy |
| `AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED` | Defaults false; true only after actual approval |
| `AURVIN_GOOGLE_CALENDAR_CONTENT_PERMISSION` | Defaults `volatile`; `retained` requires the retention/backup/invalidation gate |
| `AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED` | Defaults false; independently approved minimized durable outcomes/dedup evidence |
| `AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT` | Absolute RFC3339 policy deadline, never a renewable consent substitute |
| `AURVIN_GOOGLE_CALENDAR_TIME_ZONE` | Trusted reference IANA timezone, default `Etc/UTC`; not permission to guess event timezone |

The existing `AURVIN_CONFIG_ENCRYPTION_KEY` is backend-only base64 of 32 private random bytes. Preserve it separately from encrypted credential backups; losing it makes stored credentials unusable. Never print secrets, tokens, connection records, callback query/code/state, or private `.env` values. Never place identity, Calendar authority, credentials, or model overrides in `VITE_*` settings; browser configuration remains `VITE_API_BASE=/api`. A policy ID/flag is configuration, not policy-compliance evidence.

All blank Calendar values mean absent; incomplete setup stays default-off/unavailable. Configured Calendar is IPv4 loopback HTTP only because the actual listener binds `127.0.0.1`. Use one hostname consistently for frontend, callback cookie, backend Host, and Vite proxy. Do not mix `localhost` and `127.0.0.1` or accept wildcard origins/forwarded hosts.

Manual default layout: `FRONTEND_ORIGIN=http://localhost:5173`, backend authority `localhost:3000`, Vite `BACKEND_PROXY_TARGET=http://localhost:3000` (the current default). The frontend listener can bind `127.0.0.1` while accessed as `localhost`. `run.bat` uses backend `127.0.0.1:8001` and frontend `127.0.0.1:5179`, with matching private `FRONTEND_ORIGIN`, callback registration, and proxy target. Match these actual ports, not assumed 3000/5173 values. Prefer a registered callback through the same-origin frontend proxy at `/api/plugins/google-calendar/oauth/callback` so the HttpOnly cookie host remains consistent; the parser also admits the exact matching backend-origin callback. Port/origin changes require matching operator configuration; default selection does not.

## 4. Exact scopes, consent, and connection lifecycle

The requested set is exactly:

- `openid`
- `email`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.freebusy`

`calendar.events.owned` is a legacy grant, not sufficient for shared-calendar reads/writes or multi-calendar discovery/availability. `calendar.events` alone does not authorize free/busy. Broad `calendar` and broader-than-needed `calendar.readonly` stay forbidden; there is no environment scope override. The three requested Calendar scopes and the old owned scope are classified Sensitive, not Restricted. Do not infer an external-publishing verification exemption or a public-release approval; no Restricted-scope CASA claim is a substitute for applicable Google OAuth verification.

Connect/re-consent requests `include_granted_scopes=true` and `prompt=consent`, offline access, S256 PKCE, OIDC nonce/subject verification, browser binding, and single-use ten-minute OAuth state. Callback must return every required scope; granular partial consent remains reconnect-required with missing-scope diagnostics. Token refresh cannot widen a Phase 1 grant. A changed Google subject is rejected in a bound reconnect flow; deliberate account replacement requires the proper disconnect/new-account lifecycle and resets preferences without transferring old operation authority.

Same-account re-consent preserves a still-valid saved override. Expired/partial grants and legacy records stay readable for status/history but cannot acquire new capability merely by refreshing a token. Raw v1 records first require the explicit migration gate in section 11; clicking Reconnect does not perform that migration.

Enable/disable is distinct from default selection. Disable fences dispatch without revoking Google. Local disconnect clears local ordinary credentials/discovery and does not delete Google events. Project-wide revoke is separate and requires `mode: "revoke-google-grant"` plus `acknowledgeProjectWideRevocation: true`; it may affect other grants in that Google project. Remote revocation can be confirmed, failed, or unknown; never claim cancellation/revoke undoes a dispatched event. Do not retain a secret solely for unapproved automatic revocation retries.

## 5. Discovery, roles, defaults, and availability meaning

Discovery covers bounded entries returned by the authorized calendar-list API, not every calendar that might exist in Workspace. Completeness requires exhaustion of `nextPageToken`, even on a short page. Primary is at most one, can be absent from a truncated snapshot, and is resolved from the entry's primary flag to its canonical ID, not the account email. Cached/stale names are display data, not dispatch permission. A failed/partial refresh must not present an authoritative complete subset or silently overwrite a complete saved snapshot.

Capability combines current grant, scopes, access role, supported operation, hidden/deleted status, and policy. Owner/writer can read/create/check availability when otherwise authorized; `writerWithoutPrivateAccess` is admitted as a shared writer with private details masked. Readers cannot create; freeBusyReader has availability only, not event detail access. Unknown roles fail closed. A lost default/permission asks for a choice/reset rather than falling back silently.

Target precedence is explicit request → valid saved override → canonical primary. Multiple calendars alone do not require a choice. Ambiguous/unknown/unavailable explicit targets, invalid saved defaults, or missing primary require clarification. The picker can save a writable override or clear it with “Use primary automatically.” Default-only PATCH uses `defaultSettingRevision` and expected `connectionRevision`; a default change does not bump account `connectionRevision` or retarget in-flight/saved work. Revision conflicts require loading current state, not blind resubmission.

Availability uses opaque Google busy intervals, not the timed-event list. It can include timed/tentative/recurring opaque events, opaque all-day entries, and out-of-office/focus-time entries. Transparent events (transparent entries, including many UI-created all-day events), declined/cancelled events, working hours, nights, and weekends are not covered as busy. Private data contributes intervals, not unrelated titles/attendees. HTTP 200 can contain per-calendar errors: those are incomplete/unknown coverage, never an all-clear.

Every create has server-enforced current-target checks and fresh availability preflight, even if the model requests create directly. Conflict or incomplete coverage needs durable, current, event/time/target-specific user acceptance or another time. A model's `confirmed` flag is not acceptance. Proposals are same-session, single-consumption, expiry/revision/account bound. Changed target/time/account/calendar set/coverage condition requires renewed acceptance; an unchanged accepted condition does not. Free/busy plus insert is not atomic: this is conflict awareness, **not a reservation**, hard lock, or no-clash guarantee.

## 6. HTTP and streaming boundary

| Method | `/api/plugins/google-calendar/` suffix | Effect |
| --- | --- | --- |
| GET | `status` | Cached/local v2 connection state, no outbound probe |
| GET | `calendars` | Bounded retained discovery page; optional signed `pageToken`, no hidden refresh |
| POST | `calendars/refresh` | Explicit bounded refresh, expected connection revision |
| PATCH | `settings` | Enable/disable and/or default save/reset with expected revisions |
| POST | `oauth/start` | Local state/cookie and consent URL |
| GET | `oauth/callback` | Browser-bound OAuth callback, strict state/nonce/PKCE checks |
| POST | `disconnect` | Explicit local disconnect or acknowledged project-wide revoke |

Plugin mutations require exact local Host, loopback peer, exact frontend Origin, `X-Aurvin-Calendar-CSRF: 1`, and bounded strict JSON. Cached calendar GET requires the admitted local read boundary. The callback is the carefully validated Origin exception, not a general query exemption. Responses are no-store/nosniff; no ETag or token/callback query disclosure. The middleware rejects unexpected/duplicate/malformed query keys; only calendar pagination is an admitted non-callback query. Calendar-enabled chat separately requires exact Origin and JSON, and opts into compatible streaming with `calendarProtocol: 2`. Do not weaken these checks to make a proxy/browser test pass.

Compatible v1/v2 frames use one ordered sequence. Progress/clarification/prose is provisional. Only durable operation evidence supplies a succeeded receipt and its calendar label; changing the default cannot relabel it. Narration failure does not erase a completed event. EOF is not saved completion. An unknown write stays unresolved and must not become a fresh request/create.

P8-GATE-P4-CALENDAR-GET: the inspected legacy middleware rejects cached GET calendars and its query before the new controller. Require the P4 owner's committed route correction and the assembled HTTP/security tests before admitting picker/discovery HTTP release. Do not work around the middleware in AppService or a second route. If the gate is corrected, attach its actual commit/check here while preserving the gate history.

## 7. Finite limits and accounting

Lower configured ceilings still apply; no limit is raised to fit provider output.

| Work | Ceiling |
| --- | --- |
| Model dispatches / structural repairs | 8 / 2 per accepted turn |
| Logical requested tools / logical creates | 6 / 1 per accepted turn |
| Calendar HTTP / token-refresh requests | 20 / 2 per accepted turn |
| Eligible delivery retries | 2; create stays non-retryable |
| Event/availability range / event result count | 31 days / 20 events |
| Tool arguments / result | 16 KiB each, encoded size wins (payload about 15,360 bytes) |
| Tool timeout / shared total default | 20 seconds / 180 seconds |
| Estimated model-spend admission | USD 1, not an invoice guarantee |
| Retained calendars / UI or tool page | 100 / 20 |
| Discovery page deliveries | maxResults=100; 2 in-turn, 10 out-of-turn |
| Discovery freshness / snapshot working or stored size | at most 5 minutes / 256 KiB, stricter document/header/policy limits win |
| Availability scan / request batches | 100 calendars, at most 2 batches of at most 50 |
| Busy intervals processed | 2,000 before bounded coalescing/projection; oversize output is truncated/incomplete |
| Current proposal | One per session, at most 10 minutes; tombstones retain necessary dedup authority |
| Repair diagnostics | 10 errors / 2,048 characters |

Discovery, capability rechecks, free/busy/preflight, batching, reconciliation, and eligible retries must consume actual delivery budgets. Server preflight is not another model-requested logical tool. P8-GATE-P6-REQUEST-ACCOUNTING: P6 now charges discovery and capability-recheck deliveries (`60345e9`); assembled delivery-versus-persisted-counter checks are the remaining accounting evidence, not a second P8 category translation. Do not charge purely local re-authorization as a delivery or ignore a real HTTP request because its purpose is a capability recheck. Persistent idempotent debits survive retry; a turn's finite budgets do not reset on continuation. Every model attempt retains server `user` attribution and pricing/reservation evidence; estimates, known charges, held unknown charges, and provider invoice evidence are different. No private model reasoning is stored. Cancellation can still be billed and a dispatched event can still succeed.

## 8. Readiness and graceful degradation

`/api/operations/live` is liveness, never a paid probe. `/api/operations/ready` applies cached native DB/owner readiness and existing model-limit/config evidence, not inference, Google discovery, token refresh, or write health calls. Status/picker GET does not refresh outbound. Calendar health states remain independent of text/speech: disabled, setup-required, connected, reconnect-required, degraded. A missing Calendar model capability, policy expiry, or Calendar service failure withholds Calendar without deliberately taking ordinary text chat down. Blank ordinary chat configuration remains diagnostic with ready 503, not a Calendar success. Provider outages must not trigger restart loops.

Only explicit user work/refresh/consent can cause external activity, subject to authorization and budgets. Fixture `degraded` status is deliberate and not a real connected-account certificate. Telemetry contains allowlisted hashed correlation and finite metrics only, not calendar names/IDs, titles, busy intervals, proposal text, raw provider errors, secrets, or callback URLs.

## 9. Drain, ownership, and pinned recovery

Use the existing graceful stop/awaited shutdown path. Stop configuration/Calendar admission and abort process-owned setup/refresh first; stop text admission; drain runtime, voice, tracked setup/v2 store jobs, and actual embedded MCP channels; close persistence exactly once only after every underlying job and unresolved-write check is safe. Cancellation of an HTTP waiter is not proof that a provider/driver job stopped. Unknown v2 save acknowledgement keeps shutdown unsafe and retains ownership. Ordinary stop does not disconnect/revoke or delete Google events.

Windows uses Ctrl-C/awaited supervisor IPC; do not assume SIGTERM behavior. The external supervisor bound is 45 seconds; a bound expiring is not a safe release. Do not overlap old/new executors, delete the sentinel because a lease expired, or enable local crash recovery to bypass unknown work. Prove the exact previous process and work are stopped and follow [base ownership/reconciliation](../aurvin-phase-1/operations.md) and the [root recovery guidance](../../README.md).

Before first dispatch, unresolved targeting/proposals need current rights and a fresh valid condition. After dispatch or uncertain outcome, reconcile only the original account, canonical calendar, stable event ID, request hash, and saved linkage. Do not select the current default, replay create with a new ID, run preflight as a reason to repeat a dispatched effect, infer dedup from similar text, or recover against a replacement account. Absent, mismatch, definitely failed, matched/succeeded, and unknown are distinct outcomes. Saved results/receipts can finish publication without another inference/create. A stopped-executor recovery fixture is not proof of live service behavior.

## 10. Privacy, retention, redaction, and backup/restore

Google, OpenRouter, and the configured model provider are external processors. Self-hosting does not eliminate transfers. Denied data collection is not verified ZDR, legal approval, or permission to train generalized models on Workspace data. Obtain current Google API/Workspace Limited Use and actual routed-provider/model retention/processing approval, including shared-calendar metadata and busy intervals, before real data. Prefer availability projection rather than unrelated event detail collection.

Discovery metadata and source-linked derived labels/links/results are untrusted, minimized, bounded, and expire at the earliest source/header/cache/policy deadline. Discovery freshness is at most five minutes; a policy deadline can shorten it. Event-derived content has a maximum source lifetime of 24 hours; operational audit defaults at most 30 days, with stricter policy winning. No-store/no-cache/zero/absent content permission stays volatile; independently permitted minimal reference/tombstone/outcome evidence is different from permission to retain content. Proposal expiry cannot erase an unresolved operation's dedup authority. No unproved TTL deletes unknown effects.

P2 now implements bounded cursor-based multi-calendar expiry (`sweepMultiCalendarPage`), independent audit expiry, proposal tombstones, source-linked projections, and `invalidateAccountRevisionPage`. These are reusable owner-fenced maintenance methods, not an automatic certified scheduler or a public maintenance endpoint. P8-GATE-P2-INVALIDATION: AppService now quiesces operator chat streams, waits through reserved `run()` including final message persistence, then walks `invalidateAccountRevisionPage({ account, now, cursor, limit })` from `cursor: null` until `nextCursor === null`, reusing the same account and timestamp. The fence stays closed while pages run. A failed or undrained scan does not call `releaseStreamFence`; a retry restarts at `cursor: null`. Generic `MongoMessages.append` is still not account-revision guarded; the fence is what makes the paged walk safe. Do not equate general expiry with disconnect deletion. Deterministic P8 wiring tests are not native index `explain`, backup/restore, or retained real-data admission. MC-POLICY/MC-NATIVE remain required before retained real data.

Backups/exports are not exempt from retention. MC-POLICY requires approved backup lifetimes/exclusions, separately protected key custody, and an isolated restore/scrub drill that cannot resurrect disconnected credentials, expired Calendar names/content, proposals, or replayable unknown operations. Keep permitted dedup/quarantine evidence while eliminating disallowed content. Prefer fresh reconnect only after reconciling existing evidence. Document measured results and limitations; do not claim backup/restore certification from source presence.

## 11. Explicit versioned migration and rollback

Normal startup/status/readiness does not migrate application data. Preserve the existing eight-collection layout, encryption/AAD, stable user/session/intent/operation/event identities, legacy accounting, visible messages, and completed v1 receipts. The new formats use v2 tool/proof/cursor authority; nonterminal v1 work is not a new v2 create. It must remain pinned/quarantined and fail closed through its owner-approved compatibility path; completed old receipts remain renderable.

P8-GATE-MIGRATION-ENTRYPOINT: P2 has fixture-tested `projectLegacyCalendarConnection`, `MongoCalendarConnections.migrateLegacy`, and `assessCalendarRollback`, but no approved standalone operator command is delivered. A migration script needs an explicit ownership amendment and exact operator action authorization. Do not use ad-hoc database edits, environment import, startup side effects, a hidden HTTP route, or “Reconnect” as a substitute.

Before a separately authorized migration: identify exact DB/commit/schema/topology, prove backup/restore/scrub and encryption-key custody, stop admission, fully settle/drain the sole executor, enumerate bounded compatible records/unknown effects, and obtain current owner/revision evidence. P2's explicit legacy projection retains the old canonical pinned target as `defaultSetting.defaultCalendarId`, starts `defaultSettingRevision` at 1, increments account revision, clears discovery, and requires re-consent without fabricating scopes or changing token AAD. A legacy `primary` alias is not a canonical migration target and is refused by that projection. No application migration is performed by this procedure.

Before rollback: stop/fence/drain, finish a complete bounded record/effect assessment, and preserve original-target unknown effects, receipts, minimal dedup and compatible checkpoint readers. `assessCalendarRollback` blocks on incomplete scans/undrained work/unresolved effects; existing v2 records require preserve-v2-read-only support, not an old binary that cannot decode them. Revert code only under that compatibility proof. Never drop collections/indexes/records, delete history/checkpoints, revoke automatically, or delete Google events merely to make rollback appear successful. Asset-hash rebase is separate from changing the validated envelope string.

## 12. Deterministic checks and pending service gates

Run commands one at a time. In `backend/`:

```powershell
npm test -- test/assembly/calendar- test/http/calendar-boundary.spec.ts test/operations/calendar- test/operations/persistence.spec.ts src/platform/config/calendar-config.spec.ts
npm test -- test/plugins/google-calendar test/plugins/mcp test/model/calendar- test/runtime/calendar- test/context/calendar-context.spec.ts test/persistence/calendar-migration.spec.ts
npm run build
npm run lint
npm test
npm run test:e2e
```

Then in `frontend/`: `npm run build`, `npm run lint`, `npm test`, separately. Preserve existing text, manageable-config, live-voice-disabled-tools, voice, canvas, and release-asset checks. A required failure returns to its owner. An empty or prerequisite-skipped suite is not a passing executed case.

| Gate | Required evidence / authorization, not supplied by this runbook |
| --- | --- |
| P8-GATE-P4-CALENDAR-GET | P4 admitted bounded GET `/calendars` (`5202f8b`); assembled pagination and Host/Origin/CSRF denials remain required evidence, not a weakened production boundary |
| P8-GATE-P6-REQUEST-ACCOUNTING | P6 charges discovery/capability-recheck deliveries (`60345e9`); assembled delivery-versus-persisted-counter evidence still required |
| P8-GATE-P2-INVALIDATION | P8 wires quiesce-then-paged invalidation through final message persistence; native index/backup/restore and retained real-data admission stay on MC-NATIVE/MC-POLICY |
| P8-GATE-MIGRATION-ENTRYPOINT | Explicit owner-approved tooling/action and isolated migration/rollback evidence before any application migration |
| MC-NATIVE | Operator-supplied isolated `AURVIN_TEST_MONGODB_URI` and exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; generated fixture DBs only; CAS/migration/proposal/recovery/debit cases executed, not skipped |
| MC-BROWSER | Actual local browser/keyboard/focus/announcement/picker/no-ID-connect/receipt observations; Node rendering tests are not a browser session |
| MC-LIVE-CONSENT | Exact operator-approved project/client/test user and scope-upgrade/partial-consent drill, within approved external-processing bounds |
| MC-LIVE-ACL | Separately named disposable primary/secondary-owner/shared-writer/reader/freeBusyReader targets, permitted event data/ranges and cleanup authority; live list/freebusy/read/write/readback/unknown-safe-retry evidence; primary writes need explicit authorization |
| MC-LIVE-QUOTA | Bounded authorized quota/secondary-rate-limit/Workspace role-shape observations, including 403 rate-limit semantics and no duplicate create |
| MC-POLICY | Current Google/provider/model approval, real headers/cache behavior, shared data transfer, invalidation, retention, backup/restore/scrub, and release-asset compatibility evidence |

Historical G8/G9 gates are not automatically closed. P9 must record exact commit set, environment, commands, counts, skips, measurements, limits, and authorized live actions separately. If native/browser/live/policy prerequisites are missing, report the verified subset and named pending gate; do not mark the entire workflow complete or record review as passed.

Related: [root README](../../README.md), [research support, not service proof](research.md), [super-admin operations](../super-admin-config/operations.md), [voice operations](../voice-modes/operations.md).
