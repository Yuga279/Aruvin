# Goal: Super-admin configuration

## Approval and scope

Design and written specification/graph approved in this session on 13 October 2026. The user said “I approve this” and requested skipping research and code review. Planning, implementation, testing, defect correction, and final verification are authorized. Execution of the operator migration, agent-run live/paid provider checks, provisioning, and deployment remain outside this approval.

Build a separate, modern settings dashboard for Aurvin. Until authentication and RBAC exist, the server assigns the existing development identity the super-admin role. This is a development assumption, not proof of authentication or authorization. Chat remains the landing page.

The user approved MongoDB as the sole source of manageable settings, write-only provider credentials, non-billable credential validation, immediate activation for new work, an explicit one-time environment import, and the sidebar entry shown in their annotated screenshot. Research and unified review are **skipped** by user instruction; planning, execution, defect correction, and final verification remain required. Assigned planners/workers still check relevant source and current API documentation as necessary for correct implementation; no separate researcher or reviewer is dispatched.

## User experience

- Pin a profile row labeled **Super admin** to the bottom of the existing chat sidebar, below independently scrolling history. Opening it reveals **Manage Aurvin** and a disabled **Sign out**, explained by “Authentication not enabled.” Do not implement fake logout or imply a signed-in account.
- Manage Aurvin opens a separate dashboard; Back to chat returns to chat. Preserve chat selection/draft and do not cancel an active stream or voice session merely by navigating. Keep one ChatProvider and one voice lifecycle owner.
- Dashboard tabs are **Config** and **Analytics**; Config is selected when entering through Manage Aurvin. Analytics has an empty content area, without charts, sample metrics, or analytics requests.
- Config has section navigation: **OpenRouter**, **Chat limits**, **Voice**, and **Deepgram**. Show one group at a time, with quotas and advanced speech settings organized within the relevant group. On mobile use a compact section selector. Avoid exposing raw environment-variable names as primary labels.
- Use Aurvin's existing OpenAI-style light/dark visual language: monochrome surfaces, generous spacing, restrained borders, clear sans-serif headings, existing system/utility fonts, and readable field rows. Reuse existing color tokens rather than adding a competing theme or external font dependency. The defining interaction is a clear configured-state credential row, not decorative dashboard statistics.
- Use plain labels, units, concise help text, visible focus, keyboard-operable menus/tabs, accessible status/errors, and reduced-motion support. The profile menu opens above its row, closes on Escape/outside focus or click, and returns focus appropriately. Support mobile without horizontal page overflow.
- Nonsecret edits stay in memory until **Save changes**. Show dirty, saving, saved/active, conflict, unavailable, and validation-error states; protect unsaved edits when changing sections or leaving the page.
- A configured credential is represented by a fixed number of dots and **Configured**, independent of key length. Never return/display its value, prefix, suffix, fingerprint, or last characters. Offer **Replace key** and **Remove key**, with removal confirmation. There is no reveal button.
- The replacement editor is a masked input. **Validate and save** initiates one operation: validate on the backend, persist automatically if valid, and activate for new work. There is no second Save click for a credential. Never submit on each keystroke. Clear the candidate after success, cancel, or leaving the editor. Retain it only transiently in the editor after an actionable failure; never copy it to global state or storage.
- Credential operations and nonsecret saves have separate, explicit scopes: validating a key does not implicitly save unrelated dirty fields. Credential operations update the current revision without discarding unsaved nonsecret edits.

## Configuration ownership

MongoDB's new **`config`** collection is the only runtime source for manageable values. No ongoing environment override or plaintext configuration file for these values. Reuse existing defaults and validators where applicable; defaults are not permission to enable voice or weaken admission.

| Source | Settings |
| --- | --- |
| Environment only | `PORT`, `FRONTEND_ORIGIN`, `NODE_ENV`, `AURVIN_USER_ID`, persistence profile, MongoDB URI/database/credentials, executor topology/local recovery, the new encryption master key, infrastructure/storage safety settings, and frontend API/proxy locations. |
| Config: OpenRouter | API key, one backend-selected model ID, data-collection policy, and transform policy. Existing admitted restrictions remain: data collection denied and transforms disabled; show these as fixed policy, not toggles that bypass admission. No chat model picker. |
| Config: chat limits | Input characters/tokens, messages in context, context/output tokens, model margin, title length, process generation concurrency, per-user request rate, retry count/delays, first-output/idle-stream/total-run deadlines. One active attempt per session remains fixed at one. |
| Config: voice | Independent dictation/live flags, dictation/live duration and warning limits, idle warning/exit, finalization/reconnect/connect timeouts, input/output queue limits, identity/global concurrency and daily minutes, optional daily spend cap. |
| Config: Deepgram | API key, supported US/EU API region, supported dictation/live/TTS models, endpointing, spoken punctuation, keyterms, Flux end-of-turn threshold/timeout, and configured STT/TTS rates. Preserve existing provider/model allowlists; do not claim arbitrary models are supported. |

