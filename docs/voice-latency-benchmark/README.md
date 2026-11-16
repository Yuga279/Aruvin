# Conversation latency benchmark

Current pre-WebRTC baseline: [real WebSocket measurements — 5 November 2026](websocket-live-baseline-2026-11-05.md). Eight real-provider turns completed; seven measured samples: first received PCM p50 **7.801 s**, exploratory p95 **17.696 s**. Audible browser/device playback and interruption-stop remain unmeasured. [Earlier offline checkpoint](websocket-baseline-2026-11-05.md) is historical.

Benchmarks **text and live voice** using existing application routes. It does not change models, enable tools, bypass authorization, start another database executor, or optimize the system before measuring it.

## Coverage

- Text no-tool baseline: “In two short sentences, explain why the sky looks blue.”
- `calendar_list_events`: upcoming timed events in an explicit date window.
- `calendar_get_event`: details of a known synthetic event.
- `calendar_create_event`: one explicitly requested event on a disposable calendar.
- `calendar_list_calendars`: accessible calendar discovery.
- `calendar_check_availability`: availability in an explicit date/time-zone window.
- Live voice no-tool baseline: the same synthetic question through real input/output speech sockets.

The current runtime excludes Calendar tools from live voice. Reports explicitly list all five voice/tool combinations as **unsupported**, never successful tool executions. Text-tool eligibility still depends on current server configuration, connected account/scopes, model capabilities, and existing authorization.

## Offline verification and dry-run

Run from `backend/`:

```powershell
npm run build
npm run test:benchmark
npm run benchmark -- benchmark.example.json
```

The last command makes **no network calls**. It writes an inventory/blocked-case report under `backend/benchmark-results/<run-id>/`. It is not a latency measurement. Output is ignored by Git.

For exported production-adapter/tool-component fixture measurements:

```powershell
$env:AURVIN_BENCHMARK_FIXTURE_OUTPUT = 'benchmark-results/fixtures'
npm run test:benchmark
Remove-Item Env:AURVIN_BENCHMARK_FIXTURE_OUTPUT
```

These checks exercise real model SSE parsing, all five actual tool executors, synthetic Google responses, and model narration. They do **not** exercise durable application orchestration, real providers, or device playback; their durations and apparent throughput must not be used to judge provider performance. The voice-client test uses a real local HTTP/WebSocket fixture and simulated playback acknowledgments, not Deepgram.

## Generate repeatable synthetic speech without paid calls

On this Windows PC, from `backend/`:

```powershell
powershell -NoProfile -File src/benchmark/make-audio.ps1
```

Uses the installed Windows speech synthesizer, not a cloud provider or microphone. It creates `benchmark-results/audio/baseline.pcm` and `baseline.json`. Existing files are never overwritten; pass `-OutputDirectory` with a new directory to regenerate. The manifest contains the exact synthetic prompt and `speechEndMs`. The marker is the last nonzero synthesized PCM sample, **not** a measurement of human-perceived phonetic end. Two seconds of silence follow it. The replay client sends 80 ms frames at real-time speed, zero-pads the final short frame, and measures actual transmitted audio duration. A supplied custom clip must be raw PCM16 little-endian mono 16 kHz, have at least one second of trailing silence after the declared marker, fit within 65 seconds, and contain only the intended single utterance. Do not use a WAV file or private recording.

## Live run prerequisites

Live runs can incur model and speech charges and persist chat sessions. The [5 November bounded run](websocket-live-baseline-2026-11-05.md) collected real provider measurements using one isolated backend/database; it is not ongoing approval for more calls. Earlier observations about port 8001 are historical; always inspect current listeners and ownership before starting a run.

1. Approve a dollar ceiling. Set provider-account spending limits separately: `budgetCeilingUsd` records authorization, **not a guaranteed invoice cap**. Application/provider retries can incur charges, and cancellations do not guarantee zero billing.
2. Have the operator deploy/restart the instrumented backend at a safe handoff. Use the normal existing single-executor startup process; do not launch a second backend against the same database. The client does not load `.env`, access MongoDB, or change stored settings/flags.
3. Capture the backend's ordinary JSON diagnostic stdout to a local **UTF-8** file with operator-controlled log rotation. Include complete `process` and `voice-pipeline` JSON lines. Supply that file as `serverLog`. Do not point at credential/config files or an old pre-instrumentation log. The client refuses log files larger than 64 MiB. Existing stdout backpressure can drop logs, so missing evidence means unverified, not a zero-duration stage.
4. Copy `benchmark.example.json` to the ignored `benchmark.local.json`; set future start/end timestamps and an IANA time zone. Set `serverRevision` to the deployed commit and `modelLabel` to the actual configured model; these labels are operator declarations, not automatic server verification.
5. Set `allowPaid: true` and `budgetCeilingUsd` only after approval. To measure Calendar reads, also approve data processing and set `allowCalendarData: true`. Supply `eventId` from a known synthetic event. Avoid ordinary/private calendars.
6. To allow the single creation sample, explicitly supply a disposable `calendarId`, `allowMutations: true`, and `disposableCalendar: true`. The prompt requests that specific calendar. Existing server authority/preflight rules remain in force. The runner will **not** blindly confirm a clarification/conflict, retry an uncertain mutation, or delete events. A request that needs confirmation is recorded as such, not as a successful creation benchmark. Complete any required manual cleanup/confirmation with the operator.
7. For voice, the existing server voice flag must already be appropriately enabled and configured. Supply `voicePcm` and `speechEndMs` from the synthetic manifest, and set `origin` to the backend's exact configured frontend origin. The runner does not enable voice or alter CORS/access control. It keeps the voice session open until correlated durable delivery evidence is observed or a finite deadline expires, then ends/deletes only the voice session resource it created (not the durable conversation).

