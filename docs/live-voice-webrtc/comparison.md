# Live voice WebRTC comparison

## Verdict

**INCONCLUSIVE — no new observed WebRTC run; fixture results are not latency measurements.** The retained WebSocket baseline is real headless provider evidence at PCM receipt and startup boundaries. The P6 WebRTC driver, provenance path, and fail-closed comparison now exist and are verified offline, but no WebRTC sample was collected, so no after values or deltas exist and no latency improvement is claimed. See [verification](verification.md) for current test outcomes and gates.

## Retained WebSocket baseline

Source: [WebSocket live baseline report](../voice-latency-benchmark/websocket-live-baseline-2026-11-05.md), run `9ab4762c-c960-406f-adcf-84d91f265d56`.

| Measure | Historical result | Definition / qualification |
| --- | ---: | --- |
| Completed submissions | 8/8 | 1 warm-up excluded; 7 measured successful samples. |
| Speech-end → first PCM receipt | p50 **7,800.788 ms**; exploratory p95 **17,696.421 ms** | Client replay marker to first binary PCM receipt; not decoded-nonzero audio and not audible onset. With seven samples, nearest-rank p95 is the maximum and exploratory. |
| Connection startup | p50 **1,479.505 ms**; exploratory p95 **2,216.661 ms** | HTTP session creation through WebSocket `session.ready`, including provider setup; excludes microphone permission and device readiness. |
| Speech-end → simulated playback end | p50 **24,043.905 ms**; exploratory p95 **33,761.372 ms** | CLI simulated-playback boundary; not browser/device playback. |
| Audible onset / interruption stop | **Not measured** | No browser or device observation in the baseline. |

The baseline report records estimated model plus speech cost of **US$0.091509** for its historical run. Its eight-submission authorization is exhausted and is not permission to repeat the run. The baseline's p95 values are exploratory, not stable tail estimates.

## Metric boundaries

| Metric | WebSocket baseline | WebRTC after-run | Comparable? |
| --- | --- | --- | --- |
| Speech end → first received/decoded audio | `ws-pcm-receipt-v1`: first PCM chunk receipt can include silence before browser scheduling; p50 7,800.788 ms, exploratory p95 17,696.421 ms. | `webrtc-decoded-nonzero-after-start-v1` is implemented in `backend/src/benchmark/webrtc-voice.ts` but **no run or sample exists**. | **No.** Historical PCM bytes were not retained in a form that permits reconstructing first nonzero decoded audio. Delta and percentage: **null / not computed**. |
| Startup | HTTP session creation → WebSocket `session.ready`, including provider setup. | No observed WebRTC startup value. The driver measures admission POST through `session.ready` after join/publish, but a fixture timer or fake Room is not a startup measurement. | **No after value; no delta.** Matching environment/configuration has not been established. |
| Audible onset | Not measured. | Not measured. | **No data.** Neither PCM receipt nor a fake playback clock is audible evidence. |
| Interruption → playback stopped | Not exercised in the baseline. | Not observed on a browser/device. | **No data.** |
| Simulated playback end / durable completion | Historical CLI simulation and application completion evidence. | Deterministic fixture/proof behavior only; the headless driver sends no invented progress and reports `unverified` / `BENCHMARK_UNPROVEN_PLAYBACK` absent supported proof. That is **not** device playback. | **No.** A fixture ACK or an onset-only row is not device playback confirmation. |
| Jitter, loss, reconnect, and deployment | No matched impairment profile. | No authorized profile or deployment observation. | **No data.** |

## Matching and provenance

