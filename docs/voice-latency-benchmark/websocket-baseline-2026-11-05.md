# WebSocket baseline checkpoint — 5 November 2026

## Current status

**Superseded by the [real-provider baseline](websocket-live-baseline-2026-11-05.md)** after the user explicitly authorized a bounded live run: eight successful turns, one warm-up plus seven measured; first received PCM p50 7.801 s / exploratory p95 17.696 s; reported model plus estimated speech cost $0.091509. Audible playback/interruption remain unmeasured. The remainder below is the **historical initial offline pass**, not the final live-run status or current authorization gate.

## Initial offline status (historical)

**Live comparison baseline incomplete / blocked.** This checkpoint records the current WebSocket runner's offline verification and a reproducible input asset, not measured provider or audible-device latency. No paid provider calls, Calendar API requests, Calendar mutations, application API calls, database access, microphone capture, or device playback were performed. The only HTTP/WebSocket traffic was the benchmark test's ephemeral loopback fixture. No infrastructure was provisioned, backend started/restarted, transport changed, dependency installed, or commit created. Unified review: **skipped**, not passed.

The [WebRTC measurement goals](../live-voice-webrtc/goal.md#verification-goals) require audible reply latency, interruption stopping, startup, and network impairment behavior. Neither the goal nor the [runner instructions](README.md#live-run-prerequisites) supply a paid-run authorization: the README's dollar value is explicitly illustrative. Prior [verification](verification.md#interpretation-and-remaining-gates) also leaves approval outstanding. Therefore no live run was attempted.

## Snapshot and reproducibility

- Observation window: 2026-11-05 approximately 08:08–08:11 UTC (13:38–13:41, UTC+05:30).
- HEAD: `a3188adb4b2cd5668e7fd8cb05938ff481612094`; **dirty worktree**, not a deployed server revision. Existing runtime optimizations were already uncommitted; do not label a future measurement with HEAD alone.
- Windows 11 Pro, 64-bit, OS `10.0.26200`; Node `v24.18.0`, npm `12.0.1`, installed Vitest `4.1.11`. Existing installed dependencies were used.
- Before this documentation was added, SHA-256 of `git diff --binary HEAD` stdout: `1f44ca9d20c908b72e5251e50b74a1d14f35c3e233bbeb664c279d0c1c68674c`. This identifies the tracked diff only, not untracked files or a runnable release.
- Initially 21 modified tracked files (listed below), plus untracked `docs/live-voice-webrtc/`. No staged changes were reported. Existing benchmark sources/tests were unchanged. All existing changes were preserved.
- A listener inventory found port 5173 listening and no listener on 3000 or 8001 at that instant. Listener presence alone does not verify frontend identity. No endpoint was contacted or process modified.
- Actual active model, STT/TTS model/version, voice flags, quotas, provider limits, database topology, server revision, and diagnostic log: **unverified**. Manageable settings live in the encrypted database configuration, not legacy `.env` values; neither secrets nor stored settings were inspected. Source integrates OpenRouter and Deepgram; that is not proof of effective running configuration.

Initial modified paths:

```text
backend/src/chat-runtime/admission-receipt.ts
backend/src/chat-runtime/durable-chat-runtime.ts
backend/src/chat-runtime/finalization.ts
backend/src/model/index.ts
backend/src/model/openrouter-adapter.ts
backend/src/persistence/metadata.ts
backend/src/voice/agent/agent-voice-adapter.ts
backend/src/voice/agent/voice-delivery.ts
backend/src/voice/providers/flux-tts.ts
backend/src/voice/session/live-flow.ts
backend/src/voice/usage/voice-accounting.ts
backend/test/performance/voice-critical-path.spec.ts
backend/test/persistence/voice-metadata.spec.ts
backend/test/runtime/voice-output.spec.ts
backend/test/voice/agent/voice-delivery.spec.ts
backend/test/voice/providers/accounting.spec.ts
frontend/src/features/voice/audio/audio-capture-service.test.ts
frontend/src/features/voice/audio/audio-capture-service.ts
frontend/src/features/voice/integration-tests/voice-matrix.test.ts
frontend/src/features/voice/state/live-voice-controller.test.ts
frontend/src/features/voice/state/live-voice-controller.ts
```

## What actually ran

Commands below ran once from `backend/`, except the repository whitespace check:

| Command | Observed result |
| --- | --- |
| `npm run build` | **Failed**, exit 1, three TypeScript errors in pre-existing modified runtime files. `durable-chat-runtime.ts:28` and `finalization.ts:38` import `VoiceDeliveryRecord` from metadata, which does not export it (the definition exists in `contracts/voice.ts`). `durable-chat-runtime.ts:1285` uses `generation-start`, absent from `OwnedPhaseName`. No fix attempted in this baseline-only task. |
| `npm run test:benchmark` | **80 passed, 6 files**, exit 0; Vitest total duration 1.97 s. Includes actual local HTTP/WebSocket client pacing, simulated playback progress, durable-confirmation hook, and cleanup; other transports are injected fixtures. Suite runtime is not conversation latency. |
| `npm run benchmark -- benchmark.example.json` | **Dry-run**, exit 0; seven scenario records skipped as `dry-run`, five voice/Calendar combinations unsupported, empty latency summary. No scenario executions, warm-ups, or paid calls. |
| `powershell -NoProfile -File src/benchmark/make-audio.ps1 -OutputDirectory benchmark-results/ws-baseline-2026-11-05/audio` | Passed; offline Windows speech synthesis, not a microphone or speech-provider run. Fresh unique output; no prior asset overwritten. |
| `git diff --check` (repository) | Passed, exit 0. Git emitted LF/CRLF conversion warnings, not whitespace errors. |

The failed build emitted the benchmark CLI and the dry-run could execute it. This does **not** establish a successful application build or permission to deploy partial output. Rebuild successfully before any live run.

Final documentation checks: all 11 local Markdown link targets existed; dry-run JSON was asserted to contain exactly seven skipped records and an empty summary; README whitespace check passed. Only this report and its README link were added/edited by the task; the existing benchmark-acceptance backlog item was refreshed rather than duplicated.

Local generated artifacts follow the existing ignored `backend/benchmark-results/` convention; retain them locally when comparing:

- [Dry-run report](../../backend/benchmark-results/7e919ae8-525e-4e7f-8d54-c6d3ae4f6180/report.md) and [results.json](../../backend/benchmark-results/7e919ae8-525e-4e7f-8d54-c6d3ae4f6180/results.json); run ID `7e919ae8-525e-4e7f-8d54-c6d3ae4f6180`, persisted at `2026-11-05T08:09:34.451Z`.
- [Build log](../../backend/benchmark-results/ws-baseline-2026-11-05/build.log), [test log](../../backend/benchmark-results/ws-baseline-2026-11-05/tests.log), [dry-run log](../../backend/benchmark-results/ws-baseline-2026-11-05/dry-run.log), [audio-generation log](../../backend/benchmark-results/ws-baseline-2026-11-05/audio-generation.log).
- [Synthetic audio manifest](../../backend/benchmark-results/ws-baseline-2026-11-05/audio/baseline.json) and [PCM](../../backend/benchmark-results/ws-baseline-2026-11-05/audio/baseline.pcm): 183,518 bytes, SHA-256 `933c59e38179c0a16df1b26aa1567a8a76ee823c0c0ceaf820feef382412c3a1`; PCM16 little-endian, mono, 16 kHz. Speech-end marker `3734.9375 ms`, followed by 2000 ms silence. Marker is last nonzero waveform sample, not perceived phonetic end. No message payload is copied into this report.

## Measurement ledger

| Required/related metric | Live samples | Result and boundary |
| --- | ---: | --- |
| Speech end → first **audible** reply p50/p95 | 0 | **Not measured**; no browser/hardware observation. |
| Speech end → first client audio receipt p50/p95 | 0 | **Not measured**; runner exposes `speechEndToFirstAudioMs`, distinct from audibility. |
| Server first synthesized audio | 0 | **Not measured**; `tts-first-audio` is a server pipeline span, not delivery or audibility. Never subtract independent process clocks without alignment. |
| User interruption → actual playback stop | 0 | **Not measured**; existing headless runner rejects `response.cancelled` rather than benchmarking barge-in. |
| Connection startup | 0 | **Not measured**; runner's `setupMs` covers HTTP voice creation through `session.ready`, not microphone permission or browser audio readiness. |
| Jitter / packet loss | 0 | **Not measured**; no impairment introduced. |
| Durable live completion / cancellation / quotas / accounting | 0 | No live evidence; fixture checks do not certify the running service. |

Configured dry-run values were concurrency 1, warm-ups 1, measured repetitions 3, default timeout 90 s; **actual executed count for all these is zero**. Warm/cold live state: not applicable. The fixture has two voice-client tests, including one successful simulated socket exchange; no provider percentiles were derived. All real latency values remain unavailable, not zero.

Important comparison detail: the CLI's voice summary p50/p95 currently ranks **speech-end to simulated playback end**, not first audible reply or even first receipt. For a future headless baseline, compute receipt percentiles from successful non-warm-up `voice-baseline` records' `speechEndToFirstAudioMs` separately (nearest-rank, matching `report.ts`). Keep failures and missing evidence visible. Three measured samples make p95 just the largest observation, not a stable tail estimate.

## Smallest next step and proposed approval (not yet granted)

1. Have the owning developer finish the current runtime changes and restore a successful build; identify the exact source/build snapshot, including dirty hashes if still uncommitted. Do not substitute stale `dist` output. Operator safely starts the normal **single** backend executor, verifies ready/live-voice configuration, and supplies current UTF-8 diagnostic stdout containing complete `process` and `voice-pipeline` events (≤64 MiB). No second database executor or database mutation for test setup is authorized here.
2. Request approval for an initial **US$1 total, at most 8 logical submissions, concurrency 1, 90 s/submission, 15 min wall-clock** run: one warm-up plus three measured text no-tool baselines and one warm-up plus three measured live-voice no-tool baselines. The current CLI always includes text baseline; it has no voice-only selector. Set Calendar data/mutation/disposable-calendar flags **false** throughout, so all five Calendar cases remain blocked. Partial-coverage live exit 2 is expected and must not be confused with failure of successful baseline samples. No client retry or automatic rerun. Stop further work at the approved cost limit, an unexpected tool invocation, unknown accounting, or prerequisite failure. Provider-side caps/operator monitoring are required: `budgetCeilingUsd` is metadata, not an enforced billing cap. Before approval is actionable, operator must confirm finite existing server retry/dispatch/output limits and worst-case tariff reservation fit US$1; otherwise request a revised ceiling, never silently expand it.
3. Separately obtain a bounded browser/device approval: proposed **US$1 additional, at most 7 voice submissions, 90 s each, 15 min wall-clock**, consisting of one warm-up plus three measured audible-reply samples and three interruption samples. This is operator-observed work, not provided by the current CLI. Confirm synthetic-audio/device routing and nonprivate audio consent; do not record private speech or reply content. Use the same calibrated monotonic observation method for both transports. Capture speech-end and actual output onset/stop with an acoustic/device-loopback reference, not only WebSocket events or UI state. State calibration/resolution and verify no stale audio after interruption. Without this observation, even a successful headless live run will **not** complete the audible baseline.
4. Network impairment tests need a separately agreed finite profile and approval; keep the initial baseline unimpaired and state network/device details. Before transport implementation, choose and record identical delay/jitter/loss profiles and repeats for both paths. No such tests were authorized or run here.

### Pin these parameters for the before/after comparison

- Reuse the exact PCM bytes/hash above, marker and semantic scenario; 80 ms input frames (2560 bytes), zero-padding of final frame; 5760 ms total transmitted input when the entire clip is sent. Future WebRTC packetization may differ: record it rather than silently asserting equivalence.
- Keep input locale `en-US`, input PCM16/16 kHz/mono and output PCM16/24 kHz/mono, response length limits, actual model identifier/version/routing, STT/TTS models, endpointing settings, prompt/system/product asset revisions, context/history (fresh conversation), server quotas/retries, browser/device and network location fixed or explicitly record differences. Do not override models just for the benchmark.
- Headless client opens a fresh voice session per sample; record provider/cache reuse and first-run cold/warm state explicitly. The one excluded warm-up does not prove every subsystem is warm. Browser samples must label permission/unlock/setup state separately.
- Retain revision/build hashes, date, effective nonsecret settings, all sample outcomes, warm-up exclusions, cost/accounting evidence, startup, receipt, simulated completion, server spans, and independently observed audible timings. Do not export provider bodies, transcripts, raw private audio, credentials or connection strings.

### Repeat instructions

For safe repetition, run the commands in the table; use a **new** audio output directory because the generator refuses overwrites. `benchmark.example.json` has historical Calendar dates, but dry-run never sends them. For approved live work, copy it to ignored `backend/benchmark.local.json`, use a future UTC window and explicit time zone as required by the schema, add the generated PCM/marker, actual origin, operator-supplied log, exact server revision and actual model label. Set `allowPaid` and `budgetCeilingUsd` only after the approval above. Run `npm run benchmark -- benchmark.local.json --live` from `backend/` once. Do not enable Calendar flags or supply mutation approval. Preserve the generated run directory and add actual results to this checkpoint before claiming the WebSocket baseline complete.
