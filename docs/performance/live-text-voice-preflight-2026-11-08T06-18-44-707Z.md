# Bounded live preflight — text and current WebRTC now ready

Date: 8 November 2026. Status: **awaiting a narrow scope decision**, no live
model or speech samples submitted. Earlier reports are retained unchanged.

The new application configuration now admits both text and current LiveKit/WebRTC
voice. The remaining condition is Calendar: the effective snapshot still enables
it. The original task prohibits Calendar reads/data/mutations and saved settings
changes. The existing API has no request-level switch to exclude Calendar;
ordinary text admission with Calendar enabled can enter Calendar account/context
handling before inference. Merely omitting Calendar benchmark scenarios is not
equivalent to removing that enabled server capability.

## Verified evidence

| Item | Actual result |
| --- | --- |
| Build | `npm run build` succeeded. |
| Harness syntax | `node --check` succeeded. |
| Offline synthetic speech | Local Windows SAPI; speech-end marker 3734.9375 ms; padded input 5760 ms. |
| Executor handoff | Exact configured port 8001 verified free before normal loopback bootstrap. No second local backend launched. |
| Effective configuration | Active snapshot present; configured native profile true; text admission true; speech ready; effective live voice enabled; no readiness issues. |
| Calendar | Effective capability enabled. No Calendar scenarios submitted or Calendar API calls made. Normal bootstrap reads saved local connection status. |
| Preflight result | `CURRENT_CONFIGURATION_NOT_ADMITTED` solely because Calendar remains enabled under the original scope. |
| Submissions | Text 0, voice 0, warmups 0, client retries 0. |
| Provider diagnostics | Model-dispatch events 0; model-stream-end events 0. Fresh-process voice sessions/audio/characters/tokens remain 0. |
| Shutdown | Supported operations shutdown/application close confirmed safe; server exit code 0. |

No per-mode duration, decoded onset, audible playback or durable chat completion
measurement exists. No p50/p95 or Cosmos product/API/tier/region certification is
claimed. Source/build/input hashes are recorded; complete voice provenance was
not assembled after the preflight stop. Model/speech invoice cost remains
unmeasured; no paid test request was initiated. The user previously waived
provider-side cap verification; no cap was verified or changed.

Existing development persistence was opened and shut down through normal
application lifecycle, including ordinary ownership/index initialization/release.
No chat submission, transcript/checkpoint from a test turn, destructive database
operation, fixture database, public deployment, provisioning, or settings mutation
was performed. Private environment, credential and connection-string contents
were not inspected or printed.

## Scope decision requested

A narrow exception was requested to temporarily disable Calendar using its
existing local settings endpoint, run the authorized one-text/one-WebRTC pair,
then restore its enabled flag. No dependent action has been taken.

Source inspection established material toggle behavior: the normal handler
increments connection revisions and clears discovery cache on authority changes;
restoring the enabled flag does not restore the old cache. This was disclosed
while the question remained pending. No Google Calendar refresh will be used to
rebuild it. Without an exception or operator-provided disabled capability, the
original no-settings-changes restriction remains binding.

## Preserved evidence

- [Run result](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T06-18-44-707Z/results.json)
- [Lifecycle](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T06-18-44-707Z/lifecycle.json)
- [Sanitized process/voice diagnostics](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T06-18-44-707Z/diagnostics.jsonl)
- [One-shot operator harness](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T06-18-44-707Z/bounded-run.mjs)
- [Synthetic timing manifest](../../backend/benchmark-results/webrtc-live-bounded-2026-11-08T06-18-44-707Z/audio/baseline.json); sibling PCM retained locally and not emitted.

All 60 preexisting modified/untracked Git entries were preserved. This evidence
document is the only new Git-visible file for this attempt. No application,
benchmark-source or guard-source changes, staging or commits occurred. Ignored
build output and all local run artifacts are retained without cleanup.
