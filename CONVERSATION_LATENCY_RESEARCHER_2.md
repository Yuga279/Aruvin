# Aurvin conversation latency research — researcher 2

Research date: 7 November 2026. Checkout inspected: `89e0d4ee94c14f92d383efd1e114a1b8b57463c9`. Local Node: `v24.19.0`.

This is source research and an architecture recommendation, not implementation or a performance result. No application, tests, providers, database services, Azure checks, provisioning, or deployment were run. No credentials or `.env` contents were read. Existing `research.md` and `plan*.md` were not read. No skills or workflow were invoked. The sole file output is this requested report; source/configuration remain unchanged.

## 1. Recommendation

For the user's accepted tradeoff—losing unpersisted conversation data on a crash—the strongest direction is **one bounded in-memory conversation state per active session, immediate model/audio delivery, and ordered consolidated persistence after the interaction**.

The main opportunity is removing durability dependencies from the conversation path. Existing code already caches assets/configuration, reuses confirmed context, batches historical lookups, coalesces some observation writes, and streams live speech before its main graph checkpoint cycle. Adding another generic cache or merely replacing awaited writes with untracked promises would miss the remaining dependency chain.

Proceed in two levels:

1. Make small, independently useful reductions: optimistic sidebar updates, use the existing bounded checkpoint read facade, carry more confirmed receipts through accounting/delivery, and avoid repeated session/context preflights.
2. Change the plain-conversation execution contract: memory acceptance and context become sufficient for dispatch and next-turn admission; background persistence owns archive durability. Keep external calendar mutation intent/authority barriers separate.

The old project requirements say acceptance and completion are durable. The user's requested behavior changes those guarantees for conversational data. A later implementation needs explicit states for **accepted in this process**, **answer finished**, and **saved**. It must not silently report old durable semantics after moving writes.

There are no measured latency percentiles in this report and no promise of a particular speedup. The ordering below ranks source-observed work by how directly it blocks the requested interaction.

## 2. Evidence and limits

### Relevant dependency versions

The lockfile pins LangGraph `1.4.19`, MongoDB checkpointer `1.4.1`, MongoDB driver `6.21.0`, Nest core `12.1.2`, LiveKit Node RTC `1.2.1`, and LiveKit server SDK `2.19.2`: `backend/package-lock.json:608`, `:639`, `:4657`, `:1013`, `:874`, `:4426`. Frontend manifests use React 19 and LiveKit client 2: `frontend/package.json:17`.

Context7 was requested, but no Context7 tool is exposed in this session; tool discovery returned none. Framework guidance was checked against official documentation and, where necessary, the locally installed library source. Current online documentation is not assumed to describe the exact installed release.

### What is unknown

The user reports Cosmos DB on Azure. The actual product/API, protocol version, tier, regions, partition keys, enabled capabilities, consistency, RU/throttling behavior, and deployment topology are unknown. Backend placement, process count, autoscaling, sticky routing, durable local disk, proxy behavior, LiveKit region, and browser/device/audio route are also unknown.

The checkout initializes the application runtime only for the `native-mongodb` profile ([backend/src/app.service.ts:731](D:/Peter/ECG/Aurvin/backend/src/app.service.ts:731)), although profile labels include Cosmos MongoDB RU and Azure DocumentDB ([backend/src/contracts/persistence-profile.ts:23](D:/Peter/ECG/Aurvin/backend/src/contracts/persistence-profile.ts:23)). A URI using a native label is not evidence of native service semantics. This mismatch needs sanitized operator facts, not an inferred compatibility claim.

No eligible checked-in `*.log` files were found by the read-only file search. Logging/counter implementation and benchmark interpretation were inspected; this report does not invent observations from a running deployment.

## 3. Actual text path

### 3.1 Browser submission and stream attachment

```text
submitMessage
  -> optimistic user bubble; submitting state
  -> POST turn, await acceptance response
  -> TURN_ACCEPTED and attach coalescer
  -> GET returned stream URL
  -> server stream reservation/status check
  -> runtime execution starts
  -> provider fetch
  -> provider SSE -> backend delta -> application SSE
  -> browser coalescer -> React -> first paint
  -> durable publication/release -> terminal frames -> composer unlock
```

