# Live delivery investigation and small TDD plan

Date: 13 October 2026. Investigated baseline: `ed3f5cb` (initial checkout clean).
Role: owning P3/P5/P6 defect investigation, **not implementation or review**.
Unified review remains **SKIPPED**. The completed workflow's historical evidence is not retroactively changed.

## Authorized live evidence: TTS Connected validation fails

**Latest finding, 13 October 2026:** one explicitly authorized silent pair of configured speech-provider connections reproduced the startup validation failure. The original failure is now identified: **the provider's TTS `Connected.model_name` is a string but differs from configured `flux-haley-en`; the adapter incorrectly requires exact equality** (`flux-tts.ts:88`). The preceding offline investigation remains below as historical evidence, not the latest attribution.

### Exposure and sanitized results

- Authorization: exactly one STT and one TTS connection; no retries, microphone/audio frames, text, application startup, database access/writes, executor/sentinel changes, or `.env` edits.
- Existing backend bootstrap uses Node's `process.loadEnvFile`, not dotenv; the probe used that same loader and the real `loadVoiceConfig` / provider URL builder / socket factory. Credentials, environment, URLs, headers, request IDs, and raw packets were never printed.
- Both sockets opened once. Total probe elapsed: **7484ms**, including approximately six seconds of idle observation; all sockets terminated in `finally`. The hard bound was 18500ms with a 20000ms shell limit.
- This was a direct WebSocket probe with current Connected validation equivalence, not a full app/adapters/accounting execution. It omitted the optional tracking tag and sent no heartbeat or application control messages.

| Role | Configured model | HTTP result / Connected | Current validation | Idle outcome |
| --- | --- | --- | --- | --- |
| STT | `flux-general-en` | HTTP101 at 1481ms; Connected at 1481ms | Accepted. `model_name` and `model_version` absent, as allowed by STT validation/reference. | Open after six seconds; no error/close event. |
| TTS | `flux-haley-en` | HTTP101 at 1480ms; Connected at 1481ms | **Rejected:** `model_name` string is not equal to configured model. `model_version` is a valid bounded string; no request-ID/version schema failure. | Adapter-equivalent validation failed immediately, so no accepted-TTS idle result is claimed. The direct socket emitted no provider Error/close event during the remaining observation. |

The actual differing resolved-name string was not printed: it did not match the probe's conservative model-string output allowlist. Its type and equality result are sufficient to establish the rejected branch. No provider error code was received; this is **local validation failure after successful HTTP upgrade**, not demonstrated credential rejection, provider unavailability, or lost reply audio.

### Root cause and minimum correction

`flux-tts.ts:86–88` parses Connected request/version, then throws `Wrong model` on strict `message.model_name !== cfg.deepgram.ttsModel`. `ProviderLink.start:136` catches this exception and substitutes `TTS_UNAVAILABLE`; startup `VoiceConnection.fail:217` substitutes `VOICE_DELIVERY_UNKNOWN`. This exactly explains how a successful silent provider connection becomes the reported delivery notice before voice is ready. The primary reference describes `model_name` as a **resolved model name**, not a guaranteed byte-for-byte echo of the query's model identifier. Its example happened to echo the requested name; the authorized actual response did not.

**Minimum owner fix proposed, not implemented:** P3 should replace the exact query-name comparison with bounded nonempty-string validation of the resolved `model_name` (reuse `providerId`), retaining request/version validation and the configured model allowlist/request URL. Do not change voice selection, add fallback providers/retries, or relax other message validation. The configured requested model remains authoritative for application accounting; this task does not require storing the provider's resolved-name string.

Small TDD sequence: (1) offline Flux TTS connect regression with a valid Connected resolved-name string different from the requested model; prove rejection first, then readiness after the minimal guard correction; (2) missing/empty/non-string/overlong name negatives plus retained request/version negatives; (3) no-utterance real-adapter/LiveFlow startup fixture reaching `session.ready` and staying open for six seconds. Existing configured-model/query and provider/session suites must still pass. No new paid repeat is authorized by this report. P5's provider-code preservation remains a separate useful diagnostic correction, **not required to remove this particular erroneous handshake rejection**.

The full app's accounting/database admission and exact five-to-six-second wall time were not exercised; those may add startup latency. No claim is made that every possible voice failure is fixed. The local Connected mismatch itself is confirmed using the user's configured provider and reproduces the current adapter's rejection condition.

