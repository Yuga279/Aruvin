Build the configuration foundation, not the dashboard or its service. MongoDB will own manageable settings; a separate backend-only bootstrap object will own infrastructure, storage safety and the encryption master key. Add strict schemas, redacted HTTP contracts and operation-stable snapshot ports before downstream workers change consumption. Use existing TypeScript/NodeNext, Zod 3, Vitest and Node primitives; add no dependencies.

Written scope: [goal.md](goal.md). Ownership/dependencies: [state.md](state.md). Research and unified review are **skipped**, not passed. This plan authorizes implementation only when assigned to the P1 worker; it does not authorize executing import, contacting providers, provisioning or deployment.

## Ownership and implementation boundary

Create:

- `backend/src/contracts/admin-config-wire.ts`: dependency-free public types, routes, fixed policy/validation limits and exact response guards; contains no bootstrap, encryption or runtime-secret types.
- `backend/src/contracts/admin-config.ts`: Zod settings, admin request/response and bounded stored-document schemas.
- `backend/src/contracts/config-runtime.ts`: backend-only credential, snapshot, repository and activation interfaces.
- `backend/src/contracts/admin-config.spec.ts`: schema, request, storage and frontend-mirror parity checks.
- `backend/src/contracts/config-runtime.spec.ts`: compile-time port examples and snapshot contract checks.
- `backend/src/platform/config/bootstrap-config.ts` and `bootstrap-config.spec.ts`: infrastructure-only parsing, master-key state and obsolete-name warning construction.
- `backend/src/platform/config/manageable-config.ts` and `manageable-config.spec.ts`: safe settings defaults, bootstrap-dependent validation, runtime projection and detached/frozen snapshots.
- `backend/src/platform/config/legacy-config-import.ts` and `legacy-config-import.spec.ts`: explicit legacy environment-to-settings projection for the future import command, without network/storage side effects.
- `frontend/src/api/admin-config-protocol.ts`: public mirror only, with browser-safe runtime guards.

Modify only feature-related portions of:

- `backend/src/contracts/budgets.ts`: expose the existing unrefined object schema so settings can pick its fields before refinements; preserve existing `budgetConfigSchema` behavior.
- `backend/src/contracts/index.ts`: export the three new contract modules.
- `backend/src/contracts/collections.ts` and `persistence-profile.spec.ts`: add the approved seventh collection, `config`; preserve all existing six names.
- `backend/src/platform/config/load-config.ts`, `voice-config.ts` and matching existing specs: compatibility documentation/type re-exports and factoring only; keep existing fixture interfaces usable until their owners migrate callers.

Do not edit `platform.module.ts`, `platform/index.ts`, identity/tokens, `app.*`, `main.ts`, model/context/runtime/voice implementation, persistence, dashboard/client, `.env.example`, README, state or goal. P6 owns production assembly/documentation; P2 owns storage/API/crypto/provider verification; P3/P4 own runtime behavior; P5 owns UI/client. Do not add a package script now. P6 requests a named P1 package-file change for its import script after the script path exists, or runs `node dist/scripts/import-config.js` without changing manifests.

Every implementation step below is one small action. Split a table-driven group into several failing-test/run/implementation/run cycles if it exceeds five minutes. Commit only passing atomic groups, with an orchestrator-granted index turn and explicitly named files. Sample code intentionally omits documentation/file-header boilerplate.

## Current-source findings that affect the plan

- `load-config.ts` currently mixes all chat budgets and credentials with MongoDB settings. `voice-config.ts` currently parses all voice/Deepgram settings from env.
- `platform.module.ts` calls `loadConfig(process.env)`; `AppService` holds one startup `AurvinConfig`. P1 cannot remove this call without crossing P6 ownership. The transitional API below is intentional and **not** proof that integrated production source separation is complete.
- Many existing tests call `loadConfig({...fixture env...})` or `loadVoiceConfig({...fixture env...})`: `backend/test/model/{helpers.ts,policy.spec.ts}`, `test/runtime/native-harness.ts`, `test/voice/{session,usage}/fixtures.ts`, `test/fixtures/deepgram/socket.ts`, assembly/app tests and operations fixtures. Do not break them just to rename loaders. Keep old return shapes/types until their owners migrate consumption.
- `BudgetConfig` has shared `connectTimeoutMs`, `persistenceTimeoutMs`, `shutdownDrainMs` and storage/page values. MongoDB and model catalogue/transport currently use the same connection deadline. None belongs in manageable chat settings.
- Hard ceilings are already present outside environment defaults: HTTP/message input 32,000 characters; title schema 80; manifest 500 references/64 source ranges; pages 50; provider frame 65,536 bytes, model output 32,000 characters and stream 1 MiB; voice payload 131,072 bytes, normal provider queue 256 events, fixed PCM formats and `en-US`.
- Voice supports only Nova-3 dictation, Flux-general-en live and three Flux TTS voices. US/EU bases are explicitly allowlisted. Dictation warning currently derives from `dictationMaxMs - 30_000`; unlike live warning it has no env variable. Make this explicit in manageable settings without changing the existing voice wire protocol or mirrored voice files in P1.
- `budgetConfigSchema` is a Zod 3 `ZodEffects` after `superRefine`, not a plain object on which to call `.pick()`. Targeted correctness check used current Zod 3 documentation at `https://v3.zod.dev/`: strict objects, `safeParse`, `superRefine` and safe/finite numbers. This is not a research-phase artifact or a version upgrade.
- `redactSecrets` is not a permission to log arbitrary candidates: arbitrary Deepgram keys, encryption envelopes and validation exceptions need not match its patterns. New APIs/errors/warnings must be allowlisted, not redacted after logging.

## Exhaustive source and migration map

Runtime rule: only bootstrap reads ordinary environment values. Only the explicit import projector reads the manageable names below. Never implement env-over-stored or stored-over-env fallback. `undefined` means a missing legacy value; blank credential/model fields remain unconfigured. Preserve the old distinction that blank numeric budgets/invalid booleans are errors, while blank rate/spend fields become `null`.

### Environment-only infrastructure

| Environment name | Bootstrap path / default | Constraint / consumer |
| --- | --- | --- |
| `PORT` | `port` / 3000 | Integer 1–65535; server binding remains loopback. |
| `FRONTEND_ORIGIN` | `frontendOrigin` / `http://localhost:5173` | Exact serialized origin, no credentials/path/query/fragment. HTTPS except explicit development `localhost`, `127.0.0.1` or `[::1]` HTTP. |
| `NODE_ENV` | `nodeEnv` / development | development/test/production; test is not a remote plaintext exception. |
| `AURVIN_USER_ID` | `identity.userId` / aurvin-dev-user | Existing bounded server identity; no client identity or role override. |
| `PERSISTENCE_PROFILE` | `persistence.profile` / unknown | Existing enum remains diagnostic; only admitted native replica-set topology can enable work. Azure labels do not certify Azure. |
| `MONGODB_URI` | `persistence.mongoUri` / empty | Private URI includes any DB credentials/TLS/replica-set options; never public or logged. |
| `MONGODB_DB_NAME` | `persistence.mongoDbName` / aurvin | Existing nonempty DB name semantics; persistence owner validates admitted service. |
| `AURVIN_EXECUTOR_TOPOLOGY` | `topology.executor` / single-process | Literal single-process, not editable. |
| `AURVIN_LOCAL_CRASH_RECOVERY` | `topology.localCrashRecovery` / false | Strict true/false; true requires native profile; existing proof/journal/handoff remains mandatory. |
| `AURVIN_CONFIG_ENCRYPTION_KEY` | `encryption` / missing | New strict canonical base64 of exactly 32 bytes; backend-only; never silently generate/replace. |
| `MAX_MESSAGE_BYTES` | `safety.maxMessageBytes` / 65536 | Fixed per startup, below document headroom; content still checked in UTF-8 at runtime. |
| `MAX_DOCUMENT_BYTES` | `safety.maxDocumentBytes` / 1800000 | At most `documentHeadroomBytes(profile)`; no assumption of universal Mongo/Cosmos 16 MiB. |
| `MAX_MANIFEST_BYTES` | `safety.maxManifestBytes` / 131072 | Below maxDocumentBytes; schema reference counts remain fixed. |
| `MAX_PAGE_SIZE` | `safety.maxPageSize` / 50 | At most 50. |
| `DEFAULT_PAGE_SIZE` | `safety.defaultPageSize` / 20 | At most maxPageSize. |
| `CONNECT_TIMEOUT_MS` | `safety.connectTimeoutMs` / 10000 | Shared MongoDB/catalogue/provider connect ceiling. No new model-specific setting. |
| `PERSISTENCE_TIMEOUT_MS` | `safety.persistenceTimeoutMs` / 15000 | Shared durable DB deadline, not a chat/voice knob. |
| `SHUTDOWN_DRAIN_MS` | `safety.shutdownDrainMs` / 20000 | Shared owner/drain deadline, not a voice timeout setting. |

Keep `persistence.documentHeadroomBytes` derived from the existing helper. Reject invalid safety even when no keys/config document exist. Bootstrap safety integers must be positive safe integers; timer values must also be at most 2,147,483,647, so Node timers cannot overflow into near-immediate execution.

### Config collection: OpenRouter and chat

