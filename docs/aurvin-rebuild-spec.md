# Aurvin — Rebuild Specification

> Purpose: everything needed to rebuild Aurvin from scratch in another IDE/agent, plus the proposed feature roadmap.
> Extracted from the source checkout on 13 November 2026 (branch `main`, head `c283766`). Paths refer to the original repo layout.
> Facts come from source and repo docs. Where the source was unclear, the text says so. No secret values are included, only setting names.

## How to use this document

1. Read **Part 0** for the product and architecture in one page.
2. Rebuild in the order given in **Part 0.4**. Each step lists the spec sections it needs.
3. **Parts 1–3** are the detailed specification: backend core, backend features, then frontend and tooling.
4. **Part 4** is the proposed (not yet built) feature roadmap.

---

# Part 0 — Overview

## 0.1 What Aurvin is

Aurvin is a self-hosted AI assistant with durable, streamed text chat and these optional extras:

| Capability | Summary | Default |
| --- | --- | --- |
| Text chat | New chats, session sidebar, durable history, streamed replies, explicit terminal outcomes (completed / failed / cancelled / interrupted / length-truncated), explicit retry | On (requires configuration) |
| Authentication | WorkOS email/password sessions, per-user data isolation, Super Admin role, user administration | Diagnostic-only when WorkOS settings are blank |
| Manage Aurvin | Super Admin dashboard for settings stored in MongoDB `config`, with encrypted write-only credentials | — |
| Google Calendar plugin | Per-member OAuth, multi-calendar discovery, availability, timed-event creation with server-side proposal and confirmation | Off |
| Dictation | Deepgram Nova-3 speech-to-text into the composer over the `/api/voice` WebSocket | Off |
| Live voice | Deepgram Flux STT/TTS conversation over LiveKit/WebRTC, with barge-in | Off |
| Canvas | Side panel showing Mermaid-style diagrams, charts, SVG and calendar workspaces, in both text and voice | On (renders when artifacts exist) |
| Operations | Liveness/readiness, admission, drain/shutdown, telemetry, crash recovery, usage and cost accounting | — |
| Benchmark | Opt-in text/voice latency benchmark CLI | Dry run |

Deliberately **not** built: MCP connections, uploads and multimodal input, automatic compaction and summaries, embeddings, retrieval across chats, model picker, public production rollout.

## 0.2 Architecture

```
Browser (React 19 + Vite)
  │  /api  HTTP + SSE (chat streams)      /api/voice WebSocket (dictation only)
  │                                        LiveKit WebRTC (live voice media + control) ──► LiveKit SFU
  ▼
Vite dev proxy (ws: true) ──or── NGINX protected staging gateway
  ▼
NestJS backend (single process, binds 127.0.0.1)
  ├─ platform      config, crypto, identity, redaction, errors
  ├─ contracts     shared types + runtime guards (the wire/storage contract)
  ├─ auth / administration / admin-config
  ├─ http          chat REST + SSE
  ├─ chat-runtime  durable turn engine (accept → generate → finalize → complete; recovery; calendar tool loop)
  ├─ agent         LangGraph turn graph
  ├─ context       prompt assembly within budgets
  ├─ model         OpenRouter adapter (raw SSE), catalogue, faults, accounting
  ├─ persistence   MongoDB repositories, checkpoints, journal, ownership
  ├─ voice         Deepgram providers, LiveKit transport, sessions, accounting
  ├─ plugins/google-calendar   OAuth, discovery, availability, tools
  └─ operations    readiness, admission, drain, telemetry, recovery
  ▼
MongoDB replica set (native)          OpenRouter (one configured model)        Deepgram        Google Calendar API        WorkOS
```

Key architectural rules:
- **One `single-process` executor per database.** An executor sentinel is taken over on restart. Never run two live backends against one database.
- **Two turn paths.** The **memory-first** text path is the default whenever a persistence store exists. It accepts the turn in memory, streams, and saves to the database in the background, reporting save progress (`save` state: pending → saving → saved/failed). The fully **durable** path persists acceptance before inference and is used as a fallback (older calendar sessions, handoff). In both paths streamed text is provisional until the terminal status is confirmed. See Part 1 §8.2 and §8.6.
- **Inference starts on stream open.** `POST …/turns` returns 202 with IDs; `GET …/turns/:turnId/stream` executes the attempt. There is no replay cursor: after a disconnect the client polls turn status and messages.
- **Messages are the UI archive. Checkpoints serve graph execution. `agent-memory` controls context selection.** Records reference messages rather than copying them.
- **The browser holds no secrets.** The only browser setting is `VITE_API_BASE=/api`. Identity, model and keys are server-side.
- **Readiness is not a restart probe.** A provider outage must not cause restart loops or paid health calls.

## 0.3 Technology stack

| Layer | Technology |
| --- | --- |
| Runtime | Node `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` |
| Backend | NestJS 12, TypeScript (ESM, NodeNext, `.js` import specifiers), Zod 3, LangGraph JS + `@langchain/langgraph-checkpoint-mongodb`, `@langchain/openrouter`, MongoDB driver 6, `ws`, `@livekit/rtc-node`, `livekit-server-sdk`, `@workos-inc/node` |
| Frontend | React 19, Vite, TypeScript, `livekit-client`, `@ozymandiasthegreat/vad`. Diagram and chart rendering is **hand-written SVG**, with no Mermaid or chart library |
| Tests | Vitest (backend: routine, e2e, azure and behavior configs; frontend: Node environment, `src/**/*.test.ts`) |
| Database | MongoDB replica set (native). Azure/Cosmos is not certified |
| Providers | OpenRouter (LLM), Deepgram (STT/TTS), LiveKit (WebRTC SFU), Google Calendar API, WorkOS (auth) |

## 0.4 Recommended rebuild order

| Step | Build | Spec sections |
| --- | --- | --- |
| 1 | Repo skeleton, two npm packages, TypeScript, lint and test setup, file-header convention | Part 3 §1 |
| 2 | `platform` (config loading, crypto, identity, redaction, errors) and `contracts` | Part 1 §1–3 |
| 3 | `persistence`: six collections plus config and users, indexes, ownership sentinel | Part 1 §5 |
| 4 | `model` (OpenRouter adapter), `context`, `agent` graph | Part 1 §6–8 |
| 5 | `chat-runtime` durable turn lifecycle, then `http` REST and SSE | Part 1 §4, §8 |
| 6 | `operations`: liveness, readiness, admission, drain | Part 1 §9 |
| 7 | Frontend shell, chat state, sidebar, transcript, composer, safe Markdown | Part 3 §2–4 |
| 8 | Auth and administration, then Manage Aurvin (admin config) | Part 2 §4–6, Part 3 §3 |
| 9 | Canvas (frontend renderers, then the backend artifact contract) | Part 2 §2, Part 3 §5 |
| 10 | Google Calendar plugin (backend tools and proposals, then frontend panel and turn region) | Part 2 §3, Part 3 §3 |
| 11 | Voice: dictation first, then live voice over LiveKit, then calendar and canvas in voice | Part 2 §1, Part 3 §6 |
| 12 | Usage accounting, local crash recovery, benchmark, deployment configs | Part 1 §9, Part 2 §7, Part 3 §1 |

## 0.5 Where the original docs and code disagree

The **code is authoritative**. When rebuilding, decide deliberately whether to copy the code's behavior or the doc's intent.

| Topic | Docs say | Code does |
| --- | --- | --- |
| Persist before inference | AGENTS.md requires acceptance to be persisted before inference | The memory-first path (the default) accepts in memory and saves in the background |
| Authentication | README says there is no application authentication and everyone shares one development identity | WorkOS login is required. Every private `/api/*` route (including readiness, metrics and `/api/health`) needs a session cookie. With WorkOS unconfigured, private routes return 503 `NOT_READY`. `AURVIN_USER_ID` is only a legacy setting for adopting old data |
| Rate limit | "Per user" | `maxRequestsPerMinutePerUser` is enforced across the whole process (generation 20/min, other 120/min). Voice admission reuses it |
| Voice state | — | Voice sessions, tickets, quotas and daily minutes are held in memory and reset on restart |
| Calendar routes | — | Work only locally: loopback peer, loopback http frontend origin and redirect URI, and an `X-Aurvin-Calendar-CSRF: 1` header on writes |
| Fixed assets | — | Editing `system.md` or `product_knowledge.md` changes their hash. Existing chats then need reconciliation, and `rebaseSession` exists but nothing appears to call it |
| Context budget | "Tokens" | Measured in UTF-8 bytes, not tokens |
| Password length | One form header says 8+ | Code and UI require 10, though one input still has `minLength={8}` |
| Live voice and VAD | — | Live voice runs only over LiveKit. `/api/voice` handles dictation only. The VAD gate remains in the PCM capture path |
| Mermaid fidelity | — | Dedicated layouts exist only for flowcharts, sequence diagrams and pie/xy/quadrant charts. Other types go through the generic flowchart parser |
| Canvas `calendar` kind | — | Validation accepts it, but no backend code creates one; calendar views travel as `calendarView` on stream events instead. Backend Canvas extraction only runs for live voice turns |
| Render deployment | — | The config points at `/app/backend`, but no Dockerfile is tracked, and how the frontend is served there is unclear |

## 0.6 Development workflow conventions (from the original repo)

- **File headers.** Every code file starts with a header block containing FILE, LOCATION, PURPOSE, ROLE IN PROJECT and KEY COMPONENTS. It is not added to strict JSON or generated files.
- **Features are developed as documented workflows.** Each feature gets `docs/<feature>/` containing `goal.md`, `state.md` (graph, ownership, commits), `research.md`, `plan1..N.md`, `verification.md` and `final_report.md`. Unified review was explicitly *skipped* (recorded as skipped, not passed).
- **Evidence over claims.** Results are recorded as planned, implemented, tested, skipped or awaiting approval. Fixture tests are not live-service certification.
- **Minimal-diff ("lazy senior dev") policy.** Reuse before adding, avoid new dependencies, and mark deliberate shortcuts with a `ponytail:` comment.

---

# Part 1 — Backend core


Scope: `backend/src/{main.ts, app.module.ts, app.service.ts, app.controller.ts, platform/, contracts/, persistence/, context/, instructions/, model/, agent/, chat-runtime/, http/, operations/}`. Voice, Google Calendar plugin internals, auth, admin-config, administration, benchmark, scripts and frontend are covered in Parts 2–3 and appear here only where core wiring touches them. Everything below comes from the source. Where the source was unclear, this document says "unclear".

Stack: NestJS 12 on Express 5, ESM TypeScript (NodeNext, local imports use `.js`), Zod 3, MongoDB driver 6.x, `@langchain/langgraph` ^1.4.19, `@langchain/langgraph-checkpoint-mongodb` ^1.4.1, `@langchain/openrouter` ^0.4.17 (used only as a request serializer), and Vitest. Node `^22.22.3 || ^24.15.0 || >=26.0.0`.

---

## 1. Bootstrap and composition

### 1.1 `main.ts`
- `bootstrap()`:
  1. If `.env` exists in `process.cwd()`, it is loaded with `process.loadEnvFile`. There is no dotenv package.
  2. `NestFactory.create(AppModule, { bodyParser: false, logger: false, abortOnError: false })`.
  3. `configureApplication(app)`. Shutdown hooks are `SIGINT` on win32, and `SIGINT` plus `SIGTERM` elsewhere. The app listens on `config.port`, bound to **`127.0.0.1` only**.
  4. An IPC `'shutdown'` message triggers `app.close()`, then `process.disconnect()`. If close fails, it writes `Aurvin shutdown could not be confirmed.` and sets exit code 1.
  5. On failure, the error is rethrown as-is if it is an `AppError`; otherwise it becomes `Error('Aurvin startup failed.')`.
- Entry guard: the module runs only when it is `argv[1]` (it accepts an extensionless `dist/main`). A startup failure writes `Aurvin startup failed [CODE]; <guidance>` to stderr. For `UNSUPPORTED_TOPOLOGY` the guidance is a fixed "verify previous executor stopped… do not delete the sentinel" message. The code is shown only when it is in `APP_ERROR_CODES`.
- `configureApplication(app)` registers these in order (the order matters):
  1. `useWebSocketAdapter(new AuthenticatedWsAdapter(app, service.voiceUpgrades))` (voice).
  2. `service.attachTransport(app.get(ChatStreamTransport))`.
  3. `app.setGlobalPrefix('api')`.
  4. `enableCors({ origin: frontendOrigin, credentials: true, methods, allowedHeaders, exposedHeaders: ['X-Request-ID','Retry-After'], preflightContinue: true })`.
     - Methods are `GET, POST, PUT, PATCH, DELETE, OPTIONS` when calendar is configured or the frontend is local `http://localhost|127.0.0.1`. Otherwise PATCH is omitted.
     - Allowed headers are `Content-Type`, plus `X-Aurvin-Calendar-CSRF` under calendar CORS.
  5. Custom OPTIONS handler: sets `no-store` and `nosniff`. It returns 403 if an `Origin` is present and differs from `frontendOrigin`, otherwise 204.
  6. `configureAuthHttp` (auth module).
  7. `configurePrivateHttp` (cookie session admission; see §4.1).
  8. `configureOperations` (request ID, rate limiting, readiness admission; see §9).
  9. Calendar HTTP:
     - If calendar bootstrap is present: `configureGoogleCalendarHttp` and `configureCalendarChatBoundary`.
     - Else if the frontend is local: calendar HTTP with `backendOrigin=http://<host>:<port>`.
     - Else: every `/api/plugins/google-calendar*` request returns 503 `NOT_READY`.
  10. `configureAdminHttp` and `configureAdministrationHttp` (see Part 2).
  11. `configureChatHttp(app, budgets)`: global `Cache-Control: no-store` and `nosniff`, then the JSON body parser (see §4.4).
  12. A final middleware calls `service.identities.restore(req)` to re-enter the AsyncLocalStorage principal.
- `trustedAdminHttpsIngress(req)`: the peer is loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) and `x-forwarded-proto === 'https'`.

### 1.2 `app.module.ts`
- `AssemblyModule` imports `PlatformModule` and provides `AppService` through an async factory: `AppService.create(config, { identities, identity })`, injecting `AURVIN_CONFIG`, `RequestIdentityStore` and `ServerIdentityResolver`.
- `AppModule` imports:
  - `AuthModule.registerAsync`: `service.auth`, with `secureCookie` derived from an https frontend origin.
  - `AdministrationModule`.
  - `OperationsModule.registerAsync({ service: service.operations })`.
  - `AdminConfigModule`.
  - `ChatHttpModule.registerAsync(service.httpOptions(service.identity))`.
  - `GoogleCalendarModule`: a per-user `calendarFor(userId)`.
- Controllers are `AppController` and `VoiceSessionController`. Providers are the voice session service, `VoiceUpgradeAdmission` and `VoiceGateway`, all pulled from `AppService`.
- Invariant: exactly **one** `AppService` composes one runtime, one telemetry instance and one persistence close owner. No module constructs a second runtime.

### 1.3 `platform/platform.module.ts`
- `AURVIN_CONFIG` (`Symbol.for('aurvin.config')`) is `loadBootstrapConfig(process.env)`.
- If legacy manageable env names are present, it writes the warning `Ignored obsolete manageable environment settings: <NAMES>. Use Manage Aurvin or the explicit import command.` to stderr. The warning lists names only, never values.
- It also exports `RequestIdentityStore` and `ServerIdentityResolver`.

### 1.4 `app.service.ts` (`AppService`)
**Constructor checks:**
- `topology.executor !== 'single-process'` raises `UNSUPPORTED_TOPOLOGY`.
- `new URL(frontendOrigin).origin !== frontendOrigin` raises `CONFIGURATION_ERROR`.

**Default ports (all overridable in tests):**
- `open = openPersistence`.
- `assets = loadFixedAssets({ instructions: resolve(cwd,'src/instructions/system.md'), knowledge: resolve(cwd,'../product_knowledge.md') })`. The process **must run with cwd = `backend/`**, and the full checkout layout must be kept. Nest build does not copy the Markdown files.
- `limits = loadModelLimits`.
- `runtime = d => new DurableChatRuntime(d)`.
- `fetcher = fetch`.
- `writeLog = writeStdoutLog`.

**State built at construction:**
- `unconfigured` is a `RuntimeConfigSnapshot` at revision 0 with default manageable settings and null credentials.
- `config` (an `AurvinConfig` adapter) is built from bootstrap plus the unconfigured snapshot. Its budgets therefore reflect `DEFAULT_BUDGETS` plus any bootstrap safety overrides, not the stored config.
- It also builds auth (WorkOS provider when configured), administration, `CredentialService`, the calendar owner registry, the config repository wrapper, `AdminConfigService`, voice services and `OperationsService`.

**Lazy repositories:**
- `sessions`, `messages` and `users` forward to the opened persistence. If storage is not open they throw `NOT_READY` ("Chat storage is unavailable.").
- Config and user writes are tracked in `configJobs` so that shutdown can drain them.

**`initialize()` (called from `create`):**
1. Load and validate the fixed assets. Failure is a hard startup failure (`CONFIGURATION_ERROR`). On success, set `assetsOk = true`.
2. If `!mongoUri || profile !== 'native-mongodb'`, enter **diagnostic mode**: emit readiness `{ok:false, code:'NOT_READY'}` and return. Liveness works, readiness is 503, chat is unavailable.
3. `open(config)`. On error:
   - Rethrow if `localCrashRecovery` is set or the code is `UNSUPPORTED_TOPOLOGY`. A second or stale executor is a hard failure.
   - Otherwise emit `NOT_READY` and stay diagnostic.
4. Wrap persistence with `observePersistence` (metrics). Create `MongoConfigRepository(store, owner, min(16384, maxDocumentBytes))`.
5. `current = loadPointer(assets)`:
   - Read the stored config strictly.
   - If no document exists, use the unconfigured snapshot.
   - Otherwise decrypt the credentials and call `prepareConfigurationSnapshot`. Each failure emits a readiness code and leaves `current = null`: `CONFIG_STORED_INVALID`, `CONFIG_ENCRYPTION_UNAVAILABLE` or `CONFIGURATION_ERROR`.
6. Create the runtime:
   - Without local crash recovery: `rawRuntime = createRuntime(assets)`. The runtime always exists, even when unconfigured; admission rejects inference later.
   - With local crash recovery: require local executor evidence. If the config is null, mark recovery pending and return. If `AURVIN_USER_ID` is not mapped to a user but has leftover sessions, fail with "Unmapped legacy chat data requires explicit operator adoption." Otherwise run `finishLocalMaintenanceForUsers(...)` and then create a fresh runtime.
   - Any error calls `operations.shutdown()` and throws `NOT_READY` ("Chat initialization failed.").

**`createRuntime(assets)`:**
- Builds `ReferencedContextAssembler({ memory, messages, metadata, budgets: config.budgets, assets })` and passes `{ config, persistence, assembler, assets, limits, currentConfig, fetcher, calendarFor, configFor, memoryFirst?, diagnostics }`.
- **`memoryFirst` is enabled by default** with `voice: true` and policy `PROPOSED_MEMORY_TEXT_POLICY`, overridden with `shutdownDrainMs` and `writeTimeoutMs = persistenceTimeoutMs`. It is disabled only when `ports.memoryFirstPolicy === null`, or when the policy is undefined and `persistence.owner.store` is missing. See §8.6.

**Config activation:**
- `prepareConfigurationSnapshot(bootstrap, candidate, assets, limitsLoader, fetcher, signal)`:
  1. Validate the settings and compose budgets.
  2. `assertFixedContextFits`.
  3. If an OpenRouter key and model ID are both present, load model limits from the live catalogue, with frozen calendar pricing evidence when known.
  4. `buildRuntimeSnapshot`.
- `publishSnapshot(snapshot)` publishes only the last prepared snapshot. It requires a revision greater than the current one, no closing, no uncertain config write, no pending local recovery, and a runtime that is not degraded.
- New work captures the current snapshot per attempt. In-flight work keeps its snapshot.

**Per-owner projection:**
- `configFor(userId)` adds `calendar: {...setup.initial, enabled: eligible}`. Eligibility requires all of the following:
  - The owner's calendar status was refreshed by `prepareOwner` during private HTTP admission.
  - Storage is up and no config write is uncertain.
  - Policy deadlines exist and all are in the future, and `minimalEvidenceAllowed` is set.
  - The model catalogue lists tools and pricing.
  - The connection is configured and not `reconnect-required`.

**Other hooks:**
- `onUserDeactivated`: cancel calendar OAuth, interrupt the user's runtime work, close their streams and stop voice.
- `auth.logout` is wrapped to also close the user's streams, voice sessions and pending OAuth.
- `getHello()` returns `'Hello from Aurvin'`. `getHealth()` returns `{status:'ok'}`.

### 1.5 Fixed assets (`instructions/fixed-assets.ts`)
- Two files are loaded:
  - `backend/src/instructions/system.md`, which must start with `# Aurvin system instructions\n\nRelease: phase1.v2\n` (CRLF is also accepted).
  - Root `product_knowledge.md`, which must start with `# Aurvin product knowledge\n\nRelease: phase1.v1\n`.
- Validation:
  - Maximum 16,384 bytes each, not empty, no UTF-8 BOM, strict UTF-8.
  - No control characters except TAB, LF and CR.
  - Secret patterns are rejected: `sk-or-v1-`, `mongodb(+srv)://`, PEM private key, `Bearer <16+ chars>`, `OPENROUTER_API_KEY=`/`MONGODB_URI=`.
- Output is a frozen object `{ instructions, knowledge, instructionVersion: sha256(instruction bytes), knowledgeContentHash: sha256(knowledge bytes), graphSchemaVersion: 'phase1.v1' }`.
- Any failure raises `CONFIGURATION_ERROR` ("Required Aurvin instructions or knowledge are unavailable or invalid.").
- **Gotcha:** editing either file changes its hash. Existing manifests then fail `validateManifest` ("Chat context needs reconciliation"). `DurableChatRuntime.rebaseSession` exists to migrate them, but it is not exposed over HTTP (see §8.7).

---

## 2. Configuration

### 2.1 Bootstrap environment (`platform/config/bootstrap-config.ts`)
The allowlist is `BOOTSTRAP_ENV_NAMES`. Parsing uses Zod with coercion and passes unknown keys through. Any violation raises `CONFIGURATION_ERROR` ("Invalid application configuration.").

| Name | Default | Rule / meaning |
|---|---|---|
| `PORT` | 3000 | int 1–65535 |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Must equal `new URL(v).origin`. Must be https, or http only when `NODE_ENV=development` with host localhost, 127.0.0.1, ::1 or [::1]. |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `AURVIN_USER_ID` | `aurvin-dev-user` | 1–128 chars. Legacy owner selector used only for operator adoption and local-recovery checks. It is not login. |
| `PERSISTENCE_PROFILE` | `unknown` | `unknown`, `native-mongodb`, `cosmos-mongodb-ru` or `azure-documentdb`. Only `native-mongodb` opens storage. |
| `MONGODB_URI` | `''` | Blank means diagnostic mode. |
| `MONGODB_DB_NAME` | `aurvin` | min 1 |
| `AURVIN_EXECUTOR_TOPOLOGY` | `single-process` | Literal; no other value is accepted. |
| `AURVIN_LOCAL_CRASH_RECOVERY` | `false` | `true`/`false`. `true` requires `native-mongodb`. |
| `AURVIN_CONFIG_ENCRYPTION_KEY` | absent | Canonical base64 of exactly 32 bytes (`^[A-Za-z0-9+/]{43}=$`) gives `{status:'ready'}`. Empty means `missing`; anything else means `invalid`. It is never generated. Startup does not fail on missing or invalid; credential operations do. |
| `MAX_MESSAGE_BYTES`, `MAX_DOCUMENT_BYTES`, `MAX_MANIFEST_BYTES`, `DEFAULT_PAGE_SIZE` | `DEFAULT_BUDGETS` | Positive safe integers. |
| `MAX_PAGE_SIZE` | 50 | Positive integer, at most 50. |
| `CONNECT_TIMEOUT_MS`, `PERSISTENCE_TIMEOUT_MS`, `SHUTDOWN_DRAIN_MS` | `DEFAULT_BUDGETS` | Positive integers, at most 2,147,483,647. |
| `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD` | all blank means no auth | All three or none. No surrounding whitespace or control characters, at most 4096 chars, and the cookie password must be at least 32 chars. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | blank | Voice bootstrap (`voice-config.ts`). All three or none. |
| `AURVIN_GOOGLE_CALENDAR_*` (CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, TARGET_ID [deprecated, ignored], PROCESSING_POLICY_ID, POLICY_APPROVED, CONTENT_PERMISSION [default `volatile`], MINIMAL_EVIDENCE_ALLOWED, POLICY_DEADLINE_AT, TIME_ZONE [default `Etc/UTC`]) | blank | `calendar-config.ts`; the calendar agent covers these. |
| `AURVIN_LOG_LEVEL` | unset | Not in the allowlist; read directly by `writeStdoutLog`. `debug` writes every log line. |

Cross-field safety rules (otherwise `CONFIGURATION_ERROR`):
- `maxDocumentBytes ≤ 1,800,000` (`documentHeadroomBytes`, the same for every profile).
- `maxMessageBytes < maxDocumentBytes`.
- `maxManifestBytes < maxDocumentBytes`.
- `defaultPageSize ≤ maxPageSize`.