- Historical baseline source/input hash: `e916bc586fafc4c2950791fb7cc1c46589623545b63dc11394631320ff4b0432`; run ID `9ab4762c-c960-406f-adcf-84d91f265d56`.
- Historical post-run compiled audit hash: `4574aa2847ce323eb0250b8bdf64fb9bb4448218dc17a5acdfc32870396fd64a`. The baseline report explicitly says this was collected post-run, not independently sealed before measurement.
- Current P8 source snapshot is **base commit `4a564e024ac33616348921d188fb96e8d4533465`** with the P4 fix `121ae72` and the P6 benchmark fix `b528445`..`deb09f5`, plus the P8 report commit that contains this file. The worktree was clean before the report edits. The fourteen-file P8 test-source fingerprint `d25fedb6c674e92ec3475281d43a5299db16a70ac11002fc7863112cf98e6113` is recorded in [verification](verification.md). No current WebRTC measurement source/build/config/input identity can be attached because no after-run occurred.
- The P6 driver now records strict non-secret provenance: source/build/configuration/instruction/product-knowledge/PCM hashes, input bytes and marker, scenario, input/decoded rates and channels, codec (Opus, 48 kHz RTP clock), unmeasured packet duration (`null`), resampling path, explicit client/backend/SFU/database/provider labels, SDK/FFI versions, model/routing/STT/TTS labels, endpointing/limits hashes, impairment profile, and `playbackBoundary: 'unproven'`. Unknown placement is the literal `unverified` and blocks a matched comparison. None of these fields has been populated by an actual run.
- Input waveform, browser/device, provider/model configuration, codec/packetization, SFU/bridge placement, and environment matching must not be inferred from today's checkout to fill gaps in the historical run. The frozen input is 183,518 bytes of 16 kHz mono PCM16LE with SHA-256 `933c59e38179c0a16df1b26aa1567a8a76ee823c0c0ceaf820feef382412c3a1` and a 3,734.9375 ms speech-end marker; the driver refuses a mismatch before admission.

## Samples and failures

- New WebRTC benchmark samples: **none**. No warm-up, measured, failed, or unverified row exists, so those counts are **not applicable**, not zero-valued measurements.
- No P8 benchmark submission was attempted. The driver was not executed against LiveKit, any provider, or the retained database; there is no provider, SFU, TURN, or infrastructure usage figure. This is not an invoice or account-level zero-use assertion.
- Deterministic tests ran against SDK doubles and local fixtures: benchmark tooling 147/147, backend voice integration 38 passed / 8 native skips, frontend voice integration 34/34. Their pass counts belong to software verification, not the latency sample set.
- The fail-closed design means a future authorized headless run may legitimately produce onset-only rows marked `BENCHMARK_UNPROVEN_PLAYBACK` and exit incomplete. Those would be retained as failures/unverified evidence, never relabelled as eight successful samples.

## Deltas

No signed or percentage delta is calculated. The after values are absent, and the receipt/playback boundaries are not matching. In particular, the historical first-PCM receipt values cannot be subtracted from an unmeasured WebRTC decoded-audio or audible boundary. Startup also has no after value or established matching environment. Overall result: **inconclusive**, neither improved nor not improved.

## Audibility interruption and impairment

The baseline contains no browser-audible onset, interruption-to-stop, stale-tail/rejoin, or network-impairment observation. This P8 continuation made no microphone/audio-output capture and no impairment change. Virtual element clocks, SDK doubles, `captureFrame`, decoded-audio onset, and synthetic progress/proof callbacks are software fixture observations only; they do not establish audible onset, real track playout, or playback stop. The proposed `fixed-delay-jitter-loss-v1` profile (bidirectional 50 ms one-way delay, ±10 ms jitter, independent 1% loss) remains an unexecuted procedure requiring its own authorization and independent verification of the applied profile.

## Deployment and cost

No LiveKit deployment, SFU/TURN path, provider submission, browser session, or WebRTC operating-cost measurement occurred. Historical estimated spend belongs only to the retained WebSocket run; it is not a current WebRTC cost estimate, an invoice reconciliation, or repeat authorization. No claim is made about free service, hosting placement, public access, production readiness, guaranteed cancellation savings, or expected latency improvement. Any future run needs a fresh finite grant: the tested ceilings are 16 capped model dispatches, 60,000 context and 6,000 output tokens per dispatch, 60,000 ms aggregate STT PCM, 4,000 aggregate TTS bytes, 32 speech sockets, 900,000 ms paid-active lifetime, one warm-up plus seven measured at 90,000 ms per case, concurrency one, and a conservative reservation of `$0.99847` that is not an invoice guarantee.

## Limitations

- There is no observed WebRTC after-run, so there are no after p50/p95 values and no valid before/after delta.
- Seven measured baseline samples make the exploratory p95 equal to the maximum; it is not a stable tail estimate.
- The old PCM receipt boundary is not the WebRTC decoded-nonzero boundary and neither is automatically audible onset.
- The headless path cannot prove playback, so an onset-only run would be unverified rather than complete; P8 cannot claim a complete lifecycle comparison from it.
- No packet capture is added: requested/observed packet duration remains `null`, and 80 ms capture calls do not prove 80 ms RTP packets. A nonce in a control event does not correlate an RTP frame to a response.
- No native persistence, real LiveKit media, browser/audio, paid provider, impairment, rollback, or deployment evidence was collected. P7's drills remain unrun.