| Legacy name | Manageable path | Default / migration behavior |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | `credentials.openrouter` | Empty => absent; otherwise transient import candidate, validated/encrypted by P2/P6. Never part of settings. |
| `OPENROUTER_MODEL` | `settings.openRouter.modelId` | Empty; nonempty bounded ID, catalogue verification before activation. |
| `OPENROUTER_DATA_COLLECTION` | `settings.openRouter.dataCollection` | Literal deny; import of allow refuses, never silently weakens or changes policy. |
| `OPENROUTER_DISABLE_TRANSFORMS` | `settings.openRouter.disableTransforms` | Literal true; import of false refuses. |
| `MAX_INPUT_CHARS` | `settings.chat.maxInputChars` | 32000, maximum 32000. |
| `MAX_INPUT_TOKENS` | `settings.chat.maxInputTokens` | 8192; current conservative UTF-8 estimator, not a certified tokenizer. |
| `MAX_MESSAGES_IN_CONTEXT` | `settings.chat.maxMessagesInContext` | 80; counts fixed instructions/history/new input together; maximum 500. |
| `MAX_CONTEXT_TOKENS` | `settings.chat.maxContextTokens` | 16384; catalogue cap and usable-history reserve required. |
| `MAX_OUTPUT_TOKENS` | `settings.chat.maxOutputTokens` | 2048; catalogue cap; byte/character output ceilings still enforced independently. |
| `MODEL_MARGIN_TOKENS` | `settings.chat.modelMarginTokens` | 1024, positive reserved margin. |
| `TITLE_MAX_CHARS` | `settings.chat.titleMaxChars` | 80, maximum 80. |
| `MAX_CONCURRENT_GENERATIONS_PER_PROCESS` | `settings.chat.maxConcurrentGenerationsPerProcess` | 8; finite positive safe integer; one executor, not multi-instance support. |
| `MAX_REQUESTS_PER_MINUTE_PER_USER` | `settings.chat.maxRequestsPerMinutePerUser` | 20; finite positive safe integer; edits do not reset request history. |
| `RETRY_MAX_ATTEMPTS` | `settings.chat.retryMaxAttempts` | 2; inclusive attempts, not retries-after-first; maximum 3. |
| `RETRY_BASE_DELAY_MS` | `settings.chat.retryBaseDelayMs` | 500. |
| `RETRY_MAX_DELAY_MS` | `settings.chat.retryMaxDelayMs` | 5000, at least base delay. |
| `FIRST_OUTPUT_TIMEOUT_MS` | `settings.chat.firstOutputTimeoutMs` | 30000. |
| `IDLE_STREAM_TIMEOUT_MS` | `settings.chat.idleStreamTimeoutMs` | 20000. |
| `TOTAL_RUN_TIMEOUT_MS` | `settings.chat.totalRunTimeoutMs` | 180000. |

`maxConcurrentAttemptsPerSession = 1` is an immutable runtime budget and is not a settings/request field. No client setting for user attribution, tracing, transforms array, plugins/tools, endpoint, reasoning, fallback model or automatic compaction. Existing `OPENROUTER_SESSION_ID`/`OPENROUTER_TRACE` behavior in the installed provider must remain explicitly disabled; they are not supported import/settings names.

### Config collection: voice and Deepgram

| Legacy name | Manageable path | Default / migration behavior |
| --- | --- | --- |
| `ENABLE_DICTATION_MODE` | `settings.voice.enabledModes.dictation` | false, independently parsed. |
| `ENABLE_LIVE_VOICE_MODE` | `settings.voice.enabledModes.live` | false, independently parsed. |
| `VOICE_DICTATION_MAX_MS` | `settings.voice.limits.dictationMaxMs` | 300000. |
| no legacy env name | `settings.voice.dictationWarningMs` | 270000; import derives `dictationMaxMs - 30000` when positive, otherwise null (no warning), preserving legacy short sessions. |
| `VOICE_LIVE_MAX_MS` | `settings.voice.limits.liveMaxMs` | 1200000. |
| `VOICE_LIVE_WARNING_MS` | `settings.voice.limits.liveWarningMs` | 1080000. |
| `VOICE_IDLE_WARNING_MS` | `settings.voice.limits.idleWarningMs` | 60000. |
| `VOICE_IDLE_EXIT_AFTER_WARNING_MS` | `settings.voice.limits.idleExitAfterWarningMs` | 30000. |
| `VOICE_FINALIZATION_MS` | `settings.voice.limits.finalizationMs` | 2000. |
| `VOICE_RECONNECT_MS` | `settings.voice.limits.reconnectMs` | 10000. |
| `VOICE_CONNECT_MS` | `settings.voice.limits.connectMs` | 10000; voice handshake control, at most shared connect ceiling. |
| `VOICE_INPUT_QUEUE_MS` | `settings.voice.limits.inputQueueMs` | 1000; bounded PCM queue, not an editable payload ceiling. |
| `VOICE_OUTPUT_QUEUE_MS` | `settings.voice.limits.outputQueueMs` | 2000; bounded PCM queue. |
| `VOICE_IDENTITY_CONCURRENT` | `settings.voice.quotas.identityConcurrent` | 1. |
| `VOICE_GLOBAL_CONCURRENT` | `settings.voice.quotas.globalConcurrent` | 4; identity <= global. |
| `VOICE_IDENTITY_DAILY_MINUTES` | `settings.voice.quotas.identityDailyMinutes` | 60. |
| `VOICE_GLOBAL_DAILY_MINUTES` | `settings.voice.quotas.globalDailyMinutes` | 120; identity <= global. |
| `VOICE_DAILY_SPEND_USD` | `settings.voice.quotas.dailySpendUsd` | null for blank/missing, otherwise finite positive; requires all three rates. |
| `DEEPGRAM_API_KEY` | `credentials.deepgram` | Empty => absent; nonempty candidate validated/encrypted by P2/P6. |
| `DEEPGRAM_API_BASE` | `settings.deepgram.region` | wss://api.deepgram.com => us; wss://api.eu.deepgram.com => eu; default us; no arbitrary URL. |
| `DEEPGRAM_DICTATION_MODEL` | `settings.deepgram.dictationModel` | Literal nova-3. |
| `DEEPGRAM_LIVE_MODEL` | `settings.deepgram.liveModel` | Literal flux-general-en. |
| `DEEPGRAM_TTS_MODEL` | `settings.deepgram.ttsModel` | flux-haley-en; allow only flux-haley-en, flux-alexis-en, flux-priya-en. |
| `DEEPGRAM_DICTATION_ENDPOINTING_MS` | `settings.deepgram.endpointingMs` | 300; integer 300–500. |
| `DEEPGRAM_SPOKEN_PUNCTUATION` | `settings.deepgram.spokenPunctuation` | false. |
| `DEEPGRAM_KEYTERMS` | `settings.deepgram.keyterms` | []; import splits commas/trims/removes empty terms; <=50 terms, each nonempty <=64 chars; legacy raw string <=3300. |
| `DEEPGRAM_FLUX_EOT_THRESHOLD` | `settings.deepgram.eotThreshold` | 0.8; finite 0.5–1. |
| `DEEPGRAM_FLUX_EOT_TIMEOUT_MS` | `settings.deepgram.eotTimeoutMs` | 5000; positive bounded timer. |
| `DEEPGRAM_NOVA_RATE_PER_MIN_USD` | `settings.deepgram.rates.novaPerMinuteUsd` | null when blank/missing, otherwise finite >=0; zero is known, not unknown. |
| `DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD` | `settings.deepgram.rates.fluxSttPerMinuteUsd` | Same null/zero rule. |
| `DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD` | `settings.deepgram.rates.fluxTtsPerThousandCharsUsd` | Same null/zero rule. |

Keep the original `VoiceLimits`/`PublicVoiceConfig`/session wire shape intact in P1. `dictationWarningMs` is a new admin setting and server snapshot field; P4 schedules server warning events from it. No new voice env override or voice-model support is introduced. Rates are configured estimates; unknown usage stays unknown, even if rates are known.

### Other environment and immutable values

- Frontend/build/launcher-only: `VITE_API_BASE`, `FRONTEND_PORT`, `BACKEND_PROXY_TARGET`, `BACKEND_PORT` in `run.bat`; retain outside editor/import. `FRONTEND_ORIGIN` and backend `PORT` remain coherent with the proxy. No `VITE_*` identity/key/settings exports.
- Test-only: `AURVIN_TEST_MONGODB_URI`, `AURVIN_TEST_DB_PREFIX`, `AURVIN_AZURE_TEST_FACTS_JSON`, `AURVIN_AZURE_TEST_URI`, `AURVIN_AZURE_TEST_DB_NAME`, `AURVIN_AZURE_TEST_AUTHORIZED`, `AURVIN_LIVE_SMOKE`, `AURVIN_P10_LOAD`, `AURVIN_VOICE_PILOT_EVIDENCE`, `AURVIN_FIXTURE_SCRIPT`, `AURVIN_FIXTURE_KEY`. Preserve as test/operator gates, never import or editor controls. OS `PATH`, `SystemRoot`, `TEMP`, `TMP`, `ComSpec` are not application settings.
- Immutable: collection names/schema version/stable config ID; single-process/single-session ownership, local journal/quarantine; privacy deny/transforms disabled; PCM/locale/wire versions; fixed asset locations; provider destinations/allowlists; provider validation deadline 10000 ms, response 65536 bytes and zero automatic retries; all fixed storage/HTTP/SSE/control/provider byte ceilings. No toggles that weaken these.
- Unknown env names are not read, imported or echoed in warnings. Define the warning/import registry using only the manageable names in the two tables, excluding the derived dictation warning and all environment-only/test names. Add an assertion that all previous loader env-schema names are in exactly one source class, with the new key explicitly environment-only.

## Shared contracts: freeze these interfaces before downstream planning

### Public settings and admin wire shape

Put these types/constants in `backend/src/contracts/admin-config-wire.ts`, then mirror that public module into `frontend/src/api/admin-config-protocol.ts` (no server imports). Use existing `VoiceLimits` type through each package's corresponding voice wire module. Both copies use the same code starting at their first export; any import-path differences are normalized by the parity test.