`LEGACY_MANAGEABLE_ENV_NAMES` (49 names) are **ignored** at startup and produce the name-only warning. The full list is in `bootstrap-config.ts`. Examples: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_DATA_COLLECTION`, `OPENROUTER_DISABLE_TRANSFORMS`, `MAX_*` chat budgets, `RETRY_*`, `*_TIMEOUT_MS`, `TITLE_MAX_CHARS`, `DEEPGRAM_*`, `ENABLE_DICTATION_MODE`, `ENABLE_LIVE_VOICE_MODE`, `VOICE_*`.

### 2.2 Budgets (`contracts/budgets.ts`, `DEFAULT_BUDGETS`)

| Field | Default | Field | Default |
|---|---|---|---|
| maxInputChars | 32,000 | titleMaxChars | 80 |
| maxInputTokens | 8,192 (compared against **UTF-8 bytes** of input) | maxConcurrentAttemptsPerSession | literal 1 |
| maxMessagesInContext | 80 | maxConcurrentGenerationsPerProcess | 8 |
| maxContextTokens | 16,384 | maxRequestsPerMinutePerUser | 20 |
| maxOutputTokens | 2,048 | retryMaxAttempts | 2 (max 3) |
| modelMarginTokens | 1,024 | retryBaseDelayMs | 500 |
| maxMessageBytes | 65,536 | retryMaxDelayMs | 5,000 |
| maxDocumentBytes | 1,800,000 | connectTimeoutMs | 10,000 |
| maxManifestBytes | 131,072 | firstOutputTimeoutMs | 30,000 |
| maxPageSize | 50 (max 50) | idleStreamTimeoutMs | 20,000 |
| defaultPageSize | 20 | totalRunTimeoutMs | 180,000 |
| | | persistenceTimeoutMs | 15,000 |
| | | shutdownDrainMs | 20,000 |

Schema refinements:
- `defaultPageSize ≤ maxPageSize`.
- `usableHistoryTokens = maxContextTokens − maxOutputTokens − modelMarginTokens > 0`.
- `retryMaxDelayMs ≥ retryBaseDelayMs`.

Runtime budgets come from `composeRuntimeBudgets(settings, safety)`: `{...settings.chat, ...bootstrap.safety, maxConcurrentAttemptsPerSession: 1}`.

### 2.3 Manageable settings (MongoDB `config` collection, one document `_id: 'aurvin'`)
Schema: `manageableSettingsSchema` (strict, no coercion) in `contracts/admin-config.ts`. Defaults come from `defaultManageableSettings()` in `manageable-config.ts`.

| Path | Default | Constraint |
|---|---|---|
| `openRouter.modelId` | `''` | ≤200 chars, trimmed, no control chars (`''` means unconfigured) |
| `openRouter.dataCollection` | `'deny'` | literal `'deny'` |
| `openRouter.disableTransforms` | `true` | literal `true` |
| `chat.maxInputChars` | 32,000 | ≤32,000 |
| `chat.maxInputTokens` | 8,192 | ≤ bootstrap `maxMessageBytes` and ≤ usableHistoryTokens |
| `chat.maxMessagesInContext` | 80 | ≤500 |
| `chat.maxContextTokens` / `maxOutputTokens` / `modelMarginTokens` | 16,384 / 2,048 / 1,024 | Must leave usable history > 0. Output ≤ `maxMessageBytes`. |
| `chat.titleMaxChars` | 80 | ≤80 |
| `chat.maxConcurrentGenerationsPerProcess` | 8 | positive |
| `chat.maxRequestsPerMinutePerUser` | 20 | positive |
| `chat.retryMaxAttempts` | 2 | ≤3 |
| `chat.retryBaseDelayMs` / `retryMaxDelayMs` | 500 / 5,000 | Timers. base ≤ max ≤ totalRunTimeoutMs. |
| `chat.firstOutputTimeoutMs` / `idleStreamTimeoutMs` / `totalRunTimeoutMs` | 30,000 / 20,000 / 180,000 | first and idle ≤ total |
| `voice.enabledModes.{dictation,live}` | false/false | (voice agent) |
| `voice.limits.*` | `DEFAULT_VOICE_LIMITS` | `connectMs ≤ connectTimeoutMs`. Queue byte bounds ≤ `MAX_VOICE_CONTROL_BYTES`. |
| `voice.dictationWarningMs` | 270,000 | null or < `dictationMaxMs` |
| `voice.quotas` | identityConcurrent 1, globalConcurrent 4, identityDailyMinutes 60, globalDailyMinutes 120, dailySpendUsd null | identity ≤ global. Spend requires all rates. |
| `deepgram.*` | region `us`, `nova-3`, `flux-general-en`, `flux-haley-en`, endpointing 300 (300–500), spokenPunctuation false, keyterms [] (≤50 × ≤64 chars), eotThreshold 0.8 (0.5–1), eotTimeoutMs 5,000, rates null | (voice agent) |

Stored document (`storedConfigDocumentSchema`, strict, at most `MAX_CONFIG_DOCUMENT_BYTES` = 16,384):
- `{ _id:'aurvin', schemaVersion:1, revision ≥1, settings, credentials:{ openrouter, deepgram }, updatedAt, updatedBy }`.
- Each credential is `null` or `{ envelope:{ algorithm:'aes-256-gcm', nonce:b64(12B), tag:b64(16B), ciphertext:b64 }, validatedAt }`.
- The encryption key is `AURVIN_CONFIG_ENCRYPTION_KEY`.

Writes (`persistence/config.ts`, `MongoConfigRepository`):
- `createIfAbsent` is an `updateOne({_id}, {$setOnInsert}, upsert)` that requires revision 1.
- `compareAndSwap(expected, doc)` is a `replaceOne({_id, revision: expected})` that requires `doc.revision = expected + 1`.
- Results are `confirmed`, `conflict{currentRevision}` or `uncertain`.
- An uncertain write latches `configUncertain`, which blocks further admin writes and activation until restart.

`RuntimeConfigSnapshot` (`contracts/config-runtime.ts`) is deep-frozen:
- `{ schemaVersion:1, revision, settings, budgets, openRouter:{apiKey, modelId, dataCollection:'deny', disableTransforms:true}, voice, modelLimits: VerifiedModelLimits|null, calendar? }`.
- A configured model requires verified limits with `modelId` matching, `supportsMaxTokens`, `source ∈ {fixture, catalogue}`, `contextTokens ≥ maxContextTokens` and `outputTokens ≥ maxOutputTokens`.

### 2.4 Legacy import (`platform/config/legacy-config-import.ts`)
- `parseLegacyConfigImport(env, bootstrap)` filters only the legacy names. It rejects `OPENROUTER_DATA_COLLECTION ≠ 'deny'` and `OPENROUTER_DISABLE_TRANSFORMS ≠ 'true'`.
- It maps values through the legacy `loadConfig` and `loadVoiceConfig` and derives `dictationWarningMs = dictationMaxMs − 30,000` (or null).
- It returns `{settings, credentials:{openrouter, deepgram}, importedNames}`.
- The operator CLI `backend/src/scripts/import-config.ts` writes into an **empty** config store only. It belongs to the scripts agent and has no npm script entry.
- `load-config.ts` (`loadConfig` and `readinessIssues`) is the legacy env adapter that this import and the readiness fallback use.

---

## 3. Contracts (`backend/src/contracts/`)

### 3.1 File index

| File | Purpose |
|---|---|
| `identifiers.ts` | `idSchema` (string 1–128, `ID_MAX_LENGTH=128`), `isoDateSchema`, `sequenceSchema` (int ≥0) |
| `versions.ts` | `CONTRACT_VERSIONS = {api:1, stream:1, session:1, message:1, agentMemory:1, attempt:1, metadata:1, graphSchema:'phase1.v1'}`; `schemaVersionSchema = literal(1)` |
| `collections.ts` | Collection names (see §5) |
| `persistence-profile.ts` | Profiles; `CONSERVATIVE_DOCUMENT_LIMIT_BYTES=2,000,000`, `CONSERVATIVE_DOCUMENT_HEADROOM_BYTES=1,800,000` |
| `budgets.ts` | Budgets (see §2.2) |
| `errors.ts` | Error codes, HTTP map, retry sets, `clientErrorBodySchema` |
| `session.ts` | `sessionRecordSchema`, `executionLeaseSchema` |
| `message.ts` | `messageRecordSchema`, roles, completion statuses |
| `attempt.ts` | `attemptRecordSchema`, `ATTEMPT_STATUSES` |
| `agent-memory.ts` | Manifest, `messageRef`, `sourceRange`, `summaryRef` |
| `metadata.ts` | Accounting, tool-request and tool-result records; `reconstructToolGroups` |
| `usage-evidence.ts` | Decimal-string money evidence, timing evidence, `canonicalDecimal` |
| `context.ts` | Context assembler types |
| `runtime.ts` | `ModelInvokeRequest`, `ModelChunk`, `ModelAdapter`, command types, `AgentRuntime` |
| `api.ts` | HTTP routes, request and response schemas |
| `stream.ts` | SSE envelope v1 and event union |
| `identity.ts` | `ResolvedIdentity`, `IdentityResolver` |
| `repositories.ts` | Persistence and ownership ports (`SessionRepository`, `MessageRepository`, `ExecutionOwnership`, `PageQuery`, etc.) |
| `config-runtime.ts` | Snapshot, activation port, config CAS types, `VerifiedModelLimits` |
| `admin-config.ts` / `admin-config-wire.ts` | Manageable settings and admin protocol (admin agent) |
| `auth.ts` | `userAccountSchema`, auth wire types (auth agent) |
| `administration.ts` | Administration routes and page schemas (administration agent) |
| `accounting-reporting.ts` | Internal UTC accounting query port |
| `calendar-*.ts` (15 files) | Google Calendar authority, availability, wire, tools, policy and similar (calendar agent) |
| `canvas-artifact.ts`, `voice*.ts` | Voice and Canvas types (voice agent) |
| `index.ts` | Re-exports |
| `testing/voice-fixtures.ts` | Test fixtures |

### 3.2 Identifiers
- All IDs are strings of 1–128 chars.
- Server-derived IDs are `key(kind, ...parts) = sha256hex(JSON.stringify([kind, ...parts]))`, from `persistence/records.ts` and used in `chat-runtime/identity.ts`:
  - `sessionId` (new chat) = `key('new-session', userId, idempotencyKey)`. Otherwise the client-provided existing ID is used.
  - `turnId = key('turn', u, s, idempotencyKey)`.
  - `attemptId = key('attempt-id', u, s, idempotencyKey)`.
  - `userMessageId = inputId = key('input', u, s, attemptId)`.
  - assistant `messageId = outputId = key('output', u, s, attemptId)`.
  - `eventId = key('event', u, s, messageId)`.
  - `graphThreadId = key('thread', u, s)`.
- Mongo `_id` values: `key('session',u,s)`, `key('message',u,s,messageId)`, `key('attempt',u,s,idempotencyKey)`, `key('acceptance',u,s,attemptId)`, `key('sequence-counter',u,s)`, `key('sequence-reservation',u,s,reservationId)`, `key('executor')`.
- `titleFor(content, max)` replaces control chars with spaces, collapses whitespace, trims, falls back to `'New chat'`, and truncates by code point to `min(max, 80)`.

### 3.3 Records
**SessionRecord** (strict):
- `{ schemaVersion:1, userId, sessionId, title(1–80), pinned?, createdAt, updatedAt, lastActivityAt, lifecycle:'active'|'archived', graphThreadId, execution:{ownerId|null, leaseExpiresAt|null, activeAttemptId|null, generation:int≥0}, latestTurnId|null, memoryPublication?:{version, sequence, epoch, fence} }`.

**MessageRecord** (strict):
- `{ schemaVersion:1, userId, sessionId, turnId, messageId, eventId, sequence, role:'user'|'assistant', content(≤32,000 chars), createdAt, completionStatus, attemptId|null, truncated, visibility?:'visible'|'internal', mode?:'text'|'live', voiceSessionId?, voiceDurationSeconds?, voiceTranscripts?, sourceProvenance?(1–6), canvasArtifacts?, calendarView? }`.
- `MESSAGE_COMPLETION_STATUSES = ['accepted','streaming','completed','truncated','failed','cancelled','interrupted']`.
- Canvas artifacts require role assistant, visibility internal, mode live, a non-null `attemptId` and a valid `voiceSessionId`. Calendar views require role assistant.

**AttemptRecord** (`kind:'attempt'`, strict):
- `{ schemaVersion, userId, sessionId, turnId, attemptId, idempotencyKey(8–128), payloadHash(64-char sha256 of content), calendarReplyTo?, nativePublication?, status, sequence, createdAt, updatedAt, instructionVersion, knowledgeContentHash, graphSchemaVersion, contextVersion, modelId, openRouterUser, generationId|null, truncated, errorCode|null, causal:{userMessageId, previousAttemptId|null} }`.
- **`ATTEMPT_STATUSES = ['accepted','generating','finalizing','completed','truncated','failed','cancelled','interrupted']`**.
- Terminal statuses are `completed`, `truncated`, `failed`, `cancelled` and `interrupted`.
- Allowed CAS transitions (`persistence/metadata.ts`):

| From | To |
|---|---|
| accepted | generating, failed, cancelled, interrupted |
| generating | generating, finalizing, failed, cancelled, interrupted |
| finalizing | finalizing, completed, truncated, failed, cancelled, interrupted |
| any terminal status | none |

- `truncated` must equal `status === 'truncated'`.
- A non-null `generationId` is immutable.
- The other fields are immutable; changing them raises `IDEMPOTENCY_PAYLOAD_MISMATCH`.

**AccountingRecord** (`kind:'accounting'`):
- `{ …ids, generationId, requestedModel, reportedModel, reportedProvider, promptTokens, completionTokens, cost, money?, cachedPromptTokens?, cacheWriteTokens?, reasoningOutputTokens?, timing?, accountingStatus:'known'|'pending'|'unknown', outcome: AttemptStatus, startedAt, endedAt }`.
- Status rule: `known` when prompt tokens, completion tokens and cost are all present; otherwise `pending` if a generationId exists; otherwise `unknown`.
- `money` is `{currency:'USD', reportedAmount, estimatedAmount (decimal strings ≤34 significant digits), costStatus, source:'provider-response'|'provider-generation'|'provider-estimate'|'legacy-number'|'unavailable', observedAt, pricing}`.
- `timing` is `{dispatchedAt, firstOutputAt, providerEndedAt, durableCompletedAt, providerDurationMs, firstOutputLatencyMs, dispatchCount ≤3}`.

**Tool-request and tool-result records:** these exist in contracts as future boundaries (`argumentsJson` ≤ 131,072 bytes; result stored `inline` or `external`). `reconstructToolGroups` pairs requests and results.

**AgentMemoryManifest:**
- `{ schemaVersion, userId, sessionId, contextVersion, sourceRanges(≤64), messageRefs(≤500: {messageId,eventId,sequence}), activeSummaryRef:null (must be null in Phase 1), instructionVersion, knowledgeContentHash, graphSchemaVersion }`.

**ResolvedIdentity:**
- `{ userId, source:'server-configured'|'authenticated-session'|'bootstrap-operator', openRouterUser }`.
- The runtime **requires** `source==='authenticated-session'` and `openRouterUser===userId`; otherwise it raises `IDENTITY_OVERRIDE_REJECTED`.

### 3.4 Errors (`contracts/errors.ts`)

| Code | HTTP | Code | HTTP |
|---|---|---|---|
| INVALID_REQUEST | 400 | RATE_LIMITED | 429 |
| UNKNOWN_FIELD | 400 | CONCURRENCY_LIMIT | 429 |
| IDENTITY_OVERRIDE_REJECTED | 400 | TIMEOUT | 504 |
| MODEL_OVERRIDE_REJECTED | 400 | PROVIDER_ERROR | 502 |
| NOT_FOUND | 404 | PROVIDER_AUTH | 502 |
| CONFLICT_ACTIVE_TURN | 409 | PROVIDER_CREDITS | 402 |
| IDEMPOTENCY_PAYLOAD_MISMATCH | 409 | CANCELLED | 409 |
| CONTEXT_BUDGET_EXCEEDED | 413 | INTERRUPTED | 409 |
| INPUT_TOO_LARGE | 413 | PERSISTENCE_ERROR | 503 |
| STORAGE_BUDGET_EXCEEDED | 413 | CONFIGURATION_ERROR | 500 |
| | | NOT_READY | 503 |
| | | UNSUPPORTED_TOPOLOGY | 500 |

- `RETRYABLE_CODES`: TIMEOUT, PROVIDER_ERROR, PERSISTENCE_ERROR, RATE_LIMITED, NOT_READY.
- `NEVER_RETRY_CODES`: the validation, override, size, auth, credits, configuration, topology and idempotency codes.
- Client body is `{code, message(≤500), retryable}`. Messages come from the fixed public table in `http/client-errors.ts`; internal messages never reach the client. For example, CONTEXT_BUDGET_EXCEEDED maps to "This chat is too long. Start a new chat."
- `AppError(code, message, retryable=isRetryable(code))` carries `httpStatus`.

### 3.5 Stream protocol v1 (`contracts/stream.ts`)
- Envelope: `{ protocolVersion:1, sessionId, turnId, attemptId, sequence, event }`.
- Events:

| Event | Fields |
|---|---|
| `turn-accepted` | `{userMessageId}` |
| `delta` | `{text (min 1), reset?: true}` (`reset` means discard the provisional text) |
| `status` | `{status: AttemptStatus, truncated, save?}` |
| `usage` | `{accountingStatus, promptTokens, completionTokens, cost}` (all nullable) |
| `error` | `{code, message, retryable}` |
| `completed` | `{assistantMessageId, outcome:'completed'|'truncated', save?, calendarView?}` |

- `save` snapshot: `{ state:'pending'|'saving'|'saved'|'failed'|'unknown'|'fenced', epoch, version, durableVersion }`. This is the memory-first save progress.
- Frame encoding is `data: <JSON>\n\n`. The transport also accepts the calendar protocol v2 (`calendar-progress`, `calendar-operation`, `calendar-clarification`) and v3 multi-stream envelopes (`calendarCompatibleEnvelopeSchema`).

---

## 4. HTTP API

All routes carry the `/api` prefix. Every `/api/*` response gets `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, no `ETag`, and an `X-Request-ID` (UUID).

### 4.1 Private admission (`http/configure-private-http.ts`)
Exempt paths (lower-cased, trailing slash stripped):
- `OPTIONS`.
- `/api/auth/{login,logout,me,password,forgot-password,reset-password}`.
- `GET /api/operations/live`.
- `GET /api/plugins/google-calendar/oauth/callback`.

Every other `/api/*` request goes through these checks:
1. Reject with `FORBIDDEN` when `Sec-Fetch-Site: cross-site`, when an `Origin` differs from `FRONTEND_ORIGIN`, or when a non-GET/HEAD request lacks the exact `Origin`.
2. `auth.authenticate(sessionCookie)` and `requireFullAccount`. `/api/admin*` additionally requires super-admin.
3. Optionally re-seal the cookie.
4. `prepareOwner` (refreshes calendar status, bounded by `persistenceTimeoutMs`).
5. Bind the principal through AsyncLocalStorage.

Fault bodies come from `AuthFault`. `UNAUTHENTICATED` also clears the cookie. **Note:** `/api/operations/ready`, `/api/operations/metrics`, `/api` and `/api/health` therefore require an authenticated session.

### 4.2 Chat routes (`http/chat-http.controller.ts`, `@Controller('sessions')`, `ChatHttpFilter`)
Every route except the session list rejects any query string (`noQuery`, strict empty object). Path IDs must pass `idSchema` and must not contain whitespace, `/`, `\`, `?`, `#` or control characters.

| Method and path | Body / query | Success | Notes |
|---|---|---|---|
| `GET /api/sessions` | query `cursor?` (≤2048, base64url), `limit?` (`^[1-9]\d{0,2}$`, ≤ maxPageSize; default defaultPageSize) | 200 `{items:[{sessionId,title,pinned?,createdAt,lastActivityAt}], nextCursor}` | Only `lifecycle:'active'` sessions **with `latestTurnId ≠ null`**. Pinned first, then `lastActivityAt` desc, then `sessionId` desc. Memory-first sessions are overlaid. |
| `POST /api/sessions` | `submitTurnRequest` with `sessionId:null` | **202** `SubmitTurnResponse` | Creates a new chat at its first accepted message. |
| `GET /api/sessions/:sessionId` | — | 200 `SessionSummary` | 404 if missing, archived or not owned. |
| `PATCH /api/sessions/:sessionId` | `{title?: trimmed 1–80, pinned?: boolean}`; at least one; strict | 200 `SessionSummary` | Memory-first rejects while saving ("still saving"). |
| `DELETE /api/sessions/:sessionId` | — | **204** | Soft delete: `lifecycle:'archived'` only when `execution.ownerId` and `activeAttemptId` are both null; otherwise 409 `CONFLICT_ACTIVE_TURN`. |
| `GET /api/sessions/:sessionId/messages` | `cursor?`, `limit?` | 200 `{items: VisibleMessage[], nextCursor, olderAvailable, save?, saveTurnId?, activeTurn?:{turnId,attemptId,status:'accepted'|'generating'|'finalizing',mode?}}` | A page holds the newest N, returned oldest to newest; the cursor walks older. Internal live-voice messages return `content:''` plus `voiceTranscripts`. Internal user inputs without an acceptance marker are hidden. With `memoryPublication`, results are bounded at `sequence ≤ publication.sequence`. |
| `POST /api/sessions/:sessionId/turns` | `submitTurnRequest`; body `sessionId` must equal the path | **202** `SubmitTurnResponse` | Duplicates return the same 202 body. |
| `GET /api/sessions/:sessionId/turns/:turnId` | — | 200 `TurnStatusResponse` `{sessionId,turnId,attemptId,status,truncated,error|null,calendar?,save?}` | Read-only and reflects the latest attempt. |
| `POST /api/sessions/:sessionId/turns/:turnId/retry` | `{idempotencyKey(8–128), expectedEpoch?, calendarProtocol?:2|3}` | **202** `SubmitTurnResponse` | Only the latest turn; prior status must be failed, cancelled or interrupted; fewer than 3 attempts per turn. |
| `POST /api/sessions/:sessionId/turns/:turnId/cancel` | `{attemptId}` | **204** | Acknowledgment only; this is not proof that the turn is terminal or that billing stopped. |
| `POST /api/sessions/:sessionId/turns/:turnId/retry-save` | `{epoch, version}` | **202** `TurnStatusResponse` | Memory-first only. Retries a failed background save. Raises INTERRUPTED on an epoch or version mismatch and NOT_READY if the save cannot be retried. |
| `GET /api/sessions/:sessionId/turns/:turnId/stream` | — | 200 `text/event-stream` | **Executes** the latest accepted attempt; see §4.5. |

`submitTurnRequestSchema` (strict):
- `{ sessionId: id|null, content: string 1–32,000 (non-blank after trim), idempotencyKey: 8–128, expectedEpoch?: id, calendarProtocol?: 2|3, calendarReplyTo? }`.
- Pre-checks:
  - `content.length > min(maxInputChars,32000)` or `bytes > maxMessageBytes` raises `INPUT_TOO_LARGE` (413).
  - Unknown key raises `UNKNOWN_FIELD`.
  - Body keys `userId`, `user` or `openRouterUser` raise `IDENTITY_OVERRIDE_REJECTED`. Keys `model`, `modelId` or `apiKey` raise `MODEL_OVERRIDE_REJECTED`.
  - When the calendar is enabled for the owner, `calendarProtocol` must equal 2; otherwise `INVALID_REQUEST`.
  - A mismatched `expectedEpoch` raises `INTERRUPTED` ("earlier server session").
  - `executionReservations.assertText` rejects when live voice owns the session.

`SubmitTurnResponse`:
- `{ sessionId, turnId, attemptId, userMessageId, streamPath: '/sessions/<s>/turns/<t>/stream' (relative to /api), processEpoch? }`.
- `processEpoch` is a per-process random UUID, returned on the memory-first path.

### 4.3 Operations and app routes
- `GET /api/operations/live` returns `{live:true}`. No auth is required.
- `GET /api/operations/ready` returns 200 when `acceptReady`, otherwise 503. The body is `{live:true, readReady, acceptReady, provider:'healthy'|'degraded'|'blocked'|'unknown', speech:'off'|'unconfigured'|'degraded'|'ready', issues:string[], calendar?:{state,enabled}}`. See §9.
- `GET /api/operations/metrics` returns `{observations: Record<Metric,{count,sumMs,maxMs}>, runtime: snapshot, transport:{active,backpressured}, voice?}`.
- `GET /api` returns `'Hello from Aurvin'`. `GET /api/health` returns `{status:'ok'}` (from `app.controller.ts`).

### 4.4 Body parsing and errors
- `configure-chat-http.ts` installs a JSON parser with `strict: true` and `limit = min(262144, 32000*6+4096) = 196,096` bytes.
  - Too large: 413 `INPUT_TOO_LARGE`.
  - Parse error: 400 `INVALID_REQUEST`.
- `ChatHttpFilter` turns errors into `publicError`:
  - `AppError` keeps its code.
  - `ZodError` becomes `INVALID_REQUEST`.
  - `HttpException` maps 413, 429, 404, other <500 and ≥500 to `INPUT_TOO_LARGE`, `RATE_LIMITED`, `NOT_FOUND`, `INVALID_REQUEST` and `PERSISTENCE_ERROR` respectively.
  - Anything else becomes `PERSISTENCE_ERROR`.
  - If headers were already sent, the response is just ended.

### 4.5 SSE stream semantics (`http/chat-stream.transport.ts`, `http/sse-writer.ts`)
1. At most **one attachment per (userId, sessionId)**; a second one gets 409 `CONFLICT_ACTIVE_TURN`. The process-wide total is capped at `maxConcurrentGenerationsPerProcess`; above that the request gets 429 `CONCURRENCY_LIMIT`.
2. `runtime.reserveStream(userId, sessionId, signal)` is held through the run. Status is resolved first: the memory "hot" status, otherwise the durable `getTurnStatus` after a session ownership check.
3. If the status is `generating` or `finalizing`, the request gets 409. Another tab may poll status but cannot attach.
4. `SseWriter` sets these headers on the first frame: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`, `nosniff`. Writer rules:
   - The writer rewrites `sequence` to its own counter from 0, renumbering producers.
   - It validates scope against session, turn and attempt.
   - It rejects any frame after a terminal frame.
   - `completed` must be preceded by a `status` of the same outcome.
   - Error frames are rewritten to public bodies.
   - Frame cap is `6*min(maxMessageBytes,65536)+4096` (397,312 bytes by default).
   - Backpressure waits for `drain` with timeout `idleStreamTimeoutMs`; a timeout interrupts the stream.
5. `runtime.executeTurn({userId, sessionId, turnId, attemptId, signal, emit, emitCalendar})` runs inference only if the attempt is `accepted`. For a terminal attempt it replays:
   - The durable path sends `status` and, for completed or truncated, the stored assistant text in 1,000-char `delta`s (the first with `reset:true`) followed by `completed`.
   - Memory-first sends `status` and `completed` with `save`.
6. Terminal frames (`completed`, `error`, or a terminal `status` and anything after it) are buffered (≤ `6*maxMessageBytes+65536` bytes) and flushed only after the runtime reservation has released transport work.
7. If a read-only reattachment to a failed, cancelled or interrupted attempt produced no error frame, one is synthesized from the stored error, or from `CANCELLED`/`INTERRUPTED`.
8. Errors before headers are sent go back as JSON with the HTTP status. Errors after the first frame become one `error` frame.
9. A client disconnect (`req aborted` or `res close`) aborts the signal. The runtime maps that to **interrupted**, but a sealed result still finalizes.
10. `ChatStreamTransport.closeUser(userId, authSessionId?)` aborts attachments on logout or deactivation.

Reconnection rules:
- There is no replay cursor and no `Last-Event-ID`.
- After a disconnect the client reads `GET status` and `GET messages`. If the attempt is still `accepted`, the client re-opens the stream; for a terminal attempt the client re-opens it to get a replay.
- **Streamed text is provisional**; completion is real only when a terminal `status` is followed by `completed`. EOF or HTTP 200 is not completion.
- The prompt is never resubmitted automatically.

---

## 5. Persistence (`backend/src/persistence/`)

### 5.1 Opening (`persistence.ts`, `openPersistence(config)`)
- `executorId = randomUUID()`. Topology must be `single-process`, and the URI must be present (otherwise `NOT_READY`).
- `MongoClient` options:
  - `appName`: `aurvin-<executorId>`, or `aurvin-local-<executorId>` in local mode.
  - `monitorCommands:true`, `retryWrites:false`, `maxIdleTimeMS:120000`.
  - `connectTimeoutMS` and `serverSelectionTimeoutMS` = `connectTimeoutMs`.
  - `timeoutMS` = `persistenceTimeoutMs`.
  - `writeConcern {w:'majority'}`. Local mode adds `j:true`, `readPreference:'primary'` and `readConcern:'majority'`.
- Local crash recovery mode:
  1. Acquire the Windows guard (§9.6).
  2. Require an explicit `replicaSet` in the URI (not load-balanced, not `directConnection`). `hello.setName` must match, `isWritablePrimary` must be true, and the server must not be mongos.
  3. Claim the executor or hand off from a previous one, bound to the machine, installation, PID, creation time, database hash and guard hash.
  4. Install `MutationJournal` and `guardedClient`.
- `createPersistenceBundle(client, dbName, budgets, executorId, local?)`:
  1. `RecordStore(db, persistenceTimeoutMs)`.
  2. `MongoOwnership` and `claimExecutor()` (outside local mode).
  3. `setupIndexes`.
  4. Checkpointer `setup()`.
  5. Build the repositories (`sessions`, `users`, `messages`, `memory`, `metadata`, the calendar stores and their v2 variants, `calendarProposals`, `owner`, `checkpoints`), `observeDatabase`, and `ping()` (`{ping:1}`).
  6. On a setup error, release the executor (outside local mode).
- `close()` drains ownership, stops the journal (local), releases the executor sentinel, stops observation, closes the client and finally closes the guard.

### 5.2 Store conventions (`store.ts`, `records.ts`, `confirmed-record.ts`)
- Every application document has `_id` (a deterministic sha256 key) and `_revision` (an integer, incremented on every update).
- `bounded(schema, value, id, limit)` runs strict Zod parsing and safe-sequence checks, then requires `BSON size + 256 ≤ min(limit, 1,800,000)`; otherwise `STORAGE_BUDGET_EXCEEDED`.
- `decode` failures raise `PERSISTENCE_ERROR` ("Saved chat data is unavailable.").
- All reads pass `maxTimeMS = persistenceTimeoutMs`.
- Immutable insert is `updateOne(filter, {$setOnInsert: doc}, upsert)`. An existing document with different content raises `IDEMPOTENCY_PAYLOAD_MISMATCH`. Ambiguous results are re-read and confirmed by content.
- `ConfirmedRecord<T>` is an opaque receipt (WeakMap, deep-frozen) bound to `{store, collection, id, revision, canonical}`. CAS replacements require a receipt (`replaceConfirmed`), and those outcomes are `confirmed`, `conflict` or `uncertain`.
- The `beforeMutation` hook enforces ownership phase deadlines, lease expiry and journal health before every write.

### 5.3 Collections

| Collection | Key fields / kinds | Indexes (name: keys) |
|---|---|---|
| `sessions` | SessionRecord + `_id`, `_revision` | `user_activity_session` {userId:1,lastActivityAt:-1,sessionId:-1}; `user_lifecycle_pin_activity_session` {userId,lifecycle,pinned,lastActivityAt:-1,sessionId:-1} |
| `messages` | MessageRecord | `scope_sequence_message` {userId,sessionId,sequence:-1,messageId:-1}; `scope_message` {userId,sessionId,messageId}; calendar: `calendar_message_source`, `calendar_invalidation_message` |
| `agent-memory` | AgentMemoryManifest (one per session; `put` is an immutable first write, then a `contextVersion+1` CAS) | `scope_manifest` {userId,sessionId} |
| `metadata` | `kind` ∈ `attempt`, `acceptance`, `accounting`, `voice-accounting`, `sequence-counter`, `sequence-reservation`, `generation`, `executor`, voice delivery kinds, `calendar-*` kinds | `scope_kind_attempt`, `scope_kind_request` (idempotencyKey), `scope_kind_sequence`, `user_kind_generation`, `kind_user_accounting_range`, `kind_accounting_range_user`, plus about 26 partial unique calendar indexes (`calendar_operation_turn`, `calendar_dispatch_identity`, `calendar_pending_proposal_session`, …; see `indexes.ts` `CALENDAR_INDEXES`) |
| `checkpoints` / `checkpoint_writes` | Stock `MongoDBSaver` collections | Created by the saver's `setup()` |
| `config` | One document `_id:'aurvin'` | none |
| `users` | `userAccountSchema` (`_id = userId`; workosUserId, emailNormalized, role, status, passwordChangeRequired, currentWorkosSessionId, sessionEpoch, createdAt…) | `users_workos_subject` (unique), `users_email` (unique), `users_created_identity` {createdAt:-1,userId:-1} |
| `integration_connections` | Calendar connections | `calendar_owner` {userId,provider} unique; `calendar_connection_identity` unique |

Index creation failure raises `NOT_READY` ("Chat storage setup failed."). All application indexes are created on every boot.

### 5.4 Pagination (`pagination.ts`)
- Cursor is `base64url(JSON{v:1, kind:'sessions'|'messages'|'attempts', userId, sessionId('' for sessions), value: ISO string|sequence, id, pinned?})`.
- Cursors are scope-checked; a wrong user, session or kind gives `INVALID_REQUEST`. A cursor is at most 2,048 chars, and `limit` is 1..min(maxPageSize,50).
- The session list runs 3 parallel queries (pinned true, false, null) with `limit+1` each, then merges them.
- History reads used for context cap at 100 pages × maxPageSize records; overflow raises `STORAGE_BUDGET_EXCEEDED` ("Start a new chat").

### 5.5 Executor sentinel and session leases (`ownership.ts`, `MongoOwnership`)
- **Sentinel:**
  - Document `metadata` with `_id=key('executor')`, `kind:'executor'`, `userId:'__aurvin_system__'`, `sessionId:'__executor__'`, `ownerId`, `local?`. It has no TTL.
  - `claimExecutor()` inserts it. If a different owner already holds it (outside local mode), **the leftover sentinel is taken over** by a revision CAS (`handoffStoppedExecutorCore`). This lets watch reloads and crashed processes boot. Two *live* backends would race; that setup is unsupported.
  - `assertExecutor()` re-reads the sentinel; when `ownerId` is not this process it raises `UNSUPPORTED_TOPOLOGY`.
- **All ownership operations are serialized** through one promise queue (`exclusive`).
- **Session lease** fields on the session are `execution.{ownerId, leaseExpiresAt, activeAttemptId, generation}`. The lease is `{userId, sessionId, ownerId, generation, leaseExpiresAt}`, with `leaseMs` 1..180,000 (the runtime uses 180,000).
  - `acquire`: `findOneAndUpdate` when active, `ownerId=null` and `activeAttemptId=null` at the expected generation. It sets the owner and expiry and increments `generation` and `_revision`. Otherwise it returns `CONFLICT_ACTIVE_TURN`.
  - `reserveAttempt(lease, attemptId)` sets `activeAttemptId`; that field is **the one-active-generation-per-session latch**.
  - `allocateSequences(lease, reservationId, count≤80)` uses a per-session `sequence-counter` (`$inc next`) and records an idempotent `sequence-reservation`. If the counter is missing but messages exist, it raises `NOT_READY` ("restore reconciliation").
  - `confirmAcceptance(lease, attemptId, receipts?)` verifies the input message, attempt and payload hash, inserts the `acceptance` marker, and sets `session.latestTurnId`.
  - `detachAccepted` clears the owner but keeps `activeAttemptId` (`generation++`). `attachAccepted` re-acquires for an accepted attempt when the stream opens.
  - `renew`, `fence`, `run(lease, action)` and `runPhase(lease, {name, deadlineAt, maxOperations}, action)` provide guarded write phases.
  - `finishAttempt(lease, terminalReceipt, activityAt)` atomically clears owner, lease and slot and runs `$max` on `lastActivityAt`/`updatedAt`. `clearAttempt` clears the slot after a terminal attempt. `release` clears the owner.
  - `recoverStoppedSession(u, s, previousOwner, leaseMs)` lets the current or an authorized stopped owner take a session for reconciliation. **Lease expiry alone never authorizes takeover.**
  - `releaseExecutor()` deletes or releases the sentinel at close.

### 5.6 Mutation journal and local crash recovery (`mutation-journal.ts`, `operations/local-*.ts`)
- This is active only when `AURVIN_LOCAL_CRASH_RECOVERY=true`.
- Every data or DDL write goes through `MutationJournal.write`:
  1. CAS the sentinel `local.mutation` from `idle` to `busy{token}` (majority with journal).
  2. Dispatch the write (majority with journal).
  3. CAS `busy` back to `idle`.
- Any failure latches `failed`, which blocks all writes and keeps the sentinel `busy`, requiring operator recovery.
- Queue limit is 100 (`CONCURRENCY_LIMIT`).
- `guardedClient` exposes only `collection(name)` for the 8 known collections, read cursors (`find`, `findOne`, a restricted accounting `aggregate`), the mutation methods (`updateOne`, `replaceOne`, `findOneAndUpdate`, `bulkWrite`, `createIndex`) and `ping`. Transactions or sessions raise `UNSUPPORTED_TOPOLOGY`.
- At next start, `handoffLocalOwner` requires that the previous sentinel is `local-mutation-v1` with mutation `idle`, the binding hashes match, the app name matches, and `local-guard.ps1` reports the old exact process lifetime as `dead`. It records `ancestors` (≤16) and `pending:true`.
- `finishLocalMaintenanceForUsers` then builds a maintenance runtime with `stopAccepting` and `allowStoppedOwner(ancestors)`. It pages over all users (≤1000 pages of 50) and their recoverable sessions (`listForRecovery`, ≤1000 pages, so 50,000 rows per owner), calls `reconcileSession` on each, drains, runs `owner.finishLocalRecovery()`, and returns a **fresh** runtime.

### 5.7 Checkpoints (`checkpoints.ts`)
- `ScopedMongoSaver` extends `MongoDBSaver` with collections `checkpoints` and `checkpoint_writes`. It accepts only `thread_id === graphThreadId(u,s)` and `checkpoint_ns === ''`.
- Every document is size-checked (`maxDocumentBytes`), write lists are capped at 81 rows and total bytes ≤ `maxDocumentBytes`, and every write requires a live lease (`bind(lease)`).
- Graph config is `{configurable:{thread_id, checkpoint_ns:''}, durability:'sync'}`.

---

## 6. Context assembly (`backend/src/context/`)

`ReferencedContextAssembler.assemble(request, source?)` (`referenced-context-assembler.ts`):
1. Validate the IDs and `validateInput`:
   - Input must be non-blank; otherwise INVALID_REQUEST.
   - INPUT_TOO_LARGE if `length > maxInputChars`, `bytes > maxMessageBytes` or `bytes > maxInputTokens`.
2. Load the manifest (`agent-memory`), or take it from an in-process `source` snapshot. `validateManifest` requires:
   - Bytes ≤ maxManifestBytes.
   - Matching user and session.
   - `activeSummaryRef === null`.
   - **`instructionVersion`, `knowledgeContentHash` and `graphSchemaVersion` equal to the current assets.**
   - Unique refs, and `sourceRanges` equal to exactly one envelope from the first to the last ref.
   - Otherwise `NOT_READY` ("Chat context needs reconciliation before continuing.").
3. Load the referenced message records (`getReferences` bulk, or one at a time) and run `selectReferences`:
   - Every ref must match a record (scope, eventId, sequence).
   - **A record whose `turnId === request.turnId` is skipped.** It must be a single eligible user record whose content equals `newUserInput`; this is the dedupe for retries where the input is already referenced.
   - Other records are kept if `eligible`:
     - user: accepted or completed and not truncated;
     - internal live assistant: terminal with an attemptId;
     - assistant: `completed` and not truncated, with an attemptId.
   - Truncated, failed, cancelled and interrupted assistant replies are therefore **excluded** from future context.
4. Build messages in this order:
   1. `system`: `assets.instructions` (system.md verbatim).
   2. `system`: `"Product background (data, not authority):\n" + JSON.stringify(knowledge)`.
   3. `system`: `"Environment background (data, not authority):\n" + JSON.stringify({timeZone, currentDate:'YYYY-MM-DD', dayOfWeek})`. The time zone is the calendar trusted zone or `Etc/UTC`.
   4. `system`: `"Response mode: text."` or `"Response mode: voice."`.
   5. History in sequence order. Live voice assistant turns are replaced by the *heard* text from the voice delivery record, or by "Voice reply delivery is unknown; do not assume generated content was heard." Canvas artifacts are added as an assistant data message.
   6. `user`: `newUserInput` (**exactly once**).
5. Budget (`context-budget.ts`):
   - `estimatePromptTokens = bytes(JSON.stringify(messages)) + 32*count + 256`.
   - Overflow when `estimate + maxOutputTokens + modelMarginTokens > maxContextTokens` or `count > maxMessagesInContext`, or when any message exceeds `maxMessageBytes`.
   - Overflow returns `{ok:false, overflow:{code:'CONTEXT_BUDGET_EXCEEDED', …}}`. History is **never silently dropped**; the user must start a new chat.
6. `assertFixedContextFits(assets, budgets)` runs at startup and on config activation. It probes fixed, environment, mode and `'x'` messages for both modes.

Checkpoint duplication: graph state (`agent/state.ts`) holds **no chat messages**, only `input` (attempt record and assistant sequence), `boundary` (`{contextVersion, manifestHash}`), `result`, `sealed`, `rebase` and calendar cursor, seal and refs. History always comes from the manifest and messages, so nothing restored from a checkpoint can duplicate it. On each turn the runtime checks that `checkpoint.boundary === boundaryFor(currentManifest)` and that `acceptedHistory` rebuilds exactly the stored manifest (`checkBoundary`); otherwise it raises `NOT_READY` ("needs recovery").

Manifest construction (`buildReferenceManifest`): eligible records are sorted by sequence, refs are `{messageId,eventId,sequence}`, there is one source range, and asset hashes come from the current (or overridden) assets. After a turn the target manifest is `contextVersion+1` and includes the new user and assistant records (a truncated assistant is excluded as ineligible).

---

## 7. Model layer (`backend/src/model/`)

### 7.1 Request (`policy.ts`, `openrouter-adapter.ts`)
- `POST https://openrouter.ai/api/v1/chat/completions` with headers `Authorization: Bearer <key>`, `Content-Type: application/json` and `X-Title: Aurvin`.
- The body is built by `ChatOpenRouter({ apiKey, model, user, maxTokens, maxRetries:0, streamUsage:true, transforms:[], provider:{data_collection:'deny', require_parameters:true}, plugins:[context-compression, web, file-parser, response-healing all {enabled:false}], siteName:'Aurvin', siteUrl:'' }).invocationParams({})`, with `sessionId` and `trace` cleared. The adapter then adds:
  - `messages` (`[{role,content}]`), `stream:true`, `stream_options:{include_usage:true}`.
  - `session_id = 'aurvin-' + sha256(JSON[userId, sessionId])`.
  - `cache_control:{type:'ephemeral'}` when the model ID starts with `anthropic/`.
- **`user` = the authenticated `userId`** (`attempt.openRouterUser`) on every dispatch. `assertRequest` requires `r.user === config.identity.userId`, where the runtime builds the config per attempt with `identity.userId = attempt.userId`.
- `assertRequest` also requires: the key and model are set, transforms are disabled, limits match, `maxOutputTokens ≤ budget` (the runtime always sends `snapshot.budgets.maxOutputTokens`), message count ≤ maxMessagesInContext, roles in system/user/assistant, each message ≤ maxMessageBytes, last user ≤ maxInputChars and ≤ maxInputTokens bytes, and `64 + Σ(bytes+32) + maxOutputTokens + margin ≤ maxContextTokens`.
- Transport limits (`TRANSPORT_LIMITS`): frame 65,536 B, stream 1 MiB, 10,000 frames, JSON 65,536 B, catalogue 4 MiB, visible output 32,000 chars, and output bytes ≤ maxMessageBytes (otherwise `STORAGE_BUDGET_EXCEEDED`).

### 7.2 Streaming and parsing
- `parseSse` (`sse.ts`) decodes strict UTF-8 and handles CR, LF and CRLF.
  - `:comment` lines yield comments.
  - `data:` lines are joined by `\n`; an empty line ends the event.
  - Exceeding a bound raises `PROVIDER_ERROR`. A trailing partial frame raises `INTERRUPTED`.
- Each frame is handled as follows:
  - `[DONE]` requires a finish reason and a generationId.
  - JSON `id` gives the generationId. On first capture it is durably saved (`onGenerationId`, which updates the attempt) **before any text is yielded**. A different ID later raises `PROVIDER_ERROR`.
  - `usage` merges absolute counts (`prompt_tokens`, `completion_tokens`, `cost`, cached, cache-write and reasoning tokens), saves accounting, and yields `usage`.
  - `error` fails.
  - More than one choice, `tool_calls`/`function_call`, a non-assistant role or non-string content fails closed.
  - `finish_reason` must be `stop` or `length`. `length` yields `{type:'length'}`, which becomes **truncated**. Content after finish fails.
- Chunks are `delta`, `comment`, `generation-id`, `usage`, `length`, `error` and `end`.

### 7.3 Deadlines, retries and faults
- `RunDeadlines` (`deadlines.ts`) arms `total = min(totalRunTimeoutMs, attempt deadline)`, then `connect` until headers, then `first` (`firstOutputTimeoutMs` until first text) and `idle` (`idleStreamTimeoutMs`, reset by every frame, including comments). Timeout raises `TIMEOUT`; outer abort raises `CANCELLED`.
- Dispatch loop: up to `retryMaxAttempts` fetches. Accounting is saved **before each fetch**, as durable evidence of possible billing.
  - A non-OK response is retried only when the status is 429 or 503, the error body's `code` equals the status, and there is no generationId and no visible text (`mayRetryRejection`).
  - Delay is full jitter `rand*min(retryMaxDelayMs, base*2^(n-1))`. A `Retry-After` above `retryMaxDelayMs` means no retry.
  - A network error on fetch raises `INTERRUPTED`; there is no automatic retry.
- `providerFault(status, code)`:

| Condition | Code | Retryable |
|---|---|---|
| 401/403/`invalid_api_key` | PROVIDER_AUTH | false |
| 402/`insufficient_credits` | PROVIDER_CREDITS | false |
| 413/`context_length_exceeded` | CONTEXT_BUDGET_EXCEEDED | false |
| 400/422 | INVALID_REQUEST | false |
| 429/`rate_limit_exceeded` | RATE_LIMITED | true |
| otherwise | PROVIDER_ERROR | true |

- Failure cleanup: outcome becomes `cancelled`, `interrupted` (INTERRUPTED or TIMEOUT) or `failed`. Accounting is saved under a separate cleanup signal; a failed save raises `PERSISTENCE_ERROR`.

### 7.4 Catalogue verification (`catalogue.ts`)
- `loadModelLimits` calls `GET /api/v1/models` with the bearer key, `redirect:'error'`, a `connectTimeoutMs` timer, and a 4 MiB JSON cap.
- It finds the entry with `id === modelId` and requires `context_length` and `top_provider.max_completion_tokens` to be positive safe integers ≥ the budgets, and `supported_parameters` to include `max_tokens`.
- It returns `{modelId, contextTokens, outputTokens, supportsMaxTokens:true, source:'catalogue', calendar?}`. The `calendar` field requires `tools` support and listed prompt and completion prices; it is verified against frozen `calendar-evidence.ts` or derived from the live catalogue.
- Any failure raises `CONFIGURATION_ERROR`, which makes snapshot activation fail and readiness report `model_limits`.

### 7.5 Accounting (`accounting.ts`)
- `AccountingService.save` validates scope (`userId`, `requestedModel`) and bounds the write by `persistenceTimeoutMs`.
- `reconcile(record)` runs only when there is a generationId and the status is not known. It calls `GET /api/v1/generation?id=…` up to `retryMaxAttempts` times (retrying on 404, 429 and 503), maps `native_tokens_*`, `total_cost`, `model` and `provider_name`, sets `unknown` if still unresolved, and saves.
- Values never regress. Conflicting cost or tokens raise `PROVIDER_ERROR`.
- `observation-writer.ts` is a bounded asynchronous merge-and-flush writer used when the runtime supervises a non-blocking stream.

### 7.6 Strict JSON (`strict-json.ts`)
`scanJsonObject(raw, {argumentBytes, jsonDepth})` is a hand-written JSON scanner for **calendar tool arguments**. It detects malformed JSON, duplicate keys, the byte limit (16,384), the depth limit (8) and forbidden calendar keys. Text chat never uses tools.

---

## 8. Agent graph and chat runtime

### 8.1 LangGraph graph (`agent/turn-graph.ts`, `agent/state.ts`)
- State is `TurnState` (`input`, `boundary`, `result`, `sealed`, `rebase`, `calendarCursor`, `calendarSeal`, `calendarRefs`).
- `GraphInput` is `{attempt: AttemptRecord, assistantSequence}`.
- `SavedResult` is `{input, assistant: MessageRecord, accounting, base: Boundary, target: Manifest, outcome:'completed'|'truncated'}`.
- Nodes:
  - `prepare`: calls `hooks.prepare`. **Text turns generate inside `prepare`**, so no empty checkpoint is written before paid inference.
  - `generate`.
  - `calendar_decide`.
  - `calendar_execute`.
  - `seal`: validates that the result or calendar seal belongs to `input.attempt.attemptId` and that the boundary is restorable, then sets `sealed:true`.
- Edges:
  - START → prepare.
  - prepare → seal if a result or seal exists; otherwise generate, calendar_execute, seal or calendar_decide according to `cursor.next`.
  - decide → execute, decide or seal.
  - execute → decide or seal.
  - generate → seal → END.
- The graph is compiled with the scoped saver bound to the current lease. Recovery builds the graph with `prepare`/`generate` hooks that **throw**, so recovery can never invoke the model.

### 8.2 Durable turn lifecycle (`chat-runtime/durable-chat-runtime.ts`, used for the durable path and calendar handoff)

Acceptance (`acceptNewTurn`), with **no inference**:
1. Validate identity and readiness, then `assertText`.
2. Idempotency lookup `getAttemptByIdempotency(u, s, key)`. On a hit with the same `payloadHash` (and reply reference), return the same response; otherwise `IDEMPOTENCY_PAYLOAD_MISMATCH`. Concurrent identical submits share one promise (`joinAcceptance`); the in-flight map is bounded by maxConcurrentGenerations, above which `CONCURRENCY_LIMIT` is raised.
3. Capture the settings snapshot. This requires the key, model ID and matching limits; otherwise `NOT_READY` ("Chat configuration is unavailable."). It is stored per attempt in memory (≤1024 pending attempts).
4. `sessions.createIfAbsent` for a new chat (title from content). A `sessionId` that is supplied but missing gives `NOT_FOUND`.
5. `owner.acquire` (lease 180 s), then `checkBoundary`/`loadHealthyContext`: build context and verify manifest and checkpoint consistency. If the boundary is missing, bootstrap it (empty manifest at `contextVersion 0`). A prior latest attempt that is not terminal raises `CONFLICT_ACTIVE_TURN`.
6. One ownership phase `acceptance-stage` (≤8 operations):
   - `reserveAttempt`.
   - `allocateSequences(3)`: user message `start`, attempt `start+1`, assistant `start+2`. A retry allocates 2.
   - Append the user message (`completionStatus:'accepted'`) and put the attempt (`status:'accepted'`, `generationId:null`) in parallel.
   - `confirmAcceptance`: acceptance marker and `latestTurnId`.
7. `detachAccepted` releases the lease and keeps the `activeAttemptId` slot. Store an in-memory `AdmissionReceipt` (TTL 60 s; 128 entries; ≤2 MiB each, 16 MiB total) for fast attachment, then return 202.

Execution (`executeOwnedTurn`, triggered by GET stream):
1. If the attempt is terminal, replay it (§4.5). If it is not `accepted`, raise `NOT_READY`.
2. `work.attach(u, s, signal, totalRunTimeoutMs)` gives one job per session. `attachAccepted` re-acquires the lease, then a heartbeat renews it. A renew failure quarantines the work (`degraded`) and raises INTERRUPTED.
3. Emit `turn-accepted`. CAS the attempt to `generating`, emit `status generating`, then create the OpenRouter adapter with seed accounting (`outcome:'generating'`). The generationId is persisted on the attempt and in accounting before the first text, and `delta` and `usage` events are forwarded.
4. The graph invoke produces a `SavedResult` with the assistant record (`streaming`) and the target manifest, then seals. The checkpoint is written synchronously.
5. Verify the sealed state, CAS the attempt to `finalizing`, and emit `status finalizing`. **From here the saved result wins over cancel or disconnect.**
6. `publishResult` runs in one `publication-stage` phase:
   1. Append the assistant message and put the accounting record (with outcome) in parallel.
   2. `memory.put(target)` (`contextVersion+1` CAS).
   3. `graph.updateState({boundary: target})` and confirm it.
   4. `messages.updateCompletion(completed|truncated)`.
   5. `touchActivity`.
   6. CAS the attempt to `completed` or `truncated`.
7. `finishAttempt` releases the owner, clears the slot and advances `lastActivityAt` in one CAS. Cache the confirmed state (`ConfirmedStateCache`, TTL 5 min). Emit `status <outcome>` and then `completed`.

Failure path:
- If a sealed result exists, mark the attempt `finalizing` and set `work.degraded=true`, which leaves record-driven recovery to finish publication.
- Otherwise `interruptAttempt` (`reconciliation.ts`):
  - Confirm a missing acceptance if possible.
  - Status becomes `cancelled` (CANCELLED), `interrupted` (INTERRUPTED, TIMEOUT or NOT_READY) or `failed`.
  - Append partial assistant text, if any, with that status. It is **not** added to future context.
  - Rebuild and put the manifest.
  - Reset the graph boundary (`input:null, result:null`).
  - Put accounting with the outcome.
  - CAS the attempt to terminal with `errorCode`.
  - `clearAttempt`.
  - Emit a terminal `status` and an `error` frame.

### 8.3 Retry, cancel, reconcile
- **Retry** (`acceptRetry`):
  - Only `session.latestTurnId`.
  - Prior status must be failed, cancelled or interrupted, with **fewer than 3 attempts per turn**; otherwise `CONFLICT_ACTIVE_TURN`.
  - Creates a new attempt with a new idempotency key, `causal.previousAttemptId = prior.attemptId` and the same `userMessageId`, and allocates 2 sequences. There is no new user message.
- **Cancel** (`cancelTurn`):
  - Memory-first entries are cancelled in memory.
  - Otherwise the attempt must be the latest (`CONFLICT_ACTIVE_TURN` if not current).
  - A terminal or `finalizing` attempt makes this a no-op.
  - An active job is aborted with `CANCELLED`. An accepted but unattached attempt is recovered through `recoverStoppedSession` and `interruptAttempt(CANCELLED)`.
- **reconcileSession(u,s)** is quiescent repair. It never infers.
  - It handles a pending rebase, pending calendar operations (`reconcileCalendarOperation`/`V2`, which can leave an outcome unknown) and pending voice deliveries.
  - If a sealed result exists it publishes it.
  - Otherwise it interrupts.
  - It requires the session owner to be this executor or one authorized through `allowStoppedOwner`.
- **interruptUser(userId)** (deactivation) aborts work and memory turns and cancels pending accepted attempts.
- **drain(ms)** (≤ shutdownDrainMs) returns `{drained, active, unresolvedWrites}` after draining work, memory saves and ownership. `stopAccepting()` is irreversible.

### 8.4 Concurrency and exclusion
- One active attempt per session, enforced in three places:
  - durable: `execution.activeAttemptId` CAS;
  - process: `WorkRegistry` (one job per user/session);
  - HTTP: one stream attachment per user/session.
- Process cap is `maxConcurrentGenerationsPerProcess`.
- `ExecutionReservations` excludes text and live voice on the same session across tabs: `assertText` and `assertLive`.

### 8.5 Idempotency summary
- `(userId, sessionId-or-new, idempotencyKey)` deterministically yields the session, turn, attempt and message IDs.
- Same key with the same content returns the original IDs, including for a brand-new chat, because the new session ID is derived from the key.
- Same key with different content, or with a different `calendarReplyTo`, raises `IDEMPOTENCY_PAYLOAD_MISMATCH` (409).

### 8.6 Memory-first text path (default; `memory-text.ts`, `memory-first-foundation.ts`, `persistence/memory-text-archive.ts`)
- One `MemoryText` compartment per owner, at most 32 per process; above that `CONCURRENCY_LIMIT`.
- `submitTurn` uses this path when the runtime is eligible: calendar disabled for the owner, or calendar v2 available. Acceptance is **in memory and synchronous** with the same deterministic IDs, and returns `processEpoch`.
- An existing session is first *hydrated* from storage. Hydration requires:
  - the session idle (no owner or slot), all attempts terminal, and the manifest valid;
  - `memoryPublication.version` equal to `manifest.contextVersion`;
  - the graph boundary consistent with the manifest.
- Otherwise it raises `NOT_READY` ("needs recovery"). A `DurableHistoryRequired` error falls back to the durable path.
- Inference streams the same events. The terminal envelope (user and assistant messages, attempt, accounting, manifest, checkpoint boundary) is saved **afterwards** by an ordered background save (`MemoryTextArchive.save`). It is exposed as `save` on status, `completed`, the messages listing and `retry-save`.
- The `memoryPublication {version, sequence, epoch, fence}` field on the session bounds the durable listing. `enterDurablePublication` removes it when the durable path takes over.
- `PROPOSED_MEMORY_TEXT_POLICY`:
  - maxSessions 16, maxSessionBytes 8 MiB, maxMemoryBytes 128 MiB;
  - maxRequestsPerSession 128, maxTurnsPerSession 128;
  - maxEnvelopes 32, maxEnvelopeBytes 512 KiB, maxBacklogBytes 16 MiB;
  - maxInputBytes 64 KiB, maxOutputBytes 128 KiB, maxEvidenceBytes 128 KiB;
  - maxOperationsPerSave 32, maxConcurrentSaves 2, maxAttempts 3, retryBackoffMs 1,000;
  - writeTimeoutMs 15,000, maxDirtyAgeMs 60,000, requestRetentionMs 300,000, shutdownDrainMs 20,000.
- Session mutation (PATCH/DELETE) while dirty raises `NOT_READY` ("still saving").
- **Note:** on this path acceptance is not durable before inference, which differs from the AGENTS.md "persist acceptance before inference" rule. A crash before the save completes loses the turn; the source treats this as save state `unknown`/`failed`. Exact crash semantics beyond that are unclear from source.

### 8.7 Rebase (not an HTTP route)
`rebaseSession(u,s)` runs on an idle session after a system.md or product_knowledge.md hash change, with an unchanged graph schema. It writes a `rebase` intent into the graph, then `finishRebase` writes a `contextVersion+1` manifest with the new hashes. The source does not show what invokes it automatically; it appears to be operator-only. Unclear.

### 8.8 Calendar tool loop (summary only; `chat-runtime/calendar-*.ts`, `model/calendar-*.ts`, `context/calendar-context.ts`)
Activation conditions:
- The calendar is enabled for the owner (`configFor`).
- The client sends `calendarProtocol: 2`.
- The graph prepare returns a v2 `calendarCursor` `{deadlineAt, trustedNow, trustedTimeZone, limits, next, pending*Id, repair}`.

Flow:
1. **decide** (`CalendarLoop.decide`):
   - Check the dispatch budget (`CalendarTurnLedger.reserveDispatch`, with a Decimal128 USD reservation).
   - If a proposal is pending, a user reply is matched deterministically (`readCalendarReply`, `resolveReplyTarget`) and consumed or tombstoned.
   - Otherwise one OpenRouter dispatch with tool schemas runs through `calendar-adapter.ts` (`createCalendarModelPort`).
   - The tool-call candidate is validated (`calendar-validation.ts`, `strict-json.ts`). Invalid arguments get up to 2 repair dispatches (`calendar-repair.ts`); exhaustion gets a conversational failure answer.
   - Decision records are persisted, and the cursor moves to `execute` or `seal`.
2. **execute**:
   - Reads (`calendar_list_events`, `calendar_get_event`, `calendar_list_calendars`, `calendar_check_availability`) go to the plugin. Results are persisted as bounded source and result records, and the cursor returns to `decide`.
   - `calendar_create_event` runs through:
     - an intent read from the accepted user message (`calendar-intent.ts`); the model cannot manufacture consent;
     - an availability preflight (`calendar-preflight.ts`);
     - a proposal published for confirmation when needed (`calendar-authority.ts`);
     - a single durable operation via `CalendarOperationWriter.executeCreate` (`calendar-operation.ts`) with operation and event ledgers; an unknown write outcome is never replayed.
3. **seal** writes a v2 `calendarSeal` (narration ref, dispatchIds ≤8, operationId, optional `view`). `publishCalendarTurn` (`calendar-publication.ts`) publishes the message with `sourceProvenance` and `calendarView`.

Frames: progress, operation and clarification events stream as calendar protocol v2/v3 frames alongside v1 events.

Limits (`CALENDAR_LIMITS`): modelDispatches 8, repairs 2, logicalTools 6, creates 1, calendarRequests 20, toolTimeoutMs 20,000, modelSpendUsd `'1'`, argument and result bytes 16,384, proposalLifetimeMs 600,000, sourceLifetimeMs 1 day, auditLifetimeMs 30 days.

Recovery: `reconcileCalendarOperation[V2]` in `reconcileSession`.

---

## 9. Operations (`backend/src/operations/`)

### 9.1 Request admission (`configure-operations.ts`, `admission.ts`)
- Every request gets an `X-Request-ID` (UUID) and runs inside a telemetry request scope. The request duration is measured.
- **Generation requests** are `POST /api/sessions`, `POST …/turns`, `POST …/retry` and `GET …/stream`. Paths are matched lower-case without the trailing slash. **Control requests** are everything else.
- `Admission.take(kind)` is a **process-wide** 60 s sliding window:
  - generation cap = `maxRequestsPerMinutePerUser` (default 20, read live from the snapshot);
  - control cap = 120.
  - Over the cap gives 429 `RATE_LIMITED` with `Retry-After: 60`.
- Then:
  - `retry` and `stream` call `ops.acceptForRetry()`, which bypasses only the transient 30 s provider "degraded" state.
  - New-turn POSTs call `ops.accept()`, which requires `readiness.readForText().acceptReady`; otherwise 503 `NOT_READY`.
  - Either way, if active runtime generations ≥ `maxConcurrentGenerationsPerProcess`, the request gets 429 `CONCURRENCY_LIMIT`.

### 9.2 Readiness (`readiness.ts`)
`issues` entries (any issue makes `acceptReady` false):

| Issue | Condition |
|---|---|
| `OPENROUTER_API_KEY is missing` | Active snapshot has no key. |
| `OPENROUTER_MODEL is missing` | Active snapshot has no model ID. |
| `unverified_persistence` | No URI. |
| `fixed_assets` | Assets not loaded. |
| `model_limits` | Snapshot has no model limits. |
| `privacy_policy` | `dataCollection` not `deny` or transforms enabled. |
| `database` | `ping` fails. |
| `executor` | `assertExecutor` fails. |
| `runtime` | No runtime. |
| `runtime_quarantined` | Runtime degraded. |
| `runtime_stopped` | Runtime not accepting. |
| `draining` | Shutdown in progress. |
| `authentication` | WorkOS not configured or no storage. |

- Database and executor results are cached 5 s; the probe is bounded at 1 s and shared while pending.
- `provider` state:
  - `PROVIDER_ERROR`, `TIMEOUT`, `PROVIDER_AUTH` or `PROVIDER_CREDITS` sets `degraded` for 30 s.
  - `PROVIDER_AUTH` or `PROVIDER_CREDITS` sets `blocked` until restart.
  - A success sets `healthy`. The initial state is `unknown`.
  - `acceptReady` also requires the provider to be neither blocked nor degraded.
- `readReady = db && authenticated`.
- When the memory-first runtime reports `memoryAdmissionReady()`, text admission skips the database probe (it assumes `db:false`, `executor:true`).
- **Readiness never calls the paid provider.** Readiness is not a restart probe.

### 9.3 Shutdown and drain (`operations.service.ts`)
`beforeApplicationShutdown` calls `shutdown()` once:
1. Set `readiness.closing`, stop voice, config and calendar admission, then `runtime.stopAccepting()`.
2. Under one `shutdownDrainMs` deadline, drain voice (in parallel), the runtime, config jobs and calendar.
3. `safe` is true only if every drain reports drained with 0 active, 0 unresolved writes and 0 active transports. Only then is `closePersistence()` called (bounded by `persistenceTimeoutMs`). It runs `assertExecutor` and then `close`, which releases the sentinel.
4. If not safe, `process.exitCode = 1` and **the sentinel is kept**.

### 9.4 Telemetry and logging (`telemetry.ts`, `observed-runtime.ts`, `observe-persistence.ts`)
- `event(kind, fields)` with kinds `request`, `attempt`, `accounting`, `readiness`, `recovery`, `shutdown`, `calendar` and `process` writes one JSON line ≤4,096 bytes. Fields:
  - IDs (`sessionId`, `turnId`, `attemptId`, `generationId`, `dispatchId`, …) are **pseudonymized** as `h:` plus the first 24 hex chars of sha256.
  - Enumerated fields go through allowlists; only known error codes appear.
  - Numbers are clamped.
  - `redactSecrets` is applied.
  - No message, tool or payload content is ever logged.
- Metric cells (`METRICS`): `request`, `admitted`, `rate_rejected`, `overload_rejected`, `dedup_hit`, `first_output`, `total_run`, `failure`, `interruption`, `checkpoint`, `write`, `finalization`, `reconciliation`, accounting known/pending/unknown, `shutdown`, `log_failure`, `read`, the `mongo_*` cells, `event_loop_delay`, `stream_header`, and others. Each cell is `{count, sumMs, maxMs}` plus latency buckets ≤10, ≤50, ≤250 and ≤1000 ms and >1000 ms.
- Stdout filter (`shouldWriteStdoutLog`): always `readiness`, `recovery` and `shutdown`; `request` and `attempt` only when `ok:false`; `process` lines with an error or rejected state or a milestone stage. `AURVIN_LOG_LEVEL=debug` writes everything. Writes are skipped when stdout needs a drain.
- `observedRuntime` wraps the runtime to record first output, finalization, failures and reconciliation, and to feed `readiness.providerFailure`/`providerSuccess`. `observePersistence` times writes and checkpoint puts.

### 9.5 Recovery helpers (`recovery.ts`)
- `handoffVerifiedStopped(owner, runtime, previousOwnerId, {oldProcessStopped, inFlightIoSettled, operatorAuthorized})` requires all three booleans to be true and the runtime to be quiescent. These booleans are an operator boundary and never HTTP input.
- `reconcilePage(runtime, sessions, userId, cursor, limit ≤50)` requires a runtime that is not accepting and is quiescent.

### 9.6 Local guard (`local-guard.ts`, `local-guard.ps1`; Windows only)
- `acquireLocalGuard(guardHash)` spawns `powershell.exe -NoProfile -NonInteractive -File src/operations/local-guard.ps1 -ParentPid <pid> -GuardHash <hash>`. The cwd must be `backend/`.
- The script opens the parent process handle and holds the named kernel mutex `Global\AurvinLocal-<hash>`. It then prints `READY {"machine":MachineGuid,"pid":…,"creation":StartTime UTC ticks}` and waits until the parent exits or stdin is closed.
- The guard returns `{machineHash, pid, creation, guardHash, installationHash = sha256(realpath(cwd)), assertHeld(), close()}`.
- Losing the guard is fatal by default (`process.exit(1)`).
- `inspectLocalProcess` runs the script with `-ExpectedCreation`, which prints `dead`, `live` or `reused`.

### 9.7 Accounting migration (`accounting-migration.ts`)
- `migrateAccountingPage(store, budgets, {limit ≤ maxPageSize, cursor (64-hex _id), apply?, maintenanceConfirmed?, owner?})` is dry-run by default.
- For `accounting` and `voice-accounting` metadata without `money`, it adds `money` with `source:'legacy-number'` (decimal from the legacy number) or `unavailable`.
- Apply requires admitted executor ownership, an idle local journal and **no active sessions**. Each write is a revision CAS.
- It returns `{scanned, eligible, converted, unchanged, invalid, conflicts, nextCursor}`. The CLI is `scripts/migrate-accounting.ts` (scripts agent).

---

## 10. Rebuild notes: invariants and gotchas

1. **Single executor per database.** The durable sentinel (`metadata._id = key('executor')`) has no TTL. A leftover sentinel is taken over at startup (watch reload), so **never run two live backends on one DB**. Every write path calls `assertExecutor`/`run(lease)`.
2. **Bind to `127.0.0.1` only**, and run with cwd = `backend/`. Fixed assets resolve to `src/instructions/system.md` and `../product_knowledge.md`; the PowerShell guard resolves from cwd too. `dist` does not contain the Markdown files.
3. **Diagnostic mode** applies when `MONGODB_URI` is blank or `PERSISTENCE_PROFILE ≠ native-mongodb`: the process boots, `/api/operations/live` works, readiness is 503 and chat is unavailable. Invalid configuration or assets fail startup.
4. **Identity is server-side.**
   - The principal comes from the authenticated cookie session.
   - Body keys `userId`, `user`, `openRouterUser`, `model`, `modelId` and `apiKey` are rejected.
   - OpenRouter `user` = `userId` on every dispatch, plus `session_id = 'aurvin-' + sha256([userId, sessionId])`.
   - Privacy settings are fixed: `provider.data_collection:'deny'`, `require_parameters:true`, `transforms:[]`, plugins disabled.
5. **Deterministic IDs** come from sha256 of JSON tuples (§3.2). Idempotency depends on them: retries of the same key must return identical IDs.
6. **Sequences** come from a per-session counter with idempotent reservations: 3 for a new turn (user, attempt, assistant) and 2 for a retry. Ordering uses sequence and messageId, never timestamps.
7. **Acceptance before inference (durable path):** user message, attempt and acceptance marker are all written under the lease, the lease is detached, and the turn is executed only when the SSE stream attaches. POST returns 202 without inference. An unattached accepted turn is not a background job: it stays `accepted` until a stream attaches, a cancel arrives or reconciliation interrupts it.
8. **Completion is confirmed only after** the checkpoint is sealed (sync durability), the assistant message is appended, accounting is saved, the manifest moves to `contextVersion+1`, the graph boundary is updated, the message completion is set and the attempt is CAS'd to terminal. Only then are `status` and `completed` emitted. `finalizing` means "will complete even if the client disconnects".
9. **Recovery never re-infers.** Graph hooks used in recovery throw. A sealed result is published; otherwise the attempt is interrupted, with partial text kept but excluded from context.
10. **Context is reference-only.** The manifest points at message records, and the checkpoint state holds no transcript. Asset hash changes invalidate manifests (rebase needed). The context budget is a conservative UTF-8 byte estimate, not real tokenization. Overflow is an explicit `CONTEXT_BUDGET_EXCEEDED` that requires a new chat, never silent trimming.
11. **Truncated (`finish_reason=length`) is a distinct terminal outcome**: `completed` frame with `outcome:'truncated'`, excluded from future context.
12. **Retry is limited** to the latest turn, after failed, cancelled or interrupted, with at most 3 attempts per turn. Provider auto-retry happens only on definitive pre-stream 429/503 responses with no generation ID or visible text, at most `retryMaxAttempts` (≤3) dispatches.
13. **SSE:** one attachment per user and session; a server-assigned sequence; terminal frames buffered until the run releases; frame and backpressure bounds; no replay cursor. Clients must poll status after disconnect.
14. **Memory-first is on by default** for text and live voice (§8.6). The durable path remains for calendar v1 and the handoff fallback. Re-implementers must decide whether to keep this path, since it relaxes acceptance durability; the source keeps both.
15. **Rate limiting is process-global**, despite the name `maxRequestsPerMinutePerUser` (20/min generation, 120/min control). There is no per-user bucket in `admission.ts`.
16. **Shutdown** releases the sentinel only when every drain is clean; otherwise it exits with code 1 and keeps the sentinel for operator recovery.
17. **Config writes** use revision CAS on a single document. An `uncertain` outcome latches writes closed until restart. New snapshots apply to new work only.
18. **Unclear from source:**
    - What (if anything) automatically calls `rebaseSession` after an asset edit.
    - The exact crash-loss semantics of memory-first turns before their background save confirms.
    - Whether `maxRequestsPerMinutePerUser` is intended to be per-user.

---

# Part 2 — Backend features


Scope: `backend/src/voice/**`, `backend/src/plugins/google-calendar/**`, `backend/src/auth/**`, `backend/src/admin-config/**`, `backend/src/administration/**`, `backend/src/benchmark/**`, `backend/src/scripts/**`, plus the contracts they use. Backend core is in Part 1 and the frontend in Part 3. Everything here comes from the source at commit `c283766` unless it is marked **unclear**. All HTTP paths have the global `api` prefix that `main.ts` sets with `app.setGlobalPrefix('api')`.

Cross-cutting facts:
- The backend binds `127.0.0.1` only (`main.ts`). The browser origin is `FRONTEND_ORIGIN`. HTTPS deployments are admitted only through a trusted same-host gateway. `trustedAdminHttpsIngress(req)` requires a loopback peer and `X-Forwarded-Proto: https`.
- `configurePrivateHttp` (owned by core) runs in front of every `/api/*` route except `OPTIONS`, the exact `/api/auth/*` routes, `GET /api/operations/live` and `GET /api/plugins/google-calendar/oauth/callback`. It does the following:
  - Rejects `Sec-Fetch-Site: cross-site` and any foreign `Origin`, and requires `Origin` on mutations.
  - Authenticates the `aurvin_wos_session` cookie and requires a full account (no pending password change).
  - Requires `super-admin` for `/api/admin*`.
  - Refreshes the cookie and binds the principal into AsyncLocalStorage.
- Every feature HTTP boundary sets `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, strips `ETag`, and returns closed error codes without implementation detail.

---

## 1. Voice

### 1.1 Modes and transports

| Mode | STT | TTS | Transport | Files |
|---|---|---|---|---|
| `dictation` | Deepgram **Nova-3** (`/v1/listen`) | none | Browser WebSocket at `/api/voice` (binary PCM frames + JSON control) | `session/dictation-flow.ts`, `transport/voice.gateway.ts`, `transport/voice-connection.ts`, `providers/nova-stt.ts` |
| `live` | Deepgram **Flux** `flux-general-en` (`/v2/listen`) | Deepgram Flux TTS (`/v2/speak`) | **LiveKit/WebRTC only.** The server-side media bridge joins the room as an agent participant. Control JSON travels over the reliable data topic. | `session/live-flow.ts`, `transport/livekit-*.ts`, `providers/flux-stt.ts`, `providers/flux-tts.ts` |

- The WebSocket gateway claims only `dictation` bindings: `sessions.claim(..., 'dictation')` in `voice.gateway.ts`. Live voice over WebSocket was removed in the "live-only cutover" (`docs/live-voice-webrtc/final_report.md`).
- `PROTOCOL_VERSION`: `VOICE_PROTOCOL_VERSION = 1` (`contracts/voice-wire.ts`). Locale is fixed to `'en-US'`.
- Composition lives in `app.service.ts`: `openVoice()` builds `DictationFlow` or `LiveFlow`, a `VoiceAccounting`, and an `AgentVoiceAdapter`. `openLiveBridge()` dynamically imports `transport/livekit-media.ts` and connects `LiveKitMediaBridge`.

### 1.2 Audio formats and fixed constants (`contracts/voice-wire.ts`)

| Constant | Value |
|---|---|
| `INPUT_AUDIO` | `{encoding:'pcm16', sampleRate:16000, channels:1, endian:'little', frameMs:80}` (2560 bytes per frame) |
| `OUTPUT_AUDIO` | `{encoding:'pcm16', sampleRate:24000, channels:1, endian:'little'}` |
| `MAX_VOICE_CONTROL_BYTES` | 131072 |
| `LIVEKIT_CONTROL_LIMITS` | maxPacketBytes 15360, maxMessageBytes 131072, maxChunkBytes 14336, maxChunksPerMessage 16, maxInflightReassemblies 2, reassemblyTimeoutMs 5000 |
| `LIVEKIT_CONTROL_TOPIC` | `'aurvin.voice.control'` |
| `LIVEKIT_ROOM_PREFIX` / `LIVEKIT_AGENT_PREFIX` | `'aurvin-live-'` / `'aurvin-agent:'` |
| `LIVEKIT_TOKEN_MAX_TTL_MS` / `LIVEKIT_TEARDOWN_TIMEOUT_MS` | 30000 / 2000 |
| `LIVE_WEBRTC_AUDIO` | browser publishes opus at 48 kHz. STT gets 16 kHz mono in 80 ms frames (1280 samples, 2560 bytes). TTS is 24 kHz mono, max chunk 200 ms (4800 samples, 9600 bytes). quietPeakThreshold 600, quietHangoverMs 5000, quietFrameWindowMs 20, quietPreRollFrames 4 |
| `DEFAULT_VOICE_LIMITS` | dictationMaxMs 300000, liveMaxMs 1200000, liveWarningMs 1080000, idleWarningMs 60000, idleExitAfterWarningMs 30000, finalizationMs 2000, reconnectMs 10000, connectMs 10000, inputQueueMs 1000, outputQueueMs 2000 |

`isVoiceLimits` requires every limit to be a positive uint32, with these cross-checks:
- `liveWarningMs < liveMaxMs`
- `finalizationMs <= dictationMaxMs`
- `inputQueueMs <= dictationMaxMs`
- `outputQueueMs <= liveMaxMs`

**WebSocket binary audio frame** (`contracts/voice-audio.ts`) has a 16-byte little-endian header:

| Byte(s) | Field |
|---|---|
| `[0]` | `0xAF` |
| `[1]` | version `1` |
| `[2]` | `kind` (1 = input, 2 = output) |
| `[3]` | `flags` (0, or 1 = end) |
| `[4..7]` | `sequence` (u32) |
| `[8..11]` | `offsetMs` (u32) |
| `[12..15]` | `pcmByteLength` (u32) |

Validation rules:
- PCM byte length must be even.
- Input (kind 1) is at most 2560 bytes. Output (kind 2) is at most 9600 bytes.
- An empty frame is allowed only when `flags` is 1.

### 1.3 Voice configuration

Runtime voice settings come from the **Manage Aurvin** config snapshot (section 5): `voice.enabledModes`, `limits`, `dictationWarningMs`, `quotas`, the `deepgram.*` settings, and the Deepgram credential. LiveKit is **bootstrap-only** and read from environment variables.

| Env var | Notes |
|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | All three must be set or all three blank; anything else throws `partial_livekit_config`. URL rules: `ws:`/`wss:`, no path, query or credentials. `ws:` is allowed only on a dev loopback host outside production. Key: 3–128 chars. Secret: 8–256 chars. (`platform/config/voice-config.ts`) |

Legacy environment names are **ignored at runtime** and listed in `LEGACY_MANAGEABLE_ENV_NAMES` (`platform/config/bootstrap-config.ts`); startup logs a names-only warning. They can be imported once with `import-config` (section 7):
- `DEEPGRAM_API_KEY`, `DEEPGRAM_API_BASE`, `DEEPGRAM_DICTATION_MODEL`, `DEEPGRAM_LIVE_MODEL`, `DEEPGRAM_TTS_MODEL`, `DEEPGRAM_DICTATION_ENDPOINTING_MS`, `DEEPGRAM_SPOKEN_PUNCTUATION`, `DEEPGRAM_KEYTERMS`, `DEEPGRAM_FLUX_EOT_THRESHOLD`, `DEEPGRAM_FLUX_EOT_TIMEOUT_MS`
- `DEEPGRAM_NOVA_RATE_PER_MIN_USD`, `DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD`, `DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD`
- `ENABLE_DICTATION_MODE`, `ENABLE_LIVE_VOICE_MODE`
- `VOICE_DICTATION_MAX_MS`, `VOICE_LIVE_MAX_MS`, `VOICE_LIVE_WARNING_MS`, `VOICE_IDLE_WARNING_MS`, `VOICE_IDLE_EXIT_AFTER_WARNING_MS`, `VOICE_FINALIZATION_MS`, `VOICE_RECONNECT_MS`, `VOICE_CONNECT_MS`, `VOICE_INPUT_QUEUE_MS`, `VOICE_OUTPUT_QUEUE_MS`
- `VOICE_IDENTITY_CONCURRENT`, `VOICE_GLOBAL_CONCURRENT`, `VOICE_IDENTITY_DAILY_MINUTES`, `VOICE_GLOBAL_DAILY_MINUTES`, `VOICE_DAILY_SPEND_USD`

Mode effectiveness (`effectiveVoiceModes`):
- `dictation = enabledModes.dictation && deepgramKey`.
- `live = enabledModes.live && deepgramKey && LiveKit configured`.
- `GET /voice/config` forces both modes to `false` when there is no Deepgram key.

### 1.4 REST routes (`voice/session/voice-session.controller.ts`, `@Controller('voice')`)

| Method + path | Request | Response | Notes |
|---|---|---|---|
| `GET /api/voice/config` | No query allowed | `PublicVoiceConfig {protocolVersion:1, enabledModes{dictation,live}, supportedLocales:['en-US'], limits, inputAudio, outputAudio}` | `Origin` is optional; if present it must equal `frontendOrigin`. |
| `POST /api/voice/sessions` (201) | `CreateVoiceSessionRequest {protocolVersion:1, mode, conversationId:string\|null, locale:'en-US', idempotencyKey (8..128 chars)}` exact keys | `CreateVoiceSessionResponse {protocolVersion:1, sessionId(UUID), conversationId, mode, connectionEpoch, websocketUrl:'/api/voice', livekit?, expiresAt, effectiveAudioSettings{input, output\|null}, limits}`. Adds `Set-Cookie: aurvin_voice_ticket=<43-char base64url>; HttpOnly; SameSite=Strict; Path=/api/voice; Max-Age=<s>[; Secure]` | `Origin` is required. `livekit` is present only for live mode: `{url, roomName, participantIdentity, participantToken(JWT)}`. Dictation has `output:null` and no `livekit`. |
| `DELETE /api/voice/sessions/:id` (204) | No query; `id` at most 128 chars | none | Owner check covers both userId and auth sessionId. The ticket cookie is deliberately **not** cleared. |

Errors use `VoiceHttpFilter` with body `{error:{code, message:'Voice is unavailable.', retryable}}`. `retryable` is true for 5xx and 429.

| Status | Codes |
|---|---|
| 403 | `INVALID_ORIGIN`, `VOICE_BINDING_MISMATCH` |
| 503 | `VOICE_DISABLED` |
| 429 | `VOICE_QUOTA_EXHAUSTED` |
| 409 | `CONFLICT_ACTIVE_TURN`, `VOICE_INVALID_STATE`, `STALE_CONNECTION_EPOCH` |
| 410 | `VOICE_SESSION_ENDED`, `VOICE_RECONNECT_TIMEOUT` |
| 400 | `INVALID_VOICE_REQUEST` |
| 503 | everything else (unknown errors become `VOICE_DELIVERY_UNKNOWN`) |

### 1.5 Session lifecycle (`voice/session/voice-session.service.ts`)

The registry is **in-process**: `Map sessionId -> VoiceBinding`. Ended entries remain as 10-second tombstones. At most 1024 entries are held; above that the service returns `VOICE_QUOTA_EXHAUSTED`.

**Create**:
1. Check origin and request shape, then require a full account and run `assertAccountCurrent`.
2. Apply idempotency keyed by `[userId, idempotencyKey]`:
   - A concurrent duplicate awaits the same promise.
   - A repeated POST reuses the existing entry. It must match mode and locale, and either conversationId matches; otherwise `VOICE_BINDING_MISMATCH`.
   - An ended entry returns `VOICE_SESSION_ENDED`.
   - An expired entry returns `VOICE_CONNECT_TIMEOUT` or, for a reconnecting entry, `VOICE_RECONNECT_TIMEOUT`.
   - A `reconnecting` entry with a consumed ticket increments `connectionEpoch` (max 0xffffffff), evicts the old LiveKit participant, and **re-issues**.
3. Check that the mode is enabled and capture the config snapshot.
4. If `conversationId` is non-null, the session must exist for this user; otherwise `VOICE_BINDING_MISMATCH`.
5. Run `admission(context)` (the usage service, §1.12).
6. Re-check capacity synchronously: `quotas.globalConcurrent` and `identityConcurrent`.
7. For live mode, acquire the execution reservation: `reservations.acquire({owner:{kind:'live', voiceSessionId}})`. Its failure `CONFLICT_ACTIVE_TURN` propagates.
8. Run `issue()`, then call `assertAccountCurrent` again.

**Issue**:
- Generate a fresh 32-byte base64url ticket and store only its sha256.
- `deadline = now + min(30000, limits.connectMs)`. A reconnecting entry never extends its earlier deadline.
- Live mode: `LiveKitAdmission.issue(...)`, then `openLiveBridge(entry, ticket)`.
- A timer ends the session at the deadline.

**Claim** (WebSocket upgrade) and **claimLive** (LiveKit participant):
- Checks:
  - The ticket cookie appears exactly once and matches `^[A-Za-z0-9_-]{43}$`.
  - The ticket hash matches an entry with the same userId **and** the same auth sessionId.
  - The mode matches, the deadline has not passed, and the state is `created` or `reconnecting`.
  - `assertPaidWork()` passes.
- The ticket is consumed **synchronously** and the state becomes `active`.

**Statuses**:
- `VoiceSessionStatus` in the wire contract: `created|connecting|active|reconnecting|ending|ended`.
- The service uses `created|active|reconnecting|ended`.

**Disconnect**:
- Dictation, or a non-recoverable failure, ends the session.
- Live mode goes to `reconnecting` with `deadline = now + reconnectMs`. Flow and bridge are cleaned up, `usage.disconnected` runs, and a timer ends the session. The client re-POSTs with the **same idempotencyKey** to get a new epoch and token.

**End order**: flow cleanup, then LiveKit bridge close, then `teardownRoom` (best-effort, 2 s), then reservation release, then admission release.

**Other entry points**:

| Entry point | Behavior |
|---|---|
| `stop(id, reason)` | For live mode with reason `duration`/`quota`, the session **pauses** (paid work stops, the room stays up, `session.ended{terminal:false}` is sent). Idle does nothing server-side. Otherwise it is terminal. |
| `stopUser(userId, authSessionId?)` | Ends that user's sessions. Used on logout and on deactivate. |
| `drain()` | Stops accepting, sends `shutdown` terminal to active live sessions, then ends all. |
| `bindConversation(id, conversationId)` | Live only. Rebinds the reservation the first time a fresh live conversation gets its session id. |

### 1.6 Dictation WebSocket (`/api/voice`)

**Gateway**: `@WebSocketGateway({path:'/api/voice', maxPayload:131072, perMessageDeflate:false})`.

**Upgrade admission** (`transport/authenticated-ws-adapter.ts`, `VoiceUpgradeAdmission.verify`) requires:
- URL exactly `/api/voice`.
- Exactly one `Origin` header, equal to `frontendOrigin`, and exactly one `Host` header.
- `Sec-Fetch-Site` not `cross-site`.
- Transport: either dev loopback (http loopback origin, loopback Host, loopback peer) or an `https:` origin plus trusted ingress.
- A valid WorkOS session cookie for a full account.

The upgrade response may include a refreshed session `Set-Cookie`. Rejection uses the `AuthFault` status or 503. Any post-upgrade binding failure closes with code **1008**.

**`VoiceConnection`** (`transport/voice-connection.ts`):

Inbound limits:
- Binary messages at most 2576 bytes; text at most 131072 bytes.
- Pending binary bytes at most `inputQueueMs*32 + 16*ceil(inputQueueMs/80)`.
- At most 64 pending messages.
- Exceeding either gives `AUDIO_BUFFER_OVERFLOW`.
- Messages are processed strictly in order on one promise chain.

Binary input rules:
- Kind 1 only. A non-final frame must be exactly 2560 bytes.
- `sequence` must equal the next expected value; lower values are ignored as replays. `offsetMs` must equal `floor(inputSamples/16)`. Otherwise `VOICE_SEQUENCE_ERROR`.
- `flags=1` ends input.

Control message rules:
- Parsed with `parseVoiceControl(json,'client',mode)`. `sessionId` and `connectionEpoch` must match.
- `sequence` must be `rx+1`; lower values are ignored. `eventId` must be unique within a 4096 window.
- The first message must be `session.start`. It opens the flow and replies with `session.ready`.
- `session.end` finishes `completed`.

Outbound rules:
- Server envelope `sequence` (`tx`) starts at 0. Each event is self-validated with `parseVoiceControl(...,'server')` before sending.
- Socket `bufferedAmount` budget is `outputQueueMs*24*18 + 131072`.

Timers and failures:
- Connect timer: `connectMs` until `session.ready`, else `VOICE_CONNECT_TIMEOUT`.
- `fail(code)` sends `session.error{recovery:'return_to_chat', recoverable:false, terminal:true}` and ends the session.
- Codes outside the allowed list are reported as `VOICE_DELIVERY_UNKNOWN`. The allowed list is: `VOICE_DISABLED`, `INVALID_AUDIO_FRAME`, `INVALID_VOICE_CONTROL`, `VOICE_BINDING_MISMATCH`, `STALE_CONNECTION_EPOCH`, `VOICE_SEQUENCE_ERROR`, `VOICE_INVALID_STATE`, `AUDIO_BUFFER_OVERFLOW`, `VOICE_CONNECT_TIMEOUT`.

**`DictationFlow`**:
- States: `recording`, then `finalizing`, then `closed`.
- `dictation.stop` starts the provider `Finalize`. It does **not** block a later `dictation.cancel`.
- A timer of `min(2000, finalizationMs)` forces completion with a `DICTATION_FINALIZATION_TIMEOUT` warning (`recovery:'retry_dictation'`).
- Final segments are deduplicated by `segmentId`, up to 4096.
- Completion emits `dictation.complete{finalization:'complete'|'timeout'|'empty', unfinalizedTail}` and then `session.ended{reason:'completed'}`.
- Provider failure emits `session.error STT_UNAVAILABLE {recovery:'retry_dictation', recoverable:true, terminal:true}`.
- Dictation produces text in the client composer only. It does not submit a chat turn.

### 1.7 Live voice over LiveKit

**Admission** (`voice/session/livekit-admission.ts`, `LiveKitAdmission.issue`):

| Item | Value |
|---|---|
| Room | `aurvin-live-<sessionId>` |
| Browser identity | `<userId>:<sessionId>:<connectionEpoch>` |
| Agent identity | `aurvin-agent:<sessionId>` |
| TTL | `ceil(clamp(connectMs, 1000, 30000)/1000)` seconds |
| Browser grant | `roomCreate:false, roomJoin, room, canPublish, canSubscribe, canPublishData, canPublishSources:[MICROPHONE], roomAdmin/roomList/roomRecord:false` |
| Agent grant | `roomCreate:true, roomJoin, room, canPublish, canSubscribe, canPublishData`, admin/list/record false |
| Teardown | `RoomServiceClient.deleteRoom` and `removeParticipant` (epoch eviction), best-effort and bounded to 10 s or less |

`assertLiveKitParticipantBinding`:
- A wrong user, session or room gives `VOICE_BINDING_MISMATCH`.
- A wrong epoch gives `STALE_CONNECTION_EPOCH`.

**Media bridge** (`transport/livekit-media.ts`, `LiveKitMediaBridge`):

Join and publish:
- Connects with `room.connect(url, agentToken, {autoSubscribe:false, dynacast:false, dataStream:{maxPayloadByteLength:131072}})`, bounded by `connectMs`.
- Publishes local track `aurvin-assistant` from `AudioSource(24000,1,outputQueueMs)`.

Subscribing to the microphone:
- Subscribes only to the exact browser participant identity and only an **audio microphone** publication.
- Reads it through `AudioStream(track,{sampleRate:16000,numChannels:1,frameSizeMs:80})`.
- When that participant disconnects the session is treated as lost (reconnecting).

Control channel:
- `publishData(bytes,{reliable:true, topic:'aurvin.voice.control', destination_identities:[browserIdentity]})`.
- Payloads larger than 15360 bytes are split into `control.chunk` packets (`encodeVoiceControlPackets`). Packet fields: `protocolVersion, type:'control.chunk', sessionId, connectionEpoch, sequence, eventId, turnId?/responseId?, chunkIndex, chunkCount(2..16), totalBytes, payload`.
- Inbound packets go through `VoiceControlReassembler`: at most 2 in-flight messages, a 5 s timeout, strict chunk order, and binding/epoch checks.

Quiet gate (`LiveKitInput`):
- If the per-20 ms peak stays below 600 for 5000 ms, the gate calls `flow.suspendInput('quiet')`. This sends Flux `Finalize`, stops uploading, and emits `voice.state input:'suspended'`.
- When speech is detected again the gate replays up to 4 pre-roll frames and resumes.
- The STT forward queue holds at most `inputQueueMs/80` frames.

Output (`LiveKitOutput`):
- Copies PCM into `AudioFrame`s and tracks a generated-sample cursor.
- Emits `audio.watermark` (generated-sample ceiling) per response.
- Fences invalidated responses.

Pause and resume:
- On the codes below, `pause(code)` stops providers but keeps the room: `VOICE_QUOTA_EXHAUSTED`, `VOICE_DURATION_LIMIT`, `VOICE_DISABLED`, `STT_UNAVAILABLE`, `TTS_UNAVAILABLE`, `VOICE_PROVIDER_RATE_LIMITED`, `VOICE_AGENT_FAILED`, `VOICE_DELIVERY_UNKNOWN`, `VOICE_CONNECT_TIMEOUT`, `AUDIO_BUFFER_OVERFLOW`.
- It sends `session.error{recovery:'resume_call'|'none', terminal:false}`.
- A later client `input.unmute` re-opens paid work through `assertPaidWork`.

### 1.8 Wire protocol (`contracts/voice-wire.ts`)

The **envelope** on every control event is `{protocolVersion:1, sessionId(1..128), connectionEpoch(u32), eventId(1..128), sequence(u32)}`. Objects are exact-keyed: unknown or missing keys are rejected.

Shared reference type: `VoiceResponseRef = {turnId, responseId}`.

**Client to server** (`VoiceClientPayload`):

| type | Fields | Modes |
|---|---|---|
| `session.start` | `mode` (must equal session mode), `audioSettings` (= INPUT_AUDIO) | both |
| `dictation.stop`, `dictation.cancel` | none | dictation |
| `input.mute`, `input.unmute`, `input.suspend` | none | live |
| `session.end` | none | both |
| `response.interrupt` | `turnId, responseId, playbackPositionMs(u32), playedSamples(safe uint), proof?:'proven'\|'unproven'`. Requires `playbackPositionMs == floor(playedSamples/24)`. | live |
| `playback.progress` | `turnId, responseId, playedMs, playedSamples, proof?` | live |
| `calendar.confirm` | `proposalId, proposalRevision(>0), answer: {kind:'accept'}\|{kind:'reject'}\|{kind:'select', calendarId (1..1024, not 'primary', no control chars)}` | live |

**Server to client** (`VoiceServerPayload`):

| type | Fields | Modes |
|---|---|---|
| `session.ready` | `limits, effectiveAudioSettings{input, output\|null}` | both (output null for dictation) |
| `session.ended` | `reason: completed\|cancelled\|disconnected\|duration\|idle\|quota\|error\|shutdown`, `terminal` | both |
| `conversation.bound` | `conversationId`, optional `turnId` + `save:{state:pending\|saving\|saved\|failed\|unknown\|fenced, epoch, version, durableVersion}` (both or neither) | live |
| `dictation.partial` / `dictation.final` | `segmentId, text (at most 32000)` | dictation |
| `dictation.complete` | `finalization: complete\|timeout\|empty`, `unfinalizedTail` | dictation |
| `voice.state` | `input: listening\|suspended\|muted`, `agent: idle\|thinking\|speaking`, `connection: connected\|reconnecting` | live |
| `audio.start` | `turnId, responseId, sampleRate:24000, firstAudioSequence, firstAudioSample?` (multiple of 24) | live |
| `audio.watermark` | `turnId, responseId, firstAudioSample(%24==0), queuedSamples, lastAudioSample (= first+queued), final` | live |
| `audio.end` / `response.cancelled` | `turnId, responseId, lastAudioSequence:u32\|null`, optional `firstAudioSample, lastAudioSample, totalAudioSamples` (consistent) | live |
| `session.warning` | `code, recovery, recoverable` | both |
| `session.error` | `code, recovery, recoverable, terminal` | both |
| `canvas.artifact` | `turnId, responseId, ordinal, kind, subType, title, rawSource`. `sessionId` and `eventId` must match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. | live |
| `calendar.frame` | `turnId, attemptId, responseId, event: CalendarPresentationEvent` (§3.7). Whole event at most 16384 UTF-8 bytes. | live |

- `VoiceRecovery` values: `none | retry_dictation | resume_gesture | repeat_turn | return_to_chat | resume_call`.
- `VOICE_ERROR_CODES`: `VOICE_DISABLED`, `INVALID_VOICE_REQUEST`, `INVALID_VOICE_CONTROL`, `INVALID_AUDIO_FRAME`, `INVALID_ORIGIN`, `VOICE_SESSION_NOT_FOUND`, `VOICE_SESSION_ENDED`, `VOICE_BINDING_MISMATCH`, `STALE_CONNECTION_EPOCH`, `VOICE_SEQUENCE_ERROR`, `VOICE_INVALID_STATE`, `CONFLICT_ACTIVE_TURN`, `AUDIO_BUFFER_OVERFLOW`, `VOICE_QUOTA_EXHAUSTED`, `VOICE_DURATION_LIMIT`, `VOICE_IDLE_TIMEOUT`, `DICTATION_FINALIZATION_TIMEOUT`, `VOICE_RECONNECT_TIMEOUT`, `VOICE_CONNECT_TIMEOUT`, `STT_UNAVAILABLE`, `TTS_UNAVAILABLE`, `VOICE_PROVIDER_RATE_LIMITED`, `VOICE_AGENT_FAILED`, `VOICE_DELIVERY_UNKNOWN`, `MEDIA_GATE_UNAVAILABLE`.
- Helper `clampPlayedSamplesToWatermark()` bounds the played cursor to the watermark.

### 1.9 Deepgram providers (`voice/providers/*`)

**Connection setup** (`provider-link.ts`):
- Every connection uses `ProviderLink` over `ws` with header `Authorization: Token <deepgramKey>`.
- The base is `wss://api.deepgram.com` (region `us`) or `wss://api.eu.deepgram.com` (region `eu`).
- An HTTP 429 on the upgrade gives `VOICE_PROVIDER_RATE_LIMITED`. Any other failure gives `STT_UNAVAILABLE` or `TTS_UNAVAILABLE`.
- A Deepgram `Error` message fails the link. A `KeepAlive` heartbeat is sent periodically.
- Every URL includes a `tag` equal to the user's hashed tag `aurvin-user-<sha256("aurvin:deepgram:user:v1:"+userId)>`. This gives provider-side attribution without exposing raw user IDs.

| Adapter | URL | Query parameters | Commands |
|---|---|---|---|
| `NovaSttAdapter` | `/v1/listen` | `model=nova-3, tag, language=en-US, encoding=linear16, sample_rate=16000, channels=1, interim_results=true, punctuate=true, smart_format=true, endpointing=<300..500>`, repeated `keyterm=` (at most 50, each at most 64 chars), `dictation=true` if spokenPunctuation | `Finalize`, then settle (2 s deadline) |
| `FluxSttAdapter` | `/v2/listen` | `model=flux-general-en, tag, encoding=linear16, sample_rate=16000, eot_threshold (0.5..1, default 0.8), eot_timeout_ms (default 5000)` | `CloseStream`. Maps `TurnInfo` `StartOfTurn` to `start-of-turn` and `EndOfTurn` to `end-of-turn`. `EagerEndOfTurn` and `TurnResumed` are ignored. |
| `FluxTtsAdapter` | `/v2/speak` | `model=flux-haley-en\|flux-alexis-en\|flux-priya-en, tag, encoding=linear16, sample_rate=24000` | `Speak{text}` (chunks sent verbatim, no added spaces), `Flush`, `Interrupt{playback_offset:{type:'time_ms',value}}`, `Close`. Handles `SpeechStarted`, `SpeechMetadata`, `SpeechInterrupted`. Completion deadline 30 s after Flush. Interrupt deadline `min(2000, finalizationMs)`. |

Reconnect policy (`connectWithBackoff`): at most 5 attempts, backoff `min(2000, 250*2^n)*(1+rand)`, overall cap `min(10000, deadline)`. Only recoverable `STT_UNAVAILABLE`, `TTS_UNAVAILABLE`, `VOICE_CONNECT_TIMEOUT` and `VOICE_PROVIDER_RATE_LIMITED` are retried.

### 1.10 LiveFlow: turns, barge-in and interrupt (`voice/session/live-flow.ts`)

**Turn dispatch**:
- Only a Flux `EndOfTurn` with non-empty text dispatches a turn. Turn IDs are deduplicated per `providerTurnId`, up to 4096.
- At most 2 turns may be pending; more gives `CONFLICT_ACTIVE_TURN`.
- Turns run serially on `finalChain` and call `hooks.finalized(context, {providerSocketEpoch: connectionEpoch, providerTurnId, text}, signal)`.

**Barge-in**: a Flux `StartOfTurn` (when not muted or suspended):
- aborts the current "thinking" turn;
- interrupts the current response at `floor(played/24)` ms.

**Interrupt sequence**:
1. Mark the response invalid.
2. Call `sink.invalidate`. This sends `response.cancelled` and drops queued audio.
3. Set agent to `idle`.
4. In parallel, run `hooks.playback` (persist the played position, unless the proof is `unproven`) and `hooks.interrupt` (calls `runtime.cancelLiveTurn` and aborts generation).
5. Send Flux TTS `Interrupt` at that ms offset.
6. If no audio was sent, or the offset regressed, reset the TTS socket instead.

**Playback reporting**:
- `playback.progress` with `proof:'unproven'` only guides pacing and is never durable evidence.
- `playedSamples` must not regress and must stay within `[wireBase, wireBase+sent]`.

**Mute, suspend and unmute**:
- `input.mute` closes the STT socket.
- `input.unmute` opens a new Flux STT socket, or resumes from suspension.
- `input.suspend` is the client-side equivalent of the quiet gate.
- After a quiet suspension, STT may be renewed **once** without new admitted media. A second failure pauses the call for manual recovery; it does not retry in a loop.

**Response lifecycle**:
- `prepareResponse` registers the response and captures `providerBase` and `wireBase`.
- `speak`/`flush` forward to TTS.
- `audio.start` is emitted on the first audio.
- `audio.end` is emitted only after the browser ACKs playback up to `wireBase+sent`. Then the agent returns to `idle`.

**Calendar confirm**: `calendar.confirm` is rejected with a `CONFLICT_ACTIVE_TURN` warning while a turn is pending or thinking. Otherwise it runs `hooks.calendarControl` (§3.8).

### 1.11 Agent bridge (`voice/agent/agent-voice-adapter.ts`)

**Turn idempotency**:
- Key: `voiceRequestKey = key('voice-input', voiceSessionId, String(providerSocketEpoch), providerTurnId)`.
- The same key with different text gives `VOICE_BINDING_MISMATCH`.
- At most 4096 tracked keys. One accepting turn at a time; more gives `CONFLICT_ACTIVE_TURN`.

**Conversation binding**:
- `sessionIdFor(userId, conversationId, requestKey)` derives the chat session.
- On first use the voice session is rebound via `bindConversation`.
- `findLiveSubmission` detects replays. A replay only reconciles; it never speaks.

**Submit and execute**:
1. `runtime.submitLiveTurn({identity, sessionId, content:text, idempotencyKey, reservation, freshConversation, voice:{voiceSessionId, socketEpoch, providerTurnId}, calendarReplyTo?, configSnapshot?})`.
2. Emit `conversation.bound{conversationId, turnId?, save?}`.
3. Only when status is `accepted`, call `runtime.executeTurn({..., emitCalendar, live:{reservation, start, delta, artifact, finish, modelStarted, modelOutput, settle}})`.

**Response ID**: `key('voice-response', userId, sessionId, attemptId)`.

**Failure mapping**:
- A delivery with status `unknown` or `failed` gives `VOICE_DELIVERY_UNKNOWN`.
- An empty generation gives `VOICE_AGENT_FAILED`.
- A pre-audio interrupt emits `response.cancelled{lastAudioSequence:null}` immediately.

### 1.12 Speech filter: Canvas and markup removed from TTS (`voice/agent/speech-prose.ts`)

`SpeechProse(maximum=min(32000, maxInputChars), onArtifact)` is constructed by the chat runtime only for live turns (`chat-runtime/durable-chat-runtime.ts`, `memory-text.ts`). It is an incremental filter over model deltas:
- Removes hidden tags such as `<think>…</think>` (any tag except `aurvin-canvas`).
- Removes code fences, standalone JSON objects or arrays, markdown tables and anything containing `{}|<>`.
- Strips markdown emphasis, headers, list bullets and link syntax (keeping link text), and decodes basic entities.
- Speaks only units ending in sentence punctuation or a newline, or a fast-released plain clause of 24 to 65 chars. Partial openers are held back.
- Exceeding `maximum` throws `STORAGE_BUDGET_EXCEEDED`.

**Visual suffix rule**: once a recognized visual block appears, **all later prose is silent**. Recognized blocks:

| Source | Classified as |
|---|---|
| `<aurvin-canvas title=… type=…>…</aurvin-canvas>` (header at most 512 chars or 1024 bytes; nested wrapper rejected) | type `mermaid`/`diagram`/`flowchart` gives mermaid. Chart words give chart. `svg` gives svg. Otherwise the body is sniffed. |
| Fences ` ``` ` / `~~~` with info token `mermaid, mmd` | mermaid |
| Info token `chart, graph, plot, scatter, xy, xy-plot, line-graph, bar-chart, line-chart, pie-chart, area-chart` | chart |
| Info token `svg` | svg |
| Info token `canvas` | sniffed |
| Info token `json`, or no token, when the body is a chart JSON or a mermaid header | chart / mermaid |

- At most `maxArtifactsPerResponse = 3` candidates.
- Title comes from the `title=` attribute, a trailing plain title, mermaid front-matter or `title`, JSON `title`, SVG `<title>`/`aria-label`, or else defaults to the subType.
- Mermaid subTypes: Flowchart, Pie Chart, Coordinate Graph, Timeline Chart, Sequence Diagram, State Diagram, Class Diagram, ER Diagram, Mindmap.
- Chart subTypes: Bar Chart, Line Graph, Area Graph, Pie Chart, X-Y Point Plot, Coordinate Graph.
- SVG subType: `SVG Visual`.
- SVG must start with `<svg` and end with `</svg>` or `/>`.

### 1.13 Voice delivery accounting (`voice/agent/voice-delivery.ts`, `contracts/voice.ts`)

`VoiceDeliveryRecord` (strict zod) is stored in `metadata` with `_id = key('voice-delivery', userId, sessionId, attemptId)` and `kind:'voice-delivery'`.

| Field group | Fields |
|---|---|
| Identifiers | `schemaVersion:1, kind:'voice-delivery', userId, sessionId, voiceSessionId, turnId, attemptId, responseId, eventId, sequence, speechId\|null, providerSocketId` |
| Status | `status: pending\|completed\|interrupted\|cancelled\|failed\|unknown` |
| Audio | `audioDurationMs\|null, audioPlayedMs\|null, playedSamples\|null, audioSamples?` |
| Text | `textGenerated, textSpoken\|null, textRemaining\|null` |
| Canvas | `canvasArtifacts?` |
| Timestamps | `createdAt, updatedAt` |

Invariants:
- `audioPlayedMs <= audioDurationMs`.
- `textSpoken` is a prefix of `textGenerated`.
- `textSpoken + textRemaining == textGenerated`.
- Every artifact's `responseId` equals the delivery `responseId`.

Behavior:
- Each update writes `sequence+1` with a new `eventId`. Writes are CAS against the old sequence (`DeliveryWrite(next, expectedSequence)`).
- Speak is dispatched **immediately**. `textGenerated` journal writes are coalesced into 100 ms or 512-character batches.
- Settlement waits for proof within `lifetime {activeMs = min(totalRunTimeoutMs ?? 180000, liveMaxMs), stallMs: 30000}`, or `invalidAt + finalizationMs` after invalidation.

Settlement outcomes:

| Outcome | Condition |
|---|---|
| `completed` | Synthesized, all generated text was sent, and played samples equal the expected samples. |
| `interrupted` | Provider `SpeechInterrupted` evidence reconciles (`textSpoken`/`textRemaining`/`audioPlayedMs`). |
| `cancelled` | Invalidated before any text was sent. |
| `failed` | Generated text but nothing sent, or synthesized with 0 samples. |
| `unknown` | Anything else. |

### 1.14 Usage, quotas, rates and provider accounting

**`VoiceUsageService`** (`voice/usage/voice-usage.service.ts`) is **process-local and in-memory**. Daily windows use the UTC date and reset on restart.

`admission()` checks, in order:
1. Accepting and mode enabled, with a Deepgram key.
2. Admissions per rolling 60 s are below `budgets.maxRequestsPerMinutePerUser`. **Gotcha:** the counter is one process-wide list, not per user.
3. `globalConcurrent` and `identityConcurrent`.
4. Daily minutes (`identityDailyMinutes`, `globalDailyMinutes` multiplied by 60000) and `dailySpendUsd`, if set.

Any failure gives `VOICE_QUOTA_EXHAUSTED`.

Timers:
- **Duration** (`armDuration`): a warning at `liveWarningMs` (live) or `dictationWarningMs` (dictation), sent as `session.warning VOICE_DURATION_LIMIT, recovery:none`. A hard stop at `min(modeCap, remaining daily minutes)` is reported as `duration` or `quota`.
- **Idle** (live only, armed when the agent is not busy): a warning at `idleWarningMs` (`VOICE_IDLE_TIMEOUT`). The backend does **not** consume `idleExitAfterWarningMs`; it is only passed to the client in `limits`. The exit after the warning is presumably client-driven (**unclear**).

Spend estimation uses `deepgram.rates`: Nova or Flux STT dollars per minute times audioMs, plus TTS dollars per 1k characters. It is labelled an estimate, never an invoice.

**`VoiceAccounting`** (`voice/usage/voice-accounting.ts`) writes `VoiceAccountingRecord` documents (`contracts/voice-accounting.ts`) to `metadata` via `putVoiceAccounting`:

| Field group | Fields |
|---|---|
| Identity | `kind:'voice-accounting', provider:'deepgram', userId, sessionId (= voiceSessionId), conversationId, usageId, providerSocketId, userTag, model, turnId/responseId/speechId` |
| Provider evidence | `providerRequestId, modelVersion` |
| Status | `status: pending\|closed\|completed\|interrupted\|cancelled\|failed` |
| Usage and cost | `observedAudioMs, audioMs, billableCharacters, estimatedCostUsd, actualCostUsd:null, money?, timing?` |
| Timestamps | `startedAt, endedAt` |

Rules:
- A socket-level row has `usageId = providerSocketId` and is written **before** the socket opens (awaited).
- A per-response TTS row has `usageId = key('voice-speech', socketId, turnId, responseId)` and is pipelined so it does not block Speak.
- A failed accounting write marks voice cleanup uncertain. `drainVoice` then throws `PERSISTENCE_ERROR`.

---

## 2. Canvas artifacts (backend)

| Aspect | Specification |
|---|---|
| Contract | `contracts/voice-wire.ts` (`CANVAS_ARTIFACT_LIMITS`, `isCanvasArtifactSource`/`Projection`/`ProjectionList`). zod wrappers are in `contracts/canvas-artifact.ts` (`canvasArtifactProjectionSchema`, `canvasArtifactsSchema`). |
| Kinds | `'mermaid' \| 'chart' \| 'svg' \| 'calendar'`. `calendar` is accepted by the guards but **no backend producer was found** (reserved). |
| Source shape | `{ordinal (0..2), kind, subType, title, rawSource}` |
| Projection shape | Source plus `responseId` (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`) |
| Limits | rawSource at most 8192 chars and 16384 bytes, trimmed, no control chars except tab/LF/CR, no lone surrogates. title at most 120 chars and 480 bytes. subType at most 48 chars and 192 bytes. At most 3 per response, ordinals strictly increasing, one responseId. Total source at most 16384 chars and 24576 bytes. JSON projection at most 32768 bytes. `messageReserveBytes` 33792. `headerMaxChars` 512 / `headerMaxBytes` 1024. |
| Extraction | Live voice only: `SpeechProse` (§1.12) calls `onArtifact`. The runtime appends `{...source, responseId}` if the list stays valid, then `live.artifact()` runs `VoiceDelivery.artifact()` (CAS journal). Text chat does **not** extract artifacts on the backend; the frontend renders fences from text. |
| Event | After a durable journal write, `AgentVoiceAdapter` emits `{type:'canvas.artifact', turnId, ...projection}` **once per ordinal** to the live control channel. A conflicting duplicate ordinal is rejected. |
| Persistence | `MessageRecord.canvasArtifacts` (`contracts/message.ts`) is allowed only when `role:'assistant'`, `mode:'live'`, `visibility:'internal'`, `attemptId` is non-null, and `voiceSessionId` is valid (`persistence/messages.ts` enforces the same rule). Finalization and reconciliation copy journal artifacts onto the message (`chat-runtime/finalization.ts`, `reconciliation.ts`). The API projection exposes `canvasArtifacts` (`contracts/api.ts`). |

---

## 3. Google Calendar plugin (`plugins/google-calendar/*`)

### 3.1 Bootstrap environment variables (`platform/config/calendar-config.ts`, names only)

`AURVIN_GOOGLE_CALENDAR_CLIENT_ID`, `AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET`, `AURVIN_GOOGLE_CALENDAR_REDIRECT_URI`, `AURVIN_GOOGLE_CALENDAR_TARGET_ID` (deprecated legacy target), `AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID`, `AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED` (true/false), `AURVIN_GOOGLE_CALENDAR_CONTENT_PERMISSION` (`volatile` (default) or `retained`), `AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED`, `AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT` (ISO with offset), `AURVIN_GOOGLE_CALENDAR_TIME_ZONE` (IANA, default `Etc/UTC`). Token encryption uses `AURVIN_CONFIG_ENCRYPTION_KEY` (canonical base64 of exactly 32 bytes).

Constraints:
- `FRONTEND_ORIGIN` must be http `localhost` or `127.0.0.1`. The backend origin is `http://<same host>:<PORT>`.
- The redirect URI must be **loopback http** and must have the frontend's or backend's origin, with the same hostname (`loopbackRedirectSchema`, `options.ts`).
- `realDataPolicyApproved` requires all of: approved, a policy id, minimal-evidence allowed, and a deadline.
- If no calendar env is set and the frontend is a local http origin, the routes still mount; OAuth then returns `NOT_READY`. If the frontend is not local, every `/api/plugins/google-calendar*` route returns 503 `NOT_READY` (`main.ts`).

### 3.2 HTTP routes (`controller.ts`, boundary `controller-http.ts`)

The pre-controller boundary (`configureGoogleCalendarHttp`) applies to all plugin paths:
- Exactly one `Host` header, equal to the backend host. The peer must be **loopback**.
- `OPTIONS` preflight allows only the frontend origin, headers `Content-Type, X-Aurvin-Calendar-CSRF`, and methods `GET, PATCH, POST`.
- A query string is allowed only on `GET calendars`.
- `GET status` allows no `Origin` unless `Sec-Fetch-Site` is cross-site. `GET calendars` requires the frontend origin or same-origin fetch. Everything else requires `Origin == frontendOrigin`.
- Rate limit: 60 requests per rolling 60 s, else 429 `RATE_LIMITED` with `Retry-After: 60`.
- **POST/PATCH require header `X-Aurvin-Calendar-CSRF: 1`** and a JSON content type (utf-8). Body at most 16 KiB, read within 5 s.

| Method + path | Body / query | Response |
|---|---|---|
| `GET /api/plugins/google-calendar/status` | none | `CalendarStatusV2Response` (below) |
| `PATCH …/settings` | `{enabled?: boolean, defaultSetting?: {calendarId: canonicalId\|null, expectedRevision, expectedConnectionRevision}}` (at least one) | status v2 |
| `GET …/calendars?pageToken=` | `pageToken` only (1..2048), no duplicate keys, raw query at most 8192 bytes | `{protocolVersion:2, page: CalendarListCalendarsResult}` |
| `POST …/calendars/refresh` (200) | `{expectedConnectionRevision}` | same as calendars |
| `POST …/oauth/start` (200) | `{}` | `{authorizationUrl}` (must be `https://accounts.google.com/o/oauth2/v2/auth`) plus `Set-Cookie: aurvin_gcal_oauth=<opaque>; Path=/api/plugins/google-calendar/oauth; HttpOnly; SameSite=Lax; Max-Age=600` |
| `GET …/oauth/callback` | Google redirect (no auth) | Static HTML with CSP `default-src 'none'; script-src 'sha256-…'; connect-src 'self'`. Its script POSTs `rawQuery` to `oauth/complete` with the CSRF header, then `location.replace('/?plugin=google-calendar&oauth=<outcome>')`. |
| `POST …/oauth/complete` (200) | `{rawQuery (at most 8192)}` | `{outcome:'connected'\|'fixture'\|'cancelled'\|'failed'}` and clears the OAuth cookie |
| `POST …/disconnect` (200) | `{mode:'local'}` or `{mode:'revoke-google-grant', acknowledgeProjectWideRevocation:true}` | `{disconnected:true, remoteRevocation:'not-requested'\|'confirmed'\|'failed'\|'unknown'}` |

`CalendarStatusV2Response` fields:
- `protocolVersion:2`
- `state`: `disabled | setup-required | connected | reconnect-required | degraded`
- `enabled`
- `accountEmail`
- `processingDisclosure`: `{policyId, processors:'Google, OpenRouter and the configured model provider', dataCollection:'deny'}`, or null
- `connectionRevision`
- `defaultSetting`: `{defaultCalendarId, defaultSettingRevision}`
- `primaryCalendarId`
- `discovery`: `{discoveryRevision, fetchedAt, expiresAt, complete, truncated, stale}`
- `missingScopes` (empty when `connected`)

`fixture` evidence is always reported as `degraded`. State derivation is in `options.ts` (`publicStatusV2`).

### 3.3 OAuth flow (`oauth.ts`, `oauth-client.ts`, `oauth-identity.ts`)

Endpoints:

| Purpose | URL |
|---|---|
| auth | `https://accounts.google.com/o/oauth2/v2/auth` |
| token | `https://oauth2.googleapis.com/token` |
| revoke | `https://oauth2.googleapis.com/revoke` |
| discovery | `https://accounts.google.com/.well-known/openid-configuration` |
| JWKS | `https://www.googleapis.com/oauth2/v3/certs` |

Scopes (`CALENDAR_SCOPES`): `openid`, `email`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.freebusy`. Never grant `calendar` or `calendar.readonly` (both forbidden). The v1 scope `calendar.events.owned` is legacy and becomes reconnect-required.

**Start**:
1. `beginConsent`, then capture a setup snapshot.
2. Generate random 32-byte base64url values for `state`, `browser`, `nonce` and the PKCE `verifier`.
3. Persist an `oauthStateSchema` record (`kind:'calendar-oauth-state'`) holding only the hashes of state, browser and nonce, plus the encrypted verifier (`sealVerifier`). It expires in 600 s (`CALENDAR_LIMITS.oauthStateMs`).
4. Build the auth URL with `response_type=code, access_type=offline, prompt=consent, include_granted_scopes=true, state, nonce, code_challenge (S256)`.
5. The **pending setup is held in memory**: one flow per process, bound to the auth `sessionId`.

**Callback/complete**:
- Query keys are limited to an allow-list (`state, code, error, error_description, error_uri, scope, authuser, prompt, hd, iss`) with no duplicates. `iss` must be Google. Exactly one of `code` or `error` must be present.
- Checks: a single cookie value, the pending flow matches state, auth session and current snapshot, then the stored state is consumed atomically (hashes match, not expired).
- `error=access_denied` gives `cancelled`; other errors give `failed`.
- Otherwise: exchange the code (20 s bound). Every scope must be present; otherwise `OAuthScopeRejected` records a partial-grant diagnostic and returns `failed`.
- Verify the ID token: JWKS signature, issuer, audience = clientId, nonce hash, clock skew 60 s.
- Then `installGrant` (fenced; a changed Google subject gives `failed`) and return `connected`, or `fixture` when evidence is `fixture`.

**Token storage**:
- Tokens are AES-256-GCM sealed (`platform/crypto/calendar-secret-cipher.ts`) as `{version:1, iv, tag, ciphertext}`.
- The AAD is `{version:1, userId, provider:'google-calendar', connectionId, credentialVersion, googleSubjectId, tokenKind:'access'|'refresh'}`.
- Connections are stored in the `integration_connections` collection. OAuth state and proposals and operations are stored in `metadata`.
- Refresh is single-flight per connection, and a rotated refresh token is persisted (`connection.ts`, `withAccessToken`).

### 3.4 Discovery and availability

**Discovery** (`calendar-discovery-api.ts`, `discovery.ts`):
- Calls `GET /calendar/v3/users/me/calendarList` (paged).
- Stores a bounded snapshot: at most 100 entries, 20 per page, 2 pages in-turn, 10 out-of-turn, at most 262144 bytes, fresh for 300 s.
- Each entry has `calendarId` (never the literal `primary`), `label`, `primary`, `accessRole`, `privateAccess`, `timeZone`, `selected`, `hidden`, `deleted` and `capabilities{readEvents, createEvents, availability}`. `accessRole` is one of `owner | writer | writerWithoutPrivateAccess | reader | freeBusyReader`.
- Capabilities are the intersection of full scopes and policy: `readEvents` is false for `freeBusyReader`; `createEvents` requires `owner`, `writer` or `writerWithoutPrivateAccess`.
- Limitations: `page-limit, calendar-limit, byte-limit, provider-error, unsupported-entry, primary-missing, stale`.
- Discovery refreshes are coalesced, and CAS rebasing never lets a partial refresh replace a complete snapshot.

**Availability** (`calendar-availability-api.ts`):
- Calls `POST /calendar/v3/freeBusy` in batches of at most 50 calendars, at most 2 batches (100 calendars), at most 2000 busy intervals ingested, ranges of at most 31 days.
- Per-calendar errors inside an HTTP 200 body are reported as **incomplete coverage**, never as all-clear.
- Intervals are merged in UTC and partitioned into busy and free.

**Target precedence**: explicit calendar, then saved default (`defaultSettingRevision`, which is separate from `connectionRevision`), then primary.

### 3.5 Event read and creation (`calendar-api.ts`, `calendar-api-http.ts`)

- Base URL `https://www.googleapis.com/calendar/v3`.
- `429`, `5xx`, and `403` with reason `rateLimitExceeded`/`userRateLimitExceeded` are retryable for reads only. Create is **never** retried (`deliveryRetry:'never'`).
- Create is `POST /calendars/{id}/events?sendUpdates=none&conferenceDataVersion=0&supportsAttachments=false&fields=…,extendedProperties/private`. The body is:
  - `{id: operation.googleEventId (stable, precomputed → idempotent), summary, start/end:{dateTime: wall-clock in tz, timeZone}, description?, location?, reminders:{useDefault:false}, guestsCanInviteOthers:false, extendedProperties.private:{aurvinOperationId, aurvinRequestHash}}`
- An uncertain create is resolved by **readback** of the same event ID, matching the private properties.
- Operation states (v2): `planned, dispatching, succeeded, definitely-failed, unknown, evidence-expired, failed, cancelled`.
- Pagination cursors are HMAC-signed, process-local continuation tokens (`calendar-api-cursor.ts`, `CALENDAR_CURSOR_VERSION=2`). Raw Google page tokens are never exposed.

### 3.6 Model-facing tools (`contracts/calendar-tools.ts`)

The model is bound to only two native tools (`SKILL_NATIVE_TOOLS`, protocol `plugin-skills.v1`). It also receives a compact catalog `{plugin:'google-calendar', label:'Calendar', description:'Scheduling and availability', tools:[{name, description}]}`.

| Native tool | Arguments |
|---|---|
| `activate_skill` | `{plugin: /^[a-z][a-z0-9_-]*$/ (at most 64), tools: 'all' \| string[1..64 unique]}`. Returns a `skill-disclosure` with each tool's schema, revision and instructions. |
| `call_tool` | `{plugin, tool, arguments: object}`. Executes a loaded tool. Errors: `SCHEMA_NOT_LOADED`, `SCHEMA_STALE`, `ARGUMENTS_INVALID`, `UNKNOWN_PLUGIN`, `UNKNOWN_TOOL`, `INVALID_SELECTION`, `DISCLOSURE_BUDGET_EXCEEDED`. |

Calendar tools (revision `google-calendar.v2`; all are `additionalProperties:false`):

| Tool | Required | Optional | Read-only |
|---|---|---|---|
| `calendar_list_events` | `timeMin, timeMax` (at most 96 chars), `maxResults` (1..20) | `pageToken` (at most 2048), `calendarId` (at most 1024) | yes; range at most 31 days |
| `calendar_get_event` | `eventId` (at most 1024) | `calendarId` | yes |
| `calendar_create_event` | `summary` (1..200), `start`, `end` (offset RFC3339), `timeZone` (IANA, at most 100) | `description` (0..2000), `location` (0..500), `calendarId` | no; `deliveryRetry:'never'` |
| `calendar_list_calendars` | none | `pageToken` | yes |
| `calendar_check_availability` | `timeMin, timeMax, timeZone` | `calendarIds` (1..100 unique) | yes |

Additional rules:
- Arguments and results are each at most 16384 bytes. JSON depth is at most 8.
- `forbiddenCalendarKeys` (attendees, recurrence, reminders, visibility, id, tokens, `confirmed`, `proposalId`, revisions, and others) are rejected outright.
- Per-turn limits (`CALENDAR_LIMITS`): modelDispatches 8, repairs 2, logicalTools 6, creates 1, calendarRequests 20, refreshRequests 2, deliveryRetries 2, eventsPerResult 20, toolTimeoutMs 20000, modelSpendUsd `'1'`, sourceLifetimeMs 86400000, auditLifetimeMs 2592000000, proposalLifetimeMs 600000.
- Validation codes (`tools-validation.ts`): `CALENDAR_ARGUMENTS_INVALID`, `CALENDAR_FORBIDDEN`, `CALENDAR_UNKNOWN_TOOL`, `TIME_REQUIRES_CLARIFICATION`, `SUMMARY_REQUIRES_CLARIFICATION`, `OPERATION_AUTHORITY_REQUIRED`.

### 3.7 Proposal and confirmation flow (`contracts/calendar-authority.ts`, chat-runtime)

**Proposal record** (`calendarProposalSchema`, `kind:'calendar-proposal'`, schemaVersion 2), stored in `metadata`:

| Field group | Fields |
|---|---|
| Account binding | `userId, connectionId, connectionRevision, googleSubjectId` |
| Identity and origin | `sessionId, proposalId, revision (>0), originatingTurnId, originatingAcceptedMessageId, originatingAttemptId, intentId` |
| Target and action | `target\|null, action (create args)\|null, canonicalActionHash (sha256)\|null` |
| Evidence revisions | `discoveryRevision, availabilityRevision\|null, conditionFingerprint\|null, disclosedLimitations` |
| Choices | `candidates[{target, canonicalActionHash}] (at most 20), purpose: selection\|details\|conflict` |
| Lifecycle | `expiresAt` (TTL at most 600000 ms and at most `contentExpiresAt`), `state: pending\|consumed\|cancelled\|superseded\|expired`, `consumedBy\|null` |
| Optional | `incomplete?{missing[start\|end\|title\|target\|duration\|timeZone], messageRefs (at most 8)}` |

The record must be at most 16384 bytes.

How replies resolve a proposal:
- A reply must match the **current pending** proposal (`proposalMatchesReply`): same session, `revision`, connection and subject; not expired; a matching canonical hash and condition fingerprint; and a decision `accept|cancel|select` allowed for the purpose.
- An incomplete proposal is never consumable.
- Consumption is single-use (`consumedBy` holds operationId, acceptedMessageId and calendarId) and drives exactly one operation, which is idempotent through the stable event ID.
- Model claims such as `confirmed:true` never authorize anything.

Reply paths:
- **Text**: `POST` chat message with an optional `calendarReplyTo:{proposalId, revision}` (`contracts/api.ts`) and natural-language text such as "yes", "cancel" or a calendar choice. The runtime resolves this against the pending proposal.
- **Voice** (`AgentVoiceAdapter.calendarControl`): `calendar.confirm` must match the last disclosed proposal view (`proposalId` and `revision`). It is converted into a synthetic finalized turn: text `'yes'` for accept, `'cancel'` for reject, or the candidate `calendarId` for select. The provider turn ID is `key('calendar-confirm', proposalId, revision, kind, calendarId|'')` and `calendarReplyTo` is set. Voice and buttons therefore share one idempotent path. A mismatch raises `INVALID_VOICE_CONTROL` as a warning.

### 3.8 Views and wire events sent to the UI (`contracts/calendar-view.ts`, `calendar-wire.ts`)

Each `CalendarView` is at most 14336 bytes and has `viewVersion:1`.

| kind | Key fields |
|---|---|
| `agenda` | `target{calendarId, calendarLabel\|null, labelExpiresAt}`, `requested{timeMin, timeMax, displayTimeZone}\|null`, `entries[] (at most 20){eventId, summary, start, end, allDay, timeZone, status, location?, description?, htmlLink (safe https)\|null}`, `nextPageToken`, `truncated`, `detailsTrimmed`, `entriesOmitted`, `expiresAt` |
| `proposal` | `proposalId, intentId, revision, expiresAt, reason: target\|details\|conflict\|coverage, target\|null, action\|null, candidates[{calendarId, label, role}] (at most 20)` |
| `outcome` | `operationId, proposalId\|null, intentId, state (v2), retryAction: none\|resume-reconciliation\|reconnect\|clarify\|blocked-expired, receipt{durable:true, eventId, htmlLink, calendarLabel, expiresAt}\|null` (receipt present if and only if succeeded) |
| `notice` | `state: failed\|unavailable\|clarification\|cancelled\|expired\|read-completed, message (at most 1000), proposalId, intentId, tool, coverage: complete\|incomplete, conflict: clear\|conflict\|unknown, limitations (at most 8)` |

`CalendarPresentationEvent` is one of:
- `{type:'calendar-progress', phase: validating|repairing|executing|reconciling}`
- `{type:'calendar-operation', operation: CalendarTurnStateV2}`
- `{type:'calendar-clarification', proposalId, proposalRevision?, expiresAt, reason, message, candidates, view?}`
- `{type:'calendar-view', view}`

Delivery:
- Text chat uses the SSE envelope `calendarMultiStreamEnvelopeSchema` (`protocolVersion:3, sessionId, turnId, attemptId, sequence, event`), at most 16384 bytes.
- Voice wraps the same events in `calendar.frame`. This is best-effort: frame failure never changes the calendar outcome.
- Assistant messages may persist a `calendarView` (`contracts/message.ts`).

---

## 4. Authentication (WorkOS password sessions, `auth/*`)

| Item | Specification |
|---|---|
| Env (bootstrap) | `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`. All three must be set or all blank. No whitespace or control characters, at most 4096 chars, cookie password at least 32 chars; otherwise `CONFIGURATION_ERROR` at startup. `AURVIN_USER_ID` (default `aurvin-dev-user`) is the legacy owner ID used by bootstrap. |
| SDK | `new WorkOS(apiKey, {clientId, issuer: 'https://api.workos.com/user_management/<clientId>', timeout:10000, maxRetries:0})`. Provider calls are bounded: at most 4 concurrent (else `RATE_LIMITED`) and 10 s (else `AUTH_TIMEOUT`). |
| Cookie | `aurvin_wos_session=<WorkOS sealed session>; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800[; Secure]`. `Secure` is set when the frontend origin is https. Value at most 12288 chars of printable ASCII. Reading rejects headers over 16 KiB or a duplicated cookie. |
| Roles / status | `USER_ROLES = ['super-admin','user']`, `USER_STATUSES = ['active','inactive']` |
| Users collection | `users` holds `UserAccount {schemaVersion:1, userId, workosUserId, emailNormalized, role, status, passwordChangeRequired, currentWorkosSessionId\|null, sessionEpoch, createdAt, updatedAt}`, updated through revisioned CAS (`UsersRepository`). |

Routes (`auth.controller.ts`; boundary `configure-auth-http.ts`). Wire constants are `AUTH_PROTOCOL_VERSION = 1` and `AUTH_ROUTES`.

Boundary rules:
- Only the exact pairs `GET me` and `POST login|logout|password|forgot-password|reset-password` are accepted. No query strings.
- `Origin` must equal `FRONTEND_ORIGIN`; a GET may omit it. `Sec-Fetch-Site: cross-site` is rejected.
- Transport must be dev loopback or https with trusted ingress.
- POST requires `application/json[; charset=utf-8]`, identity encoding, body at most 4096 bytes (else 413), read within 5 s (else 408), and strict UTF-8.

| Route | Body | Success | Behavior |
|---|---|---|---|
| `POST /api/auth/login` | `{email (normalized, 3..254), password (1..1024)}` | `{user}` + Set-Cookie | Steps below. |
| `GET /api/auth/me` | none | `{user: {userId, email, role, passwordChangeRequired}}` | Allowed while a password change is pending. |
| `POST /api/auth/password` | `{currentPassword, newPassword (10..1024, different)}` | `{user}` + new cookie | Steps below. |
| `POST /api/auth/forgot-password` | `{email}` | `{ok:true}` **always** | Sends recovery only for an active local account. Never reveals whether the account exists. |
| `POST /api/auth/reset-password` | `{token (1..2048), newPassword (10..1024)}` | `{ok:true}` + cleared cookie | The provider resolves the subject. The local account is invalidated and `passwordChangeRequired:false` is set (CAS, up to 3 tries). |
| `POST /api/auth/logout` (204) | `{}` exactly | cleared cookie | If this session is current, invalidate (`currentWorkosSessionId:null`, `sessionEpoch+1`). Revoke the WorkOS session. Also stop the user's voice sessions and cancel any pending Calendar OAuth (`app.service.ts`). |

Login steps:
1. Apply the global limiter and the per-email limiter.
2. Read the local account by email.
3. Call WorkOS `authenticateWithPassword` (sealSession).
4. The local account must be `active` and its `workosUserId` must match; otherwise revoke the new session and return `UNAUTHENTICATED`.
5. CAS-set `currentWorkosSessionId`. Only **one live session per account**: logging in elsewhere invalidates the older session.

Password change steps:
1. Re-verify the current password through a provider login, then revoke that proof session.
2. CAS-invalidate the account **before** `updateUser(password)`.
3. Log in with the new password and CAS-set the new session with `passwordChangeRequired:false`.
4. Revoke the old session.

**Request identity** (`authenticate`):
1. Load the sealed session, call `refresh()`, and re-authenticate the refreshed session.
2. Look up the local account by `workosUserId` (`bySubject`).
3. `admitAccount` requires `status:'active'` and `currentWorkosSessionId === sessionId`.
4. The principal identity is `{userId, openRouterUser: userId, source:'authenticated-session'}`.
5. The refreshed sealed session is sent back as `Set-Cookie`.

Gates:
- `requireFullAccount` (`PASSWORD_CHANGE_REQUIRED` 403) applies to all private routes, voice and calendar.
- `requireSuperAdmin` applies to `/api/admin*`.

**Attempt limiter** (`attempt-limiter.ts`, in-memory):

| Limit | Value |
|---|---|
| Global | 60 per 60 s |
| Login (per email) | 10 per 60 s |
| Recovery (per email) | 3 per 60 s |
| Tracked keys | at most 1024 |

Exceeding a limit gives `RATE_LIMITED` (429, `Retry-After: 60`).

**Errors**: body `{error:{code, retryable}}`.

| Code | Status | Retryable |
|---|---|---|
| `INVALID_REQUEST` | 400 | no |
| `UNAUTHENTICATED` | 401 (also clears the cookie) | no |
| `FORBIDDEN` | 403 | no |
| `PASSWORD_CHANGE_REQUIRED` | 403 | no |
| `RATE_LIMITED` | 429 | yes |
| `NOT_READY` | 503 | yes |
| `AUTH_PROVIDER_UNAVAILABLE` | 503 | yes |
| `AUTH_TIMEOUT` | 504 | yes |

WorkOS error mapping: 429 gives `RATE_LIMITED`; 408 gives `AUTH_TIMEOUT`; `invalid_credentials`, `invalid_grant`, `email_verification_required`, `mfa_challenge` and expired or invalid reset tokens give `UNAUTHENTICATED`; 400, 409 and 422 give `INVALID_REQUEST`; everything else gives `AUTH_PROVIDER_UNAVAILABLE`.

**When WorkOS is not configured**: `AuthService.provider()` throws `NOT_READY`. Every private `/api` route, voice and admin return 503 `NOT_READY`. `forgot-password` still returns `{ok:true}`. Only `GET /api/operations/live` (and OPTIONS) work. There is no anonymous or dev-identity fallback.

**First Super Admin bootstrap**: an operator CLI (§7, `auth:bootstrap`). There is no self-registration and no promotion API.

---

## 5. Admin config ("Manage Aurvin", `admin-config/*`)

**Routes** (`admin-config.controller.ts`; super-admin enforced by the private boundary and again by `assertActor`, which requires a `session` / `local-account` super-admin):

| Method + path | Body | Response |
|---|---|---|
| `GET /api/admin/config` | none (no query) | `PublicAdminConfig` |
| `PUT /api/admin/config` | `{protocolVersion:1, expectedRevision (0 = create), settings: ManageableSettings}`. Keys `updatedBy`, `actor` and `envelope` are rejected. | `PublicAdminConfig` |
| `POST /api/admin/config/credentials/:provider` (200) | `provider ∈ openrouter\|deepgram`. Body is `{protocolVersion:1, expectedRevision, action:'replace', candidate (1..4096 bytes, trimmed, no control chars)}` or `{…, action:'remove', confirm:true}` | `PublicAdminConfig` |

`PublicAdminConfig` fields:
- `protocolVersion:1, schemaVersion:1`
- `revision`
- `activeRevision|null`
- `state: missing|stored`
- `activation: active|unconfigured|blocked`
- `roleAssumption{role, authentication:'session', source:'local-account'}`
- `settings`
- `credentials{openrouter, deepgram}`, each `{configured, validatedAt|null}`

Credentials are **write-only**: they are never returned.

**HTTP boundary** (`configure-admin-http.ts`):
- Origin must be exact, else `INVALID_ADMIN_ORIGIN` 403.
- Transport must be trusted HTTPS or dev loopback, else `ADMIN_TRANSPORT_REQUIRED` 403.
- Rate limit 60 per 60 s, else `ADMIN_RATE_LIMITED`.
- Methods are limited to GET, PUT and POST. Body at most 16384 bytes, read within 5 s.

**Settings catalogue** (`contracts/admin-config.ts` `manageableSettingsSchema`; defaults from `platform/config/manageable-config.ts` `defaultManageableSettings`). All objects are strict, and integers must be positive safe integers unless noted.

| Key | Type / validation | Default |
|---|---|---|
| `openRouter.modelId` | string at most 200; `''`, or trimmed with no control chars | `''` |
| `openRouter.dataCollection` | literal `'deny'` | `'deny'` |
| `openRouter.disableTransforms` | literal `true` | `true` |
| `chat.maxInputChars` | int at most 32000 | 32000 |
| `chat.maxInputTokens` | int | 8192 |
| `chat.maxMessagesInContext` | int at most 500 | 80 |
| `chat.maxContextTokens` | int; must exceed `maxOutputTokens + modelMarginTokens` | 16384 |
| `chat.maxOutputTokens` | int | 2048 |
| `chat.modelMarginTokens` | int | 1024 |
| `chat.titleMaxChars` | int at most 80 | 80 |
| `chat.maxConcurrentGenerationsPerProcess` | int | 8 |
| `chat.maxRequestsPerMinutePerUser` | int (also the voice admission rate) | 20 |
| `chat.retryMaxAttempts` | int at most 3 | 2 |
| `chat.retryBaseDelayMs` | timer at most 2147483647 | 500 |
| `chat.retryMaxDelayMs` | timer; at least base and at most totalRunTimeoutMs | 5000 |
| `chat.firstOutputTimeoutMs` | timer; at most totalRunTimeoutMs | 30000 |
| `chat.idleStreamTimeoutMs` | timer; at most totalRunTimeoutMs | 20000 |
| `chat.totalRunTimeoutMs` | timer | 180000 |
| `voice.enabledModes.dictation` / `.live` | boolean | false / false |
| `voice.limits.*` (10 keys of `VoiceLimits`) | timers plus the `isVoiceLimits` cross-rules | `DEFAULT_VOICE_LIMITS` (§1.2) |
| `voice.dictationWarningMs` | timer or null; less than `dictationMaxMs` | 270000 |
| `voice.quotas.identityConcurrent` / `globalConcurrent` | int; identity at most global | 1 / 4 |
| `voice.quotas.identityDailyMinutes` / `globalDailyMinutes` | int; identity at most global | 60 / 120 |
| `voice.quotas.dailySpendUsd` | positive number or null; non-null requires all three rates | null |
| `deepgram.region` | `us\|eu` (selects the WSS and validation host) | `us` |
| `deepgram.dictationModel` / `liveModel` | literals `nova-3` / `flux-general-en` | same |
| `deepgram.ttsModel` | `flux-haley-en\|flux-alexis-en\|flux-priya-en` | `flux-haley-en` |
| `deepgram.endpointingMs` | int 300..500 | 300 |
| `deepgram.spokenPunctuation` | boolean | false |
| `deepgram.keyterms` | string[] at most 50, each 1..64, trimmed | [] |
| `deepgram.eotThreshold` | 0.5..1 | 0.8 |
| `deepgram.eotTimeoutMs` | timer | 5000 |
| `deepgram.rates.novaPerMinuteUsd` / `fluxSttPerMinuteUsd` / `fluxTtsPerThousandCharsUsd` | non-negative or null | null |

`ADMIN_CONFIG_FIELD_PATHS` enumerates the 51 field paths used in `fieldErrors[{path, code: required|invalid|out_of_range|cross_field|immutable|unsupported}]`.

**Storage**: a single document in the `config` collection.
- Shape: `{_id:'aurvin', schemaVersion:1, revision (>0), settings, credentials:{openrouter, deepgram}, updatedAt, updatedBy}`.
- Each credential slot is `{envelope:{algorithm:'aes-256-gcm', nonce (12 bytes, base64), tag (16 bytes), ciphertext}, validatedAt}` or null.
- The document is at most 16384 bytes.
- The encryption key is `AURVIN_CONFIG_ENCRYPTION_KEY`, with AAD `JSON.stringify(['aurvin','config',1,provider])` and a fresh nonce per seal (`credential-service.ts`).
- There is no plaintext environment fallback, and a key is never generated.

**Validate-and-save** (`credential-validation.ts`):
- Requires an existing document (otherwise `CONFIG_CONFLICT`, current revision 0) and a ready encryption key (otherwise `CONFIG_ENCRYPTION_UNAVAILABLE`).
- Validation calls are made before the write:
  - OpenRouter: `GET https://openrouter.ai/api/v1/key` with `Authorization: Bearer`.
  - Deepgram: `GET https://api.deepgram.com/v1/auth/token` (or `api.eu.deepgram.com` for region `eu`) with `Authorization: Token`.
  - Bounds: 10 s, 64 KiB response, no retries, no redirects.
  - Outcomes: 401/403 give `CREDENTIAL_REJECTED`; 429 gives `CREDENTIAL_PROVIDER_RATE_LIMITED`; a timeout gives `CREDENTIAL_VALIDATION_TIMEOUT`; malformed responses give `CREDENTIAL_PROVIDER_RESPONSE_INVALID`.
  - Concurrency: at most 2 validations at once and 6 per minute.
- The candidate is then sealed and saved with CAS. `remove` sets the slot to null.

**Activation semantics** (`admin-config.service.ts`):
1. Every mutation builds the candidate document at `expectedRevision+1` and decrypts credentials.
2. `activation.prepare(snapshot)` builds the runtime snapshot (bounded to 10 s).
3. It then writes: `createIfAbsent` when `expectedRevision=0`, otherwise `compareAndSwap(expectedRevision)`.
4. Only after a confirmed write does it `activation.publish(snapshot)`. New requests and voice sessions use the new snapshot. In-flight work keeps its captured snapshot ("applies to new work only").

Other rules:
- Mutations are serialized: at most 8 queued, each with a 30 s wait.
- A write whose outcome is unknown after dispatch sets **`blocked`**. All later writes then return `CONFIG_WRITE_UNCERTAIN` until restart or reconciliation.
- `activation` values:
  - `blocked` when blocked, or when the active revision differs from the stored revision.
  - `unconfigured` when there is no document, or when there is no OpenRouter credential or modelId.
  - `active` otherwise.

Errors use body `{protocolVersion:1, error:{code, retryable, currentRevision, fieldErrors}}`.

| Status | Codes |
|---|---|
| 400 | `INVALID_CONFIG_REQUEST` |
| 422 | `CONFIG_VALIDATION_FAILED`, `CREDENTIAL_REJECTED` |
| 409 | `CONFIG_CONFLICT` |
| 503 | `CONFIG_STORAGE_UNAVAILABLE`, `CONFIG_WRITE_UNCERTAIN`, `CONFIG_STORED_INVALID`, `CONFIG_ENCRYPTION_UNAVAILABLE`, `CONFIG_ACTIVATION_UNAVAILABLE` |
| 504 | `CREDENTIAL_VALIDATION_TIMEOUT` |
| 429 | `CREDENTIAL_PROVIDER_RATE_LIMITED`, `ADMIN_RATE_LIMITED` |
| 502 | `CREDENTIAL_PROVIDER_UNAVAILABLE`, `CREDENTIAL_PROVIDER_RESPONSE_INVALID` |
| 403 | `INVALID_ADMIN_ORIGIN`, `ADMIN_TRANSPORT_REQUIRED` |

Retryable codes: `CONFIG_STORAGE_UNAVAILABLE`, `CREDENTIAL_VALIDATION_TIMEOUT`, `CREDENTIAL_PROVIDER_RATE_LIMITED`, `CREDENTIAL_PROVIDER_UNAVAILABLE`, `ADMIN_RATE_LIMITED`.

---

## 6. Administration: user management (`administration/*`)

**Routes** (`@Controller('admin/users')`; boundary `configure-administration-http.ts`):
- Body JSON at most 4096 bytes. Only GET on the collection, and POST on the collection or an action. No query string on POST.
- `requireAdmin` re-reads the actor's account, requires an active current session and the super-admin role, and takes from the global limiter.

| Method + path | Body / query | Success |
|---|---|---|
| `GET /api/admin/users?limit=1..50&cursor=(1..512)` | Default limit is 20 | `{items: AdministrationUser[], nextCursor\|null}` |
| `POST /api/admin/users` (201) | `{email (normalized), temporaryPassword (8..1024), role:'user'}` | `{user}` |
| `POST /api/admin/users/:userId/deactivate` (200) | `{}` | `{user}` |
| `POST /api/admin/users/:userId/reactivate` (200) | `{}` | `{user}` |
| `POST /api/admin/users/:userId/password-reset` (204) | `{}` | none |

`AdministrationUser = {userId, email, role, passwordChangeRequired, status, createdAt}`.

Rules (`administration.service.ts`):
- **Create**:
  - An existing local email gives `ACCOUNT_CONFLICT`.
  - A new `userId` (UUID) is passed as the WorkOS `externalId` in `createUser`. Only role `user` can be created (super-admins come only from bootstrap).
  - The local account starts `active`, with `passwordChangeRequired:true`, `sessionEpoch:0` and no session.
  - An unknown provider outcome gives `ACCOUNT_PROVISIONING_INCOMPLETE` (503). It is never retried and never adopted by email.
- **Targets**: the target must exist (else `ACCOUNT_NOT_FOUND` 404) and have role `user`. An admin cannot act on themselves or on another super-admin (`FORBIDDEN`).
- **Deactivate**:
  - CAS `status:'inactive'` together with `invalidateAccount` (session cleared, epoch+1).
  - Then, bounded to 10 s: `onUserDeactivated(userId)` (stops voice sessions) and revoking WorkOS sessions (the current one plus at most 3 pages of 100 listed sessions).
  - Repeating the command repairs a crash between the commit and the cleanup.
- **Reactivate**: sets `status:'active'` and `currentWorkosSessionId:null`.
- **Password reset**: limited by the recovery limiter (3 per minute per email), then WorkOS `createPasswordReset` sends the email.
- **Errors**: the auth codes plus `ACCOUNT_CONFLICT` 409, `ACCOUNT_NOT_FOUND` 404, `ACCOUNT_WRITE_UNCERTAIN` 503 and `ACCOUNT_PROVISIONING_INCOMPLETE` 503 (none retryable).

---

## 7. Benchmark and operator scripts

npm scripts (`backend/package.json`): `"benchmark": "node dist/benchmark/cli.js"`, `"test:benchmark": "vitest run test/benchmark/"`, `"auth:bootstrap": "node dist/scripts/bootstrap-auth.js"`. All of these require `npm run build` first.

| Command | What it does |
|---|---|
| `npm run auth:bootstrap -- preflight --workos-user <id> --email <e> --legacy-owner <AURVIN_USER_ID>` | Read-only. Looks up the WorkOS user by exact ID (`getUser`) and inspects MongoDB collections (`users, sessions, messages, agent-memory, …`; at most 5000 rows per collection in batches of 50, else `INSPECTION_LIMIT`). Refuses if a super-admin already exists, the owner, subject or email is already mapped, owners are ambiguous, work is unreconciled, and similar. Prints `BOOTSTRAP_PREFLIGHT_OK`. |
| `npm run auth:bootstrap -- adopt … --confirm-owner <same> --app-stopped --backup-confirmed --authorized` | Repeats the checks under executor ownership, then inserts one `users` row: `userId = legacy owner`, role `super-admin`, `active`, `passwordChangeRequired:true`. Prints `BOOTSTRAP_ADOPTED`. Exit codes: 0 ok, 2 refused (`BOOTSTRAP_REFUSED`, e.g. `ALREADY_BOOTSTRAPPED`), 1 failed (`WRITE_UNCONFIRMED`/`CLOSE_UNCONFIRMED`). `--legacy-owner` must equal `AURVIN_USER_ID`. Existing data is never rewritten. |
| `node --enable-source-maps dist/scripts/import-config.js` (no arguments) | One-time import of the legacy manageable env names (§1.3, plus `OPENROUTER_*` and chat budget names) into an **empty** `config` store as an encrypted document. Prints names and counts only. Exit 0 imported, 2 already configured or refused, 1 failure. Never edits `.env`. |
| `node dist/scripts/migrate-accounting.js --database <db> [--apply --maintenance-confirmed] [--page-size 1..50] [--max-pages 1..1000] [--after-id HEX]` | Accounting record migration. Dry-run by default with read-only IO. `--apply` uses admitted persistence ownership. Prints one JSON summary `{dryRun, pages, …, nextCursor, complete}`. Per the docs it uses a private `AURVIN_ACCOUNTING_MONGODB_URI` (`docs/mongodb-usage-accounting/operations.md`). `--help` prints usage. |
| `npm run benchmark -- <config.json> [--live]` | `benchmark/cli.ts`. Dry-run by default (zero network). Inventories scenarios (`report.ts`: text and voice, Calendar read and mutation variants). Live mode requires the config's `allowPaid` and `budgetCeilingUsd`. It drives the running backend over HTTP/SSE (`runner.ts`) and voice over WebSocket or LiveKit (`voice-runner.ts`, `webrtc-voice.ts`). Results go to `backend/benchmark-results/<uuid>/`. |
| `node dist/benchmark/live-baseline.js --live --transport=… --approval-reference=… --output-name=…` | One-shot guarded WebRTC baseline. Boots an isolated app with a `LiveBudget` guard (HTTP, speech-byte and lifetime ceilings). Reads `benchmark-results/webrtc-context.local.json` and pre-generated PCM, spawns `dist/benchmark/cli.js … --live`, and claims a new output directory exclusively. |
| `make-audio.ps1 [-OutputDirectory]` | Windows `System.Speech` generates a synthetic PCM16 16 kHz mono baseline plus a timing manifest. Offline. |

Supporting modules:
- `voice-comparison.ts`: offline comparison of WebSocket and WebRTC runs.
- `voice-measurements.ts`: decoded-onset gate and percentile summary.
- `stream-timing.ts`: per-dispatch timing.
- `readonly-harness.ts` and `readonly-calendar-boundary.ts`: synthetic read-only Calendar harness, not wired into production.

---

## 8. Rebuild notes: invariants and gotchas

1. **Single-process, in-memory state.** Several pieces of state live only in memory and are lost on restart:

   | State | Location |
   |---|---|
   | Voice sessions, tickets and quotas | `VoiceSessionService`, `VoiceUsageService` |
   | Auth limiter and provider concurrency | `attempt-limiter.ts`, `provider.ts` |
   | Pending Calendar OAuth flow | `oauth.ts` (`ponytail`) |
   | Calendar cursors' HMAC key | `calendar-api-cursor.ts` |
   | Admin `blocked` flag | `admin-config.service.ts` |

   Do not run two live backends against one database.
2. **Server-resolved identity only.** `userId` comes from the WorkOS session mapped through `users.workosUserId`. `openRouterUser = userId`. Deepgram receives only the hashed `tag`. Clients never supply identity. LiveKit participant identities embed `userId:sessionId:epoch` and are validated against the issued binding.
3. **Accept before paid work.** Voice admission (quota, accounting row) completes before provider sockets open. `assertPaidWork()` is checked before every STT write, reconnect and resume. Live `duration`/`quota` limits **pause** rather than end the call.
4. **Idempotency keys are stable compositions.** `voice-input|voiceSessionId|epoch|providerTurnId`, `voice-response|userId|sessionId|attemptId`, `calendar-confirm|proposalId|revision|kind|calendarId`, and a stable Google event ID for creates. Replays reconcile; they never re-infer or re-speak.
5. **Sequencing.** Control envelopes have strictly incrementing `sequence`; lower values are ignored and gaps are errors. `connectionEpoch` fences stale sockets and participants. Audio frames carry `sequence` and `offsetMs` that must be exact.
6. **Streamed speech is provisional.** Delivery status is settled from provider evidence and browser ACKs (`proof`). Unproven evidence is never durable. The record status becomes `unknown` when evidence is missing; Aurvin never claims "spoken".
7. **Canvas and voice coupling.** Once a visual block starts, the rest of the answer is silent in TTS. Artifacts are emitted only after a durable journal write. Persisting `canvasArtifacts` is restricted to live/internal assistant messages.
8. **Calendar authority.** Only a matched, unexpired, pending proposal revision, consumed once, authorizes a write. Model flags are ignored. Create is never retried; uncertainty is resolved by readback. A 404 on one calendar does not disconnect the account. Availability errors mean incomplete coverage, never free.
9. **Calendar is local-only today.** Routes require a loopback peer and loopback http origins and redirect, plus the `X-Aurvin-Calendar-CSRF: 1` header on mutations.
10. **Secrets.** Calendar tokens and admin credentials are encrypted with AES-256-GCM under `AURVIN_CONFIG_ENCRYPTION_KEY` with purpose-specific AAD. Credentials are write-only over the API. Never print secrets in scripts or logs. Legacy manageable env vars are ignored at runtime, and startup warns with names only.
11. **Auth single session.** `currentWorkosSessionId` allows one live session per account, so logging in elsewhere invalidates the older one. `sessionEpoch` increments on logout, password change, reset and deactivate. A pending password change blocks all private routes except `/auth/*`.
12. **Concurrency gotcha.** The voice admission per-minute limit reuses `chat.maxRequestsPerMinutePerUser`, but it is counted **process-wide**.
13. **Unclear or unverified.** The following are uncertain or not verified by a live run:
    - Server-side enforcement of `idleExitAfterWarningMs` (it appears client-driven).
    - The `calendar` Canvas artifact kind has no backend producer.
    - Real LiveKit, Deepgram, Google and WorkOS behavior.

    The docs record review as **skipped** and live, native and staging evidence as unrun (`docs/live-voice-webrtc/final_report.md`, `docs/google-calendar-multi-calendar/final_report.md`).

---

# Part 3 — Frontend and tooling


Extracted from source at `d:\Source6\Aurvin` (HEAD `c283766`, branch `main`, 13 Nov 2026). Paths are repo-relative. Backend module internals are in Parts 1–2 and are referenced here only where the frontend calls them. Where something was not verified it is marked **unclear**.

---

## 1. Repo layout and tooling

### 1.1 Top-level tree

```
Aurvin/
├── AGENTS.md                      # agent/contributor rules (MAW, ownership, header convention, checks)
├── README.md                      # setup, config table, run modes, checks, voice, staging, crash recovery
├── product_knowledge.md           # fixed runtime asset injected into model context ("Release: phase1.v1")
├── voice-modes-prd.md             # PRD v1.0 (8 Oct 2026): dictation (Nova-3) + live voice (Flux)
├── CONVERSATION_LATENCY_RESEARCHER_2.md   # one-off latency research report (7 Nov 2026)
├── setup.bat / run.bat            # Windows setup and launcher
├── .gitignore / .dockerignore     # no Dockerfile is tracked
├── .openchamber/screenshots/*.jpg # tracked UI screenshots (local tool output)
├── backend/                       # NestJS 12 / LangGraph package (own package-lock.json)
│   ├── src/{admin-config,administration,agent,auth,benchmark,chat-runtime,context,contracts,
│   │        http,instructions,model,operations,persistence,platform/{config,crypto,errors,
│   │        identity,security},plugins/google-calendar,scripts,voice/{agent,providers,
│   │        session,transport,usage}}
│   ├── test/<area>/...            # ~367 *.spec.ts + 48 *.e2e-spec.ts across repo
│   ├── .env.example, .oxlintrc.json, .prettierrc, nest-cli.json, benchmark.example.json
│   ├── tsconfig.json, tsconfig.build.json
│   └── vitest.config.ts / .e2e.ts / .azure.ts / .behavior.ts
├── frontend/                      # React 19 / Vite 8 package (own package-lock.json)
│   ├── index.html, vite.config.ts, vitest.config.ts, vercel.json
│   ├── tsconfig.json (refs) / tsconfig.app.json / tsconfig.node.json
│   ├── .env.example, .oxlintrc.json, .gitignore
│   ├── public/{aurvin-logo.png, aurvin-favicon.ico, aurvin-favicon-32.png, favicon.svg}
│   └── src/ (224 tracked files, 97 *.test.ts)
├── deployment/
│   ├── staging/{nginx.conf, README.md}       # Windows single-host TLS + basic-auth gateway
│   └── render/{nginx.conf.template, entrypoint.sh}  # container: NGINX on $PORT + node backend
└── docs/<workflow-slug>/...       # MAW workflow artifacts (see 1.10)
```

There is no root `package.json` or workspace; run npm in each package directory.

### 1.2 Node and module settings

| Item | Backend | Frontend |
| --- | --- | --- |
| `engines.node` | `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` | same |
| `"type"` | `module` | `module` |
| TS module | `module`/`moduleResolution: nodenext`, `resolvePackageJsonExports` | app: `module: esnext`, `moduleResolution: bundler`; node config (vite.config.ts only): `module: nodenext` |
| Local import specifier | **`.js`** (NodeNext; e.g. `./app.service.js`) | **`.ts`/`.tsx`** (`allowImportingTsExtensions: true`, e.g. `'./App.tsx'`); a few voice files import extensionless (`'./client'`) |
| Target | ES2023 | es2023, lib `ES2023, DOM`, `jsx: react-jsx` |
| Strictness | `strict: true`, `strictPropertyInitialization: false`, decorators + `emitDecoratorMetadata`, `isolatedModules`, `declaration`, `sourceMap`, `incremental` | `noEmit`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums/namespaces/param properties), `noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch`, `moduleDetection: force`, `allowArbitraryExtensions` |
| Types | `vitest/globals`, `node` | `vite/client` (app), `node` (node config) |
| Build config | `tsconfig.build.json`: rootDir `./src`, excludes `test`, `dist`, `**/*spec.ts`; `nest-cli.json` `deleteOutDir: true`, sourceRoot `src` | `tsc -b && vite build` |

Note: `frontend/src/styles/node-fs.d.ts` declares a minimal `node:fs.readFileSync` so app-tsconfig tests can read CSS files.

### 1.3 Frontend `package.json` (`frontend/package.json`)

| Scripts | |
| --- | --- |
| `dev` | `vite` |
| `build` | `tsc -b && vite build` |
| `lint` | `oxlint` |
| `preview` | `vite preview` |
| `test` / `test:watch` | `vitest run` / `vitest` |

| Dependencies | Version | | Dev dependencies | Version |
| --- | --- | --- | --- | --- |
| `@ozymandiasthegreat/vad` | `2.0.7` (exact) | | `@types/node` | `^24.13.3` |
| `livekit-client` | `^2.23.0` | | `@types/react` | `^19.2.18` |
| `react` | `^19.2.8` | | `@types/react-dom` | `^19.2.7` |
| `react-dom` | `^19.2.8` | | `@vitejs/plugin-react` | `^6.1.1` |
| | | | `oxlint` | `^1.81.0` |
| | | | `typescript` | `~6.0.2` |
| | | | `vite` | `^8.3.0` |
| | | | `vitest` | `^4.1.11` |

No router, state library, Markdown/Mermaid/chart library, CSS framework or icon package: all are hand-written.

### 1.4 Backend `package.json` (`backend/package.json`)

Scripts: `build` (`nest build`), `deploy` (`nest deploy`), `format` (prettier on `src/**/*.ts test/**/*.ts`), `start`, `start:dev` (`nest start --watch`), `start:debug` (`--debug --watch`), `start:prod` (`node dist/main`), `lint` (`oxlint --type-aware src/ test/`), `test` (`vitest run`), `benchmark` (`node dist/benchmark/cli.js`), `test:benchmark` (`vitest run test/benchmark/`), `test:watch`, `test:cov` (`--coverage`), `test:debug` (`--inspect-brk --no-file-parallelism`), `test:azure`, `test:behavior`, `test:e2e` (each with its own `--config`), `auth:bootstrap` (`node dist/scripts/bootstrap-auth.js`).

| Dependencies | Version | Dev dependencies | Version |
| --- | --- | --- | --- |
| `@langchain/core` | `^1.2.16` | `@nestjs/cli` | `^12.0.0` |
| `@langchain/langgraph` | `^1.4.19` | `@nestjs/mau` | `^0.2.6` |
| `@langchain/langgraph-checkpoint-mongodb` | `^1.4.1` | `@nestjs/schematics` | `^12.0.0` |
| `@langchain/openrouter` | `^0.4.17` | `@nestjs/testing` | `^12.0.1` |
| `@livekit/rtc-node` | `^1.2.1` | `@types/express` | `^5.0.0` |
| `@nestjs/common`, `core`, `platform-express`, `platform-ws`, `websockets` | `^12.0.1` | `@types/node` | `^24.0.0` |
| `@workos-inc/node` | `^12.2.0` | `@types/supertest` | `^7.0.0` |
| `livekit-server-sdk` | `^2.19.2` | `@types/ws` | `^8.5.14` |
| `mongodb` | `^6.21.0` | `@vitest/coverage-v8` | `^4.1.2` |
| `reflect-metadata` | `^0.2.2` | `oxlint` | `^1.58.0` |
| `rxjs` | `^7.8.1` | `oxlint-tsgolint` | `^7.0.2001` (needed by `--type-aware`) |
| `ws` | `^8.18.0` | `prettier` | `^3.4.2` |
| `zod` | `^3.25.32` | `source-map-support`, `supertest` | `^0.5.21`, `^7.0.0` |
| `overrides.undici` | `^6.28.1` | `typescript` / `vite-tsconfig-paths` / `vitest` | `^6.0.2` / `^5.1.4` / `^4.1.2` |

### 1.5 Lint and format

- `frontend/.oxlintrc.json`: plugins `react`, `typescript`, `oxc`; `react/rules-of-hooks: error`; `react/only-export-components: warn {allowConstantExport: true}`.
- `backend/.oxlintrc.json`: `typescript/no-explicit-any: off`, `typescript/no-floating-promises: error`, `env.node`.
- `backend/.prettierrc`: `singleQuote: true`, `trailingComma: all`. No frontend Prettier config (frontend style: no semicolons in some files, semicolons in others; unclear whether enforced).

### 1.6 Test configurations and discovery

| Config | Include | Exclude / notes |
| --- | --- | --- |
| `frontend/vitest.config.ts` | `src/**/*.test.ts` | `environment: 'node'` (no DOM). Tests render with `react-dom/server` (48 files use `renderToStaticMarkup`/`renderToString`), use `vi.fn`, `vi.useFakeTimers`, `vi.stubGlobal`; 10 tests `readFileSync` CSS/HTML to assert styles. No `.test.tsx`. |
| `backend/vitest.config.ts` | `**/*.spec.ts` | excludes `node_modules`, `dist`, `**/*.azure.spec.ts`, `**/*.behavior.spec.ts`, `**/*.e2e-spec.ts`; `globals: true`; plugin `vite-tsconfig-paths`. Specs live both co-located in `src/` (34) and in `test/<area>/`. |
| `backend/vitest.config.e2e.ts` | `**/*.e2e-spec.ts` | includes `*.native.e2e-spec.ts` that need `AURVIN_TEST_MONGODB_URI` + `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` (skip when absent). |
| `backend/vitest.config.azure.ts` | `test/compatibility/**/*.azure.spec.ts` | `passWithNoTests: true` (empty run is not evidence). |
| `backend/vitest.config.behavior.ts` | `test/evaluations/**/*.behavior.spec.ts` | `passWithNoTests: true`. |

Focused run: `npm test -- <relative-test-path> -t "<name>"`. Browser fixtures (not run by Vitest) are Vite dev pages: `features/chat/testing/stream-render-browser.html`, `features/admin-config/{testing,integration-tests}/dashboard-browser.html` (two near-identical 379-line copies), `features/auth/integration-tests/auth-browser.html`, `features/plugins/google-calendar/testing/calendar-browser.html`; they use `testing/browser-checks.ts` (`check`, `typeInput`, `press`).

### 1.7 Vite (`frontend/vite.config.ts`)

- Plugin `@vitejs/plugin-react`.
- `server.port = Number(process.env.FRONTEND_PORT ?? 5173)`.
- Proxy `/api` → `process.env.BACKEND_PROXY_TARGET ?? 'http://localhost:3000'`, `changeOrigin: true`, **`ws: true`** (required for dictation `/api/voice` WebSocket). Proxy `error` handler writes `503` `{"error":{"code":"NOT_READY","retryable":true}}` with `Cache-Control: no-store` when headers not yet sent. Guarded by `src/vite-proxy.test.ts`.
- `index.html`: `<div id="root">`, `/src/main.tsx`, title `Aurvin`, favicons `/aurvin-favicon.ico` + `/aurvin-favicon-32.png`.
- `frontend/vercel.json`: SPA rewrite `/(.*)` → `/index.html`.
- Audio worklet is loaded through Vite `?worker&url` (per `audio-capture-service.ts` header).

### 1.8 Environment files (names only)

- `frontend/.env.example`: `VITE_API_BASE=/api` plus a comment forbidding `VITE_OPENROUTER_API_KEY`, `VITE_USER_ID`, `VITE_MODEL`. All clients read `import.meta.env.VITE_API_BASE` defaulting to `/api`, trailing slashes stripped.
- `backend/.env.example` (85 lines) names: `PORT`, `FRONTEND_ORIGIN`, `NODE_ENV`, `AURVIN_USER_ID`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `PERSISTENCE_PROFILE`, `MONGODB_URI`, `MONGODB_DB_NAME`, `AURVIN_CONFIG_ENCRYPTION_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `AURVIN_EXECUTOR_TOPOLOGY`, `AURVIN_LOCAL_CRASH_RECOVERY`; commented optional: `AURVIN_LOG_LEVEL`, `MAX_MESSAGE_BYTES`, `MAX_DOCUMENT_BYTES`, `MAX_MANIFEST_BYTES`, `MAX_PAGE_SIZE`, `DEFAULT_PAGE_SIZE`, `CONNECT_TIMEOUT_MS`, `PERSISTENCE_TIMEOUT_MS`, `SHUTDOWN_DRAIN_MS`; Calendar: `AURVIN_GOOGLE_CALENDAR_{CLIENT_ID,CLIENT_SECRET,REDIRECT_URI,PROCESSING_POLICY_ID,POLICY_APPROVED,CONTENT_PERMISSION,MINIMAL_EVIDENCE_ALLOWED,POLICY_DEADLINE_AT,TIME_ZONE}`.
- Launcher/proxy-only variables: `FRONTEND_PORT`, `BACKEND_PORT` (run.bat local), `BACKEND_PROXY_TARGET`. Test-only: `AURVIN_TEST_MONGODB_URI`, `AURVIN_TEST_DB_PREFIX`.
- Legacy names ignored at startup (import-only, per README): `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_DATA_COLLECTION`, `OPENROUTER_DISABLE_TRANSFORMS`, `ENABLE_DICTATION_MODE`, `ENABLE_LIVE_VOICE_MODE`, `DEEPGRAM_API_KEY`, `DEEPGRAM_API_BASE`, chat/voice limit names. `AURVIN_GOOGLE_CALENDAR_TARGET_ID` deprecated/ignored.

