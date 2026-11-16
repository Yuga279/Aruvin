# Bounded text and current WebRTC voice preflight — 8 November 2026

Outcome: **live checks not executed**. The PowerShell signing-policy obstacle was
resolved using `powershell -NoProfile -ExecutionPolicy Bypass -File` for the
checked-in local SAPI generator. No saved execution policy was changed. The
remaining blocker is missing private startup configuration in this checkout.

## Authorization and limits

The user authorized one synthetic text submission and one synthetic current
LiveKit/WebRTC voice session, at most 60 seconds, without client warmups or
retries. The user subsequently waived verification of the provider-side spending
cap. No account limit was verified or changed. The benchmark budget field remains
authorization metadata, not an enforced invoice ceiling.

Calendar operations, configuration/admin setting changes, provisioning,
deployment, destructive database operations, generated-artifact cleanup, staging,
and commits remained outside this run. No application source was changed.

## Observed results

| Check | Actual evidence |
| --- | --- |
| Backend build | `npm run build` completed successfully before startup. |
| One-shot harness syntax | `node --check` passed; harness is Git-ignored. |
| Offline synthetic speech | Local Windows SAPI succeeded; speech-end marker 3734.9375 ms; padded replay duration below 60 seconds. No cloud synthesis. |
| Local admission | Exact effective port 3000 checked free before the first bootstrap. Backend bound loopback using normal application bootstrap. |
| Effective startup configuration | `backend/.env` absent; no relevant inherited bootstrap environment variable names were present. Native profile false, active configuration snapshot absent, text admission false, speech off, live voice disabled. |
| First guarded preflight | Stopped with `CURRENT_CONFIGURATION_NOT_ADMITTED` before either submission. |
| Passive startup diagnosis | Confirmed `NOT_READY`, seven readiness issues, no active configuration snapshot, zero runtime work. No chat or voice submission. |
| Model evidence | Zero model-dispatch and model-stream-end diagnostic events. |
| Speech evidence | Zero voice sessions, STT/TTS audio milliseconds, TTS characters, prompt tokens and completion tokens in the fresh process. |
| Shutdown | Both diagnostic application starts closed through supported operations shutdown and application close; safe shutdown confirmed. First server exited code 0; diagnostic process also exited code 0. |
| Database changes | None. The non-native/unconfigured startup branch returns before persistence open or Calendar connection-status refresh. No database URI or credential value was inspected or printed. |
| Calendar | Zero Calendar API operations; Calendar scenarios never selected or submitted. |

Actual submitted counts: **text 0, voice 0**, warmups 0, client retries 0.
There are no per-mode durations, TTFT, decoded-audio onset, audible onset,
playback confirmation, or durable conversation completion measurements.
No latency percentiles are claimed. No model/speech charge was initiated by a
submitted check; actual invoice cost is unmeasured, not inferred from estimates.

Fresh source/build/input hashes were recorded. Valid complete current WebRTC
provenance could not be assembled without an active configuration snapshot;
no provenance or playback proof was invented. The headless native SDK loaded,
but no room, participant or provider voice socket was opened. No Cosmos
product/API/tier/region compatibility certification is implied.

## Preserved artifacts

All artifacts below are new, ignored local output; none were cleaned up:

- [Run evidence](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T05-42-25-848Z/results.json)
- [Passive startup diagnosis](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T05-42-25-848Z/startup-diagnosis.json)
- [Sanitized process/voice diagnostics](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T05-42-25-848Z/diagnostics.jsonl) — no matching model/voice events, not a latency result.
- [Lifecycle evidence](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T05-42-25-848Z/lifecycle.json)
- [One-shot operator harness](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T05-42-25-848Z/bounded-run.mjs)
- [Passive diagnostic harness](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T05-42-25-848Z/diagnose-startup.mjs)
- [Synthetic timing manifest](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T05-42-25-848Z/audio/baseline.json); sibling `baseline.pcm` is preserved locally and not attached or emitted.

The earlier empty preparation directory at
`backend/backend/benchmark-results/webrtc-live-bounded-2026-11-08T05-40-09-068Z`
is also preserved. It contains no generated audio or results.

The 58 preexisting modified/untracked entries were preserved. The only new
Git-visible task artifact is this evidence document. Nothing was staged or
committed. Build output and local harness/audio/evidence remain ignored.

The missing prerequisite is the existing private infrastructure configuration
being available to normal backend startup. Supplying or reconstructing it was
not attempted under the no-configuration-changes/no-secret-inspection scope.