```typescript
export const ADMIN_CONFIG_PROTOCOL_VERSION = 1 as const;
export const ADMIN_CONFIG_SCHEMA_VERSION = 1 as const;
export const MAX_ADMIN_CONFIG_BODY_BYTES = 16_384;
export const MAX_CREDENTIAL_BYTES = 4_096;
export const CREDENTIAL_VALIDATION_LIMITS = {
  timeoutMs: 10_000, responseBytes: 65_536, retries: 0,
} as const;
export type CredentialProvider = 'openrouter' | 'deepgram';
export const ADMIN_CONFIG_ROUTES = {
  config: '/admin/config',
  credential: (provider: CredentialProvider) => `/admin/config/credentials/${provider}`,
} as const;

export type ChatLimits = {
  maxInputChars: number; maxInputTokens: number; maxMessagesInContext: number;
  maxContextTokens: number; maxOutputTokens: number; modelMarginTokens: number;
  titleMaxChars: number; maxConcurrentGenerationsPerProcess: number;
  maxRequestsPerMinutePerUser: number; retryMaxAttempts: number;
  retryBaseDelayMs: number; retryMaxDelayMs: number;
  firstOutputTimeoutMs: number; idleStreamTimeoutMs: number; totalRunTimeoutMs: number;
};
export type ManageableSettings = {
  openRouter: { modelId: string; dataCollection: 'deny'; disableTransforms: true };
  chat: ChatLimits;
  voice: {
    enabledModes: { dictation: boolean; live: boolean };
    limits: VoiceLimits; dictationWarningMs: number | null;
    quotas: { identityConcurrent: number; globalConcurrent: number;
      identityDailyMinutes: number; globalDailyMinutes: number; dailySpendUsd: number | null };
  };
  deepgram: {
    region: 'us' | 'eu'; dictationModel: 'nova-3'; liveModel: 'flux-general-en';
    ttsModel: 'flux-haley-en' | 'flux-alexis-en' | 'flux-priya-en';
    endpointingMs: number; spokenPunctuation: boolean; keyterms: string[];
    eotThreshold: number; eotTimeoutMs: number;
    rates: { novaPerMinuteUsd: number | null; fluxSttPerMinuteUsd: number | null;
      fluxTtsPerThousandCharsUsd: number | null };
  };
};
export type CredentialState = { configured: boolean; validatedAt: string | null };
export type AdminRoleAssumption = {
  role: 'super-admin'; authentication: 'disabled'; source: 'server-configured-development';
};
export type PublicAdminConfig = {
  protocolVersion: 1; schemaVersion: 1;
  revision: number; activeRevision: number | null; state: 'missing' | 'stored';
  activation: 'active' | 'unconfigured' | 'blocked';
  roleAssumption: AdminRoleAssumption;
  settings: ManageableSettings;
  credentials: { openrouter: CredentialState; deepgram: CredentialState };
};
export type SaveSettingsRequest = {
  protocolVersion: 1; expectedRevision: number; settings: ManageableSettings;
};
export type CredentialUpdateRequest =
  | { protocolVersion: 1; expectedRevision: number; action: 'replace'; candidate: string }
  | { protocolVersion: 1; expectedRevision: number; action: 'remove'; confirm: true };
export const ADMIN_CONFIG_ERROR_CODES = [
  'INVALID_CONFIG_REQUEST', 'CONFIG_VALIDATION_FAILED', 'CONFIG_CONFLICT',
  'CONFIG_STORAGE_UNAVAILABLE', 'CONFIG_WRITE_UNCERTAIN', 'CONFIG_STORED_INVALID',
  'CONFIG_ENCRYPTION_UNAVAILABLE', 'CONFIG_ACTIVATION_UNAVAILABLE',
  'CREDENTIAL_REJECTED', 'CREDENTIAL_VALIDATION_TIMEOUT',
  'CREDENTIAL_PROVIDER_RATE_LIMITED', 'CREDENTIAL_PROVIDER_UNAVAILABLE',
  'CREDENTIAL_PROVIDER_RESPONSE_INVALID', 'ADMIN_RATE_LIMITED',
  'INVALID_ADMIN_ORIGIN', 'ADMIN_TRANSPORT_REQUIRED',
] as const;
export type AdminConfigErrorCode = typeof ADMIN_CONFIG_ERROR_CODES[number];
export type AdminConfigError = {
  protocolVersion: 1;
  error: { code: AdminConfigErrorCode; retryable: boolean; currentRevision: number | null;
    fieldErrors: Array<{ path: string; code: 'required' | 'invalid' | 'out_of_range'
      | 'cross_field' | 'immutable' | 'unsupported' }> };
};
```

Define `ADMIN_CONFIG_FIELD_PATHS` as the exact leaf paths from the mapping, plus `expectedRevision` and `candidate` (not env names). Fields such as keyterms use `deepgram.keyterms`, not arbitrary array-index/user-property paths. Validate `fieldErrors.path` against that closed list, maximum 20 errors; no exception/response text or attempted values in errors. Use a local UI static code-to-message mapping in P5. Do not expand existing chat `APP_ERROR_CODES` and break frontend chat parity for this feature.

Semantics P2/P5/P6 must consume:

- GET `/api/admin/config`; PUT the same path for a full **nonsecret** settings replacement; POST `/api/admin/config/credentials/openrouter|deepgram` for replace/remove. All requests strict JSON, no query/body identity, URI, bootstrap, envelopes or credentials in `settings`.
- Missing document: `state: 'missing', revision: 0`, safe defaults and absent credentials. Revision zero is an expected-create CAS token, never a persisted document revision. Stored revisions start at one and increment once per confirmed mutation, refusing overflow.
- `activeRevision` reports the currently published revision, or null when unavailable. `activation: active` requires stored/active equality; unconfigured denotes usable settings with absent model/key prerequisites; blocked denotes durable state that cannot currently activate. Never claim a saved but unpublished revision active.
- Every successful mutation returns a fresh `PublicAdminConfig`, with its confirmed revision already available for new work. A deliberately absent key can return unconfigured rather than active. Successful removals do not promise that old active sessions can still use revoked credentials.
- Replacement saves only the credential in the persisted revision's settings/provider region. It never saves dirty fields alongside a key. Removal requires `confirm: true`. A separate nonsecret save cannot include candidates/credential objects.
- No API read includes key length, prefix, suffix, last characters, fingerprint, envelope/nonce/tag or master-key status bytes. `configured` and `validatedAt` are the only credential metadata. Absent credential requires `validatedAt: null`; configured requires a bounded valid timestamp. The fixed-dot UI is P5, not a server-returned key mask.
- Expected revisions are nonnegative safe integers <= `Number.MAX_SAFE_INTEGER - 1`; stored/current revisions are safe positive integers. CAS includes delayed validation: validation at r must never commit onto r+1.
- Role assumption is explicit server metadata, not a browser assertion. P6/P2 resolve the existing identity and stamp actor ID; do not add auth/RBAC, client role headers, cookies or fake logout.
- Error HTTP mapping: invalid/schema 400 (oversized JSON 413 at parser), conflict 409, storage/uncertain/encryption/activation/stored-invalid 503, rejected credential 422, validation timeout 504, provider rate limit/provider unavailable/invalid response 502, local admin rate 429, origin/transport 403. Errors carry static categories, never raw provider bodies.

### Stored document and server-only interfaces

In `admin-config.ts`, keep the settings schema and stored-document schema separate from public reads. Infer stored types from Zod. Define `APP_CONFIG_ID = 'aurvin'` and `COLLECTIONS.config = 'config'`. The bounded singleton document is exactly:

```typescript
export type EncryptedCredentialEnvelope = {
  algorithm: 'aes-256-gcm'; nonce: string; tag: string; ciphertext: string;
};
export type StoredCredential = { envelope: EncryptedCredentialEnvelope; validatedAt: string };
export type StoredConfigDocument = {
  _id: 'aurvin'; schemaVersion: 1; revision: number; settings: ManageableSettings;
  credentials: { openrouter: StoredCredential | null; deepgram: StoredCredential | null };
  updatedAt: string; updatedBy: string;
};
```

Require canonical base64: nonce decodes to 12 bytes, tag to 16, ciphertext 1–4096 bytes. Bounds before decoding; compare decoded/re-encoded text to reject ignored characters, wrong padding/noncanonical encoding. Encryption/decryption is P2. Associated data is exactly UTF-8 `aurvin-config:1:openrouter` or `aurvin-config:1:deepgram`; revision is deliberately absent so unchanged encrypted credentials can survive nonsecret saves. Fresh nonce for each actual encryption; no plaintext field, validation response, embedded history or duplicate credential copies.

Export `MAX_CONFIG_DOCUMENT_BYTES = 16_384`. Validate schema and actual encoded document size against `min(MAX_CONFIG_DOCUMENT_BYTES, bootstrap.safety.maxDocumentBytes)` at P2 persistence boundaries using the installed MongoDB/BSON size calculation, not only JSON string length. Do not create another DB collection or client. The `config` collection is the sole feature addition to the existing six collections.

In `config-runtime.ts`, use existing `BudgetConfig`, `VoiceLimits` and `ResolvedIdentity` types. Keep all these exports backend-only:

```typescript
export type DecryptedCredentials = { openrouter: string | null; deepgram: string | null };
export type VerifiedModelLimits = {
  modelId: string; contextTokens: number; outputTokens: number;
  supportsMaxTokens: boolean; source: 'fixture' | 'catalogue';
};
export type VoiceConfig = {
  enabledModes: { dictation: boolean; live: boolean }; limits: VoiceLimits;
  deepgram: { apiKey: string; apiBase: string; dictationModel: 'nova-3';
    liveModel: 'flux-general-en'; ttsModel: 'flux-haley-en' | 'flux-alexis-en' | 'flux-priya-en';
    endpointingMs: number; spokenPunctuation: boolean; keyterms: string[];
    eotThreshold: number; eotTimeoutMs: number };
  quotas: ManageableSettings['voice']['quotas']; rates: ManageableSettings['deepgram']['rates'];
};
export type RuntimeConfigSnapshot = {
  readonly schemaVersion: 1; readonly revision: number;
  readonly settings: Readonly<ManageableSettings>;
  readonly budgets: Readonly<BudgetConfig>;
  readonly openRouter: Readonly<{ apiKey: string; modelId: string;
    dataCollection: 'deny'; disableTransforms: true }>;
  readonly voice: Readonly<VoiceConfig & { dictationWarningMs: number | null }>;
  readonly modelLimits: Readonly<VerifiedModelLimits> | null;
};
export type SnapshotCandidate = {
  revision: number; settings: ManageableSettings; credentials: DecryptedCredentials;
};
export interface CurrentConfigPort { current(): RuntimeConfigSnapshot | null }
export interface ConfigActivationPort {
  prepare(candidate: SnapshotCandidate): Promise<RuntimeConfigSnapshot>;
  publish(snapshot: RuntimeConfigSnapshot): void;
}
export type ConfigCasResult =
  | { outcome: 'confirmed'; document: StoredConfigDocument }
  | { outcome: 'conflict'; currentRevision: number }
  | { outcome: 'uncertain' };
export interface ConfigRepository {
  read(): Promise<StoredConfigDocument | null>;
  createIfAbsent(document: StoredConfigDocument): Promise<ConfigCasResult>;
  compareAndSwap(expectedRevision: number, document: StoredConfigDocument): Promise<ConfigCasResult>;
}
export type AdminConfigActor = {
  identity: ResolvedIdentity; assumption: AdminRoleAssumption;
};
```

`Readonly` here preserves compatibility with existing nested mutable type signatures; `buildRuntimeSnapshot` must actually clone/freeze **all nested objects/arrays**. Tests below prove physical isolation. No component may mutate a captured snapshot, even when older TypeScript types permit it. Do not put snapshot/key objects into attempts/checkpoints/metadata/logs, or expose them via frontend re-exports.

`prepare` is P6's preflight, using P1 validation and P3 catalogue/asset checks: side-effect-free with respect to active settings, reservations, quotas and owners. `publish` is a synchronous, nonthrowing pointer publication after confirmed persistence; all potentially failing preparation happens before the write. New consumers read `CurrentConfigPort`; they do not reassemble runtimes or subscribe by creating replacement owners. Repository uncertainty is resolved by P2 within the journal/ownership boundary, never by deleting evidence or publishing a guessed revision. A known durable mutation can publish even if the HTTP client disconnects; disconnect must not trigger an undo or inference replay.

### Bootstrap and pure helper functions

`bootstrap-config.ts` exports:

```typescript
export type StorageSafety = Pick<BudgetConfig,
  'maxMessageBytes' | 'maxDocumentBytes' | 'maxManifestBytes' | 'maxPageSize'
  | 'defaultPageSize' | 'connectTimeoutMs' | 'persistenceTimeoutMs' | 'shutdownDrainMs'>;
export type EncryptionBootstrap =
  | { status: 'ready'; key: Uint8Array }
  | { status: 'missing' | 'invalid' };
export type BootstrapConfig = {
  port: number; frontendOrigin: string; nodeEnv: 'development' | 'test' | 'production';
  identity: { userId: string };
  persistence: { profile: PersistenceProfile; mongoUri: string; mongoDbName: string;
    documentHeadroomBytes: number };
  topology: { executor: 'single-process'; localCrashRecovery: boolean };
  safety: StorageSafety; encryption: EncryptionBootstrap;
};
export function loadBootstrapConfig(env: Record<string, string | undefined>): BootstrapConfig;
export function obsoleteManageableNames(env: Record<string, string | undefined>): string[];
export function legacyConfigWarning(env: Record<string, string | undefined>): string | null;
```

Do not attach raw env, legacy candidates, key strings or diagnostics containing values to bootstrap. Parse master key with an upper-bound/regex/canonical round trip, then return only decoded bytes or missing/invalid state. A missing/invalid master key is an actionable admin diagnostic, **not** a thrown startup error or silent generated key. P6 keeps liveness/admin available and blocks all secret saves/secret activation; it must not label undecryptable stored keys absent. Infrastructure parse failures still throw the existing sanitized `AppError('CONFIGURATION_ERROR', 'Invalid application configuration.')`.

`obsoleteManageableNames` uses own properties with defined values, including empty values, returns a sorted list of **known names only**. `legacyConfigWarning` is null for an empty list; otherwise exactly `Ignored obsolete manageable environment settings: ${names.join(', ')}. Use Manage Aurvin or the explicit import command.` It never stringifies env or invokes a logger. P6 emits it once at normal bootstrap; import reports its own names/counts instead.

`manageable-config.ts` exports:

```typescript
export function defaultManageableSettings(): ManageableSettings;
export function validateManageableSettings(raw: unknown, bootstrap: BootstrapConfig): ManageableSettings;
export function composeRuntimeBudgets(settings: ManageableSettings, safety: StorageSafety): BudgetConfig;
export function buildRuntimeSnapshot(
  bootstrap: BootstrapConfig,
  candidate: SnapshotCandidate,
  modelLimits: VerifiedModelLimits | null,
): RuntimeConfigSnapshot;
export function projectPublicAdminConfig(
  document: StoredConfigDocument | null,
  active: RuntimeConfigSnapshot | null,
  activation: PublicAdminConfig['activation'],
): PublicAdminConfig;
```

`legacy-config-import.ts` exports `parseLegacyConfigImport(env, bootstrap): { settings: ManageableSettings; credentials: DecryptedCredentials; importedNames: string[] }`. This is a pure **explicit import preparation** helper, not a command, owner or fallback. It parses names privately and returns transient credentials only to backend P6/P2; do not put its result into public output. It does not validate recognition by providers or encrypt/persist. Those steps occur only when the operator explicitly runs P6's import command.

## Validation rules and evidence required

All JSON/stored settings schemas are strict at **every** nesting level, without coercion/default filling. Keep constructors/default factories separate: invalid stored objects are errors, not values to repair with defaults. Settings requests replace the whole nonsecret candidate; no patch/upsert merge that can silently delete unknown/corrupted fields.

1. Reuse the budget object numeric fields, add positive/safe/finite bounds, and run existing retry/context refinements on the composed complete `BudgetConfig`. Retain `maxConcurrentAttemptsPerSession: 1`. Input <=32000 chars, title <=80, messages <=500; input tokens <= fixed message bytes and usable context reserve; output tokens <= fixed message bytes and catalogue output cap. The latter is a conservative configuration ceiling, **not** a token-to-byte guarantee; actual UTF-8/character checks remain mandatory.
2. All operational timer integers <=2,147,483,647. First-output/idle timeout <=total-run. Do not require a first-output timer >=idle timer: both remain independent. Retry max-delay >=base and <=total-run. Shared connect may exceed a deliberately shorter total-run; total-run still bounds the operation. No model-only connect field.
3. Reuse `isVoiceLimits` for its exact-field/cross-field checks. Positive timer bounds; liveWarning <liveMax; idleWarning+exit <=liveMax; finalization/inputQueue <=dictationMax; outputQueue <=liveMax. Dictation warning null or positive <dictationMax. Voice connect <=bootstrap shared connect. Derived daily minutes*60000 must be <=safe timer maximum; identity quotas <=global; rates finite >=0 or null; spend finite >0 or null and requires all rates. Never coerce null rates to zero.
4. Use a conservative noneditable aggregate audio queue byte ceiling of existing `MAX_VOICE_CONTROL_BYTES = 131072`, including transport framing: `inputQueueMs*32 + 16*Math.ceil(inputQueueMs/80) <=131072`; `outputQueueMs*48 + 16*Math.ceil(outputQueueMs/200) <=131072`. This prevents an admin edit from turning queue duration into an unbounded allocation; it does not change provider frame/event ceilings. Check the boundary values 4070/4071 ms input and 2726/2727 ms output. A legacy value that exceeded the newly enforced aggregate safety ceiling fails explicit import with a safe field category; do not clamp it silently.
5. Model ID empty is permitted for an unconfigured admin page, otherwise trimmed nonblank <=200 characters, without control characters. No URLs/endpoints/fallback models. Deepgram region enum and model literals stay admitted allowlists; keyterms must already be trimmed/nonempty on JSON input, not silently normalized. Endpointing 300–500, threshold 0.5–1.
6. Credential replacement is nonempty, <=4096 UTF-8 bytes/characters, rejects control characters or leading/trailing whitespace; never trim a candidate silently. Removing uses its own union branch. Validation bodies bound at 16 KiB; failure before network for extra fields/identity/raw URLs/envelopes. Real key validity is P2, not a P1 heuristic for provider format.
7. Empty credentials are allowed with desired voice flags true, to represent legacy/unconfigured intent. Snapshot admission/capabilities must remain disabled without usable credentials; P4/P6 calculate effective capabilities. Removing a key does not rewrite the desired flags or enable speech. Never default flags to true.
8. P3/P6 must verify catalogue and fixed-asset fit before activation, for any model/context/output edit (not only a changed model ID). Require matching modelId, safe positive verified limits, supportsMaxTokens=true, context/output >=candidate values. Null limits only allowed when key/model absent; a configured candidate may not bypass verification by passing null. P1 uses deterministic fixtures; no catalogue fetch in config parsing.
9. Preserve content-storage byte checks: character length and token limits are not substitutes. Fixed assets/history must fit without silent history dropping; max-message/document/manifest values stay in bootstrap. P2 bounds actual stored config BSON; lowering safety may make saved config invalid and must not overwrite it.

