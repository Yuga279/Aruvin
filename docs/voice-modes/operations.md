# Voice modes operations

Policy for the scoped voice baseline. This file is not measured evidence. P11 owns `staging-evidence.md`, `verification.md`, and `pilot-evaluation.md`. Review is skipped, not passed. Do not provision infrastructure, deploy publicly, enable flags, or run paid provider checks from this runbook.

## Scope and topology

Voice is admitted only on loopback or inside the existing access-controlled staging boundary. One Node process and one database executor. No rolling overlap, no second runtime, no browser-supplied identity, and no new authentication. Dictation and live voice stay independently default-off. Text chat remains available when either flag is off.

Session creation, deletion, and the WebSocket upgrade use the same `/api` boundary as text chat. Origin checks, the connection ticket cookie, and the shared development identity are not user authentication. Credentials stay in backend secrets. They must not appear in URLs, Vite settings, or logs.

P10 wires `VoiceUsageService` into the P5 admission, usage, and disconnected hooks, and into `speechDegraded`, `drainVoice`, and `voiceSnapshot`. P10 implements `stop` as `VoiceSessionService.end`. That releases the admission lease. P10 must not point speech failures at `Readiness.providerFailure`.

## Quotas and clocks

| Control | Default | Enforcement |
| --- | --- | --- |
| Dictation duration | 300000 ms | Warn 30000 ms before the cap, then stop `duration` |
| Live duration | 1200000 ms, warn at 1080000 ms | Warn, then stop `duration` |
| Live idle | 60000 ms warning, then 30000 ms | Stop `idle`. Dictation pauses do not idle-stop |
| Identity / global concurrency | 1 / 4 | Reject `VOICE_QUOTA_EXHAUSTED` before provider allocation |
| Identity / global daily minutes | 60 / 120 | Wall-clock, UTC day the session started. In-memory |
| Daily spend | unset | Known rates only. Missing rates stay unknown, never `$0` |
| Voice admissions | same number as `maxRequestsPerMinutePerUser` (20) | Sliding 60s window. Not a Deepgram rate |

The clock starts at admission, which is slightly before the socket is ready. Connect budget is already capped at 10 seconds. Process restart resets in-memory quota counters; those ceilings are not durable billing. Direct speech accounting is now stored separately in the existing `metadata` collection as described below; it does not make quotas restart-durable.

Cancellation and quota stop do not claim charge prevention. Provider usage that arrives after release is still attributed. Stable socket/response usage IDs deduplicate replay, not equal usage tuples: two identical speeches count twice, and reconnect/mute-resume sockets count separately even without provider request IDs. Cumulative STT snapshots replace, they do not add.

## Direct Deepgram attribution and durable accounting

Canonical monetary evidence and bounded internal text/voice reports are described in [MongoDB accounting operations](../mongodb-usage-accounting/operations.md). Existing voice fields remain readable; actual invoice cost is still unknown. TTS response estimates and socket audio observations remain distinct, and TTS socket lifecycle rows are not added to response charges. The accounting maintenance command is separate opt-in tooling, not authority to migrate application data.

All direct Nova `/v1/listen`, Flux `/v2/listen`, and Flux `/v2/speak` WebSockets carry one immutable `tag` query parameter: `aurvin-user-` plus a domain-separated SHA-256 hash of the trusted server user ID. Raw user identity is not sent as a tag. This is a stable pseudonym, not anonymization or authentication. Mongo records keep its mapping to `userId`. The current server-configured development identity is shared by all local browser users; this is **not** per-person attribution until a future trusted authentication boundary supplies distinct identities. Browser identity overrides remain rejected.

`metadata.kind = "voice-accounting"` contains one bounded record per provider socket and one per TTS response. Socket and response admission is persisted as `pending` **before** opening a provider socket or sending the first `Speak`. Terminal statuses are `closed`, `completed`, `interrupted`, `cancelled`, or `failed`. Records include `userId`, voice-scoped `sessionId`/`voiceSessionId`, nullable `conversationId`, stable `usageId`/`providerSocketId`, tag, model/version, nullable provider request/speech IDs, turn/response linkage, start/end times, and usage evidence. Join TTS response IDs to `voice-delivery` to find the chat attempt; dictation and unsaved voice need no chat attempt. No audio, transcripts, generated text, or private reasoning are stored in accounting.

