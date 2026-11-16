# Aurvin

For opt-in text/voice workflow latency measurements and per-stage diagnostics, see [Conversation latency benchmark](docs/voice-latency-benchmark/README.md). The runner defaults to a no-network dry-run; live provider calls and Calendar mutations require explicit approvals.

Persistent text chat with a React/Vite frontend and a NestJS/LangGraph backend using one server-configured OpenRouter model. Phase 1 provides sessions, durable history, streamed replies and explicit failed/cancelled/interrupted/truncated outcomes. No model picker, compaction, retrieval or application authentication is enabled. Optional local Google Calendar text tools are default-off and backend-configured; there is no public MCP route. See [Google Calendar operations](docs/google-calendar-plugin/operations.md). Dictation and live voice are implemented behind independent server flags that default off. Text chat remains available when either flag is off. Voice does not add authentication, Calendar tools, or a browser-configured model.

## Prerequisites

- Node 22.22.3+ in the Node 22 line, Node 24.15+ in the Node 24 line, or Node 26+; npm. The development PC used Node 24.18.0.
- For local durable chat: an operator-provided native MongoDB replica set, a private OpenRouter key and one model with verified context/output/max_tokens limits. Azure compatibility is not certified; do not relabel an unidentified Cosmos/DocumentDB service as native MongoDB.
- One `single-process` backend executor per database. A leftover sentinel from watch reload or an unsafe exit is taken over on the next start. Do not run two live backends against the same database. Explicit Windows local recovery is restricted as described below.

## Install

Run [`setup.bat`](setup.bat) from the checkout to install backend/frontend packages and create local environment files without replacing existing `.env` files. Edit the private backend `.env` locally; never commit it, print it in diagnostics, or put its secrets in command arguments. The frontend needs only `VITE_API_BASE=/api`. Never add MongoDB credentials, an OpenRouter key, user identity, or a model override as `VITE_*` settings. Never add `DEEPGRAM_API_KEY`, `ENABLE_DICTATION_MODE`, `ENABLE_LIVE_VOICE_MODE`, or a voice model id as a `VITE_*` setting. The browser learns enabled modes only from `GET /api/voice/config`.

`setup.bat` uses `npm install` in each package. For a clean lockfile installation, run `npm ci` separately in `backend/` and `frontend/`; this replaces that package's dependency directory. `run.bat` uses `npm ci` only when a package's `node_modules` directory is absent.

## Backend configuration

Manageable chat, voice, and provider settings live in the MongoDB `config` collection, edited through the **Super admin** profile row at the bottom of the chat sidebar (**Manage Aurvin**, Config tab). The LiveKit endpoint/key/secret are the exception: they are private bootstrap-only server settings, not stored in that collection or shown in Manage Aurvin. The server assigns the development identity the super-admin role; this is a development assumption, not authentication. **Sign out** stays disabled with “Authentication not enabled.” The dashboard has a Config tab and an empty Analytics tab. Nonsecret edits stay in memory until **Save changes**; a configured credential row shows dots and **Configured**, never the value. **Validate and save** on a replacement key validates once on the backend, persists automatically when valid, and activates for new work without a second click or a restart. Removal asks for confirmation. Credential recognition proves the key is recognized, not paid-model access, speech-model support, account credit, or end-to-end usability.

| Setting | Meaning |
| --- | --- |
| `PORT=3000` | Backend port; listener binds `127.0.0.1`. |
| `FRONTEND_ORIGIN=http://localhost:5173` | One exact CORS origin, no path/trailing slash. CORS is not authentication. |
| `AURVIN_USER_ID=aurvin-dev-user` | Server-only development identity; all browser users share it. |
| `PERSISTENCE_PROFILE=native-mongodb` | Only currently admitted persistence profile for chat; `unknown`/Azure profiles remain diagnostic. |
| `MONGODB_URI`, `MONGODB_DB_NAME` | Private native replica-set URI and isolated application database name. |
| `AURVIN_CONFIG_ENCRYPTION_KEY` | Backend-only base64 of 32 random bytes for stored credentials. Generate once privately, back it up separately, never log or share it. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Optional private backend bootstrap-only tuple for live WebRTC. All blank means LiveKit is absent; partial/malformed values fail startup. Configure together only after target/access approval; production requires trusted `wss://`. Changes require controlled restart/drain. These values do not enable a voice mode; see [Live voice WebRTC operations](docs/live-voice-webrtc/operations.md). |
| `AURVIN_EXECUTOR_TOPOLOGY=single-process` | Required topology; other values fail validation. |
| `AURVIN_LOCAL_CRASH_RECOVERY=false` | Explicit Windows local recovery for idle-journal crashes; busy/unknown writes require operator recovery. |
| `AURVIN_LOG_LEVEL` | Optional. Default stdout prints turn outcomes and faults only. Set `debug` for the full process trace. |