### 1.9 Run/setup scripts and ports

| Mode | Backend | Frontend | Browser |
| --- | --- | --- | --- |
| Manual dev | `cd backend; npm run start:dev` → `127.0.0.1:3000` (`PORT=3000`) | `cd frontend; npm run dev -- --host 127.0.0.1` → 5173, proxy → `http://localhost:3000` | `http://localhost:5173` (`FRONTEND_ORIGIN` default) |
| `run.bat` | sets `PORT=8001`, `FRONTEND_ORIGIN=http://127.0.0.1:5179`, runs `npm run start:dev` in new window | `FRONTEND_PORT=5179`, `BACKEND_PROXY_TARGET=http://127.0.0.1:8001`, `npm run dev -- --host 127.0.0.1 --port 5179 --strictPort` | opens `http://127.0.0.1:5179` |
| Staging NGINX | backend `127.0.0.1:3000` | static `frontend/dist` in `html/aurvin` | `https://127.0.0.1:8443` (basic auth) |
| Render container | backend `127.0.0.1:3000` (`node dist/main.js` in `/app/backend`) | not served by template (unclear) | NGINX on `$PORT` (default 10000) |

`run.bat` sequence: verify `backend\package.json`; `npm ci` per package only if `node_modules` missing; copy `.env.example` → `.env` if absent; `npm run build` backend (fail stops); start backend window; poll `http://127.0.0.1:8001/api/operations/live` up to 90×1 s (fail exits); start Vite; poll UI up to 45 s; open browser. Never enables `AURVIN_LOCAL_CRASH_RECOVERY`.