Example additional **nonsecret** fields in the local JSON config:

```json
{
  "allowPaid": true,
  "budgetCeilingUsd": 1,
  "serverLog": "C:/path/to/operator-captured-backend.jsonl",
  "voicePcm": "benchmark-results/audio/baseline.pcm",
  "speechEndMs": 3734.9375
}
```

Merge these into the full example configuration, not a standalone config. The dollar value is illustrative, not approval. Use the marker from your own generated manifest. Never put credentials in JSON or URL arguments. An optional existing local gateway authorization header can be supplied using the private process environment `AURVIN_BENCHMARK_AUTHORIZATION`; it is never exported. The client currently admits only loopback HTTP `/api` targets and refuses redirects/embedded credentials; it is **not** a public/staging load generator.

```powershell
npm run benchmark -- benchmark.local.json --live
```

Defaults: concurrency one, one warm-up and three measured repetitions per read-only/baseline case, 90 second case deadline. Creation uses one measured sample without a warm-up. There is no client-side paid retry. A failed/unverified sample stops repetitions of that scenario; other scenarios retain their own explicit gates. Exit `0` means a successful dry-run or fully successful live coverage; exit `2` means incomplete/failed/blocked live coverage; exit `1` means configuration/prerequisite failure. Reports are saved after each case.

Optional `voiceOnly: true` selects only the existing live-voice no-tool scenario, excluding text and Calendar cases without granting any paid-call permission. The [bounded 5 November driver](../../backend/src/benchmark/live-baseline.ts) used this option with one warm-up plus seven measured repetitions and additional tested outbound spending guards. Its eight-submission authorization is exhausted; it is not permission to rerun.

## Reading the results

`report.md` ranks successful workflows by median duration and lists the longest observed stage spans. `results.json` contains every repetition, expected scenario, observed tool names, outcomes, per-model-round timing/throughput, and ordered correlated diagnostic events. IDs are pseudonymized; event contents, prompts, audio, credentials, private reasoning and Calendar payloads are not copied into reports. Unknown fields from the server log are projected out. Warm-ups and failed/unverified cases are excluded from successful latency percentiles; their outcomes remain visible. A small-sample p95 is descriptive, not a capacity claim.

### Metric definitions

- **Text duration:** client submission through SSE completion and a completed durable status read. Acceptance and first nonempty text receipt are separate values. A provisional delta or EOF is not success.
- **Voice response duration in the ranking:** known input speech-end marker through final **simulated** playback completion. Full operation/setup duration, actual transmitted audio duration, first audio receipt, speech-end-to-thinking notification, speech-end-to-first-audio, durable confirmation, and resource cleanup are separate values.
- **Model first event:** dispatch through first parsed SSE data frame, including empty role/usage frames; it is not TTFT.
- **Model first output:** dispatch through first nonempty text or meaningful tool-call fragment; **first text** is recorded separately. Measurements happen before generation-ID/usage persistence for that frame.
- **Model request/output throughput:** provider-reported `completion_tokens` divided by whole dispatch-to-stream-end seconds, or stream-end-minus-first-output seconds, respectively. Unknown counts/denominators produce `null`. Reasoning tokens may be included by the provider. Stream chunks are never treated as tokens. Measured stream cadence includes application backpressure and prior persistence; it is **not isolated provider decode speed**.
- **Tools/external requests:** one executor span per actual tool invocation, plus nested existing Google request durations. Discovery may be served from a cached bounded snapshot; the log records that rather than pretending an HTTP request occurred.
- **Voice spans:** STT/TTS connection setup, receipt of finalized end-of-turn, turn preparation, model-first-output, first TTS submission after text buffering, first synthesized audio, playback acknowledgment and durable delivery settlement.
- **Persistence/finalization/context:** existing write/checkpoint observations plus measured context and publication spans. This does not time every database read, lease wait, graph operation, event-loop wait, or browser event.
- **Covered/unattributed duration:** union of measured server spans, without double-counting nested/parallel intervals. Per-process monotonic clocks have origin identifiers; spans from different process origins are not combined. A gap is **unattributed**, not automatically CPU time or proof of sequential code.

### Limits on conclusions

Application-observed TTFT cannot separate provider queueing, model prefill, network transit, or local read backpressure without additional provider evidence. Speech-end-to-thinking includes STT endpointing and application/transport notification, not isolated Deepgram compute time. No raw audio or private model reasoning is retained.

**Headless voice does not measure audible browser/device playback.** Its acknowledgment loop consumes received PCM at 24 kHz in real time. Browser AudioWorklet scheduling, hardware output buffering, microphone capture and acoustic delay still need a device/browser measurement. Voice pipeline completion also does not independently establish transcription/answer semantic accuracy.

The [5 November checkpoint](websocket-live-baseline-2026-11-05.md) now supplies initial real-provider voice timings and server-stage observations, not a general text/tool workflow ranking or audible-device result. See [verification.md](verification.md) for earlier offline checks and the checkpoint for actual live coverage, costs, and remaining gates.