Temporary script: `C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-authorized-silent-provider-probe.cjs`. **Do not rerun without new explicit provider-cost authorization.** Repository implementation remains unchanged; review remains **SKIPPED**.

## Priority update: silent startup closes in five or six seconds

New user reproduction on 13 October: **live voice closes after five or six seconds even without speaking, with no reply audio**. This supersedes turn-delivery settlement as the primary investigation. The earlier delivery defects remain independently reproducible, but their correction plan below is **deferred, not the remedy for this silent-startup report**.

### What is confirmed, and what is not

- **Confirmed diagnostic defect:** a pre-ready `STT_UNAVAILABLE`, `TTS_UNAVAILABLE`, or `VOICE_PROVIDER_RATE_LIMITED` failure is converted to `VOICE_DELIVERY_UNKNOWN`. `VoiceConnection.receive:128` passes the exception's message to `fail`; `fail:212–217` omits those provider codes from its allowed list. The screenshot can therefore mean **voice never became ready**, rather than any answer was generated or unheard.
- **Confirmed matching failure path:** an offline TTS HTTP-upgrade rejection injected at 5500ms traverses the actual STT adapter → `LiveFlow.open` → TTS adapter → `ProviderLink.start` → `VoiceConnection.receive/fail`; it emits the exact unknown error, with no `session.ready`, finalized input, or TTS response. The delay and rejection were deliberately injected: this proves path/timing compatibility, **not the actual rejection or HTTP status**.
- **At the offline stage, not confirmed:** a real `Connected` schema mismatch, wrong URL/model, authentication/entitlement failure, network failure, or accounting/persistence outage. No live event/status or logs were available then. The subsequent explicitly authorized evidence above confirms the TTS resolved-model-name comparison failure; the other hypotheses remain unconfirmed.

### Startup trace and primary-document checks

