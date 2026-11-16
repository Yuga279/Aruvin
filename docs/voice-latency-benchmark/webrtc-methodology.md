# WebRTC voice benchmark methodology (P6)

This document defines the headless LiveKit/WebRTC measurement boundary delivered by P6. It records **method and future invocation only** — P6 produced no measured latency, no audible evidence, no LiveKit connection and no deployment approval. The offline suites use deterministic SDK fakes; they do not certify native FFI loading, media connectivity, provider performance or browser/device audibility.

Related: [workflow goal](../live-voice-webrtc/goal.md), [execution state](../live-voice-webrtc/state.md), [P6 plan](../live-voice-webrtc/plan6.md), and the immutable [5 November WebSocket baseline](websocket-live-baseline-2026-11-05.md).

## Transport selection

The benchmark config gains `transport: 'websocket' | 'webrtc'`, defaulting to `websocket` so every existing caller keeps its old behavior. A declared `webrtc` run fails with `BENCHMARK_TRANSPORT_MISMATCH` if admission returns a legacy descriptor; a legacy run fails the same way if admission returns a LiveKit descriptor. There is no automatic fallback, retry or transport relabeling.

`runVoice` remains the admission, PCM-validation, timeout and HTTP session-cleanup owner. Only after admission does it branch to the headless participant in `backend/src/benchmark/webrtc-voice.ts`. The WebSocket branch and its simulated playback progress loop are unchanged.

## Frozen boundaries

| Metric | WebSocket | WebRTC |
| --- | --- | --- |
| `setupMs` | admission POST through `session.ready` | admission POST through `session.ready` after join/publish |
| first audio | first binary PCM chunk accepted after `audio.start`, including silence (`ws-pcm-receipt-v1`) | first decoded **nonzero** mono 24 kHz frame after a valid `audio.start` for the expected agent track (`webrtc-decoded-nonzero-after-start-v1`) |
| `firstMediaReceiptMs` | not separately exported | `null`; `TrackSubscribed` is not an RTP receipt timestamp |
| `firstTrackSubscribedMs` | null | remote assistant track subscription notification only |
| `firstTrackScheduledMs`, `firstAudibleMs`, `speechEndToAudibleMs`, `interruptionToAudibleStopMs` | null | null |
| `speechEndToPlaybackEndMs` | existing simulated 24 kHz playback end | `null`; decoded frames and `audio.end` are not playback proof |
| `durableCompletionMs` | correlated `delivery-settled` without error plus matching terminal completion | same strict correlation; absent evidence remains `null`/unverified |

Frames before `audio.start` are ignored, counted in `preStartFrames`, and never backdated. A backwards clock, wrong rate/channels, empty/oversized frame, second response start, foreign sender/session/epoch/sequence, track replacement, reconnect, unsubscribe, decoded EOF, cancellation or control error fails the one-shot run. Input replay keeps the original 16 kHz mono PCM, 80 ms pacing, fractional speech-end marker and zero-padded final frame; lateness above 80 ms fails instead of bursting. The submission time of the marker-containing frame and maximum pacing lateness are recorded.

8 November offline compatibility correction: the checked-in client now explicitly
uses `AudioSource(16000, 1, 1000)`, the installed rtc-node 1.2.1 SDK's supported
buffered source. Zero-queue native direct capture accepts only 160-sample/10 ms
frames and rejected the runner's 1280-sample/80 ms frames. The queue is a bounded
1000 ms capacity, not a required initial wait. Before each capture the runner
rejects a nonfinite/negative queue estimate or one whose next 80 ms frame exceeds
capacity, and records `maxInputQueuedMs` (SDK estimate, not measured RTP latency).
Absolute 80 ms pacing, the unchanged >80 ms lateness guard, final zero padding,
abort/late-connect cleanup and strict transport selection remain in force.
Deterministic SDK fixtures verify constructor arguments and exact frame contents;
they do not replace native/live verification. This change does not retroactively
turn the ignored operator-client measurement into a stock-client result. See
[the offline follow-up](../performance/live-latency-followup-2026-11-08.md).

The WebSocket and WebRTC first-audio boundaries are **not like-for-like**: WS receipt includes initial silence and excludes jitter/decode; WebRTC onset excludes silence and includes jitter/decode. Report them side by side with `deltaMs=null`, `deltaPercent=null` and no improvement verdict. The retained WS run exported no PCM content, so its first-nonzero boundary cannot be reconstructed from old JSON. Never relabel the historical report.

## Headless receipt is not playback proof

