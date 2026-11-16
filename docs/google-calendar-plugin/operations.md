# Google Calendar plugin operations

Local operator runbook for Aurvin's default-off Google Calendar proof. Documentation and setup values authorize no spend, grant, migration or deployment.

## 1. Scope, authorization and evidence

This is a **local single-user proof**. The server-configured identity owns one Google connection. Member accounts and RBAC are deferred. The plugin is **default-off**. A fixture grant is never a real Google connection.

Unified review is **skipped**, not passed. G8 live create/readback/safe-retry and G9 Google/provider policy remain named gates. They are unrun until separately authorized evidence exists.

## 2. Release and runtime inventory

Use the full checkout. Node `^22.22.3 || ^24.15.0 || >=26.0.0`. Backend and frontend are separate npm packages with separate lockfiles. Installed MCP client/server is `2.3.1` with wire `2026-07-28`. Existing Zod 3 JSON-schema bridge. Do not install `@modelcontextprotocol/sdk` v1. There is no remote or public MCP route or socket.

OAuth uses the committed native-fetch/S256 PKCE and RS256 Google OIDC discovery/JWKS verifier. No Google SDK is installed.

Keep `backend/src/instructions/system.md`, root `product_knowledge.md`, and `backend/src/operations/local-guard.ps1` at checkout paths. Copying only `dist` is unsupported. Asset hash changes require quiescent existing-session reconciliation/rebase, not history deletion.

IPv4 Calendar setup only: `main.ts` binds IPv4 loopback. Explicit IPv6 Calendar setup is not admitted by the listener-specific parser.

## 3. Existing operator prerequisites, no provisioning

The operator supplies an already configured Google OAuth web client, consent, test-user configuration, and a disposable owned calendar. Confirm Calendar API access, exact consent scopes, exact redirect registration, and local host consistency. Do not create these resources from this runbook.

The target calendar ID is explicit, never automatic `primary`. ACL `owner` alone is not live scope/ownership certification. Missing project/grant/scope proof leaves the live gate blocked.

## 4. Exact backend configuration

All ten names are backend-only. Blank optional values mean absent, not `true`. Connection state is default-off. Default trusted reference timezone is `Etc/UTC` (not permission to guess an event timezone). Policy deadline is an absolute timestamp. Content permission defaults to volatile; minimal evidence is not allowed unless explicitly true. Keep the client secret private and the existing master key in a separate backup. Do not put OAuth tokens, target, owner, or model overrides in frontend settings or `VITE_*` storage. Do not emit secret values in examples or diagnostics. A policy-id/boolean is operator configuration, not proof that Google/provider processing approval was obtained.

| Name | Meaning |
| --- | --- |
| `AURVIN_GOOGLE_CALENDAR_CLIENT_ID` | OAuth web client id |
| `AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET` | Private client secret |
| `AURVIN_GOOGLE_CALENDAR_REDIRECT_URI` | Exact loopback callback URI |
| `AURVIN_GOOGLE_CALENDAR_TARGET_ID` | Disposable owned calendar id, never `primary` |
| `AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID` | Operator policy identifier |
| `AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED` | `true` only when the operator approved processing |
| `AURVIN_GOOGLE_CALENDAR_CONTENT_PERMISSION` | `volatile` or `retained` |
| `AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED` | `true` only when minimized durable evidence is permitted |
| `AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT` | Absolute RFC3339 deadline |
| `AURVIN_GOOGLE_CALENDAR_TIME_ZONE` | Trusted IANA reference timezone |

## 5. Local origins and OAuth procedure

For manual defaults use one hostname consistently (`FRONTEND_ORIGIN=http://localhost:5173`, backend authority `localhost:3000`, Vite target `http://localhost:3000`). For `run.bat`, use its actual `127.0.0.1:8001` backend and `127.0.0.1:5179` frontend, matching private config and `BACKEND_PROXY_TARGET`.

