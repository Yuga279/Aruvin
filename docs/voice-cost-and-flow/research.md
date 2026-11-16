# Voice Cost and Flow Research

Status: complete, research only. Date: 16 October 2026.
Checkout: `codex/voice-cost-and-flow`. No source, package, or lockfile changes.
No paid provider, microphone, database, provisioning, or deployment action was run.

## Decisions

1. Use `@ozymandiasthegreat/vad@2.0.7` embedded entry, mode `VADMode.AGGRESSIVE`, 16 kHz, 20 ms `processFrame` calls. Do not use RMS, browser `SpeechRecognition`, or Silero/ONNX.
2. Add one client event, `input.suspend`, and one server state, `input: "suspended"`. Reuse `input.unmute` for automatic foreground resume. Manual mute remains its existing discard/restart path.
3. Keep the mounted call through quiet, resource expiry, quota, provider failure, and exhausted reconnects. Stop or renew paid resources without creating a session, conversation, or accepted turn. Only Hang up, navigation, unmount, and page destruction exit.
4. Change `SpeechProse` clause selection and coalesce `VoiceDelivery` writes. Do not add a queue, parser, model, or second Flush.
5. Add one 100 ms playback origin delay per assistant response, not per packet or sentence.

## 1. Speech detector

### Choice and ladder

- RMS in `live-voice-controller.ts` is visualization only. It is not a speech detector.
- Browser `SpeechRecognition` is not an installed dependency, needs network recognition, and would duplicate Flux. Reject it.
- No installed frontend dependency provides VAD. Frontend dependencies are only React and React DOM.
- `@ozymandiasthegreat/vad@2.0.7` is the smallest package that clears the raw-energy failure mode. It is the latest version, has zero dependencies, and its unpacked package is 53,014 bytes.
- Silero through `@ricky0123/vad-web@0.0.31` is rejected. It needs ONNX Runtime, a worklet bundle, and 1.81–2.33 MB model files, with 512-sample/32 ms or 1536-sample/96 ms frames. That is unnecessary weight for an upload gate.

### Package contract

Import the embedded entry, not the fetching entry:

```typescript
import createVad, { VADMode, VADEvent } from "@ozymandiasthegreat/vad/lib/embedded.js";

const VAD = await createVad();
const vad = new VAD(VADMode.AGGRESSIVE, 16000);
const decision = vad.processFrame(frame); // 0 silence, 1 voice, -1 error
vad.destroy();
```

`processFrame` accepts 160, 320, or 480 samples at 16 kHz. Use 320 samples. `processBuffer` is an aggregate helper and is not the cadence API.

The embedded entry decodes a base64 WASM module and calls `WebAssembly.instantiate(binary)`. It does not fetch, `eval`, or use `new Function`. The package’s other entry fetches `dist/libfvad.wasm`; do not import it.

The package is ESM and exposes `typings/index.d.ts`. Vite bundles the embedded JS and inline WASM payload. No public asset path, CDN, runtime download, microphone upload, or analytics is required. A WASM CSP must allow `'wasm-unsafe-eval'`; no script `unsafe-eval` is required. A deployment that forbids WASM instantiation must report detector unavailable rather than silently loading another implementation.

The package metadata says MIT. The distributed `LICENSE` is the WebRTC/libfvad BSD-3-Clause text. Preserve both notices with the dependency. The upstream repository is archived, so this exact version is pinned deliberately; do not float it.

### Detector behavior

- Run it only in the capture worklet, after the existing resampler emits 16 kHz PCM.
- Score each 80 ms upload frame as three 20 ms decisions plus a 20 ms remainder. A negative decision is detector failure. Any positive decision is speech; otherwise the frame is non-speech.
- Speech clears the silence timer and marks the following audio, up to the 320 ms pre-roll target, as required. Confirmed non-speech for 5,000 ms suspends upload on the next frame. The 80 ms frame cadence is the one-frame tolerance.
- Keep at most four 80 ms frames. On resume, send that bounded pre-roll once, in order, then live audio. Drop anything older. Never accumulate a reconnect backlog.
- The detector never calls agent execution, interrupt, unmute, or provider finalization. Flux `StartOfTurn` remains the only barge-in authorization.
- Model the gate as a pure decision function over frame decisions and timestamps. Worklet tests can exercise it without WASM. One browser/worklet test must load the real embedded module and prove a voiced fixture, silence fixture, and destroyed-instance failure.