P1's current contract exposes `audio.start`, `audio.end` and `playback.progress`, but a continuous remote track's decoded sample count is not proof that the intended response was audible. The headless path therefore sends **no** invented `playback.progress`, never sets `completed` from `audio.end`, and does not bypass server backpressure. If `audio.end` and decoded onset arrive without a control/media failure, absent supported completion proof yields `outcome: 'unverified'` / `failureCode: 'BENCHMARK_UNPROVEN_PLAYBACK'`. If the server first sends a delivery-unknown/session-error control (as in the retained 8 November run), the existing fail-closed handler instead records `BENCHMARK_MEDIA_FAILED`; a deadline records timeout. Neither path proves a runtime playback defect or a completed conversation. P8 cannot claim a complete lifecycle comparison from an onset-only run.

If a supported non-audible consumer/proof contract is later supplied, its owner must hand over the exact types, validation and semantics before this benchmark enables acknowledgments.

## Export schema (version 2)

`results.json` retains every attempted sample, pseudonymized identifiers, timelines, warmups, failures and the existing duration `summary`, and adds:

- `schemaVersion: 2`, `complete`, `transport`, `firstAudioBoundary`, `voiceMetrics` (one nearest-rank summary per metric) and `provenance`.
- `complete` requires the expected warmup/measured counts, no skips/failures/unverified rows, finite required metrics and correlated durable completion. Process exit alone is not completion.
- Missing metrics stay `null`; warmups and failures remain in raw records and are excluded from success percentiles. WebRTC voice duration never falls back to whole-operation duration.
- Strict nonsecret provenance: source/build/configuration/instruction/product-knowledge/PCM hashes, input bytes and marker, scenario/fresh conversation, input/decoded rates and channels, codec (Opus, 48 kHz RTP clock), unmeasured packet duration (`null`), resampling path, explicit client/backend/SFU/database/provider labels, resolved SDK/FFI versions, model/routing/STT/TTS labels, endpointing/limits hashes, impairment profile and `playbackBoundary: 'unproven'`.

Hashes are lowercase SHA-256. Labels allow only `[A-Za-z0-9/_.:-]`, length 1–128, and reject JWT/Bearer/`sk-` shapes. Unknown placement is the literal `unverified`, which blocks a matched comparison. No LiveKit token, participant descriptor, URL with access data, `.env`, authorization header, raw exception, transcript, response text, reasoning or audio output is exported. The original synthetic input stays in its private artifact location; only its hash is exported.

## Budgets and approvals (unchanged)

The guarded driver keeps the tested ceilings: 16 capped model dispatches; 60,000 context and 6,000 output tokens per dispatch; 60,000 ms aggregate STT PCM; 4,000 aggregate UTF-8 TTS bytes; 32 speech sockets; 900,000 ms paid-active lifetime; one warmup plus seven measured submissions at 90,000 ms per case; concurrency one. The conservative reservation is `$0.99847`; it is not an invoice guarantee. LiveKit traffic is not billed as provider STT PCM. Any cloud/TURN or LiveKit infrastructure cost needs a separate approved envelope.

Fresh WebRTC run options are explicit; the exhausted `user-followup-2026-11-05` reference and default `--live` invocation are refused before `.env`, database or network work:

```powershell
node dist/benchmark/live-baseline.js --live --transport=webrtc --approval-reference=<fresh-reference> --output-name=webrtc-live-<date>-<unique>
```

The approval reference is provenance, not proof of authorization. An existing output directory is never reused or deleted. The driver validates the immutable PCM (183,518 bytes, SHA-256 `933c59e...412c3a1`, marker `3734.9375` ms) and refuses mismatches before admission. It hashes source and compiled `dist/**/*.js` before and after the child; drift makes the run incomplete. A 900,000 ms parent deadline terminates only its own Node child; it does not use a process-name kill.

## P8 output layout

```text
backend/benchmark-results/webrtc-live-<date>-<unique-name>/
  context.json                 # pre/post source/build identity, settings, SDK/placement, approval ref
  benchmark.json               # nonsecret generated config with transport + provenance
  server.jsonl                 # existing allowlisted telemetry projection only
  readiness.json
  readiness.jsonl
  client.log                   # generic safe status lines, no raw errors
  client-status.json           # exit code, deadline, drift
  budget.json                  # LiveBudget counters/denial/conservative ceiling
  runs/<run-id>/results.json   # every attempted sample, raw metrics, provenance, completeness
  runs/<run-id>/report.md
  runs/<run-id>/comparison-input.json
```

The CLI fences `webrtc-live-*` output roots (or their `runs` child), resolves canonical ancestors, refuses traversal/reparse paths into `ws-live-2026-11-05` or `ws-baseline-2026-11-05`, and reserves the new UUID leaf with non-recursive `mkdir`. Historical reports and raw baseline evidence are immutable and never opened for writing.

