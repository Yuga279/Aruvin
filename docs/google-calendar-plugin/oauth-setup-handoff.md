# Aurvin Google Calendar — OAuth setup support handoff

Date: 22 October 2026. Continue interactive setup support in the next chat; do not restart the implementation workflow.

## Immediate user goal and stopping point

The user wants step-by-step, plain-language help configuring Google OAuth for Aurvin's existing **Connect Google Calendar** button. They chose **Option A: their own Google Cloud OAuth Web application client**, not gcloud/ADC or a new token-import mode.

They are currently in Google Cloud Console, project **Aurvin**, in organization **ecgroup-intl.com**. Their screenshot shows **APIs & Services → Credentials → Create credentials**:

- Credential Type → “Which API are you using?”: **Google Calendar API** selected.
- “What data will you be accessing?”: **User data** and **Application data** radio options, neither selected yet.
- **Next** button.

Last response told them:

1. Keep Google Calendar API selected.
2. Select **User data** (OAuth client). Do not select Application data (service account).
3. Click Next.
4. If app information appears: app name **Aurvin**, support and developer-contact emails their email, logo optional/blank.
5. Send the next screenshot, with **no client secret visible**.

Continue one screen at a time. They explicitly asked to “dumb it down” before deciding. Do not overwhelm them with all policy variables or re-ask the already-selected OAuth approach.

## Actual local configuration — important correction

Working directory: `D:/Peter/Aurvin Agent/Aurvin`
Branch: `codex/google-calendar-plugin`

Last checked non-secret settings in `backend/.env`:

```dotenv
PORT=8001
FRONTEND_ORIGIN=http://localhost:5179
AURVIN_USER_ID=aurvin-dev-user
PERSISTENCE_PROFILE=native-mongodb
MONGODB_DB_NAME=aurvin
OPENROUTER_MODEL=openai/gpt-6-luna
OPENROUTER_DATA_COLLECTION=deny
OPENROUTER_DISABLE_TRANSFORMS=true
```

**Use this exact authorized redirect URI for the current configuration:**

```text
http://localhost:8001/api/plugins/google-calendar/oauth/callback
```

Earlier messages incorrectly offered default port 3000 and then `127.0.0.1:8001`; both were corrected after reading actual configuration. Do not mix `localhost` and `127.0.0.1`. `backend/src/platform/config/calendar-config.ts` derives backend origin from frontend hostname and backend port. Recheck if the user changes their configuration.

Choose OAuth client type **Web application**, not Desktop or service account. This is backend authorization-code OAuth. Authorized JavaScript origins are not needed for this server-side redirect flow; the redirect URI is essential.

Exact implemented scopes (`backend/src/contracts/calendar-policy.ts`, runbook):

- `openid`
- `email`
- `https://www.googleapis.com/auth/calendar.events.owned`

Do not request broad Calendar, calendar-list, or Google-hosted MCP scopes. Aurvin uses its own embedded MCP adapter backed by stable Calendar REST APIs.

Audience: choose according to the actual account being connected. **Internal** can work for a user in this Workspace organization; personal Gmail/outside-organization accounts require **External**, with their Google account added as a test user while in Testing. Do not assume which account they intend to connect. Avoid promising no verification warning or permanent refresh-token lifetime: External/Testing Calendar grants can have short-lived refresh tokens.

## Explain the flow simply

- The OAuth client ID/secret identify **Aurvin the application**. The user registers that identity once in Google Cloud.
- The Connect button then redirects to Google, where the user signs in and consents.
- Google returns a one-time code to Aurvin's backend; Aurvin exchanges it for access/refresh credentials and stores them encrypted server-side.
- The user must **not manually acquire or paste a refresh token**.
- No Google sign-in/RBAC for Aurvin is being built: this remains a single-user local proof.

Existing implementation:

- `frontend/src/features/plugins/google-calendar/GoogleCalendarPanel.tsx`
- `backend/src/plugins/google-calendar/controller.ts`
  - `GET /api/plugins/google-calendar/status`
  - `POST /api/plugins/google-calendar/oauth/start`
  - `GET /api/plugins/google-calendar/oauth/callback`
  - `POST /api/plugins/google-calendar/disconnect`
- OAuth state is browser-bound and single-use; identity and token validation, refresh/rotation, reconnect and disconnect/revocation distinctions already exist.
- UI is integrated into the admin dashboard. Do not invent another setup UI.

## Later setup inputs (not yet supplied)

Store secrets only in `backend/.env` or another approved server-side secret location, never chat/screenshots, frontend VITE variables, git or browser storage.

```dotenv
AURVIN_GOOGLE_CALENDAR_CLIENT_ID=<Google Web OAuth client ID>
AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET=<secret; do not print>
AURVIN_GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:8001/api/plugins/google-calendar/oauth/callback
AURVIN_GOOGLE_CALENDAR_TARGET_ID=<disposable owned calendar ID>
AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID=<approved policy identifier>
AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED=<explicit approval required>
AURVIN_GOOGLE_CALENDAR_CONTENT_PERMISSION=volatile
AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED=<explicit approval required>
AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT=<future timestamp matching approved policy>
AURVIN_GOOGLE_CALENDAR_TIME_ZONE=<user's actual IANA timezone>
```

Do not silently set approval flags, invent policy evidence or choose an arbitrary expiry. A policy ID/flag alone does not establish compliance. See `operations.md`, G9, `P8-GATE-P2-RETENTION` and `P8-GATE-P2-INVALIDATION` in the evidence documents.

The user needs a separate empty/disposable owned calendar (e.g. **Aurvin Test**). Its ID is found in Google Calendar → that calendar's Settings → Integrate calendar. Do not automatically target `primary` or test on real business events.

Before a live test, require exact event title/date/start/end/timezone, authorized disposable target, external processing consent/policy, and bounded model spend. The user has **not yet authorized an exact live event or paid inference budget**. No broad Calendar deletion tool is implemented; cleanup is manual unless separately and precisely authorized.

## Workflow status and evidence

Read these instead of reconstructing the long chat:

- `docs/google-calendar-plugin/state.md` — graph, authorization, ownership, defect records, resume instructions and D7 follow-up.
- `docs/google-calendar-plugin/goal.md` — approved scope.
- `docs/google-calendar-plugin/operations.md` — setup and operations runbook.
- `docs/google-calendar-plugin/verification.md`
- `docs/google-calendar-plugin/staging-evidence.md`
- `docs/google-calendar-plugin/final_report.md`

All nine plans/workers committed. Unified **code review was explicitly skipped**; do not dispatch a reviewer, claim review passed, or reinterpret testing/defect correction as a unified review. The user specifically checked this.

Workflow remains **incomplete at live Google/provider acceptance G8 and real-data admission G9**. Do not mark it complete from fixtures alone. No live Google event creation or paid inference has run in this session.

Historical 21 October native proof: isolated temporary **single-node MongoDB 8.3 replica set**, loopback port 27099, `replicaSet=aurvinNative`, PRIMARY; e2e **41 files / 145 tests passed**, no skips. It has been stopped and its temporary dbpath removed. This is not multi-member, production, Azure or multi-instance certification. Do not assume that port is still running. A pre-existing MongoDB service on port 27017 belongs to the user: do not stop or reuse its application database for fixtures. Earlier teardown incorrectly attempted to stop all mongod processes; the existing service refused access and remained running. Future teardown must target only the exact process the agent starts, preferably gracefully.

Native harness uses generated `aurvin_p2_test_<uuid>` databases and requires `AURVIN_TEST_MONGODB_URI` plus exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. Never use application data. Several early failed native runs left test databases in the now-removed isolated temp instance; final successful runs showed no additional leftovers.

## Latest fix: D7 (22 October), verified