Register the exact callback `/api/plugins/google-calendar/oauth/callback`, normally through the frontend proxy. Do not mix `localhost` and `127.0.0.1` cookie hosts. Do not change Origin to `*`. IPv6 Calendar setup is not admitted.

HttpOnly/SameSite=Lax binds the callback cookie to the initiating browser. S256 PKCE, OIDC nonce, ten-minute single-use state. Process restart requires a fresh setup. Failed or missing offline token requires reconnect, not fake refresh. Never paste callback query, state, or code into a log or ticket.

## 6. Scopes and connection lifecycle

Exactly `openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy`. No broad Calendar or Calendar read-only scope.

The calendar-list scope discovers the calendars the account may act on; the events scope reads and writes events on them; the freebusy scope backs the availability check. The broad `https://www.googleapis.com/auth/calendar` and `https://www.googleapis.com/auth/calendar.readonly` scopes stay forbidden.

Validate the immutable Google subject and the configured disposable owned target. Refresh uses a per-connection lock and a separate cap of 2 requests. Encrypted tokens use AAD bound to user, provider, connection id, and credential version. Replacement increments connection revision and invalidates pending work.

Disable prevents dispatch but does not revoke Google. Local disconnect clears credentials without deleting Calendar events. Separate `revoke-google-grant` requires `acknowledgeProjectWideRevocation: true` and warns about the wider Google project grant. Unconfirmed remote revoke destroys ordinary local credentials and directs the operator to Google grant controls; no retained token for an automatic retry.

## 7. HTTP/status/stream contract

Setup routes under `/api`:

| Method | Path |
| --- | --- |
| GET | `/api/plugins/google-calendar/status` |
| PATCH | `/api/plugins/google-calendar/settings` |
| POST | `/api/plugins/google-calendar/oauth/start` |
| GET | `/api/plugins/google-calendar/oauth/callback` |
| POST | `/api/plugins/google-calendar/disconnect` |

Mutations require `X-Aurvin-Calendar-CSRF: 1`, exact local Host/Origin, and a loopback peer. The OAuth callback is the Origin exception and uses state/browser/PKCE. Vite's same-origin proxy carries the HttpOnly cookie.

Progress phases: validating, repairing, executing, reconciling. Compatible v1/v2 frames share one wire sequence. Tool-enabled chat opts in with `calendarProtocol: 2`. No raw tool arguments. A durable receipt is independent of narration. Status polling is read-only. EOF is not completion. Eligible retry is explicit. No direct model/tool endpoint or maintenance HTTP endpoint.

## 8. Finite budgets and cost caveats

| Budget | Limit |
| --- | --- |
| Model dispatches per accepted turn | 8 |
| Structural repairs | 2 |
| Sequential tools | 6; one call per decision |
| Logical event creation | 1 per accepted turn |
| Calendar HTTP requests | 20 |
| Refresh requests | 2, separate from Calendar HTTP |
| Delivery retries | 2 after the original delivery |
| Event list | 20 events, 31-day range |
| Arguments/results | 16 KiB each |
| Repair diagnostics | 10 errors / 2,048 characters |
| Tool timeout | 20 seconds |
| Shared run deadline | default 180 seconds |
| Estimated admission cap | USD 1.00 |

Smaller configured limits still apply. Known prices are required. Reservations happen before each dispatch. Unknown charges stay held, not zero. Every repair, retry, and post-tool dispatch is attributed and counted. No private reasoning. The estimate is not an invoice cap. Calendar request count is not a speculative connector dollar rate. Cancellation can still be billed and a dispatched write can still succeed.

## 9. Readiness/degradation

`/api/operations/live` is liveness. Blank config remains ready 503. Plugin states are independent of text/speech: disabled, setup-required, connected, reconnect-required, degraded. Repeated readiness makes no inference or Calendar write/read health probe. Provider outages do not trigger restart loops. Never use `connected` fixture status as actual grant evidence.

