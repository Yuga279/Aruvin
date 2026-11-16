# Voice Chat Cost and Conversational Flow

Status: **approved — offline implementation authorized on 16 October 2026**.
Date: 16 October 2026. Starting checkout: `4569119` (`main`).

## User requirements

- Implement the voice audit's cost-saving recommendations with a fine-tuned balance between latency, cost, and a pleasant hands-free experience.
- Investigate and correct the conspicuous gaps between Aurvin's spoken sentences. Speech should flow naturally, not sound like separate sentence recordings.
- After approximately four to five seconds of non-speech, microphone audio must stop being uploaded to Deepgram. Local listening may continue so speech can resume automatically.
- Silence, upload suspension/resumption, or other optimizations must **not hang up the voice chat**. The user ends the call with Hang up.

## Proposed design

### 1. Separate the call from its paid connections

The user-visible call, microphone activity, agent work, and transport/provider resources have separate lifetimes. A quiet call stays on the existing voice screen, with its conversation and draft intact, whether its STT connection is held idle or released. Speech resumes within that same call; no new conversation, replayed turn, or empty transcript entry is created merely by a transport renewal.

Do not disable finite safety budgets to keep the screen open. Quota exhaustion, duration/resource limits, provider/configuration failure, microphone loss, or exhausted reconnect attempts pause paid work and show a recoverable or blocked status **inside** the call. Do not automatically navigate back to text, endlessly retry, rotate sessions to bypass a ceiling, or claim the connection remains healthy when it does not. A permitted Resume action may reauthorize resources; exhausted budgets cannot be bypassed by Resume. A bounded transport may renew only at a safe boundary under the remaining server-enforced policy, without cancelling an in-progress turn just to renew it.

Explicit user hang-up and its accessible keyboard equivalent end the call. Page closure, reload, application unmount, or browser/OS termination must still release resources; this is not a promise of surviving a destroyed browser page. Hiding/freezing a page pauses capture for privacy and browser compatibility, but preserves the call screen. Returning from a browser-imposed pause may require a gesture; ordinary foreground silence must not.

### 2. Speech-aware input, not a volume threshold

Use a lightweight, local speech detector to gate **uploads**, not to start agent work or interrupt playback. Keep the existing Flux model-level turn detection authoritative for completed turns and barge-in. Browser echo cancellation remains enabled. Noise suppression must be evaluated rather than assumed universally beneficial; quiet/accented speech and short answers must not be sacrificed to aggressive filtering.

Initial behavioral target: suspend audio media after **5,000 ms of confirmed non-speech**, within one 80 ms media-frame tolerance. Preserve a short bounded local pre-roll (target 240–320 ms) to protect the first syllable when speech returns. Keep complete words, short yes/no answers, negations, identifiers, and normal within-turn pauses. Do not retain an ever-growing silence or reconnect backlog.

Before suspending media, settle any pending recognition turn exactly once using verified Flux semantics. Do not implement idle with the current manual-mute path if that discards an unfinished turn. Do not repeatedly send finalization for an already-finalized turn. A provider-confirmed new turn may interrupt Aurvin; local detector activity, noise spikes, connection events, and upload resume alone must not.

During quiet periods send no replacement silent/zero-filled audio. Use the endpoint's documented control/heartbeat behavior if keeping its socket open is appropriate; otherwise release and lazily reopen it without leaving the call. Socket-open time is not automatically treated as free or as an observed billable minute. Meter observed media separately from elapsed call time and unknown provider charges.

Microphone mute is absolute: discard buffered audio and disable capture/upload; neither automatic speech detection nor reconnection can undo it. Hang-up, permission loss, and backgrounding clear transient audio. A detector failure must be visible and must not silently fall back to indefinite billable streaming; keep a manual recovery option in the call.

Research must select and justify the smallest reliable detector supported by the browser pipeline, including licensing, asset hosting, CPU/bundle overhead and offline behavior. Reuse installed/native facilities where adequate; any unavoidable new dependency or model asset needs an explicit rationale. No external runtime model download, microphone-data upload, or third-party analytics is added implicitly.

### 3. Continuous spoken output

Measure the path from LLM text through safe prose release, durable evidence, TTS dispatch, provider audio receipt and actual playback scheduling. Distinguish upstream text starvation, evidence-write stalls, network jitter, browser underruns, and intentional silence already present in provider audio. Do not claim an acoustic root cause from source inspection alone.

Improve safe incremental prose release so TTS can receive useful continuous text without routinely waiting for each whole following sentence. Preserve the existing filtering of hidden reasoning, code, JSON, tables and ambiguous markup across arbitrary token boundaries. Preserve factual words and ordering. Avoid per-token database writes or an unbounded asynchronous text queue. Required generated-before-Speak durability and generated-versus-heard evidence remain intact: measure, batch or coalesce within bounded latency rather than simply removing safety writes.

Use one continuous synthesis turn per assistant response, with Flush only at the genuine response end. Do not synthesize each sentence as a separate response. The current code already flushes once; do not invent a per-sentence Flush bug. Preserve punctuation and intentional prosody. Do not trim PCM silence, crossfade speech, raise speaking speed, switch models/voices, or remove punctuation as a substitute for diagnosing gaps.