## Task 1: Public settings schema, reusable budgets and safe defaults

Files: create `admin-config-wire.ts`, `admin-config.ts`, `admin-config.spec.ts`, `manageable-config.ts`, `manageable-config.spec.ts`; modify `budgets.ts`.

- [ ] Write `defaultManageableSettings()` assertions and unknown/policy-field failures in `backend/src/contracts/admin-config.spec.ts`. Initially import exports that do not exist; this is the intended first red run.

```typescript
import { describe, expect, it } from 'vitest';
import { manageableSettingsSchema } from './admin-config.js';
import { defaultManageableSettings } from '../platform/config/manageable-config.js';

it('keeps defaults unconfigured, independently off and strict', () => {
  const s = defaultManageableSettings();
  expect(manageableSettingsSchema.parse(s)).toEqual(s);
  expect(s.openRouter).toEqual({ modelId: '', dataCollection: 'deny', disableTransforms: true });
  expect(s.voice.enabledModes).toEqual({ dictation: false, live: false });
  expect(s.voice.dictationWarningMs).toBe(270000);
  expect(s.deepgram.rates).toEqual({ novaPerMinuteUsd: null,
    fluxSttPerMinuteUsd: null, fluxTtsPerThousandCharsUsd: null });
  for (const raw of [
    { ...s, userId: 'browser-user' },
    { ...s, openRouter: { ...s.openRouter, dataCollection: 'allow' } },
    { ...s, openRouter: { ...s.openRouter, disableTransforms: false } },
    { ...s, chat: { ...s.chat, connectTimeoutMs: 1 } },
    { ...s, chat: { ...s.chat, maxConcurrentAttemptsPerSession: 2 } },
    { ...s, voice: { ...s.voice, apiKey: 'candidate' } },
    { ...s, deepgram: { ...s.deepgram, region: 'https://evil.invalid' } },
  ]) expect(manageableSettingsSchema.safeParse(raw).success).toBe(false);
});
```

- [ ] From `backend`, run `npm test -- src/contracts/admin-config.spec.ts -t "keeps defaults"`. Expect FAIL unresolved new import, not a native/provider skip.
- [ ] Factor existing budget object before its refinement, preserving every old field/refinement/default:

```typescript
export const budgetConfigObjectSchema = z.object({
  maxInputChars: z.number().int().positive(),
  maxInputTokens: z.number().int().positive(),
  maxMessagesInContext: z.number().int().positive(),
  maxContextTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  modelMarginTokens: z.number().int().positive(),
  maxMessageBytes: z.number().int().positive(),
  maxDocumentBytes: z.number().int().positive(),
  maxManifestBytes: z.number().int().positive(),
  maxPageSize: z.number().int().positive().max(50),
  defaultPageSize: z.number().int().positive(),
  titleMaxChars: z.number().int().positive(),
  maxConcurrentAttemptsPerSession: z.literal(1),
  maxConcurrentGenerationsPerProcess: z.number().int().positive(),
  maxRequestsPerMinutePerUser: z.number().int().positive(),
  retryMaxAttempts: z.number().int().positive().max(3),
  retryBaseDelayMs: z.number().int().positive(),
  retryMaxDelayMs: z.number().int().positive(),
  connectTimeoutMs: z.number().int().positive(),
  firstOutputTimeoutMs: z.number().int().positive(),
  idleStreamTimeoutMs: z.number().int().positive(),
  totalRunTimeoutMs: z.number().int().positive(),
  persistenceTimeoutMs: z.number().int().positive(),
  shutdownDrainMs: z.number().int().positive(),
}).strict();
export const budgetConfigSchema = budgetConfigObjectSchema.superRefine((budgets, ctx) => {
  if (budgets.defaultPageSize > budgets.maxPageSize) ctx.addIssue({
    code: z.ZodIssueCode.custom, message: 'defaultPageSize cannot exceed maxPageSize', path: ['defaultPageSize'],
  });
  if (usableHistoryTokens(budgets) <= 0) ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'maxContextTokens must leave room for maxOutputTokens and modelMarginTokens',
    path: ['maxContextTokens'],
  });
  if (budgets.retryMaxDelayMs < budgets.retryBaseDelayMs) ctx.addIssue({
    code: z.ZodIssueCode.custom, message: 'retryMaxDelayMs must be >= retryBaseDelayMs', path: ['retryMaxDelayMs'],
  });
});
```

In `admin-config.ts`, pick exactly the 15 mapped chat fields from `budgetConfigObjectSchema`; strengthen limits listed above using `.extend()` **before** refinements. Define strict OpenRouter, voice, quotas, Deepgram and rates objects from the explicit shared shape. Apply existing `isVoiceLimits`, budget and spend rules via `superRefine`/safe issue paths; do not stringify rejected objects in errors. Use `satisfies z.ZodType<ManageableSettings>` to keep the public type consistent.
- [ ] Implement defaults with explicit public fields from `DEFAULT_BUDGETS` and `{...DEFAULT_VOICE_LIMITS}`; use voice quotas 1/4/60/120, null spend/rates, model literals/defaults from the mapping. Return new arrays/objects on every call; no shared mutable default settings.
- [ ] Add `it.each` failures for `chat.maxInputChars=32001`, `titleMaxChars=81`, messages=501, retry=4, numbers Infinity/NaN/fractions/unsafe integers/numeric strings/null, model whitespace/>200/control, endpointing501, Flux model expansion, untrimmed/51 keyterms, threshold1.1, voice warnings/quotas/rates/spend failures. For each boundary add its valid neighbor; e.g. zero known rates with a positive spend passes; null rate with spend fails.
- [ ] Run `npm test -- src/contracts/admin-config.spec.ts src/contracts/budgets.spec.ts` and `npm run build` from `backend`. Expect all discovered tests pass and build succeeds; no change to old runtime loaders yet.
- [ ] With commit turn, stage the six exact new/modified paths listed for this task and commit `feat(config): define strict manageable settings and safe defaults`.

Run from the checkout root, as separate commands:

```powershell
git add backend/src/contracts/admin-config-wire.ts backend/src/contracts/admin-config.ts backend/src/contracts/admin-config.spec.ts backend/src/contracts/budgets.ts backend/src/platform/config/manageable-config.ts backend/src/platform/config/manageable-config.spec.ts
git commit -m "feat(config): define strict manageable settings and safe defaults"
```

## Task 2: Infrastructure-only bootstrap, master-key parsing and name-only warnings

Files: create `bootstrap-config.ts`, `bootstrap-config.spec.ts`. Bootstrap-dependent manageable validation follows in Task 3. Do not read a private `.env`.

- [ ] Write source-isolation and master-key examples:

```typescript
import { loadBootstrapConfig, legacyConfigWarning, obsoleteManageableNames } from './bootstrap-config.js';

it('ignores even malformed legacy values without copying or exposing them', () => {
  const env = { OPENROUTER_API_KEY: 'fixture-secret-A', OPENROUTER_MODEL: 'fixture/model',
    MAX_INPUT_CHARS: 'not-a-number', ENABLE_LIVE_VOICE_MODE: 'not-a-boolean',
    DEEPGRAM_API_KEY: 'fixture-secret-B', MONGODB_DB_NAME: 'fixture-db' };
  const b = loadBootstrapConfig(env);
  expect(b.persistence.mongoDbName).toBe('fixture-db');
  expect(b).not.toHaveProperty('openRouter');
  expect(b).not.toHaveProperty('voice');
  expect(b).not.toHaveProperty('budgets');
  expect(b.encryption).toEqual({ status: 'missing' });
  const names = obsoleteManageableNames(env);
  expect(names).toEqual(['DEEPGRAM_API_KEY', 'ENABLE_LIVE_VOICE_MODE',
    'MAX_INPUT_CHARS', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL']);
  const warning = legacyConfigWarning(env)!;
  expect(warning).toContain(names.join(', '));
  for (const value of Object.values(env)) expect(warning).not.toContain(value);
  expect(JSON.stringify(b)).not.toContain('fixture-secret');
});
it('accepts only canonical base64 encoding of exactly 32 bytes', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const b = loadBootstrapConfig({ AURVIN_CONFIG_ENCRYPTION_KEY: key });
  expect(b.encryption.status).toBe('ready');
  if (b.encryption.status === 'ready') expect([...b.encryption.key]).toEqual([...Buffer.alloc(32, 7)]);
  for (const invalid of [' ', key.trimEnd().slice(0, -1), key + '\n',
    Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'),
    '!'.repeat(44), key.replace(/=/g, '')]) {
    expect(loadBootstrapConfig({ AURVIN_CONFIG_ENCRYPTION_KEY: invalid }).encryption)
      .toEqual({ status: 'invalid' });
  }
  expect(loadBootstrapConfig({ AURVIN_CONFIG_ENCRYPTION_KEY: '' }).encryption)
    .toEqual({ status: 'missing' });
});
```

- [ ] Run `npm test -- src/platform/config/bootstrap-config.spec.ts` from `backend`; expect FAIL missing bootstrap exports.
- [ ] Implement a bootstrap env schema using only infrastructure table names and existing profile/default primitives. Allow unrelated process env keys, but construct the returned object from explicit allowlisted fields. Parse optional infrastructure numbers with the old missing-vs-empty distinction. Reuse `documentHeadroomBytes`; reject message/manifest >=document, document >headroom and default page >max. Validate the exact origin and development-only plaintext exception here without adding gateway/RBAC machinery.
- [ ] Implement strict key state and warning registry:

```typescript
function parseEncryptionKey(value: string | undefined): EncryptionBootstrap {
  if (value === undefined || value === '') return { status: 'missing' };
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return { status: 'invalid' };
  const key = Buffer.from(value, 'base64');
  return key.byteLength === 32 && key.toString('base64') === value
    ? { status: 'ready', key: Uint8Array.from(key) }
    : { status: 'invalid' };
}
export function obsoleteManageableNames(env: Record<string, string | undefined>): string[] {
  return LEGACY_MANAGEABLE_ENV_NAMES.filter(name => Object.hasOwn(env, name) && env[name] !== undefined).sort();
}
```

Define/export the exact registry from the migration tables in this module (one literal sorted array), and `BOOTSTRAP_ENV_NAMES` for coverage testing. Warning uses only the returned registry names. No key-generation path; do not freeze a nonempty typed array with `Object.freeze` (Node disallows that); keep master bytes private and copy where needed.
- [ ] Add tests for invalid port/origin/topology/safety, all 18 infrastructure fields and explicit local recovery; HTTPS accepted, remote HTTP/credentials/path/query/fragment/trailing origin slash rejected, production localhost HTTP rejected. Add empty legacy values, unknown secret-looking names and inherited properties to warning tests; warnings null when only bootstrap/unknown names exist.
- [ ] Add the source-map coverage test with the literal previous loader-name set extracted from current source; assert disjoint bootstrap/manageable sets and their union equals that previous set plus the master-key name. Assert derived dictation warning, OS and test names do not appear. This test runs offline and reads no private env.
- [ ] Run `npm test -- src/platform/config/bootstrap-config.spec.ts src/platform/config/load-config.spec.ts src/platform/config/voice-config.spec.ts` and `npm run build`; expect new/bootstrap and unchanged legacy suites pass.
- [ ] Stage the two bootstrap files only, with a commit turn; commit `feat(config): separate infrastructure bootstrap and safe legacy warnings`.

```powershell
git add backend/src/platform/config/bootstrap-config.ts backend/src/platform/config/bootstrap-config.spec.ts
git commit -m "feat(config): separate infrastructure bootstrap and safe legacy warnings"
```

## Task 3: Bootstrap-aware validation and stable runtime snapshot projection

Files: create `config-runtime.ts`, `config-runtime.spec.ts`; finish `manageable-config.ts`/its spec. Move the existing `VoiceConfig` type declaration from `voice-config.ts` into `config-runtime.ts` and re-export it from `voice-config.ts`, preserving the old loader's inferred signatures. This prevents contracts from importing platform implementation. Do not modify provider classes or `ModelLimits`; new `VerifiedModelLimits` is structurally compatible with the current model type.

- [ ] Write the bootstrap composition/cross-field test:

```typescript
import { loadBootstrapConfig } from './bootstrap-config.js';
import { buildRuntimeSnapshot, composeRuntimeBudgets, defaultManageableSettings,
  validateManageableSettings } from './manageable-config.js';

it('composes shared safety without accepting it as a settings override', () => {
  const b = loadBootstrapConfig({ CONNECT_TIMEOUT_MS: '9000', MAX_MESSAGE_BYTES: '16000' });
  const s = defaultManageableSettings();
  s.voice.limits.connectMs = 9000;
  s.chat.maxOutputTokens = 1000;
  const budgets = composeRuntimeBudgets(validateManageableSettings(s, b), b.safety);
  expect(budgets.connectTimeoutMs).toBe(9000);
  expect(budgets.maxMessageBytes).toBe(16000);
  expect(budgets.maxConcurrentAttemptsPerSession).toBe(1);
  expect(() => validateManageableSettings({ ...s,
    chat: { ...s.chat, maxInputTokens: 16001 } }, b)).toThrow();
  expect(() => validateManageableSettings({ ...s,
    voice: { ...s.voice, limits: { ...s.voice.limits, connectMs: 9001 } } }, b)).toThrow();
});
it('freezes a detached revision without copying secrets into settings', () => {
  const b = loadBootstrapConfig({});
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = 'fixture/model';
  const candidate = { revision: 3, settings,
    credentials: { openrouter: 'fixture-A', deepgram: 'fixture-B' } };
  const limits = { modelId: 'fixture/model', contextTokens: 32768,
    outputTokens: 4096, supportsMaxTokens: true, source: 'fixture' as const };
  const snap = buildRuntimeSnapshot(b, candidate, limits);
  settings.chat.maxOutputTokens = 512;
  settings.deepgram.keyterms.push('changed');
  candidate.credentials.openrouter = 'fixture-C';
  limits.outputTokens = 1;
  expect(snap.revision).toBe(3);
  expect(snap.budgets.maxOutputTokens).toBe(2048);
  expect(snap.openRouter.apiKey).toBe('fixture-A');
  expect(snap.voice.deepgram.apiKey).toBe('fixture-B');
  expect(snap.modelLimits?.outputTokens).toBe(4096);
  expect(snap.settings.deepgram.keyterms).toEqual([]);
  expect(Object.isFrozen(snap.settings.deepgram.keyterms)).toBe(true);
  expect(Object.isFrozen(snap.voice.deepgram)).toBe(true);
  expect(JSON.stringify(snap.settings)).not.toContain('fixture-A');
});
```

- [ ] Run `npm test -- src/platform/config/manageable-config.spec.ts`; expect FAIL missing functions/failed assertions, not provider contact.
- [ ] Implement composition with settings first, safety explicitly overriding, fixed session concurrency last:

```typescript
export function composeRuntimeBudgets(settings: ManageableSettings, safety: StorageSafety): BudgetConfig {
  return budgetConfigSchema.parse({ ...settings.chat, ...safety, maxConcurrentAttemptsPerSession: 1 });
}
```

Validate structural schema, then composed budget/cross-field/storage/queue constraints listed above. Do not let settings include any safety field. Return sanitized configuration errors, never `JSON.stringify(raw)` or a thrown raw ZodError at API/logging boundaries. Backend internal schema `safeParse` remains available for P2 field-path categorization.
- [ ] Implement snapshot projection: region maps only to `wss://api.deepgram.com`/`wss://api.eu.deepgram.com`; null credential maps to empty string for existing adapter compatibility; spread the explicit settings parts into legacy `VoiceConfig`, adding `dictationWarningMs`. Verify fixture/catalogue limits when key+model exist; allow null only for unconfigured candidates. Candidate revision zero only for in-memory absent-store defaults. Copy settings/limits with `structuredClone`, freeze nested plain JSON objects/arrays recursively, then freeze the snapshot; never include bootstrap Mongo URI/master bytes/identity in it.
- [ ] Write `it.each` bootstrap-dependent cases: context <=output+margin; input >usable reserve; first/idle >total; retry max <base or >total; timer overflow; voice connect >shared; queue boundaries; unsafe minute-to-ms conversion; unknown/null rates with spend; mismatched/undersized/nonfinite model limits; configured model/key with null limits; snapshot credentials null with both flags true leaves no usable secret. Add passing just-inside boundaries and independent booleans.
- [ ] Add `config-runtime.spec.ts` fake `CurrentConfigPort`/`ConfigActivationPort` examples using the exact interfaces. Implement only the credential/model/voice/snapshot/candidate/current/activation/actor types at this step; add repository/stored imports and examples in Task 4, when those types exist. Demonstrate original snapshot remains revision3 after fake current pointer changes to revision4. This proves the contract/projection, **not** actual retry/reconnect behavior (P3/P4).
- [ ] Run `npm test -- src/platform/config/manageable-config.spec.ts src/platform/config/voice-config.spec.ts src/contracts/config-runtime.spec.ts`, then `npm run build`/`npm run lint` from `backend`. Expect all pass with no unresolved stored-type references.
- [ ] Stage exact runtime/projection/type-move files with commit turn; commit `feat(config): validate safety bounds and capture immutable runtime snapshots`.

```powershell
git add backend/src/contracts/config-runtime.ts backend/src/contracts/config-runtime.spec.ts backend/src/platform/config/manageable-config.ts backend/src/platform/config/manageable-config.spec.ts backend/src/platform/config/voice-config.ts
git commit -m "feat(config): validate safety bounds and capture immutable runtime snapshots"
```

## Task 4: Strict CAS/admin requests, bounded encrypted storage and redacted reads

Files: complete `admin-config.ts`, `admin-config-wire.ts`, `config-runtime.ts`, related specs and `projectPublicAdminConfig`; modify `collections.ts`, `persistence-profile.spec.ts`, `contracts/index.ts`. Add repository types only after the stored-document types exist, without redefining public interfaces.

- [ ] Add red request cases:

```typescript
import { credentialUpdateRequestSchema, saveSettingsRequestSchema,
  storedConfigDocumentSchema } from './admin-config.js';

it('scopes CAS credential operations separately from nonsecret saves', () => {
  const settings = defaultManageableSettings();
  const save = { protocolVersion: 1, expectedRevision: 0, settings };
  expect(saveSettingsRequestSchema.safeParse(save).success).toBe(true);
  expect(saveSettingsRequestSchema.safeParse({ ...save, candidate: 'fixture-key' }).success).toBe(false);
  const replace = { protocolVersion: 1, expectedRevision: 7, action: 'replace', candidate: 'fixture-key' };
  expect(credentialUpdateRequestSchema.safeParse(replace).success).toBe(true);
  for (const raw of [
    { ...replace, settings }, { ...replace, providerUrl: 'https://evil.invalid' },
    { ...replace, role: 'super-admin' }, { ...replace, expectedRevision: -1 },
    { ...replace, candidate: '' }, { ...replace, candidate: ' x ' },
    { ...replace, candidate: 'x'.repeat(4097) },
    { protocolVersion: 1, expectedRevision: 7, action: 'remove' },
    { protocolVersion: 1, expectedRevision: 7, action: 'remove', confirm: false },
  ]) expect(credentialUpdateRequestSchema.safeParse(raw).success).toBe(false);
  expect(credentialUpdateRequestSchema.safeParse({ protocolVersion: 1,
    expectedRevision: 7, action: 'remove', confirm: true }).success).toBe(true);
});
```