## 10. Drain, ownership handoff and unknown writes

Stop new admission and effects, bound runtime/setup/refresh/retention/MCP/voice work, persist uncertain effects, await underlying driver jobs, then close persistence once. Windows Ctrl-C/awaited IPC and an external 45-second bound; no assumed SIGTERM.

Retain an unsafe/busy sentinel. Prove the exact old process/work stopped. Use existing idle-journal/operator recovery. Never delete the sentinel on expired lease or overlap executors.

Reconcile the same saved event ID and verify action/linkage. Absent, mismatch, and unknown are distinct. A saved receipt survives failed narration. Do not start a new user turn to retry an unknown write. A new ID, text similarity, and a visual check are not safe deduplication authority.

## 11. Privacy, redaction, retention and backups

Google, OpenRouter, and the model provider are processors. Denied data collection is not verified ZDR. Self-hosted Aurvin still sends plugin data to those processors.

Before real data, document Google terms, actual response headers, provider routing/retention approval, model/price evidence, and independently permitted minimal outcomes. Raw bodies are transient. Fetched and derived content expire at the earliest permitted source/header/policy deadline, max 24h. No-store/no-cache/zero/absent permission means volatile content and a durable permitted reference/tombstone only.

Operational audit/usage max default 30 days, subject to stricter policy. Retain only permitted dedup markers while retryable. Quarantine unknowns. Refuse replay after expiry. Owner-fenced bounded cleanup; no unproved TTL.

Backup copies are not exempt. Absent a proved compliant backup lifetime/exclusion and restore scrub, real-data/retained admission remains blocked. Encrypted credentials and a separately protected master key are needed for a usable restore, but restoring must not resurrect disconnected grants, expired content, or replayable unknown writes. Prefer fresh reconnect after evidence reconciliation.

Implemented P8 coordination: shutdown aborts the process signal, fences `connections.close()` without disconnect/revoke, drains setup jobs and embedded MCP channels, then closes persistence once. `redactInvalidatedRevision` is not an all-copy walk. P2 `sweepPage`/`expireAuditPage` still do not filter by cursor, `redactDerived` scans the first 50 rows, and audit expiry has no terminal `evidence-expired` transition. P8-GATE-P2-RETENTION and P8-GATE-P2-INVALIDATION remain blocked. Do not admit retained real data until those owner gates pass.

## 12. Additive migration and rollback preconditions

Preserve legacy config cipher/AAD and old accounting interpretation. Use the owner's fixture-tested collection/index/schema changes. No implicit application-data migration.

Before apply: approved exact database/action, backup/restore evidence, stopped/settled executor, same admitted topology and current owner.

Before rollback: disable/fence the plugin, drain, retain operation/receipt/quarantine/evidence and a compatible checkpoint reader. An old binary that cannot read new records is not safe. Never drop plugin records/indexes to make old code run or delete Google events as rollback. Instruction/schema incompatibility needs tested rebase/migration. Run no service command simply because it is printed.

## 13. Checks and remaining gates

Offline/focused (working directory `backend/`):

```powershell
npm test -- test/assembly test/http test/operations runtime/calendar context/calendar plugins/google-calendar plugins/mcp
npm run build
npm run lint
npm test
```

Frontend (no P8 source edits): `npm run build`, `npm run lint`, `npm test`.

Isolated native tests require operator-supplied `AURVIN_TEST_MONGODB_URI` and exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. Do not print a URI. Empty Azure/behavior discovery is not evidence.

P9 writes verification/staging/final evidence. G8 and G9 remain pending. Review remains skipped.

Related documents: [goal.md](goal.md), [state.md](state.md), [root README](../../README.md), [Phase 1 operations](../aurvin-phase-1/operations.md), [super-admin config](../super-admin-config/operations.md), [voice operations](../voice-modes/operations.md), [usage accounting](../mongodb-usage-accounting/operations.md).