Offline comparison (only after P8 has valid normalized sidecars):

```powershell
node dist/benchmark/voice-comparison.js <before-comparison-input.json> <after-comparison-input.json> <new-output-directory>
```

Comparison requires strict 1 MiB-max inputs, live/complete runs, matching configuration/environment/input/marker/repetition identity, and expected row shapes. Different source hashes are allowed and recorded (the transport implementation necessarily changes source). Incompatible first-audio boundaries produce `deltaMs: null`, `deltaPercent: null`; unproven playback refuses durable/playback deltas. There is no `--force`, URL, provider or subprocess support.

## Legacy WebSocket comparison sidecar

The retained 5 November `results.json` is schema 1 and has no comparison DTO. P8 must retain it unchanged and create a **new sidecar** in the new P8 evidence directory, deriving counts/metrics from raw rows and identities from its original `context.json`, PCM/manifest, provenance audit and saved source/build evidence. Do not fill unavailable legacy fields from today's checkout. If old configuration/asset/environment identity cannot be established, write `complete:false` and report comparison blocked. Rounded report values or `latency-summary.json` alone are insufficient.

## Browser/device and impairment procedure (P8-owned, unrun)

- Match both transports using separate preserved builds/checkouts. Use the same fixture/rates, model/routing, endpointing, fresh conversation, counts, browser/device/output route and placements. Record permission/unlock and cold/warm state separately from setup.
- For actual audibility, route consented synthetic input plus calibrated acoustic or device-loopback output into one observation clock. Detect the last input waveform and first output waveform/stop on that same clock; log calibration latency, resolution, threshold, noise floor, browser/OS/device versions and method. UI `playing`, track attach, server TTS and decoded onset are not audible events. Retain only consented synthetic artifacts; never record private microphone speech or reply content by default.
- For interruption, use one documented synthetic marker at a fixed time after observed assistant onset. Measure actual output disappearance and continued absence for 1000 ms, including no stale tail after cancellation. Record explicit client interrupt and Flux-detected barge-in separately; do not combine percentiles.
- Fixed profile `none` injects nothing. Proposed `fixed-delay-jitter-loss-v1` is bidirectional 50 ms one-way delay, ±10 ms jitter and independent 1% loss, with no bandwidth cap or reordering. These are requested injector settings, not measured network properties. Record tool/version/seed/affected link and verify the imposed profile with independent probes. Apply the same browser/client-to-media link for both transports; mark SFU-to-bridge placement unmodified. If a tool cannot apply matching semantics to TCP WS and UDP RTP, mark the profile incompatible rather than equivalent.
- Obtain approval for the specific impairment tool, privileges and interface before use. Do not install, reset adapters, change firewall/proxy/TURN settings or deploy as part of measurement. Always restore and verify operator network settings. A browser DevTools HTTP throttle is not proof of UDP WebRTC loss/jitter.
- Use the same approved repeats/warmup policy for both paths; keep impaired samples separate from unimpaired; preserve timeouts/failures; qualify small p95. Browser/interruption/impairment submissions need their own finite allocation and must not be squeezed into the eight-turn headless approval.

## Offline verification (P6)

From `backend/`:

```powershell
npm run build
npm test -- test/benchmark/voice-measurements.spec.ts test/benchmark/webrtc-voice.spec.ts test/benchmark/voice-comparison.spec.ts test/benchmark/live-run-options.spec.ts test/benchmark/runner.spec.ts test/benchmark/voice-runner.spec.ts test/benchmark/live-budget.spec.ts
npm run test:benchmark
npm run build
npm run lint
```

The no-argument and exhausted-argument driver invocations must refuse before environment/network/database work. No LiveKit server, device, native join, database, paid inference, Calendar or remote catalogue call belongs in offline verification. The suite is not browser, FFI/media connectivity, provider performance or audible evidence, and unified review remains **skipped**, not passed.

## Remaining limitations

- No measured WebRTC latency exists in P6; P8 needs fresh authorization, an approved LiveKit target and a supported completion proof.
- Headless decoded onset says nothing about audibility, browser autoplay, device buffering, echo cancellation or acoustic delay.
- No packet capture is added: requested/observed packet duration remains `null`; 80 ms capture calls do not prove 80 ms RTP packets.
- A nonce in a JSON control event does not correlate an RTP frame to a response; continuous-track attribution is recorded as a limitation.
- The retained WS baseline is transport- and boundary-incompatible with the new path until a matched baseline or stronger evidence exists.