`setup.bat`: requires `node`/`npm` on PATH; PowerShell version check (22.22.3+/24.15+/26+); `npm install` (not `ci`) in backend then frontend; copy `.env.example` to `.env` only when absent; `pause` on error.

### 1.10 Deployment files

- `deployment/staging/nginx.conf`: `listen 127.0.0.1:8443 ssl` (TLS 1.2/1.3; cert/key/htpasswd under `conf/operator/`), `auth_basic`, `root html/aurvin`, `Cache-Control: no-store, no-transform`, `X-Content-Type-Options: nosniff`, `client_max_body_size 256k`. Locations: `/api/operations/` (allow 127.0.0.1 only), `= /api/voice` (Upgrade/Connection upgrade, buffering off, 1260 s read/send), `/api/` (buffering off, request buffering on, 240 s), `/` (`try_files $uri $uri/ /index.html`). Strips `Authorization`, `X-Request-ID`, `X-Forwarded-For` upstream.
- `deployment/staging/README.md`: 10-step operator procedure; single Node executor; not a Calendar or LiveKit transport; no provisioning implied.
- `deployment/render/nginx.conf.template` + `entrypoint.sh`: `envsubst '$PORT'`, `location = /` returns `{"status":"ok","service":"aurvin-backend"}`, public `= /api/operations/live`, other `/api/operations/` local-only, `= /api/voice` WebSocket, `/api/` SSE with buffering off (240 s). No Dockerfile is tracked.