CPU cost is a few G.729 classifier calls per 80 ms frame. It is negligible beside capture, resampling, and playback, but AC8 must still record actual device CPU and false-decision rates. Detector latency is at most one 20 ms sub-frame plus worklet messaging and is distinct from network or provider latency.

Browser constraints remain echo cancellation enabled and noise suppression disabled for the initial implementation. Existing capture starts with the latter enabled; P2 must change that default. Aggressive suppression is a measured option, not the default, because Deepgram documents clipping of quiet, accented, and short speech. The selected VAD mode is the conservative gate: it prefers fewer false speech decisions, while a missed weak onset is bounded by pre-roll only when a decision eventually turns positive. That tradeoff requires AC8 measurement.

## 2. Flux lifecycle and call persistence

### Verified provider semantics

Flux listen uses `/v2/listen`; Flux TTS uses `/v2/speak`. Current code already connects to those routes and sends one WebSocket protocol ping every 20 seconds, with a 5-second pong deadline. Nova’s JSON `KeepAlive` is a different mechanism and must not be sent to Flux.

Official comparison says Flux keep-alive is “replaced by pings, 60s timeout.” Official TTS documentation is explicit: 60 seconds without an inbound client message closes with `NET-0004`, and a protocol ping or pong resets it. Current `/v2/listen` documentation does not explicitly define a no-audio close code. Older STT troubleshooting documents 10-second `NET-0001`/`NET-0002` behavior and says JSON `KeepAlive` does not replace the first audio requirement. Therefore a ping-only held Flux socket is compatible with the strongest official statement but is not certified for an indefinite quiet call.

`ForceEndTurn` finalizes the active turn and emits normal `EndOfTurn` with `trigger: "manual"`. No active turn produces warning `FORCE_END_TURN_NO_ACTIVE_TURN`, no turn advance, and no error. Repeating it has that same no-op result. `CloseStream` does not emit `EndOfTurn`; it must not be used as finalization.

Current code has three relevant defects:

- `input.mute` increments the STT generation, closes STT, and drops late callbacks. Unmute opens a new STT connection. That is correct privacy behavior but discards an unfinished turn, so it cannot implement idle.
- `FluxSttAdapter.finalize()` sends `ForceEndTurn` but does not make its result idempotent or expose a settled promise.
- `LiveFlow.error()` emits non-recoverable `session.error` with `return_to_chat` and finishes the socket. `VoiceClient` then calls its error callback, and the controller exits. `session.ended` also exits. This conflicts with the approved call lifetime.

### Contracts

P1 owns the shared contracts in `backend/src/contracts/voice-wire.ts` and `frontend/src/api/voice-protocol.ts`.

- Add `input.suspend` beside the existing parameterless client events. It is live-only.
- Extend `voice.state.input` from `"listening" | "muted"` to `"listening" | "suspended" | "muted"`.
- Extend server recovery with `"resume_call"`.
- Add `MEDIA_GATE_UNAVAILABLE` to the shared voice error list.
- Give `session.error` and `session.ended` an explicit `terminal: boolean`. Existing terminal reasons remain terminal. New non-terminal pause/block events use `terminal: false` and must not close the client socket.

No new resume event is needed. `input.unmute` already means “listen again”; its server effect depends on whether the preceding state was suspended or muted.

Server semantics:

- `input.suspend`: if already suspended, no-op. If muted, reject. Stop upload admission, remember the STT generation, call `finalize()` once, and wait for either the resulting `EndOfTurn` or the documented no-active-turn warning. Then continue the existing 20-second protocol pings. Do not close STT, clear its turn set, increment its generation, or cancel TTS/agent work.
- If no terminal settle signal arrives within the existing 2,000 ms finalization limit, close and lazily reopen that STT socket without submitting partial text. This bounds a provider race without charging another model inference.
- While suspended, discard binary media even if a stale client sends it. Pings continue. Agent/TTS activity still marks the call busy and must not be interrupted by suspension.
- `input.unmute` from suspended keeps the same STT generation and session, sends no buffered silence, and only resumes media admission. It does not create a conversation or turn. A later provider `StartOfTurn` may interrupt playback under the existing rule; suspension itself cannot.
- `input.unmute` from muted retains the current close/connect discard behavior exactly.
- A provider-closed held socket is renewed once at the next safe boundary, after pending finalization and with no active agent turn. If renewal fails, enter a paused call state. Do not rotate voice or chat sessions to obtain another quota or identity slot.

The existing 60-second warning plus 30-second idle stop ends the server session. P1 removes that stop for an otherwise healthy call. The warning can remain informational, but it cannot be described as impending hang-up. Duration, quota, shutdown, and disconnect paths remain authoritative.

