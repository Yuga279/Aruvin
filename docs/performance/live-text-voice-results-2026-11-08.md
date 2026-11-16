# Live text and current WebRTC results — 8 November 2026

The live checks have finished. **Text completed successfully. Voice generated
decoded response audio, but delivery ended with `VOICE_DELIVERY_UNKNOWN`; it is
not a successful proven-playback or completed voice conversation.**

All configured capabilities, including Calendar, stayed enabled. Effective
allowlisted configuration hashes matched across all three runs. No saved
configuration/admin setting or application/benchmark/guard source was changed.
Only the synthetic no-tool baseline cases were selected. No Calendar API request
or mutation was observed; the text ledger records zero Calendar/refresh requests.
Normal startup reads saved local Calendar connection status.

The user revoked the one-submission rule and directed completion against actual
conditions. This continuation used **one text submission and three voice sessions**:
two client compatibility failures followed by one full-input voice attempt. No
warmups ran. The prior HTTP-403 text submission remains separately documented;
including that earlier attempt, this conversation submitted two text requests,
only one of which reached inference. No provider-side cap was verified or changed;
the user had waived that prerequisite. The JSON dollar field is not an invoice cap.

## Text result

| Metric | Single observed sample |
| --- | ---: |
| Acceptance | 14.579 s |
| First nonempty text received | 23.061 s |
| Submission through completed status verification | 28.287 s |
| Model dispatches confirmed by durable accounting | 1, initial dispatch |
| Provider prompt / completion tokens | 4312 / 552 |
| Provider-reported model cost | USD 0.000814900 |

The SSE completion and subsequent status read both indicated completion. The
actual Calendar-enabled durable route emitted no separate pending-save state.
No semantic evaluation of the answer or browser rendering is claimed.

The initial text process's normal stdout filter suppressed detailed model timing
events. Its raw result consequently has zero *dispatch log events*, not zero
provider requests. A bounded read of the matching model-accounting aggregate and
validated dispatch records confirmed the single terminal model attempt, known
cost and nonempty server-side provider-user attribution. No prompt, transcript,
provider identifier or raw identity was exported.

## Voice attempts and final outcome

| Attempt | Input submitted | Outcome | Client time including cleanup |
| --- | ---: | --- | ---: |
| Stock direct-source runner | 0 ms | Installed native SDK rejects 80 ms direct-capture frames; no voice inference | 4.548 s |
| Client split into 10 ms direct frames | 240 ms | Existing strict pacing gate rejected 87.802 ms lateness; no voice inference | 3.193 s |
| Supported buffered SDK input | 5760 ms | Decoded response onset observed; final delivery unknown | 51.246 s |

The offline native check reproduced the SDK error: direct capture requires 160
samples (10 ms at 16 kHz), while the runner supplies 1280 samples (80 ms). A local
split-frame check passed native frame admission, but the live split variant failed
the unchanged pacing guard. Neither failed session produced a model dispatch.

The final operator client used the installed SDK's supported 1000 ms input queue
with the same 80 ms absolute pacing and strict decoded-nonzero-after-`audio.start`
gate. It is an ignored operator copy, not a checked-in benchmark/runtime change.
Its offline 15-frame pacing check passed: maximum lateness 2.294 ms. In the live
run, maximum input lateness was 13.967 ms and maximum observed queued input was
95 ms. The copied client's hash and buffering difference are retained in evidence;
these measurements must not be treated as a stock-client or audible-device result.

Final voice sample:

| Metric | Observation |
| --- | ---: |
| Voice-session setup | 1.566 s |
| Input speech-end to thinking notification | 1.989 s |
| Input speech-end to first decoded nonzero response audio | **8.251 s** |
| Session start to decoded onset | 13.552 s |
| Model first nonempty text after dispatch | 2.254 s |
| Model stream duration | 2.477 s |
| Provider prompt / completion tokens | 3245 / 187 |
| Provider-reported model cost | USD 0.000499025 |