- [ ] Run `npm test -- src/contracts/admin-config.spec.ts -t "scopes CAS"`; expect FAIL absent request schemas.
- [ ] Implement strict save object and strict `z.discriminatedUnion('action', [replaceObject, removeObject])`. Keep each union branch a plain object; refine credential UTF-8 on the candidate string with `TextEncoder` so bytes and characters cannot disagree. Provider is a separately parsed allowlisted route parameter; never take it from a candidate URL. No DB/network operation in schemas.
- [ ] Write stored-document failures using `{_id:'aurvin',schemaVersion:1,revision:1,settings:defaultManageableSettings(),credentials:{openrouter:null,deepgram:null},updatedAt:'2026-10-13T00:00:00.000Z',updatedBy:'aurvin-dev-user'}`. Test revision0/overflow, unknown fields at every level, unsupported schema/id, plaintext key fields, malformed/noncanonical/oversized envelope, invalid date/actor. Valid envelope uses `Buffer.alloc(12).toString('base64')`, 16-byte tag and `Buffer.from('fixture').toString('base64')`; this only tests shape, not authentic crypto.
- [ ] Implement the exact singleton/envelope schemas and revision bounds; add the `ConfigRepository`/`ConfigCasResult` definitions and fake repository examples to `config-runtime.ts`/its spec. Add `COLLECTIONS.config` and update the existing exact collection assertion to include it (rename “six” to “seven including config”). Export the new modules in the backend barrel. Leave indexes/bundle/guarded writes to P2.
- [ ] Add red projection/guard cases:

```typescript
it('projects only configured-state metadata, not envelopes or secrets', () => {
  const document = storedConfigDocumentSchema.parse({
    _id: 'aurvin', schemaVersion: 1, revision: 2, settings: defaultManageableSettings(),
    credentials: { openrouter: { validatedAt: '2026-10-13T00:00:00.000Z', envelope: {
      algorithm: 'aes-256-gcm', nonce: Buffer.alloc(12).toString('base64'),
      tag: Buffer.alloc(16).toString('base64'), ciphertext: Buffer.from('fixture-secret').toString('base64'),
    } }, deepgram: null }, updatedAt: '2026-10-13T00:00:00.000Z', updatedBy: 'aurvin-dev-user',
  });
  const pub = projectPublicAdminConfig(document, null, 'blocked');
  expect(pub.credentials).toEqual({ openrouter: { configured: true,
    validatedAt: '2026-10-13T00:00:00.000Z' }, deepgram: { configured: false, validatedAt: null } });
  expect(pub.activeRevision).toBeNull();
  expect(pub.roleAssumption.authentication).toBe('disabled');
  const text = JSON.stringify(pub);
  for (const word of ['fixture-secret', 'envelope', 'ciphertext', 'nonce', 'fingerprint', 'updatedBy'])
    expect(text).not.toContain(word);
  expect(isPublicAdminConfig(pub)).toBe(true);
  expect(isPublicAdminConfig({ ...pub, credentials: { ...pub.credentials,
    openrouter: { ...pub.credentials.openrouter, lastCharacters: 'secret' } } })).toBe(false);
});
```

- [ ] Run `npm test -- src/contracts/admin-config.spec.ts -t "projects only"`; expect FAIL missing projection/guard.
- [ ] Implement public projection by constructing every allowlisted field, not spreading stored documents or runtime objects. Missing document uses fresh defaults/revision0/absent credentials. Validate public reads with a strict schema and portable `isPublicAdminConfig` guard. Guard settings recursively with exact keys/known types and same intrinsic rules; bootstrap-specific limits remain server validation. Guard errors with closed codes/paths/bounded field counts; no arbitrary strings from the provider. Reject reads where missing state has nonzero revision/configured keys, active state has mismatched revision, or credential configured/timestamp linkage is invalid.
- [ ] Run `npm test -- src/contracts/admin-config.spec.ts src/contracts/config-runtime.spec.ts src/contracts/persistence-profile.spec.ts src/platform/config/manageable-config.spec.ts`, `npm run build`, `npm run lint`. Expect no existing chat error/collection/persistence-profile regression. Encryption at rest and actual CAS/write certainty remain P2 tests, not claims from schema success.
- [ ] Stage the exact contracts/projection files changed with a commit turn; commit `feat(config): add redacted admin CAS and bounded encrypted document contracts`.

```powershell
git add backend/src/contracts/admin-config.ts backend/src/contracts/admin-config-wire.ts backend/src/contracts/admin-config.spec.ts backend/src/contracts/config-runtime.ts backend/src/contracts/config-runtime.spec.ts backend/src/contracts/collections.ts backend/src/contracts/persistence-profile.spec.ts backend/src/contracts/index.ts backend/src/platform/config/manageable-config.ts backend/src/platform/config/manageable-config.spec.ts
git commit -m "feat(config): add redacted admin CAS and bounded encrypted document contracts"
```

## Task 5: Explicit legacy-import projection and transitional loader compatibility

Files: create `legacy-config-import.ts`, `legacy-config-import.spec.ts`; modify comments/type re-exports in `load-config.ts`/`voice-config.ts` and owned loader specs only where useful. The production-call cutover belongs to P6.

- [ ] Add failing import tests:

```typescript
import { parseLegacyConfigImport } from './legacy-config-import.js';

it('imports only manageable names while preserving disabled voice and unknown rates', () => {
  const b = loadBootstrapConfig({ CONNECT_TIMEOUT_MS: '12000' });
  const imported = parseLegacyConfigImport({ OPENROUTER_API_KEY: 'fixture-openrouter',
    OPENROUTER_MODEL: 'fixture/model', DEEPGRAM_API_KEY: 'fixture-deepgram',
    ENABLE_DICTATION_MODE: 'false', ENABLE_LIVE_VOICE_MODE: 'false',
    VOICE_DICTATION_MAX_MS: '10000', DEEPGRAM_API_BASE: 'wss://api.eu.deepgram.com',
    DEEPGRAM_KEYTERMS: ' Aurvin, , LangGraph ', DEEPGRAM_NOVA_RATE_PER_MIN_USD: '',
    MONGODB_URI: 'ignored-private-uri', CONNECT_TIMEOUT_MS: '1',
  }, b);
  expect(imported.credentials).toEqual({ openrouter: 'fixture-openrouter', deepgram: 'fixture-deepgram' });
  expect(imported.settings.voice.enabledModes).toEqual({ dictation: false, live: false });
  expect(imported.settings.voice.dictationWarningMs).toBeNull();
  expect(imported.settings.deepgram.region).toBe('eu');
  expect(imported.settings.deepgram.keyterms).toEqual(['Aurvin', 'LangGraph']);
  expect(imported.settings.deepgram.rates.novaPerMinuteUsd).toBeNull();
  expect(imported.importedNames).not.toContain('MONGODB_URI');
  expect(imported.importedNames).not.toContain('CONNECT_TIMEOUT_MS');
  expect(imported.settings).not.toHaveProperty('persistence');
});
it('refuses unsafe import rather than normalizing policy or reporting values', () => {
  const b = loadBootstrapConfig({});
  for (const env of [ { OPENROUTER_DATA_COLLECTION: 'allow' },
    { OPENROUTER_DISABLE_TRANSFORMS: 'false' }, { ENABLE_DICTATION_MODE: 'yes' },
    { MAX_INPUT_CHARS: '' }, { MAX_CONTEXT_TOKENS: '100' },
    { DEEPGRAM_API_BASE: 'wss://evil.invalid' }, { VOICE_DAILY_SPEND_USD: '1' },
  ]) expect(() => parseLegacyConfigImport({ ...env, DEEPGRAM_API_KEY: 'fixture-secret' }, b))
    .toThrow('Invalid application configuration.');
});
```

- [ ] Run `npm test -- src/platform/config/legacy-config-import.spec.ts`; expect FAIL missing import projector.
- [ ] Implement mapping from the exhaustive tables. Prefer existing `loadConfig`/`loadVoiceConfig` parsing helpers where behavior matches, but **filter input first to the known manageable registry** so safety fields cannot affect imports. Build infrastructure-independent legacy chat/voice candidates using default safety; then validate/project against the supplied actual bootstrap. Copy only mapped nonsecret fields, canonicalize region, extract credentials separately and derive the dictation warning. Reuse defaults/validators, not another override hierarchy. Empty/missing optional rates/spend ->null; valid zero rate preserved. Any error becomes a static sanitized AppError; never attach raw env/exception text to it.
- [ ] Add a table-driven check for every manageable registry name with a valid nondefault fixture and expected path (including privacy fixed values and provider candidates). Add numeric undefined vs empty, null/zero rate, both independent flags, aliases rejected, policy import refusal, unknown/infrastructure-name exclusion and derived warning cases. Validate candidate size/control rules before P2 provider verification.
- [ ] Make compatibility intent explicit in the existing loaders: `loadConfig(env)` and `loadVoiceConfig(env)` remain legacy **fixture/import adapters** with their existing outputs/defaults; no live-config port, master key or overlay is added to them. Their current production callers remain temporarily until P6's single coordinated cutover. No `NODE_ENV==='test'` hidden behavior, automatic import or env fallback flag.
- [ ] Run `npm test -- src/platform/config/legacy-config-import.spec.ts src/platform/config/load-config.spec.ts src/platform/config/voice-config.spec.ts src/contracts/testing/voice-fixtures.spec.ts`; then `npm run build`, `npm run lint`. Expect all pass, including old fixture behavior. Report the remaining production call as pending P6 integration, not a P1 defect concealed by the adapter.
- [ ] Stage the exact owned import/loader files with a commit turn; commit `feat(config): prepare explicit legacy import without runtime overlays`.

