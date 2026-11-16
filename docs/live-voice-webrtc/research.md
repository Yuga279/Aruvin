# Live voice over WebRTC — technical research

**Date:** 5 November 2026 | **Baseline HEAD:** `a78f23a` (`Improve live voice responsiveness`) | **Scope:** Replace browser-facing live voice WebSocket PCM transport with LiveKit/WebRTC while keeping dictation, Deepgram Flux STT/TTS, LangGraph runtime, durable turns, identity, and accounting intact.

---

## 1. Media Bridge vs. Scoped LiveKit Agents Integration

### Recommendation
**Adopt a thin in-process LiveKit Media Bridge** (`@livekit/rtc-node` + `livekit-server-sdk` on the backend, `livekit-client` on the frontend) that implements `VoiceSink` (`backend/src/voice/session/voice-session.options.ts:38-46`) and feeds `LiveFlow` (`backend/src/voice/session/live-flow.ts:46-724`) directly. **Reject `@livekit/agents`.**

### Justification & Concrete Integration Points
1. **Preserves the single LangGraph runtime and single-executor invariant:**
   - Aurvin enforces one active executor and one session lease per live voice session via `ExecutionReservation` in `VoiceSessionService.create` (`backend/src/voice/session/voice-session.service.ts:193-194`) and `AppService.openVoice` (`backend/src/app.service.ts:813-857`), routing accepted voice turns through `AgentVoiceAdapter` (`backend/src/voice/agent/agent-voice-adapter.ts:52-299`) into `DurableChatRuntime` (`submitLiveTurn`, `executeTurn`, `cancelLiveTurn`, `reconcileSession` at `backend/src/app.service.ts:665-683`).
   - `@livekit/agents` (`1.9.5`) is designed around standalone multi-process job workers (`cli.runApp`, child process pools, job dispatchers) and its own `AgentSession` / `VoicePipelineAgent` state machine with competing turn detection, VAD, and LLM/TTS loops ([LiveKit Agents Node.js docs](https://docs.livekit.io/agents/build/)). Adopting it would introduce a second turn orchestrator competing with `LiveFlow` (`backend/src/voice/session/live-flow.ts:493-544`) and `VoiceDelivery` (`backend/src/voice/agent/voice-delivery.ts:35-379`), or require bypassing 90% of `@livekit/agents` while still paying for its transitive dependency tree (`@opentelemetry/*`, `sharp`, `fluent-ffmpeg`, `blingfire`).
2. **Smallest working diff on the Ponytail ladder:**
   - `LiveFlow` (`backend/src/voice/session/live-flow.ts:94-118`) already abstracts transport behind `VoiceSink` (`send`, `audio`, `invalidate`, `close` in `backend/src/voice/session/voice-session.options.ts:38-46`) and accepts inbound 16 kHz PCM frames via `input(pcm: Uint8Array)` (`live-flow.ts:202-210`) and JSON control via `control(event: VoiceClientEvent)` (`live-flow.ts:127-200`).
   - A dedicated `LiveKitMediaBridge` (`backend/src/voice/transport/livekit-media.ts`) joins the admitted LiveKit room as the single server participant (`aurvin-agent:${sessionId}`), subscribes to the browser participant's audio track via `@livekit/rtc-node` `AudioStream`, publishes TTS audio via `@livekit/rtc-node` `AudioSource` + `LocalAudioTrack`, and exchanges `VoiceClientEvent` / `VoiceServerEvent` over reliable data packets (`DataPacket_Kind.RELIABLE`), leaving `LiveFlow`, `AgentVoiceAdapter`, `VoiceDelivery`, `FluxSttAdapter`, `FluxTtsAdapter`, `VoiceUsageService`, and `VoiceAccounting` authoritative.

---

## 2. Minimal Dependency Set, Versions, and Platform Constraints

### Recommendation
Add **only three packages** across the workspace:

| Package | Workspace | Recommended Spec | Verified Latest | Node Engine Requirement | Native / Build Constraints |
| --- | --- | --- | --- | --- | --- |
| `livekit-server-sdk` | `backend/package.json` | `^2.19.2` | `2.19.2` | `>=19` | Pure JS/TS (`jose@^5.1.2`, `@livekit/protocol@1.51.0`, `@bufbuild/protobuf@^1.10.1`, `ws@^8.17.1`). Zero native bindings. |
| `@livekit/rtc-node` | `backend/package.json` | `^1.2.1` | `1.2.1` | `>= 18` | Uses `@livekit/rtc-ffi-bindings@0.13.1` with prebuilt Rust FFI binaries via `optionalDependencies`, including `@livekit/rtc-ffi-bindings-win32-x64-msvc@0.13.1`, `linux-x64-gnu`, `linux-arm64-gnu`, `darwin-x64`, `darwin-arm64`. No local Rust/C++ toolchain required on Windows x64. |
| `livekit-client` | `frontend/package.json` | `^2.23.0` | `2.23.0` | Browser ES2022+ | Pure browser WebRTC SDK (`events`, `loglevel`, `tslib`, `webrtc-adapter`, `@livekit/protocol@1.49.1`). |

### Repository & Guard Compatibility
- Both `backend/package.json:8-10` and `frontend/package.json:6-8` enforce `"node": "^22.22.3 || ^24.15.0 || >=26.0.0"` (current local runtime: Node `v24.18.0` on `win32` x64). All three packages satisfy this range.
- **Explicit exclusions:** Do not install `@livekit/agents`, `@livekit/components-react` (Aurvin's voice UI already exists in `frontend/src/features/voice/live/`), or `@deepgram/sdk` (explicitly forbidden by `backend/src/platform/voice-dependencies.spec.ts:40`).
- Update `backend/src/platform/voice-dependencies.spec.ts:24-45` in P1 to assert the presence of `livekit-server-sdk` and `@livekit/rtc-node` in `backend/package.json`, `livekit-client` in `frontend/package.json`, and the continued absence of `@deepgram/sdk` and `@livekit/agents`.
- Primary docs: [LiveKit Node.js SDK (`@livekit/rtc-node`)](https://docs.livekit.io/reference/other/node/), [LiveKit Server SDK (`livekit-server-sdk`)](https://docs.livekit.io/reference/server-sdk-js/), [LiveKit JS Client SDK (`livekit-client`)](https://docs.livekit.io/reference/client-sdk-js/).

---

## 3. Existing Live Voice Path End-to-End & Callers That Must Change

### Current End-to-End Flow
1. **Public Voice Config & Capabilities:**
   - `VoiceSessionController.config` (`backend/src/voice/session/voice-session.controller.ts:47-53`) calls `VoiceSessionService.config` (`backend/src/voice/session/voice-session.service.ts:60-69`) → `publicVoiceConfig` (`backend/src/platform/config/voice-config.ts:94-97`).
   - Consumed by `VoiceHttpClient.config` (`frontend/src/api/voice-client.ts:61-65`) and `voiceCapabilities` (`frontend/src/features/voice/state/voice-capabilities.ts:23-60`), which gates live voice on `navigator.mediaDevices.getUserMedia`, `AudioContext`, `AudioWorkletNode`, and `WebSocket`.
2. **Session Admission:**
   - `POST /api/voice/sessions` (`backend/src/voice/session/voice-session.controller.ts:55-64`) invokes `VoiceSessionService.create` (`backend/src/voice/session/voice-session.service.ts:107-211`).
   - Enforces origin check (`voice-session.options.ts:104-106`), resolves identity (`this.options.identity.resolve()` at `voice-session.service.ts:111`), deduplicates by `(userId, idempotencyKey)` (`voice-session.service.ts:127-159`), checks quota admission via `VoiceUsageService.admission` (`backend/src/voice/usage/voice-usage.service.ts:189-215`), acquires `ExecutionReservation` for `live` mode (`voice-session.service.ts:193-194`), mints an HMAC cookie ticket `aurvin_voice_ticket` (`voice-session.service.ts:84-105`), and returns `CreateVoiceSessionResponse` (`backend/src/contracts/voice-wire.ts:94-98`).
3. **Transport & Gateway:**
   - `VoiceGateway.handleConnection` (`backend/src/voice/transport/voice.gateway.ts:37-65`) upgrades `/api/voice`, claims the cookie ticket via `VoiceSessionService.claim` (`voice-session.service.ts:213-230`), and creates `VoiceConnection` (`backend/src/voice/transport/voice-connection.ts:35-363`).
   - On `session.start` (`voice-connection.ts:186-212`), `VoiceConnection` invokes `sessions.options.open` → `AppService.openVoice` (`backend/src/app.service.ts:813-857`).
4. **Live Flow, Providers, Delivery & Accounting:**
   - `AppService.openVoice` constructs `VoiceAccounting` (`backend/src/voice/usage/voice-accounting.ts:30-92`), `AgentVoiceAdapter` (`backend/src/voice/agent/agent-voice-adapter.ts:52-299`), and `LiveFlow.open` (`backend/src/voice/session/live-flow.ts:94-118`) using `FluxSttAdapter` (`backend/src/voice/providers/flux-stt.ts:32-145`) and `FluxTtsAdapter` (`backend/src/voice/providers/flux-tts.ts:34-208`).
   - `AgentVoiceAdapter` persists the accepted user turn via `runtime.submitLiveTurn` before model execution, streams tokens through `VoiceDelivery` (`backend/src/voice/agent/voice-delivery.ts:35-379`), and reconciles durable generated vs. spoken completion via `runtime.reconcileSession`.
5. **Frontend Live Voice & Dictation:**
   - `useLiveVoice` (`frontend/src/features/voice/state/useLiveVoice.ts:36-71`) instantiates `LiveVoiceController` (`frontend/src/features/voice/state/live-voice-controller.ts:114-790`), which orchestrates `VoiceHttpClient`, `VoiceClient` (`frontend/src/api/voice-client.ts:98-378`), `AudioCaptureService` (`frontend/src/features/voice/audio/audio-capture-service.ts:36-196`), and `AudioPlaybackService` (`frontend/src/features/voice/audio/audio-playback-service.ts:32-208`).
   - Dictation uses `DictationController` (`frontend/src/features/voice/dictation/dictation-controller.ts:50-387`) with `VoiceHttpClient`, `VoiceClient`, and `AudioCaptureService`.

### Exact Ports / Callers That Must Change by Owner (`state.md`)
- **P1 (Contracts, Config & Dependencies):**
  - `backend/src/contracts/voice-wire.ts:75-98` & `frontend/src/api/voice-protocol.ts:71-95`: Extend `CreateVoiceSessionResponse` (and `isCreateVoiceSessionResponse` at `voice-protocol.ts:242-259`) with LiveKit transport metadata for `live` mode (`livekit?: { url: string; roomName: string; participantIdentity: string; participantToken: string }`) while keeping `websocketUrl: '/api/voice'` for `dictation`.
  - `backend/src/contracts/config-runtime.ts:54-62`, `backend/src/platform/config/voice-config.ts:51-97`, `backend/src/platform/config/bootstrap-config.ts:81-97`, `backend/src/platform/config/manageable-config.ts`: Add LiveKit server config (`url`, `apiKey`, `apiSecret`) to `VoiceConfig` and gate `liveEnabled` on both Deepgram key presence and valid LiveKit configuration (`dictationEnabled` continues requiring only Deepgram).
  - `backend/src/platform/security/redact.ts:20-23`: Extend `SECRET_KEY` and `SECRET_VALUE` to redact `participantToken` / `livekit` tokens and compact JWT strings (`eyJ...`).
  - `backend/package.json`, `frontend/package.json`, lockfiles, and `backend/src/platform/voice-dependencies.spec.ts`.
- **P2 (Session Admission & Scoped LiveKit Access):**
  - New `backend/src/voice/session/livekit-admission.ts`: Mint room/participant-scoped JWTs (`AccessToken`) and execute server-side participant/room teardown (`RoomServiceClient.removeParticipant` / `deleteRoom`).
  - `backend/src/voice/session/voice-session.service.ts:107-366`, `voice-session.controller.ts:55-90`, `voice-session.options.ts:57-97`: Attach `livekit` credentials on `mode === 'live'` admission/reconnect, skip or decouple the WebSocket-only cookie ticket requirement for live WebRTC sessions, and trigger LiveKit room/bridge teardown on `end`, `stop`, `disconnected`, `sweep`, and `drain`.
- **P3 (Backend LiveKit Media Bridge & Live Flow Adaptation):**
  - New `backend/src/voice/transport/livekit-media.ts`: Implement `VoiceSink` + `@livekit/rtc-node` `Room` participant, inbound `AudioStream` (16 kHz mono 80 ms / 2560 B frames → `LiveFlow.input`), outbound `AudioSource` (24 kHz mono → `LocalAudioTrack`), `audioSource.clearQueue()` on `invalidate`, and reliable data channel control framing.
  - `backend/src/voice/session/live-flow.ts:106-118,389-397,453-491,599-628` & `backend/src/voice/agent/voice-delivery.ts:318-378`: Preserve `playback.progress` flow control and durable delivery settlement over WebRTC.
  - **Unchanged in P3:** `flux-stt.ts`, `flux-tts.ts`, `nova-stt.ts`, `dictation-flow.ts`, `agent-voice-adapter.ts`.
- **P4 (Frontend Live WebRTC Client & Controller Cutover):**
  - `frontend/src/api/voice-client.ts` (add `LiveKitVoiceClient` or WebRTC live transport alongside `VoiceClient`), `frontend/src/features/voice/state/live-voice-controller.ts:173-774`, `frontend/src/features/voice/state/voice-capabilities.ts:23-60` (require `RTCPeerConnection` for live voice instead of requiring `AudioWorkletNode` when WebRTC native track capture is used), `frontend/src/features/voice/state/testing/live-voice-fixture.ts`.
  - **Unchanged in P4:** `frontend/src/features/voice/dictation/dictation-controller.ts`.
- **P5 (App Wiring, Cutover & Legacy Live WebSocket Removal):**
  - `backend/src/app.service.ts:212-235,813-857`, `backend/src/voice/transport/voice.gateway.ts:37-65`, `backend/src/voice/transport/voice-connection.ts:144-169`, `backend/src/operations/readiness.ts`: Wire `LiveKitAdmission` and `LiveKitMediaBridge` in `AppService`; reject `live` mode binary audio on `/api/voice` WebSocket so `/api/voice` serves `dictation` only; drain active LiveKit bridges on shutdown.
- **P6 (Benchmark Harness WebRTC Extension):**
  - `backend/src/benchmark/{runner.ts,voice-runner.ts,cli.ts,live-baseline.ts,live-budget.ts}`: Add headless `@livekit/rtc-node` participant mode to `runVoice`.

---

## 4. Audio Format, Codec, Sample-Rate Conversion & Buffering Boundaries

### End-to-End Audio Pipeline

| Boundary | Format / Codec / Rate | Frame / Buffer Size | Owner & Conversion Mechanism |
| --- | --- | --- | --- |
| **Browser Mic → LiveKit SFU** | WebRTC Opus (48 kHz internal clock, 1 ch mono, `echoCancellation`, `noiseSuppression`, `autoGainControl`) | 20 ms RTP Opus packets | `livekit-client` (`Room.localParticipant.publishTrack` / `setMicrophoneEnabled`). Browser native WebRTC engine handles capture, AEC/NS/AGC, and Opus encoding. |
| **LiveKit SFU → Backend Bridge** | WebRTC Opus → `@livekit/rtc-node` `AudioStream` resampled to **16,000 Hz, 1 ch, `pcm16` (`Int16Array`)** | **80 ms** (`1,280 samples` = `2,560 bytes`) | `new AudioStream(remoteTrack, { sampleRate: 16000, numChannels: 1, frameSizeMs: 80 })` in `livekit-media.ts`. A 2,560-byte ring accumulator guarantees exact `INPUT_AUDIO.chunkBytes` (`backend/src/contracts/voice-audio.ts:29-39`) before calling `LiveFlow.input(pcm)` (`live-flow.ts:202-210`). |
| **Backend Bridge → Deepgram Flux STT** | `linear16`, 16,000 Hz, 1 ch | Exact 2,560 B binary WebSocket messages | `FluxSttAdapter.writeAudio` (`backend/src/voice/providers/flux-stt.ts:107-118`). **Zero changes required.** |
| **Deepgram Flux TTS → Backend Bridge** | `linear16`, **24,000 Hz, 1 ch, `pcm16`** | Up to 200 ms (`4,800 samples` = `9,600 bytes`) per chunk (`OUTPUT_AUDIO.maxChunkBytes` in `voice-audio.ts:41-52`) | `FluxTtsAdapter` (`backend/src/voice/providers/flux-tts.ts:144`) emits `Uint8Array` → `LiveFlow.readTts` (`live-flow.ts:599-628`) → `sink.audio(pcm)`. |
| **Backend Bridge → LiveKit SFU** | `AudioSource(24000, 1, queueSizeMs)` → resampled by native WebRTC FFI to 48 kHz Opus RTP | Queued as `AudioFrame(int16, 24000, 1, samples)`; bounded by `limits.outputQueueMs` (2,000 ms) | `livekit-media.ts` converts incoming even-byte `Uint8Array` into a copied/aligned `Int16Array` and calls `await audioSource.captureFrame(frame)`. |
| **LiveKit SFU → Browser Playback** | WebRTC Opus → browser WebRTC jitter buffer + PLC → `RemoteAudioTrack` | Adaptive WebRTC jitter buffer | `livekit-client` `RoomEvent.TrackSubscribed` attaches `RemoteAudioTrack` to an `HTMLAudioElement` unlocked via `room.startAudio()`. |

### Critical Boundary Decisions
1. **Single Microphone Capture & 5-Second Quiet Gate (`CaptureGate`):**
   - P4 requires **one mic capture** in live mode (`state.md:72`). Calling both `AudioCaptureService.start()` and `livekit-client`'s `createLocalAudioTrack()` would call `getUserMedia` twice.
   - **Recommended design:** Move the 5-second non-speech upload gate (`CaptureGate` in `frontend/src/features/voice/audio/audio-capture-gate.ts:29-88`, peak threshold `600 / 32768`, hangover `5000 ms`) into `livekit-media.ts` on the backend inbound `AudioStream` (or share the exact pure `CaptureGate` logic in `backend/src/contracts/voice-audio.ts`).
   - **Why backend gating wins on the Ponytail ladder:**
     - The browser only opens **one** native WebRTC `LocalAudioTrack` (`createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 })`) with zero `AudioWorklet` / JS main-thread PCM marshaling overhead.
     - Browser-to-LiveKit WebRTC audio is flat-rate/unmetered per byte, whereas backend-to-Deepgram Flux STT (`wss://api.deepgram.com/v2/listen`) is paid per audio second (`VoiceAccounting.recordStt(pcm.byteLength)` at `live-flow.ts:209`). Gating in `livekit-media.ts` before `LiveFlow.input(pcm)` invokes `LiveFlow.suspendInput('quiet')` (`live-flow.ts:328-334`) after 5 s of silence and automatically resumes on speech onset (`peak >= 600`), preserving the exact Deepgram cost/quota savings and UI `paused` state (`live-flow.ts:568-571`).
2. **Buffer Alignment Safety Across FFI:**
   - `FluxTtsAdapter` (`flux-tts.ts:144`) emits `new Uint8Array(data.buffer, data.byteOffset, data.byteLength)` from `ws`, where `byteOffset` is not guaranteed to be 2-byte aligned. Before constructing `new Int16Array` for `@livekit/rtc-node` `AudioFrame`, `livekit-media.ts` must copy misaligned buffers (or copy into a reusable aligned scratch buffer) to avoid `RangeError: start offset of Int16Array should be a multiple of 2`.
3. **PCM Helpers Reused vs. Untouched:**
   - `frontend/src/features/voice/audio/{audio-capture-service.ts,audio-capture-processor.ts,audio-capture-gate.ts,pcm-resampler.ts}` and `frontend/src/api/voice-audio.ts` remain **100% untouched** and continue serving `DictationController` (`frontend/src/features/voice/dictation/dictation-controller.ts`).
   - `frontend/src/features/voice/audio/audio-playback-service.ts` remains untouched for existing unit tests; live WebRTC playback uses LiveKit's `RemoteAudioTrack`.

---

## 5. Admission, Scoped LiveKit Access, Rejoin & Revocation

### Token & Room Scoping Model
1. **Server-Side Identity & Room Binding:**
   - `VoiceSessionService.create` (`backend/src/voice/session/voice-session.service.ts:111`) resolves `identity = this.options.identity.resolve()` (`aurvin-dev-user`).
   - Each admitted live session (`sessionId = randomUUID()`) maps 1:1 to a unique LiveKit room name: `aurvin-live-${sessionId}`.
   - Browser participant identity is bound to user, session, and epoch: `${identity.userId}:${sessionId}:${connectionEpoch}`.
   - Backend bridge participant identity is `aurvin-agent:${sessionId}`.
2. **Least-Privilege JWT Grants (`livekit-server-sdk` `AccessToken`):**
   - Browser token minted by `LiveKitAdmission` (`backend/src/voice/session/livekit-admission.ts`):
     - `ttl`: `Math.ceil(Math.min(30_000, limits.connectMs) / 1000) + 's'` (e.g., `15s`–`30s`, bounding initial join window to `limits.connectMs`).
     - `VideoGrant`: `{ roomJoin: true, room: 'aurvin-live-' + sessionId, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: [TrackSource.MICROPHONE], roomCreate: false, roomAdmin: false, roomList: false, roomRecord: false }`.
   - Backend media bridge token (never leaves the server):
     - `{ roomCreate: true, roomJoin: true, room: 'aurvin-live-' + sessionId, canPublish: true, canSubscribe: true, canPublishData: true }`.
3. **Reconnect / Rejoin (`connectionEpoch`):**
   - When the browser reconnects within `limits.reconnectGraceMs` (`15,000 ms`) by calling `POST /api/voice/sessions` with the same `idempotencyKey` while `entry.state === 'reconnecting'` (`voice-session.service.ts:138-148`), `VoiceSessionService` increments `connectionEpoch`, mints a fresh browser `participantToken` for `${identity.userId}:${sessionId}:${connectionEpoch}`, and returns the updated `CreateVoiceSessionResponse`.
4. **Revocation & Active Teardown (Token Expiry Alone Does Not Disconnect):**
   - Verified from [LiveKit Authentication Docs](https://docs.livekit.io/home/get-started/authentication/): JWT `exp` only validates the initial connection handshake; an already-joined participant remains in the room after token expiry unless actively removed or the room is deleted.
   - Therefore, on every terminal transition—`DELETE /api/voice/sessions/:id` (`voice-session.service.ts:242-254`), `stop(id, reason)` (`voice-session.service.ts:289-302`), unrecoverable `disconnected(entry, false)` (`voice-session.service.ts:281-287`), `sweep()` expiry (`voice-session.service.ts:340-356`), and `drain()` (`voice-session.service.ts:358-365`)—the backend must:
     1. Close the local `LiveKitMediaBridge` (`room.disconnect()`).
     2. Call `RoomServiceClient.deleteRoom('aurvin-live-' + sessionId)` (or `removeParticipant` on stale epoch eviction) with a bounded timeout (`2,000 ms`) and best-effort error handling so shutdown/drain never hangs if the LiveKit server is unreachable.
5. **Secret & Configuration Ownership:**
   - Configure LiveKit via server environment variables in `bootstrap-config.ts` / `voice-config.ts`: `LIVEKIT_URL` (`ws://` or `wss://`), `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`.
   - Do **not** expose `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET` in `PublicVoiceConfig`, `PublicAdminConfig`, or `VITE_*`. The browser receives only the short-lived `livekit.url`, `livekit.roomName`, `livekit.participantIdentity`, and `livekit.participantToken` inside `CreateVoiceSessionResponse` after passing origin, identity, quota, and session-lease admission.

---

## 6. Live Lifecycle Semantics: Control Ordering, Interruption, Reconnect & Durable Completion

### Recommendation: Unified LiveKit Transport (Audio Tracks + Reliable Data Channel Control)
Use **LiveKit Reliable Data Packets (`DataPacket_Kind.RELIABLE`)** on the same `Room` connection to carry the existing JSON control protocol (`VoiceClientEvent` / `VoiceServerEvent` validated by `parseVoiceControl` in `backend/src/contracts/voice-wire.ts:448-485`).
- **Why this beats running `/api/voice` WebSocket + LiveKit Room in parallel:**
  - Eliminates coordinating two independent sockets, two handshake timers, and two disconnect/reconnect state machines in `LiveVoiceController` and `VoiceSessionService`.
  - LiveKit reliable data packets use WebRTC SCTP reliable/ordered delivery, and Aurvin's `VoiceEnvelope` (`sequence`, `connectionEpoch` fencing in `voice-connection.ts:173-180`) provides application-layer ordering and stale-epoch rejection on top.
  - `/api/voice` WebSocket (`VoiceGateway` + `VoiceConnection`) remains strictly for `dictation` mode.

### Control-Event Ordering & Handshake
1. **Admission:** Browser `POST /api/voice/sessions` (`mode: 'live'`) → backend admits session, reserves `ExecutionReservation`, starts/connects `LiveKitMediaBridge` (`aurvin-agent:${sessionId}`), and returns `CreateVoiceSessionResponse` with `livekit` descriptor.
2. **Join & Start:** Browser connects `Room` (`room.connect(livekit.url, livekit.participantToken)`), unlocks audio (`room.startAudio()`), publishes microphone track, and sends `session.start` (`{ type: 'session.start', sessionId, connectionEpoch, sequence: 1, mode: 'live' }`) via `room.localParticipant.publishData(..., { reliable: true, topic: 'aurvin.voice.control' })`.
3. **Provider Open & Ready:** Backend bridge receives `session.start`, opens `LiveFlow` (`FluxSttAdapter.connect()` + `FluxTtsAdapter.connect()`), and emits `session.ready` followed by `voice.state` (`state: 'listening'`) over reliable data packet.

### Interruption / Barge-In & Queued Audio Flush
- **Single authoritative endpointing/interruption policy:** Keep Deepgram Flux `StartOfTurn` (`backend/src/voice/session/live-flow.ts:503-506`) + explicit client `response.interrupt` (`live-flow.ts:364-369`). Do not add a second client or agent VAD interrupter.
- **Exact flush sequence on interruption:**
  1. When `LiveFlow.interrupt(reason, clientPlaybackMs)` runs (`live-flow.ts:453-491`), it immediately calls `this.options.sink.invalidate({ turnId, responseId })`.
  2. `LiveKitMediaBridge.invalidate()` calls **`audioSource.clearQueue()`** on the `@livekit/rtc-node` `AudioSource` (synchronously discarding all queued/unplayed PCM frames in the native WebRTC send buffer) and sends `response.cancelled` over the reliable data channel.
  3. Browser receives `response.cancelled` (or initiates `response.interrupt` locally), immediately mutes/resets playout tracking for the invalidated `responseId`, and reports monotonic `playbackPositionMs` / `playedSamples`.
  4. `LiveFlow` calls `this.tts.interrupt({ turnId, responseId, playbackPositionMs })` (`flux-tts.ts:183-197`, which increments the TTS generation counter and drops stale Deepgram audio chunks) and `this.options.hooks.interrupt(...)` (`agent-voice-adapter.ts:243-261`, which aborts the LLM stream and calls `runtime.cancelLiveTurn`).

### Playback Progress vs. Durable Completion
- **Invariant (`state.md:67`, `voice-delivery.ts:318-340`):** *Pushing PCM into `AudioSource.captureFrame` is NOT playback confirmation.*
- `LiveFlow` continues to emit `audio.start` (`sampleRate: 24000`) before the first TTS frame and `audio.end` when Deepgram emits `Flushed` (`speech-completed`, `live-flow.ts:524-530`).
- While `audioSource.captureFrame(frame)` queues 24 kHz audio into `@livekit/rtc-node`, `LiveFlow.readTts` (`live-flow.ts:605-622`) continues enforcing the `limits.outputQueueMs` (`2,000 ms`) backpressure window against `this.wirePlayed` (updated by browser `playback.progress` events every `100 ms` from `live-voice-controller.ts:552-569`).
- On the browser, once `audio.start` is received for the active `responseId` and the subscribed `RemoteAudioTrack` is playing, the browser advances played samples at the 24 kHz reference clock (clamped to the total generated samples announced by the backend or elapsed active playout duration) and sends `playback.progress` (`playedSamples`, `playbackPositionMs`).
- `LiveFlow.completePlayback` (`live-flow.ts:389-397`) and `VoiceDelivery.settle` (`voice-delivery.ts:342-378`) mark the turn `completed` (`voice.turn.completed`) **only after** both `speechCompleted === true` and `playedSamples === generatedSamples`. If the WebRTC room disconnects or is interrupted before `playedSamples === generatedSamples`, `VoiceDelivery.proof()` records a bounded prefix (`spokenText < generatedText`) and reconciles the turn as `cancelled` or `interrupted`.

### Failure Codes Mapping
- Existing `VoiceErrorCode` values (`backend/src/contracts/voice-wire.ts:20-34`) cover all required failure modes without adding new wire error codes:
  - Room join / ICE connection timeout or failure → `VOICE_CONNECT_TIMEOUT` (`retryable: true`)
  - Unexpected room disconnect after grace window → `SESSION_EXPIRED` (`retryable: false`)
  - Stale epoch participant or duplicate join → `STALE_CONNECTION` (`retryable: false`)
  - Deepgram STT/TTS failure → `STT_UNAVAILABLE` / `TTS_UNAVAILABLE` (`retryable: true`)

---

## 7. Benchmark Equivalence & Harness Extensions

### Existing Benchmark Assets (`backend/src/benchmark/`, `docs/voice-latency-benchmark/`)
- `backend/src/benchmark/voice-runner.ts:18-151` (`runVoice`) drives `/api/voice` over `ws`, feeds `fixtures/baseline.pcm` (SHA-256 `933c59e38179c0a16df1b26aa1567a8a76ee823c0c0ceaf820feef382412c3a1`, `speechEndMs: 3734.9375`) in 80 ms real-time chunks, measures `setupMs`, `firstAudioMs`, `speechEndToFirstAudioMs`, `speechEndToThinkingMs`, `speechEndToPlaybackEndMs`, and `durableCompletionMs`, and collects server-side `voice-pipeline` telemetry spans (`backend/src/benchmark/runner.ts:241-342`).
- `backend/src/benchmark/live-budget.ts:12-102` and `live-baseline.ts:18-246` enforce hard paid-call caps (`maxSubmissions: 8`, `maxSessionCreations: 8`, `maxAudioFrames: 640`, `maxSpokenChars: 2400`, `maxCostUsd: 1.00`) and preserve the 5 November 2026 baseline in `benchmark-results/ws-live-2026-11-05` (`runId: 9ab4762c-c960-406f-adcf-84d91f265d56`).

### How to Extend for Headless WebRTC (`P6`)
1. **Transport Selection & Metadata (`backend/src/benchmark/runner.ts`):**
   - Add `transport: z.enum(['websocket', 'webrtc']).default('webrtc')` (or derive from `CreateVoiceSessionResponse.livekit`) to `benchmarkConfigSchema` (`runner.ts:17-43`).
   - Record `transport: 'websocket' | 'webrtc'`, `codec: 'pcm16' | 'opus'`, and `sampleRateHz` in `WireResult` / `summary.json` so artifacts self-describe their transport.
2. **Headless WebRTC Client in `runVoice` (`backend/src/benchmark/voice-runner.ts`):**
   - When `CreateVoiceSessionResponse.livekit` is present, instantiate a client-side `@livekit/rtc-node` `Room` in `runVoice`:
     - Connect to `livekit.url` with `livekit.participantToken`.
     - Publish a `LocalAudioTrack` backed by `new AudioSource(16000, 1, 0)` and feed the exact same 80 ms (1,280-sample) slices from `fixture.audio` on the same 80 ms monotonic schedule, recording `speechEndClockMs` on the frame covering `fixture.speechEndMs`.
     - Subscribe to the backend bridge's `RemoteAudioTrack` via `new AudioStream(track, { sampleRate: 24000, numChannels: 1, frameSizeMs: 20 })`.
     - **First-audio timestamp (`firstAudioMs` / `speechEndToFirstAudioMs`):** Because a published WebRTC `AudioSource` transmits continuous RTP Opus packets (including silence while idle), gate `firstAudioMs` on `audio.start` having arrived **and** the first decoded `AudioFrame` from `AudioStream` containing non-zero PCM energy (`peak > 0`), then feed `playback.progress` (`playedSamples`, `playbackPositionMs`) until `generatedSamples` is reached and `voice.turn.completed` arrives.
3. **Baseline Preservation (`backend/src/benchmark/live-baseline.ts`):**
   - Never overwrite `benchmark-results/ws-live-2026-11-05` or `docs/voice-latency-benchmark/websocket-live-baseline-2026-11-05.md`. Write new runs to transport-tagged directories (e.g., `benchmark-results/webrtc-live-<date>`).

### Like-for-Like vs. Non-Equivalent Boundaries & Authorization Gates
- **Directly comparable (like-for-like):**
  - `speechEndToFirstAudioMs` (monotonic client `speechEndClockMs` → first received/decoded assistant audio frame), `setupMs` (`POST /api/voice/sessions` → `session.ready`), `speechEndToThinkingMs`, `speechEndToPlaybackEndMs`, `durableCompletionMs`, and all server-side `voice-pipeline` stages (`stt-connected`, `tts-connected`, `response-prepared`, `model-first-output`, `tts-first-submit`, `tts-first-audio`, `delivery-settled`).
- **Transport boundary difference (must be explicitly documented in P8 reports):**
  - WebSocket `firstAudioMs` measures raw TCP/WS `pcm16` chunk arrival before browser `AudioContext` scheduling.
  - Headless WebRTC `firstAudioMs` measures RTP arrival + native WebRTC jitter buffer + Opus decode into a 24 kHz `AudioFrame`.
- **Requires separate user authorization (P8):**
  - Any live paid provider benchmark run (`OpenRouter` + `Deepgram`) and any real-browser audible onset or network-impairment run require explicit user authorization with a bounded call/cost budget before execution.

---

## 8. Hosting, Placement, TURN Implications & Bounded Cost Sketch

### Placement & Latency Implications
- The live media path is: `Browser ⇄ LiveKit SFU ⇄ Aurvin Backend Bridge ⇄ Deepgram Flux (US) / OpenRouter`.
- **Critical placement rule:** Every millisecond of RTT between the **Aurvin Backend** and the **LiveKit SFU** is added twice per turn (inbound mic RTP to backend + outbound TTS RTP from backend).
  - **Local development & local headless benchmarks (Windows `127.0.0.1`):** Run a local `livekit-server --dev` process (native Windows binary or Docker container on `ws://127.0.0.1:7880`). Loopback RTT is `< 1 ms`, avoiding WAN hair-pinning from a local backend to a remote cloud SFU and back.
  - **Staging / Production:** Co-locate the Aurvin backend and the LiveKit SFU in the **same region (US-East)** near Deepgram's US endpoints (`wss://api.deepgram.com`).

### Firewall, Ports & TURN Requirements (for `P7` Operations Docs)
- Aurvin's `/api` HTTP reverse proxy does **not** carry WebRTC media. The browser connects directly to `livekit.url` (`wss://`) for signaling and to the SFU's media/TURN ports:
  - **Signaling:** TCP `443` (`wss://`) in staging/prod; TCP `7880` (`ws://`) in local dev.
  - **WebRTC Media:** UDP `7882` (single-port UDP mux) or UDP `50000–60000`, plus TCP `7881` (ICE/TCP fallback).
  - **Embedded TURN:** UDP `3478` and TURN/TLS on TCP `443` / `5349` (required for corporate NATs/VPNs that block UDP). LiveKit Cloud includes managed global TURN/TLS automatically; self-hosted `livekit-server` includes an embedded TURN server requiring a dedicated TLS domain/cert.

### Bounded Cost Sketch (No Provisioning Performed)

| Component / Tier | Fixed Cost | Included Usage | Overage / Unit Rate | Notes |
| --- | --- | --- | --- | --- |
| **Local `livekit-server --dev`** | **$0.00 / mo** | Unlimited local loopback | $0.00 | Apache-2.0 binary/container for offline tests and local dev. |
| **LiveKit Cloud — Build (Free)** | **$0.00 / mo** | **5,000 participant-mins / mo** + 50 GB bandwidth | Hard cap (no auto-charge; no credit card required) | 1 live voice session = 2 participants (browser + backend bridge) = **2,500 voice call minutes/mo free**. |
| **LiveKit Cloud — Ship** | **$50.00 / mo** | ~150,000 participant-mins / mo + 250 GB | ~$0.0005 / participant-min | Optional future production tier if free cap is exceeded. |
| **P8 Paid Benchmark Run (1× 8-turn suite)** | **$0.00** infra | 1 warm-up + 7 measured turns (~5 min audio) | **~$0.09–$0.12 per run** (OpenRouter + Deepgram) | Fits comfortably within the existing **$1.00 / 8-submission** `LiveBudget` cap. |

---

## 9. DAG Reconciliation (`P1`–`P8` Ownership, Dependencies & `state.md` Refinements)

### DAG Structure Verification
The dependency graph in `docs/live-voice-webrtc/state.md:107-128` (`R → P1 → {P2, P3, P4, P6} → P5 → {P7, P8} → V`) is **confirmed sound** and requires no topological changes.

### Recommended `state.md` Refinements for the Orchestrator Before Dispatching `P1`
1. **P1 Scope Reduction (Ponytail — Keep LiveKit Config in Bootstrap/Voice Env Only):**
   - `state.md:39-40` lists `backend/src/contracts/admin-config.ts`, `admin-config-wire.ts`, `frontend/src/api/admin-config-protocol.ts`, and `backend/src/admin-config/{credential-service.ts,credential-validation.ts}` under P1.
   - **Refinement:** Store `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in environment / `VoiceConfig` (`bootstrap-config.ts`, `voice-config.ts`, `manageable-config.ts`, `config-runtime.ts`)—just like `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`—rather than altering the encrypted MongoDB `StoredConfigDocument` (`credentials: { openrouter, deepgram }` in `backend/src/contracts/admin-config.ts:331-336`) and the Manage Aurvin UI wire contract.
   - **Add to P1 owned files:** `backend/src/platform/security/redact.ts` and `backend/src/platform/security/redact.spec.ts` so `participantToken` and compact JWTs (`eyJ...`) are redacted by `redactSecrets`.
2. **P3 Provider Adapter Invariance & Gate Placement:**
   - Record in `state.md` under P3 that `backend/src/voice/providers/{flux-stt.ts,flux-tts.ts,nova-stt.ts}` require **zero modifications**, and that `backend/src/voice/transport/livekit-media.ts` owns the inbound 16 kHz / 80 ms (2,560 B) framing, the 5-second quiet gate (`CaptureGate` pausing Deepgram STT uploads via `LiveFlow.suspendInput('quiet')`), the outbound 24 kHz `AudioSource`, `audioSource.clearQueue()` on `invalidate`, and reliable data channel control framing.
3. **P4 Single Mic Capture & Dictation Isolation:**
   - Record in `state.md` under P4 that live mode uses a single `livekit-client` `Room` connection (publishing one microphone `LocalAudioTrack`, subscribing to one `RemoteAudioTrack`, and sending/receiving `VoiceClientEvent` / `VoiceServerEvent` over `Room` reliable data packets), while `DictationController`, `VoiceClient`, and `AudioCaptureService` remain untouched for dictation.

---

## Decisions Handed to Planning

1. **Architecture:** In-process `LiveKitMediaBridge` (`@livekit/rtc-node` + `livekit-server-sdk`) implementing `VoiceSink` in front of `LiveFlow`; `@livekit/agents` is rejected.
2. **Dependencies:** Add `livekit-server-sdk@^2.19.2` and `@livekit/rtc-node@^1.2.1` to `backend/package.json`; add `livekit-client@^2.23.0` to `frontend/package.json`.
3. **Wire Contract:** `CreateVoiceSessionResponse` adds `livekit?: { url: string; roomName: string; participantIdentity: string; participantToken: string }` for `mode === 'live'`; `dictation` retains `websocketUrl: '/api/voice'`.
4. **Control Channel:** Live mode carries existing `VoiceClientEvent` / `VoiceServerEvent` JSON envelopes over LiveKit reliable data packets (`DataPacket_Kind.RELIABLE`, topic `'aurvin.voice.control'`) on the same `Room` connection; `/api/voice` WebSocket is dictation-only after P5 cutover.
5. **Audio Framing & Quiet Gate:** Backend `LiveKitMediaBridge` subscribes via `AudioStream(track, { sampleRate: 16000, numChannels: 1, frameSizeMs: 80 })`, runs the 5-second `CaptureGate` before `LiveFlow.input(pcm)` (so the browser opens only one WebRTC mic track and paid Deepgram STT uploads still pause on silence), and publishes 24 kHz TTS PCM via `AudioSource(24000, 1, limits.outputQueueMs)`.
6. **Interruption & Playout Proof:** Interruption calls `audioSource.clearQueue()` on the backend bridge plus `tts.interrupt` and `runtime.cancelLiveTurn`. Durable completion continues to require both provider `speech-completed` and client `playback.progress` (`playedSamples === generatedSamples`).
7. **Admission & Teardown:** Room `aurvin-live-${sessionId}`, browser identity `${userId}:${sessionId}:${connectionEpoch}`, short-lived join token (`<= 30s`), and active server teardown (`room.disconnect()` + `RoomServiceClient.deleteRoom`) on session end, expiry, unrecoverable disconnect, or server drain.
8. **Benchmark Harness:** Extend `runVoice` in `backend/src/benchmark/voice-runner.ts` with a headless `@livekit/rtc-node` client participant driving the identical `baseline.pcm` fixture and recording `speechEndToFirstAudioMs` on the first decoded non-silent `AudioFrame` after `audio.start`, writing to a new output directory without touching `benchmark-results/ws-live-2026-11-05`.

---

## Unresolved Decisions Requiring User Approval

1. **LiveKit Server Target for P8 Live Evaluation:**
   - Offline unit/integration tests (P1–P6) will use deterministic fakes/mocks. For P8 live latency benchmarking and browser validation, does the user approve running a **local `livekit-server --dev` instance on `127.0.0.1:7880`** ($0 cost, zero WAN hair-pinning), or connecting to a **user-supplied LiveKit Cloud project** (Free Build tier, $0 up to 5,000 participant-mins/mo)?
2. **P8 Paid Benchmark Authorization:**
   - Executing P8's live end-to-end WebRTC benchmark against real Deepgram Flux STT/TTS and OpenRouter requires explicit user authorization for paid provider calls under the bounded `LiveBudget` cap (**max 8 submissions, ~$0.12 estimated cost, hard cap $1.00 USD**).
3. **Config Surface Confirmation:**
   - Confirm that keeping `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in server environment variables (`.env` / `bootstrap-config.ts` / `voice-config.ts`) rather than adding a third credential provider card to the "Manage Aurvin" browser UI is acceptable.

---

## Verification Provenance & Unrun Environment Checks

- **Verified from primary sources & npm registry (read-only):**
  - Package versions, engine ranges, dependency trees, and prebuilt Windows x64 FFI binary availability (`@livekit/rtc-ffi-bindings-win32-x64-msvc@0.13.1`) verified via `npm view` against the live npm registry on 5 November 2026.
  - `@livekit/rtc-node` (`Room`, `AudioSource`, `AudioStream`, `AudioFrame`, `LocalAudioTrack`, `clearQueue()`, `waitForPlayout()`), `livekit-server-sdk` (`AccessToken`, `VideoGrant`, `RoomServiceClient`), `livekit-client` (`Room`, `RoomEvent`, `Track`, `startAudio`), JWT expiry behavior, and LiveKit Cloud tier limits verified against official LiveKit documentation (`docs.livekit.io` and `livekit.io/pricing`).
  - All repository call paths, line numbers, audio constants, and benchmark baseline hashes verified directly from working tree source at `HEAD = a78f23a`.
- **Inferred (to be validated by P3/P6 unit and integration tests):**
  - Exact frame chunking behavior of `@livekit/rtc-node` `AudioStream` when `frameSizeMs: 80` is passed (whether the FFI yields one 80 ms frame or 10 ms/20 ms sub-frames); mitigated by design via the mandatory 2,560-byte ring accumulator in `livekit-media.ts`.
- **Environment checks intentionally not performed (per research-only constraints):**
  - No packages were installed (`package.json` and lockfiles untouched).
  - No LiveKit server or cloud project was provisioned or contacted.
  - No paid OpenRouter or Deepgram API calls were executed.