Preflight found a genuine wiring gap: `loadModelLimits` only returned Calendar capability when passed its optional fourth evidence argument, but production never supplied it. OAuth could connect yet no tools/budget could be admitted.

- P4 commit `3b198c9ce5e846a47ab31aac0c5c28ac3de40c6a`:
  - `backend/src/model/calendar-evidence.ts`: frozen price/capability evidence for `openai/gpt-6-luna`.
  - `calendarEvidenceFor(modelId: string): CalendarCatalogueEvidence | null`, exported from model boundary.
  - `nativeStrict: false`, `parallelToolCallsParameter: false`; own strict validation/sequential-call enforcement remain required.
  - Prices observed from public OpenRouter catalogue: prompt `0.0000001` USD/token, completion `0.0000005`; no per-request price listed, evidence uses `requestUsd: '0'`.
  - Base-price evidence has a documented ceiling: catalogue has a higher tier starting at 272000 prompt tokens. Current default/configured context ceilings are below it; do not reuse it above that ceiling without tier-aware reservations.
- P8 commit `e45e8b67813b5e5f2144ee5723d0874c611cbcd7`:
  - `prepareConfigurationSnapshot` passes evidence into the limits loader on both startup and config activation.
  - Unknown models, price mismatches or no tool support remain text-only; connected/enabled plugin still required.
  - Added 8 assembly tests, including actual tool advertising and text-only operation without connection.
- Documentation commit `c65cf6f`: D7 verification and selected OAuth setup recorded.

Orchestrator independently checked at `e45e8b6`:

- Focused new suites: **2 files / 19 tests passed**.
- Full backend `npm test`: **192 files passed, 2 skipped; 1572 tests passed, 10 skipped**.
- Backend build/lint exit 0.
- No native/browser rerun at this D7 tip; those figures in the earlier reports are dated historical evidence, not current-tip reruns.

Run builds and test suites **sequentially**: `test/operations/bootstrap.spec.ts` rebuilds `backend/dist` and launches compiled children; concurrent builds from parallel agents can wipe their modules, producing `ERR_MODULE_NOT_FOUND`. Do not mislabel that race as a product regression or weaken assertions.

## Cautions and preservation

Root `AGENTS.md` applies. For MAW orchestration, load MAW if continuing implementation: orchestrator does not write implementation code or ingest `research.md`/`plan*.md`, uses agent summaries and verifies commit stats. No agents need dispatching merely to guide the OAuth console.

The user requested **no documentation-header banners in planners' output**. Earlier prompts also told workers to omit banners. Preserve existing headers; consult current instructions before new code. Ordinary setup support needs no source changes.

User's unrelated uncommitted work must remain untouched and unstaged:

- `frontend/src/components/MessageItem.tsx`
- `frontend/src/components/Transcript.tsx`
- `frontend/src/styles/chat.css`
- `frontend/src/styles/styles.test.ts`
- untracked `frontend/src/components/PromptTraveler.tsx` and `.test.ts`
- `.openchamber/screenshots/**`

Stage named task files only, never `git add .`. Do not revert user work.

An owner reported a separate runtime concern not resolved in this chat: `classifyCalendarContinuation` was exported but not wired; explicit retry of an `unknown` operation with an available connection might reach create again with the same deterministic event ID instead of first selecting readback. Do not claim this was fixed by D6 (D6 covers unavailable connection/policy and text recovery). Before executing the live safe-retry proof, verify the actual retry path and route a defect to P6 if the approved readback-before-redispatch contract is violated.

Also do not repeat the earlier unverified claim that `gcloud auth application-default login` supplies arbitrary Calendar scopes without one's own OAuth client, or that it guarantees no warnings. The user selected the standard app OAuth route; no ADC mode is authorized or needed.

## Suggested opening in next chat

“We’re continuing your Google Calendar connection setup. On the screen you showed, choose **User data**, then **Next**. Send me the next screen, keeping any client secret hidden.”