STT `observedAudioMs` measures input successfully acknowledged by the socket send callback; it is **not** a Deepgram billable duration. STT `audioMs` and `estimatedCostUsd` stay null without provider billing evidence. TTS `audioMs`/`billableCharacters` come from provider `SpeechMetadata` or `SpeechInterrupted`; `estimatedCostUsd` uses the configured TTS rate only when billable characters are reported. Missing evidence/rates remain null. `actualCostUsd` is always null: WebSocket metadata does not establish invoice charges. TTS socket records have no usage totals; sum response records, not socket counts. In-memory operations spend remains a rate-based estimate and is not this durable ledger.

Accounting writes use executor checks and existing bounded, scoped Mongo insert/revision-CAS machinery (including local mutation journaling). Queue overflow or a delivery consumer failure cannot drop the independent accounting write. Failed admission prevents the billable request; failed terminal persistence is surfaced by close/drain and prevents a safe persistence shutdown. A hard crash can leave `pending` records: treat their billing as **unknown**, never zero or completed. Recovery must not replay transcription, synthesis, or inference to fill accounting gaps. There is no automatic provider management-API polling, invoice reconciliation, or charge-prevention guarantee.

Operator queries, run only against the intended database via the existing approved connection procedure:

```javascript
db.metadata.find({ kind: "voice-accounting", userId: "<server-user-id>" },
  { _id: 0, usageId: 1, providerSocketId: 1, userTag: 1, model: 1, status: 1,
    conversationId: 1, responseId: 1, observedAudioMs: 1, audioMs: 1,
    billableCharacters: 1, estimatedCostUsd: 1, actualCostUsd: 1,
    startedAt: 1, endedAt: 1 }).sort({ startedAt: -1 }).limit(100);
db.metadata.find({ kind: "voice-accounting", userId: "<server-user-id>", status: "pending" })
  .limit(100);
```

Existing user-prefixed metadata indexes support scoped reads; no new collection, TTL, or migration is required. Deepgram usage/billing APIs can filter/group the persisted tag; these direct requests **do not appear in OpenRouter's dashboard**. Deepgram tags are immutable per request, limited to 128 characters and 500 unique tag values per project per 24 hours; Console tag grouping is disabled at 500 or more tags in the selected period. Review that limit before introducing many authenticated identities. See [Deepgram tagging](https://developers.deepgram.com/guides/fundamentals/tagging-your-usage-data.md) and the [Nova](https://developers.deepgram.com/reference/speech-to-text/listen-streaming), [Flux STT](https://developers.deepgram.com/reference/speech-to-text/listen-flux), and [Flux TTS](https://developers.deepgram.com/reference/text-to-speech/speak-flux) references. No live provider validation or rate confirmation is implied by deterministic tests.

Client-visible `session.warning` and `session.ended` reasons `duration`, `idle`, and `shutdown` need the P5 follow-up named in `plan9.md`. Until that commit exists, the server still stops the session, and the live flag must not be enabled for operators. Dictation duration enforcement does not need that follow-up.

## Readiness without paid probes

`/api/operations/live` is process reachability only. It must not call Deepgram, OpenRouter, or the database.

`/api/operations/ready` remains the text-chat gate. Speech status is a separate `speech` field:

| `speech` | Meaning | Text `acceptReady` |
| --- | --- | --- |
| `off` | Both voice flags off | Unchanged |
| `unconfigured` | A flag is on and `DEEPGRAM_API_KEY` is missing | Unchanged, no paid call |
| `ready` | Enabled, key present, no recorded speech failure | Unchanged |
| `degraded` | `VoiceUsageService.degrade()` was called | Unchanged |