Paused or blocked states stop the associated paid work but retain the same mounted session and draft. A Resume control may reopen a permitted transport or playback context. It must not reset quota, duration, attempt identity, or provider billing identity. Exhausted budget remains blocked.

Page hide, freeze, permission loss, and manual mute still stop capture immediately. Hide/freeze preserves the call and may require the existing gesture resume. Navigation, unmount, and pagehide remain real teardown.

## 3. Output flow

No acoustic cause is claimed. Source and deterministic timing identify two application contributors and one playback-scheduling exposure.

### Measured text release

The existing prose tests prove sentence-sized release and arbitrary-cut safety, but not cadence. An isolated scratch Vitest, since deleted, imported the real `SpeechProse` and `VoiceDelivery` and measured:

- `"Hello there. This is the second sentence. Here is a third..."` released at characters 13 and 42. The final sentence waited for `finish()`.
- A 164-character unpunctuated sentence produced one release at 96 characters and the remainder at `finish()`.
- With a 25 ms artificial durable write, the first speak waited 27 ms and the second 30 ms. One initial write and one write per emitted chunk were observed. Exactly one Flush occurred.

Thus the gap is not a per-sentence Flush bug. It is sentence-or-96-character release followed by one persistence wait per release. Real Mongo latency was not measured.

### Required code changes

P3 changes `SpeechProse` in place. The current 96-character plain-text fallback becomes a 24-character clause threshold while retaining its 64-character maximum chunk and all existing hidden-content guards. It may split only on whitespace. It must not split words or numbers, trim punctuation, or emit hidden reasoning, fenced code, JSON, tables, or ambiguous markup. Existing full-string assertions remain the safety oracle. This is a threshold change, not a new parser.

P3 changes `VoiceDelivery.delta` so it does not durably persist every clause before speech:

- Keep the initial delivery record before model output.
- Append each clause to in-memory `textGenerated` and send it to the existing TTS writer immediately.
- Coalesce dirty evidence into one write at least every 100 ms or 512 characters, whichever first, and always before `finish()`, cancellation, interruption, and settle.
- Keep the single existing Flush in `finish()`.
- Cap unpersisted text at 512 characters. If a write fails, stop further speak dispatch and preserve the existing failure/unknown settlement path.
- Do not persist raw audio or model reasoning. Playback progress coalescing already exists and remains separate.

This preserves generated-before-final-evidence ordering without a per-token or per-clause database round trip. The crash window is one bounded dirty clause batch, recovered through the existing delivery/reconciliation records; it must be stated rather than claimed away.

### Playback

`AudioPlaybackService.enqueue` starts the first packet at `max(currentTime, nextTime)` and starts each later packet exactly at the prior packet end. A delayed packet therefore produces an audible gap. The scratch model showed a 130 ms gap when one packet in a contiguous response was delayed by 250 ms. This tests scheduling math only; it does not identify network jitter or provider silence as the user’s cause.

P3 adds one startup hold: the first packet of a response is scheduled 100 ms after the current scheduling origin, and all later packets remain contiguous behind it. If the first packet arrives already carrying more than 100 ms, no extra hold is added. The hold is never applied per sentence or packet. The existing interrupt path still stops and discards queued old audio immediately. Underruns are counted and surfaced as delivery observations; the queue must not grow without bound to conceal a slow provider.

## 4. Ownership and sequencing

P1 owns shared contracts and backend policy:

- `backend/src/contracts/voice-wire.ts`
- `backend/src/contracts/voice.ts`
- `backend/src/contracts/admin-config.ts`
- `backend/src/contracts/admin-config-wire.ts`
- `backend/src/platform/config/voice-config.ts`
- `backend/src/platform/config/manageable-config.ts`
- `backend/src/voice/providers/flux-stt.ts`
- `backend/src/voice/providers/provider-link.ts`
- `backend/src/voice/session/live-flow.ts`
- `backend/src/voice/session/voice-session.service.ts`
- `backend/src/voice/session/voice-session.options.ts`
- `backend/src/voice/usage/voice-usage.service.ts`
- direct tests for those files

P1 also owns the frontend protocol mirror, `frontend/src/api/voice-protocol.ts`, and its direct protocol test. It does not own UI or capture implementation.

P2 owns browser capture, detector, call state, and controls:

- `frontend/src/features/voice/audio/audio-capture-processor.ts`
- `frontend/src/features/voice/audio/audio-capture-service.ts`
- `frontend/src/features/voice/audio/pcm-resampler.ts` only if a 20 ms tap is required
- the new detector helper under `frontend/src/features/voice/audio/`
- `frontend/package.json` and `frontend/package-lock.json` for the one pinned dependency
- `frontend/src/features/voice/state/live-voice-controller.ts`
- `frontend/src/features/voice/state/live-voice-reducer.ts`
- `frontend/src/features/voice/live/**`
- direct tests for those areas

P2 must not edit playback, dictation, or backend files. Dictation uses separate controller and protocol paths; live-only events cannot be accepted in dictation mode.

P3 owns:

- `backend/src/voice/agent/speech-prose.ts`
- `backend/src/voice/agent/voice-delivery.ts`
- the scoped live delta path in `backend/src/chat-runtime/durable-chat-runtime.ts`
- `backend/src/voice/providers/flux-tts.ts` only if a bounded output observation requires it
- `frontend/src/features/voice/audio/audio-playback-service.ts`
- direct tests for those files

P3 does not take `live-flow.ts`; P1 owns its input/lifecycle changes. If P3 needs another output observation, it uses the existing observation hook rather than editing P1’s file.

P4 owns central wiring and integrated evidence:

- `backend/src/app.service.ts`
- cross-layer tests not owned directly by P1–P3
- feature documentation and the final verification record

P1 is the only planner/worker that starts from research. P2 and P3 planners require the committed P1 worker because both consume its wire and delivery contracts. P2 and P3 workers are then independent. P4 waits for both workers.

## 5. Config, quota, and tests

No new user setting is required. The 5-second gate, 320 ms pre-roll, 100 ms prose/playback bounds, and 512-character dirty cap are fixed implementation contracts. Existing `eotTimeoutMs` remains 5,000 ms and must not be reinterpreted as the upload gate.

P1 must update stored config compatibility because `voice.state` and terminal events are explicit contracts. Existing duration, reconnect, queue, quota, and rate fields remain unchanged. Idle warning/exit fields remain in stored config for compatibility but no longer authorize healthy-call teardown. Do not silently repurpose them for the 5-second gate.

Quota counters remain process-local and estimated. P1 must report that plainly. Resume and transport renewal cannot bypass them or create a new admitted session merely to refresh them.

Routine checks do not need a database:

- Backend: `npm test -- <spec> -t "<name>"`, then `npm run build`, `npm run lint`, and `npm test` from `backend/`.
- Frontend: `npm test -- <test> -t "<name>"`, then `npm run build`, `npm run lint`, and `npm test` from `frontend/`.
- Frontend tests are Node tests, not browser DOM tests. A real-module VAD test can instantiate the bundled WASM in Node; browser CPU and acoustic behavior remain AC8.

Native tests are guarded by `AURVIN_TEST_MONGODB_URI` plus exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. `backend/test/persistence/native.ts` creates a generated database and drops it. Neither value was set in this shell, so no native suite was run. `npm run test:e2e` includes native suites and must be reported separately whenever those variables are absent. No suite may point at the application database.

The scratch tests were deleted and `git status --short` was clean except for this research file before commit.

## Verification required by implementation

- AC1: after 5,000 ms plus one 80 ms frame, zero PCM is sent during a long quiet interval while protocol pings continue.
- AC2: one bounded pre-roll is sent once, in order, into the same session; no duplicate turn or empty conversation occurs.
- AC3: prior 60-plus-30 idle policy, duration, quota, provider failure, and exhausted reconnect leave the mounted call in an honest state. Hang up still closes every resource.
- AC4: detector speech does not directly interrupt or submit; only Flux `StartOfTurn` can interrupt.
- AC5–AC6: token-split prose fixtures remain exact, dirty evidence is bounded, one Flush occurs, and the playback reserve is applied once. A failed evidence write stops dispatch rather than weakening durability.
- AC7: package checks pass; native checks are passed, skipped, or blocked according to the actual environment.
- AC8: remains unauthorized and unrun. No acoustic quality or invoice saving may be marked verified.

## Limitations

- Ping-held `/v2/listen` no-audio behavior is not certified by current official documentation. The implementation must renew or pause on actual socket loss.
- The 5-second local gate and Flux’s 5-second model timeout are independent. Local suspension must finalize a pending turn before relying on either timer.
- Text and playback measurements were deterministic source-level reproductions, not device audio measurements.
- Archived upstream and the mixed MIT/BSD license notices require the pin and notice preservation stated above.
- This document authorizes no live Deepgram, OpenRouter, microphone, or database work.
