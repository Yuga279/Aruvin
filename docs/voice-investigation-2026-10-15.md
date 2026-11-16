# Live voice latency and unexpected termination investigation

## Outcome

Investigated checkout `364e169fab026561179dc9c3c025c4c84ab27f3a` on 15 October 2026. No application source or settings were changed. Offline checks reproduce premature delivery settlement, output-burst termination, and incorrect second-response playback accounting. The screenshot is the frontend's generic voice-session failure notice, not evidence by itself of a Node/Nest process crash.

The precise fault in the supplied incident **cannot be identified from these logs**: they contain HTTP/request and model-accounting observations, but no voice terminal code, WebSocket close detail, or per-stage timestamps. The reproduced defects are credible failure paths, not a claim that all occurred in this incident.

## What the incident logs establish

| UTC time | Observation | Time since voice admission |
| --- | --- | --- |
| 07:03:05.005 | Live voice admitted | 0 |
| 07:03:18.726 | First model-accounting write, status `unknown` | 13.721 s |
| 07:03:22.229 | Model-accounting write includes a generation ID | 17.224 s |
| 07:03:23.533 | Model-accounting status becomes `known` | 18.528 s |
| 07:03:29.404 | Another accounting write remains `known` | 24.399 s |
| 07:03:31.556–557 | Further requests report `ok: true` | About 26.55 s |

The initial 13.721 seconds include an unknown amount of user speaking, provider connection, turn detection, and persistence. They are **not** a measured post-speech transcription delay. `known` means token/cost accounting is available, not that speech was delivered or playback succeeded. Repeated accounting writes do not establish repeated inference. Successful later requests are consistent with a voice-session failure while HTTP remains available; without process lifecycle evidence they cannot rule out a restart.

The voice admission's hashed session ID is a voice-session ID; model-accounting logs use a conversation ID. Different hashes are expected and do not establish a binding error.

## Reproduced failure paths

### 1. Live delivery settlement has an unconditional two-second ceiling