Legacy manageable environment entries (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_DATA_COLLECTION`, `OPENROUTER_DISABLE_TRANSFORMS`, chat budget overrides, `ENABLE_DICTATION_MODE`, `ENABLE_LIVE_VOICE_MODE`, `DEEPGRAM_API_KEY`, voice limits/quotas/rates, and related names) are ignored at startup with a value-free warning naming only the obsolete setting names. They are read only by the explicit one-time import in [docs/super-admin-config/operations.md](docs/super-admin-config/operations.md); normal startup never overlays them onto stored settings. Remove migrated entries manually after a successful import while keeping the infrastructure settings above and the master key. Data collection stays denied and transforms stay disabled as fixed policy; there is no chat model picker.

See [backend/.env.example](backend/.env.example) and [operations defaults](docs/aurvin-phase-1/operations.md) for finite budgets. Do not silently discard history at a context limit; start a new chat. Set upstream spending limits privately before any live model use.

Optional Google Calendar setup is backend-only and default-off. No target ID is required: after the operator's approved OAuth connection, Aurvin discovers bounded account-local calendars and uses canonical primary unless a saved override is selected in the panel. Explicit conversational targets take precedence. `AURVIN_GOOGLE_CALENDAR_TARGET_ID` is deprecated and ignored; it cannot override persisted preferences or retarget saved operations. Existing Phase 1 records require an explicit versioned migration and re-consent, not an automatic environment import. Setup names are `AURVIN_GOOGLE_CALENDAR_CLIENT_ID`, `AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET`, `AURVIN_GOOGLE_CALENDAR_REDIRECT_URI`, `AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID`, `AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED`, `AURVIN_GOOGLE_CALENDAR_CONTENT_PERMISSION`, `AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED`, `AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT`, and `AURVIN_GOOGLE_CALENDAR_TIME_ZONE`. Never put those values in `VITE_*` settings. See [multi-calendar operations and pending gates](docs/google-calendar-multi-calendar/operations.md); [Phase 1 evidence](docs/google-calendar-plugin/operations.md) remains historical, not Phase 2 service acceptance. The existing protected staging proxy is not an admitted Calendar transport.

## Run locally

On Windows, run [`run.bat`](run.bat) from the checkout root. It builds the backend once, starts Nest watch (`npm run start:dev`) on `127.0.0.1:8001`, waits for `/api/operations/live`, then starts Vite and opens `http://127.0.0.1:5179`. Failed compilation or backend liveness stops frontend launch; liveness is not generation readiness.

Backend file changes restart the Nest process. A leftover executor sentinel from watch reload or an unsafe exit is taken over on the next start, so closing the backend window no longer blocks the following boot. Do not run two live backend windows against the same database. Opt-in `AURVIN_LOCAL_CRASH_RECOVERY` still uses its own stopped-work procedure.

Backend terminal, working directory `backend`:

```powershell
npm run start:dev
```

Frontend terminal, working directory `frontend`:

```powershell
npm run dev -- --host 127.0.0.1
```

Open http://localhost:5173. The Vite development proxy forwards `/api` HTTP and WebSocket upgrades to `BACKEND_PROXY_TARGET`, or `http://localhost:3000` when that variable is unset. `ws: true` is required. `run.bat` already sets the target to `http://127.0.0.1:8001`. A backend-port change must update both `PORT` and `BACKEND_PROXY_TARGET`. A New Chat does not save an empty session: the first accepted text message creates it. Opening voice on an unsaved chat also does not create an empty transcript; only an accepted live turn creates the conversation.

With blank external settings, the backend starts in **diagnostic mode** only: liveness works, readiness is 503, and chat is unavailable. Valid assets/configuration are still required. Database failure or unverified model limits cannot silently enable generation; catalogue verification failure retains diagnostic liveness/archive reads where storage is available. Configuration/assets errors and competing executor ownership fail startup. Inspect readiness, not a scaffold badge, to determine admission.

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/operations/live
Invoke-RestMethod http://127.0.0.1:3000/api/operations/ready
```

`/api` preserves the greeting and `/api/health` is legacy liveness only. `/api/operations/ready` is generation readiness, not a restart probe. Health does not generate a paid model request. Streamed tokens are provisional until durable terminal status; EOF alone is not completion. Retry is explicit and does not add another copy of the accepted user input. Cancellation is best effort and does not guarantee charge prevention.

## Voice modes

Voice is optional, server-configured, and off unless an operator enables it in Manage Aurvin (Config tab, Voice section). `false` is the shipped default. Confirmed saves activate for new dictation/live sessions immediately; active sessions keep their original snapshot through reconnects and related live turns, and usage accounting is never reset by an edit. Disabling a mode blocks only new sessions. Blank external settings still start diagnostic text mode: `/api/operations/live` works, `/api/operations/ready` is 503, and `speech` is `off`.

| Dashboard label | Meaning |
| --- | --- |
| Dictation mode | Nova-3 composer dictation. Dictation never submits a turn. |
| Live voice mode | Flux live conversation over LiveKit/WebRTC. The Manage Aurvin flag defaults off and affects new sessions; LiveKit bootstrap settings are separate. `/api/voice` is dictation-only, with no live-WebSocket fallback. Browser, network, and authorization gates remain unrun; see [live voice operations](docs/live-voice-webrtc/operations.md). |
| Deepgram key | Write-only server credential. A mode enabled with an empty key reports `speech: unconfigured` and does not call Deepgram during readiness. |
| API region | `us` (`wss://api.deepgram.com`) or `eu` (`wss://api.eu.deepgram.com`). |
| TTS voice | `flux-haley-en`, `flux-alexis-en`, or `flux-priya-en`. |

The legacy environment names behind these labels are `ENABLE_DICTATION_MODE`, `ENABLE_LIVE_VOICE_MODE`, `DEEPGRAM_API_KEY`, and `DEEPGRAM_API_BASE` (plus quota, endpointing, and rate names). They are startup-ignored and import-only, as described above; the dashboard never shows raw variable names as primary labels. LiveKit bootstrap credentials are not legacy imports or Manage Aurvin values; use only the private backend environment and restart/drain procedure above.

The full quota, endpointing, and rate guidance is in Manage Aurvin; legacy full variable lists remain in [docs/super-admin-config/operations.md](docs/super-admin-config/operations.md). Leave rates blank until the operator copies them from the actual account. Missing rates stay unknown. Do not invent `$0`. Do not put the key in a URL, a log, or a frontend environment file.

Dictation's `/api/voice` WebSocket, voice-session REST, and text routes use the Vite `/api` proxy. `/api/voice` is **dictation-only**. Live media and reliable control connect directly to the admitted `LIVEKIT_URL`; there is no parallel live socket or WebSocket fallback. A remote browser needs a secure HTTPS context and trusted, reachable `wss://` signaling; separately approved LiveKit signaling/media/TURN reachability is not supplied by the HTTP proxy. The frontend remains configured only with `VITE_API_BASE=/api`: never add `VITE_LIVEKIT_*` settings or secrets. Protected staging uses its existing HTTP basic-auth example, which is not application authentication. The exact dictation socket location is `location = /api/voice` in [deployment/staging/nginx.conf](deployment/staging/nginx.conf). Copying that file does not start NGINX, install a certificate, provision LiveKit, or enable a flag. See [Live voice WebRTC operations](docs/live-voice-webrtc/operations.md) for access, network, drain, rollback, and unrun evidence gates; [voice-mode operations](docs/voice-modes/operations.md) retains dictation/accounting policy.

Direct Deepgram streaming requests carry a stable pseudonymous tag derived from the server user identity. Socket/TTS-response accounting is durable as `metadata.kind = "voice-accounting"`, including dictation before Send and unsaved live sessions. STT input duration is observed, not billed; TTS cost is a configured-rate estimate when provider characters are known, and actual invoice cost remains unknown. All browsers still share the development identity; this does not add authentication or an OpenRouter voice dashboard. See [voice accounting queries and limitations](docs/voice-modes/operations.md#direct-deepgram-attribution-and-durable-accounting).

A speech outage must not restart the process or take text chat down. Cancellation and quota stops do not guarantee charge prevention. The primary desktop and mobile capture/playback spike is unrun. Fixture tests do not certify latency, fidelity, echo, or a real provider.

## Build and start the backend release

Run from `backend/` in the full release checkout:

```powershell
npm run build
npm run start:prod
```

Keep `backend/src/instructions/system.md`, root `product_knowledge.md`, and `backend/src/operations/local-guard.ps1` beside the release in those exact checkout locations. The current Nest build does not package markdown into `dist`; copying only `dist/` is not a supported deployment. Frontend `npm run build` produces its static bundle; `npm run preview` is a local preview, not a protected staging server.

## Checks

| Directory | Commands |
| --- | --- |
| `backend` | `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e` |
| `frontend` | `npm run build`, `npm run lint`, `npm test` |

Native integration checks require operator-supplied `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; existing fixtures create and drop generated isolated databases. Never use application/production data. Provider responses are deterministic fixtures, not paid inference.

P9's explicit assembled native smoke, working directory `backend`:

```powershell
if (-not $env:AURVIN_TEST_MONGODB_URI -or $env:AURVIN_TEST_DB_PREFIX -ne 'aurvin_p2_test_') { throw 'Isolated native test configuration is required.' }
npx vitest run src/app.controller.spec.ts -t "P9 native assembled fixture chat"
```

`npm run test:azure` and `npm run test:behavior` exist but are separately gated service/behavior suites, not unconditional proof of Azure compatibility or authorization to spend. Report skips separately from executed passes.

## Usage accounting

Optional Decimal128-backed monetary evidence, token breakdowns, dispatch/completion timing, and bounded **internal read-only** reporting preserve existing numeric fields and legacy saved results. Voice costs remain estimates, not invoice charges. No analytics UI or reporting HTTP endpoint is added. See [accounting operations, dry-run migration, and rollback prerequisites](docs/mongodb-usage-accounting/operations.md) and [implementation evidence](docs/mongodb-usage-accounting/implementation-report.md). Tooling does not authorize application-data migration.

## Protected staging and shutdown

Use the existing same-host authenticated gateway profile in [deployment/staging/nginx.conf](deployment/staging/nginx.conf) with separate staging credentials/database, a trusted certificate/private access boundary, and operator-controlled log rotation/supervision. Protect both static UI and API; do not expose the backend or Vite development server. No infrastructure has been provisioned by these files. Voice session/token routes and the dictation-only `/api/voice` upgrade must stay inside that same access-controlled boundary. Do not expose the backend or token API publicly; separately approved LiveKit signaling/media reachability is required and is not supplied by this HTTP gateway. Do not enable either voice flag from this README.

Follow [operations.md](docs/aurvin-phase-1/operations.md) for gateway configuration/streaming, privacy, bounded drain, stale-owner recovery, retention, backups and rollback; [staging-evidence.md](docs/aurvin-phase-1/staging-evidence.md) distinguishes actual results from unrun drills. Stop acceptance, drain, then close persistence via the operations service. Windows uses validated Ctrl-C or awaited supervisor IPC `shutdown`; do not assume SIGTERM. The external supervisor must bound process exit to 45 seconds. Do not restart from provider-driven readiness failure.

After an unsafe exit, default admission takes over the leftover executor sentinel so the next start can listen. Do not delete metadata as a shortcut, and do not retry session-lease ownership on expiry. Opt-in local crash recovery still requires the operator-only handoff/reconciliation procedure. No rolling overlap, automatic maintenance HTTP endpoint or exactly-once provider billing claim.

### Local crash recovery (opt-in)

Set `AURVIN_LOCAL_CRASH_RECOVERY=true` explicitly in `backend/.env` or the environment inherited by `run.bat`. The launcher never enables it automatically. It requires Windows, `PERSISTENCE_PROFILE=native-mongodb`, an explicit `replicaSet` in the URI, a verified writable primary with that set name, and majority+journal write acknowledgements. Blank storage remains diagnostic mode. Default-off single-process admission is unchanged; Azure is not admitted/certified by this mode.

Before every application/checkpoint/session-ownership mutation, the shared driver facade serializes a majority+journal-ACKed, owner-bound **busy intent**, then dispatches the actual write. Only successful awaited durable completion permits clearing to **idle**. Unknown/thrown data writes retain busy and quarantine further writes. Startup indexes and stock saver setup remain busy throughout bootstrap. The write queue is bounded to 100 jobs; normal mutations cost up to **two extra sentinel writes**. Only the current owner can change intent; unknown driver methods, write commands, transactions and arbitrary aggregation are blocked in local mode. The only admitted aggregation is the immutable bounded read-only accounting pipeline on metadata. Read cursors/reporting do not mark intent.

After a crash, startup acquires the Windows lifetime mutex, checks the exact previous PID/creation lifetime, and conditionally hands off the **same observed owner/revision plus idle versioned journal** on the primary. If late begin-intent wins, busy/revision rejects handoff; if handoff wins, old intent is fenced before any old data dispatch. This does not rely on process death alone, sleeps, lease expiry or `currentOp` absence. It supports idle crashes and provider-generation crashes **between ACKed DB writes**; arbitrary mid-write/DDL crashes deliberately require operator recovery. Majority+journal completion, not connection disappearance, establishes the safe boundary. No native service certification or live drill is claimed by offline tests.

Only one configured Windows PC/installation may use a bound database. Machine identity, canonical checkout path, exact configured URI+database hash, process lifetime and unique `appName` are recorded without plaintext URI/credentials. URI aliases, credential/configuration changes, foreign installations, PID reuse, missing/legacy/future markers and ancestry overflow refuse automatic takeover. Existing legacy sentinels require one-time operator stopped-work handoff/reconciliation and graceful sentinel release **before** enabling this mode; enabling it never upgrades/adopts legacy records. No external writer, restore, server replacement or topology migration is authorized by this feature.

Recovery authorizes persisted ancestors (maximum 16), scans bounded pages including owner-only leftovers (maximum 1,000 pages), finishes saved sealed results without model replay and interrupts no-result attempts for explicit retry. It completes before generation readiness: maintenance stops acceptance and fully drains, durable recovery evidence is completed, then a fresh runtime uses the same bundle. Catalogue unavailability remains diagnostic with pending ancestry intact. Failed/partial recovery or uncertain writes retain the sentinel. Graceful close stops/drains writes, marks only a safe completed idle owner released while retaining its binding/provenance, closes the client, then releases the local guard. Restart still requires the previous exact process to be stopped; reopening within a still-live old process is refused. Unfinished accepted work retains its unreleased idle sentinel for the next restart. Turning local mode off for a bound database also requires an explicit operator migration; no empty-sentinel reset silently admits another PC. No charge-prevention guarantee is made. Keep `backend/src/operations/local-guard.ps1` in the full release checkout.

## Evidence and remaining gates

Local fixture/build results do not establish public-production readiness, selected Azure compatibility, authenticated gateway deployment, live-model privacy/cost behavior, proxy delivery, supervisor/log rotation, backup restore or rollback certification. These require the owning operations/integrated verification evidence. Public identity/access and production capacity/RPO/RTO remain unresolved. Voice fixture assembly is not a device, browser, LiveKit, TURN, impairment, shutdown, rollback, or Deepgram certification. Desktop/mobile capture/playback, network, access-control, latency, and rollback drills remain unrun; no public rollout is approved. Unified review is explicitly **skipped**, not passed.

Approved requirements and ownership: [goal.md](docs/aurvin-phase-1/goal.md), [state.md](docs/aurvin-phase-1/state.md).