A speech failure must not call `stopAccepting`, must not set `process.exitCode`, and must not cool text generation. Do not supervise `/ready` as a restart probe. Provider auth or credit failures on the text path keep the existing text circuit; speech must not be wired into that circuit.

## Redacted telemetry

Voice logs are JSON objects with `kind: "voice-usage"`, an action, a hashed session id (`h:` plus 24 hex chars), mode, reason, and code. They must not contain transcripts, audio, API keys, raw session ids, provider request ids, or token text. Aggregate `metrics().voice` exposes counts, milliseconds, character totals, token totals, spend status, and p50/p95. Empty latency is null. The `tool` segment stays empty because tools are out of scope.

Text-chat `METRICS` cells are unchanged. Unknown spend is `estimatedSpendUsd: null` and `spendStatus: "unknown"`. Do not alert on a fabricated zero.

Actual account rates are operator inputs: `DEEPGRAM_NOVA_RATE_PER_MIN_USD`, `DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD`, and `DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD`. A spend cap requires all three. Invoice reconciliation is an operator action, not a health check.

## Staging WebSocket proxy

Use `deployment/staging/nginx.conf`. The exact location `= /api/voice` is the socket. REST `/api/voice/sessions` and `/api/voice/config` stay on the existing `/api/` location and the existing basic-auth server block. Operations routes stay local-only.

The socket location sets `Upgrade` and `Connection "upgrade"`, clears `Authorization`, `X-Forwarded-For`, and `X-Request-ID`, and uses a 10 second connect timeout and 1260 second read/send timeouts. 1260 seconds is longer than the 20 minute live cap so the application policy fires first. Proxy timeout is not the quota. Buffering and cache stay off. Access logs stay off. Do not log the upgrade URL.

Backend remains bound to `127.0.0.1:3000`. The gateway remains the selected staging profile. Copying the config does not start NGINX, install certificates, or open a firewall. `nginx -t` is syntax only and is not streaming evidence.

## Drain and shutdown

1. Stop text admission, then drain the text runtime.
2. Drain voice by calling `VoiceUsageService.drain()`, which stops new admissions, asks each active session to end, and releases leases.
3. Close persistence only when text drain, voice drain, and HTTP transport are quiescent.
4. A hung or active voice drain is unsafe. Do not close the database and do not delete the executor sentinel.
5. Supervisor hard-stop remains 45 seconds, as in [Phase 1 operations](../aurvin-phase-1/operations.md). A speech outage is not a reason to restart.

## Retention, deletion, migration, and rollback

No raw audio is stored. Transient buffers belong to the session and provider adapters and are cleared on end. Finalized internal voice turns, if written by P2, follow the existing conversation retention policy. There is no voice TTL and no automated session deletion in this workflow.

Quota/operations counters remain process memory; durable `voice-accounting` records live in `metadata`, not a seventh collection. Retain them as accounting/audit evidence when deleting a conversation, like existing attempt/accounting/delivery records. Apply the existing metadata retention policy; no new automatic deletion is introduced. Backup and restore remain the six-collection procedure in the Phase 1 runbook. Do not add a voice collection to `mongodump`. Do not put URIs, keys, or transcripts in evidence.

No voice schema migration is authorized here. Rollback of the voice feature is flag-off, then drain, on the same release. Do not roll an older build that does not understand `visibility: internal` onto data that already contains internal voice messages. If that data exists, restore an isolated pre-voice snapshot using the Phase 1 procedure and switch only after operator approval. Do not replay prompts. Record any post-snapshot provider cost as unknown unless the invoice says otherwise.

Disabling one flag must leave the other flag and text chat operable. Disabling both leaves diagnostic liveness and text chat on their existing gates.

## Operator inputs still required

Actual Deepgram rates, whether to set `VOICE_DAILY_SPEND_USD`, privacy/model-improvement choices, and any staging exposure beyond loopback are operator decisions. This document does not supply them and does not authorize the spend. P11 records measurements. Unavailable latency, fidelity, device, and cost results stay blocked or unrun, not passed.