Where timing evidence warrants it, use a small bounded startup/rebuffer reserve (initial target 80–120 ms; no more than 200 ms added reserve) to absorb ordinary PCM delivery jitter. Do not add that delay per sentence or per packet. Keep sample-accurate playback evidence and immediate interruption; buffered old-response audio is discarded on valid interruption. Slow upstream synthesis cannot be fixed with unlimited buffering: detect and report underruns instead.

### 4. Cost, performance and privacy boundaries

Keep STT, TTS and LLM usage distinct. Retain request/response identities and cancellation accounting; no duplicate inference or speech on pause/resume, reconnect, or retries. Keep server quotas and spend estimates honest about incomplete/in-flight evidence. Record observed upload savings rather than inventing invoice savings. Do not represent existing process-local quota counters as restart-durable enforcement.

No raw audio persistence, message payload logs, secret exposure, public deployment, new billing platform, authentication system, multi-process executor, model picker, voice picker, live tool integration, or general architecture rewrite is in scope. Preserve text chat, dictation and existing conversation/transcript behavior. New voice-only controls must not inadvertently gate dictation pauses or change text prompts.

## Verification and acceptance

| ID | Required evidence |
| --- | --- |
| AC1 | Deterministic media tests show zero outgoing PCM after the five-second non-speech threshold plus one-frame tolerance, including a long quiet interval with control heartbeats allowed. |
| AC2 | Speech after quiet automatically resumes the same foreground call; bounded pre-roll is delivered once, in order, without duplicate inference, empty conversations, or clipped fixture onset. Detector decision/release latency is measured separately from network/provider latency. |
| AC3 | Long quiet intervals, prior 60+30-second idle expiry, duration/resource expiry, quota stops, provider errors, and exhausted reconnects never automatically exit the mounted call UI. Paid work stays stopped when safety policy requires it. Hang-up still tears down every resource. |
| AC4 | Noise/echo fixtures do not directly trigger agent execution or local-detector-driven interruption. Real-device acoustic false positives/negatives remain a separate measured gate; arbitrary background speech is not claimed to be addressed to Aurvin. |
| AC5 | Timing fixtures cover slow evidence writes, slow/split LLM tokens, sentence boundaries, bursty PCM and recoverable jitter. Prove earlier safe text delivery where applicable and no application-inserted gap when contiguous PCM is available. Report startup reserve and underruns. |
| AC6 | Single-Flush behavior, safe prose filtering at arbitrary token cuts, exact content/order, mute privacy, cancellation, played-versus-generated evidence, durable finalization and bounded queues pass regressions. No optimization weakens safety to satisfy a timing assertion. |
| AC7 | Backend/frontend builds, lint and routine tests pass; deterministic integrated tests cover the full changed path. Native/service tests are separately reported as passed, skipped or blocked by their actual prerequisites. |
| AC8 | A consented device/provider A/B listening evaluation checks sentence flow, short/quiet/accented speech, speakers/headphones, false interruptions, wake latency, p50/p95 first audible response and actual provider usage. Until explicitly authorized and performed, acoustic quality and real billing savings remain **unverified**, not certified by fixtures. |

The existing pilot first-audible-response targets (p50 <=1,500 ms; p95 <=2,500 ms) remain measurement goals, not promises established by unit tests. Compare identical voice/model/configuration across baseline and changed builds; report cold start separately and do not exclude failures from denominators.

## Investigation evidence and limitations

- Input currently streams all unmuted 80 ms frames: `frontend/src/features/voice/audio/audio-capture-processor.ts`, `frontend/src/features/voice/state/live-voice-controller.ts`, `backend/src/voice/session/live-flow.ts`.
- Existing default idle expiry is 60 seconds plus 30 seconds; it ends the server session. Terminal/error paths currently exit the frontend call: `backend/src/voice/usage/voice-usage.service.ts`, `frontend/src/features/voice/state/live-voice-controller.ts`.
- `SpeechProse` buffers sentence-like units or sufficiently long plain text; `VoiceDelivery.delta` awaits durable generated evidence before Speak. These are potential sources of starvation, not yet an acoustically confirmed root cause.
- The browser schedules received PCM consecutively but has no explicit jitter reserve. The backend already preserves a single TTS response and final Flush.
- Provider guidance reviewed: [Flux streaming synthesis](https://developers.deepgram.com/docs/flux-tts/client-messages), [audio preprocessing and barge-in](https://developers.deepgram.com/guides/deep-dives/audio-preprocessing-barge-in.md), [Flux/Nova connection differences](https://developers.deepgram.com/docs/flux/flux-nova-3-comparison.md).

## Authorization and workflow gate

The user approved goal/state ("The goal and the state looks good") and explicitly authorized execution on 16 October 2026 ("You can go ahead"). Use MAW with unified review **skipped** under the repository instruction; meaningful tests, defect correction and final verification are mandatory. Planners/workers operate within a maximum of three concurrent children, and shared Git commits are serialized.

No paid Deepgram/OpenRouter call, real microphone capture, application-database substitution, external provisioning or deployment is authorized by this document. Live acceptance requires separate explicit authorization with a bounded cost/data scope. Offline implementation can proceed after written-design approval; live limitations must be recorded honestly.