### 1.11 Root documents and docs/ MAW convention

- `AGENTS.md` (165 lines): project rules; MAW skill with `--skip review` (record review as **skipped**, never passed); orchestrator manages DAG/status/dispatch only, max three child agents; ownership P1 contracts, P9 central wiring, P10 integration tests/staging evidence; "Ponytail lazy senior dev" rules (`ponytail:` comments mark deliberate ceilings, e.g. `voice-client.ts`, `canvas-artifacts.ts`); mandatory file header; verification table; Git hygiene (stage named files, `codex/` branch prefix). Note: it states `verification.md`/`final_report.md` for Phase 1 are "not yet present", but both are tracked (stale text).
- `product_knowledge.md`: short `<product_knowledge>` block loaded as a fixed context asset (path must stay at repo root).
- `docs/<slug>/` per workflow. Canonical MAW artifact set (example `docs/aurvin-phase-1/`):

| File | Role |
| --- | --- |
| `goal.md` | Approved scope and acceptance criteria (ACnn). |
| `state.md` | YAML front matter (`workflow: maw`, `status`, `skipped_phases: [review]`, gates, plan commits, worker ranges, AC pass/fail/blocked) + execution graph, ownership per plan (P1..P10, R1), acceptance coverage, commit record, resume procedure. |
| `research.md` | Consolidated research (+ supplements such as R1). |
| `plan1.md`..`planN.md` | One committed implementation plan per owner/worker. |
| `operations.md`, `staging-evidence.md` | Procedures and actual vs. unrun drill evidence (optional). |
| `verification.md`, `final_report.md` | Integrated verification evidence and closing report. |