Infrastructure/storage safety settings retained outside the editor include document/message/manifest byte ceilings, pagination limits, shared database connection/persistence deadlines, and shutdown drain. Existing `CONNECT_TIMEOUT_MS` remains the shared connection ceiling; do not introduce a duplicate model-only control for it. Expose application input/output/context controls without allowing them to exceed fixed storage, transport, provider, or admitted-topology ceilings. Testing-only variables remain test configuration, not dashboard controls. P1 owns the exhaustive source mapping and removal of legacy manageable runtime reads.

Introduce `AURVIN_CONFIG_ENCRYPTION_KEY`, a backend-only base64 encoding of 32 random bytes, documented with a safe local generation procedure. Never generate or replace it silently. It is not stored in MongoDB or sent to the browser. Back it up separately with restricted access; losing it makes stored credentials unusable. Encryption-key rotation and external secret managers are outside this feature.

Legacy manageable environment entries are used only by the explicit import command. Normal startup ignores them with a value-free warning identifying obsolete setting names, not values. Existing infrastructure values are preserved. Update `.env.example`, setup/run guidance, and operator documentation accordingly; do not overwrite private environment files automatically.

## Storage and secret handling

- Store one bounded application configuration document with a stable identifier, schema version, increasing revision, validated nonsecret settings, encrypted credential envelopes, configured-state validation metadata, update time, and server-resolved actor identity. Do not grow embedded change histories or store duplicate key copies in metadata/checkpoints/logs.
- Use authenticated encryption through the Node standard library: AES-256-GCM, a fresh random nonce per encryption, authentication tag, and associated data binding the envelope to its credential name/schema. Ciphertext/tags/nonces are internal and absent from API reads. No custom cryptographic algorithm or new crypto dependency.
- Only the backend credential service decrypts keys for provider use. Plaintext exists transiently in browser/backend memory as necessary; this is encryption at rest plus transport security, **not end-to-end encryption** or a guarantee against a compromised client/server.
- Never persist keys in application-managed browser local storage, session storage, cookies, IndexedDB, URLs, query strings, or caches. Do not log credential request bodies, authorization headers, provider response bodies, ciphertext envelopes, or exception text that could contain secrets. Best-effort input autocomplete controls are not a promise about browser extensions/password managers.
- Admin API responses use `Cache-Control: no-store`. Validate bounded JSON bodies, allowlisted fields/provider destinations, exact configured browser origin and browser mutation origin checks; reject form submissions and unexpected fields. Origin/CORS checks reduce browser attacks but are not authentication. Keep bounded validation concurrency/rate limits and safe, actionable error categories.
- Outside explicit localhost development, serve browser-to-gateway traffic over trusted HTTPS and keep gateway-to-backend traffic on the existing same-host loopback boundary. Do not send credentials through remote plaintext HTTP or disable TLS verification. Provider verification always uses HTTPS with fixed/allowlisted hosts and no credential-bearing redirects. The implementation must document/enforce the development exception rather than label all localhost HTTP as encrypted.
- Validation uses OpenRouter `GET https://openrouter.ai/api/v1/key` with bearer authorization and Deepgram's documented `GET /v1/auth/token` with token authorization, with regional handling confirmed during research. Research must verify status/response semantics and restrict destinations. Do not substitute project-admin permission checks or generate text, speech, or temporary browser credentials.
- Provider checks are bounded (10-second request deadline, at most 64 KiB response, no automatic validation retries); malformed responses, timeout, rate limits, and provider outage do not count as success. These checks prove credentials are recognized, not paid-model access, speech-model support, account credit, or end-to-end usability. Label this limitation in the UI/docs.
- Failed candidate validation/encryption/write preserves the previous stored and active configuration. A failed write never reports success. If durable write outcome is unknown, resolve by revision/read-back within admitted persistence rules or surface uncertainty and refuse conflicting activation; never bypass the mutation journal/quarantine.
- Compare-and-swap revisions prevent lost updates. A key validated while another save changes the revision must not overwrite newer settings. Return a conflict and require refresh/retry. Successful responses never echo the candidate or raw provider details.

## Live application of configuration