```powershell
git add backend/src/platform/config/legacy-config-import.ts backend/src/platform/config/legacy-config-import.spec.ts backend/src/platform/config/load-config.ts backend/src/platform/config/voice-config.ts
git commit -m "feat(config): prepare explicit legacy import without runtime overlays"
```

If an owned existing loader spec changed, stage only its exact path additionally (`backend/src/platform/config/load-config.spec.ts` or `backend/src/platform/config/voice-config.spec.ts`); never stage the directory.

## Task 6: Browser-safe public protocol and cross-package parity

Files: create `frontend/src/api/admin-config-protocol.ts`; extend `backend/src/contracts/admin-config.spec.ts`. Matching frontend protocol test ownership is outside the explicitly assigned P1 file, so keep parity/guard tests in the owned backend spec; P5 creates its frontend client/protocol-consumption tests.

- [ ] Add a red parity check to the backend spec, matching the established separately mirrored chat/voice protocol design without importing backend types into the browser:

```typescript
import { readFileSync } from 'node:fs';

it('mirrors only the public admin contract into the frontend', () => {
  const backendText = readFileSync(new URL('./admin-config-wire.ts', import.meta.url), 'utf8');
  const frontendText = readFileSync(new URL('../../../frontend/src/api/admin-config-protocol.ts', import.meta.url), 'utf8');
  const exportedBody = (text: string) => text.slice(text.indexOf('export const ADMIN_CONFIG_PROTOCOL_VERSION'));
  expect(exportedBody(frontendText)).toBe(exportedBody(backendText));
  expect(frontendText).not.toMatch(/from ['"].*(platform|admin-config-runtime|config-runtime|persistence|node:)/);
  for (const word of ['AURVIN_CONFIG_ENCRYPTION_KEY', 'StoredConfigDocument',
    'EncryptedCredentialEnvelope', 'DecryptedCredentials', 'RuntimeConfigSnapshot'])
    expect(frontendText).not.toContain(word);
});
```

The relative URL from `backend/src/contracts` to repository `frontend` is `../../../frontend/...`. Normalize only imports/header prelude by slicing after first export; keep identical exported bodies so drift fails a runnable check. Use named functions for public guards; they must not call server-side Zod/Buffer or import a backend module. Type-only `VoiceLimits` import is backend `./voice-wire.js`, frontend `./voice-protocol`; keep it in the prelude.
- [ ] Run `npm test -- src/contracts/admin-config.spec.ts -t "mirrors only"` from `backend`; expect FAIL absent frontend mirror file.
- [ ] Copy the exact public exported body and frontend voice type-only import into `frontend/src/api/admin-config-protocol.ts`. Include only public types/guards/constants. Credential request candidate type is permitted; stored/runtime/decrypted credentials are not. No browser-storage code, client fetch code, masked UI or key-generation/crypto helper.
- [ ] Run the focused parity test again; expect PASS. Run `npm run build`/`npm run lint` from `frontend`; expect public types typecheck without introducing a runtime dependency. Run `npm test` from `frontend`; expect existing discovery unchanged (no new frontend test file claimed).
- [ ] Stage `frontend/src/api/admin-config-protocol.ts` and the owned backend spec with a commit turn; commit `feat(config): publish browser-safe admin configuration protocol`.

```powershell
git add frontend/src/api/admin-config-protocol.ts backend/src/contracts/admin-config.spec.ts
git commit -m "feat(config): publish browser-safe admin configuration protocol"
```

## Task 7: P1 verification, migration handoff and integration closure requirements

No implementation in other owners' files. Complete any port type references deferred across Tasks 3/4 and fix only owned defects, rerunning their focused checks. Do not dispatch a reviewer.

- [ ] From `backend`, run `npm test -- src/contracts/admin-config.spec.ts src/contracts/config-runtime.spec.ts src/platform/config/bootstrap-config.spec.ts src/platform/config/manageable-config.spec.ts src/platform/config/legacy-config-import.spec.ts src/platform/config/load-config.spec.ts src/platform/config/voice-config.spec.ts src/contracts/budgets.spec.ts src/contracts/persistence-profile.spec.ts`. Expect nonzero new test discovery, all executed assertions pass and no provider/native contact.
- [ ] From `backend`, run `npm run build`, `npm run lint`, `npm test`, and `npm run test:e2e` separately. From `frontend`, run `npm run build`, `npm run lint`, `npm test` separately. Record actual counts/skips. Native tests may skip without prerequisites; zero/skip exit is not native evidence. Do not run behavior/live/Azure checks/import or change private env to make a gate pass.
- [ ] Run `git diff --check` and inspect named changed-file scope. Report unrelated failures to their owner; do not expand P1 to fix voice investigations/assembly.
- [ ] Send orchestrator the actual source map, final exported signatures/files, all implementation commits, test results and pending P6 closure below. Orchestrator must be able to dispatch P2–P5 using this summary without reading the plan.

P6 production cutover is mandatory, not optional compatibility debt:

1. Replace `platform.module.ts` production `loadConfig(process.env)` with `loadBootstrapConfig(process.env)`; emit the safe obsolete-name warning once. Replace `AppService` environment-config composition with the stored-config/current-port flow. Do not import the legacy projector except in `scripts/import-config.ts` or fixtures/tests. Extend the exact-origin CORS method allowlist in `main.ts` to include PUT for nonsecret saves; preserve credential POST and origin/body validation rather than enabling arbitrary methods/origins.
2. Preserve diagnostic/liveness and admin availability with missing DB/model/key/master key, but block generation/secret mutation appropriately. Stored-invalid/decryption failure must never cause env fallback or default overwriting.
3. Use one persistence/open/close/ownership/journal path and one current revision publisher. Preflight assets/catalogue with candidate budgets, then confirmed CAS then publish; no owner replacement or quota reset.
4. Migrate P3/P4/P6 fixture construction when their consumers change. Existing old loader tests may remain explicit importer/compatibility tests; normal assembly tests must now inject bootstrap and stored/snapshot fixtures rather than pretending env is runtime authority. P7 includes a runtime test using malformed/different legacy values and saved values to prove they cannot override storage.
5. Normal production source must have **zero reachable legacy manageable reads**: grep loader/import references and trace callers, not merely file strings. `loadVoiceConfig({})` default compatibility can be replaced by `defaultManageableSettings` projections; never pass process env. No dual config owner or ongoing `.env` plaintext configuration for manageable values.
6. P6 operator import obtains admitted ownership, verifies/encrypts nonempty candidates, creates only when absent, preserves disabled flags/null rates, writes once through guarded persistence, logs names/counts/categories only, drains cleanly and leaves `.env` unchanged. P1's projector is not migration execution or evidence.
7. Update `backend/.env.example` (actual path, not a nonexistent root example), README/operator docs and any necessary package script through P1 ownership coordination. Document safe local master-key generation, separate restricted backup, HTTPS/local exception, manual removal of migrated names and explicit rollback/no plaintext export. Never generate/replace the key in startup code.

## Handoff risks and acceptance coverage

- P2 consumes `ConfigRepository`, singleton/envelope schemas, admin request/redacted response/error contracts, fixed validation limits and activation port. It owns AES-GCM, official provider response/US-EU verification, no-redirect HTTPS, origin/body/cache/rate safeguards, actual BSON/write/journal/CAS tests and uncertain outcome handling. Provider credential recognition does not certify model access/credit/speech usability.
- P3 consumes `CurrentConfigPort`, `RuntimeConfigSnapshot`, `VerifiedModelLimits`, composed budgets. It owns dynamic admission/attempt capture, catalogue/fixed-asset validation integration, automatic retry stability, explicit retry freshness and terminal/recovery regression tests; no secrets in persisted graph/attempt records.
- P4 consumes the same snapshot plus effective credential/desired-mode separation and `dictationWarningMs`. It owns voice admission/reconnect/live-turn/rate snapshots, accounting continuity and browser-safe capabilities refresh without mutating active negotiated sessions. Config edits cannot reset counters or rebuild reservation/usage owners.
- P5 consumes only `frontend/src/api/admin-config-protocol.ts`, the exact paths/public shapes and role-assumption metadata. It owns dirty-field protection, revision conflicts/rebasing after credential operations, fixed dots/configured state, local transient candidate cleanup and safe response/error rendering. It must not accidentally copy candidates into a global draft/local persistence.
- P6 owns the temporary loader cutover, central readiness/owner/activation/import wiring and operator docs. P7 verifies actual integrated AC1–AC8, with fixture/native/browser results distinguished. P1 alone satisfies schema/source-map/projection portions of AC2/AC3/AC6, not actual encrypted persistence, immediate runtime adoption or restart durability.
- Lower infrastructure ceilings can invalidate existing/default settings; fail diagnostically, never clamp/import silently. New aggregate queue safety may refuse an unsafe oversized legacy queue; report its field category and operator action without values. Unknown provider rates remain null.
- Do not infer topology/Azure/gateway/hardware support from parsing a profile/region or passing fixtures. Authentication remains deferred and role is a development assumption. Paid/live/provider/import/deployment checks remain unauthorized for the agent. Research/review stay **skipped**.