Workflow folders present: `aurvin-phase-1`, `google-calendar-plugin`, `google-calendar-multi-calendar`, `voice-modes`, `voice-cost-and-flow`, `voice-canvas-multimodal`, `voice-calendar-canvas`, `voice-mode-instructions`, `voice-agent-reliability`, `voice-latency-benchmark`, `live-voice-webrtc`, `super-admin-config`, `workos-authentication`, `plugin-skill-scalability`, `calendar-visibility-simplification`, `calendar-memory-first-production-handoff`, `chat-followup-latency`, `chat-performance`, `latency-reduction`, `backend-startup-fix`, `environment-knowledge-context`, `turn-status-ux`, `turn-finalization-repair`, `terminal-close-launcher`, `report-optimizations`, `local-crash-recovery`, `mongodb-usage-accounting`, `aurvin-plugins-research`, `performance/` (dated investigation notes) plus loose dated notes at `docs/*.md`.

### 1.12 File header convention (AGENTS.md)

Every code file starts with a banner: `FILE`, `LOCATION`, `PURPOSE` (1 line), `ROLE IN PROJECT` (2–3 lines), `KEY COMPONENTS` (bullets). Comment syntax per language: `/** ... */` (TS/TSX/vitest configs), `REM` (`.bat`), `#` (nginx/sh), `<!-- -->` (HTML fixtures). Not added to strict JSON or generated files. Required for new files and for existing files modified >30%. Observed widely but not universally (`vite.config.ts`, `vitest.config.e2e.ts`, `tsconfig*.json` have none).