1. Read and validate the stored configuration before enabling generation. Missing provider keys yields a usable configuration page and diagnostic/not-ready chat, not a bootstrap dependency on chat readiness.
2. Validate a candidate against existing cross-field rules and immutable safety limits. A changed OpenRouter model must have verified catalogue limits before it becomes active; metadata lookup is not paid inference. Missing Deepgram credentials must never silently enable speech; retain safe unconfigured/off behavior.
3. Persist the entire candidate atomically under the expected revision with existing durable write/ownership rules; publish the new in-memory revision only after confirmed persistence. A successful response means the change is saved and available for new work without a process restart.
4. Each new text generation attempt and new voice session captures a consistent configuration snapshot. Active attempts keep the original provider key/model/budgets for automatic retries; active voice sessions keep their snapshot through reconnects and related live turns. Explicit user retry creates a new attempt using current settings. Do not persist decrypted keys in attempt records or checkpoints.
5. Retain one runtime, one persistence connection/close owner, one reservation authority, and one usage accounting authority. Do not reassemble overlapping executors for every edit. Update shared admission safely: lowering concurrency does not cancel already admitted work; new admission waits/refuses within the new ceiling. Disabling voice blocks new sessions, without abruptly terminating existing ones.
6. Daily usage/spend and rate-limit accounting survive edits: configuration changes are not a quota reset. Active voice accounting uses the rate snapshot that belongs to that session, with existing unknown-cost semantics.
7. Refresh the browser's safe voice capabilities after changes so a new session can use enabled modes without page reload. Do not replace an active voice session's negotiated limits with the new capabilities.
8. On restart, load saved settings rather than legacy environment values. Invalid stored schema/settings or undecryptable credentials are actionable diagnostic failures; do not silently fall back to plaintext env keys or overwrite corrupted data. Missing/invalid master key blocks secret saves/activation with safe guidance. Database outage leaves liveness available and the admin page able to show storage unavailable, without writing a local substitute.
9. Preserve crash recovery and durable terminal-state behavior. After process loss, use existing reconciliation; never replay inference solely to apply configuration. Saved graph results can finalize without provider repetition. There is no guarantee that removed/revoked keys remain usable for already active requests or that cancellation prevents charges.

## One-time import

- Supply an explicit backend migration command; do not execute it automatically during install/startup or this documentation stage.
- Read legacy manageable values privately, apply the same defaults/validation rules, and validate nonempty credentials with the selected non-billable provider checks. Preserve deliberately disabled voice and unknown rates.
- Import only when no config document exists. Claim/use the admitted executor and mutation boundary; refuse concurrent backend ownership. An import must not become an external writer or delete a stale sentinel. It needs no inference or second application runtime.
- Persist one encrypted, validated document atomically; repeat invocation is a safe refusal/no-op, never a reset or overwrite. Failed validation or storage leaves no partial document and does not delete existing credentials.
- Report only setting names/counts and success/failure categories, never values. Leave `.env` unchanged, with instructions to remove migrated entries manually while retaining infrastructure settings and the master key.
- Back up encrypted configuration with the application database, and the master key separately. Document restoration, validation failures, graceful command shutdown, and rollback limitations. Returning to an env-only release is an explicit operator action; there is no plaintext export endpoint.

## Boundaries and verification

No authentication/RBAC implementation, public deployment, analytics implementation, extra MongoDB feature collections, provider-key reveal, arbitrary environment editor, voice-model expansion, live tools, automatic compaction, or unrelated refactor. Preserve unrelated intervening user commits/changes, including voice defect-investigation work.

| Acceptance | Required evidence |
| --- | --- |
| AC1: Sidebar entry, separate dashboard, empty Analytics | Accessible menu/tab/navigation tests plus actual desktop/mobile browser inspection; chat draft/active work not lost on navigation. |
| AC2: Environment/config separation | Exhaustive source mapping, tests proving legacy manageable values do not override stored config, blank-key bootstrap, and safe defaults. |
| AC3: Write-only encrypted credentials | Ciphertext-at-rest, decryption round trip/tamper failure, fresh nonce, redacted APIs/errors/logs, fixed masking, no browser-storage writes. |
| AC4: Validate then automatically save | Fixture success/failure/timeout/rate-limit/malformed/oversized-response tests; old key survives failure; no paid endpoint invoked. |
| AC5: Immediate, consistent activation | New text/voice work uses new revision; active retry/reconnect/live work uses original snapshot; no duplicate owners or quota resets. |
| AC6: Safe edits and removal | Cross-field/model/storage caps, CAS conflicts including delayed key validation, confirmed removal, unavailable/uncertain writes, and disabled-mode admission. |
| AC7: Import and restart durability | Empty-store import, populated-store refusal, invalid-key no-partial-write, no secret output, ownership/journal checks, and restart reading saved encrypted keys. |
| AC8: Reliable integration and security | Full backend/frontend package checks, admitted native isolated-database checks when prerequisites exist, regression coverage for chat finalization/recovery and voice accounting, origin/body/TLS boundaries, and evidence with explicit skips. |

Use existing Vitest/provider fixtures and isolated generated MongoDB test databases. Native checks require operator-supplied `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; never use application data. Routine tests do not send real credentials to providers. Real credential checks occur only when explicitly invoked by an operator in the UI/import command. Agent-run live checks need separate authorization; no paid checks are authorized.

The final verification/report must record the actual commit set, environment, executed results, skipped/unrun checks, remaining release gates, and review as **skipped**, never passed. Local fixture success is not production, Azure, gateway, or real-provider certification.

## Design self-check

The specification distinguishes role assumption from authentication, credential validity from feature usability, stored versus active revisions, new versus active work, nonsecret saves versus credential actions, and approved design versus written-spec approval. The scope has no analytics placeholder implementation or secret-reveal path. Exact implementation interfaces and package placement belong to committed plans under the ownership graph in [state.md](state.md). Research-phase references above now mean targeted compatibility verification by assigned planners/workers, not a separate research phase.