- [`agent-voice-adapter.ts:186`](../backend/src/voice/agent/agent-voice-adapter.ts#L186) supplies `Math.min(2000, finalizationMs)` to the delivery tracker. Increasing the configured finalization value cannot raise that ceiling.
- [`durable-chat-runtime.ts:586–592`](../backend/src/chat-runtime/durable-chat-runtime.ts#L586) starts settlement when model/graph execution finishes, not when synthesis and audible playback have finished.
- [`voice-delivery.ts:132–150`](../backend/src/voice/agent/voice-delivery.ts#L132) waits for proof only until that deadline, then stores `unknown` and freezes further delivery updates.
- [`agent-voice-adapter.ts:203–205`](../backend/src/voice/agent/agent-voice-adapter.ts#L203) rejects an `unknown` delivery. [`live-flow.ts:255–262`](../backend/src/voice/session/live-flow.ts#L255) turns that rejection into `VOICE_AGENT_FAILED`, ending the voice session.

**Offline result:** with text generation finished but speech completion/playback evidence outstanding, settlement returns `unknown` after approximately 2.0 seconds. Later completion/playback evidence does not repair that tracker. Separately, a finalized-turn rejection carrying `VOICE_DELIVERY_UNKNOWN` emerges from LiveFlow as `VOICE_AGENT_FAILED`.

**Implication:** a normal synthesis/playback tail or delayed evidence can terminate the conversation. A short bounded cleanup timeout should not double as the entire active speech-delivery allowance. The PRD's proposed two-second finalization target is specifically for dictation Stop, not a maximum spoken-response duration ([PRD D4](../voice-modes-prd.md#L106)).

### 2. Faster-than-playback audio is treated as a fatal buffer overflow

- The shipped default output allowance is 2,000 ms ([`voice-wire.ts:43–46`](../backend/src/contracts/voice-wire.ts#L43)); the incident's stored runtime setting was not retrieved.
- [`live-flow.ts:303–306`](../backend/src/voice/session/live-flow.ts#L303) faults when synthesized audio exceeds the playback-acknowledged cursor by that allowance.
- [`audio-playback-service.ts:114–117`](../frontend/src/features/voice/audio/audio-playback-service.ts#L114) also interrupts on queue overflow. This is a safety cap, not playback-paced flow control.
- The application cannot assume synthesized audio arrives at speaker speed. Deepgram's [Flux TTS lifecycle](https://developers.deepgram.com/docs/flux-tts/state.md) describes generated audio and synthesis completion, not proof of client playback.

**Offline result:** eleven valid 200 ms PCM chunks arriving before a playback acknowledgment cause LiveFlow to emit `AUDIO_BUFFER_OVERFLOW` and finish with an error. No provider failure is required.

**Implication:** valid bursty synthesis can close the entire session. Fix bounded buffering/flow control and playback acknowledgment behavior rather than just raising a timeout or removing memory limits.

### 3. Second-response accounting uses the wrong origin

- [`agent-voice-adapter.ts:149–151`](../backend/src/voice/agent/agent-voice-adapter.ts#L149) probes for `flow.prepareResponse()` through `any`, falling back to base sample offset zero.
- That method does not exist on `LiveFlow`; repository search found only the adapter's probe and attempted invocation.
- LiveFlow passes a cumulative provider playback cursor to the delivery hook ([`live-flow.ts:151–159`](../backend/src/voice/session/live-flow.ts#L151)). VoiceDelivery expects to subtract each response's base ([`voice-delivery.ts:87–94`](../backend/src/voice/agent/voice-delivery.ts#L87)).

**Offline result:** after an initial 100 ms response, a fully played second 100 ms response has cumulative cursor 4,800 samples. A zero base produces `unknown`; the correct 2,400-sample base produces `completed`. This comparison used a shortened 20 ms diagnostic settlement deadline; production uses up to 2,000 ms. Waiting longer cannot make an incorrect relative cursor equal the expected response duration.

**Implication:** this is a deterministic multi-turn defect independently of provider speed. Replace the nonexistent optional API/fallback with an explicit, typed response-origin handoff.

## Why latency is poor

These are source-confirmed contributors, **not measured attribution for the incident**:

1. **Conservative turn completion.** Defaults are EOT threshold `0.8` and silence timeout `5,000 ms` ([`manageable-config.ts:148–149`](../backend/src/platform/config/manageable-config.ts#L148)). Only confirmed `EndOfTurn` submits work; eager events do not ([`flux-stt.ts:56–64`](../backend/src/voice/providers/flux-stt.ts#L56)). The timeout is a fallback, not a mandatory five-second wait for every turn. Actual stored incident settings remain unknown.
2. **Application-side sentence buffering.** [`speech-prose.ts:92–107`](../backend/src/voice/agent/speech-prose.ts#L92) withholds text until a sentence boundary/newline or generation completion. The offline check confirms an unpunctuated answer emits nothing to TTS until `finish()`. Deepgram [supports streaming tokens directly](https://developers.deepgram.com/docs/flux-tts/quickstart.md) and performs internal sentence/clause handling, although any change must preserve Aurvin's speech-safety filtering.
3. **Persistence blocks speech delivery and input processing.** Every emitted prose unit awaits a delivery write before Speak ([`voice-delivery.ts:70–77`](../backend/src/voice/agent/voice-delivery.ts#L70)). Playback progress is sent every 100 ms ([`live-voice-controller.ts:123–125`](../frontend/src/features/voice/state/live-voice-controller.ts#L123)), and each update also writes delivery evidence. Those writes perform ownership checks, linkage reads and a compare/update. [`voice-connection.ts:78–128`](../backend/src/voice/transport/voice-connection.ts#L78) serializes progress controls with microphone frames, so slow database operations can delay input and build queue pressure. No database round-trip latency was measured here.
4. **Provider connection setup is sequential.** LiveFlow connects STT and then TTS before readiness ([`live-flow.ts:66–76`](../backend/src/voice/session/live-flow.ts#L66)). This affects cold startup, not every turn.

## Why the current logs hide the cause

- [`live-voice-controller.ts:54–65`](../frontend/src/features/voice/state/live-voice-controller.ts#L54) uses the screenshot wording for multiple unmapped errors, including `VOICE_AGENT_FAILED`, `TTS_UNAVAILABLE`, and `AUDIO_BUFFER_OVERFLOW`.
- LiveFlow's finalized-turn catch discards the original fault code before surfacing `VOICE_AGENT_FAILED`.
- `VoiceUsageService.noteLatency()` exists, but search found no production callers. Its declared latency buckets therefore do not constitute actual end-to-end latency instrumentation.
- LiveFlow and VoiceConnection emit terminal errors to the WebSocket without corresponding structured terminal-fault logging.

To identify the exact next incident, record allowlisted voice fault/stage codes, correlated hashed voice/conversation/turn identifiers, epoch, elapsed stage durations, and queue depths. Preserve useful error classification without logging transcripts, PCM, credentials, or raw provider payloads. Browser WebSocket control frames and the first failing component's sanitized code are needed to distinguish these paths.

## Recommended correction priorities

- Correct response-origin accounting and the live speech settlement lifecycle first.
- Handle bursty synthesis with bounded flow control and decouple high-frequency playback evidence from microphone-frame processing; retain persistence ownership and durable completion guarantees.
- Preserve fault classification and wire real end-of-speech, first-model-output, first-TTS-audio, and first-audible-sample timing.
- Then tune turn detection and safe incremental speech emission using recorded utterances and real microphone/speaker evaluation. Do not add speculative execution or change providers merely to mask these defects.

No implementation, paid provider check, database fixture run, deployment, or claim of real-device verification is included in this investigation.

## Verification performed

- Backend `npm run build`: passed against the investigated source.
- Backend focused suites: **31 tests passed**, across delivery tracking, live flow, and gateway transport.
- Frontend focused suites: **30 tests passed**, across playback, live controller, and voice transport.
- Additional offline assertions reproduced the failure conditions above. The existing passing suites do not cover these conditions as successful full conversations.
- Local diagnostic script: `C:\Users\Peter\AppData\Local\Temp\opencode\aurvin-voice-investigation.mjs` (outside the repository; not a committed regression suite). It imports the freshly built backend and uses in-memory ports only.

```powershell
# First run npm run build from backend/.
node "C:\Users\Peter\AppData\Local\Temp\opencode\aurvin-voice-investigation.mjs" "D:\Peter\Aurvin Agent\Aurvin\backend"
```

No running app was found listening on the standard local ports during this investigation. Actual provider, database, browser-audio, configured-settings, and process-restart evidence remains unverified.

## Extended end-to-end investigation (before fixer handoff)

The follow-up covers microphone capture/worklet/resampling; frontend lifecycle, playback and controller; HTTP/native WebSocket admission, framing and reconnection; STT/TTS provider adapters, queues, timers and accounting; LiveFlow/agent bridge; runtime cancellation/finalization, context/history and transcript persistence; and usage/idle/duration/quota policy. No planner, MAW workflow, or review agent is involved. This is a code-level investigation with deterministic fixtures, not a certification that no undiscovered or hardware/provider-specific defects remain.

Additional baseline verification: backend voice/runtime/context/exclusion selection **162 passed, 8 skipped**; frontend voice/chat/protocol selection **130 passed**. Native database URI and approved fixture prefix are absent, so native suites were not admitted. Five additional temporary investigative assertions reproduce the broken behaviors below; these passing reproductions are **not** fixed-behavior acceptance tests.

| Finding | Evidence and affected flow |
| --- | --- |
| False idle hangup during speech | Reproduced with actual LiveFlow, in-memory STT/TTS, and the real usage policy clock: repeated microphone input and recognition updates still result in idle stop at 90 seconds. `noteActivity` is wired only to terminal speech usage, not conversational activity. Silence-only PCM must not continually refresh idle either. Relevant: `backend/src/voice/usage/voice-usage.service.ts`, `backend/src/voice/session/live-flow.ts`, `backend/src/app.service.ts`. |
| Thinking is not interruptible before first prose | Reproduced: an accepted EndOfTurn followed by a new StartOfTurn before Speak never invokes the interrupt hook. LiveFlow does not create `current` until `speak()`, although the agent is already running. Prepare the typed response before inference; do not send invalid provider Interrupt commands when no speech/audio exists. |
| Send-time disconnect defeats reconnect | Reproduced: VoiceClient detects a send failure and invokes `lost`, but the controller treats its subsequent `false` return as a fatal connect error and sends HTTP end. Must retain suspension/reconnect once the transport has reported loss, without replaying microphone audio. |
| Fractional-millisecond packet boundaries lose cursor samples | Reproduced: two 25-sample packets produce `consumedSamples: 50` but `playedSamples: 49` because each packet's origin independently uses `offsetMs * 24`. LiveFlow's sub-millisecond completion allowance also conflicts with VoiceDelivery's exact duration-times-24 proof. Correct exact sample accounting without declaring unplayed samples heard. |
| Premature progress after interrupted response | Reproduced: after interrupting the first 100 ms response at 50 ms, `audio.start` for response two followed by a timer tick before its first PCM emits a 1,200-sample cursor for response two; the backend requires at least its 2,400-sample wire origin. Progress/interrupt must be bound to actual response samples, not the prior response's cursor. |
| Lost first conversation binding blocks recovery | Source-confirmed: backend binds a new chat before sending `conversation.bound`. If that message is lost, reconnect HTTP correctly returns the same voice session with its new conversation, but `VoiceHttpClient.create` and `VoiceClient.reconnect` require exact equality with previous null. Permit only a verified same-session null-to-bound transition; preserve ID/epoch/ownership fences and prevent re-inference. |
| Unrelated device changes hang up | Source-confirmed and explicitly exercised by the existing lifecycle test: **any** `mediaDevices.devicechange` exits voice, even when the active microphone remains healthy. AudioCaptureService already observes the actual track's `onended`. Do not treat an unrelated added/removed device as proof of microphone loss. |
| Error/reason classification is lost | Source-confirmed: HTTP voice codes are discarded for `HTTP_status`, controller catch sites use Error.message rather than ApiClientError.code, LiveFlow masks finalized errors, and usage stop wiring ignores its idle/duration/quota/shutdown reason. Preserve sanitized codes and terminal reasons with useful UI notices; distinguish intentional session end from reconnectable loss. |
| Control ceiling contradicts allowed session duration | Source-confirmed: VoiceConnection terminates after 4,096 distinct control events. Playback reports alone run at up to 10 Hz, exhausting that ceiling in about 6.8 minutes of playback, below the default 20-minute session duration. The comment says to reconnect with a fresh epoch, but the fault goes through fatal `fail`/`disconnected(..., false)` instead. Keep bounded replay protection without prematurely ending otherwise admitted sessions. |
| Disconnect-only transcript aggregation can lose data | Source-confirmed: AgentVoiceAdapter retains completed turns only in RAM, waits until disconnect to save, silently catches recordVoiceSession failure, and reconnecting adapters share the same summary ID so a later write returns early. `recordVoiceSession` silently drops all but 50 transcript items, can exceed the message-byte cap even below that count, and invents sequence numbers (including timestamp fallback) outside the owned allocator. Fix the voice archive path using existing durable per-turn evidence/owned sequencing, bounded records and idempotency; do not claim a full transcript from a dropped/disconnect-only cache. |

The burst/settlement/cursor fixes must cover long answers and several consecutive turns, synthesis arriving faster than playback, irregular PCM chunk sizes, interruption before first audio and after synthesis but before playback drain, slow persistence, disconnect/reconnect around first binding, mute/resume, and error/shutdown drain. Do not fix reliability by removing finite budgets, bypassing fencing, fabricating heard text, replaying paid inference, or deleting safety policy. The conservative EOT setting is tunable policy, not by itself a correctness defect or authorization for speculative generation.

Temporary investigative files handed to the fixer: `backend/test/voice/investigation.spec.ts` and `frontend/src/features/voice/integration-tests/investigation.test.ts`. Convert them to correct-behavior regressions (or move equivalent coverage into existing suites); do not retain tests that bless the broken behavior as acceptance. Production fixes have not yet been made at this handoff point.

## Implementation and verification appendix — 15 October 2026

The sections above preserve the **baseline investigation**, not the current implementation status. Fixes below are an **uncommitted working diff against `57ad34d8936b665653fff1cac5265946412212f1`**. That commit's Nova segment-identity fix and its two regression files are unchanged; its actual report path is [`dictation-transcript-duplication-2026-10-15.md`](dictation-transcript-duplication-2026-10-15.md). Work was paused on request during that change and resumed in the same checkout after explicit authorization. No worktree move, planner, MAW workflow, additional agent, review, commit, provisioning, deployment, paid provider call, or application-database inspection/mutation was performed.

### Root fixes and traceability

Review was **skipped** per instruction, not passed; deterministic verification below is separate.

| Handoff item | Implemented correction | Deterministic evidence |
| --- | --- | --- |
| 1. Premature settlement / poisoned queue | Active speech gets a progress-sensitive 30-second stall allowance, capped by the existing run/session budgets. Cancellation uses the separately bounded configured finalization allowance. Runtime abort reaches settlement; terminal evidence drains before ownership release. Rejected actions no longer poison later evidence. A completed zero-PCM synthesis cannot mark generated text heard. | `voice-delivery.spec.ts`: active speech beyond two seconds; slow model thinking before Speak; stalls; cancellation; queue rejection; zero PCM; exact final proof. |
| 2. Bursty synthesis / hot-path database waits | LiveFlow sends only playback-credited PCM and waits for actual acknowledgments. The provider queue pauses/resumes its socket at bounded high/low watermarks; tiny already-decoded packets coalesce into at most 200-ms blocks. Progress writes coalesce to one latest cursor and leave the microphone/control receive path. Interrupt cleanup is tracked off that path and drained. | Provider burst and 300 irregular-packet tests; LiveFlow burst test; composed agent/wire slow-write, slow-interrupt and three-turn tests; browser composed playback test. |
| 3. Wrong later-response origin | A real typed `prepareResponse` supplies each delivery's provider origin. Provider/socket and monotonic wire origins remain separate. A reset replaces only TTS, resets its provider origin, and waits before admitting the next output. No `any`/zero fallback. | Three-turn tests, including after discarded/undrained first-response audio; reset gate test. |
| 4. Thinking / early / late barge-in | Response preparation precedes inference. StartOfTurn cancels the turn signal even during acceptance/thinking. No provider Interrupt is sent when speech was never submitted; submitted-but-unheard or non-advancing-offset speech resets TTS rather than guessing an offset. Documented interrupt warnings preserve unknown evidence and replace the TTS socket, not the conversation. Completed synthesis remains locally interruptible until playback drains. | Composed before-first-token cancellation; before-first-PCM reset; all three documented warning families through the real Flux adapter plus LiveFlow; interruption after synthesis followed by two successful replies. |
| 5. False idle timeout | Recognized speech refreshes activity; generating/playing lifecycle suspends idle accounting. New flows initialize their busy state. Silence-only microphone PCM does not refresh activity. Duration/quota limits remain independent and finite. | Real policy-clock regressions: ongoing recognition, a busy reply, return to genuine idle, and silence-only PCM. |
| 6. Send-time loss defeats reconnect | A false send after `lost()` no longer causes controller HTTP end. Analogous control sends respect the already-reported loss. Closed-socket sends notify loss; stale capture generations are not replayed. Fatal errors retain a distinct exit path. | Converted disconnect regression; real transport/controller first-binding recovery and fresh-input resume; existing mute/lifecycle tests. |
| 7. Irregular PCM / rounded metadata | Packet lengths advance the exact sample cursor; only response origins use millisecond framing. `audioSamples` is optional durable completion evidence, supplied from actual delivered PCM, while legacy records retain duration-based proof. Playback completion requires the exact last sample. | Two 25-sample packets yield 50 played samples; 52,825-sample replies with integer 2,201-ms metadata; the existing 2,399/2,400 negative test still rejects incomplete playback. |
| 8. Stale new-response progress | Production `audio.start` includes an optional exact `firstAudioSample` origin. The browser binds the new response to it, permits safe pre-PCM interruption, and does not poll progress until that response receives PCM. | Converted post-interruption regression and composed multi-turn browser test. |
| 9. Lost first binding | HTTP and socket recovery allow null-to-bound only with verified same-session, advancing-epoch, same-mode recovery. An already bound conversation cannot change. The controller updates its conversation lease from recovered admission. No automatic inference/audio replay. | HTTP/client first-binding tests and real client/controller recovery, gesture resume, intentional shutdown test. |
| 10. Unrelated device changes | Generic devicechange no longer ends the call. Capture still owns active-track `onended` loss; no automatic microphone switching was added. | Updated lifecycle test and existing capture/active-device-loss tests. |
| 11. Lost faults, reasons, timing | Allowlisted HTTP/provider/flow voice codes survive masking boundaries; fatal codes arrive before loss cleanup can erase them. Notices distinguish recognition, synthesis, quota, delivery and connection problems. Idle/duration/quota/shutdown reasons and warnings reach the socket. Hashed, payload-free pipeline/error observations now have production callers. Text readiness remains independent of speech faults. | Structured-code/notice tests; policy terminal tests for all four reasons; redacted observation test; existing voice/text readiness tests. |
| 12. 4,096-control hangup | A bounded 4,096-entry recent-ID window replaces the fatal lifetime ceiling. Monotonic epoch/sequence checks remain authoritative for older replays. | 4,200 distinct controls accepted; existing duplicate, gap, binding and epoch rejection tests retained. |
| 13. Disconnect-only archive | Removed `completedTurns` and `recordVoiceSession` aggregation. Newly accepted durable internal messages carry their voice-session attribution, including terminal/recovered assistant records. Bounded HTTP projections reuse those originals and their **existing fenced sequence allocation**, not copied disconnect summaries or max-read/timestamp sequence guesses. Unconfirmed user acceptance is not projected. Legacy summaries remain readable and outside model context. UI labels per-message records without inventing a session duration or proof of hearing. | 61-message paged projection exceeds 65,536 aggregate characters without a 50-item truncation; original identity/sequence checks; context-exclusion tests; UI tests. Native bridge expectations updated but database-backed execution remains blocked below. |
| 14. Sentence buffering | Unambiguous plain prose emits completed-word clauses after a bounded 96-character lookahead rather than waiting for the final punctuation/finish. Existing hidden-tag, JSON, Markdown/code and table filtering remains; unsafe/ambiguous units stay buffered or suppressed. No raw token bypass or speculative execution. | Existing arbitrary-split safety/meaning cases plus unpunctuated names/numbers/date/negation and hidden-unit regressions. |

### Explicit bounds and compatibility

- The configured playback window is **still 2,000 ms by default**, on both server and browser. Playback acknowledgments, not provider synthesis speed, grant more PCM credit. No arbitrary-length synthesized answer is accumulated in application memory.
- Provider queue PCM is capped at `outputQueueMs * 48 + 131072` bytes (one maximum provider message of pause headroom), plus the single currently consumed maximum-size message and a bounded coalescing block. The existing event-count ceiling remains. Paused reads do not falsely expire the synthesis-completion/pong timers; stalled playback and the existing run/session abort budgets still terminate the pipeline.
- Transport accounting now reserves framing **as well as** PCM and one bounded control payload: `outputQueueMs * 24 * (2 + 16) + MAX_VOICE_CONTROL_BYTES`. The protocol permits a one-sample packet, so assuming only one header per 200 ms was incorrect, even for a correctly credited window. This finite physical-byte cap does **not** grant extra PCM credit. A regression fills a complete credited window with irregular packets and control bytes, then verifies rejection at the hard byte cap.
- High-frequency progress has one pending latest-value slot, not an unbounded write backlog. Final delivery settlement waits for serialized authoritative evidence; write failures remain failures and ownership/drain are not bypassed.
- `audioSamples` is optional in existing schema-version-1 records. Legacy records without it retain their prior exact duration-based check. New code accepts legacy wire fixtures without `firstAudioSample`; matched frontend/backend code supports that optional origin and the explicit `quota` terminal reason. This is not certification of a mixed old-browser/new-server rolling release: strict old clients may reject new fields/reasons and should be refreshed when releasing the matched pair.
- Archives are **per-message projections**, not a newly promised full-session aggregate. Existing legacy internal records without voice-session attribution are not automatically backfilled or exposed, and historical aggregate losses are not represented as repaired. Their original records are not deleted. New attributed originals remain bounded, durable and paginated across disconnect/reconnect.

### Timing definitions and limits

`VoiceUsageService.noteLatency` now receives actual production observations for these boundaries:

| Bucket | Actual measured boundary |
| --- | --- |
| `turn` | Recognized EndOfTurn received by LiveFlow → response preparation after acceptance/binding. Includes application queue/persistence time. |
| `llm` | Runtime model-stream invocation → first raw model delta. Includes adapter setup; not a provider-only TTFT claim. |
| `tts` | First safe prose Speak invocation → first PCM forwarded to transport. Includes provider admission/accounting/setup. |
| `playback` | First forwarded PCM → first positive browser audible-sample acknowledgment received by the server. Includes network, scheduling and acknowledgment delay; not a hardware-only latency measurement. |

Other buckets remain unmeasured/empty, not fabricated measurements. Error/stage logs contain allowlisted stage/code, hashed voice/conversation/turn/response identifiers, epoch, bounded durations and queue samples. They contain no transcripts, PCM, private reasoning, secrets or raw provider payloads. No real-device latency benchmark was performed. Conservative EOT settings and sequential cold STT/TTS startup were not tuned; speculation remains disabled.

### Checks on HEAD `57ad34d` plus the working diff

Environment: Windows; Node **v24.18.0**. Process environment confirms no `AURVIN_TEST_MONGODB_URI` and no approved `AURVIN_TEST_DB_PREFIX`. No application `.env` was read to obtain fixture credentials.

| Package / command | Actual result |
| --- | --- |
| Backend `npm run build` | Passed after implementation. |
| Backend `npm run lint` | Exit 0, with warnings (not a warning-free claim). |
| Backend `npm test` | **964 passed, 10 skipped; 122 files passed, 2 skipped.** Final isolated run passed after the last code change. |
| Backend `npm run test:e2e` | **Exit 1: 19 passed, 40 skipped, 70 failed; 4 files passed, 15 skipped, 17 failed.** All reported failures stop at `Isolated native test configuration is required.` These are prerequisite failures, **not passing or skipped native tests**. |
| Frontend `npm run build` | Passed. |
| Frontend `npm run lint` | Exit 0, with warnings. |
| Frontend `npm test` | **336 passed across 50 files**; no skips. |
| Detection commit preservation | `git diff --quiet HEAD --` its four files returned exit 0. |
| Diff whitespace | `git diff --check` passed; Git reports checkout LF/CRLF conversion notices. |
| Report links | 67 local Markdown links checked; no missing targets. |

The initial diagnostics were converted to positive assertions and observed failing before the corresponding fixes. Additional red/green regressions caught late-Speak stall accounting, reset gating, fatal-code ordering, zero-PCM false completion, tiny-frame queue pressure and physical framing-budget mistakes. An intermediate concurrent backend/e2e/build run also hit the existing bootstrap fixture's 10-second process-start bound; no timeout was raised to hide it. The accounting queue-full test was updated to fill actual bounded control slots now that tiny PCM deliberately coalesces, retaining its billing-evidence assertion. The immediately preceding isolated backend run passed **963 tests, 10 skipped**; the final rerun additionally includes the physical-framing regression.

The parent session independently repeated both packages' build, lint and full routine test commands after the fixer finished: the same **964 backend passes / 10 skips** and **336 frontend passes** were confirmed. A subsequent isolated backend e2e rerun confirmed the same **19 passed / 40 skipped / 70 prerequisite failures**, not a passing e2e result. Local report links and preservation of the detection source/regressions were also rechecked. Full parent e2e output is retained locally at `C:\Users\Peter\AppData\Local\Temp\opencode\aurvin-voice-final-e2e.txt`.

### Remaining verification / genuinely blocked work

- Native MongoDB acceptance, fenced writes, crash recovery, checkpointer restoration and actual database-backed archive paging are **not certified** by the in-memory runtime/record-store tests. They require operator-supplied isolated fixture settings and a rerun of native suites. E2e prerequisite failures above remain unresolved without those settings; no application database was substituted.
- Live Deepgram/OpenRouter behavior, physical microphone/speaker timing, acoustic barge-in, browser/hardware combinations, slow-network proxy streaming and staging remain unrun. No incident-specific cause or guaranteed performance improvement is claimed.
- Existing unattributed legacy archive records were not migrated/backfilled, and previously lost RAM-only aggregates were not reconstructed. Sequential cold provider startup and EOT policy remain unchanged, not silently declared optimized.
- No handoff defect was intentionally removed from scope; the implementation addresses all fourteen areas with deterministic checks, but **full live/native acceptance remains pending**, so this is not an unconditional “all bugs fixed / production ready” claim.

### Changed-file manifest (all uncommitted fixer/parent-owned work)

Backend production:

- [`backend/src/app.service.ts`](../backend/src/app.service.ts)
- [`backend/src/chat-runtime/durable-chat-runtime.ts`](../backend/src/chat-runtime/durable-chat-runtime.ts)
- [`backend/src/chat-runtime/ports.ts`](../backend/src/chat-runtime/ports.ts)
- [`backend/src/chat-runtime/reconciliation.ts`](../backend/src/chat-runtime/reconciliation.ts)
- [`backend/src/contracts/voice-wire.ts`](../backend/src/contracts/voice-wire.ts)
- [`backend/src/contracts/voice.ts`](../backend/src/contracts/voice.ts)
- [`backend/src/persistence/messages.ts`](../backend/src/persistence/messages.ts)
- [`backend/src/voice/agent/agent-voice-adapter.ts`](../backend/src/voice/agent/agent-voice-adapter.ts)
- [`backend/src/voice/agent/speech-prose.ts`](../backend/src/voice/agent/speech-prose.ts)
- [`backend/src/voice/agent/voice-delivery.ts`](../backend/src/voice/agent/voice-delivery.ts)
- [`backend/src/voice/providers/flux-tts.ts`](../backend/src/voice/providers/flux-tts.ts)
- [`backend/src/voice/providers/provider-link.ts`](../backend/src/voice/providers/provider-link.ts)
- [`backend/src/voice/session/live-flow.ts`](../backend/src/voice/session/live-flow.ts)
- [`backend/src/voice/session/voice-session.options.ts`](../backend/src/voice/session/voice-session.options.ts)
- [`backend/src/voice/session/voice-session.service.ts`](../backend/src/voice/session/voice-session.service.ts)
- [`backend/src/voice/transport/voice-connection.ts`](../backend/src/voice/transport/voice-connection.ts)
- [`backend/src/voice/usage/voice-usage.service.ts`](../backend/src/voice/usage/voice-usage.service.ts)

Backend checks/fixtures:

- [`backend/test/fixtures/deepgram/socket.ts`](../backend/test/fixtures/deepgram/socket.ts)
- [`backend/test/persistence/voice-messages.spec.ts`](../backend/test/persistence/voice-messages.spec.ts)
- [`backend/test/voice/investigation.spec.ts`](../backend/test/voice/investigation.spec.ts) (converted parent diagnostic)
- [`backend/test/voice/agent/pipeline.spec.ts`](../backend/test/voice/agent/pipeline.spec.ts) (new composed suite)
- [`backend/test/voice/agent/bridge.native.e2e-spec.ts`](../backend/test/voice/agent/bridge.native.e2e-spec.ts)
- [`backend/test/voice/agent/speech-prose.spec.ts`](../backend/test/voice/agent/speech-prose.spec.ts)
- [`backend/test/voice/agent/submission.spec.ts`](../backend/test/voice/agent/submission.spec.ts)
- [`backend/test/voice/agent/voice-delivery.spec.ts`](../backend/test/voice/agent/voice-delivery.spec.ts)
- [`backend/test/voice/providers/accounting.spec.ts`](../backend/test/voice/providers/accounting.spec.ts)
- [`backend/test/voice/providers/flux-tts.spec.ts`](../backend/test/voice/providers/flux-tts.spec.ts)
- [`backend/test/voice/providers/resilience.spec.ts`](../backend/test/voice/providers/resilience.spec.ts)
- [`backend/test/voice/session/live.spec.ts`](../backend/test/voice/session/live.spec.ts)
- [`backend/test/voice/transport/gateway.spec.ts`](../backend/test/voice/transport/gateway.spec.ts)
- [`backend/test/voice/usage/operations.spec.ts`](../backend/test/voice/usage/operations.spec.ts)

Frontend production:

- [`frontend/src/api/voice-client.ts`](../frontend/src/api/voice-client.ts)
- [`frontend/src/api/voice-protocol.ts`](../frontend/src/api/voice-protocol.ts)
- [`frontend/src/components/MessageItem.tsx`](../frontend/src/components/MessageItem.tsx)
- [`frontend/src/components/VoiceTranscriptModal.tsx`](../frontend/src/components/VoiceTranscriptModal.tsx)
- [`frontend/src/features/voice/audio/audio-playback-service.ts`](../frontend/src/features/voice/audio/audio-playback-service.ts)
- [`frontend/src/features/voice/dictation/dictation-controller.ts`](../frontend/src/features/voice/dictation/dictation-controller.ts)
- [`frontend/src/features/voice/live/live-voice-lifecycle.ts`](../frontend/src/features/voice/live/live-voice-lifecycle.ts)
- [`frontend/src/features/voice/state/live-voice-controller.ts`](../frontend/src/features/voice/state/live-voice-controller.ts)

Frontend checks:

- [`frontend/src/components/MessageItem.test.ts`](../frontend/src/components/MessageItem.test.ts)
- [`frontend/src/components/VoiceTranscriptModal.test.ts`](../frontend/src/components/VoiceTranscriptModal.test.ts)
- [`frontend/src/features/voice/integration-tests/investigation.test.ts`](../frontend/src/features/voice/integration-tests/investigation.test.ts) (converted parent diagnostic)
- [`frontend/src/features/voice/integration-tests/pipeline.test.ts`](../frontend/src/features/voice/integration-tests/pipeline.test.ts) (new composed suite)
- [`frontend/src/features/voice/live/live-voice-lifecycle.test.ts`](../frontend/src/features/voice/live/live-voice-lifecycle.test.ts)
- [`frontend/src/features/voice/state/live-voice-controller.test.ts`](../frontend/src/features/voice/state/live-voice-controller.test.ts)
- [`frontend/src/features/voice/transport/voice-client.test.ts`](../frontend/src/features/voice/transport/voice-client.test.ts)

Documentation: this report, preserving the baseline evidence above and adding only this implementation/verification appendix.