---

## 2. Frontend architecture

### 2.1 Boot and shell

`main.tsx`: imports `index.css`, `App.tsx`, then `styles/scrollbars.css` last (so scrollbar rules win); throws `'Aurvin root element is missing.'` if `#root` absent; calls `installScrollReveal()`; renders `<StrictMode><App/></StrictMode>`.

`App.tsx` component tree:

```
App(props: client?, adminClient?, calendarClient?, administrationClient?, authClient?,
    initialAuthUser?, initialAuthStatus?, refreshCapabilities?)   // all injectable for tests
└─ AuthProvider
   └─ AppShell (routing by auth state; no URL router)
      ├─ ?token=... in URL          → ResetPasswordForm (then replaceState to pathname)
      ├─ status 'loading'           → "Loading Aurvin…"
      ├─ 'unauthenticated'          → LoginForm | ForgotPasswordForm (local toggle)
      ├─ 'password-change-required' or user.passwordChangeRequired → MandatoryPasswordChangeForm
      └─ authenticated → ChatProvider key={user.userId} (remount on account change)
                          └─ VoiceChatShell
                             ├─ div.aurvin-chat-surface [hidden/inert when page!=='chat'] → ChatView
                             └─ page==='admin' → AdminDashboard
```

- `VoiceChatShell` owns `page: 'chat'|'admin'` and `adminSection`. Initial section: OAuth callback present → `'calendar'`; role `user` → `'calendar'`; else `'openrouter'`. ChatView stays mounted (hidden + `inert`) while admin is shown so chat/voice continue ("Chat/voice continues in the background").
- Calendar OAuth return: `extractAndScrubCalendarOAuthCallback(location.href)` reads `?plugin=google-calendar&oauth=connected|fixture|cancelled|failed`, deletes sensitive query keys (`plugin, oauth, code, state, scope, error, error_description, error_uri, iss, authuser, prompt, hd, access_token, refresh_token, id_token, client_secret, token, userId, calendarId`) and token-like hashes, then `history.replaceState`; opens admin → Plugins → Google Calendar.
- `useLiveVoice` is created in `VoiceChatShell` with bindings to chat actions (`claimVoiceInput`, `writeVoiceDraft`, `releaseVoiceInput`, `bindVoiceConversation`, `refreshSessions` → `loadSessions` + `commitVoiceSession` + `reloadMessages`, `openCanvasArtifact`, `getActiveConversationId`). Its `start` is published through `startRef` to `ChatProvider.startVoiceConversation` (used by the composer waveform button).
- Sign out: `clearAllSubmissionRecovery()` (sessionStorage key) then `auth.logout()`.

### 2.2 Auth state (`features/auth/auth-context.tsx`)

`AuthStatus = 'loading'|'unauthenticated'|'authenticated'|'password-change-required'`. On mount (unless initial values injected) calls `client.me()`; failure → unauthenticated. `login`, `logout` (best effort, always clears), `changePassword`, `refreshUser`, `clearError`. Error mapping (`loginFailureMessage`): `RATE_LIMITED` → wait 60 s message; `NOT_READY`/`AUTH_PROVIDER_UNAVAILABLE`/503 invalid → "temporarily unavailable"; timeouts/network → "Could not reach Aurvin"; else "Invalid email or password." Password change errors map `INVALID_REQUEST` (≥10 chars, no common words), `UNAUTHENTICATED`, `RATE_LIMITED`.

### 2.3 Chat state management

- `ChatProvider` (`features/chat/state/chat-context.tsx`): `useReducer(chatReducer, initialChatState)`; creates `ApiClient` unless injected; wraps `dispatch` so navigation actions (`NEW_CHAT`, `SELECT_SESSION`, deleting the active session) first close any voice lease (`lease.onClose()` then `RELEASE_VOICE_INPUT`); runs `actions.loadSessions()` on mount. Context value `{ state, dispatch, actions, client, startVoiceConversation }`. `useChat()` throws outside provider.
- `ChatState` (`chat-types.ts`) fields: submission/retry recovery; `saves` per session `{turnId, value: SaveStateSnapshot, mode}`; `unsavedMessages`; `localSessionIds`; `sessionsRevision`; sessions list + loading/error/cursor/`hasMoreSessions`; `activeSessionId/Title`; messages + loading/error/cursor/`olderAvailable`/`loadingOlder`; `activeTurnId/AttemptId/TurnMode('text'|'live')`; `turnStatus` (`AttemptStatus | 'submitting' | 'idle'`); `isStreaming`, `streamText`, `turnError`; `draftInput`, `isSubmitting`; `voiceInput {token, mode}`; `sidebarOpen`; Canvas `canvasOpen`, `activeCanvasArtifactId`, `closedCanvasArtifactIds`; Calendar `calendarProgress`, `calendarOperationsByTurn`, `calendarViewsByTurn`, `calendarTurnOrder`, `calendarClarification`, `calendarLastSequence`.
- Actions: `SUBMISSION_RECOVERY, RETRY_RECOVERY, SAVE_STATE, NEW_CHAT, SET_DRAFT, CLAIM_VOICE_INPUT, VOICE_DRAFT, RELEASE_VOICE_INPUT, BIND_VOICE_CONVERSATION, TOGGLE_SIDEBAR, CLOSE_SIDEBAR, OPEN_CANVAS_ARTIFACT, CLOSE_CANVAS_TAB, CLOSE_CANVAS, SESSIONS_LOADING/LOADED/APPENDED/ERROR, SESSION_UPDATED, SESSION_DELETED, SELECT_SESSION, MESSAGES_LOADING/LOADED/ERROR, OLDER_MESSAGES_LOADING/LOADED, TURN_SUBMIT_START, TURN_ACCEPTED, TURN_SUBMIT_ERROR, STREAM_DELTA, STREAM_STATUS, STREAM_COMPLETED, STREAM_ERROR, STREAM_CANCELLED, STREAM_INTERRUPTED, CALENDAR_PROGRESS, CALENDAR_OPERATION, CALENDAR_VIEW, CALENDAR_CLARIFICATION, VOICE_SESSION_COMMITTED`.
- Key reducer semantics (`chat-reducer.ts`):
  - `NEW_CHAT`: clears active session/messages/turn/Canvas/Calendar state; **no server call**; stashes unsaved messages of a not-yet-saved session.
  - `SET_DRAFT` ignored while `voiceInput` lease held; `CLAIM_VOICE_INPUT` refused while busy/streaming; `VOICE_DRAFT`/`RELEASE_VOICE_INPUT` token-checked.
  - `TURN_SUBMIT_START`: appends optimistic user message `temp_user_N` (unless `hideFromTranscript`), clears draft, `turnStatus='submitting'`.
  - `TURN_ACCEPTED`: rewrites temp ids to server `userMessageId/turnId`, sets active session (first message creates the session server-side), `isStreaming=true`, `turnStatus='accepted'`; when `processEpoch` present inserts/updates session row locally (title = first input sliced to 80 chars) and bumps `sessionsRevision`.
  - `TURN_SUBMIT_ERROR`: removes `temp_*` messages, restores draft (unless user typed a new one), sets `turnError`.
  - `STREAM_DELTA`: `reset ? text : streamText + text`.
  - `STREAM_COMPLETED`: appends assistant message from `streamText` (+ attaches `calendarView`), rewrites in-flight Canvas id prefix `streaming_in_flight::canvas::` → `<assistantMessageId>::canvas::`.
  - `STREAM_ERROR/CANCELLED/INTERRUPTED`: append a terminal assistant placeholder (`failed_*`, `cancelled_*`, `interrupted_*`) with matching status; Calendar narration synced.
  - `SAVE_STATE`: epoch/version-fenced (stale snapshots ignored); `saved` clears unsaved stash and local-session marker.
  - Calendar actions are ignored when session/attempt mismatch or sequence ≤ last (`ignoreCalendarAction`).
- `use-chat.ts` (`useChatActions`): `startNewChat`, `selectSession` (GET messages), `loadOlderMessages`, `loadSessions`, `loadMoreSessions`, `reloadMessages`, `commitVoiceSession`, `submitMessage`, `restoreSubmission`, `allowNewAttempt`, `retrySave`, `cancelCurrentTurn`, `retryTurn`, `retryRecoveredTurn`, `setDraft`, voice lease methods (`isVoiceInputLocked`, `claimVoiceInput` → `crypto.randomUUID()` token, `writeVoiceDraft`, `releaseVoiceInput`, `bindVoiceConversation`).
  - Submit guard: trimmed non-empty, ≤32,000 chars, no voice lease, not streaming/submitting/busy. New `crypto.randomUUID()` idempotency key per submission/retry. Always sends `calendarProtocol: 2`; adds `calendarReplyTo {proposalId, revision}` when answering a Calendar clarification (hidden from transcript).
  - A monotonically increasing generation counter + `AbortController` makes stale stream/error/finally callbacks no-ops; stream events are dropped unless `envelope.sessionId/turnId/attemptId` match the submit response.
  - Session list reconcile: no GET on the send path; known rows reconcile after 250 ms idle (`SESSION_LIST_RECONCILE_IDLE_MS`), aborted on send/navigation/unmount.
  - `startSavePollEffect`: when active save is `pending|saving` and not streaming, poll after 1 s then every 2 s up to 10 checks (`getTurnStatus`, falling back to `listMessages(limit:1)` for live or `NOT_FOUND`).
  - `startRestoredBusyPollEffect`: after reload with a busy turn, poll every 1 s up to 15 checks; text uses `getTurnStatus`, live uses `listMessages`; reloads messages when terminal.
- Stream delta coalescer (`stream-delta-coalescer.ts`): `StreamDeltaCoalescer` with `attachTurn`, `bufferDelta(text, reset, ctx)`, `flush`, `drain`, `cancel`, `hasPending`; dispatches at most one `STREAM_DELTA` per animation frame with a bounded `setTimeout` fallback (32 ms with rAF, 16 ms without); preserves order, reset semantics and turn isolation; scheduler injectable via `ChatProvider scheduler` prop.

### 2.4 API clients and protocol guards (`src/api`)

All clients: base `VITE_API_BASE ?? '/api'`, `cache: 'no-store'`, `credentials: 'same-origin'` (cookie session); auth/admin/administration/calendar clients also `redirect: 'error'`, bounded JSON reads (fatal UTF-8), timeouts via `AbortSignal.any`. Guards use exact-key checks (`hasExactKeys`), bounded ids (1–128 chars), closed enums.

| Client (file) | Methods → endpoints | Limits / notes |
| --- | --- | --- |
| `ApiClient` (`client.ts`) | `listSessions({cursor,limit})` GET `/sessions`; `getSession` GET `/sessions/:id`; `updateSession` PATCH `/sessions/:id` `{title?, pinned?}`; `deleteSession` DELETE `/sessions/:id`; `listMessages(id,{cursor,limit})` GET `/sessions/:id/messages`; `submitTurn` POST `/sessions` (new chat, `sessionId:null`) or POST `/sessions/:id/turns`; `retryTurn` POST `/sessions/:sid/turns/:tid/retry`; `cancelTurn` POST `.../cancel` `{attemptId}`; `getTurnStatus` GET `/sessions/:sid/turns/:tid`; `retrySave` POST `.../retry-save` `{epoch, version}`; `connectTurnStream(streamPath)` GET `.../stream` (`Accept: text/event-stream`) | Error body `{code,message,retryable}` → `ApiClientError(code,message,status,retryable)`. Submission recovery persisted in `sessionStorage` key `aurvin:submission:v1:<base>` (`{pending, retry?, epoch}`, ≤200,000 chars); unknown-delivery submits/retries block new ones with `SUBMISSION_PENDING`/`SUBMISSION_UNKNOWN`; same request is re-sent with `expectedEpoch` = last `processEpoch`. 4xx (except `INTERRUPTED`) clears pending. |
| SSE reader (`connectTurnStream`) | Splits on newlines, skips blank and `:` comment lines, parses `data:` via `parseCalendarCompatibleFrame` | `completed` → `onComplete(outcome)`; `error` event → `onError`; EOF without terminal → `STREAM_INTERRUPTED` (EOF is not completion); errors `STREAM_CONNECT_FAILED`, `HTTP_<n>`, `NO_STREAM_BODY`, `INVALID_STREAM_ENVELOPE`, `STREAM_READ_ERROR`. |
| `AuthClient` (`auth-client.ts`, `auth-protocol.ts`) | `me` GET `/auth/me`; `login` POST `/auth/login`; `logout` POST `/auth/logout`; `changePassword` POST `/auth/password`; `forgotPassword` POST `/auth/forgot-password`; `resetPassword` POST `/auth/reset-password` | 30 s timeout, 64 KiB response cap. `AuthUser = {userId, email (lower-case), role: 'super-admin'|'user', passwordChangeRequired}`. Wire block delimited `// BEGIN AUTH WIRE … // END AUTH WIRE` (mirrored with backend). |
| `AdminConfigClient` (`admin-config-client.ts`, `admin-config-protocol.ts`) | `read` GET `/admin/config`; `saveSettings` PUT `/admin/config` `{protocolVersion:1, expectedRevision, settings}`; `updateCredential(provider)` POST `/admin/config/credentials/{openrouter\|deepgram}` `{…, action:'replace', candidate}` or `{…, action:'remove', confirm:true}` | 30 s timeout, 64 KiB response, request body ≤16,384 B, candidate ≤4,096 B; errors carry `currentRevision`, `fieldErrors[{path, code}]`, `uncertain` (write may have landed). |
| `AdministrationClient` (`administration-client.ts`) | `listUsers({limit≤50, cursor})` GET `/admin/users`; `createUser` POST `/admin/users` `{email, temporaryPassword, role:'user'}`; `deactivateUser`/`reactivateUser`/`sendPasswordReset` POST `/admin/users/:id/{deactivate,reactivate,password-reset}` | 30 s, 64 KiB; extra error codes `ACCOUNT_CONFLICT`, `ACCOUNT_NOT_FOUND`. |
| `CalendarClient` (`calendar-client.ts`, `calendar-protocol.ts`) | `getStatus` GET `/plugins/google-calendar/status`; `updateSettings` PATCH `/settings` `{enabled?, defaultSetting?{calendarId, expectedRevision, expectedConnectionRevision}}`; `startOAuth` POST `/oauth/start` `{}`; `disconnect` POST `/disconnect` `{mode:'local'}` or `{mode:'revoke-google-grant', acknowledgeProjectWideRevocation:true}`; `listCalendars({pageToken})` GET `/calendars`; `refreshCalendars` POST `/calendars/refresh` `{expectedConnectionRevision}` (all under `/plugins/google-calendar`) | 20 s timeout, 16 KiB response; mutations send header `X-Aurvin-Calendar-CSRF: 1`; `CalendarClientError.uncertain`. OAuth URL accepted only if origin `https://accounts.google.com` path `/o/oauth2/v2/auth`. |
| `VoiceHttpClient` (`voice-client.ts`) | `config` GET `/voice/config`; `create` POST `/voice/sessions` `{protocolVersion:1, mode, conversationId, locale:'en-US', idempotencyKey}`; `end` DELETE `/voice/sessions/:id` | Timeout = `DEFAULT_VOICE_LIMITS.connectMs` (10 s); response mode/conversation must match request. |
| `VoiceClient` (`voice-client.ts`) | WebSocket to `/api/voice` (http→ws, https→wss; only that exact path, no query/hash) | Dictation transport; see §6. |
| `LiveKitVoiceClient` (`livekit-voice-client.ts`) | LiveKit Room join using `livekit` block of session response | Live transport; see §6. |

Chat protocol (`protocol.ts`): `STREAM_PROTOCOL_VERSION = API_PROTOCOL_VERSION = 1`; `ATTEMPT_STATUSES = accepted, generating, finalizing, completed, truncated, failed, cancelled, interrupted`; `SubmitTurnRequest {sessionId|null, content (1..32,000), idempotencyKey (8..128), expectedEpoch?, calendarProtocol?: 2, calendarReplyTo?}`; `SubmitTurnResponse {sessionId, turnId, attemptId, userMessageId, streamPath (must equal turnStream route), processEpoch?}`; `VisibleMessage {messageId, turnId, eventId, sequence, role, content, createdAt, completionStatus, truncated, visibility?, mode?: 'text'|'live', voiceSessionId?, voiceDurationSeconds?, voiceTranscripts?, canvasArtifacts? (only on live assistant messages), calendarView?}`; `ListMessagesResponse {items, nextCursor, olderAvailable, save?, saveTurnId?, activeTurn?}`; `SaveStateSnapshot {state: pending|saving|saved|failed|unknown|fenced, epoch, version, durableVersion}`. Stream events: `turn-accepted`, `delta {text, reset?: true}`, `status`, `usage {accountingStatus, promptTokens, completionTokens, cost}`, `error {code ∈ APP_ERROR_CODES, message ≤500}`, `completed {assistantMessageId, outcome, save?, calendarView?}`. Calendar-compatible envelopes add protocolVersion 2/3 with `calendar-progress`, `calendar-operation`, `calendar-clarification`, `calendar-view`. `assertNoClientOverrides` throws if a request contains `userId, user, openRouterUser, model, modelId, apiKey, calendarId, accountId, connectionId, googleSubjectId, accessToken, refreshToken, clientSecret, authorization, serviceUrl`.

---

## 3. UI components and screens

### 3.1 ChatView (`features/chat/ChatView.tsx`)

Layout `div.aurvin-layout` (+ `-collapsed`, `-canvas-open`): `Sidebar` | mobile backdrop button | `main.aurvin-main` (header + body) | optional `CanvasPanel`.
- Header: "Open sidebar" toggle, "Start a new chat" icon; right side a **Canvas** button with artifact count when session has artifacts and live voice is not shown.
- Body: live voice active → `LiveVoicePanel`; else empty (`!activeSessionId && no messages && !streaming`) → `EmptyState` + centered `Composer`; else `Transcript` (with `CalendarTurnRegion` as child) + docked `Composer`.
- Save notices (`role=status`): pending "Answer ready. Waiting to save.", saving "Answer ready. Saving…", failed/unknown/fenced variants with **Retry saving** (failed/unknown) and **Copy conversation** (copies `role: content` lines incl. voice transcripts). Submission recovery banners: "The last submission has an unknown outcome…" → **Restore original draft** / **Allow a new attempt**; retry recovery → **Retry original request** / **Allow a new attempt**.
- Live voice notices auto-hide after 6 s when not in live mode. Footer disclaimer: "Aurvin can make mistakes. Check important information."
- New chat increments a greeting key so the empty state picks a new greeting; returning from admin focuses profile trigger / open-sidebar / composer.

### 3.2 Sidebar (`components/Sidebar.tsx`)

Brand (logo + "Aurvin"), close button, **New chat** button, session nav grouped by `Pinned` then activity: `Today`, `Yesterday`, `Previous 7 days`, `Previous 30 days`, then `Month YYYY` (by `lastActivityAt`; server order preserved). Selected row `aria-current="page"`, untitled → "Untitled Chat". Per-row `<details>` "•••" menu (Escape/blur closes): **Rename** (inline form, `maxLength 80`, required, Save/Cancel → PATCH title), **Delete** (disabled for selected row while turn busy; `ConfirmDialog` danger "Delete chat?"), **Pin/Unpin** (PATCH pinned). After mutation: dispatch + reload sessions. "Load more chats…" when `hasMoreSessions`. Footer `ProfileMenu`. Mobile (≤768 px): fixed slide-in drawer (`data-open`); desktop (≥769 px): collapsible.

### 3.3 ProfileMenu (`features/admin-config/ProfileMenu.tsx`)

`<details>` with logo mark, email (fallback "Super admin") and role label ("Super admin"/"User"). Menu: **Manage Aurvin**, **Sign out** (or disabled with "Authentication not enabled." if no handler). Closes on outside pointerdown, Escape, blur.

### 3.4 Transcript, MessageItem, Composer, EmptyState

- `Transcript`: `role="log"`, `aria-live="polite"`; "Load older messages" button when `olderAvailable`; messages pass through `hideCalendarConfirmReplies` (hides user confirm replies to Calendar confirmation prompts) and `groupVoiceMessages` (contiguous `voiceSessionId` messages → one pill). While streaming or a text turn is busy, renders an in-flight assistant `MessageItem` with id `streaming_in_flight` and `content=streamText`. `ScrollController` keeps the view pinned only when near bottom and shows jump-to-bottom. `PromptTraveler`: right-side tick rail of user prompts with hover magnification and popover; click scrolls prompt to top.
- `MessageItem`: voice message → pill "Voice Chat · <duration>" opening `VoiceTranscriptModal` (bubbles + Canvas cards, focus trap, Escape). User → plaintext bubble. Assistant → `SafeMarkdown` (streaming flag when status streaming/generating); "Generating…" placeholder only for live in-flight empty content (`message-presentation.ts`); badges: truncated "Response reached maximum length", "Cancelled", "Generation failed"/"Generation interrupted" + **Retry** (calls `retryTurn(turnId)`, not for voice). Copy button (1.8 s "Copied"). Assistant messages matching `/^Please confirm:\s*create\b/i` are re-phrased "I can create "<summary>" (<time>). Does this look good?".
- `Composer` (`docked` | `centered`): textarea "Ask Aurvin" autosizing to 200 px; Enter sends, Shift+Enter newline, IME-safe, Escape cancels dictation; read-only while a voice lease is held; Send disabled when empty/busy/over 32,000/voice-locked; while streaming (or a text turn busy with ids) the Send button becomes **Cancel response** (stop icon); char counter shown above 25,000 chars (`data-over`). Embeds `ComposerVoiceControls`.
- `EmptyState`: logo + random greeting from `EMPTY_GREETINGS` ("Where should we begin?", "What's on your mind?", "How can I help you today?", "What are you working on?", "What's on the agenda today?", "Ready when you are.").
- `ConfirmDialog` (`components/ConfirmDialog.tsx`, `confirm-dialog.css`): modal with focus trap, Escape, backdrop blur, variants `danger|warning|primary`, `busy`/`busyLabel`. Used for session delete, user deactivate, admin discard.
- `icons.tsx`: inline SVG icons (Sidebar, NewChat, Send, Stop, ChevronDown, Microphone, Waveform, Copy, Check, Edit, Trash, Pin).

### 3.5 Turn status UX summary

New Chat is unsaved until the first accepted message (`POST /sessions` with `sessionId:null`); a voice call on an unsaved chat creates the conversation only when a live turn is accepted (`conversation.bound`). Streamed text is provisional; completion is only on the `completed` event; EOF → interrupted state with Retry. Cancel is best-effort POST `.../cancel`. Retry creates a new attempt for the same turn (new idempotency key). Save state is shown separately from generation outcome.