1. Browser capture starts with microphone tracks disabled. HTTP admission/reservation runs first. The browser opens `/api/voice`, sends `session.start`, and does not transmit microphone frames until `session.ready` and capture unmute complete. Not speaking after ready still produces silent PCM frames; it is not the same as sending no input bytes.
2. `LiveFlow.open:68–74` connects Flux STT **first**, then TTS. A TTS failure closes the already-open STT connection. No reader, agent execution, or reply begins until both connections return and `VoiceConnection` emits ready.
3. Each adapter calls `VoiceAccounting.start` before creating its provider socket. Production admission writes execute `store.owner.assertExecutor()` and `metadata.putVoiceAccounting` (`app.service.ts:264–271`). Failure here also reaches the generic unknown mapping. In a fresh socket record the null conversation/turn/response fields are valid; `MongoMetadata.putVoiceAccounting` only checks response/delivery linkage for non-null response IDs. No deterministic startup-accounting linkage bug was found.
4. `ProviderLink.start:126–144` rejects on invalid JSON/adapter parsing, provider `Error`, socket error/close, or rejected HTTP upgrade; all but HTTP429 become the adapter's unavailable code. HTTP429 becomes `VOICE_PROVIDER_RATE_LIMITED`. The implementation discards the underlying safe stage/status distinction. No retry helper is invoked by production startup: `connectWithBackoff` has no production caller.
5. TTS primary [API reference](https://developers.deepgram.com/reference/text-to-speech/speak-flux) and [server-message example](https://developers.deepgram.com/docs/flux-tts/server-messages) both require/illustrate `Connected` with `request_id`, **`model_name`**, **`model_version`**, and `model_uuids`. Their example `model_name` is `flux-haley-en`. That exact published example passes `flux-tts.ts:86–88`. It is therefore incorrect to claim those fields are absent from the documented TTS handshake.
6. STT primary [API reference](https://developers.deepgram.com/reference/speech-to-text/listen-flux) requires only `type`, `request_id`, and `sequence_id` on `Connected`. That minimal shape passes `flux-stt.ts:45–50`; its model version is optional. The existing shared fixture is TTS-shaped and used in STT tests too, but this masks a coverage difference rather than proving an STT parser failure.
7. A TTS message lacking model version, or with a model name unequal to the configured model, **does** reproduce parser failure and the startup unknown mapping. Those are synthetic counterexamples. Documentation calls the name a resolved model name; no live resolved-name difference or provider guarantee violation was observed. Do not remove validation based only on these probes.
8. The generated default URLs match the primary references: `/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.8&eot_timeout_ms=5000&tag=…` and `/v2/speak?model=flux-haley-en&encoding=linear16&sample_rate=24000&tag=…`. All supplied query names are documented. Authentication uses the documented Token header. Actual configured region, credentials, and provider access were **not inspected or tested**.

### Timers and newly ruled-out primary causes

| Candidate | Evidence for silent startup |
| --- | --- |
| Prior two-second delivery timer/base/sample defects | Require a runtime live turn/response. No turn means these paths never start; ruled out as primary under this reproduction. |
| Default connection budget | 10000ms in server/browser limits and `.env.example`, not 5000–6000ms. Both providers wait for `Connected`, not only WebSocket open. Actual runtime overrides remain unknown. |
| Flux EOT timeout | `5000` is turn-end detection after speech, not a local connection-close timer. `LiveFlow` ignores empty EndOfTurn text. Silence alone cannot dispatch an agent turn from these callbacks. |
| First-audio/completion/interrupt TTS timers | Armed by `speak`, `flush`, or `interrupt`, not TTS connect. None is armed in an idle TTS startup. |
| Ping timeout | First ping scheduled at 20000ms, then 5000ms pong grace; not five seconds from startup. |
| Idle/duration limits | Default idle warning 60000ms plus 30000ms grace; live cap 1200000ms. Not a default six-second cutoff. Quota/runtime overrides are not proven by this check. |
| Generic database timeout | Default persistence operation budget is 15000ms, not five seconds. An immediate/rejected accounting operation can still fail earlier; no database was accessed. |
| Provider handshake/upgrade/parser error | Can arrive at any time before the 10000ms budget and produce the exact unknown message. Offline path proven; original cause remains unidentified. |

### Silent-startup probes and checks

Executed `node C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-silent-startup-probe.cjs` from `backend`. This external temporary assertion probe uses the actual adapters, `LiveFlow`, `VoiceConnection`, `VoiceAccounting`, and accounting Zod schema, with in-memory sockets/writes only.

- Published minimal STT and full TTS `Connected` messages: ready succeeds; both pending socket accounting records validate with a null conversation. No turn/reply occurs.
- 75 valid silent 80ms PCM frames over approximately six seconds: connection stays ready, all 75 reach STT, no finalized hook or TTS Speak.
- STT-shaped `Connected` on the TTS socket, or nonmatching resolved name: `TTS_UNAVAILABLE` → startup `VOICE_DELIVERY_UNKNOWN`.
- Synthetic TTS403 rejection at 5500ms, STT upgrade rejection, and TTS429 rejection: underlying provider failures → startup unknown, no ready or utterance required.
- Synthetic accounting admission failure: fails before any provider socket is created; persistence failure → startup unknown.

All final probe assertions passed. Its first run failed because the test configuration defaults live mode off; enabling the mode in the temporary fixture corrected that harness setup, not production code.

Executed focused checks: `npm test -- test/voice/providers/flux-stt.spec.ts test/voice/providers/flux-tts.spec.ts test/voice/providers/accounting.spec.ts test/voice/session/live.spec.ts test/voice/transport/gateway.spec.ts`: **5 files / 38 tests passed**. No DB/live/device tests or implementation changes.

### Smallest next diagnostic; no unrelated fixes

First obtain whether the browser received `session.ready` before failure and the original code supplied to `VoiceConnection.fail`. With an authorized local reproduction, this needs **no source change or payload logging**: debugger breakpoints at `VoiceConnection.fail:209`, `ProviderLink.start`'s parser catch `:136` / upgrade callback `:140`, and `app.service.ts:269`. Observe only stage, elapsed milliseconds, enumerated original error code, upgrade status integer, and **presence/type/equality booleans** for Connected fields. Do not capture whole messages, exception prose/stacks, URLs/query strings, headers, transcript/audio, or credentials.

If durable diagnostic code is necessary later, the smallest client-visible correction is P5 preservation of the already-defined `STT_UNAVAILABLE`, `TTS_UNAVAILABLE`, and `VOICE_PROVIDER_RATE_LIMITED` codes instead of mapping them to delivery unknown; no wire-schema extension is required. This distinguishes the failing service, not the underlying handshake reason. Any further temporary provider diagnostic should carry only a fixed stage enum (`accounting-admission`, `upgrade-rejected`, `connected-invalid`, `socket-error`, `provider-error`, `input-send`) and allowlisted numeric status/elapsed time through a controlled local observer, with **no raw error or message logging**. Actual diagnostic implementation and provider/network correction await attribution; do not change playback timers, model-name validation, authentication policy, or retries to address silent startup speculatively.

## Outcome and limits

Offline probes confirm delivery settlement defects and a precision incompatibility under currently accepted inputs. **The screenshot's particular trigger is unknown.** Its notice is a many-to-one failure message, not proof of a provider outage, missing audio, or any one defect below. No implementation changed, paid calls, database access, environment/secret printing, or development servers were used.

### 1. Confirmed: normal delivery uses an interruption-sized deadline

- `agent-voice-adapter.ts:182` passes `Math.min(2000, limits.finalizationMs)` to `VoiceDelivery`.
- `durable-chat-runtime.ts:437,499–503` flushes speech before durable graph/application finalization, then calls settlement in `finally`. Settlement therefore starts after **model/runtime** completion, not after synthesis or audible playback completion.
- `voice-delivery.ts:137–150` starts the timer immediately, writes terminal `unknown` when proof is absent, and freezes the record. Late completion/progress is ignored (`event:101`, `playback:92`).
- `flux-tts.ts:157,171` independently permits 30 seconds for first audio and post-Flush synthesis completion. `SpeechMetadata` is synthesis completion, not playback acknowledgment.
- Probe: a fully played 100ms response with metadata not yet received settles `unknown` after two seconds; supplying valid metadata afterward cannot repair it. This needs no large queue and fits the adapter's own completion window.
- Separate probe: 3000ms synthesized audio with 500ms heard at settlement becomes `unknown` in approximately 2016ms; later full acknowledgment is ignored. That specific 2500ms queued-tail example needs an admitted output queue larger than the default 2000ms. It is not a reproduction with default queue settings.
- Raising `VOICE_FINALIZATION_MS` alone cannot help: the bridge caps it at two seconds. Removing the cap alone also leaves the default two-second budget and does not distinguish synthesis from playback.

### 2. Confirmed: second and later turns use the wrong delivery origin

- `agent-voice-adapter.ts:145–147` probes an optional `prepareResponse` using `any`; repository-wide search finds **no implementation**. The production `LiveFlow` therefore always gives `VoiceDelivery` base `0`.
- `live-flow.ts:178–186,312` does maintain a response-specific cumulative provider base. `progress:157–159` correctly maps the monotonic wire cursor into that cumulative provider cursor; its delivery hook passes the cumulative value.
- `VoiceDelivery.playback:89` subtracts its constructor base to obtain response-relative samples. With the fallback zero, subsequent delivery records retain samples from previous responses.
- Probe using actual `AgentVoiceAdapter` and `LiveFlow`, fake speech ports/runtime/writes: first fully heard 100ms turn completes; second fully heard 100ms turn records **4800**, not **2400**, relative samples and raises `VOICE_DELIVERY_UNKNOWN` on direct `bridge.finalized()`.
- The same mismatch can make the completion predicate accept prior-turn playback as current-turn proof if a progress snapshot lands at the prior response boundary. This premature-completion consequence follows from the predicate; the executed bridge probe tested the false-unknown case, not that timing variant.

### 3. Confirmed under accepted inputs: integer duration is not an exact sample proof

- `voice-delivery.ts:126–128` requires exact `playedSamples === audioDurationMs * 24`.
- `flux-tts.ts:79–84,97–108` accepts any positive even-sized PCM chunk and integer metadata duration. It counts actual bytes but never exposes that count to settlement or validates duration/sample equivalence.
- Probe with the actual `FluxTtsAdapter` and in-memory provider socket: **2401 PCM samples plus 100ms metadata** are accepted and emitted without error. Fully acknowledged 2401 samples then settle `unknown` because `2401 !== 2400`.
- Separately, actual `VoiceConnection.audio:164–174` writes `floor(outputCursor / 24)` per frame. Actual `AudioPlaybackService.enqueue:125–127` reconstructs each frame's origin from that millisecond header. Probe with consecutive 2401- and 2400-sample chunks: **4801 consumed samples** become **4800 reported playedSamples**. This is a proven local framing loss, not provider speculation.
- `LiveFlow.completePlayback:163–165` permits a less-than-24-sample shortfall for UI drain while explicitly refusing to treat that rounding as durable heard text. UI idle and durable `unknown` can therefore disagree by design.
- Primary Deepgram documentation specifies integer `audio_duration_ms`, arbitrary raw audio frames, and metadata after all turn audio; it does **not** specify rounding direction or promise all chunks/turns contain multiples of 24 samples. Whether the real screenshot involved non-multiple-of-24 PCM is unknown.
- **Do not fix this with `>=`, a rounding tolerance, or invented advancing offsets.** Those can certify unplayed tail audio; the existing 2399-of-2400 negative test must remain meaningful.

## End-to-end error trace and screenshot ambiguity

1. Production `app.service.ts:284–292` attaches the bridge's hooks to `LiveFlow` and uses `FluxTtsAdapter`.
2. Provider events are read by `LiveFlow.readTts`. Non-audio evidence reaches `hooks.delivery` before usage/UI processing; playback controls reach `hooks.playback` after binding and bounds validation.
3. Bridge hooks forward events/progress only to the active matching response. `VoiceDelivery` serializes durable evidence writes; runtime retains the lease through settlement. The completed generated answer is distinct from heard evidence and must not be inferred/spoken again.
4. Direct bridge settlement of `unknown`/`failed` throws `VoiceSessionError('VOICE_DELIVERY_UNKNOWN')` (`agent-voice-adapter.ts:200`). **But ordinary STT dispatch catches every finalized-hook error and reports `VOICE_AGENT_FAILED`** (`live-flow.ts:255–262`). Thus the two confirmed bridge defects alone do not prove the screenshot's exact notice path.
5. Provider `unknown()` publishes null interruption evidence and fails the socket (`flux-tts.ts:57–70`). Its triggers include first-audio/completion/interrupt deadlines, non-advancing interrupt offsets, and ignored-interrupt warnings. `LiveFlow.readTts:277,285,320–329` reports the unknown code directly and ends voice. Missing interruption evidence remains a legitimate unknown, not necessarily a defect.
6. Other direct unknown paths: STT-driven interrupt rejection (`live-flow.ts:244–246`), generic TTS reader exceptions, and `VoiceConnection.fail:209–224` sanitizing unrecognized failures. REST filter/drain also use the code for otherwise unknown errors.
7. Browser `LiveVoiceController` maps this exact code to the screenshot text (`:63`), but also selects it locally for playback enqueue exceptions (`:132–135`) and exceptions during event handling (`:174–208`). Exit stops playback/capture, restores the draft, closes voice, and returns to text (`:299–316`). No backend code is required for those local error paths.

To attribute the original event, request an authorized repeat with payload-free stage/timing evidence: first or later turn, whether it failed before/after sound, synthesis-completion time, settlement start/expiry, response-relative sent/played counts, and the initiating error boundary/code. Record no transcript, raw audio, credentials, or provider request bodies. No such evidence was available in this investigation.

## Existing checks and coverage gap

Executed from `backend`:

```powershell
npm test -- test/voice/agent/voice-delivery.spec.ts test/voice/agent/submission.spec.ts test/voice/session/live.spec.ts test/voice/providers/flux-tts.spec.ts
```

Result: **4 files / 21 tests passed**, no skipped tests in this command. These are offline fixtures, not live-provider/device certification.

Additional assertion probe ran actual TypeScript modules through the installed TypeScript compiler, with fake sockets/runtime and an audio-context stub. Six reported assertions/scenarios passed, reproducing the failures above; source was unchanged. Temporary probe:
`C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-live-delivery-probe.cjs`.
Run from `backend` with `node` and that absolute path. An earlier attempted in-memory esbuild runner could not start because esbuild is not installed; no dependency was added.

Current unit fixtures use 4800-byte/100ms audio and immediate acknowledgment. `VoiceDelivery` tests explicitly inject a correct nonzero base, so they never exercise the missing production handoff. Session tests mock delivery hooks; submission tests do not execute settlement. Native bridge/integration fixtures principally finish one response and promptly inject metadata/progress; their second-turn context test does not prove second-response settlement. Native fixtures were inspected but **not run**: this task forbids database access. No unrelated full-suite, hardware, staging, or live checks are claimed.

## Minimum correction and TDD sequence (implementation not authorized here)

1. **P5/P6: repair origin handoff first.** Add an offline two-completed-turn bridge/LiveFlow regression, plus a first-interrupted/second-completed case. Fail on incorrect relative samples and false prior-turn proof. Provide a small typed response-preparation/base handoff at the same response allocation boundary that `speak` uses; remove the `any` capability probe and zero fallback. Reuse existing `Response`/provider-base state, not a second cursor owner. Preparation must still let thinking-stage barge-in cancel the runtime before first prose.
2. **P6/P3: separate normal delivery wait from interruption reconciliation.** Add fake-clock tests for metadata arriving after 2000ms but inside the existing 30000ms synthesis deadline, playback continuing after metadata, and genuine no-progress/missing-ack expiry. Use a finite normal completion window that accounts for the existing synthesis deadline, admitted playback queue, and acknowledgment/finalization slack; retain the short interruption deadline for invalidated responses. Do not merely enlarge dictation's finalization budget, wait forever, release the runtime lease early, or replay inference. Test shutdown/cancellation while waiting.
3. **P3/P5/P6: make completion sample evidence authoritative.** Add non-multiple-of-24 PCM tests with rounded metadata and multiple partial chunks. Retain the one-sample-short negative test. Carry actual PCM sample count/end evidence to delivery and compare against response-relative heard samples, using integer milliseconds only for provider timing/accounting. Exact proof across arbitrary chunk boundaries also needs the existing framing ceiling resolved with **P1/P4 coordination** (precise sample-origin/ack semantics); do not silently widen schemas or edit frontend/shared contracts under P3/P5/P6 ownership. If kept backend-only initially, document that precision gate as unresolved rather than claiming arbitrary-frame completion fixed.
4. **P5: preserve the meaningful error code.** Add an STT-dispatch regression proving a bridge `VoiceSessionError('VOICE_DELIVERY_UNKNOWN')` reaches the client as that code; retain safe `VOICE_AGENT_FAILED` for unclassified finalized-hook failures. This is diagnostic correctness, not proof of the screenshot cause.
5. Run the focused regressions above and relevant existing provider/session/agent/transport suites, then backend build/lint. Native integration and real-device/provider checks require separate permitted prerequisites; mark them unrun until authorized. Review stays **SKIPPED**.

### Owned correction files

| Owner | Candidate files |
| --- | --- |
| P3 | `backend/src/voice/providers/flux-tts.ts`; `backend/test/voice/providers/flux-tts.spec.ts`; provider fixture builders only if needed |
| P5 | `backend/src/voice/session/live-flow.ts`; `backend/src/voice/session/voice-session.options.ts`; `backend/test/voice/session/live.spec.ts`; transport source/tests only for a coordinated precision change |
| P6 | `backend/src/voice/agent/agent-voice-adapter.ts`; `backend/src/voice/agent/voice-delivery.ts`; `backend/test/voice/agent/voice-delivery.spec.ts`; a small offline bridge test in that subtree |
| Coordination only | P1 shared `TtsEvent`/wire schemas if sample evidence changes their shape; P4 browser audio/ack implementation; P11 integrated regressions after owner fixes |

No runtime refactor, new dependency, provider substitution, retry policy expansion, authentication/tools, or UI redesign is proposed. `durable-chat-runtime.ts` was traced; its existing lease-held settlement seam can be retained.

## Primary provider sources

Retrieved through Context7 and the primary documentation on 13 October 2026:

- [Server messages](https://developers.deepgram.com/docs/flux-tts/server-messages): metadata marks all audio sent, integer per-turn duration, session-wide interruption offset, and ignored-interrupt warning semantics.
- [Voice-agent barge-in](https://developers.deepgram.com/docs/flux-tts/voice-agent): immediate local stop and session-wide playback offset.
- [Quickstart](https://developers.deepgram.com/docs/flux-tts/quickstart): Speak → SpeechStarted → audio → Flush → remaining audio → SpeechMetadata.

These document provider semantics; they do not establish the timing, bytes, or event path of the reported screenshot.