- [frontend/src/features/chat/state/use-chat.ts:467](D:/Peter/ECG/Aurvin/frontend/src/features/chat/state/use-chat.ts:467) validates the draft, allocates an idempotency key, invalidates stale reconciliation, and dispatches `TURN_SUBMIT_START`. It awaits `client.submitTurn` at line 493 and only starts `connectTurnStream` at line 522.
- [frontend/src/features/chat/state/chat-reducer.ts:351](D:/Peter/ECG/Aurvin/frontend/src/features/chat/state/chat-reducer.ts:351) creates the provisional user bubble. `TURN_ACCEPTED` at line 379 binds IDs and sets streaming. Neither transition inserts a sidebar session row.
- [frontend/src/api/client.ts:215](D:/Peter/ECG/Aurvin/frontend/src/api/client.ts:215) sends the POST. `connectTurnStream:261` performs a separate fetch, reads response chunks, and parses application SSE.
- Thus even an instantaneous backend admission retains a browser/backend POST-response-GET dependency. Combining submit and streaming into one POST response could remove that additional handoff; it is a transport/API change, not required for the first database reductions.
- [backend/src/http/chat-http.service.ts:54](D:/Peter/ECG/Aurvin/backend/src/http/chat-http.service.ts:54) validates the command and delegates. `streamStatus:66` first tries the receipt-backed `getStreamAttempt`; a hit avoids the fallback session/attempt reads.
- [backend/src/http/chat-stream.transport.ts:32](D:/Peter/ECG/Aurvin/backend/src/http/chat-stream.transport.ts:32) reserves one attachment per user/session and a runtime slot. It awaits stream status at line 51, creates the writer, and invokes execution at line 81.
- Terminal events are deliberately buffered at lines 69–94 until the runtime reservation is relinquished. Reporting an early terminal from deep inside execution alone would not change browser unlock.
- [backend/src/http/sse-writer.ts:34](D:/Peter/ECG/Aurvin/backend/src/http/sse-writer.ts:34) flushes SSE headers, validates/bounds events, and awaits socket drain when needed. This backpressure is useful; removing it would trade latency for unbounded buffering. Node documents the write/drain contract in its [HTTP response API](https://nodejs.org/api/http.html#responsewritechunk-encoding-callback). Nest supports this library-specific response ownership through [controllers](https://docs.nestjs.com/controllers#library-specific-approach).

### 3.2 Admission before the POST returns

The substantive path is [backend/src/chat-runtime/durable-chat-runtime.ts:689](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:689):

1. Resolve trusted identity and deterministic session/turn/attempt/message IDs; check in-process text/live reservation.
2. Read session and idempotency record in parallel (lines 700–705). Live voice may reuse a fresh negative idempotency lookup.
3. Capture the current immutable config snapshot and validate input (lines 735–751). This is not a per-turn config database fetch.
4. For a new session, create it; live turns call `createForInternalTurn` even on follow-ups (lines 768–770).
5. Acquire execution ownership (line 772). The ownership implementation reads the executor sentinel, reads the session, and performs a conditional session update.
6. In parallel, read the previous latest attempt if present, load healthy context, and check for an orphan input (lines 787–793). Voice can skip the orphan lookup under narrow fresh-submission/generation conditions.
7. Fall back to full boundary reconstruction if healthy loading fails (line 795).
8. Inside an ownership phase: reserve active attempt, allocate three event sequences, append input and accepted attempt, then confirm acceptance (lines 815–857).
9. Potentially check calendar availability (line 858).
10. Detach the accepted lease, cache a receipt, drain outstanding work, close the local work slot, and return IDs (lines 861–899).

These are semantic gates, not accidental awaits on telemetry. They implement the old acceptance durability contract. Changing them requires the new persistence policy.

### 3.3 Assets, configuration, history, and context

**Assets/configuration are already loaded ahead of chat.**

- [backend/src/app.service.ts:731](D:/Peter/ECG/Aurvin/backend/src/app.service.ts:731) loads fixed assets once; it retains `cachedAssets`, opens persistence, reads/activates stored configuration, and builds the runtime.
- `prepareConfigurationSnapshot:143` verifies fixed context and loads model limits during snapshot preparation, not on every streamed token.
- [backend/src/instructions/fixed-assets.ts:91](D:/Peter/ECG/Aurvin/backend/src/instructions/fixed-assets.ts:91) loads instruction/knowledge files together.
- Re-reading Markdown files or adding a configuration cache is not the primary fix.

**Warm consecutive plain text already avoids most history retrieval.**

- [durable-chat-runtime.ts:504](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:504) checks a confirmed-state entry against executor, generation, latest turn, asset versions, and a real checkpoint ID.
- With complete plain records and no refresh references, it assembles from memory (lines 526–577).
- A cache miss reads manifest and graph state in parallel (lines 580–592), then fetches referenced messages in a bounded query at line 675.
- The assembler uses the supplied source snapshot; it does not always reload every message. See [backend/src/context/referenced-context-assembler.ts:112](D:/Peter/ECG/Aurvin/backend/src/context/referenced-context-assembler.ts:112) and [backend/src/persistence/messages.ts:269](D:/Peter/ECG/Aurvin/backend/src/persistence/messages.ts:269).
- Receipt attachment rebuilds text context but can reuse complete assembled live-voice context ([durable-chat-runtime.ts:435](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:435)). Text's prepare hook still rereads the manifest at line 1379, even with a receipt; the narrow live fast path skips it.
- New text first attempts healthy loading and, without a manifest, falls through to `checkBoundary:323`, which again reads manifest/graph plus accepted history. Voice has a special empty-boundary bootstrap at lines 596–654. Reusing that proven new-thread shape for plain text is a small opportunity.
- Full fallback reconstruction is materially different from warm operation: [backend/src/chat-runtime/history.ts:26](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/history.ts:26) and `:36` page attempts and archive, up to 100 pages each, then batch acceptance markers in chunks of 500 at line 63. This is bounded, but should not become routine pre-dispatch work.

**Voice-containing context can still read on a warm turn.**

[referenced-context-assembler.ts:129](D:/Peter/ECG/Aurvin/backend/src/context/referenced-context-assembler.ts:129) collects earlier live assistant attempts and obtains their delivery records via `getVoiceDeliveries` at line 132. The metadata adapter batches these in one query for a nonempty list ([backend/src/persistence/metadata.ts:533](D:/Peter/ECG/Aurvin/backend/src/persistence/metadata.ts:533)). Having cached message records therefore does not prove zero database context work for mixed/voice history. Cache the settled heard projection or its confirmed receipt as well, with correct invalidation.

Context preserves selected session history and the new input once ([referenced-context-assembler.ts:158](D:/Peter/ECG/Aurvin/backend/src/context/referenced-context-assembler.ts:158)). Existing conservative context/input/storage bounds must remain; automatic truncation/compaction is a separate scope.

### 3.4 Attach through first provider output

[durable-chat-runtime.ts:1067](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:1067) obtains attempt/input from the admission receipt, otherwise rereads them.

- A hot attach conditionally claims the accepted session at line 1185, starts the heartbeat, and reuses context evidence.
- It starts delivery if applicable and transitions the attempt to `generating` at lines 1237–1301.
- The text route builds a Mongo-backed graph and invokes it at lines 1500–1508. Text generation runs inside the prepare node: [backend/src/agent/turn-graph.ts:71](D:/Peter/ECG/Aurvin/backend/src/agent/turn-graph.ts:71) already avoids an empty prepare checkpoint before inference.
- The graph still loads/checkpoints state around execution; [backend/src/chat-runtime/finalization.ts:97](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/finalization.ts:97) explicitly sets `durability: 'sync'`.
- The prepare hook at [durable-chat-runtime.ts:1374](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:1374) can perform a fence plus a manifest recheck, depending on attach/receipt conditions.
- [backend/src/model/openrouter-adapter.ts:160](D:/Peter/ECG/Aurvin/backend/src/model/openrouter-adapter.ts:160) constructs dispatch accounting before fetch. **Text awaits the initial accounting save at line 170 before the provider fetch at line 176.** Live voice skips that particular pre-dispatch save.
- At generation-ID capture, text awaits the attempt-identity and accounting writes before yielding the first delta ([openrouter-adapter.ts:115](D:/Peter/ECG/Aurvin/backend/src/model/openrouter-adapter.ts:115), especially 129–157). These share an ownership phase and run concurrently inside it, but still create a first-output barrier.
- Text also awaits accounting saves on changed provider usage frames (line 216). Its first-text observation can enqueue a background accounting write (lines 236–243).
- The adapter awaits final accounting at line 265 before emitting its end marker. This tail delays graph sealing/finalization.
- Server identity is already included on model attempts ([durable-chat-runtime.ts:1441](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:1441)); do not drop it when shortening the path.

There is no general database write per ordinary text token. The problematic work is lifecycle/accounting barriers and, for voice, delivery snapshots.

### 3.5 Completion and next-turn unlock

The existing path is intentionally long after model output:

```text
provider end + accounting drain
  -> graph invoke/seal completes
  -> graph.getState validation
  -> attempt finalizing write
  -> assistant append + accounting final outcome
  -> manifest update
  -> graph boundary update + graph.getState confirmation
  -> assistant completion update
  -> terminal attempt update
  -> session finish/activity/slot release
  -> pending work/ownership drain
  -> publish completed event
  -> transport releases reservation and sends terminal frames
```

Evidence:

- [durable-chat-runtime.ts:1507](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:1507) invokes and reads sealed graph state, then writes finalizing status at line 1514.
- [backend/src/chat-runtime/finalization.ts:198](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/finalization.ts:198) publishes. It stages assistant append/accounting together, then at lines 292–304 serially updates manifest, seals/confirms the graph boundary, completes the assistant record, optionally touches activity, and completes the attempt.
- Text combines activity, slot, and ownership release through `finishAttempt` at [durable-chat-runtime.ts:1553](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:1553); it already avoids a redundant separate activity touch on that path.
- Confirmed cache insertion occurs only after successful release (line 1640).
- `Work.settled` drains tracked promises to a fixed point ([backend/src/chat-runtime/work.ts:216](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/work.ts:216)). The transport also waits for the reserved run.

**Async final persistence only improves conversational readiness if this dependency chain is split.** A background write tracked by the same Work object still blocks its drain and completion. The next turn must obtain the previous result from the in-memory session state; it cannot immediately fall back to the not-yet-updated durable manifest.

## 4. Actual voice paths

### 4.1 Live conversation setup

Live voice currently uses LiveKit WebRTC. Legacy raw PCM browser playback/capture modules are not the production live composition.

- [frontend/src/features/voice/state/useLiveVoice.ts:56](D:/Peter/ECG/Aurvin/frontend/src/features/voice/state/useLiveVoice.ts:56) constructs `LiveKitVoiceClient`.
- [live-voice-controller.ts:294](D:/Peter/ECG/Aurvin/frontend/src/features/voice/state/live-voice-controller.ts:294) claims the chat voice lease. `activate:314` awaits microphone/audio preparation, then HTTP session creation, then room connection.
- [frontend/src/api/livekit-voice-client.ts:128](D:/Peter/ECG/Aurvin/frontend/src/api/livekit-voice-client.ts:128) starts audio unlock and microphone capture together. Session admission starts after that preparation resolves. Parallelizing authorized HTTP admission with permission preparation is a possible setup improvement, but must release a session if permission is denied. Do not preopen paid provider sockets on page load.
- [backend/src/voice/session/voice-session.service.ts:219](D:/Peter/ECG/Aurvin/backend/src/voice/session/voice-session.service.ts:219) verifies an existing conversation. Its admission quotas are in memory; [backend/src/voice/usage/voice-usage.service.ts:189](D:/Peter/ECG/Aurvin/backend/src/voice/usage/voice-usage.service.ts:189) is not a database quota query.
- Live reservation acquire/bind can query session busy state: [backend/src/chat-runtime/execution-reservations.ts:57](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/execution-reservations.ts:57), `:77`; the callback is [durable-chat-runtime.ts:221](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:221).
- Voice session issue awaits the LiveKit ticket/room operation and backend bridge connection ([voice-session.service.ts:119](D:/Peter/ECG/Aurvin/backend/src/voice/session/voice-session.service.ts:119), `:132`, `:139`).
- [backend/src/voice/session/live-flow.ts:94](D:/Peter/ECG/Aurvin/backend/src/voice/session/live-flow.ts:94) opens STT and TTS in parallel. Each socket's accounting admission is awaited before its provider connection ([backend/src/voice/usage/voice-accounting.ts:50](D:/Peter/ECG/Aurvin/backend/src/voice/usage/voice-accounting.ts:50); `providers/flux-stt.ts:38`; `providers/flux-tts.ts:40`).
- [backend/src/app.service.ts:897](D:/Peter/ECG/Aurvin/backend/src/app.service.ts:897) wraps each speech accounting write with an executor assertion and metadata persistence.
- Warm utterances on the same call reuse speech sockets. Fresh voice-session-per-utterance measurements cannot represent this warm path.

Setup includes permission/gesture, HTTP, LiveKit control/SFU, provider sockets, and database admission. A database-only change cannot eliminate all of that.

### 4.2 Microphone through final transcript

```text
browser native microphone track
  -> LiveKit/SFU
  -> backend decoded AudioStream (16 kHz, mono, 80 ms)
  -> bounded input/quiet gate
  -> Flux /v2/listen
  -> StartOfTurn / updates / final EndOfTurn
  -> serialized finalized-speech hook
  -> live turn admission
```

- [backend/src/voice/transport/livekit-media.ts:314](D:/Peter/ECG/Aurvin/backend/src/voice/transport/livekit-media.ts:314) requests 80 ms audio frames.
- [livekit-input.ts:65](D:/Peter/ECG/Aurvin/backend/src/voice/transport/livekit-input.ts:65) accumulates exact frames and applies a quiet gate with bounded pre-roll. Its forwarding loop awaits STT socket writes, not database writes.
- Quiet suspension is after five seconds; this is an upload-saving gate, not the normal conversational end-of-turn timer ([backend/src/contracts/voice-wire.ts:81](D:/Peter/ECG/Aurvin/backend/src/contracts/voice-wire.ts:81)).
- `providers/flux-stt.ts:79` maps StartOfTurn; line 83 maps EndOfTurn. EagerEndOfTurn and TurnResumed are deliberately not execution authorization (line 88).
- Code defaults are EOT threshold 0.8 and timeout 5000 ms ([backend/src/platform/config/voice-config.ts:106](D:/Peter/ECG/Aurvin/backend/src/platform/config/voice-config.ts:106)). The timeout is a backstop, not proof that every utterance waits five seconds.
- [live-flow.ts:528](D:/Peter/ECG/Aurvin/backend/src/voice/session/live-flow.ts:528) processes recognition events. EndOfTurn queues one bounded next finalized input through `finalChain` (lines 543–569). There is a cap of two pending turns, including current work.
- **No database write is performed for every incoming PCM frame or partial recognition transcript in this flow.**

The [official Flux configuration guide](https://developers.deepgram.com/docs/flux/configuration) describes the certainty/latency tradeoff and distinguishes timeout from confidence-based end-of-turn. The [Flux quickstart](https://developers.deepgram.com/docs/flux/quickstart) recommends approximately 80 ms chunks. Shrinking frames blindly is not the first fix.

### 4.3 Final transcript through first speech

[backend/src/voice/agent/agent-voice-adapter.ts:128](D:/Peter/ECG/Aurvin/backend/src/voice/agent/agent-voice-adapter.ts:128):

1. Wait for previous active execution and output reset/drain.
2. Bind conversation if necessary.
3. Find a previous live submission by stable provider utterance key.
4. Submit the internal live turn.
5. Read accepted status, usually from its receipt.
6. Prepare the response and attach execution/delivery.

The negative lookup is cached for ten seconds ([durable-chat-runtime.ts:2178](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:2178)) so the subsequent admission can avoid duplicating it. Do not “optimize” by adding a second idempotency cache.

The live route is already more latency-oriented than text:

- It reuses assembled context from the admission receipt.
- [durable-chat-runtime.ts:1281](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:1281) stages the initial delivery journal and generating attempt transition together.
- [openrouter-adapter.ts:169](D:/Peter/ECG/Aurvin/backend/src/model/openrouter-adapter.ts:169) skips the initial dispatch-accounting barrier for live voice.
- Generation-ID persistence runs in the background for voice, with failure supervision ([openrouter-adapter.ts:135](D:/Peter/ECG/Aurvin/backend/src/model/openrouter-adapter.ts:135)).
- [durable-chat-runtime.ts:1495](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:1495) computes/streams the live model result **before** creating/invoking its durable graph. Therefore a blanket claim that all voice inference waits for the main graph checkpoints would be wrong.

Speech output then follows:

```text
model delta
  -> SpeechProse filter
  -> VoiceDelivery.delta
  -> immediate Speak messages on existing Flux TTS socket
  -> SpeechStarted + PCM
  -> LiveFlow output pacing
  -> LiveKitOutput bounded capture queue
  -> native AudioSource / WebRTC / SFU
  -> browser remote audio track
  -> actual device output
```

- [backend/src/voice/agent/voice-delivery.ts:184](D:/Peter/ECG/Aurvin/backend/src/voice/agent/voice-delivery.ts:184) sends speech immediately while journaling generated text in background batches: first content, 512-character threshold, or approximately 100 ms (lines 167–195). This is not one write per token and not a guaranteed fixed rate.
- `providers/flux-tts.ts:150` pipelines per-response accounting; it does not wait for that database write before Speak. Socket-level accounting still blocks socket setup.
- [live-flow.ts:593](D:/Peter/ECG/Aurvin/backend/src/voice/session/live-flow.ts:593) tracks SpeechStarted without blocking first PCM on the delivery hook.
- [live-flow.ts:639](D:/Peter/ECG/Aurvin/backend/src/voice/session/live-flow.ts:639) paces output using playback progress and the output queue budget.
- [backend/src/voice/transport/livekit-output.ts:90](D:/Peter/ECG/Aurvin/backend/src/voice/transport/livekit-output.ts:90) converts PCM, queues a native AudioFrame, sends bounded sample watermarks, and drains capture frames serially. No database work is attached directly to each audio frame.
- [livekit-media.ts:146](D:/Peter/ECG/Aurvin/backend/src/voice/transport/livekit-media.ts:146) gives the AudioSource the output queue budget; defaults allow two seconds (`contracts/voice-wire.ts:108`). A queue capacity is not a mandatory two-second initial delay. Measure actual occupancy before tuning.
- LiveKit's [AudioSource API](https://docs.livekit.io/reference/client-sdk-node/classes/AudioSource.html) exposes capture, queue clearing, queued duration, and playout waiting. Server source drain is not proof of audible browser output.
- [frontend/src/features/voice/audio/live-track-playback.ts:117](D:/Peter/ECG/Aurvin/frontend/src/features/voice/audio/live-track-playback.ts:117) estimates an observed cursor within server watermarks and marks uncertain observations unproven. It is useful delivery bookkeeping; it is not acoustic measurement of a speaker.

### 4.4 Voice journal and readiness remain expensive

- Each `VoiceDelivery.update:86` persists a new full snapshot, including accumulated generated text.
- `metadata.compareVoiceDelivery:595` still reads the existing delivery document before revision-CAS replacement. Linkage receipts avoid the older separate input/attempt rereads, but do not remove this read.
- The runtime callback executes these writes under `owner.run` ([durable-chat-runtime.ts:1265](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:1265)); outside a grouped phase, that also fences executor/session.
- Playback reports are sent by the browser every 100 ms while a response exists ([live-voice-controller.ts:285](D:/Peter/ECG/Aurvin/frontend/src/features/voice/state/live-voice-controller.ts:285), `:548`). `VoiceDelivery.observePlayback:263` collapses pending samples while a write is active, but it has no separate long debounce window.
- `VoiceDelivery.finish:198` waits for the generated-text journal to drain as well as TTS Flush. Artifact publication at line 213 also drains generated text and awaits an artifact journal update.
- [live-flow.ts:605](D:/Peter/ECG/Aurvin/backend/src/voice/session/live-flow.ts:605) awaits non-started delivery events before later event handling. Persistence can therefore still delay completion/control progression, even though first PCM is protected.
- The standard text-result graph sealing/publication runs after live generation.
- [durable-chat-runtime.ts:1550](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:1550) explicitly retains the voice lease for playback settlement; the finally block at lines 1703–1739 settles delivery, stops heartbeat, drains tracked work/ownership, releases the session, and only then installs confirmed warm state.
- `VoiceDelivery.settle:342` waits for sufficient heard/interruption proof, then persists terminal delivery.
- [agent-voice-adapter.ts:122](D:/Peter/ECG/Aurvin/backend/src/voice/agent/agent-voice-adapter.ts:122) and [live-flow.ts:556](D:/Peter/ECG/Aurvin/backend/src/voice/session/live-flow.ts:556) serialize the next finalized utterance behind the preceding run. Moving a journal write off first audio without changing these barriers does not remove next-turn delay.

For this user's tradeoff, keep generated text, played samples, speech ID, and heard/unknown status in memory during the response; consolidate their persistence afterward. Next-turn model context must use that in-memory heard projection. Generated text must never automatically become “heard text.”

### 4.5 Barge-in

- Flux StartOfTurn aborts thinking and starts response interruption ([live-flow.ts:538](D:/Peter/ECG/Aurvin/backend/src/voice/session/live-flow.ts:538)).
- [live-flow.ts:476](D:/Peter/ECG/Aurvin/backend/src/voice/session/live-flow.ts:476) invalidates output before awaiting playback/cancellation persistence. [agent-voice-adapter.ts:243](D:/Peter/ECG/Aurvin/backend/src/voice/agent/agent-voice-adapter.ts:243) invalidates delivery and synchronously requests runtime cancellation before awaiting its promise.
- A manual browser interrupt silences the local track immediately before sending the server control ([live-voice-controller.ts:620](D:/Peter/ECG/Aurvin/frontend/src/features/voice/state/live-voice-controller.ts:620)).
- Provider interruption offsets, response/epoch fencing, and late-frame invalidation must remain even with asynchronous persistence.
- Browser native input does not use the dictation VAD as a local automatic live interrupt. Automatic voice barge-in includes the uplink/ASR StartOfTurn path.
- Faster next response may require separating immediate silence, in-memory cancellation, TTS reset/proof settlement, and durable journal completion. Those are different milestones.
- Flux TTS retains conversational acoustic state across Flush and Interrupt; reconnecting resets it. Preserve warm sockets when valid, while keeping reset on ambiguous output. See [Deepgram cross-turn context](https://developers.deepgram.com/docs/flux-tts/context).

### 4.6 Dictation and transcript display

Dictation is a draft-input tool, not the live voice agent:

- [frontend/src/features/voice/dictation/dictation-controller.ts:84](D:/Peter/ECG/Aurvin/frontend/src/features/voice/dictation/dictation-controller.ts:84) starts capture, admits a dictation session, and writes partial/final transcription to the composer at line 119.
- It finishes into `draft_ready`; the later user text submission follows the normal text path.
- Backend [dictation-flow.ts:93](D:/Peter/ECG/Aurvin/backend/src/voice/session/dictation-flow.ts:93) routes partial/final events without message-archive writes. On stop, it starts a bounded finalization timeout.
- At [dictation-flow.ts:120](D:/Peter/ECG/Aurvin/backend/src/voice/session/dictation-flow.ts:120), completion waits for STT close. Nova close drains socket accounting. Thus draft release can still be coupled to accounting cleanup; separate transcript completion from ledger drain if changing that contract, while retaining cleanup supervision.
- Live internal user/assistant messages are durable transcript records. [backend/src/persistence/messages.ts:89](D:/Peter/ECG/Aurvin/backend/src/persistence/messages.ts:89) pages them and batch-checks acceptance markers for internal user records; line 154 projects them as `voiceTranscripts`.
- The live panel is transcript-free; after a call the frontend refreshes conversation data ([live-voice-controller.ts:759](D:/Peter/ECG/Aurvin/frontend/src/features/voice/state/live-voice-controller.ts:759), [useLiveVoice.ts:64](D:/Peter/ECG/Aurvin/frontend/src/features/voice/state/useLiveVoice.ts:64)). [VoiceTranscriptModal.tsx:115](D:/Peter/ECG/Aurvin/frontend/src/components/VoiceTranscriptModal.tsx:115) correctly warns that a generated transcript is not proof of hearing.

Avoid introducing raw audio persistence, partial-transcript journaling, or per-token UI archive writes as part of a latency project.

## 5. Calendar-enabled text is a distinct path

An ordinary text question can use the calendar/skill loop when calendar is connected and enabled. This is not limited to prompts containing the word “calendar.”

- [durable-chat-runtime.ts:1743](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:1743) checks account availability during admission and stores an in-memory calendar window.
- During execution, lines 1305–1315 route a visible text turn into the loop when that window exists. A budget fallback lookup can also run.
- `runCalendarTurn:1782` reads current account again. It reconstructs historical tool groups at line 1805.
- [backend/src/chat-runtime/calendar-history.ts:30](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/calendar-history.ts:30) reads dispatches by selected turn, then saved decisions/results; work scales with included tool history and call count.
- [calendar-loop.ts:625](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/calendar-loop.ts:625) starts by checking ownership and current account, and inspecting the current proposal slot.
- Budget/dispatch reservation is grouped at lines 729–740, but provider dispatch is outside that phase.
- [calendar-budget.ts:679](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/calendar-budget.ts:679) performs fence, account validation, dispatch-state persistence, and another fence before a model request. Its in-memory confirmed budget/dispatch receipts already reduce repeats.
- [backend/src/model/calendar-adapter.ts:156](D:/Peter/ECG/Aurvin/backend/src/model/calendar-adapter.ts:156) awaits the dispatch hook. Identity/terminal observations remain priority barriers; nonpriority observations can use its coalescing writer.
- Decisions, tool evidence, budget debits, continuation checkpoints, and final publication add work according to the actual loop; a single fixed “calendar turn query count” would be misleading.
- [backend/src/chat-runtime/calendar-operation.ts:372](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/calendar-operation.ts:372) checks accepted authority/intent, deduplication, target capability, and availability before create. At lines 513–526 it reserves/records the operation; at lines 583–586 it checks authority/budget and durably marks dispatching before invoking the provider.
- Stable Google event IDs and private operation provenance already exist ([calendar-operation.ts:250](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/calendar-operation.ts:250); `plugins/google-calendar/calendar-api.ts:152`, `:293`, `:368`). Keep readback on ambiguous writes.

**Do not apply “crash loss is acceptable” to calendar mutations without a separate decision.** Losing a chat answer and losing evidence of an external create are different failures. Preserve a minimal durable intent/dispatch record and reconciliation identity before external mutations; defer redundant archive/accounting projections where possible.

Google supports caller-supplied IDs but does not promise collision detection at creation in every distributed case; stable IDs complement reconciliation rather than prove exactly-once effects. See [Events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

Live voice currently bypasses this calendar loop: the branch is guarded by `!internal` at [durable-chat-runtime.ts:1305](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/durable-chat-runtime.ts:1305). Adding calendar tools to live voice would be new functionality, beyond making current conversations faster.

## 6. Substantiated operation costs

These are **normal-path driver/repository operation counts derived from code**, not measured per-turn totals or guaranteed wire command counts. Assume acknowledged success, no retry/readback, no local mutation journal, and small cursor results without getMore. “Fence” costs apply outside an active ownership phase.

| Primitive | Source-derived normal work | Evidence |
| --- | --- | --- |
| Executor assertion | 1 read | [ownership.ts:186](D:/Peter/ECG/Aurvin/backend/src/persistence/ownership.ts:186) |
| Session fence | Executor assertion + session read: 2 reads | [ownership.ts:370](D:/Peter/ECG/Aurvin/backend/src/persistence/ownership.ts:370) |
| Ownership acquire | Executor read + session read + conditional update: 2 reads, 1 write | [ownership.ts:275](D:/Peter/ECG/Aurvin/backend/src/persistence/ownership.ts:275) |
| Detach accepted | Executor read + conditional update: 1 read, 1 write | [ownership.ts:850](D:/Peter/ECG/Aurvin/backend/src/persistence/ownership.ts:850) |
| Attach accepted | Executor read + conditional update: 1 read, 1 write | [ownership.ts:900](D:/Peter/ECG/Aurvin/backend/src/persistence/ownership.ts:900) |
| Sequence allocation, counter already present and new reservation | Reservation read + counter read + counter increment + reservation upsert: 2 reads, 2 writes, plus enclosing fence if any | [ownership.ts:657](D:/Peter/ECG/Aurvin/backend/src/persistence/ownership.ts:657) |
| First sequence counter bootstrap | Adds two existence reads and a counter insert to the preceding allocation path | [ownership.ts:689](D:/Peter/ECG/Aurvin/backend/src/persistence/ownership.ts:689) |
| Acceptance confirmation with valid receipts | Marker upsert + session latest-turn update: 2 writes, plus enclosing fence if any | [ownership.ts:757](D:/Peter/ECG/Aurvin/backend/src/persistence/ownership.ts:757) |
| Message append, fresh key | 1 upsert; acknowledgment returns a receipt without readback | [messages.ts:45](D:/Peter/ECG/Aurvin/backend/src/persistence/messages.ts:45); [store.ts:146](D:/Peter/ECG/Aurvin/backend/src/persistence/store.ts:146) |
| Attempt append | Attempt identity read + immutable upsert | `metadata.ts:153` |
| Fresh nonempty message reference batch | 1 bounded find; empty refs perform no query | [messages.ts:269](D:/Peter/ECG/Aurvin/backend/src/persistence/messages.ts:269) |
| Voice journal compare with linkage receipts | Existing-journal read + revision replace: 1 read, 1 write; enclosing owner.run usually adds 2 reads | `metadata.ts:595`; [ownership.ts:447](D:/Peter/ECG/Aurvin/backend/src/persistence/ownership.ts:447) |
| Stock checkpoint getTuple on nonempty state | 2 reads: checkpoint, pending writes | installed `@langchain/langgraph-checkpoint-mongodb/dist/checkpoint.js:81` |
| Current default scoped getTuple on nonempty state | 2 validation reads, then the stock saver’s 2 reads: 4 reads | [checkpoints.ts:368](D:/Peter/ECG/Aurvin/backend/src/persistence/checkpoints.ts:368) |
| Scoped getTuple with existing read facade enabled | Stock saver’s reads through bounded validation cursors; avoids the preceding duplicate pair | [checkpoints.ts:70](D:/Peter/ECG/Aurvin/backend/src/persistence/checkpoints.ts:70), `:370` |
| Checkpoint put | 1 stock checkpoint upsert, plus owner.run fence outside a phase | [checkpoints.ts:255](D:/Peter/ECG/Aurvin/backend/src/persistence/checkpoints.ts:255); installed saver `checkpoint.js:180` |
| Nonempty checkpoint putWrites | Existing pending-write read + stock bulk write, plus owner.run fence outside a phase | [checkpoints.ts:298](D:/Peter/ECG/Aurvin/backend/src/persistence/checkpoints.ts:298); installed saver `checkpoint.js:212` |
| Sidebar list | 3 parallel find queries for first/pinned pages; 2 for an unpinned continuation | [sessions.ts:100](D:/Peter/ECG/Aurvin/backend/src/persistence/sessions.ts:100) |

More amplification:

- `metadata.putAccountingConfirmed:336` rereads the attempt on every save.
- With a generation ID, it reads the generation claim and runs an immutable claim upsert before checking whether the accounting record is unchanged (lines 349–399).
- Once that immutable generation row exists, the upsert's normal matched-existing path rereads it for equality ([store.ts:180](D:/Peter/ECG/Aurvin/backend/src/persistence/store.ts:180)). A changed accounting snapshot with an existing generation and an expected accounting receipt therefore still does three repository reads and two writes before enclosing ownership fencing.
- Existing or ambiguous immutable writes intentionally read back; “one upsert” does not always mean one command.
- Ownership `exclusive:107` uses a shared promise tail. Unrelated sessions and voice background writes can queue behind this one owner. Grouping storage phases reduces checks but can also hold the global queue for their duration.
- Opt-in local crash recovery changes costs: [mutation-journal.ts:47](D:/Peter/ECG/Aurvin/backend/src/persistence/mutation-journal.ts:47) and `:52` add busy/idle executor transitions around mutation; [ownership.ts:405](D:/Peter/ECG/Aurvin/backend/src/persistence/ownership.ts:405) does not use the normal grouped-phase optimization when that journal is present. Do not extrapolate counts between profiles.

No current total count is claimed. Checkpoint scheduling, warm-cache validity, selected history, usage frames, voice duration/playback reports, calendar loops, ambiguity handling, and driver batching all change it.

Existing performance files contain useful assertions and historical baselines, not current results:
[backend/test/performance/durable-latency.spec.ts:25](D:/Peter/ECG/Aurvin/backend/test/performance/durable-latency.spec.ts:25) explicitly attributes its constants to an earlier revision; [voice-critical-path.spec.ts:30](D:/Peter/ECG/Aurvin/backend/test/performance/voice-critical-path.spec.ts:30) tests linkage reuse; [shared-admission-critical-path.spec.ts:168](D:/Peter/ECG/Aurvin/backend/test/performance/shared-admission-critical-path.spec.ts:168) checks phase grouping. None was executed for this research.

## 7. Reuse these primitives

| Existing primitive | Keep/reuse | Necessary distinction |
| --- | --- | --- |
| WorkRegistry and ExecutionReservations | In-process per-session exclusion, bounded concurrency, aborts | Background durability must have its own bounded lifecycle if it must not delay next turn |
| AdmissionReceiptStore | Same-process accepted IDs/input/context evidence; 60-second TTL | An unpersisted acceptance must not be minted as a confirmed database receipt |
| ConfirmedStateCache | Scoped versions, bounded records, TTL/size limits | Keep a separate current in-memory version and durable watermark |
| ConfirmedRecord | Store-bound WeakMap receipt for safe CAS without rereads | Carry original receipt object; serialized copies lose its hidden proof |
| Owned storage phases | Share one fence for consecutive storage-only work | Do not hold the global phase across provider waits/audio |
| ObservationWriter | At most one in-flight and one pending latest snapshot | It currently flushes/drains and aborts on persistence failure; its policy needs adapting for best-effort conversation persistence |
| VoiceDelivery | Generated/heard separation, samples, interruption/unknown evidence | Keep live semantics in memory; reduce snapshot persistence frequency |
| Database command observer | Sanitized wire counts, origins/phases, durations, pool waits | Repository-call counters and wire counters are different views |
| StreamTiming | Model wire milestones before application persistence | Prefer dispatch-correlated milestones over contaminated legacy timing fields |
| Frontend StreamDeltaCoalescer | rAF scheduling plus timeout fallback, terminal flush | Already limits render churn; retain while changing persistence |
| Deferred sidebar reconciliation | Abort/stale-generation protections | Merge optimistic rows instead of repeatedly fetching whole sidebar |

Cache limits are already finite: both principal stores cap at 128 entries, 2 MiB per entry, 16 MiB total. Confirmed state TTL is five minutes; admission receipt TTL is one minute ([confirmed-state-cache.ts:45](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/confirmed-state-cache.ts:45); [admission-receipt.ts:88](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/admission-receipt.ts:88)). Current access is insertion-ordered rather than a fully access-refreshing LRU. Do not introduce an eviction rewrite unless profiling shows it matters; never evict the only unsaved copy of active state.

## 8. Prioritized strategy

### Priority 1 — low-complexity changes useful under either persistence policy

1. **Optimistic sidebar.** Insert/update the row when acceptance binds server IDs; use a provisional idempotency-key row earlier if desired. Compute/display title immediately or include a server summary in acceptance. Preserve pin/order/title/deletion semantics. Merge later server revisions without discarding unsaved rows.
2. **Enable and verify the existing checkpoint read facade in production composition.** [persistence.ts:59](D:/Peter/ECG/Aurvin/backend/src/persistence/persistence.ts:59) currently constructs the factory without the option, despite the implementation at [checkpoints.ts:70](D:/Peter/ECG/Aurvin/backend/src/persistence/checkpoints.ts:70). This can remove repeated reads without inventing a saver. Test scope/bounds/stock-saver parity before enabling it.
3. **Carry attempt/generation/delivery receipts.** Extend existing confirmed evidence usage so repeated accounting saves do not revalidate the same immutable generation through database reads/upserts, and delivery comparisons can CAS from their last acknowledged revision. Preserve strict reload on conflict/uncertainty.
4. **Remove duplicate ordinary preflights where evidence already exists.** Examples: live follow-up session creation's extra get; healthy-context miss followed by repeated cold-boundary reads; text receipt's manifest reread when the same exclusive owner and version are still valid. Fix shared paths used by HTTP and voice.
5. **Reuse a settled voice heard projection.** Current message caching alone still reloads voice delivery history. Invalidate on delivery settlement, response cancellation, account redaction, config/schema change, and ownership change as appropriate.

These reduce actual work. They do not alone reach the user's requested zero-database warm dispatch.

### Priority 2 — make plain conversation execution independent of durability

Maintain a bounded server-side current session state with:

- Ordered accepted inputs/results, stable IDs, current context version and event sequence.
- Current generation/cancellation/voice response ownership.
- The latest heard voice projection, distinct from generated output.
- Current version and separately last-confirmed durable version.
- Immutable config/assets references per accepted attempt.

For a new session, create this state when the first input is accepted in memory. An unused New Chat remains unsaved.

For an existing cold session, hydrate bounded durable records once, then serve warm turns from the in-memory state. Do not treat the client transcript as trusted authority. A background write must never cause the next turn to reload an older durable manifest.

Plain text should be able to fetch the model after input/context/budget validation and in-process reservation, without per-turn Mongo fences, counter/reservation writes, acceptance marker writes, graph reads, or dispatch accounting on that warm path. Budget decisions remain finite and server-side; the changed crash/billing evidence guarantees must be recorded.

At model completion, update the in-memory context and release conversation execution when it is semantically safe. Schedule durable publication separately. Do not leave the existing Work drain/transport completion holding the same slot.

### Priority 3 — reduce persistence volume through consolidation

For the unchanged collection layout, build one immutable final turn snapshot and materialize:

- Both messages in one messages bulk operation.
- Attempt, usage/generation/delivery evidence in a bounded metadata bulk operation.
- One manifest update.
- One session metadata/activity update.

This is a **proposed target of four collection-level persistence calls per flushed plain turn**, excluding optional graph persistence, first-session setup, retries/readbacks, and socket accounting. It is not a measured command count, an atomic transaction, or a guarantee that a driver sends exactly four wire commands.

A per-session ordered writer must prevent late older work from overwriting a newer manifest/session/attempt. Coalesce mutable session/activity projections to the latest version, while retaining every accepted message/attempt that is meant to survive. Bound queue entries, bytes, age, concurrency, and shutdown drain. When full, apply explicit backpressure or show a save failure; never grow an unbounded queue.

Do not retain provisional assistant append plus completion replacement merely to reproduce an internal state no user needs durably. The final durable message can start in its final outcome under the new contract. Existing recovery readers must be updated coherently; otherwise they will reject the consolidated layout.

### Priority 4 — choose the least necessary graph persistence

| Alternative | Effect | Cost/limitation |
| --- | --- | --- |
| Keep sync saver + receipt/read reductions | Preserves most current recovery contract | Does not remove lifecycle writes or completion tail |
| Change plain graph to async durability | Overlaps checkpoint writes with later graph work | Usually hides work; still writes, drains, and risks competing with observations |
| Plain graph exit durability | Avoids routine per-step remote saves; persists at exit | Still has exit persistence and application publication; no mid-run crash recovery |
| In-memory/no remote checkpointer for plain turns; durable archive afterward | Removes remote graph storage from interaction | Requires rebuilding continuation from application state and changing old graph-boundary validators |
| One bounded durable turn envelope then asynchronous projections | Potentially simplest durable source of truth and fewer round trips | Adds a new record/reader/migration contract; avoid unless the existing final-write approach remains too complex |
| External durable queue/Redis | Can support different failure/topology requirements | New infrastructure and failure modes; unnecessary for the current single-process/crash-loss goal |

The installed LangGraph loop supports exit durability and suppresses normal per-step putWrites in that mode ([backend/node_modules/@langchain/langgraph/dist/pregel/loop.js:392](D:/Peter/ECG/Aurvin/backend/node_modules/@langchain/langgraph/dist/pregel/loop.js:392), `:822`). It also waits for checkpoint promises in sync mode at line 478. Current [checkpointer documentation](https://docs.langchain.com/oss/javascript/langgraph/checkpointers#durability-modes) describes the modes, but its current sync wording differs from this installed implementation. Verify behavior on the pinned release; a mode name alone is not proof that external side effects have a durable precondition.

Do not globally change `graphConfig` and accidentally remove calendar side-effect boundaries. Plain chat and a resumable external-action workflow need different choices.

### Priority 5 — keep audio/control free of database dependencies

- Keep generated text, progress, and provider speech identity in memory until the response has enough final/interruption/unknown evidence.
- Use one consolidated terminal delivery write, with a bounded optional coarse snapshot only if a recovery requirement needs it.
- Let TTS Speak/PCM delivery and immediate cancellation proceed independently of archive/accounting.
- Use in-memory heard state for the next utterance; persistence completion should not keep the speech turn queued.
- Preserve response/epoch sequencing, audio backpressure, proof uncertainty, late-frame invalidation, and output reset barriers.
- Preserve currently parallel STT/TTS connections and warm sockets.
- Measure quiet wake, permission/connection setup, ASR EOT, initial model output, first Speak, first PCM, playout, and settlement separately.

Only after these are separated should tuning thresholds or speculative inference be considered. Deepgram's [eager EOT guide](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot) requires handling speculative generation cancellation and additional model requests. It is higher complexity and can increase spend. Do not run calendar mutations from a speculative transcript.

### Priority 6 — calendar reductions without weakening side-effect authority

Reuse current account/config/capability evidence within a bounded attempt when invalidation is reliable; batch historical tool-evidence loads; avoid repeatedly querying the same proposal/connection purely to format a reply; consolidate noncritical accounting/projection writes.

Keep current authority checks at meaningful external-action boundaries, durable operation identity before mutation, original-operation readback after uncertainty, per-turn budgets, and content retention/redaction checks. A cache hit must not resurrect disconnected or expired calendar content.

A lexical “calendar intent” shortcut would reduce work on greetings but could silently remove tool capability for indirect requests. A simpler deliberate product choice is explicit capability/mode admission or lazy tool-state loading; evaluate it as behavior, not a transparent performance fix.

## 9. What asynchronous work does—and does not—solve

| Change | First dispatch/output | Next turn | Database volume |
| --- | --- | --- | --- |
| Put independent reads in Promise.all | Removes serial waiting | May help | Same calls |
| Fire existing journal updates in background | Can protect first audio | Still blocked if finish/settle/Work drains them | Similar volume |
| Coalesce pending snapshot updates | Usually helps under load | Shorter drain | Fewer writes |
| Switch sync checkpoints to async | May overlap useful work | Run/publication still drains | Similar checkpoint volume |
| Exit/no remote checkpoints for plain turns | Removes interaction graph barriers | Helps if final writer is separate | Fewer graph writes |
| Release UI on model end only | Feels ready | Backend may still reject next input | Same work; inconsistent semantics |
| Promote in-memory context and release execution before ordered save | Removes durability from interaction | Next turn uses current memory | Fewer writes only if consolidated |
| Optimistic sidebar | Immediate row/order | Removes incidental fetch contention | Fewer list queries if reconciliation policy changes |

Keep one server process as the authority unless deployment requirements explicitly change. An in-memory per-session lock cannot enforce exclusion across unknown overlapping instances. Retaining a startup executor sentinel/handoff is compatible with reducing per-turn fencing only if that single-process invariant is actually enforced.

## 10. Sidebar and user-visible state semantics

Current behavior:

- New Chat is local until submission.
- The user bubble is optimistic; the sidebar is not.
- Completed text triggers session reconciliation ([use-chat.ts:149](D:/Peter/ECG/Aurvin/frontend/src/features/chat/state/use-chat.ts:149), `:396`). A known session is deferred to idle; a new session causes an immediate list request.
- A list request can issue three database queries ([sessions.ts:110](D:/Peter/ECG/Aurvin/backend/src/persistence/sessions.ts:110)).
- Session selection asks for message history. HTTP validates the session first, then pages messages ([backend/src/http/chat-http.service.ts:50](D:/Peter/ECG/Aurvin/backend/src/http/chat-http.service.ts:50)); internal voice history adds its acceptance check.

Recommended states:

| State | Meaning/UI |
| --- | --- |
| Draft | No server acceptance or persistent session implied |
| Sending | Optimistic bubble/row; request may still fail |
| Accepted, unsaved | This process owns the input; stable IDs available; crash can lose it |
| Generating / speaking | Output provisional; show useful feedback immediately |
| Answer finished, saving | Model response ended; next input may proceed using in-memory context |
| Saved | Durable watermark covers the input/result; no ordinary success noise needed |
| Save delayed/failed | Preserve visible content and draft; mark unsaved and offer safe save retry/export |
| Interrupted/cancelled | Distinguish model cancellation, transport loss, and heard/unknown voice delivery |

For voice, “generated,” “synthesized,” “played,” and “saved” must stay separate. Unknown hearing must remain unknown. A save failure must not automatically repeat provider inference.

Reconciliation must merge by server IDs/version and durable watermark. A stale list cannot delete an unsaved row, undo a rename/pin, or replace the active transcript. On refresh/restart, explain any recovered draft/unsaved data rather than claiming it had been saved. Cross-tab runtime exclusion remains server-controlled; client hints are only UX.

## 11. Cosmos/Azure constraints

The following are conditional platform facts, not certification of this deployment:

1. **Identify the product first.** Microsoft's [Azure DocumentDB FAQ](https://learn.microsoft.com/azure/documentdb/faq) says Azure DocumentDB was formerly Cosmos DB for MongoDB vCore. That is distinct from Cosmos MongoDB RU and Cosmos NoSQL.
2. **Region matters to each serial round trip.** Microsoft's [MongoDB query troubleshooting guide](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/troubleshoot-query-performance) recommends proximity and examining partition fan-out/throttling. Establish the backend-to-database path; the browser's region alone is insufficient.
3. **Mongo query scope is not a partition guarantee.** Application records use user/session keys; checkpoints use encoded thread_id. Match actual shard keys to all these query shapes. A userId-only partition can become hot; a session partition complicates user-wide sidebar and generation uniqueness. Do not choose either without workload/service facts.
4. **Indexes differ by API.** Cosmos MongoDB 3.6+ indexes _id and shard key automatically, and _id uniqueness is per shard key. Existing compound/partial/unique indexes and checkpointer indexes require service-specific verification. See [MongoDB indexing](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/indexing).
5. **Collection bulkWrite is not a cross-collection transaction.** MongoDB's [Node bulk operations guide](https://www.mongodb.com/docs/drivers/node/current/crud/bulk-write/) distinguishes collection operations from client multi-namespace bulk writes. The latter requires MongoDB server 8.0+ and driver 6.10+. Driver 6.21 alone does not establish server or Cosmos support.
6. **Cosmos NoSQL TransactionalBatch has its own boundary.** Standard batches are within one container and logical partition, with request/operation limits. The current six-collection Mongo adapter cannot simply invoke that facility. See [transactional batches](https://learn.microsoft.com/en-us/azure/cosmos-db/transactional-batch). Newer preview distributed-transaction facilities are separately API/SDK/capability dependent; they do not establish support for this Node Mongo driver.
7. **MongoDB RU transaction/document limits are specific.** The [MongoDB 4.2 feature matrix](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/feature-support-42) limits its documented multi-document transactions to a nonsharded collection and describes optional 16-MB support for collections created after capability enablement. Do not assume universal 16 MB, cross-shard transactions, or native checkpointer compatibility.
8. **Retry modes change latency and constraints.** The [MongoDB 5.0 feature matrix](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/feature-support-50#retryable-writes) documents capability-dependent retryable writes and bulk restrictions. Current code disables driver retryWrites ([persistence.ts:134](D:/Peter/ECG/Aurvin/backend/src/persistence/persistence.ts:134)); do not flip it as a generic fix. Server-side retry/throttling can still produce long tails.
9. **Bulk reduces round trips, not necessarily charged operations.** Measure RU charge, partition distribution, retries, payload bytes, and write amplification as well as API-call count.
10. **Keep connections warm.** The current composition uses one shared Mongo client with command monitoring ([persistence.ts:131](D:/Peter/ECG/Aurvin/backend/src/persistence/persistence.ts:131)). Do not add a new client per turn or enlarge its pool before observing pool wait.

Provider/SFU regions matter too. Current voice configuration only permits US/EU Deepgram base URLs ([voice-config.ts:99](D:/Peter/ECG/Aurvin/backend/src/platform/config/voice-config.ts:99)). Deepgram's [latency guidance](https://developers.deepgram.com/docs/text-to-speech-latency) now discusses additional regional endpoints, but adding a region requires model/API availability and data-policy verification. Do not infer an India endpoint choice merely from this workstation's timezone.

## 12. Metrics overhead versus persistence

### Existing measurements worth retaining

- Native driver monitoring: [backend/src/persistence/database-observation.ts:36](D:/Peter/ECG/Aurvin/backend/src/persistence/database-observation.ts:36); enabled at client creation.
- Sanitized counts by command, collection, origin, phase, failure; pool checkout wait.
- Bounded in-flight map (4096 entries), expiry pruning, and dropped-observation counters.
- Telemetry per-request/turn state, database busy/overlap intervals, and at most 128 command details: `operations/telemetry.ts:124`, `:192`.
- Ownership queue timing and repository/checkpointer timing: `operations/observe-persistence.ts:56`.
- Event-loop delay via Node perf_hooks, with 20 ms sampling resolution: [telemetry.ts:130](D:/Peter/ECG/Aurvin/backend/src/operations/telemetry.ts:130).
- Per-dispatch StreamTiming milestones before generation-ID persistence: `benchmark/stream-timing.ts:17`.
- Voice EOT/model/TTS/playback/settlement milestones: `voice/usage/voice-usage.service.ts:148`.
- Nearest-rank summary logic and explicit unavailable voice fields: `benchmark/report.ts`, `benchmark/voice-measurements.ts:71`.

Recording these counters is primarily in-process work; it does not itself issue a database command. Persistent accounting/delivery is the database work described earlier. Do not conflate them.

### CPU/allocation work that should be profiled

- Log event construction hashes IDs, constructs summaries, redacts, and JSON-serializes before the stdout sink filters normal messages ([telemetry.ts:274](D:/Peter/ECG/Aurvin/backend/src/operations/telemetry.ts:274), `:325`, `:343`). Disabling stdout alone does not eliminate construction cost.
- Voice pipeline events also hash/serialize before the sink ([voice-usage.service.ts:161](D:/Peter/ECG/Aurvin/backend/src/voice/usage/voice-usage.service.ts:161)).
- Confirmed receipts structured-clone twice, deep-freeze, and BSON clone the encoded record (`persistence/confirmed-record.ts:63`).
- Cache insertion JSON-serializes retained state to enforce byte limits ([confirmed-state-cache.ts:78](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/confirmed-state-cache.ts:78); [admission-receipt.ts:121](D:/Peter/ECG/Aurvin/backend/src/chat-runtime/admission-receipt.ts:121)).
- Repeated full VoiceDelivery snapshots validate accumulated text. Total validation/serialization can grow with response length and snapshot frequency even though individual records are bounded.
- Context assembly/token estimation and repeated graph/result schema checks traverse bounded history; [context-budget.ts:95](D:/Peter/ECG/Aurvin/backend/src/context/context-budget.ts:95) serializes messages as a conservative estimate.
- SSE data passes schema/bounds at several layers before JSON transmission; media conversion copies PCM and creates frames. These protect trust boundaries and cannot simply be deleted.
- Frontend already coalesces deltas to rendering frames with timeout fallback ([stream-delta-coalescer.ts:43](D:/Peter/ECG/Aurvin/frontend/src/features/chat/state/stream-delta-coalescer.ts:43)). Streaming Markdown still changes as output grows; profile render/parse cost with production builds.

Measure CPU time, allocation/GC, event-loop delay/utilization, and stage duration with three controlled fixture modes: full diagnostics, counters-only diagnostics, and a no-op diagnostics sink. Account for serialization that occurs before the sink. Use representative long output and overlapping voice traffic.

Node's [performance APIs](https://nodejs.org/api/perf_hooks.html) provide the existing measurements. React's [memo guidance](https://react.dev/reference/react/memo) recommends profiling actual render cost before adding comparison machinery. Do not assume these CPU costs exceed remote persistence latency; no profile was run.

## 13. Latency measurement plan

### Boundaries

Measure per attempt/dispatch with monotonic clocks within each process/browser. Correlate IDs without transcripts, credentials, or raw audio logs. Do not subtract unrelated browser/server performance.now values; use one-clock spans or an explicit clock-offset/trace method with uncertainty.

| Metric | Start | End |
| --- | --- | --- |
| Submit-to-accept | Browser send / server ingress, reported separately | Acceptance response |
| Submit-to-dispatch | Server ingress | Actual provider fetch invocation |
| Browser TTFT | Browser submit | First nonempty assistant text rendered |
| Provider TTFT | Actual model fetch | First provider text delta before application persistence |
| Application delivery overhead | First provider text parsed | Browser visible output, using correlated spans |
| Voice setup | User activation | Input listening acknowledgment |
| Speech-end-to-EOT | Known input speech end | Flux EndOfTurn received |
| EOT-to-dispatch | EndOfTurn received | Actual model fetch |
| EOT-to-first Speak | EndOfTurn | First text submitted to TTS |
| EOT-to-first PCM | EndOfTurn | Backend first nonempty provider PCM |
| First decoded browser audio | EndOfTurn or calibrated speech end | First response-bound nonzero decoded audio |
| First audible audio | Known speech end / calibrated EOT span | Actual output onset at device/loopback observation |
| Next-turn readiness | Model end or audible end, both variants | Next input can actually dispatch without persistence wait |
| Barge-in-to-silence | Local action and ASR StartOfTurn, separately | Local/device output silence |
| Save lag | In-memory answer version committed | Durable watermark reaches that version |

“Next-turn readiness” needs a probe that submits the next turn immediately at the defined readiness boundary. A visually enabled composer is insufficient.

### Current metric traps

- [openrouter-adapter.ts:166](D:/Peter/ECG/Aurvin/backend/src/model/openrouter-adapter.ts:166) starts dispatchClock and records dispatchedAt before text's awaited accounting save. Those fields include pre-fetch persistence.
- Its first-output timing occurs after generation capture/identity barriers. `StreamTiming.frame` runs earlier ([openrouter-adapter.ts:206](D:/Peter/ECG/Aurvin/backend/src/model/openrouter-adapter.ts:206)) and offers the better per-dispatch wire boundary.
- ProviderEndedAt/providerDuration are assigned after pending identity waits ([openrouter-adapter.ts:255](D:/Peter/ECG/Aurvin/backend/src/model/openrouter-adapter.ts:255)); use wire stream-end for provider time and preserve finalization time separately.
- Duplicate diagnostic stage names can exist with different scopes. Prefer matching attempt plus dispatchId, not first matching stage globally.
- [observed-runtime.ts:114](D:/Peter/ECG/Aurvin/backend/src/operations/observed-runtime.ts:114) first_output starts at execution/attachment, excluding POST admission and the browser's second request.
- “terminal-delivered” in that wrapper is an internal callback boundary; text transport buffers terminal frames until reservation release.
- Model output cadence observed by an awaited application iterator may include backpressure/persistence time. Separate provider frame timing from client paint/audio onset.
- Telemetry's five broad latency buckets cannot produce precise p50/p95. Export bounded samples/appropriate histogram data and use the benchmark summarizer.
- Database operation sums double-count overlap. Busy-time union is better but is still not proof of critical-path blocking.
- Repository counters do not include all saver/control traffic; driver wire counts are the correct complete command view. Do not add repository and wire counts together.

### Required scenario matrix

Record p50 and p95 separately for:

- Process cold startup, first new session, first turn in an existing cold session.
- Same-process warm turns and after cache TTL/eviction.
- Short, medium, and near-bound current-session histories; plain, voice-containing, and retained calendar content.
- Plain text with calendar disabled; ordinary text with calendar connected; one calendar read; one create; clarification/reply; ambiguous create readback.
- Live call setup; first utterance; multiple follow-ups in the **same** call; quiet-suspension wake; barge-in during generation and playback.
- Dictation first partial, final transcript, and composer unlock.
- One session and bounded concurrent sessions; a slow persistence writer while audio is active.
- Provider delay/rejection, database slowdown/outage, stream disconnect, save failure, stale responses, and restart with unsaved state.

Use deterministic provider/storage fixtures first. Existing dependency-wave/native-command fixtures can prove call elimination and locking behavior without provider spend. Later, only with explicit service/cost authorization, collect isolated database and bounded live voice/provider evidence on the actual admitted deployment.

For reporting: record revision, dirty tree, runtime/dependency versions, host/service regions, API/tier/capabilities, scenario counts, warmups, success/failure/timeout/unsaved counts, queue depth, and metric boundary. Keep unsuccessful samples visible; latency percentiles for successful samples alone can hide regressions. Do not add p50 stage values to estimate end-to-end p50.

Current WebRTC benchmark deliberately leaves audible/playback-proof metrics unavailable ([backend/src/benchmark/webrtc-voice.ts:70](D:/Peter/ECG/Aurvin/backend/src/benchmark/webrtc-voice.ts:70)). Its decoded first-audio boundary is not comparable to legacy WebSocket first-byte receipt. Keep that distinction; use browser/device or loopback instrumentation for audible onset. Small-sample p95 is exploratory, not a reliable tail guarantee.

## 14. Proposed budgets, not current measurements

These targets describe the desired architecture and must be validated on the chosen service. “Call” and “wire command” are intentionally not interchangeable.

| Scenario/boundary | Proposed target |
| --- | --- |
| New plain session to model dispatch | 0 awaited database reads/writes; memory admission after validation |
| Warm plain text or warm live utterance to model dispatch | 0 awaited database reads/writes |
| Cold existing plain session hydration | At most 3 logical bounded reads: session, manifest, selected messages |
| Cold mixed/voice history | At most one additional batch read for settled delivery evidence |
| First model delta to UI/TTS | 0 awaited database operations |
| PCM input/output and playback progress | 0 database operations per frame/report |
| Normal complete voice response | One consolidated delivery persistence operation in background, excluding socket ledger and exceptional snapshots |
| Plain turn persistence using existing four application collections | Target 4 collection-level calls per flush; optional checkpoints/ambiguity recovery counted separately |
| Normal sidebar after local accepted/completed turn | 0 compulsory list fetches; background reconcile on explicit freshness/idle policy |
| Healthy next turn after output/heard state is ready | 0 waits for the prior turn's background persistence queue |
| Calendar external mutation | Explicit durable intent/dispatch barrier retained; budget based on verified operation requirements |

Do not set numerical p50/p95 latency promises before collecting the baseline. Agree separate targets for server dispatch overhead, browser render, ASR EOT, first audible audio, and next-turn readiness once topology and provider contribution are known.

## 15. Risks and scope boundaries

- Single-process authority must be enforced; unknown multi-instance deployment invalidates zero-DB coordination assumptions.
- Crash-loss acceptance does not provide exactly-once provider billing. Before the first durable receipt, retry after a process crash can repeat inference.
- Keep stable keys, explicit attempt linkage, and save-only retries. Never repair a save failure by silently regenerating an answer.
- In-memory queue loss, cache eviction, shutdown, and browser refresh need bounded, honest behavior. Optional browser draft/receipt persistence or a local journal can reduce losses; the recovery researcher should select the workaround and its data/privacy/deployment assumptions.
- Browser storage survives some failures, not all; it must not become trusted identity/context. Local disk durability is unknown on the backend deployment.
- Older background writes must not regress newer context/session versions or resurrect deleted/redacted content.
- Keep current server identity/provider user attribution, safe Markdown, trust-boundary validation, cancellation epochs, finite budgets, and data retention.
- Provider/SFU jitter, ASR end detection, model prefill/generation, browser gesture/permission, audio device buffering, and network distance remain after database removal.
- Do not add compaction, retrieval/embeddings, raw audio archives, new tools, a second runtime owner, a new queue service, or a voice model picker as incidental latency work.
- Do not certify Cosmos support or provision/move services from this report.
- Existing integrated verification/review state is not advanced. Tests and unified review were not run; no passing check or performance result is claimed.

## 16. Suggested verification for a later authorized implementation

Reuse the existing package Vitest infrastructure and fixtures. The most useful checks are:

1. An instrumented warm text/live utterance dispatches with a blocked persistence writer and no pre-dispatch database command.
2. A follow-up uses the previous unsaved answer/heard projection in correct order, exactly once.
3. Background publication is monotonic and idempotent under before/after-write ambiguity, retries, stale versions, deletion, and restart.
4. Two tabs cannot infer concurrently in the same session; unrelated sessions do not wait behind unnecessary global storage phases.
5. First text and first audio are independent of accounting/delivery save delay; queues remain finite.
6. Barge-in silences output promptly, rejects late audio, preserves unknown hearing, and admits the next utterance after the correct media boundary.
7. Sidebar shows the accepted session immediately and survives stale reconciliation without losing pins, renames, pending rows, or pagination.
8. Calendar intent/authority, explicit acceptance, deterministic event IDs, and ambiguous-outcome readback remain valid.
9. Bounded checkpoint facade preserves isolation/size limits and stock-saver behavior.
10. Native-command accounting includes checkpoint/control operations and reports unavailable measurements honestly.

Run focused checks and required package suites at implementation time. Native/service tests still require safe isolated operator-provided prerequisites and explicit authorization; source/test existence alone is not verification.