### 3.6 Auth screens (`features/auth`, `auth.css`)

| Screen | Content |
| --- | --- |
| `LoginForm` | "Sign in to Aurvin", email + password, "Signing in…", link to forgot password |
| `ForgotPasswordForm` | "Reset your password", email, "Send recovery email", enumeration-safe confirmation, back to login |
| `ResetPasswordForm` | token from `?token=`; new + confirm (min 10), "Update password" |
| `MandatoryPasswordChangeForm` | current temporary + new + confirm (min 10, must differ, must match), sign-out option |

### 3.7 Manage Aurvin dashboard (`features/admin-config`)

- Header: **Back to chat** (disabled while mutating; dirty → ConfirmDialog "Discard unsaved changes?"), `h1` "Manage Aurvin" (focused on mount), "Chat/voice continues in the background" when chat active. `beforeunload` guard while dirty/pending.
- Tabs (ARIA tablist, Arrow/Home/End): super-admin `Config`, `Plugins`, `Analytics` (empty panel), `Administration`; role `user` sees only `Plugins` (no config read).
- Config sections: `OpenRouter`, `Chat limits`, `Voice`, `Deepgram`. Fields from `editableFields` catalog (`config-edit-state.ts`), grouped e.g. OpenRouter "Model ID"; chat "Input and context" (input chars/tokens, messages in context, context tokens, output tokens, model safety margin, title chars), "Admission and retries" (concurrent responses, requests/min/user, max attempts 1–3, retry delays), "Deadlines" (first output, stream idle, total timeout); voice "Modes and duration" (Dictation enabled, Live voice enabled, durations, warnings), "Advanced timing and queues", "Quotas"; Deepgram region `us|eu`, TTS voice `flux-haley-en|flux-alexis-en|flux-priya-en`, endpointing, keyterms, EOT, rates. Fixed policy text: data collection deny, transforms disabled.
- Save: client-side conversion/validation → field errors summary (focus first invalid field) → PUT with `expectedRevision`; then `refreshCapabilities()` (re-GET `/voice/config`); if that fails: "Saved. Voice availability could not be refreshed…" + **Retry voice refresh**. **Reload saved settings** (confirm discard). Editing locks while pending/stale/uncertain.
- `CredentialRow` (OpenRouter, Deepgram): "Configured" + fixed eight-dot mask or "Not configured"; **Replace key** → password input → **Validate and save** (single backend validation, auto-persist); **Remove key** → **Confirm removal**; notice that active work is not cancelled. Candidate kept only in row-local state.
- `AdministrationPanel`: "User administration" table (Email, Role, Status, Created, Actions), super admin rows "Protected", Deactivate (confirm) / Reactivate / send password reset, keyset "Load more users"; `CreateUserDialog` (email, masked temporary password, role fixed `User`, cleared on submit/exit; conflict → "An account with this email address already exists.").
- Plugins → Google Calendar: `GoogleCalendarPanel` (heading "Google Calendar (embedded MCP)"): status (Not configured on server / Not connected / Connected Google account …), **Connect/Reconnect Google Calendar** (navigates only to safe Google OAuth URL), **Enable/Disable**, disconnect locally vs **Revoke Google grant and disconnect** (both confirmed), "External processing & privacy" disclosure, `CalendarDefaults` paged picker ("Use primary automatically", roles, capabilities, stale/partial warnings, CAS save with revision conflict messages), refresh discovery. State in `calendar-setup-state.ts` reducer (request/revision fencing, non-optimistic).

### 3.8 CalendarTurnRegion (`features/plugins/google-calendar/CalendarTurnRegion.tsx`)

Inline in transcript: progress lines ("Validating Calendar request…", "Correcting…", "Running Calendar action…", "Reconciling Calendar outcome…"), operation cards (created with durable receipt event id, safe `htmlLink`, unexpired calendar label; uncertain/failed/expired/reconnect messages; retry resumes same event id), clarification cards ("Choose a calendar", "Confirm this event", "Clarify in composer"; answers sent as hidden submit with `calendarReplyTo`), manual "open in Canvas" entries. Text-chat Calendar views never auto-open Canvas; live voice ones do.

---

## 4. Markdown rendering and safety (`features/chat/markdown`)

- `parse-markdown.ts` (`parseMarkdown(md, onStablePrefix?)`): zero-dependency line tokenizer, CRLF-normalized. Tokens: `heading` (`#`×1–6), `code_block` (``` fences; **unclosed fence emitted as code while streaming**), `math_block` (`\[ … \]` or `$$ … $$`, single or multi-line), `blockquote` (`>` per line), `bullet_list` (`-*+`), `ordered_list` (`1.`/`1)`), `paragraph` (one per non-empty line). No tables, nested lists, or HTML. Reports a stable prefix (chars/tokens before any open construct) for incremental reuse.
- `safe-markdown.tsx` (`SafeMarkdown {content, messageId, isStreaming, activeArtifactId, onOpenArtifact}`): uses `prepareCanvasMarkdown` (shared cache) then renders tokens as React elements; **never `dangerouslySetInnerHTML`**. Code blocks: language header + `<pre><code>`. Canvas-eligible fences render as `CanvasArtifactCard`. Inline: `` `code` ``, `***bold italic***`, `**bold**`, `*italic*`, links `[text](url)` → `<a target="_blank" rel="noopener noreferrer" class="aurvin-link">` only if `sanitizeUrl` passes, else plain span. Mini TeX renderer for inline `\( \)`, `\[ \]`, `$…$`, `$$…$$`: Greek/symbol map, `\frac`, `\sqrt`, `\text`/`\mathrm`, bold/italic, `\mathbb{R,N,Z,Q,C}`, function names, sizing commands ignored. Token components are memoized so streaming appends do not re-render stable prefix.
- `sanitize-url.ts`: trims; allows relative `/…` and `#…`; otherwise `new URL()` with protocol in `{http:, https:, mailto:}`; else `''`.

---

## 5. Canvas (`features/canvas`)

### 5.1 Model

`CanvasArtifact {artifactId, messageId, index, kind: 'mermaid'|'chart'|'svg'|'calendar', subType, title, buttonLabel, rawSource, isStreaming, turnId?, calendarView?, calendarWorkspace?, calendarAliases?}`; id format `<messageId>::canvas::<index>`. Wire projection for live voice (`voice-protocol.ts`): `CanvasArtifactProjection {ordinal, kind, subType, title, rawSource, responseId}`; limits `CANVAS_ARTIFACT_LIMITS`: source ≤8,192 chars/16,384 B, title ≤120 chars, subType ≤48, ≤3 artifacts per response, response source ≤16,384 chars, projection ≤32,768 B.

### 5.2 Extraction (`canvas-artifacts.ts`)

- `preprocessCanvasTags`: `<aurvin-canvas attrs>body</aurvin-canvas>` → ```` ```canvas attrs ```` fence; an unclosed trailing tag becomes an open fence (streaming).
- `parseCanvasCodeBlock(lang, code, …)` classification by first info token: `mermaid|mmd` → mermaid; `chart|graph|plot|scatter|xy|xy-plot|line-graph|bar-chart|line-chart|pie-chart|area-chart` → chart (plot/scatter/xy → scatter; `graph` → JSON `type` or line); `svg`; `calendar|event`; `canvas` with `type=` attr (`mermaid|diagram|flowchart`, `calendar|event`, chart kinds, `svg`) or sniffed (Mermaid header regex, `<svg`, else chart); `json` with chart-shaped (`type` + `datasets|data|points`) or event-shaped (`summary|calendarLabel|calendarId` + `start|htmlLink|eventId`) objects; bare fence starting with a Mermaid header. Attributes `title="…"`, `type=…` (quoted or bare); trailing plain text after the token becomes the title.
- Mermaid header regex: optional `---` front matter then `flowchart|graph|sequenceDiagram|stateDiagram(-v2)|classDiagram|erDiagram|pie|xychart-beta|quadrantChart|gantt|mindmap`; `%%` comments stripped; title from front matter, `title`/`accTitle` directive or `pie title`.
- Chart parsing `parseChartSource`: (1) JSON object/array (Chart.js-like `labels/datasets`, `points`, `type`), (2) Mermaid `pie`, `quadrantChart` (axes, `quadrant-1..4` labels), `xychart-beta`, (3) `(x, y)` coordinate pairs or `Label: 123` lines, with `type:` line. Chart kinds `bar|line|area|pie|scatter`; subTypes Bar Chart / Line Graph / Area Graph / Pie Chart / X-Y Point Plot / Coordinate Graph; button "View chart"/"View graph"/"View diagram"/"View calendar event".
- `prepareCanvasMarkdown`: shared LRU-ish cache ≤32 entries / 256 Ki chars keyed by `[messageId, isStreaming]`, reusing the stable token prefix (`ponytail:` comment documents ceiling).
- Session aggregation: `collectSessionCanvasArtifacts` (text messages + voice projections + Calendar views), `mergeSessionCanvasArtifacts`, `projectionToCanvasArtifact` (drops projections whose parsed model is empty), `extractVoiceMessageCanvasArtifacts`, `claimNewAutoOpenArtifactId` (first unseen live projection).

### 5.3 Renderers (all pure React SVG, no external libs)

| Renderer | Behavior |
| --- | --- |
| `mermaid-renderer.tsx` | `parseMermaidSource`: pie/xychart/quadrant → chart model; `sequenceDiagram` → participants/messages (dashed)/notes; otherwise flowchart parser (`flowchart|graph TD/TB/BT/LR/RL`, node shapes rect/rounded/stadium/diamond/circle/cylinder/subroutine/state start/end, edges solid/dashed/thick/open with labels, subgraphs). Topological rank layout, Bezier edges. Other headers (state/class/er/gantt/mindmap) get metadata but render via the generic flowchart path; fidelity **unclear**. Fallback "Generating diagram…" + source while incomplete. |
| `chart-renderer.tsx` | Bar/line/area cartesian with axes + gridlines, X-Y coordinate/scatter (optional lines, quadrant labels), pie/donut with center summary + legend. |
| `svg-renderer.tsx` | Strips `<script>`/`<foreignObject>`, parses tags against allowlist, drops `on*`, `href`, `xlink:href`, `style`, values with `javascript:/data:/vbscript:`, unsafe paint `url()` refs; builds React nodes. |
| `calendar-event-renderer.tsx` | Google-Calendar-styled card (tear-off date sheet, duration, status badge, mini day schedule, CTA via `resolveSafeCalendarLink`: https on `calendar.google.com`/`www.google.com`/`google.com`). |
| `calendar-view-renderer.tsx` / `calendar-agenda-view.tsx` | Structured `CalendarView` kinds `agenda` (day-grouped, Intl time zones, all-day exclusive ends, expiry), `proposal` (review card; Accept/Reject/Select calendar only for the current live proposal), `outcome`, `notice`; one bounded expiry timer; `CalendarViewBoundary` error boundary. |

### 5.4 CanvasPanel (`CanvasPanel.tsx`) and ChatView rules

- `aside#aurvin-canvas-panel` "Aurvin's Canvas", `data-canvas-state=open|exiting`. Tab strip (`role=tablist`) with per-tab close; **Expand canvas / Restore split view** (maximize); **Close canvas**.
- Toolbar (non-calendar): Preview/Code mode group; zoom 25–300 % step 25 with reset ("Reset zoom and center"), wheel zoom (`computeWheelZoomView`, native wheel `passive:false`), drag pan; Code view with line numbers; **Copy artifact source** (raw source); **Download artifact**: in preview, serializes rendered `<svg>` (adds xmlns) as `.svg`, else raw source as `.mmd|.svg|.json`; filename slug of title; path label `canvas/<slug>.<mmd|svg|chart.json|event.json>`.
- Calendar artifacts: scrollable body only (no zoom/source/copy/download).
- Open/close: header Canvas toggle opens last active or most recent artifact; closing tabs records `closedCanvasArtifactIds`; closing last tab/panel snapshots for a 320 ms exit animation (`CANVAS_TRANSITION_MS`) unless `prefers-reduced-motion`; focus restored (live toggle → live surface → header toggle → composer).
- Auto-open: new live-voice projections auto-open; live Calendar workspaces auto-open once per call (`claimCalendarAutoOpenId`, seen sets reset on session change/new call); **text Calendar stays manual**. Alt+C toggles Canvas in live mode (`handleLiveCanvasShortcut`).
- Calendar workspaces (`calendar-workspace.ts`): `foldCalendarFrame` correlates live `calendar.frame` events by intent/proposal/operation into bounded `CalendarWorkspace` records; `freezeCalendarControls` makes them read-only; controls disabled unless live, same conversation, connected, agent not thinking, input not busy.
- Responsive (`styles/chat.css`): 901–1120 px → sidebar 220 px, panel `clamp(380px, 44vw, 50vw)`; ≤900 px → panel fixed full-screen overlay (`z-index 40`).

---

## 6. Voice UI (`features/voice`, `api/voice-*`, `api/livekit-voice-client.ts`)

### 6.1 Capability discovery

`voice-capabilities.ts`: singleton store over `VoiceHttpClient.config()` → GET `/api/voice/config` returning `PublicVoiceConfig {protocolVersion:1, enabledModes{dictation, live}, supportedLocales:['en-US'], limits, inputAudio, outputAudio}`; snapshot frozen; latest-request fencing; failure publishes `null` (buttons hidden). `useVoiceCapabilities()` subscribes via `useSyncExternalStore` and calls `ensureLoaded`. `refreshVoiceCapabilities()` is called after admin saves. Composer shows mic button only if `enabledModes.dictation`, waveform only if `enabledModes.live`. Live also requires `supportsLiveVoice()`: `isSecureContext`, `navigator.mediaDevices.getUserMedia`, `RTCPeerConnection`.

### 6.2 Dictation

- `useDictation({textareaRef, draft, conversationId, bindings})` builds a `DictationController` with ports `AudioCaptureService`, `VoiceClient`, `VoiceHttpClient`; `visibilitychange`/`pagehide` disconnect (`DICTATION_FOREGROUND_REQUIRED`); restores textarea selection.
- `DictationController` phases `idle → requesting_permission → connecting → recording → finalizing → draft_ready`. Claims chat voice lease (`claimVoiceInput('dictation')`), snapshots draft selection (`dictation-draft.ts`: prefix/suffix preserved, selected text replaced by final+interim segments, max 32,000 chars), POST `/voice/sessions` mode `dictation`, opens WebSocket, streams PCM, writes draft via `writeVoiceDraft(token, text)`; Stop sends `dictation.stop` and waits for `dictation.complete`; Cancel sends `dictation.cancel`. **Dictation never submits**; user presses Send.
- Wire (`VoiceClient`): JSON control envelopes `{protocolVersion:1, sessionId, connectionEpoch, eventId (UUID), sequence, …payload}` validated by `parseVoiceControl`; first message `session.start {mode, audioSettings: INPUT_AUDIO}`; server events `session.ready`, `dictation.partial/final/complete`, `session.warning/error/ended`, etc. Binary audio frames (`voice-audio.ts`): 16-byte header `[0xAF, 1, kind(1=input,2=output), flags(0|1 final)]`, LE uint32 `sequence`, `offsetMs`, `pcmLength`; input PCM exactly 2,560 B (80 ms @16 kHz mono s16le) except final ≤2,560; output ≤9,600 B. Backpressure budget from `limits.inputQueueMs`; connect timeout `limits.connectMs`; bounded reconnect/reauthorize; ≤4,096 response ids per client (`ponytail:`).

### 6.3 Audio pipeline

| File | Role |
| --- | --- |
| `audio-capture-service.ts` | Gesture-started `getUserMedia` + `AudioContext` + AudioWorklet (`aurvin-capture`, loaded via Vite `?worker&url`), mute revisions, stop. |
| `audio-capture-processor.ts` | Worklet: resample to 16 kHz, post transferable 80 ms PCM16 frames, backpressure, drain/reset; optional live gate. |
| `pcm-resampler.ts` | Stateful anti-alias FIR + fractional resampler, downmix, s16le packing, 1,280-sample frames. |
| `audio-capture-gate.ts` / `audio-capture-vad.ts` / `embedded-vad.d.ts` | Five-second non-speech upload gate with 320 ms pre-roll; WebRTC VAD (`@ozymandiasthegreat/vad/lib/embedded.js`, AGGRESSIVE, 16 kHz, four 20 ms windows per frame); failure → `MEDIA_GATE_UNAVAILABLE`. `audio-capture-vad.NOTICES.md` holds third-party notices. Used by the PCM capture path; live now runs over LiveKit, so whether the gate is active in any shipped mode is **unclear**. |
| `audio-playback-service.ts` | 24 kHz PCM Web Audio scheduler, played/consumed sample tracking, queue limit, interruption, gesture unlock (legacy PCM path). |
| `live-track-playback.ts` | Owns attached LiveKit remote audio track; fresh element per response; played-sample cursor bounded by server `audio.watermark`/`audio.end`. |

### 6.4 Live voice

- Transport `LiveKitVoiceClient`: POST `/voice/sessions` mode `live` → response with `livekit {url (wss), roomName ('aurvin-live-…'), participantIdentity, participantToken (JWT, TTL ≤30 s)}`; joins `Room` (SDK auto-reconnect disabled: `nextRetryDelayInMs: () => null`), publishes one native mic track (Opus 48 kHz), subscribes to agent (`aurvin-agent:<sessionId>`) audio; Aurvin control messages go over reliable data channel topic `aurvin.voice.control`, chunked (packet ≤15,360 B, chunk ≤14,336 B, ≤16 chunks, message ≤131,072 B, reassembly 5 s, ≤2 in flight); bounded reconnect within `limits.reconnectMs` with reauthorization; teardown ≤2 s. No WebSocket fallback.
- `LiveVoiceController` (`state/live-voice-controller.ts`) + `liveVoiceReducer`: `LiveVoiceState {phase: idle|requesting_permission|connecting|active|suspended|ending, input: listening|muted|suspended, agent: idle|thinking|speaking, connection: connecting|connected|reconnecting|disconnected, response, resumeRequired, inputBusy, canResume, errorCode, notice, restoreDraft, conversationId, artifacts, calendarWorkspaces}` (no transcript field). Handles server events `session.ready`, `conversation.bound` (binds chat via `BIND_VOICE_CONVERSATION`), `canvas.artifact`, `calendar.frame`, `voice.state`, `audio.start/watermark/end`, `response.cancelled`, `session.warning` (`resume_gesture` → pause), `session.error`, `session.ended` (refresh sessions, commit voice session pill, reload messages). Paused calls require **Resume voice** (no auto hang-up); notices such as "Voice paused. Select Resume voice; repeat any speech lost during the interruption." Live Calendar answers sent as `calendar.confirm {proposalId, proposalRevision, answer: accept|reject|select calendarId}`.
- Lifecycle (`live-voice-lifecycle.ts`): `visibilitychange` hidden/`freeze` → suspend; `pagehide` → exit; unmount → exit. Shortcuts (not inside inputs): **Alt+M** mute/unmute, **Escape** stop speaking (interrupt), **Alt+X** hang up, **Alt+C** Canvas toggle. Draft and caret restored on exit (`restoreLiveDraftFocus`).
- UI: `LiveVoicePanel` (region "Live voice conversation", sr-only `aria-live` status, **Resume voice**), `LiveVoiceBubble` (SVG dotted baseline morphing into waveform, ~60 fps smoothing), `LiveVoiceControls` (Mute/Unmute, **Stop speaking**, Canvas pill with count, **Hang up**). Composer and transcript are hidden while live.

---

## 7. Styling

| File | Scope |
| --- | --- |
| `src/index.css` | Design tokens on `:root` (dark default, `color-scheme: dark`) + light override via `prefers-color-scheme: light`; reset (`box-sizing`, full-height `html/body/#root`, `body overflow:hidden`), `:focus-visible` 2 px accent outline, `.sr-only`. |
| `src/App.css` | `#root` min-height `100svh`, `.aurvin-chat-surface[hidden]`, `.aurvin-auth-loading`. |
| `src/styles/chat.css` (2,468 lines) | Layout, sidebar (260 px), header, transcript, messages, composer, markdown/math, status badges, Canvas panel + renderers (`--aurvin-canvas-*` locals), PromptTraveler, save notices; breakpoints 600/768/769/900/901–1120 px; reduced-motion and light-theme blocks. Imported by `features/chat/index.ts`. |
| `src/styles/scrollbars.css` + `scroll-reveal.ts` | Thin overlay scrollbars revealed on hover via a JS-set attribute (Chromium caches `::-webkit-scrollbar-thumb`, so `:hover` alone does not work). Imported last in `main.tsx`. |
| `components/confirm-dialog.css`, `features/admin-config/admin-config.css`, `features/auth/auth.css`, `features/plugins/google-calendar/calendar-plugin.css`, `features/voice/dictation/composer-voice-controls.css`, `features/voice/live/live-voice.css` | Feature-local styles imported by their components. |

Tokens (dark → light): `--aurvin-bg #000 → #fff`, `--aurvin-surface #000 → #f9f9f9`, `--aurvin-surface-elevated #2f2f2f → #f4f4f4`, `--aurvin-hover`, `--aurvin-selected`, `--aurvin-border rgba(255,255,255,.1) → rgba(0,0,0,.1)`, `--aurvin-text-primary #ececec → #0d0d0d`, `--aurvin-text-secondary #afafaf → #8f8f8f`, `--aurvin-primary #fff → #0d0d0d`, `--aurvin-primary-hover`, `--aurvin-danger #f87171 → #dc2626`, `--aurvin-warning #fbbf24 → #d97706`, `--aurvin-surface-elevated #303030 → #fff`, `--aurvin-shadow-composer`, `--aurvin-user-bubble #323232 → #f4f4f4`, `--aurvin-primary/fg`, `--aurvin-disabled-bg/fg`, `--aurvin-hover-strong`, `--aurvin-code-bg #0d0d0d → #f4f4f4`, `--aurvin-font` (system UI stack), `--aurvin-mono`. Visual target is a ChatGPT-like dark shell. All class names are prefixed `aurvin-`.

---

## 8. Rebuild notes, invariants and gotchas

1. **Browser config is only `VITE_API_BASE=/api`.** Never place keys, user id, model, Deepgram/LiveKit/Calendar values or mode flags in `VITE_*`. Voice modes come only from GET `/api/voice/config`; identity only from the server session cookie (`credentials: 'same-origin'`).
2. **Client never sends identity/model/credential overrides**; `assertNoClientOverrides` and exact-key guards enforce request shape; responses are validated before use (unknown keys rejected).
3. **New Chat is local-only** until first accepted turn (`POST /api/sessions`); deleting/renaming are PATCH/DELETE on `/sessions/:id`.
4. **Streaming is provisional**: only the `completed` SSE event finalizes; EOF without terminal is "interrupted"; render deltas through the coalescer (one dispatch per frame).
5. **Idempotency**: UUID per submit/retry; unknown-outcome submissions persist in `sessionStorage` and block duplicate sends until the user restores or explicitly allows a new attempt (charge warning). Clear it on sign-out.
6. **One active generation per session** in the UI: Send disabled while submitting/streaming/accepted/generating/finalizing or while a voice lease exists; voice lease token gates draft writes.
7. **Vite proxy must keep `ws: true`** and the NOT_READY 503 shim; a backend port change requires `PORT` and `BACKEND_PROXY_TARGET` (and `FRONTEND_ORIGIN` for CORS) to change together. `run.bat` uses 8001/5179; manual dev uses 3000/5173.
8. **No HTML injection anywhere**: Markdown, SVG, Mermaid, charts and Calendar are rendered as React elements; links pass `sanitizeUrl`; OAuth and Calendar links pass host allowlists.
9. **Live voice requires a secure context and reachable `wss://` LiveKit**; there is no WebSocket fallback for live. `/api/voice` WebSocket is dictation-only and must be proxied with upgrade headers and long read timeout (1260 s in NGINX).
10. ChatView stays mounted under the admin page (hidden + `inert`); do not unmount it or active voice/streams restart.
11. Tests run in Node without DOM; component tests use `react-dom/server`. Keep tests as `src/**/*.test.ts`. Browser fixtures are separate Vite HTML pages.
12. Backend uses `.js` import specifiers; frontend uses `.ts/.tsx` specifiers. Mixing them breaks `tsc -b`/Nest build.
13. Fixed assets `backend/src/instructions/system.md` and root `product_knowledge.md` are read from the checkout at runtime (not copied to `dist`); keep the full checkout layout.
14. Documentation drift observed: `AGENTS.md` says Phase 1 `verification.md`/`final_report.md` are absent (they exist); `MandatoryPasswordChangeForm.tsx` header says 8+ characters while code/UI enforce 10 (one input still has `minLength={8}`); README says "no application authentication" while the frontend implements WorkOS-backed login, roles and user administration (`docs/workos-authentication`). Treat source as truth.
15. Duplicate fixture `features/admin-config/integration-tests/dashboard-browser.tsx` mirrors `testing/dashboard-browser.tsx`; `@ozymandiasthegreat/vad` is pinned exactly at 2.0.7 because a hand-written `.d.ts` targets its `lib/embedded.js` subpath.
16. Render deployment template references `/app/backend` and NGINX config paths but no Dockerfile is tracked; how the frontend bundle is served there is **unclear**.

---

# Part 4 — Proposed feature roadmap (not yet built)

These features are proposals. None is implemented in the source checkout. In the original codebase, Canvas already supports Copy source and SVG/`.mmd`/`.json` download.

**Effort:** S = small, M = medium, L = large, XL = new infrastructure.
**Groundwork:** ✅ mostly exists · 🟡 partly exists · ⬜ new.

## 4.1 Finish what's half-built

| # | Feature | Effort | Groundwork | Notes |
| --- | --- | --- | --- | --- |
| 1 | Analytics dashboard in Manage Aurvin | S–M | ✅ | The tab exists but is empty. Cost, token and voice usage are already in MongoDB. |
| 2 | Edit, reschedule and delete calendar events | M | ✅ | Reuse the proposal and confirmation flow. |
| 3 | Session search by title and message text | S | 🟡 | Rename and delete already exist. |
| 4 | Edit message and regenerate | S–M | ✅ | Builds on explicit retry. |
| 5 | Export or share a chat as Markdown or PDF | S | ✅ | See #48. |
| 6 | Thumbs up/down feedback on replies | S | ✅ | Store in `metadata`. |

## 4.2 Canvas

| # | Feature | Effort | Groundwork | Notes |
| --- | --- | --- | --- | --- |
| 7 | PNG export and printing | S | ✅ | Copy and SVG download already exist. |
| 8 | "Ask about this": click a node, chart point or event to fill the composer | S | ✅ | Visual source is already in follow-up context. |
| 9 | Data tables (`table` kind): sort, filter, "chart this" | M | 🟡 | Also previews spreadsheets (#50). |
| 10 | Fill in diagram types: gantt, ER, class, mindmap, quadrant | M | 🟡 | They're detected, but rendering fidelity is unconfirmed. |
| 11 | Free/busy timeline from availability checks | M | ✅ | |
| 12 | Day and week calendar grid | M | ✅ | |
| 13 | Conflict highlighting on event confirmation cards | S | ✅ | |
| 14 | Editable documents and drafts | L | ⬜ | Needs revision tracking. |
| 15 | Code and diff viewer | M | ⬜ | |
| 16 | Math rendering (KaTeX) | S–M | ⬜ | |
| 17 | Live browser workspace: screenshot, URL and step log | M | 🟡 | For #30–31. |
| 18 | Sandboxed HTML/React apps | L | ⬜ | Requires changing the "no arbitrary HTML/JS" rule. |
| 19 | Maps | M | ⬜ | Needs external tiles. |

## 4.3 Memory and long conversations

| # | Feature | Effort | Groundwork | Notes |
| --- | --- | --- | --- | --- |
| 20 | Automatic compaction and summaries | L | 🟡 | Removes the "context full, start a new chat" dead end. |
| 21 | Memory across chats | L | 🟡 | |
| 22 | Search across past chats using embeddings | L | 🟡 | |

## 4.4 Tools and plugins

| # | Feature | Effort | Groundwork | Notes |
| --- | --- | --- | --- | --- |
| 23 | **General tool registry and loop (prerequisite)** | M–L | 🟡 | The current loop only handles Calendar, one call per round. |
| 24 | Web search | S | 🟡 | OpenRouter's built-in web search. |
| 25 | Read page / fetch URL | S–M | ⬜ | Size limits; block internal network addresses. |
| 26 | Email plugin (Gmail or Outlook) with confirm before send | L | 🟡 | |
| 27 | Drive or OneDrive documents | L | 🟡 | |
| 28 | Task trackers (Jira, Linear, Asana) | M–L | 🟡 | |
| 29 | MCP client | L | 🟡 | |

## 4.5 Browser use and computer use

| # | Feature | Effort | Groundwork | Notes |
| --- | --- | --- | --- | --- |
| 30 | Read-only browser agent (Playwright in a sandbox, reads the page as text) | L | ⬜ | |
| 31 | Browser actions with confirmation | M | ✅ | Reuses the proposal flow. |
| 32 | Hand over for logins | M | ⬜ | Aurvin never stores passwords. |
| 33 | Browser limits: steps, time, cost, domains | S–M | ✅ | |
| 34 | Full computer use (vision, VM) | XL | ⬜ | Only for a concrete desktop-app use case. |
| 35 | Image support in model requests | M | ⬜ | |

## 4.6 Documents and files

| # | Feature | Effort | Groundwork | Notes |
| --- | --- | --- | --- | --- |
| 48 | Markdown download (single reply or whole chat) | S | ✅ | Reuses the Canvas Blob download. |
| 49 | Word (.docx) generator | M | ⬜ | JSON outline built with `docx`; Canvas preview. |
| 50 | Excel (.xlsx) generator | M | 🟡 | JSON outline built with `exceljs`; table preview. |
| 51 | PowerPoint (.pptx) generator | M–L | 🟡 | JSON outline built with `pptxgenjs`; slide thumbnails. |

## 4.7 Code execution

| # | Feature | Effort | Groundwork | Notes |
| --- | --- | --- | --- | --- |
| 52 | Code-agent loop: write, run, read output, fix, rerun | M | 🟡 | Needs #23. Every run saved as a tool event. |
| 53 | In-browser code runner (Pyodide, or JS in a sandboxed iframe or Web Worker) | M–L | ⬜ | Output in Canvas, no server setup. |
| 54 | Server-side code sandbox (container or microVM) | XL | ⬜ | Never on the backend host. |
| 55 | Live app preview in Canvas | L | ⬜ | |
| 56 | Script-generated documents (Python produces Word, Excel or PowerPoint) | M | ⬜ | Needs #54. |

## 4.8 Agent capabilities, voice and experience

| # | Feature | Effort | Groundwork | Notes |
| --- | --- | --- | --- | --- |
| 37 | File and image uploads | L | ⬜ | |
| 38 | Deep-research mode with a cited report | L | 🟡 | |
| 39 | Reminders and scheduled tasks | XL | ⬜ | Needs a job scheduler. |
| 40 | Scheduled web monitoring | M | ⬜ | |
| 41 | Multiple languages for voice | M | 🟡 | |
| 42 | Model picker | M | ⬜ | Deliberately excluded so far. |

(#36 "Code-execution sandbox" was replaced by #52–56.)

## 4.9 Groundwork for a wider rollout (not features)

| # | Item |
| --- | --- |
| 43 | Browser end-to-end tests (several browser checks were never run) |
| 44 | Azure database certification |
| 45 | Live voice and LiveKit drills |
| 46 | Public access-control decision |
| 47 | Sandbox infrastructure (shared by #30, #34, #54, #55) |

## 4.10 Recommended order

| Wave | Items |
| --- | --- |
| 1. Quick wins | #48, #7, #1, #8, #3, #11 |
| 2. Foundation | #23, #24, #25, #43 |
| 3. Documents | #49, #50 with #9, #51 |
| 4. Big UX gap | #20 |
| 5. Everyday tools | #2, #26 |
| 6. Code in the browser | #52, #53, #15 |
| 7. Agent power | #47, #54, #55, #30–33 with #17 |
| 8. Later | #21–22, #29, #37, #38, #39–40, #14, #56 |
| Only on demand | #34, #18, #19, #42 |