Model generation and its application finalization reached durable terminal
evidence. Voice delivery subsequently settled as `VOICE_DELIVERY_UNKNOWN` and
the wire runner returned `BENCHMARK_MEDIA_FAILED`. The headless client does not
prove browser/device scheduling or audible playback; no playback acknowledgment
or heard-prefix proof was fabricated. Voice `completed` remains false and
`durableCompletionMs` remains null. Decoded samples can include silence and do
not measure how much speech a person heard. No additional live retry was made
for this known proof limitation.

The final voice DELETE request exceeded its five-second response deadline.
Its HTTP cleanup response is unconfirmed, **not** a successful DELETE claim.
Supported application shutdown subsequently confirmed zero voice sessions,
zero runtime work/unresolved writes and zero transport activity.

## Accounting, cleanup and limits

The two accounted model generations total **USD 0.001313925**, with 7557 prompt
tokens and 739 completion tokens. This is provider-reported model cost only.
Speech cost and total invoice cost remain **unknown**. Observed STT audio was
0 ms, 400 ms and 8720 ms across the three voice sessions; these are not billable
duration reconciliation. TTS billing-character/audio fields are unavailable,
despite decoded audio having been observed. Zero-valued incomplete counters do
not establish free synthesis.

All voice client attempts, including their bounded cleanup waits, were below
60 seconds; the full synthetic input was 5.760 seconds. Synthetic speech-end
3734.9375 ms is the local SAPI waveform marker, not a human-perceived acoustic
measurement. There are no p50/p95, comparative transport gains or capacity claims.
Provider queuing/prefill/network latency cannot be isolated by these measurements.

Normal application startup/shutdown used the existing approved development
database. Accepted text and voice turn/checkpoint/accounting data were retained;
no test data or generated artifacts were deleted. Normal ownership/index work
also occurred. No fixture database, Calendar event operation, provisioning,
deployment or public access ran. A native profile/readiness result does not
certify the unknown Cosmos product/API/tier/region.

Each application shutdown returned safe. After the first run, native SDK helper
processes lingered after safe app close; exact owned PIDs were verified as
non-listening and stopped. Later runs called the SDK's exported `dispose()` after
normal close and exited code 0. Final verification confirmed **zero owned Node
processes**, TCP connection refusal on port 8001, zero active voice/runtime/
transport work and zero unresolved writes. Parent benchmark command outcomes
remain nonzero because voice coverage did not pass.

Private environment/credential/connection-string contents, transcripts, tokens
and raw audio were not printed or attached. All 62 preexisting modified/untracked
Git entries were preserved; this document is the only new Git-visible task file.
Nothing was staged or committed. Build and operator-script syntax checks passed;
offline SDK checks and the two failed live client variants remain explicitly
distinguished from the final live measurement.

## Evidence

- [Consolidated summary](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/summary.json)
- [Final voice metrics and complete sanitized timeline](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/voice-result.json)
- [Final run and accounting](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/results.json)
- [Provenance](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/provenance.json), [bounded preflight and operator client hash](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/preflight.json)
- [Lifecycle, text accounting lookup and shutdown](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/lifecycle.json)
- [Final resource verification](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/shutdown-verification.json)
- [Successful text sample](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T07-12-54-043Z/text-result.json)
- [First voice failure](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T07-12-54-043Z/voice-result.json), [offline native frame reproduction](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T07-12-54-043Z/native-frame-check.json)
- [Split-frame live failure](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-19-45-854Z/voice-result.json), [offline split-frame check](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-19-45-854Z/native-frame-adapter-check.json)
- [Buffered native pacing check](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/buffered-input-check.json)
- [As-run final operator driver](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/bounded-run.mjs), [WebRTC caller](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/voice-client.mjs), [strict client copy](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/webrtc-client.mjs)
- [Synthetic timing manifest](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/audio/baseline.json); sibling PCM is retained locally and not attached.

Strict provenance has fresh source/build/configuration/input fingerprints and
explicit unverified SFU/database/provider placement, packet timing and playback
boundary. It supports this headless decoded-onset observation, not an environment-
verified transport comparison or audible-device acceptance.

The [post-run fingerprint check](../../backend/benchmark-results/webrtc-live-voice-2026-11-08T07-23-59-889Z/provenance-verification.json)
passed: backend source, compiled build and operator WebRTC client remained
unchanged from the recorded measurement fingerprints.
